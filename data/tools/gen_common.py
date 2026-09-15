"""Briques communes aux generateurs de jeux de donnees (soleil, lissage, bruit, CSV).

Tout est deterministe : chaque scenario utilise un `random.Random(seed)` dedie,
donc relancer le generateur reproduit exactement les memes fichiers.
"""

import math
import os
import random

MINUTES_PER_DAY = 1440

# Site PV de reference (coherent avec DEFAULT_PARAMS de js/01-state.js)
LATITUDE_DEG = 45.0          # ~ vallee du Rhone
LONGITUDE_DEG = 5.0          # est de Greenwich
PV_KWC = 250.0               # puissance crete DC installee
PV_AC_LIMIT_KW = 225.0       # limite onduleurs (ratio DC/AC = 1.11)
PV_TILT_DEG = 25.0           # inclinaison des modules
PV_AZIMUTH_DEG = 0.0         # plein sud

DATA_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


# --------------------------------------------------------------------------
# Geometrie solaire et modele de production PV
# --------------------------------------------------------------------------

def solar_angles(day_of_year, local_minute, utc_offset_h):
    """Elevation et azimut solaires (radians) pour une minute locale donnee.

    L'azimut est compte depuis le sud, positif vers l'ouest.
    """
    b = math.radians(360.0 / 365.0 * (day_of_year - 81))
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
    solar_minute = local_minute + 4.0 * (LONGITUDE_DEG - 15.0 * utc_offset_h) + eot
    omega = math.radians(15.0 * (solar_minute / 60.0 - 12.0))
    decl = math.radians(23.45 * math.sin(math.radians(360.0 / 365.0 * (284 + day_of_year))))
    phi = math.radians(LATITUDE_DEG)

    sin_alpha = (math.sin(phi) * math.sin(decl)
                 + math.cos(phi) * math.cos(decl) * math.cos(omega))
    alpha = math.asin(max(-1.0, min(1.0, sin_alpha)))

    cos_alpha = math.cos(alpha)
    if cos_alpha < 1e-6:
        return alpha, 0.0
    sin_az = math.cos(decl) * math.sin(omega) / cos_alpha
    cos_az = (math.sin(alpha) * math.sin(phi) - math.sin(decl)) / (cos_alpha * math.cos(phi))
    return alpha, math.atan2(sin_az, cos_az)


def poa_clear_sky(alpha, azimuth, day_of_year, albedo=0.2):
    """Irradiance ciel clair dans le plan des modules (W/m2), modele Hottel simplifie."""
    if alpha <= 0.015:
        return 0.0
    i0 = 1361.0 * (1 + 0.033 * math.cos(math.radians(360.0 * day_of_year / 365.0)))
    air_mass = 1.0 / max(math.sin(alpha), 0.03)
    dni = i0 * 0.72 ** (air_mass ** 0.678)
    dhi = 0.14 * dni * math.sin(alpha) + 12.0 * math.sin(alpha)

    tilt = math.radians(PV_TILT_DEG)
    panel_az = math.radians(PV_AZIMUTH_DEG)
    cos_theta = max(0.0, math.sin(alpha) * math.cos(tilt)
                    + math.cos(alpha) * math.sin(tilt) * math.cos(azimuth - panel_az))

    direct = dni * cos_theta
    diffuse = dhi * (1 + math.cos(tilt)) / 2.0
    reflected = (dni * math.sin(alpha) + dhi) * albedo * (1 - math.cos(tilt)) / 2.0
    return max(0.0, direct + diffuse + reflected)


def pv_ac_power_kw(poa_wm2, t_ambient_c, soiling=1.0):
    """Puissance AC injectee (kW) pour une irradiance plan modules et une temperature."""
    if poa_wm2 <= 1.0:
        return 0.0
    t_cell = t_ambient_c + poa_wm2 / 800.0 * 25.0          # NOCT 45 degC
    thermal = 1.0 - 0.0038 * (t_cell - 25.0)               # -0.38 %/degC
    p_dc = PV_KWC * (poa_wm2 / 1000.0) * thermal * soiling * 0.97   # cablage + mismatch
    if p_dc <= 0:
        return 0.0
    load_ratio = p_dc / PV_KWC
    eta_inv = 0.940 + 0.045 * min(1.0, load_ratio / 0.25) - 0.012 * load_ratio
    return min(PV_AC_LIMIT_KW, max(0.0, p_dc * eta_inv))


def ambient_temperature(t_min, t_max, minute):
    """Temperature ambiante sinusoidale, minimum vers 05:30 et maximum vers 16:00."""
    phase = (minute - 330) / MINUTES_PER_DAY * 2 * math.pi
    return (t_min + t_max) / 2.0 - (t_max - t_min) / 2.0 * math.cos(phase)


# --------------------------------------------------------------------------
# Lissage / interpolation
# --------------------------------------------------------------------------

def smooth_from_hourly(anchors):
    """Courbe 1 min continue passant par 24 ancres placees au milieu de chaque heure.

    Spline Catmull-Rom periodique : la moyenne horaire de la courbe obtenue reste
    tres proche de l'ancre correspondante, ce qui garde prevision horaire et
    courbe fine coherentes en energie.
    """
    n = len(anchors)
    out = []
    for minute in range(MINUTES_PER_DAY):
        x = (minute - 30) / 60.0
        i = math.floor(x)
        t = x - i
        p0 = anchors[(i - 1) % n]
        p1 = anchors[i % n]
        p2 = anchors[(i + 1) % n]
        p3 = anchors[(i + 2) % n]
        out.append(0.5 * (2 * p1
                          + (-p0 + p2) * t
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    return out


def hourly_means(series_1min):
    """Agrege une serie 1 min en 24 moyennes horaires (conservation de l'energie)."""
    return [sum(series_1min[h * 60:(h + 1) * 60]) / 60.0 for h in range(24)]


def ou_noise(rng, count, sigma, persistence=0.90):
    """Bruit auto-correle (processus AR(1)) : plus realiste qu'un bruit blanc."""
    out = []
    value = 0.0
    for _ in range(count):
        value = persistence * value + rng.gauss(0.0, sigma)
        out.append(value)
    return out


def time_shift(series, minutes):
    """Decale une serie dans le temps (positif = plus tard), avec bouclage sur 24 h."""
    n = len(series)
    return [series[(i - minutes) % n] for i in range(n)]


# --------------------------------------------------------------------------
# Ecriture CSV
# --------------------------------------------------------------------------

def _timestamp(date_str, minute):
    return '%s %02d:%02d:00' % (date_str, minute // 60, minute % 60)


def write_hourly_csv(path, header, date_str, columns):
    """Ecrit 24 lignes (pas horaire). `columns` = liste de listes de 24 valeurs formatees."""
    lines = [header]
    for h in range(24):
        values = [col[h] for col in columns]
        lines.append(','.join([_timestamp(date_str, h * 60)] + values))
    _write(path, lines)


def write_minute_csv(path, header, date_str, values, decimals=2):
    """Ecrit 1440 lignes (pas 1 min) pour une seule colonne de valeurs."""
    fmt = '%%.%df' % decimals
    lines = [header]
    for minute in range(MINUTES_PER_DAY):
        lines.append('%s,%s' % (_timestamp(date_str, minute), fmt % values[minute]))
    _write(path, lines)


def _write(path, lines):
    full = os.path.join(DATA_ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8', newline='\n') as handle:
        handle.write('\n'.join(lines) + '\n')


def summarize(label, values_1min, unit='kWh'):
    """Retourne (libelle, energie journaliere, puissance max) pour le recapitulatif."""
    energy = sum(values_1min) / 60.0
    return (label, energy, max(values_1min), unit)
