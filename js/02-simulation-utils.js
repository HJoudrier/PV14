function resampleSeriesTo1Minute(rawCsv, defaultRes = '1h') {
  const result = new Array(1440).fill(0);
  if (!rawCsv || !rawCsv.trim()) return result;

  const parsed = Papa.parse(rawCsv.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  const rows = parsed.data || [];
  const fields = parsed.meta.fields || [];
  if (rows.length === 0 || fields.length === 0) return result;

  const timeCol = fields.find((f) => /time|date|horaire|horodate|ts/i.test(f)) || fields[0];
  const valCol = fields.find((f) => f !== timeCol && /power|puissance|kw|eur|price|prix|load|charge|pv|measure|mesure|value/i.test(f))
    || fields.find((f) => f !== timeCol)
    || fields[1];

  const minuteMap = new Map();
  for (const row of rows) {
    const rawT = row[timeCol];
    const rawV = row[valCol];
    if (rawT === undefined || rawV === undefined) continue;

    const m = parseTimeToMinutes(rawT);
    const num = parseFloat(String(rawV).replace(',', '.'));
    if (!isNaN(num)) {
      minuteMap.set(m, num);
    }
  }

  if (minuteMap.size === 0) return result;

  const knownMinutes = Array.from(minuteMap.keys()).sort((a, b) => a - b);

  // If 1-minute step: direct fill with gap preservation
  if (knownMinutes.length > 500) {
    let lastVal = minuteMap.get(knownMinutes[0]) || 0;
    for (let m = 0; m < 1440; m++) {
      if (minuteMap.has(m)) {
        lastVal = minuteMap.get(m);
      }
      result[m] = lastVal;
    }
    return result;
  }

  // If 5-min step (interpolation)
  if (knownMinutes.length >= 200 && knownMinutes.length <= 350) {
    for (let m = 0; m < 1440; m++) {
      if (minuteMap.has(m)) {
        result[m] = minuteMap.get(m);
      } else {
        let prevM = knownMinutes[0];
        let nextM = knownMinutes[knownMinutes.length - 1];
        for (let i = 0; i < knownMinutes.length; i++) {
          if (knownMinutes[i] <= m) prevM = knownMinutes[i];
          if (knownMinutes[i] >= m) {
            nextM = knownMinutes[i];
            break;
          }
        }
        if (prevM === nextM) {
          result[m] = minuteMap.get(prevM) || 0;
        } else {
          const v0 = minuteMap.get(prevM) || 0;
          const v1 = minuteMap.get(nextM) || 0;
          const alpha = (m - prevM) / (nextM - prevM);
          result[m] = v0 + (v1 - v0) * alpha;
        }
      }
    }
    return result;
  }

  // Hourly step (hourly hold or ramp)
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const hMin = h * 60;
    if (minuteMap.has(hMin)) {
      result[m] = minuteMap.get(hMin);
    } else {
      let closest = knownMinutes[0];
      let minDiff = Infinity;
      for (const km of knownMinutes) {
        const diff = Math.abs(km - m);
        if (diff < minDiff) {
          minDiff = diff;
          closest = km;
        }
      }
      result[m] = minuteMap.get(closest) || 0;
    }
  }

  return result;
}

/**
 * Décide de la puissance de charge/décharge BESS pour une minute donnée, selon la
 * stratégie de pilotage sélectionnée. Retourne des puissances positives.
 */
function computeBessDispatch(params, ctx) {
  const { plannedBessKw, priceMwh, medianPrice, netLocal, loadM, currentEnergy, minEnergy, maxEnergy, oneWayEff, dtHours } = ctx;
  let bessNetKw = 0; // >0 discharge, <0 charge
  let bessChargeKw = 0;
  let bessDischargeKw = 0;

  if (params.strategy === 'follow_forecast' && Math.abs(plannedBessKw) > 0.1) {
    if (plannedBessKw > 0) {
      // Requested discharge
      const maxDisch = Math.min(
        params.bessPowerKw,
        ((currentEnergy - minEnergy) / dtHours) * oneWayEff
      );
      bessDischargeKw = Math.max(0, Math.min(plannedBessKw, maxDisch));
      bessNetKw = bessDischargeKw;
    } else {
      // Requested charge
      const maxChg = Math.min(
        params.bessPowerKw,
        ((maxEnergy - currentEnergy) / (dtHours * oneWayEff))
      );
      bessChargeKw = Math.max(0, Math.min(-plannedBessKw, maxChg));
      bessNetKw = -bessChargeKw;
    }
  } else if (params.strategy === 'price_arbitrage') {
    if (priceMwh < medianPrice * 0.85 && currentEnergy < maxEnergy) {
      const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
      bessChargeKw = maxChg;
      bessNetKw = -bessChargeKw;
    } else if (priceMwh > medianPrice * 1.25 && currentEnergy > minEnergy) {
      const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
      bessDischargeKw = maxDisch;
      bessNetKw = bessDischargeKw;
    } else {
      // fallback to self-consumption
      if (netLocal > 0) {
        const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
        bessChargeKw = Math.min(netLocal, maxChg);
        bessNetKw = -bessChargeKw;
      } else {
        const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
        bessDischargeKw = Math.min(-netLocal, maxDisch);
        bessNetKw = bessDischargeKw;
      }
    }
  } else if (params.strategy === 'peak_shaving') {
    // Shave load above contract / threshold
    const peakThreshold = params.gridContractKw * 0.75;
    if (loadM > peakThreshold && currentEnergy > minEnergy) {
      const needed = loadM - peakThreshold;
      const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
      bessDischargeKw = Math.min(needed, maxDisch);
      bessNetKw = bessDischargeKw;
    } else if (netLocal > 0) {
      const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
      bessChargeKw = Math.min(netLocal, maxChg);
      bessNetKw = -bessChargeKw;
    }
  } else {
    // Default: Max self-consumption
    if (netLocal > 0) {
      const maxChg = Math.min(params.bessPowerKw, ((maxEnergy - currentEnergy) / (dtHours * oneWayEff)));
      bessChargeKw = Math.min(netLocal, maxChg);
      bessNetKw = -bessChargeKw;
    } else {
      const maxDisch = Math.min(params.bessPowerKw, ((currentEnergy - minEnergy) / dtHours) * oneWayEff);
      bessDischargeKw = Math.min(-netLocal, maxDisch);
      bessNetKw = bessDischargeKw;
    }
  }

  return { bessChargeKw, bessDischargeKw, bessNetKw };
}

/**
 * Microgrid Physics Simulation Engine
 */
