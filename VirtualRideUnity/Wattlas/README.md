# Wattlas — projet Unity

Le jeu 3D natif de Wattlas : la course du site, dans Unity 6, sur PC et dans un casque Meta Quest autonome. Ce premier état est un **socle jouable** :

- une route construite d'après un GPX ;
- le joueur sur son vélo, avec son cycliste animé ;
- sept coureurs virtuels ;
- la mécanique du site portée en C# : vitesse, pente, air, vent, W′, abri simplifié ;
- un compteur ;
- trois caméras : poursuite, vue du cycliste, casque VR.

Le document de conception est [`../CONCEPTION.md`](../CONCEPTION.md). Les modèles 3D viennent des générateurs Blender de [`../blender/`](../blender/).

> **État** : les scripts compilent (avec Mono, contre les assemblies de référence de UnityEngine et UnityEditor). Le moteur porté passe ses tests contre le moteur JavaScript du site. **Le projet n'a pas encore été ouvert dans l'éditeur Unity** : les réglages ci-dessous sont à vérifier à la première ouverture.

## Ouvrir le projet

1. Installer **Unity 6.3 LTS** (Unity Hub), avec le module **Android Build Support** pour le Quest.
2. Unity Hub › **Add › Add project from disk** › choisir ce dossier (`VirtualRideUnity/Wattlas`), puis la version 6.3.
3. Au premier chargement, Unity installe les paquets de `Packages/manifest.json` : URP 17.3, Input System 1.14, OpenXR 1.15, Test Framework, plus les modules intégrés. Si Unity demande d'activer le nouveau système d'entrées et de redémarrer, accepter. Sinon, régler *Project Settings › Player › Active Input Handling* sur **Input System Package** (ou **Both**).
4. Menu **Wattlas › 1. Régler le projet** : crée l'URP (`Assets/_Wattlas/Reglages/URP_Wattlas.asset`), l'active pour tous les niveaux de qualité et passe en couleurs linéaires.
5. Menu **Wattlas › 2. Construire la scène de démonstration** : crée les préfabs (vélos, cyclistes avec leurs clips), les matériaux et la scène `Assets/_Wattlas/Scenes/Demo.unity`.
6. **Lecture** (▶).

Les deux menus peuvent être relancés à tout moment, par exemple après avoir régénéré les modèles.

## Commandes

| Action | Clavier | Manette | Manettes du casque |
| --- | --- | --- | --- |
| Puissance | ↑ ↓ (Maj : ±50 W) | gâchettes droite / gauche, croix ↑ ↓ | gâchettes droite / gauche |
| Roue libre | 0 | B | — |
| Place sur la route | ← → | stick gauche | — |
| Position (haut du cintre, cocottes, bas…) | 1 à 6 | RB / LB | — |
| Caméra (poursuite / vue du cycliste) | C | Y | — |
| Recentrer la vue dans le casque | R | — | A ou X |

On passe en **danseuse** tout seul dans les fortes pentes (au-dessus de 120 % de la PC), et au **sprint**.

## Jouer dans le casque (Meta Quest autonome)

1. Menu **Wattlas › 3. Régler pour le Meta Quest** : IL2CPP, ARM64, Vulkan, textures ASTC, API Android 32.
2. *Project Settings › XR Plug-in Management*, onglet **Android** : cocher **OpenXR**, puis dans *OpenXR* le groupe **Meta Quest Support**. Si Unity propose de corriger des réglages (projet « validation »), accepter.
3. *File › Build Profiles* : choisir **Android** (ou **Meta Quest**), *Switch Platform*.
4. Casque en mode développeur, relié en USB : **Build And Run**.

Sur PC, avec un casque relié (Quest Link ou SteamVR), cocher OpenXR dans l'onglet **Windows** de *XR Plug-in Management* : la même scène s'ouvre dans le casque.

Dans le casque, la vue est celle du cycliste. Pour le confort, la tête du joueur est suivie librement, mais le repère ne suit que le cap du vélo : ni roulis ni tangage ne sont imposés. La tête du cycliste du joueur est réduite à rien, pour qu'il ne la voie pas de l'intérieur. Le compteur est posé sur la potence.

## Organisation

```
Assets/_Wattlas/
├─ Art/Velos/          Velo_Aero_M.fbx, Velo_Aero_F.fbx (+ palettes, rapports) — velo_route.py
├─ Art/Cyclistes/      Cycliste_M.fbx, Cycliste_F.fbx (+ palettes) — cycliste.py
├─ Parcours/           GPX d'exemple (renommés en .xml pour être lus comme du texte)
├─ Scripts/
│  ├─ Domaine/         C# pur, sans UnityEngine : Physique, Catalogue, Roulage, Parcours (+ GPX), Braquets
│  ├─ Jeu/             cas d'usage, sans UnityEngine : Course, Coureur, port ISourcePuissance, coureurs virtuels
│  ├─ Adaptateurs/     PuissanceClavierManette (Input System) ; plus tard : home-trainer Bluetooth (FTMS)
│  ├─ Presentation/    VeloAnimation, CyclisteAnimation, CyclisteEquipement, RouteMaillage, CameraJoueur, Compteur, DemoCourse
│  └─ Editeur/         ImportModeles (réglages d'import), ConstructeurProjet (menus Wattlas)
└─ Tests/Domaine/      tests NUnit du domaine (Window › General › Test Runner) + Vecteurs/physique.json
```

Les fichiers `.asmdef` imposent les dépendances. Le **Domaine** et le **Jeu** n'ont pas accès à `UnityEngine` (`noEngineReferences`) : ils se compilent et se testent hors de Unity.

### Les modèles

- **Vélos** : pivots (direction, roues, pédalier, pédales) animés par `VeloAnimation`. Le vélo penche dans les virages et se balance en danseuse.
- **Cyclistes** :
  - squelette de 15 os aux noms de l'avatar *Humanoid* ;
  - 8 clips, chacun un tour de pédalier : `Pedalage_upright`, `_tops`, `_hoods`, `_hoods_bent`, `_drops`, `_forearms`, `Danseuse_hoods`, `Danseuse_drops`. `CyclisteAnimation` règle le temps des clips sur l'angle du pédalier, si bien que les pieds restent sur les pédales à toutes les cadences ;
  - tous les équipements du magasin sont dans le modèle. `CyclisteEquipement` montre ceux qu'on choisit et fabrique la texture de la tenue (manches, cuissard, chaussettes, gants, couleurs d'équipe).
- Un cycliste est **réglé pour son vélo** : hauteur de selle et prises au cintre. `Cycliste_M` va avec `Velo_Aero_M`, `Cycliste_F` avec `Velo_Aero_F`. Les deux sortent ensemble de `cycliste.py --avec-velo`.

## Vérifier sans Unity

```sh
bash VirtualRideUnity/outils/verifier_domaine.sh     # moteur porté contre le moteur JavaScript (node + mono)
bash VirtualRideUnity/outils/verifier_scripts.sh     # compilation de tous les scripts (mono + références Unity)
```

Le premier régénère `Tests/Domaine/Vecteurs/physique.json` avec le moteur du site (`outils/vecteurs.js`), puis lance les tests. Il en faut un après chaque changement du moteur JavaScript.

Le second compile contre UnityEngine 2021.3 et UnityEditor 2021.1 (références publiques), avec des substituts pour Input System et URP. Il attrape les erreurs de C#, mais ce n'est pas Unity 6 :

- une API récente passerait pour une erreur ;
- une API retirée depuis passerait inaperçue.

## Limites de ce premier état

- La route est un ruban sur un terrain ondulé, pas encore le paysage de Bike3D (villages, forêts, rivières) : son portage est l'étape « Monde » de la conception.
- Le moteur porté couvre la mécanique et le roulage. Pas encore portés : les plafonds de la courbe record, le freinage dans les virages, le modèle physiologique complet, l'aspiration de `draft.js` (remplacée par un abri simplifié), les tactiques et le peloton du site.
- Pas encore de home-trainer : la puissance vient du clavier ou des manettes.
- Sur le Quest, rien n'a encore été mesuré.
