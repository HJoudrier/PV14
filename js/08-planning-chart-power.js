function renderPowerChart(planData, hoursExt) {
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
}

// 2. Chart 2: Pilotage Batterie & SoC (Courbe 2)
