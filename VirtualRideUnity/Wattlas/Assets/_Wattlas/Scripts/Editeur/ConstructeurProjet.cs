using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using Wattlas.Presentation;

namespace Wattlas.Editeur
{
    /// <summary>
    /// Menus « Wattlas » : réglages du projet (URP, couleurs linéaires), construction de la scène de démonstration
    /// (préfabs du vélo et des cyclistes, matériaux, route, caméra) et réglages Android pour le Meta Quest.
    /// Tout est refait à chaque appel : on peut relancer après avoir régénéré les modèles avec Blender.
    /// </summary>
    public static class ConstructeurProjet
    {
        const string Racine = "Assets/_Wattlas";
        const string Reglages = Racine + "/Reglages";
        const string Prefabs = Racine + "/Prefabs";
        const string Materiaux = Racine + "/Art/Materiaux";
        const string Scenes = Racine + "/Scenes";

        [MenuItem("Wattlas/1. Régler le projet (URP, couleurs linéaires)", priority = 1)]
        public static void ReglerProjet()
        {
            Dossier(Reglages);
            string chemin = Reglages + "/URP_Wattlas.asset";
            var urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(chemin);
            if (urp == null)
            {
                var rendu = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(rendu, Reglages + "/URP_Wattlas_Rendu.asset");
                urp = UniversalRenderPipelineAsset.Create(rendu);
                AssetDatabase.CreateAsset(urp, chemin);
            }
            urp.msaaSampleCount = 4;
            urp.supportsHDR = false;        // Quest : pas de HDR, pas de post-traitement plein écran
            urp.shadowDistance = 40f;
            urp.shadowCascadeCount = 1;
            EditorUtility.SetDirty(urp);
            GraphicsSettings.defaultRenderPipeline = urp;
            int niveau = QualitySettings.GetQualityLevel();
            for (int i = 0; i < QualitySettings.names.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                QualitySettings.renderPipeline = urp;
            }
            QualitySettings.SetQualityLevel(niveau, false);
            PlayerSettings.colorSpace = ColorSpace.Linear;
            AssetDatabase.SaveAssets();
            Debug.Log("Wattlas : URP actif (" + chemin + "), couleurs linéaires.");
        }

        [MenuItem("Wattlas/2. Construire la scène de démonstration", priority = 2)]
        public static void ConstruireDemo()
        {
            if (GraphicsSettings.defaultRenderPipeline == null)
                ReglerProjet();
            Dossier(Prefabs);
            Dossier(Materiaux);
            Dossier(Scenes);

            GameObject veloM = PrefabVelo("Velo_Aero_M"), veloF = PrefabVelo("Velo_Aero_F");
            GameObject cyclisteM = PrefabCycliste("Cycliste_M"), cyclisteF = PrefabCycliste("Cycliste_F");
            if (veloM == null || cyclisteM == null)
            {
                EditorUtility.DisplayDialog("Wattlas", "Modèles introuvables dans " + Racine + "/Art (Velos/Velo_Aero_M.fbx, " +
                    "Cyclistes/Cycliste_M.fbx). Générez-les avec VirtualRideUnity/blender/cycliste.py --avec-velo.", "OK");
                return;
            }

            Material chaussee = Materiau("Chaussee", new Color(0.18f, 0.18f, 0.19f), 0.25f);
            Material accotement = Materiau("Accotement", new Color(0.55f, 0.52f, 0.46f), 0.1f);
            Material herbe = Materiau("Herbe", new Color(0.30f, 0.46f, 0.20f), 0.05f);
            Material ciel = AssetDatabase.LoadAssetAtPath<Material>(Materiaux + "/Ciel.mat");
            if (ciel == null)
            {
                ciel = new Material(Shader.Find("Skybox/Procedural"));
                AssetDatabase.CreateAsset(ciel, Materiaux + "/Ciel.mat");
            }

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            RenderSettings.skybox = ciel;
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogStartDistance = 500f;
            RenderSettings.fogEndDistance = 2000f;
            RenderSettings.fogColor = new Color(0.72f, 0.80f, 0.88f);
            Light soleil = Object.FindObjectsByType<Light>(FindObjectsSortMode.None).FirstOrDefault(l => l.type == LightType.Directional);
            if (soleil != null)
            {
                soleil.transform.rotation = Quaternion.Euler(48f, -30f, 0f);
                soleil.intensity = 1.3f;
                soleil.shadows = LightShadows.Soft;
            }

            var demo = new GameObject("Démonstration").AddComponent<DemoCourse>();
            demo.gpx = AssetDatabase.LoadAssetAtPath<TextAsset>(Racine + "/Parcours/balade-en-campagne.xml");
            demo.velo = veloM;
            demo.cycliste = cyclisteM;
            demo.velosAdversaires = veloF != null && cyclisteF != null ? new[] { veloM, veloF } : new[] { veloM };
            demo.cyclistesAdversaires = veloF != null && cyclisteF != null ? new[] { cyclisteM, cyclisteF } : new[] { cyclisteM };
            demo.rayonRoue = RayonRoue("Velo_Aero_M");
            demo.chaussee = chaussee;
            demo.accotement = accotement;
            demo.herbe = herbe;

            string cheminScene = Scenes + "/Demo.unity";
            EditorSceneManager.SaveScene(scene, cheminScene);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(cheminScene, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("Wattlas : scène de démonstration prête (" + cheminScene + "). Lecture : ↑ ↓ puissance, C caméra.");
        }

        [MenuItem("Wattlas/3. Régler pour le Meta Quest (Android)", priority = 3)]
        public static void ReglerQuest()
        {
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)32;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
            EditorUserBuildSettings.androidBuildSubtarget = MobileTextureSubtarget.ASTC;
            Debug.Log("Wattlas : réglages Android pour le Quest appliqués (IL2CPP, ARM64, Vulkan, ASTC, API 32). " +
                      "Reste à activer OpenXR et « Meta Quest Support » : Project Settings › XR Plug-in Management (onglet Android).");
        }

        static GameObject PrefabVelo(string nom)
        {
            string modele = Racine + "/Art/Velos/" + nom + ".fbx";
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(modele);
            if (source == null)
                return null;
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(source);
            var va = inst.GetComponent<VeloAnimation>();
            if (va == null)
                va = inst.AddComponent<VeloAnimation>();
            va.rayonRoue = RayonRoue(nom);
            RelierMateriaux(inst, modele);
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(inst, Prefabs + "/" + nom + ".prefab");
            Object.DestroyImmediate(inst);
            return prefab;
        }

        static GameObject PrefabCycliste(string nom)
        {
            string modele = Racine + "/Art/Cyclistes/" + nom + ".fbx";
            var source = AssetDatabase.LoadAssetAtPath<GameObject>(modele);
            if (source == null)
                return null;
            var inst = (GameObject)PrefabUtility.InstantiatePrefab(source);
            if (inst.GetComponent<Animator>() == null)
                inst.AddComponent<Animator>();
            var anim = inst.GetComponent<CyclisteAnimation>();
            if (anim == null)
                anim = inst.AddComponent<CyclisteAnimation>();
            anim.clips = AssetDatabase.LoadAllAssetsAtPath(modele).OfType<AnimationClip>()
                .Where(c => !c.name.StartsWith("__preview__")).OrderBy(c => c.name).ToArray();
            if (inst.GetComponent<CyclisteEquipement>() == null)
                inst.AddComponent<CyclisteEquipement>();
            RelierMateriaux(inst, modele);
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(inst, Prefabs + "/" + nom + ".prefab");
            Object.DestroyImmediate(inst);
            return prefab;
        }

        /// <summary>Au cas où les palettes ont été importées après le modèle : rebranche-les sur ses matériaux.</summary>
        static void RelierMateriaux(GameObject inst, string modele)
        {
            foreach (Renderer r in inst.GetComponentsInChildren<Renderer>(true))
                foreach (Material m in r.sharedMaterials)
                    if (m != null && ImportModeles.RelierPalettes(m, modele))
                        EditorUtility.SetDirty(m);
        }

        [System.Serializable]
        sealed class Rapport
        {
            public Geometrie geometrie = null;
        }

        [System.Serializable]
        sealed class Geometrie
        {
            public float rayon_roue = 0f;
        }

        static float RayonRoue(string nomVelo)
        {
            string chemin = Racine + "/Art/Velos/" + nomVelo + ".rapport.json";
            if (!File.Exists(chemin))
                return 0.339f;
            var r = JsonUtility.FromJson<Rapport>(File.ReadAllText(chemin));
            return r != null && r.geometrie != null && r.geometrie.rayon_roue > 0 ? r.geometrie.rayon_roue : 0.339f;
        }

        static Material Materiau(string nom, Color couleur, float lissage)
        {
            string chemin = Materiaux + "/" + nom + ".mat";
            var m = AssetDatabase.LoadAssetAtPath<Material>(chemin);
            if (m == null)
            {
                Shader s = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
                m = new Material(s);
                AssetDatabase.CreateAsset(m, chemin);
            }
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", couleur);
            if (m.HasProperty("_Color")) m.SetColor("_Color", couleur);
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", lissage);
            EditorUtility.SetDirty(m);
            return m;
        }

        static void Dossier(string chemin)
        {
            if (AssetDatabase.IsValidFolder(chemin))
                return;
            string parent = Path.GetDirectoryName(chemin).Replace('\\', '/');
            Dossier(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(chemin));
        }
    }
}
