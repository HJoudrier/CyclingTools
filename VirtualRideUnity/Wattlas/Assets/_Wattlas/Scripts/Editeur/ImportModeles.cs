using System.IO;
using UnityEditor;
using UnityEngine;

namespace Wattlas.Editeur
{
    /// <summary>
    /// Réglages d'import des modèles générés par VirtualRideUnity/blender (dossier Assets/_Wattlas/Art) :
    ///  - modèles FBX : conversion des axes cuite (Bake Axis Conversion), pas de caméra ni de lumière ;
    ///    vélos sans animation ; cyclistes en rig « Generic » (os gardés), clips en boucle, sans compression (les pieds
    ///    restent sur les pédales) ; seuls les équipements par défaut sont visibles dans le préfab ;
    ///  - palettes (*_Palette, *_MetalLisse, *_MetalRugosite) : filtrage « au plus proche », sans mipmaps ni compression ;
    ///  - matériaux : la palette en couleur de base, *_MetalLisse en carte de métal / lissé (URP/Lit).
    /// </summary>
    public sealed class ImportModeles : AssetPostprocessor
    {
        const string Dossier = "Assets/_Wattlas/Art/";

        static bool Concerne(string chemin)
        {
            return chemin.Replace('\\', '/').StartsWith(Dossier);
        }

        static bool EstCycliste(string chemin)
        {
            return Path.GetFileName(chemin).StartsWith("Cycliste");
        }

        void OnPreprocessModel()
        {
            if (!Concerne(assetPath))
                return;
            var mi = (ModelImporter)assetImporter;
            mi.bakeAxisConversion = true;
            mi.importCameras = false;
            mi.importLights = false;
            mi.isReadable = false;
            mi.importBlendShapes = false;
            if (EstCycliste(assetPath))
            {
                mi.animationType = ModelImporterAnimationType.Generic;
                mi.optimizeGameObjects = false;
                mi.importAnimation = true;
                mi.animationCompression = ModelImporterAnimationCompression.Off;
                mi.resampleCurves = true;
            }
            else
            {
                mi.animationType = ModelImporterAnimationType.None;
                mi.importAnimation = false;
            }
        }

        void OnPreprocessAnimation()
        {
            if (!Concerne(assetPath) || !EstCycliste(assetPath))
                return;
            var mi = (ModelImporter)assetImporter;
            ModelImporterClipAnimation[] clips = mi.defaultClipAnimations;
            foreach (ModelImporterClipAnimation c in clips)
            {
                c.loopTime = true;
                c.loopPose = false;   // la dernière image est déjà la première (un tour complet)
                c.lockRootRotation = false;
                c.lockRootHeightY = false;
                c.lockRootPositionXZ = false;
            }
            mi.clipAnimations = clips;
        }

        void OnPreprocessTexture()
        {
            if (!Concerne(assetPath))
                return;
            string nom = Path.GetFileNameWithoutExtension(assetPath);
            if (!(nom.EndsWith("_Palette") || nom.EndsWith("_MetalLisse") || nom.EndsWith("_MetalRugosite")))
                return;
            var ti = (TextureImporter)assetImporter;
            ti.filterMode = FilterMode.Point;
            ti.mipmapEnabled = false;
            ti.wrapMode = TextureWrapMode.Clamp;
            ti.textureCompression = TextureImporterCompression.Uncompressed;
            ti.sRGBTexture = nom.EndsWith("_Palette");
            ti.alphaSource = nom.EndsWith("_MetalLisse") ? TextureImporterAlphaSource.FromInput : TextureImporterAlphaSource.None;
        }

        void OnPostprocessMaterial(Material m)
        {
            if (!Concerne(assetPath))
                return;
            RelierPalettes(m, assetPath);
        }

        /// <summary>Branche la palette et la carte métal / lissé rangées à côté du modèle (« M_Velo_Aero_M » → Velo_Aero_M_Palette.png).</summary>
        public static bool RelierPalettes(Material m, string cheminModele)
        {
            string dossier = Path.GetDirectoryName(cheminModele).Replace('\\', '/');
            string base_ = m.name.StartsWith("M_") ? m.name.Substring(2) : Path.GetFileNameWithoutExtension(cheminModele);
            var couleurs = AssetDatabase.LoadAssetAtPath<Texture2D>(dossier + "/" + base_ + "_Palette.png");
            var metal = AssetDatabase.LoadAssetAtPath<Texture2D>(dossier + "/" + base_ + "_MetalLisse.png");
            if (couleurs == null)
                return false;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", couleurs);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", couleurs);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", Color.white);
            if (metal != null && m.HasProperty("_MetallicGlossMap"))
            {
                m.SetTexture("_MetallicGlossMap", metal);
                m.SetFloat("_Smoothness", 1f);
                m.EnableKeyword("_METALLICSPECGLOSSMAP");
            }
            return true;
        }

        void OnPostprocessModel(GameObject racine)
        {
            if (!Concerne(assetPath) || !EstCycliste(assetPath))
                return;
            // un seul casque, une seule paire de lunettes et de chaussures visibles dans le préfab (CyclisteEquipement choisit en jeu)
            foreach (Transform t in racine.GetComponentsInChildren<Transform>(true))
            {
                string n = t.name;
                int lod = n.LastIndexOf("_LOD");
                if (lod > 0) n = n.Substring(0, lod);
                bool variante = n.StartsWith("Casque_") || n.StartsWith("Lunettes_") || n.StartsWith("ChaussureD_") || n.StartsWith("ChaussureG_");
                bool parDefaut = n == "Casque_road" || n == "Lunettes_sport" || n.EndsWith("_road");
                if (variante && !parDefaut)
                    t.gameObject.SetActive(false);
            }
        }
    }
}
