// Wattlas — modèle mécanique cycliste + vélo, porté de Commun/js/engine/physics.js (mêmes tables, mêmes formules).
// Masse, aérodynamisme (CdA), roulement (Crr), transmission (rendement), densité de l'air.
// Correspondance : frontalRef → SurfaceFrontale, airDensity → DensiteAir, airDensityHumid → DensiteAirHumide,
// buildSetup → Regler, steadyPower → PuissanceStable, steadySpeed → VitesseStable.
using System;

namespace Wattlas.Domaine
{
    public interface IIdentifie
    {
        string Id { get; }
    }

    /// <summary>Une ligne d'une table : identifiant (celui de Wattlas), libellé et effet (facteur ou ΔCdA).</summary>
    public sealed class Choix : IIdentifie
    {
        public string Id { get; }
        public string Libelle { get; }
        public double Valeur { get; }

        public Choix(string id, string libelle, double valeur)
        {
            Id = id;
            Libelle = libelle;
            Valeur = valeur;
        }
    }

    public sealed class Pneu : IIdentifie
    {
        public string Id { get; }
        public string Libelle { get; }
        /// <summary>Coefficient de roulement ; NaN : personnalisé.</summary>
        public double Crr { get; }
        /// <summary>Risque de crevaison par terrain (route, pavés, gravier, chemins), par rapport au pneu route.</summary>
        public double[] Crevaison { get; }
        public bool Preventif { get; }

        public Pneu(string id, string libelle, double crr, double[] crevaison, bool preventif)
        {
            Id = id;
            Libelle = libelle;
            Crr = crr;
            Crevaison = crevaison;
            Preventif = preventif;
        }
    }

    public sealed class Chaussure : IIdentifie
    {
        public string Id { get; }
        public string Libelle { get; }
        /// <summary>Part de la puissance transmise (rigidité de la semelle).</summary>
        public double K { get; }
        public double Masse { get; }
        public double DCda { get; }

        public Chaussure(string id, string libelle, double k, double masse, double dcda)
        {
            Id = id;
            Libelle = libelle;
            K = k;
            Masse = masse;
            DCda = dcda;
        }
    }

    public sealed class Transmission : IIdentifie
    {
        public string Id { get; }
        public string Libelle { get; }
        /// <summary>Rendement ; NaN : personnalisé.</summary>
        public double Rendement { get; }

        public Transmission(string id, string libelle, double rendement)
        {
            Id = id;
            Libelle = libelle;
            Rendement = rendement;
        }
    }

    /// <summary>Cycliste : mêmes champs que « rider » de Wattlas (masse en kg, taille en cm).</summary>
    public sealed class Cycliste
    {
        public double Masse;
        public double Taille;
        public double Age;
        public string Position;
        public string Casque;
        public string Tenue;
        public string Lunettes;
        public string Chaussettes;
        public string Epilation;

        public Cycliste Copie() => (Cycliste)MemberwiseClone();
    }

    /// <summary>Vélo : mêmes champs que « bike » de Wattlas (masses en kg).</summary>
    public sealed class Velo
    {
        public double Masse;
        public double Charge;
        public double MasseRoues;
        public double CdaAjustement;
        public double CdaImposee;
        public double CrrPerso;
        public double RendementPerso;
        public double VitesseMaxPedalageKmh;
        public string Cadre;
        public string Roues;
        public string Pneu;
        public string Transmission;
        public string Chaussures;

        public Velo Copie() => (Velo)MemberwiseClone();
    }

    /// <summary>Paramètres mécaniques effectifs (setup de buildSetup).</summary>
    public sealed class Reglages
    {
        public double MasseCycliste;
        public double MasseVelo;
        public double Masse;
        public double MasseEffective;
        public double MasseRoues;
        public double ARef;
        public double Cda;
        public double CdaEstimee;
        public double CdaImposee;
        public double Crr;
        public double Rendement;
        public string Pneu;
        public double Crevaison;
        /// <summary>Force maximale à la roue au démarrage (couple limité), N.</summary>
        public double FMax;
        /// <summary>Au-delà de cette vitesse (m/s), on ne pédale plus efficacement.</summary>
        public double VPedalage;
    }

    public static class Physique
    {
        public const double G = 9.80665;

        /// <summary>Positions : facteur appliqué à la surface frontale de référence (Bassett et al.).</summary>
        public static readonly Choix[] Positions =
        {
            new Choix("upright", "Position droite (VTT / ville)", 1.35),
            new Choix("tops", "Buste relevé, mains en haut du cintre", 1.25),
            new Choix("hoods", "Mains sur les cocottes, bras tendus", 1.08),
            new Choix("hoods_bent", "Mains sur les cocottes, bras fléchis", 0.98),
            new Choix("drops", "Mains en bas du cintre (drops)", 0.92),
            new Choix("forearms", "Avant-bras à plat sur le cintre", 0.85),
            new Choix("tt", "Prolongateurs (position contre-la-montre)", 0.74),
            new Choix("tt_pro", "CLM optimisée (soufflerie)", 0.66),
        };

        public static readonly Choix[] Casques =
        {
            new Choix("road", "Casque route standard", 0),
            new Choix("city", "Casque urbain", 0.008),
            new Choix("aero", "Casque aéro route", -0.006),
            new Choix("tt", "Casque contre-la-montre", -0.012),
        };

        public static readonly Choix[] Tenues =
        {
            new Choix("loose", "Ample (loisir, coupe-vent)", 0.02),
            new Choix("fitted", "Ajustée (maillot + cuissard)", 0),
            new Choix("aero", "Maillot aéro", -0.006),
            new Choix("skinsuit", "Combinaison (skinsuit)", -0.012),
            new Choix("skinsuit_tt", "Combinaison chrono (manches longues)", -0.016),
        };

        public static readonly Choix[] Lunettes =
        {
            new Choix("none", "Sans lunettes", 0.001),
            new Choix("sport", "Lunettes de sport", 0),
            new Choix("shield", "Écran panoramique", -0.002),
        };

        public static readonly Choix[] Chaussettes =
        {
            new Choix("short", "Socquettes", 0.001),
            new Choix("classic", "Chaussettes mi-mollet", 0),
            new Choix("aero", "Chaussettes aéro (hautes, texturées)", -0.003),
        };

        public static readonly Choix[] Epilations =
        {
            new Choix("none", "Jambes et bras au naturel", 0),
            new Choix("legs", "Jambes rasées", -0.008),
            new Choix("full", "Jambes et bras épilés", -0.010),
        };

        public static readonly Choix[] Cadres =
        {
            new Choix("road", "Route classique", 0),
            new Choix("climber", "Route grimpeur (tubes fins)", 0.002),
            new Choix("aero", "Route aéro", -0.010),
            new Choix("tt", "Contre-la-montre / triathlon", -0.015),
            new Choix("gravel", "Gravel", 0.008),
            new Choix("mtb", "VTT", 0.025),
            new Choix("city", "Ville / randonnée (porte-bagages…)", 0.035),
        };

        public static readonly Choix[] Roues =
        {
            new Choix("box", "Jante plate (≈ 18 mm, 32 rayons)", 0.003),
            new Choix("low", "Profil bas (20–30 mm)", 0),
            new Choix("mid", "Mi-hautes (40–50 mm)", -0.006),
            new Choix("deep", "Hautes (60 mm)", -0.010),
            new Choix("deep80", "Très hautes (80 mm)", -0.012),
            new Choix("disc", "Lenticulaire AR + haute AV", -0.016),
            new Choix("spoked", "Rayons VTT / gravel", 0.004),
        };

        public static readonly Pneu[] Pneus =
        {
            new Pneu("race", "Course haut de gamme (latex)", 0.0030, new[] { 1.6, 1.5, 1.8, 1.6 }, false),
            new Pneu("tubeless", "Tubeless route + liquide préventif", 0.0032, new[] { 0.9, 0.5, 0.8, 0.7 }, true),
            new Pneu("road", "Route standard", 0.0038, new[] { 1.0, 1, 1, 1 }, false),
            new Pneu("training", "Entraînement / renforcé anti-crevaison", 0.0048, new[] { 0.35, 0.6, 0.5, 0.45 }, false),
            new Pneu("gravel", "Gravel (35–45 mm)", 0.0055, new[] { 0.6, 0.25, 0.2, 0.25 }, true),
            new Pneu("mtb", "VTT", 0.0080, new[] { 0.5, 0.2, 0.15, 0.15 }, true),
            new Pneu("custom", "Personnalisé", double.NaN, new[] { 1.0, 1, 1, 1 }, false),
        };

        public static readonly Chaussure[] Chaussures =
        {
            new Chaussure("flat", "Baskets et pédales plates", 0.97, 0.45, 0),
            new Chaussure("mtb", "Chaussures VTT / gravel", 0.99, 0.15, 0),
            new Chaussure("road", "Chaussures route", 1, 0, 0),
            new Chaussure("carbon", "Route, semelle carbone", 1.005, -0.15, 0),
            new Chaussure("aero", "Route carbone + couvre-chaussures aéro", 1.005, -0.1, -0.004),
        };

        public static readonly Transmission[] Transmissions =
        {
            new Transmission("waxed", "Chaîne cirée, propre", 0.985),
            new Transmission("clean", "Chaîne lubrifiée, propre", 0.975),
            new Transmission("average", "Chaîne moyennement entretenue", 0.965),
            new Transmission("dirty", "Chaîne sale / usée", 0.950),
            new Transmission("hub", "Moyeu à vitesses intégrées", 0.930),
            new Transmission("custom", "Personnalisé", double.NaN),
        };

        /// <summary>Comme byId : l'élément d'identifiant id, sinon celui de rang defaut.</summary>
        public static T ParId<T>(T[] liste, string id, int defaut = 0) where T : IIdentifie
        {
            foreach (T x in liste)
                if (x.Id == id)
                    return x;
            return liste[defaut];
        }

        /// <summary>Surface frontale de référence cycliste + vélo (m²), Bassett et al. 1999 (taille en cm, masse en kg).</summary>
        public static double SurfaceFrontale(double tailleCm, double masseKg)
        {
            double h = (tailleCm > 0 ? tailleCm : 178) / 100;
            double m = masseKg > 0 ? masseKg : 72;
            return 0.0293 * Math.Pow(h, 0.725) * Math.Pow(m, 0.425) + 0.0604;
        }

        /// <summary>Densité de l'air (kg/m³) : atmosphère standard à l'altitude, température donnée.</summary>
        public static double DensiteAir(double altM, double tempC)
        {
            double p = 101325 * Math.Pow(Math.Max(0.2, 1 - 2.25577e-5 * altM), 5.25588);
            return p / (287.05 * (tempC + 273.15));
        }

        /// <summary>Densité de l'air humide (kg/m³) : pression au niveau de la mer (hPa), humidité relative (%).</summary>
        public static double DensiteAirHumide(double altM, double tempC, double humidite, double pressionMerHpa)
        {
            double pm = double.IsNaN(pressionMerHpa) || double.IsInfinity(pressionMerHpa) ? 1013.25 : pressionMerHpa;
            double p = pm * 100 * Math.Pow(Math.Max(0.2, 1 - 2.25577e-5 * altM), 5.25588);
            double k = tempC + 273.15;
            double es = 610.78 * Math.Exp(17.27 * tempC / (tempC + 237.3));
            double rh = double.IsNaN(humidite) || double.IsInfinity(humidite) ? 0 : humidite;
            double pv = Math.Min(p, Math.Max(0, Math.Min(100, rh)) / 100 * es);
            return (p - pv) / (287.05 * k) + pv / (461.495 * k);
        }

        /// <summary>Paramètres mécaniques effectifs (buildSetup).</summary>
        public static Reglages Regler(Cycliste c, Velo v)
        {
            double mCycliste = c.Masse > 0 ? c.Masse : 72;
            double mVelo = (v.Masse > 0 ? v.Masse : 8.5) + (v.Charge > 0 ? v.Charge : 0);
            double masse = mCycliste + mVelo;
            double masseRoues = v.MasseRoues > 0 ? v.MasseRoues : 2.2;
            double masseEff = masse + 0.8 * masseRoues; // inertie de rotation des roues

            double aRef = SurfaceFrontale(c.Taille, mCycliste);
            Choix pos = ParId(Positions, c.Position, 3);
            Choix casque = ParId(Casques, c.Casque);
            Choix tenue = ParId(Tenues, c.Tenue, 1);
            Choix cadre = ParId(Cadres, v.Cadre);
            Choix roues = ParId(Roues, v.Roues);
            Chaussure chaussures = ParId(Chaussures, v.Chaussures, 2);
            Choix lunettes = ParId(Lunettes, c.Lunettes, 1);
            Choix chaussettes = ParId(Chaussettes, c.Chaussettes, 1);
            Choix epil = ParId(Epilations, c.Epilation);
            // bras couverts par des manches longues : seules les jambes rasées comptent
            double epilDcda = tenue.Id == "skinsuit_tt" && epil.Id == "full" ? ParId(Epilations, "legs").Valeur : epil.Valeur;
            double somme = aRef * pos.Valeur + casque.Valeur + tenue.Valeur + cadre.Valeur + roues.Valeur;
            if (lunettes.Valeur != 0) somme += lunettes.Valeur;
            if (chaussettes.Valeur != 0) somme += chaussettes.Valeur;
            if (epilDcda != 0) somme += epilDcda;
            if (chaussures.DCda != 0) somme += chaussures.DCda;
            if (v.CdaAjustement != 0 && !double.IsNaN(v.CdaAjustement)) somme += v.CdaAjustement;
            double cdaEstimee = Math.Max(0.12, somme);
            double cdaImposee = v.CdaImposee > 0 ? v.CdaImposee : 0;
            double cda = cdaImposee > 0 ? cdaImposee : cdaEstimee;

            Pneu pneu = ParId(Pneus, v.Pneu, 2);
            double crr = !double.IsNaN(pneu.Crr) ? pneu.Crr : Math.Max(0.001, v.CrrPerso > 0 || v.CrrPerso < 0 ? v.CrrPerso : 0.004);
            Transmission tr = ParId(Transmissions, v.Transmission, 1);
            double perso = v.RendementPerso > 0 || v.RendementPerso < 0 ? v.RendementPerso : 97;
            double etaChaine = !double.IsNaN(tr.Rendement) ? tr.Rendement : Math.Min(1, Math.Max(0.8, perso / 100));
            double eta = Math.Min(0.995, etaChaine * chaussures.K);

            return new Reglages
            {
                MasseCycliste = mCycliste,
                MasseVelo = mVelo,
                Masse = masse + chaussures.Masse,
                MasseEffective = masseEff + chaussures.Masse,
                MasseRoues = masseRoues,
                ARef = aRef,
                Cda = cda,
                CdaEstimee = cdaEstimee,
                CdaImposee = cdaImposee,
                Crr = crr,
                Rendement = eta,
                Pneu = pneu.Id,
                Crevaison = pneu.Crevaison[0],
                FMax = Math.Max(200, 0.45 * mCycliste * G),
                VPedalage = (v.VitesseMaxPedalageKmh > 0 ? v.VitesseMaxPedalageKmh : 65) / 3.6,
            };
        }

        /// <summary>Puissance nécessaire (W, aux pédales) pour tenir la vitesse v en régime établi.</summary>
        public static double PuissanceStable(Reglages s, double v, double pente, double crrK, double rho, double ventFace, double ventTravers)
        {
            double th = Math.Atan(pente);
            double va = v + ventFace;
            double vapp = Math.Sqrt(va * va + ventTravers * ventTravers);
            double k = crrK != 0 && !double.IsNaN(crrK) ? crrK : 1;
            double f = s.Masse * G * (Math.Sin(th) + s.Crr * k * Math.Cos(th)) + 0.5 * rho * s.Cda * vapp * va;
            return f * v / s.Rendement;
        }

        /// <summary>Vitesse d'équilibre (m/s) pour une puissance donnée (dichotomie, comme steadySpeed).</summary>
        public static double VitesseStable(Reglages s, double p, double pente, double crrK, double rho, double ventFace, double ventTravers)
        {
            double lo = 0, hi = 40;
            for (int i = 0; i < 60; i++)
            {
                double mid = 0.5 * (lo + hi);
                if (PuissanceStable(s, mid, pente, crrK, rho, ventFace, ventTravers) > p) hi = mid;
                else lo = mid;
            }
            return 0.5 * (lo + hi);
        }
    }
}
