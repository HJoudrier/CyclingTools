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

### Le HUD en deux parties (le coureur en haut, l'effort en bas)

En haut, le nom du coureur actif avec ◀ ▶, puis puissance, vitesse, FC. En bas, entre Freiner et Accélérer, l'effort et les barres **Aérobie** (vert)
et **Anaérobie** (rouge).

| Fichier | Contenu |
| --- | --- |
| `proposition-d.png` / `.html` | **D — Haut et bas** : barre du haut centrée ; en bas, la barre d'effort, l'aspiration, Aérobie et Anaérobie ; le centre reste dégagé |
| `proposition-e.png` / `.html` | **E — Cadran** : l'effort en demi-cercle (compte-tours, aiguille, zone rouge au-delà de 100 %), Aérobie et Anaérobie en arcs autour |
| `proposition-f.png` / `.html` | **F — Barres aux pouces** : onglet suspendu en haut ; Aérobie en jauge verticale contre Freiner, Anaérobie contre Accélérer |

### Pour l'immersion

| Fichier | Contenu |
| --- | --- |
| `proposition-g.png` / `.html` | **G — Retransmission TV** : caméra TV, logo et « en direct », bandeau de l'échappée, pastille de nom au-dessus du coureur, bandeau de nom en bas, encart « capteurs » |
| `proposition-h.png` / `.html` | **H — Vue cycliste, compteur au guidon** : pas de HUD ; les chiffres sur le compteur du guidon, l'effort et Aérobie / Anaérobie en diodes, levier gauche pour freiner, cocotte droite pour accélérer |
| `proposition-i.png` / `.html` | **I — Sensations** : bords de l'écran vert (aérobie) et rouge qui pulse au rythme du cœur (anaérobie), FC dans un cœur, marqueurs des coéquipiers dans la scène, actions en cercle sous le doigt (appui long) |

Chaque page montre l'écran en course et un second état : le menu d'actions, la liste de l'équipe, le tiroir ou le menu en cercle.

- **Fonds :** de vraies captures de la vue 3D (Chromium, 844 × 390 à 2×) :
  - `fond.jpg` : caméra de poursuite ;
  - `fond-large.jpg` : caméra large ;
  - `fond-tv.jpg` : caméra TV ;
  - `fond-cycliste.jpg` : vue du cycliste.
- **Chevrons :** dessinés en perspective sur chacune de ces routes, par `maquettes.js` (`VIEWS`).
- **Réseau :** les pages s'ouvrent sans réseau.
- **Captures :** les PNG sont capturés à 2× la résolution.
- **Valeurs :** celles d'une même course fictive (`maquettes.js`).
