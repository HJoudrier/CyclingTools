// Wattlas — le strict nécessaire de NUnit pour lancer les tests du domaine hors de Unity (Mono) : voir verifier_domaine.sh.
// Dans Unity, ce fichier n'est pas utilisé : c'est le vrai NUnit du Unity Test Framework.
using System;

namespace NUnit.Framework
{
    [AttributeUsage(AttributeTargets.Class)] public sealed class TestFixtureAttribute : Attribute { }
    [AttributeUsage(AttributeTargets.Method)] public sealed class TestAttribute : Attribute { }

    public sealed class AssertionException : Exception
    {
        public AssertionException(string message) : base(message) { }
    }

    public static class Assert
    {
        public static void AreEqual(double attendu, double obtenu, double tolerance, string message = null)
        {
            if (double.IsNaN(obtenu) || Math.Abs(attendu - obtenu) > tolerance)
                throw new AssertionException($"{message} : attendu {attendu:R} ± {tolerance:G3}, obtenu {obtenu:R}");
        }

        public static void AreEqual(object attendu, object obtenu, string message = null)
        {
            if (!Equals(attendu, obtenu))
                throw new AssertionException($"{message} : attendu {attendu}, obtenu {obtenu}");
        }

        public static void IsTrue(bool condition, string message = null)
        {
            if (!condition)
                throw new AssertionException(message ?? "condition fausse");
        }
    }
}
