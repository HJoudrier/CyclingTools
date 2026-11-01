/* Virtual Ride 3D Réaliste — arbres, buissons, rochers et bottes de foin des tuiles de terrain (placés par terrain-worker.js) :
   - de près (rayon de la qualité : 70 à 170 m), le modèle complet : écorce texturée, feuillage translucide (la lumière du soleil passe
     à travers les feuilles quand on regarde vers lui), qui ondule au vent, aux couleurs de la saison (jaunes, orangés et roux
     d'automne, arbres dénudés en hiver) ;
   - au loin (jusqu'à plusieurs kilomètres), des imposteurs : chaque modèle a été photographié sous huit angles (couleur et normales)
     dans un tableau de textures ; un seul appel de dessin pour toute la forêt, éclairé comme un volume, qui porte son ombre.
   Rochers et bottes de foin : modèles complets jusqu'à 300 m. */
import * as THREE from 'three';
import { buildModels, leafAtlas, SPECIES } from './foliage.js';
import { NOISE } from './glsl.js';

const FRAMES = 8, FRAME_PX = 128;
const NOFAR = new Set(['rock', 'hay']);
const EVERGREEN = new Set(['spruce', 'pine', 'cypress', 'olive']);
const WIND_VERT = /* glsl */`
uniform float uTimeV;
uniform vec3 uWindV;
attribute float aSway;
`;
// ondulation au vent : la position monde de l'instance donne la phase, aSway la souplesse
const WIND_APPLY = /* glsl */`
#ifdef USE_INSTANCING
{
  vec3 ip = instanceMatrix[3].xyz;
  float ph = ip.x * 0.13 + ip.z * 0.17;
  float k = uWindV.y;
  float sway = aSway * aSway;
  float g = sin(uTimeV * (1.1 + 0.3 * k) + ph) * 0.6 + sin(uTimeV * 2.3 + ph * 1.7) * 0.25;
  vec3 wd = vec3(uWindV.x, 0.0, uWindV.z);
  transformed += wd * (0.05 + 0.25 * k) * sway * (0.6 + g) * (1.0 + 0.05 * position.y);
  transformed.y -= 0.03 * k * sway;
  // frémissement des feuilles
  transformed += vec3(sin(uTimeV * 7.0 + position.x * 3.0 + ph), 0.0, cos(uTimeV * 6.0 + position.z * 3.0 + ph)) * 0.02 * sway * (0.3 + k);
}
#endif
`;

const SEASON_FRAG = /* glsl */`
uniform float uAutumn, uBare;
varying float vRand;
vec3 seasonLeaf(vec3 c) {
  float r = vRand;
  vec3 aut = r < 0.33 ? vec3(0.55, 0.32, 0.04) : r < 0.66 ? vec3(0.62, 0.16, 0.03) : vec3(0.40, 0.25, 0.06);
  float k = uAutumn * smoothstep(0.1, 0.5, fract(r * 7.13) + uAutumn * 0.4);
  float l = dot(c, vec3(0.3, 0.6, 0.1));
  return mix(c, aut * (0.5 + 1.6 * l), k);
}
`;

function makeLeafMaterial(atlas, u, engine, evergreen) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, alphaToCoverage: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTimeV: u.uTime, uWindV: u.uWind, uAutumn: u.uAutumn, uBare: u.uBare, uLightDirV: u.uLightDir, uLightColV: u.uLightColor });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_VERT + 'varying float vRand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_APPLY + `
        #ifdef USE_INSTANCING
        vRand = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
        #else
        vRand = 0.5;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SEASON_FRAG + 'uniform vec3 uLightDirV; uniform vec3 uLightColV;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // au loin, les mipmaps rongent la transparence : on la renforce selon le niveau de détail lu
        { float lodE = max(0.0, log2(max(length(dFdx(vMapUv)), length(dFdy(vMapUv))) * 1536.0)); diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.3 * lodE)); }
        ${evergreen ? '' : 'diffuseColor.rgb = seasonLeaf(diffuseColor.rgb);\n        diffuseColor.a *= 1.0 - smoothstep(0.0, 1.0, uBare * (0.6 + 0.8 * fract(vRand * 13.7)));'}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // translucidité : la lumière traverse les feuilles quand on regarde vers le soleil
          vec3 Lv = normalize((viewMatrix * vec4(uLightDirV, 0.0)).xyz);
          vec3 V = normalize(vViewPosition);
          float back = pow(clamp(dot(V, Lv), 0.0, 1.0), 3.0) * 0.9 + 0.12 * clamp(dot(-normal, Lv), 0.0, 1.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uLightColV * back * 0.55;
        }`);
  };
  m.customProgramCacheKey = () => 'leaf-' + (evergreen ? 'e' : 'd');
  engine.prepare(m);
  return m;
}

function makeBarkMaterial(tex, layer, u, engine) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTimeV: u.uTime, uWindV: u.uWind, uBA: { value: tex.bark.A }, uBB: { value: tex.bark.B } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_VERT + 'varying vec2 vBUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_APPLY + 'vBUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2DArray uBA, uBB; varying vec2 vBUv;
        mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
          vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
          vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
          vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
          float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
          return mat3(T * im, B * im, N);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 ba = texture(uBA, vec3(vBUv * vec2(1.0, 0.6), ${layer.toFixed(1)}));
        vec4 bb = texture(uBB, vec3(vBUv * vec2(1.0, 0.6), ${layer.toFixed(1)}));
        diffuseColor.rgb *= ba.rgb * ba.rgb * 2.2;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bb.z;')
      .replace('#include <normal_fragment_maps>', `{
          vec3 tn = vec3(bb.xy * 2.0 - 1.0, 1.0);
          tn.z = sqrt(max(0.0, 1.0 - dot(tn.xy, tn.xy)));
          mat3 tbnB = cotangentFrame(normal, -vViewPosition, vBUv);
          normal = normalize(tbnB * tn);
        }`);
  };
  m.customProgramCacheKey = () => 'bark-' + layer;
  engine.prepare(m);
  return m;
}

function makeRockMaterial(tex, u, engine, layer, tile) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uGA: { value: tex.ground.A }, uGB: { value: tex.ground.B }, uSnowR: u.uSnow });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 w = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          w = instanceMatrix * w;
          #endif
          vRW = (modelMatrix * w).xyz;
          vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray uGA, uGB; uniform float uSnowR; varying vec3 vRW; varying vec3 vRN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 Nw = normalize(vRN);
        vec3 tw = pow(abs(Nw), vec3(4.0)); tw /= dot(tw, vec3(1.0));
        float TL = ${tile.toFixed(2)};
        vec4 ax = texture(uGA, vec3(vRW.zy / TL, ${layer}.0)), ay = texture(uGA, vec3(vRW.xz / TL, ${layer}.0)), az = texture(uGA, vec3(vRW.xy / TL, ${layer}.0));
        vec4 A = ax * tw.x + ay * tw.y + az * tw.z;
        diffuseColor.rgb *= A.rgb * A.rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.92), uSnowR * smoothstep(0.5, 0.8, Nw.y));`);
  };
  m.customProgramCacheKey = () => 'rock-' + layer;
  engine.prepare(m);
  return m;
}

/* ---------------------------------------------------------------- imposteurs */

const IMP_VERT = /* glsl */`
attribute float aLayer;
attribute vec3 aTintI;
uniform float uFrames;
varying vec3 vImpUv;
varying vec3 vImpR; varying vec3 vImpU; varying vec3 vImpF;
varying vec3 vTintI;
varying float vRand;
varying float vEvg;
`;
// panneau tourné vers la caméra (autour de la verticale), et la vue photographiée la plus proche de l'angle de vue
const IMP_BILLBOARD = /* glsl */`
vec3 c0 = instanceMatrix[3].xyz;
float sc = length(instanceMatrix[0].xyz);
vec3 ax0 = instanceMatrix[0].xyz / sc, ax2 = instanceMatrix[2].xyz / sc;
vec3 toCam = cameraPosition - c0; toCam.y = 0.0;
toCam = length(toCam) > 1e-3 ? normalize(toCam) : vec3(0.0, 0.0, 1.0);
vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
float la = atan(dot(toCam, ax2), dot(toCam, ax0));
float fr = mod(floor(la / 6.2831853 * uFrames + 0.5), uFrames);
transformed = (right * position.x + vec3(0.0, 1.0, 0.0) * position.y) * sc;
vImpUv = vec3((fr + position.x + 0.5) / uFrames, position.y, mod(aLayer, 1000.0));
vEvg = step(999.0, aLayer);
vImpR = right; vImpU = vec3(0.0, 1.0, 0.0); vImpF = toCam;
vTintI = aTintI;
vRand = fract(sin(dot(c0.xz, vec2(12.9898, 78.233))) * 43758.5453);
`;

function makeImpostorMaterial(texA, texN, u, engine) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0, alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide });
  const common = (shader) => {
    Object.assign(shader.uniforms, { uFrames: { value: FRAMES }, uImpA: { value: texA }, uImpN: { value: texN }, uAutumn: u.uAutumn, uBare: u.uBare, uLightDirV: u.uLightDir, uLightColV: u.uLightColor });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + IMP_VERT)
      // l'instance est déjà orientée vers la caméra : on ne garde que sa position (la matrice d'instance ne tourne plus le panneau)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + IMP_BILLBOARD)
      .replace('#include <project_vertex>', `vec4 mvPosition = vec4(transformed + c0, 1.0);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = modelMatrix * vec4(transformed + c0, 1.0);')
      .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalMatrix * vec3(0.0, 0.0, 1.0);');
  };
  m.onBeforeCompile = (shader) => {
    common(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray uImpA, uImpN; varying vec3 vImpUv; varying vec3 vImpR; varying vec3 vImpU; varying vec3 vImpF; varying vec3 vTintI; varying float vEvg;\n' + SEASON_FRAG + 'uniform vec3 uLightDirV; uniform vec3 uLightColV;')
      .replace('#include <map_fragment>', `
        vec4 ia = texture(uImpA, vImpUv);
        vec4 inn = texture(uImpN, vImpUv);
        ia.a = min(1.0, ia.a * 1.6);
        diffuseColor *= ia;
        diffuseColor.rgb *= vTintI;
        float leafF = step(0.8, inn.a);
        float decid = leafF * (1.0 - vEvg);
        diffuseColor.rgb = mix(diffuseColor.rgb, seasonLeaf(diffuseColor.rgb), decid);
        diffuseColor.a *= 1.0 - decid * smoothstep(0.0, 1.0, uBare * (0.6 + 0.8 * fract(vRand * 13.7)));`)
      .replace('#include <normal_fragment_maps>', `{
          vec3 nb = inn.xyz * 2.0 - 1.0;
          vec3 nw = normalize(vImpR * nb.x + vImpU * nb.y + vImpF * nb.z);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          vec3 Lv = normalize((viewMatrix * vec4(uLightDirV, 0.0)).xyz);
          vec3 V = normalize(vViewPosition);
          float back = pow(clamp(dot(V, Lv), 0.0, 1.0), 3.0) * 0.7;
          reflectedLight.directDiffuse += diffuseColor.rgb * uLightColV * back * 0.45 * leafF;
        }`);
  };
  m.customProgramCacheKey = () => 'impostor';
  // ombres portées : le même panneau, tourné vers la lumière (la caméra de l'ombre)
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.45 });
  depth.onBeforeCompile = (shader) => {
    common(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2DArray uImpA; varying vec3 vImpUv;')
      .replace('#include <alphatest_fragment>', 'if (texture(uImpA, vImpUv).a < 0.45) discard;');
  };
  depth.customProgramCacheKey = () => 'impostor-depth';
  engine.prepare(m);
  return { material: m, depth };
}

/** Photographie chaque modèle sous FRAMES angles : couleur (sRGB) et normales (repère de la vue) dans deux tableaux de textures. */
function bakeImpostors(renderer, models, atlas) {
  const list = [];
  for (const sp of SPECIES) if (!NOFAR.has(sp)) models[sp].forEach((m, v) => list.push({ sp, v, m }));
  const W = FRAMES * FRAME_PX, H = FRAME_PX, D = list.length;
  const mk = (srgb) => {
    const rt = new THREE.WebGLArrayRenderTarget(W, H, D, { depthBuffer: true, type: THREE.UnsignedByteType });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    return rt;
  };
  const rtA = mk(true), rtN = mk(false);
  const scene = new THREE.Scene();
  const leafA = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });
  const normalMat = (useMap, flag) => new THREE.ShaderMaterial({
    uniforms: { map: { value: atlas }, useMap: { value: useMap ? 1 : 0 }, flag: { value: flag } },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main() { vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float useMap, flag; varying vec2 vUv; varying vec3 vN; void main() { if (useMap > 0.5 && texture2D(map, vUv).a < 0.42) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, flag); }',
    side: THREE.DoubleSide,
  });
  const leafN = normalMat(true, 1.0), barkN = normalMat(false, 0.6);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  list.forEach((it, layer) => {
    const m = it.m;
    const S = Math.max(m.radius * 2.3, m.height * 1.06);
    m.impSize = S; m.impLayer = layer;
    const barkA = new THREE.MeshBasicMaterial({ color: new THREE.Color(m.barkColor) });
    const gb = new THREE.Mesh(m.bark, barkA), gl = m.leaves ? new THREE.Mesh(m.leaves, leafA) : null;
    scene.add(gb); if (gl) scene.add(gl);
    cam.left = -S / 2; cam.right = S / 2; cam.top = S; cam.bottom = 0; cam.updateProjectionMatrix();
    for (const [rt, pass] of [[rtA, 0], [rtN, 1]]) {
      gb.material = pass ? barkN : barkA;
      if (gl) gl.material = pass ? leafN : leafA;
      renderer.setRenderTarget(rt, layer);
      renderer.setClearColor(pass ? 0x8080ff : 0x2a3a1a, 0);
      renderer.clear(true, true, false);
      for (let k = 0; k < FRAMES; k++) {
        const a = (k / FRAMES) * Math.PI * 2;
        cam.position.set(Math.cos(a) * 80, 0, Math.sin(a) * 80);
        cam.lookAt(0, 0, 0);
        renderer.setViewport(k * FRAME_PX, 0, FRAME_PX, FRAME_PX);
        renderer.setScissor(k * FRAME_PX, 0, FRAME_PX, FRAME_PX);
        renderer.setScissorTest(true);
        renderer.render(scene, cam);
      }
      renderer.setScissorTest(false);
    }
    scene.remove(gb); if (gl) scene.remove(gl);
    barkA.dispose();
  });
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  leafA.dispose(); leafN.dispose(); barkN.dispose();
  return { texA: rtA.texture, texN: rtN.texture, rts: [rtA, rtN] };
}

/* ---------------------------------------------------------------- gestion */

const STRIDE = 10;

export class Vegetation {
  constructor(world) {
    this.world = world;
    const E = this.engine = world.engine;
    const Q = this.Q = world.Q;
    const u = world.atmo.u;
    // saison : feuilles colorées, arbres nus
    u.uAutumn = u.uAutumn || { value: world.season.autumn };
    u.uBare = u.uBare || { value: world.season.bare * 0.92 };
    if (world.landscape.amb.id === 'automne') u.uAutumn.value = Math.max(u.uAutumn.value, 0.8);
    if (world.landscape.amb.id === 'hiver') u.uBare.value = Math.max(u.uBare.value, 0.85);
    this.atlas = leafAtlas(Q.tex >= 2048 ? 512 : 384);
    this.models = buildModels();
    const tex = world.tex;
    this.leafMat = makeLeafMaterial(this.atlas, u, E, false);
    this.leafMatE = makeLeafMaterial(this.atlas, u, E, true);
    this.barkMats = [0, 1, 2].map((l) => makeBarkMaterial(tex, l, u, E));
    this.rockMat = makeRockMaterial(tex, u, E, 4, 3.0);
    this.hayMat = makeRockMaterial(tex, u, E, 1, 1.4);
    const imp = bakeImpostors(E.renderer, this.models, this.atlas);
    this.imp = imp;
    const im = makeImpostorMaterial(imp.texA, imp.texN, u, E);
    this.impMat = im.material;
    // un panneau unitaire (x : −0,5…0,5, y : 0…1)
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    this.impGeo = quad;
    this.impDepth = im.depth;
    this.group = new THREE.Group();
    this.group.name = 'végétation';
    E.scene.add(this.group);
    // instances près de la caméra : un couple (écorce, feuillage) par modèle
    this.near = new Map();
    for (const sp of SPECIES) this.models[sp].forEach((m, v) => {
      const key = sp + v;
      const bm = sp === 'rock' ? this.rockMat : sp === 'hay' ? this.hayMat : this.barkMats[m.barkLayer] || this.barkMats[0];
      const e = { sp, v, m, bark: this._inst(m.bark, bm, 64), leaves: m.leaves ? this._inst(m.leaves, EVERGREEN.has(sp) ? this.leafMatE : this.leafMat, 64) : null, n: 0 };
      this.near.set(key, e);
    });
    this.far = this._impInst(4096);
    this.tiles = new Map();
    this.dirtyNear = true; this.dirtyFar = true;
    this.lastNear = new THREE.Vector3(1e9, 0, 0); this.lastFar = new THREE.Vector3(1e9, 0, 0);
    world.terrain.onTile((ev, slot) => {
      const key = slot.level + ':' + slot.tx + ',' + slot.tz;
      if (ev === 'add' && slot.data.veg && slot.data.veg.length) { this.tiles.set(key, slot.data.veg); this.dirtyNear = this.dirtyFar = true; }
      else if (ev === 'remove' && this.tiles.delete(key)) this.dirtyNear = this.dirtyFar = true;
    });
  }

  _inst(geo, mat, cap) {
    const g = geo.clone();
    const m = new THREE.InstancedMesh(g, mat, cap);
    m.count = 0;
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.group.add(m);
    return m;
  }

  _grow(mesh, need) {
    if (need <= mesh.instanceMatrix.count) return mesh;
    let cap = mesh.instanceMatrix.count;
    while (cap < need) cap *= 2;
    const n = new THREE.InstancedMesh(mesh.geometry, mesh.material, cap);
    n.count = 0; n.castShadow = mesh.castShadow; n.receiveShadow = mesh.receiveShadow; n.frustumCulled = false;
    n.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    n.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (mesh.customDepthMaterial) n.customDepthMaterial = mesh.customDepthMaterial;
    this.group.remove(mesh); this.group.add(n);
    mesh.dispose();
    return n;
  }

  _impInst(cap) {
    const g = this.impGeo.clone();
    g.setAttribute('aLayer', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    g.setAttribute('aTintI', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    const m = new THREE.InstancedMesh(g, this.impMat, cap);
    m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
    m.customDepthMaterial = this.impDepth;
    this.group.add(m);
    return m;
  }

  update(dt, camera) {
    const p = camera.position;
    if (p.distanceToSquared(this.lastNear) > 16) this.dirtyNear = true;
    if (p.distanceToSquared(this.lastFar) > 40 * 40) this.dirtyFar = true;
    if (this.dirtyNear || this.dirtyFar) this._rebuild(p, this.dirtyNear, this.dirtyFar);
  }

  _rebuild(p, doNear, doFar) {
    const Q = this.Q;
    const R0 = Q.treeNear, R0b = R0 * R0, RF = Q.impostorFar, RFb = RF * RF, RR = 300 * 300;
    const near = new Map();
    let farN = 0;
    const farList = doFar ? [] : null;
    for (const arr of this.tiles.values()) {
      for (let i = 0; i < arr.length; i += STRIDE) {
        const dx = arr[i] - p.x, dz = arr[i + 2] - p.z, d2 = dx * dx + dz * dz;
        const sp = SPECIES[arr[i + 5]];
        const nofar = NOFAR.has(sp);
        if (d2 < (nofar ? RR : R0b)) {
          if (doNear) { const key = sp + arr[i + 6]; let l = near.get(key); if (!l) near.set(key, (l = [])); l.push(i, arr); }
        } else if (!nofar && d2 < RFb && doFar) { farList.push(i, arr); farN++; }
      }
    }
    if (doNear) {
      this.lastNear.copy(p);
      this.dirtyNear = false;
      for (const [key, e] of this.near) {
        const l = near.get(key) || [];
        const n = l.length / 2;
        e.bark = this._grow(e.bark, n);
        if (e.leaves) e.leaves = this._grow(e.leaves, n);
        this._fill(e.bark, l, n, e.m, false);
        if (e.leaves) this._fill(e.leaves, l, n, e.m, false);
      }
    }
    if (doFar) {
      this.lastFar.copy(p);
      this.dirtyFar = false;
      if (farN > this.far.instanceMatrix.count) {
        let cap = this.far.instanceMatrix.count; while (cap < farN) cap *= 2;
        this.group.remove(this.far); this.far.geometry.dispose(); this.far.dispose();
        this.far = this._impInst(cap);
      }
      const M = this.far.instanceMatrix.array, Lr = this.far.geometry.attributes.aLayer.array, T = this.far.geometry.attributes.aTintI.array;
      for (let k = 0; k < farN; k++) {
        const i = farList[k * 2], arr = farList[k * 2 + 1];
        const sp = SPECIES[arr[i + 5]], m = this.models[sp][arr[i + 6]];
        const s = arr[i + 3] * m.impSize, a = arr[i + 4], c = Math.cos(a), sn = Math.sin(a), o = k * 16;
        M[o] = c * s; M[o + 1] = 0; M[o + 2] = -sn * s; M[o + 3] = 0;
        M[o + 4] = 0; M[o + 5] = s; M[o + 6] = 0; M[o + 7] = 0;
        M[o + 8] = sn * s; M[o + 9] = 0; M[o + 10] = c * s; M[o + 11] = 0;
        M[o + 12] = arr[i]; M[o + 13] = arr[i + 1] - 0.3 * arr[i + 3]; M[o + 14] = arr[i + 2]; M[o + 15] = 1;
        // couche de l'imposteur ; + 1000 : persistant (pas de couleurs d'automne ni de branches nues)
        Lr[k] = m.impLayer + (EVERGREEN.has(sp) ? 1000 : 0);
        T[k * 3] = arr[i + 7]; T[k * 3 + 1] = arr[i + 8]; T[k * 3 + 2] = arr[i + 9];
      }
      this.far.count = farN;
      this.far.instanceMatrix.needsUpdate = true;
      this.far.geometry.attributes.aLayer.needsUpdate = true;
      this.far.geometry.attributes.aTintI.needsUpdate = true;
    }
  }

  _fill(mesh, l, n, model) {
    const M = mesh.instanceMatrix.array, C = mesh.instanceColor.array;
    for (let k = 0; k < n; k++) {
      const i = l[k * 2], arr = l[k * 2 + 1];
      const s = arr[i + 3], a = arr[i + 4], c = Math.cos(a), sn = Math.sin(a), o = k * 16;
      const sy = model.height < 2 ? s : s * (0.92 + 0.16 * ((arr[i] * 7.31 + arr[i + 2] * 3.17) % 1 + 1) % 1);
      M[o] = c * s; M[o + 1] = 0; M[o + 2] = -sn * s; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = sn * s; M[o + 9] = 0; M[o + 10] = c * s; M[o + 11] = 0;
      M[o + 12] = arr[i]; M[o + 13] = arr[i + 1]; M[o + 14] = arr[i + 2]; M[o + 15] = 1;
      C[k * 3] = arr[i + 7]; C[k * 3 + 1] = arr[i + 8]; C[k * 3 + 2] = arr[i + 9];
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}
