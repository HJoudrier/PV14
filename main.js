// Papa and Chart are loaded globally via vendor/papaparse.min.js and vendor/chart.umd.min.js

// Register Chart.js components
Chart.register(
  Chart.LineController,
  Chart.BarController,
  Chart.LineElement,
  Chart.BarElement,
  Chart.PointElement,
  Chart.LinearScale,
  Chart.CategoryScale,
  Chart.Title,
  Chart.Tooltip,
  Chart.Legend,
  Chart.Filler
);

// File specifications as defined in user prompt
const FILE_SPECS = [
  {
    id: 'GRID_forecast',
    filename: 'GRID_forecast.csv',
    asset: 'GRID',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: '€/MWh & kW',
    desc: 'Prix de l\'énergie horaire et limite contractuelle réseau',
    color: '#3b82f6',
  },
  {
    id: 'PV_forecast',
    filename: 'PV_forecast.csv',
    asset: 'PV',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: 'kW',
    desc: 'Prévision de production solaire photovoltaïque',
    color: '#eab308',
  },
  {
    id: 'BESS_forecast',
    filename: 'BESS_forecast.csv',
    asset: 'BESS',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: 'kW & %',
    desc: 'Planning prévisionnel de pilotage batterie (puissance & SoC)',
    color: '#10b981',
  },
  {
    id: 'LOAD_forecast',
    filename: 'LOAD_forecast.csv',
    asset: 'LOAD',
    type: 'forecast',
    resolution: '5 min',
    unit: 'kW',
    desc: 'Prévision de la consommation de la charge non pilotable',
    color: '#ef4444',
  },
  {
    id: 'PV_measures',
    filename: 'PV_measures.csv',
    asset: 'PV',
    type: 'measure',
    resolution: '1 min',
    unit: 'kW',
    desc: 'Mesures réelles de production PV (télémétrie)',
    color: '#ca8a04',
  },
  {
    id: 'LOAD_measure',
    filename: 'LOAD_measure.csv',
    asset: 'LOAD',
    type: 'measure',
    resolution: '1 min',
    unit: 'kW',
    desc: 'Mesures réelles de consommation de la charge',
    color: '#dc2626',
  },
];

// Default dimensioning parameters
const DEFAULT_PARAMS = {
  pvCapacityKwp: 250,
  pvPriceEurPerKwc: 1200,
  bessCapacityKwh: 400,
  bessCapacityPriceEurPerKwh: 250,
  bessPowerKw: 150,
  bessPowerPriceEurPerKw: 150,
  bessEfficiencyPercent: 92,
  bessMinSocPercent: 10,
  bessMaxSocPercent: 95,
  bessInitialSocPercent: 45,
  gridContractKw: 160,
  gridMaxExportKw: 120,
  feedInTariffEurMwh: 45,
  strategy: 'self_consumption', // 'self_consumption' | 'follow_forecast' | 'price_arbitrage' | 'peak_shaving'
};

// Default 24h BESS schedule (kW)
const DEFAULT_BESS_PLAN = [
  0, 0, 0, 0, 0, 0,
  15, 25, 0, 0,
  -60, -90, -110, -95, -50,
  0, 0,
  80, 115, 120, 90, 45,
  0, 0,
];

// Global State
const state = {
  files: {},
  params: { ...DEFAULT_PARAMS },
  simulationResult: null,
  currentMinuteIndex: 780, // 13:00 default cursor
  isPlaying: false,
  playbackInterval: null,
  charts: {},
  activeTab: 'overview',
  planningBess: [...DEFAULT_BESS_PLAN],
  selectedPlanningHour: 12,
  isDraggingPlanning: false,
  planningDebounceTimer: null,
};

// LocalStorage Keys
const STORAGE_PREFIX = 'microgrid_';
const STORAGE_PARAMS_KEY = `${STORAGE_PREFIX}params`;
const STORAGE_FILES_KEY = `${STORAGE_PREFIX}files`;

/**
 * Generates realistic sample CSV contents for standard 24-hour day (2026-06-15)
 */
function generateRealisticSampleCsvs() {
  const dateStr = '2026-06-15';

  // 1. GRID_forecast.csv (24 rows, 1h step)
  const gridRows = ['timestamp,price_eur_per_mwh,contract_limit_kw'];
  const basePrices = [
    65, 58, 52, 50, 56, 72, 115, 148, 130, 85,
    55, 32, 22, 28, 42, 68, 92, 135, 185, 210,
    170, 132, 98, 76
  ];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    gridRows.push(`${dateStr} ${hh}:00:00,${basePrices[h]},160.0`);
  }

  // 2. PV_forecast.csv (24 rows, 1h step)
  const pvForecastRows = ['timestamp,pv_power_kw'];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    let power = 0;
    if (h >= 6 && h <= 20) {
      const angle = ((h - 6) / 14) * Math.PI;
      power = Math.sin(angle) * 215;
    }
    pvForecastRows.push(`${dateStr} ${hh}:00:00,${power.toFixed(1)}`);
  }

  // 3. LOAD_forecast.csv (288 rows, 5 min step)
  const loadForecastRows = ['timestamp,load_power_kw'];
  for (let m = 0; m < 1440; m += 5) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let base = 35; // night
    if (h >= 6 && h < 19) {
      const progress = (h - 6) + min / 60;
      base = 42 + 70 * (1 / (1 + Math.exp(-(progress - 1.5) * 2)));
      if (h >= 12 && h < 14) {
        base -= 24 * Math.sin(((progress - 6) / 2) * Math.PI);
      } else if (h >= 14 && h < 17) {
        base += 18 * Math.sin(((progress - 8) / 3) * Math.PI);
      }
    } else if (h >= 19 && h < 23) {
      const down = (h - 19) + min / 60;
      base = 105 - down * 20;
    }
    loadForecastRows.push(`${dateStr} ${hh}:${mm}:00,${base.toFixed(2)}`);
  }

  // 4. BESS_forecast.csv (24 rows, 1h step)
  const bessForecastRows = ['timestamp,planned_power_kw,target_soc_percent'];
  const bessPlan = (state && state.planningBess && state.planningBess.length === 24)
    ? state.planningBess
    : DEFAULT_BESS_PLAN;
  let soc = 45;
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const p = bessPlan[h];
    soc = Math.min(95, Math.max(10, soc - (p * 1.0) / 400 * 100));
    bessForecastRows.push(`${dateStr} ${hh}:00:00,${p.toFixed(1)},${soc.toFixed(1)}`);
  }

  // 5. PV_measures.csv (1440 rows, 1 min step)
  const pvMeasuresRows = ['timestamp,pv_measured_kw'];
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let power = 0;
    if (m >= 360 && m <= 1260) {
      const fracHour = m / 60;
      const angle = ((fracHour - 6) / 14) * Math.PI;
      const clearSky = Math.sin(angle) * 224;

      // Realistic cloud passage at 10:45 - 11:35 and small dip at 13:40
      let cloud = 1.0;
      if (m >= 645 && m <= 700) {
        cloud = 0.32 + 0.18 * Math.cos(((m - 670) / 55) * Math.PI);
      } else if (m >= 810 && m <= 845) {
        cloud = 0.58 + 0.22 * Math.sin((m / 5) * 0.8);
      }
      const noise = (Math.sin(m * 12.3) * 0.035) + (Math.cos(m * 7.7) * 0.025);
      power = Math.max(0, clearSky * cloud * (1 + noise));
    }
    pvMeasuresRows.push(`${dateStr} ${hh}:${mm}:00,${power.toFixed(2)}`);
  }

  // 6. LOAD_measure.csv (1440 rows, 1 min step)
  const loadMeasureRows = ['timestamp,load_measured_kw'];
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let base = 35;
    if (h >= 6 && h < 19) {
      const progress = (h - 6) + min / 60;
      base = 42 + 70 * (1 / (1 + Math.exp(-(progress - 1.5) * 2)));
      if (h >= 12 && h < 14) {
        base -= 24 * Math.sin(((progress - 6) / 2) * Math.PI);
      } else if (h >= 14 && h < 17) {
        base += 18 * Math.sin(((progress - 8) / 3) * Math.PI);
      }
    } else if (h >= 19 && h < 23) {
      const down = (h - 19) + min / 60;
      base = 105 - down * 20;
    }

    // Industrial spikes & motor cycles
    const compressor = (m % 20 < 8) && (h >= 7 && h <= 18) ? 16 : 0;
    const peakMotor = (m % 110 === 22 || m % 110 === 23) && (h >= 8 && h <= 17) ? 26 : 0;
    const noise = (Math.sin(m * 3.14) * 3.4) + (Math.cos(m * 1.6) * 2.2);

    const actual = Math.max(26, base + compressor + peakMotor + noise);
    loadMeasureRows.push(`${dateStr} ${hh}:${mm}:00,${actual.toFixed(2)}`);
  }

  return {
    GRID_forecast: gridRows.join('\n'),
    PV_forecast: pvForecastRows.join('\n'),
    BESS_forecast: bessForecastRows.join('\n'),
    LOAD_forecast: loadForecastRows.join('\n'),
    PV_measures: pvMeasuresRows.join('\n'),
    LOAD_measure: loadMeasureRows.join('\n'),
  };
}

/**
 * Extract time to minute-of-day (0 to 1439)
 */
function parseTimeToMinutes(ts) {
  if (!ts) return 0;
  const match = String(ts).match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }
  return 0;
}

/**
 * Resamples raw data series into a continuous 1440-point minute array
 */
function resampleSeriesTo1Minute(rawCsv, defaultRes = '1h') {
  const result = new Array(1440).fill(0);
  if (!rawCsv || !rawCsv.trim()) return result;

  const parsed = Papa.parse(rawCsv.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rows = parsed.data || [];
  const fields = parsed.meta.fields || [];
  if (rows.length === 0 || fields.length === 0) return result;

  const timeCol = fields.find((f) => /time|date|horaire|horodate|ts/i.test(f)) || fields[0];
  const valCol = fields.find((f) => f !== timeCol && /power|puissance|kw|eur|price|prix|load|charge|pv|measure|mesure|value/i.test(f))
    || fields.find((f) => f !== timeCol)
    || fields[1];

  const minuteMap = new Map();
  for (const row of rows) {
    const rawT = row[timeCol];
    const rawV = row[valCol];
    if (rawT === undefined || rawV === undefined) continue;

    const m = parseTimeToMinutes(rawT);
    const num = parseFloat(String(rawV).replace(',', '.'));
    if (!isNaN(num)) {
      minuteMap.set(m, num);
    }
  }

  if (minuteMap.size === 0) return result;

  const knownMinutes = Array.from(minuteMap.keys()).sort((a, b) => a - b);

  // If 1-minute step: direct fill with gap preservation
  if (knownMinutes.length > 500) {
    let lastVal = minuteMap.get(knownMinutes[0]) || 0;
    for (let m = 0; m < 1440; m++) {
      if (minuteMap.has(m)) {
        lastVal = minuteMap.get(m);
      }
      result[m] = lastVal;
    }
    return result;
  }

  // If 5-min step (interpolation)
  if (knownMinutes.length >= 200 && knownMinutes.length <= 350) {
    for (let m = 0; m < 1440; m++) {
      if (minuteMap.has(m)) {
        result[m] = minuteMap.get(m);
      } else {
        let prevM = knownMinutes[0];
        let nextM = knownMinutes[knownMinutes.length - 1];
        for (let i = 0; i < knownMinutes.length; i++) {
          if (knownMinutes[i] <= m) prevM = knownMinutes[i];
          if (knownMinutes[i] >= m) {
            nextM = knownMinutes[i];
            break;
          }
        }
        if (prevM === nextM) {
          result[m] = minuteMap.get(prevM) || 0;
        } else {
          const v0 = minuteMap.get(prevM) || 0;
          const v1 = minuteMap.get(nextM) || 0;
          const alpha = (m - prevM) / (nextM - prevM);
          result[m] = v0 + (v1 - v0) * alpha;
        }
      }
    }
    return result;
  }

  // Hourly step (hourly hold or ramp)
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const hMin = h * 60;
    if (minuteMap.has(hMin)) {
      result[m] = minuteMap.get(hMin);
    } else {
      let closest = knownMinutes[0];
      let minDiff = Infinity;
      for (const km of knownMinutes) {
        const diff = Math.abs(km - m);
        if (diff < minDiff) {
          minDiff = diff;
          closest = km;
        }
      }
      result[m] = minuteMap.get(closest) || 0;
    }
  }

  return result;
}

/**
 * Microgrid Physics Simulation Engine
 */
function runMicrogridSimulation(files, params) {
  // 1. Resample all 6 files to 1-minute grid
  const pvForecast1m = resampleSeriesTo1Minute(files.PV_forecast, '1h');
  const pvMeasure1m = resampleSeriesTo1Minute(files.PV_measures, '1min');
  const loadForecast1m = resampleSeriesTo1Minute(files.LOAD_forecast, '5min');
  const loadMeasure1m = resampleSeriesTo1Minute(files.LOAD_measure, '1min');
  const gridPrice1m = resampleSeriesTo1Minute(files.GRID_forecast, '1h');
  const bessForecast1m = resampleSeriesTo1Minute(files.BESS_forecast, '1h');

  // Scaling factor for PV peak if user adjusted dimensioning slider
  const pvScale = params.pvCapacityKwp > 0 ? params.pvCapacityKwp / 250 : 1;

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

    const loadF = Math.max(0, loadForecast1m[m] || 0);
    const loadM = Math.max(0, loadMeasure1m[m] || 0);
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

    let bessNetKw = 0; // >0 discharge, <0 charge
    let bessChargeKw = 0;
    let bessDischargeKw = 0;

    if (params.strategy === 'follow_forecast' && Math.abs(plannedBessKw) > 0.1) {
      if (plannedBessKw > 0) {
        // Requested discharge
        const maxDisch = Math.min(
          params.bessPowerKw,
          ((currentEnergy - minEnergy) / dtHours) * oneWayEff
        );
        bessDischargeKw = Math.max(0, Math.min(plannedBessKw, maxDisch));
        bessNetKw = bessDischargeKw;
      } else {
        // Requested charge
        const maxChg = Math.min(
          params.bessPowerKw,
          ((maxEnergy - currentEnergy) / (dtHours * oneWayEff))
        );
        bessChargeKw = Math.max(0, Math.min(-plannedBessKw, maxChg));
        bessNetKw = -bessChargeKw;
      }
    } else if (params.strategy === 'price_arbitrage') {
      if (priceMwh < medianPrice * 0.85 && currentEnergy < maxEnergy) {
        const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
        bessChargeKw = maxChg;
        bessNetKw = -bessChargeKw;
      } else if (priceMwh > medianPrice * 1.25 && currentEnergy > minEnergy) {
        const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
        bessDischargeKw = maxDisch;
        bessNetKw = bessDischargeKw;
      } else {
        // fallback to self-consumption
        if (netLocal > 0) {
          const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
          bessChargeKw = Math.min(netLocal, maxChg);
          bessNetKw = -bessChargeKw;
        } else {
          const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
          bessDischargeKw = Math.min(-netLocal, maxDisch);
          bessNetKw = bessDischargeKw;
        }
      }
    } else if (params.strategy === 'peak_shaving') {
      // Shave load above contract / threshold
      const peakThreshold = params.gridContractKw * 0.75;
      if (loadM > peakThreshold && currentEnergy > minEnergy) {
        const needed = loadM - peakThreshold;
        const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
        bessDischargeKw = Math.min(needed, maxDisch);
        bessNetKw = bessDischargeKw;
      } else if (netLocal > 0) {
        const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
        bessChargeKw = Math.min(netLocal, maxChg);
        bessNetKw = -bessChargeKw;
      }
    } else {
      // Default: Max self-consumption
      if (netLocal > 0) {
        const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
        bessChargeKw = Math.min(netLocal, maxChg);
        bessNetKw = -bessChargeKw;
      } else {
        const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
        bessDischargeKw = Math.min(-netLocal, maxDisch);
        bessNetKw = bessDischargeKw;
      }
    }

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
function updateKpiCards(kpis) {
  setText('kpi-autoconsommation', `${kpis.autoconsumptionRatePercent}%`);
  setText('kpi-autoproduction', `${kpis.autoproductionRatePercent}%`);
  setText('kpi-pv-total', `${kpis.totalPvEnergyKwh.toLocaleString()} kWh`);
  setText('kpi-load-total', `${kpis.totalLoadEnergyKwh.toLocaleString()} kWh`);
  setText('kpi-grid-import', `${kpis.totalGridImportKwh.toLocaleString()} kWh`);
  setText('kpi-grid-export', `${kpis.totalGridExportKwh.toLocaleString()} kWh`);
  setText('kpi-bess-cycles', `${kpis.bessCycles} cycles`);
  setText('kpi-savings', `${kpis.totalSavingsEur.toFixed(1)} €`);
  setText('kpi-bill', `${kpis.netBillEur.toFixed(1)} €`);

  // Error badges
  setText('kpi-pv-mae', `MAE: ±${kpis.pvMaeKw} kW | Max: ${kpis.pvMaxDeltaKw} kW`);
  setText('kpi-load-mae', `MAE: ±${kpis.loadMaeKw} kW | Max: ${kpis.loadMaxDeltaKw} kW`);

  // Curtailment warning
  const curtailAlert = document.getElementById('alert-curtailment');
  if (curtailAlert) {
    if (kpis.totalCurtailedKwh > 0.5) {
      curtailAlert.classList.remove('hidden');
      setText('alert-curtailment-text', `Écrêtement PV : ${kpis.totalCurtailedKwh} kWh non injectés (limite réseau atteinte).`);
    } else {
      curtailAlert.classList.add('hidden');
    }
  }

  // Unmet load warning
  const unmetAlert = document.getElementById('alert-unmet');
  if (unmetAlert) {
    if (kpis.totalUnmetLoadKwh > 0.5) {
      unmetAlert.classList.remove('hidden');
      setText('alert-unmet-text', `Dépassement de puissance : ${kpis.totalUnmetLoadKwh} kWh non servis (souscription réseau dépassée).`);
    } else {
      unmetAlert.classList.add('hidden');
    }
  }
}

function updateRealTimeDisplay(minuteIndex) {
  if (!state.simulationResult || !state.simulationResult.points[minuteIndex]) return;
  const pt = state.simulationResult.points[minuteIndex];

  state.currentMinuteIndex = minuteIndex;

  setText('rt-time-badge', pt.timeLabel);
  const timeSlider = document.getElementById('time-slider');
  if (timeSlider && parseInt(timeSlider.value, 10) !== minuteIndex) {
    timeSlider.value = minuteIndex;
  }

  // Live power values
  setText('rt-pv-val', `${pt.pvMeasureKw.toFixed(1)} kW`);
  setText('rt-pv-delta', `${pt.pvDeltaKw >= 0 ? '+' : ''}${pt.pvDeltaKw.toFixed(1)} kW`);
  setDeltaClass('rt-pv-delta', pt.pvDeltaKw);

  setText('rt-load-val', `${pt.loadMeasureKw.toFixed(1)} kW`);
  setText('rt-load-delta', `${pt.loadDeltaKw >= 0 ? '+' : ''}${pt.loadDeltaKw.toFixed(1)} kW`);
  setDeltaClass('rt-load-delta', -pt.loadDeltaKw); // high load delta is red

  setText('rt-soc-val', `${pt.bessSocPercent.toFixed(1)}%`);
  const bessText = pt.bessNetKw > 0
    ? `Décharge: +${pt.bessDischargeKw.toFixed(1)} kW`
    : pt.bessNetKw < 0
    ? `Charge: -${pt.bessChargeKw.toFixed(1)} kW`
    : 'Veille (0 kW)';
  setText('rt-bess-status', bessText);

  // Grid exchange
  const gridText = pt.gridNetKw > 0
    ? `Soutirage: ${pt.gridImportKw.toFixed(1)} kW`
    : pt.gridNetKw < 0
    ? `Injection: ${pt.gridExportKw.toFixed(1)} kW`
    : 'Équilibre (0 kW)';
  setText('rt-grid-val', gridText);
  setText('rt-price-val', `${pt.gridPriceEurMwh.toFixed(1)} €/MWh`);

  // Animated flow lines schematic
  updateSchematicSvg(pt);
}

function setDeltaClass(elementId, value) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (Math.abs(value) < 1.0) {
    el.className = 'text-xs font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700';
  } else if (value > 0) {
    el.className = 'text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold';
  } else {
    el.className = 'text-xs font-mono px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold';
  }
}

function updateSchematicSvg(pt) {
  // Update power flow pill indicators
  setText('schematic-pv-kw', `${pt.pvMeasureKw.toFixed(0)} kW`);
  setText('schematic-load-kw', `${pt.loadMeasureKw.toFixed(0)} kW`);
  setText('schematic-bess-kw', `${pt.bessNetKw >= 0 ? '+' : ''}${pt.bessNetKw.toFixed(0)} kW`);
  setText('schematic-grid-kw', `${pt.gridNetKw >= 0 ? '+' : ''}${pt.gridNetKw.toFixed(0)} kW`);
  setText('schematic-soc', `${pt.bessSocPercent.toFixed(0)}%`);

  // Battery bar level
  const socBar = document.getElementById('schematic-soc-bar');
  if (socBar) {
    socBar.style.width = `${pt.bessSocPercent}%`;
  }
}

/**
 * Chart Creation and Refreshing
 */
function initCharts() {
  const points = state.simulationResult ? state.simulationResult.points : [];
  if (!points || points.length === 0) return;

  // Sample every 5 minutes for performance in charts (288 points)
  const sampled = points.filter((_, idx) => idx % 5 === 0);
  const labels = sampled.map((p) => p.timeLabel);

  // Common styles
  const gridColor = '#f1f5f9';
  const textColor = '#64748b';

  // 1. Power Flows Chart (Chart 1)
  const ctxPower = document.getElementById('chart-power-flows')?.getContext('2d');
  if (ctxPower) {
    if (state.charts.power) state.charts.power.destroy();
    state.charts.power = new Chart(ctxPower, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'PV Mesuré (kW)',
            data: sampled.map((p) => p.pvMeasureKw),
            borderColor: '#eab308',
            backgroundColor: 'rgba(234, 179, 8, 0.15)',
            borderWidth: 2,
            fill: true,
            tension: 0.2,
            pointRadius: 0,
          },
          {
            label: 'Charge Mesurée (kW)',
            data: sampled.map((p) => p.loadMeasureKw),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 0,
          },
          {
            label: 'Batterie BESS (kW)',
            data: sampled.map((p) => p.bessNetKw),
            borderColor: '#10b981',
            borderWidth: 1.8,
            borderDash: [3, 3],
            tension: 0.2,
            pointRadius: 0,
          },
          {
            label: 'Réseau Net (kW)',
            data: sampled.map((p) => p.gridNetKw),
            borderColor: '#3b82f6',
            borderWidth: 1.8,
            tension: 0.2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: textColor } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)} kW`,
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: 'Puissance (kW)', color: textColor } },
        },
      },
    });
  }

  // 2. Forecast vs Measure Comparative Chart (Chart 2)
  const ctxCompare = document.getElementById('chart-comparative')?.getContext('2d');
  if (ctxCompare) {
    if (state.charts.compare) state.charts.compare.destroy();
    state.charts.compare = new Chart(ctxCompare, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'PV Prévu (1h)',
            data: sampled.map((p) => p.pvForecastKw),
            borderColor: '#fbbf24',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 0,
          },
          {
            label: 'PV Mesuré (1m)',
            data: sampled.map((p) => p.pvMeasureKw),
            borderColor: '#ca8a04',
            borderWidth: 2,
            pointRadius: 0,
          },
          {
            label: 'Charge Prévue (5m)',
            data: sampled.map((p) => p.loadForecastKw),
            borderColor: '#f87171',
            borderWidth: 2,
            borderDash: [4, 4],
            pointRadius: 0,
          },
          {
            label: 'Charge Mesurée (1m)',
            data: sampled.map((p) => p.loadMeasureKw),
            borderColor: '#dc2626',
            borderWidth: 2,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: textColor } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toFixed(1)} kW`,
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: 'kW', color: textColor } },
        },
      },
    });
  }

  // 3. Deltas / Deviations Chart (Chart 3)
  const ctxDelta = document.getElementById('chart-deltas')?.getContext('2d');
  if (ctxDelta) {
    if (state.charts.delta) state.charts.delta.destroy();
    state.charts.delta = new Chart(ctxDelta, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Écart PV (Mesuré - Prévu)',
            data: sampled.map((p) => p.pvDeltaKw),
            backgroundColor: sampled.map((p) => (p.pvDeltaKw >= 0 ? '#10b981' : '#f59e0b')),
            borderRadius: 2,
          },
          {
            label: 'Écart Charge (Mesuré - Prévu)',
            data: sampled.map((p) => p.loadDeltaKw),
            backgroundColor: sampled.map((p) => (p.loadDeltaKw >= 0 ? '#ef4444' : '#60a5fa')),
            borderRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: textColor } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(1)} kW`,
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: 'Écart Delta (kW)', color: textColor } },
        },
      },
    });
  }

  // 4. Battery SoC and Dispatch (Chart 4)
  const ctxBess = document.getElementById('chart-bess-soc')?.getContext('2d');
  if (ctxBess) {
    if (state.charts.bess) state.charts.bess.destroy();
    state.charts.bess = new Chart(ctxBess, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'SoC Batterie (%)',
            data: sampled.map((p) => p.bessSocPercent),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            fill: true,
            yAxisID: 'ySoC',
            borderWidth: 2.2,
            tension: 0.1,
            pointRadius: 0,
          },
          {
            label: 'Puissance BESS (kW)',
            data: sampled.map((p) => p.bessNetKw),
            borderColor: '#6366f1',
            borderWidth: 1.5,
            yAxisID: 'yPower',
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: textColor } },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          ySoC: {
            type: 'linear',
            position: 'left',
            min: 0,
            max: 100,
            grid: { color: gridColor },
            ticks: { color: '#10b981', callback: (v) => `${v}%` },
            title: { display: true, text: 'SoC (%)', color: '#10b981' },
          },
          yPower: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#6366f1', callback: (v) => `${v} kW` },
            title: { display: true, text: 'Puissance BESS (kW)', color: '#6366f1' },
          },
        },
      },
    });
  }

  // 5. Grid Price & Cumulative Cost (Chart 5)
  const ctxPrice = document.getElementById('chart-grid-price')?.getContext('2d');
  if (ctxPrice) {
    if (state.charts.price) state.charts.price.destroy();
    state.charts.price = new Chart(ctxPrice, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Prix Énergie Spot (€/MWh)',
            data: sampled.map((p) => p.gridPriceEurMwh),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            yAxisID: 'yPrice',
            borderWidth: 2,
            stepped: 'before',
            pointRadius: 0,
          },
          {
            label: 'Facture Nette Cumulée (€)',
            data: sampled.map((p) => p.cumulativeCostEur),
            borderColor: '#3b82f6',
            borderWidth: 2,
            yAxisID: 'yCost',
            tension: 0.1,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, color: textColor } },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 12 } },
          yPrice: {
            type: 'linear',
            position: 'left',
            grid: { color: gridColor },
            ticks: { color: '#f59e0b', callback: (v) => `${v} €` },
            title: { display: true, text: 'Prix Spot (€/MWh)', color: '#f59e0b' },
          },
          yCost: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#3b82f6', callback: (v) => `${v} €` },
            title: { display: true, text: 'Coût (€)', color: '#3b82f6' },
          },
        },
      },
    });
  }
}

/**
 * =============================================================================
 * PARTIE PLANIFICATION & PILOTAGE INTERACTIF (Courbe 1 & Courbe 2)
 * =============================================================================
 */

function extractBessPlanFromCsv(csvText) {
  if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
    return [...DEFAULT_BESS_PLAN];
  }
  try {
    const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
    const rows = parsed.data || [];
    const fields = parsed.meta.fields || [];
    const valCol = fields.find((f) => /plan|power|puissance|kw/i.test(f)) || fields[1];
    if (!valCol || rows.length === 0) return [...DEFAULT_BESS_PLAN];
    const plan = new Array(24).fill(0);
    for (let i = 0; i < Math.min(24, rows.length); i++) {
      const v = parseFloat(String(rows[i][valCol]).replace(',', '.'));
      plan[i] = isNaN(v) ? 0 : v;
    }
    return plan;
  } catch (err) {
    console.warn('Could not parse BESS plan from CSV:', err);
    return [...DEFAULT_BESS_PLAN];
  }
}

function syncPlanningBessToForecastCsv(skipSimulation = false) {
  const dateStr = '2026-06-15';
  const rows = ['timestamp,planned_power_kw,target_soc_percent'];
  let soc = state.params.bessInitialSocPercent || 45;
  const capacity = state.params.bessCapacityKwh || 400;
  const eff = Math.sqrt((state.params.bessEfficiencyPercent || 92) / 100);

  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const p = state.planningBess[h] !== undefined ? state.planningBess[h] : 0;
    if (p > 0) {
      soc = Math.max(state.params.bessMinSocPercent, soc - (p / eff / capacity) * 100);
    } else if (p < 0) {
      soc = Math.min(state.params.bessMaxSocPercent, soc + (Math.abs(p) * eff / capacity) * 100);
    }
    rows.push(`${dateStr} ${hh}:00:00,${p.toFixed(1)},${soc.toFixed(1)}`);
  }

  state.files.BESS_forecast = rows.join('\n');
  saveStateToLocalStorage();

  if (!skipSimulation) {
    state.simulationResult = runMicrogridSimulation(state.files, state.params);
    updateKpiCards(state.simulationResult.kpis);
    updateRealTimeDisplay(state.currentMinuteIndex);
    renderFilesTable();
  }
}

function syncPlanningBessToForecastCsvDebounced() {
  if (state.planningDebounceTimer) {
    clearTimeout(state.planningDebounceTimer);
  }
  state.planningDebounceTimer = setTimeout(() => {
    syncPlanningBessToForecastCsv(false);
  }, 250);
}

function getPlanningHourlyData() {
  const pvForecast1m = resampleSeriesTo1Minute(state.files.PV_forecast, '1h');
  const loadForecast1m = resampleSeriesTo1Minute(state.files.LOAD_forecast, '5min');
  const gridPrice1m = resampleSeriesTo1Minute(state.files.GRID_forecast, '1h');

  const pvScale = state.params.pvCapacityKwp > 0 ? state.params.pvCapacityKwp / 250 : 1;
  const contractLimit = Math.max(0, state.params.gridContractKw || 160);
  const bessPowerMax = Math.max(0, state.params.bessPowerKw || 150);
  const capacityKwh = Math.max(1, state.params.bessCapacityKwh || 400);
  const eff = Math.sqrt((state.params.bessEfficiencyPercent || 92) / 100);
  const minSoc = state.params.bessMinSocPercent || 10;
  const maxSoc = state.params.bessMaxSocPercent || 95;

  const hours = [];
  const pvPlan = [];
  const loadPlan = [];
  const loadCovered = [];
  const gridPlan = [];
  const gridPlanRaw = [];
  const gridContractLine = [];
  const deficit = [];
  const gridPrice = [];
  const bessPlan = [];
  const socCurve = [];

  let currentSoc = state.params.bessInitialSocPercent || 45;
  let totalDeficitKwh = 0;

  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    hours.push(`${hh}:00`);

    // 1. Hourly averages for PV, Load, and Spot Price
    let sumPv = 0;
    let sumLoad = 0;
    let sumPrice = 0;
    for (let m = 0; m < 60; m++) {
      const idx = h * 60 + m;
      sumPv += (pvForecast1m[idx] || 0) * pvScale;
      sumLoad += loadForecast1m[idx] || 0;
      sumPrice += gridPrice1m[idx] || 70;
    }
    const pvH = Math.max(0, sumPv / 60);
    const loadH = Math.max(0, sumLoad / 60);
    const priceH = sumPrice / 60;

    pvPlan.push(Number(pvH.toFixed(1)));
    loadPlan.push(Number(loadH.toFixed(1)));
    gridPrice.push(Number(priceH.toFixed(1)));
    gridContractLine.push(contractLimit);

    // 2. BESS command evaluation & physical constraints
    const pReq = state.planningBess[h] !== undefined ? state.planningBess[h] : 0;
    let pEff = 0;

    if (pReq > 0) {
      // Discharge (upwards): limited by available stored energy
      const availKwh = Math.max(0, ((currentSoc - minSoc) / 100) * capacityKwh * eff);
      pEff = Math.max(0, Math.min(pReq, bessPowerMax, availKwh));
      currentSoc = Math.max(minSoc, currentSoc - (pEff / eff / capacityKwh) * 100);
    } else if (pReq < 0) {
      // Charge (downwards): limited by available capacity room
      const roomKwh = Math.max(0, ((maxSoc - currentSoc) / 100) * capacityKwh / eff);
      pEff = -Math.max(0, Math.min(Math.abs(pReq), bessPowerMax, roomKwh));
      currentSoc = Math.min(maxSoc, currentSoc + (Math.abs(pEff) * eff / capacityKwh) * 100);
    } else {
      pEff = 0;
    }

    bessPlan.push(Number(pEff.toFixed(1)));
    socCurve.push(Number(currentSoc.toFixed(1)));

    // 3. Electrical balance: PV + BESS + GRID = LOAD
    // Net demand from grid before limits:
    const netDemand = loadH - pvH - pEff;

    let pGrid = 0;
    let pDeficit = 0;

    if (netDemand > 0) {
      // Need grid import
      if (netDemand <= contractLimit) {
        pGrid = netDemand;
        pDeficit = 0;
        loadCovered.push(Number(loadH.toFixed(1)));
      } else {
        // Exceeds grid contract limit!
        pGrid = contractLimit;
        pDeficit = netDemand - contractLimit;
        totalDeficitKwh += pDeficit;
        // Missing load equals missing grid power
        const served = Math.max(0, loadH - pDeficit);
        loadCovered.push(Number(served.toFixed(1)));
      }
    } else {
      // Net export surplus
      const exportLimit = state.params.gridMaxExportKw || contractLimit;
      pGrid = Math.max(netDemand, -exportLimit);
      pDeficit = 0;
      loadCovered.push(Number(loadH.toFixed(1)));
    }

    gridPlan.push(Number(pGrid.toFixed(1)));
    gridPlanRaw.push(Number(netDemand.toFixed(1)));
    deficit.push(Number(pDeficit.toFixed(1)));
  }

  return {
    hours,
    pvPlan,
    loadPlan,
    loadCovered,
    gridPlan,
    gridPlanRaw,
    gridContractLine,
    deficit,
    gridPrice,
    bessPlan,
    socCurve,
    totalDeficitKwh: Number(totalDeficitKwh.toFixed(1)),
    finalSoc: Number(currentSoc.toFixed(1)),
  };
}

function updatePlanningControllerUI(planData) {
  const h = state.selectedPlanningHour;
  const hh = String(h).padStart(2, '0');
  const nextH = String((h + 1) % 24).padStart(2, '0');

  setText('planning-hour-display', `${hh}h00 - ${nextH}h00`);

  const currentPower = state.planningBess[h] !== undefined ? state.planningBess[h] : 0;
  const powerBadge = document.getElementById('planning-power-badge');
  if (powerBadge) {
    if (currentPower > 0) {
      powerBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-emerald-100 text-emerald-800';
      powerBadge.textContent = `+${currentPower.toFixed(0)} kW (Décharge ⚡)`;
    } else if (currentPower < 0) {
      powerBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-amber-100 text-amber-800';
      powerBadge.textContent = `${currentPower.toFixed(0)} kW (Charge 🔋)`;
    } else {
      powerBadge.className = 'px-2 py-0.5 rounded text-xs font-bold font-mono bg-slate-100 text-slate-700';
      powerBadge.textContent = '0 kW (Veille ⏸)';
    }
  }

  // Update resulting SoC for this hour
  if (planData && planData.socCurve && planData.socCurve[h] !== undefined) {
    setText('planning-hour-soc-badge', `${planData.socCurve[h]}%`);
  }

  // Slider bounds & value
  const maxKw = state.params.bessPowerKw || 150;
  const slider = document.getElementById('planning-bess-slider');
  if (slider) {
    slider.min = -maxKw;
    slider.max = maxKw;
    slider.value = currentPower;
  }
  setText('planning-slider-min-lbl', `-${maxKw} kW`);
  setText('planning-slider-max-lbl', `+${maxKw} kW`);
}

function setSelectedPlanningHour(hour) {
  state.selectedPlanningHour = Math.max(0, Math.min(23, hour));
  renderPlanningCharts();
}

function setPlanningHourPower(hour, powerKw) {
  const maxKw = state.params.bessPowerKw || 150;
  const clamped = Math.max(-maxKw, Math.min(maxKw, Math.round(powerKw / 5) * 5));
  state.planningBess[hour] = clamped;
  renderPlanningCharts();
  syncPlanningBessToForecastCsvDebounced();
}

function changeSelectedHourPower(step) {
  const current = state.planningBess[state.selectedPlanningHour] || 0;
  setPlanningHourPower(state.selectedPlanningHour, current + step);
}

function setupPlanningCanvasDrag(canvas) {
  if (!canvas || canvas.dataset.dragAttached) return;
  canvas.dataset.dragAttached = 'true';

  const updatePowerFromPointer = (e) => {
    const chart = state.charts.planningBess;
    if (!chart || !chart.scales.yPower) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawVal = chart.scales.yPower.getValueForPixel(y);
    const maxKw = state.params.bessPowerKw || 150;
    const clamped = Math.max(-maxKw, Math.min(maxKw, Math.round(rawVal / 5) * 5));
    setPlanningHourPower(state.selectedPlanningHour, clamped);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const chart = state.charts.planningBess;
    if (!chart) return;
    const elements = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, false);
    if (elements && elements.length > 0) {
      state.isDraggingPlanning = true;
      // Le point 24 (24:00) est la duplication visuelle de l'heure 23 : le ramener à 23.
      const clickedHour = Math.min(23, elements[0].index);
      state.selectedPlanningHour = clickedHour;
      updatePowerFromPointer(e);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.isDraggingPlanning) return;
    updatePowerFromPointer(e);
  });

  const stopDrag = (e) => {
    if (state.isDraggingPlanning) {
      state.isDraggingPlanning = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
}

// Largeurs d'axe fixes (en pixels) partagées par les deux graphiques de planification,
// pour que leurs zones de tracé démarrent/finissent exactement au même endroit et que
// les pas horaires restent alignés verticalement entre les deux graphiques empilés.
const PLANNING_AXIS_WIDTH_LEFT = 78;
const PLANNING_AXIS_WIDTH_RIGHT = 78;
const lockAxisWidth = (width) => (axis) => {
  axis.width = width;
};

// Axe catégoriel caché à 24 créneaux (avec `offset: true`, comme le ferait n'importe
// quel bar chart), utilisé pour toutes les séries de la Courbe 1 (courbes ET barres).
// Ses 24 cellules se calent exactement sur les 24 intervalles de l'axe horaire principal
// `x` (25 graduations 00:00..24:00, `offset: false`) : chaque point/barre se retrouve
// donc centré sur la demi-heure de son créneau (ex. le créneau 00:00-01:00 est centré
// sur 00:30), ce qui représente correctement une moyenne horaire, sans déplacer les
// graduations affichées.
const hiddenHourBarAxis = (hours) => ({
  type: 'category',
  position: 'bottom',
  offset: true,
  labels: hours,
  display: false,
});

// Calcule des bornes min/max pour l'axe puissance (yPower) et l'axe prix (yPrice) de la
// Courbe 1 telles que leurs deux "0" tombent exactement à la même hauteur (même fraction
// verticale), même si la puissance a des valeurs négatives et le prix non.
function computeAlignedZeroScales(powerValues, priceValues) {
  const roundStep = 50;
  const powerNums = powerValues.filter((v) => v != null);
  const priceNums = priceValues.filter((v) => v != null);
  const powerDataMin = Math.min(0, ...powerNums);
  const powerDataMax = Math.max(0, ...powerNums);
  const powerPad = 20;
  const powerMin = powerDataMin < 0 ? Math.floor((powerDataMin - powerPad) / roundStep) * roundStep : 0;
  let powerMax = Math.ceil((powerDataMax + powerPad) / roundStep) * roundStep;
  if (powerMax <= powerMin) powerMax = powerMin + roundStep;

  const priceDataMax = Math.max(0, ...priceNums);
  const pricePad = 10;
  let priceMax = Math.ceil((priceDataMax + pricePad) / roundStep) * roundStep;
  if (priceMax <= 0) priceMax = roundStep;

  // Fraction de la hauteur de l'axe puissance à laquelle se trouve le 0.
  const zeroFraction = Math.min(0.98, Math.max(0, (0 - powerMin) / (powerMax - powerMin)));
  const priceMin = zeroFraction === 0 ? 0 : (zeroFraction * priceMax) / (zeroFraction - 1);

  return { powerMin, powerMax, priceMin, priceMax };
}

function renderPlanningCharts() {
  const planData = getPlanningHourlyData();
  const hoursExt = [...planData.hours, '24:00'];

  // Update Section Badges
  setText('planning-grid-contract-badge', `🌐 Limite Réseau : ${state.params.gridContractKw} kW`);

  const defBadge = document.getElementById('planning-deficit-badge');
  if (defBadge) {
    if (planData.totalDeficitKwh > 0.1) {
      defBadge.className = 'px-2.5 py-1 rounded-lg font-mono font-semibold bg-rose-50 text-rose-700 border border-rose-200';
      defBadge.textContent = `⚠️ Manque : ${planData.totalDeficitKwh} kWh non couverts`;
    } else {
      defBadge.className = 'px-2.5 py-1 rounded-lg font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
      defBadge.textContent = '✓ Charge 100% couverte';
    }
  }

  setText('planning-soc-end-badge', `🔋 SoC fin : ${planData.finalSoc}%`);

  // Update Controller UI for selected hour
  updatePlanningControllerUI(planData);

  // 1. Chart 1: Plan de production / consommation (Courbe 1)
  const ctxPower = document.getElementById('chart-planning-power')?.getContext('2d');
  if (ctxPower) {
    // Convention: producteurs en positif (vers le haut), consommateurs en négatif (vers le bas).
    // PV : toujours producteur -> positif. Charge : toujours consommatrice -> négatif.
    // Réseau : positif quand on soutire (consommateur), négatif quand on injecte (producteur).
    const loadNeg = planData.loadPlan.map((v) => -v);
    const loadCoveredNeg = planData.loadCovered.map((v) => -v);

    const pvVals = planData.pvPlan;
    const loadCoveredNegVals = loadCoveredNeg;
    const loadNegVals = loadNeg;
    const gridVals = planData.gridPlan;
    const gridRawVals = planData.gridPlanRaw;
    const priceBars = planData.gridPrice;

    const alignedScales = computeAlignedZeroScales(
      [...pvVals, ...loadCoveredNegVals, ...loadNegVals, ...gridVals, ...gridRawVals],
      planData.gridPrice
    );

    // Titre d'infobulle en intervalle horaire : "00:00 - 01:00", ..., "23:00 - 24:00".
    const tooltipHourRangeTitle = (items) => {
      const startH = items[0].dataIndex;
      const startStr = `${String(startH).padStart(2, '0')}:00`;
      const endStr = `${String(startH + 1).padStart(2, '0')}:00`;
      return `${startStr} - ${endStr}`;
    };

    if (state.charts.planningPower) {
      const chart = state.charts.planningPower;
      chart.data.labels = hoursExt;
      chart.data.datasets[0].data = pvVals;
      chart.data.datasets[1].data = loadCoveredNegVals;
      chart.data.datasets[2].data = loadNegVals;
      chart.data.datasets[3].data = gridVals;
      chart.data.datasets[4].data = gridRawVals;
      chart.data.datasets[5].data = priceBars;
      chart.options.scales.yPower.min = alignedScales.powerMin;
      chart.options.scales.yPower.max = alignedScales.powerMax;
      chart.options.scales.yPrice.min = alignedScales.priceMin;
      chart.options.scales.yPrice.max = alignedScales.priceMax;
      chart.update('none');
    } else {
      state.charts.planningPower = new Chart(ctxPower, {
        type: 'line',
        data: {
          labels: hoursExt,
          datasets: [
            {
              label: 'PV ',
              data: pvVals,
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.16)',
              borderWidth: 2,
              fill: true,
              tension: 0,
              pointRadius: 0,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
            },
            {
              // Charge réellement fournie : suit la demande quand tout est couvert,
              // sinon reste entre 0 et la courbe de demande (déficit de puissance).
              label: 'Charge fournie ',
              data: loadCoveredNegVals,
              borderColor: '#e11d48',
              backgroundColor: 'rgba(225, 29, 72, 0.28)',
              borderWidth: 1,
              fill: true,
              tension: 0,
              pointRadius: 0,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
            },
            {
              label: 'Charge demandée ',
              data: loadNegVals,
              borderColor: '#e11d48',
              borderWidth: 2,
              borderDash: [5, 3],
              fill: false,
              tension: 0,
              pointRadius: 0,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
            },
            {
              // Réseau réellement mobilisé : la consigne d'équilibre plafonnée par la
              // limite de raccordement (import) / d'export contractuelle.
              label: 'Réseau fourni ',
              data: gridVals,
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37, 99, 235, 0.16)',
              borderWidth: 2,
              fill: true,
              tension: 0,
              pointRadius: 0,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
            },
            {
              // Consigne réseau nécessaire pour équilibrer le système et opérer
              // intégralement la charge, sans tenir compte de la limite de raccordement.
              label: 'Réseau demandé ',
              data: gridRawVals,
              borderColor: '#2563eb',
              borderWidth: 2,
              borderDash: [5, 3],
              fill: false,
              tension: 0,
              pointRadius: 0,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
            },
            {
              type: 'bar',
              label: 'Prix Réseau ',
              data: priceBars,
              backgroundColor: 'rgba(217, 119, 6, 0.35)',
              borderColor: '#d97706',
              borderWidth: 1,
              borderRadius: 2,
              barPercentage: 0.9,
              categoryPercentage: 0.8,
              grouped: false,
              xAxisID: 'xBar',
              yAxisID: 'yPrice',
              order: 10,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              labels: {
                boxWidth: 12,
                font: { size: 11 },
                color: '#475569',
                // "Charge fournie"/"Charge demandée" (index 1/2) et "Réseau fourni"/
                // "Réseau demandé" (index 3/4) sont chacune deux datasets distincts
                // (aire remplie + contour) pour une seule et même grandeur physique :
                // on les fusionne sous une unique légende "Charge (kW)" / "Réseau (kW)".
                generateLabels: (chart) => {
                  const items = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                  return items
                    .filter((item) => item.datasetIndex !== 2 && item.datasetIndex !== 4)
                    .map((item) => {
                      if (item.datasetIndex === 1) item.text = 'Charge';
                      if (item.datasetIndex === 3) item.text = 'Réseau';
                      return item;
                    });
                },
              },
              onClick: (evt, legendItem, legend) => {
                const chart = legend.chart;
                const pairedIndex = { 1: 2, 3: 4 }[legendItem.datasetIndex];
                if (pairedIndex !== undefined) {
                  const hidden = !chart.getDatasetMeta(legendItem.datasetIndex).hidden;
                  chart.getDatasetMeta(legendItem.datasetIndex).hidden = hidden;
                  chart.getDatasetMeta(pairedIndex).hidden = hidden;
                  chart.update();
                } else {
                  Chart.defaults.plugins.legend.onClick.call(legend, evt, legendItem, legend);
                }
              },
            },
            tooltip: {
              callbacks: {
                title: tooltipHourRangeTitle,
                label: (ctx) => (ctx.dataset.yAxisID === 'yPrice'
                  ? ` ${ctx.dataset.label}: ${ctx.raw} €/MWh`
                  : ` ${ctx.dataset.label}: ${ctx.raw} kW`),
              },
            },
          },
          scales: {
            x: {
              offset: false,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#64748b', font: { size: 11 } },
            },
            xBar: hiddenHourBarAxis(planData.hours),
            yPower: {
              type: 'linear',
              position: 'left',
              afterFit: lockAxisWidth(PLANNING_AXIS_WIDTH_LEFT),
              min: alignedScales.powerMin,
              max: alignedScales.powerMax,
              grid: { color: '#f1f5f9' },
              title: { display: true, text: 'Puissance (kW) — Producteur (+) / Consommateur (-)', color: '#475569', font: { size: 11 } },
              ticks: { color: '#64748b', callback: (v) => `${v} kW` },
            },
            yPrice: {
              type: 'linear',
              position: 'right',
              afterFit: lockAxisWidth(PLANNING_AXIS_WIDTH_RIGHT),
              min: alignedScales.priceMin,
              max: alignedScales.priceMax,
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Prix Spot (€/MWh)', color: '#d97706', font: { size: 11 } },
              ticks: { color: '#d97706', callback: (v) => `${v} €` },
            },
          },
        },
      });
    }
  }

  // 2. Chart 2: Pilotage Batterie & SoC (Courbe 2)
  const ctxBess = document.getElementById('chart-planning-bess')?.getContext('2d');
  if (ctxBess) {
    const pMax = Math.max(state.params.bessPowerKw * 1.15, 50);

    // Barres centrées sur la demi-heure de leur créneau (axe xBar caché), il n'y a pas
    // de barre pour une "heure 24" qui n'existe pas.
    const bessPlanBars = planData.bessPlan;
    // Le SoC doit tomber sur les heures entières, entre deux barres : le point 0 (00:00)
    // est le SoC initial (avant toute opération), et le point i (i = 1..24) est le SoC
    // résultant à la fin de l'heure (i-1), donc le dernier point (24:00) = SoC final réel.
    const socBoundariesExt = [state.params.bessInitialSocPercent, ...planData.socCurve];

    if (state.charts.planningBess) {
      const chart = state.charts.planningBess;
      chart.data.labels = hoursExt;
      chart.data.datasets[0].data = bessPlanBars;
      chart.data.datasets[1].data = socBoundariesExt;
      chart.options.scales.yPower.suggestedMin = -pMax;
      chart.options.scales.yPower.suggestedMax = pMax;
      chart.update('none');
    } else {
      state.charts.planningBess = new Chart(ctxBess, {
        type: 'line',
        data: {
          labels: hoursExt,
          datasets: [
            {
              type: 'bar',
              label: 'Puissance BESS (kW)',
              data: bessPlanBars,
              barPercentage: 0.9,
              categoryPercentage: 0.8,
              grouped: false,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
              borderRadius: 3,
              backgroundColor: (ctx) => {
                const idx = ctx.dataIndex;
                const isSelected = idx === state.selectedPlanningHour;
                const v = ctx.raw;
                if (isSelected) {
                  return v >= 0 ? '#047857' : '#b45309';
                }
                return v >= 0 ? 'rgba(16, 185, 129, 0.85)' : 'rgba(245, 158, 11, 0.85)';
              },
              borderColor: (ctx) => {
                const idx = ctx.dataIndex;
                if (idx === state.selectedPlanningHour) return '#0f172a';
                return ctx.raw >= 0 ? '#059669' : '#d97706';
              },
              borderWidth: (ctx) => (ctx.dataIndex === state.selectedPlanningHour ? 2.5 : 1),
            },
            {
              type: 'line',
              label: 'Niveau de SoC (%)',
              data: socBoundariesExt,
              yAxisID: 'ySoC',
              borderColor: '#6366f1',
              backgroundColor: 'rgba(99, 102, 241, 0.08)',
              borderWidth: 2.5,
              tension: 0,
              // Le point mis en avant est celui qui tombe juste après l'heure sélectionnée,
              // c'est-à-dire le SoC résultant de l'action sur cette heure.
              pointRadius: (ctx) => (ctx.dataIndex === state.selectedPlanningHour + 1 ? 6 : 3),
              pointBackgroundColor: (ctx) => (ctx.dataIndex === state.selectedPlanningHour + 1 ? '#4338ca' : '#6366f1'),
              pointBorderColor: '#ffffff',
              pointBorderWidth: 1.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          onClick: (evt, elements) => {
            if (elements && elements.length > 0) {
              const selectedIdx = elements[0].index;
              setSelectedPlanningHour(selectedIdx);
            }
          },
          plugins: {
            legend: {
              position: 'top',
              labels: { boxWidth: 12, font: { size: 11 }, color: '#475569' },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  if (ctx.dataset.yAxisID === 'ySoC') {
                    return ` SoC Batterie: ${ctx.raw}%`;
                  }
                  const v = ctx.raw;
                  const mode = v > 0 ? 'Décharge' : v < 0 ? 'Charge' : 'Veille';
                  return ` BESS: ${v > 0 ? '+' : ''}${v} kW (${mode})`;
                },
              },
            },
          },
          scales: {
            x: {
              offset: false,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#64748b', font: { size: 11 } },
            },
            xBar: hiddenHourBarAxis(planData.hours),
            yPower: {
              type: 'linear',
              position: 'left',
              afterFit: lockAxisWidth(PLANNING_AXIS_WIDTH_LEFT),
              suggestedMin: -pMax,
              suggestedMax: pMax,
              grid: {
                color: (ctx) => (ctx.tick.value === 0 ? '#475569' : '#f1f5f9'),
                lineWidth: (ctx) => (ctx.tick.value === 0 ? 1.5 : 1),
              },
              title: {
                display: true,
                text: 'Puissance BESS (kW)  [ ↑ Décharge  |  ↓ Charge ]',
                color: '#475569',
                font: { size: 11 },
              },
              ticks: {
                color: '#64748b',
                callback: (v) => `${v > 0 ? '+' : ''}${v} kW`,
              },
            },
            ySoC: {
              type: 'linear',
              position: 'right',
              afterFit: lockAxisWidth(PLANNING_AXIS_WIDTH_RIGHT),
              min: 0,
              max: 100,
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Niveau de SoC (%)', color: '#6366f1', font: { size: 11 } },
              ticks: { color: '#6366f1', callback: (v) => `${v}%` },
            },
          },
        },
      });

      setupPlanningCanvasDrag(document.getElementById('chart-planning-bess'));
    }
  }
}

function applyProfileSelfConsumption() {
  const pvForecast1m = resampleSeriesTo1Minute(state.files.PV_forecast, '1h');
  const loadForecast1m = resampleSeriesTo1Minute(state.files.LOAD_forecast, '5min');
  const pvScale = state.params.pvCapacityKwp > 0 ? state.params.pvCapacityKwp / 250 : 1;
  const maxKw = state.params.bessPowerKw || 150;

  for (let h = 0; h < 24; h++) {
    let sumPv = 0;
    let sumLoad = 0;
    for (let m = 0; m < 60; m++) {
      const idx = h * 60 + m;
      sumPv += (pvForecast1m[idx] || 0) * pvScale;
      sumLoad += loadForecast1m[idx] || 0;
    }
    const pvH = sumPv / 60;
    const loadH = sumLoad / 60;
    const net = loadH - pvH;

    if (net < 0) {
      // Surplus PV -> Charge
      state.planningBess[h] = -Math.min(maxKw, Math.round(Math.abs(net) / 5) * 5);
    } else if (net > 0) {
      // Deficit -> Discharge
      state.planningBess[h] = Math.min(maxKw, Math.round(net / 5) * 5);
    } else {
      state.planningBess[h] = 0;
    }
  }

  renderPlanningCharts();
  syncPlanningBessToForecastCsv(false);
}

function applyProfileSpotArbitrage() {
  const gridPrice1m = resampleSeriesTo1Minute(state.files.GRID_forecast, '1h');
  const maxKw = state.params.bessPowerKw || 150;

  const hourlyPrices = [];
  for (let h = 0; h < 24; h++) {
    let sum = 0;
    for (let m = 0; m < 60; m++) {
      sum += gridPrice1m[h * 60 + m] || 70;
    }
    hourlyPrices.push({ hour: h, price: sum / 60 });
  }

  const sorted = [...hourlyPrices].sort((a, b) => a.price - b.price);
  const cheapest6 = new Set(sorted.slice(0, 6).map((x) => x.hour));
  const mostExpensive6 = new Set(sorted.slice(-6).map((x) => x.hour));

  for (let h = 0; h < 24; h++) {
    if (cheapest6.has(h)) {
      state.planningBess[h] = -Math.round((maxKw * 0.8) / 5) * 5;
    } else if (mostExpensive6.has(h)) {
      state.planningBess[h] = Math.round((maxKw * 0.85) / 5) * 5;
    } else {
      state.planningBess[h] = 0;
    }
  }

  renderPlanningCharts();
  syncPlanningBessToForecastCsv(false);
}

function applyProfileDefault() {
  state.planningBess = [...DEFAULT_BESS_PLAN];
  renderPlanningCharts();
  syncPlanningBessToForecastCsv(false);
}

function applyProfileZero() {
  state.planningBess = new Array(24).fill(0);
  renderPlanningCharts();
  syncPlanningBessToForecastCsv(false);
}

function bindPlanningEventListeners() {
  const slider = document.getElementById('planning-bess-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      setPlanningHourPower(state.selectedPlanningHour, parseFloat(e.target.value));
    });
  }

  document.querySelectorAll('.btn-bess-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = parseFloat(btn.getAttribute('data-step')) || 0;
      changeSelectedHourPower(step);
    });
  });

  document.getElementById('btn-bess-max-discharge')?.addEventListener('click', () => {
    setPlanningHourPower(state.selectedPlanningHour, state.params.bessPowerKw);
  });

  document.getElementById('btn-bess-zero')?.addEventListener('click', () => {
    setPlanningHourPower(state.selectedPlanningHour, 0);
  });

  document.getElementById('btn-bess-max-charge')?.addEventListener('click', () => {
    setPlanningHourPower(state.selectedPlanningHour, -state.params.bessPowerKw);
  });

  document.getElementById('btn-plan-prev-hour')?.addEventListener('click', () => {
    setSelectedPlanningHour((state.selectedPlanningHour + 23) % 24);
  });

  document.getElementById('btn-plan-next-hour')?.addEventListener('click', () => {
    setSelectedPlanningHour((state.selectedPlanningHour + 1) % 24);
  });

  document.getElementById('btn-profile-pv')?.addEventListener('click', applyProfileSelfConsumption);
  document.getElementById('btn-profile-arbitrage')?.addEventListener('click', applyProfileSpotArbitrage);
  document.getElementById('btn-profile-default')?.addEventListener('click', applyProfileDefault);
  document.getElementById('btn-profile-zero')?.addEventListener('click', applyProfileZero);
}

/**
 * File Management Table Rendering
 */
function renderFilesTable() {
  const container = document.getElementById('files-table-body');
  if (!container) return;

  container.innerHTML = FILE_SPECS.map((spec) => {
    const content = state.files[spec.id];
    const isLoaded = !!(content && content.trim());
    const lineCount = isLoaded ? content.trim().split('\n').length - 1 : 0;

    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${spec.color}"></span>
            <span class="font-mono text-sm font-semibold text-slate-800">${spec.filename}</span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">${spec.desc}</p>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-block px-2 py-0.5 text-xs rounded bg-slate-100 text-slate-700 font-mono font-medium">
            ${spec.resolution}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          <span class="inline-block px-2 py-0.5 text-xs rounded ${spec.type === 'forecast' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'} font-medium">
            ${spec.type === 'forecast' ? 'Prévision' : 'Mesures'}
          </span>
        </td>
        <td class="py-3 px-4 text-center">
          ${
            isLoaded
              ? `<span class="inline-flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                  ✓ ${lineCount} lignes
                </span>`
              : `<span class="inline-flex items-center text-xs text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                  Manquant
                </span>`
          }
        </td>
        <td class="py-3 px-4 text-right">
          <div class="flex items-center justify-end gap-2">
            <button
              data-download-id="${spec.id}"
              class="btn-download px-2 py-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded bg-white transition-colors"
              title="Télécharger ce fichier CSV"
            >
              Télécharger
            </button>
            <label
              class="cursor-pointer px-2.5 py-1 text-xs text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded font-medium transition-colors"
            >
              Importer
              <input type="file" accept=".csv" data-upload-id="${spec.id}" class="file-input-single hidden" />
            </label>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach download & upload events
  container.querySelectorAll('.btn-download').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const fileId = e.currentTarget.getAttribute('data-download-id');
      downloadCsvFile(fileId);
    });
  });

  container.querySelectorAll('.file-input-single').forEach((input) => {
    input.addEventListener('change', handleSingleFileUpload);
  });
}

function handleSingleFileUpload(event) {
  const file = event.target.files[0];
  const fileId = event.target.getAttribute('data-upload-id');
  if (!file || !fileId) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    state.files[fileId] = text;
    saveStateToLocalStorage();
    recomputeAndRender();
  };
  reader.readAsText(file);
}

function handleMultiFilesUpload(filesList) {
  if (!filesList || filesList.length === 0) return;

  let loadedCount = 0;
  Array.from(filesList).forEach((file) => {
    const name = file.name.toLowerCase();
    // match with our known files
    let matchedSpec = null;
    if (name.includes('grid_forecast') || (name.includes('grid') && name.includes('forecast'))) {
      matchedSpec = 'GRID_forecast';
    } else if (name.includes('pv_forecast') || (name.includes('pv') && name.includes('forecast'))) {
      matchedSpec = 'PV_forecast';
    } else if (name.includes('bess_forecast') || (name.includes('bess') && name.includes('forecast'))) {
      matchedSpec = 'BESS_forecast';
    } else if (name.includes('load_forecast') || (name.includes('load') && name.includes('forecast'))) {
      matchedSpec = 'LOAD_forecast';
    } else if (name.includes('pv_measure') || (name.includes('pv') && name.includes('measure'))) {
      matchedSpec = 'PV_measures';
    } else if (name.includes('load_measure') || (name.includes('load') && name.includes('measure'))) {
      matchedSpec = 'LOAD_measure';
    }

    if (matchedSpec) {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.files[matchedSpec] = e.target.result;
        loadedCount++;
        if (loadedCount === filesList.length || loadedCount >= 1) {
          saveStateToLocalStorage();
          recomputeAndRender();
        }
      };
      reader.readAsText(file);
    }
  });
}

function downloadCsvFile(fileId) {
  const spec = FILE_SPECS.find((s) => s.id === fileId);
  const content = state.files[fileId] || '';
  if (!content) return;

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = spec ? spec.filename : `${fileId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadAllSampleZipOrFiles() {
  // Download each file with slight delay
  FILE_SPECS.forEach((spec, i) => {
    setTimeout(() => {
      downloadCsvFile(spec.id);
    }, i * 200);
  });
}

function downloadSimulationResultsCsv() {
  if (!state.simulationResult || !state.simulationResult.points) return;
  const points = state.simulationResult.points;

  const header = [
    'timestamp',
    'time_label',
    'pv_forecast_kw',
    'pv_measure_kw',
    'pv_delta_kw',
    'load_forecast_kw',
    'load_measure_kw',
    'load_delta_kw',
    'bess_charge_kw',
    'bess_discharge_kw',
    'bess_net_kw',
    'bess_soc_percent',
    'grid_import_kw',
    'grid_export_kw',
    'grid_net_kw',
    'grid_price_eur_mwh',
    'curtailment_kw',
    'unmet_load_kw',
    'cumulative_cost_eur',
  ].join(',');

  const rows = points.map((p) => [
    `2026-06-15 ${p.timeLabel}:00`,
    p.timeLabel,
    p.pvForecastKw,
    p.pvMeasureKw,
    p.pvDeltaKw,
    p.loadForecastKw,
    p.loadMeasureKw,
    p.loadDeltaKw,
    p.bessChargeKw,
    p.bessDischargeKw,
    p.bessNetKw,
    p.bessSocPercent,
    p.gridImportKw,
    p.gridExportKw,
    p.gridNetKw,
    p.gridPriceEurMwh,
    p.curtailmentKw,
    p.unmetLoadKw,
    p.cumulativeCostEur,
  ].join(','));

  const fullCsv = [header, ...rows].join('\n');
  const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'microgrid_simulation_results_1min.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Parameter Inputs Binding
 */
function syncInputsWithParams() {
  setInputValue('param-pv-capacity', state.params.pvCapacityKwp);
  setText('val-pv-capacity', `${state.params.pvCapacityKwp} kWc`);
  setInputValue('param-pv-price', state.params.pvPriceEurPerKwc);

  setInputValue('param-bess-capacity', state.params.bessCapacityKwh);
  setText('val-bess-capacity', `${state.params.bessCapacityKwh} kWh`);
  setInputValue('param-bess-capacity-price', state.params.bessCapacityPriceEurPerKwh);

  setInputValue('param-bess-power', state.params.bessPowerKw);
  setText('val-bess-power', `${state.params.bessPowerKw} kW`);
  setInputValue('param-bess-power-price', state.params.bessPowerPriceEurPerKw);

  setInputValue('param-bess-eff', state.params.bessEfficiencyPercent);
  setText('val-bess-eff', `${state.params.bessEfficiencyPercent}%`);

  setInputValue('param-bess-initial-soc', state.params.bessInitialSocPercent);
  setText('val-bess-initial-soc', `${state.params.bessInitialSocPercent}%`);

  setInputValue('param-grid-contract', state.params.gridContractKw);
  setText('val-grid-contract', `${state.params.gridContractKw} kW`);

  setInputValue('param-grid-export', state.params.gridMaxExportKw);
  setText('val-grid-export', `${state.params.gridMaxExportKw} kW`);

  setInputValue('param-feed-in', state.params.feedInTariffEurMwh);
  setText('val-feed-in', `${state.params.feedInTariffEurMwh} €/MWh`);

  setInputValue('param-strategy', state.params.strategy);
}

function bindInputListeners() {
  const bindings = [
    { id: 'param-pv-capacity', key: 'pvCapacityKwp', unit: 'kWc', isFloat: false },
    { id: 'param-pv-price', key: 'pvPriceEurPerKwc', unit: '€/kWc', isFloat: false },
    { id: 'param-bess-capacity', key: 'bessCapacityKwh', unit: 'kWh', isFloat: false },
    { id: 'param-bess-capacity-price', key: 'bessCapacityPriceEurPerKwh', unit: '€/kWh', isFloat: false },
    { id: 'param-bess-power', key: 'bessPowerKw', unit: 'kW', isFloat: false },
    { id: 'param-bess-power-price', key: 'bessPowerPriceEurPerKw', unit: '€/kW', isFloat: false },
    { id: 'param-bess-eff', key: 'bessEfficiencyPercent', unit: '%', isFloat: false },
    { id: 'param-bess-initial-soc', key: 'bessInitialSocPercent', unit: '%', isFloat: false },
    { id: 'param-grid-contract', key: 'gridContractKw', unit: 'kW', isFloat: false },
    { id: 'param-grid-export', key: 'gridMaxExportKw', unit: 'kW', isFloat: false },
    { id: 'param-feed-in', key: 'feedInTariffEurMwh', unit: '€/MWh', isFloat: false },
  ];

  bindings.forEach(({ id, key, unit, isFloat }) => {
    const el = document.getElementById(id);
    if (!el) return;

    const handleValueChange = (e) => {
      const raw = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      const val = isNaN(raw) ? 0 : Math.max(0, raw);
      state.params[key] = val;
      const labelId = id.replace('param-', 'val-');
      setText(labelId, `${state.params[key]} ${unit}`);
      saveStateToLocalStorage();
      recomputeAndRender();
    };

    el.addEventListener('input', handleValueChange);
    el.addEventListener('change', handleValueChange);
  });

  // Step buttons (- / +) for dimensioning inputs
  document.querySelectorAll('.btn-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const step = parseFloat(btn.getAttribute('data-step')) || 0;
      const inputEl = document.getElementById(targetId);
      if (!inputEl) return;
      const currentVal = parseFloat(inputEl.value) || 0;
      const min = inputEl.min !== '' ? parseFloat(inputEl.min) : 0;
      const max = inputEl.max !== '' ? parseFloat(inputEl.max) : Infinity;
      const newVal = Math.max(min, Math.min(max, currentVal + step));
      inputEl.value = newVal;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  const stratSelect = document.getElementById('param-strategy');
  if (stratSelect) {
    stratSelect.addEventListener('change', (e) => {
      state.params.strategy = e.target.value;
      saveStateToLocalStorage();
      recomputeAndRender();
    });
  }

  // Time Slider
  const timeSlider = document.getElementById('time-slider');
  if (timeSlider) {
    timeSlider.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      updateRealTimeDisplay(idx);
    });
  }

  // Play / Pause Replay Button
  const playBtn = document.getElementById('btn-play-pause');
  if (playBtn) {
    playBtn.addEventListener('click', togglePlayback);
  }

  // Reset to default sample button
  const resetBtn = document.getElementById('btn-reset-sample');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (confirm('Réinitialiser toutes les données avec le jeu d\'exemple réaliste ?')) {
        state.files = generateRealisticSampleCsvs();
        state.params = { ...DEFAULT_PARAMS };
        saveStateToLocalStorage();
        syncInputsWithParams();
        recomputeAndRender();
      }
    });
  }

  // Download all sample files button
  const downloadAllBtn = document.getElementById('btn-download-all-samples');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', downloadAllSampleZipOrFiles);
  }

  // Download simulation results button
  const exportSimBtn = document.getElementById('btn-export-results');
  if (exportSimBtn) {
    exportSimBtn.addEventListener('click', downloadSimulationResultsCsv);
  }

  // Global Dropzone for any CSV
  const globalDropzone = document.getElementById('global-dropzone');
  const globalFileInput = document.getElementById('global-file-input');

  if (globalDropzone && globalFileInput) {
    globalDropzone.addEventListener('click', () => globalFileInput.click());
    globalFileInput.addEventListener('change', (e) => handleMultiFilesUpload(e.target.files));

    ['dragenter', 'dragover'].forEach((eventName) => {
      globalDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        globalDropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      globalDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        globalDropzone.classList.remove('drag-over');
      });
    });

    globalDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleMultiFilesUpload(dt.files);
      }
    });
  }
}

function togglePlayback() {
  state.isPlaying = !state.isPlaying;
  const playBtn = document.getElementById('btn-play-pause');

  if (state.isPlaying) {
    if (playBtn) playBtn.innerHTML = '⏸ Pause';
    state.playbackInterval = setInterval(() => {
      let nextIdx = state.currentMinuteIndex + 5;
      if (nextIdx >= 1440) nextIdx = 0;
      updateRealTimeDisplay(nextIdx);
    }, 150);
  } else {
    if (playBtn) playBtn.innerHTML = '▶ Rejouer';
    if (state.playbackInterval) {
      clearInterval(state.playbackInterval);
      state.playbackInterval = null;
    }
  }
}

/**
 * Recomputes microgrid simulation and refreshes views
 */
function computeCapex(params) {
  const pv = params.pvCapacityKwp * params.pvPriceEurPerKwc;
  const bessCapacity = params.bessCapacityKwh * params.bessCapacityPriceEurPerKwh;
  const bessPower = params.bessPowerKw * params.bessPowerPriceEurPerKw;
  return { pv, bessCapacity, bessPower, total: pv + bessCapacity + bessPower };
}

function formatEur(value) {
  return `${Math.round(value).toLocaleString('fr-FR')} €`;
}

function updateCapexBadge() {
  const capex = computeCapex(state.params);
  setText('dimensioning-capex-badge', `💰 CAPEX : ${formatEur(capex.total)}`);
}

function recomputeAndRender() {
  state.simulationResult = runMicrogridSimulation(state.files, state.params);
  updateKpiCards(state.simulationResult.kpis);
  updateRealTimeDisplay(state.currentMinuteIndex);
  renderPlanningCharts();
  initCharts();
  renderFilesTable();
  updateCapexBadge();
}

/**
 * Helper Utilities
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

/**
 * App Initialization
 */
function init() {
  loadStateFromLocalStorage();
  syncInputsWithParams();
  bindInputListeners();
  bindPlanningEventListeners();
  recomputeAndRender();
}

// Kick off when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
