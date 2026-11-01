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
