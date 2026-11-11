// Substitut minimal du paquet URP (com.unity.render-pipelines.universal), pour compiler les scripts d'éditeur hors de
// Unity (verifier_scripts.sh). Pas utilisé dans Unity.
namespace UnityEngine.Rendering.Universal
{
    public abstract class ScriptableRendererData : ScriptableObject { }
    public class UniversalRendererData : ScriptableRendererData { }
    public class UniversalRenderPipelineAsset : RenderPipelineAsset
    {
        public static UniversalRenderPipelineAsset Create(ScriptableRendererData rendererData = null) { return null; }
        public int msaaSampleCount { get; set; }
        public bool supportsHDR { get; set; }
        public float shadowDistance { get; set; }
        public int shadowCascadeCount { get; set; }
        public override RenderPipeline CreatePipeline() { return null; }
    }
}
