/* Virtual Ride 3D Réaliste — vélo : la géométrie des cadres de Bike3D (mêmes cotes, js/cyclist.js de l'univers cartoon : route alu,
   endurance, grimpeur, aéro, contre-la-montre, gravel, VTT, ville), en pièces détaillées : tubes ronds ou profilés, fourche, potence
   et cintre (cocottes, leviers, guidoline), selle, tige, étriers ou disques, pédalier (plateaux, manivelles, pédales), cassette,
   dérailleur, chaîne, bidon et porte-bidon, roues (jante à hauteur de profil, rayons, moyeu, lenticulaire), pneus à flanc beige
   ou crampons. Chaque sommet porte sa couleur et son matériau (rugosité, métal, vernis) ; la peinture du cadre (masque) prend la
   couleur du coureur. Quatre maillages : le vélo, la roue avant, la roue arrière, le pédalier (qui tournent). */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const R = 0.34;
const HEAD = 0.3125;
const FRAME_BASE = { st: 0.815, seat: 0.3065, ht: 0.86, hb: [0.70, 0.41], k: 1, prof: 1, stays: 0, bar: 'drop', flare: 0, fork: 'road', bottle: true };
const FRAMES = {
  classic: {}, alu: { k: 1.3 }, endurance: { st: 0.80, ht: 0.895, k: 1.05 }, climber: { k: 0.78 },
  aero: { st: 0.80, k: 1.1, prof: 2.3, stays: 0.6, bar: 'aero' },
  tt: { st: 0.79, seat: 0.2126, saddleZ: -0.215, ht: 0.80, hb: [0.66, 0.422], k: 1.1, prof: 2.7, stays: 0.58, bar: 'tt', bottle: false, hug: 0.02 },
  gravel: { st: 0.76, ht: 0.90, hb: [0.71, 0.407], k: 1.15, flare: 0.045 },
  mtb: { st: 0.74, ht: 0.88, hb: [0.73, 0.41], k: 1.4, bar: 'flat', fork: 'susp' },
  city: { st: 0.75, ht: 0.92, k: 1.15, bar: 'city', fenders: true, rack: true },
};
const WHEELS = {
  tri: { depth: 0.045, carbon: true, spokes: 20 }, box: { depth: 0.018, alu: true, spokes: 32, cross: true }, alu: { depth: 0.025, alu: true, dark: true, spokes: 24, cross: true },
  climb: { depth: 0.03, carbon: true, spokes: 24 }, c45: { depth: 0.045, carbon: true, spokes: 20 }, c65: { depth: 0.06, carbon: true, spokes: 20 },
  c80: { depth: 0.08, carbon: true, spokes: 18 }, disc: { rear: 'lenticular', front: 'c80' }, gravel: { depth: 0.025, alu: true, dark: true, spokes: 28, cross: true, wide: true },
};
const TIRES = { race: { r: 0.016, wall: [0.45, 0.3, 0.16] }, road: { r: 0.018 }, tubeless: { r: 0.019 }, training: { r: 0.02 }, gravel: { r: 0.029, wall: [0.4, 0.28, 0.15], knobs: 0.006 }, mtb: { r: 0.035, knobs: 0.01 } };
export const POSITIONS = {
  upright: { grip: 'tops', e: 1.0 }, tops: { grip: 'tops', e: 0.97 }, hoods: { grip: 'hoods', e: 0.97 }, hoods_bent: { grip: 'hoods', e: 0.8 },
  drops: { grip: 'drops', e: 0.86 }, forearms: { grip: 'forearms', tuckK: 0.4 }, tt: { grip: 'pads', tuckK: 0.25 }, tt_pro: { grip: 'pads', tuckK: 0.25, pro: true },
};
const has = (t, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(t, k);
export function normGear(g) {
  g = g || {};
  const pick = (t, k, d) => (has(t, k) ? k : d);
  return {
    frame: pick(FRAMES, g.frame, 'aero'), wheels: pick(WHEELS, g.wheels, 'c45'), tire: pick(TIRES, g.tire, 'road'), position: pick(POSITIONS, g.position, 'hoods'),
    helmet: ['road', 'city', 'aero', 'tt'].includes(g.helmet) ? g.helmet : 'road', clothing: ['loose', 'fitted', 'aero', 'skinsuit', 'skinsuit_tt'].includes(g.clothing) ? g.clothing : 'fitted',
    glasses: ['none', 'sport', 'shield'].includes(g.glasses) ? g.glasses : 'sport', socks: ['short', 'classic', 'aero'].includes(g.socks) ? g.socks : 'classic',
    shoes: ['flat', 'mtb', 'road', 'carbon', 'aero'].includes(g.shoes) ? g.shoes : 'road', sex: g.sex === 'f' ? 'f' : 'm',
  };
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Cotes du cadre (comme frameLayout de Bike3D). */
export function frameLayout(id) {
  const F = Object.assign({}, FRAME_BASE, FRAMES[id] || {});
  const rearAxle = V(0, R, -0.5), frontAxle = V(0, R, 0.57), BB = V(0, 0.28, -0.08);
  const onSeat = (y) => V(0, y, BB.z - (y - BB.y) * F.seat);
  const onHead = (y) => V(0, y, F.hb[1] - (y - F.hb[0]) * HEAD);
  const L = { F, rearAxle, frontAxle, BB, onSeat, onHead, stTop: onSeat(F.st), htTop: onHead(F.ht), htBot: V(0, F.hb[0], F.hb[1]), saddle: onSeat(0.965) };
  if (F.saddleZ) L.saddle.z = F.saddleZ;
  L.dtHalf = 0.026 * F.k * (F.prof > 1.2 ? Math.sqrt(F.prof) : 1);
  L.dt = [BB, onHead(F.hb[0] + 0.05)];
  L.arc = null;
  if (F.hug) {
    const A = frontAxle, rc = R + L.dtHalf + F.hug, at = (a) => V(0, A.y + Math.sin(a) * rc, A.z + Math.cos(a) * rc);
    let a0 = Math.atan2(BB.y - A.y, BB.z - A.z); if (a0 < 0) a0 += Math.PI * 2;
    const from = a0 - Math.acos(rc / Math.hypot(BB.y - A.y, BB.z - A.z));
    const c0 = F.hb[0] - A.y, c1 = F.hb[1] - A.z, qa = 1 + HEAD * HEAD, qb = 2 * (c0 - c1 * HEAD), qc = c0 * c0 + c1 * c1 - rc * rc;
    const s = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
    const to = Math.atan2(c0 + s, c1 - s * HEAD);
    if (to < from) { L.dt = [BB, at(from)]; L.arc = { r: rc, from, to, at }; }
  }
  const u = L.dt[1].clone().sub(BB).normalize(), inward = V(0, u.z, -u.y);
  L.bottle = { center: BB.clone().addScaledVector(u, 0.25).addScaledVector(inward, L.dtHalf + 0.035 + 0.003), dir: u };
  L.cockpit = cockpit(F, L.htTop);
  return L;
}

/** Prises des mains (repère du vélo), comme _cockpit de Bike3D. */
function cockpit(F, ht) {
  const ck = {};
  if (F.bar === 'drop' || F.bar === 'aero') {
    const aero = F.bar === 'aero', by = ht.y + (aero ? 0.012 : 0.025), bz = ht.z + 0.14, w = 0.21, fl = F.flare;
    Object.assign(ck, { by, bz, w, fl, hoods: [w + fl * 0.15 - 0.005, by + 0.045, bz + 0.08], tops: [0.15, by + 0.038, bz - 0.005], drops: [w + fl * 0.7, by - 0.075, bz + 0.07], forearm: [0.14, by + 0.048, bz - 0.02], forearmHand: [0.1, by + 0.035, bz + 0.24], dropBar: true });
  } else if (F.bar === 'tt') {
    const by = ht.y - 0.015, bz = ht.z + 0.115;
    Object.assign(ck, { by, bz, hoods: [0.205, by + 0.038, bz + 0.1], tops: [0.12, by + 0.04, bz], drops: [0.205, by + 0.038, bz + 0.1], dropsE: 0.86 });
  } else if (F.bar === 'flat') {
    const by = ht.y + 0.05, bz = ht.z + 0.11;
    Object.assign(ck, { by, bz, hoods: [0.29, by + 0.04, bz], tops: [0.29, by + 0.04, bz], drops: [0.29, by + 0.04, bz] });
  } else {
    const by = ht.y + 0.06, bz = ht.z + 0.07;
    Object.assign(ck, { by, bz, hoods: [0.27, by + 0.06, bz - 0.12], tops: [0.27, by + 0.06, bz - 0.12], drops: [0.27, by + 0.06, bz - 0.12] });
  }
  if (!ck.dropsE) ck.dropsE = ck.dropBar ? 0.86 : 0.8;
  return ck;
}

/** Manchettes et prolongateurs : position des coudes et des mains. */
export function clipOns(L, pro) {
  const F = L.F, ck = L.cockpit;
  const tt = F.bar === 'tt';
  const y = tt ? ck.by : ck.by + 0.012, z = ck.bz - (tt ? 0.04 : 0.03), rise = tt ? 0.07 : 0.035;
  const px = pro ? 0.075 : 0.09, py = y + rise;
  return { y, z, rise, px, py, pad: [px, py + 0.06, z], ext: pro ? [0.045, py + 0.085, z + 0.25] : [0.055, py + 0.06, z + 0.27] };
}

/** Plan de la position (comme _plan de Bike3D) : bassin, épaules, mains, coudes. */
export function plan(L, posId, stand, morph) {
  const P = POSITIONS[posId] || POSITIONS.hoods, ck = L.cockpit;
  const side = (p) => [V(-p[0], p[1], p[2]), V(p[0], p[1], p[2])];
  const pelvis = V(0, 1.0, L.saddle.z + 0.03);
  const TORSO = 0.59;
  let hands, elbows = null, e = P.e;
  const co = P.grip === 'pads' || (P.grip === 'forearms' && L.F.bar === 'tt') ? clipOns(L, P.pro) : null;
  if (P.grip === 'pads' && co) { hands = side(co.ext); elbows = side(co.pad); }
  else if (P.grip === 'forearms' && ck.forearm) { hands = side(ck.forearmHand); elbows = side(ck.forearm); }
  else if (P.grip === 'forearms' && co) { hands = side(co.ext); elbows = side(co.pad); }
  else if (P.grip === 'drops') { hands = side(ck.drops); e = ck.dropsE; }
  else hands = side(ck[P.grip] || ck.hoods);
  let a = 0.6;
  if (elbows) a = Math.asin(Math.max(0.05, Math.min(0.95, (elbows[1].y + 0.28 - pelvis.y) / TORSO)));
  else {
    const h = hands[1], reach = (morph ? morph.upperArm + morph.foreArm : 0.585) * 1.02 * e;
    let lo = 0.08, hi = 1.3;
    for (let k = 0; k < 22; k++) {
      a = (lo + hi) / 2;
      const d = Math.hypot(Math.abs(h.x) - (morph ? morph.shoulderX : 0.19), h.y - (pelvis.y + TORSO * Math.sin(a) - 0.03), h.z - (pelvis.z + TORSO * Math.cos(a) - 0.03));
      if (d < reach) lo = a; else hi = a;
    }
  }
  const shoulder = V(0, pelvis.y + TORSO * Math.sin(a), pelvis.z + TORSO * Math.cos(a));
  if (stand) { pelvis.y += 0.16; pelvis.z += 0.2; shoulder.y += 0.06; shoulder.z += 0.1; }
  const drops = ck.dropBar && (P.grip === 'hoods' || P.grip === 'tops') ? side(ck.drops) : null;
  return { pelvis, shoulder, hands, elbows, drops, pro: !!P.pro, tuckK: P.tuckK || 1, clipOns: co };
}

/* ---------------------------------------------------------------- constructeur de géométrie */

// matériaux : [albédo r, g, b, rugosité, métal, vernis, masque de peinture (0 non, 0,5 liseré, 1 cadre)]
const MAT = {
  paint: [0.5, 0.5, 0.5, 0.28, 0.0, 1.0, 1], accent: [0.9, 0.9, 0.9, 0.3, 0.0, 1.0, 0.5],
  carbon: [0.025, 0.025, 0.028, 0.32, 0.0, 0.9, 0], matte: [0.03, 0.03, 0.032, 0.6, 0.0, 0.0, 0],
  alu: [0.75, 0.76, 0.78, 0.32, 1.0, 0.0, 0], steel: [0.6, 0.6, 0.62, 0.22, 1.0, 0.0, 0], darkMetal: [0.12, 0.12, 0.13, 0.35, 1.0, 0.0, 0],
  chain: [0.35, 0.35, 0.36, 0.45, 1.0, 0.0, 0], rubber: [0.035, 0.035, 0.035, 0.82, 0.0, 0.0, 0], tape: [0.04, 0.04, 0.045, 0.75, 0.0, 0.0, 0],
  saddle: [0.03, 0.03, 0.03, 0.55, 0.0, 0.2, 0], bottle: [0.85, 0.85, 0.82, 0.35, 0.0, 0.3, 0], wall: [0.45, 0.30, 0.16, 0.8, 0, 0, 0],
  reflector: [0.6, 0.05, 0.03, 0.3, 0, 0.5, 0], decal: [0.85, 0.85, 0.85, 0.35, 0, 0.9, 0],
};

let LOW = false;   // vélo lointain : géométrie allégée

class GB {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.i = []; }
  get count() { return this.p.length / 3; }
  v(p, n, mat) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.c.push(mat[0], mat[1], mat[2]); this.m.push(mat[3], mat[4], mat[5], mat[6]); return this.count - 1; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.m, 4));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
  // tube le long d'un chemin (points), rayons r0 → r1, profil (prof : profondeur / largeur dans le plan du cadre), sections fermées
  tube(pts, r0, r1, mat, sides, prof, caps) {
    sides = sides || 12; prof = prof || 1;
    if (LOW) { sides = Math.max(4, Math.round(sides / 2)); if (pts.length > 6) pts = pts.filter((p, k) => k % 2 === 0 || k === pts.length - 1); }
    const n = pts.length, base = this.count;
    let side = V(1, 0, 0);
    for (let k = 0; k < n; k++) {
      const p = pts[k], t = k / (n - 1);
      const dir = (k < n - 1 ? pts[k + 1].clone().sub(p) : p.clone().sub(pts[k - 1])).normalize();
      const u = side.clone().addScaledVector(dir, -side.dot(dir));
      if (u.lengthSq() < 1e-6) u.set(0, 1, 0).addScaledVector(dir, -dir.y);
      u.normalize();
      const w = new THREE.Vector3().crossVectors(dir, u).normalize();
      const r = r0 + (r1 - r0) * t;
      const sx = 1 / Math.sqrt(prof), sz = Math.sqrt(prof);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const off = u.clone().multiplyScalar(ca * r * sx).addScaledVector(w, sa * r * sz);
        const nn = u.clone().multiplyScalar(ca / sx).addScaledVector(w, sa / sz).normalize();
        this.v(p.clone().add(off), nn, mat);
      }
    }
    for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) {
      const a = base + k * (sides + 1) + s, b = a + sides + 1;
      this.i.push(a, a + 1, b, a + 1, b + 1, b);
    }
    if (caps !== false) for (const [k, sgn] of [[0, -1], [n - 1, 1]]) {
      const p = pts[k], dir = (k === 0 ? pts[1].clone().sub(p) : p.clone().sub(pts[n - 2])).normalize().multiplyScalar(sgn);
      const c = this.v(p, dir, mat), ring = base + k * (sides + 1);
      for (let s = 0; s < sides; s++) { if (sgn > 0) this.i.push(c, ring + s, ring + s + 1); else this.i.push(c, ring + s + 1, ring + s); }
    }
  }
  // boîte orientée (centre, demi-tailles, rotation autour de x)
  box(c, hx, hy, hz, mat, rotX) {
    const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rotX || 0);
    const faces = [[V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)], [V(-1, 0, 0), V(0, 1, 0), V(0, 0, -1)], [V(0, 1, 0), V(0, 0, 1), V(1, 0, 0)], [V(0, -1, 0), V(0, 0, 1), V(-1, 0, 0)], [V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)], [V(0, 0, -1), V(1, 0, 0), V(0, -1, 0)]];
    const h = V(hx, hy, hz);
    for (const [n, a, b] of faces) {
      const base = this.count;
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = V(n.x * h.x + a.x * h.x * sa + b.x * h.x * sb, n.y * h.y + a.y * h.y * sa + b.y * h.y * sb, n.z * h.z + a.z * h.z * sa + b.z * h.z * sb);
        this.v(p.applyQuaternion(q).add(c), n.clone().applyQuaternion(q), mat);
      }
      this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // révolution autour de l'axe x (roues) : profil [(rayon, x)] ; mats par segment
  lathe(profile, mats, segs, center) {
    segs = segs || 64;
    if (LOW) segs = Math.max(16, Math.round(segs / 4));
    const base = this.count, n = profile.length;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < n; k++) {
        const [r, x] = profile[k];
        const prev = profile[Math.max(0, k - 1)], next = profile[Math.min(n - 1, k + 1)];
        // normale du profil : perpendiculaire à la tangente (dr, dx)
        const dr = next[0] - prev[0], dx = next[1] - prev[1];
        const nr = dx, nx = -dr, l = Math.hypot(nr, nx) || 1;
        this.v(V(center.x + x, center.y + ca * r, center.z + sa * r), V(nx / l, ca * nr / l, sa * nr / l), mats[Math.min(k, mats.length - 1)]);
      }
    }
    for (let s = 0; s < segs; s++) for (let k = 0; k < n - 1; k++) {
      const a = base + s * n + k, b = a + n;
      this.i.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

/* ---------------------------------------------------------------- pièces */

function wheel(spec, tire, front, wide) {
  const g = new GB();
  const c = V(0, 0, 0);
  const T = TIRES[tire] || TIRES.road;
  const tr = T.r * (wide ? 1 : 1);
  const rimR = R - tr * 1.6;
  const lent = !front && spec.rear === 'lenticular';
  const W = spec.rear ? WHEELS[front ? spec.front : 'c80'] : spec;
  // pneu : tore, flanc beige éventuel, crampons
  const tp = [];
  for (let k = 0; k <= 16; k++) {
    const a = -Math.PI * 0.85 + (k / 16) * Math.PI * 1.7;
    tp.push([rimR + tr * 0.6 + Math.cos(a) * tr, Math.sin(a) * tr * 0.92]);
  }
  const wall = T.wall ? [...T.wall, 0.8, 0, 0, 0] : MAT.rubber;
  g.lathe(tp, tp.map((p, k) => (k < 4 || k > 12 ? wall : MAT.rubber)), 96, c);
  if (T.knobs && !LOW) {
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      for (const sx of [-0.6, 0, 0.6]) {
        const p = V(sx * tr, Math.cos(a) * (rimR + tr * 1.55), Math.sin(a) * (rimR + tr * 1.55));
        g.box(p, T.knobs * 0.9, 0.006, 0.006, MAT.rubber, -a);
      }
    }
  }
  // jante
  const depth = lent ? 0 : W.depth || 0.025;
  const rimMat = W.carbon ? MAT.carbon : W.dark ? MAT.darkMetal : MAT.alu;
  const half = (wide ? 0.014 : 0.0115);
  if (lent) {
    const prof = [[0.02, 0.034], [0.05, 0.028], [rimR * 0.7, 0.014], [rimR, half], [rimR + 0.004, 0], [rimR, -half], [rimR * 0.7, -0.014], [0.05, -0.028], [0.02, -0.034]];
    g.lathe(prof, prof.map((p, k) => (k === 3 || k === 5 ? MAT.decal : MAT.carbon)), 64, c);
  } else {
    const inner = rimR - depth;
    const prof = [[rimR + 0.002, half * 0.9], [rimR, half], [rimR - 0.01, half], [inner + 0.004, half * 0.7], [inner, 0], [inner + 0.004, -half * 0.7], [rimR - 0.01, -half], [rimR, -half], [rimR + 0.002, -half * 0.9]];
    // inscription des jantes carbone : une bande claire sur le flanc
    const decal = W.carbon && depth > 0.035;
    g.lathe(prof, prof.map((p, k) => (decal && (k === 2 || k === 6) ? MAT.decal : (!W.carbon && (k === 1 || k === 7) ? MAT.steel : rimMat))), 72, c);
    // rayons (pas au loin)
    const n = LOW ? 0 : W.spokes || 24;
    const hubR = 0.022;
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2;
      const side = s % 2 ? 1 : -1;
      const cross = W.cross ? side * 0.35 : 0;
      const ah = a + cross;
      const pHub = V(side * 0.03, Math.cos(ah) * hubR, Math.sin(ah) * hubR);
      const pRim = V(side * 0.004, Math.cos(a) * (inner + 0.003), Math.sin(a) * (inner + 0.003));
      g.tube([pHub, pRim], 0.0011, 0.0011, W.carbon ? MAT.darkMetal : MAT.steel, 4, 1, false);
    }
    // moyeu
    g.tube([V(-0.045, 0, 0), V(-0.03, 0, 0), V(0.03, 0, 0), V(0.045, 0, 0)], 0.022, 0.022, MAT.darkMetal, 16);
  }
  // disque de frein et cassette
  if (!front) {
    g.tube([V(-0.035, 0, 0), V(-0.033, 0, 0)], 0.08, 0.08, MAT.steel, 32);
    if (!LOW) for (let k = 0; k < 11; k++) g.tube([V(0.028 + k * 0.0038, 0, 0), V(0.0295 + k * 0.0038, 0, 0)], 0.022 + k * 0.0034, 0.022 + k * 0.0034, MAT.chain, 24);
  } else {
    g.tube([V(-0.035, 0, 0), V(-0.033, 0, 0)], 0.07, 0.07, MAT.steel, 32);
  }
  return g.build();
}

function crankset(L, gear) {
  const g = new GB();
  // plateaux, araignée, manivelles, pédales (repère centré sur l'axe du pédalier)
  g.tube([V(0.045, 0, 0), V(0.049, 0, 0)], 0.105, 0.105, MAT.carbon, 48);
  g.tube([V(0.052, 0, 0), V(0.0555, 0, 0)], 0.082, 0.082, MAT.darkMetal, 40);
  g.tube([V(-0.07, 0, 0), V(0.07, 0, 0)], 0.012, 0.012, MAT.darkMetal, 10);
  for (const sx of [-1, 1]) {
    // manivelle : de l'axe vers la pédale, côté droit vers le haut à crank = 0 (convention de Bike3D)
    const dir = sx > 0 ? V(0, 1, 0) : V(0, -1, 0);
    const a = V(sx * 0.075, 0, 0), b = V(sx * 0.085, dir.y * 0.17, 0);
    g.tube([a, b], 0.012, 0.01, gear.frame === 'tt' || gear.frame === 'aero' ? MAT.carbon : MAT.alu, 8, 2);
    // pédale automatique
    g.box(V(sx * 0.115, dir.y * 0.17, 0), 0.038, 0.008, 0.045, MAT.matte);
  }
  return g.build();
}

function bikeStatic(L, gear) {
  const g = new GB();
  const F = L.F, k = F.k, pf = F.prof, aero = pf > 1.2;
  const { BB, onSeat, onHead, stTop, htTop, htBot, rearAxle, frontAxle } = L;
  const paint = MAT.paint;
  const t = (a, b, r, prof, mat) => g.tube([a, b], r, r * 0.95, mat || paint, 14, prof);
  // cadre
  t(BB, stTop, 0.022 * k, pf);
  t(stTop, onHead(F.ht - 0.02), 0.019 * k, aero ? 1.5 : 1);
  if (L.arc) {
    const pts = [BB, L.dt[1]];
    const n = 10;
    for (let i = 1; i <= n; i++) pts.push(L.arc.at(L.arc.from + (L.arc.to - L.arc.from) * i / n));
    g.tube(pts, L.dtHalf / Math.sqrt(pf), L.dtHalf / Math.sqrt(pf) * 0.9, paint, 14, pf);
  } else t(L.dt[0], L.dt[1], 0.026 * k, pf);
  t(htBot.clone().add(V(0, -0.02, 0.006)), htTop.clone().add(V(0, 0.01, -0.003)), 0.028 * k, aero ? 1.6 : 1);
  // liseré : bande claire en haut du tube oblique
  const dtU = L.dt[1].clone().sub(L.dt[0]);
  g.tube([L.dt[0].clone().addScaledVector(dtU, 0.55), L.dt[0].clone().addScaledVector(dtU, 0.8)], 0.0262 * k * 1.01, 0.0262 * k * 1.01, MAT.accent, 14, pf, false);
  const stayTop = F.stays ? onSeat(F.stays) : stTop;
  for (const sx of [-1, 1]) {
    t(stayTop.clone().add(V(sx * 0.012, 0, 0)), V(sx * 0.062, R, -0.5), 0.011 * Math.min(k, 1.2), 1.2);
    t(BB.clone().add(V(sx * 0.03, 0, 0)), V(sx * 0.062, R, -0.5), 0.013 * Math.min(k, 1.2), 1.4);
    // pattes et axe traversant
    g.tube([V(sx * 0.062, R, -0.5), V(sx * 0.068, R, -0.5)], 0.008, 0.008, MAT.darkMetal, 8);
  }
  g.tube([V(-0.07, R, -0.5), V(0.07, R, -0.5)], 0.006, 0.006, MAT.darkMetal, 8);
  g.tube([BB.clone().add(V(-0.045, 0, 0)), BB.clone().add(V(0.045, 0, 0))], 0.022, 0.022, paint, 16);
  // fourche
  const crown = htBot.clone().add(V(0, -0.025, 0.008));
  for (const sx of [-1, 1]) {
    const tip = V(sx * 0.052, R, frontAxle.z);
    const mid = crown.clone().lerp(tip, 0.5).add(V(sx * 0.03, 0, 0.012));
    if (F.fork === 'susp') {
      g.tube([crown.clone().add(V(sx * 0.05, 0, 0)), mid.clone().add(V(sx * 0.005, 0, 0))], 0.017, 0.017, MAT.alu, 12);
      g.tube([mid.clone().add(V(sx * 0.005, 0.02, 0)), tip], 0.021, 0.016, MAT.matte, 12);
    } else g.tube([crown.clone().add(V(sx * 0.02, 0, 0)), mid, tip], 0.016 * k, 0.009, paint, 12, aero ? 1.8 : 1.3);
  }
  g.tube([V(-0.06, R, frontAxle.z), V(0.06, R, frontAxle.z)], 0.006, 0.006, MAT.darkMetal, 8);
  // tige de selle et selle profilée
  const sad = L.saddle;
  g.tube([stTop.clone().add(V(0, -0.02, 0.006)), sad.clone().add(V(0, -0.03, 0.01))], 0.0135, 0.0135, aero ? MAT.carbon : MAT.carbon, 12, aero ? 2 : 1);
  const sp = [];
  for (let i = 0; i <= 10; i++) {
    const tt = i / 10, z = sad.z - 0.12 + tt * 0.27;
    const wdt = 0.072 * (1 - Math.pow(tt, 1.6)) + 0.016;
    sp.push([z, wdt, sad.y + 0.012 * Math.sin(tt * Math.PI) - 0.008 * tt]);
  }
  for (let i = 0; i < sp.length - 1; i++) {
    const [z0, w0, y0] = sp[i], [z1, w1, y1] = sp[i + 1];
    g.tube([V(0, y0, z0), V(0, y1, z1)], w0, w1, MAT.saddle, 14, 0.32 * 0.32 * 9.7, false);
  }
  g.tube([V(-0.02, sad.y - 0.01, sad.z - 0.1), V(-0.02, sad.y - 0.015, sad.z + 0.11)], 0.0035, 0.0035, MAT.steel, 6);
  g.tube([V(0.02, sad.y - 0.01, sad.z - 0.1), V(0.02, sad.y - 0.015, sad.z + 0.11)], 0.0035, 0.0035, MAT.steel, 6);
  // poste de pilotage
  const ck = L.cockpit;
  if (F.bar === 'drop' || F.bar === 'aero') {
    const { by, bz, w, fl } = ck;
    g.tube([htTop.clone().add(V(0, 0.012, -0.004)), V(0, by, bz)], aero ? 0.016 : 0.015, 0.016, aero ? MAT.carbon : MAT.matte, 12, aero ? 1.8 : 1);
    const right = [V(0, by, bz), V(w - 0.03, by, bz + 0.002), V(w, by + 0.006, bz + 0.05), V(w + fl * 0.15, by + 0.01, bz + 0.1), V(w + fl * 0.4, by - 0.035, bz + 0.122), V(w + fl * 0.8, by - 0.09, bz + 0.095), V(w + fl, by - 0.115, bz + 0.035)];
    for (const sx of [-1, 1]) {
      const pts = right.map((p) => V(p.x * sx, p.y, p.z));
      g.tube(smoothPath(pts, 3), 0.0125, 0.0125, MAT.tape, 10);
      // cocotte et levier
      g.box(V(sx * (w + fl * 0.15), by + 0.03, bz + 0.088), 0.017, 0.026, 0.035, MAT.matte, -0.25);
      g.tube([V(sx * (w + fl * 0.17), by + 0.02, bz + 0.12), V(sx * (w + fl * 0.32), by - 0.035, bz + 0.13), V(sx * (w + fl * 0.4), by - 0.08, bz + 0.115)], 0.006, 0.005, MAT.alu, 8, 1.6);
    }
  } else if (F.bar === 'tt') {
    const { by, bz } = ck;
    g.tube([htTop, V(0, by, bz)], 0.02, 0.02, paint, 12, 1.8);
    for (const sx of [-1, 1]) g.tube(smoothPath([V(0, by, bz), V(sx * 0.145, by, bz), V(sx * 0.19, by - 0.003, bz + 0.035), V(sx * 0.205, by - 0.008, bz + 0.09), V(sx * 0.205, by - 0.012, bz + 0.15)], 3), 0.012, 0.012, MAT.carbon, 10, 1.8);
  } else if (F.bar === 'flat') {
    const { by, bz } = ck;
    g.tube([htTop, V(0, by, bz)], 0.018, 0.018, MAT.matte, 12);
    g.tube([V(-0.33, by, bz), V(0.33, by, bz)], 0.0125, 0.0125, MAT.matte, 10);
    for (const sx of [-1, 1]) g.tube([V(sx * 0.255, by, bz), V(sx * 0.335, by, bz)], 0.017, 0.017, MAT.rubber, 12);
  } else {
    const { by, bz } = ck;
    g.tube([htTop, V(0, by, bz)], 0.018, 0.018, MAT.alu, 12);
    for (const sx of [-1, 1]) g.tube(smoothPath([V(0, by, bz), V(sx * 0.15, by + 0.01, bz + 0.012), V(sx * 0.24, by + 0.02, bz - 0.045), V(sx * 0.268, by + 0.025, bz - 0.12)], 3), 0.012, 0.012, MAT.alu, 10);
  }
  // prolongateurs (contre-la-montre, ou rapportés)
  const P = POSITIONS[gear.position] || POSITIONS.hoods;
  if (P.grip === 'pads' || F.bar === 'tt') {
    const co = clipOns(L, P.pro);
    for (const sx of [-1, 1]) {
      g.box(V(sx * co.px, co.py, co.z), 0.035, 0.012, 0.06, MAT.matte);
      g.tube(smoothPath([V(sx * (co.px - 0.015), co.py - 0.005, co.z + 0.03), V(sx * (co.px - 0.025), co.py, co.z + 0.16), V(sx * (co.ext[0] + 0.004), co.py + (P.pro ? 0.04 : 0.02), co.z + 0.26), V(sx * co.ext[0], co.ext[1] - 0.01, co.ext[2])], 3), 0.011, 0.011, MAT.carbon, 10);
    }
  }
  // freins à disque (étriers), dérailleur, chaîne
  g.box(V(-0.045, R + 0.06, -0.5 + 0.04), 0.012, 0.025, 0.035, MAT.darkMetal, 0.6);
  g.box(V(-0.045, R + 0.06, frontAxle.z - 0.04), 0.012, 0.025, 0.035, MAT.darkMetal, -0.6);
  g.box(V(0.075, R - 0.07, -0.5 + 0.01), 0.008, 0.045, 0.02, MAT.darkMetal, 0.3);
  // chaîne : brin supérieur et inférieur entre plateau et pignons
  const cy = BB.y, cz = BB.z;
  g.tube([V(0.052, cy + 0.1, cz), V(0.05, R + 0.04, -0.5)], 0.0045, 0.0045, MAT.chain, 6, 3);
  g.tube([V(0.052, cy - 0.1, cz), V(0.06, R - 0.09, -0.5 + 0.03), V(0.06, R - 0.03, -0.5)], 0.0045, 0.0045, MAT.chain, 6, 3);
  // bidon et porte-bidon
  if (F.bottle) {
    const B = L.bottle, d = B.dir;
    g.tube([B.center.clone().addScaledVector(d, -0.1), B.center.clone().addScaledVector(d, 0.08)], 0.034, 0.034, MAT.bottle, 16);
    g.tube([B.center.clone().addScaledVector(d, 0.08), B.center.clone().addScaledVector(d, 0.105)], 0.022, 0.012, MAT.matte, 12);
  }
  if (F.fenders) {
    for (const [ax, a0, a1] of [[rearAxle, 0.2, 2.6], [frontAxle, 0.6, 2.9]]) {
      const pts = [];
      for (let i = 0; i <= 14; i++) { const a = a0 + (a1 - a0) * i / 14; pts.push(V(0, ax.y + Math.sin(a) * (R + 0.025), ax.z + Math.cos(a) * (R + 0.025) * (ax === rearAxle ? -1 : 1))); }
      g.tube(pts, 0.026, 0.026, MAT.matte, 10, 0.2);
    }
  }
  return g.build();
}

function smoothPath(pts, sub) {
  const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return c.getPoints((pts.length - 1) * (sub || 3));
}

/** Les quatre maillages d'un vélo (repères : vélo ; roues centrées sur leur axe ; pédalier centré sur le boîtier) ; low : un seul
 *  maillage allégé (vélo lointain : roues et pédalier fixes). */
export function buildBike(gear, low) {
  const G = normGear(gear);
  const L = frameLayout(G.frame);
  const W = WHEELS[G.wheels] || WHEELS.c45;
  const wide = G.frame === 'gravel' || G.frame === 'mtb';
  const tire = G.frame === 'mtb' ? 'mtb' : G.frame === 'gravel' && G.tire !== 'mtb' ? 'gravel' : G.tire;
  LOW = !!low;
  try {
    const out = {
      layout: L, gear: G,
      static: bikeStatic(L, G),
      front: wheel(W, tire, true, wide),
      rear: wheel(W, tire, false, wide),
      crank: crankset(L, G),
    };
    if (low) {
      const at = (g, p) => g.translate(p.x, p.y, p.z);
      at(out.front, L.frontAxle); at(out.rear, L.rearAxle); at(out.crank, L.BB);
      out.static = mergeGeometries([out.static, out.front, out.rear, out.crank]);
      out.front = out.rear = out.crank = null;
    }
    return out;
  } finally { LOW = false; }
}

export { R as WHEEL_R };
