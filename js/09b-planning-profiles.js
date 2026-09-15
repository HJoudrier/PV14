function applyProfileSelfConsumption() {
  const pvForecast1m = resampleSeriesTo1Minute(state.files.PV_forecast, '1h');
  const loadForecast1m = resampleSeriesTo1Minute(state.files.LOAD_forecast, '5min');
  const pvScale = state.params.pvCapacityKwp >= 0 ? state.params.pvCapacityKwp / 250 : 1;
  const loadScale = (state.params.loadPowerPercent || 0) / 100;
  const maxKw = state.params.bessPowerKw;

  for (let h = 0; h < 24; h++) {
    let sumPv = 0;
    let sumLoad = 0;
    for (let m = 0; m < 60; m++) {
      const idx = h * 60 + m;
      sumPv += (pvForecast1m[idx] || 0) * pvScale;
      sumLoad += (loadForecast1m[idx] || 0) * loadScale;
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
  const maxKw = state.params.bessPowerKw;

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

