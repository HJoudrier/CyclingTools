/* Virtual Ride 3D Réaliste — la route :
   - RoadPath : l'axe de la route de Bike3D (échantillons tous les ~5 m) lissé par une spline de Catmull-Rom, pour des virages et des
     lacets ronds ; les coureurs et la caméra s'y placent aussi ;
   - la chaussée, par tronçons de 200 m, avec un sommet par mètre : bombée au centre, bords et accotements qui descendent vers le
     terrain, revêtement de chaque portion de PaceYourRide (enrobé, enrobé usé, pavés, chemin blanc, gravier, terre, herbe) à sa largeur ;
   - le matériau : textures d'enrobé ou de pavés, marquages (rives continues, axe discontinu, continu dans les virages serrés), peinture
     usée, traces de pneus plus lisses, accotements de gravillons et d'herbe, chaussée mouillée qui reflète le ciel, flaques et
     ondes de pluie. */
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { SAMPLE, ROAD_TILE } from './textures.js';

/** Revêtements (mêmes identifiants que Bike3D, js/road.js) → couche de texture de la route. */
export const SURFACE_IDS = ['asphalt', 'smooth', 'rough', 'cobbles', 'cobbles_hard', 'gravel_hard', 'gravel_loose', 'dirt', 'wet', 'grass'];
export const SURFACE_INFO = {
  asphalt: { name: 'Asphalte', layer: 0, paved: true, shake: 0 },
  smooth: { name: 'Enrobé neuf', layer: 0, paved: true, shake: 0, fresh: true },
  rough: { name: 'Asphalte dégradé', layer: 1, paved: true, shake: 0.35 },
  cobbles: { name: 'Pavés', layer: 2, shake: 1, sector: 'SECTEUR PAVÉ', stars: 3 },
  cobbles_hard: { name: 'Pavés difficiles', layer: 3, shake: 1.6, sector: 'SECTEUR PAVÉ', stars: 5 },
  gravel_hard: { name: 'Chemin blanc', layer: 4, shake: 0.4, sector: 'CHEMIN BLANC', stars: 2, dust: '#e9e1cc' },
  gravel_loose: { name: 'Gravier', layer: 4, shake: 0.7, sector: 'GRAVIER', stars: 4, loose: true, dust: '#e3d6b6' },
  dirt: { name: 'Chemin de terre', layer: 5, shake: 0.6, sector: 'CHEMIN DE TERRE', stars: 3, dust: '#c4a27a' },
  wet: { name: 'Route mouillée', layer: 0, paved: true, wet: true, shake: 0 },
  grass: { name: 'Herbe', layer: 6, shake: 0.5, sector: 'HERBE ET SABLE', stars: 4, dust: '#d8c38e' },
};

/** Axe lissé de la route. route : B3D.Route (x, y, z, n, spacing). */
export class RoadPath {
  constructor(route) {
    this.r = route;
    this.n = route.n;
    this.sp = route.spacing;
    this.length = route.sEnd;
  }

  /** Point à l'abscisse s (m, abscisse étendue de Bike3D) : x, y, z, tangente (tx, ty, tz), droite (rx, rz), pente, i. */
  sample(s, out) {
    out = out || {};
    const R = this.r, n = this.n, sp = this.sp;
    let f = s / sp;
    if (f < 0) f = 0;
    if (f > n - 1.0001) f = n - 1.0001;
    const i = Math.floor(f), t = f - i;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = i + 1, i3 = Math.min(n - 1, i + 2);
    const cr = (a, b, c, d) => {
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    };
    const dcr = (a, b, c, d) => {
      const t2 = t * t;
      return 0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
    };
    const X = R.x, Y = R.y, Z = R.z;
    out.x = cr(X[i0], X[i1], X[i2], X[i3]);
    out.z = cr(Z[i0], Z[i1], Z[i2], Z[i3]);
    out.y = Y[i1] + (Y[i2] - Y[i1]) * t;     // l'altitude reste linéaire (déjà lissée par Bike3D)
    let tx = dcr(X[i0], X[i1], X[i2], X[i3]), tz = dcr(Z[i0], Z[i1], Z[i2], Z[i3]);
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    out.tx = tx; out.tz = tz;
    out.rx = -tz; out.rz = tx;
    out.grade = R.grade[i1] + (R.grade[i2] - R.grade[i1]) * t;
    out.ty = out.grade / Math.sqrt(1 + out.grade * out.grade);
    out.curv = R.curv[i1] + (R.curv[i2] - R.curv[i1]) * t;
    out.i = i; out.t = t;
    return out;
  }
}

const ROAD_VERT_PARS = /* glsl */`
attribute float aSurf;
attribute float aHalf;
attribute float aCont;
attribute float aEdge;
varying vec3 vRP;
varying vec2 vRUV;
flat varying float vSurf;
varying float vHalf;
varying float vCont;
varying float vEdge;
varying vec3 vRN;
`;
const ROAD_VERT = /* glsl */`
vRP = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRN = normalize(mat3(modelMatrix) * objectNormal);
vRUV = uv;
vSurf = aSurf; vHalf = aHalf; vCont = aCont; vEdge = aEdge;
`;

const ROAD_FRAG_PARS = NOISE + SAMPLE + /* glsl */`
uniform sampler2DArray uRA, uRB, uGA, uGB;
uniform float uRTile[7];
uniform float uWet, uSnow, uTimeR, uRainR;
uniform vec3 uVergeTint;
varying vec3 vRP;
varying vec2 vRUV;
flat varying float vSurf;
varying float vHalf;
varying float vCont;
varying float vEdge;
varying vec3 vRN;
vec3 rAlb; float rRough; vec3 rNorm; float rAO; float rMetal;
// ondes des gouttes de pluie dans les flaques
vec2 ripples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (1.6 + float(k) * 0.7) + float(k) * 7.1;
    vec2 i = floor(q), f = fract(q);
    vec2 c = h22(i) * 0.8 + 0.1;
    float ph = fract(t * (0.9 + 0.3 * h12(i + 3.0)) + h12(i));
    float d = length(f - c);
    float ring = sin((d - ph * 0.45) * 60.0) * smoothstep(0.45 * ph + 0.06, 0.45 * ph, d) * smoothstep(0.0, 0.05, 0.45 * ph - d + 0.05) * (1.0 - ph);
    acc += (f - c) / max(d, 1e-3) * ring;
  }
  return acc * 0.35;
}
void roadShade(vec3 N0, float dist) {
  float u = vRUV.x, v = vRUV.y;            // u : mètres depuis l'axe (+ à droite) ; v : mètres le long de la route
  float au = abs(u);
  int S = int(vSurf + 0.5);
  float layer = S == 2 ? 1.0 : S == 3 ? 2.0 : S == 4 ? 3.0 : S == 5 || S == 6 ? 4.0 : S == 7 ? 5.0 : S == 9 ? 6.0 : 0.0;
  bool paved = S <= 2 || S == 8;
  float tile = uRTile[int(layer)];
  vec2 uv = vec2(u, v) / tile;
  vec4 A = texA(uRA, uv, layer), B = texB(uRB, uv, layer);
  // seconde lecture décalée pour casser la répétition de l'enrobé
  float bl = smoothstep(0.3, 0.7, vnoise(vec2(u * 0.2, v * 0.05)));
  vec4 A2 = texA(uRA, uv * 0.71 + vec2(0.31, 0.17), layer), B2 = texB(uRB, uv * 0.71 + vec2(0.31, 0.17), layer);
  A = mix(A, A2, bl * 0.6); B = mix(B, B2, bl * 0.6);
  vec3 alb = A.rgb; float rough = B.z; float ao = B.w;
  vec3 tn = vec3(B.xy, sqrt(max(0.0, 1.0 - dot(B.xy, B.xy))));
  // usure à grande échelle : enrobé plus clair et plus lisse dans les traces de roues, réparations plus sombres
  if (paved) {
    float tracks = exp(-pow((au - vHalf * 0.48) / (vHalf * 0.16), 2.0));
    alb *= 1.0 + 0.18 * tracks;
    rough -= 0.12 * tracks;
    float patchZ = smoothstep(0.66, 0.7, vnoise(vec2(u * 0.35 + 3.0, v * 0.06)));
    alb = mix(alb, alb * 0.55, patchZ * (S == 2 ? 1.0 : 0.35));
    float fresh = S == 1 ? 1.0 : 0.0;
    alb *= mix(1.0, 0.72, fresh);
    alb *= 0.9 + 0.2 * vnoise(vec2(u * 0.4, v * 0.02));
  } else if (S == 6 || S == 5 || S == 7) {
    // chemins : bande d'herbe au milieu, ornières dans les traces
    float mid = smoothstep(0.55, 0.25, au) * (S == 7 ? 1.0 : 0.6) * smoothstep(0.35, 0.6, vnoise(vec2(u * 2.0, v * 0.3)));
    vec4 G = texA(uGA, vRP.xz / 2.4, 0.0);
    alb = mix(alb, G.rgb, mid);
    float rut = exp(-pow((au - 0.85) / 0.3, 2.0));
    alb *= 1.0 - 0.18 * rut;
  }
  // marquages : rives continues, axe discontinu (3 m de trait, 10 m d'espace) ou continu dans les virages serrés
  float paint = 0.0;
  if (paved && vHalf > 2.3) {
    float aa = fwidth(u) * 0.8;
    float edgeU = vHalf - 0.28;
    float edge = smoothstep(0.075 + aa, 0.075 - aa, abs(au - edgeU));
    float dash = step(fract(v / 13.0), 3.0 / 13.0);
    float center = smoothstep(0.06 + aa, 0.06 - aa, au) * max(dash, step(0.5, vCont)) * step(2.6, vHalf);
    float wear = smoothstep(0.25, 0.55, vnoise(vec2(u * 6.0, v * 1.3))) * 0.6 + 0.4;
    paint = max(edge, center) * wear * (S == 2 ? 0.55 : 1.0);
  }
  alb = mix(alb, vec3(0.72, 0.72, 0.70), paint);
  rough = mix(rough, 0.5, paint);
  tn = normalize(mix(tn, vec3(0.0, 0.0, 1.0), paint * 0.8));
  // accotements : gravillons au bord de l'enrobé, puis herbe vers le terrain
  float verge = smoothstep(vHalf - 0.02, vHalf + 0.08, au);
  if (verge > 0.0) {
    float grassT = smoothstep(vHalf + 0.25, vHalf + 0.9, au + 0.3 * vnoise(vRP.xz * 0.9));
    vec4 Gr = texA(uGA, vRP.xz / 2.2, 6.0), Gn = texB(uGB, vRP.xz / 2.2, 6.0);
    vec4 Gg = texA(uGA, vRP.xz / 2.4, 0.0), Gb = texB(uGB, vRP.xz / 2.4, 0.0);
    vec3 va = mix(Gr.rgb, Gg.rgb * uVergeTint, grassT);
    vec4 vb = mix(Gn, Gb, grassT);
    alb = mix(alb, va, verge);
    rough = mix(rough, vb.z, verge);
    tn = normalize(mix(tn, vec3(vb.xy, sqrt(max(0.0, 1.0 - dot(vb.xy, vb.xy)))), verge));
    ao = mix(ao, vb.w, verge);
  }
  // neige : bourrelets sur les bords, chaussée blanchie au centre
  if (uSnow > 0.001) {
    float sn = uSnow * (0.35 + 0.65 * smoothstep(vHalf * 0.4, vHalf + 0.6, au)) * (0.7 + 0.3 * vnoise(vRP.xz * 0.6));
    alb = mix(alb, vec3(0.82, 0.85, 0.9), sn);
    rough = mix(rough, 0.6, sn);
  }
  // pluie : chaussée sombre et miroitante, flaques près des bords et dans les creux, ondes des gouttes
  float wet = max(uWet, S == 8 ? 0.85 : 0.0);
  if (wet > 0.001) {
    float por = paved ? 0.62 : 0.45;
    alb *= mix(1.0, 1.0 - por, wet);
    rough = mix(rough, paved ? 0.12 : 0.3, wet * (1.0 - verge * 0.6));
    float puddle = smoothstep(0.58, 0.68, vnoise(vec2(u * 0.6, v * 0.18)) + 0.25 * smoothstep(vHalf * 0.6, vHalf, au)) * wet;
    puddle *= paved || S == 7 || S == 5 ? 1.0 : 0.5;
    rough = mix(rough, 0.02, puddle);
    tn = normalize(mix(tn, vec3(0.0, 0.0, 1.0), puddle));
    if (uRainR > 0.05) tn.xy += ripples(vec2(u, v), uTimeR) * puddle * uRainR * 0.4;
  }
  // repère tangent (u, v) reconstruit à l'écran (repère cotangent)
  vec3 dp1 = dFdx(vRP), dp2 = dFdy(vRP);
  vec2 duv1 = dFdx(vRUV), duv2 = dFdy(vRUV);
  vec3 dp2perp = cross(dp2, N0), dp1perp = cross(N0, dp1);
  vec3 Tw = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 Bw = dp2perp * duv1.y + dp1perp * duv2.y;
  float im = inversesqrt(max(max(dot(Tw, Tw), dot(Bw, Bw)), 1e-12));
  rNorm = normalize(Tw * im * tn.x + Bw * im * tn.y + N0 * tn.z);
  rAlb = alb; rRough = clamp(rough, 0.02, 1.0); rAO = ao;
}
`;

function roadMaterial(tex, atmoU, engine, vergeTint) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uRA: { value: tex.road.A }, uRB: { value: tex.road.B }, uGA: { value: tex.ground.A }, uGB: { value: tex.ground.B },
      uRTile: { value: ROAD_TILE }, uWet: atmoU.uWet, uSnow: atmoU.uSnow, uTimeR: atmoU.uTime, uRainR: atmoU.uRain, uVergeTint: { value: vergeTint },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + ROAD_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + ROAD_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ROAD_FRAG_PARS)
      .replace('#include <map_fragment>', '#include <map_fragment>\nroadShade(normalize(vRN), length(vRP - cameraPosition));\ndiffuseColor.rgb = rAlb;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(rNorm, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= rAO;');
  };
  m.customProgramCacheKey = () => 'road-v1';
  engine.prepare(m);
  return m;
}

/** Construit la chaussée : un maillage par tronçon de 200 m (les tronçons hors de vue ne sont pas dessinés). */
export function buildRoad(world) {
  const { engine, tex, atmo, landscape: L, route, path } = world;
  const group = new THREE.Group();
  group.name = 'route';
  const verge = new THREE.Color(1, 1, 1);
  const mat = roadMaterial(tex, atmo.u, engine, verge);
  const step = 1.0;
  const CH = 200;
  const half0 = L.roadHalf;
  const sp = route.spacing;
  const q = {};
  // largeur et revêtement à chaque échantillon de Bike3D (bridge.onLandscape les a posés : L.surf, L.surfHalf)
  const halfAt = (i) => (L.bridgeMask[i] || !L.surfHalf ? half0 : L.surfHalf[i]);
  const surfAt = (i) => (L.surf ? L.surf[i] : 0);
  // axe continu dans les virages serrés (rayon < 180 m sur les 60 m qui viennent ou qui précèdent)
  const n = route.n;
  const cont = new Uint8Array(n);
  const reach = Math.ceil(60 / sp);
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = Math.max(0, i - reach); k <= Math.min(n - 1, i + reach); k++) c = Math.max(c, Math.abs(route.curv[k]));
    cont[i] = c > 1 / 180 ? 1 : 0;
  }
  // profil en travers : décalages (m, au-delà du bord de la chaussée pour les accotements) et hauteur
  const prof = (h) => {
    const cr = Math.min(0.06, 0.02 * h);   // bombement
    return [
      [-(h + 1.2), -0.16, 1], [-(h + 0.45), -0.05, 1], [-h, 0.0, 0], [-h * 0.55, cr * 0.7, 0], [0, cr, 0],
      [h * 0.55, cr * 0.7, 0], [h, 0.0, 0], [h + 0.45, -0.05, 1], [h + 1.2, -0.16, 1],
    ];
  };
  const NP = 9;
  for (let s0 = 0; s0 < route.sEnd; s0 += CH) {
    const s1 = Math.min(route.sEnd, s0 + CH);
    const rows = Math.ceil((s1 - s0) / step) + 1;
    const pos = [], nor = [], uv = [], surf = [], hal = [], con = [], edg = [], idx = [];
    let ox = 0, oz = 0, oy = 0, first = true, vcount = 0, prevOK = false;
    for (let r = 0; r < rows; r++) {
      const s = Math.min(s1, s0 + r * step);
      path.sample(s, q);
      const i = Math.min(n - 1, Math.round(s / sp));
      const dup = route.dup[i];
      if (first) { ox = q.x; oy = q.y; oz = q.z; first = false; }
      const h = halfAt(i), P = prof(h);
      const base = vcount;
      for (let k = 0; k < NP; k++) {
        const [lat, dy, e] = P[k];
        pos.push(q.x + q.rx * lat - ox, q.y + 0.04 + dy - oy, q.z + q.rz * lat - oz);
        nor.push(0, 1, 0);
        uv.push(lat, s);
        surf.push(surfAt(i)); hal.push(h); con.push(cont[i]); edg.push(e);
        vcount++;
      }
      const ok = !dup;
      if (r > 0 && ok && prevOK) {
        for (let k = 0; k < NP - 1; k++) {
          const a = base - NP + k, b = a + 1, c = base + k, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      prevOK = ok;
    }
    if (!idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 1));
    g.setAttribute('aHalf', new THREE.Float32BufferAttribute(hal, 1));
    g.setAttribute('aCont', new THREE.Float32BufferAttribute(con, 1));
    g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edg, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(ox, oy, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  engine.scene.add(group);
  return { group, material: mat, vergeTint: verge };
}
