function runMicrogridSimulation(files, params) {
  // 1. Resample all 6 files to 1-minute grid
  const pvForecast1m = resampleSeriesTo1Minute(files.PV_forecast, '1h');
  const pvMeasure1m = resampleSeriesTo1Minute(files.PV_measures, '1min');
  const loadForecast1m = resampleSeriesTo1Minute(files.LOAD_forecast, '5min');
  const loadMeasure1m = resampleSeriesTo1Minute(files.LOAD_measure, '1min');
  const gridPrice1m = resampleSeriesTo1Minute(files.GRID_forecast, '1h');
  const bessForecast1m = resampleSeriesTo1Minute(files.BESS_forecast, '1h');

  // Scaling factor for PV peak if user adjusted dimensioning slider
  const pvScale = params.pvCapacityKwp >= 0 ? params.pvCapacityKwp / 250 : 1;
  // Courbe de charge normalisée (échantillon = référence) puis multipliée par le
  // paramètre "LOAD : Puissance" (%) du Dimensionnement.
  const loadScale = (params.loadPowerPercent || 0) / 100;

  // Battery energy & limits
  const maxEnergy = (params.bessCapacityKwh * params.bessMaxSocPercent) / 100;
  const minEnergy = (params.bessCapacityKwh * params.bessMinSocPercent) / 100;
  let currentEnergy = (params.bessCapacityKwh * params.bessInitialSocPercent) / 100;
  const oneWayEff = Math.sqrt(params.bessEfficiencyPercent / 100);
  const dtHours = 1 / 60;

  // Find median price for arbitrage
  const sortedPrices = [...gridPrice1m].sort((a, b) => a - b);
  const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)] || 75;

  const points = [];
  let totalPvKwh = 0;
  let totalLoadKwh = 0;
  let totalImportKwh = 0;
  let totalExportKwh = 0;
  let totalBessChargeKwh = 0;
  let totalBessDischargeKwh = 0;
  let totalCurtailedKwh = 0;
  let totalUnmetKwh = 0;

  let totalCostEur = 0;
  let totalRevenueEur = 0;
  let baselineBillEur = 0;

  let pvAbsDeltaSum = 0;
  let loadAbsDeltaSum = 0;
  let pvMaxDelta = 0;
  let loadMaxDelta = 0;

  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const timeLabel = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

    const pvF = Math.max(0, (pvForecast1m[m] || 0) * pvScale);
    const pvM = Math.max(0, (pvMeasure1m[m] || 0) * pvScale);
    const pvDelta = pvM - pvF; // >0: overperformance, <0: underperformance

    const loadF = Math.max(0, (loadForecast1m[m] || 0) * loadScale);
    const loadM = Math.max(0, (loadMeasure1m[m] || 0) * loadScale);
    const loadDelta = loadM - loadF; // >0: overconsumption

    const priceMwh = gridPrice1m[m] || 70;
    const priceKwh = priceMwh / 1000;
    const feedInKwh = params.feedInTariffEurMwh / 1000;
    const plannedBessKw = bessForecast1m[m] || 0;

    // Deltas
    const absPv = Math.abs(pvDelta);
    const absLoad = Math.abs(loadDelta);
    pvAbsDeltaSum += absPv;
    loadAbsDeltaSum += absLoad;
    if (absPv > pvMaxDelta) pvMaxDelta = absPv;
    if (absLoad > loadMaxDelta) loadMaxDelta = absLoad;

    // Power balance before battery
    const netLocal = pvM - loadM; // positive = surplus, negative = deficit

    const { bessChargeKw, bessDischargeKw, bessNetKw } = computeBessDispatch(params, {
      plannedBessKw,
      priceMwh,
      medianPrice,
      netLocal,
      loadM,
      currentEnergy,
      minEnergy,
      maxEnergy,
      oneWayEff,
      dtHours,
    });

    // Battery energy update
    if (bessChargeKw > 0) {
      currentEnergy += bessChargeKw * dtHours * oneWayEff;
    } else if (bessDischargeKw > 0) {
      currentEnergy -= (bessDischargeKw * dtHours) / oneWayEff;
    }
    currentEnergy = Math.max(minEnergy, Math.min(maxEnergy, currentEnergy));
    const currentSoc = params.bessCapacityKwh > 0 ? (currentEnergy / params.bessCapacityKwh) * 100 : 0;

    // Remaining exchange with Grid
    const residual = netLocal + bessNetKw; // pv - load + (disch - chg)

    let gridImportKw = 0;
    let gridExportKw = 0;
    let curtailmentKw = 0;
    let unmetLoadKw = 0;

    if (residual > 0) {
      if (residual <= params.gridMaxExportKw) {
        gridExportKw = residual;
      } else {
        gridExportKw = params.gridMaxExportKw;
        curtailmentKw = residual - params.gridMaxExportKw;
      }
    } else if (residual < 0) {
      const deficit = -residual;
      if (deficit <= params.gridContractKw) {
        gridImportKw = deficit;
      } else {
        gridImportKw = params.gridContractKw;
        unmetLoadKw = deficit - params.gridContractKw;
      }
    }

    // Financial calculations
    const minuteCost = gridImportKw * dtHours * priceKwh;
    const minuteRev = gridExportKw * dtHours * feedInKwh;
    totalCostEur += minuteCost;
    totalRevenueEur += minuteRev;
    baselineBillEur += loadM * dtHours * priceKwh;

    // Accumulate kWh
    totalPvKwh += pvM * dtHours;
    totalLoadKwh += loadM * dtHours;
    totalImportKwh += gridImportKw * dtHours;
    totalExportKwh += gridExportKw * dtHours;
    totalBessChargeKwh += bessChargeKw * dtHours;
    totalBessDischargeKwh += bessDischargeKw * dtHours;
    totalCurtailedKwh += curtailmentKw * dtHours;
    totalUnmetKwh += unmetLoadKw * dtHours;

    points.push({
      minuteIndex: m,
      timeLabel,
      pvForecastKw: parseFloat(pvF.toFixed(2)),
      pvMeasureKw: parseFloat(pvM.toFixed(2)),
      pvDeltaKw: parseFloat(pvDelta.toFixed(2)),
      loadForecastKw: parseFloat(loadF.toFixed(2)),
      loadMeasureKw: parseFloat(loadM.toFixed(2)),
      loadDeltaKw: parseFloat(loadDelta.toFixed(2)),
      gridPriceEurMwh: parseFloat(priceMwh.toFixed(1)),
      gridImportKw: parseFloat(gridImportKw.toFixed(2)),
      gridExportKw: parseFloat(gridExportKw.toFixed(2)),
      gridNetKw: parseFloat((gridImportKw - gridExportKw).toFixed(2)),
      bessChargeKw: parseFloat(bessChargeKw.toFixed(2)),
      bessDischargeKw: parseFloat(bessDischargeKw.toFixed(2)),
      bessNetKw: parseFloat((bessDischargeKw - bessChargeKw).toFixed(2)),
      bessSocPercent: parseFloat(currentSoc.toFixed(1)),
      curtailmentKw: parseFloat(curtailmentKw.toFixed(2)),
      unmetLoadKw: parseFloat(unmetLoadKw.toFixed(2)),
      cumulativeCostEur: parseFloat((totalCostEur - totalRevenueEur).toFixed(2)),
    });
  }

  const netBill = totalCostEur - totalRevenueEur;
  const savings = baselineBillEur - netBill;
  const consumedPv = Math.max(0, totalPvKwh - totalExportKwh - totalCurtailedKwh);
  const autoconsumptionRate = totalPvKwh > 0 ? Math.min(100, (consumedPv / totalPvKwh) * 100) : 0;
  const coveredLoad = Math.max(0, totalLoadKwh - totalImportKwh);
  const autoproductionRate = totalLoadKwh > 0 ? Math.min(100, (coveredLoad / totalLoadKwh) * 100) : 0;
  const bessCycles = params.bessCapacityKwh > 0 ? (totalBessChargeKwh + totalBessDischargeKwh) / (2 * params.bessCapacityKwh) : 0;

  const kpis = {
    totalPvEnergyKwh: Math.round(totalPvKwh),
    totalLoadEnergyKwh: Math.round(totalLoadKwh),
    totalGridImportKwh: Math.round(totalImportKwh),
    totalGridExportKwh: Math.round(totalExportKwh),
    totalBessChargedKwh: Math.round(totalBessChargeKwh),
    totalBessDischargedKwh: Math.round(totalBessDischargeKwh),
    totalCurtailedKwh: Math.round(totalCurtailedKwh),
    totalUnmetLoadKwh: Math.round(totalUnmetKwh),
    autoconsumptionRatePercent: parseFloat(autoconsumptionRate.toFixed(1)),
    autoproductionRatePercent: parseFloat(autoproductionRate.toFixed(1)),
    totalCostEur: parseFloat(totalCostEur.toFixed(2)),
    totalRevenueEur: parseFloat(totalRevenueEur.toFixed(2)),
    netBillEur: parseFloat(netBill.toFixed(2)),
    baselineBillEur: parseFloat(baselineBillEur.toFixed(2)),
    totalSavingsEur: parseFloat(savings.toFixed(2)),
    bessCycles: parseFloat(bessCycles.toFixed(2)),
    pvMaxDeltaKw: parseFloat(pvMaxDelta.toFixed(1)),
    loadMaxDeltaKw: parseFloat(loadMaxDelta.toFixed(1)),
    pvMaeKw: parseFloat((pvAbsDeltaSum / 1440).toFixed(2)),
    loadMaeKw: parseFloat((loadAbsDeltaSum / 1440).toFixed(2)),
  };

  return { points, kpis };
}

/**
 * Storage persistence helpers
 */
function saveStateToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_PARAMS_KEY, JSON.stringify(state.params));
    localStorage.setItem(STORAGE_FILES_KEY, JSON.stringify(state.files));
  } catch (err) {
    console.warn('LocalStorage save failed:', err);
  }
}

function loadStateFromLocalStorage() {
  try {
    const savedParams = localStorage.getItem(STORAGE_PARAMS_KEY);
    if (savedParams) {
      state.params = { ...DEFAULT_PARAMS, ...JSON.parse(savedParams) };
    }

    const savedFiles = localStorage.getItem(STORAGE_FILES_KEY);
    if (savedFiles) {
      state.files = JSON.parse(savedFiles);
    }
  } catch (err) {
    console.warn('LocalStorage load failed:', err);
  }

  // Check if any required file is missing; if so, populate with default sample
  let missing = false;
  for (const spec of FILE_SPECS) {
    if (!state.files[spec.id]) {
      missing = true;
      break;
    }
  }

  if (missing) {
    const sample = generateRealisticSampleCsvs();
    state.files = { ...sample, ...state.files };
    saveStateToLocalStorage();
  }

  // Load BESS planned power from CSV
  state.planningBess = extractBessPlanFromCsv(state.files.BESS_forecast);
}

/**
 * UI Rendering & Chart Updates
 */
