/* Virtual Ride 3D Réaliste — le bord de la route et les villages de Bike3D :
   - glissières de sécurité en acier galvanisé sur poteaux (côtés en surplomb), parapets de pierre des ponts et leurs piles ;
   - bornes kilométriques (borne blanche à tête rouge, distance restante jusqu'à l'arrivée) ;
   - villages : maisons alignées le long de la route (enduit ou pierre, toits de tuiles canal au Sud, d'ardoise au Nord et en
     montagne, fenêtres à volets, portes, cheminées, fenêtres éclairées la nuit), l'église et son clocher, panneaux d'entrée et de
     sortie au nom du village ;
   - la course : arches gonflables de départ et d'arrivée, des sprints, des sommets classés et du ravitaillement, banderole « flamme
     rouge » à 1 km, barrières de foule dans le dernier kilomètre et aux sprints, et le public (villages, fin des côtes, arrivée). */
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------------------------------------------------------- géométrie */

// sommet : position, normale, uv (m), couleur, matériau [rugosité, métal, couche de texture (−1 : aucune), fenêtres (étages)],
// fenêtres [espacement, décalage, teinte des volets, position de la porte]
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.m = []; this.w = []; this.i = []; this.mat = [0.8, 0, -1, 0]; this.win = [0, 0, 0, -99]; this.col = [1, 1, 1]; }
  get count() { return this.p.length / 3; }
  v(p, n, u, v) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(...this.col); this.m.push(...this.mat); this.w.push(...this.win); return this.count - 1; }
  // quadrilatère a, b, c, d (sens direct vu de la face) ; uv en mètres depuis a, le long de ab et ad
  quad(a, b, c, d, u0, v0) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const lu = a.distanceTo(b), lv = a.distanceTo(d);
    u0 = u0 || 0; v0 = v0 || 0;
    const ia = this.v(a, n, u0, v0), ib = this.v(b, n, u0 + lu, v0), ic = this.v(c, n, u0 + lu, v0 + lv), id = this.v(d, n, u0, v0 + lv);
    this.i.push(ia, ib, ic, ia, ic, id);
  }
  tri(a, b, c) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const ia = this.v(a, n, 0, 0), ib = this.v(b, n, a.distanceTo(b), 0), ic = this.v(c, n, 0, a.distanceTo(c));
    this.i.push(ia, ib, ic);
  }
  // boîte orientée : centre au sol c, demi-largeur hw (le long de r), demi-profondeur hd (le long de f), hauteur h
  box(c, f, hw, hd, h, top) {
    const r = V(f.z, 0, -f.x);
    const P = (sx, sy, sz) => c.clone().addScaledVector(r, sx * hw).addScaledVector(f, sz * hd).add(V(0, sy * h, 0));
    this.quad(P(-1, 0, 1), P(1, 0, 1), P(1, 1, 1), P(-1, 1, 1));
    this.quad(P(1, 0, -1), P(-1, 0, -1), P(-1, 1, -1), P(1, 1, -1));
    this.quad(P(1, 0, 1), P(1, 0, -1), P(1, 1, -1), P(1, 1, 1));
    this.quad(P(-1, 0, -1), P(-1, 0, 1), P(-1, 1, 1), P(-1, 1, -1));
    if (top !== false) this.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1));
  }
  // cylindre vertical
  cyl(c, r, h, n) {
    n = n || 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const p0 = c.clone().add(V(Math.cos(a0) * r, 0, Math.sin(a0) * r)), p1 = c.clone().add(V(Math.cos(a1) * r, 0, Math.sin(a1) * r));
      this.quad(p1, p0, p0.clone().add(V(0, h, 0)), p1.clone().add(V(0, h, 0)), k * r * 0.6, 0);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 4));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.w, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const SHUTTERS = [[0.16, 0.25, 0.32], [0.30, 0.45, 0.32], [0.55, 0.18, 0.12], [0.75, 0.72, 0.62], [0.25, 0.30, 0.22], [0.10, 0.10, 0.10]];

const BUILD_FRAG = NOISE + /* glsl */`
uniform sampler2DArray uBA, uBB;
uniform float uNightB, uWetB;
uniform vec3 uShut[6];
varying vec2 vBuv;
varying vec4 vMat;
varying vec4 vWin;
varying vec3 vBW;
float bRough, bMetal; vec3 bEmis; vec3 bTN;
vec3 buildAlbedo(vec3 base) {
  bRough = vMat.x; bMetal = vMat.y; bEmis = vec3(0.0); bTN = vec3(0.0, 0.0, 1.0);
  vec3 a = base;
  float L = vMat.z;
  if (L > -0.5) {
    vec2 uv = vBuv / 1.6;
    vec4 A = texture(uBA, vec3(uv, L)), Bn = texture(uBB, vec3(uv, L));
    a *= A.rgb * A.rgb * 2.2;
    bRough = Bn.z;
    bTN = vec3(Bn.xy * 2.0 - 1.0, 1.0); bTN.z = sqrt(max(0.0, 1.0 - dot(bTN.xy, bTN.xy)));
  }
  // salissures en bas des murs, traces de pluie
  a *= 0.82 + 0.18 * smoothstep(0.0, 1.2, vBuv.y);
  // fenêtres, volets et porte des façades
  if (vMat.w > 0.5) {
    float sp = vWin.x, u = vBuv.x - vWin.y, v = vBuv.y;
    float fl = floor(v / 3.0), cy = fract(v / 3.0);
    float cx = fract(u / sp) * sp - sp * 0.5;   // m depuis l'axe de la fenêtre
    float cell = floor(u / sp);
    bool door = fl < 0.5 && abs(vBuv.x - vWin.w) < 0.6 && v < 2.25;
    if (door) {
      a = vec3(0.16, 0.09, 0.05) * (0.8 + 0.2 * vnoise(vBuv * vec2(30.0, 2.0)));
      bRough = 0.6; bTN = vec3(0.0, 0.0, 1.0);
    } else if (fl < vMat.w && u > 0.6 && cy > 0.3 && cy < 0.8) {
      float hw = 0.5, sw = 0.48;
      if (abs(cx) < hw) {
        // vitre (avec un cadre clair) : reflet du ciel, lumière la nuit
        float frame = step(hw - 0.06, abs(cx)) + step(0.77, cy) + step(cy, 0.33) + step(abs(cx), 0.025);
        if (frame > 0.5) { a = vec3(0.75, 0.74, 0.7); bRough = 0.5; }
        else {
          a = vec3(0.02, 0.022, 0.025); bRough = 0.04; bMetal = 0.2;
          float on = step(0.55, h12(vec2(cell, fl) + floor(vWin.y * 3.1)));
          bEmis = vec3(1.0, 0.62, 0.3) * on * uNightB * 2.5;
        }
        bTN = vec3(0.0, 0.0, 1.0);
      } else if (abs(cx) < hw + sw) {
        // volets ouverts, à lames
        a = uShut[int(vWin.z + 0.5)] * (0.75 + 0.25 * step(0.5, fract(v * 9.0)));
        bRough = 0.55; bTN = vec3(0.0, -0.15 * sin(v * 56.0), 1.0);
      }
    }
  }
  a *= mix(1.0, 0.6, uWetB * 0.6);
  bRough = mix(bRough, bRough * 0.5, uWetB);
  return a;
}
`;

function buildMaterial(engine, tex, u) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uBA: { value: tex.bark.A }, uBB: { value: tex.bark.B }, uNightB: u.uNight, uWetB: u.uWet, uShut: { value: SHUTTERS.map((c) => new THREE.Vector3(...c)) } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aMat; attribute vec4 aWin; varying vec2 vBuv; varying vec4 vMat; varying vec4 vWin; varying vec3 vBW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBuv = uv; vMat = aMat; vWin = aWin; vBW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BUILD_FRAG}
        mat3 cotangentFrameB(vec3 N, vec3 p, vec2 uv) {
          vec3 dp1 = dFdx(p), dp2 = dFdy(p); vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
          vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
          vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
          float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
          return mat3(T * im, B * im, N);
        }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = buildAlbedo(diffuseColor.rgb);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = bRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize(cotangentFrameB(normal, -vViewPosition, vBuv) * bTN);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bEmis;');
  };
  m.customProgramCacheKey = () => 'build-v1';
  engine.prepare(m);
  return m;
}

/* ---------------------------------------------------------------- textes (panneaux, banderoles) */

function textTexture(lines, opts) {
  const W = opts.w || 1024, H = opts.h || 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = opts.bg || '#ffffff'; ctx.fillRect(0, 0, W, H);
  if (opts.border) { ctx.strokeStyle = opts.border; ctx.lineWidth = H * 0.07; ctx.strokeRect(H * 0.06, H * 0.06, W - H * 0.12, H - H * 0.12); }
  if (opts.dots) { ctx.fillStyle = opts.dots; for (let y = 20; y < H; y += 46) for (let x = ((y / 46) % 2) * 23 + 12; x < W; x += 46) { ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.3); ctx.fill(); } }
  ctx.fillStyle = opts.fg || '#111111';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((t, k) => {
    let size = Math.round(H / (n + 0.6) * (k === 0 ? 0.95 : 0.7));
    ctx.font = `700 ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    while (ctx.measureText(t).width > W * 0.9 && size > 10) { size -= 2; ctx.font = `700 ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`; }
    ctx.fillText(t, W / 2, H * (k + 0.8) / (n + 0.6));
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------------------------------------------------------------- le bord de route */

export class Roadside {
  constructor(world) {
    this.world = world;
    const E = this.engine = world.engine;
    this.group = new THREE.Group();
    this.group.name = 'bord de route';
    E.scene.add(this.group);
    this.mat = buildMaterial(E, world.tex, world.atmo.u);
    this.crowd = [];
    const L = world.landscape, route = world.route, path = world.path;
    this.L = L; this.route = route; this.path = path;
    const g = new GB();
    this._rails(g);
    this._bridges(g);
    this._kmMarkers(g);
    for (const v of L.villages || []) this._village(g, v);
    this._race(g);
    if (g.count) {
      const mesh = new THREE.Mesh(g.build(), this.mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.crowdPlaced = false;
  }

  _rows(i) { const R = this.route; return { x: R.x[i], y: R.y[i], z: R.z[i], tx: R.tx[i], tz: R.tz[i], rx: -R.tz[i], rz: R.tx[i] }; }

  _runs(mask) {
    const out = [], n = this.route.n, dup = this.route.dup;
    let a = -1;
    for (let i = 0; i <= n; i++) {
      if (i < n && mask[i] && !dup[i]) { if (a < 0) a = i; }
      else if (a >= 0) { out.push([a, i - 1]); a = -1; }
    }
    return out;
  }

  // glissières : lisse ondulée sur poteaux tous les 4 m
  _rails(g) {
    const L = this.L, path = this.path, sp = this.route.spacing, q = {}, q2 = {};
    g.mat = [0.35, 1, -1, 0]; g.col = [0.62, 0.63, 0.64];
    for (const [mask, side] of [[L.railL, -1], [L.railR, 1]]) {
      for (const [a, b] of this._runs(mask)) {
        const s0 = a * sp, s1 = b * sp;
        const off = L.roadHalf + 0.7;
        for (let s = s0; s < s1; s += 2) {
          path.sample(s, q); path.sample(Math.min(s1, s + 2), q2);
          const P = (o, sy, extra) => V(o.x + o.rx * (off + extra) * side, o.y + sy, o.z + o.rz * (off + extra) * side);
          // lisse : trois faces (profil en W simplifié)
          const A0 = P(q, 0.5, 0), A1 = P(q, 0.62, -0.04 * side * side), A2 = P(q, 0.74, 0), B0 = P(q2, 0.5, 0), B1 = P(q2, 0.62, -0.04), B2 = P(q2, 0.74, 0);
          if (side < 0) { g.quad(A0, B0, B1, A1); g.quad(A1, B1, B2, A2); } else { g.quad(B0, A0, A1, B1); g.quad(B1, A1, A2, B2); }
        }
        for (let s = s0; s <= s1; s += 4) {
          path.sample(s, q);
          g.box(V(q.x + q.rx * (L.roadHalf + 0.85) * side, q.y - 0.3, q.z + q.rz * (L.roadHalf + 0.85) * side), V(q.tx, 0, q.tz), 0.04, 0.06, 1.0);
        }
      }
    }
  }

  // ponts : parapets de pierre, piles sous le tablier
  _bridges(g) {
    const L = this.L, path = this.path, sp = this.route.spacing, q = {};
    for (const [a, b] of L.bridges || []) {
      const s0 = a * sp, s1 = b * sp, half = L.roadHalf;
      g.mat = [0.9, 0, 4, 0]; g.col = [0.95, 0.9, 0.82];
      for (const side of [-1, 1]) {
        for (let s = s0; s < s1; s += 1.5) {
          path.sample(s + 0.75, q);
          g.box(V(q.x + q.rx * (half + 0.25) * side, q.y - 0.2, q.z + q.rz * (half + 0.25) * side), V(q.tx, 0, q.tz), 0.25, 0.78, 1.0);
        }
      }
      // tablier : sous-face et rives
      g.mat = [0.9, 0, 4, 0];
      for (let s = s0; s < s1; s += 2) {
        path.sample(s + 1, q);
        g.box(V(q.x, q.y - 1.4, q.z), V(q.tx, 0, q.tz), half + 0.45, 1.02, 1.35, false);
      }
      // une pile au milieu
      path.sample((s0 + s1) / 2, q);
      g.box(V(q.x, q.y - 12, q.z), V(q.tx, 0, q.tz), half * 0.6, 1.2, 10.7);
    }
  }

  // bornes kilométriques tous les kilomètres (côté droit), distance restante
  _kmMarkers(g) {
    const W = this.world, path = this.path, q = {};
    const total = W.pyrLen;
    for (let d = 1000; d < total - 200; d += 1000) {
      const s = W.toS(total - d);
      path.sample(s, q);
      const off = W.halfAt(s) + 1.0;
      const c = V(q.x + q.rx * off, q.y - 0.05, q.z + q.rz * off);
      const f = V(-q.rx, 0, -q.rz);
      g.mat = [0.6, 0, -1, 0]; g.col = [0.85, 0.85, 0.83];
      g.box(c, f, 0.2, 0.1, 0.62);
      g.col = [0.55, 0.06, 0.04];
      g.box(c.clone().add(V(0, 0.62, 0)), f, 0.2, 0.1, 0.2);
    }
  }

  // un village : maisons des deux côtés, église au centre, panneaux d'entrée
  _village(g, v) {
    const L = this.L, route = this.route, path = this.path, sp = route.spacing, q = {};
    const rnd = rng(v.seed || 1);
    const south = v.style === 'sud', mont = v.style === 'montagne';
    const roofLayer = south ? 5 : 6;
    const wallStone = mont ? 0.6 : south ? 0.25 : 0.35;
    const s0 = v.i0 * sp, s1 = v.i1 * sp, sc = v.ic * sp;
    const half = L.roadHalf;
    // l'église, au centre, d'un côté
    const churchSide = rnd() < 0.5 ? -1 : 1;
    const churchS = sc + (rnd() - 0.5) * 30;
    for (const side of [-1, 1]) {
      let s = s0 + rnd() * 6;
      while (s < s1) {
        const w = 7 + rnd() * 6, d = 7 + rnd() * 4;
        const sMid = s + w / 2;
        if (side === churchSide && Math.abs(sMid - churchS) < 18) { s = churchS + 18; continue; }
        path.sample(sMid, q);
        // pas dans un autre passage de la route (lacets)
        const setback = half + 2.2 + rnd() * 2.5 + d / 2;
        const cx = q.x + q.rx * setback * side, cz = q.z + q.rz * setback * side;
        const nr = route.nearest(cx, cz, 30, {});
        if (nr.i >= 0 && Math.abs(nr.i * sp - sMid) > 60 && nr.d < d / 2 + half + 3) { s += w + 2; continue; }
        const floors = 2 + (rnd() < 0.35 ? 1 : 0) - (mont && rnd() < 0.4 ? 0 : 0);
        const f = V(-q.rx * side, 0, -q.rz * side);   // la façade regarde la route
        const y = q.y - 0.3;
        this._house(g, V(cx, y, cz), f, w / 2, d / 2, floors, rnd, roofLayer, rnd() < wallStone, south);
        s += w + (rnd() < 0.3 ? 4 + rnd() * 6 : 0.3);
      }
    }
    path.sample(churchS, q);
    const off = half + 14;
    const cc = V(q.x + q.rx * off * churchSide, q.y - 0.3, q.z + q.rz * off * churchSide);
    this._church(g, cc, V(q.tx, 0, q.tz), rnd, roofLayer);
    // panneaux d'entrée et de sortie (blancs, liseré rouge, nom du village)
    const tex = textTexture([v.name || 'Village'], { bg: '#f4f3ef', border: '#c5161d', fg: '#111' });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    this.engine.prepare(mat);
    for (const [ss, flip] of [[s0 - 15, 1], [s1 + 15, -1]]) {
      path.sample(ss, q);
      const sx = q.x + q.rx * (half + 1.3), sz = q.z + q.rz * (half + 1.3);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.42), mat);
      panel.position.set(sx, q.y + 1.6, sz);
      panel.rotation.y = Math.atan2(q.tx, q.tz) + (flip > 0 ? Math.PI : 0);
      panel.castShadow = true;
      this.group.add(panel);
      g.mat = [0.4, 1, -1, 0]; g.col = [0.55, 0.56, 0.57];
      g.box(V(sx, q.y - 0.2, sz), V(q.tx, 0, q.tz), 0.03, 0.03, 1.8);
    }
    // public dans le village
    for (let k = 0; k < 40; k++) {
      const ss = s0 + rnd() * (s1 - s0);
      path.sample(ss, q);
      const side = rnd() < 0.5 ? -1 : 1, o = half + 0.8 + rnd() * 1.5;
      this.crowd.push({ x: q.x + q.rx * o * side, y: q.y, z: q.z + q.rz * o * side, yaw: Math.atan2(-q.rx * side, -q.rz * side) + (rnd() - 0.5) * 0.8, up: rnd() < 0.25 });
    }
  }

  _house(g, c, f, hw, hd, floors, rnd, roofLayer, stone, south) {
    const r = V(f.z, 0, -f.x);
    const H = floors * 3 + 0.3;
    const wallTint = south ? [[1.0, 0.86, 0.66], [0.98, 0.78, 0.6], [1, 0.92, 0.8], [0.95, 0.72, 0.55]] : [[0.95, 0.94, 0.9], [0.9, 0.88, 0.84], [0.98, 0.95, 0.88], [0.85, 0.86, 0.85]];
    g.col = wallTint[Math.floor(rnd() * wallTint.length)];
    g.mat = [0.9, 0, stone ? 4 : 3, floors];
    const spacing = 2.6 + rnd() * 0.8;
    g.win = [spacing, ((hw * 2) % spacing) / 2 + 0.2, Math.floor(rnd() * SHUTTERS.length), hw];
    const P = (sx, y, sz) => c.clone().addScaledVector(r, sx * hw).addScaledVector(f, sz * hd).add(V(0, y, 0));
    // façades (les fenêtres sur les quatre côtés ; la porte côté route)
    g.quad(P(-1, 0, 1), P(1, 0, 1), P(1, H, 1), P(-1, H, 1));
    g.win = [spacing, 0.3, g.win[2], -99];
    g.quad(P(1, 0, -1), P(-1, 0, -1), P(-1, H, -1), P(1, H, -1));
    g.mat = [0.9, 0, stone ? 4 : 3, floors * (rnd() < 0.5 ? 1 : 0)];
    g.quad(P(1, 0, 1), P(1, 0, -1), P(1, H, -1), P(1, H, 1));
    g.quad(P(-1, 0, -1), P(-1, 0, 1), P(-1, H, 1), P(-1, H, -1));
    // toit à deux pans, faîtage parallèle à la route, débord de 40 cm ; pignons
    const pitch = south ? 0.32 : 0.65;
    const ridge = H + hd * pitch;
    const o = 0.4;
    g.mat = [0.8, 0, roofLayer, 0]; g.win = [0, 0, 0, -99];
    g.col = roofLayer === 5 ? [1, 0.95, 0.9] : [1, 1, 1];
    const R = (sx, y, sz) => c.clone().addScaledVector(r, sx * (hw + o)).addScaledVector(f, sz).add(V(0, y, 0));
    g.quad(R(-1, H - o * pitch, hd + o), R(1, H - o * pitch, hd + o), R(1, ridge, 0), R(-1, ridge, 0));
    g.quad(R(1, H - o * pitch, -hd - o), R(-1, H - o * pitch, -hd - o), R(-1, ridge, 0), R(1, ridge, 0));
    g.mat = [0.9, 0, stone ? 4 : 3, 0]; g.col = wallTint[0];
    g.tri(P(1, H, 1), P(1, H, -1), c.clone().addScaledVector(r, hw).add(V(0, ridge, 0)));
    g.tri(P(-1, H, -1), P(-1, H, 1), c.clone().addScaledVector(r, -hw).add(V(0, ridge, 0)));
    // cheminée
    if (rnd() < 0.7) {
      g.mat = [0.9, 0, 4, 0]; g.col = [0.9, 0.85, 0.8];
      g.box(c.clone().addScaledVector(r, (rnd() - 0.5) * hw).addScaledVector(f, -hd * 0.3).add(V(0, H, 0)), f, 0.3, 0.3, ridge - H + 0.8);
    }
  }

  _church(g, c, t, rnd, roofLayer) {
    // nef (perpendiculaire à la route) et clocher carré à flèche
    const f = V(t.x, 0, t.z), r = V(f.z, 0, -f.x);
    g.mat = [0.9, 0, 4, 0]; g.col = [0.95, 0.9, 0.82]; g.win = [0, 0, 0, -99];
    const hw = 5, hd = 11, H = 8;
    g.box(c, f, hw, hd, H, false);
    const ridge = H + hw * 0.8;
    g.mat = [0.8, 0, roofLayer, 0]; g.col = [1, 1, 1];
    const R = (sx, y, sz) => c.clone().addScaledVector(r, sx).addScaledVector(f, sz).add(V(0, y, 0));
    g.quad(R(-hw - 0.4, H - 0.3, -hd - 0.3), R(-hw - 0.4, H - 0.3, hd + 0.3), R(0, ridge, hd + 0.3), R(0, ridge, -hd - 0.3));
    g.quad(R(hw + 0.4, H - 0.3, hd + 0.3), R(hw + 0.4, H - 0.3, -hd - 0.3), R(0, ridge, -hd - 0.3), R(0, ridge, hd + 0.3));
    g.mat = [0.9, 0, 4, 0]; g.col = [0.95, 0.9, 0.82];
    g.tri(R(-hw, H, hd), R(hw, H, hd), R(0, ridge, hd));
    g.tri(R(hw, H, -hd), R(-hw, H, -hd), R(0, ridge, -hd));
    const tc = c.clone().addScaledVector(f, hd + 2.5);
    g.box(tc, f, 2.6, 2.6, 22);
    // flèche (pyramide) en ardoise
    g.mat = [0.6, 0, 6, 0]; g.col = [1, 1, 1];
    const top = tc.clone().add(V(0, 31, 0));
    const T = (sx, sz) => tc.clone().addScaledVector(r, sx * 2.8).addScaledVector(f, sz * 2.8).add(V(0, 22, 0));
    g.tri(T(-1, 1), T(1, 1), top); g.tri(T(1, 1), T(1, -1), top); g.tri(T(1, -1), T(-1, -1), top); g.tri(T(-1, -1), T(-1, 1), top);
  }

  // arches gonflables (départ, arrivée, sprints, sommets, ravitaillement), flamme rouge, barrières et public de l'arrivée
  _race(g) {
    const W = this.world, path = this.path, q = {}, P = W.points || { sprints: [], koms: [], feeds: [] };
    const arch = (s, lines, opts) => {
      path.sample(s, q);
      const half = W.halfAt(s) + 0.8;
      const tex = textTexture(lines, opts);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
      this.engine.prepare(mat);
      const grp = new THREE.Group();
      const col = new THREE.Color(opts.arch || '#d81f26');
      const tm = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.45, sheen: 0.3, sheenColor: new THREE.Color(1, 1, 1) });
      this.engine.prepare(tm);
      // deux piliers et une traverse en boudins gonflés
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const a = Math.PI * k / 24;
        pts.push(V(Math.cos(a) * half, Math.sin(a) * 1.2 + (k === 0 || k === 24 ? 0 : 0), 0));
      }
      const curve = new THREE.CatmullRomCurve3([V(-half, 0, 0), V(-half, 4.5, 0), V(-half + 0.8, 5.6, 0), V(half - 0.8, 5.6, 0), V(half, 4.5, 0), V(half, 0, 0)]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.55, 16, false), tm);
      tube.castShadow = true;
      grp.add(tube);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 1.6, 1.1), mat);
      banner.position.set(0, 5.1, 0.56); grp.add(banner);
      const back = banner.clone(); back.rotation.y = Math.PI; back.position.z = -0.56; grp.add(back);
      grp.position.set(q.x, q.y, q.z);
      grp.rotation.y = Math.atan2(q.tx, q.tz);
      this.group.add(grp);
    };
    arch(W.toS(0), ['DÉPART'], { bg: '#ffffff', fg: '#d81f26', arch: '#d81f26' });
    arch(W.toS(W.pyrLen), ['ARRIVÉE'], { bg: '#ffffff', fg: '#111111', arch: '#1a1a1a' });
    for (const s of P.sprints) arch(s, ['SPRINT'], { bg: '#1c9a4b', fg: '#ffffff', arch: '#1c9a4b' });
    for (const k of P.koms) arch(k.s1, ['GRAND PRIX DE LA MONTAGNE'], { bg: '#ffffff', fg: '#c5161d', dots: '#d81f26', arch: '#f5f5f2' });
    for (const z of P.feeds) arch(z.s0, ['ZONE DE RAVITAILLEMENT'], { bg: '#f08a24', fg: '#ffffff', arch: '#f08a24' });
    // flamme rouge (1 km de l'arrivée)
    if (W.pyrLen > 1500) arch(W.toS(W.pyrLen - 1000), ['FLAMME ROUGE · 1 KM'], { bg: '#c5161d', fg: '#ffffff', arch: '#c5161d' });
    // barrières de foule : dernier kilomètre, 200 m autour des sprints
    const barrier = (sa, sb) => {
      g.mat = [0.35, 1, -1, 0]; g.col = [0.7, 0.71, 0.72]; g.win = [0, 0, 0, -99];
      for (let s = sa; s < sb; s += 2.4) {
        path.sample(s + 1.2, q);
        const half = W.halfAt(s) + 0.5;
        for (const side of [-1, 1]) {
          const c = V(q.x + q.rx * half * side, q.y, q.z + q.rz * half * side), f = V(q.rx * side, 0, q.rz * side);
          g.box(c.clone().add(V(0, 0.95, 0)), f, 1.15, 0.02, 0.1);
          g.box(c.clone().add(V(0, 0.08, 0)), f, 1.15, 0.02, 0.06);
          for (const e of [-1, 1]) g.box(c.clone().addScaledVector(V(f.z, 0, -f.x), e * 1.1), f, 0.02, 0.02, 1.05);
          // le public derrière les barrières
          for (let k = 0; k < 2; k++) this.crowd.push({ x: c.x + f.x * (0.5 + k * 0.7) + (Math.random() - 0.5) * 1.6 * f.z, y: q.y, z: c.z + f.z * (0.5 + k * 0.7) - (Math.random() - 0.5) * 1.6 * f.x, yaw: Math.atan2(-f.x, -f.z) + (Math.random() - 0.5) * 0.6, up: Math.random() < 0.4 });
        }
      }
    };
    barrier(W.toS(Math.max(0, W.pyrLen - 1000)), W.toS(W.pyrLen) + 30);
    for (const s of P.sprints) barrier(s - 200, s + 20);
    // public au sommet des côtes classées (dense sur les deux derniers kilomètres des grands cols)
    for (const k of P.koms) {
      const len = k.cat <= 1 ? 2000 : 600;
      for (let s = Math.max(k.s0, k.s1 - len); s < k.s1; s += k.cat <= 1 ? 1.2 : 3) {
        path.sample(s, q);
        const half = W.halfAt(s);
        const side = Math.random() < 0.5 ? -1 : 1, o = half + 0.6 + Math.random() * 2.5;
        this.crowd.push({ x: q.x + q.rx * o * side, y: q.y, z: q.z + q.rz * o * side, yaw: Math.atan2(-q.rx * side, -q.rz * side) + (Math.random() - 0.5) * 0.8, up: Math.random() < 0.35 });
      }
    }
  }

  update() {
    // le public est confié aux coureurs (même rendu des corps) une fois ceux-ci prêts
    if (!this.crowdPlaced && this.world.riders && this.world.riders.addCrowd) {
      this.crowdPlaced = true;
      // posé sur le terrain quand il est connu
      this.world.riders.addCrowd(this.crowd);
    }
  }
}
