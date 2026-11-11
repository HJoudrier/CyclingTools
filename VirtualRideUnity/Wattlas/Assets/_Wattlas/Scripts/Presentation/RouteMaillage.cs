using System.Collections.Generic;
using UnityEngine;
using Wattlas.Domaine;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Route construite le long d'un parcours : chaussée bombée, accotements et un ruban de terrain qui ondule de part et
    /// d'autre, en tronçons d'environ 1 km (Unity écarte ceux qui sont hors champ). Repère : x vers l'est, z vers le nord,
    /// y l'altitude moins celle du départ. Premier jet : le paysage de Bike3D (VirtualRide3D/univers) viendra avec son portage.
    /// </summary>
    public static class RouteMaillage
    {
        /// <summary>Profil en travers : décalage latéral (m), hauteur relative (m), matériau (0 chaussée, 1 accotement, 2 herbe).</summary>
        static readonly float[] Decalages = { -90f, -40f, -14f, -5f, -3.4f, -3f, 0f, 3f, 3.4f, 5f, 14f, 40f, 90f };

        public static float AltitudeDepart(Parcours p)
        {
            return (float)p.Z[0];
        }

        /// <summary>Point du monde Unity sur le parcours, à la distance s et au décalage latéral d (m, + à droite).</summary>
        public static Vector3 Position(Parcours p, double s, double d)
        {
            double x, y, z, cap, pente;
            p.Echantillonner(s, out x, out y, out z, out cap, out pente);
            return new Vector3((float)(x + d * System.Math.Cos(cap)), (float)z - AltitudeDepart(p), (float)(y - d * System.Math.Sin(cap)));
        }

        public static GameObject Construire(Parcours p, Transform parent, Material chaussee, Material accotement, Material herbe,
                                            float largeur = 6f, int pointsParTroncon = 100)
        {
            var racine = new GameObject("Route · " + p.Nom);
            racine.transform.SetParent(parent, false);
            float z0 = AltitudeDepart(p);
            for (int debut = 0; debut < p.N - 1; debut += pointsParTroncon)
            {
                int fin = Mathf.Min(p.N - 1, debut + pointsParTroncon);
                var go = new GameObject("Tronçon " + (debut / pointsParTroncon + 1));
                go.transform.SetParent(racine.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = Troncon(p, debut, fin, largeur, z0);
                go.AddComponent<MeshRenderer>().sharedMaterials = new[] { chaussee, accotement, herbe };
            }
            return racine;
        }

        static Mesh Troncon(Parcours p, int debut, int fin, float largeur, float z0)
        {
            int nc = Decalages.Length;
            var sommets = new List<Vector3>();
            var uv = new List<Vector2>();
            float demi = largeur / 2f;
            for (int i = debut; i <= fin; i++)
            {
                double cap = p.Cap[i];
                float cx = (float)System.Math.Cos(cap), cy = (float)System.Math.Sin(cap);
                for (int k = 0; k < nc; k++)
                {
                    float d = Decalages[k];
                    // la chaussée garde sa largeur ; au-delà, le terrain s'écarte et ondule
                    if (Mathf.Abs(d) <= 3f) d = d / 3f * demi;
                    else if (Mathf.Abs(d) <= 3.4f) d = Mathf.Sign(d) * (demi + 0.4f);
                    else if (Mathf.Abs(d) <= 5f) d = Mathf.Sign(d) * (demi + 2f);
                    float x = (float)p.X[i] + d * cx, y = (float)p.Y[i] - d * cy;
                    float h = (float)p.Z[i] - z0;
                    float a = Mathf.Abs(d);
                    if (a <= demi) h += 0.06f * (1f - (d / demi) * (d / demi));      // chaussée bombée
                    else if (a <= demi + 0.4f) h -= 0.02f;                           // accotement
                    else
                    {
                        float loin = Mathf.Clamp01((a - demi - 1f) / 60f);
                        h += -0.15f + loin * loin * 14f * (Mathf.PerlinNoise(x * 0.004f + 13f, y * 0.004f + 7f) - 0.35f)
                             + loin * 2.5f * (Mathf.PerlinNoise(x * 0.02f, y * 0.02f) - 0.5f);
                    }
                    sommets.Add(new Vector3(x, h, y));
                    uv.Add(new Vector2(d / largeur, (float)(i * p.Pas / 5.0)));
                }
            }
            var tris = new[] { new List<int>(), new List<int>(), new List<int>() };
            for (int i = 0; i < fin - debut; i++)
                for (int k = 0; k < nc - 1; k++)
                {
                    int a = i * nc + k, b = a + 1, c = a + nc, e = c + 1;
                    float milieu = Mathf.Abs((Decalages[k] + Decalages[k + 1]) / 2f);
                    int m = milieu <= 3f ? 0 : milieu <= 3.4f ? 1 : 2;
                    // faces vers le haut (Unity : sens horaire vu de dessus)
                    tris[m].AddRange(new[] { a, c, b, b, c, e });
                }
            var mesh = new Mesh { name = "Route " + debut };
            mesh.SetVertices(sommets);
            mesh.SetUVs(0, uv);
            mesh.subMeshCount = 3;
            for (int m = 0; m < 3; m++)
                mesh.SetTriangles(tris[m], m);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
