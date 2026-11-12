/* author : Hugo Joudrier-Faure */
/* Tests de la trajectoire manuelle (steer.js, Course 3D) : dynamique latérale, virages pris trop vite, frein du joueur, bas-côté et
 * sorties de route, chute sur un coureur tombé ; et de la trajectoire automatique (corde ou large, contourner un coureur tombé). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor } = require('./helpers.js');

const Steer = PYR.steer, Race = PYR.race, Pel = PYR.peloton, Tac = PYR.tactics;

/** Segments d'un virage de deg° (> 0 à droite) de rayon R (m), par pas de 10 m. */
function arc(deg, R) {
  const n = Math.round((Math.abs(deg) * Math.PI / 180 * R) / 10);
  return Array.from({ length: n }, () => ({ len: 10, grade: 0, turn: Math.sign(deg) * (10 / R) * 180 / Math.PI }));
}

/** Un coureur piloté seul : ligne droite de pre m, un virage (deg, R), puis 600 m ; manual : trajectoire manuelle. */
function solo(o) {
  const { deg = 0, R = 30, pre = 300, v0 = 10, P = 0, manual = true, seed = 3, events = false, w = 6 } = o || {};
  const segs = deg ? [{ len: pre, grade: 0 }, ...arc(deg, R), { len: 600, grade: 0 }] : [{ len: pre + 900, grade: 0 }];
  const { course, setup, athlete } = setupFor(makeProfile(segs, { heading: 0 }), {}, { temperature: 20, roadWidth: w });
  const race = Race.create({ course, rules: { peloton: true, events }, seed, gustSeed: 1 });
  const r = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0 });
  Tac.setMode(r, 'manual', 0);
  r.tac.cmd = P;
  Pel.setY(r, 0);
  if (manual) { r.lat.manual = true; r.lat.edgeMax = Steer.HALF_3D; Steer.init(r.lat); }
  return { race, r, course };
}

/** n secondes : la trajectoire avance par images de 50 ms (comme l'écran de jeu), puis une seconde de course. u(r) : commande. */
function drive(x, n, u, brake) {
  const { race, r, course } = x;
  for (let t = 0; t < n && !r.finished; t++) {
    if (r.lat.manual && !r.incident) {
      const grip = Steer.gripOf(course, r.cond);
      for (let k = 0; k < 20; k++) Steer.step(r.lat, 0.05, r.st.v, Steer.kappaAt(course, r.st.s + r.st.v * k * 0.05), u ? u(r) : 0, grip);
    }
    r.brakeIn = brake ? brake(r) : 0;
    Race.step(race);
  }
}

test('entrées : zone morte et courbe des axes, rampe des touches, inclinaison du téléphone', () => {
  assert.equal(Steer.axis(0.1), 0);
  assert.equal(Steer.axis(-0.05, 0.1), 0);
  assert.equal(Steer.axis(1), 1);
  assert.equal(Steer.axis(-1), -1);
  assert.ok(Steer.axis(0.5) > 0 && Steer.axis(0.5) < 0.5, 'précis au centre');
  let u = 0;
  for (let i = 0; i < 5; i++) u = Steer.keyRamp(u, 1, 0.05);
  assert.ok(Math.abs(u - 1) < 1e-9, `en appui : ${u}`);
  u = Steer.keyRamp(u, 0, 0.1);
  assert.ok(u > 0 && u < 1);
  for (let i = 0; i < 4; i++) u = Steer.keyRamp(u, 0, 0.05);
  assert.equal(u, 0);
  assert.equal(Steer.tiltAxis(2), 0);
  assert.equal(Steer.tiltAxis(-30), -1);
  assert.ok(Steer.tiltAxis(10) > 0.3 && Steer.tiltAxis(10) < 0.4);
});

test('dynamique : sans commande en ligne droite on reste sur sa voie ; la commande déplace à la vitesse latérale maximale au plus', () => {
  const L = Steer.init({ y: 0.5 });
  for (let i = 0; i < 40; i++) Steer.step(L, 0.05, 10, 0, 0, 6.6);
  assert.ok(Math.abs(L.y - 0.5) < 1e-9);
  const M = Steer.init({ y: 0 });
  let vMax = 0;
  for (let i = 0; i < 40; i++) { Steer.step(M, 0.05, 10, 0, 1, 6.6); vMax = Math.max(vMax, M.vy); }
  assert.ok(M.y > 2 && M.y < 2 * Steer.VY_MAX, `y = ${M.y}`);
  assert.ok(vMax <= Steer.vyMax(10) + 1e-9);
  // à l'arrêt, pas de déplacement de côté
  const S = Steer.init({ y: 0 });
  Steer.step(S, 1, 0, 0, 1, 6.6);
  assert.equal(S.y, 0);
});

test('virage : sous l\'adhérence on suit la route, trop vite on est poussé vers l\'extérieur', () => {
  const k = 1 / 25, grip = 6.6;                  // virage de 25 m vers les y positifs ; vitesse limite √(6,6 × 25) ≈ 12,8 m/s
  const slow = Steer.init({ y: 0 }), fast = Steer.init({ y: 0 });
  for (let i = 0; i < 60; i++) { Steer.step(slow, 0.05, 11, k, 0, grip); Steer.step(fast, 0.05, 15, k, 0, grip); }
  assert.ok(Math.abs(slow.y) < 1e-9, `lent : ${slow.y}`);
  assert.ok(fast.y < -1.5, `trop vite : ${fast.y} (vers l'extérieur)`);
  assert.ok(fast.drift < 0);
  // à la corde la courbure est plus serrée : on décroche à une vitesse plus basse qu'à l'extérieur
  const inside = Steer.init({ y: 2 }), outside = Steer.init({ y: -2 });
  for (let i = 0; i < 20; i++) { Steer.step(inside, 0.05, 12.6, k, 0, grip); Steer.step(outside, 0.05, 12.6, k, 0, grip); }
  assert.ok(inside.y < 2 - 0.03, `corde : ${inside.y}`);
  assert.ok(Math.abs(outside.y + 2) < 1e-9, `extérieur : ${outside.y}`);
});

test('trajectoire manuelle : pas de freinage automatique en virage, le frein du joueur ralentit', () => {
  // virage serré (rayon ≈ 20 m, limite du pilote automatique ≈ 9,4 m/s) abordé à 12 m/s : le pilote automatique freine, pas la
  // trajectoire manuelle (qui le passe de justesse, sous l'adhérence du joueur)
  const auto = solo({ deg: 90, R: 10, pre: 60, v0: 11, P: 280, manual: false });
  const man = solo({ deg: 90, R: 10, pre: 60, v0: 11, P: 280 });
  let brAuto = 0, brMan = 0, vAuto = Infinity, vMan = Infinity;
  for (let t = 0; t < 12; t++) {
    drive(auto, 1); drive(man, 1);
    if (auto.r.st.braking) brAuto++;
    if (man.r.st.braking) brMan++;
    if (Math.abs(Steer.kappaAt(auto.course, auto.r.st.s)) > 0.03) vAuto = Math.min(vAuto, auto.r.st.v);
    if (Math.abs(Steer.kappaAt(man.course, man.r.st.s)) > 0.03) vMan = Math.min(vMan, man.r.st.v);
  }
  assert.ok(brAuto > 0, 'freinage automatique');
  assert.equal(brMan, 0, 'pas de freinage automatique');
  assert.ok(vMan > vAuto + 1, `dans le virage : ${vMan.toFixed(1)} m/s en manuel, ${vAuto.toFixed(1)} m/s en automatique`);
  // frein du joueur : bien plus de vitesse perdue qu'en roue libre
  const a = solo({ v0: 12 }), b = solo({ v0: 12 });
  drive(a, 3, null, () => 1);
  drive(b, 3, null, () => 0);
  assert.ok(a.r.st.v < b.r.st.v - 3, `frein ${a.r.st.v.toFixed(1)} m/s, roue libre ${b.r.st.v.toFixed(1)} m/s`);
  assert.ok(a.r.st.braking);
});

test('virage trop vite sans freiner : sortie de route ; en freinant on passe', () => {
  const fast = solo({ deg: 90, R: 10, pre: 60, v0: 14, P: 400 });
  drive(fast, 12);
  const out = fast.race.events.some((e) => e.type === 'offroad' || e.type === 'verge' || (e.type === 'crash' && e.cause));
  assert.ok(out, 'bas-côté ou sortie de route');
  const careful = solo({ deg: 90, R: 10, pre: 60, v0: 14, P: 400 });
  // on freine jusqu'à 9 m/s avant le virage, puis on le prend
  drive(careful, 25, null, (r) => (r.st.v > 9 ? 1 : 0));
  assert.ok(!careful.race.events.some((e) => e.type === 'offroad' || e.type === 'verge' || (e.type === 'crash' && e.cause)), 'reste sur la route');
});

test('bas-côté : roulement ×3 ; sortie de route : chute d\'autant plus probable qu\'on va vite', () => {
  const road = solo({ v0: 8 }), verge = solo({ v0: 8 });
  verge.r.lat.y = Steer.edgeOf(verge.course, 0, Steer.HALF_3D) + 0.5;
  Race.step(road.race); Race.step(verge.race);
  assert.ok(Math.abs(verge.r.cond.crr / road.r.cond.crr - 3) < 1e-9);
  // risques
  assert.ok(Steer.vergeRisk(15 / 3.6) < 0.01 && Steer.vergeRisk(40 / 3.6) > 0.2);
  assert.ok(Steer.exitRisk(15 / 3.6) < 0.1 && Steer.exitRisk(50 / 3.6) > 0.9);
  for (let k = 10; k < 60; k += 5) assert.ok(Steer.exitRisk((k + 5) / 3.6) >= Steer.exitRisk(k / 3.6));
  // sur des tirages : sortir à 45 km/h fait chuter bien plus souvent qu'à 15 km/h
  const crashes = (v) => {
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const x = solo({ v0: v / 3.6, seed });
      x.r.lat.y = Steer.edgeOf(x.course, 0, Steer.HALF_3D) + Steer.VERGE + 0.5;
      Race.step(x.race);
      if (x.r.incident) { n++; assert.equal(x.r.incident.cause, 'offroad'); }
      else assert.ok(x.race.events.some((e) => e.type === 'offroad'), 'sortie sans chute');
    }
    return n;
  };
  const lo = crashes(15), hi = crashes(45);
  assert.ok(lo < 10 && hi > 30, `chutes : ${lo}/40 à 15 km/h, ${hi}/40 à 45 km/h`);
});

test('après une chute en trajectoire manuelle, on repart sur la chaussée', () => {
  const x = solo({ v0: 11 });
  x.r.lat.y = Steer.edgeOf(x.course, 0, Steer.HALF_3D) + Steer.VERGE + 1;
  Race.incident(x.race, x.r, 'crash', 'offroad');
  for (let t = 0; t < 60 && x.r.incident; t++) Race.step(x.race);
  Race.step(x.race);
  assert.ok(!x.r.incident);
  assert.equal(Steer.zone(x.r.lat.y, Steer.edgeOf(x.course, x.r.st.s, Steer.HALF_3D)), 'road');
});

test('rouler sur un coureur tombé fait chuter (souvent) ; le pilote automatique le contourne', () => {
  let n = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const x = solo({ v0: 9, seed });
    const { setup, athlete } = setupFor(makeProfile([{ len: 1200, grade: 0 }]));
    const o = Race.addRider(x.race, { id: 'o', name: 'Tombé', setup, athlete, v0: 0 });
    o.st.s = 15; Pel.setY(o, 0); Race.incident(x.race, o, 'crash');
    o.incident.until = 1e9;
    for (let t = 0; t < 3 && !x.r.incident; t++) { o.lat.y = 0; drive(x, 1); } // il est resté au milieu de la route
    if (x.r.incident && x.r.incident.cause === 'pileup') n++;
  }
  assert.ok(n >= 12, `chutes : ${n}/20`);
  // pilote automatique : on passe à côté
  const y = solo({ v0: 9, manual: false });
  y.r.lat.linePref = 'inside';
  const { setup, athlete } = setupFor(makeProfile([{ len: 1200, grade: 0 }]));
  const o = Race.addRider(y.race, { id: 'o', name: 'Tombé', setup, athlete, v0: 0 });
  o.st.s = 40; Race.incident(y.race, o, 'crash');
  o.incident.until = 1e9;
  let minGap = Infinity;
  for (let t = 0; t < 8; t++) {
    o.lat.y = 0;                                  // couché au milieu de la route
    Race.step(y.race);
    if (Math.abs(y.r.st.s - o.st.s) < 3) minGap = Math.min(minGap, Math.abs(y.r.lat.y - o.lat.y));
  }
  assert.ok(minGap >= 0.6, `écart en passant : ${minGap.toFixed(2)} m`);
});

test('peloton : la position d\'un coureur en trajectoire manuelle est gardée telle quelle', () => {
  const x = solo({ v0: 10 });
  x.r.lat.y = 1.234;
  Race.step(x.race);
  assert.equal(x.r.lat.y, 1.234);
  x.r.lat.y = 0.5;
  Race.step(x.race);
  assert.equal(x.r.lat.prevY, 1.234, 'position du début de la seconde');
  assert.equal(x.r.lat.y, 0.5);
});

test('pilote automatique large : à l\'extérieur du virage, un peu plus vite', () => {
  const run = (pref) => {
    const x = solo({ deg: 90, R: 30, pre: 200, v0: 10, P: 260, manual: false });
    x.r.lat.linePref = pref;
    let ySum = 0, nIn = 0, mul = 1;
    for (let t = 0; t < 80 && !x.r.finished; t++) {
      Race.step(x.race);
      const k = Steer.kappaAt(x.course, x.r.st.s);
      if (Math.abs(k) > 0.02) { ySum += x.r.lat.y * Math.sign(k); nIn++; mul = Math.max(mul, x.r.cond.vlimMul); }
    }
    return { y: ySum / Math.max(1, nIn), mul };
  };
  const inside = run('inside'), wide = run('wide');
  assert.ok(inside.y > 0.5, `corde : ${inside.y.toFixed(2)}`);
  assert.ok(wide.y < -0.5, `large : ${wide.y.toFixed(2)}`);
  assert.ok(wide.mul > 1.02 && inside.mul === 1);
});

test('déterminisme : deux parties identiques donnent la même trajectoire', () => {
  const one = () => { const x = solo({ deg: 60, R: 25, pre: 80, v0: 12, events: true }); drive(x, 20, (r) => (r.st.t % 6 < 3 ? 0.6 : -0.4)); return [x.r.st.s, x.r.lat.y, x.race.events.length]; };
  assert.deepEqual(one(), one());
});

test('frein du joueur aussi en trajectoire automatique (bouton Freiner) ; les coureurs virtuels l\'ignorent', () => {
  const a = solo({ v0: 12, manual: false }), b = solo({ v0: 12, manual: false });
  drive(a, 3, null, () => 1);
  drive(b, 3, null, () => 0);
  assert.ok(a.r.st.v < b.r.st.v - 3, `frein ${a.r.st.v.toFixed(1)} m/s, roue libre ${b.r.st.v.toFixed(1)} m/s`);
  assert.ok(a.r.st.braking);
  const c = solo({ v0: 12, manual: false });
  c.r.human = false;
  drive(c, 3, null, () => 1);
  assert.ok(Math.abs(c.r.st.v - b.r.st.v) < 0.01, 'un coureur non piloté ne freine pas');
});

/* ---------- aide à la trajectoire (steer.guide) ---------- */
// parcours synthétique : 300 m droits, un virage à droite de 30 m de rayon sur 60 m, puis tout droit
function corner30() {
  const step = 5, n = 200, kappa = new Float64Array(n), width = new Float64Array(n).fill(6);
  for (let i = 0; i < n; i++) kappa[i] = i * step >= 300 && i * step < 360 ? 1 / 30 : 0;
  return { length: n * step, step, n, kappa, width, aLat: 4.4, aBrake: 3.5 };
}

test('aide à la trajectoire : un point tous les 4 m sur 80 m, la corde dans le virage, rien en ligne droite', () => {
  const C = corner30();
  const far = Steer.guide(C, 100, { maxHalf: 3 });
  assert.equal(far.pts.length, 20);
  assert.deepEqual([far.pts[0].d, far.pts[19].d], [4, 80]);
  assert.ok(far.pts.every((p) => p.y === 0 && p.v === Steer.V_FREE), 'ligne droite : au milieu, sans limite');
  assert.equal(far.corner, null);
  const g = Steer.guide(C, 290, { maxHalf: 3 });
  const apex = g.pts.find((p) => p.s === 330);
  assert.ok(apex.y > 2 && apex.y <= 3 - 0.6 + 1e-9, `corde à droite (κ > 0), contre le bord moins 0,6 m : ${apex.y}`);
  // à gauche : la corde change de côté
  const L = corner30(); for (let i = 0; i < L.n; i++) L.kappa[i] = -L.kappa[i];
  assert.ok(Steer.guide(L, 290, { maxHalf: 3 }).pts.find((p) => p.s === 330).y < -2);
});

test('aide à la trajectoire : vitesse conseillée à la limite d\'adhérence du virage, freinage anticipé, virage annoncé', () => {
  const C = corner30(), cond = { brakeK: 1 };
  const g = Steer.guide(C, 290, { maxHalf: 3, cond });
  const grip = Steer.gripOf(C, cond), apex = g.pts.find((p) => p.s === 330);
  // à la corde, la courbure est plus serrée : v² · κ / (1 − y·κ) ≤ adhérence, à 95 %
  const lim = 0.95 * Math.sqrt(grip * (1 - apex.y / 30) * 30);
  assert.ok(Math.abs(apex.v - lim) < 0.05, `${apex.v} ≈ ${lim}`);
  assert.ok(g.corner && Math.abs(g.corner.v - lim) < 0.05 && g.corner.d <= 20);
  // en approche, la vitesse conseillée descend vers celle du virage (on freine à temps), jamais plus vite que v² = vc² + 2·a·d
  const app = Steer.guide(C, 220, { maxHalf: 3, cond });
  const vs = app.pts.map((p) => p.v);
  for (let i = 1; i < vs.length; i++) if (app.pts[i].s <= 300) assert.ok(vs[i] <= vs[i - 1] + 1e-9, 'décroissante avant le virage');
  const p = app.pts.find((x) => x.s === 260);
  assert.ok(p.v <= Math.sqrt(lim * lim + 2 * 3.5 * 45) + 0.2 && p.v > lim);
  // route mouillée : moins d'adhérence, plus lent
  assert.ok(Steer.guide(C, 290, { maxHalf: 3, cond: { brakeK: 0.7 } }).corner.v < g.corner.v);
  // au-delà de la fin du parcours : plus de points
  assert.equal(Steer.guide(C, C.length - 10, {}).pts.length, 2);
});
