/* Virtual Ride 3D Réaliste — terrain : tuiles calculées par des fils à part (terrain-worker.js), en trois niveaux de détail autour
   de la caméra (2 m, 8 m et 32 m entre les sommets, jusqu'à l'horizon). Une tuile grossière laisse un trou là où les tuiles fines
   sont prêtes ; une jupe le long du bord des tuiles fines cache les petites fentes.
   Le matériau mélange huit sols (herbe, herbe sèche, sous-bois, terre, roche, neige, gravier, boue) selon des poids par sommet, en
   tenant compte de la hauteur de chaque texture (les cailloux affleurent entre les herbes), avec une seconde lecture tournée pour
   casser la répétition, la roche plaquée sur trois axes dans les pentes, les sillons et rangs des champs, la neige sur les faces
   tournées vers le ciel, et le sol qui fonce et brille sous la pluie. */
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { SAMPLE, GROUND_TILE } from './textures.js';

const LEVELS = [
  { size: 128, seg: 64 },
  { size: 512, seg: 64 },
  { size: 2048, seg: 64 },
];

const TERRAIN_VERT_PARS = /* glsl */`
attribute vec4 aW0;
attribute vec4 aW1;
attribute vec3 aTint;
attribute float aStripe;
varying vec3 vWPos;
varying vec3 vWNorm;
varying vec4 vW0;
varying vec4 vW1;
varying vec3 vTint;
flat varying float vStripe;
`;
const TERRAIN_VERT = /* glsl */`
vec4 tw = modelMatrix * vec4(transformed, 1.0);
vWPos = tw.xyz;
vWNorm = normalize(mat3(modelMatrix) * objectNormal);
vW0 = aW0; vW1 = aW1; vTint = aTint; vStripe = aStripe;
`;

export const GROUND_FRAG_PARS = NOISE + SAMPLE + /* glsl */`
uniform sampler2DArray uGA, uGB;
uniform float uTile[8];
uniform float uWet, uSnow, uTimeT;
uniform vec2 uRowDir;
uniform vec3 uSoilRow, uVineRow, uLavender;
varying vec3 vWPos;
varying vec3 vWNorm;
varying vec4 vW0;
varying vec4 vW1;
varying vec3 vTint;
flat varying float vStripe;
vec3 gAlb; float gRough; vec3 gNorm; float gAO;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
// une couche lue deux fois (décalée et tournée), mélangée selon un bruit lent : la répétition ne se voit plus
void layerSample(int i, vec2 xz, float blend, out vec4 A, out vec4 Bn) {
  float L = float(i);
  vec2 uv = xz / uTile[i];
  vec4 a1 = texA(uGA, uv, L), b1 = texB(uGB, uv, L);
  if (blend > 0.01) {
    vec2 uv2 = rot(1.7) * uv * 0.83 + vec2(0.37, 0.61);
    vec4 a2 = texA(uGA, uv2, L), b2 = texB(uGB, uv2, L);
    b2.xy = rot(-1.7) * b2.xy;
    A = mix(a1, a2, blend); Bn = mix(b1, b2, blend);
  } else { A = a1; Bn = b1; }
}
void triRock(vec3 p, vec3 N, out vec4 A, out vec4 Bn) {
  vec3 w = pow(abs(N), vec3(4.0)); w /= dot(w, vec3(1.0));
  float t = uTile[4];
  vec4 ax = texA(uGA, p.zy / t, 4.0), ay = texA(uGA, p.xz / t, 4.0), az = texA(uGA, p.xy / t, 4.0);
  vec4 bx = texB(uGB, p.zy / t, 4.0), by = texB(uGB, p.xz / t, 4.0), bz = texB(uGB, p.xy / t, 4.0);
  A = ax * w.x + ay * w.y + az * w.z;
  // normales (mélange « whiteout ») : chaque plan perturbe la normale autour de son axe
  vec3 nx = vec3(bx.xy + N.zy, abs(N.x)).zyx; nx.x *= sign(N.x);
  vec3 ny = vec3(by.xy + N.xz, abs(N.y)).xzy; ny.y *= sign(N.y);
  vec3 nz = vec3(bz.xy + N.xy, abs(N.z)); nz.z *= sign(N.z);
  vec3 n = normalize(nx * w.x + ny * w.y + nz * w.z);
  Bn = vec4(n, 0.0);
  Bn.z = bx.z * w.x + by.z * w.y + bz.z * w.z;
  Bn.w = bx.w * w.x + by.w * w.y + bz.w * w.z;
  gNorm = n;
}
void groundShade(vec3 P, vec3 N, float dist) {
  float w[8];
  w[0] = vW0.x; w[1] = vW0.y; w[2] = vW0.z; w[3] = vW0.w; w[4] = vW1.x; w[5] = vW1.y; w[6] = vW1.z; w[7] = vW1.w;
  // neige fraîche sur les faces tournées vers le ciel
  float snowK = uSnow * smoothstep(0.45, 0.8, N.y) * (0.75 + 0.25 * vnoise(P.xz * 0.15));
  w[5] = max(w[5], snowK);
  float blend = smoothstep(0.35, 0.65, vnoise(P.xz / 19.0)) * (1.0 - smoothstep(250.0, 500.0, dist));
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x), Bt = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
  vec4 As[8]; vec4 Rs[8]; vec3 Ns[8]; float Hs[8];
  float hmax = -9.0;
  // chaque couche présente : albédo et hauteur, normale, rugosité et occlusion
  for (int i = 0; i < 8; i++) {
    Hs[i] = -9.0;
    if (w[i] < 0.004) continue;
    vec4 A, Bn;
    vec3 n;
    if (i == 4) { triRock(P, N, A, Bn); n = gNorm; }
    else {
      layerSample(i, P.xz, blend, A, Bn);
      float nz = sqrt(max(0.0, 1.0 - dot(Bn.xy, Bn.xy)));
      n = normalize(T * Bn.x + Bt * Bn.y + N * nz);
    }
    As[i] = A; Rs[i] = Bn; Ns[i] = n;
    Hs[i] = A.a + w[i] * 1.6;
    hmax = max(hmax, Hs[i]);
  }
  // transition par la hauteur : seules les couches proches du maximum comptent
  vec3 alb = vec3(0.0), nsum = vec3(0.0); float rough = 0.0, ao = 0.0, tot = 0.0;
  for (int i = 0; i < 8; i++) {
    if (Hs[i] < -5.0) continue;
    float b = max(Hs[i] - hmax + 0.25, 0.0);
    if (b <= 0.0) continue;
    vec3 a = As[i].rgb;
    if (i == 0 || i == 1 || i == 3) a *= vTint;
    alb += a * b; rough += Rs[i].z * b; ao += Rs[i].w * b; nsum += Ns[i] * b; tot += b;
  }
  alb /= tot; rough /= tot; ao /= tot;
  vec3 n = normalize(nsum);
  // variations lentes de teinte et de clarté (le sol n'est jamais uniforme)
  float macro = vnoise(P.xz / 61.0) * 0.6 + vnoise(P.xz / 7.3) * 0.4;
  alb *= 0.86 + 0.28 * macro;
  // sillons et rangs des champs (attribut de Bike3D : 1 labour, 2 vigne, 3 lavande, 4 tournesol, 5 citrouille ; +8 tourné de 90°)
  float sk = mod(vStripe, 8.0);
  if (sk > 0.5) {
    vec2 rd = vStripe > 7.5 ? vec2(-uRowDir.y, uRowDir.x) : uRowDir;
    float across = dot(P.xz, vec2(-rd.y, rd.x));
    float spacing = sk < 1.5 ? 0.8 : sk < 2.5 ? 3.2 : sk < 3.5 ? 2.6 : sk < 4.5 ? 0.8 : 2.4;
    float ph = fract(across / spacing);
    float ridge = 0.5 + 0.5 * cos(ph * 6.2831853);
    float fade = 1.0 - smoothstep(120.0, 600.0, dist);
    // relief des rangs : la normale penche de chaque côté du sillon
    float slopeR = -sin(ph * 6.2831853) * 0.55 * fade;
    vec3 acrossW = normalize(vec3(-rd.y, 0.0, rd.x));
    n = normalize(n + acrossW * slopeR * (sk < 1.5 || sk > 3.5 ? 1.0 : 0.35));
    if (sk < 1.5) alb *= 0.72 + 0.4 * ridge;
    else if (sk < 2.5) { float row = smoothstep(0.82, 0.95, ridge); alb = mix(alb, uVineRow, row * 0.75); }
    else if (sk < 3.5) { float row = smoothstep(0.5, 0.9, ridge); alb = mix(alb, uLavender, row * 0.85); rough = mix(rough, 0.8, row); }
    else if (sk < 4.5) { alb = mix(alb, vec3(0.05, 0.08, 0.02), smoothstep(0.4, 0.9, ridge) * 0.6); }
    else { alb = mix(alb, vec3(0.06, 0.09, 0.025), smoothstep(0.5, 0.9, ridge) * 0.5); }
  }
  // pluie : le sol fonce (il boit l'eau) et devient plus brillant ; flaques dans les creux plats
  if (uWet > 0.001) {
    float por = 1.0 - w[4] * 0.6 - w[5];
    alb *= mix(1.0, 0.55, uWet * por);
    rough = mix(rough, rough * 0.55, uWet);
    float puddle = smoothstep(0.62, 0.7, vnoise(P.xz * 0.25)) * smoothstep(0.96, 0.99, N.y) * uWet * (w[7] + w[3] + w[6]);
    rough = mix(rough, 0.04, puddle);
    alb = mix(alb, alb * 0.4, puddle);
    n = normalize(mix(n, N, puddle));
  }
  gAlb = alb; gRough = clamp(rough, 0.04, 1.0); gNorm = n; gAO = ao;
}
`;

function patchGround(mat, tex, atmoU, extra) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGA: { value: tex.ground.A }, uGB: { value: tex.ground.B }, uTile: { value: GROUND_TILE },
      uWet: atmoU.uWet, uSnow: atmoU.uSnow, uTimeT: atmoU.uTime,
      uRowDir: { value: extra.rowDir }, uVineRow: { value: extra.vineRow }, uLavender: { value: extra.lavender }, uSoilRow: { value: extra.soil },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_VERT_PARS)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TERRAIN_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_FRAG_PARS)
      .replace('#include <map_fragment>', `#include <map_fragment>
        groundShade(vWPos, normalize(vWNorm), length(vWPos - cameraPosition));
        diffuseColor.rgb = gAlb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNorm, 0.0)).xyz);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= gAO; reflectedLight.indirectSpecular *= gAO * gAO;');
  };
  mat.customProgramCacheKey = () => 'ground-v1';
}

export class Terrain {
  /** world : {engine, tex, atmo, Q, landscape, route, workerInit} */
  constructor(world) {
    this.world = world;
    this.engine = world.engine;
    this.Q = world.Q;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.engine.scene.add(this.group);
    this.levels = LEVELS.map((d, i) => Object.assign({}, d, { ring: this.Q.terrain[i], tiles: new Map() }));
    const L = world.landscape;
    const C = (h) => new THREE.Color(h);
    this.extra = {
      rowDir: new THREE.Vector2(L.bio.rowDir[0], L.bio.rowDir[1]),
      vineRow: C('#2f4a1c'), lavender: C('#5d4a8c'), soil: C('#4a3624'),
    };
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    patchGround(this.material, world.tex, world.atmo.u, this.extra);
    this.engine.prepare(this.material);
    this.indexCache = new Map();
    this.pending = new Map();
    this.workers = [];
    this.queue = [];
    this.inflight = 0;
    this.idSeq = 1;
    this.listeners = [];
    this.ready = false;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
  }

  /** Lance les fils de calcul ; résout quand ils ont construit le paysage. */
  start() {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const url = new URL('./terrain-worker.js', import.meta.url);
    const init = this.world.workerInit;
    const ps = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      w.busy = 0;
      ps.push(new Promise((res, rej) => {
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') { w.onmessage = (ev) => this._onMsg(w, ev.data); res(); }
          else if (m.type === 'error') rej(new Error(m.text));
        };
        w.onerror = (e) => rej(new Error(e.message || 'fil du terrain'));
      }));
      w.postMessage(Object.assign({ type: 'init' }, init));
      this.workers.push(w);
    }
    return Promise.all(ps).then(() => { this.ready = true; });
  }

  onTile(fn) { this.listeners.push(fn); }

  _onMsg(w, m) {
    w.busy--;
    this.inflight--;
    if (m.type === 'error') { console.error('terrain', m.text, m.stack); return; }
    if (m.type !== 'tile') return;
    const lv = this.levels[m.level];
    const key = m.tx + ',' + m.tz;
    const slot = lv.tiles.get(key);
    if (!slot || slot.id !== m.id) return;   // tuile devenue inutile entre-temps
    this._makeMesh(slot, m);
    for (const fn of this.listeners) fn('add', slot);
    this._markParents(m.level, m.tx, m.tz);
  }

  _index(level, holes) {
    const N = this.levels[level].seg, V = N + 1;
    const key = level + '|' + (holes || '');
    if (this.indexCache.has(key)) return this.indexCache.get(key);
    const idx = [];
    const k = level === 0 ? 0 : 4;        // une tuile de niveau n contient 4 × 4 tuiles du niveau n − 1
    const sub = N / 4;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (holes && k) {
          const c = Math.floor(j / sub) * 4 + Math.floor(i / sub);
          if (holes[c] === '1') continue;
        }
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // jupes : bord nord, sud, ouest, est (la jupe suit le bord)
    if (level < 2) {
      const base = V * V;
      const side = (s, edge) => {
        for (let q = 0; q < N; q++) {
          const a = edge(q), b = edge(q + 1), sa = base + s * V + q, sb = sa + 1;
          idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
        }
      };
      side(0, (q) => q);
      side(1, (q) => N * V + q);
      side(2, (q) => q * V);
      side(3, (q) => q * V + N);
    }
    const arr = (V * V + 4 * V) > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    const attr = new THREE.BufferAttribute(arr, 1);
    this.indexCache.set(key, attr);
    return attr;
  }

  _makeMesh(slot, m) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('aW0', new THREE.BufferAttribute(m.w0, 4));
    g.setAttribute('aW1', new THREE.BufferAttribute(m.w1, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(m.tint, 3));
    g.setAttribute('aStripe', new THREE.BufferAttribute(m.stripe, 1));
    g.setIndex(this._index(m.level, slot.holes));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, m.minH - 20, 0), new THREE.Vector3(m.size, m.maxH + 5, m.size));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(m.x0, 0, m.z0);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.receiveShadow = true;
    mesh.castShadow = m.level < 2;
    this.group.add(mesh);
    slot.mesh = mesh;
    slot.data = m;
    slot.ready = true;
  }

  // une tuile fine prête ou retirée : la tuile grossière qui la contient refait son trou
  _markParents(level, tx, tz) {
    for (let l = level + 1; l < this.levels.length; l++) {
      const f = Math.pow(4, l - level);
      const px = Math.floor(tx / f), pz = Math.floor(tz / f);
      const p = this.levels[l].tiles.get(px + ',' + pz);
      if (p) p.dirty = true;
    }
  }

  _holes(level, tx, tz) {
    if (level === 0) return '';
    const fine = this.levels[level - 1].tiles;
    let s = '';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const c = fine.get((tx * 4 + i) + ',' + (tz * 4 + j));
      s += c && c.ready && this._covered(level - 1, tx * 4 + i, tz * 4 + j, c) ? '1' : '0';
    }
    return s;
  }

  // une tuile fine couvre-t-elle tout son carré ? (oui si elle est prête ; ses propres trous sont couverts par plus fin encore)
  _covered() { return true; }

  /** Tuiles à charger et à retirer autour de la caméra (appelé à chaque image). */
  update(cam) {
    if (!this.ready) return;
    const cx = cam.x, cz = cam.z;
    const moved = Math.hypot(cx - this.lastCam.x, cz - this.lastCam.z) > 8;
    if (moved) {
      this.lastCam.set(cx, 0, cz);
      this.queue.length = 0;
      for (let l = 0; l < this.levels.length; l++) {
        const lv = this.levels[l], S = lv.size, R = lv.ring;
        const i0 = Math.floor((cx - R) / S), i1 = Math.floor((cx + R) / S), j0 = Math.floor((cz - R) / S), j1 = Math.floor((cz + R) / S);
        const want = new Set();
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const ccx = (i + 0.5) * S, ccz = (j + 0.5) * S;
          const d = Math.max(0, Math.hypot(ccx - cx, ccz - cz) - S * 0.7071);
          if (d > R) continue;
          const key = i + ',' + j;
          want.add(key);
          let slot = lv.tiles.get(key);
          if (!slot) { slot = { level: l, tx: i, tz: j, id: 0, ready: false, holes: '', d }; lv.tiles.set(key, slot); this._markParents(l, i, j); }
          slot.d = d;
          if (!slot.id) this.queue.push(slot);
        }
        // tuiles trop loin : retirées (avec une marge pour ne pas osciller)
        for (const [key, slot] of lv.tiles) {
          if (want.has(key)) continue;
          const ccx = (slot.tx + 0.5) * S, ccz = (slot.tz + 0.5) * S;
          if (Math.hypot(ccx - cx, ccz - cz) - S * 0.7071 < R + S * 0.6) continue;
          this._remove(lv, key, slot);
        }
      }
      // les plus proches d'abord ; les tuiles fines passent devant à distance égale
      this.queue.sort((a, b) => (a.d + a.level * 150) - (b.d + b.level * 150));
    }
    // envoi aux fils libres
    const cap = this.workers.length * 2;
    while (this.queue.length && this.inflight < cap) {
      const slot = this.queue.shift();
      if (slot.id) continue;
      const w = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      slot.id = this.idSeq++;
      w.busy++; this.inflight++;
      const lv = this.levels[slot.level];
      w.postMessage({ type: 'tile', id: slot.id, level: slot.level, tx: slot.tx, tz: slot.tz, size: lv.size, seg: lv.seg, veg: slot.level < 2 });
    }
    // trous des tuiles grossières
    for (let l = 1; l < this.levels.length; l++) {
      for (const slot of this.levels[l].tiles.values()) {
        if (!slot.dirty || !slot.ready) continue;
        slot.dirty = false;
        const h = this._holes(l, slot.tx, slot.tz);
        if (h !== slot.holes) {
          slot.holes = h;
          slot.mesh.geometry.setIndex(this._index(l, h));
          slot.mesh.visible = h !== '1111111111111111';
        }
      }
    }
  }

  _remove(lv, key, slot) {
    lv.tiles.delete(key);
    if (slot.mesh) {
      this.group.remove(slot.mesh);
      slot.mesh.geometry.dispose();
      for (const fn of this.listeners) fn('remove', slot);
    }
    this._markParents(slot.level, slot.tx, slot.tz);
  }

  /** Nombre de tuiles encore à calculer près de la caméra (écran de chargement). */
  pendingNear(cam, r) {
    let n = 0, tot = 0;
    for (const lv of this.levels) for (const s of lv.tiles.values()) {
      if (s.d > (lv === this.levels[0] ? r : lv.ring)) continue;
      tot++; if (!s.ready) n++;
    }
    return { left: n, total: tot };
  }

  /** Altitude du sol (m) en (x, z), d'après les tuiles chargées (la plus fine), ou null. */
  heightAt(x, z) {
    for (const lv of this.levels) {
      const S = lv.size, i = Math.floor(x / S), j = Math.floor(z / S);
      const slot = lv.tiles.get(i + ',' + j);
      if (!slot || !slot.ready) continue;
      const d = slot.data, V = lv.seg + 1, st = S / lv.seg;
      const fx = Math.min(V - 1.001, (x - d.x0) / st), fz = Math.min(V - 1.001, (z - d.z0) / st);
      const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, q = iz * V + ix, H = d.H;
      return (H[q] * (1 - ax) + H[q + 1] * ax) * (1 - az) + (H[q + V] * (1 - ax) + H[q + V + 1] * ax) * az;
    }
    return null;
  }

  /** Tuile fine (niveau 0) prête qui contient (x, z), ou null. */
  fineTile(x, z) {
    const lv = this.levels[0], S = lv.size;
    const slot = lv.tiles.get(Math.floor(x / S) + ',' + Math.floor(z / S));
    return slot && slot.ready ? slot : null;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const lv of this.levels) for (const [key, slot] of lv.tiles) this._remove(lv, key, slot);
  }
}
