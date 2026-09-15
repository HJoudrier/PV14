"""Scenarios de charge : residentiel, industriel, eco-parc, tertiaire, recharge VE, quartier.

Chaque scenario definit deux jeux d'ancres horaires :
  * `forecast` : le profil type utilise par le previsionniste (pas horaire en sortie) ;
  * `real`     : le profil effectivement realise (decalage d'horaire, amplitude
    differente), sur lequel viennent se greffer les phenomenes fins visibles
    seulement a la minute (cycles de compresseurs, demarrages moteurs, sessions
    de recharge, eclairage public, arret non planifie...).

La prevision n'est donc jamais la moyenne horaire de la mesure : l'ecart contient
une erreur de forme (structurelle) et une variabilite haute frequence.
"""

from gen_common import (MINUTES_PER_DAY, hourly_means, ou_noise, smooth_from_hourly,
                        summarize, write_hourly_csv, write_minute_csv)


# --------------------------------------------------------------------------
# Briques d'evenements a la minute
# --------------------------------------------------------------------------

def add_cycling(series, rng, power, on_minutes, off_minutes, window, jitter=0.18):
    """Ajoute un equipement en marche/arret cyclique (compresseur, groupe froid, PAC)."""
    minute = window[0] + rng.randint(0, on_minutes + off_minutes)
    while minute < window[1]:
        duration = max(2, int(on_minutes * rng.uniform(1 - jitter, 1 + jitter)))
        level = power * rng.uniform(0.92, 1.08)
        for k in range(duration):
            if window[0] <= minute + k < min(window[1], MINUTES_PER_DAY):
                series[minute + k] += level
        minute += duration + max(2, int(off_minutes * rng.uniform(1 - jitter, 1 + jitter)))


def add_spikes(series, rng, window, count, power_range, duration_range):
    """Ajoute des appels de puissance brefs (demarrage moteur, four, bouilloire, ascenseur)."""
    for _ in range(count):
        start = rng.randint(window[0], max(window[0], window[1] - 1))
        duration = rng.randint(*duration_range)
        level = rng.uniform(*power_range)
        for k in range(duration):
            if 0 <= start + k < MINUTES_PER_DAY:
                series[start + k] += level


def add_step(series, power, start, end):
    """Ajoute un palier constant (eclairage public, enseignes) avec bouclage minuit."""
    for minute in range(MINUTES_PER_DAY):
        inside = (start <= minute < end) if start < end else (minute >= start or minute < end)
        if inside:
            series[minute] += power


def apply_outage(series, start, duration, level):
    """Force la puissance a un niveau de repli (arret de ligne, coupure d'atelier)."""
    for k in range(duration):
        if 0 <= start + k < MINUTES_PER_DAY:
            series[start + k] = level


def ev_sessions(rng, shape_1min, mean_arrival_gap=6.0, site_limit=180.0):
    """Reconstitue une journee de recharge sous forme de sessions discretes.

    Le taux d'arrivee suit la forme du profil previsionnel, mais la puissance
    appelee est une somme de creneaux (7,4 / 22 / 50 / 150 kW) : la mesure est
    donc en marches d'escalier la ou la prevision est lisse. Les sessions se
    repartissent comme sur une station publique reelle (majorite de charges AC
    lentes, quelques charges rapides, rares charges ultra-rapides), et un
    gestionnaire d'energie brides le site a `site_limit`.
    """
    fleet = {
        'AC': {'connectors': [7.4, 7.4, 7.4, 22.0, 22.0, 22.0], 'share': 0.58,
               'duration': (60, 240)},
        'DC': {'connectors': [50.0, 50.0, 50.0], 'share': 0.30, 'duration': (18, 48)},
        'HPC': {'connectors': [150.0, 150.0], 'share': 0.12, 'duration': (12, 28)},
    }
    kinds = list(fleet)
    weights = [fleet[k]['share'] for k in kinds]
    busy_until = {k: [0] * len(fleet[k]['connectors']) for k in kinds}
    power = [0.0] * MINUTES_PER_DAY
    hpc_active = [False] * MINUTES_PER_DAY
    peak = max(shape_1min)

    minute = 0
    while minute < MINUTES_PER_DAY:
        intensity = max(0.04, shape_1min[minute] / peak)
        minute += max(1, int(rng.expovariate(intensity / mean_arrival_gap)))
        if minute >= MINUTES_PER_DAY:
            break
        kind = rng.choices(kinds, weights)[0]
        free = [i for i, until in enumerate(busy_until[kind]) if until <= minute]
        if not free:
            continue                             # tous les points occupes : depart du client
        index = rng.choice(free)
        p_max = fleet[kind]['connectors'][index]
        duration = rng.randint(*fleet[kind]['duration'])
        busy_until[kind][index] = minute + duration + rng.randint(2, 9)
        for k in range(duration):
            slot = minute + k
            if slot >= MINUTES_PER_DAY:
                break
            fraction = k / duration
            level = p_max * 0.45 if fraction < 0.03 else p_max
            if fraction > 0.70:                  # passage en tension constante
                level = p_max * (1 - 0.75 * (fraction - 0.70) / 0.30)
            power[slot] += level * rng.uniform(0.93, 1.0)
            if kind == 'HPC':
                hpc_active[slot] = True

    # Auxiliaires du site + refroidissement des armoires HPC, puis bridage par le
    # gestionnaire d'energie (avec sa bande de regulation de l'ordre du kW).
    ripple = ou_noise(rng, MINUTES_PER_DAY, 0.35, 0.80)
    output = []
    for m in range(MINUTES_PER_DAY):
        value = power[m] + 4.2 + (6.0 if hpc_active[m] else 0.0)
        if value > site_limit - 1.0:
            value = site_limit - 1.0 + ripple[m]
        output.append(value)
    return output


# Intervalle moyen entre deux arrivees a l'heure de pointe (min). Cale pour que
# l'energie journaliere mesuree depasse la prevision d'environ 10 % : la
# frequentation reelle d'une station de recharge reste tres difficile a prevoir.
EV_MEAN_ARRIVAL_GAP_MIN = 16.3


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------

def _residential(rng, real):
    """~60 logements chauffes par pompes a chaleur, journee d'hiver de semaine."""
    add_cycling(real, rng, 12.0, 18, 24, (0, 560))          # PAC nuit + matin
    add_cycling(real, rng, 12.0, 20, 22, (1000, 1440))      # PAC soiree
    add_spikes(real, rng, (390, 560), 14, (6.0, 18.0), (3, 12))     # petit dejeuner
    add_spikes(real, rng, (1080, 1320), 18, (6.0, 16.0), (4, 26))   # repas, lave-linge
    noise = ou_noise(rng, MINUTES_PER_DAY, 1.4, 0.82)
    return [max(16.0, real[m] + noise[m]) for m in range(MINUTES_PER_DAY)]


def _industrial(rng, real):
    """Atelier en 2 postes 06:00-22:00, avec arret non planifie l'apres-midi."""
    add_cycling(real, rng, 22.0, 9, 11, (360, 1320))        # compresseur d'air
    add_spikes(real, rng, (420, 1300), 26, (22.0, 32.0), (1, 2))    # demarrages moteurs
    noise = ou_noise(rng, MINUTES_PER_DAY, 1.9, 0.85)
    series = [max(24.0, real[m] + noise[m]) for m in range(MINUTES_PER_DAY)]
    apply_outage(series, 862, 26, 38.0)                     # panne ligne 14:22 -> 14:48
    for k in range(10):                                     # redemarrage progressif
        series[888 + k] = 38.0 + (series[898] - 38.0) * (k + 1) / 10.0
    return series


def _eco_park(rng, real):
    """Parc d'activites : une dizaine de PME, groupes froid et services partages."""
    for phase in range(3):                                  # 3 groupes froid decales
        add_cycling(real, rng, 11.0, 16, 19, (330 + phase * 55, 1200))
    add_step(real, 8.5, 400, 1170)                          # eclairage des voiries
    add_spikes(real, rng, (420, 1140), 18, (5.0, 12.0), (2, 8))
    noise = ou_noise(rng, MINUTES_PER_DAY, 1.6, 0.88)
    return [max(30.0, real[m] + noise[m]) for m in range(MINUTES_PER_DAY)]


def _tertiary(rng, real):
    """Immeuble de bureaux : CTA/groupe froid cycliques, salle serveurs continue."""
    add_cycling(real, rng, 28.0, 12, 9, (480, 1110))        # groupe froid
    add_step(real, 11.0, 420, 1150)                         # eclairage + CTA base
    add_spikes(real, rng, (450, 1140), 30, (4.0, 8.0), (1, 3))      # ascenseurs
    noise = ou_noise(rng, MINUTES_PER_DAY, 1.1, 0.86)
    return [max(14.0, real[m] + noise[m]) for m in range(MINUTES_PER_DAY)]


def _district(rng, real):
    """Quartier mixte : logements, commerces, bureaux, eclairage public, bornes VE."""
    add_step(real, 14.0, 1270, 400)                         # eclairage public 21:10-06:40
    for phase in range(2):                                  # froid alimentaire commerces
        add_cycling(real, rng, 9.0, 14, 17, (360 + phase * 30, 1290))
    # recharges de VE au pied des immeubles
    add_spikes(real, rng, (1020, 1380), 12, (7.0, 15.0), (25, 120))
    add_spikes(real, rng, (400, 1300), 24, (5.0, 14.0), (2, 10))
    noise = ou_noise(rng, MINUTES_PER_DAY, 2.4, 0.87)
    return [max(30.0, real[m] + noise[m]) for m in range(MINUTES_PER_DAY)]


def _ev_station(rng, real):
    """Station de recharge : la mesure est reconstruite session par session."""
    return ev_sessions(rng, real, mean_arrival_gap=EV_MEAN_ARRIVAL_GAP_MIN)



SCENARIOS = {
    'residentiel': {
        'label': 'Quartier residentiel ~60 logements (jour de semaine, hiver)',
        'date': '2026-01-15', 'seed': 101, 'builder': _residential,
        'forecast': [28, 25, 23, 22, 23, 28, 42, 62, 70, 58, 48, 52,
                     58, 50, 46, 48, 56, 72, 98, 115, 108, 86, 58, 38],
        'real': [23.8, 21.9, 20.1, 19.2, 21, 28.3, 43.9, 60.4, 60.4,
                 49.4, 42.1, 45.7, 54.9, 47.6, 40.2, 42.1, 53, 69.5,
                 95.1, 110.7, 103.3, 80.5, 51.2, 32],
    },
    'industriel': {
        'label': 'Site industriel en 2 postes 06:00-22:00',
        'date': '2026-03-12', 'seed': 102, 'builder': _industrial,
        'forecast': [32, 30, 30, 30, 31, 44, 98, 132, 138, 140, 142, 134,
                     116, 130, 140, 138, 132, 126, 118, 94, 70, 62, 42, 34],
        'real': [28.2, 27.3, 26.4, 26.4, 27.3, 34.6, 74.7, 116.6, 128.5,
                 131.2, 133, 125.7, 102, 114.8, 130.3, 129.4, 123.9,
                 118.4, 111.2, 90.2, 67.4, 54.7, 36.4, 30.1],
    },
    'eco_park': {
        'label': 'Eco-parc d\'activites (PME, services partages)',
        'date': '2026-03-12', 'seed': 103, 'builder': _eco_park,
        'forecast': [40, 38, 37, 37, 38, 46, 64, 90, 120, 132, 138, 140,
                     134, 128, 132, 136, 128, 110, 86, 68, 58, 52, 46, 42],
        'real': [32.5, 30.8, 30, 30, 30.8, 35.8, 48.3, 69.9, 93.2, 104.9,
                 110.7, 113.2, 108.2, 104.9, 110.7, 115.7, 109.9, 94.9,
                 73.2, 57.4, 47.4, 42.4, 37.4, 34.1],
    },
    'tertiaire': {
        'label': 'Immeuble de bureaux (tertiaire, 08:00-18:00)',
        'date': '2026-03-12', 'seed': 104, 'builder': _tertiary,
        'forecast': [22, 20, 19, 19, 20, 26, 40, 74, 104, 112, 116, 112,
                     94, 104, 114, 116, 108, 88, 56, 36, 29, 26, 24, 22],
        'real': [18.2, 17.4, 16.5, 16.5, 20.8, 33, 48.6, 71.2, 92.1,
                 95.6, 97.3, 93.8, 74.7, 86.9, 97.3, 99.9, 90.3, 67.8,
                 38.2, 27.8, 23.5, 21.7, 20, 18.2],
    },
    'recharge_ve': {
        'label': 'Station de recharge VE (2x150 kW + 3x50 kW + 6 bornes AC)',
        'date': '2026-03-12', 'seed': 105, 'builder': _ev_station,
        'forecast': [10, 8, 6, 6, 8, 15, 34, 52, 60, 55, 48, 52,
                     66, 72, 66, 58, 62, 78, 96, 88, 64, 44, 28, 16],
        # Seule exception : ici `real` ne sert que de forme pour le taux
        # d'arrivee des vehicules, la puissance mesuree etant entierement
        # reconstruite session par session. Il est donc egal a `forecast`.
        'real': [10, 8, 6, 6, 8, 15, 34, 52, 60, 55, 48, 52, 66, 72, 66,
                 58, 62, 78, 96, 88, 64, 44, 28, 16],
    },
    'quartier': {
        'label': 'Quartier mixte (logements, commerces, bureaux, VE)',
        'date': '2026-02-05', 'seed': 106, 'builder': _district,
        'forecast': [52, 46, 42, 40, 42, 52, 74, 98, 112, 104, 98, 104,
                     110, 102, 96, 100, 110, 128, 150, 156, 140, 114, 84, 62],
        'real': [42.6, 38.4, 34.9, 33.2, 35.8, 47.7, 68.2, 86.9, 93.8,
                 85.2, 81, 86.1, 92, 85.2, 79.3, 84.4, 97.2, 115.9,
                 134.7, 127, 112.5, 92, 68.2, 50.3],
    },
}


def generate(rng_factory):
    """Ecrit les 12 fichiers de charge et retourne les lignes de recapitulatif."""
    rows = []
    for key, spec in SCENARIOS.items():
        rng = rng_factory(spec['seed'])
        forecast_1min = smooth_from_hourly(spec['forecast'])
        # Les ancres `real` sont volontairement sous le profil previsionnel : les
        # evenements a la minute ne font qu'ajouter de la puissance, et sans cela
        # l'energie mesuree deriverait de 15 a 25 % au-dessus de la prevision.
        measured_1min = spec['builder'](rng, smooth_from_hourly(spec['real']))

        write_hourly_csv('load/LOAD_forecast_%s.csv' % key, 'timestamp,load_power_kw',
                         spec['date'], [['%.1f' % v for v in hourly_means(forecast_1min)]])
        write_minute_csv('load/LOAD_measure_%s.csv' % key, 'timestamp,load_measured_kw',
                         spec['date'], measured_1min)

        label = spec['label']
        rows.append(summarize('LOAD_forecast_%s.csv | %s' % (key, label), forecast_1min))
        rows.append(summarize('LOAD_measure_%s.csv | %s' % (key, label), measured_1min))
    return rows
