function renderBessChart(planData, hoursExt) {
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

