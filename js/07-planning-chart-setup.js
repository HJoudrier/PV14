const lockAxisWidth = (width) => (axis) => {
  axis.width = width;
};

// Axe catégoriel caché à 24 créneaux (avec `offset: true`, comme le ferait n'importe
// quel bar chart), utilisé pour toutes les séries de la Courbe 1 (courbes ET barres).
// Ses 24 cellules se calent exactement sur les 24 intervalles de l'axe horaire principal
// `x` (25 graduations 00:00..24:00, `offset: false`) : chaque point/barre se retrouve
// donc centré sur la demi-heure de son créneau (ex. le créneau 00:00-01:00 est centré
// sur 00:30), ce qui représente correctement une moyenne horaire, sans déplacer les
// graduations affichées.
const hiddenHourBarAxis = (hours) => ({
  type: 'category',
  position: 'bottom',
  offset: true,
  labels: hours,
  display: false,
});

// Calcule des bornes min/max pour l'axe puissance (yPower) et l'axe prix (yPrice) de la
// Courbe 1 telles que leurs deux "0" tombent exactement à la même hauteur (même fraction
// verticale), même si la puissance a des valeurs négatives et le prix non.
function computeAlignedZeroScales(powerValues, priceValues) {
  const roundStep = 50;
  const powerNums = powerValues.filter((v) => v != null);
  const priceNums = priceValues.filter((v) => v != null);
  const powerDataMin = Math.min(0, ...powerNums);
  const powerDataMax = Math.max(0, ...powerNums);
  const powerPad = 20;
  const powerMin = powerDataMin < 0 ? Math.floor((powerDataMin - powerPad) / roundStep) * roundStep : 0;
  let powerMax = Math.ceil((powerDataMax + powerPad) / roundStep) * roundStep;
  if (powerMax <= powerMin) powerMax = powerMin + roundStep;

  const priceDataMax = Math.max(0, ...priceNums);
  const pricePad = 10;
  let priceMax = Math.ceil((priceDataMax + pricePad) / roundStep) * roundStep;
  if (priceMax <= 0) priceMax = roundStep;

  // Fraction de la hauteur de l'axe puissance à laquelle se trouve le 0.
  const zeroFraction = Math.min(0.98, Math.max(0, (0 - powerMin) / (powerMax - powerMin)));
  const priceMin = zeroFraction === 0 ? 0 : (zeroFraction * priceMax) / (zeroFraction - 1);

  return { powerMin, powerMax, priceMin, priceMax };
}

function renderPlanningCharts() {
  const planData = getPlanningHourlyData();
  const hoursExt = [...planData.hours, '24:00'];

  // Update Section Badges
  const defBadge = document.getElementById('planning-deficit-badge');
  if (defBadge) {
    if (planData.totalDeficitKwh > 0.1) {
      defBadge.hidden = false;
      defBadge.textContent = `⚠️ LOAD : ${planData.totalDeficitKwh} kWh non couverts`;
    } else {
      defBadge.hidden = true;
    }
  }

  setText('planning-soc-end-badge', `🔋 SoC fin : ${planData.finalSoc}%`);

  // Update Controller UI for selected hour
  updatePlanningControllerUI(planData);

  renderPowerChart(planData, hoursExt);
  renderBessChart(planData, hoursExt);

  refreshOpenDetailModal();
}

// 1. Chart 1: Plan de production / consommation (Courbe 1)
