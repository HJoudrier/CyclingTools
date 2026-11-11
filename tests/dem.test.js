/* author : Hugo Joudrier-Faure */
/* Tests du relief réel de Virtual Ride 3D (VirtualRide3D/univers/js/dem.js) : tuiles Terrarium (décodage, Mercator, couloir de tuiles
 * autour du tracé, choix du zoom, altitude interpolée), et paysage cartoon posé sur un relief réel (js/landscape.js, option dem) :
 * la route garde son altitude, le terrain suit la carte recalée sur la route, et sans relief réel rien ne change. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const U = path.join(__dirname, '..', 'VirtualRide3D', 'univers');

/** Bike3D chargé à part dans un contexte : les fichiers demandés (après util.js). */
function load(files) {
  const ctx = { console: { log() {}, warn() {}, error() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(U, f), 'utf8'), ctx, { filename: f });
  return ctx.B3D;
}

const B = load(['js/util.js', 'js/dem.js']);
const D = B.Dem;

/** Point à (est, nord) mètres de (lat0, lon0). */
function offset(lat0, lon0, east, north) {
  const R = 6371000, k = Math.PI / 180;
  return { lat: lat0 + north / (R * k), lon: lon0 + east / (R * k * Math.cos(lat0 * k)) };
}
/** Tracé rectiligne vers l'est : un point tous les `step` mètres. */
function straight(lat0, lon0, len, step = 50) {
  const out = [];
  for (let d = 0; d <= len; d += step) out.push(offset(lat0, lon0, d, 0));
  return out;
}

test('relief réel : altitude codée dans les tuiles Terrarium, décodée en quarts de mètre (la mer à 0 m)', () => {
  assert.equal(D.terrarium(128, 0, 0), 0);
  assert.equal(D.terrarium(131, 232, 0), 1000);
  assert.equal(D.terrarium(131, 232, 64), 1000.25);
  const px = [128, 0, 0, 255, 131, 232, 64, 255, 127, 206, 0, 255, 140, 202, 0, 255];
  assert.deepEqual(Array.from(D.decode(px)), [0, 4001, 0, 4 * (12 * 256 + 202)], 'mer (−50 m) ramenée à 0 m');
});

test('relief réel : Mercator aller et retour, mètres par pixel', () => {
  for (const [lat, lon] of [[45.2, 6.1], [-33.9, 151.2], [64.1, -21.9]]) {
    const p = D.mercPx(lat, lon, 14), q = D.lonLatOfPx(p.x, p.y, 14);
    assert.ok(Math.abs(q.lat - lat) < 1e-9 && Math.abs(q.lon - lon) < 1e-9);
  }
  assert.ok(Math.abs(D.mPerPx(0, 0) - 156543.03) < 0.01, 'zoom 0 à l\'équateur');
  assert.ok(Math.abs(D.mPerPx(45, 14) - 6.75) < 0.01, '≈ 7 m par pixel au zoom 14 à 45°');
});

test('relief réel : le couloir de tuiles couvre tout point à moins de la marge du tracé', () => {
  const samples = straight(45.1, 5.9, 12000);
  const z = 14, set = new Set(D.corridorTiles(samples, z));
  for (const p of samples) {
    for (const [e, n] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7]]) {
      const q = offset(p.lat, p.lon, e * D.MARGIN * 0.99, n * D.MARGIN * 0.99), m = D.mercPx(q.lat, q.lon, z);
      assert.ok(set.has(D.tileKey(Math.floor(m.x / 256), Math.floor(m.y / 256))), 'tuile du couloir');
    }
  }
  const core = D.corridorTiles(samples, z, 0);
  assert.ok(core.length < set.size && core.every((k) => set.has(k)), 'les tuiles traversées par la route sont dans le couloir');
});

test('relief réel : zoom le plus fin qui tient en MAX_TILES tuiles, le même pour tous les joueurs', () => {
  const short = D.pickZoom(straight(45.1, 5.9, 8000));
  assert.equal(short.z, D.MAX_ZOOM, 'court parcours : zoom 14');
  assert.ok(short.tiles.length <= D.MAX_TILES);
  const longS = straight(45.1, 1.5, 400000, 100);
  const long = D.pickZoom(longS);
  assert.ok(long.z < D.MAX_ZOOM && long.tiles.length <= D.MAX_TILES, 'long parcours : un zoom plus large');
  assert.ok(D.corridorTiles(longS, long.z + 1).length > D.MAX_TILES, 'le zoom suivant aurait trop de tuiles');
  assert.deepEqual(D.pickZoom(longS), long, 'déterministe');
});

test('relief réel : altitude interpolée entre les pixels, d\'une tuile à l\'autre ; NaN hors des tuiles', () => {
  const z = 10, tx = 530, ty = 365;
  // deux tuiles côte à côte : altitude = un quart de mètre par colonne, plus 2 m par ligne
  const tiles = new Map();
  for (const t of [tx, tx + 1]) {
    const a = new Int16Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) a[j * 256 + i] = (t - tx) * 256 + i + 8 * j;
    tiles.set(D.tileKey(t, ty), a);
  }
  const dem = D.fromTiles(z, tiles);
  const at = (gx, gy) => { const p = D.lonLatOfPx(gx, gy, z); return dem.at(p.lat, p.lon); };
  const want = (gx, gy) => (gx - 0.5 - tx * 256) / 4 + 2 * (gy - 0.5 - ty * 256);
  for (const [gx, gy] of [[tx * 256 + 10.3, ty * 256 + 20.6], [tx * 256 + 255.7, ty * 256 + 100.2], [tx * 256 + 256.4, ty * 256 + 3.9], [tx * 256 + 400, ty * 256 + 200]]) {
    assert.ok(Math.abs(at(gx, gy) - want(gx, gy)) < 1e-6, 'bilinéaire exact sur une pente plane, à cheval sur deux tuiles');
  }
  assert.ok(Number.isNaN(at(tx * 256 - 30, ty * 256 + 20)), 'hors des tuiles');
  assert.ok(Number.isNaN(at(tx * 256 + 10, ty * 256 + 256.2)), 'au bord sud, faute de tuile voisine');
  const r = dem.range();
  assert.deepEqual([r.min, r.max], [0, (511 + 8 * 255) / 4]);
});

/* ---------- le paysage cartoon sur relief réel ---------- */

const hasThree = fs.existsSync(path.join(U, 'vendor', 'three.min.js'));

test('paysage cartoon sur relief réel : la route garde son altitude, le terrain suit la carte recalée sur la route', { skip: !hasThree && 'three.js absent' }, () => {
  const W = load(['vendor/three.min.js', 'js/util.js', 'js/ambiances.js', 'js/route.js', 'js/dem.js', 'js/landscape.js']);
  const lat0 = 45.05, lon0 = 6.2;
  // montée rectiligne vers l'est à 8 % (pas de fond de vallée : pas de rivière le long de la route)
  const points = [];
  for (let d = 0; d <= 4000; d += 20) { const p = offset(lat0, lon0, d, 0); points.push({ lat: p.lat, lon: p.lon, ele: 500 + 0.08 * d }); }
  const route = new W.Route({ name: 'essai', points });
  // la carte : la même pente vers l'est, un versant à 12 % vers le nord, et 30 m sous l'altitude du GPX
  const kx = Math.cos(lat0 * Math.PI / 180) * 6371000 * Math.PI / 180, kz = 6371000 * Math.PI / 180;
  const real = (lat, lon) => 470 + 0.08 * (lon - lon0) * kx + 0.12 * (lat - lat0) * kz;
  const dem = { at: real, range: () => ({ min: 300, max: 900 }) };
  const seed = 4242;
  const L = new W.Landscape(route, seed, { dem });
  assert.ok(L.dem, 'relief réel utilisé');
  assert.ok(Math.abs(L.cR[L.cR.length >> 1] - 30) < 0.2, 'écart route − carte : 30 m');
  assert.ok(L.cR.every((r) => Math.abs(r - 30) < 5), '… à peine plus aux bouts (prolongements plats de la route)');

  const o = {};
  let onRoad = 0;
  for (let i = route.iStart; i <= route.iEnd; i += 7) {
    L.sample(route.x[i], route.z[i], o);
    if (o.dr < o.rw + 30 || o.lakeRn < 1.7) continue;
    assert.ok(Math.abs(o.h - route.y[i]) < 0.5, 'sur la route : son altitude (' + o.h.toFixed(2) + ' / ' + route.y[i].toFixed(2) + ')');
    onRoad++;
  }
  assert.ok(onRoad > 50);

  let far = 0;
  for (let i = route.iStart + 20; i <= route.iEnd; i += 25) {
    for (const off of [-600, -350, 350, 600]) {
      const x = route.x[i], z = route.z[i] + off;
      L.sample(x, z, o);
      if (o.dr < o.rw + 60 || o.lakeRn < 1.8 || o.roadD < 80) continue;
      const ll = route.lonLatOf(x, z);
      assert.ok(Math.abs(o.h - (real(ll.lat, ll.lon) + 30)) < 3, 'loin de la route : la carte + 30 m, à un léger modelé près');
      far++;
    }
  }
  assert.ok(far > 30);
  assert.match(L.describe().find((d) => d.label === 'Relief').value, /réel \(carte\) · 300 – 900 m/);

  // sans relief réel, ou si la carte n'a rien sous la route : exactement le relief inventé d'avant
  const P0 = new W.Landscape(route, seed), P1 = new W.Landscape(route, seed, {}), P2 = new W.Landscape(route, seed, { dem: { at: () => NaN } });
  assert.equal(P2.dem, null, 'rien sous la route : relief inventé');
  for (let k = 0; k < 40; k++) {
    const x = route.x[route.iStart] + k * 97 - 400, z = (k % 7 - 3) * 180;
    const h = P0.heightAt(x, z);
    assert.equal(P1.heightAt(x, z), h);
    assert.equal(P2.heightAt(x, z), h);
  }
  assert.equal(P0.amb.id, L.amb.id, 'même graine, même ambiance, relief réel ou non');
});
