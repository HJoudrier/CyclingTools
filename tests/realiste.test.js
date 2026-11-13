/* author : Hugo Joudrier-Faure */
/* Tests de Virtual Ride 3D Réaliste (VirtualRide3DRealiste/) : l'application dans le site (chargeur, vue 3D de l'écran de course,
 * vitrine), la position du soleil et de la lune, la saison, le pont avec PaceYourRide (temps qu'il fait, voies), la géométrie des
 * vélos (la même que Bike3D), le corps des cyclistes (os, zones de la tenue) et la route lissée. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { register } = require('node:module');
const { pathToFileURL } = require('url');
register('./three-loader.mjs', pathToFileURL(__filename));

const ROOT = path.join(__dirname, '..');
const MONDE = path.join(ROOT, 'VirtualRide3DRealiste', 'monde', 'js');
const imp = (f) => import(pathToFileURL(path.join(MONDE, f)).href);

/* ---------- l'application dans le site ---------- */

test('réaliste : une application à part (chargeur, pages, portail, déploiement)', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'Commun/js/boot.js'), 'utf8');
  assert.match(boot, /jeu3dr: \{ dir: 'VirtualRide3DRealiste', ns: 'paceyourride\.jeu3dr'/);
  for (const f of ['index.html', 'course.html']) {
    const html = fs.readFileSync(path.join(ROOT, 'VirtualRide3DRealiste', f), 'utf8');
    assert.match(html, /data-app="jeu3dr"/, f);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'VirtualRide3DRealiste/course.html'), 'utf8'), /data-display="3d"/);
  assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /VirtualRide3DRealiste\/index\.html/);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitlab-ci.yml'), 'utf8'), /VirtualRide3DRealiste/);
  // la vue et la vitrine existent, avec la carte d'import de three.js
  for (const f of ['index.html', 'vitrine.html']) assert.match(fs.readFileSync(path.join(ROOT, 'VirtualRide3DRealiste/monde', f), 'utf8'), /"three": "\.\/vendor\/three\/three\.module\.min\.js"/);
});

test('réaliste : l\'écran de course ouvre le monde réaliste, l\'univers cartoon reste celui de Virtual Ride 3D', () => {
  globalThis.PYR = globalThis.PYR || {};
  require(path.join(ROOT, 'Commun/js/core/util.js'));
  require(path.join(ROOT, 'Commun/js/jeu/view3d.js'));
  const V3 = PYR.view3d;
  const was = PYR.appId;
  PYR.appId = 'jeu3dr';
  assert.equal(V3.universe().url, 'VirtualRide3DRealiste/monde/index.html');
  assert.match(V3.urlOf(true), /VirtualRide3DRealiste\/monde\/index\.html\?pyr&hud=1$/);
  PYR.appId = 'jeu3d';
  assert.equal(V3.universe().url, 'VirtualRide3D/univers/index.html');
  PYR.appId = 'jeu2d';
  assert.equal(V3.universe().url, 'VirtualRide3D/univers/index.html', 'la fenêtre à part de la carte : l\'univers cartoon');
  PYR.appId = was;
});

test('réaliste : avec une météo datée, la vue reçoit l\'heure et le jour de l\'année', () => {
  require(path.join(ROOT, 'Commun/js/engine/weather.js'));
  const V3 = PYR.view3d;
  // 21 juin 2026, 10 h locales (UTC+2)
  const start = Date.UTC(2026, 5, 21, 8, 0, 0) / 1000;
  const course = { weather: { start, off: 7200 }, n: 2, step: 10, temperature: 20 };
  const save = PYR.weather.at;
  PYR.weather.at = () => ({ T: 21, rain: 0, ws: 3, wd: 270, gust: 5, rh: 50, wet: 0 });
  try {
    const env = V3.envAt(course, 0, 3600);
    assert.equal(Math.round(env.hour), 11);
    assert.equal(env.doy, 172);
  } finally { PYR.weather.at = save; }
});

/* ---------- soleil, lune, saison ---------- */

test('réaliste : le soleil se lève à l\'est, culmine au sud vers 13 h 30 l\'été en France, se couche à l\'ouest', async () => {
  const A = await imp('astro.js');
  const lat = 45.1, lon = 6.0, doy = 172;   // Alpes, solstice d'été
  assert.equal(A.utcOffset(lat, lon, doy), 2, 'heure d\'été de Paris');
  assert.equal(A.utcOffset(lat, lon, 15), 1, 'heure d\'hiver');
  const noon = A.skyPositions(lat, lon, doy, 13.6);
  assert.ok(noon.sun.el > 65 * Math.PI / 180 && noon.sun.el < 70 * Math.PI / 180, `élévation à midi solaire ${(noon.sun.el * 180 / Math.PI).toFixed(1)}°`);
  assert.ok(noon.sun.z > 0, 'au sud (z vers le sud)');
  const morning = A.skyPositions(lat, lon, doy, 7);
  assert.ok(morning.sun.x > 0.5 && morning.sun.y > 0, 'à l\'est le matin');
  const evening = A.skyPositions(lat, lon, doy, 20.5);
  assert.ok(evening.sun.x < -0.5, 'à l\'ouest le soir');
  assert.ok(A.skyPositions(lat, lon, doy, 0.5).sun.y < 0, 'nuit à minuit et demi');
  const winter = A.skyPositions(lat, lon, 355, 12.6);
  assert.ok(winter.sun.el < 25 * Math.PI / 180, 'soleil bas en hiver');
  assert.ok(Math.abs(noon.solarNoon - 13.6) < 0.4, `midi solaire ${noon.solarNoon.toFixed(2)} h`);
});

test('réaliste : lune et ses phases, saisons de la végétation', async () => {
  const A = await imp('astro.js');
  for (const h of [0, 6, 12, 18]) {
    const p = A.skyPositions(45, 2, 100, h);
    assert.ok(p.moon.phase >= 0 && p.moon.phase < 1 && p.moon.light >= 0 && p.moon.light <= 1);
    assert.ok(Math.abs(Math.hypot(p.moon.x, p.moon.y, p.moon.z) - 1) < 1e-9);
  }
  const S = (d) => A.season(d, 46);
  assert.ok(S(196).green > 0.9 && S(196).bare === 0, 'été : vert');
  assert.ok(S(295).autumn > 0.9, 'fin octobre : feuilles colorées');
  assert.ok(S(15).bare > 0.9 && S(15).snowy > 0.5, 'janvier : arbres nus');
  assert.ok(A.season(15, -40).green > 0.9, 'hémisphère sud : l\'été en janvier');
  assert.equal(A.doyOfAmbiance('automne'), 288);
});

/* ---------- pont avec PaceYourRide ---------- */

test('réaliste : temps affiché d\'après la pluie de la course, voies sans chevauchement', async () => {
  const { weatherOf, assignLanes } = await imp('bridge.js');
  assert.equal(weatherOf({ rain: 0, rh: 50 }, 'soleil'), 'soleil');
  assert.equal(weatherOf({ rain: 1.5, T: 14 }, 'soleil'), 'pluie');
  assert.equal(weatherOf({ rain: 1.5, T: -1 }, 'soleil'), 'neige');
  assert.equal(weatherOf({ rain: 9, T: 20, gust: 15 }, 'pluie'), 'orage');
  assert.equal(weatherOf({ rain: 0.2, T: 14 }, 'pluie'), 'pluie', 'hystérésis : la pluie ne s\'arrête pas au premier creux');
  assert.equal(weatherOf({ rain: 0.05, rh: 60 }, 'soleil'), 'nuageux');
  const list = [];
  // un groupe serré de sept coureurs (sept voies sur une chaussée de 6 m) puis un second, 3 m derrière
  for (let i = 0; i < 7; i++) list.push({ sT: 100 + i * 0.2, half: 3 });
  for (let i = 0; i < 5; i++) list.push({ sT: 97 - i * 0.3, half: 3 });
  assignLanes(list);
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const A = list[a], B = list[b];
    if (Math.abs(A.sT - B.sT) < 1.9 && Math.abs(A.laneT - B.laneT) < 0.6) assert.fail(`deux coureurs l'un sur l'autre (${A.laneT}, ${B.laneT})`);
  }
  const narrow = [{ sT: 10, half: 0.9 }, { sT: 10.5, half: 0.9 }];
  assignLanes(narrow);
  assert.ok(narrow.every((o) => o.laneT === 0), 'chemin étroit : en file au milieu');
});

/* ---------- vélos et cyclistes ---------- */

/** Bike3D (univers cartoon) chargé à part, pour comparer les cotes des cadres. */
function bike3dCyclist() {
  const vm = require('vm');
  const BIKE3D = path.join(ROOT, 'VirtualRide3D', 'univers');
  const noop = new Proxy(function () {}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : noop), apply: () => undefined, set: () => true });
  const ctx = { console: { log() {}, warn() {}, error() {} }, document: { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['vendor/three.min.js', 'js/util.js', 'js/toon.js', 'js/anatomy.js', 'js/cyclist.js']) vm.runInContext(fs.readFileSync(path.join(BIKE3D, f), 'utf8'), ctx, { filename: f });
  return ctx.B3D.Cyclist;
}

test('réaliste : les cadres ont les cotes de Bike3D (selle, douille, boîtier, bidon, passage de roue du chrono)', async () => {
  const K = await imp('bike.js');
  const C = bike3dCyclist();
  for (const id of C.GEAR.frames) {
    const a = K.frameLayout(id), b = C.layout(id);
    for (const k of ['BB', 'saddle', 'htTop', 'htBot', 'stTop', 'frontAxle', 'rearAxle']) assert.ok(a[k].distanceTo(b[k]) < 1e-9, `${id} : ${k}`);
    assert.ok(Math.abs(a.dtHalf - b.dtHalf) < 1e-12, `${id} : tube oblique`);
    assert.equal(!!a.arc, !!b.arc, `${id} : tube oblique qui épouse la roue`);
  }
  // l'équipement inconnu prend des valeurs sûres
  const g = K.normGear({ frame: 'fusée', position: 'superman', sex: 'x' });
  assert.equal(g.frame, 'aero'); assert.equal(g.position, 'hoods'); assert.equal(g.sex, 'm');
  // chaque position de PaceYourRide a son plan (bassin sur la selle, mains sur le cintre)
  for (const pos of Object.keys(K.POSITIONS)) {
    const L = K.frameLayout(pos.startsWith('tt') ? 'tt' : 'aero');
    const P = K.plan(L, pos, false);
    assert.ok(P.pelvis.y > 0.95 && P.shoulder.y > P.pelvis.y, pos);
    assert.ok(P.hands[0].x < 0 && P.hands[1].x > 0, `${pos} : une main de chaque côté`);
  }
});

test('réaliste : le vélo en pièces (cadre, roues, pédalier) et sa version allégée au loin', async () => {
  const K = await imp('bike.js');
  const full = K.buildBike({ frame: 'tt', wheels: 'disc', tire: 'race', position: 'tt_pro' });
  for (const k of ['static', 'front', 'rear', 'crank']) {
    const g = full[k];
    assert.ok(g.index.count > 0 && g.attributes.aMat && g.attributes.color, k);
  }
  const low = K.buildBike({ frame: 'aero', wheels: 'c65' }, true);
  assert.equal(low.front, null);
  const tri = (g) => g.index.count / 3;
  const fullAero = K.buildBike({ frame: 'aero', wheels: 'c65' });
  assert.ok(tri(low.static) < 0.45 * (tri(fullAero.static) + tri(fullAero.front) + tri(fullAero.rear) + tri(fullAero.crank)), 'au loin : moins de la moitié des triangles');
});

test('réaliste : le corps du cycliste (une surface, 15 os, poids normalisés, zones de la tenue)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const G = K.normGear({ frame: 'aero', position: 'hoods', clothing: 'fitted', helmet: 'road', sex: 'm' });
  const L = K.frameLayout(G.frame), M = B.morphology('m');
  const J = B.joints(K.plan(L, G.position, false, M), Math.PI / 2, L.BB, M);
  const g = B.buildBody(J, G, 0.035);
  const n = g.attributes.position.count;
  assert.ok(n > 500, `${n} sommets`);
  const W = g.attributes.skinWeight.array, I = g.attributes.skinIndex.array;
  for (let i = 0; i < n; i++) {
    const s = W[i * 4] + W[i * 4 + 1] + W[i * 4 + 2] + W[i * 4 + 3];
    assert.ok(Math.abs(s - 1) < 1e-4, 'somme des poids = 1');
    for (let k = 0; k < 4; k++) assert.ok(I[i * 4 + k] < B.BONES.length);
  }
  const regions = new Set(Array.from(g.attributes.aRef.array).filter((v, i) => i % 4 === 3));
  for (const r of [B.REGION.SKIN, B.REGION.JERSEY, B.REGION.SHORTS, B.REGION.SHOE, B.REGION.HELMET]) assert.ok(regions.has(r), `zone ${r}`);
  // les os de la pose de référence : la matrice de chaque os, multipliée par l'inverse de sa référence, donne l'identité
  const inv = B.restInverse(J), ends = B.boneEnds(J);
  const THREE = await import('three');
  for (let b = 0; b < ends.length; b++) {
    const m = B.boneFrame(ends[b][0], ends[b][1], ends[b][2], new THREE.Matrix4()).multiply(inv[b]);
    assert.ok(m.equals(new THREE.Matrix4()) || m.elements.every((v, k) => Math.abs(v - new THREE.Matrix4().elements[k]) < 1e-9), BONES_NAME(B, b));
  }
  // pédalage : les pieds restent sur les pédales, le genou ne casse pas
  for (let c = 0; c < 6.3; c += 0.7) {
    const Jc = B.joints(K.plan(L, G.position, false, M), c, L.BB, M);
    for (const s of ['L', 'R']) {
      assert.ok(Math.abs(Jc['hip' + s].distanceTo(Jc['kn' + s]) - M.thigh) < 1e-6, 'cuisse de longueur fixe');
      assert.ok(Jc['kn' + s].z > Jc['hip' + s].z - 0.05, 'genou devant la hanche');
    }
  }
});
function BONES_NAME(B, b) { return 'os ' + B.BONES[b]; }

test('réaliste : posture d\'un coureur professionnel (hanches au-dessus de la selle, genou, buste, coudes, cheville)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const THREE = await import('three');
  const deg = (r) => r * 180 / Math.PI;
  for (const sex of ['m', 'f']) {
    const M = B.morphology(sex), L = K.frameLayout('aero');
    const P = K.plan(L, 'hoods', false, M);
    // les hanches sont au-dessus de la selle (les ischions sont posés dessus), les épaules au bout du buste
    const rise = P.pelvis.y - L.saddle.y;
    assert.ok(rise >= 0.07 - 1e-9 && rise <= 0.1 + 1e-9, `${sex} : hanches ${(rise * 100).toFixed(1)} cm au-dessus de la selle`);
    assert.ok(Math.abs(P.pelvis.distanceTo(P.shoulder) - M.torso) < 1e-9);
    const lean = (Q) => deg(Math.atan2(Q.shoulder.y - Q.pelvis.y, Q.shoulder.z - Q.pelvis.z));
    assert.ok(lean(P) > 30 && lean(P) < 42, `${sex} : buste à ${lean(P).toFixed(1)}° sur les cocottes`);
    assert.ok(lean(K.plan(L, 'drops', false, M)) < lean(P) - 8, 'plus bas en bas du cintre');
    assert.ok(lean(K.plan(K.frameLayout('tt'), 'tt_pro', false, M)) < 22, 'presque à plat en contre-la-montre');
    const S = K.plan(L, 'hoods', true, M);
    assert.ok(S.pelvis.y > P.pelvis.y + 0.05 && Math.abs(S.pelvis.z - L.BB.z) < 0.06, 'danseuse : hanches au-dessus du pédalier');
    // coudes fléchis sur les cocottes (jamais verrouillés)
    const J0 = B.joints(P, Math.PI / 2, L.BB, M);
    const elbow = deg(J0.shL.clone().sub(J0.elL).angleTo(J0.wrL.clone().sub(J0.elL)));
    assert.ok(elbow > 140 && elbow < 165, `${sex} : coude à ${elbow.toFixed(0)}°`);
    // un tour de pédale : le genou fléchi de 30 à 40° en bas, de 105 à 116° en haut ; la cheville travaille
    let kmin = 9, kmax = 0, pmin = 9, pmax = -9;
    for (let c = 0; c < Math.PI * 2; c += 0.05) {
      const J = B.joints(P, c, L.BB, M);
      for (const s of ['L', 'R']) {
        const flex = Math.PI - J['hip' + s].clone().sub(J['kn' + s]).angleTo(J['an' + s].clone().sub(J['kn' + s]));
        kmin = Math.min(kmin, flex); kmax = Math.max(kmax, flex);
        // pied : cheville au-dessus et en arrière de l'axe de la pédale, à distance fixe ; os du pied parallèle à la semelle
        const a = J['an' + s], p = J['pedal' + s], t = J['toe' + s];
        assert.ok(Math.abs(a.distanceTo(p) - Math.hypot(K.FOOT.up, K.FOOT.back)) < 1e-9, 'la cheville tourne autour de l\'axe de la pédale');
        const pitch = Math.atan2(a.y - t.y, t.z - a.z);
        pmin = Math.min(pmin, pitch); pmax = Math.max(pmax, pitch);
      }
    }
    assert.ok(deg(kmin) > 30 && deg(kmin) < 40, `${sex} : genou fléchi de ${deg(kmin).toFixed(1)}° en bas du coup de pédale`);
    assert.ok(deg(kmax) > 105 && deg(kmax) < 116, `${sex} : genou fléchi de ${deg(kmax).toFixed(1)}° en haut`);
    assert.ok(deg(pmin) > 4 && deg(pmin) < 12 && deg(pmax) > 28 && deg(pmax) < 36, `cheville : pied incliné de ${deg(pmin).toFixed(0)} à ${deg(pmax).toFixed(0)}°`);
    // la tête en avant des épaules, plus haut : le cou projeté vers la route
    assert.ok(J0.head.z > P.shoulder.z + 0.08 && J0.head.y > P.shoulder.y + 0.15, 'tête devant et au-dessus des épaules');
    // le bassin bascule un peu : la hanche de la jambe qui pousse descend
    const Jr = B.joints(P, 0, L.BB, M, { roll: 0.03 });
    assert.ok(Jr.hipR.y < Jr.hipL.y && Math.abs(Jr.hipR.y - Jr.hipL.y) < 0.01);
  }
  // le pied : presque à plat en poussant, talon relevé en remontant, plus haut en danseuse
  assert.ok(K.footPitch(Math.PI / 2, 0) < K.footPitch(0, 0) && K.footPitch(1.5 * Math.PI, 0) > K.footPitch(Math.PI, 0));
  assert.ok(K.footPitch(1, 1) > K.footPitch(1, 0) + 0.1);
  void THREE;
});

test('réaliste : fessiers en danseuse et au pédalage (pose de référence symétrique, fessier qui suit le bassin, pas de déchirure à l\'entrejambe)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const THREE = await import('three');
  const G = K.normGear({ frame: 'aero', position: 'hoods', clothing: 'fitted', helmet: 'road', sex: 'm' });
  const L = K.frameLayout(G.frame), M = B.morphology('m'), P = K.plan(L, 'hoods', false, M), S = K.plan(L, 'hoods', true, M);
  // pose de référence : les deux jambes à la même phase, la hanche entre sa flexion la plus forte et son ouverture la plus grande
  const J0 = B.restJoints(P, L.BB, M);
  assert.ok(Math.abs(B.hipAngle(J0, 'L') - B.hipAngle(J0, 'R')) < 1e-9 && Math.abs(J0.knL.z - J0.knR.z) < 1e-9, 'pose de référence symétrique');
  let lo = 9, hi = 0;
  for (let c = 0; c < Math.PI * 2; c += 0.05) { const a = B.hipAngle(B.joints(P, c, L.BB, M), 'L'); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  const a0 = B.hipAngle(J0, 'L');
  assert.ok(a0 > lo + 0.3 * (hi - lo) && a0 < hi - 0.2 * (hi - lo), `hanche de référence ${(a0 * 180 / Math.PI).toFixed(0)}° entre ${(lo * 180 / Math.PI).toFixed(0)} et ${(hi * 180 / Math.PI).toFixed(0)}°`);
  // le corps déformé comme sur la carte graphique (texture des os) : assis et en danseuse, jambes opposées
  const g = B.buildBody(J0, G, 0.016), inv = B.restInverse(J0);
  const pos = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, RW = g.attributes.aRegW, n = pos.count;
  const body = (i) => RW.getX(i) + RW.getY(i) + RW.getZ(i) + RW.getW(i) > 0.5;
  const skin = (J) => {
    const mats = B.boneEnds(J).map(([a, b, lat], k) => B.boneFrame(a, b, lat, new THREE.Matrix4()).multiply(inv[k]));
    const out = new Float32Array(n * 3), v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i); acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > 0) acc.addScaledVector(t.copy(v).applyMatrix4(mats[SI.getComponent(i, k)]), w); }
      out.set([acc.x, acc.y, acc.z], i * 3);
    }
    return { out, pinv: mats[B.B.pelvis].clone().invert() };
  };
  const idx = g.index.array, H = J0.pelvis;
  for (const [name, plan, crank, stand] of [['assis', P, Math.PI, 0], ['danseuse, pédale gauche en bas', S, Math.PI, 1], ['danseuse, pédale gauche en haut', S, 0, 1]]) {
    const { out, pinv } = skin(B.joints(plan, crank, L.BB, M, { stand }));
    // l'arrière des fessiers suit le bassin : il ne recule pas avec la cuisse quand la hanche s'ouvre (pas de bosse sous la fesse)
    const v = new THREE.Vector3();
    let back = 0;
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (!body(i) || z > H.z - 0.06 || y < H.y - 0.12 || y > H.y + 0.04 || Math.abs(x) < 0.02 || Math.abs(x) > 0.15) continue;
      v.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]).applyMatrix4(pinv);
      back = Math.max(back, z - v.z);
    }
    assert.ok(back < 0.025, `${name} : le fessier recule de ${(back * 100).toFixed(1)} cm par rapport au bassin`);
    // ni déchirure ni pli : autour du bassin et à l'entrejambe, aucune arête ne s'étire plus de 2,8 fois
    let worst = 0;
    for (let k = 0; k < idx.length; k += 3) for (let c = 0; c < 3; c++) {
      const a = idx[k + c], b = idx[k + (c + 1) % 3];
      if (!body(a) || !body(b) || Math.abs(pos.getY(a) - H.y) > 0.2 || pos.getZ(a) > H.z + 0.1) continue;
      const r = Math.hypot(pos.getX(a) - pos.getX(b), pos.getY(a) - pos.getY(b), pos.getZ(a) - pos.getZ(b));
      const d = Math.hypot(out[a * 3] - out[b * 3], out[a * 3 + 1] - out[b * 3 + 1], out[a * 3 + 2] - out[b * 3 + 2]);
      if (r > 1e-4) worst = Math.max(worst, d / r);
    }
    assert.ok(worst < 2.8, `${name} : étirement de la peau ${worst.toFixed(2)}`);
  }
  // chaque jambe ne tire que son côté : à gauche du milieu, aucun poids de la jambe droite (et inversement)
  for (let i = 0; i < n; i++) {
    if (!body(i) || Math.abs(pos.getX(i)) < 0.03) continue;
    for (let k = 0; k < 4; k++) {
      const b = SI.getComponent(i, k), w = SW.getComponent(i, k);
      if (w < 1e-3) continue;
      if (pos.getX(i) < 0) assert.ok(![B.B.thighR, B.B.shinR, B.B.footR].includes(b), 'la jambe droite ne tire pas le côté gauche');
      else assert.ok(![B.B.thighL, B.B.shinL, B.B.footL].includes(b), 'la jambe gauche ne tire pas le côté droit');
    }
  }
});

test('réaliste : pli sous la fesse discret, la cuisse dans le prolongement du buste (danseuse, de profil)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const THREE = await import('three');
  for (const sex of ['m', 'f']) {
    const G = K.normGear({ frame: 'aero', position: 'hoods', clothing: 'fitted', helmet: 'road', sex });
    const L = K.frameLayout(G.frame), M = B.morphology(sex), P = K.plan(L, 'hoods', false, M), S = K.plan(L, 'hoods', true, M);
    const J0 = B.restJoints(P, L.BB, M), g = B.buildBody(J0, G, 0.016), inv = B.restInverse(J0);
    const pos = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, RW = g.attributes.aRegW, n = pos.count;
    for (const [name, plan, stand] of [['danseuse', S, 1], ['assis', P, 0]]) {
      // pédale droite en bas : la hanche droite est ouverte au plus (danseuse : 140°, la cuisse presque dans le prolongement du buste)
      const J = B.joints(plan, 0.3, L.BB, M, { stand });
      if (stand) assert.ok(B.hipAngle(J, 'R') > 130 * Math.PI / 180, `hanche ouverte : ${(B.hipAngle(J, 'R') * 180 / Math.PI).toFixed(0)}°`);
      const mats = B.boneEnds(J).map(([a, b, lat], k) => B.boneFrame(a, b, lat, new THREE.Matrix4()).multiply(inv[k]));
      // de profil, dans le plan de la cuisse droite : distance à l'axe de la cuisse vers l'arrière, tous les 2 cm le long de la cuisse
      const hip = J.hipR, d = J.knR.clone().sub(hip).normalize(), back = new THREE.Vector3(0, d.z, -d.y);
      if (back.z > 0) back.negate();
      const prof = new Map(), v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        if (RW.getX(i) + RW.getY(i) + RW.getZ(i) + RW.getW(i) < 0.5) continue;
        v.fromBufferAttribute(pos, i); acc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) { const w = SW.getComponent(i, k); if (w > 0) acc.addScaledVector(t.copy(v).applyMatrix4(mats[SI.getComponent(i, k)]), w); }
        if (Math.abs(acc.x - hip.x) > 0.03) continue;
        acc.sub(hip);
        const b = Math.round(acc.dot(d) * 50);
        if (b >= -3 && b <= 7) prof.set(b, Math.max(prof.get(b) ?? -1, acc.dot(back)));
      }
      // pli : le creux du profil entre la fesse (au-dessus) et l'arrière de la cuisse (en dessous)
      const p = [...prof.keys()].sort((a, b) => a - b).map((k) => prof.get(k));
      let fold = 0;
      for (let i = 1; i + 1 < p.length; i++) fold = Math.max(fold, Math.min(Math.max(...p.slice(0, i)), Math.max(...p.slice(i + 1))) - p[i]);
      assert.ok(p.length >= 10 && fold < (stand ? 0.01 : 0.005), `${sex}, ${name} : pli de ${(fold * 100).toFixed(1)} cm sous la fesse`);
    }
  }
});

test('réaliste : le vélo sous le coureur (pieds sur les pédales, transmission à droite, disques à gauche, selle plate)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const G = K.normGear({ frame: 'aero', wheels: 'c45' });
  const bike = K.buildBike(G), L = bike.layout, M = B.morphology('m');
  const pos = (g) => g.attributes.position;
  // pédalier à crank = 0 : chaque pédale est du côté et à la hauteur du pied du coureur
  const J = B.joints(K.plan(L, 'hoods', false, M), 0, L.BB, M);
  for (const [s, sx] of [['L', -1], ['R', 1]]) {
    const p = pos(bike.crank);
    let y = 0, n = 0;
    for (let i = 0; i < p.count; i++) if (p.getX(i) * sx > 0.1) { y += p.getY(i); n++; }
    assert.ok(n > 0, 'pédale du côté ' + s);
    assert.ok(Math.abs(y / n - (J['pedal' + s].y - L.BB.y)) < 0.01, `pédale ${s} sous le pied : ${(y / n).toFixed(3)} contre ${(J['pedal' + s].y - L.BB.y).toFixed(3)}`);
  }
  // transmission à la droite du coureur (x < 0 : le repère a z vers l'avant et y en haut) : plateaux, cassette ; disques à gauche
  const side = (g, rmin, rmax) => {
    const p = pos(g);
    let lo = 1, hi = -1;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getY(i), p.getZ(i)); if (r > rmin && r < rmax && Math.abs(p.getX(i)) > 0.025) { lo = Math.min(lo, p.getX(i)); hi = Math.max(hi, p.getX(i)); } }
    return [lo, hi];
  };
  const rings = side(bike.crank, 0.09, 0.12);
  assert.ok(rings[1] < 0, `plateaux à droite : x de ${rings[0].toFixed(3)} à ${rings[1].toFixed(3)}`);
  const cogs = side(bike.rear, 0.03, 0.06);
  assert.ok(cogs[0] < -0.028 && cogs[1] < 0.05, 'cassette à droite');
  const rotor = side(bike.rear, 0.075, 0.085);
  assert.ok(rotor[1] > 0.03 && rotor[0] > -0.03 + 1e-9 || rotor[0] > 0, `disque à gauche : x de ${rotor[0].toFixed(3)} à ${rotor[1].toFixed(3)}`);
  // selle : une coque plate dont le dessus est à la hauteur de la selle (pas un cône de 17 cm de haut)
  const p = pos(bike.static), sad = L.saddle;
  let top = -1, low = 9;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i)) > 0.1 || p.getZ(i) < sad.z - 0.11 || p.getZ(i) > sad.z + 0.02) continue;
    if (p.getY(i) > sad.y - 0.06) { top = Math.max(top, p.getY(i)); if (Math.abs(p.getX(i)) > 0.03) low = Math.min(low, p.getY(i)); }
  }
  assert.ok(top > sad.y - 0.005 && top < sad.y + 0.02, `dessus de la selle : ${top.toFixed(3)} (selle à ${sad.y})`);
  assert.ok(low > sad.y - 0.035, `selle plate : ${(top - low).toFixed(3)} m d'épaisseur sur les côtés`);
});

test('réaliste : le corps (dos d\'un seul arc sans bosse, épaules rattachées au buste, fessiers posés sur la selle, raccords et ourlets)', async () => {
  const B = await imp('body.js');
  const K = await imp('bike.js');
  const G = K.normGear({ frame: 'aero', position: 'hoods', clothing: 'fitted', helmet: 'road', sex: 'm' });
  const L = K.frameLayout(G.frame), M = B.morphology('m');
  const J = B.joints(K.plan(L, G.position, false, M), Math.PI / 2, L.BB, M);
  const g = B.buildBody(J, G, 0.02);
  const P = g.attributes.position, N = g.attributes.normal, W = g.attributes.aRegW, n = P.count;
  const body = (i) => W.getX(i) + W.getY(i) + W.getZ(i) + W.getW(i) > 0.5;      // le corps (les accessoires n'ont pas de zone de tenue)
  // une seule surface : tous les sommets du corps tiennent ensemble
  const parent = new Int32Array(n).map((v, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const idx = g.index.array;
  for (let k = 0; k < idx.length; k += 3) { const a = find(idx[k]), b = find(idx[k + 1]), c = find(idx[k + 2]); parent[b] = a; parent[find(c)] = a; }
  const roots = new Set();
  for (let i = 0; i < n; i++) if (body(i)) roots.add(find(i));
  assert.equal(roots.size, 1, 'le corps est une seule surface');
  // dos : la hauteur du dos au-dessus de la droite hanches-cou monte puis redescend, d'un seul arc (ni bosse ni creux de plus de 4 mm)
  const tdir = J.neck.clone().sub(J.pelvis), len = tdir.length();
  tdir.normalize();
  const dorsal = { y: tdir.z, z: -tdir.y };
  const bins = new Array(14).fill(-1);
  for (let i = 0; i < n; i++) {
    if (!body(i) || Math.abs(P.getX(i)) > 0.03) continue;
    const dy = P.getY(i) - J.pelvis.y, dz = P.getZ(i) - J.pelvis.z, s = (dy * tdir.y + dz * tdir.z) / len, h = dy * dorsal.y + dz * dorsal.z;
    if (s < 0.12 || s > 0.9 || N.getY(i) * dorsal.y + N.getZ(i) * dorsal.z < 0.5) continue;
    const b = Math.min(13, Math.floor((s - 0.12) / 0.78 * 14));
    bins[b] = Math.max(bins[b], h);
  }
  assert.ok(bins.every((h) => h > 0.05), 'le dos est échantillonné sur toute sa longueur');
  const peak = bins.indexOf(Math.max(...bins));
  for (let b = 1; b < bins.length; b++) {
    if (b <= peak) assert.ok(bins[b] > bins[b - 1] - 0.004, `dos : pas de creux avant le sommet (${bins.map((h) => h.toFixed(3)).join(' ')})`);
    else assert.ok(bins[b] < bins[b - 1] + 0.004, `dos : pas de bosse après le sommet (${bins.map((h) => h.toFixed(3)).join(' ')})`);
  }
  assert.ok(Math.max(...bins) - Math.min(bins[0], bins[13]) < 0.06, 'dos rond sans excès');
  // épaules : du cou à l'épaule, le buste garde au moins 9 cm d'épaisseur (pas un fil entre le cou et une boule)
  for (const sx of [-1, 1]) {
    const sh = J[sx < 0 ? 'shL' : 'shR'];
    for (const t of [0.3, 0.5, 0.7, 0.9]) {
      const cx = J.neck.x + (sh.x - J.neck.x) * t, cy = J.neck.y + (sh.y - J.neck.y) * t, cz = J.neck.z + (sh.z - J.neck.z) * t;
      let lo = 9, hi = -9;
      for (let i = 0; i < n; i++) {
        if (!body(i) || Math.abs(P.getX(i) - cx) > 0.02 || Math.hypot(P.getY(i) - cy, P.getZ(i) - cz) > 0.16) continue;
        const h = (P.getY(i) - cy) * dorsal.y + (P.getZ(i) - cz) * dorsal.z;
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      assert.ok(hi - lo > 0.09, `épaule rattachée au buste (à ${t} du cou) : ${(hi - lo).toFixed(3)} m d'épaisseur`);
    }
  }
  // fessiers : posés sur la selle (ni dessous, ni loin derrière), pas plus larges que les épaules
  let ymin = 9, zmin = 9, xmax = 0;
  for (let i = 0; i < n; i++) {
    if (!body(i) || P.getZ(i) > J.pelvis.z - 0.02 || P.getY(i) > J.pelvis.y + 0.1 || P.getY(i) < J.pelvis.y - 0.2) continue;   // le bassin, derrière les hanches
    if (Math.abs(P.getX(i)) > 0.085) continue;                       // (la selle : 7 à 9 cm de demi-largeur)
    ymin = Math.min(ymin, P.getY(i)); zmin = Math.min(zmin, P.getZ(i));
  }
  for (let i = 0; i < n; i++) if (body(i) && Math.abs(P.getY(i) - J.pelvis.y) < 0.06 && P.getZ(i) < J.pelvis.z + 0.05) xmax = Math.max(xmax, Math.abs(P.getX(i)));
  assert.ok(ymin > L.saddle.y - 0.035, `les fessiers ne descendent pas sous la selle : ${(ymin - L.saddle.y).toFixed(3)} m`);
  assert.ok(zmin > L.saddle.z - 0.16, `ni loin derrière elle : ${(zmin - L.saddle.z).toFixed(3)} m`);
  assert.ok(xmax < M.shoulderX + 0.06 && xmax > 0.14, `hanches : ${xmax.toFixed(3)} m de demi-largeur`);
  // raccords : autour de la hanche, des sommets partagés entre le bassin et la cuisse (le bas des fessiers suit la cuisse)
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  let shared = 0, edges = 0;
  for (let i = 0; i < n; i++) {
    if (!body(i)) continue;
    let wp = 0, wt = 0;
    for (let k = 0; k < 4; k++) { const b = SI.getComponent(i, k), w = SW.getComponent(i, k); if (b === B.B.pelvis) wp += w; if (b === B.B.thighL || b === B.B.thighR) wt += w; }
    if (wp > 0.2 && wt > 0.2) shared++;
    // ourlets : de part et d'autre d'un bord de la tenue, deux zones se partagent le sommet (la ligne est nette entre les sommets)
    const ws = [W.getX(i), W.getY(i), W.getZ(i), W.getW(i)];
    assert.ok(Math.abs(ws[0] + ws[1] + ws[2] + ws[3] - 1) < 1e-5, 'poids des zones de la tenue');
    if (ws.filter((w) => w > 0.02).length === 2) edges++;
  }
  assert.ok(shared > 20, `sommets partagés entre le bassin et les cuisses : ${shared}`);
  assert.ok(edges > 40, `sommets sur un ourlet : ${edges}`);
});


test('réaliste : la route lissée passe par les points de Bike3D, tangentes unitaires', async () => {
  const vm = require('vm');
  const U = path.join(ROOT, 'VirtualRide3D', 'univers');
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['js/util.js', 'js/route.js']) vm.runInContext(fs.readFileSync(path.join(U, f), 'utf8'), ctx, { filename: f });
  const xml = fs.readFileSync(path.join(U, 'samples/col-hors-categorie.gpx'), 'utf8');
  const pts = [...xml.matchAll(/lat="([\d.-]+)" lon="([\d.-]+)">\s*<ele>([\d.-]+)/g)].map((m) => ({ lat: +m[1], lon: +m[2], ele: +m[3] }));
  const route = new ctx.B3D.Route({ name: 'hc', points: pts });
  const { RoadPath } = await imp('road.js');
  const P = new RoadPath(route), q = {};
  for (let i = 1; i < route.n - 2; i += 37) {
    P.sample(i * route.spacing, q);
    assert.ok(Math.hypot(q.x - route.x[i], q.z - route.z[i]) < 1e-6, 'passe par les échantillons');
    assert.ok(Math.abs(Math.hypot(q.tx, q.tz) - 1) < 1e-9);
    P.sample((i + 0.5) * route.spacing, q);
    const mx = (route.x[i] + route.x[i + 1]) / 2, mz = (route.z[i] + route.z[i + 1]) / 2;
    assert.ok(Math.hypot(q.x - mx, q.z - mz) < 1.5, 'reste près du tracé entre deux échantillons (lacets arrondis)');
  }
});
