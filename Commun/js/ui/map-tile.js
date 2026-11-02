/* author : Hugo Joudrier-Faure */
/* PaceYourRide — la « tuile » de fond de carte d'un parcours : une image (JPEG, 768 × 512) du fond de carte autour du tracé, assemblée une fois
 * à partir des tuiles du fond (CARTO Voyager, ou OpenStreetMap), puis gardée sur l'appareil (IndexedDB) et dans le Dropbox
 * (« /tiles/<clé>.json », dossier de l'application, par cloud.js writeFile) : un parcours n'a besoin du réseau de cartes qu'une fois, et les autres
 * appareils la retrouvent dans Dropbox. Elle sert de fond à l'aperçu 2D d'un parcours (route-thumb.js mountMap) et de sol plat à sa vue 3D (mount).
 *
 * Le cadre est celui de la vue 3D (route-thumb.js geometry().frame) : centré sur le tracé, 2,1 fois son étendue en largeur et 1,4 fois en hauteur
 * (3 : 2) ; le sol carré de la vue 3D en est la partie centrale.
 *   const tile = await PYR.mapTile.get(profile);   // { key, img (adresse data:), w, h, latc, lngc, dLat, dLng } ou null (hors ligne, jamais vue)
 *   PYR.mapTile.plan(profile)                       // clé, zoom, bornes et tuiles à charger (pur, testé sous Node)
 * La clé ne dépend que du cadre : deux parcours de même emprise partagent la tuile. */
(function (PYR) {
  'use strict';

  const W = 768, H = 512;               // pixels de l'image
  const FRAME_W = 2.1, FRAME_H = 1.4;   // largeur et hauteur du cadre, en étendues du tracé
  const MAX_TILES = 64;
  const SPEC = { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', subdomains: 'abcd', maxZoom: 17,
    attribution: '© OpenStreetMap · © CARTO' };
  const FALLBACK = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: 'abc', maxZoom: 17, attribution: '© OpenStreetMap' };
  const ALT = { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', subdomains: 'abcd', maxZoom: 17, attribution: '© OpenStreetMap · © CARTO' };

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rad = (d) => d * Math.PI / 180;
  const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

  /** Pixel mondial (tuiles de 256 px) d'une longitude / latitude au zoom z. */
  const pxX = (lng, z) => ((lng + 180) / 360) * 256 * 2 ** z;
  const pxY = (lat, z) => { const r = rad(clamp(lat, -85.05, 85.05)); return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256 * 2 ** z; };

  /**
   * Cadre et tuiles à charger pour un parcours (profil de library.routeProfile) : { key, latc, lngc, dLat, dLng (demi-cadre, degrés), z,
   * x0, y0, x1, y1 (pixels mondiaux du cadre), tx0, ty0, tx1, ty1 (tuiles couvertes), count } ou null.
   */
  function plan(profile) {
    const g = PYR.routeThumb && PYR.routeThumb.geometry(profile);
    if (!g) return null;
    const f = g.frame;
    const dLat = (FRAME_H * f.extent / 2) / f.kz, dLng = (FRAME_W * f.extent / 2) / f.kx;
    // zoom où l'image garde à peu près la résolution du fond (au plus 17, comme les fonds de carte)
    let z = clamp(Math.round(Math.log2(156543.03392 * Math.cos(rad(f.latc)) * W / (FRAME_W * f.extent))), 4, SPEC.maxZoom);
    let x0, x1, y0, y1, tx0, tx1, ty0, ty1, count;
    for (;;) {
      x0 = pxX(f.lngc - dLng, z); x1 = pxX(f.lngc + dLng, z); y0 = pxY(f.latc + dLat, z); y1 = pxY(f.latc - dLat, z);
      tx0 = Math.floor(x0 / 256); tx1 = Math.floor(x1 / 256); ty0 = Math.floor(y0 / 256); ty1 = Math.floor(y1 / 256);
      count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
      if (count <= MAX_TILES || z <= 4) break;
      z--;
    }
    const key = 't' + hash([f.latc.toFixed(4), f.lngc.toFixed(4), Math.round(f.extent)].join('|'));
    return { key, latc: f.latc, lngc: f.lngc, dLat, dLng, z, x0, y0, x1, y1, tx0, ty0, tx1, ty1, count };
  }

  /* ---------- assemblage ---------- */

  /** Au plus n tâches à la fois ; les autres attendent leur tour (le délai d'une tuile ne court qu'une fois sa place prise). */
  function limiter(n) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= n || !queue.length) return;
      active++;
      const job = queue.shift();
      job.fn().then(job.resolve, job.reject).then(() => { active--; next(); });
    };
    return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
  }
  const imageSlot = limiter(6), renderSlot = limiter(1);        // 6 tuiles de carte à la fois, un parcours à la fois (les serveurs de cartes refusent les rafales)

  function loadNow(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';           // sans quoi le canvas serait « souillé » et ne s'exporterait pas
      const t = setTimeout(() => { img.src = ''; reject(new Error('délai dépassé')); }, 12000);
      img.onload = () => { clearTimeout(t); resolve(img); };
      img.onerror = () => { clearTimeout(t); reject(new Error('tuile illisible')); };
      img.src = url;
    });
  }
  const loadImage = (url) => (/^data:/.test(url) ? loadNow(url) : imageSlot(() => loadNow(url)));

  const urlOf = (spec, z, x, y) => spec.url.replace('{s}', spec.subdomains[(x + y) % spec.subdomains.length]).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{r}', '');

  /** Assemble l'image du cadre (réseau) ; essaie le fond principal, puis OpenStreetMap. Lève une erreur si trop de tuiles manquent. */
  async function render(pl) {
    let lastErr = null;
    for (const spec of [SPEC, FALLBACK, ALT]) {
      try { return await renderWith(pl, spec); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('fond de carte indisponible');
  }

  async function renderWith(pl, spec) {
    const n = 2 ** pl.z, nx = pl.tx1 - pl.tx0 + 1, ny = pl.ty1 - pl.ty0 + 1;
    const stitch = document.createElement('canvas');
    stitch.width = nx * 256; stitch.height = ny * 256;
    const sc = stitch.getContext('2d');
    sc.fillStyle = '#e9e7e1'; sc.fillRect(0, 0, stitch.width, stitch.height);
    let ok = 0;
    const jobs = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = ((pl.tx0 + i) % n + n) % n, y = pl.ty0 + j;
      if (y < 0 || y >= n) { ok++; continue; }
      jobs.push(loadImage(urlOf(spec, pl.z, x, y)).then((img) => { sc.drawImage(img, i * 256, j * 256, 256, 256); ok++; }, () => {}));
    }
    await Promise.all(jobs);
    if (ok < nx * ny * 0.75) throw new Error('fond de carte incomplet');
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').drawImage(stitch, pl.x0 - pl.tx0 * 256, pl.y0 - pl.ty0 * 256, pl.x1 - pl.x0, pl.y1 - pl.y0, 0, 0, W, H);
    return { v: 1, key: pl.key, img: out.toDataURL('image/jpeg', 0.72), w: W, h: H, latc: pl.latc, lngc: pl.lngc, dLat: pl.dLat, dLng: pl.dLng, att: spec.attribution };
  }

  /* ---------- stockage local (IndexedDB) ---------- */

  let dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise((resolve) => {
        if (!globalThis.indexedDB) { resolve(null); return; }
        try {
          const rq = indexedDB.open('paceyourride-tiles', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('tiles', { keyPath: 'key' });
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbP;
  }
  const idb = (mode, fn) => db().then((d) => (d ? new Promise((resolve) => {
    try { const rq = fn(d.transaction('tiles', mode).objectStore('tiles')); rq.onsuccess = () => resolve(rq.result || null); rq.onerror = () => resolve(null); } catch (e) { resolve(null); }
  }) : null));
  const idbGet = (key) => idb('readonly', (s) => s.get(key));
  const idbPut = (tile, up) => idb('readwrite', (s) => s.put({ key: tile.key, tile, up: !!up }));

  /* ---------- Dropbox ---------- */

  const connected = () => !!(PYR.cloud && PYR.cloud.status && PYR.cloud.status().connected && PYR.cloud.writeFile);
  const pathOf = (key) => '/tiles/' + key + '.json';
  /** Envoie la tuile dans le Dropbox (sans bloquer ; la prochaine fois qu'elle est affichée, un échec est retenté). */
  function upload(tile) {
    if (!connected()) return Promise.resolve(false);
    return PYR.cloud.writeFile(pathOf(tile.key), JSON.stringify(tile)).then(() => { idbPut(tile, true); return true; }, () => false);
  }

  /* ---------- accès ---------- */

  const mem = new Map();      // clé → promesse de tuile (une seule récupération par clé et par page)

  let lastError = '';

  /**
   * La tuile d'un parcours : mémoire, appareil, Dropbox, sinon assemblée sur le réseau (puis gardée et envoyée dans Dropbox). null si introuvable
   * (la raison est dans PYR.mapTile.lastError). retry : on réessaie un échec précédent de cette page.
   */
  function get(profile, retry) {
    const pl = plan(profile);
    if (!pl) return Promise.resolve(null);
    if (retry) mem.delete(pl.key);
    if (!mem.has(pl.key)) {
      const p = (async () => {
        const rec = await idbGet(pl.key);
        if (rec && rec.tile && rec.tile.img) { if (!rec.up) upload(rec.tile); return rec.tile; }
        if (connected() && PYR.cloud.readFile) {
          try {
            const txt = await PYR.cloud.readFile(pathOf(pl.key));
            const t = txt ? JSON.parse(txt) : null;
            if (t && t.key === pl.key && typeof t.img === 'string' && t.img.startsWith('data:image/')) { idbPut(t, true); return t; }
          } catch (e) { /* Dropbox injoignable : on assemble la tuile */ }
        }
        const tile = await renderSlot(() => render(pl));
        idbPut(tile, false);
        upload(tile);
        return tile;
      })().catch((e) => { lastError = (e && e.message) || 'fond de carte indisponible'; mem.delete(pl.key); return null; });
      mem.set(pl.key, p);
    }
    return mem.get(pl.key);
  }

  /** Élément <img> décodé de la tuile (une fois par tuile), pour dessiner dans un canvas ou en faire une texture. */
  function image(tile) {
    if (!tile) return Promise.resolve(null);
    if (!tile._img) tile._img = loadImage(tile.img).catch(() => null);
    return tile._img;
  }

  /** Pixels (dans l'image de la tuile) d'un point de coordonnées (lat, lng). */
  const toPx = (tile, lat, lng) => [((lng - (tile.lngc - tile.dLng)) / (2 * tile.dLng)) * tile.w, (((tile.latc + tile.dLat) - lat) / (2 * tile.dLat)) * tile.h];

  PYR.mapTile = { W, H, FRAME_W, FRAME_H, plan, get, image, toPx, attribution: SPEC.attribution, get lastError() { return lastError; } };
})(globalThis.PYR = globalThis.PYR || {});
