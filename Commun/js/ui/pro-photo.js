/* author : Hugo Joudrier-Faure */
/* PaceYourRide — la photo d'un coureur professionnel (cartes du carrousel d'athlètes de l'accueil), cherchée sur Wikipédia (français, puis anglais) :
 * la page du coureur, reconnue à son nom et à sa description de cycliste, donne sa photo (le plus souvent une image libre de Wikimedia Commons).
 * La photo est réduite (160 × 200, JPEG) et gardée sur l'appareil (IndexedDB) : un coureur n'est cherché qu'une fois ; un coureur sans photo
 * n'est retenté qu'après quelques jours. Hors ligne, ou sans page de coureur, la carte garde ses initiales.
 *   const ph = await PYR.proPhoto.get('Tadej Pogačar');   // { src (adresse data: ou https:), page (adresse Wikipédia), lang } ou null
 * Les photos appartiennent à leurs auteurs (licences libres de Wikimedia Commons) : la page du coureur donne l'auteur et la licence. */
(function (PYR) {
  'use strict';

  const W = 160, H = 200;                    // taille gardée de la photo
  const MISS_DAYS = 3;                       // un coureur sans photo est cherché de nouveau après ce délai
  const LANGS = ['fr', 'en'];

  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** Adresse de la recherche d'une page (avec sa photo et sa description) ; origin=* : appel depuis le navigateur permis. */
  function searchUrl(lang, name) {
    const q = lang === 'fr' ? `${name} cycliste` : `${name} cyclist`;
    return `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=4&prop=pageimages%7Cdescription&piprop=thumbnail&pithumbsize=300&redirects=1&format=json&origin=*`;
  }

  /**
   * Parmi les pages renvoyées, celle du coureur : son titre contient son prénom et son nom (ou le nom seul si c'est le titre le plus proche) et
   * la description parle de cyclisme ; elle doit avoir une photo. null sinon (on ne prend jamais une page au hasard : mauvaise personne).
   * (pure : testée sous Node)
   */
  function pick(json, name) {
    const pages = json && json.query && json.query.pages ? Object.values(json.query.pages) : [];
    const words = norm(name).split(' ').filter(Boolean), last = words[words.length - 1], first = words[0];
    const sport = /cycl|coureur|rider|road|vélo|velo|tour de/i;
    const ok = pages.filter((p) => p && p.thumbnail && p.thumbnail.source && sport.test(String(p.description || '')))
      .map((p) => ({ p, t: norm(p.title) }))
      .filter((x) => x.t.includes(last) && x.t.includes(first))
      .sort((a, b) => (a.p.index || 9) - (b.p.index || 9));
    return ok.length ? ok[0].p : null;
  }

  /* ---------- stockage local ---------- */

  let dbP = null;
  function db() {
    if (!dbP) {
      dbP = new Promise((resolve) => {
        if (!globalThis.indexedDB) { resolve(null); return; }
        try {
          const rq = indexedDB.open('paceyourride-photos', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('photos', { keyPath: 'key' });
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbP;
  }
  const idb = (mode, fn) => db().then((d) => (d ? new Promise((resolve) => {
    try { const rq = fn(d.transaction('photos', mode).objectStore('photos')); rq.onsuccess = () => resolve(rq.result || null); rq.onerror = () => resolve(null); } catch (e) { resolve(null); }
  }) : null));

  /* ---------- réseau ---------- */

  let active = 0;
  const waiting = [];
  const slot = (fn) => new Promise((resolve, reject) => {          // trois recherches à la fois au plus
    const run = () => { active++; fn().then(resolve, reject).then(() => { active--; if (waiting.length) waiting.shift()(); }); };
    if (active < 3) run(); else waiting.push(run);
  });

  const getJson = (url) => fetch(url, { headers: { Accept: 'application/json' } }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });

  /** Réduit l'image (recadrée en 4 : 5, vers le haut pour garder le visage) en JPEG ; l'adresse d'origine si le navigateur refuse (CORS, canvas). */
  async function shrink(url) {
    try {
      const blob = await fetch(url, { mode: 'cors' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const k = Math.max(W / bmp.width, H / bmp.height), w = bmp.width * k, h = bmp.height * k;
      c.getContext('2d').drawImage(bmp, (W - w) / 2, Math.min(0, (H - h) * 0.12), w, h);   // le haut de l'image est favorisé
      return c.toDataURL('image/jpeg', 0.82);
    } catch (e) { return url; }
  }

  async function lookup(name) {
    let errors = 0;
    for (const lang of LANGS) {
      let page = null;
      try { page = pick(await slot(() => getJson(searchUrl(lang, name))), name); } catch (e) { errors++; continue; }
      if (!page) continue;
      const src = await slot(() => shrink(page.thumbnail.source));
      return { src, page: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`, lang };
    }
    if (errors === LANGS.length) throw new Error('Wikipédia injoignable');       // hors ligne : on ne retient pas un « sans photo »
    return null;
  }

  const mem = new Map();

  /** La photo d'un coureur ({ src, page, lang }), ou null si on n'en trouve pas. Une recherche par coureur, gardée sur l'appareil. */
  function get(name) {
    const key = norm(name);
    if (!key) return Promise.resolve(null);
    if (!mem.has(key)) {
      mem.set(key, (async () => {
        const rec = await idb('readonly', (s) => s.get(key));
        if (rec && (rec.photo || Date.now() - rec.at < MISS_DAYS * 86400000)) return rec.photo || null;
        let photo;
        try { photo = await lookup(name); } catch (e) { mem.delete(key); return null; }
        idb('readwrite', (s) => s.put({ key, photo, at: Date.now() }));
        return photo;
      })());
    }
    return mem.get(key);
  }

  PYR.proPhoto = { get, pick, searchUrl, W, H, credit: 'Photos : Wikipédia / Wikimedia Commons (licences libres, voir la page du coureur)' };
})(globalThis.PYR = globalThis.PYR || {});
