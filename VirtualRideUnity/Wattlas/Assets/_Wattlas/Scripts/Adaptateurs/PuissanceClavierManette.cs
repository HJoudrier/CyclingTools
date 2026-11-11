using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.InputSystem.XR;
using Wattlas.Jeu;

namespace Wattlas.Adaptateurs
{
    /// <summary>
    /// Adaptateur du port ISourcePuissance : la puissance se règle au clavier, à la manette ou aux manettes du casque,
    /// comme sur l'écran de course du site (↑ ↓, Maj : par 50 W ; gâchettes droite et gauche ; 0 ou bouton B : roue libre).
    /// En attendant le home-trainer en Bluetooth (FTMS), qui sera un autre adaptateur du même port.
    /// </summary>
    public sealed class PuissanceClavierManette : ISourcePuissance
    {
        public double Cible = 200;
        public double Min = 0, Max = 1500;
        /// <summary>Vitesse de réglage (W par seconde, touche ou gâchette enfoncée à fond).</summary>
        public double Vitesse = 150;
        public bool RoueLibre;
        /// <summary>Déplacement latéral demandé (-1 à gauche, +1 à droite).</summary>
        public float Lateral;
        /// <summary>Position demandée (touches 1 à 6) : upright, tops, hoods, hoods_bent, drops, forearms ; null : inchangée.</summary>
        public string Position;

        static readonly string[] Positions = { "upright", "tops", "hoods", "hoods_bent", "drops", "forearms" };

        public void MettreAJour(float dt)
        {
            double d = 0;
            Position = null;
            Lateral = 0;
            var k = Keyboard.current;
            if (k != null)
            {
                if (k.upArrowKey.isPressed) d += 1;
                if (k.downArrowKey.isPressed) d -= 1;
                bool maj = k.leftShiftKey.isPressed || k.rightShiftKey.isPressed;
                if (maj && k.upArrowKey.wasPressedThisFrame) Cible += 50;
                if (maj && k.downArrowKey.wasPressedThisFrame) Cible -= 50;
                if (k.digit0Key.wasPressedThisFrame) RoueLibre = !RoueLibre;
                if (k.leftArrowKey.isPressed) Lateral -= 1;
                if (k.rightArrowKey.isPressed) Lateral += 1;
                KeyControl[] chiffres = { k.digit1Key, k.digit2Key, k.digit3Key, k.digit4Key, k.digit5Key, k.digit6Key };
                for (int i = 0; i < chiffres.Length; i++)
                    if (chiffres[i].wasPressedThisFrame)
                        Position = positionCourante = Positions[i];
            }
            var g = Gamepad.current;
            if (g != null)
            {
                d += g.rightTrigger.ReadValue() - g.leftTrigger.ReadValue();
                if (g.dpad.up.wasPressedThisFrame) Cible += 50;
                if (g.dpad.down.wasPressedThisFrame) Cible -= 50;
                if (g.buttonEast.wasPressedThisFrame) RoueLibre = !RoueLibre;
                Lateral += g.leftStick.ReadValue().x;
                if (g.rightShoulder.wasPressedThisFrame) Position = Suivante(+1);
                if (g.leftShoulder.wasPressedThisFrame) Position = Suivante(-1);
            }
            d += Gachette(XRController.rightHand) - Gachette(XRController.leftHand);
            Cible = System.Math.Min(Max, System.Math.Max(Min, Cible + d * Vitesse * dt));
            Lateral = Mathf.Clamp(Lateral, -1f, 1f);
        }

        string positionCourante = "hoods";

        string Suivante(int sens)
        {
            int i = System.Array.IndexOf(Positions, positionCourante);
            i = (i + sens + Positions.Length) % Positions.Length;
            positionCourante = Positions[i];
            return positionCourante;
        }

        static float Gachette(XRController manette)
        {
            if (manette == null)
                return 0f;
            var a = manette.TryGetChildControl<AxisControl>("trigger");
            return a != null ? a.ReadValue() : 0f;
        }

        public double Puissance(Coureur coureur, Course course)
        {
            return RoueLibre ? 0 : Cible;
        }
    }
}
