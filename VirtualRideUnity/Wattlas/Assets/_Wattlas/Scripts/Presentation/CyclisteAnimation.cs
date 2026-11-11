using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Anime un cycliste produit par VirtualRideUnity/blender/cycliste.py : chaque clip est un tour de pédalier
    /// (Pedalage_hoods, Pedalage_drops…, Danseuse_hoods, Danseuse_drops). Le temps des clips suit l'angle du pédalier
    /// du vélo (VeloAnimation) : les pieds restent sur les pédales à toutes les cadences, et la roue libre fige la pose.
    /// Les positions se fondent l'une dans l'autre (changement de prise, passage en danseuse).
    ///
    /// À poser sur la racine du cycliste (avec son Animator, sans contrôleur), enfant du vélo.
    /// </summary>
    [RequireComponent(typeof(Animator))]
    public sealed class CyclisteAnimation : MonoBehaviour
    {
        [Tooltip("Clips importés du .fbx du cycliste (rangés par le constructeur de projet).")]
        public AnimationClip[] clips;

        [Tooltip("Le vélo sous le cycliste (son pédalier donne le temps des clips).")]
        public VeloAnimation velo;

        [Tooltip("Position du magasin : upright, tops, hoods, hoods_bent, drops, forearms.")]
        public string position = "hoods";

        [Tooltip("En danseuse (hors de la selle).")]
        public bool danseuse;

        [Tooltip("Durée d'un changement de position (s).")]
        public float transition = 0.35f;

        [Tooltip("Balancement du vélo en danseuse (degrés).")]
        public float balancement = 7f;

        PlayableGraph graphe;
        AnimationMixerPlayable melangeur;
        AnimationClipPlayable[] lecteurs;
        float[] poids;

        void OnEnable()
        {
            if (clips == null || clips.Length == 0)
                return;
            if (velo == null)
                velo = GetComponentInParent<VeloAnimation>();
            graphe = PlayableGraph.Create(name + " · pédalage");
            graphe.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            var sortie = AnimationPlayableOutput.Create(graphe, "Cycliste", GetComponent<Animator>());
            melangeur = AnimationMixerPlayable.Create(graphe, clips.Length);
            lecteurs = new AnimationClipPlayable[clips.Length];
            poids = new float[clips.Length];
            for (int i = 0; i < clips.Length; i++)
            {
                lecteurs[i] = AnimationClipPlayable.Create(graphe, clips[i]);
                lecteurs[i].SetApplyFootIK(false);
                graphe.Connect(lecteurs[i], 0, melangeur, i);
            }
            sortie.SetSourcePlayable(melangeur);
            int c = Index(Cible());
            for (int i = 0; i < clips.Length; i++)
                poids[i] = i == c ? 1f : 0f;
            graphe.Play();
        }

        void OnDisable()
        {
            if (graphe.IsValid())
                graphe.Destroy();
        }

        /// <summary>Nom du clip voulu : Danseuse_hoods / Danseuse_drops en danseuse, sinon Pedalage_&lt;position&gt;.</summary>
        string Cible()
        {
            if (danseuse)
                return position == "drops" ? "Danseuse_drops" : "Danseuse_hoods";
            return "Pedalage_" + position;
        }

        int Index(string nom)
        {
            int repli = -1;
            for (int i = 0; i < clips.Length; i++)
            {
                if (clips[i] == null)
                    continue;
                string n = clips[i].name;
                if (n == nom || n.EndsWith("|" + nom) || n.EndsWith(nom))   // le FBX préfixe les prises : « Cycliste_M|Pedalage_hoods »
                    return i;
                if (n.EndsWith("Pedalage_hoods"))
                    repli = i;
            }
            return repli >= 0 ? repli : 0;
        }

        void LateUpdate()
        {
            if (!graphe.IsValid() || lecteurs == null)
                return;
            float angle = velo != null ? velo.AngleManivelle : 0f;
            float phase = angle / 360f;
            int cible = Index(Cible());
            float pas = transition > 0 ? Time.deltaTime / transition : 1f;
            float somme = 0f;
            for (int i = 0; i < lecteurs.Length; i++)
            {
                poids[i] = Mathf.MoveTowards(poids[i], i == cible ? 1f : 0f, pas);
                somme += poids[i];
            }
            float danse = 0f;
            for (int i = 0; i < lecteurs.Length; i++)
            {
                float w = somme > 0 ? poids[i] / somme : 0f;
                melangeur.SetInputWeight(i, w);
                lecteurs[i].SetTime(phase * clips[i].length);
                if (clips[i].name.Contains("Danseuse"))
                    danse += w;
            }
            graphe.Evaluate(0f);
            // en danseuse, le vélo se balance sous le cycliste : penché à gauche quand le pied droit appuie (vers 45°)
            if (velo != null)
                velo.roulisPedalage = -balancement * danse * Mathf.Sin((angle + 45f) * Mathf.Deg2Rad);
        }
    }
}
