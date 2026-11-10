/* author : Hugo Joudrier-Faure */
/* Allègement des tracés (util.thinCoords), extraction d'un parcours pour la bibliothèque et profil avec altitudes manquantes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
for (const f of ['Commun/js/core/util.js', 'Commun/js/core/library.js']) require(path.join(__dirname, '..', f));
const PYR = globalThis.PYR, U = PYR.util, L = PYR.library;

/** Tracé sinueux de `km` kilomètres, un point tous les `stepM` mètres. */
function track(km, stepM, withEle = true) {
  const n = Math.round((km * 1000) / stepM) + 1, out = [];
  for (let i = 0; i < n; i++) out.push([45 + (i * stepM) / 111195, 6 + 0.002 * Math.sin(i / 400), withEle ? 800 + 300 * Math.sin(i / 700) : null]);
  return out;
}
const length = (c) => { let m = 0; for (let i = 1; i < c.length; i++) m += U.haversine(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]); return m; };

test('thinCoords : garde les extrémités, espace les points d\'au moins 10 m, longueur quasi inchangée', () => {
  const c = track(400, 5), t = U.thinCoords(c);
  assert.ok(t.length <= c.length / 2 + 1, `${t.length} points gardés sur ${c.length}`);
  assert.equal(t[0], c[0]);
  assert.equal(t[t.length - 1], c[c.length - 1]);
  for (let i = 1; i < t.length - 1; i++) assert.ok(U.haversine(t[i - 1][0], t[i - 1][1], t[i][0], t[i][1]) >= 10 - 1e-6);
  assert.ok(Math.abs(length(t) - length(c)) / length(c) < 0.005, 'la longueur change de moins de 0,5 %');
});

test('thinCoords : idempotent, et laisse un tracé déjà espacé intact', () => {
  const t = U.thinCoords(track(50, 5));
  assert.equal(U.thinCoords(t), t);
  const sparse = track(50, 100);
  assert.equal(U.thinCoords(sparse), sparse);
  assert.deepEqual(U.thinCoords([[0, 0, 1]]), [[0, 0, 1]]);
});

test('library.extract (parcours) : allège les tronçons sans toucher au projet d\'origine', () => {
  const coords = track(30, 5);
  const state = { route: { name: 'x', legs: [{ coords }] }, surfaces: [], winds: [] };
  const d = L.extract('route', state);
  assert.ok(d.route.legs[0].coords.length < coords.length);
  assert.equal(state.route.legs[0].coords.length, coords.length);
  assert.ok(Math.abs(L.routeLength(d) - L.routeLength(state)) / L.routeLength(state) < 0.005);
  assert.deepEqual(L.extract('route', { route: d.route }).route.legs[0].coords, d.route.legs[0].coords, 'extraire un parcours déjà allégé ne le change plus');
});

test('routeProfile : altitudes manquantes interpolées, en temps linéaire', () => {
  const c = track(40, 10);                      // 4 000 points
  const holes = c.map((p, i) => (i % 3 === 1 || i % 7 === 2 ? [p[0], p[1], null] : p));
  const full = L.routeProfile({ route: { legs: [{ coords: c }] } }), part = L.routeProfile({ route: { legs: [{ coords: holes }] } });
  assert.equal(part.n, full.n);
  assert.ok(part.hasEle);
  assert.ok(Math.abs(part.up - full.up) / full.up < 0.05, 'le dénivelé reste proche malgré les trous');
  // 60 000 points avec des trous : plus d'une seconde en O(n²) avant correction
  const big = track(600, 10).map((p, i) => (i % 2 ? [p[0], p[1], null] : p));
  const t0 = Date.now();
  assert.ok(L.routeProfile({ route: { legs: [{ coords: big }] } }));
  assert.ok(Date.now() - t0 < 1000, `routeProfile a pris ${Date.now() - t0} ms`);
});

test('routeProfile : début et fin sans altitude prennent la valeur connue la plus proche', () => {
  const c = track(5, 10).map((p, i, a) => (i < 5 || i > a.length - 6 ? [p[0], p[1], null] : p));
  const p = L.routeProfile({ route: { legs: [{ coords: c }] } });
  assert.ok(Number.isFinite(p.ele[0]) && Number.isFinite(p.ele[p.n - 1]));
});

test('routeLength(…, true) : un ancien parcours dense et son extrait allégé ont la même longueur comparée', () => {
  const dense = { route: { legs: [{ coords: track(120, 4).map((p, i) => [p[0], p[1] + (i % 2 ? 3e-5 : 0), p[2]]) }] } };      // bruit du GPS : un point sur deux décalé d'environ 2 m
  const thin = L.extract('route', dense);
  assert.ok(Math.abs(L.routeLength(dense, true) - L.routeLength(thin, true)) < 2);
  assert.ok(Math.abs(L.routeLength(dense) - L.routeLength(thin)) > 2, 'sans allègement, l\'écart dépasse la tolérance de 2 m de l\'accueil');
});
