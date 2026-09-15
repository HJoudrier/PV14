function syncInputsWithParams() {
  setInputValue('param-pv-capacity', state.params.pvCapacityKwp);
  setInputValue('param-pv-price', state.params.pvPriceEurPerKwc);
  setInputValue('param-pv-efficiency', state.params.pvKwcPerArea);

  setInputValue('param-bess-capacity', state.params.bessCapacityKwh);
  setInputValue('param-bess-capacity-price', state.params.bessCapacityPriceEurPerKwh);
  
  setInputValue('param-bess-power', state.params.bessPowerKw);
  setInputValue('param-bess-power-price', state.params.bessPowerPriceEurPerKw);

  setInputValue('param-bess-eff', state.params.bessEfficiencyPercent);

  setInputValue('param-bess-initial-soc', state.params.bessInitialSocPercent);

  setInputValue('param-grid-contract', state.params.gridContractKw);

  setInputValue('param-strategy', state.params.strategy);
}

function bindInputListeners() {
  const bindings = [
    { id: 'param-pv-capacity', key: 'pvCapacityKwp', unit: 'kWc', isFloat: false },
    { id: 'param-pv-price', key: 'pvPriceEurPerKwc', unit: '€/kWc', isFloat: false },
    { id: 'param-pv-efficiency', key: 'pvKwcPerArea', unit: 'kWc/m²', isFloat: false },
    { id: 'param-bess-capacity', key: 'bessCapacityKwh', unit: 'kWh', isFloat: false },
    { id: 'param-bess-capacity-price', key: 'bessCapacityPriceEurPerKwh', unit: '€/kWh', isFloat: false },
    { id: 'param-bess-power', key: 'bessPowerKw', unit: 'kW', isFloat: false },
    { id: 'param-bess-power-price', key: 'bessPowerPriceEurPerKw', unit: '€/kW', isFloat: false },
    { id: 'param-bess-eff', key: 'bessEfficiencyPercent', unit: '%', isFloat: false },
    { id: 'param-bess-initial-soc', key: 'bessInitialSocPercent', unit: '%', isFloat: false },
    { id: 'param-grid-contract', key: 'gridContractKw', unit: 'kW', isFloat: false },
    { id: 'param-grid-export', key: 'gridMaxExportKw', unit: 'kW', isFloat: false },
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
function computeArea(params) {
  const pv = params.pvCapacityKwp * 1000 / params.pvKwcPerArea;
  return { pv, total: pv };
}

function computeCapex(params) {
  const pv = params.pvCapacityKwp * params.pvPriceEurPerKwc;
  const bessCapacity = params.bessCapacityKwh * params.bessCapacityPriceEurPerKwh;
  const bessPower = params.bessPowerKw * params.bessPowerPriceEurPerKw;
  return { pv, bessCapacity, bessPower, total: pv + bessCapacity + bessPower };
}

/**
 * OPEX is not a fixed operating cost: it reflects the daily economic outcome
 * of the microgrid's arbitrage with the grid (purchases vs. sales) plus the
 * wear cost of cycling the battery, priced against an assumed cycle life.
 */
function computeOpexBreakdown() {
  const kpis = state.simulationResult ? state.simulationResult.kpis : null;
  const capex = computeCapex(state.params);
  const cycleLife = state.params.bessCycleLifeCycles > 0 ? state.params.bessCycleLifeCycles : 7000;

  const gridPurchaseCostEur = kpis ? kpis.totalCostEur : 0;
  const gridSaleRevenueEur = kpis ? kpis.totalRevenueEur : 0;
  const gridNetEur = kpis ? kpis.netBillEur : 0;

  const cyclesPerDay = kpis ? kpis.bessCycles : 0;
  const costPerCycleEur = capex.bessCapacity / cycleLife;
  const bessCyclingCostEur = cyclesPerDay * costPerCycleEur;

  return {
    gridPurchaseCostEur,
    gridSaleRevenueEur,
    gridNetEur,
    cycleLife,
    cyclesPerDay,
    costPerCycleEur,
    bessCyclingCostEur,
    total: gridNetEur + bessCyclingCostEur,
  };
}

function formatEur(value) {
  return `${(Math.round(value) + 0).toLocaleString('fr-FR')} €`;
}

function formatArea(value) {
  return `${Math.round(value).toLocaleString('fr-FR')} m²`;
}

function updateAreaBadge() {
  const area = computeArea(state.params);
  setText('dimensioning-area-badge', `▱ AREA : ${formatArea(area.total)}`);

  const defBadge = document.getElementById('dimensioning-area-limit-badge');
  if (defBadge) {
    if (state.params.areaLimitEnabled && area.total > state.params.areaLimitM2) {
      defBadge.hidden = false;
      defBadge.textContent = `⚠️ Surface : ${formatArea(state.params.areaLimitM2)} max`;
    } else {
      defBadge.hidden = true;
    }
  }
}

function updateCapexBadge() {
  const capex = computeCapex(state.params);
  setText('dimensioning-capex-badge', `💰 CAPEX : ${formatEur(capex.total)}`);

  const defBadge = document.getElementById('dimensioning-capex-limit-badge');
  if (defBadge) {
    if (state.params.capexLimitEnabled && capex.total > state.params.capexLimitEur) {
      defBadge.hidden = false;
      defBadge.textContent = `️⚠️ CAPEX : ${formatEur(state.params.capexLimitEur)} max`;
    } else {
      defBadge.hidden = true;
    }
  }
}

function updateOpexBadge() {
  const opex = computeOpexBreakdown();
  setText('planning-opex-badge', `💰 OPEX (jour) : ${formatEur(opex.total)}`);

  const limitBadge = document.getElementById('planning-opex-limit-badge');
  if (limitBadge) {
    if (state.params.opexLimitEnabled && opex.total > state.params.opexLimitEurPerDay) {
      limitBadge.hidden = false;
      limitBadge.textContent = `⚠️ OPEX : ${formatEur(state.params.opexLimitEurPerDay)} max/jour`;
    } else {
      limitBadge.hidden = true;
    }
  }
}

function updateGridPowerLimits() {
  const grid = state.params.gridContractKw;

  state.params.gridMaxExportKw = -grid;
  state.params.gridMaxImportKw = grid;
}

function recomputeAndRender() {
  updateGridPowerLimits();
  state.simulationResult = runMicrogridSimulation(state.files, state.params);
  updateKpiCards(state.simulationResult.kpis);
  updateRealTimeDisplay(state.currentMinuteIndex);
  renderPlanningCharts();
  initCharts();
  renderFilesTable();
  updateCapexBadge();
  updateAreaBadge();
  updateOpexBadge();
  refreshOpenDetailModal();
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
  bindDetailModalListeners();
  recomputeAndRender();
}

// Kick off when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
