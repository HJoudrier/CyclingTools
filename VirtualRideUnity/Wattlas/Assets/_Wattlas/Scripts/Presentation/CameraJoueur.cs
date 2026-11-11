using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.XR;

namespace Wattlas.Presentation
{
    /// <summary>
    /// Caméra du joueur.
    ///  - Écran : poursuite (derrière et au-dessus) ou vue du cycliste (à ses yeux) ; touche C ou bouton Y pour changer.
    ///  - Casque VR actif : la caméra suit la tête (TrackedPoseDriver) dans un repère posé aux yeux du cycliste, qui ne suit
    ///    que le cap du vélo : ni roulis ni tangage imposés (confort). Touche R ou bouton A/X de la manette VR : recentrer.
    /// </summary>
    public sealed class CameraJoueur : MonoBehaviour
    {
        public enum Mode { Poursuite, Cycliste }

        [Tooltip("Racine du coureur (son cap et sa position).")]
        public Transform coureur;
        [Tooltip("Yeux du cycliste (os Ancre_Yeux).")]
        public Transform yeux;
        [Tooltip("Équipement du cycliste du joueur : sa tête disparaît en vue du cycliste.")]
        public CyclisteEquipement equipement;
        public Mode mode = Mode.Poursuite;
        public float distance = 4.5f, hauteur = 1.9f, lissage = 6f;

        Camera cam;
        Transform repereVR;
        Vector3 decalageTete;
        float lacetTete;
        bool vr;

        public bool EnVR { get { return vr; } }

        void Start()
        {
            cam = GetComponent<Camera>();
            vr = XRSettings.isDeviceActive;
            if (vr)
                PreparerVR();
            if (equipement != null)
                equipement.vueInterne = vr || mode == Mode.Cycliste;
        }

        void PreparerVR()
        {
            repereVR = new GameObject("Repère VR").transform;
            transform.SetParent(repereVR, false);
            var suivi = GetComponent<TrackedPoseDriver>();
            if (suivi == null)
                suivi = gameObject.AddComponent<TrackedPoseDriver>();
            var position = new InputAction("Position de la tête", InputActionType.Value, "<XRHMD>/centerEyePosition");
            var rotation = new InputAction("Rotation de la tête", InputActionType.Value, "<XRHMD>/centerEyeRotation");
            position.Enable();
            rotation.Enable();
            suivi.positionInput = new InputActionProperty(position);
            suivi.rotationInput = new InputActionProperty(rotation);
            cam.nearClipPlane = 0.05f;
            Invoke(nameof(Recentrer), 1f);
        }

        /// <summary>Place la tête du joueur aux yeux du cycliste, regard dans l'axe du vélo.</summary>
        public void Recentrer()
        {
            decalageTete = transform.localPosition;
            lacetTete = transform.localEulerAngles.y;
        }

        void LateUpdate()
        {
            if (coureur == null)
                return;
            var clavier = Keyboard.current;
            var manette = Gamepad.current;
            if (vr)
            {
                if ((clavier != null && clavier.rKey.wasPressedThisFrame) || Appui(XRController.rightHand, "primaryButton")
                    || Appui(XRController.leftHand, "primaryButton"))
                    Recentrer();
                float cap = coureur.eulerAngles.y - lacetTete;
                repereVR.rotation = Quaternion.Euler(0f, cap, 0f);
                Vector3 oeil = yeux != null ? yeux.position : coureur.position + Vector3.up * 1.6f;
                repereVR.position = oeil - repereVR.rotation * decalageTete;
                return;
            }
            if ((clavier != null && clavier.cKey.wasPressedThisFrame) || (manette != null && manette.buttonNorth.wasPressedThisFrame))
            {
                mode = mode == Mode.Poursuite ? Mode.Cycliste : Mode.Poursuite;
                if (equipement != null)
                    equipement.vueInterne = mode == Mode.Cycliste;
            }
            if (mode == Mode.Cycliste && yeux != null)
            {
                transform.position = yeux.position;
                Vector3 avant = Vector3.ProjectOnPlane(coureur.forward, Vector3.up).normalized;
                transform.rotation = Quaternion.LookRotation(avant, Vector3.up) * Quaternion.Euler(12f, 0f, 0f);
                cam.nearClipPlane = 0.05f;
                return;
            }
            Vector3 dos = -Vector3.ProjectOnPlane(coureur.forward, Vector3.up).normalized;
            Vector3 cible = coureur.position + dos * distance + Vector3.up * hauteur;
            float k = 1f - Mathf.Exp(-lissage * Time.deltaTime);
            transform.position = Vector3.Lerp(transform.position, cible, k);
            transform.rotation = Quaternion.LookRotation(coureur.position + Vector3.up * 1.0f - transform.position, Vector3.up);
            cam.nearClipPlane = 0.2f;
        }

        static bool Appui(XRController manette, string bouton)
        {
            if (manette == null)
                return false;
            var b = manette.TryGetChildControl<UnityEngine.InputSystem.Controls.ButtonControl>(bouton);
            return b != null && b.wasPressedThisFrame;
        }
    }
}
