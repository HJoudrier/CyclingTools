/* author : Hugo Joudrier-Faure */
/* PaceYourRide — stockage des données volumineuses (projet en cours, bibliothèque, copie du nuage, sortie en cours) dans IndexedDB.
 *
 * Pourquoi : localStorage est limité à environ 5 millions de caractères pour tout le site, et un parcours de plusieurs centaines de km en prend
 * plusieurs fois un million ; il est aussi recopié (projet, bibliothèque, copies du nuage). IndexedDB n'a pas cette limite.
 *
 * Comment : toute l'application lit et écrit de façon synchrone (store.js, home.js, cloud.js…). Ce module garde donc un cache en mémoire :
 *   - au démarrage, boot.js attend PYR.kv.ready, qui charge tout IndexedDB dans le cache, avant de charger le reste de la page ;
 *   - getItem / setItem / removeItem ont la forme de localStorage et répondent depuis le cache ;
 *   - setItem met le cache à jour tout de suite et écrit dans IndexedDB aussitôt après (une transaction par tour de boucle, la dernière valeur de
 *     chaque clé), flush() attend la fin des écritures ;
 *   - une clé absente d'IndexedDB est cherchée dans localStorage (anciennes données) puis recopiée dans IndexedDB, et retirée de localStorage une fois
 *     la copie faite : la migration se fait clé par clé, à la première lecture ;
 *   - une autre page ou un autre onglet qui écrit prévient par BroadcastChannel : le cache se met à jour et l'évènement « pyr:kv » est émis sur window ;
 *   - sans IndexedDB (navigation privée de certains navigateurs, Node pour les tests), tout passe directement par localStorage.
 *   - une écriture refusée (quota, base fermée) émet « pyr:kv-error » ; la valeur reste dans le cache pour la page ouverte ;
 *   - une page qui se ferme (pagehide, ou masquée sur téléphone) avant la fin d'une écriture la copie dans un journal de localStorage (clé « pyr.kvj.<clé> »,
 *     si elle y tient), que la page suivante reprend au chargement : une écriture en vol ne se perd pas.
 * Ne vont pas ici : les petites valeurs lues par plusieurs pages en même temps (date de modification du projet…), qui restent dans localStorage. */
(function (PYR) {
  'use strict';

  const DB_NAME = 'pyr-kv', STORE = 'kv', CHANNEL = 'pyr-kv', OPEN_TIMEOUT = 4000, JOURNAL = 'pyr.kvj.', DELETED = '\u0000';

  /* ---------- le vrai IndexedDB ---------- */

  /** Fond de stockage sur IndexedDB : { getAll(), get(key), write(entries) } (entries : [[clé, valeur | undefined]], une seule transaction). */
  function idbBackend(idb) {
    const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const opened = new Promise((resolve, reject) => {
      let r;
      try { r = idb.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('IndexedDB indisponible'));
      r.onblocked = () => reject(new Error('IndexedDB bloqué'));
      setTimeout(() => reject(new Error('IndexedDB ne répond pas')), OPEN_TIMEOUT);
    });
    const tx = async (mode) => (await opened).transaction(STORE, mode);
    return {
      async getAll() {
        const t = await tx('readonly'), s = t.objectStore(STORE);
        const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
        return keys.map((k, i) => [k, values[i]]);
      },
      async get(key) { const v = await req((await tx('readonly')).objectStore(STORE).get(key)); return v === undefined ? null : v; },
      async write(entries) {
        const t = await tx('readwrite'), s = t.objectStore(STORE);
        const done = new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('écriture annulée')); });
        for (const [k, v] of entries) { if (v === undefined) s.delete(k); else s.put(v, k); }
        return done;
      },
    };
  }

  /* ---------- le stockage ---------- */

  /**
   * Crée un stockage. opts : { backend (fond asynchrone, ou null : tout passe par localStorage), ls () → l'objet de type localStorage,
   * channel (BroadcastChannel ou semblable), emit (nom, détail) pour les évènements }. Les tests injectent un faux fond.
   */
  function create(opts) {
    const o = opts || {};
    const backend = o.backend || null;
    const ls = o.ls || (() => (typeof localStorage === 'undefined' ? null : localStorage));
    const emit = o.emit || (() => {});
    const cache = new Map();              // clé → texte
    const dirty = new Map();              // clé → texte | undefined (à écrire)
    let draining = null, inflight = null, mode = backend ? 'idb' : 'ls', channel = o.channel || null;

    const lsGet = (k) => { try { const s = ls(); return s ? s.getItem(k) : null; } catch (e) { return null; } };
    const lsSet = (k, v) => { const s = ls(); if (!s) throw new Error('stockage indisponible'); s.setItem(k, v); };
    const lsDel = (k) => { try { const s = ls(); if (s) s.removeItem(k); } catch (e) { /* stockage indisponible */ } };

    /** Écritures d'une page précédente restées en vol à sa fermeture (journal de localStorage) : reprises comme des écritures neuves. */
    function replayJournal() {
      let s = null, keys = [];
      try { s = ls(); if (s && typeof s.length === 'number') for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(JOURNAL)) keys.push(k); } } catch (e) { return; }
      for (const jk of keys) {
        const key = jk.slice(JOURNAL.length), v = lsGet(jk);
        if (v === null) continue;
        if (v === DELETED) { cache.delete(key); dirty.set(key, undefined); } else { cache.set(key, v); dirty.set(key, v); }
      }
      if (dirty.size) schedule();
    }

    async function load() {
      if (!backend) return;
      try {
        for (const [k, v] of await backend.getAll()) if (typeof v === 'string' && !dirty.has(k)) cache.set(k, v);
        replayJournal();
      } catch (e) {
        mode = 'ls';                       // base illisible : on repasse sur localStorage pour cette page
        cache.clear();
        emit('pyr:kv-error', { key: null, error: e, fatal: true });
      }
    }

    async function drain() {
      while (dirty.size) {
        const batch = Array.from(dirty.entries());
        dirty.clear();
        inflight = new Map(batch);
        try {
          await backend.write(batch);
          inflight = null;
          for (const [k, v] of batch) { lsDel(JOURNAL + k); if (v !== undefined) lsDel(k); }       // l'ancienne copie de localStorage ne doit pas ressusciter
          if (channel) { try { channel.postMessage({ keys: batch.map((b) => b[0]) }); } catch (e) { /* canal fermé */ } }
        } catch (e) {
          inflight = null;
          // écriture refusée : on tente localStorage pour ne pas perdre la valeur (valable pour les petites), sinon on prévient
          for (const [k, v] of batch) {
            let kept = false;
            if (v !== undefined) { try { lsSet(k, v); kept = true; } catch (e2) { /* plein aussi */ } }
            if (!kept && v !== undefined) emit('pyr:kv-error', { key: k, error: e, fatal: false });
          }
        }
      }
    }
    function schedule() {
      if (!draining) draining = Promise.resolve().then(drain).then(() => { draining = null; }, () => { draining = null; });
    }

    function onMessage(ev) {
      const keys = ev && ev.data && Array.isArray(ev.data.keys) ? ev.data.keys : [];
      Promise.all(keys.map(async (k) => {
        try { const v = await backend.get(k); if (typeof v === 'string') cache.set(k, v); else cache.delete(k); emit('pyr:kv', { key: k }); } catch (e) { /* la lecture suivante réessaiera */ }
      }));
    }
    if (backend && channel) channel.onmessage = onMessage;

    const ready = load();

    return {
      ready,
      get mode() { return mode; },
      getItem(key) {
        if (mode === 'ls') return lsGet(key);
        if (cache.has(key)) return cache.get(key);
        if (dirty.has(key)) return null;                  // retiré et pas encore écrit
        const old = lsGet(key);                           // anciennes données : copiées dans IndexedDB à la première lecture
        if (old === null) return null;
        cache.set(key, old);
        dirty.set(key, old);
        schedule();
        return old;
      },
      setItem(key, value) {
        const v = String(value);
        if (mode === 'ls') { lsSet(key, v); return; }
        cache.set(key, v);
        dirty.set(key, v);
        schedule();
      },
      removeItem(key) {
        if (mode === 'ls') { lsDel(key); return; }
        cache.delete(key);
        dirty.set(key, undefined);
        lsDel(key);
        schedule();
      },
      /** À appeler quand la page se ferme : copie dans localStorage (si elle y tient) ce qu'IndexedDB n'a pas encore confirmé. */
      journal() {
        if (mode !== 'idb') return;
        const pending = new Map(inflight || []);
        for (const [k, v] of dirty) pending.set(k, v);
        for (const [k, v] of pending) { try { lsSet(JOURNAL + k, v === undefined ? DELETED : v); } catch (e) { /* trop gros pour localStorage : l'écriture IndexedDB suit son cours */ } }
      },
      /** Attend la fin des écritures en cours. */
      async flush() { while (draining || dirty.size) { schedule(); await draining; } },
      /** Relit IndexedDB (page revenue du cache arrière/avant, ou doute sur l'état). Les écritures en attente sont gardées. */
      async refresh() {
        if (mode !== 'idb') return;
        const before = new Map(cache);
        await this.flush();
        cache.clear();
        await load();
        for (const k of new Set([...before.keys(), ...cache.keys()])) if (before.get(k) !== cache.get(k)) emit('pyr:kv', { key: k });
      },
      /** Taille approximative (caractères) de chaque clé en cache : pour le diagnostic. */
      sizes() { const out = {}; for (const [k, v] of cache) out[k] = v.length; return out; },
    };
  }

  /* ---------- l'instance de la page ---------- */

  function pageInstance() {
    const g = globalThis;
    let backend = null, channel = null;
    if (g.indexedDB) {
      try { backend = idbBackend(g.indexedDB); } catch (e) { backend = null; }
      if (backend && g.BroadcastChannel) { try { channel = new g.BroadcastChannel(CHANNEL); } catch (e) { channel = null; } }
    }
    const emit = (name, detail) => {
      if (typeof g.dispatchEvent === 'function' && typeof g.CustomEvent === 'function') g.dispatchEvent(new g.CustomEvent(name, { detail }));
    };
    const kv = create({ backend, channel, emit });
    if (typeof g.addEventListener === 'function') {
      // retour depuis le cache arrière/avant : une autre page a pu écrire entre-temps
      g.addEventListener('pageshow', (e) => { if (e.persisted) kv.refresh(); });
      g.addEventListener('pagehide', () => { kv.journal(); kv.flush(); });
      if (g.document && g.document.addEventListener) g.document.addEventListener('visibilitychange', () => { if (g.document.visibilityState === 'hidden') kv.journal(); });
    }
    return kv;
  }

  PYR.kvCreate = create;
  PYR.kv = pageInstance();
})(globalThis.PYR = globalThis.PYR || {});
