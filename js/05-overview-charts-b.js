function initDeltasChart(sampled, labels, gridColor, textColor) {
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
}

// 4. Battery SoC and Dispatch (Chart 4)
function initBessSocChart(sampled, labels, gridColor, textColor) {
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
}

// 5. Grid Price & Cumulative Cost (Chart 5)
function initGridPriceChart(sampled, labels, gridColor, textColor) {
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

