/* author : Hugo Joudrier-Faure */
/* Tests de « Ciel et Météo » de Virtual Ride 3D (Commun/js/jeu/view3d.js) : réglages lus dans l'état, heure et jour du ciel à partir de la date de départ et
 * de la vitesse du temps, conditions envoyées à la vue selon la source de la météo (du parcours, réelle, du jeu). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PYR, makeProfile, setupFor } = require('./helpers.js');
require(path.join(__dirname, '..', 'Commun', 'js', 'jeu', 'view3d.js'));
const V3 = PYR.view3d;

const state = (g, w) => ({ game: Object.assign({ skyMode: 'game', skyWeather: 'random', skyWind: 'random', skyFlow: 1 }, g), weather: Object.assign({ startAt: '2026-07-15T14:30', enabled: false, snapshot: null, utcOffset: 0 }, w) });

test('ciel : réglages lus dans l\'état ; sans météo utilisable, le ciel du jeu', () => {
  PYR.appId = 'jeu3d';
  assert.deepEqual(V3.skySettings(state({ skyWeather: 'storm', skyWind: 'strong', skyFlow: 60 })), { mode: 'game', weather: 'storm', wind: 'strong', flow: 60, startAt: '2026-07-15T14:30', off: null });
  // la météo du parcours ou réelle ne vaut que si elle est là (activée, avec ses prévisions)
  assert.equal(V3.skySettings(state({ skyMode: 'real' })).mode, 'game');
  assert.equal(V3.skySettings(state({ skyMode: 'course' }, { enabled: true })).mode, 'game');
  const ok = V3.skySettings(state({ skyMode: 'real' }, { enabled: true, snapshot: { v: 1 }, utcOffset: 7200 }));
  assert.equal(ok.mode, 'real'); assert.equal(ok.off, 2);
  // valeurs absurdes : ramenées aux valeurs par défaut ; vitesse 0 = ciel figé
  assert.equal(V3.skySettings(state({ skyMode: 'xx', skyFlow: -3 })).mode, 'game');
  assert.equal(V3.skySettings(state({ skyMode: 'xx', skyFlow: -3 })).flow, 1);
  assert.equal(V3.skySettings(state({ skyFlow: 0 })).flow, 0);
  // les autres applications gardent le ciel de leur vue
  PYR.appId = 'jeu2d';
  assert.equal(V3.skySettings(state({})), null);
  PYR.appId = 'jeu3d';
});

test('ciel : l\'heure et le jour viennent de la date de départ et de la vitesse du temps', () => {
  const c0 = V3.clockAt('2026-07-15T14:30', 0);
  assert.equal(c0.hour, 14.5); assert.equal(c0.doy, 196);
  // une heure de course à ×1 : 15 h 30 ; à ×60 : 60 h plus tard, soit le surlendemain à 2 h 30
  assert.equal(V3.clockAt('2026-07-15T14:30', 3600).hour, 15.5);
  const c60 = V3.clockAt('2026-07-15T14:30', 3600 * 60);
  assert.equal(c60.hour, 2.5); assert.equal(c60.doy, 199);
  // passage d'une année à l'autre
  assert.equal(V3.clockAt('2026-12-31T23:00', 7200).doy, 1);
  assert.equal(V3.clockAt('pas une date', 0), null);
});

test('ciel : conditions envoyées à la vue selon la source de la météo', () => {
  const { course } = setupFor(makeProfile([{ len: 4000, grade: 0.02 }]));
  const sky = (o) => Object.assign({ mode: 'game', weather: 'random', wind: 'random', flow: 1, startAt: '2026-07-15T14:30', off: null }, o);
  // météo du jeu : seulement l'heure et le jour (la vue tire elle-même le temps et le vent) ; vitesse du temps ×60
  const g = V3.skyEnv(course, 500, 600, sky({ flow: 60 }));
  assert.deepEqual(Object.keys(g).sort(), ['doy', 'hour']);
  assert.equal(g.hour, 0.5);                 // 14 h 30 + 10 h de ciel = 0 h 30 le lendemain
  assert.equal(g.doy, 197);
  // ciel figé : l'heure du départ, toute la course
  assert.equal(V3.skyEnv(course, 3000, 5000, sky({ flow: 0 })).hour, 14.5);
  // météo réelle ou du parcours : lue à la position, à l'heure du ciel (t × vitesse), et l'heure et le jour sont ceux du départ choisi
  course.weather = { v: 1, start: Date.UTC(2026, 6, 15, 12, 30) / 1000, off: 7200, t0: Date.UTC(2026, 6, 15, 12) / 1000, n: 3, stations: [{ s: 0, lat: 45, lng: 6, ele: 500 }],
    T: [[10, 12, 14]], rain: [[0, 0, 6]], ws: [[3, 4, 5]], wd: [[90, 90, 90]], gust: [[5, 6, 7]], rh: [[60, 60, 60]], wet: [[0, 0, 1]], p: [[900, 900, 900]] };
  const r = V3.skyEnv(course, 500, 0, sky({ mode: 'real' }));
  assert.ok(Number.isFinite(r.rain) && Number.isFinite(r.ws) && Number.isFinite(r.T), JSON.stringify(r));
  assert.equal(r.hour, 14.5);
  const late = V3.skyEnv(course, 500, 3600 * 1.5 / 30, sky({ mode: 'real', flow: 30 }));    // 3 min de course à ×30 = 1 h 30 de ciel
  assert.ok(late.rain > r.rain, `la pluie arrive : ${r.rain} → ${late.rain}`);
  assert.equal(late.hour, 16);
  // sans réglage (autres applications) : la météo de la simulation à l'heure de course, comme avant
  assert.deepEqual(V3.skyEnv(course, 500, 0, null), V3.envAt(course, 500, 0));
});

test('ciel : les images portent l\'heure du ciel et les réglages ne sont envoyés qu\'avec la première image et à chaque changement', () => {
  const { course } = setupFor(makeProfile([{ len: 2000, grade: 0 }]));
  const base = { course, cps: [], feed: [], t: 120, k: 1, run: true, me: { id: 'me', name: 'Moi', s: 100, v: 8, kind: 'avatar' }, others: [] };
  const sky = { mode: 'game', weather: 'rain', wind: 'calm', flow: 30, startAt: '2026-07-15T09:00', off: null };
  const m = V3.frameMessage(Object.assign({}, base, { sky }));
  assert.equal(m.env.hour, 10);              // 9 h + 2 min de course × 30 = 10 h
  assert.equal(m.sky, undefined, 'les réglages ne sont pas dans chaque image (publish les ajoute à la première)');
});
