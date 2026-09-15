"""Scenarios de production PV : journee d'ete, journee d'hiver, journee nuageuse.

Pour chaque scenario on construit deux series distinctes :
  * la prevision (pas horaire)  : ciel clair module par une nebulosite *lissee*,
    telle que la fournirait un modele meteo la veille au soir ;
  * la mesure (pas 1 min)       : le meme ciel clair module par une nebulosite
    *reelle* (passages de nuages, brouillard qui traine, effet de bord de nuage),
    avec encrassement des modules et bruit de capteur.

L'ecart prevision / mesure est donc physique, pas un simple bruit ajoute.
"""

import math

from gen_common import (MINUTES_PER_DAY, ambient_temperature, hourly_means, ou_noise,
                        poa_clear_sky, pv_ac_power_kw, smooth_from_hourly, solar_angles,
                        summarize, write_hourly_csv, write_minute_csv)


def _apply_cloud(factor, start, duration, depth, enhancement, ramp):
    """Superpose un nuage sur la serie de facteurs de nebulosite."""
    for k in (1, 2):
        before, after = start - k, start + duration + k - 1
        if 0 <= before < MINUTES_PER_DAY:
            factor[before] = max(factor[before], 1.0 + enhancement)
        if 0 <= after < MINUTES_PER_DAY:
            factor[after] = max(factor[after], 1.0 + enhancement)
    for k in range(duration):
        index = start + k
        if not 0 <= index < MINUTES_PER_DAY:
            continue
        if k < ramp:
            value = 1.0 - (1.0 - depth) * (k + 1) / (ramp + 1)
        elif k >= duration - ramp:
            value = 1.0 - (1.0 - depth) * (duration - k) / (ramp + 1)
        else:
            value = depth
        factor[index] = min(factor[index], value)


def _cloud_factor(rng, window, mean_gap, mean_duration, depth_range, enhancement, ramp=2):
    """Serie 1 min de facteurs de nebulosite generee par tirage de passages nuageux."""
    factor = [1.0] * MINUTES_PER_DAY
    minute = window[0]
    while minute < window[1]:
        minute += max(2, int(rng.expovariate(1.0 / mean_gap)))
        duration = max(2 * ramp + 1, int(rng.expovariate(1.0 / mean_duration)))
        _apply_cloud(factor, minute, duration, rng.uniform(*depth_range), enhancement, ramp)
        minute += duration
    return factor


def _clear_sky_poa(day_of_year, utc_offset_h):
    poa = []
    for minute in range(MINUTES_PER_DAY):
        alpha, azimuth = solar_angles(day_of_year, minute + 0.5, utc_offset_h)
        poa.append(poa_clear_sky(alpha, azimuth, day_of_year))
    return poa


def _series(poa, kc, t_min, t_max, soiling):
    return [pv_ac_power_kw(poa[m] * kc[m], ambient_temperature(t_min, t_max, m), soiling)
            for m in range(MINUTES_PER_DAY)]


# --------------------------------------------------------------------------
# Scenario 1 : journee d'ete degagee
# --------------------------------------------------------------------------

def _summer(rng):
    poa = _clear_sky_poa(172, 2)                 # 21 juin, UTC+2
    t_min, t_max = 17.0, 33.0

    # Prevision : ciel clair, legere brume de chaleur l'apres-midi.
    kc_forecast = smooth_from_hourly([0.99] * 10 + [0.98, 0.97, 0.96, 0.95, 0.95, 0.94]
                                     + [0.95] * 8)
    forecast = _series(poa, kc_forecast, t_min, t_max, soiling=0.99)

    # Mesure : voile de cirrus non prevu de 15:05 a 15:55, salissure estivale.
    noise = ou_noise(rng, MINUTES_PER_DAY, 0.006, 0.93)
    kc_measured = list(kc_forecast)
    for minute in range(905, 955):
        depth = 0.80 + 0.06 * math.sin((minute - 905) / 50.0 * math.pi)
        kc_measured[minute] *= depth
    for minute in range(1120, 1124):             # ombre portee (grue de chantier)
        kc_measured[minute] *= 0.88
    kc_measured = [max(0.02, min(1.10, kc_measured[m] * (1 + noise[m]) * 1.015))
                   for m in range(MINUTES_PER_DAY)]
    measured = _series(poa, kc_measured, t_min + 0.8, t_max + 1.2, soiling=0.975)
    return '2026-06-21', forecast, measured


# --------------------------------------------------------------------------
# Scenario 2 : journee d'hiver (brouillard matinal)
# --------------------------------------------------------------------------

def _winter(rng):
    poa = _clear_sky_poa(349, 1)                 # 15 decembre, UTC+1
    t_min, t_max = 0.0, 7.0

    # Prevision : brouillard donne pour se lever vers 09:30 puis ciel voile.
    kc_forecast = smooth_from_hourly([0.30] * 9 + [0.45, 0.68, 0.82, 0.85, 0.84, 0.78, 0.70]
                                     + [0.55] * 8)
    forecast = _series(poa, kc_forecast, t_min, t_max, soiling=0.94)

    # Mesure : le brouillard tient jusqu'a 11:10, puis ciel franchement degage
    # (donc production nettement sous la prevision le matin, au-dessus l'apres-midi).
    noise = ou_noise(rng, MINUTES_PER_DAY, 0.010, 0.95)
    kc_measured = []
    for minute in range(MINUTES_PER_DAY):
        if minute < 620:
            value = 0.17
        elif minute < 670:                       # dissipation progressive 10:20 -> 11:10
            value = 0.17 + 0.83 * (minute - 620) / 50.0
        else:
            value = 1.0
        kc_measured.append(value)
    cumulus = _cloud_factor(rng, (780, 1010), 90, 14, (0.45, 0.75), 0.04)
    kc_measured = [max(0.02, min(1.06, kc_measured[m] * cumulus[m] * (1 + noise[m])))
                   for m in range(MINUTES_PER_DAY)]
    measured = _series(poa, kc_measured, t_min - 1.0, t_max + 0.5, soiling=0.90)
    return '2026-12-15', forecast, measured


# --------------------------------------------------------------------------
# Scenario 3 : journee nuageuse (cumulus, forte variabilite)
# --------------------------------------------------------------------------

def _cloudy(rng):
    poa = _clear_sky_poa(104, 2)                 # 14 avril, UTC+2
    t_min, t_max = 9.0, 17.0

    # Prevision : le modele meteo ne restitue qu'une nebulosite moyenne lissee.
    kc_forecast = smooth_from_hourly([0.62, 0.62, 0.60, 0.60, 0.58, 0.56, 0.55, 0.54,
                                      0.52, 0.50, 0.48, 0.46, 0.45, 0.46, 0.48, 0.52,
                                      0.56, 0.60, 0.64, 0.66, 0.66, 0.64, 0.62, 0.62])
    forecast = _series(poa, kc_forecast, t_min, t_max, soiling=0.97)

    # Mesure : alternance rapide eclaircies / cumulus, avec rehaussement de bord
    # de nuage (kc > 1) juste avant chaque passage.
    noise = ou_noise(rng, MINUTES_PER_DAY, 0.012, 0.92)
    cumulus = _cloud_factor(rng, (330, 1290), 5, 15, (0.12, 0.38), 0.05)
    kc_measured = [max(0.02, min(1.06, 0.90 * cumulus[m] * (1 + noise[m])))
                   for m in range(MINUTES_PER_DAY)]
    measured = _series(poa, kc_measured, t_min, t_max, soiling=0.96)
    return '2026-04-14', forecast, measured


SCENARIOS = {
    'ete': ('Journee d\'ete degagee (21 juin)', _summer, 20260621),
    'hiver': ('Journee d\'hiver, brouillard matinal (15 decembre)', _winter, 20261215),
    'nuageux': ('Journee nuageuse, cumulus (14 avril)', _cloudy, 20260414),
}


def generate(rng_factory):
    """Ecrit les 6 fichiers PV et retourne les lignes de recapitulatif."""
    rows = []
    for key, (label, builder, seed) in SCENARIOS.items():
        date_str, forecast_1min, measured_1min = builder(rng_factory(seed))

        forecast_hourly = hourly_means(forecast_1min)
        write_hourly_csv('pv/PV_forecast_%s.csv' % key, 'timestamp,pv_power_kw', date_str,
                         [['%.1f' % v for v in forecast_hourly]])
        write_minute_csv('pv/PV_measures_%s.csv' % key, 'timestamp,pv_measured_kw', date_str,
                         measured_1min)

        rows.append(summarize('PV_forecast_%s.csv | %s' % (key, label), forecast_1min))
        rows.append(summarize('PV_measures_%s.csv | %s' % (key, label), measured_1min))
    return rows
