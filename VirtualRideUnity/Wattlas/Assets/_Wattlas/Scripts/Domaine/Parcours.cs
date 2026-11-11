// Wattlas — parcours : points GPS (GPX) projetés en mètres autour du départ, rééchantillonnés tous les 10 m comme le moteur
// du site, altitude lissée, pente et cap à chaque point. Repère : x vers l'est, y vers le nord, z l'altitude (m).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Xml;

namespace Wattlas.Domaine
{
    public struct PointGps
    {
        public double Lat;
        public double Lon;
        public double Ele;

        public PointGps(double lat, double lon, double ele)
        {
            Lat = lat;
            Lon = lon;
            Ele = ele;
        }
    }

    public static class Gpx
    {
        /// <summary>Points d'un fichier GPX (traces trkpt, sinon itinéraire rtept).</summary>
        public static List<PointGps> Lire(string xml)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var points = new List<PointGps>();
            foreach (string balise in new[] { "trkpt", "rtept" })
            {
                foreach (XmlNode n in doc.GetElementsByTagName(balise))
                {
                    double lat = Nombre(n.Attributes?["lat"]?.Value), lon = Nombre(n.Attributes?["lon"]?.Value), ele = 0;
                    foreach (XmlNode e in n.ChildNodes)
                        if (e.LocalName == "ele")
                            ele = Nombre(e.InnerText);
                    if (!double.IsNaN(lat) && !double.IsNaN(lon))
                        points.Add(new PointGps(lat, lon, double.IsNaN(ele) ? 0 : ele));
                }
                if (points.Count > 0)
                    break;
            }
            return points;
        }

        static double Nombre(string s)
        {
            double v;
            return s != null && double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : double.NaN;
        }
    }

    public sealed class Parcours
    {
        public const double RayonTerre = 6371000;

        public readonly string Nom;
        /// <summary>Pas entre deux points (m).</summary>
        public readonly double Pas;
        public readonly double Longueur;
        public readonly double[] X, Y, Z, Pente, Cap;
        public int N { get { return X.Length; } }

        Parcours(string nom, double pas, double[] x, double[] y, double[] z)
        {
            Nom = nom;
            Pas = pas;
            X = x;
            Y = y;
            Z = z;
            int n = x.Length;
            Longueur = (n - 1) * pas;
            Pente = new double[n];
            Cap = new double[n];
            for (int i = 0; i < n; i++)
            {
                int a = Math.Max(0, i - 1), b = Math.Min(n - 1, i + 1);
                double ds = (b - a) * pas;
                Pente[i] = ds > 0 ? (z[b] - z[a]) / ds : 0;
                Cap[i] = Math.Atan2(x[b] - x[a], y[b] - y[a]);
            }
        }

        /// <summary>Parcours à partir de points GPS : projection autour du premier point, rééchantillonnage, lissage de l'altitude.</summary>
        public static Parcours DepuisPoints(string nom, IList<PointGps> points, double pas = 10, double lissage = 30)
        {
            if (points == null || points.Count < 2)
                throw new ArgumentException("il faut au moins deux points");
            double lat0 = points[0].Lat * Math.PI / 180, lon0 = points[0].Lon * Math.PI / 180, cos0 = Math.Cos(lat0);
            int m = points.Count;
            var px = new double[m];
            var py = new double[m];
            var cumul = new double[m];
            for (int i = 0; i < m; i++)
            {
                px[i] = RayonTerre * (points[i].Lon * Math.PI / 180 - lon0) * cos0;
                py[i] = RayonTerre * (points[i].Lat * Math.PI / 180 - lat0);
                if (i > 0)
                    cumul[i] = cumul[i - 1] + Math.Sqrt((px[i] - px[i - 1]) * (px[i] - px[i - 1]) + (py[i] - py[i - 1]) * (py[i] - py[i - 1]));
            }
            double longueur = cumul[m - 1];
            int n = Math.Max(2, (int)Math.Round(longueur / pas) + 1);
            double p = longueur / (n - 1);
            var x = new double[n];
            var y = new double[n];
            var z = new double[n];
            int j = 0;
            for (int i = 0; i < n; i++)
            {
                double s = i * p;
                while (j < m - 2 && cumul[j + 1] < s)
                    j++;
                double seg = cumul[j + 1] - cumul[j];
                double t = seg > 0 ? Math.Min(1, Math.Max(0, (s - cumul[j]) / seg)) : 0;
                x[i] = px[j] + (px[j + 1] - px[j]) * t;
                y[i] = py[j] + (py[j + 1] - py[j]) * t;
                z[i] = points[j].Ele + (points[j + 1].Ele - points[j].Ele) * t;
            }
            // lissage de l'altitude : moyenne glissante sur ± lissage / 2
            int k = Math.Max(0, (int)Math.Round(lissage / p / 2));
            if (k > 0)
            {
                var zl = new double[n];
                for (int i = 0; i < n; i++)
                {
                    double somme = 0;
                    int c = 0;
                    for (int q = Math.Max(0, i - k); q <= Math.Min(n - 1, i + k); q++)
                    {
                        somme += z[q];
                        c++;
                    }
                    zl[i] = somme / c;
                }
                z = zl;
            }
            return new Parcours(nom, p, x, y, z);
        }

        /// <summary>Position, cap (radians, depuis le nord vers l'est) et pente à la distance s du départ.</summary>
        public void Echantillonner(double s, out double x, out double y, out double z, out double cap, out double pente)
        {
            double f = Math.Min(N - 1.000001, Math.Max(0, s / Pas));
            int i = (int)f;
            double t = f - i;
            x = X[i] + (X[i + 1] - X[i]) * t;
            y = Y[i] + (Y[i + 1] - Y[i]) * t;
            z = Z[i] + (Z[i + 1] - Z[i]) * t;
            pente = Pente[i] + (Pente[i + 1] - Pente[i]) * t;
            double d = Cap[i + 1] - Cap[i];
            if (d > Math.PI) d -= 2 * Math.PI;
            if (d < -Math.PI) d += 2 * Math.PI;
            cap = Cap[i] + d * t;
        }

        /// <summary>Courbure de la trajectoire (1/m, positive en tournant à droite) autour de s.</summary>
        public double Courbure(double s, double base_ = 20)
        {
            double xa, ya, za, ca, pa, xb, yb, zb, cb, pb;
            Echantillonner(s - base_ / 2, out xa, out ya, out za, out ca, out pa);
            Echantillonner(s + base_ / 2, out xb, out yb, out zb, out cb, out pb);
            double d = cb - ca;
            if (d > Math.PI) d -= 2 * Math.PI;
            if (d < -Math.PI) d += 2 * Math.PI;
            return d / base_;
        }

        /// <summary>Dénivelé positif cumulé (m).</summary>
        public double DenivelePositif()
        {
            double d = 0;
            for (int i = 1; i < N; i++)
                if (Z[i] > Z[i - 1])
                    d += Z[i] - Z[i - 1];
            return d;
        }
    }
}
