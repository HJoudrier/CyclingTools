# Virtual Ride 3D Réaliste — le monde réaliste 🏔️

La course de PaceYourRide dans un **monde 3D réaliste**, rendu dans le navigateur avec [three.js](https://threejs.org) (r185, WebGL 2), pour **PC et consoles de salon** : il exploite la carte graphique (ombres en cascade, éclairage physique, post-traitement HDR, des centaines de milliers de brins d'herbe, des forêts jusqu'à l'horizon). Il remplace le paysage cartoon de Bike3D sur l'écran de course de l'application **Virtual Ride 3D Réaliste** (`VirtualRide3DRealiste/`), avec **le même protocole** : PaceYourRide simule, ce monde montre.

**Le même monde que l'univers cartoon.** Le tracé (`B3D.Route`) et le paysage (`B3D.Landscape` : relief, rivières et ponts, lacs et mares, villages, champs, forêts, alpages, biomes) sont ceux de Bike3D, chargés depuis `VirtualRide3D/univers/js/` avec **la même graine** : tous les joueurs d'une course en direct roulent dans le même monde, et c'est le même monde que dans Virtual Ride 3D, rendu autrement.

## Ouvrir

- Dans le site : portail → **Virtual Ride 3D Réaliste** → choisir le parcours, l'athlète, le matériel (vitrine réaliste), la météo, puis **Démarrer** : l'écran de course `VirtualRide3DRealiste/course.html` montre ce monde (`monde/index.html?pyr`) par-dessus la carte, avec le HUD, la jauge, les tactiques et les classements de PaceYourRide. Le bouton ⧉ ouvre la vue dans une autre fenêtre (téléviseur, second écran), avec son compteur.
- Seul, en démonstration : `VirtualRide3DRealiste/monde/index.html` (servir la racine du dépôt : `python3 -m http.server 8000`, puis `http://localhost:8000/VirtualRide3DRealiste/monde/`). Un parcours d'exemple de Bike3D et un peloton qui roule tout seul ; ↑ ↓ la puissance, ← → la place sur la route, C la caméra.
- Page d'essai du pont (développement, non publiée) : `monde/tools/essai-pont.html` joue le rôle de PaceYourRide (parcours d'exemple, peloton, météo et heure réglables, revêtements).

Il faut un navigateur récent avec **WebGL 2** (Chrome, Edge, Firefox, Safari ; le navigateur de la Xbox, Edge, convient) et une carte graphique. Les pages sont des **modules ES** : elles doivent être servies (pas d'ouverture par double-clic).

### Paramètres de l'adresse

| Paramètre | Effet |
| --- | --- |
| `q=moyenne`, `haute`, `ultra` | qualité graphique (gardée ensuite ; menu ⚙️ de la vue) |
| `scale=0.6` | résolution fixe (sinon adaptative, visant 60 images par seconde) |
| `stats=1` | images par seconde, appels de dessin, triangles |
| `cam=chase`, `tv`, `heli`, `rider`, `roadside`, `drone`, `auto` | caméra de départ |
| `demo=marmottes`, `hc`, `campagne` ; `seed=1234` ; `at=600` ; `n=24` | démonstration : parcours, graine, départ (m), nombre de coureurs |
| `hour=18.5`, `doy=196`, `wx=pluie` (`nuageux`, `couvert`, `orage`, `neige`) | démonstration : heure, jour de l'année, temps |
| `frame=tt&wheels=disc&position=tt_pro&sex=f…` | démonstration et vitrine : l'équipement |

## Commandes

| Clavier | Manette (API Gamepad, disposition standard) | Action |
| --- | --- | --- |
| ↑ ↓ (Maj : ±50 W) | gâchettes droite / gauche (plus on appuie, plus ça monte vite) ; croix ↑ ↓ (LB : ±50 W) | puissance demandée |
| ← → | croix ← → | changer de place sur la route |
| 1 … 9, S | RB (tactique suivante), A (sprint) | tactiques |
| 0 | B | roue libre |
| M, B, R | X, L3, R3 | manger, boire, ravitaillement |
| A | Vue (Back) | pilote automatique |
| Espace | Menu (Start) | pause |
| C (ou un toucher sur la vue) | Y | caméra : poursuite, moto TV, hélicoptère, vue cycliste, bord de route, drone, réalisation automatique |
| F | | plein écran |

Les touches et les boutons de la manette sont renvoyés au jeu exactement comme les touches du clavier de l'écran de course.

## Ce qu'on voit

- **Ciel et lumière** (`js/atmosphere.js`, `js/astro.js`) : un modèle d'atmosphère physique (diffusion de Rayleigh et de Mie, absorption de l'ozone, diffusion multiple approchée), intégré par la carte graphique dans une table direction → luminance, recalculée quand le soleil bouge. Le **soleil et la lune** sont à leur vraie place : latitude et longitude du parcours, jour de l'année (celui de la météo datée de PaceYourRide, sinon la saison du paysage) et heure locale (fuseau et heure d'été) ; la lune a ses phases. La lumière directe prend la couleur que lui laisse l'atmosphère (rouge au coucher) ; l'éclairage ambiant vient d'une carte d'environnement calculée sur ce ciel et le sol. Étoiles la nuit (l'œil s'adapte jusqu'à ×12 : la nuit reste sombre, éclairée par la lune, les fenêtres des villages et le **phare** du joueur), **couche nuageuse** animée par le vent (bord argenté à contre-jour), **ombres des nuages** qui défilent au sol, **éclairs** et tonnerre.
- **Rendu** (`js/engine.js`) : rendu HDR (demi-flottants) avec antialiasing multi-échantillons, **ombres en cascade** (nettes au pied du coureur, jusqu'à un kilomètre et plus), **occlusion ambiante** (GTAO), **perspective atmosphérique** (brouillard de hauteur coloré par le ciel dans la direction regardée, halo du soleil), **halo lumineux** des hautes lumières, **exposition automatique** (l'œil s'adapte au sous-bois, au plein soleil, à la nuit), courbe de tons ACES, étalonnage, vignettage, grain léger.
- **Terrain** (`js/terrain.js`, `js/terrain-worker.js`) : calculé dans des fils à part (Web Workers) en trois niveaux de détail (2 m, 8 m, 32 m entre les sommets) jusqu'à 5 à 10 km ; au-delà de la zone que Bike3D sait calculer, un **champ lointain** prolonge le relief (altitude de la route diffusée, distance à la route, grandes montagnes à l'horizon des parcours de montagne). Huit sols (herbe, herbe sèche, sous-bois, terre, roche, neige, gravier, boue) mélangés selon la hauteur de leurs textures, la roche plaquée sur trois axes dans les pentes, sillons et rangs des champs (labours, vignes, lavande, tournesols), sol qui fonce et brille sous la pluie, neige sur les faces tournées vers le ciel.
- **Textures** (`js/textures.js`) : aucune image ; toutes sont **calculées par la carte graphique** au chargement (bruits périodiques, cellules de Voronoï) : albédo, hauteur, normale, rugosité et occlusion de l'herbe, de la roche, de l'enrobé, des pavés, du chemin blanc, des écorces, des enduits, des moellons, des tuiles et des ardoises.
- **Route** (`js/road.js`) : axe lissé (spline) pour des lacets ronds, chaussée bombée avec accotements, **revêtements de PaceYourRide** à leur largeur (enrobé neuf ou usé, pavés réguliers ou difficiles, chemin blanc, gravier, terre, herbe), marquages (rives, axe discontinu, continu dans les virages serrés), peinture usée, traces de roues, **chaussée mouillée** qui reflète le ciel, flaques, ondes des gouttes.
- **Végétation** (`js/foliage.js`, `js/vegetation.js`, `js/grass.js`) : feuillus, épicéas, pins, peupliers, bouleaux, cyprès, oliviers, arbres fruitiers, saules, buissons, rochers et bottes de foin, générés au chargement (trois variantes par espèce) ; **feuillage translucide** (la lumière traverse les feuilles à contre-jour), qui ondule au vent, aux **couleurs de la saison** (automne, arbres nus en hiver). Au loin, des **imposteurs** photographiés sous huit angles (couleur et normales) : un seul appel de dessin pour toute la forêt, qui porte son ombre. **Herbe en vraie géométrie** autour de la caméra (des centaines de milliers de brins), posée sur le relief, courbée par les rafales, piquée de fleurs.
- **Eau** (`js/water.js`) : lacs, mares et rivières, transparents sur les bords, reflet du ciel (Fresnel), vaguelettes au vent, courant, gouttes de pluie.
- **Villages et bord de route** (`js/roadside.js`) : maisons (enduit ou pierre, tuiles canal au Sud, ardoise au Nord et en montagne, fenêtres à volets, portes, cheminées, **fenêtres éclairées la nuit**), église et clocher, panneaux d'entrée et de sortie au nom du village, glissières sur poteaux, parapets et piles des ponts, bornes kilométriques ; arches gonflables de départ, d'arrivée, des sprints, des sommets (à pois) et du ravitaillement, flamme rouge, **barrières et public** dans le dernier kilomètre, aux sprints et au sommet des cols.
- **Coureurs** (`js/body.js`, `js/bike.js`, `js/riders.js`) : le **corps** est une seule surface continue, construite à partir d'un champ de distance (tête, cou, buste, fessiers, deltoïdes, biceps, quadriceps, mollets fondus entre eux), extraite en maillage et rattachée à un squelette de 15 os, avec casque ventilé (ou chrono), lunettes, chaussures et queue de cheval ; la tenue (manches, cuissard, chaussettes, gants, combinaison) se lit dans les zones du corps, aux couleurs du coureur (motifs d'équipe). Les poses (pédalage, danseuse, position recroquevillée en descente, prolongateurs) sont calculées os par os et rangées dans une texture : **un seul appel de dessin** anime tous les corps d'un modèle, ombres comprises ; trois niveaux de détail. Le **vélo** reprend les cotes des cadres de Bike3D (route alu, endurance, grimpeur, aéro, contre-la-montre, gravel, VTT, ville), en pièces : tubes profilés, fourche, cintre et cocottes, selle, pédalier, cassette, chaîne, freins à disque, roues à hauteur de jante avec rayons, lenticulaire, pneus à flanc beige ou crampons ; peinture vernie, carbone, alu. Le vélo s'incline dans les virages et suit la pente.
- **Météo** (`js/weather.js`) : pluie (traînées de gouttes autour de la caméra, éclairées par le ciel), neige qui tombe en tourbillonnant, chaussée qui se mouille puis sèche, neige qui blanchit peu à peu le paysage puis fond ; avec PaceYourRide, la pluie, la température, le vent et la chaussée mouillée viennent de la météo de la course.
- **Sons** (`js/sound.js`) : synthétisés (Web Audio) : vent, roulement selon le revêtement (pavés qui grondent, gravier qui crisse), roue libre, pluie, public, tonnerre.

## Qualités

| | Moyenne | Haute (défaut) | Ultra |
| --- | --- | --- | --- |
| Antialiasing | ×2 | ×4 | ×4 |
| Ombres | 3 cascades de 2048², 450 m | 4 de 2048², 800 m | 4 de 4096², 1 300 m |
| Occlusion ambiante | demi-résolution | demi-résolution | pleine résolution |
| Herbe | 26 m | 40 m | 55 m |
| Arbres complets / imposteurs | 70 m / 1,8 km | 110 m / 3 km | 170 m / 4,5 km |
| Terrain | 300 m / 1,2 km / 5 km | 420 m / 1,7 km / 7,5 km | 520 m / 2,2 km / 10 km |
| Textures | 1024² | 1024² | 2048² |

La **résolution adaptative** (case du menu ⚙️) baisse la résolution de rendu jusqu'à 60 % quand l'image tombe sous 52 images par seconde, et la remonte dès qu'elle le peut.

## Protocole avec PaceYourRide

Le même que l'univers cartoon (version 1, détaillé en tête de `js/bridge.js` et de `VirtualRide3D/univers/js/bridge.js`) : `course` (tracé, revêtements, points de passage, joueur et son équipement), `frame` à chaque image (position, vitesse, puissance, abri de chaque coureur ; météo à la position et à l'heure du joueur, avec le jour de l'année quand la météo est datée), `gear` (achat au magasin), `cmd` (caméra, son, autre paysage, compteur) ; en retour `hello`, `status` et `key`. Côté PaceYourRide, `Commun/js/jeu/view3d.js` choisit la vue selon l'application (`jeu3d` : l'univers cartoon ; `jeu3dr` : ce monde) ; une autre adresse peut être donnée par `localStorage.setItem('pyr.view3d.realiste', 'https://…/index.html')`.

La **vitrine** (`vitrine.html`, `js/vitrine.js`) reprend le protocole de la vitrine de Bike3D : la page de choix de Virtual Ride 3D Réaliste y règle le matériel (cadre, roues, pneus, position, casque, lunettes, tenue, chaussettes, chaussures) sur le vélo et le cycliste réalistes, dans un studio photo.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `index.html`, `css/monde.css` | la vue : chargement, annonces, compteur de la fenêtre à part, boutons, réglages |
| `js/main.js` | démarrage : moteur, monde, caméras, pilote (PaceYourRide ou démonstration), boucle |
| `js/engine.js` | rendu HDR, ombres en cascade, post-traitement, qualités, résolution adaptative |
| `js/atmosphere.js`, `js/astro.js` | ciel physique, soleil, lune, étoiles, nuages, lumière, carte d'environnement, brouillard ; positions des astres et saisons |
| `js/glsl.js`, `js/textures.js` | bruits GLSL ; textures procédurales calculées par la carte graphique |
| `js/world.js` | le monde d'un parcours (tracé et paysage de Bike3D, revêtements, secteurs) et ses systèmes |
| `js/terrain.js`, `js/terrain-worker.js` | tuiles de terrain et leur matériau ; calcul dans des fils à part, champ lointain, placement de la végétation |
| `js/road.js` | axe lissé, chaussée, revêtements et marquages |
| `js/foliage.js`, `js/vegetation.js`, `js/grass.js` | modèles d'arbres et atlas de feuillage ; instances et imposteurs ; herbe |
| `js/water.js` | lacs, mares, rivières |
| `js/roadside.js` | glissières, ponts, bornes, villages, arches, barrières, emplacements du public |
| `js/body.js`, `js/bike.js`, `js/riders.js` | corps (champ de distance, squelette, zones de la tenue) ; vélos ; coureurs et public (squelette sur la carte graphique, niveaux de détail) |
| `js/weather.js` | pluie, neige, sol mouillé ou enneigé |
| `js/cameras.js` | caméras de la course |
| `js/bridge.js`, `js/demo.js` | pilotes : PaceYourRide, démonstration |
| `js/input.js`, `js/sound.js` | manette ; sons |
| `vitrine.html`, `js/vitrine.js` | vitrine du matériel |
| `tools/essai-pont.html` | page d'essai du protocole (développement) |
| `vendor/three/` | three.js r185 (module, et les extensions utilisées : passes GTAO et halo, ombres en cascade, outils de géométrie, environnement de studio) |

Tests : `tests/realiste.test.js` (application dans le site, soleil et lune, saisons, pont, cotes des vélos identiques à Bike3D, corps et squelette, route lissée).

## Licences

Code sous licence GPL v3 (voir `LICENSE` à la racine). three.js est distribué sous licence MIT (`vendor/three/LICENSE`).
