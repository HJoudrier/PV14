#!/usr/bin/env python3
"""Genere tous les jeux de donnees CSV de data/ (PV, charge, prix reseau).

Usage :
    python3 data/tools/generate_datasets.py

Sortie deterministe : chaque scenario a sa propre graine, deux executions
produisent des fichiers identiques. Les fichiers sont ecrits dans
data/pv/, data/load/ et data/grid/ avec les memes en-tetes de colonnes que les
jeux de donnees embarques dans l'application (voir js/01-state.js), afin d'etre
importables directement via l'onglet "Fichiers".
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import gen_grid
import gen_load
import gen_pv


def rng_factory(seed):
    return random.Random(seed)


def main():
    rows = []
    rows += gen_pv.generate(rng_factory)
    rows += gen_load.generate(rng_factory)
    rows += gen_grid.generate()

    width = max(len(row[0]) for row in rows)
    print('%-*s %14s %12s' % (width, 'Fichier | Scenario', 'Energie/Moyenne', 'Maximum'))
    print('-' * (width + 28))
    for label, total, peak, unit in rows:
        if unit == 'kWh':
            print('%-*s %10.1f kWh %8.1f kW' % (width, label, total, peak))
        else:
            print('%-*s %8.1f EUR/MWh %5.1f EUR/MWh' % (width, label, total, peak))
    print('\n%d fichiers ecrits dans %s' % (len(rows), gen_pv.__name__ and 'data/'))


if __name__ == '__main__':
    main()
