/* author : Hugo Joudrier-Faure */
/* Tests de la tuile de fond de carte d'un parcours (Commun/js/ui/map-tile.js) : cadre, zoom, tuiles à charger, clé, et son lien avec la vue 3D. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PYR, makeProfile } = require('./helpers.js');
require(path.join(__dirname, '..', 'Commun/js/ui/route-thumb.js'));
require(path.join(__dirname, '..', 'Commun/js/ui/map-tile.js'));
const T = PYR.mapTile, RT = PYR.routeThumb;

const prof = (len, grade, o) => { const p = makeProfile([{ len, grade }], o); return { n: p.n, length: p.length, lat: p.lat, lng: p.lng, ele: p.ele, hasEle: true }; };

test('tuile : le cadre est centré sur le tracé, 2,1 × 1,4 étendues, et contient tout le parcours', () => {
  for (const len of [3000, 25000, 120000]) {
    const p = prof(len, 0.02), pl = T.plan(p), g = RT.geometry(p);
    assert.ok(pl && pl.key && /^t[0-9a-z]+$/.test(pl.key));
    const lat = Array.from(p.lat), lng = Array.from(p.lng);
    assert.ok(pl.latc - pl.dLat < Math.min(...lat) && pl.latc + pl.dLat > Math.max(...lat), 'latitudes dans le cadre');
    assert.ok(pl.lngc - pl.dLng < Math.min(...lng) && pl.lngc + pl.dLng > Math.max(...lng), 'longitudes dans le cadre');
    const wM = 2 * pl.dLng * g.frame.kx, hM = 2 * pl.dLat * g.frame.kz;
    assert.ok(Math.abs(wM / g.frame.extent - T.FRAME_W) < 1e-6 && Math.abs(hM / g.frame.extent - T.FRAME_H) < 1e-6);
    assert.ok(pl.count >= 1 && pl.count <= 64, `${pl.count} tuiles pour ${len} m`);
    assert.ok(pl.z >= 4 && pl.z <= 17);
    // les tuiles couvrent le cadre ; les pixels du cadre ont le rapport 3 : 2 de l'image
    assert.ok(pl.tx0 * 256 <= pl.x0 && (pl.tx1 + 1) * 256 >= pl.x1 && pl.ty0 * 256 <= pl.y0 && (pl.ty1 + 1) * 256 >= pl.y1);
    assert.ok(Math.abs((pl.x1 - pl.x0) / (pl.y1 - pl.y0) - 1.5) < 0.05, 'rapport 3 : 2 conservé en projection');
  }
  assert.equal(T.plan(null), null);
});

test('tuile : un parcours long est vu de moins près ; même emprise, même clé ; autre emprise, autre clé', () => {
  const a = T.plan(prof(5000, 0.03)), b = T.plan(prof(80000, 0.03));
  assert.ok(b.z < a.z, `zoom ${b.z} (80 km) < ${a.z} (5 km)`);
  assert.equal(T.plan(prof(5000, 0.03)).key, a.key);
  assert.equal(T.plan(prof(5000, 0.05)).key, a.key, 'le profil d\'altitude ne change pas le fond');
  assert.notEqual(T.plan(prof(5000, 0.03, { heading: 90 })).key, a.key);
});

test('tuile : la position d\'un point dans l\'image (nord en haut) correspond au sol plat de la vue 3D', () => {
  const p = prof(10000, 0.02, { heading: 45 }), pl = T.plan(p), g = RT.geometry(p);
  const tile = { w: T.W, h: T.H, latc: pl.latc, lngc: pl.lngc, dLat: pl.dLat, dLng: pl.dLng };
  const [cx, cy] = T.toPx(tile, pl.latc, pl.lngc);
  assert.ok(Math.abs(cx - T.W / 2) < 1e-6 && Math.abs(cy - T.H / 2) < 1e-6, 'le centre du tracé est au centre de l\'image');
  // le sol de la scène est le carré central : un point de la scène (x, z) tombe au pixel (W/2 + x·W/(FRAME_W·SPAN), H/2 + z·H/(FRAME_H·SPAN))
  for (const i of [0, Math.floor(g.n / 2), g.n - 1]) {
    const k = i === 0 ? 0 : Math.round((i * (p.n - 1)) / (g.n - 1)), [px, py] = T.toPx(tile, p.lat[k], p.lng[k]);
    const ex = T.W / 2 + g.x[i] * T.W / (T.FRAME_W * g.span), ey = T.H / 2 + g.z[i] * T.H / (T.FRAME_H * g.span);
    assert.ok(Math.abs(px - ex) < 0.8 && Math.abs(py - ey) < 0.8, `point ${i} : (${px.toFixed(1)}, ${py.toFixed(1)}) attendu (${ex.toFixed(1)}, ${ey.toFixed(1)})`);
  }
});
