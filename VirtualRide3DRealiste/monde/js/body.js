/* Virtual Ride 3D Réaliste — corps du cycliste : une seule surface continue, sans couture, construite à partir d'un champ de distance,
   extraite en maillage (« surface nets ») dans la pose de référence (sur les cocottes, pédales à l'horizontale), puis rattachée à un
   squelette de 15 os.
   Les proportions et la posture sont celles d'un coureur professionnel (photos et images de course ; angles articulaires de la
   littérature) : hanches 9 cm au-dessus de la selle (genou fléchi de 30 à 40° en bas du coup de pédale, de 105 à 110° en haut), buste
   à 35-40° sur les cocottes, dos rond d'un seul arc, épaules avancées, coudes fléchis, cou relevé, cheville qui travaille (la pointe
   du pied plus basse que le talon, davantage en remontant).
   Le buste est une seule forme, du bassin posé sur la selle à la base du cou : des sections (largeur, ventre, dos) qui varient le
   long de la colonne, donc ni bosse ni raccord dans le dos ; les fessiers, les trapèzes et les pectoraux s'y fondent. Les bras et les
   jambes (deltoïde, biceps, triceps, quadriceps, ischio-jambiers, vastes, rotule, mollet, malléoles) ne se fondent dans le buste
   qu'autour de l'épaule et de la hanche : pas de palmure entre le bras et le buste, entre les cuisses.
   Chaque sommet suit les os voisins : il reçoit d'abord l'os de sa partie du corps, puis ces poids sont lissés le long de la surface
   (plus largement autour des hanches et du milieu du dos) ; au pédalage, le bas des fessiers suit la cuisse sans cassure.
   Casque, lunettes, chaussures et queue de cheval sont fabriqués de la même façon et suivent leur os. Chaque sommet porte sa zone
   (peau, maillot, cuissard, chaussette, chaussure, casque, verres, gants, cheveux) et la distance au bord de la tenue : les ourlets
   (manches, cuissard, chaussettes, col, gants) sont des lignes nettes.
   Repère : celui du vélo de Bike3D (y en haut, z vers l'avant, x vers la gauche du coureur ; roue de 0,34 m, boîtier en
   (0 ; 0,28 ; −0,08)). */
import * as THREE from 'three';
import { CRANK, FOOT, footPitch } from './bike.js';

export const BONES = ['pelvis', 'chest', 'head', 'uarmL', 'farmL', 'handL', 'uarmR', 'farmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const B = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const REGION = { SKIN: 0, JERSEY: 1, SHORTS: 2, SOCK: 3, SHOE: 4, HELMET: 5, LENS: 6, GLOVE: 7, HAIR: 8, SOLE: 9, STRAP: 10 };

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NB = BONES.length;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

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

/** Ellipsoïde orientée : centre, axe principal (direction de v), axe latéral approximatif (u), demi-axes le long de u, v, w = u × v. */
function ell(c, along, lateral, rx, ry, rz) {
  const v = along.clone().normalize();
  const u = lateral.clone().sub(v.clone().multiplyScalar(lateral.dot(v))).normalize();
  const w = new THREE.Vector3().crossVectors(u, v).normalize();
  return { c, u, v, w, r: V(rx, ry, rz) };
}

/** Profil lisse passant par des points [t, valeur] (Hermite cubique, pentes de Catmull-Rom), échantillonné : f(t), t de 0 à 1. */
function profile(pts) {
  const n = pts.length - 1, N = 96, tab = new Float32Array(N + 1);
  const slope = (k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n, k + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); };
  for (let q = 0; q <= N; q++) {
    const t = q / N;
    let v;
    if (t <= pts[0][0]) v = pts[0][1];
    else if (t >= pts[n][0]) v = pts[n][1];
    else {
      let i = 0;
      while (t > pts[i + 1][0]) i++;
      const h = pts[i + 1][0] - pts[i][0], u = (t - pts[i][0]) / h, u2 = u * u, u3 = u2 * u;
      v = (2 * u3 - 3 * u2 + 1) * pts[i][1] + (u3 - 2 * u2 + u) * slope(i) * h + (-2 * u3 + 3 * u2) * pts[i + 1][1] + (u3 - u2) * slope(i + 1) * h;
    }
    tab[q] = v;
  }
  return (t) => { const f = clamp(t, 0, 1) * N, i = Math.min(N - 1, f | 0); return tab[i] + (tab[i + 1] - tab[i]) * (f - i); };
}

/* ---------------------------------------------------------------- pose */

/** Articulations du cycliste pour une pose : pelvis (le milieu des hanches), poitrine (milieu du dos), base du cou, tête, épaules,
 *  coudes, poignets, mains, hanches, genoux, chevilles, pointes de pied.
 *  P : plan de position {pelvis, shoulder (le milieu des épaules), hands[2], elbows?} ; crank : angle du pédalier ; morph :
 *  morphologie ; opts : {look (la tête tourne), roll (bascule du bassin, rad : la hanche de la jambe qui pousse descend), stand
 *  (0 à 1, en danseuse : talon plus haut), round (dos plus ou moins rond)}. */
export function joints(P, crank, BB, morph, opts = {}) {
  const J = {};
  const pelvis = P.pelvis.clone(), shoulder = P.shoulder.clone();
  J.pelvis = pelvis;
  const tdir = shoulder.clone().sub(pelvis);
  const tlen = tdir.length();
  tdir.normalize();
  const dorsal = V(0, tdir.z, -tdir.y).normalize();   // perpendiculaire au buste, vers le dos
  // dos rond : le milieu du dos est poussé vers le dos (le bas du dos plus relevé que le haut)
  J.chest = pelvis.clone().addScaledVector(tdir, tlen * 0.5).addScaledVector(dorsal, 0.04 * (opts.round ?? 1));
  J.neck = shoulder.clone().addScaledVector(tdir, 0.05).addScaledVector(dorsal, 0.018);
  // cou relevé : le coureur regarde la route (plus le buste est couché, plus le cou se redresse par rapport à lui)
  const back = Math.atan2(tdir.y, tdir.z);
  const ha = Math.min(1.5, 0.745 + 0.62 * back) - (opts.headDown || 0) * 0.15;
  const nl = morph.neck || 0.15;
  J.head = J.neck.clone().add(V(0, Math.sin(ha) * nl, Math.cos(ha) * nl));
  J.headLook = opts.look || 0;
  J.headPitch = 0.2;                                   // visage un peu penché vers la route
  const roll = opts.roll || 0;
  J.latP = roll ? V(1, -roll, 0).normalize() : null;
  for (const [s, i] of [['L', 0], ['R', 1]]) {
    const sx = s === 'L' ? -1 : 1;
    const sh = V(shoulder.x + sx * morph.shoulderX, shoulder.y, shoulder.z);
    const hand = P.hands[i].clone();
    let elbow;
    if (P.elbows) elbow = P.elbows[i].clone();
    else elbow = ik(sh, hand, morph.upperArm, morph.foreArm, V(sx * 0.55, -0.45, -0.7).normalize());
    J['sh' + s] = sh; J['el' + s] = elbow;
    // poignet en retrait de la prise (la paume entoure le cintre)
    const fdir = hand.clone().sub(elbow).normalize();
    J['wr' + s] = hand.clone().addScaledVector(fdir, -0.07);
    J['hd' + s] = hand.clone().addScaledVector(fdir, 0.03);
  }
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const sgn = -sx;
    const pedal = V(sx * 0.12, BB.y + sgn * Math.cos(crank) * CRANK, BB.z + sgn * Math.sin(crank) * CRANK);
    // pied : la plante sur l'axe de la pédale ; il bascule autour de cet axe au fil du tour (phase depuis le point mort haut)
    const pitch = footPitch(crank + (sgn > 0 ? 0 : Math.PI), opts.stand || 0), c = Math.cos(pitch), sn = Math.sin(pitch);
    const ankle = pedal.clone().add(V(0, FOOT.up * c + FOOT.back * sn, -FOOT.back * c + FOOT.up * sn));
    const hip = V(pelvis.x + sx * morph.hipX, pelvis.y - sx * morph.hipX * roll, pelvis.z);
    const knee = ik(hip, ankle, morph.thigh, morph.shin, V(sx * 0.05, 0.25, 1).normalize());
    J['hip' + s] = hip; J['kn' + s] = knee; J['an' + s] = ankle;
    // l'os du pied est parallèle à la semelle
    J['toe' + s] = pedal.clone().add(V(0, FOOT.up * c - FOOT.fwd * sn, FOOT.fwd * c + FOOT.up * sn));
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

const LAT = V(1, 0, 0);
/** Os : [origine, extrémité, vecteur latéral de référence] dans les articulations J. */
export function boneEnds(J) {
  const lat = LAT;
  return [
    [J.pelvis, J.chest, J.latP || lat], [J.chest, J.neck, lat], [J.neck, J.head, lat],
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

/* ---------------------------------------------------------------- morphologie */

/** Morphologie (m) d'un coureur de 1,80 m ou d'une coureuse de 1,74 m, affûtés : squelette (demi-largeur des épaules et des hanches,
 *  buste des hanches aux épaules, cou, bras jusqu'à la prise de la main, cuisse, jambe) et volumes (rayons, demi-largeurs). */
export function morphology(sex) {
  const f = sex === 'f';
  return {
    f, shoulderX: f ? 0.16 : 0.178, hipX: f ? 0.09 : 0.088, torso: f ? 0.49 : 0.52, neck: f ? 0.142 : 0.15, pelvisLen: f ? 0.088 : 0.09,
    upperArm: f ? 0.292 : 0.31, foreArm: f ? 0.31 : 0.33, thigh: f ? 0.428 : 0.435, shin: f ? 0.425 : 0.435,
    chestW: f ? 0.14 : 0.158, chestD: f ? 0.098 : 0.106, waistW: f ? 0.116 : 0.131, hipW: f ? 0.158 : 0.152, glute: f ? 0.08 : 0.075,
    armR: f ? 0.036 : 0.042, thighR: f ? 0.083 : 0.084, calfR: f ? 0.051 : 0.055, neckR: f ? 0.048 : 0.056, headS: f ? 0.94 : 1,
  };
}

/* ---------------------------------------------------------------- buste : une forme le long de la colonne */

/** Buste, du plancher du bassin (sur la selle, derrière et sous les hanches) à la base du cou : un arc (le dos rond) qui passe par le
 *  milieu du dos, et des sections en ellipse (demi-largeur, ventre, dos) qui varient le long de l'arc.
 *  d(x, y, z) : distance approchée ; coord(x, y, z, o) : o.s (m le long de l'arc), o.lx (latéral), o.ld (+ vers le dos). */
function makeTrunk(J, M) {
  const t0 = J.chest.clone().sub(J.pelvis).normalize();
  const P0 = J.pelvis.clone().addScaledVector(t0, -M.pelvisLen), P2 = J.neck, Q = J.chest;
  const l0 = Q.distanceTo(P0), l1 = P2.distanceTo(Q), uc = l0 / (l0 + l1), L = l0 + l1;
  // arc de Bézier qui passe par le milieu du dos en uc : C(u) = P0 + 2 u A + u² Bq
  const P1 = Q.clone().addScaledVector(P0, -(1 - uc) * (1 - uc)).addScaledVector(P2, -uc * uc).multiplyScalar(1 / (2 * uc * (1 - uc)));
  const ax = P1.x - P0.x, ay = P1.y - P0.y, az = P1.z - P0.z;
  const bx = P0.x - 2 * P1.x + P2.x, by = P0.y - 2 * P1.y + P2.y, bz = P0.z - 2 * P1.z + P2.z;
  const cx = P2.x - P0.x, cy = P2.y - P0.y, cz = P2.z - P0.z, cc = cx * cx + cy * cy + cz * cz;
  // repères le long de l'arc : hanches en fH, puis part k du trajet des hanches au cou
  const fH = M.pelvisLen / L, f = (k) => fH + (1 - fH) * k;
  const W = profile([[0, 0.098], [fH * 0.5, 0.14], [fH, M.hipW], [f(0.14), M.hipW - 0.008], [f(0.33), M.waistW], [f(0.55), (M.waistW + M.chestW) / 2 + 0.004],
    [f(0.74), M.chestW + 0.004], [f(0.87), M.chestW + 0.008], [f(0.95), M.chestW - 0.006], [1, 0.1]]);
  const DV = profile([[0, 0.05], [fH, 0.082], [f(0.14), 0.088], [f(0.33), 0.09], [f(0.55), 0.096], [f(0.74), M.chestD], [f(0.87), M.chestD - 0.012], [f(0.95), 0.075], [1, 0.06]]);
  const DD = profile([[0, 0.066], [fH, 0.09], [f(0.14), 0.087], [f(0.33), 0.085], [f(0.55), 0.093], [f(0.74), 0.101], [f(0.87), 0.099], [f(0.95), 0.086], [1, 0.068]]);
  const capA = 0.05, capB = 0.045;
  const o = { s: 0, lx: 0, ld: 0, la: 0, u: 0 };
  function coord(x, y, z, out) {
    let u = clamp(((x - P0.x) * cx + (y - P0.y) * cy + (z - P0.z) * cz) / cc, 0, 1);
    for (let k = 0; k < 3; k++) {
      const px = P0.x + 2 * u * ax + u * u * bx - x, py = P0.y + 2 * u * ay + u * u * by - y, pz = P0.z + 2 * u * az + u * u * bz - z;
      const dx = 2 * (ax + u * bx), dy = 2 * (ay + u * by), dz = 2 * (az + u * bz);
      const f2 = dx * dx + dy * dy + dz * dz + 2 * (px * bx + py * by + pz * bz);
      if (f2 < 1e-9) break;
      u = clamp(u - (px * dx + py * dy + pz * dz) / f2, 0, 1);
    }
    let tx = ax + u * bx, ty = ay + u * by, tz = az + u * bz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // latéral : (1, 0, 0) rendu perpendiculaire à l'arc ; dos : T × latéral
    let ux = 1 - tx * tx, uy = -tx * ty, uz = -tx * tz;
    const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
    const qx = x - (P0.x + 2 * u * ax + u * u * bx), qy = y - (P0.y + 2 * u * ay + u * u * by), qz = z - (P0.z + 2 * u * az + u * u * bz);
    out.u = u; out.s = u * L;
    out.lx = qx * ux + qy * uy + qz * uz; out.ld = qx * wx + qy * wy + qz * wz; out.la = qx * tx + qy * ty + qz * tz;
    return out;
  }
  function d(x, y, z) {
    coord(x, y, z, o);
    const w = W(o.u), r = o.ld > 0 ? DD(o.u) : DV(o.u), a = o.u < 0.5 ? capA : capB;
    const X = o.lx / w, Y = o.ld / r, Z = o.la / a;
    const k0 = Math.sqrt(X * X + Y * Y + Z * Z), k1 = Math.sqrt((X / w) ** 2 + (Y / r) ** 2 + (Z / a) ** 2);
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(w, r);
  }
  const at = (u) => V(P0.x + 2 * u * ax + u * u * bx, P0.y + 2 * u * ay + u * u * by, P0.z + 2 * u * az + u * u * bz);
  const tangent = (u) => V(ax + u * bx, ay + u * by, az + u * bz).normalize();
  return { d, coord, at, tangent, L, fH, f, uc, W, DV, DD };
}

/* ---------------------------------------------------------------- le corps : buste, bras, jambes */

/** Repère de la tête : centre, haut (U), devant (F), échelle ; at(x, u, f) : point à x de côté, u vers le haut, f vers l'avant. */
function headFrame(J, M) {
  const p = J.headPitch || 0, hs = M.headS, H = J.head;
  const U = V(0, Math.cos(p), Math.sin(p)), F = V(0, -Math.sin(p), Math.cos(p));
  const at = (x, u, f) => V(H.x + x * hs, H.y + (U.y * u + F.y * f) * hs, H.z + (U.z * u + F.z * f) * hs);
  // coordonnées (m, tête à l'échelle 1) d'un point : u (haut), f (devant)
  const uf = (y, z) => [((y - H.y) * U.y + (z - H.z) * U.z) / hs, ((y - H.y) * F.y + (z - H.z) * F.z) / hs];
  return { H, U, F, hs, at, uf };
}

// côté antérieur d'un segment de jambe (dans le plan sagittal) : la face du quadriceps, du tibia
const anterior = (dir) => V(0, dir.z, -dir.y).normalize();

// Formes : d(x, y, z), k (rayon de fondu avec les précédentes), et leur sphère englobante (cx, cy, cz, R), pour ne calculer que
// celles qui comptent au point demandé.
const cone = (a, b, r1, r2, k) => ({ d: (x, y, z) => sdRoundCone(x, y, z, a, b, r1, r2), k: k || 0.03,
  cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, cz: (a.z + b.z) / 2, R: a.distanceTo(b) / 2 + Math.max(r1, r2) });
const elp = (E, k) => ({ d: (x, y, z) => sdEllipsoidF(x, y, z, E), k: k || 0.03, cx: E.c.x, cy: E.c.y, cz: E.c.z, R: Math.max(E.r.x, E.r.y, E.r.z) });
const ball = (c, r, k) => ({ d: (x, y, z) => Math.sqrt((x - c.x) * (x - c.x) + (y - c.y) * (y - c.y) + (z - c.z) * (z - c.z)) - r, k: k || 0.03, cx: c.x, cy: c.y, cz: c.z, R: r });

/** Champ d'un groupe de formes fondues entre elles ; une forme trop loin pour changer le résultat n'est pas calculée. */
function evalGroup(list, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < list.length; i++) {
    const p = list[i], dx = x - p.cx, dy = y - p.cy, dz = z - p.cz, m = d + p.k + p.R;
    if (m > 0 && dx * dx + dy * dy + dz * dz > m * m) continue;
    const v = p.d(x, y, z);
    d = d > 1e8 ? v : smin(d, v, p.k);
  }
  return d;
}

function distSeg(x, y, z, a, b) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, px = x - a.x, py = y - a.y, pz = z - a.z;
  const t = clamp((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz), 0, 1);
  const qx = px - bx * t, qy = py - by * t, qz = pz - bz * t;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/** Le corps dans la pose J : groupes de formes (buste et tête, bras, jambes), champ de distance, et pour un point de la surface :
 *  son groupe, son os de départ, sa zone de tenue. */
function bodyModel(J, M, gear) {
  const X = LAT;
  const T = makeTrunk(J, M);
  const HF = headFrame(J, M);
  const hs = M.headS;
  /* --- buste, cou, tête --- */
  const tm = T.at(0.5);
  const trunk = [{ d: T.d, k: 0.001, cx: tm.x, cy: tm.y, cz: tm.z, R: T.L / 2 + 0.2 }];
  const pc = T.at(T.fH), pt = T.tangent(T.fH), pd = V(0, pt.z, -pt.y).normalize();      // bassin : centre, axe, dos
  for (const sx of [-1, 1]) {
    // fessiers : derrière et sous les hanches, posés sur l'arrière de la selle ; ils se fondent dans le bas du dos
    trunk.push(elp(ell(pc.clone().addScaledVector(X, sx * 0.068).addScaledVector(pd, 0.03).addScaledVector(pt, -0.045), pt, X, M.glute + 0.003, 0.1, M.glute * 0.92), 0.07));
    // trapèze et clavicule : du cou à la pointe de l'épaule
    const sh = J[sx < 0 ? 'shL' : 'shR'];
    const st = T.tangent(1), sd = V(0, st.z, -st.y).normalize();
    trunk.push(cone(J.neck.clone().addScaledVector(X, sx * 0.04).addScaledVector(st, -0.012), sh.clone().addScaledVector(sd, 0.022).addScaledVector(st, 0.012).addScaledVector(X, -sx * 0.012), 0.043, 0.04, 0.06));
  }
  {
    // pectoraux, ou poitrine d'une coureuse
    const u = T.f(M.f ? 0.7 : 0.76), c = T.at(u), t = T.tangent(u), dd = V(0, t.z, -t.y).normalize();
    for (const sx of [-1, 1]) {
      if (M.f) trunk.push(elp(ell(c.clone().addScaledVector(X, sx * 0.066).addScaledVector(dd, -(T.DV(u) - 0.012)), t, X, 0.054, 0.052, 0.046), 0.04));
      else trunk.push(elp(ell(c.clone().addScaledVector(X, sx * 0.07).addScaledVector(dd, -(T.DV(u) - 0.026)), t, X, 0.072, 0.065, 0.03), 0.06));
    }
  }
  const nHead = trunk.length;                                                               // à partir d'ici : cou et tête
  trunk.push(cone(J.neck.clone(), HF.at(0, -0.058, -0.03), M.neckR + 0.005, M.neckR, 0.045));
  trunk.push(elp(ell(HF.at(0, 0.016, -0.008), HF.U, X, 0.077 * hs, 0.098 * hs, 0.098 * hs), 0.03));          // crâne
  trunk.push(elp(ell(HF.at(0, -0.042, 0.03), HF.U, X, 0.064 * hs, 0.076 * hs, 0.064 * hs), 0.035));           // visage, mâchoire
  trunk.push(ball(HF.at(0, -0.098, 0.066), 0.023 * hs, 0.03));                                               // menton
  trunk.push(cone(HF.at(0, -0.002, 0.089), HF.at(0, -0.043, 0.112), 0.008, 0.0125, 0.015));                   // nez
  trunk.push(elp(ell(HF.at(0, 0.02, 0.084), HF.U, X, 0.05 * hs, 0.012, 0.014), 0.02));                        // arcades
  for (const sx of [-1, 1]) trunk.push(elp(ell(HF.at(sx * 0.077, -0.012, -0.012), HF.U, X, 0.01, 0.03 * hs, 0.018 * hs), 0.012));   // oreilles
  /* --- bras --- */
  const arms = [];
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const sh = J['sh' + s], el = J['el' + s], wr = J['wr' + s], hd = J['hd' + s];
    const dU = el.clone().sub(sh).normalize(), LU = el.distanceTo(sh), dF = wr.clone().sub(el).normalize(), LF = wr.distanceTo(el);
    // côté du biceps : vers où l'avant-bras fléchit
    let bend = dF.clone().addScaledVector(dU, -dF.dot(dU));
    if (bend.lengthSq() < 1e-6) bend = V(0, 1, 0).addScaledVector(dU, -dU.y);
    bend.normalize();
    const out = V(sx, 0, 0);
    const r = M.armR, L = [];
    L.push(cone(sh, el, r, r * 0.86, 0));
    L.push(elp(ell(sh.clone().addScaledVector(dU, 0.045).addScaledVector(out, 0.012), dU, X, r * 1.2, 0.085, r * 1.26), 0.045));                // deltoïde
    L.push(elp(ell(sh.clone().lerp(el, 0.52).addScaledVector(bend, 0.01), dU, X, r * 0.92, LU * 0.3, r * 0.95), 0.03));                          // biceps
    L.push(elp(ell(sh.clone().lerp(el, 0.45).addScaledVector(bend, -0.012), dU, X, r * 0.9, LU * 0.33, r * 0.9), 0.03));                         // triceps
    L.push(ball(el.clone().addScaledVector(bend, -0.006), r * 0.88, 0.03));                                                                       // coude
    L.push(cone(el, wr, r * 0.88, 0.027, 0.03));
    L.push(elp(ell(el.clone().lerp(wr, 0.28), dF, X, r * 0.95, LF * 0.3, r * 0.86), 0.03));                                                       // avant-bras
    // main fermée sur le cintre : paume, doigts enroulés dessous, pouce à l'intérieur
    const hup = V(0, 1, 0).addScaledVector(dF, -dF.y).normalize();
    const palm = wr.clone().addScaledVector(dF, 0.065);
    L.push(elp(ell(palm, dF, X, 0.043, 0.05, 0.026), 0.025));
    L.push(cone(palm.clone().addScaledVector(dF, 0.04).addScaledVector(hup, -0.004), palm.clone().addScaledVector(dF, 0.028).addScaledVector(hup, -0.042), 0.021, 0.017, 0.02));
    L.push(cone(palm.clone().addScaledVector(out, -0.036).addScaledVector(dF, -0.01), palm.clone().addScaledVector(out, -0.03).addScaledVector(dF, 0.04).addScaledVector(hup, -0.02), 0.014, 0.011, 0.015));
    const bis = dU.clone().add(dF).normalize();
    arms.push({ list: L, joint: sh, k: 0.055, r0: 0.1, r1: 0.2, path: [sh, el, wr, hd], R: 0.09, s, sx, sh, el, wr, hd, dU, LU, dF, LF, bis, bones: [B['uarm' + s], B['farm' + s], B['hand' + s]] });
  }
  /* --- jambes --- */
  const legs = [];
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const hip = J['hip' + s], kn = J['kn' + s], an = J['an' + s], toe = J['toe' + s];
    const dT = kn.clone().sub(hip).normalize(), LT = kn.distanceTo(hip), dS = an.clone().sub(kn).normalize(), LS = an.distanceTo(kn);
    const aT = anterior(dT), aS = anterior(dS), out = V(sx, 0, 0);
    const r = M.thighR, c = M.calfR, L = [];
    L.push(cone(hip.clone().addScaledVector(dT, 0.06), kn, r * 0.97, 0.05, 0));
    L.push(elp(ell(hip.clone().lerp(kn, 0.42).addScaledVector(aT, 0.022).addScaledVector(out, 0.004), dT, X, r * 0.86, LT * 0.43, r * 0.72), 0.04));    // quadriceps
    L.push(elp(ell(hip.clone().lerp(kn, 0.46).addScaledVector(aT, -0.02), dT, X, r * 0.76, LT * 0.4, r * 0.62), 0.04));                              // ischio-jambiers
    L.push(elp(ell(hip.clone().lerp(kn, 0.5).addScaledVector(out, 0.018).addScaledVector(aT, 0.008), dT, X, r * 0.56, LT * 0.36, r * 0.62), 0.04));   // vaste externe
    L.push(elp(ell(hip.clone().lerp(kn, 0.84).addScaledVector(aT, 0.014).addScaledVector(out, -0.021), dT, X, 0.036, 0.06, 0.036), 0.03));            // vaste interne
    L.push(ball(kn, 0.05, 0.03));
    L.push(elp(ell(kn.clone().addScaledVector(aT.clone().add(aS).normalize(), 0.021), dS, X, 0.033, 0.04, 0.027), 0.025));                            // rotule
    L.push(cone(kn, an, c * 0.86, 0.031, 0.03));
    L.push(elp(ell(kn.clone().lerp(an, 0.27).addScaledVector(aS, -0.024), dS, X, c * 0.93, LS * 0.27, c * 0.86), 0.035));                             // mollet
    L.push(elp(ell(kn.clone().lerp(an, 0.3).addScaledVector(aS, 0.01).addScaledVector(out, 0.01), dS, X, 0.03, LS * 0.25, 0.03), 0.03));              // jambier
    for (const m of [-1, 1]) L.push(ball(an.clone().addScaledVector(out, m * 0.027), 0.017, 0.015));                                                  // malléoles
    // pied (dans la chaussure)
    const fw = toe.clone().sub(an).normalize(), up = V(0, fw.z, -fw.y).normalize();
    L.push(cone(an.clone().addScaledVector(up, -0.03).addScaledVector(fw, -0.03), an.clone().addScaledVector(fw, 0.17).addScaledVector(up, -0.045), 0.033, 0.026, 0.02));
    const bis = dT.clone().add(dS).normalize();
    legs.push({ list: L, joint: hip, k: 0.07, r0: 0.15, r1: 0.26, path: [hip, kn, an, toe], R: 0.12, s, sx, hip, kn, an, dT, LT, dS, LS, bis, bones: [B['thigh' + s], B['shin' + s], B['foot' + s]] });
  }
  const limbs = arms.concat(legs);
  for (const g of limbs) {
    const bb = new THREE.Box3().setFromPoints(g.path), c = bb.getCenter(V(0, 0, 0));
    g.cx = c.x; g.cy = c.y; g.cz = c.z; g.RR = bb.min.distanceTo(bb.max) / 2 + g.R;
  }
  const limbD = (g, x, y, z) => evalGroup(g.list, x, y, z);
  const trunkD = (x, y, z) => evalGroup(trunk, x, y, z);
  // plus proche du cou ou de la tête que du reste du buste
  const headish = (x, y, z) => {
    let dh = 1e9, db = 1e9;
    for (let i = 0; i < trunk.length; i++) { const d = trunk[i].d(x, y, z); if (i >= nHead) dh = Math.min(dh, d); else db = Math.min(db, d); }
    return dh < db;
  };
  // borne inférieure de la distance au membre : sa sphère englobante d'abord, puis ses segments
  const limbFar = (g, x, y, z, lim) => {
    const dx = x - g.cx, dy = y - g.cy, dz = z - g.cz, m0 = lim + g.RR;
    if (m0 > 0 && dx * dx + dy * dy + dz * dz > m0 * m0) return 1e9;
    let m = 1e9;
    for (let i = 0; i + 1 < g.path.length; i++) m = Math.min(m, distSeg(x, y, z, g.path[i], g.path[i + 1]));
    return m - g.R;
  };
  /** Champ du corps : le buste, puis chaque membre, fondu dans le buste seulement près de son articulation. */
  const sdf = (x, y, z) => {
    let d = trunkD(x, y, z);
    for (let i = 0; i < limbs.length; i++) {
      const g = limbs[i];
      if (limbFar(g, x, y, z, Math.max(d, 0) + 0.09) > Math.max(d, 0) + 0.09) continue;
      const dl = limbD(g, x, y, z);
      const jx = x - g.joint.x, jy = y - g.joint.y, jz = z - g.joint.z;
      const k = g.k * (1 - ss(g.r0, g.r1, Math.sqrt(jx * jx + jy * jy + jz * jz)));
      d = k > 1e-3 ? smin(d, dl, k) : Math.min(d, dl);
    }
    return d;
  };
  /* --- tenue --- */
  const cl = gear.clothing || 'fitted';
  const suit = cl === 'skinsuit' || cl === 'skinsuit_tt', long = cl === 'skinsuit_tt', loose = cl === 'loose';
  const sleeve = loose ? 0.6 : cl === 'aero' || suit ? 0.86 : 0.55;                        // manche : part du bras couverte
  const hemT = loose ? 0.82 : 0.68;                                                          // cuissard : part de la cuisse couverte
  const sockH = { short: 0.045, classic: 0.12, aero: 0.18 }[gear.socks || 'classic'] ?? 0.12;   // chaussette : m au-dessus de la cheville
  const gloves = gear.gloves !== false && gear.helmet !== 'none';
  // col : plan en travers du cou, plus bas devant
  const nd = J.head.clone().sub(J.neck).normalize(), nv = V(0, nd.z, -nd.y).normalize().multiplyScalar(-1);
  const cn = nd.clone().addScaledVector(nv, 0.32).normalize(), col = J.neck.clone().addScaledVector(nd, 0.034);
  const tc = { s: 0, lx: 0, ld: 0, la: 0, u: 0 };
  const hemBack = T.fH * T.L + (loose ? 0.02 : 0.065), hemFront = T.fH * T.L + (loose ? 0.06 : 0.15);
  const R = { a: 0, b: 0, s: 0 };
  const solid = (r) => { R.a = r; R.b = r; R.s = -1; return R; };
  const edge = (a, b, s) => { R.a = a; R.b = b; R.s = s; return R; };
  /** Zone de tenue d'un point de la surface : {a, b, s} — zone a, zone b au-delà du bord, s : distance au bord (m, + du côté de b). */
  function region(g, x, y, z) {
    if (g === 0) {
      const sc = (x - col.x) * cn.x + (y - col.y) * cn.y + (z - col.z) * cn.z;
      if (sc > -0.03) return edge(REGION.JERSEY, REGION.SKIN, sc);
      if (suit) return solid(REGION.JERSEY);
      T.coord(x, y, z, tc);
      return edge(REGION.SHORTS, REGION.JERSEY, tc.s - (hemFront + (hemBack - hemFront) * ss(-0.05, 0.05, tc.ld)));
    }
    if (g <= 2) {
      const A = arms[g - 1];
      const past = (x - A.el.x) * A.bis.x + (y - A.el.y) * A.bis.y + (z - A.el.z) * A.bis.z > 0;
      const tw = (x - A.wr.x) * A.dF.x + (y - A.wr.y) * A.dF.y + (z - A.wr.z) * A.dF.z;
      if (past && tw > -0.03) return gloves ? edge(long ? REGION.JERSEY : REGION.SKIN, REGION.GLOVE, tw - 0.012) : long ? edge(REGION.JERSEY, REGION.SKIN, tw + 0.012) : solid(REGION.SKIN);
      if (past || long) return solid(long ? REGION.JERSEY : REGION.SKIN);
      const tu = (x - A.sh.x) * A.dU.x + (y - A.sh.y) * A.dU.y + (z - A.sh.z) * A.dU.z;
      return edge(REGION.JERSEY, REGION.SKIN, tu - sleeve * A.LU);
    }
    const G = legs[g - 3];
    const past = (x - G.kn.x) * G.bis.x + (y - G.kn.y) * G.bis.y + (z - G.kn.z) * G.bis.z > 0;
    if (!past) {
      const tt = (x - G.hip.x) * G.dT.x + (y - G.hip.y) * G.dT.y + (z - G.hip.z) * G.dT.z;
      return edge(suit ? REGION.JERSEY : REGION.SHORTS, REGION.SKIN, tt - hemT * G.LT);
    }
    const ts = (x - G.kn.x) * G.dS.x + (y - G.kn.y) * G.dS.y + (z - G.kn.z) * G.dS.z;
    return edge(REGION.SKIN, REGION.SOCK, ts - (G.LS - sockH));
  }
  /** Groupe d'un point de la surface : 0 le buste et la tête, 1-2 les bras, 3-4 les jambes. */
  function groupOf(x, y, z) {
    let best = 0, bd = trunkD(x, y, z);
    for (let i = 0; i < limbs.length; i++) {
      const g = limbs[i];
      if (limbFar(g, x, y, z, bd + 0.02) > bd + 0.02) continue;
      const d = limbD(g, x, y, z);
      if (d < bd) { bd = d; best = i + 1; }
    }
    return best;
  }
  /** Os de départ d'un point de la surface (avant le lissage des poids). */
  function boneOf(g, x, y, z) {
    if (g === 0) {
      // cou et tête : ce qui est plus proche du cou ou de la tête que du reste du buste
      if (headish(x, y, z)) return ((x - J.neck.x) * nd.x + (y - J.neck.y) * nd.y + (z - J.neck.z) * nd.z) > 0.035 ? B.head : B.chest;
      T.coord(x, y, z, tc);
      return tc.u < T.uc ? B.pelvis : B.chest;
    }
    const G = limbs[g - 1], j = G.path;
    if ((x - j[1].x) * G.bis.x + (y - j[1].y) * G.bis.y + (z - j[1].z) * G.bis.z <= 0) return G.bones[0];
    const d2 = g <= 2 ? G.dF : G.dS;
    return (x - j[2].x) * d2.x + (y - j[2].y) * d2.y + (z - j[2].z) * d2.z > (g <= 2 ? 0 : 0.012) ? G.bones[2] : G.bones[1];
  }
  /** Lissage supplémentaire des poids (0 à 1) : autour des hanches (le bas des fessiers suit la cuisse) et au milieu du dos. */
  function wide(g, x, y, z) {
    let m = 0;
    for (const G of legs) m = Math.max(m, 1 - ss(0.13, 0.24, Math.hypot(x - G.hip.x, y - G.hip.y, z - G.hip.z)));
    if (g === 0) { T.coord(x, y, z, tc); m = Math.max(m, 1 - ss(0.1, 0.2, Math.abs(tc.s - T.uc * T.L))); }
    return m;
  }
  return { sdf, region, groupOf, boneOf, wide, HF };
}

/* ---------------------------------------------------------------- extraction du maillage (surface nets) */

function surfaceNets(sdf, box, h, bandK) {
  const nx = Math.ceil((box.max.x - box.min.x) / h) + 1, ny = Math.ceil((box.max.y - box.min.y) / h) + 1, nz = Math.ceil((box.max.z - box.min.z) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const ox = box.min.x, oy = box.min.y, oz = box.min.z;
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // bande étroite : une grille 4 fois plus grossière d'abord ; le champ exact n'est calculé que près de la surface
  const S = 4, cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1, H = h * S;
  const G = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) G[(k * cy + j) * cx + i] = sdf(ox + i * H, oy + j * H, oz + k * H);
  const band = H * (bandK || 1.9);
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

function accessoryPrims(J, M, gear, HF) {
  const P = [];
  const X = LAT, hs = M.headS, H = HF.H;
  const helmet = gear.helmet || 'road';
  // coordonnées dans la tête (m, à l'échelle 1) : côté, haut, devant
  const loc = (x, y, z) => { const [u, f] = HF.uf(y, z); return [(x - H.x) / hs, u, f]; };
  if (helmet === 'none') {
    // tête nue (le public) : cheveux courts, calotte au-dessus du front et derrière la tête
    const E = ell(HF.at(0, 0.02, -0.012), HF.U, X, 0.081 * hs, 0.1 * hs, 0.101 * hs);
    P.push({ bone: B.head, region: REGION.HAIR, d: (x, y, z) => {
      // calotte pleine (elle se voit à tous les niveaux de détail) : au-dessus du front, plus bas sur la nuque
      const [, u, f] = loc(x, y, z);
      return Math.max(sdEllipsoidF(x, y, z, E), 0.04 - Math.max(0, -f) * 0.8 - u);
    } });
  } else if (helmet === 'tt') {
    // casque chrono : coque qui s'étire en pointe vers l'arrière, le long du dos ; visière
    const a = HF.at(0, 0.03, 0.01), b = HF.at(0, -0.03, -0.25);
    P.push({ bone: B.head, region: REGION.HELMET, d: (x, y, z) => {
      const [, u, f] = loc(x, y, z);
      return Math.max(sdRoundCone(x, y, z, a, b, 0.113 * hs, 0.018), -0.03 - u + Math.max(0, f) * 0.55 - Math.max(0, -f) * 0.3);
    } });
    const E = ell(HF.at(0, 0.004, 0.03), HF.U, X, 0.106 * hs, 0.078 * hs, 0.1 * hs);
    P.push({ bone: B.head, region: REGION.LENS, d: (x, y, z) => {
      let d = sdEllipsoidF(x, y, z, E); d = Math.max(d, -(d + 0.004));
      const [, u, f] = loc(x, y, z);
      return Math.max(d, 0.055 - f, u - 0.04, -0.055 - u);
    } });
  } else {
    // casque de route : coque allongée, bord plus bas sur la nuque que sur le front, aérations en long
    const E = ell(HF.at(0, 0.026, -0.016), HF.U, X, 0.099 * hs, 0.108 * hs, 0.142 * hs);
    const tail = helmet === 'aero' ? [HF.at(0, 0.05, -0.06), HF.at(0, 0.03, -0.175)] : null;
    P.push({ bone: B.head, region: REGION.HELMET, d: (x, y, z) => {
      let d = sdEllipsoidF(x, y, z, E);
      if (tail) d = smin(d, sdRoundCone(x, y, z, tail[0], tail[1], 0.07 * hs, 0.032), 0.03);
      d = Math.max(d, -(d + 0.021));                                  // coque de 21 mm
      const [lx, u, f] = loc(x, y, z);
      d = Math.max(d, 0.004 + 0.28 * f - u);                          // bord : au-dessus des sourcils, bas sur la nuque
      if (helmet !== 'aero') for (const c of [-0.05, -0.025, 0, 0.025, 0.05]) {
        const len = Math.abs(c) > 0.04 ? 0.045 : Math.abs(c) > 0.01 ? 0.065 : 0.078;
        d = Math.max(d, -Math.max(Math.abs(lx - c) - 0.0068, Math.abs(f - 0.008) - len, 0.058 - u));
      }
      return d;
    } });
    // jugulaire
    for (const sx of [-1, 1]) {
      // jugulaire : de la tempe et de l'arrière de l'oreille jusque sous le menton
      const j = HF.at(sx * 0.071, -0.052, 0.012), c = HF.at(sx * 0.03, -0.112, 0.04);
      const a1 = HF.at(sx * 0.082, 0.012, 0.03), a2 = HF.at(sx * 0.084, 0.006, -0.04);
      P.push({ bone: B.head, region: REGION.STRAP, d: (x, y, z) => Math.min(sdRoundCone(x, y, z, a1, j, 0.004, 0.004), sdRoundCone(x, y, z, a2, j, 0.004, 0.004), sdRoundCone(x, y, z, j, c, 0.004, 0.004)) });
    }
  }
  // lunettes : écran courbe devant les yeux
  if ((gear.glasses || 'sport') !== 'none' && helmet !== 'tt' && helmet !== 'none') {
    const big = gear.glasses === 'shield';
    const E = ell(HF.at(0, 0.0, 0.012), HF.U, X, 0.085 * hs, 0.08 * hs, 0.1 * hs);
    P.push({ bone: B.head, region: REGION.LENS, d: (x, y, z) => {
      let d = sdEllipsoidF(x, y, z, E); d = Math.max(d, -(d + 0.008));
      const [, u, f] = loc(x, y, z);
      return Math.max(d, u - (big ? 0.026 : 0.019), (big ? -0.038 : -0.027) - u, 0.036 - f);
    } });
  }
  // chaussures : tige, pointe effilée, semelle rigide et plate ; couvre-chaussures qui montent sur la cheville
  const cover = gear.shoes === 'aero';
  for (const [s, ft] of [['L', B.footL], ['R', B.footR]]) {
    const an = J['an' + s], toe = J['toe' + s];
    const fw = toe.clone().sub(an).normalize(), up = V(0, fw.z, -fw.y).normalize();
    const pt = (f, u) => an.clone().addScaledVector(fw, f).addScaledVector(up, u);
    const heel = pt(-0.058, -0.04), tip = pt(0.212, -0.053), in0 = pt(-0.012, -0.014), in1 = pt(0.085, -0.03), top = pt(-0.01, cover ? 0.075 : 0.02);
    const sole = FOOT.up - 0.012;                                    // de la cheville au-dessous de la semelle
    const shape = (x, y, z) => {
      const wx = an.x + (x - an.x) * 0.8;                              // plus large que haute
      let d = smin(sdRoundCone(wx, y, z, heel, tip, 0.037, 0.027), sdRoundCone(wx, y, z, in0, in1, 0.04, 0.035), 0.03);
      if (cover) d = smin(d, sdRoundCone(wx, y, z, in0, top, 0.04, 0.039), 0.02);
      return d;
    };
    const uOf = (x, y, z) => (x - an.x) * up.x + (y - an.y) * up.y + (z - an.z) * up.z;
    P.push({ bone: ft, region: REGION.SHOE, d: (x, y, z) => { const u = uOf(x, y, z); return Math.max(shape(x, y, z), -(u + sole - 0.007), u - (cover ? 0.07 : -0.004)); } });
    P.push({ bone: ft, region: REGION.SOLE, d: (x, y, z) => { const u = uOf(x, y, z); return Math.max(shape(x, y, z) - 0.002, Math.abs(u + sole - 0.002) - 0.006); } });
  }
  // cheveux : queue de cheval sous le casque
  if (M.f) { const a = HF.at(0, -0.035, -0.098), b = HF.at(0, -0.17, -0.165); P.push({ bone: B.head, region: REGION.HAIR, d: (x, y, z) => sdRoundCone(x, y, z, a, b, 0.03, 0.018) }); }
  return P;
}

/* ---------------------------------------------------------------- assemblage */

/** Poids des os le long de la surface. Chaque sommet a un os de départ (label) ; pour chaque os, on mesure la distance le long de la
 *  surface (arêtes du maillage) depuis sa partie du corps, jusqu'à radius[v] au plus : l'os garde un poids qui décroît avec cette
 *  distance (1 sur sa partie, 0 à radius[v]). De part et d'autre d'une articulation, les deux os se partagent le sommet ; à l'entrejambe,
 *  le bassin et les deux cuisses. W : nv × NB poids (non normalisés). */
function surfaceWeights(label, radius, nv, start, nbr, pos, rmax) {
  const W = new Float32Array(nv * NB), dist = new Float32Array(nv), queue = new Int32Array(nv), inq = new Uint8Array(nv);
  for (let b = 0; b < NB; b++) {
    // départ : les sommets de l'os qui touchent un autre os
    let head = 0, tail = 0, count = 0, any = false;
    for (let v = 0; v < nv; v++) {
      if (label[v] !== b) { dist[v] = Infinity; continue; }
      dist[v] = 0; any = true; W[v * NB + b] = 1;
      for (let k = start[v]; k < start[v + 1]; k++) if (label[nbr[k]] !== b) { queue[tail] = v; tail = (tail + 1) % nv; count++; inq[v] = 1; break; }
    }
    if (!any) continue;
    while (count > 0) {
      const v = queue[head]; head = (head + 1) % nv; count--; inq[v] = 0;
      const dv = dist[v], vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
      for (let k = start[v]; k < start[v + 1]; k++) {
        const n = nbr[k];
        if (label[n] === b) continue;
        const ex = pos[n * 3] - vx, ey = pos[n * 3 + 1] - vy, ez = pos[n * 3 + 2] - vz, d = dv + Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d < dist[n] && d < rmax) { dist[n] = d; if (!inq[n]) { queue[tail] = n; tail = (tail + 1) % nv; count++; inq[n] = 1; } }
      }
    }
    for (let v = 0; v < nv; v++) {
      const d = dist[v];
      if (d > 0 && d < radius[v]) { const t = d / radius[v]; W[v * NB + b] = 1 - t * t * (3 - 2 * t); }
    }
  }
  return W;
}

/**
 * Corps + accessoires dans la pose de référence : BufferGeometry avec position, normal, skinIndex (4 os), skinWeight, aRegW (poids
 * des zones de la tenue : maillot, cuissard, peau, chaussette ou gant), aRef (position de référence, pour les motifs du maillot, et
 * zone en w).
 * h : pas de la grille (m) ; 0,0095 pour le modèle de près, 0,036 pour le modèle lointain.
 */
export function buildBody(J, gear, h) {
  const M = morphology(gear.sex);
  const body = bodyModel(J, M, gear);
  const acc = accessoryPrims(J, M, gear, body.HF);
  // boîte : autour des articulations (le coureur sur son vélo, le spectateur debout, bras levés)
  const box = new THREE.Box3();
  for (const k in J) if (J[k] && J[k].isVector3 && k !== 'latP') box.expandByPoint(J[k]);
  box.expandByScalar(0.24);
  const parts = [];
  { const { pos, index } = surfaceNets(body.sdf, box, h); parts.push({ pos, index, sdf: body.sdf, body: true }); }
  for (const a of acc) {
    const thin = a.region === REGION.LENS || a.region === REGION.STRAP;
    if (thin && h > 0.02) continue;                  // au loin, ni verres ni jugulaire
    const ah = thin ? Math.max(0.0028, h * 0.3) : Math.min(0.02, Math.max(0.006, h * 0.65));
    // boîte serrée autour de l'accessoire : on la cherche sur une grille grossière, près de son os (tête ou pied)
    const o = a.bone === B.head ? J.head : J[a.bone === B.footL ? 'anL' : 'anR'];
    const bb = tightBox(a.d, new THREE.Box3(o.clone().addScalar(-0.34), o.clone().addScalar(0.34)).intersect(box), 0.02);
    if (!bb) continue;
    const { pos, index } = surfaceNets(a.d, bb, ah, 2.9);
    parts.push({ pos, index, regionFixed: a.region, boneFixed: a.bone, sdf: a.d });
  }
  // fusion, normales par le gradient du champ, os et poids
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.pos.length / 3; ni += p.index.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), reg = new Float32Array(nv), regW = new Float32Array(nv * 4);
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  const e = h * 0.5, soft = Math.max(0.004, h * 0.75);
  const SLOT = { [REGION.JERSEY]: 0, [REGION.SHORTS]: 1, [REGION.SKIN]: 2, [REGION.SOCK]: 3, [REGION.GLOVE]: 3 };
  for (const p of parts) {
    const n = p.pos.length / 3;
    const label = p.body ? new Uint8Array(n) : null, radius = p.body ? new Float32Array(n) : null;
    for (let i = 0; i < n; i++) {
      const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2], o = (vo + i) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      const f = p.sdf;
      let gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
      const l = Math.hypot(gx, gy, gz) || 1;
      nor[o] = gx / l; nor[o + 1] = gy / l; nor[o + 2] = gz / l;
      if (p.body) {
        const g = body.groupOf(x, y, z);
        label[i] = body.boneOf(g, x, y, z);
        radius[i] = 0.034 + 0.058 * body.wide(g, x, y, z);       // demi-largeur du raccord entre deux os
        // zone de la tenue : de part et d'autre d'un bord, les poids des deux zones se croisent exactement sur le bord
        const R = body.region(g, x, y, z), m = clamp(0.5 + R.s / (2 * soft), 0, 1);
        reg[vo + i] = m > 0.5 ? R.b : R.a;
        regW[(vo + i) * 4 + SLOT[R.a]] += 1 - m;
        regW[(vo + i) * 4 + SLOT[R.b]] += m;
      } else {
        const q = (vo + i) * 4;
        si[q] = p.boneFixed; sw[q] = 1;
        reg[vo + i] = p.regionFixed;
      }
    }
    if (p.body) {
      // voisins de chaque sommet (arêtes des triangles), puis poids des os : raccords plus larges aux hanches et au milieu du dos
      const deg = new Uint32Array(n + 1);
      for (let k = 0; k < p.index.length; k += 3) for (let c = 0; c < 3; c++) deg[p.index[k + c] + 1] += 2;
      for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
      const fill = deg.slice(0, n), nbr = new Uint32Array(deg[n]);
      for (let k = 0; k < p.index.length; k += 3) for (let c = 0; c < 3; c++) {
        const a = p.index[k + c], b = p.index[k + (c + 1) % 3], d = p.index[k + (c + 2) % 3];
        nbr[fill[a]++] = b; nbr[fill[a]++] = d;
      }
      const W = surfaceWeights(label, radius, n, deg, nbr, p.pos, 0.1);
      // les quatre os les plus présents
      const order = new Array(NB);
      for (let i = 0; i < n; i++) {
        for (let b = 0; b < NB; b++) order[b] = b;
        order.sort((a, b) => W[i * NB + b] - W[i * NB + a]);
        let s = 0;
        for (let k = 0; k < 4; k++) s += W[i * NB + order[k]];
        const q = (vo + i) * 4;
        for (let k = 0; k < 4; k++) { si[q + k] = order[k]; sw[q + k] = s > 0 ? W[i * NB + order[k]] / s : k === 0 ? 1 : 0; }
      }
    }
    // chaque triangle tourne sa face vers l'extérieur (la normale du champ)
    for (let k = 0; k < p.index.length; k += 3) {
      let a = p.index[k], b = p.index[k + 1], c = p.index[k + 2];
      const Q = p.pos, oa = (vo + a) * 3;
      const ux = Q[b * 3] - Q[a * 3], uy = Q[b * 3 + 1] - Q[a * 3 + 1], uz = Q[b * 3 + 2] - Q[a * 3 + 2];
      const wx = Q[c * 3] - Q[a * 3], wy = Q[c * 3 + 1] - Q[a * 3 + 1], wz = Q[c * 3 + 2] - Q[a * 3 + 2];
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
