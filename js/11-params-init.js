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
