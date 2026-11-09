# Compteur : maquettes d'une interface en plusieurs vues

Propositions pour découper l'écran de la sortie du compteur (Compteur/js/tab-ride.js, Commun/css/ride.css) en trois vues
entre lesquelles on bascule : **carte et guidage**, **puissance cible**, **athlète et sortie en cours**.

| Fichier | Contenu |
| --- | --- |
| `avant.png` | L'écran actuel (mode démo), pour comparer |
| `proposition-a.png` / `.html` | **A — Compteur GPS** : cases de données séparées par des filets, onglets en bas, thème clair |
| `proposition-b.png` / `.html` | **B — Immersif** : vues plein écran, thème sombre, la couleur du fond dit si l'on est dans la consigne |
| `proposition-c.png` / `.html` | **C — Bandeau fixe et panneau** : puissance, cardio et vitesse toujours visibles, panneau Carte · Cible · Corps |

Les pages HTML s'ouvrent sans réseau (la carte est un fond dessiné, `maquettes.js`) ; les PNG en sont la capture
(Chromium, 2× la résolution). Les valeurs sont celles d'une même sortie fictive (km 42,3 sur 100, cible 250 W).
