/* Virtual Ride 3D Réaliste — modèles de végétation générés au chargement :
   - un atlas de feuillages dessiné sur un canevas (grappes de feuilles de feuillus, rameaux d'épicéa, aiguilles de pin, feuilles de
     bouleau, de peuplier, d'olivier, écailles de cyprès, feuillage de buisson), avec la transparence ;
   - des arbres par espèce, chacun en trois variantes : tronc et branches (cylindres effilés et courbés), feuillage en cartes posées au
     bout des rameaux, dont les normales s'arrondissent autour du houppier (lumière douce, comme un volume de feuilles) ;
   - rochers (icosaèdres déformés) et bottes de foin.
   Les espèces suivent l'ordre du fil du terrain (terrain-worker.js, SP). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SPECIES = ['broadleaf', 'spruce', 'pine', 'poplar', 'birch', 'cypress', 'olive', 'fruit', 'willow', 'bush', 'rock', 'hay', 'vine'];
// cellule de l'atlas de feuillage (4 × 2) et couche d'écorce (textures.js, BARK) de chaque espèce
const LEAF_CELL = { broadleaf: 0, spruce: 1, pine: 2, poplar: 3, birch: 4, cypress: 5, olive: 6, fruit: 0, willow: 3, bush: 7, vine: 0 };
const BARK_LAYER = { broadleaf: 0, spruce: 2, pine: 2, poplar: 0, birch: 1, cypress: 2, olive: 0, fruit: 0, willow: 0, bush: 0, vine: 0 };
export const BARK_COLOR = { broadleaf: '#4a4038', spruce: '#4b3528', pine: '#6a4330', poplar: '#5f5a50', birch: '#c9c4ba', cypress: '#4b3528', olive: '#6b655a', fruit: '#4a4038', willow: '#4f4a40', bush: '#3d3329' };

/* ---------------------------------------------------------------- atlas de feuillage */

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function leafShape(ctx, len, wid, tip) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(wid, len * 0.25, wid * 0.9, len * 0.7, 0, len * tip);
  ctx.bezierCurveTo(-wid * 0.9, len * 0.7, -wid, len * 0.25, 0, 0);
  ctx.fill();
}

function drawCell(ctx, kind, S, rnd) {
  const c = S / 2;
  const green = (l, s, h) => `hsl(${h || 95 + rnd() * 25}, ${s || 35 + rnd() * 20}%, ${l}%)`;
  ctx.save();
  if (kind === 1) {
    // rameau d'épicéa : un axe et des aiguilles serrées de part et d'autre, qui retombent
    ctx.translate(c, S * 0.04);
    for (let b = 0; b < 3; b++) {
      ctx.save();
      ctx.rotate((b - 1) * 0.35);
      ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = S * 0.012;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, S * 0.9); ctx.stroke();
      for (let k = 0; k < 140; k++) {
        const y = (k / 140) * S * 0.88, side = k % 2 ? 1 : -1, L = S * (0.07 + 0.05 * (1 - y / S)) * (0.7 + rnd() * 0.5);
        ctx.strokeStyle = green(14 + rnd() * 14, 30 + rnd() * 20, 120 + rnd() * 30);
        ctx.lineWidth = S * 0.006;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(side * L, y + L * 0.55); ctx.stroke();
      }
      ctx.restore();
    }
  } else if (kind === 2) {
    // touffes d'aiguilles de pin
    for (let t = 0; t < 22; t++) {
      const x = S * (0.18 + rnd() * 0.64), y = S * (0.18 + rnd() * 0.64);
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, L = S * (0.06 + rnd() * 0.07);
        ctx.strokeStyle = green(16 + rnd() * 16, 30 + rnd() * 15, 100 + rnd() * 30);
        ctx.lineWidth = S * 0.005;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
      }
    }
  } else if (kind === 5) {
    // écailles de cyprès : petites pousses serrées
    for (let k = 0; k < 900; k++) {
      const x = S * (0.08 + rnd() * 0.84), y = S * (0.05 + rnd() * 0.9);
      if (Math.hypot((x - c) / (S * 0.42), (y - c) / (S * 0.48)) > 1) continue;
      ctx.fillStyle = green(12 + rnd() * 14, 30 + rnd() * 20, 100 + rnd() * 30);
      ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * 6.28);
      ctx.fillRect(-S * 0.008, -S * 0.02, S * 0.016, S * 0.04);
      ctx.restore();
    }
  } else {
    // grappe de feuilles : rameaux puis feuilles orientées le long des rameaux
    const P = {
      0: { n: 150, len: 0.085, wid: 0.032, tip: 1, h: 92, l: [18, 34] },
      3: { n: 170, len: 0.06, wid: 0.03, tip: 1, h: 88, l: [20, 36] },
      4: { n: 220, len: 0.045, wid: 0.022, tip: 1, h: 85, l: [24, 40] },
      6: { n: 200, len: 0.075, wid: 0.012, tip: 1, h: 80, l: [30, 46], s: 14 },
      7: { n: 230, len: 0.05, wid: 0.022, tip: 1, h: 100, l: [16, 32] },
    }[kind] || { n: 150, len: 0.08, wid: 0.03, tip: 1, h: 95, l: [18, 34] };
    const twigs = 7;
    for (let t = 0; t < twigs; t++) {
      const a0 = -Math.PI / 2 + (t / (twigs - 1) - 0.5) * 2.4 + (rnd() - 0.5) * 0.3;
      const L = S * (0.32 + rnd() * 0.12);
      const x0 = c, y0 = S * 0.96;
      const pts = [];
      for (let k = 0; k <= 10; k++) { const f = k / 10; pts.push([x0 + Math.cos(a0) * L * f + Math.sin(f * 3 + t) * S * 0.01, y0 + Math.sin(a0) * L * f]); }
      ctx.strokeStyle = '#3b3020'; ctx.lineWidth = S * 0.008;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
      const per = Math.round(P.n / twigs);
      for (let k = 0; k < per; k++) {
        const f = 0.25 + rnd() * 0.75, p = pts[Math.min(10, Math.round(f * 10))];
        const ang = a0 + (rnd() - 0.5) * 2.2 + Math.PI / 2;
        ctx.save();
        ctx.translate(p[0] + (rnd() - 0.5) * S * 0.04, p[1] + (rnd() - 0.5) * S * 0.04);
        ctx.rotate(ang);
        const l = P.l[0] + rnd() * (P.l[1] - P.l[0]);
        const g = ctx.createLinearGradient(0, 0, 0, S * P.len);
        g.addColorStop(0, green(l * 0.8, P.s, P.h + rnd() * 20));
        g.addColorStop(1, green(l, P.s, P.h + rnd() * 20));
        ctx.fillStyle = g;
        const sc = 0.75 + rnd() * 0.5;
        leafShape(ctx, S * P.len * sc, S * P.wid * sc, P.tip);
        // nervure
        ctx.strokeStyle = 'rgba(255,255,230,0.12)'; ctx.lineWidth = S * 0.002;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, S * P.len * sc * 0.9); ctx.stroke();
        ctx.restore();
      }
    }
  }
  ctx.restore();
}

/** Atlas 4 × 2 cellules (feuillages), avec transparence. */
export function leafAtlas(size) {
  const S = size || 512;
  const cv = document.createElement('canvas');
  cv.width = S * 4; cv.height = S * 2;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate((i % 4) * S, Math.floor(i / 4) * S);
    ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
    drawCell(ctx, i, S, rng(1000 + i * 77));
    ctx.restore();
  }
  // les pixels transparents prennent la couleur de leurs voisins (pas de liseré sombre au filtrage)
  const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data, W = cv.width, H = cv.height;
  for (let pass = 0; pass < 4; pass++) {
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (src[i + 3] > 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const o of [-4, 4, -W * 4, W * 4]) if (src[i + o + 3] > 0) { r += src[i + o]; g += src[i + o + 1]; b += src[i + o + 2]; n++; }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; d[i + 3] = 1; }
    }
  }
  for (let i = 3; i < d.length; i += 4) if (d[i] === 1) d[i] = 0;
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* ---------------------------------------------------------------- géométrie */

class Builder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; this.h = []; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v, h) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.h.push(h || 0); return this.count - 1; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.h, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3();

/** Tube effilé le long d'une polyligne (branche) ; sway : souplesse au vent (0 tronc, 1 bout de rameau). */
function tube(B, pts, r0, r1, sides, sway0, sway1, uScale) {
  const n = pts.length;
  let len = 0;
  const base = B.count;
  let side = new V3(1, 0, 0);
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const t = k / (n - 1);
    const dir = (k < n - 1 ? _a.copy(pts[k + 1]).sub(p) : _a.copy(p).sub(pts[k - 1])).normalize();
    if (Math.abs(dir.dot(side)) > 0.9) side.set(0, 0, 1);
    const u = _b.crossVectors(dir, side).normalize();
    const w = _c.crossVectors(dir, u).normalize();
    side = w.clone();
    const r = r0 + (r1 - r0) * t;
    if (k > 0) len += p.distanceTo(pts[k - 1]);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = u.x * Math.cos(a) + w.x * Math.sin(a), ny = u.y * Math.cos(a) + w.y * Math.sin(a), nz = u.z * Math.cos(a) + w.z * Math.sin(a);
      B.vert(p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, (s / sides) * Math.max(1, Math.round(r * 18)) * (uScale || 1), len / 0.9, sway0 + (sway1 - sway0) * t);
    }
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) {
    const a = base + k * (sides + 1) + s, b = a + sides + 1;
    B.i.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

/** Carte de feuillage centrée en p, orientée (normale de face nf, axe vertical up), taille w × h ; cellule de l'atlas ; normale
 *  arrondie vers (p - centre du houppier). */
function card(B, p, nf, up, w, h, cell, center, sway, roundK) {
  const right = new V3().crossVectors(up, nf).normalize();
  const upv = new V3().crossVectors(nf, right).normalize();
  const cu = (cell % 4) / 4, cv = 1 - Math.floor(cell / 4) / 2;
  const rn = new V3().copy(p).sub(center).normalize();
  const n = new V3().copy(nf).lerp(rn, roundK === undefined ? 0.75 : roundK).normalize();
  const base = B.count;
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
  for (const [x, y] of corners) {
    const q = new V3().copy(p).addScaledVector(right, x * w).addScaledVector(upv, (y - 0.15) * h);
    const qn = new V3().copy(q).sub(center).normalize().lerp(n, 0.5).normalize();
    B.vert(q.x, q.y, q.z, qn.x, qn.y, qn.z, cu + (x + 0.5) * 0.25, cv - 0.5 + y * 0.5, sway);
  }
  B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function randDir(rnd, up) { const a = rnd() * Math.PI * 2, z = up ? 0.2 + rnd() * 0.8 : rnd() * 2 - 1, r = Math.sqrt(1 - z * z); return new V3(r * Math.cos(a), z, r * Math.sin(a)); }

// branche courbe : du point p, direction d, longueur L, qui fléchit de droop
function branchPts(p, d, L, droop, segs) {
  const pts = [];
  const dir = d.clone();
  const q = p.clone();
  for (let k = 0; k <= segs; k++) {
    pts.push(q.clone());
    q.addScaledVector(dir, L / segs);
    dir.y -= droop / segs;
    dir.normalize();
  }
  return pts;
}

/* Espèces : chaque générateur renvoie {bark, leaves, height, radius}. */
function genBroadleaf(rnd, o) {
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.85 + rnd() * 0.3), trunkH = H * (o.trunk || 0.35);
  const r0 = H * 0.028;
  const trunk = [new V3(0, -0.3, 0)];
  for (let k = 1; k <= 4; k++) trunk.push(new V3((rnd() - 0.5) * 0.25 * k / 4, trunkH * k / 4 + (k === 4 ? 0.0 : 0), (rnd() - 0.5) * 0.25 * k / 4));
  tube(B, trunk, r0 * 1.25, r0 * 0.75, 9, 0, 0.05);
  const top = trunk[trunk.length - 1];
  const crownC = new V3(top.x, trunkH + (H - trunkH) * 0.5, top.z);
  const crownR = (H - trunkH) * 0.55 * (o.wide || 1);
  const nb = o.branches || 7;
  for (let b = 0; b < nb; b++) {
    const ang = (b / nb) * Math.PI * 2 + rnd() * 0.6;
    const el = 0.45 + rnd() * 0.6;
    const d = new V3(Math.cos(ang) * Math.cos(el), Math.sin(el), Math.sin(ang) * Math.cos(el));
    const start = top.clone().add(new V3(0, -rnd() * trunkH * 0.15, 0));
    const L = crownR * (0.8 + rnd() * 0.4);
    const pts = branchPts(start, d, L, o.droop || 0.25, 4);
    tube(B, pts, r0 * 0.55, r0 * 0.12, 6, 0.05, 0.5);
    // rameaux secondaires et feuillage
    for (let s = 0; s < 3; s++) {
      const f = 0.45 + s * 0.22;
      const sp = pts[Math.round(f * (pts.length - 1))];
      const sd = d.clone().add(randDir(rnd, true).multiplyScalar(0.8)).normalize();
      const sl = L * (0.35 + rnd() * 0.25);
      const spts = branchPts(sp, sd, sl, 0.3, 2);
      tube(B, spts, r0 * 0.2, r0 * 0.06, 4, 0.5, 0.9);
      const tip = spts[spts.length - 1];
      for (let k = 0; k < (o.cardsPer || 5); k++) {
        const p = tip.clone().add(randDir(rnd).multiplyScalar(sl * 0.6));
        const nf = randDir(rnd); if (nf.y < -0.5) nf.y = -nf.y;
        const sz = o.leaf * (0.75 + rnd() * 0.5);
        card(F, p, nf, new V3(0, 1, 0).lerp(randDir(rnd), 0.6).normalize(), sz, sz, o.cell, crownC, 1);
      }
    }
  }
  // remplissage du houppier : cartes réparties dans un ellipsoïde
  for (let k = 0; k < (o.fill || 40); k++) {
    const d = randDir(rnd);
    const rr = 0.35 + 0.65 * Math.pow(rnd(), 0.6);
    const p = crownC.clone().add(new V3(d.x * crownR, d.y * crownR * (o.tall || 0.8), d.z * crownR).multiplyScalar(rr));
    const nf = d.clone().lerp(randDir(rnd), 0.5).normalize();
    const sz = o.leaf * (0.8 + rnd() * 0.6);
    card(F, p, nf, new V3(0, 1, 0), sz, sz, o.cell, crownC, 0.8);
  }
  return { bark: B.build(), leaves: F.build(), height: H, radius: crownR };
}

function genSpruce(rnd, o) {
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.85 + rnd() * 0.3);
  const r0 = H * 0.02;
  tube(B, [new V3(0, -0.4, 0), new V3(0, H * 0.5, 0), new V3(0, H, 0)], r0, r0 * 0.15, 8, 0, 0.3);
  const crownC = new V3(0, H * 0.45, 0);
  const R = H * (o.wide || 0.22);
  const start = H * (o.bare || 0.12);
  const whorls = Math.round((H - start) / (o.whorl || 0.45));
  for (let w = 0; w < whorls; w++) {
    const y = start + (w / whorls) * (H - start - 0.3);
    const t = (y - start) / (H - start);
    const L = R * (1 - t) * (0.85 + rnd() * 0.3) + 0.25;
    const nbr = 5 + Math.floor(rnd() * 3);
    for (let b = 0; b < nbr; b++) {
      const ang = (b / nbr) * Math.PI * 2 + w * 0.7 + rnd() * 0.4;
      const d = new V3(Math.cos(ang), (o.up || -0.15) + rnd() * 0.1, Math.sin(ang)).normalize();
      const pts = branchPts(new V3(0, y, 0), d, L, o.droop || 0.35, 2);
      // la branche s'arrête dans le rameau (pas de bout de bois qui dépasse)
      if (L > 0.8) tube(B, branchPts(new V3(0, y, 0), d, L * 0.7, o.droop || 0.35, 2), r0 * 0.2, r0 * 0.04, 4, 0.2, 0.7);
      // rameau : une carte allongée le long de la branche, légèrement inclinée vers le bas
      const mid = pts[1];
      const along = pts[2].clone().sub(pts[0]).normalize();
      const nf = new V3(0, 1, 0).addScaledVector(along, -0.3).add(new V3(-along.z, 0, along.x).multiplyScalar((rnd() - 0.5) * 0.6)).normalize();
      card(F, pts[0].clone().addScaledVector(along, 0.05), nf, along, L * 0.55 + 0.25, L * 1.05 + 0.15, o.cell, crownC, 0.6 + t * 0.4, 0.55);
      if (L > 1.2) card(F, mid, new V3(0, 1, 0).lerp(nf, 0.5).normalize(), along, L * 0.45, L * 0.7, o.cell, crownC, 0.8, 0.55);
    }
  }
  // flèche
  card(F, new V3(0, H - 0.8, 0), new V3(1, 0, 0), new V3(0, 1, 0), 0.5, 1.2, o.cell, crownC, 1, 0.4);
  card(F, new V3(0, H - 0.8, 0), new V3(0, 0, 1), new V3(0, 1, 0), 0.5, 1.2, o.cell, crownC, 1, 0.4);
  return { bark: B.build(), leaves: F.build(), height: H, radius: R };
}

function genColumn(rnd, o) {
  // peuplier d'Italie, cyprès : houppier étroit tout le long du tronc
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.85 + rnd() * 0.3);
  const r0 = H * 0.022;
  tube(B, [new V3(0, -0.3, 0), new V3(0, H * 0.6, 0), new V3(0, H * 0.95, 0)], r0, r0 * 0.2, 8, 0, 0.3);
  const crownC = new V3(0, H * 0.55, 0);
  const R = H * (o.wide || 0.12);
  const n = o.fill || 90;
  for (let k = 0; k < n; k++) {
    const y = H * (o.bare || 0.08) + rnd() * H * (0.95 - (o.bare || 0.08));
    const t = (y / H);
    const prof = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.95) * (1 - 0.35 * t);
    const ang = rnd() * Math.PI * 2;
    const rr = R * prof * (0.4 + 0.6 * rnd());
    const p = new V3(Math.cos(ang) * rr, y, Math.sin(ang) * rr);
    const nf = new V3(Math.cos(ang), 0.2, Math.sin(ang)).normalize();
    const sz = o.leaf * (0.7 + rnd() * 0.5) * (0.6 + 0.4 * prof);
    card(F, p, nf, new V3(0, 1, 0), sz * 0.8, sz * 1.3, o.cell, crownC, t, 0.8);
  }
  return { bark: B.build(), leaves: F.build(), height: H, radius: R };
}

function genPine(rnd, o) {
  // pin : long fût nu, houppier en parasol au sommet
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.85 + rnd() * 0.3);
  const r0 = H * 0.025;
  const lean = new V3((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6);
  const trunk = [];
  for (let k = 0; k <= 5; k++) { const t = k / 5; trunk.push(new V3(lean.x * t * t * 3 + Math.sin(t * 5) * 0.12, -0.3 + t * H * 0.78, lean.z * t * t * 3)); }
  tube(B, trunk, r0 * 1.1, r0 * 0.45, 8, 0, 0.1);
  const top = trunk[5];
  const crownC = top.clone().add(new V3(0, H * 0.1, 0));
  const R = H * (o.wide || 0.3);
  for (let b = 0; b < 7; b++) {
    const ang = (b / 7) * Math.PI * 2 + rnd();
    const d = new V3(Math.cos(ang), 0.35 + rnd() * 0.4, Math.sin(ang)).normalize();
    const pts = branchPts(top.clone().add(new V3(0, -rnd() * H * 0.12, 0)), d, R * (0.7 + rnd() * 0.4), 0.15, 3);
    tube(B, pts, r0 * 0.35, r0 * 0.1, 5, 0.1, 0.6);
    const tip = pts[pts.length - 1];
    for (let k = 0; k < 7; k++) {
      const p = tip.clone().add(new V3((rnd() - 0.5) * R * 0.7, (rnd() - 0.2) * R * 0.3, (rnd() - 0.5) * R * 0.7));
      card(F, p, new V3((rnd() - 0.5) * 0.6, 1, (rnd() - 0.5) * 0.6).normalize(), randDir(rnd), o.leaf * (0.8 + rnd() * 0.5), o.leaf * (0.8 + rnd() * 0.5), o.cell, crownC, 1, 0.65);
    }
  }
  return { bark: B.build(), leaves: F.build(), height: H, radius: R };
}

function genBush(rnd, o) {
  const B = new Builder(), F = new Builder();
  const R = o.h * (0.8 + rnd() * 0.4);
  const c = new V3(0, R * 0.55, 0);
  for (let b = 0; b < 5; b++) {
    const d = randDir(rnd, true);
    tube(B, branchPts(new V3(0, -0.1, 0), d, R * 0.9, 0.2, 2), R * 0.04, R * 0.01, 4, 0.2, 0.8);
  }
  for (let k = 0; k < (o.fill || 26); k++) {
    const d = randDir(rnd);
    const p = c.clone().add(new V3(d.x * R, d.y * R * 0.6, d.z * R).multiplyScalar(Math.pow(rnd(), 0.35)));
    if (p.y < 0.05) p.y = 0.05 + rnd() * 0.2;
    const sz = o.leaf * (0.8 + rnd() * 0.5);
    card(F, p, d.clone().lerp(randDir(rnd), 0.4).normalize(), new V3(0, 1, 0), sz, sz, o.cell, c, 0.7);
  }
  return { bark: B.build(), leaves: F.build(), height: R * 1.2, radius: R };
}

function genWillow(rnd, o) {
  // saule pleureur : tronc court, branches arquées, rideaux de feuillage qui pendent
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.85 + rnd() * 0.3), trunkH = H * 0.35, r0 = H * 0.04;
  tube(B, [new V3(0, -0.3, 0), new V3(0.2, trunkH * 0.6, 0), new V3(0, trunkH, 0.1)], r0, r0 * 0.7, 9, 0, 0.05);
  const crownC = new V3(0, H * 0.6, 0);
  for (let b = 0; b < 9; b++) {
    const ang = (b / 9) * Math.PI * 2 + rnd() * 0.4;
    const d = new V3(Math.cos(ang) * 0.6, 0.8, Math.sin(ang) * 0.6).normalize();
    const pts = branchPts(new V3(0, trunkH, 0), d, H * 0.55, 1.6, 5);
    tube(B, pts, r0 * 0.35, r0 * 0.08, 5, 0.1, 0.8);
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k];
      const out = new V3(Math.cos(ang), 0, Math.sin(ang));
      card(F, p.clone().add(new V3(0, -o.leaf * 0.6, 0)), out, new V3(0, 1, 0), o.leaf * 0.8, o.leaf * 1.8, o.cell, crownC, 1, 0.5);
    }
  }
  return { bark: B.build(), leaves: F.build(), height: H, radius: H * 0.45 };
}

// cep de vigne : souche tordue, fil de palissage, feuillage en haie basse et étroite le long du rang (axe z)
function genVine(rnd, o) {
  const B = new Builder(), F = new Builder();
  const H = o.h * (0.9 + rnd() * 0.2);
  tube(B, [new V3(0, -0.05, 0), new V3(0.03, H * 0.35, 0.02), new V3(-0.02, H * 0.5, 0)], 0.035, 0.022, 5, 0, 0.2, 2);
  const c = new V3(0, H * 0.75, 0);
  for (let k = 0; k < (o.fill || 14); k++) {
    const p = new V3((rnd() - 0.5) * 0.35, H * (0.5 + rnd() * 0.5), (rnd() - 0.5) * 1.2);
    const nf = new V3(rnd() < 0.5 ? 1 : -1, 0.3 + rnd() * 0.4, (rnd() - 0.5) * 0.6).normalize();
    card(F, p, nf, new V3(0, 1, 0), o.leaf * (0.8 + rnd() * 0.4), o.leaf * (0.8 + rnd() * 0.4), o.cell, c, 0.6, 0.6);
  }
  return { bark: B.build(), leaves: F.build(), height: H, radius: 0.6 };
}

const GEN = {
  vine: (r) => genVine(r, { h: 1.25, cell: 0, leaf: 0.7, fill: 16 }),
  broadleaf: (r) => genBroadleaf(r, { h: 15, leaf: 2.6, cell: 0, branches: 8, fill: 90, cardsPer: 6, trunk: 0.32 }),
  spruce: (r) => genSpruce(r, { h: 22, cell: 1, wide: 0.2, whorl: 0.5, droop: 0.4 }),
  pine: (r) => genPine(r, { h: 16, cell: 2, wide: 0.3, leaf: 2.2 }),
  poplar: (r) => genColumn(r, { h: 22, cell: 3, wide: 0.11, leaf: 1.9, fill: 110 }),
  birch: (r) => genBroadleaf(r, { h: 14, leaf: 1.8, cell: 4, branches: 7, fill: 60, cardsPer: 5, trunk: 0.4, wide: 0.75, droop: 0.6, tall: 1.1 }),
  cypress: (r) => genColumn(r, { h: 13, cell: 5, wide: 0.1, leaf: 1.5, fill: 120, bare: 0.03 }),
  olive: (r) => genBroadleaf(r, { h: 6, leaf: 1.6, cell: 6, branches: 5, fill: 45, cardsPer: 5, trunk: 0.3, wide: 1.2, droop: 0.1 }),
  fruit: (r) => genBroadleaf(r, { h: 6.5, leaf: 1.6, cell: 0, branches: 5, fill: 45, cardsPer: 5, trunk: 0.3, wide: 1.15 }),
  willow: (r) => genWillow(r, { h: 11, cell: 3, leaf: 1.4 }),
  bush: (r) => genBush(r, { h: 1.3, cell: 7, leaf: 1.0, fill: 26 }),
};

function genRock(rnd) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const sx = 0.8 + rnd() * 0.5, sy = 0.55 + rnd() * 0.3, sz = 0.8 + rnd() * 0.5;
  const ph = [rnd() * 10, rnd() * 10, rnd() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.18 * Math.sin(x * 3.1 + ph[0]) * Math.sin(y * 2.7 + ph[1]) + 0.12 * Math.sin(z * 4.3 + ph[2]) + 0.05 * Math.sin(x * 9 + z * 7);
    const flat = y < -0.2 ? 0.6 : 1;
    p.setXYZ(i, x * n * sx, y * n * sy * flat, z * n * sz);
  }
  g.computeVertexNormals();
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(p.count), 1));
  return { bark: g, leaves: null, height: sy, radius: Math.max(sx, sz) };
}

function genHay() {
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 20, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(0, 0.72, 0);
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return { bark: g, leaves: null, height: 1.5, radius: 0.75 };
}

/** Modèles : species → [3 variantes] {bark, leaves, height, radius, cell, barkLayer, barkColor}. */
export function buildModels() {
  const out = {};
  SPECIES.forEach((sp, si) => {
    out[sp] = [];
    for (let v = 0; v < 3; v++) {
      const rnd = rng(9000 + si * 31 + v * 7);
      const m = sp === 'rock' ? genRock(rnd) : sp === 'hay' ? genHay() : GEN[sp](rnd);
      m.cell = LEAF_CELL[sp] ?? 0;
      m.barkLayer = BARK_LAYER[sp] ?? 0;
      m.barkColor = BARK_COLOR[sp] || '#555';
      out[sp].push(m);
    }
  });
  return out;
}

export { mergeGeometries };
