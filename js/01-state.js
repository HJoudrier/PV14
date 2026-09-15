// Papa and Chart are loaded globally via vendor/papaparse.min.js and vendor/chart.umd.min.js

// Register Chart.js components
Chart.register(
  Chart.LineController,
  Chart.BarController,
  Chart.LineElement,
  Chart.BarElement,
  Chart.PointElement,
  Chart.LinearScale,
  Chart.CategoryScale,
  Chart.Title,
  Chart.Tooltip,
  Chart.Legend,
  Chart.Filler
);

// File specifications as defined in user prompt
const FILE_SPECS = [
  {
    id: 'GRID_forecast',
    filename: 'GRID_forecast.csv',
    asset: 'GRID',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: '€/MWh & kW',
    desc: 'Prix de l\'énergie horaire et limite contractuelle réseau',
    color: '#3b82f6',
  },
  {
    id: 'PV_forecast',
    filename: 'PV_forecast.csv',
    asset: 'PV',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: 'kW',
    desc: 'Prévision de production solaire photovoltaïque',
    color: '#eab308',
  },
  {
    id: 'BESS_forecast',
    filename: 'BESS_forecast.csv',
    asset: 'BESS',
    type: 'forecast',
    resolution: '1h (Horaire)',
    unit: 'kW & %',
    desc: 'Planning prévisionnel de pilotage batterie (puissance & SoC)',
    color: '#10b981',
  },
  {
    id: 'LOAD_forecast',
    filename: 'LOAD_forecast.csv',
    asset: 'LOAD',
    type: 'forecast',
    resolution: '5 min',
    unit: 'kW',
    desc: 'Prévision de la consommation de la charge non pilotable',
    color: '#ef4444',
  },
  {
    id: 'PV_measures',
    filename: 'PV_measures.csv',
    asset: 'PV',
    type: 'measure',
    resolution: '1 min',
    unit: 'kW',
    desc: 'Mesures réelles de production PV (télémétrie)',
    color: '#ca8a04',
  },
  {
    id: 'LOAD_measure',
    filename: 'LOAD_measure.csv',
    asset: 'LOAD',
    type: 'measure',
    resolution: '1 min',
    unit: 'kW',
    desc: 'Mesures réelles de consommation de la charge',
    color: '#dc2626',
  },
];

// Default dimensioning parameters
const DEFAULT_PARAMS = {
  pvCapacityKwp: 0,
  pvPriceEurPerKwc: 1200,
  pvKwcPerArea: 230,
  bessCapacityKwh: 0,
  bessCapacityPriceEurPerKwh: 250,
  bessPowerKw: 0,
  bessPowerPriceEurPerKw: 150,
  bessEfficiencyPercent: 92,
  bessMinSocPercent: 5,
  bessMaxSocPercent: 95,
  bessInitialSocPercent: 50,
  gridContractKw: 40,
  gridMaxExportKw: 40,
  gridMaxImportKw: 40,
  feedInTariffEurMwh: 45,
  strategy: 'self_consumption', // 'self_consumption' | 'follow_forecast' | 'price_arbitrage' | 'peak_shaving'
};

// Default 24h BESS schedule (kW)
const DEFAULT_BESS_PLAN = [
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0,
];

// Global State
const state = {
  files: {},
  params: { ...DEFAULT_PARAMS },
  simulationResult: null,
  currentMinuteIndex: 780, // 13:00 default cursor
  isPlaying: false,
  playbackInterval: null,
  charts: {},
  activeTab: 'overview',
  planningBess: [...DEFAULT_BESS_PLAN],
  selectedPlanningHour: 12,
  isDraggingPlanning: false,
  planningDebounceTimer: null,
};

// LocalStorage Keys
const STORAGE_PREFIX = 'microgrid_';
const STORAGE_PARAMS_KEY = `${STORAGE_PREFIX}params`;
const STORAGE_FILES_KEY = `${STORAGE_PREFIX}files`;

/**
 * Generates realistic sample CSV contents for standard 24-hour day (2026-06-15)
 */
function generateRealisticSampleCsvs() {
  const dateStr = '2026-06-15';

  // 1. GRID_forecast.csv (24 rows, 1h step)
  const gridRows = ['timestamp,price_eur_per_mwh,contract_limit_kw'];
  const basePrices = [
    65, 58, 52, 50, 56, 72, 115, 148, 130, 85,
    55, 32, 22, 28, 42, 68, 92, 135, 185, 210,
    170, 132, 98, 76
  ];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    gridRows.push(`${dateStr} ${hh}:00:00,${basePrices[h]},160.0`);
  }

  // 2. PV_forecast.csv (24 rows, 1h step)
  const pvForecastRows = ['timestamp,pv_power_kw'];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    let power = 0;
    if (h >= 6 && h <= 20) {
      const angle = ((h - 6) / 14) * Math.PI;
      power = Math.sin(angle) * 215;
    }
    pvForecastRows.push(`${dateStr} ${hh}:00:00,${power.toFixed(1)}`);
  }

  // 3. LOAD_forecast.csv (288 rows, 5 min step)
  const loadForecastRows = ['timestamp,load_power_kw'];
  for (let m = 0; m < 1440; m += 5) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let base = 35; // night
    if (h >= 6 && h < 19) {
      const progress = (h - 6) + min / 60;
      base = 42 + 70 * (1 / (1 + Math.exp(-(progress - 1.5) * 2)));
      if (h >= 12 && h < 14) {
        base -= 24 * Math.sin(((progress - 6) / 2) * Math.PI);
      } else if (h >= 14 && h < 17) {
        base += 18 * Math.sin(((progress - 8) / 3) * Math.PI);
      }
    } else if (h >= 19 && h < 23) {
      const down = (h - 19) + min / 60;
      base = 105 - down * 20;
    }
    loadForecastRows.push(`${dateStr} ${hh}:${mm}:00,${base.toFixed(2)}`);
  }

  // 4. BESS_forecast.csv (24 rows, 1h step)
  const bessForecastRows = ['timestamp,planned_power_kw,target_soc_percent'];
  const bessPlan = (state && state.planningBess && state.planningBess.length === 24)
    ? state.planningBess
    : DEFAULT_BESS_PLAN;
  let soc = 45;
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const p = bessPlan[h];
    soc = Math.min(95, Math.max(10, soc - (p * 1.0) / 400 * 100));
    bessForecastRows.push(`${dateStr} ${hh}:00:00,${p.toFixed(1)},${soc.toFixed(1)}`);
  }

  // 5. PV_measures.csv (1440 rows, 1 min step)
  const pvMeasuresRows = ['timestamp,pv_measured_kw'];
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let power = 0;
    if (m >= 360 && m <= 1260) {
      const fracHour = m / 60;
      const angle = ((fracHour - 6) / 14) * Math.PI;
      const clearSky = Math.sin(angle) * 224;

      // Realistic cloud passage at 10:45 - 11:35 and small dip at 13:40
      let cloud = 1.0;
      if (m >= 645 && m <= 700) {
        cloud = 0.32 + 0.18 * Math.cos(((m - 670) / 55) * Math.PI);
      } else if (m >= 810 && m <= 845) {
        cloud = 0.58 + 0.22 * Math.sin((m / 5) * 0.8);
      }
      const noise = (Math.sin(m * 12.3) * 0.035) + (Math.cos(m * 7.7) * 0.025);
      power = Math.max(0, clearSky * cloud * (1 + noise));
    }
    pvMeasuresRows.push(`${dateStr} ${hh}:${mm}:00,${power.toFixed(2)}`);
  }

  // 6. LOAD_measure.csv (1440 rows, 1 min step)
  const loadMeasureRows = ['timestamp,load_measured_kw'];
  for (let m = 0; m < 1440; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const hh = String(h).padStart(2, '0');
    const mm = String(min).padStart(2, '0');

    let base = 35;
    if (h >= 6 && h < 19) {
      const progress = (h - 6) + min / 60;
      base = 42 + 70 * (1 / (1 + Math.exp(-(progress - 1.5) * 2)));
      if (h >= 12 && h < 14) {
        base -= 24 * Math.sin(((progress - 6) / 2) * Math.PI);
      } else if (h >= 14 && h < 17) {
        base += 18 * Math.sin(((progress - 8) / 3) * Math.PI);
      }
    } else if (h >= 19 && h < 23) {
      const down = (h - 19) + min / 60;
      base = 105 - down * 20;
    }

    // Industrial spikes & motor cycles
    const compressor = (m % 20 < 8) && (h >= 7 && h <= 18) ? 16 : 0;
    const peakMotor = (m % 110 === 22 || m % 110 === 23) && (h >= 8 && h <= 17) ? 26 : 0;
    const noise = (Math.sin(m * 3.14) * 3.4) + (Math.cos(m * 1.6) * 2.2);

    const actual = Math.max(26, base + compressor + peakMotor + noise);
    loadMeasureRows.push(`${dateStr} ${hh}:${mm}:00,${actual.toFixed(2)}`);
  }

  return {
    GRID_forecast: gridRows.join('\n'),
    PV_forecast: pvForecastRows.join('\n'),
    BESS_forecast: bessForecastRows.join('\n'),
    LOAD_forecast: loadForecastRows.join('\n'),
    PV_measures: pvMeasuresRows.join('\n'),
    LOAD_measure: loadMeasureRows.join('\n'),
  };
}

/**
 * Extract time to minute-of-day (0 to 1439)
 */
function parseTimeToMinutes(ts) {
  if (!ts) return 0;
  const match = String(ts).match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  }
  return 0;
}

/**
 * Resamples raw data series into a continuous 1440-point minute array
 */
