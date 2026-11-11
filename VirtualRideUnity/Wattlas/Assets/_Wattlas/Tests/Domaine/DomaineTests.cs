// Wattlas — tests du domaine porté en C# : chaque résultat est comparé à celui du moteur JavaScript du site
// (vecteurs de VirtualRideUnity/outils/vecteurs.js), plus quelques propriétés physiques.
using System;
using System.Collections.Generic;
using NUnit.Framework;
using Wattlas.Domaine;
using Wattlas.Jeu;

namespace Wattlas.Tests
{
    [TestFixture]
    public class PhysiqueTests
    {
        const double Pres = 1e-9;

        static void Proche(double attendu, double obtenu, double tolRel, string quoi)
        {
            double tol = Math.Max(1e-12, Math.Abs(attendu) * tolRel);
            Assert.AreEqual(attendu, obtenu, tol, quoi);
        }

        static List<Reglages> Reglages()
        {
            var l = new List<Reglages>();
            foreach (object o in Vecteurs.Liste("reglages"))
            {
                var sel = new Dictionary<string, string>();
                foreach (KeyValuePair<string, object> kv in Vecteurs.O(o, "selection"))
                    sel[kv.Key] = (string)kv.Value;
                var cy = Vecteurs.O(o, "cycliste");
                var c = new Cycliste { Masse = Vecteurs.D(cy, "weight"), Taille = Vecteurs.D(cy, "height"), Position = Vecteurs.S(cy, "position") };
                Cycliste ce;
                Velo ve;
                Catalogue.Equiper(sel, c, new Velo(), out ce, out ve);
                l.Add(Physique.Regler(ce, ve));
            }
            return l;
        }

        [Test]
        public void DensiteDeLAir()
        {
            foreach (object o in Vecteurs.Liste("densite"))
                Proche(Vecteurs.D(o, "rho"), Physique.DensiteAir(Vecteurs.D(o, "alt"), Vecteurs.D(o, "t")), Pres, "densité");
            foreach (object o in Vecteurs.Liste("densiteHumide"))
                Proche(Vecteurs.D(o, "rho"), Physique.DensiteAirHumide(Vecteurs.D(o, "alt"), Vecteurs.D(o, "t"), Vecteurs.D(o, "rh"), Vecteurs.D(o, "p")),
                       Pres, "densité humide");
        }

        [Test]
        public void SurfaceFrontale()
        {
            foreach (object o in Vecteurs.Liste("surfaceFrontale"))
                Proche(Vecteurs.D(o, "a"), Physique.SurfaceFrontale(Vecteurs.D(o, "taille"), Vecteurs.D(o, "masse")), Pres, "surface frontale");
        }

        [Test]
        public void ReglagesDuMagasin()
        {
            List<Reglages> r = Reglages();
            int i = 0;
            foreach (object o in Vecteurs.Liste("reglages"))
            {
                Reglages s = r[i++];
                string q = "réglage " + i + " : ";
                Proche(Vecteurs.D(o, "mass"), s.Masse, Pres, q + "masse");
                Proche(Vecteurs.D(o, "massEff"), s.MasseEffective, Pres, q + "masse effective");
                Proche(Vecteurs.D(o, "wheelMass"), s.MasseRoues, Pres, q + "masse des roues");
                Proche(Vecteurs.D(o, "aRef"), s.ARef, Pres, q + "surface de référence");
                Proche(Vecteurs.D(o, "cda"), s.Cda, Pres, q + "CdA");
                Proche(Vecteurs.D(o, "crr"), s.Crr, Pres, q + "Crr");
                Proche(Vecteurs.D(o, "eta"), s.Rendement, Pres, q + "rendement");
                Proche(Vecteurs.D(o, "fMax"), s.FMax, Pres, q + "force max");
                Proche(Vecteurs.D(o, "vSpin"), s.VPedalage, Pres, q + "vitesse de pédalage max");
            }
        }

        [Test]
        public void RegimeEtabli()
        {
            List<Reglages> r = Reglages();
            foreach (object o in Vecteurs.Liste("puissance"))
                Proche(Vecteurs.D(o, "P"), Physique.PuissanceStable(r[(int)Vecteurs.D(o, "reglage")], Vecteurs.D(o, "v"), Vecteurs.D(o, "pente"),
                    Vecteurs.D(o, "crrK"), Vecteurs.D(o, "rho"), Vecteurs.D(o, "ventFace"), Vecteurs.D(o, "ventTravers")), Pres, "puissance stable");
            foreach (object o in Vecteurs.Liste("vitesse"))
                Proche(Vecteurs.D(o, "v"), Physique.VitesseStable(r[(int)Vecteurs.D(o, "reglage")], Vecteurs.D(o, "P"), Vecteurs.D(o, "pente"),
                    Vecteurs.D(o, "crrK"), Vecteurs.D(o, "rho"), Vecteurs.D(o, "ventFace"), Vecteurs.D(o, "ventTravers")), Pres, "vitesse stable");
        }

        [Test]
        public void Acceleration()
        {
            List<Reglages> r = Reglages();
            foreach (object o in Vecteurs.Liste("acceleration"))
            {
                Reglages s = r[(int)Vecteurs.D(o, "reglage")];
                Conditions c = Conditions.Pour(s, Vecteurs.D(o, "pente"), Vecteurs.D(o, "crrK"), Vecteurs.D(o, "rho"), Vecteurs.D(o, "ventFace"),
                                               Vecteurs.D(o, "ventTravers"));
                Proche(Vecteurs.D(o, "a"), Roulage.Acceleration(s, Vecteurs.D(o, "v"), Vecteurs.D(o, "P"), c), 1e-9, "accélération");
            }
        }

        [Test]
        public void RoulageDeuxMinutes()
        {
            List<Reglages> r = Reglages();
            foreach (object o in Vecteurs.Liste("roulage"))
            {
                Reglages s = r[(int)Vecteurs.D(o, "reglage")];
                Conditions c = Conditions.Pour(s, Vecteurs.D(o, "pente"), 1, 1.2, Vecteurs.D(o, "ventFace"), 0);
                int n = (int)Vecteurs.D(o, "sousPas");
                double p = Vecteurs.D(o, "P"), v = Vecteurs.D(o, "v0"), dist = 0;
                var points = (List<object>)((Dictionary<string, object>)o)["points"];
                int k = 0;
                for (int t = 1; t <= (int)Vecteurs.D(o, "duree"); t++)
                {
                    for (int q = 0; q < n; q++)
                        dist += Roulage.Avancer(s, ref v, p, c, 1.0 / n);
                    if (k < points.Count && (int)Vecteurs.D(points[k], "t") == t)
                    {
                        Proche(Vecteurs.D(points[k], "v"), v, 1e-9, "vitesse à " + t + " s");
                        Proche(Vecteurs.D(points[k], "s"), dist, 1e-9, "distance à " + t + " s");
                        k++;
                    }
                }
                Assert.AreEqual(points.Count, k, "tous les points comparés");
            }
        }

        [Test]
        public void WPrimeEtRecuperation()
        {
            foreach (object o in Vecteurs.Liste("wprime"))
                Proche(Vecteurs.D(o, "apres"), Roulage.WPrime(Vecteurs.D(o, "avant"), Vecteurs.D(o, "P"), Vecteurs.D(o, "cp"), Vecteurs.D(o, "w0"),
                    Vecteurs.D(o, "dt"), Vecteurs.D(o, "recF")), Pres, "W′");
            foreach (object o in Vecteurs.Liste("recuperation"))
                Proche(Vecteurs.D(o, "recF"), Roulage.FacteurRecuperation(Vecteurs.D(o, "age")), Pres, "récupération");
        }

        [Test]
        public void LeRoulageTendVersLeRegimeEtabli()
        {
            Reglages s = Reglages()[0];
            foreach (double pente in new[] { -0.03, 0.0, 0.06 })
            {
                Conditions c = Conditions.Pour(s, pente, 1, 1.2, 0, 0);
                double v = 0;
                for (int i = 0; i < 4 * 600; i++)
                    Roulage.Avancer(s, ref v, 250, c, 0.25);
                Assert.AreEqual(Physique.VitesseStable(s, 250, pente, 1, 1.2, 0, 0), v, 1e-4, "pente " + pente);
            }
        }
    }

    [TestFixture]
    public class ParcoursTests
    {
        const string Gpx = "<?xml version=\"1.0\"?><gpx version=\"1.1\" xmlns=\"http://www.topografix.com/GPX/1/1\"><trk><trkseg>"
            + "<trkpt lat=\"45.0\" lon=\"6.0\"><ele>200</ele></trkpt>"
            + "<trkpt lat=\"45.0\" lon=\"6.0127\"><ele>250</ele></trkpt>"
            + "<trkpt lat=\"45.009\" lon=\"6.0127\"><ele>250</ele></trkpt>"
            + "</trkseg></trk></gpx>";

        [Test]
        public void LectureEtReechantillonnage()
        {
            List<PointGps> pts = Wattlas.Domaine.Gpx.Lire(Gpx);
            Assert.AreEqual(3, pts.Count, "points lus");
            Parcours p = Parcours.DepuisPoints("essai", pts, 10, 0);
            // 0,0127° de longitude à 45° ≈ 998,6 m vers l'est ; 0,009° de latitude ≈ 1000,8 m vers le nord
            Assert.AreEqual(1999.4, p.Longueur, 1.0, "longueur");
            Assert.AreEqual(10.0, p.Pas, 0.05, "pas");
            double x, y, z, cap, pente;
            p.Echantillonner(500, out x, out y, out z, out cap, out pente);
            Assert.AreEqual(500, x, 1.0, "vers l'est");
            Assert.AreEqual(0, y, 1e-6, "pas de nord");
            Assert.AreEqual(Math.PI / 2, cap, 1e-6, "cap à l'est");
            Assert.AreEqual(0.05, pente, 0.002, "pente de 5 %");
            p.Echantillonner(1500, out x, out y, out z, out cap, out pente);
            Assert.AreEqual(0, cap, 1e-6, "cap au nord");
            Assert.AreEqual(0, pente, 1e-6, "plat");
            Assert.IsTrue(p.Courbure(998.6) < 0, "virage à gauche (de l'est vers le nord)");
        }

        [Test]
        public void CourseEtArrivee()
        {
            Parcours p = Parcours.DepuisPoints("essai", Wattlas.Domaine.Gpx.Lire(Gpx), 10, 0);
            Reglages s = Physique.Regler(new Cycliste { Masse = 70, Taille = 178, Position = "hoods" }, new Velo());
            var course = new Course(p);
            Coureur a = course.Ajouter(new Coureur("A", s, Braquets.Route(), new PuissanceAllure(300)));
            Coureur b = course.Ajouter(new Coureur("B", s, Braquets.Route(), new PuissanceAllure(200)));
            for (int i = 0; i < 20 * 600 && !(a.Arrive && b.Arrive); i++)
                course.Avancer(0.05);
            Assert.IsTrue(a.Arrive && b.Arrive, "les deux coureurs arrivent");
            Assert.IsTrue(a.TempsArrivee < b.TempsArrivee, "le plus puissant arrive le premier");
            Assert.AreEqual(a, course.Classement()[0], "classement");
            Assert.IsTrue(a.Cadence > 0 || a.Arrive, "cadence");
        }
    }
}
