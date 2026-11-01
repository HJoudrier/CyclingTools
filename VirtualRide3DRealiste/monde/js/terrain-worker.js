/* Virtual Ride 3D Réaliste — calcul du terrain dans un fil à part (Web Worker classique), pour ne jamais ralentir l'image.
   Le monde est celui de Bike3D : le même tracé (B3D.Route), le même paysage (B3D.Landscape, même graine) — relief, rivières, lacs,
   villages, champs, forêts —, dont les fichiers sont chargés depuis l'univers cartoon (VirtualRide3D/univers/js/). Au-delà de ~1 km
   de la route, où le calcul de Bike3D devient très lent, un champ lointain prend le relais : l'altitude de la route diffusée sur une
   grille (« push-pull »), la distance à la route (chanfrein) et les mêmes bruits de montagnes, pour un horizon de plusieurs kilomètres.
   Messages : init {points, name, seed, base} → ready {info} ; tile {id, level, tx, tz, size, seg, veg} → tile {id, ... tableaux}. */
'use strict';

// three.js n'est pas chargé ici : Bike3D n'utilise que THREE.Color (palettes des ambiances), recopiée en petit
function srgbToLin(c) { return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
class MiniColor {
  constructor(r, g, b) {
    this.r = 1; this.g = 1; this.b = 1; this.isColor = true;
    if (typeof r === 'string') this.setHex(r);
    else if (r && r.isColor) this.copy(r);
    else if (typeof r === 'number' && g === undefined) this.setHex(r);
    else if (typeof r === 'number') { this.r = r; this.g = g; this.b = b; }
  }
  setHex(h) {
    const n = typeof h === 'number' ? h : parseInt(String(h).replace('#', ''), 16);
    this.r = srgbToLin(((n >> 16) & 255) / 255); this.g = srgbToLin(((n >> 8) & 255) / 255); this.b = srgbToLin((n & 255) / 255);
    return this;
  }
  set(v) { if (typeof v === 'string' || typeof v === 'number') return this.setHex(v); return this.copy(v); }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new MiniColor(this.r, this.g, this.b); }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  getHSL(out) {
    // en sRGB, comme three.js
    const lin2s = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
    const r = lin2s(this.r), g = lin2s(this.g), b = lin2s(this.b);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (min + max) / 2;
    if (min !== max) {
      const d = max - min;
      s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h /= 6;
    }
    out.h = h; out.s = s; out.l = l;
    return out;
  }
  offsetHSL() { return this; }
}
self.THREE = { Color: MiniColor };
self.window = self;

let B3D, route, L, far, info;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/* ---------------------------------------------------------------- champ lointain */

class FarField {
  constructor(R, Lnd, margin, cell) {
    this.L = Lnd;
    const bb = R.bbox;
    this.cell = cell;
    this.x0 = Math.floor((bb.x0 - margin) / cell) * cell;
    this.z0 = Math.floor((bb.z0 - margin) / cell) * cell;
    this.nx = Math.ceil((bb.x1 + margin - this.x0) / cell) + 1;
    this.nz = Math.ceil((bb.z1 + margin - this.z0) / cell) + 1;
    const N = this.nx * this.nz;
    const vy = new Float32Array(N), vm = new Float32Array(N), w = new Float32Array(N);
    // la route : altitude lissée et « montagnitude » de Bike3D (échantillons grossiers)
    const ci = R.coarse;
    for (let k = 0; k < ci.length; k++) {
      const i = ci[k];
      const gx = Math.round((R.x[i] - this.x0) / cell), gz = Math.round((R.z[i] - this.z0) / cell);
      if (gx < 0 || gz < 0 || gx >= this.nx || gz >= this.nz) continue;
      const q = gz * this.nx + gx;
      vy[q] += Lnd.cY[k]; vm[q] += Lnd.cM[k]; w[q] += 1;
    }
    this.B = this._pushPull(vy, w);
    this.M = this._pushPull(vm, w);
    for (let q = 0; q < N; q++) this.M[q] = clamp(this.M[q], 0.1, 1);
    this.D = this._chamfer(w);
  }

  // remplissage des trous par pyramide : moyenne pondérée vers le bas, puis interpolation vers le haut
  _pushPull(val, wt) {
    const levels = [];
    let w = this.nx, h = this.nz;
    let V = new Float32Array(val.length), W = Float32Array.from(wt);
    for (let q = 0; q < V.length; q++) V[q] = wt[q] > 0 ? val[q] / wt[q] : 0;
    levels.push({ V, W, w, h });
    while (w > 1 || h > 1) {
      const nw = Math.max(1, Math.ceil(w / 2)), nh = Math.max(1, Math.ceil(h / 2));
      const NV = new Float32Array(nw * nh), NW = new Float32Array(nw * nh);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const q = j * w + i, p = (j >> 1) * nw + (i >> 1);
        const ww = W[q];
        if (ww > 0) { NV[p] += V[q] * ww; NW[p] += ww; }
      }
      for (let p = 0; p < NV.length; p++) if (NW[p] > 0) NV[p] /= NW[p];
      V = NV; W = NW; w = nw; h = nh;
      levels.push({ V, W, w, h });
    }
    for (let l = levels.length - 2; l >= 0; l--) {
      const A = levels[l], C = levels[l + 1];
      for (let j = 0; j < A.h; j++) for (let i = 0; i < A.w; i++) {
        const q = j * A.w + i;
        const fx = clamp((i - 0.5) / 2, 0, C.w - 1), fz = clamp((j - 0.5) / 2, 0, C.h - 1);
        const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
        const i1 = Math.min(ix + 1, C.w - 1), j1 = Math.min(iz + 1, C.h - 1);
        const up = (C.V[iz * C.w + ix] * (1 - tx) + C.V[iz * C.w + i1] * tx) * (1 - tz) + (C.V[j1 * C.w + ix] * (1 - tx) + C.V[j1 * C.w + i1] * tx) * tz;
        const a = Math.min(1, A.W[q]);
        A.V[q] = A.V[q] * a + up * (1 - a);
        A.W[q] = 1;
      }
    }
    // lissage léger (les cellules de la route marquent trop)
    const out = levels[0].V, tmp = new Float32Array(out.length), W0 = this.nx;
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < W0; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= W0 || b >= this.nz) continue;
          s += out[b * W0 + a]; n++;
        }
        tmp[j * W0 + i] = s / n;
      }
      out.set(tmp);
    }
    return out;
  }

  // distance à la route (m), transformée de chanfrein en deux passes
  _chamfer(wt) {
    const w = this.nx, h = this.nz, c = this.cell, D = new Float32Array(w * h);
    for (let q = 0; q < D.length; q++) D[q] = wt[q] > 0 ? 0 : 1e9;
    const a = c, b = c * Math.SQRT2;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const q = j * w + i; let d = D[q];
      if (i > 0) d = Math.min(d, D[q - 1] + a);
      if (j > 0) { d = Math.min(d, D[q - w] + a); if (i > 0) d = Math.min(d, D[q - w - 1] + b); if (i < w - 1) d = Math.min(d, D[q - w + 1] + b); }
      D[q] = d;
    }
    for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
      const q = j * w + i; let d = D[q];
      if (i < w - 1) d = Math.min(d, D[q + 1] + a);
      if (j < h - 1) { d = Math.min(d, D[q + w] + a); if (i < w - 1) d = Math.min(d, D[q + w + 1] + b); if (i > 0) d = Math.min(d, D[q + w - 1] + b); }
      D[q] = d;
    }
    return D;
  }

  _bil(A, x, z) {
    const fx = clamp((x - this.x0) / this.cell, 0, this.nx - 1.001), fz = clamp((z - this.z0) / this.cell, 0, this.nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, w = this.nx;
    const q = iz * w + ix;
    return (A[q] * (1 - tx) + A[q + 1] * tx) * (1 - tz) + (A[q + w] * (1 - tx) + A[q + w + 1] * tx) * tz;
  }

  dist(x, z) { return this._bil(this.D, x, z); }

  // même relief que Landscape.natural, avec la base lointaine ; et de grandes montagnes à l'horizon des parcours de montagne
  natural(x, z) {
    const Lnd = this.L, P = Lnd.P;
    const B = this._bil(this.B, x, z), M = this._bil(this.M, x, z), D = this._bil(this.D, x, z) + 60;
    const X = x + Lnd.ox, Z = z + Lnd.oz;
    let h = B;
    const M2 = M * M;
    if (M2 > 0.012) {
      const wt = smoothstep(30, 1100, D);
      const mtn = 0.6 * Lnd.noise.ridged(X / 1100, Z / 1100, 3) / 0.45 + 0.4 * (0.5 + 0.5 * Lnd.noiseC.fbm(X / 650, Z / 650, 3));
      h += M2 * P.mountainAmp * Math.pow(wt, 1.2) * (0.3 + 0.9 * mtn);
      const big = smoothstep(1500, 6000, D);
      if (big > 0) h += M2 * P.mountainAmp * 1.1 * big * (Lnd.noise.ridged(X / 3400 + 31.7, Z / 3400 - 12.3, 4) / 0.45 - 0.35);
    }
    h += Lnd.noise.fbm(X / 300, Z / 300, 3) * (P.hillAmp + 16 * M) * smoothstep(5, 90, D);
    h += Lnd.noise.fbm(X / 1800 + 9.1, Z / 1800 - 3.3, 3) * (25 + 60 * M) * smoothstep(800, 3000, D);
    h += Lnd.noiseB.noise(X / 45, Z / 45) * (0.6 + 2.4 * M);
    return h;
  }
}

/* ---------------------------------------------------------------- échantillonnage */

const NEAR = 900, FAR = 1300;
const S = {};   // échantillon courant
function sampleAt(x, z, o) {
  const d = far.dist(x, z);
  if (d < FAR) {
    L.sample(x, z, o);
    if (d > NEAR) {
      const t = smoothstep(NEAR, FAR, d);
      o.h = o.h * (1 - t) + far.natural(x, z) * t;
    }
  } else {
    o.h = far.natural(x, z);
    o.roadD = 1e9; o.roadY = 0; o.roadI = -1; o.vill = 0; o.dr = 1e9; o.wl = 0; o.rw = 0; o.lakeRn = 9; o.lakeLevel = 0;
    o.waterLevel = -1e9; o.lakePond = false; o.under = false;
  }
  o.farD = d;
  return o;
}

/* ---------------------------------------------------------------- couverture → matériaux du sol */

const G = { GRASS: 0, DRY: 1, FOREST: 2, SOIL: 3, ROCK: 4, SNOW: 5, GRAVEL: 6, MUD: 7 };
let COVER, STRIPE;

function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

// teinte relative (≈ 1) tirée de la couleur de Bike3D : on en garde l'écart de teinte, atténué (couleurs plus naturelles)
function relTint(col, k, out, o) {
  const l = Math.max(1e-4, lum(col));
  out[o] = 1 + (col.r / l - 1) * k; out[o + 1] = 1 + (col.g / l - 1) * k; out[o + 2] = 1 + (col.b / l - 1) * k;
}

const _col = new MiniColor();
const _hsl = {};
function weights(x, z, o, slope, W, wo, T, to, ST, so) {
  for (let k = 0; k < 8; k++) W[wo + k] = 0;
  T[to] = 1; T[to + 1] = 1; T[to + 2] = 1;
  o.stripe = 0;
  L.cover(x, z, o, slope, _col);
  const c = o.cover, C = COVER;
  ST[so] = o.stripe;
  const var1 = 0.5 + 0.5 * L.noiseB.noise((x + L.ox) / 90, (z + L.oz) / 90);
  switch (c) {
    case C.SHOULDER: {
      const t = clamp((o.roadD - L.roadHalf) / 1.6, 0, 1);
      W[wo + G.GRAVEL] = 0.55 * (1 - t); W[wo + G.SOIL] = 0.25; W[wo + G.GRASS] = 0.2 + 0.55 * t;
      break;
    }
    case C.MEADOW: case C.ORCHARD:
      W[wo + G.GRASS] = 0.75 + 0.25 * var1; W[wo + G.DRY] = 0.25 * (1 - var1) + info.dry * 0.5;
      relTint(_col, 0.25, T, to);
      break;
    case C.FOREST: W[wo + G.FOREST] = 1; W[wo + G.GRASS] = 0.15; break;
    case C.FIELD: {
      const kind = L.cropKind[o.crop];
      _col.getHSL(_hsl);
      const brown = _hsl.h < 0.11 && _hsl.s < 0.6 || _hsl.l < 0.45 && _hsl.h < 0.13;
      if (kind === 'lavender' || kind === 'sunflower' || kind === 'pumpkin' || brown) { W[wo + G.SOIL] = 1; W[wo + G.GRASS] = kind ? 0.2 : 0; }
      else if (_hsl.h < 0.17) { W[wo + G.DRY] = 1; relTint(_col, 0.55, T, to); }       // blé, orge : doré
      else { W[wo + G.GRASS] = 1; relTint(_col, 0.45, T, to); }                       // jeunes pousses, prairie temporaire
      break;
    }
    case C.ROCK: W[wo + G.ROCK] = 1; break;
    case C.ALPINE: W[wo + G.DRY] = 0.55; W[wo + G.GRASS] = 0.45; W[wo + G.ROCK] = 0.1; relTint(_col, 0.2, T, to); break;
    case C.SNOW: W[wo + G.SNOW] = 1; W[wo + G.ROCK] = 0.08; break;
    case C.SAND: W[wo + G.GRAVEL] = 0.7; W[wo + G.SOIL] = 0.3; T[to] = 1.12; T[to + 1] = 1.04; T[to + 2] = 0.86; break;
    case C.BED: W[wo + G.GRAVEL] = 0.6; W[wo + G.MUD] = 0.4; break;
    case C.HEDGE: W[wo + G.FOREST] = 0.5; W[wo + G.GRASS] = 0.5; break;
    case C.VILLAGE: {
      const g = clamp((L.roadHalf + 11 - o.roadD) / 6, 0, 1);
      W[wo + G.GRASS] = 0.8 - 0.5 * g; W[wo + G.GRAVEL] = 0.2 + 0.6 * g;
      break;
    }
    case C.VINEYARD: W[wo + G.SOIL] = 0.85; W[wo + G.GRASS] = 0.15; T[to] = 1.08; T[to + 1] = 1.0; T[to + 2] = 0.9; break;
    case C.GARRIGUE: W[wo + G.DRY] = 0.6; W[wo + G.SOIL] = 0.25; W[wo + G.ROCK] = 0.2; T[to] = 1.05; T[to + 1] = 1.02; T[to + 2] = 0.9; break;
    case C.HEATH: W[wo + G.DRY] = 0.6; W[wo + G.GRASS] = 0.4; T[to] = 1.12; T[to + 1] = 0.9; T[to + 2] = 1.02; break;
    case C.WETLAND: W[wo + G.MUD] = 0.5; W[wo + G.GRASS] = 0.6; break;
    default: W[wo + G.GRASS] = 1;
  }
  // roches dans les pentes fortes, éboulis au pied
  const rk = smoothstep(0.62, 1.05, slope);
  if (rk > 0 && c !== C.SNOW) { for (let k = 0; k < 8; k++) W[wo + k] *= 1 - rk; W[wo + G.ROCK] += rk; }
  // l'été sec jaunit les prés du Sud et les alpages
  if (info.dry > 0 && W[wo + G.GRASS] > 0) { const t = info.dry * 0.45 * (0.6 + 0.4 * var1); W[wo + G.DRY] += W[wo + G.GRASS] * t; W[wo + G.GRASS] *= 1 - t; }
  let s = 0;
  for (let k = 0; k < 8; k++) s += W[wo + k];
  if (s > 0) for (let k = 0; k < 8; k++) W[wo + k] /= s;
  return c;
}

/* ---------------------------------------------------------------- tuiles */

// végétation : espèces (ordre de vegetation.js)
const SP = { BROADLEAF: 0, SPRUCE: 1, PINE: 2, POPLAR: 3, BIRCH: 4, CYPRESS: 5, OLIVE: 6, FRUIT: 7, WILLOW: 8, BUSH: 9, ROCK: 10, HAY: 11 };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function buildTile(m) {
  const { level, tx, tz, size, seg } = m;
  const N = seg, V = N + 1, NB = N + 3, step = size / N;
  const x0 = tx * size, z0 = tz * size;
  const H = new Float32Array(NB * NB);
  const cnt = V * V;
  const info2 = { roadD: new Float32Array(cnt), dr: new Float32Array(cnt), rw: new Float32Array(cnt), wl: new Float32Array(cnt), lakeRn: new Float32Array(cnt), under: new Uint8Array(cnt), vill: new Float32Array(cnt), pond: new Uint8Array(cnt), water: new Float32Array(cnt), farD: new Float32Array(cnt) };
  const o = S;
  let minH = Infinity, maxH = -Infinity, nearRoad = false, hasWater = false;
  for (let j = 0; j < NB; j++) {
    for (let i = 0; i < NB; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      sampleAt(x, z, o);
      H[j * NB + i] = o.h;
      if (i >= 1 && j >= 1 && i <= V && j <= V) {
        const k = (j - 1) * V + (i - 1);
        info2.roadD[k] = o.roadD; info2.dr[k] = o.dr; info2.rw[k] = o.rw; info2.wl[k] = o.wl; info2.lakeRn[k] = o.lakeRn;
        info2.under[k] = o.under ? 1 : 0; info2.vill[k] = o.vill; info2.pond[k] = o.lakePond ? 1 : 0; info2.water[k] = o.waterLevel; info2.farD[k] = o.farD;
        if (o.roadD < 60) nearRoad = true;
        if (o.under) hasWater = true;
        if (o.h < minH) minH = o.h; if (o.h > maxH) maxH = o.h;
      }
    }
  }
  // sommets : position (relative à la tuile), normale, poids des 8 matériaux, teinte, rangs ; puis la jupe (bord rabattu vers le bas)
  const skirt = level < 2 ? 4 * V : 0;
  const nv = cnt + skirt;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), w0 = new Float32Array(nv * 4), w1 = new Float32Array(nv * 4), tint = new Float32Array(nv * 3), stripe = new Float32Array(nv);
  const W = new Float32Array(8), T = new Float32Array(3), ST = new Float32Array(1);
  const cover = new Uint8Array(cnt), crop = new Uint8Array(cnt), slopeA = new Float32Array(cnt), Hc = new Float32Array(cnt);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = j * V + i, hb = (j + 1) * NB + (i + 1);
      const h = H[hb];
      const dx = (H[hb + 1] - H[hb - 1]) / (2 * step), dz = (H[hb + NB] - H[hb - NB]) / (2 * step);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      pos[k * 3] = i * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = j * step;
      nor[k * 3] = -dx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = -dz * inv;
      const slope = Math.sqrt(dx * dx + dz * dz);
      slopeA[k] = slope; Hc[k] = h;
      o.h = h; o.roadD = info2.roadD[k]; o.dr = info2.dr[k]; o.rw = info2.rw[k]; o.wl = info2.wl[k]; o.lakeRn = info2.lakeRn[k];
      o.under = !!info2.under[k]; o.vill = info2.vill[k]; o.lakePond = !!info2.pond[k];
      cover[k] = weights(x0 + i * step, z0 + j * step, o, slope, W, 0, T, 0, ST, 0);
      crop[k] = o.crop;
      for (let q = 0; q < 4; q++) { w0[k * 4 + q] = W[q]; w1[k * 4 + q] = W[q + 4]; }
      tint[k * 3] = T[0]; tint[k * 3 + 1] = T[1]; tint[k * 3 + 2] = T[2];
      stripe[k] = ST[0];
    }
  }
  if (skirt) {
    const drop = level === 0 ? 3 : 14;
    let s = cnt;
    const border = [];
    for (let i = 0; i < V; i++) border.push(i);                         // bord nord (j = 0)
    for (let i = 0; i < V; i++) border.push((V - 1) * V + i);           // bord sud
    for (let j = 0; j < V; j++) border.push(j * V);                     // bord ouest
    for (let j = 0; j < V; j++) border.push(j * V + V - 1);             // bord est
    for (const k of border) {
      pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - drop; pos[s * 3 + 2] = pos[k * 3 + 2];
      nor.copyWithin(s * 3, k * 3, k * 3 + 3); w0.copyWithin(s * 4, k * 4, k * 4 + 4); w1.copyWithin(s * 4, k * 4, k * 4 + 4);
      tint.copyWithin(s * 3, k * 3, k * 3 + 3); stripe[s] = stripe[k];
      s++;
    }
  }
  const out = { id: m.id, level, tx, tz, size, seg, x0, z0, minH, maxH: Math.max(maxH, minH + 1), nearRoad, hasWater, pos, nor, w0, w1, tint, stripe, H: Hc, cover, crop, slope: slopeA };
  const transfer = [pos.buffer, nor.buffer, w0.buffer, w1.buffer, tint.buffer, stripe.buffer, Hc.buffer, cover.buffer, crop.buffer, slopeA.buffer];
  if (m.veg) {
    const veg = vegetation(m, out, info2, step, V);
    out.veg = veg; transfer.push(veg.buffer);
  }
  if (level === 0) { out.roadD = info2.roadD; out.under = info2.under; out.water = info2.water; transfer.push(info2.roadD.buffer, info2.under.buffer, info2.water.buffer); }
  return { out, transfer };
}

// arbres, buissons, rochers et bottes de foin de la tuile : [x, y, z, échelle, rotation, espèce, variante, r, g, b]
function vegetation(m, t, inf, step, V) {
  const list = [];
  const P = L.P, B = L.bio, half = L.roadHalf;
  const dense = m.level === 0 ? 1 : 0.55;
  const st = m.level === 0 ? 5.2 : 7.4;
  const n = Math.floor(m.size / st);
  const hAt = (x, z) => {
    const fx = clamp((x - t.x0) / step, 0, V - 1.001), fz = clamp((z - t.z0) / step, 0, V - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz, q = iz * V + ix;
    return (t.H[q] * (1 - ax) + t.H[q + 1] * ax) * (1 - az) + (t.H[q + V] * (1 - ax) + t.H[q + V + 1] * ax) * az;
  };
  const push = (x, y, z, sc, sp, rnd) => {
    const g = 0.9 + rnd() * 0.2;
    list.push(x, y, z, sc, rnd() * Math.PI * 2, sp, Math.floor(rnd() * 3), g * (0.94 + rnd() * 0.1), g * (0.94 + rnd() * 0.1), g * (0.94 + rnd() * 0.08));
  };
  for (let gj = 0; gj < n; gj++) {
    for (let gi = 0; gi < n; gi++) {
      const rnd = mulberry(Math.imul(m.tx * 1024 + gi, 73856093) ^ Math.imul(m.tz * 1024 + gj, 19349663) ^ Math.imul(L.seed + m.level, 83492791));
      const x = t.x0 + (gi + 0.1 + rnd() * 0.8) * st, z = t.z0 + (gj + 0.1 + rnd() * 0.8) * st;
      const ix = clamp(Math.round((x - t.x0) / step), 0, V - 1), iz = clamp(Math.round((z - t.z0) / step), 0, V - 1);
      const k = iz * V + ix;
      if (inf.under[k] || inf.lakeRn[k] < 1.25) continue;
      if (inf.roadD[k] < half + 4.5) continue;
      if (inf.vill[k] > 0.15 && inf.roadD[k] < 40) { if (rnd() < 0.05 && inf.roadD[k] > half + 15) push(x, hAt(x, z) - 0.1, z, 0.7 + rnd() * 0.5, SP.BUSH, rnd); continue; }
      const cov = t.cover[k], slope = t.slope[k];
      const y = hAt(x, z);
      const r = rnd();
      const sc = 0.75 + rnd() * 0.55;
      const nearRiver = inf.dr[k] < inf.rw[k] + 16 && inf.dr[k] > inf.rw[k] + 3;
      if (nearRiver && r < 0.16) { push(x, y - 0.2, z, sc, r < 0.06 ? SP.WILLOW : SP.POPLAR, rnd); continue; }
      const C = COVER;
      switch (cov) {
        case C.FOREST: {
          if (r > 0.9 * dense) break;
          const south = B.south && y < 800;
          if (south && rnd() < 0.55) push(x, y - 0.3, z, sc, SP.PINE, rnd);
          else if (!south && y < 1300 && rnd() < B.birch * 0.6) push(x, y - 0.3, z, sc, SP.BIRCH, rnd);
          else {
            const conif = y > 950 + 250 * L.noiseC.noise(x / 300, z / 300) || rnd() < 0.15;
            push(x, y - 0.3, z, conif ? sc * 1.1 : sc, conif ? SP.SPRUCE : SP.BROADLEAF, rnd);
          }
          if (m.level === 0 && rnd() < 0.25) push(x + (rnd() - 0.5) * 3, y - 0.1, z + (rnd() - 0.5) * 3, 0.6 + rnd() * 0.5, SP.BUSH, rnd);
          break;
        }
        case C.MEADOW:
          if (r < P.meadowTrees * 1.4) push(x, y - 0.3, z, sc * 1.15, y > 1250 ? SP.SPRUCE : SP.BROADLEAF, rnd);
          else if (r < P.meadowTrees * 1.4 + 0.015 * dense) push(x, y - 0.1, z, sc, SP.BUSH, rnd);
          else if (r > 0.994 && m.level === 0) push(x, y - 0.25, z, 0.4 + rnd() * 0.9, SP.ROCK, rnd);
          break;
        case C.HEDGE:
          if (r < 0.55) push(x, y - 0.1, z, sc * 1.15, SP.BUSH, rnd);
          else if (r < 0.7) push(x, y - 0.3, z, sc, SP.BROADLEAF, rnd);
          break;
        case C.FIELD:
          if (m.level === 0 && r < 0.012 && info.hay && L.cropHay[t.crop[k]]) push(x, y, z, 0.95 + rnd() * 0.15, SP.HAY, rnd);
          break;
        case C.GARRIGUE:
          if (r < 0.05) push(x, y - 0.2, z, sc, SP.OLIVE, rnd);
          else if (r < 0.065) push(x, y - 0.2, z, sc, SP.CYPRESS, rnd);
          else if (r < 0.085) push(x, y - 0.3, z, sc * 0.9, SP.PINE, rnd);
          else if (r < 0.26 * dense) push(x, y - 0.15, z, sc * 0.6, SP.BUSH, rnd);
          else if (r < 0.29) push(x, y - 0.2, z, 0.4 + rnd() * 0.8, SP.ROCK, rnd);
          break;
        case C.HEATH:
          if (r < 0.03) push(x, y - 0.2, z, sc * 0.6, SP.SPRUCE, rnd);
          else if (r < 0.045 && y < 1500) push(x, y - 0.3, z, sc * 0.8, SP.BIRCH, rnd);
          else if (r < 0.2 * dense) push(x, y - 0.1, z, sc * 0.5, SP.BUSH, rnd);
          else if (r < 0.23) push(x, y - 0.2, z, 0.4 + rnd() * 0.9, SP.ROCK, rnd);
          break;
        case C.WETLAND:
          if (r < 0.03) push(x, y - 0.2, z, sc * 0.9, SP.WILLOW, rnd);
          else if (r < 0.05) push(x, y - 0.2, z, sc, SP.POPLAR, rnd);
          else if (r < 0.1 * dense) push(x, y - 0.1, z, sc * 0.6, SP.BUSH, rnd);
          break;
        case C.ALPINE:
          if (r < 0.05 * P.rockiness) push(x, y - 0.3, z, 0.6 + rnd() * 1.6, SP.ROCK, rnd);
          else if (r < 0.075) push(x, y - 0.3, z, sc * 0.75, SP.SPRUCE, rnd);
          break;
        case C.ROCK:
          if (r < 0.14) push(x, y - 0.8, z, 1.1 + rnd() * 2.4, SP.ROCK, rnd);
          else if (r < 0.18 && slope < 1.2) push(x, y - 0.3, z, sc * 0.8, SP.SPRUCE, rnd);
          break;
        default: break;
      }
    }
  }
  // vergers : rangs alignés sur les rangs des champs
  if (m.level === 0) orchards(m, t, inf, step, V, list, hAt);
  return Float32Array.from(list);
}

function orchards(m, t, inf, step, V, list, hAt) {
  const dir = L.bio.rowDir, sp = 8;
  const ux = dir[0], uz = dir[1], vx = -uz, vz = ux;
  const corners = [[t.x0, t.z0], [t.x0 + m.size, t.z0], [t.x0, t.z0 + m.size], [t.x0 + m.size, t.z0 + m.size]];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of corners) { const a = x * ux + z * uz, b = x * vx + z * vz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  for (let a = Math.ceil(a0 / sp) * sp; a <= a1; a += sp) {
    for (let b = Math.ceil(b0 / sp) * sp; b <= b1; b += sp) {
      const x = a * ux + b * vx, z = a * uz + b * vz;
      if (x < t.x0 || z < t.z0 || x >= t.x0 + m.size || z >= t.z0 + m.size) continue;
      const k = clamp(Math.round((z - t.z0) / step), 0, V - 1) * V + clamp(Math.round((x - t.x0) / step), 0, V - 1);
      if (t.cover[k] !== COVER.ORCHARD || inf.roadD[k] < L.roadHalf + 5) continue;
      const rnd = mulberry(Math.imul(Math.round(a), 2654435761) ^ Math.imul(Math.round(b), 40503));
      const sc = 0.85 + rnd() * 0.3;
      list.push(x, hAt(x, z) - 0.2, z, sc, rnd() * 6.28, L.bio.south && rnd() < 0.5 ? SP.OLIVE : SP.FRUIT, Math.floor(rnd() * 3), 1, 1, 1);
    }
  }
}

/* ---------------------------------------------------------------- messages */

self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      importScripts(m.base + 'util.js', m.base + 'ambiances.js', m.base + 'route.js', m.base + 'landscape.js');
      B3D = self.B3D;
      COVER = B3D.Landscape.COVER; STRIPE = B3D.Landscape.STRIPE;
      route = new B3D.Route({ name: m.name, points: m.points });
      L = new B3D.Landscape(route, m.seed);
      info = { dry: m.dry || 0, hay: m.hay !== false };
      far = new FarField(route, L, m.margin || 12000, 128);
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'tile') {
      const { out, transfer } = buildTile(m);
      out.type = 'tile';
      self.postMessage(out, transfer);
    } else if (m.type === 'heights') {
      // altitudes de points isolés (caméras, objets loin de la route)
      const pts = m.pts, res = new Float32Array(pts.length / 2), o = {};
      for (let i = 0; i < res.length; i++) res[i] = sampleAt(pts[i * 2], pts[i * 2 + 1], o).h;
      self.postMessage({ type: 'heights', id: m.id, res }, [res.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, text: String(err && err.message || err), stack: String(err && err.stack || '') });
  }
};
