#!/usr/bin/env bash
# Wattlas — compile les scripts du projet Unity hors de Unity, pour attraper les erreurs de C# et d'API avant d'ouvrir
# l'éditeur. Références : assemblies de UnityEngine 2021.3 et UnityEditor 2021.1 (paquets NuGet unityengine.modules et
# unity3d.sdk, téléchargés dans un dossier temporaire) ; paquets Input System et URP : substituts minimaux (mono/substituts).
# Ce n'est pas Unity : une API apparue après 2021 passe pour une erreur, une API retirée depuis passe inaperçue.
#   bash VirtualRideUnity/outils/verifier_scripts.sh        (il faut mono-mcs, curl et unzip)
set -euo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8
ici="$(cd "$(dirname "$0")" && pwd)"
s="$ici/../Wattlas/Assets/_Wattlas/Scripts"
ref="${WATTLAS_REFS:-${TMPDIR:-/tmp}/wattlas-refs}"
mkdir -p "$ref"
if [ ! -d "$ref/mod" ]; then
  curl -sSL -o "$ref/mod.nupkg" https://api.nuget.org/v3-flatcontainer/unityengine.modules/2021.3.33/unityengine.modules.2021.3.33.nupkg
  curl -sSL -o "$ref/sdk.nupkg" https://api.nuget.org/v3-flatcontainer/unity3d.sdk/2021.1.14.1/unity3d.sdk.2021.1.14.1.nupkg
  (mkdir -p "$ref/mod" "$ref/sdk" && cd "$ref/mod" && unzip -qo ../mod.nupkg && cd ../sdk && unzip -qo ../sdk.nupkg)
fi
moteur=$(ls "$ref"/mod/lib/net45/UnityEngine*.dll | sed 's/^/-r:/' | tr '\n' ' ')
sortie="$(mktemp -d)"
echo "— paquets (substituts)"
mcs -nologo -target:library -langversion:Latest $moteur -out:"$sortie/Paquets.dll" "$ici"/mono/substituts/*.cs
echo "— Domaine, Jeu, Adaptateurs, Presentation"
mcs -nologo -target:library -langversion:Latest -warnaserror+ $moteur -r:"$sortie/Paquets.dll" -out:"$sortie/Wattlas.dll" \
  "$s"/Domaine/*.cs "$s"/Jeu/*.cs "$s"/Adaptateurs/*.cs "$s"/Presentation/*.cs
echo "— Editeur"
mcs -nologo -target:library -langversion:Latest -warnaserror+ -nowarn:0618 $moteur -r:"$ref/sdk/lib/UnityEditor.dll" -r:"$sortie/Paquets.dll" \
  -r:"$sortie/Wattlas.dll" -out:"$sortie/Wattlas.Editeur.dll" "$s"/Editeur/*.cs
echo "compilation réussie"
