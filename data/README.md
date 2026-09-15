# Jeux de données (PV, charge, prix réseau)

Jeux de données CSV prêts à importer dans l'application (onglet **Fichiers**).
Chaque scénario est une journée complète de 00:00 à 23:59.

| Dossier | Contenu | Fichiers |
| --- | --- | --- |
| [`pv/`](pv) | Production photovoltaïque — 3 journées types | 3 prévisions + 3 mesures |
| [`load/`](load) | Consommation — 6 types de sites | 6 prévisions + 6 mesures |
| [`grid/`](grid) | Prix de l'énergie et limite contractuelle — 3 contextes de marché | 3 prévisions |

## Conventions communes

* **Prévision : pas horaire** (24 lignes). C'est la donnée dont on dispose la
  veille : moyenne par heure, sans détail infra-horaire.
* **Mesure : pas 1 minute** (1440 lignes). C'est la télémétrie du site.
* **La mesure n'est jamais la prévision bruitée.** L'écart contient toujours
  deux composantes : une **erreur de forme** (nébulosité mal anticipée, horaire
  décalé, amplitude différente) et une **variabilité haute fréquence** invisible
  au pas horaire (passages de nuages, cycles de compresseurs, démarrages
  moteurs, sessions de recharge, arrêt non planifié…).
* Horodatage `AAAA-MM-JJ HH:MM:SS`, séparateur `,`, décimale `.`, encodage UTF-8,
  fin de ligne `\n`.
* En-têtes de colonnes identiques à ceux des jeux d'exemple embarqués
  (voir [`js/01-state.js`](../js/01-state.js)), donc directement importables :

| Fichier | Colonnes |
| --- | --- |
| `PV_forecast_*.csv` | `timestamp,pv_power_kw` |
| `PV_measures_*.csv` | `timestamp,pv_measured_kw` |
| `LOAD_forecast_*.csv` | `timestamp,load_power_kw` |
| `LOAD_measure_*.csv` | `timestamp,load_measured_kw` |
| `GRID_forecast_*.csv` | `timestamp,price_eur_per_mwh,contract_limit_kw` |

Le dimensionnement de référence est celui des paramètres par défaut de
l'application : **250 kWc** de PV (limite onduleurs 225 kW, inclinaison 25° plein
sud, latitude 45° N), **400 kWh / 150 kW** de batterie, **160 kW** de soutirage
contractuel et **120 kW** d'injection maximale.

## PV — 3 journées types

Production d'un générateur de 250 kWc. Modèle physique : position solaire,
irradiance ciel clair dans le plan des modules, dérive thermique des modules
(−0,38 %/°C), rendement onduleur variable, écrêtage à 225 kW.

| Scénario | Fichiers | Énergie prév. | Énergie mes. | Écart | P max mes. | Écart moyen (1 min) | Écart max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Été dégagé (21 juin) | `PV_forecast_ete` / `PV_measures_ete` | 1701 kWh | 1658 kWh | −2,5 % | 206 kW | 5,2 kW | 44 kW |
| Hiver, brouillard (15 déc.) | `PV_forecast_hiver` / `PV_measures_hiver` | 537 kWh | 564 kWh | +5,1 % | 128 kW | 6,0 kW | 52 kW |
| Nuageux, cumulus (14 avril) | `PV_forecast_nuageux` / `PV_measures_nuageux` | 858 kWh | 776 kWh | −9,5 % | 218 kW | 20,9 kW | 112 kW |

Ce que chaque scénario met en évidence :

* **Été** — journée facile : prévision fiable, un voile de cirrus non prévu
  entre 15:05 et 15:55 et une ombre portée brève en fin de journée. Le plafond
  de production reste sous les 225 kW à cause de la température de cellule
  (~62 °C à midi).
* **Hiver** — erreur de forme franche : le brouillard était annoncé pour se
  lever vers 09:30, il tient jusqu'à 11:10 (production très en dessous de la
  prévision le matin), puis le ciel se dégage complètement (production
  au-dessus de la prévision l'après-midi). Encrassement hivernal des modules.
* **Nuageux** — forte variabilité : alternance rapide éclaircies / cumulus, avec
  réhaussement de bord de nuage (production momentanément au-dessus du ciel
  clair). Rampes de plus de 100 kW en 3 minutes, alors que la prévision horaire
  est une courbe lisse à mi-hauteur. C'est le cas dimensionnant pour la réserve
  de puissance de la batterie.

## Charge — 6 types de sites

| Scénario | Fichiers | Énergie prév. | Énergie mes. | Écart | P max prév. | P max mes. | Écart moyen (1 min) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Résidentiel (~60 logements) | `LOAD_*_residentiel` | 1314 kWh | 1367 kWh | +4,0 % | 114 kW | 165 kW | 8,6 kW |
| Industriel (2 postes) | `LOAD_*_industriel` | 2183 kWh | 2117 kWh | −3,0 % | 142 kW | 183 kW | 11,4 kW |
| Éco-parc d'activités | `LOAD_*_eco_park` | 2040 kWh | 1999 kWh | −2,0 % | 140 kW | 163 kW | 9,5 kW |
| Tertiaire (bureaux) | `LOAD_*_tertiaire` | 1501 kWh | 1591 kWh | +6,0 % | 116 kW | 149 kW | 9,9 kW |
| Station de recharge VE | `LOAD_*_recharge_ve` | 1092 kWh | 1197 kWh | +9,6 % | 94 kW | 180 kW | 30,2 kW |
| Quartier mixte | `LOAD_*_quartier` | 2216 kWh | 2327 kWh | +5,0 % | 155 kW | 195 kW | 11,6 kW |

Ce que chaque scénario met en évidence :

* **Résidentiel** — journée d'hiver de semaine : double pointe matin / soir,
  pointe du soir réalisée plus tard et plus haute que prévu, cycles de pompes à
  chaleur et appels d'appareils domestiques (four, lave-linge, bouilloire).
* **Industriel** — plateau de production en 2 postes 06:00–22:00, compresseur
  d'air cyclique (+22 kW), appels de démarrage moteur de 1 minute, et un
  **arrêt non planifié de 14:22 à 14:48** totalement absent de la prévision.
* **Éco-parc** — une dizaine de PME : l'agrégation lisse la courbe (variabilité
  relative faible) mais trois groupes froid décalés et l'éclairage des voiries
  créent des paliers que la prévision horaire ne voit pas.
* **Tertiaire** — bureaux 08:00–18:00 : le préchauffage a démarré ~50 minutes
  plus tôt que prévu, creux de midi plus marqué, départ plus précoce le soir, et
  cycles de groupe froid (28 kW, 12 min marche / 9 min arrêt).
* **Station de recharge VE** — 2 × 150 kW + 3 × 50 kW + 6 bornes AC. La mesure
  est reconstituée **session par session** (arrivées aléatoires, créneaux
  7,4 / 22 / 50 / 150 kW, passage en tension constante en fin de charge) alors
  que la prévision est une courbe de fréquentation lisse : c'est le scénario au
  plus fort écart prévision / mesure (30 kW en moyenne, jusqu'à 162 kW). Le
  gestionnaire d'énergie bride le site à 180 kW, d'où les plateaux visibles aux
  heures de pointe.
* **Quartier mixte** — logements, commerces, bureaux, éclairage public
  (+14 kW de 21:10 à 06:40) et quelques recharges de VE en soirée. La pointe du
  soir mesurée (195 kW) dépasse le soutirage contractuel de 160 kW : cas d'usage
  typique d'écrêtage de pointe par la batterie.

## Prix réseau — 3 contextes

Fichiers de prévision uniquement (pas de contrepartie mesurée) : prix de
l'énergie et limite contractuelle de soutirage, tous deux au pas horaire.

| Scénario | Fichier | Prix moyen | Min | Max | Limite de soutirage |
| --- | --- | --- | --- | --- | --- |
| Spot hiver tendu | `GRID_forecast_spot_hiver_tendu` | 231 €/MWh | 96 €/MWh | 520 €/MWh | 160 kW, **140 kW de 17h à 20h** |
| Spot été | `GRID_forecast_spot_ete` | 49 €/MWh | **−22 €/MWh** | 138 €/MWh | 160 kW |
| Heures pleines / creuses | `GRID_forecast_hp_hc` | 150 €/MWh | 94 €/MWh | 245 €/MWh | 160 kW |

* **Spot hiver tendu** — pointe du matin (310 €/MWh à 08:00) et pointe du soir
  très marquée (520 €/MWh à 18:00), avec un abaissement de la limite
  contractuelle de 17h à 20h simulant un appel d'effacement. Fort intérêt à
  décharger la batterie le soir.
* **Spot été** — cannibalisation solaire : **prix négatifs de 11h à 15h**
  (jusqu'à −22 €/MWh), donc intérêt à soutirer / éviter d'injecter en milieu de
  journée, puis pointe du soir modérée à 138 €/MWh.
* **Heures pleines / creuses** — tarif à paliers, sans aléa : heures creuses
  94 €/MWh (00h–06h et 22h–24h), heures pleines 168 €/MWh, pointe 245 €/MWh
  (18h–20h). Prix médian 168 €/MWh : la stratégie *Arbitrage prix* de
  l'application charge en heures creuses et décharge pendant la pointe.

## Utilisation dans l'application

Un jeu complet = **5 fichiers** : 1 prévision PV + 1 mesure PV + 1 prévision
charge + 1 mesure charge + 1 fichier prix réseau. Les combinaisons sont libres
(par exemple `ete` + `recharge_ve` + `spot_ete`, ou `hiver` + `tertiaire` +
`spot_hiver_tendu`).

Deux façons de charger un jeu :

1. **Ligne par ligne** — bouton *Importer* de chaque ligne du tableau
   *Fichiers* : c'est la méthode sûre, le fichier va dans l'emplacement choisi
   quel que soit son nom.
2. **Glisser-déposer groupé** — la zone d'import multiple reconnaît les fichiers
   par leur nom (`grid_forecast`, `pv_forecast`, `pv_measure`, `load_forecast`,
   `load_measure`), ce que respectent les noms fournis ici. Ne déposez qu'**un
   seul fichier par emplacement à la fois** : deux `PV_forecast_*` déposés
   ensemble se disputeraient le même emplacement.

Le 6ᵉ fichier attendu par l'application, `BESS_forecast.csv` (planning de
pilotage de la batterie), n'est pas fourni ici : il est produit par l'onglet
*Planification* à partir du profil que vous y dessinez.

À noter : le tableau *Fichiers* annonce « 5 min » comme résolution attendue pour
la prévision de charge. Les prévisions fournies ici sont au pas horaire, comme
les autres prévisions ; l'application les interprète correctement (palier
horaire au rééchantillonnage à la minute).

## Régénérer les fichiers

```
python3 data/tools/generate_datasets.py
```

Aucune dépendance (bibliothèque standard Python 3 uniquement) et sortie
**déterministe** : chaque scénario a sa propre graine, deux exécutions
produisent des fichiers identiques au bit près. Les générateurs sont dans
[`tools/`](tools) : [`gen_common.py`](tools/gen_common.py) (position solaire,
modèle PV, lissage, bruit auto-corrélé, écriture CSV),
[`gen_pv.py`](tools/gen_pv.py), [`gen_load.py`](tools/gen_load.py) et
[`gen_grid.py`](tools/gen_grid.py). Pour ajouter un scénario, il suffit d'une
entrée dans le dictionnaire `SCENARIOS` du générateur concerné.
