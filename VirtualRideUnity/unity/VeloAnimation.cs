using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEngine;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Anime un vélo produit par VirtualRideUnity/blender/velo_route.py : roues, pédalier, pédales (qui restent
    /// à plat) et direction.
    ///
    /// Les axes de rotation sont déduits de la position des pivots (roue arrière → roue avant = l'avant ;
    /// Pivot_Direction → Repere_AxeDirection = l'axe de braquage), pas de leur orientation : le script marche
    /// de la même façon après un import .glb (glTFast) ou .fbx, avec ou sans « Bake Axis Conversion ».
    ///
    /// À poser sur l'objet racine du vélo (Velo_Aero…) ou sur un de ses parents.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class VeloAnimation : MonoBehaviour
    {
        [Header("Entrées (branchées sur la simulation)")]
        [Tooltip("Vitesse du vélo (m/s).")]
        public float vitesse = 10f;

        [Tooltip("Cadence de pédalage (tr/min) ; 0 = roue libre.")]
        public float cadence = 90f;

        [Tooltip("Braquage du guidon (degrés ; positif = vers la droite).")]
        [Range(-45f, 45f)] public float braquage;

        [Header("Géométrie (rapport .json du générateur)")]
        [Tooltip("Rayon de la roue, pneu compris (m) : geometrie.rayon_roue du rapport.")]
        public float rayonRoue = 0.339f;

        [Header("Niveaux de détail")]
        [Tooltip("Crée un LOD Group à partir des suffixes _LOD0, _LOD1, _LOD2 s'il n'y en a pas (import .glb).")]
        public bool creerLodGroup = true;

        [Tooltip("Vélo du joueur : toujours au niveau 0 (on le voit de près dans le casque).")]
        public bool toujoursLod0;

        [Tooltip("Hauteur à l'écran (fraction) sous laquelle on passe au niveau suivant : LOD0→1, 1→2, 2→caché.")]
        public float[] seuilsLod = { 0.25f, 0.08f, 0.015f };

        sealed class Pivot
        {
            public Transform t;
            public Quaternion rot0;
            public Vector3 axe; // dans le repère du parent

            public void Tourner(float degres) => t.localRotation = Quaternion.AngleAxis(degres, axe) * rot0;
        }

        Pivot roueAvant, roueArriere, pedalier, pedaleD, pedaleG, direction;
        float angleRoues, angleManivelle;

        void Awake()
        {
            Transform tRoueAv = Chercher(transform, "Pivot_RoueAvant");
            Transform tRoueAr = Chercher(transform, "Pivot_RoueArriere");
            Transform tSelle = Chercher(transform, "Ancre_Selle");
            if (tRoueAv == null || tRoueAr == null || tSelle == null)
            {
                Debug.LogWarning($"{name} : pivots du vélo introuvables (Pivot_RoueAvant, Pivot_RoueArriere, Ancre_Selle).", this);
                enabled = false;
                return;
            }

            // repère du vélo dans le monde, tiré des pivots
            Vector3 avant = (tRoueAv.position - tRoueAr.position).normalized;
            Vector3 haut = Vector3.ProjectOnPlane(tSelle.position - tRoueAr.position, avant).normalized;
            Vector3 droite = Vector3.Cross(haut, avant);

            roueAvant = Creer(tRoueAv, droite);
            roueArriere = Creer(tRoueAr, droite);
            pedalier = Creer(Chercher(transform, "Pivot_Pedalier"), droite);
            pedaleD = Creer(Chercher(transform, "Pivot_PedaleD"), droite);
            pedaleG = Creer(Chercher(transform, "Pivot_PedaleG"), droite);
            Transform tDir = Chercher(transform, "Pivot_Direction");
            Transform tAxe = Chercher(transform, "Repere_AxeDirection");
            if (tDir != null && tAxe != null)
                direction = Creer(tDir, (tAxe.position - tDir.position).normalized);

            LODGroup groupe = GetComponentInChildren<LODGroup>();
            if (groupe == null && creerLodGroup)
                groupe = CreerLodGroup();
            if (groupe != null && toujoursLod0)
                groupe.ForceLOD(0);
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (rayonRoue > 0f)
                angleRoues = Mathf.Repeat(angleRoues + vitesse / rayonRoue * Mathf.Rad2Deg * dt, 360f);
            angleManivelle = Mathf.Repeat(angleManivelle + cadence * 6f * dt, 360f); // tr/min → degrés/s

            roueAvant?.Tourner(angleRoues);
            roueArriere?.Tourner(angleRoues);
            pedalier?.Tourner(angleManivelle);
            pedaleD?.Tourner(-angleManivelle); // les pédales tournent à l'envers du pédalier : elles restent à plat
            pedaleG?.Tourner(-angleManivelle);
            direction?.Tourner(braquage);
        }

        static Pivot Creer(Transform t, Vector3 axeMonde)
        {
            if (t == null)
                return null;
            Vector3 axe = t.parent != null ? t.parent.InverseTransformDirection(axeMonde) : axeMonde;
            return new Pivot { t = t, rot0 = t.localRotation, axe = axe.normalized };
        }

        static Transform Chercher(Transform racine, string nom)
        {
            if (racine.name == nom)
                return racine;
            foreach (Transform enfant in racine)
            {
                Transform trouve = Chercher(enfant, nom);
                if (trouve != null)
                    return trouve;
            }
            return null;
        }

        static readonly Regex SuffixeLod = new Regex(@"_LOD(\d+)$");

        /// <summary>LOD Group construit d'après les noms : Cadre_LOD0, RoueAvant_LOD1… (glTFast n'en crée pas).</summary>
        LODGroup CreerLodGroup()
        {
            var niveaux = new SortedDictionary<int, List<Renderer>>();
            foreach (Renderer r in GetComponentsInChildren<Renderer>(true))
            {
                Match m = SuffixeLod.Match(r.name);
                if (!m.Success && r.transform.parent != null)
                    m = SuffixeLod.Match(r.transform.parent.name); // primitive rangée sous le nœud du maillage
                if (!m.Success)
                    continue;
                int n = int.Parse(m.Groups[1].Value);
                if (!niveaux.TryGetValue(n, out List<Renderer> liste))
                    niveaux[n] = liste = new List<Renderer>();
                liste.Add(r);
            }
            if (niveaux.Count < 2)
                return null;

            var lods = new List<LOD>();
            foreach (KeyValuePair<int, List<Renderer>> niveau in niveaux)
            {
                int i = lods.Count;
                float seuil = i < seuilsLod.Length ? seuilsLod[i] : 0.01f / (i + 1);
                lods.Add(new LOD(seuil, niveau.Value.ToArray()));
            }
            LODGroup groupe = gameObject.AddComponent<LODGroup>();
            groupe.SetLODs(lods.ToArray());
            groupe.RecalculateBounds();
            return groupe;
        }
    }
}
