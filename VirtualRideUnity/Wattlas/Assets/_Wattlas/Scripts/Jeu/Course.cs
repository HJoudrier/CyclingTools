// Wattlas — cas d'usage « rouler » : une course sur un parcours, des coureurs qui avancent pas à pas avec le moteur du
// domaine. Aucune dépendance à Unity : la présentation lit l'état, les adaptateurs fournissent la puissance.
using System;
using System.Collections.Generic;
using Wattlas.Domaine;

namespace Wattlas.Jeu
{
    /// <summary>Port : d'où vient la puissance d'un coureur (clavier, manette, home-trainer, coureur virtuel…).</summary>
    public interface ISourcePuissance
    {
        /// <summary>Puissance demandée (W) pour ce coureur, à cet instant de la course.</summary>
        double Puissance(Coureur coureur, Course course);
    }

    public sealed class Coureur
    {
        public readonly string Nom;
        public readonly Reglages Reglages;
        public readonly Braquets Braquets;
        public ISourcePuissance Source;
        /// <summary>Puissance critique (W), réserve anaérobie W′ (J), facteur de récupération de W′.</summary>
        public double Cp = 280, W0 = 20000, RecF = 1;
        /// <summary>Position latérale sur la route (m, + à droite de l'axe).</summary>
        public double Decalage;
        public double S, V, WBal, Puissance, Cadence, TempsArrivee = double.NaN;
        /// <summary>Part de la traînée aérodynamique économisée dans l'abri d'un autre coureur (0 à 0,35).</summary>
        public double Abri;
        public bool Arrive { get { return !double.IsNaN(TempsArrivee); } }

        public Coureur(string nom, Reglages reglages, Braquets braquets, ISourcePuissance source)
        {
            Nom = nom;
            Reglages = reglages;
            Braquets = braquets;
            Source = source;
            WBal = W0;
        }
    }

    public sealed class Course
    {
        public readonly Parcours Parcours;
        public readonly List<Coureur> Coureurs = new List<Coureur>();
        public double Temps { get; private set; }
        public double TemperatureC = 18;
        /// <summary>Vent : vitesse (m/s) et direction d'où il vient (degrés, 0 = du nord, 90 = de l'est).</summary>
        public double VentVitesse, VentDirection;
        /// <summary>Sous-pas d'intégration par pas de jeu (Heun), comme subSteps de sim.js.</summary>
        public int SousPas = 2;
        /// <summary>Abri simplifié derrière un autre coureur (à remplacer par le modèle de draft.js, lot 4).</summary>
        public bool Aspiration = true;

        public Course(Parcours parcours)
        {
            Parcours = parcours;
        }

        public Coureur Ajouter(Coureur c)
        {
            Coureurs.Add(c);
            return c;
        }

        /// <summary>Avance la course de dt secondes.</summary>
        public void Avancer(double dt)
        {
            if (dt <= 0)
                return;
            if (Aspiration)
                CalculerAbris();
            foreach (Coureur c in Coureurs)
            {
                if (c.Arrive)
                {
                    c.Puissance = 0;
                    c.V = Math.Max(0, c.V - 2 * dt);
                    c.Cadence = 0;
                    continue;
                }
                double p = c.Source != null ? Math.Max(0, c.Source.Puissance(c, this)) : 0;
                int n = Math.Max(1, SousPas);
                double h = dt / n;
                for (int q = 0; q < n; q++)
                {
                    double x, y, z, cap, pente;
                    Parcours.Echantillonner(c.S, out x, out y, out z, out cap, out pente);
                    double rho = Physique.DensiteAir(z, TemperatureC);
                    double angle = VentDirection * Math.PI / 180 - cap;   // vent venant de face : angle 0
                    Conditions cond = Conditions.Pour(c.Reglages, pente, 1, rho, VentVitesse * Math.Cos(angle), VentVitesse * Math.Sin(angle));
                    cond.CdaK = 1 - c.Abri;
                    double pu = Roulage.PuissanceUtile(c.Reglages, c.V, p);
                    c.S += Roulage.Avancer(c.Reglages, ref c.V, pu, cond, h);
                    if (c.S >= Parcours.Longueur)
                    {
                        c.S = Parcours.Longueur;
                        c.TempsArrivee = Temps + (q + 1) * h;
                        break;
                    }
                }
                c.Puissance = p;
                c.WBal = Math.Min(c.W0, Roulage.WPrime(c.WBal, p, c.Cp, c.W0, dt, c.RecF));
                c.Cadence = c.Braquets != null ? c.Braquets.Cadence(c.V, p > 5) : 0;
            }
            Temps += dt;
        }

        /// <summary>Abri simplifié : derrière un coureur proche (0,3 à 3 m devant, même voie à ±0,7 m), jusqu'à 35 % de traînée en moins.</summary>
        void CalculerAbris()
        {
            foreach (Coureur c in Coureurs)
            {
                double meilleur = 0;
                foreach (Coureur d in Coureurs)
                {
                    if (d == c || d.Arrive)
                        continue;
                    double ecart = d.S - c.S, lateral = Math.Abs(d.Decalage - c.Decalage);
                    if (ecart < 0.3 || ecart > 3 || lateral > 0.7)
                        continue;
                    double a = (0.35 - 0.25 * (ecart - 0.3) / 2.7) * (1 - lateral / 0.7 * 0.5);
                    if (a > meilleur)
                        meilleur = a;
                }
                c.Abri = meilleur;
            }
        }

        /// <summary>Classement : arrivés d'abord (par temps), puis les autres par distance.</summary>
        public List<Coureur> Classement()
        {
            var l = new List<Coureur>(Coureurs);
            l.Sort((a, b) =>
            {
                if (a.Arrive && b.Arrive) return a.TempsArrivee.CompareTo(b.TempsArrivee);
                if (a.Arrive) return -1;
                if (b.Arrive) return 1;
                return b.S.CompareTo(a.S);
            });
            return l;
        }
    }

    /// <summary>Coureur virtuel : une puissance de base, modulée par la pente (plus en montée, moins en descente).</summary>
    public sealed class PuissanceAllure : ISourcePuissance
    {
        public double Base;
        public double SensibilitePente = 4;

        public PuissanceAllure(double baseW)
        {
            Base = baseW;
        }

        public double Puissance(Coureur coureur, Course course)
        {
            double x, y, z, cap, pente;
            course.Parcours.Echantillonner(coureur.S + 30, out x, out y, out z, out cap, out pente);
            double k = Math.Min(1.4, Math.Max(0.4, 1 + SensibilitePente * pente));
            return Base * k;
        }
    }
}
