// Wattlas — lecture des vecteurs de référence produits par VirtualRideUnity/outils/vecteurs.js (moteur JavaScript du site).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;

namespace Wattlas.Tests
{
    public static class Vecteurs
    {
        static Dictionary<string, object> cache;

        /// <summary>Le fichier Vecteurs/physique.json, à côté de ce fichier source (Unity comme hors de Unity).</summary>
        public static Dictionary<string, object> Physique([CallerFilePath] string source = "")
        {
            if (cache != null)
                return cache;
            string chemin = Environment.GetEnvironmentVariable("WATTLAS_VECTEURS");
            if (string.IsNullOrEmpty(chemin))
                chemin = Path.Combine(Path.GetDirectoryName(source) ?? ".", "Vecteurs", "physique.json");
            cache = (Dictionary<string, object>)MiniJson.Lire(File.ReadAllText(chemin, Encoding.UTF8));
            return cache;
        }

        public static List<object> Liste(string cle)
        {
            return (List<object>)Physique()[cle];
        }

        public static double D(object o, string cle)
        {
            return Convert.ToDouble(((Dictionary<string, object>)o)[cle], CultureInfo.InvariantCulture);
        }

        public static string S(object o, string cle)
        {
            object v;
            return ((Dictionary<string, object>)o).TryGetValue(cle, out v) ? v as string : null;
        }

        public static Dictionary<string, object> O(object o, string cle)
        {
            return (Dictionary<string, object>)((Dictionary<string, object>)o)[cle];
        }
    }

    /// <summary>Lecteur JSON minimal (objets, tableaux, nombres, chaînes, booléens, null).</summary>
    public static class MiniJson
    {
        public static object Lire(string texte)
        {
            int i = 0;
            object v = Valeur(texte, ref i);
            return v;
        }

        static void Blancs(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i]))
                i++;
        }

        static object Valeur(string s, ref int i)
        {
            Blancs(s, ref i);
            char c = s[i];
            if (c == '{')
            {
                var o = new Dictionary<string, object>();
                i++;
                Blancs(s, ref i);
                if (s[i] == '}') { i++; return o; }
                while (true)
                {
                    Blancs(s, ref i);
                    string cle = Chaine(s, ref i);
                    Blancs(s, ref i);
                    i++; // ':'
                    o[cle] = Valeur(s, ref i);
                    Blancs(s, ref i);
                    if (s[i++] == '}') return o;
                }
            }
            if (c == '[')
            {
                var l = new List<object>();
                i++;
                Blancs(s, ref i);
                if (s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Valeur(s, ref i));
                    Blancs(s, ref i);
                    if (s[i++] == ']') return l;
                }
            }
            if (c == '"') return Chaine(s, ref i);
            if (s.Substring(i).StartsWith("true")) { i += 4; return true; }
            if (s.Substring(i).StartsWith("false")) { i += 5; return false; }
            if (s.Substring(i).StartsWith("null")) { i += 4; return null; }
            int debut = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0)
                i++;
            return double.Parse(s.Substring(debut, i - debut), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        static string Chaine(string s, ref int i)
        {
            var sb = new StringBuilder();
            i++; // '"'
            while (s[i] != '"')
            {
                if (s[i] == '\\')
                {
                    i++;
                    char e = s[i];
                    if (e == 'u') { sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16)); i += 4; }
                    else sb.Append(e == 'n' ? '\n' : e == 't' ? '\t' : e);
                }
                else sb.Append(s[i]);
                i++;
            }
            i++;
            return sb.ToString();
        }
    }
}
