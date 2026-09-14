function bindPlanningEventListeners() {
  const powerInput = document.getElementById('planning-bess-power-input');
  if (powerInput) {
    const commitPowerInput = (e) => {
      const val = parseFloat(e.target.value);
      if (isNaN(val)) return;
      setPlanningHourPower(state.selectedPlanningHour, val);
    };
    powerInput.addEventListener('input', commitPowerInput);
    powerInput.addEventListener('change', commitPowerInput);
  }

  document.getElementById('btn-plan-power-minus')?.addEventListener('click', () => changeSelectedHourPower(-10));
  document.getElementById('btn-plan-power-plus')?.addEventListener('click', () => changeSelectedHourPower(10));

  document.getElementById('btn-bess-zero')?.addEventListener('click', () => {
    setPlanningHourPower(state.selectedPlanningHour, 0);
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
