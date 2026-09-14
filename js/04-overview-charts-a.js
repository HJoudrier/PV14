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

  initPowerFlowsChart(sampled, labels, gridColor, textColor);
  initComparativeChart(sampled, labels, gridColor, textColor);
  initDeltasChart(sampled, labels, gridColor, textColor);
  initBessSocChart(sampled, labels, gridColor, textColor);
  initGridPriceChart(sampled, labels, gridColor, textColor);
}

// 1. Power Flows Chart (Chart 1)
function initPowerFlowsChart(sampled, labels, gridColor, textColor) {
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
}

// 2. Forecast vs Measure Comparative Chart (Chart 2)
function initComparativeChart(sampled, labels, gridColor, textColor) {
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
}

// 3. Deltas / Deviations Chart (Chart 3)
