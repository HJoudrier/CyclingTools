#!/usr/bin/env bash
# Wattlas — vérifie le domaine porté en C# sans Unity : régénère les vecteurs de référence avec le moteur JavaScript du
# site, compile le domaine, la couche Jeu et leurs tests avec Mono (mcs), puis lance les tests.
#   bash VirtualRideUnity/outils/verifier_domaine.sh        (il faut node et mono : apt install mono-mcs mono-runtime)
set -euo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8
ici="$(cd "$(dirname "$0")" && pwd)"
projet="$ici/../Wattlas/Assets/_Wattlas"
sortie="$(mktemp -d)"
node "$ici/vecteurs.js"
mcs -langversion:Latest -warnaserror+ -nowarn:1591 -out:"$sortie/domaine.exe" \
  "$ici/mono/NUnitMinimal.cs" "$ici/mono/Lanceur.cs" \
  "$projet"/Scripts/Domaine/*.cs "$projet"/Scripts/Jeu/*.cs "$projet"/Tests/Domaine/*.cs
mono "$sortie/domaine.exe"
