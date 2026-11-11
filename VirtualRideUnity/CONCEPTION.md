# Wattlas en Unity — document de conception

Version native de la course 3D de Wattlas : un jeu installé, fait avec **Unity**, qui reprend la simulation de Wattlas (modèle mécanique, modèle physiologique, aspiration, peloton, tactiques, météo) et la montre dans un monde 3D plus abouti que les vues web.

Statut : proposition, novembre 2026. Rien n'est encore construit, sauf le générateur de vélos (`blender/velo_route.py`) et son script d'animation (`unity/VeloAnimation.cs`).

## 1. Cibles

| Cible | Rôle | Priorité |
| --- | --- | --- |
| **Meta Quest 3 et 3S, en autonome** | la cible qui fixe tous les budgets : processeur mobile, rendu en stéréo, 72 images/s minimum | 1 |
| **PC Windows** | même jeu, plus de détail ; écran ou casque VR relié au PC | 1 (développement, puis version à part entière) |
| **Xbox Series X\|S** | plus tard : il faut d'abord être accepté au programme **ID@Xbox** (accès au kit de développement de Microsoft, le GDK, et au module Xbox de Unity) | 3 |

Pas de compte ID@Xbox aujourd'hui : rien de spécifique à la Xbox n'est développé pour l'instant. Le jeu est seulement conçu pour qu'elle reste possible :

- tout se joue à la manette (Input System de Unity) ;
- aucune interface n'exige une souris ;
- le cœur du jeu (le domaine) n'utilise aucune API propre à Windows ou à Android ;
- on vise la Xbox Series S, la moins puissante.

Le Quest 2 n'est pas visé. On pourra l'essayer à la fin, en qualité réduite.

## 2. Choix techniques

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Moteur | **Unity 6.3 LTS** (maintenue jusqu'en décembre 2027) | version à support long, recommandée par Unity pour démarrer une production |
| Rendu | **URP** (Universal Render Pipeline), chemin *Forward* | le seul pipeline de Unity qui couvre Quest, PC et Xbox ; HDRP est trop lourd pour un casque autonome |
| Réalité virtuelle | **OpenXR** + *Unity OpenXR: Meta* + *XR Interaction Toolkit* | un seul code pour le Quest autonome et les casques PC ; menus et pointeurs fournis |
| Entrées | **Input System** | clavier, manette, contrôleurs VR avec les mêmes actions ; indispensable pour la Xbox |
| Modèles 3D | **glTF binaire (.glb)** importé par **glTFast** (`com.unity.cloud.gltfast`), FBX possible | format ouvert, sortie directe de Blender, axes sans ambiguïté |
| Route | paquet **Splines** de Unity | l'axe de la route se construit à partir du GPX |
| Langage du jeu | **C#** ; le domaine en C# « pur », sans `UnityEngine` | testable hors de Unity, portable, et même découpage que la cible hexagonale de Wattlas |
| Tests | **Unity Test Framework** (NUnit), en mode *EditMode* pour le domaine | rapides ; ils comparent le C# aux résultats du moteur JavaScript (§ 7) |
| Compilation Quest | Android, **IL2CPP**, ARM64, **Vulkan**, textures **ASTC**, couleurs linéaires | réglages recommandés par Meta et Unity pour le Quest |

## 3. Budgets de performance (Quest 3 / 3S)

### 3.1 Cadence et réglages

- **72 images/s garanties** (13,9 ms par image). On passe à 90 images/s seulement s'il reste de la marge.
- Rendu stéréo en une passe (*Single Pass Instanced* / multivue).
- **MSAA ×4**, pas de HDR, pas de post-traitement plein écran (ni bloom ni occlusion ambiante). Le ton du ciel et l'étalonnage sont calculés dans les shaders.
- **Rendu fovéal fixe** (*Fixed Foveated Rendering*) au niveau élevé : la périphérie de l'image est calculée en plus basse résolution.
- **Une seule lumière en temps réel** (le soleil), avec une seule cascade d'ombres limitée à 25–40 m. Plus loin, les coureurs ont une ombre « tache » sous les roues.
- Pas de transparence sur de grandes surfaces : la végétation est **opaque** (feuillage maillé), avec le découpage alpha seulement sur les cartes proches. C'est le premier risque de performance d'un monde rural en VR.
- **Brouillard** dans la couleur du ciel, qui permet d'arrêter la scène à 1,5–2 km.
- *Application SpaceWarp* (le casque fabrique une image sur deux) à garder en réserve : il demande des vecteurs de mouvement sur tous les shaders.

### 3.2 Budget par image

Meta donne pour le Quest 3/3S environ **1,3 à 1,8 million de triangles** par image, et **200 à 300 appels de dessin** pour une application dont la simulation est chargée. C'est notre cas : peloton, IA, physiologie, réseau. On se fixe une cible prudente : **1 million de triangles** et **250 appels de dessin**.

| Poste | Triangles | Appels de dessin |
| --- | ---: | ---: |
| Vélo du joueur (LOD0) et son cycliste | 50 000 | 12 |
| Peloton proche (< 15 m, 8 coureurs, LOD1) | 135 000 | 20 (dessin en lots) |
| Peloton lointain (15–80 m, 30 coureurs, LOD2) | 140 000 | 20 (dessin en lots) |
| Route et accotements (1,5 km devant) | 100 000 | 20 |
| Terrain (tuiles à niveaux de détail) | 250 000 | 30 |
| Végétation (arbres maillés proches, imposteurs au loin) | 200 000 | 40 |
| Villages, bord de route, public, arches | 100 000 | 40 |
| Ciel, eau, effets (poussière, pluie) | 20 000 | 10 |
| Interface VR (compteur, menus) | 5 000 | 15 |
| **Marge** | 0 | 43 |
| **Total** | **1 000 000** | **250** |

Ces chiffres sont des ordres de grandeur, pas des limites. On les vérifie **sur le casque** : profileur de Unity relié au Quest, *Frame Debugger*, OVR Metrics Tool. Avant de mesurer, on fixe les niveaux de processeur et de carte graphique, comme le recommande Meta.

### 3.3 Budget par modèle

| Modèle | LOD0 | LOD1 | LOD2 | Au-delà |
| --- | ---: | ---: | ---: | --- |
| **Vélo** (généré, mesuré) | 28 000 | 7 600 | 2 600 | caché à ~120 m |
| Cycliste (corps, tenue, casque) | 18 000 | 6 000 | 1 500 | imposteur |
| Spectateur | 3 000 | 1 000 | — | carte (*billboard*) |
| Arbre | 3 000–5 000 | 1 000 | — | imposteur (8 angles) |
| Maison | 2 000–5 000 | 1 000 | 200 | — |
| Voiture, moto de la caravane | 10 000 | 3 000 | 500 | — |

Le LOD0 du vélo n'est gardé que pour le vélo du joueur : il est sous ses yeux dans le casque (aperçu `blender/exemples/Velo_Aero_apercu_cycliste.jpg`). Tous les autres vélos commencent au LOD1.

### 3.4 Textures et matériaux

- **ASTC 6×6** par défaut, **4×4** pour le texte et l'interface.
- Taille maximale : 1024² pour un objet, 2048² pour un atlas de terrain.
- Un **matériau par modèle**, autant que possible :
  - palette de couleurs pour les objets « peints » (vélos, mobilier, bâtiments simples) ;
  - atlas pour le reste.
- Shaders : *URP/Simple Lit* ou un *Shader Graph* maison ; *URP/Lit* seulement pour ce qui est vu de près.
- **Peloton et couleurs d'équipe sans perdre le dessin en lots** : tous les vélos partagent les mêmes maillages et le même matériau. La couleur du maillot et du cadre est une propriété par instance, lue par un *Shader Graph* qui remplace la case `peinture` de la palette. Changer de texture par coureur casserait les lots.

### 3.5 Confort en VR

Rouler en VR, c'est avancer sans bouger : le mal des transports guette.

- **Jamais de secousse de caméra.** Les tremblements sur les pavés des vues web sont réservés à l'écran.
- **Jamais de roulis imposé** : l'horizon reste horizontal même quand le vélo penche en virage.
- La tête du joueur commande la caméra ; le jeu ne la tourne pas à sa place.
- Le vélo tourne dans les virages, et la vue tourne avec lui : virages adoucis, et **vignette** optionnelle (bords de l'image assombris) qui se resserre quand on tourne vite.
- Le tangage suit la pente, en douceur.
- Option « vue extérieure » : caméra de poursuite fixe, pour qui ne supporte pas la vue du cycliste.
- Pédaler pour de vrai, sur home-trainer, aide beaucoup : le corps sent l'effort qui va avec le mouvement.

## 4. Modèles 3D

### 4.1 D'où ils viennent

| Famille | Source | État |
| --- | --- | --- |
| **Vélos** | **générés** par `blender/velo_route.py` (paramétrique, mêmes identifiants que le magasin) | fait pour la route (6 cadres, 8 roues, 5 pneus) ; à faire : contre-la-montre, VTT, ville, crampons, logos |
| **Cyclistes** | **personnage de base** d'une bibliothèque, puis pédalage par cinématique inverse sur les ancres du vélo (§ 4.2) | à choisir |
| **Mobilier de route** (bornes, panneaux, barrières, arches, glissières, bottes de foin) | **générés** par des scripts Blender, comme le vélo : formes simples, paramétriques, palette | à faire |
| **Bâtiments** | kit modulaire (murs, toits, fenêtres) généré en Blender, assemblé dans Unity à partir de la graine du monde | à faire |
| **Arbres, rochers** | bibliothèque (Fab / Quixel Megascans, Unity Asset Store) ramenée au budget Quest ; imposteurs générés dans Unity | à choisir |
| **Petits objets variés** (voitures, motos, mobilier de village) | bibliothèques ou **générateurs IA** (Meshy, Tripo, Hyper3D Rodin), toujours repris dans Blender (§ 4.4) | au cas par cas |
| **Route et terrain** | **calculés dans le jeu** à partir du GPX et de la graine du monde (pas de fichier de modèle) | à porter (§ 7) |

Vérifier la licence de tout ce qui vient d'une bibliothèque ou d'un générateur : usage commercial, attribution (CC-BY), redistribution dans un jeu.

### 4.2 Le cycliste

Il faut un personnage **détaillé** et **animé par la simulation**, pas une animation en boucle.

1. **Corps** : un personnage humanoïde riggé, en deux morphologies (homme et femme) comme dans les vues web, de 18 000 triangles au plus au LOD0.
   - Pistes : un pack de l'Asset Store, ou un personnage créé dans un logiciel de création de personnages dont la licence permet l'usage dans un jeu.
   - À vérifier avant de choisir : le nombre de triangles, le squelette compatible *Humanoid* de Unity, les niveaux de détail.
2. **Tenue** : maillot, cuissard, combinaison, casque, lunettes, chaussures. Ce sont des maillages par-dessus le corps, ou des zones peintes dans une texture masque (comme `body.js` de la vue réaliste). Les couleurs d'équipe viennent d'une propriété par instance (§ 3.4).
3. **Pédalage** : cinématique inverse (paquet *Animation Rigging*, contrainte *Two Bone IK*).
   - **Pieds** sur `Ancre_PiedD` et `Ancre_PiedG`, qui tournent avec les pédales ; genoux orientés vers l'avant.
   - **Bassin** posé sur `Ancre_Selle`.
   - **Mains** sur les ancres de la position du magasin : `Ancre_MainD/G_Cocotte`, `_Bas` ou `_Haut`.
   - **Buste** penché selon la position (même table que `POSITIONS` de `bike.js`).
   - **Danseuse** : bassin relevé et vélo qui se balance.

   C'est ce que font déjà les vues web : il n'y a aucun clip d'animation à produire pour pédaler.
4. **Niveaux de détail** : au LOD2, la cinématique inverse est coupée (pose figée qui tourne avec le pédalier) ; au-delà, imposteur.

### 4.3 Conventions communes

Ce sont celles du générateur de vélos (voir [`README.md`](README.md)) :

- 1 unité = 1 m ; axes de Unity : +Z devant, Y en haut, +X à droite.
- Origine au sol, au point d'appui naturel.
- Pièces mobiles sur des pivots nommés `Pivot_*`, points d'accroche sur des objets vides `Ancre_*`.
- Niveaux de détail en suffixes `_LOD0`, `_LOD1`, `_LOD2`.
- Un matériau par modèle ; faces orientées vers l'extérieur, matériau à une seule face.

### 4.4 Reprendre un modèle d'une bibliothèque ou d'un générateur IA

Les modèles produits par IA sont rapides à obtenir mais rarement prêts à l'emploi. Dans Blender :

1. Mettre à l'échelle (1 m) et orienter.
2. Placer l'origine au point d'appui.
3. Réduire au budget (*Decimate*, ou retopologie pour ce qui se déforme).
4. Supprimer les faces cachées, puis recalculer les normales.
5. Refaire les UV si besoin ; regrouper les textures en un atlas ou ramener les couleurs à une palette.
6. Créer les niveaux de détail.
7. Nommer selon les conventions, puis exporter en `.glb`.

Ces étapes peuvent elles-mêmes devenir des scripts Blender, sur le modèle de `velo_route.py`.

## 5. Architecture du code

Même découpage que celui préparé pour Wattlas (agents `architecture-auditor`, `hexagonal-designer`, `refactorer`) : un **domaine pur** au centre, des **ports** (interfaces) qu'il définit, des **adaptateurs** qui les branchent sur Unity, les capteurs, le réseau.

```
                ┌──────────────── Présentation (MonoBehaviour) ────────────────┐
                │  VeloAnimation, Cycliste (IK), Caméras, HUD, menus VR        │
                └──────────────────────────────┬───────────────────────────────┘
                                               │ lit l'état de la course
┌─ Adaptateurs ─────────────┐   ┌──────────────┴──────────────┐   ┌─ Adaptateurs ────────────────┐
│ PontWebSocket (sim JS)    │──▶│  Application (cas d'usage)  │◀──│ CapteurBLE Android / Windows │
│ Stockage fichiers, Dropbox│──▶│  DémarrerCourse, Avancer…   │◀──│ RelaisRéseau (trainer)       │
│ Horloge, Entrées          │──▶│  ┌───────────────────────┐  │   │ Clavier / manette            │
└───────────────────────────┘   │  │ Domaine (C# pur)      │  │   └──────────────────────────────┘
                                │  │ mécanique, physiologie│  │
                                │  │ simulation, peloton…  │  │
                                │  └───────────────────────┘  │
                                └─────────────────────────────┘
```

| Port (interface du domaine ou de l'application) | Adaptateurs |
| --- | --- |
| `ISourceDeCourse` : le parcours, puis l'état de chaque coureur à chaque pas | `PontWebSocket` (la simulation JavaScript de Wattlas, § 7.1), `SimulationLocale` (le moteur porté en C#) |
| `IHomeTrainer` : puissance, cadence, vitesse ; consigne de pente (FTMS) | BLE Android (Quest), BLE Windows (PC), relais réseau (Xbox, ou Quest sans BLE), simulé au clavier ou à la manette |
| `IBibliotheque` : parcours, athlètes, vélos et tenues | fichiers locaux (GPX, `*.pyr-parcours.gpx`, JSON exporté par Plan), Dropbox plus tard (même fichier `/paceyourride.json`) |
| `IHorloge`, `IAleatoire` | temps de Unity ; générateur pseudo-aléatoire porté à l'identique (même graine = même monde, même course) |

## 6. Le projet Unity

### 6.1 Arborescence

Le projet est à créer dans ce dossier, sous `VirtualRideUnity/Wattlas/`, avec le gabarit *Universal 3D* de Unity 6.3 LTS. L'intégration continue GitLab ne publie que les dossiers du site : ce dossier n'y part pas.

```
VirtualRideUnity/
├─ blender/                       générateurs de modèles (velo_route.py…)
├─ unity/                         scripts prêts à copier en attendant le projet
└─ Wattlas/                       le projet Unity
   ├─ Assets/
   │  └─ _Wattlas/
   │     ├─ Art/
   │     │  ├─ Velos/             .glb générés
   │     │  ├─ Cyclistes/
   │     │  ├─ Monde/             mobilier, bâtiments, végétation
   │     │  ├─ Materiaux/  Textures/  Shaders/
   │     ├─ Prefabs/
   │     ├─ Scenes/               Demarrage, Menu, Course, Vitrine
   │     ├─ Scripts/
   │     │  ├─ Domaine/           Wattlas.Domaine.asmdef        (noEngineReferences : true)
   │     │  ├─ Application/       Wattlas.Application.asmdef    (→ Domaine)
   │     │  ├─ Adaptateurs/       Wattlas.Adaptateurs.asmdef    (→ Application, Domaine, UnityEngine)
   │     │  └─ Presentation/      Wattlas.Presentation.asmdef   (→ tout)
   │     ├─ Tests/
   │     │  ├─ Domaine/           EditMode : comparaison au moteur JS
   │     │  └─ Jeu/               PlayMode
   │     └─ Reglages/             URP_PC.asset, URP_Quest.asset, profils de qualité
   ├─ Packages/manifest.json
   └─ ProjectSettings/
```

Les fichiers `.asmdef` rendent les règles de dépendance vérifiables par le compilateur. Le domaine ne voit pas `UnityEngine` : s'il en a besoin, la compilation échoue.

### 6.2 Paquets

| Paquet | Pour |
| --- | --- |
| `com.unity.render-pipelines.universal` | rendu URP |
| `com.unity.xr.openxr`, `com.unity.xr.meta-openxr` | casque Quest (OpenXR) |
| `com.unity.xr.interaction.toolkit` | menus et pointeurs en VR |
| `com.unity.inputsystem` | clavier, manette, contrôleurs |
| `com.unity.cloud.gltfast` | import des `.glb` |
| `com.unity.splines` | axe de la route |
| `com.unity.animation.rigging` | pédalage par cinématique inverse |
| `com.unity.test-framework` | tests |
| plus tard : `com.unity.webrtc`, `com.unity.addressables` | courses en direct (compatibles avec `live.js`), chargement à la demande |

### 6.3 Profils de compilation

| Profil | Réglages |
| --- | --- |
| **Windows** | DirectX 12, IL2CPP, `URP_PC` : ombres à 3 cascades, MSAA ×4, végétation dense, distance de vue 3 km |
| **Quest** (Android) | Vulkan, IL2CPP ARM64, ASTC, multivue, `URP_Quest` : § 3.1 |
| **Xbox** (plus tard) | profil fourni par le module Xbox de Unity une fois l'accès ID@Xbox obtenu ; qualité entre Quest et PC, 60 images/s sur Series S |

### 6.4 Git

- **`.gitignore` Unity** : `Library/`, `Temp/`, `Obj/`, `Logs/`, `Build/`, `UserSettings/`, `*.csproj`, `*.sln`.
- **Sérialisation texte** (*Force Text*) et **fichiers .meta visibles** : les scènes et préfabs restent lisibles et fusionnables. Pour les conflits, on règle l'outil de fusion de Unity (*UnityYAMLMerge*).
- **Git LFS** pour les binaires lourds (`*.fbx`, `*.glb`, `*.png`, `*.psd`, `*.wav`, `*.blend`), limité à `VirtualRideUnity/Wattlas/`. Vérifier d'abord le quota LFS du compte GitHub.
- Les modèles **générés** ne sont pas des sources : on versionne le script et ses paramètres. Le `.glb` qui en sort n'est commité que pour ne pas obliger chacun à installer Blender.

## 7. Le moteur : de JavaScript à C#

Le moteur de Wattlas (`Commun/js/engine/`, 34 modules) ne touche ni au DOM ni au réseau. C'est du calcul pur, prêt à être porté.

### 7.1 Trois façons de brancher la simulation

| | A. Unity comme vue de la simulation JS | B. Moteur porté en C# | C. Moteur JS exécuté dans Unity (Jint) |
| --- | --- | --- | --- |
| Principe | la page de course de Wattlas envoie déjà l'état de la course à ses vues 3D (protocole `pyr3d` de `bridge.js` : messages `course`, `frame`, `gear`, `cmd`) ; on envoie les mêmes messages à Unity par WebSocket | réécriture des modules en C#, testée contre le JavaScript | interpréteur JavaScript en .NET, qui charge les fichiers `engine/*.js` tels quels |
| Quest autonome | non (il faut le navigateur sur un PC ou un téléphone du même réseau) | **oui** | oui en théorie |
| Xbox | non | **oui** | incertain (compilation anticipée, performances) |
| Travail | petit | gros (~9 000 lignes, § 7.3) | moyen, mais risqué |
| Deux codes à maintenir | non | **oui** (d'où les tests croisés, § 7.4) | non |

**Recommandation** :

1. **Commencer par A.** En quelques jours, la course simulée par Wattlas apparaît dans Unity sur PC, puis sur le Quest relié au réseau. On travaille le monde, les modèles, la VR et les performances sans attendre le portage. Côté web, il suffit d'ajouter une destination WebSocket à `Commun/js/jeu/view3d.js` (adresse en option, par exemple `?unity=ws://localhost:8787`). Côté Unity, il faut un petit serveur WebSocket. La page doit être servie en `http://localhost` (`lancer.bat`) : une page HTTPS n'a pas le droit d'ouvrir un `ws://` non chiffré vers le réseau local.
2. **Porter en C# ensuite (B), lot par lot**, derrière le même port `ISourceDeCourse` : le reste du jeu ne voit pas la différence.
3. **C** reste une piste à évaluer en une journée avant de se lancer dans B. Si Jint tient la charge sur le Quest (peloton de 30 coureurs à 60 pas par seconde), il évite la double maintenance.

### 7.2 Règles du portage

- **Mêmes algorithmes, mêmes constantes, mêmes noms** traduits (tableau de correspondance en tête de chaque fichier C#) : `physics.steadySpeed` → `Physique.VitesseStable`.
- **`double` partout dans le domaine** : les nombres JavaScript sont des doubles. `float` seulement dans la présentation.
- **Générateur pseudo-aléatoire porté bit à bit.** Les opérations entières de JavaScript (`|0`, `>>>`, `Math.imul`) travaillent sur 32 bits : en C#, on utilise `uint`/`int` en contexte `unchecked`. Même graine = même monde et même course que dans les vues web, condition des courses en direct entre un joueur web et un joueur Unity.
- **Mêmes formats de données** : GPX enrichi de Plan (`route-file.js`), JSON de la bibliothèque (`library.js`), catalogue du magasin (`catalog.js`). Unity lit ce que Plan écrit.
- Les modules qui dépendent l'un de l'autre (`metabo` ↔ `fuel`, `peloton` ↔ `tactics` ↔ `strategy`) sont portés ensemble.

### 7.3 Lots

| Lot | Modules (`Commun/js/`) | Lignes JS | Dépend de | Ce que ça débloque |
| --- | --- | ---: | --- | --- |
| 1 · Mécanique | `core/util.js`, `engine/physics.js`, `engine/physio.js` | 684 | — | vitesse pour une puissance donnée : rouler seul, sans fatigue |
| 2 · Énergie | `engine/metabo.js`, `engine/fuel.js`, `engine/nutrition.js` | 1 456 | 1 | W′, glycogène, hydratation, alimentation |
| 3 · Simulation | `engine/weather.js`, `engine/sim.js`, `engine/slowdown.js`, `engine/tilt.js` | 1 351 | 1, 2 | course en solo complète : météo, vent, revêtements |
| 4 · Course | `engine/draft.js`, `classif.js`, `feed.js`, `peloton.js`, `tactics.js`, `strategy.js`, `race.js`, `pros.js` | 4 360 | 1–3 | aspiration, peloton, coureurs virtuels, tactiques, classements |
| 5 · Formats | `core/route-file.js`, `core/codec.js`, `core/library.js`, `engine/catalog.js` | 1 018 | — | lire parcours, athlètes et matériel de Plan |
| Monde | `VirtualRide3D/univers/js/route.js`, `landscape.js`, `road.js`, `village.js`… | 3 000 et plus | générateur aléatoire | **le même monde** que les vues web, pour la même graine |
| Pas nécessaire | `engine/course.js`, `gradient.js`, `optimizer.js` (calcul du plan optimal) | 1 636 | 1–3 | Plan calcule le plan ; le jeu le lit |

Ordre conseillé : 1 → 3 (solo) → 5 → 2 → 4 → Monde. Chaque lot se termine quand ses tests passent (§ 7.4).

### 7.4 Tests croisés JavaScript ↔ C#

1. Un script Node, `VirtualRideUnity/outils/vecteurs.js` (à écrire), charge le moteur comme le font les tests actuels (`tests/helpers.js`). Il joue une liste de scénarios (parcours synthétiques de `makeProfile`, athlètes types, météo fixée, graine fixée). Il écrit les entrées et les sorties dans des fichiers JSON (`Assets/_Wattlas/Tests/Domaine/Vecteurs/*.json`).
2. Les tests NUnit du domaine relisent ces fichiers, appellent le C# et comparent :
   - à 1e-9 près pour les fonctions pures (`steadyPower`, densité de l'air…) ;
   - à 1e-6 près, ou à une tolérance documentée, pour les simulations intégrées pas à pas.
3. Les tests existants de chaque module (`tests/engine.test.js`, `race.test.js`, `peloton.test.js`, `metabo.test.js`…) sont traduits avec lui.
4. Quand le moteur JavaScript change, on régénère les vecteurs. Si un test C# casse, l'écart entre les deux moteurs se voit tout de suite.

## 8. Home-trainer et capteurs, par plateforme

| Plateforme | Accès au home-trainer (FTMS) et aux capteurs | Remarque |
| --- | --- | --- |
| PC | BLE de Windows : greffon natif (WinRT) ou bibliothèque de l'Asset Store | Étape A : le navigateur garde la main (Web Bluetooth de `Commun/js/ui/sensors.js`) |
| Quest | BLE d'Android : greffon Java/Kotlin (`.aar`), permissions `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` | des applications de fitness du Quest se connectent déjà à des vélos et des cardiofréquencemètres en BLE ; à valider avec nos home-trainers |
| Xbox | pas de BLE pour les jeux | relais réseau : le téléphone (Compteur) ou le PC lit le home-trainer et transmet puissance et cadence |

Dans tous les cas, le jeu envoie au home-trainer la **pente simulée** (FTMS : paramètres de simulation), comme le fait déjà le web avec le home-trainer piloté.

## 9. Étapes

| Étape | Contenu | Terminé quand |
| --- | --- | --- |
| 0 · Socle | projet Unity 6.3 LTS (URP), dossiers et `.asmdef`, paquets, profils Windows et Quest, Git LFS ; vélo généré importé et animé | le vélo tourne ses roues dans une scène vide, sur PC et sur le Quest |
| 1 · Vue Unity (A) | serveur WebSocket et adaptateur `PontWebSocket` ; route depuis le GPX (Splines) ; terrain simple ; coureurs placés selon les messages `frame` ; caméras | une course lancée dans Wattlas (page servie en local) se voit dans Unity, à 90 images/s sur PC |
| 2 · Quest | même chose dans le casque, par le réseau local ; passe de performance (§ 3) ; confort (§ 3.5) | 72 images/s tenues au milieu d'un peloton de 30 |
| 3 · Solo autonome (B) | lots 1, 3 et 5 portés et testés ; `SimulationLocale` ; puissance à la manette | une sortie en solo sur un GPX, sans PC, dans le casque |
| 4 · Home-trainer | greffon BLE Android (puis Windows) ; consigne de pente | on pédale sur son home-trainer, casque sur la tête, sans PC |
| 5 · Cycliste et peloton | personnage, tenues, pédalage par IK ; lots 2 et 4 | une course complète contre les coureurs virtuels, en autonome |
| 6 · Monde | portage de la génération du paysage ; villages, végétation, public dans les budgets | même paysage que Virtual Ride 3D pour la même graine |
| 7 · Multijoueur | WebRTC compatible avec `live.js` et `relay.js` | un joueur Unity et un joueur web dans la même course en direct |
| 8 · Xbox | après acceptation ID@Xbox : module Xbox de Unity, certification | — |

## 10. Risques et questions ouvertes

- **Végétation et distance de vue sur le Quest** : c'est là que les budgets explosent d'habitude. À mesurer dès l'étape 2, sur un vrai parcours boisé.
- **Double maintenance JavaScript / C#** (option B) : les tests croisés la rendent visible, pas gratuite. Décider après l'essai de Jint (§ 7.1, C).
- **BLE sur le Quest** : à valider tôt avec un home-trainer réel (étape 4 avancée si possible), sinon relais réseau.
- **Personnage** : trouver un modèle de base détaillé, léger et sous licence compatible. C'est un achat ou une production à prévoir.
- **Xbox** : candidature ID@Xbox, puis exigences de certification de Microsoft (suspension et reprise, comptes, accessibilité) ; pas de BLE.
- **Distribution sur le Quest** : installation directe (mode développeur) pour les tests ; la boutique de Meta demande une validation de l'application.
- **Mal des transports** : à tester tôt avec plusieurs personnes ; prévoir la vue extérieure.

## Sources

- Meta, *Performance and optimization* (Unity) : budgets de triangles et d'appels de dessin du Quest 3/3S — https://developers.meta.com/horizon/documentation/unity/unity-perf/
- Meta, *Device optimization comparison* — https://developers.meta.com/horizon/resources/device-optimization-comparison/
- Unity, *Unity 6* (versions LTS et durée de support) — https://unity.com/releases/unity-6
