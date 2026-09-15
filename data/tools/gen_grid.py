"""Scenarios de prix reseau : spot hiver tendu, spot ete, tarif heures pleines / creuses.

Le fichier GRID est un fichier de prevision uniquement (pas de contrepartie
mesuree) : il porte le prix de l'energie et la limite contractuelle de
soutirage, tous deux au pas horaire.
"""

from gen_common import write_hourly_csv

# Prix en EUR/MWh, heure par heure (00:00 -> 23:00).
SCENARIOS = {
    'spot_hiver_tendu': {
        'label': 'Spot hiver tendu (pointe du soir a 520 EUR/MWh, effacement 17h-20h)',
        'date': '2026-01-15',
        'prices': [112, 104, 98, 96, 102, 128, 186, 265, 310, 268, 214, 196,
                   188, 192, 206, 248, 352, 468, 520, 436, 318, 232, 168, 132],
        # Limite de soutirage abaissee pendant l'appel d'effacement du soir.
        'limits': [160.0] * 17 + [140.0, 140.0, 140.0] + [160.0] * 4,
    },
    'spot_ete': {
        'label': 'Spot ete (prix negatifs en milieu de journee, pointe du soir moderee)',
        'date': '2026-06-21',
        'prices': [58, 49, 44, 42, 46, 58, 72, 64, 38, 18, 2, -12,
                   -22, -18, -4, 16, 42, 78, 112, 138, 124, 96, 74, 62],
        'limits': [160.0] * 24,
    },
    'hp_hc': {
        'label': 'Tarif heures pleines / heures creuses (+ pointe 18h-20h)',
        'date': '2026-03-12',
        # HC 00:00-06:00 et 22:00-24:00 = 94 ; HP = 168 ; pointe 18:00-20:00 = 245.
        'prices': [94] * 6 + [168] * 12 + [245, 245] + [168, 168] + [94, 94],
        'limits': [160.0] * 24,
    },
}


def generate():
    """Ecrit les 3 fichiers GRID et retourne les lignes de recapitulatif."""
    rows = []
    for key, spec in SCENARIOS.items():
        prices, limits = spec['prices'], spec['limits']
        assert len(prices) == 24 and len(limits) == 24, key
        write_hourly_csv('grid/GRID_forecast_%s.csv' % key,
                         'timestamp,price_eur_per_mwh,contract_limit_kw', spec['date'],
                         [['%.1f' % p for p in prices], ['%.1f' % l for l in limits]])
        average = sum(prices) / 24.0
        rows.append(('GRID_forecast_%s.csv | %s' % (key, spec['label']),
                     average, max(prices), 'EUR/MWh'))
    return rows
