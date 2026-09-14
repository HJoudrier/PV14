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
  const bessPlanReq = [];
  const bessPowerLimited = [];
  const bessSocLimited = [];
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
    let powerLimited = false;
    let socLimited = false;

    if (pReq > 0) {
      // Discharge (upwards): limited by available stored energy
      const availKwh = Math.max(0, ((currentSoc - minSoc) / 100) * capacityKwh * eff);
      pEff = Math.max(0, Math.min(pReq, bessPowerMax, availKwh));
      powerLimited = pReq > bessPowerMax;
      socLimited = pReq > availKwh;
      currentSoc = Math.max(minSoc, currentSoc - (pEff / eff / capacityKwh) * 100);
    } else if (pReq < 0) {
      // Charge (downwards): limited by available capacity room
      const roomKwh = Math.max(0, ((maxSoc - currentSoc) / 100) * capacityKwh / eff);
      pEff = -Math.max(0, Math.min(Math.abs(pReq), bessPowerMax, roomKwh));
      powerLimited = Math.abs(pReq) > bessPowerMax;
      socLimited = Math.abs(pReq) > roomKwh;
      currentSoc = Math.min(maxSoc, currentSoc + (Math.abs(pEff) * eff / capacityKwh) * 100);
    } else {
      pEff = 0;
    }

    bessPlan.push(Number(pEff.toFixed(1)));
    bessPlanReq.push(Number(pReq.toFixed(1)));
    bessPowerLimited.push(powerLimited);
    bessSocLimited.push(socLimited);
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
    bessPlanReq,
    bessPowerLimited,
    bessSocLimited,
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

  // Update initial SoC (= résultant du pas de temps précédent) and resulting SoC for this hour
  if (planData && planData.socCurve) {
    const initialSoc = h === 0 ? state.params.bessInitialSocPercent : planData.socCurve[h - 1];
    if (initialSoc !== undefined) {
      setText('planning-hour-soc-initial-badge', `${initialSoc}%`);
    }
    if (planData.socCurve[h] !== undefined) {
      setText('planning-hour-soc-badge', `${planData.socCurve[h]}%`);
    }
  }

  // Champ de consigne (numérique) : bornes & valeur
  const maxKw = state.params.bessPowerKw || 150;
  const powerInput = document.getElementById('planning-bess-power-input');
  if (powerInput) {
    powerInput.min = -maxKw;
    powerInput.max = maxKw;
    if (document.activeElement !== powerInput) {
      powerInput.value = currentPower;
    }
  }

  // Alertes : consigne réduite car hors limite de SoC et/ou de puissance onduleur.
  const alertsEl = document.getElementById('planning-hour-alerts');
  if (alertsEl && planData) {
    const badges = [];
    if (planData.bessSocLimited && planData.bessSocLimited[h]) {
      badges.push(
        '<span class="px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">⚠️ SoC hors limites</span>'
      );
    }
    if (planData.bessPowerLimited && planData.bessPowerLimited[h]) {
      badges.push(
        '<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">⚠️ Puissance hors limite</span>'
      );
    }
    alertsEl.innerHTML = badges.join('');
  }
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
