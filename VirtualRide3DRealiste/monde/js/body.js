/* Virtual Ride 3D Réaliste — corps du cycliste : une seule surface continue, sans couture, construite à partir d'un champ de distance
   (formes arrondies fondues entre elles : tête, cou, buste, fessiers, bras et jambes galbés), extraite en maillage (« surface nets »)
   dans la pose de référence (sur les cocottes, pédales à l'horizontale), puis rattachée à un squelette de 15 os : chaque sommet suit
   les os voisins avec des poids lissés aux articulations (genoux, hanches, coudes). Casque, lunettes, chaussures et queue de cheval
   sont fabriqués de la même façon et suivent leur os. Chaque sommet porte sa zone (peau, maillot, cuissard, chaussette, chaussure,
   casque, verres, gants, cheveux) : la tenue choisie se lit dans la zone, les couleurs viennent du coureur.
   Repère : celui du vélo de Bike3D (x à droite, y en haut, z vers l'avant ; roue de 0,34 m, boîtier en (0 ; 0,28 ; −0,08)). */
import * as THREE from 'three';

export const BONES = ['pelvis', 'chest', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const B = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const REGION = { SKIN: 0, JERSEY: 1, SHORTS: 2, SOCK: 3, SHOE: 4, HELMET: 5, LENS: 6, GLOVE: 7, HAIR: 8, SOLE: 9, STRAP: 10 };

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------------------------------------------------------------- fonctions de distance */

function sdRoundCone(px, py, pz, a, b, r1, r2) {
  // iq : cône arrondi entre a (rayon r1) et b (rayon r2)
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a.x, pay = py - a.y, paz = pz - a.z;
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// ellipsoïde dans le repère (u, v, w) centré en c, demi-axes r
function sdEllipsoidF(px, py, pz, E) {
  const dx = px - E.c.x, dy = py - E.c.y, dz = pz - E.c.z;
  const x = dx * E.u.x + dy * E.u.y + dz * E.u.z, y = dx * E.v.x + dy * E.v.y + dz * E.v.z, z = dx * E.w.x + dy * E.w.y + dz * E.w.z;
  const k0 = Math.sqrt((x / E.r.x) ** 2 + (y / E.r.y) ** 2 + (z / E.r.z) ** 2);
  const k1 = Math.sqrt((x / (E.r.x * E.r.x)) ** 2 + (y / (E.r.y * E.r.y)) ** 2 + (z / (E.r.z * E.r.z)) ** 2);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(E.r.x, E.r.y, E.r.z);
}

function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

/** Ellipsoïde orientée : centre, axe principal (direction de v), axe latéral approximatif, demi-axes (le long de u, v, w). */
function ell(c, along, lateral, rx, ry, rz) {
  const v = along.clone().normalize();
  const u = lateral.clone().sub(v.clone().multiplyScalar(lateral.dot(v))).normalize();
  const w = new THREE.Vector3().crossVectors(u, v).normalize();
  return { c, u, v, w, r: V(rx, ry, rz) };
}

/* ---------------------------------------------------------------- pose de référence */

/** Articulations du cycliste pour une pose : pelvis, poitrine, base du cou, tête, épaules, coudes, poignets, hanches, genoux, chevilles,
 *  pointes de pied ; P : plan de position {pelvis, shoulder, hands[2], elbows?} ; crank : angle du pédalier ; morph : morphologie. */
export function joints(P, crank, BB, morph, opts = {}) {
  const J = {};
  const pelvis = P.pelvis.clone(), shoulder = P.shoulder.clone();
  J.pelvis = pelvis;
  const tdir = shoulder.clone().sub(pelvis);
  const tlen = tdir.length();
  tdir.normalize();
  // dos rond : le milieu du dos est poussé vers le haut et l'arrière
  const backN = V(0, tdir.z, -tdir.y).multiplyScalar(-1);   // perpendiculaire au buste, vers le dos
  J.chest = pelvis.clone().addScaledVector(tdir, tlen * 0.5).addScaledVector(backN, -0.035 * (opts.round ?? 1));
  J.neck = shoulder.clone().addScaledVector(tdir, 0.04).add(V(0, 0.03, 0.02));
  const back = Math.atan2(tdir.y, tdir.z);
  const ha = back + 0.32 - (opts.headDown || 0) * 0.15;
  J.head = J.neck.clone().add(V(0, Math.sin(ha) * 0.13, Math.cos(ha) * 0.13));
  J.headLook = opts.look || 0;
  const sw = morph.shoulderX;
  for (const [s, i] of [['L', 0], ['R', 1]]) {
    const sx = s === 'L' ? -1 : 1;
    const sh = V(sx * sw, shoulder.y - 0.03, shoulder.z - 0.03);
    const hand = P.hands[i].clone();
    let elbow;
    if (P.elbows) elbow = P.elbows[i].clone();
    else elbow = ik(sh, hand, morph.upperArm, morph.foreArm, V(sx * 0.6, -0.35, -0.7).normalize());
    J['sh' + s] = sh; J['el' + s] = elbow;
    // poignet un peu en retrait de la prise (la main entoure le cintre)
    const fdir = hand.clone().sub(elbow).normalize();
    J['wr' + s] = hand.clone().addScaledVector(fdir, -0.045);
    J['hd' + s] = hand.clone().addScaledVector(fdir, 0.05);
  }
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const sgn = -sx;
    const pedal = V(sx * 0.12, BB.y + sgn * Math.cos(crank) * 0.17, BB.z + sgn * Math.sin(crank) * 0.17);
    const ankle = pedal.clone().add(V(0, 0.075, -0.06));
    const hip = V(sx * morph.hipX + pelvis.x, pelvis.y - 0.03, pelvis.z + 0.02);
    const knee = ik(hip, ankle, morph.thigh, morph.shin, V(sx * 0.1, 0.25, 1).normalize());
    J['hip' + s] = hip; J['kn' + s] = knee; J['an' + s] = ankle;
    J['toe' + s] = pedal.clone().add(V(0, 0.03, 0.1));
    J['pedal' + s] = pedal;
  }
  return J;
}

function ik(a, b, l1, l2, bend) {
  const d = b.clone().sub(a);
  let dist = d.length();
  dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-3, dist));
  d.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const perp = bend.clone().addScaledVector(d, -bend.dot(d)).normalize();
  return a.clone().addScaledVector(d, Math.cos(ang) * l1).addScaledVector(perp, Math.sin(ang) * l1);
}

/** Os : [origine, extrémité, vecteur latéral de référence] dans les articulations J. */
export function boneEnds(J) {
  const lat = V(1, 0, 0);
  return [
    [J.pelvis, J.chest, lat], [J.chest, J.neck, lat], [J.neck, J.head, lat],
    [J.shL, J.elL, lat], [J.elL, J.wrL, lat], [J.wrL, J.hdL, lat],
    [J.shR, J.elR, lat], [J.elR, J.wrR, lat], [J.wrR, J.hdR, lat],
    [J.hipL, J.knL, lat], [J.knL, J.anL, lat], [J.anL, J.toeL, lat],
    [J.hipR, J.knR, lat], [J.knR, J.anR, lat], [J.anR, J.toeR, lat],
  ];
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/** Repère d'un os (matrice monde de l'os) : x le long de l'os, y latéral, z = x × y ; yaw : rotation propre (tête). */
export function boneFrame(a, b, lat, out, yaw) {
  _x.copy(b).sub(a).normalize();
  _y.copy(lat).addScaledVector(_x, -lat.dot(_x));
  if (_y.lengthSq() < 1e-8) _y.set(0, 1, 0).addScaledVector(_x, -_x.y);
  _y.normalize();
  _z.crossVectors(_x, _y);
  out.makeBasis(_x, _y, _z);
  if (yaw) out.multiply(_m.makeRotationX(yaw));
  out.setPosition(a);
  return out;
}

/* ---------------------------------------------------------------- morphologie et champ du corps */

export function morphology(sex) {
  const f = sex === 'f';
  return {
    f, shoulderX: f ? 0.168 : 0.19, hipX: f ? 0.1 : 0.092, upperArm: f ? 0.285 : 0.3, foreArm: f ? 0.27 : 0.285, thigh: f ? 0.44 : 0.46, shin: f ? 0.43 : 0.45,
    chestW: f ? 0.155 : 0.175, chestD: f ? 0.105 : 0.115, waistW: f ? 0.12 : 0.135, hipW: f ? 0.165 : 0.15, glute: f ? 0.098 : 0.088,
    armR: f ? 0.036 : 0.042, thighR: f ? 0.078 : 0.082, calfR: f ? 0.052 : 0.056, headS: f ? 0.95 : 1,
  };
}

/** Primitives du corps dans la pose J : [{d(x, y, z) → distance, bone, part, a, b (axe, pour le paramètre le long du membre)}]. */
function bodyPrims(J, M) {
  const P = [];
  const add = (bone, part, d, a, b, k) => P.push({ bone, part, d, a: a || null, b: b || null, k: k || 0.04 });
  const cone = (bone, part, a, b, r1, r2, k) => add(bone, part, (x, y, z) => sdRoundCone(x, y, z, a, b, r1, r2), a, b, k);
  const el = (bone, part, E, k, a, b) => add(bone, part, (x, y, z) => sdEllipsoidF(x, y, z, E), a, b, k);
  const lat = V(1, 0, 0);
  const tdir = J.neck.clone().sub(J.pelvis).normalize();
  const hs = M.headS;
  // tête : crâne, mâchoire, nez, oreilles
  const hdir = J.head.clone().sub(J.neck).normalize();
  const fwd = V(0, -hdir.z, hdir.y).multiplyScalar(-1).normalize();   // vers le visage
  const fz = V(0, 0, 1).lerp(fwd, 0.5).normalize();
  el(B.head, 'head', ell(J.head.clone(), V(0, 1, 0.25), lat, 0.074 * hs, 0.1 * hs, 0.092 * hs), 0.03);
  el(B.head, 'head', ell(J.head.clone().add(V(0, -0.055, 0.035).multiplyScalar(hs)), V(0, 1, 0.5), lat, 0.055 * hs, 0.05 * hs, 0.06 * hs), 0.04);
  cone(B.head, 'nose', J.head.clone().add(V(0, -0.005, 0.085).multiplyScalar(hs)), J.head.clone().add(V(0, -0.035, 0.105).multiplyScalar(hs)), 0.008, 0.012, 0.015);
  for (const sx of [-1, 1]) el(B.head, 'head', ell(J.head.clone().add(V(sx * 0.074, -0.005, -0.005).multiplyScalar(hs)), V(0, 1, 0), lat, 0.012, 0.03, 0.02), 0.012);
  // cou
  cone(B.head, 'neck', J.neck.clone().addScaledVector(tdir, -0.04), J.head.clone().add(V(0, -0.04, -0.02)), 0.058, 0.05, 0.05);
  // buste : cage thoracique, épaules arrondies, ventre, bassin et fessiers posés sur la selle
  const side = (s) => V(s, 0, 0);
  el(B.chest, 'chest', ell(J.chest.clone().addScaledVector(tdir, 0.09), tdir, lat, M.chestW, 0.16, M.chestD), 0.08, J.pelvis, J.neck);
  if (M.f) for (const sx of [-1, 1]) el(B.chest, 'chest', ell(J.chest.clone().addScaledVector(tdir, 0.07).add(V(sx * 0.07, 0, 0)).add(V(0, -tdir.z, tdir.y).multiplyScalar(-0.085)), tdir, lat, 0.055, 0.05, 0.05), 0.04, J.pelvis, J.neck);
  el(B.pelvis, 'belly', ell(J.pelvis.clone().addScaledVector(tdir, 0.17), tdir, lat, M.waistW, 0.14, 0.1), 0.08, J.pelvis, J.neck);
  el(B.pelvis, 'hips', ell(J.pelvis.clone().addScaledVector(tdir, 0.04).add(V(0, 0, 0.0)), tdir, lat, M.hipW, 0.1, 0.11), 0.07, J.pelvis, J.neck);
  for (const sx of [-1, 1]) {
    el(B.pelvis, 'glute', ell(J.pelvis.clone().add(V(sx * 0.07, -0.02, -0.06)), V(0, 1, 0.3), lat, M.glute * 0.9, M.glute, M.glute * 0.95), 0.05);
    // trapèze et deltoïde
    el(B.chest, 'trap', ell(J.neck.clone().add(V(sx * 0.075, -0.045, -0.035)), V(sx, -0.35, 0), V(0, 1, 0), 0.032, 0.075, 0.042), 0.05, J.pelvis, J.neck);
  }
  // bras
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const ua = s === 'L' ? B.uarmL : B.uarmR, fa = s === 'L' ? B.farmL : B.farmR, hb = s === 'L' ? B.handL : B.handR;
    const sh = J['sh' + s], elb = J['el' + s], wr = J['wr' + s], hd = J['hd' + s];
    el(ua, 'delt', ell(sh.clone().add(V(sx * 0.008, -0.005, 0)).lerp(elb, 0.12), elb.clone().sub(sh), lat, 0.046, 0.075, 0.046), 0.05, sh, elb);
    cone(ua, 'uarm', sh, elb, M.armR, M.armR * 0.78, 0.05);
    el(ua, 'bicep', ell(sh.clone().lerp(elb, 0.55), elb.clone().sub(sh), lat, M.armR * 0.95, 0.09, M.armR * 1.0), 0.03, sh, elb);
    cone(fa, 'farm', elb, wr, M.armR * 0.82, M.armR * 0.58, 0.035);
    el(fa, 'farmM', ell(elb.clone().lerp(wr, 0.3), wr.clone().sub(elb), lat, M.armR * 0.85, 0.08, M.armR * 0.8), 0.03, elb, wr);
    // main fermée sur le cintre
    el(hb, 'hand', ell(wr.clone().lerp(hd, 0.55), hd.clone().sub(wr), lat, 0.03, 0.055, 0.038), 0.02, wr, hd);
    cone(hb, 'hand', wr.clone().lerp(hd, 0.4), hd.clone().add(V(0, -0.025, 0)), 0.022, 0.018, 0.02, wr, hd);
  }
  // jambes : cuisse (quadriceps, vaste interne), genou, mollet, cheville
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const th = s === 'L' ? B.thighL : B.thighR, sn = s === 'L' ? B.shinL : B.shinR, ft = s === 'L' ? B.footL : B.footR;
    const hip = J['hip' + s], kn = J['kn' + s], an = J['an' + s], toe = J['toe' + s];
    const tdirL = kn.clone().sub(hip).normalize();
    const kneeFront = V(0, tdirL.z, -tdirL.y).multiplyScalar(-1);   // côté du genou qui pointe vers l'avant
    cone(th, 'thigh', hip, kn, M.thighR, M.thighR * 0.62, 0.05);
    el(th, 'quad', ell(hip.clone().lerp(kn, 0.5).addScaledVector(kneeFront, 0.022), tdirL, lat, M.thighR * 0.92, 0.2, M.thighR * 0.85), 0.04, hip, kn);
    el(th, 'vast', ell(hip.clone().lerp(kn, 0.82).addScaledVector(kneeFront, 0.012).add(V(-sx * 0.025, 0, 0)), tdirL, lat, 0.04, 0.06, 0.04), 0.03, hip, kn);
    const sdir = an.clone().sub(kn).normalize();
    const calfBack = V(0, -sdir.z, sdir.y);
    cone(sn, 'shin', kn, an, M.calfR * 0.85, M.calfR * 0.48, 0.03);
    el(sn, 'calf', ell(kn.clone().lerp(an, 0.32).addScaledVector(calfBack, 0.022), sdir, lat, M.calfR * 0.95, 0.11, M.calfR * 0.95), 0.035, kn, an);
    el(sn, 'knee', ell(kn.clone().addScaledVector(kneeFront, 0.01), sdir, lat, 0.045, 0.05, 0.045), 0.03, kn, an);
    // pied (caché par la chaussure)
    cone(ft, 'foot', an.clone().add(V(0, -0.02, -0.02)), toe.clone().add(V(0, -0.005, -0.02)), 0.032, 0.025, 0.02, an, toe);
  }
  return P;
}

/* ---------------------------------------------------------------- extraction du maillage (surface nets) */

function surfaceNets(sdf, box, h) {
  const nx = Math.ceil((box.max.x - box.min.x) / h) + 1, ny = Math.ceil((box.max.y - box.min.y) / h) + 1, nz = Math.ceil((box.max.z - box.min.z) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const ox = box.min.x, oy = box.min.y, oz = box.min.z;
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // bande étroite : une grille 4 fois plus grossière d'abord ; le champ exact n'est calculé que près de la surface
  const S = 4, cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1, H = h * S;
  const G = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) G[(k * cy + j) * cx + i] = sdf(ox + i * H, oy + j * H, oz + k * H);
  const band = H * 1.9;
  for (let k = 0; k < nz; k++) {
    const fk = k / S, k0 = Math.min(cz - 2, Math.floor(fk)), tk = fk - k0;
    for (let j = 0; j < ny; j++) {
      const fj = j / S, j0 = Math.min(cy - 2, Math.floor(fj)), tj = fj - j0;
      for (let i = 0; i < nx; i++) {
        const fi = i / S, i0 = Math.min(cx - 2, Math.floor(fi)), ti = fi - i0;
        const g = (a, b, c) => G[((k0 + c) * cy + (j0 + b)) * cx + (i0 + a)];
        const v = (((g(0, 0, 0) * (1 - ti) + g(1, 0, 0) * ti) * (1 - tj) + (g(0, 1, 0) * (1 - ti) + g(1, 1, 0) * ti) * tj) * (1 - tk)
          + ((g(0, 0, 1) * (1 - ti) + g(1, 0, 1) * ti) * (1 - tj) + (g(0, 1, 1) * (1 - ti) + g(1, 1, 1) * ti) * tj) * tk);
        F[idx(i, j, k)] = Math.abs(v) < band ? sdf(ox + i * h, oy + j * h, oz + k * h) : v;
      }
    }
  }
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[idx(i + C[c][0], j + C[c][1], k + C[c][2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
    }
    vid[cidx(i, j, k)] = pos.length / 3;
    pos.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
  }
  const ind = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) ind.push(a, c, b, a, d, c); else ind.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = F[idx(i, j, k)], b = F[idx(i + 1, j, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(vid[cidx(i, j - 1, k - 1)], vid[cidx(i, j, k - 1)], vid[cidx(i, j, k)], vid[cidx(i, j - 1, k)], a < 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[idx(i, j, k)], b = F[idx(i, j + 1, k)];
    if ((a < 0) === (b < 0)) continue;
    quad(vid[cidx(i - 1, j, k - 1)], vid[cidx(i - 1, j, k)], vid[cidx(i, j, k)], vid[cidx(i, j, k - 1)], a < 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const a = F[idx(i, j, k)], b = F[idx(i, j, k + 1)];
    if ((a < 0) === (b < 0)) continue;
    quad(vid[cidx(i - 1, j - 1, k)], vid[cidx(i, j - 1, k)], vid[cidx(i, j, k)], vid[cidx(i - 1, j, k)], a < 0);
  }
  return { pos: new Float32Array(pos), index: ind };
}

/* ---------------------------------------------------------------- accessoires (casque, lunettes, chaussures, cheveux) */

function accessoryPrims(J, M, gear) {
  const P = [];
  const lat = V(1, 0, 0);
  const hs = M.headS;
  const H = J.head;
  const helmet = gear.helmet || 'road';
  // casque : coque (ellipsoïde creuse) coupée au-dessus des oreilles, aérations, ou goutte d'eau du chrono
  const shell = (x, y, z) => {
    const E = ell(H.clone().add(V(0, 0.02, -0.005).multiplyScalar(hs)), V(0, 1, 0.15), lat, 0.098 * hs, 0.11 * hs, 0.135 * hs);
    let d = sdEllipsoidF(x, y, z, E);
    d = Math.max(d, -(d + 0.018));                     // coque de 18 mm
    d = Math.max(d, (H.y - 0.005 * hs) - y + 0.25 * (z - H.z) * 0);          // coupé sous la ligne des tempes
    if (helmet === 'road' || helmet === 'city') {
      // aérations : fentes longitudinales
      const lx = x - H.x;
      for (const cx of [-0.05, -0.017, 0.017, 0.05]) {
        const vz = Math.abs(z - H.z - 0.01) - 0.06, vx = Math.abs(lx - cx) - 0.008;
        d = Math.max(d, -(Math.max(vz, vx, H.y + 0.06 - y)));
      }
    }
    return d;
  };
  if (helmet === 'none') {
    // tête nue (le public) : cheveux courts, calotte au-dessus du front et derrière la tête
    P.push({ bone: B.head, region: REGION.HAIR, d: (x, y, z) => {
      const E = ell(H.clone().add(V(0, 0.012, -0.012)), V(0, 1, 0.1), lat, 0.08 * hs, 0.106 * hs, 0.1 * hs);
      let d = sdEllipsoidF(x, y, z, E); d = Math.max(d, -(d + 0.012));
      return Math.max(d, (H.y + 0.02 - Math.max(0, H.z - z) * 0.9) - y);
    } });
  } else if (helmet === 'tt') {
    P.push({ bone: B.head, region: REGION.HELMET, d: (x, y, z) => {
      // casque chrono : coque qui s'étire en pointe vers l'arrière, le long du dos
      const a = H.clone().add(V(0, 0.025, 0.015)), b = H.clone().add(V(0, -0.035, -0.26));
      return Math.max(sdRoundCone(x, y, z, a, b, 0.112 * hs, 0.016), H.y - 0.04 - y + Math.max(0, z - H.z) * 0.6 - Math.max(0, H.z - z) * 0.35);
    } });
    // visière
    P.push({ bone: B.head, region: REGION.LENS, d: (x, y, z) => {
      const E = ell(H.clone().add(V(0, 0.0, 0.035)), V(0, 1, 0.2), lat, 0.105, 0.075, 0.1);
      let d = sdEllipsoidF(x, y, z, E); d = Math.max(d, -(d + 0.004));
      return Math.max(d, z - H.z - 0.115 < 0 ? H.z + 0.06 - z : -1, y - (H.y + 0.035), (H.y - 0.06) - y);
    } });
  } else {
    P.push({ bone: B.head, region: REGION.HELMET, d: shell });
    if (helmet === 'aero') P.push({ bone: B.head, region: REGION.HELMET, d: (x, y, z) => sdRoundCone(x, y, z, H.clone().add(V(0, 0.07, -0.03)), H.clone().add(V(0, 0.05, -0.16)), 0.06, 0.03) });
    // jugulaire
    for (const sx of [-1, 1]) P.push({ bone: B.head, region: REGION.STRAP, d: (x, y, z) => sdRoundCone(x, y, z, H.clone().add(V(sx * 0.072, 0.0, 0.0)), H.clone().add(V(sx * 0.03, -0.1, 0.05)), 0.0045, 0.0045) });
  }
  // lunettes : écran courbe devant les yeux
  if ((gear.glasses || 'sport') !== 'none' && helmet !== 'tt' && helmet !== 'none') {
    const big = gear.glasses === 'shield';
    P.push({ bone: B.head, region: REGION.LENS, d: (x, y, z) => {
      const E = ell(H.clone().add(V(0, 0.01, 0.008)), V(0, 1, 0.1), lat, 0.083, 0.08, 0.098);
      let d = sdEllipsoidF(x, y, z, E); d = Math.max(d, -(d + 0.003));
      const top = H.y + (big ? 0.035 : 0.025), bot = H.y - (big ? 0.025 : 0.015);
      return Math.max(d, y - top, bot - y, (H.z + 0.04) - z);
    } });
  }
  // chaussures : tige arrondie, semelle rigide, pointe effilée
  for (const [s, ft] of [['L', B.footL], ['R', B.footR]]) {
    const an = J['an' + s], toe = J['toe' + s];
    const dir = toe.clone().sub(an).normalize();
    const heel = an.clone().addScaledVector(dir, -0.055).add(V(0, -0.03, 0));
    const tip = toe.clone().addScaledVector(dir, 0.04).add(V(0, -0.012, 0));
    P.push({ bone: ft, region: REGION.SHOE, d: (x, y, z) => smin(sdRoundCone(x, y, z, heel, tip, 0.043, 0.03), sdRoundCone(x, y, z, an.clone().add(V(0, 0.01, -0.01)), an.clone().addScaledVector(dir, 0.08), 0.042, 0.036), 0.03) });
    P.push({ bone: ft, region: REGION.SOLE, d: (x, y, z) => {
      const d = sdRoundCone(x, y, z, heel.clone().add(V(0, -0.028, 0)), tip.clone().add(V(0, -0.02, 0)), 0.03, 0.022);
      return Math.max(d, y - (heel.y - 0.025 + (z - heel.z) * (tip.y - heel.y + 0.008) / Math.max(1e-3, tip.z - heel.z)));
    } });
  }
  // cheveux : queue de cheval sous le casque
  if (M.f) P.push({ bone: B.head, region: REGION.HAIR, d: (x, y, z) => sdRoundCone(x, y, z, H.clone().add(V(0, -0.02, -0.1)), H.clone().add(V(0, -0.17, -0.16)), 0.03, 0.018) });
  return P;
}

/* ---------------------------------------------------------------- assemblage */

/** Zone du corps d'un sommet selon la tenue (manches, cuissard, chaussettes, gants). */
function regionOf(part, t, gear) {
  const cl = gear.clothing || 'fitted';
  const longSleeve = cl === 'skinsuit_tt';
  const sleeve = cl === 'loose' ? 0.65 : cl === 'aero' || cl === 'skinsuit' ? 0.85 : 0.55;
  const socks = { short: 0.12, classic: 0.3, aero: 0.42 }[gear.socks || 'classic'] ?? 0.3;
  switch (part) {
    case 'head': case 'nose': case 'neck': return REGION.SKIN;
    case 'chest': case 'belly': case 'trap': return REGION.JERSEY;
    case 'hips': case 'glute': return cl === 'skinsuit' || cl === 'skinsuit_tt' ? REGION.JERSEY : t > 0.55 ? REGION.JERSEY : REGION.SHORTS;
    case 'delt': return REGION.JERSEY;
    case 'uarm': case 'bicep': return longSleeve || t < sleeve ? REGION.JERSEY : REGION.SKIN;
    case 'farm': case 'farmM': return longSleeve && t < 0.92 ? REGION.JERSEY : REGION.SKIN;
    case 'hand': return t < 0.55 ? REGION.GLOVE : REGION.SKIN;
    case 'thigh': case 'quad': case 'vast': return t < 0.84 ? REGION.SHORTS : REGION.SKIN;
    case 'knee': return REGION.SKIN;
    case 'shin': case 'calf': return t > 1 - socks ? REGION.SOCK : REGION.SKIN;
    case 'foot': return REGION.SOCK;
    default: return REGION.SKIN;
  }
}

/**
 * Corps + accessoires dans la pose de référence : BufferGeometry avec position, normal, skinIndex (4 os), skinWeight, aRegW (poids
 * des zones de la tenue), aRef (position de référence, pour les motifs du maillot, et zone en w).
 * h : pas de la grille (m) ; 0,011 pour le modèle de près, 0,028 pour le modèle lointain.
 */
export function buildBody(J, gear, h) {
  const M = morphology(gear.sex);
  const prims = bodyPrims(J, M);
  const acc = accessoryPrims(J, M, gear);
  const bodySdf = (x, y, z) => {
    let d = 1e9;
    for (const p of prims) { const v = p.d(x, y, z); d = d > 1 ? v : smin(d, v, p.k); }
    return d;
  };
  const box = new THREE.Box3(V(-0.42, 0.18, -0.55), V(0.42, 1.9, 0.75));
  const parts = [];
  const meshOf = (sdf, regionFixed, boneFixed) => {
    const { pos, index } = surfaceNets(sdf, box, h);
    return { pos, index, regionFixed, boneFixed, sdf };
  };
  parts.push(Object.assign(meshOf(bodySdf), { body: true }));
  for (const a of acc) {
    const thin = a.region === REGION.LENS || a.region === REGION.STRAP;
    if (thin && h > 0.02) continue;                  // au loin, ni verres ni jugulaire
    const ah = thin ? Math.max(0.0035, h * 0.35) : Math.min(0.02, Math.max(0.006, h * 0.65));
    // boîte serrée autour de l'accessoire : on la cherche sur une grille grossière
    const bb = tightBox(a.d, box, 0.02);
    if (!bb) continue;
    const { pos, index } = surfaceNets(a.d, bb, ah);
    parts.push({ pos, index, regionFixed: a.region, boneFixed: a.bone, sdf: a.d });
  }
  // fusion, normales par le gradient du champ, os et poids
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.pos.length / 3; ni += p.index.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), reg = new Float32Array(nv), regW = new Float32Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  const e = h * 0.5;
  for (const p of parts) {
    const n = p.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2], o = (vo + i) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      const f = p.sdf;
      let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
      const l = Math.hypot(gx, gy, gz) || 1;
      nor[o] = gx / l; nor[o + 1] = gy / l; nor[o + 2] = gz / l;
      const q = (vo + i) * 4;
      if (p.body) {
        // influence de chaque primitive : décroissance exponentielle de sa distance ; regroupée par os
        const wb = new Float32Array(BONES.length);
        let best = null, bestD = 1e9;
        for (const pr of prims) {
          const d = pr.d(x, y, z);
          if (d < bestD) { bestD = d; best = pr; }
          wb[pr.bone] += Math.exp(-Math.max(0, d) / 0.018) * (d < 0.06 ? 1 : 0);
        }
        const order = [...wb.keys()].sort((a, b) => wb[b] - wb[a]).slice(0, 4);
        let s = 0;
        for (const b of order) s += wb[b];
        order.forEach((b, k) => { si[q + k] = b; sw[q + k] = s > 0 ? wb[b] / s : k === 0 ? 1 : 0; });
        let t = 0;
        if (best.a && best.b) {
          const ax = best.b.x - best.a.x, ay = best.b.y - best.a.y, az = best.b.z - best.a.z;
          t = ((x - best.a.x) * ax + (y - best.a.y) * ay + (z - best.a.z) * az) / (ax * ax + ay * ay + az * az);
          t = Math.max(0, Math.min(1, t));
        }
        const rg = regionOf(best.part, t, gear);
        reg[vo + i] = rg;
        const slot = rg === REGION.JERSEY ? 0 : rg === REGION.SHORTS ? 1 : rg === REGION.SKIN ? 2 : rg === REGION.SOCK ? 3 : -1;
        if (slot >= 0) regW[(vo + i) * 4 + slot] = 1;
      } else {
        si[q] = p.boneFixed; sw[q] = 1;
        reg[vo + i] = p.regionFixed;
      }
    }
    // chaque triangle tourne sa face vers l'extérieur (la normale du champ)
    for (let k = 0; k < p.index.length; k += 3) {
      let a = p.index[k], b = p.index[k + 1], c = p.index[k + 2];
      const P = p.pos, oa = (vo + a) * 3;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      if (fx * nor[oa] + fy * nor[oa + 1] + fz * nor[oa + 2] < 0) { const t = b; b = c; c = t; }
      index[io + k] = a + vo; index[io + k + 1] = b + vo; index[io + k + 2] = c + vo;
    }
    vo += n; io += p.index.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  // position de référence (motifs du maillot) et zone (w) dans un seul attribut : on reste sous les 16 attributs du WebGL
  const ref = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) { ref[i * 4] = pos[i * 3]; ref[i * 4 + 1] = pos[i * 3 + 1]; ref[i * 4 + 2] = pos[i * 3 + 2]; ref[i * 4 + 3] = reg[i]; }
  g.setAttribute('aRegW', new THREE.BufferAttribute(regW, 4));
  g.setAttribute('aRef', new THREE.BufferAttribute(ref, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

function tightBox(f, box, h) {
  const bb = new THREE.Box3();
  let any = false;
  for (let x = box.min.x; x <= box.max.x; x += h) for (let y = box.min.y; y <= box.max.y; y += h) for (let z = box.min.z; z <= box.max.z; z += h) {
    if (f(x, y, z) < h) { bb.expandByPoint(V(x, y, z)); any = true; }
  }
  if (!any) return null;
  bb.expandByScalar(h * 1.5);
  return bb;
}

/** Inverse des repères de référence des os (pour la texture des os). */
export function restInverse(J) {
  const ends = boneEnds(J);
  return ends.map(([a, b, lat]) => boneFrame(a, b, lat, new THREE.Matrix4()).invert());
}
