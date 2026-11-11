using System.Text;
using UnityEngine;
using Wattlas.Jeu;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Compteur du joueur : puissance, vitesse, cadence, W′, pente, distance, abri et classement.
    /// À l'écran, un panneau en haut à gauche ; dans le casque, un petit afficheur posé sur la potence du vélo.
    /// </summary>
    public sealed class Compteur : MonoBehaviour
    {
        public Course course;
        public Coureur joueur;
        public Adaptateurs.PuissanceClavierManette commandes;
        [Tooltip("Afficheur du casque : enfant de la direction du vélo du joueur (créé par la démo).")]
        public TextMesh afficheurVR;

        string texte = "";
        float prochaineMaj;

        void Update()
        {
            if (course == null || joueur == null || Time.time < prochaineMaj)
                return;
            prochaineMaj = Time.time + 0.2f;
            double x, y, z, cap, pente;
            course.Parcours.Echantillonner(joueur.S, out x, out y, out z, out cap, out pente);
            int rang = course.Classement().IndexOf(joueur) + 1;
            var sb = new StringBuilder();
            sb.AppendFormat("{0:0} W{1}   {2:0.0} km/h   {3:0} tr/min\n", joueur.Puissance,
                commandes != null && commandes.RoueLibre ? " (roue libre)" : "", joueur.V * 3.6, joueur.Cadence);
            sb.AppendFormat("W′ {0:0} %   pente {1:+0.0;-0.0;0.0} %   abri {2:0} %\n", 100 * joueur.WBal / joueur.W0, pente * 100, joueur.Abri * 100);
            sb.AppendFormat("{0:0.00} / {1:0.00} km   {2}   {3}e sur {4}", joueur.S / 1000, course.Parcours.Longueur / 1000,
                Duree(joueur.Arrive ? joueur.TempsArrivee : course.Temps), rang, course.Coureurs.Count);
            if (joueur.Arrive)
                sb.Append("\nArrivé !");
            texte = sb.ToString();
            if (afficheurVR != null)
                afficheurVR.text = texte;
        }

        static string Duree(double s)
        {
            int t = (int)s;
            return string.Format("{0}:{1:00}:{2:00}", t / 3600, t / 60 % 60, t % 60);
        }

        void OnGUI()
        {
            if (string.IsNullOrEmpty(texte) || (afficheurVR != null && afficheurVR.gameObject.activeInHierarchy))
                return;
            var style = new GUIStyle(GUI.skin.box) { fontSize = Mathf.Max(14, Screen.height / 45), alignment = TextAnchor.UpperLeft };
            style.normal.textColor = Color.white;
            var aide = "↑ ↓ puissance (Maj : 50 W) · 0 roue libre · ← → place · 1–6 position · C caméra";
            GUI.Box(new Rect(12, 12, Screen.width * 0.42f, style.fontSize * 5.2f), texte + "\n" + aide, style);
        }
    }
}
