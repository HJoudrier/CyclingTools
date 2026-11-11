// Substitut minimal du paquet Input System (com.unity.inputsystem), pour compiler les scripts hors de Unity
// (verifier_scripts.sh) : seulement les types et membres utilisés par le projet. Pas utilisé dans Unity.
namespace UnityEngine.InputSystem
{
    public class InputControl
    {
        public TControl TryGetChildControl<TControl>(string path) where TControl : InputControl { return null; }
    }
    public abstract class InputControl<TValue> : InputControl where TValue : struct
    {
        public TValue ReadValue() { return default(TValue); }
    }
    public class InputDevice : InputControl { }
    public class Keyboard : InputDevice
    {
        public static Keyboard current { get { return null; } }
        public Controls.KeyControl upArrowKey { get { return null; } }
        public Controls.KeyControl downArrowKey { get { return null; } }
        public Controls.KeyControl leftArrowKey { get { return null; } }
        public Controls.KeyControl rightArrowKey { get { return null; } }
        public Controls.KeyControl leftShiftKey { get { return null; } }
        public Controls.KeyControl rightShiftKey { get { return null; } }
        public Controls.KeyControl digit0Key { get { return null; } }
        public Controls.KeyControl digit1Key { get { return null; } }
        public Controls.KeyControl digit2Key { get { return null; } }
        public Controls.KeyControl digit3Key { get { return null; } }
        public Controls.KeyControl digit4Key { get { return null; } }
        public Controls.KeyControl digit5Key { get { return null; } }
        public Controls.KeyControl digit6Key { get { return null; } }
        public Controls.KeyControl cKey { get { return null; } }
        public Controls.KeyControl rKey { get { return null; } }
    }
    public class Gamepad : InputDevice
    {
        public static Gamepad current { get { return null; } }
        public Controls.ButtonControl rightTrigger { get { return null; } }
        public Controls.ButtonControl leftTrigger { get { return null; } }
        public Controls.ButtonControl buttonEast { get { return null; } }
        public Controls.ButtonControl buttonNorth { get { return null; } }
        public Controls.ButtonControl buttonSouth { get { return null; } }
        public Controls.ButtonControl buttonWest { get { return null; } }
        public Controls.ButtonControl rightShoulder { get { return null; } }
        public Controls.ButtonControl leftShoulder { get { return null; } }
        public Controls.DpadControl dpad { get { return null; } }
        public Controls.StickControl leftStick { get { return null; } }
        public Controls.StickControl rightStick { get { return null; } }
    }
    public enum InputActionType { Value, Button, PassThrough }
    public sealed class InputAction
    {
        public InputAction(string name = null, InputActionType type = default(InputActionType), string binding = null, string interactions = null,
                           string processors = null, string expectedControlType = null) { }
        public void Enable() { }
    }
    public struct InputActionProperty
    {
        public InputActionProperty(InputAction action) { }
    }
}
namespace UnityEngine.InputSystem.Controls
{
    public class AxisControl : InputControl<float> { }
    public class ButtonControl : AxisControl
    {
        public bool isPressed { get { return false; } }
        public bool wasPressedThisFrame { get { return false; } }
    }
    public class KeyControl : ButtonControl { }
    public class Vector2Control : InputControl<Vector2> { }
    public class StickControl : Vector2Control { }
    public class DpadControl : Vector2Control
    {
        public ButtonControl up { get { return null; } }
        public ButtonControl down { get { return null; } }
        public ButtonControl left { get { return null; } }
        public ButtonControl right { get { return null; } }
    }
}
namespace UnityEngine.InputSystem.XR
{
    public class TrackedDevice : InputDevice { }
    public class XRController : TrackedDevice
    {
        public static XRController rightHand { get { return null; } }
        public static XRController leftHand { get { return null; } }
    }
    public class TrackedPoseDriver : MonoBehaviour
    {
        public InputActionProperty positionInput { get; set; }
        public InputActionProperty rotationInput { get; set; }
    }
}
