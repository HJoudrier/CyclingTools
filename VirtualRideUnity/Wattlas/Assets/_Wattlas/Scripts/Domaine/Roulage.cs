// Wattlas — un pas de roulage, porté de Commun/js/engine/sim.js (accel, intégration de Heun à sous-pas de step) et
// de physio.js (W′bal de Skiba : wbalStep ; récupération selon l'âge : ageRecoveryFactor).
// Pas encore porté : plafonds de la courbe record, freinage dans les virages, aspiration (lot 4 du plan de portage).
using System;

namespace Wattlas.Domaine
{
    /// <summary>Conditions du moment : air, vent, pente, roulement (les champs c de sim.accel).</summary>
    public struct Conditions
    {
        public double Rho;
        public double VentFace;
        public double VentTravers;
        public double SinPente;
        public double CosPente;
        public double Crr;
        public double CdaK;

        public static Conditions Pour(Reglages s, double pente, double crrK, double rho, double ventFace, double ventTravers)
        {
            double th = Math.Atan(pente);
            return new Conditions
            {
                Rho = rho, VentFace = ventFace, VentTravers = ventTravers, SinPente = Math.Sin(th), CosPente = Math.Cos(th),
                Crr = s.Crr * crrK, CdaK = 1,
            };
        }
    }

    public static class Roulage
    {
        /// <summary>Vitesse minimale quand on pédale dans une pente trop forte (on pousse le vélo), m/s.</summary>
        public const double VitesseMinProgression = 1.0;

        /// <summary>Accélération (m/s²) à la vitesse v avec la puissance P (sim.accel).</summary>
        public static double Acceleration(Reglages s, double v, double p, Conditions c)
        {
            double vd = v > 0.5 ? v : 0.5;
            double fd = s.Rendement * p / vd;
            if (fd > s.FMax) fd = s.FMax;
            double va = v + c.VentFace;
            double fa = 0.5 * c.Rho * s.Cda * (c.CdaK > 0 ? c.CdaK : 1) * Math.Sqrt(va * va + c.VentTravers * c.VentTravers) * va;
            double fg = s.Masse * Physique.G * c.SinPente;
            double fr = c.Crr * s.Masse * Physique.G * c.CosPente;
            return (fd - fa - fg - fr) / s.MasseEffective;
        }

        /// <summary>Un sous-pas de durée h (s), méthode de Heun, comme la boucle de sous-pas de sim.step. Renvoie la distance parcourue.</summary>
        public static double Avancer(Reglages s, ref double v, double p, Conditions c, double h)
        {
            double b1 = Acceleration(s, v, p, c);
            double w1 = v + h * b1;
            if (w1 < 0) w1 = 0;
            double b2 = Acceleration(s, w1, p, c);
            double w = v + 0.5 * h * (b1 + b2);
            if (w < 0) w = 0;
            if (w < VitesseMinProgression && p > 20) w = VitesseMinProgression;
            double d = 0.5 * (v + w) * h;
            v = w;
            return d;
        }

        /// <summary>Puissance réellement transmise : plus d'effet au-delà de la vitesse de pédalage maximale (sim.step).</summary>
        public static double PuissanceUtile(Reglages s, double v, double p)
        {
            if (p < 0) p = 0;
            if (v > s.VPedalage)
            {
                double f = 1 - (v - s.VPedalage) / 3;
                p *= f > 0 ? f : 0;
            }
            return p;
        }

        /// <summary>Un pas de W′bal (modèle différentiel de Skiba 2015) : wbalStep.</summary>
        public static double WPrime(double wbal, double p, double cp, double w0, double dt, double recF)
        {
            if (p >= cp) return wbal - (p - cp) * dt;
            return w0 - (w0 - wbal) * Math.Exp(-recF * (cp - p) * dt / w0);
        }

        /// <summary>Facteur de récupération de W′ selon l'âge : ageRecoveryFactor.</summary>
        public static double FacteurRecuperation(double age)
        {
            double a = age > 0 ? age : 35;
            return Math.Min(1.1, Math.Max(0.6, 1 - 0.008 * (a - 30)));
        }
    }
}
