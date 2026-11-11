using UnityEngine;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Habille un cycliste produit par VirtualRideUnity/blender/cycliste.py avec l'équipement du magasin de Wattlas :
    /// active le bon casque, les bonnes lunettes et les bonnes chaussures (tous sont dans le modèle), et fabrique la texture
    /// de la tenue (manches, cuissard, chaussettes, gants, couleurs) sans toucher au maillage.
    ///
    /// vueInterne : le joueur dans le casque ne voit pas l'intérieur de sa tête (l'os de la tête est réduit à rien).
    /// </summary>
    public sealed class CyclisteEquipement : MonoBehaviour
    {
        [Header("Équipement (identifiants du magasin)")]
        public string casque = "road";      // road, city, aero, tt
        public string lunettes = "sport";   // none, sport, shield
        public string chaussures = "road";  // flat, mtb, road, carbon, aero
        public string tenue = "fitted";     // loose, fitted, aero, skinsuit, skinsuit_tt
        public string chaussettes = "classic"; // short, classic, aero

        [Header("Couleurs")]
        public Color maillot = new Color32(0xC8, 0x10, 0x2E, 255);
        public Color accent = new Color32(0xF2, 0xF2, 0xF2, 255);
        public bool bande = true;
        public Color cuissard = new Color32(0x16, 0x16, 0x1A, 255);
        public Color gants = new Color32(0x16, 0x16, 0x1A, 255);
        public Color couleurChaussettes = new Color32(0xF2, 0xF2, 0xF2, 255);
        public Color peau = new Color32(0xC9, 0x9A, 0x7A, 255);
        public Color couleurCasque = new Color32(0xF2, 0xF2, 0xF2, 255);
        public Color couleurChaussures = new Color32(0xF2, 0xF2, 0xF2, 255);
        public Color cheveux = new Color32(0x4A, 0x34, 0x23, 255);

        [Header("Joueur")]
        [Tooltip("Vue depuis les yeux du cycliste : la tête et ce qu'elle porte disparaissent pour la caméra.")]
        public bool vueInterne;

        Material materiau;
        Texture2D couleurs, metal;
        Transform tete;

        void Awake()
        {
            tete = VeloAnimation.Chercher(transform, "Head");
            Appliquer();
        }

        void OnDestroy()
        {
            if (materiau != null) Destroy(materiau);
            if (couleurs != null) Destroy(couleurs);
            if (metal != null) Destroy(metal);
        }

        /// <summary>Active les équipements choisis et refait la texture de la tenue.</summary>
        public void Appliquer()
        {
            foreach (Renderer r in GetComponentsInChildren<Renderer>(true))
                r.gameObject.SetActive(Visible(r.name));

            var tenueCycliste = new TenueCycliste
            {
                Tenue = tenue, Chaussettes = chaussettes, Chaussures = chaussures, Bande = bande, Maillot = maillot, Accent = accent,
                Cuissard = cuissard, Gants = gants, CouleurChaussettes = couleurChaussettes, Peau = peau, Casque = couleurCasque,
                CouleurChaussures = couleurChaussures, Cheveux = cheveux,
            };
            if (couleurs == null)
            {
                couleurs = TenueCycliste.NouvelleTexture(false);
                metal = TenueCycliste.NouvelleTexture(true);
            }
            tenueCycliste.Remplir(couleurs, metal);

            Renderer premier = GetComponentInChildren<Renderer>(true);
            if (premier == null)
                return;
            if (materiau == null)
                materiau = new Material(premier.sharedMaterial) { name = name + " · tenue" };
            materiau.SetTexture("_BaseMap", couleurs);
            materiau.SetTexture("_MainTex", couleurs);
            materiau.SetColor("_BaseColor", Color.white);
            materiau.SetTexture("_MetallicGlossMap", metal);
            materiau.SetFloat("_Smoothness", 1f);
            materiau.EnableKeyword("_METALLICSPECGLOSSMAP");
            foreach (Renderer r in GetComponentsInChildren<Renderer>(true))
                r.sharedMaterial = materiau;
        }

        bool Visible(string nom)
        {
            int lod = nom.LastIndexOf("_LOD");
            string n = lod > 0 ? nom.Substring(0, lod) : nom;
            if (n.StartsWith("Casque_"))
                return n == "Casque_" + casque;
            if (n.StartsWith("Lunettes_"))
                return casque != "tt" && n == "Lunettes_" + lunettes;
            if (n.StartsWith("ChaussureD_") || n.StartsWith("ChaussureG_"))
                return n.EndsWith("_" + chaussures);
            return true;
        }

        void LateUpdate()
        {
            if (tete != null)
                tete.localScale = vueInterne ? Vector3.one * 0.001f : Vector3.one;
        }
    }

    /// <summary>
    /// Texture de la tenue : 16 rangées de 4 px sur 64 px. Une rangée par partie du corps ; en largeur, la position le
    /// long du membre. Même table que cycliste.py (couleur_rangee) : garder l'ordre des rangées et les seuils identiques.
    /// </summary>
    public sealed class TenueCycliste
    {
        public static readonly string[] Rangees =
        {
            "tronc", "tete", "bras", "avantbras", "main", "cuisse", "jambe", "casque", "jugulaire", "verre", "monture",
            "chaussure", "semelle", "couvre_chaussure", "cheveux", "oeil",
        };
        public const int Largeur = 64, HauteurRangee = 4;
        const float TroncMax = 1.3f;

        public string Tenue = "fitted", Chaussettes = "classic", Chaussures = "road";
        public bool Bande = true;
        public Color Maillot, Accent, Cuissard, Gants, CouleurChaussettes, Peau, Casque, CouleurChaussures, Cheveux;

        public static Texture2D NouvelleTexture(bool lineaire)
        {
            var t = new Texture2D(Largeur, HauteurRangee * Rangees.Length, TextureFormat.RGBA32, false, lineaire)
            {
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp,
                name = lineaire ? "Tenue · métal" : "Tenue · couleurs",
            };
            return t;
        }

        /// <summary>Remplit la texture de couleurs (sRGB) et celle de métal / lissé (URP : rouge = métal, alpha = lissé).</summary>
        public void Remplir(Texture2D couleurs, Texture2D metal)
        {
            var c = new Color32[Largeur * HauteurRangee * Rangees.Length];
            var m = new Color32[c.Length];
            for (int r = 0; r < Rangees.Length; r++)
                for (int x = 0; x < Largeur; x++)
                {
                    float met, rug;
                    Color col = Couleur(r, (x + 0.5f) / Largeur, out met, out rug);
                    for (int y = 0; y < HauteurRangee; y++)
                    {
                        int i = (r * HauteurRangee + y) * Largeur + x;
                        c[i] = col;
                        byte b = (byte)Mathf.RoundToInt(met * 255);
                        m[i] = new Color32(b, b, b, (byte)Mathf.RoundToInt((1 - rug) * 255));
                    }
                }
            couleurs.SetPixels32(c);
            couleurs.Apply(false);
            metal.SetPixels32(m);
            metal.Apply(false);
        }

        /// <summary>Couleur d'un point de la texture (rangée, position s ∈ [0, 1] le long du membre).</summary>
        public Color Couleur(int rangee, float s, out float metal, out float rugosite)
        {
            metal = 0f;
            rugosite = 0.5f;
            bool longues = Tenue == "skinsuit_tt";
            switch (Rangees[rangee])
            {
                case "tronc":
                {
                    float t = s * TroncMax;
                    if (t > 1f) { rugosite = 0.55f; return Peau; }
                    rugosite = 0.45f;
                    if (t < 0.2f) return Cuissard;   // sous la taille, aussi pour une combinaison (bas foncé)
                    return Bande && t >= 0.55f && t < 0.68f ? Accent : Maillot;
                }
                case "tete":
                    rugosite = 0.55f;
                    return Peau;
                case "bras":
                {
                    float manche = Tenue == "loose" ? 0.65f : Tenue == "aero" || Tenue == "skinsuit" ? 0.85f : 0.55f;
                    rugosite = 0.45f;
                    if (longues) return Maillot;
                    if (s < manche) return Bande && s >= manche - 0.1f ? Accent : Maillot;
                    rugosite = 0.55f;
                    return Peau;
                }
                case "avantbras":
                    if (longues && s < 0.92f) { rugosite = 0.45f; return Bande && s >= 0.82f ? Accent : Maillot; }
                    rugosite = 0.55f;
                    return Peau;
                case "main":
                    rugosite = 0.6f;
                    return s >= 0.15f && s < 0.52f ? Gants : Peau;
                case "cuisse":
                    rugosite = 0.5f;
                    return s < 0.84f ? Cuissard : Peau;
                case "jambe":
                {
                    float haut = Chaussettes == "short" ? 0.12f : Chaussettes == "aero" ? 0.42f : 0.3f;
                    rugosite = 0.7f;
                    return s > 1f - haut ? CouleurChaussettes : Peau;
                }
                case "casque":
                    rugosite = 0.25f;
                    return Casque;
                case "jugulaire":
                    rugosite = 0.7f;
                    return Gris(0.05f);
                case "verre":
                    metal = 0.8f;
                    rugosite = 0.06f;
                    return Srgb(0.10f, 0.12f, 0.16f);
                case "monture":
                    rugosite = 0.35f;
                    return Gris(0.05f);
                case "chaussure":
                    if (Chaussures == "flat") { rugosite = 0.8f; return Srgb(0.45f, 0.45f, 0.47f); }
                    if (Chaussures == "mtb") { rugosite = 0.6f; return Srgb(0.22f, 0.22f, 0.23f); }
                    if (Chaussures == "carbon") { rugosite = 0.25f; return Srgb(0.04f, 0.04f, 0.045f); }
                    rugosite = 0.35f;
                    return CouleurChaussures;
                case "semelle":
                    rugosite = Chaussures == "flat" ? 0.8f : 0.5f;
                    return Chaussures == "flat" ? Srgb(0.85f, 0.85f, 0.83f) : Gris(0.06f);
                case "couvre_chaussure":
                    rugosite = 0.45f;
                    return Srgb(0.04f, 0.04f, 0.045f);
                case "cheveux":
                    rugosite = 0.6f;
                    return Cheveux;
                default:
                    rugosite = 0.15f;
                    return Srgb(0.05f, 0.04f, 0.035f);
            }
        }

        static Color Gris(float v)
        {
            return Srgb(v, v, v);
        }

        /// <summary>Couleur en valeurs sRGB, telles qu'écrites dans couleur_rangee de cycliste.py.</summary>
        static Color Srgb(float r, float g, float b)
        {
            return new Color(r, g, b, 1f);
        }
    }
}
