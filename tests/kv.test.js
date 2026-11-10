/* author : Hugo Joudrier-Faure */
/* Stockage IndexedDB avec cache synchrone (Commun/js/core/kv.js) : faux fond asynchrone et faux localStorage, aucun navigateur. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require(path.join(__dirname, '..', 'Commun/js/core/kv.js'));
const PYR = globalThis.PYR;

/** Faux localStorage (avec key() et length, comme le vrai). */
function fakeLs(quota = Infinity) {
  const m = new Map();
  return {
    m, getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const total = [...m].reduce((n, [a, b]) => n + (a === k ? 0 : a.length + b.length), 0) + k.length + String(v).length; if (total > quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}
/** Faux fond asynchrone : un Map, des écritures qu'on peut retarder ou faire échouer. */
function fakeBackend(initial = {}) {
  const data = new Map(Object.entries(initial)), log = [];
  const b = {
    data, log, failWrites: false, hold: null,
    async getAll() { return [...data]; },
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async write(entries) {
      if (b.hold) await b.hold;
      if (b.failWrites) { const e = new Error('plein'); e.name = 'QuotaExceededError'; throw e; }
      log.push(entries.map((e) => e[0]));
      for (const [k, v] of entries) { if (v === undefined) data.delete(k); else data.set(k, v); }
    },
  };
  return b;
}
const make = (backend, ls, extra = {}) => PYR.kvCreate(Object.assign({ backend, ls: () => ls, emit: () => {} }, extra));

test('kv : au démarrage le cache reçoit tout IndexedDB, et la lecture est synchrone', async () => {
  const kv = make(fakeBackend({ a: '1', b: '2' }), fakeLs());
  await kv.ready;
  assert.equal(kv.mode, 'idb');
  assert.equal(kv.getItem('a'), '1');
  assert.equal(kv.getItem('zz'), null);
});

test('kv : setItem répond tout de suite et écrit ensuite ; les écritures d\'un même tour sont groupées', async () => {
  const be = fakeBackend(), kv = make(be, fakeLs());
  await kv.ready;
  kv.setItem('p', 'v1'); kv.setItem('p', 'v2'); kv.setItem('q', 'x');
  assert.equal(kv.getItem('p'), 'v2');
  assert.equal(be.data.has('p'), false, 'pas encore écrit : l\'écriture est asynchrone');
  await kv.flush();
  assert.equal(be.data.get('p'), 'v2');
  assert.equal(be.log.length, 1, 'une seule transaction');
});

test('kv : une clé absente d\'IndexedDB est reprise de localStorage, puis déplacée', async () => {
  const be = fakeBackend(), ls = fakeLs();
  ls.setItem('paceyourride.v1', '{"route":1}');
  const kv = make(be, ls);
  await kv.ready;
  assert.equal(kv.getItem('paceyourride.v1'), '{"route":1}');
  await kv.flush();
  assert.equal(be.data.get('paceyourride.v1'), '{"route":1}');
  assert.equal(ls.getItem('paceyourride.v1'), null, 'l\'ancienne copie est retirée une fois celle d\'IndexedDB confirmée');
});

test('kv : IndexedDB l\'emporte sur une ancienne copie de localStorage', async () => {
  const ls = fakeLs(); ls.setItem('k', 'ancien');
  const kv = make(fakeBackend({ k: 'nouveau' }), ls);
  await kv.ready;
  assert.equal(kv.getItem('k'), 'nouveau');
});

test('kv : removeItem retire de partout et la clé ne revient pas', async () => {
  const be = fakeBackend({ k: 'v' }), ls = fakeLs(); ls.setItem('k', 'v');
  const kv = make(be, ls);
  await kv.ready;
  kv.removeItem('k');
  assert.equal(kv.getItem('k'), null);
  await kv.flush();
  assert.equal(be.data.has('k'), false);
  assert.equal(ls.getItem('k'), null);
});

test('kv : sans fond (pas d\'IndexedDB), tout passe par localStorage', async () => {
  const ls = fakeLs(), kv = make(null, ls);
  await kv.ready;
  assert.equal(kv.mode, 'ls');
  kv.setItem('a', '1');
  assert.equal(ls.getItem('a'), '1');
  assert.equal(kv.getItem('a'), '1');
  kv.removeItem('a');
  assert.equal(ls.getItem('a'), null);
  const full = make(null, fakeLs(5));
  assert.throws(() => full.setItem('gros', 'x'.repeat(50)), /quota/, 'en mode localStorage, un quota dépassé lève comme avant');
});

test('kv : une base illisible au démarrage repasse sur localStorage et le dit', async () => {
  const events = [], ls = fakeLs(); ls.setItem('a', '1');
  const be = { getAll: async () => { throw new Error('base corrompue'); }, get: async () => null, write: async () => {} };
  const kv = make(be, ls, { emit: (n, d) => events.push([n, d]) });
  await kv.ready;
  assert.equal(kv.mode, 'ls');
  assert.equal(kv.getItem('a'), '1');
  assert.equal(events[0][0], 'pyr:kv-error');
});

test('kv : une écriture refusée garde la valeur ailleurs (localStorage) ou prévient quand rien ne tient', async () => {
  const events = [], be = fakeBackend(), ls = fakeLs(100);
  const kv = make(be, ls, { emit: (n, d) => events.push([n, d]) });
  await kv.ready;
  be.failWrites = true;
  kv.setItem('petit', 'ok');
  kv.setItem('gros', 'x'.repeat(500));
  await kv.flush();
  assert.equal(ls.getItem('petit'), 'ok', 'une petite valeur est gardée dans localStorage');
  assert.equal(kv.getItem('gros').length, 500, 'la page ouverte garde sa valeur');
  assert.deepEqual(events.map((e) => [e[0], e[1].key]), [['pyr:kv-error', 'gros']]);
});

test('kv : journal() copie dans localStorage ce qu\'IndexedDB n\'a pas confirmé, et la page suivante le reprend', async () => {
  const be = fakeBackend(), ls = fakeLs();
  let release; be.hold = new Promise((r) => { release = r; });
  const kv = make(be, ls);
  await kv.ready;
  kv.setItem('projet', '{"v":2}');
  kv.removeItem('vieux');
  await new Promise((r) => setImmediate(r));          // l'écriture est partie mais pas confirmée
  kv.setItem('autre', 'y');                           // et une autre attend son tour
  kv.journal();                                       // la page se ferme
  assert.equal(ls.getItem('pyr.kvj.projet'), '{"v":2}');
  assert.equal(ls.getItem('pyr.kvj.autre'), 'y');
  assert.equal(ls.getItem('pyr.kvj.vieux'), '\u0000');
  // la page suivante : IndexedDB n'a jamais reçu l'écriture
  const be2 = fakeBackend({ projet: '{"v":1}', vieux: 'x' });
  const kv2 = make(be2, ls);
  await kv2.ready;
  assert.equal(kv2.getItem('projet'), '{"v":2}', 'le journal est plus récent qu\'IndexedDB');
  assert.equal(kv2.getItem('vieux'), null);
  await kv2.flush();
  assert.equal(be2.data.get('projet'), '{"v":2}');
  assert.equal(be2.data.has('vieux'), false);
  assert.equal([...ls.m.keys()].some((k) => k.startsWith('pyr.kvj.')), false, 'le journal est vidé une fois repris');
  release();
});

test('kv : une écriture confirmée efface son journal', async () => {
  const be = fakeBackend(), ls = fakeLs(), kv = make(be, ls);
  await kv.ready;
  kv.setItem('a', '1');
  kv.journal();
  assert.equal(ls.getItem('pyr.kvj.a'), '1');
  await kv.flush();
  assert.equal(ls.getItem('pyr.kvj.a'), null);
});

test('kv : un message d\'une autre page relit la clé et prévient', async () => {
  const be = fakeBackend({ k: 'v1' }), events = [], channel = {};
  const kv = make(be, fakeLs(), { channel, emit: (n, d) => events.push([n, d.key]) });
  await kv.ready;
  assert.equal(kv.getItem('k'), 'v1');
  be.data.set('k', 'v2');                             // écrit par une autre page
  channel.onmessage({ data: { keys: ['k'] } });
  await new Promise((r) => setImmediate(r));
  assert.equal(kv.getItem('k'), 'v2');
  assert.deepEqual(events, [['pyr:kv', 'k']]);
});

test('kv : les écritures sont annoncées aux autres pages une fois confirmées', async () => {
  const posted = [], kv = make(fakeBackend(), fakeLs(), { channel: { postMessage: (m) => posted.push(m) } });
  await kv.ready;
  kv.setItem('a', '1');
  assert.equal(posted.length, 0);
  await kv.flush();
  assert.deepEqual(posted, [{ keys: ['a'] }]);
});

test('kv : refresh relit IndexedDB (page revenue du cache arrière/avant) sans perdre une écriture en attente', async () => {
  const be = fakeBackend({ a: '1' }), events = [];
  const kv = make(be, fakeLs(), { emit: (n, d) => events.push(d.key) });
  await kv.ready;
  be.data.set('a', '2'); be.data.set('b', 'neuf');
  kv.setItem('c', 'local');
  await kv.refresh();
  assert.equal(kv.getItem('a'), '2');
  assert.equal(kv.getItem('b'), 'neuf');
  assert.equal(kv.getItem('c'), 'local');
  assert.deepEqual(events.sort(), ['a', 'b']);
});

test('kv : un gros projet (400 km) passe sans toucher à localStorage', async () => {
  const be = fakeBackend(), ls = fakeLs(5.2e6), kv = make(be, ls);
  await kv.ready;
  const big = JSON.stringify({ route: { legs: [{ coords: Array.from({ length: 80000 }, (_, i) => [+(45 + i * 1.1e-5).toFixed(6), +(6.123456 + Math.sin(i / 300) * 0.01).toFixed(6), +(800 + (i % 500) / 3).toFixed(1)]) }] } });
  assert.ok(big.length > 1.5e6, `taille ${big.length}`);
  for (const k of ['projet', 'bibliotheque', 'copie-nuage', 'sauvegarde']) kv.setItem(k, big);       // 4 copies : 4 fois plus que le quota de localStorage
  await kv.flush();
  assert.equal(be.data.get('projet').length, big.length);
  assert.equal(ls.m.size, 0);
  assert.throws(() => { for (const k of ['a', 'b', 'c', 'd']) ls.setItem(k, big); }, /quota/, 'les mêmes données ne tenaient pas dans localStorage');
});
