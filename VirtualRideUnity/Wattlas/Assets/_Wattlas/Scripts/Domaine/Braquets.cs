// Wattlas — braquets : le développement de chaque combinaison plateau × pignon et un choix de vitesse qui garde la
// cadence près de la cible (comme un cycliste qui change de pignon). Sert à animer le pédalier et à afficher la cadence.
using System;

namespace Wattlas.Domaine
{
    public sealed class Braquets
    {
        public readonly int[] Plateaux;
        public readonly int[] Pignons;
        /// <summary>Rayon de la roue, pneu compris (m).</summary>
        public readonly double RayonRoue;
        public double CadenceCible = 90;
        public double CadenceMin = 72;
        public double CadenceMax = 104;
        public int Plateau { get; private set; }
        public int Pignon { get; private set; }

        public Braquets(int[] plateaux, int[] pignons, double rayonRoue)
        {
            if (plateaux == null || plateaux.Length == 0 || pignons == null || pignons.Length == 0)
                throw new ArgumentException("plateaux et pignons requis");
            Plateaux = (int[])plateaux.Clone();
            Pignons = (int[])pignons.Clone();
            Array.Sort(Plateaux);
            Array.Reverse(Plateaux);   // du plus grand au plus petit
            Array.Sort(Pignons);       // du plus petit au plus grand
            RayonRoue = rayonRoue;
            Plateau = 0;
            Pignon = Pignons.Length / 2;
        }

        /// <summary>Braquets de route habituels : 52/36 et 11-30, roue de 700 × 28.</summary>
        public static Braquets Route(double rayonRoue = 0.339)
        {
            return new Braquets(new[] { 52, 36 }, new[] { 11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30 }, rayonRoue);
        }

        /// <summary>Distance parcourue par tour de pédalier (m).</summary>
        public double Developpement(int plateau, int pignon)
        {
            return 2 * Math.PI * RayonRoue * Plateaux[plateau] / Pignons[pignon];
        }

        public double DeveloppementActuel { get { return Developpement(Plateau, Pignon); } }

        /// <summary>Rapport de transmission actuel (tours de roue par tour de pédalier).</summary>
        public double Rapport { get { return (double)Plateaux[Plateau] / Pignons[Pignon]; } }

        /// <summary>Cadence (tr/min) à la vitesse v (m/s) ; change de braquet si la cadence sort de [CadenceMin, CadenceMax].</summary>
        public double Cadence(double v, bool pedale)
        {
            if (!pedale || v < 0.3)
                return 0;
            double c = v / DeveloppementActuel * 60;
            if (c < CadenceMin || c > CadenceMax)
            {
                // grand plateau au-delà de 25 km/h, petit en dessous (sans croiser la chaîne), sinon le meilleur de tous
                int prefere = v > 7 ? 0 : Plateaux.Length - 1;
                if (!Choisir(v, prefere, prefere, true))
                    Choisir(v, 0, Plateaux.Length - 1, false);
                c = v / DeveloppementActuel * 60;
            }
            return c;
        }

        bool Choisir(double v, int de, int a, bool dansLaPlage)
        {
            double meilleur = double.MaxValue;
            bool trouve = false;
            for (int p = de; p <= a; p++)
                for (int q = 0; q < Pignons.Length; q++)
                {
                    double c = v / Developpement(p, q) * 60;
                    if (dansLaPlage && (c < CadenceMin || c > CadenceMax))
                        continue;
                    double e = Math.Abs(c - CadenceCible);
                    if (e < meilleur - 1e-9)
                    {
                        meilleur = e;
                        Plateau = p;
                        Pignon = q;
                        trouve = true;
                    }
                }
            return trouve;
        }
    }
}
