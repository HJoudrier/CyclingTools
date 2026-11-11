/* Bike3D — relief réel : le modèle numérique de terrain autour du vrai parcours, à la place du relief inventé.
   Source : les tuiles Terrarium d'AWS (Terrain Tiles, https://registry.opendata.aws/terrain-tiles/), des images PNG de 256 × 256 px
   en projection de Mercator dont la couleur code l'altitude (R × 256 + V + B / 256 − 32768 m), lisibles depuis une page web (CORS).
   On ne charge que les tuiles d'un couloir de MARGIN mètres autour du tracé (prolongements compris), au zoom le plus fin (≤ 14,
   ≈ 7 m par pixel à 45°) qui tient en MAX_TILES tuiles : le zoom ne dépend que du tracé, donc tous les joueurs d'une course en
   direct ont le même relief. Les tuiles décodées restent en mémoire (une autre graine, une reconstruction : rien n'est rechargé),
   en quarts de mètre (Int16Array).
   Le paysage (B3D.Landscape, option dem) lit l'altitude par at(lat, lon) ; il la recale sur l'altitude de la route. */
(function (root) {
  'use strict';
  const B3D = root.B3D = root.B3D || {};

  const URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  const ATTRIBUTION = 'Relief : Terrain Tiles (AWS)';
  const TILE = 256;
  const MAX_ZOOM = 14, MIN_ZOOM = 8;
  const MAX_TILES = 150;    // au plus ≈ 20 Mo de relief décodé
  const MARGIN = 1200;      // couloir chargé de part et d'autre du tracé (m) : le terrain est dessiné jusqu'à 860 m de la route
  const STEP = 50;          // un point du tracé tous les STEP mètres pour délimiter le couloir
  const QS = 4;             // altitudes stockées en quarts de mètre (jusqu'à 8 191 m)
  const EARTH = 40075016.686;
  const PARALLEL = 6, TIMEOUT = 15000;
  const CACHE_MAX = 400;    // tuiles gardées en mémoire (≈ 50 Mo)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** Altitude (m) codée dans un pixel de tuile Terrarium. */
  const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

  /** Clé numérique d'une tuile (zoom ≤ 16). */
  const tileKey = (tx, ty) => tx * 65536 + ty;

  /** Position en pixels du monde au zoom z (x vers l'est, y vers le sud), tuiles de 256 px. */
  function mercPx(lat, lon, z) {
    const n = TILE * 2 ** z;
    const s = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
    return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  }

  /** Inverse de mercPx. */
  function lonLatOfPx(px, py, z) {
    const n = TILE * 2 ** z;
    return { lon: px / n * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * py / n))) * 180 / Math.PI };
  }

  /** Mètres par pixel à la latitude lat, au zoom z. */
  const mPerPx = (lat, z) => EARTH * Math.cos(lat * Math.PI / 180) / (TILE * 2 ** z);

  /**
   * Tuiles (clés tileKey, dans l'ordre du parcours) qui touchent le carré de ±margin mètres autour de chaque point {lat, lon}.
   */
  function corridorTiles(samples, z, margin = MARGIN) {
    const n = 2 ** z, seen = new Set(), out = [];
    for (const p of samples) {
      const c = mercPx(p.lat, p.lon, z), r = margin / mPerPx(p.lat, z);
      const tx0 = clamp(Math.floor((c.x - r) / TILE), 0, n - 1), tx1 = clamp(Math.floor((c.x + r) / TILE), 0, n - 1);
      const ty0 = clamp(Math.floor((c.y - r) / TILE), 0, n - 1), ty1 = clamp(Math.floor((c.y + r) / TILE), 0, n - 1);
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const k = tileKey(tx, ty);
          if (!seen.has(k)) { seen.add(k); out.push(k); }
        }
      }
    }
    return out;
  }

  /** Le zoom le plus fin (≤ MAX_ZOOM) dont le couloir tient en MAX_TILES tuiles : {z, tiles}. */
  function pickZoom(samples, margin = MARGIN, maxTiles = MAX_TILES) {
    let tiles = [];
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
      tiles = corridorTiles(samples, z, margin);
      if (tiles.length <= maxTiles || z === MIN_ZOOM) return { z, tiles };
    }
    return { z: MIN_ZOOM, tiles };
  }

  /** Points {lat, lon} du tracé de la route (B3D.Route, prolongements compris), un tous les STEP mètres. */
  function routeSamples(route) {
    const out = [], k = Math.max(1, Math.round(STEP / (route.spacing || 5)));
    for (let i = 0; i < route.n; i += k) out.push(route.lonLatOf(route.x[i], route.z[i]));
    out.push(route.lonLatOf(route.x[route.n - 1], route.z[route.n - 1]));
    return out;
  }

  /** Le relief chargé : tuiles décodées (Map tileKey → Int16Array 256 × 256, en quarts de mètre) au zoom z. */
  class Dem {
    constructor(z, tiles) {
      this.z = z;
      this.tiles = tiles;
      this.count = tiles.size;
      this.scale = TILE * 2 ** z;
      this._k = -1; this._t = null;
    }

    // altitude d'un pixel du monde (entiers), NaN hors des tuiles chargées
    _px(gx, gy) {
      const tx = Math.floor(gx / TILE), ty = Math.floor(gy / TILE), k = tileKey(tx, ty);
      let t = this._t;
      if (k !== this._k) { t = this._t = this.tiles.get(k) || null; this._k = k; }
      if (!t) return NaN;
      return t[(gy - ty * TILE) * TILE + (gx - tx * TILE)] / QS;
    }

    /** Altitude (m) au point (lat, lon), interpolée entre les quatre pixels voisins ; NaN hors de la zone chargée. */
    at(lat, lon) {
      const n = this.scale;
      const s = Math.sin(clamp(lat, -85, 85) * Math.PI / 180);
      const fx = (lon + 180) / 360 * n - 0.5, fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), a = fx - x0, b = fy - y0;
      const h00 = this._px(x0, y0), h10 = this._px(x0 + 1, y0), h01 = this._px(x0, y0 + 1), h11 = this._px(x0 + 1, y0 + 1);
      return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
    }

    /** Altitudes extrêmes des tuiles chargées : {min, max} (m). */
    range() {
      if (!this._range) {
        let mn = Infinity, mx = -Infinity;
        for (const t of this.tiles.values()) {
          for (let i = 0; i < t.length; i++) { const v = t[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        }
        this._range = this.count ? { min: mn / QS, max: mx / QS } : { min: 0, max: 0 };
      }
      return this._range;
    }
  }

  /** Relief à partir de tuiles déjà décodées (Map tileKey → Int16Array en quarts de mètre). */
  const fromTiles = (z, tiles) => new Dem(z, tiles);

  /** Pixels RGBA d'une tuile Terrarium → Int16Array d'altitudes en quarts de mètre (la mer à 0 m : elle n'est pas dessinée). */
  function decode(rgba) {
    const n = rgba.length >> 2, out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const v = terrarium(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]);
      out[i] = clamp(Math.round(Math.max(0, v) * QS), 0, 32767);
    }
    return out;
  }

  /* ---------- Téléchargement (navigateur) ---------- */

  const cache = new Map();   // 'z/x/y' → Promise<Int16Array>
  let canvas = null, ctx = null;

  function fetchTile(z, tx, ty) {
    const id = z + '/' + tx + '/' + ty;
    let p = cache.get(id);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => { img.src = ''; reject(new Error('délai dépassé')); }, TIMEOUT);
      img.onload = () => {
        clearTimeout(timer);
        try {
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.width = canvas.height = TILE;
            ctx = canvas.getContext('2d', { willReadFrequently: true });
          }
          ctx.clearRect(0, 0, TILE, TILE);
          ctx.drawImage(img, 0, 0, TILE, TILE);
          resolve(decode(ctx.getImageData(0, 0, TILE, TILE).data)); // échoue si le serveur refuse la lecture des pixels (CORS)
        } catch (err) { reject(err); }
      };
      img.onerror = () => { clearTimeout(timer); reject(new Error('tuile d\'altitude indisponible')); };
      img.src = URL.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
    });
    cache.set(id, p);
    p.catch(() => cache.delete(id)); // un échec n'est pas gardé : on réessaiera
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return p;
  }

  /**
   * Charge le relief réel autour de la route (B3D.Route). opts.onProgress(faites, total) suit le téléchargement.
   * Échoue (exception) si une tuile traversée par la route manque, ou plus d'une sur dix du couloir.
   */
  async function load(route, opts = {}) {
    const samples = routeSamples(route);
    const { z, tiles } = pickZoom(samples);
    const core = new Set(corridorTiles(samples, z, 0));
    const map = new Map(), queue = tiles.slice();
    let done = 0, failed = 0, failedCore = 0;
    if (opts.onProgress) opts.onProgress(0, tiles.length);
    const worker = async () => {
      while (queue.length) {
        const k = queue.shift();
        try {
          map.set(k, await fetchTile(z, Math.floor(k / 65536), k % 65536));
        } catch (err) {
          failed++;
          if (core.has(k)) failedCore++;
        }
        done++;
        if (opts.onProgress) opts.onProgress(done, tiles.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker));
    if (failedCore > 0 || failed > tiles.length * 0.1) throw new Error('relief réel indisponible (' + failed + ' tuile' + (failed > 1 ? 's' : '') + ' sur ' + tiles.length + ')');
    return new Dem(z, map);
  }

  B3D.Dem = {
    URL, ATTRIBUTION, TILE, MAX_ZOOM, MIN_ZOOM, MAX_TILES, MARGIN, QS,
    terrarium, tileKey, mercPx, lonLatOfPx, mPerPx, corridorTiles, pickZoom, routeSamples, decode, fromTiles, load,
  };
})(typeof window !== 'undefined' ? window : globalThis);
