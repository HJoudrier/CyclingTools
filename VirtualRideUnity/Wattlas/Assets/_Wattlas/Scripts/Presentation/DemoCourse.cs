using System.Collections.Generic;
using UnityEngine;
using Wattlas.Adaptateurs;
using Wattlas.Domaine;
using Wattlas.Jeu;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Démonstration (racine de composition) : un parcours GPX, la route, le joueur sur son vélo et des coureurs virtuels.
    /// La simulation vient du domaine porté du site (Physique, Roulage) ; la puissance du joueur, du clavier, de la manette
    /// ou des manettes du casque. Dans le casque (Meta Quest, OpenXR), la vue est celle du cycliste.
    /// </summary>
    public sealed class DemoCourse : MonoBehaviour
    {
        [Header("Parcours")]
        [Tooltip("Fichier GPX (renommé en .xml pour que Unity le lise comme un texte).")]
        public TextAsset gpx;

        [Header("Modèles (préfabs du menu Wattlas › Construire la scène de démonstration)")]
        public GameObject velo;
        public GameObject cycliste;
        public GameObject[] velosAdversaires;
        public GameObject[] cyclistesAdversaires;
        [Tooltip("Rayon de la roue du vélo (rapport du générateur : geometrie.rayon_roue).")]
        public float rayonRoue = 0.339f;

        [Header("Matériaux de la route")]
        public Material chaussee;
        public Material accotement;
        public Material herbe;

        [Header("Joueur : matériel (identifiants du magasin de Wattlas)")]
        public string cadre = "aero", roues = "c45", pneus = "race", transmission = "wax";
        public string casque = "aero", lunettes = "shield", tenue = "fitted", chaussettes = "aero", chaussures = "carbon";
        public string position = "hoods";
        public Color maillot = new Color32(0xC8, 0x10, 0x2E, 255);
        public Color accent = new Color32(0xF2, 0xF2, 0xF2, 255);

        [Header("Joueur : athlète")]
        public float masse = 72f, taille = 178f, age = 35f;
        [Tooltip("Puissance critique (W) et réserve anaérobie W′ (J).")]
        public float cp = 280f, wPrime = 20000f;

        [Header("Coureurs virtuels")]
        [Range(0, 30)] public int adversaires = 7;
        public float puissanceAdversaires = 240f;
        public int graine = 1234;

        sealed class Vue
        {
            public Coureur coureur;
            public Transform racine;
            public VeloAnimation velo;
            public CyclisteAnimation animation;
            public CyclisteEquipement equipement;
            public float roulis;
        }

        static readonly Color[] Equipes =
        {
            new Color32(0x1F, 0x4E, 0x9C, 255), new Color32(0x0B, 0x6E, 0x4F, 255), new Color32(0xF2, 0xC2, 0x30, 255),
            new Color32(0x11, 0x11, 0x11, 255), new Color32(0x7A, 0x1F, 0x8C, 255), new Color32(0xE8, 0x6A, 0x10, 255),
        };

        Parcours parcours;
        Course course;
        PuissanceClavierManette commandes;
        readonly List<Vue> vues = new List<Vue>();
        Vue joueur;

        void Start()
        {
            if (gpx == null || velo == null || cycliste == null)
            {
                Debug.LogError("DemoCourse : il manque le GPX ou les modèles (menu Wattlas › Construire la scène de démonstration).", this);
                enabled = false;
                return;
            }
            parcours = Parcours.DepuisPoints(gpx.name, Gpx.Lire(gpx.text));
            RouteMaillage.Construire(parcours, transform, chaussee, accotement, herbe);
            course = new Course(parcours);

            // joueur : réglages du moteur d'après la sélection du magasin
            var selection = new Dictionary<string, string>
            {
                ["frame"] = cadre, ["wheels"] = roues, ["tires"] = pneus, ["drivetrain"] = transmission, ["helmet"] = casque,
                ["glasses"] = lunettes, ["socks"] = chaussettes, ["shoes"] = chaussures,
            };
            if (tenue == "skinsuit") selection["suit"] = "road";
            else if (tenue == "skinsuit_tt") selection["suit"] = "tt";
            else selection["kit"] = tenue;
            Cycliste c;
            Velo v;
            Catalogue.Equiper(selection, new Cycliste { Masse = masse, Taille = taille, Age = age, Position = position }, new Velo(), out c, out v);
            commandes = new PuissanceClavierManette { Cible = Mathf.Round(cp * 0.7f / 5f) * 5f };
            var moi = course.Ajouter(new Coureur("Joueur", Physique.Regler(c, v), Braquets.Route(rayonRoue), commandes)
            {
                Cp = cp, W0 = wPrime, RecF = Roulage.FacteurRecuperation(age),
            });
            joueur = CreerVue(moi, velo, cycliste, true, maillot, accent);
            joueur.equipement.casque = casque;
            joueur.equipement.lunettes = lunettes;
            joueur.equipement.chaussures = chaussures;
            joueur.equipement.tenue = tenue;
            joueur.equipement.chaussettes = chaussettes;
            joueur.equipement.Appliquer();
            joueur.animation.position = position;

            // coureurs virtuels : en file sur deux voies, juste devant le joueur
            var hasard = new System.Random(graine);
            for (int i = 0; i < adversaires; i++)
            {
                var r = Physique.Regler(new Cycliste { Masse = 62 + 16 * hasard.NextDouble(), Taille = 168 + 20 * hasard.NextDouble(), Position = "hoods" },
                                        new Velo { Masse = 7.2, MasseRoues = 1.9, Cadre = "aero", Roues = "mid", Pneu = "race", Transmission = "clean" });
                var source = new PuissanceAllure(puissanceAdversaires * (0.85 + 0.3 * hasard.NextDouble()));
                var co = course.Ajouter(new Coureur("Coureur " + (i + 1), r, Braquets.Route(rayonRoue), source) { Cp = 300, W0 = 22000 });
                co.S = 2.2 * (i / 2 + 1);
                co.Decalage = i % 2 == 0 ? -0.55 : 0.55;
                Color equipe = Equipes[i % Equipes.Length];
                GameObject mv = Choisir(velosAdversaires, velo, i), mc = Choisir(cyclistesAdversaires, cycliste, i);
                Vue vue = CreerVue(co, mv, mc, false, equipe, i % 3 == 0 ? Color.white : Color.black);
                vue.equipement.casque = i % 4 == 0 ? "aero" : "road";
                vue.equipement.tenue = i % 3 == 0 ? "skinsuit" : "aero";
                vue.equipement.couleurCasque = equipe;
                vue.equipement.Appliquer();
            }

            // caméra et compteur
            Camera cam = Camera.main;
            if (cam != null)
            {
                cam.farClipPlane = 2500f;
                var cj = cam.GetComponent<CameraJoueur>();
                if (cj == null)
                    cj = cam.gameObject.AddComponent<CameraJoueur>();
                cj.coureur = joueur.racine;
                cj.yeux = VeloAnimation.Chercher(joueur.equipement.transform, "Ancre_Yeux");
                cj.equipement = joueur.equipement;
            }
            var compteur = gameObject.AddComponent<Compteur>();
            compteur.course = course;
            compteur.joueur = moi;
            compteur.commandes = commandes;
            compteur.afficheurVR = CreerAfficheur(joueur);
            compteur.afficheurVR.gameObject.SetActive(UnityEngine.XR.XRSettings.isDeviceActive);
            foreach (Vue vue in vues)
                Placer(vue, 0f);
        }

        static GameObject Choisir(GameObject[] liste, GameObject defaut, int i)
        {
            if (liste == null || liste.Length == 0)
                return defaut;
            GameObject g = liste[i % liste.Length];
            return g != null ? g : defaut;
        }

        Vue CreerVue(Coureur c, GameObject modeleVelo, GameObject modeleCycliste, bool estJoueur, Color couleur, Color couleurAccent)
        {
            var racine = new GameObject(c.Nom).transform;
            racine.SetParent(transform, false);
            GameObject v = Instantiate(modeleVelo, racine, false);
            var va = v.GetComponent<VeloAnimation>();
            if (va == null)
                va = v.AddComponent<VeloAnimation>();
            va.rayonRoue = rayonRoue;
            va.toujoursLod0 = estJoueur;
            GameObject cy = Instantiate(modeleCycliste, v.transform, false);
            cy.transform.localPosition = Vector3.zero;   // même origine que le vélo (rotation : celle du préfab, selon l'import)
            var anim = cy.GetComponent<CyclisteAnimation>();
            if (anim == null)
                anim = cy.AddComponent<CyclisteAnimation>();
            anim.velo = va;
            var eq = cy.GetComponent<CyclisteEquipement>();
            if (eq == null)
                eq = cy.AddComponent<CyclisteEquipement>();
            eq.maillot = couleur;
            eq.accent = couleurAccent;
            if (estJoueur)
            {
                LODGroup lg = cy.GetComponent<LODGroup>();
                if (lg != null)
                    lg.ForceLOD(0);
            }
            var vue = new Vue { coureur = c, racine = racine, velo = va, animation = anim, equipement = eq };
            vues.Add(vue);
            return vue;
        }

        static TextMesh CreerAfficheur(Vue vue)
        {
            Transform direction = VeloAnimation.Chercher(vue.velo.transform, "Pivot_Direction");
            var go = new GameObject("Compteur (casque)");
            go.transform.SetParent(direction != null ? direction : vue.velo.transform, false);
            go.transform.position = (direction != null ? direction.position : vue.velo.transform.position) + vue.racine.up * 0.32f
                                    + vue.racine.forward * 0.02f;
            go.transform.rotation = Quaternion.LookRotation(vue.racine.forward, vue.racine.up) * Quaternion.Euler(35f, 0f, 0f);
            var t = go.AddComponent<TextMesh>();
            t.characterSize = 0.006f;
            t.fontSize = 48;
            t.anchor = TextAnchor.MiddleCenter;
            t.alignment = TextAlignment.Center;
            t.color = new Color(0.95f, 0.97f, 1f);
            Font police = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (police != null)
            {
                t.font = police;
                go.GetComponent<MeshRenderer>().sharedMaterial = police.material;
            }
            return t;
        }

        void Update()
        {
            if (course == null)
                return;
            float dt = Mathf.Min(Time.deltaTime, 0.1f);
            commandes.MettreAJour(dt);
            if (commandes.Position != null)
                joueur.animation.position = commandes.Position;
            joueur.coureur.Decalage = Mathf.Clamp((float)joueur.coureur.Decalage + commandes.Lateral * 1.5f * dt, -2.6f, 2.6f);
            course.Avancer(dt);
            foreach (Vue vue in vues)
                Placer(vue, dt);
        }

        void Placer(Vue vue, float dt)
        {
            Coureur c = vue.coureur;
            double x, y, z, cap, pente;
            parcours.Echantillonner(c.S, out x, out y, out z, out cap, out pente);
            Vector3 pos = RouteMaillage.Position(parcours, c.S, c.Decalage);
            float d = (float)c.Decalage / 3f;
            pos.y += 0.06f * Mathf.Max(0f, 1f - d * d);   // bombé de la chaussée
            vue.racine.SetPositionAndRotation(pos, Quaternion.Euler(-Mathf.Atan((float)pente) * Mathf.Rad2Deg, (float)(cap * Mathf.Rad2Deg), 0f));

            // inclinaison dans les virages : tan(roulis) = v² × courbure / g ; un peu de braquage
            float courbure = (float)parcours.Courbure(c.S);
            float cible = Mathf.Atan((float)(c.V * c.V) * courbure / 9.81f) * Mathf.Rad2Deg;
            vue.roulis = dt > 0 ? Mathf.Lerp(vue.roulis, Mathf.Clamp(cible, -35f, 35f), 1f - Mathf.Exp(-4f * dt)) : cible;
            vue.velo.roulis = vue.roulis;
            vue.velo.braquage = Mathf.Clamp(Mathf.Atan(1.0f * courbure) * Mathf.Rad2Deg, -20f, 20f);
            vue.velo.vitesse = (float)c.V;
            vue.velo.cadence = (float)c.Cadence;
            // en danseuse dans les fortes pentes et au sprint
            bool fort = c.Puissance > 1.2 * c.Cp;
            vue.animation.danseuse = fort && (pente > 0.05 || c.V > 12.5);
            if (vue != joueur && vue.animation.danseuse && c.V > 12.5)
                vue.animation.position = "drops";
        }
    }
}
