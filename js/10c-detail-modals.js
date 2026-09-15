/**
 * AREA / CAPEX / OPEX detail modals: per-asset breakdown + configurable budget limits.
 */

function limitStatusText(current, limit, enabled, formatter) {
  if (!enabled) {
    return `Valeur actuelle : ${formatter(current)} — limite désactivée.`;
  }
  if (current > limit) {
    return `⚠️ Valeur actuelle : ${formatter(current)} — dépassement de ${formatter(current - limit)}.`;
  }
  return `✅ Valeur actuelle : ${formatter(current)} — dans la limite (${formatter(limit)} max).`;
}

function openDetailModal(type) {
  state.openDetailModalType = type;
  renderDetailModalContent(type);
  const overlay = document.getElementById('detail-modal');
  if (overlay) overlay.hidden = false;
}

function closeDetailModal() {
  state.openDetailModalType = null;
  const overlay = document.getElementById('detail-modal');
  if (overlay) overlay.hidden = true;
}

function refreshOpenDetailModal() {
  if (state.openDetailModalType) {
    renderDetailModalContent(state.openDetailModalType);
  }
}

function renderDetailModalContent(type) {
  const bodyEl = document.getElementById('detail-modal-body');
  if (!bodyEl) return;

  if (type === 'area') {
    setText('detail-modal-title', '▱ Détail de la surface (AREA)');
    bodyEl.innerHTML = renderAreaDetailHtml();
    bindAreaLimitHandlers();
  } else if (type === 'capex') {
    setText('detail-modal-title', '💰 Détail du CAPEX');
    bodyEl.innerHTML = renderCapexDetailHtml();
    bindCapexLimitHandlers();
  } else if (type === 'opex') {
    setText('detail-modal-title', "💰 Détail de l'OPEX");
    bodyEl.innerHTML = renderOpexDetailHtml();
    bindOpexHandlers();
  }
}

/**
 * AREA
 */
function renderAreaDetailHtml() {
  const p = state.params;
  const area = computeArea(p);
  const pct = area.total > 0 ? (area.pv / area.total) * 100 : 0;
  const limitOn = p.areaLimitEnabled;
  const limit = p.areaLimitM2;

  return `
    <table class="detail-table">
      <thead>
        <tr><th>Actif</th><th>Calcul</th><th class="num">Surface</th><th class="num">%</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>☀️ PV</td>
          <td>${p.pvCapacityKwp} kWc ÷ ${p.pvKwcPerArea} kWc/m²</td>
          <td class="num">${formatArea(area.pv)}</td>
          <td class="num">${pct.toFixed(0)}%</td>
        </tr>
      </tbody>
      <tfoot>
        <tr><td colspan="2">Total</td><td class="num">${formatArea(area.total)}</td><td class="num">100%</td></tr>
      </tfoot>
    </table>
    <p class="detail-note">Seul le PV occupe une surface au sol dans ce modèle (BESS et raccordement réseau considérés sans emprise).</p>

    <div class="limit-config">
      <div class="limit-config-title">Limite de surface</div>
      <label class="limit-config-row">
        <input type="checkbox" id="modal-area-limit-toggle" ${limitOn ? 'checked' : ''} />
        Activer une limite de surface
      </label>
      <label class="limit-config-row">
        <span>Surface maximale</span>
        <input type="number" min="0" step="10" id="modal-area-limit-value" value="${limit}" ${limitOn ? '' : 'disabled'} />
        <span>m²</span>
      </label>
      <p class="limit-status" id="modal-area-status">${limitStatusText(area.total, limit, limitOn, formatArea)}</p>
    </div>
  `;
}

function bindAreaLimitHandlers() {
  const toggle = document.getElementById('modal-area-limit-toggle');
  const value = document.getElementById('modal-area-limit-value');
  const status = document.getElementById('modal-area-status');

  const refreshStatus = () => {
    const area = computeArea(state.params);
    if (status) {
      status.textContent = limitStatusText(area.total, state.params.areaLimitM2, state.params.areaLimitEnabled, formatArea);
    }
    if (value) value.disabled = !state.params.areaLimitEnabled;
  };

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      state.params.areaLimitEnabled = e.target.checked;
      saveStateToLocalStorage();
      updateAreaBadge();
      refreshStatus();
    });
  }
  if (value) {
    const commit = (e) => {
      const v = Math.max(0, parseFloat(e.target.value) || 0);
      state.params.areaLimitM2 = v;
      saveStateToLocalStorage();
      updateAreaBadge();
      refreshStatus();
    };
    value.addEventListener('input', commit);
    value.addEventListener('change', commit);
  }
}

/**
 * CAPEX
 */
function renderCapexDetailHtml() {
  const p = state.params;
  const capex = computeCapex(p);
  const rows = [
    { label: '☀️ PV', calc: `${p.pvCapacityKwp} kWc × ${p.pvPriceEurPerKwc} €/kWc`, value: capex.pv },
    { label: '🔋 BESS — Capacité', calc: `${p.bessCapacityKwh} kWh × ${p.bessCapacityPriceEurPerKwh} €/kWh`, value: capex.bessCapacity },
    { label: '⚡ BESS — Onduleur', calc: `${p.bessPowerKw} kW × ${p.bessPowerPriceEurPerKw} €/kW`, value: capex.bessPower },
  ];
  const limitOn = p.capexLimitEnabled;
  const limit = p.capexLimitEur;

  const rowsHtml = rows
    .map((r) => {
      const pct = capex.total > 0 ? (r.value / capex.total) * 100 : 0;
      return `<tr><td>${r.label}</td><td>${r.calc}</td><td class="num">${formatEur(r.value)}</td><td class="num">${pct.toFixed(0)}%</td></tr>`;
    })
    .join('');

  return `
    <table class="detail-table">
      <thead><tr><th>Actif</th><th>Calcul</th><th class="num">CAPEX</th><th class="num">%</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class="num">${formatEur(capex.total)}</td><td class="num">100%</td></tr></tfoot>
    </table>
    <p class="detail-note">🌐 GRID : aucun coût de raccordement n'est modélisé dans le CAPEX.</p>

    <div class="limit-config">
      <div class="limit-config-title">Limite de CAPEX</div>
      <label class="limit-config-row">
        <input type="checkbox" id="modal-capex-limit-toggle" ${limitOn ? 'checked' : ''} />
        Activer une limite de CAPEX
      </label>
      <label class="limit-config-row">
        <span>CAPEX maximal</span>
        <input type="number" min="0" step="1000" id="modal-capex-limit-value" value="${limit}" ${limitOn ? '' : 'disabled'} />
        <span>€</span>
      </label>
      <p class="limit-status" id="modal-capex-status">${limitStatusText(capex.total, limit, limitOn, formatEur)}</p>
    </div>
  `;
}

function bindCapexLimitHandlers() {
  const toggle = document.getElementById('modal-capex-limit-toggle');
  const value = document.getElementById('modal-capex-limit-value');
  const status = document.getElementById('modal-capex-status');

  const refreshStatus = () => {
    const capex = computeCapex(state.params);
    if (status) {
      status.textContent = limitStatusText(capex.total, state.params.capexLimitEur, state.params.capexLimitEnabled, formatEur);
    }
    if (value) value.disabled = !state.params.capexLimitEnabled;
  };

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      state.params.capexLimitEnabled = e.target.checked;
      saveStateToLocalStorage();
      updateCapexBadge();
      refreshStatus();
    });
  }
  if (value) {
    const commit = (e) => {
      const v = Math.max(0, parseFloat(e.target.value) || 0);
      state.params.capexLimitEur = v;
      saveStateToLocalStorage();
      updateCapexBadge();
      refreshStatus();
    };
    value.addEventListener('input', commit);
    value.addEventListener('change', commit);
  }
}

/**
 * OPEX — daily grid arbitrage result + battery cycling wear cost
 */
function renderOpexDetailHtml() {
  const p = state.params;
  const opex = computeOpexBreakdown();
  const limitOn = p.opexLimitEnabled;
  const limit = p.opexLimitEurPerDay;

  return `
    <p class="detail-note">
      L'OPEX n'est pas un coût fixe : il traduit le résultat économique journalier de l'arbitrage
      avec le réseau (achats vs. ventes) et le coût d'usure de la batterie lié à son cyclage.
    </p>
    <table class="detail-table">
      <thead>
        <tr><th>Poste</th><th>Actif</th><th class="num">Montant</th></tr>
      </thead>
      <tbody>
        <tr><td>Achats réseau (import)</td><td>🌐 GRID</td><td class="num">${formatEur(opex.gridPurchaseCostEur)}</td></tr>
        <tr><td>Ventes réseau (injection)</td><td>🌐 GRID</td><td class="num">${formatEur(-opex.gridSaleRevenueEur)}</td></tr>
        <tr><td>Solde net réseau (arbitrage)</td><td>🌐 GRID</td><td class="num">${formatEur(opex.gridNetEur)}</td></tr>
        <tr><td>Usure batterie (cyclage)</td><td>🔋 BESS</td><td class="num">${formatEur(opex.bessCyclingCostEur)}</td></tr>
      </tbody>
      <tfoot>
        <tr><td colspan="2">Total OPEX (jour simulé)</td><td class="num">${formatEur(opex.total)}</td></tr>
      </tfoot>
    </table>
    <p class="detail-note">
      Cyclage batterie : ${opex.cyclesPerDay.toFixed(2)} cycles/jour × ${formatEur(opex.costPerCycleEur)}/cycle
      (CAPEX batterie ÷ durée de vie de
      <input type="number" min="1" step="500" id="modal-opex-cycle-life" value="${opex.cycleLife}" class="inline-number" />
      cycles).
    </p>

    <div class="limit-config">
      <div class="limit-config-title">Limite d'OPEX</div>
      <label class="limit-config-row">
        <input type="checkbox" id="modal-opex-limit-toggle" ${limitOn ? 'checked' : ''} />
        Activer une limite d'OPEX journalier
      </label>
      <label class="limit-config-row">
        <span>OPEX maximal</span>
        <input type="number" min="0" step="10" id="modal-opex-limit-value" value="${limit}" ${limitOn ? '' : 'disabled'} />
        <span>€ / jour</span>
      </label>
      <p class="limit-status" id="modal-opex-status">${limitStatusText(opex.total, limit, limitOn, formatEur)}</p>
    </div>
  `;
}

function bindOpexHandlers() {
  const cycleLifeInput = document.getElementById('modal-opex-cycle-life');
  if (cycleLifeInput) {
    cycleLifeInput.addEventListener('change', (e) => {
      const v = Math.max(1, parseInt(e.target.value, 10) || 7000);
      state.params.bessCycleLifeCycles = v;
      saveStateToLocalStorage();
      updateOpexBadge();
      renderDetailModalContent('opex');
    });
  }

  const toggle = document.getElementById('modal-opex-limit-toggle');
  const value = document.getElementById('modal-opex-limit-value');
  const status = document.getElementById('modal-opex-status');

  const refreshStatus = () => {
    const opex = computeOpexBreakdown();
    if (status) {
      status.textContent = limitStatusText(opex.total, state.params.opexLimitEurPerDay, state.params.opexLimitEnabled, formatEur);
    }
    if (value) value.disabled = !state.params.opexLimitEnabled;
  };

  if (toggle) {
    toggle.addEventListener('change', (e) => {
      state.params.opexLimitEnabled = e.target.checked;
      saveStateToLocalStorage();
      updateOpexBadge();
      refreshStatus();
    });
  }
  if (value) {
    const commit = (e) => {
      const v = Math.max(0, parseFloat(e.target.value) || 0);
      state.params.opexLimitEurPerDay = v;
      saveStateToLocalStorage();
      updateOpexBadge();
      refreshStatus();
    };
    value.addEventListener('input', commit);
    value.addEventListener('change', commit);
  }
}

/**
 * Wiring: open/close triggers
 */
function bindDetailModalListeners() {
  const overlay = document.getElementById('detail-modal');
  const closeBtn = document.getElementById('detail-modal-close');
  const areaBtn = document.getElementById('btn-area-detail');
  const capexBtn = document.getElementById('btn-capex-detail');
  const opexBtn = document.getElementById('btn-opex-detail');

  if (areaBtn) areaBtn.addEventListener('click', () => openDetailModal('area'));
  if (capexBtn) capexBtn.addEventListener('click', () => openDetailModal('capex'));
  if (opexBtn) opexBtn.addEventListener('click', () => openDetailModal('opex'));

  if (closeBtn) closeBtn.addEventListener('click', closeDetailModal);
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeDetailModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.openDetailModalType) closeDetailModal();
  });
}
