/* Tests : résolution de « three » et « three/addons/ » comme la carte d'import des pages du monde réaliste
   (VirtualRide3DRealiste/monde/index.html), pour importer ses modules sous Node. */
const V = new URL('../VirtualRide3DRealiste/monde/vendor/three/', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: V + 'three.module.min.js', shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: V + 'addons/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}
