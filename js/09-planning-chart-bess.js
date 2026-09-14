function renderBessChart(planData, hoursExt) {
  const ctxBess = document.getElementById('chart-planning-bess')?.getContext('2d');
  if (ctxBess) {
    const pMax = Math.max(state.params.bessPowerKw * 1.15, 50);

    // Barres centrées sur la demi-heure de leur créneau (axe xBar caché), il n'y a pas
    // de barre pour une "heure 24" qui n'existe pas.
    const bessPlanBars = planData.bessPlan;
    const bessPlanReqBars = planData.bessPlanReq;
    // Le SoC doit tomber sur les heures entières, entre deux barres : le point 0 (00:00)
    // est le SoC initial (avant toute opération), et le point i (i = 1..24) est le SoC
    // résultant à la fin de l'heure (i-1), donc le dernier point (24:00) = SoC final réel.
    const socBoundariesExt = [state.params.bessInitialSocPercent, ...planData.socCurve];
    const socBoundariesUnlimitedExt = [state.params.bessInitialSocPercent, ...planData.socCurveUnlimited];
    const socMaxLine = new Array(hoursExt.length).fill(planData.socMaxLimit);
    const socMinLine = new Array(hoursExt.length).fill(planData.socMinLimit);

    if (state.charts.planningBess) {
      const chart = state.charts.planningBess;
      chart.data.labels = hoursExt;
      chart.data.datasets[0].data = bessPlanReqBars;
      chart.data.datasets[1].data = bessPlanBars;
      chart.data.datasets[2].data = socBoundariesExt;
      chart.data.datasets[3].data = socBoundariesUnlimitedExt;
      chart.data.datasets[4].data = socMaxLine;
      chart.data.datasets[5].data = socMinLine;
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
              // Consigne demandée (avant limitation par la puissance onduleur / le SoC) :
              // tracée en pointillé, superposée à la puissance réellement chargée/déchargée.
              type: 'bar',
              label: 'Consigne demandée (kW)',
              data: bessPlanReqBars,
              barPercentage: 0.9,
              categoryPercentage: 0.8,
              grouped: false,
              xAxisID: 'xBar',
              yAxisID: 'yPower',
              borderRadius: 3,
              backgroundColor: 'rgba(0, 0, 0, 0)',
              borderColor: (ctx) => (ctx.dataIndex === state.selectedPlanningHour ? '#0f172a' : '#64748b'),
              borderWidth: (ctx) => (ctx.dataIndex === state.selectedPlanningHour ? 2 : 1.5),
              borderDash: [4, 3],
              order: 0,
            },
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
              order: 1,
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
            {
              // Trajectoire théorique du SoC si toutes les consignes demandées étaient
              // intégralement applicables (sans limite de puissance ni de SoC).
              type: 'line',
              label: 'SoC si consignes 100% appliquées (%)',
              data: socBoundariesUnlimitedExt,
              yAxisID: 'ySoC',
              borderColor: '#a5b4fc',
              borderWidth: 2,
              borderDash: [5, 3],
              fill: false,
              tension: 0,
              pointRadius: 0,
            },
            {
              // Limite haute de SoC.
              type: 'line',
              label: 'Limite SoC max (%)',
              data: socMaxLine,
              yAxisID: 'ySoC',
              borderColor: '#f43f5e',
              borderWidth: 1.25,
              borderDash: [3, 3],
              fill: false,
              tension: 0,
              pointRadius: 0,
            },
            {
              // Limite basse de SoC.
              type: 'line',
              label: 'Limite SoC min (%)',
              data: socMinLine,
              yAxisID: 'ySoC',
              borderColor: '#f43f5e',
              borderWidth: 1.25,
              borderDash: [3, 3],
              fill: false,
              tension: 0,
              pointRadius: 0,
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
                    return ` ${ctx.dataset.label}: ${ctx.raw}%`;
                  }
                  const v = ctx.raw;
                  const mode = v > 0 ? 'Décharge' : v < 0 ? 'Charge' : 'Veille';
                  return ` ${ctx.dataset.label}: ${v > 0 ? '+' : ''}${v} kW (${mode})`;
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
