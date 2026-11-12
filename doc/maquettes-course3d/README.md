# Course 3D sur téléphone : maquettes d'une interface en paysage

Propositions pour l'écran de jeu de Course 3D **sur téléphone, en paysage** (le HUD sur ordinateur ne change pas) :

- **Bas de l'écran :** **Freiner** à gauche, **Accélérer** à droite. Accélérer se tapote : chaque appui monte l'effort au-delà de la barre d'intensité, qui retombe en une seconde sans appui.
- **Au centre :** le **coureur actif** (nom, puissance, vitesse, FC), les **watts économisés par l'aspiration**, la barre d'effort (en % de la PC), l'endurance et l'effort court.
- **Flèches :** elles passent au coéquipier le plus proche devant ou derrière.
- **En haut à gauche :** un bouton **Équipe** (la liste des coureurs) et la bascule **Trajectoire** (auto ou manuelle).
- **En haut à droite :** le **menu d'actions** du coureur actif.
- **Sur la route :** les **chevrons de l'aide à la trajectoire**. Ils dessinent la trajectoire idéale et passent du vert au rouge quand il faut ralentir, avec la vitesse conseillée du virage.

| Fichier | Contenu |
| --- | --- |
| `avant.jpg` | L'écran actuel sur téléphone en paysage, pour comparer |
| `proposition-a.png` / `.html` | **A — Console de course** : gros boutons ronds aux coins (anneau d'Accélérer), HUD central en bas avec ◀ ▶, menu « ⚡ Actions » déroulant |
| `proposition-b.png` / `.html` | **B — Compteur au guidon** : jauges verticales sur les bords, compteur façon GPS au centre avec ▲ ▼, actions toujours visibles en icônes |
| `proposition-c.png` / `.html` | **C — Immersif minimal** : les quarts bas de l'écran sont les zones Freiner / Accélérer, ruban de données, tiroir d'actions depuis la droite |

Chaque page montre l'écran en course et un second état : le menu d'actions, la liste de l'équipe ou le tiroir.

- **Fond :** `fond.jpg`, une vraie capture de la vue 3D (Chromium, 844 × 390 à 2×).
- **Chevrons :** dessinés en perspective sur cette route, par `maquettes.js`.
- **Réseau :** les pages s'ouvrent sans réseau.
- **Captures :** les PNG sont capturés à 2× la résolution.
- **Valeurs :** celles d'une même course fictive (`maquettes.js`).
