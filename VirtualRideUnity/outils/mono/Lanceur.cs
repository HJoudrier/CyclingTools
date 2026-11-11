// Wattlas — lance les tests [TestFixture] / [Test] d'un assemblage (hors de Unity).
using System;
using System.Reflection;
using NUnit.Framework;

public static class Lanceur
{
    public static int Main()
    {
        int ok = 0, ko = 0;
        foreach (Type t in typeof(Lanceur).Assembly.GetTypes())
        {
            if (t.GetCustomAttribute<TestFixtureAttribute>() == null) continue;
            object o = Activator.CreateInstance(t);
            foreach (MethodInfo m in t.GetMethods())
            {
                if (m.GetCustomAttribute<TestAttribute>() == null) continue;
                try { m.Invoke(o, null); ok++; Console.WriteLine("  ok     " + t.Name + "." + m.Name); }
                catch (TargetInvocationException e) { ko++; Console.WriteLine("  ÉCHEC  " + t.Name + "." + m.Name + " : " + e.InnerException.Message); }
            }
        }
        Console.WriteLine(ok + " tests réussis, " + ko + " échecs");
        return ko == 0 ? 0 : 1;
    }
}
