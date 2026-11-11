// Wattlas — le magasin, porté de Commun/js/engine/catalog.js : articles, équipement de base et réglages complets
// (fullSetup → Catalogue.Equiper). Les identifiants sont ceux du site : un vélo acheté dans le jeu web s'équipe pareil ici.
using System.Collections.Generic;

namespace Wattlas.Domaine
{
    public sealed class Article
    {
        public readonly string Id;
        public readonly string Nom;
        public readonly double Prix;
        /// <summary>Masse (kg) pour le cadre, les roues et les pneus ; NaN sinon.</summary>
        public readonly double Masse;
        /// <summary>Champ réglé (« cycliste.Tenue », « velo.Roues »…) et sa valeur dans le moteur.</summary>
        public readonly string Champ;
        public readonly string Valeur;

        public Article(string id, string nom, double prix, double masse, string champ, string valeur)
        {
            Id = id;
            Nom = nom;
            Prix = prix;
            Masse = masse;
            Champ = champ;
            Valeur = valeur;
        }
    }

    public static class Catalogue
    {
        /// <summary>Catégories, dans l'ordre où elles s'appliquent (une combinaison passe après le maillot).</summary>
        public static readonly string[] Categories = { "frame", "wheels", "tires", "drivetrain", "helmet", "glasses", "kit", "suit", "socks", "shoes", "shave" };

        const double SansMasse = double.NaN;

        public static readonly Dictionary<string, Article[]> Articles = new Dictionary<string, Article[]>
        {
            ["frame"] = new[]
            {
                new Article("alu", "Alu Sport", 900, 8.4, "velo.Cadre", "road"),
                new Article("endurance", "Carbone Endurance", 2200, 7.1, "velo.Cadre", "road"),
                new Article("climber", "Carbone Grimpeur", 4800, 5.5, "velo.Cadre", "climber"),
                new Article("aero", "Carbone Aéro", 5200, 6.7, "velo.Cadre", "aero"),
                new Article("tt", "Contre-la-montre", 6500, 7.6, "velo.Cadre", "tt"),
                new Article("gravel", "Gravel Alu", 1400, 8.8, "velo.Cadre", "gravel"),
            },
            ["wheels"] = new[]
            {
                new Article("box", "Jante plate", 180, 2.0, "velo.Roues", "box"),
                new Article("alu", "Alu 25 mm", 250, 1.9, "velo.Roues", "low"),
                new Article("climb", "Carbone 30 mm", 1600, 1.25, "velo.Roues", "low"),
                new Article("c45", "Carbone 45 mm", 1400, 1.45, "velo.Roues", "mid"),
                new Article("c65", "Carbone 60 mm", 1900, 1.65, "velo.Roues", "deep"),
                new Article("c80", "Carbone 80 mm", 2300, 1.85, "velo.Roues", "deep80"),
                new Article("disc", "Lenticulaire + 80 mm", 3300, 2.0, "velo.Roues", "disc"),
                new Article("gravel", "Gravel 25 mm", 650, 1.75, "velo.Roues", "spoked"),
            },
            ["tires"] = new[]
            {
                new Article("training", "Renforcé anti-crevaison", 60, 0.9, "velo.Pneu", "training"),
                new Article("road", "Route polyvalent", 80, 0.56, "velo.Pneu", "road"),
                new Article("tubeless", "Tubeless + préventif", 150, 0.6, "velo.Pneu", "tubeless"),
                new Article("race", "Course latex", 160, 0.46, "velo.Pneu", "race"),
                new Article("gravel", "Gravel 40 mm", 120, 0.9, "velo.Pneu", "gravel"),
            },
            ["drivetrain"] = new[]
            {
                new Article("lube", "Chaîne lubrifiée", 35, SansMasse, "velo.Transmission", "clean"),
                new Article("wax", "Chaîne cirée", 90, SansMasse, "velo.Transmission", "waxed"),
            },
            ["helmet"] = new[]
            {
                new Article("city", "Urbain", 50, SansMasse, "cycliste.Casque", "city"),
                new Article("road", "Route ventilé", 110, SansMasse, "cycliste.Casque", "road"),
                new Article("aero", "Aéro route", 230, SansMasse, "cycliste.Casque", "aero"),
                new Article("tt", "Chrono", 380, SansMasse, "cycliste.Casque", "tt"),
            },
            ["glasses"] = new[]
            {
                new Article("none", "Sans lunettes", 0, SansMasse, "cycliste.Lunettes", "none"),
                new Article("sport", "Lunettes de sport", 90, SansMasse, "cycliste.Lunettes", "sport"),
                new Article("shield", "Écran panoramique", 180, SansMasse, "cycliste.Lunettes", "shield"),
            },
            ["kit"] = new[]
            {
                new Article("loose", "Tenue ample", 60, SansMasse, "cycliste.Tenue", "loose"),
                new Article("fitted", "Maillot et cuissard", 160, SansMasse, "cycliste.Tenue", "fitted"),
                new Article("aero", "Maillot aéro", 230, SansMasse, "cycliste.Tenue", "aero"),
            },
            ["suit"] = new[]
            {
                new Article("road", "Combinaison route", 320, SansMasse, "cycliste.Tenue", "skinsuit"),
                new Article("tt", "Combinaison chrono", 450, SansMasse, "cycliste.Tenue", "skinsuit_tt"),
            },
            ["socks"] = new[]
            {
                new Article("short", "Socquettes", 10, SansMasse, "cycliste.Chaussettes", "short"),
                new Article("classic", "Chaussettes mi-mollet", 15, SansMasse, "cycliste.Chaussettes", "classic"),
                new Article("aero", "Chaussettes aéro", 35, SansMasse, "cycliste.Chaussettes", "aero"),
            },
            ["shoes"] = new[]
            {
                new Article("flat", "Baskets", 60, SansMasse, "velo.Chaussures", "flat"),
                new Article("mtb", "VTT / gravel", 130, SansMasse, "velo.Chaussures", "mtb"),
                new Article("road", "Route", 160, SansMasse, "velo.Chaussures", "road"),
                new Article("carbon", "Route carbone", 360, SansMasse, "velo.Chaussures", "carbon"),
                new Article("aero", "Carbone + couvre-chaussures", 430, SansMasse, "velo.Chaussures", "aero"),
            },
            ["shave"] = new[]
            {
                new Article("none", "Au naturel", 0, SansMasse, "cycliste.Epilation", "none"),
                new Article("legs", "Jambes rasées", 5, SansMasse, "cycliste.Epilation", "legs"),
                new Article("full", "Jambes et bras épilés", 60, SansMasse, "cycliste.Epilation", "full"),
            },
        };

        /// <summary>Équipement « d'entrée de gamme » (BASE).</summary>
        public static readonly Dictionary<string, string> Base = new Dictionary<string, string>
        {
            ["frame"] = "alu", ["wheels"] = "alu", ["tires"] = "road", ["drivetrain"] = "lube", ["helmet"] = "road",
            ["glasses"] = "sport", ["kit"] = "fitted", ["socks"] = "classic", ["shoes"] = "road", ["shave"] = "none",
        };

        public static Article Trouver(string categorie, string id)
        {
            Article[] liste;
            if (id == null || !Articles.TryGetValue(categorie, out liste))
                return null;
            foreach (Article a in liste)
                if (a.Id == id)
                    return a;
            return null;
        }

        /// <summary>Réglages complets d'une sélection du magasin (fullSetup) : copie du cycliste et du vélo, équipés.</summary>
        public static void Equiper(IDictionary<string, string> selection, Cycliste cycliste, Velo velo, out Cycliste c, out Velo v)
        {
            var s = new Dictionary<string, string>(Base);
            if (selection != null)
                foreach (KeyValuePair<string, string> kv in selection)
                    s[kv.Key] = kv.Value;
            c = (cycliste ?? new Cycliste()).Copie();
            v = (velo ?? new Velo()).Copie();
            foreach (string cat in Categories)
            {
                string id;
                Article a = s.TryGetValue(cat, out id) ? Trouver(cat, id) : null;
                if (a != null)
                    Appliquer(a, c, v);
            }
            Article f = Trouver("frame", s["frame"]) ?? Trouver("frame", Base["frame"]);
            Article w = Trouver("wheels", s["wheels"]) ?? Trouver("wheels", Base["wheels"]);
            Article t = Trouver("tires", s["tires"]) ?? Trouver("tires", Base["tires"]);
            v.Masse = f.Masse + w.Masse + t.Masse;
            v.MasseRoues = w.Masse + t.Masse;
        }

        static void Appliquer(Article a, Cycliste c, Velo v)
        {
            switch (a.Champ)
            {
                case "velo.Cadre": v.Cadre = a.Valeur; break;
                case "velo.Roues": v.Roues = a.Valeur; break;
                case "velo.Pneu": v.Pneu = a.Valeur; break;
                case "velo.Transmission": v.Transmission = a.Valeur; break;
                case "velo.Chaussures": v.Chaussures = a.Valeur; break;
                case "cycliste.Casque": c.Casque = a.Valeur; break;
                case "cycliste.Lunettes": c.Lunettes = a.Valeur; break;
                case "cycliste.Tenue": c.Tenue = a.Valeur; break;
                case "cycliste.Chaussettes": c.Chaussettes = a.Valeur; break;
                case "cycliste.Epilation": c.Epilation = a.Valeur; break;
            }
        }
    }
}
