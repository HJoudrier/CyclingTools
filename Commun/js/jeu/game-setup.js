/* author : Hugo Joudrier-Faure */
/* PaceYourRide — page de choix des jeux (VirtualRide2D/index.html, VirtualRide3D/index.html et VirtualRide3DRealiste/index.html) : le parcours (carrousel de vues 3D avec distance, D+ et D−),
 * l'athlète (avec son vélo et sa tenue), la météo (celle d'une date, ou un temps aléatoire qui évolue), puis les réglages de la partie
 * (liés à l'état par data-bind, comme avant). « Démarrer » ouvre l'écran de course de l'application (course.html).
 *
 * Les parcours, athlètes, vélos et tenues viennent de la bibliothèque de PaceYourRide, lue dans Dropbox (cloud.js pull) et gardée en
 * copie dans le stockage local de cette application pour jouer hors ligne. Le projet en cours de PaceYourRide, lu en même temps, est
 * proposé en tête de chaque liste ; ses réglages de stratégie (allure en virage, vitesse maximale, forme) et son plan optimal le suivent,
 * pour que le fantôme (le plan optimal) soit celui du parcours et de l'athlète choisis.
 * Le choix est recopié dans l'état de l'application (library.apply, comme l'accueil de PaceYourRide) que l'écran de course relit. */
(function (PYR) {
  'use strict';

  const D = PYR.dom, store = PYR.store, L = PYR.library, U = PYR.util, We = PYR.weather;
  const { $, $$, h } = D;

  const C = PYR.libCache, NONE = 'none';            // vélo ou tenue : « réglages par défaut » (vide : le premier proposé)
  // les deux jeux en 3D : parcours vus en 3D, matériel réglé sur la vue 3D ; seul l'univers cartoon a son propre ciel (le monde réaliste montre
  // la météo de la simulation, comme la carte : pluie, vent, température, heure)
  const is3d = () => PYR.appId === 'jeu3d' || PYR.appId === 'jeu3dr';
  const ownSky = () => PYR.appId === 'jeu3d';

  const S = { views: [], mode: 'random' };
  const items = (kind) => C.items(kind), find = (kind, id) => C.find(kind, id);
  // parcours et athlète : ce qui est choisi sur la page d'accueil (le projet en cours), à défaut le premier de la bibliothèque ; vélo et tenue : le choix de cette page
  const pickId = (kind) => C.pickId(kind, kind === 'route' || kind === 'athlete' ? C.PROJECT_ID : store.state.game.pick[kind]);
  const chosen = (kind) => find(kind, pickId(kind));

  /* ---------- Dropbox ---------- */

  function renderCloud() {
    const box = $('#gs-cloud');
    D.clear(box);
    const st = PYR.cloud.status(), c = C.state;
    box.classList.toggle('is-error', !!c.error);
    const n = (k) => c.lib[L.KINDS[k].list].length;
    const when = c.pulledAt ? new Date(c.pulledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    let txt;
    if (c.busy) txt = h('span', null, 'Échange avec ton Dropbox…');
    else if (c.error) txt = h('span', null, h('b', null, 'Dropbox : '), c.error);
    else if (!st.connected) txt = h('span', null, h('b', null, 'Dropbox non connecté. '), 'Ton parcours et ton athlète sont ceux choisis sur la page d\'accueil ; ta bibliothèque reste sur cet appareil tant que tu n\'es pas connecté.' + (when ? ` Copie locale du ${when}.` : ''));
    else txt = h('span', null, h('b', null, 'Dropbox connecté. '), `${n('route')} parcours, ${n('athlete')} athlète${n('athlete') > 1 ? 's' : ''}, ${n('bike')} vélo${n('bike') > 1 ? 's' : ''}` + (when ? ` · lu le ${when}` : ''));
    box.append(h('div', { class: 'gs-cloud-txt' }, txt));
    if (st.connected) box.append(h('button', { class: 'btn', type: 'button', disabled: c.busy ? 'true' : null, onclick: () => refresh() }, '↻ Actualiser'));
    else box.append(h('button', { class: 'btn primary', type: 'button', onclick: () => PYR.cloud.login().catch((e) => D.toast(e.message, 'error')) }, 'Se connecter à Dropbox'));
    box.append(h('a', { class: 'btn ghost', href: (PYR.root || '') + 'index.html', title: 'Choisir ou créer un parcours et un athlète' }, 'Accueil'));
  }

  async function refresh() {
    if (C.state.busy || !PYR.cloud.status().connected) return;
    C.state.busy = true; renderCloud();
    try {
      const r = await C.refresh();
      if (r === 'vide') C.state.error = "Ton Dropbox ne contient encore rien : ajoute un parcours et un athlète ici, ou ouvre PaceYourRide.";
    } catch (e) { /* le message est dans C.state.error */ }
    C.state.busy = false;
    renderAll();
  }

  /* ---------- 1. parcours ---------- */

  const fmt = (x, d) => (Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('fr-FR');

  /** Page d'accueil du site : c'est là qu'on choisit (et qu'on crée) le parcours et l'athlète, pour toutes les applications. */
  const homeUrl = () => (PYR.root || '') + 'index.html';
  const goHome = () => { store.saveNow(); location.href = homeUrl(); };

  function renderRoutes() {
    for (const v of S.views) v.destroy();
    const cur = chosen('route');
    S.views = [PYR.libPick.routePicker($('#gs-routes'), { items: cur ? [cur] : [], pick: cur ? cur.id : '', defaultView: is3d() ? '3d' : '2d', onPick: () => {}, projectLabel: "Choisi sur l'accueil",
      extra: [{ label: "↩ Changer de parcours (page d'accueil)", title: "Le parcours se choisit, se crée ou se modifie sur la page d'accueil du site, pour toutes les applications", fn: goHome }],
      emptyText: "Aucun parcours choisi : choisis ou crée un parcours sur la page d'accueil du site." })];
  }

  /* ---------- 2. athlète, vélo, tenue ---------- */

  function renderAthletes() {
    const cur = chosen('athlete'), host = $('#gs-athletes');
    PYR.libPick.athletePicker(host, { items: cur ? [cur] : [], pick: cur ? cur.id : '', onPick: () => {}, actions: () => [],
      emptyText: "Aucun athlète choisi : l'athlète par défaut sera utilisé. Choisis ou crée un athlète (ou un coureur du World Tour) sur la page d'accueil du site." });
    host.querySelector('.gs-add').appendChild(h('button', { class: 'btn', type: 'button', title: "L'athlète (et les coureurs du World Tour) se choisit, se crée ou se modifie sur la page d'accueil du site, pour toutes les applications", onclick: goHome }, "↩ Changer d'athlète (page d'accueil)"));
    for (const kind of ['bike', 'outfit']) {
      const sel = $(kind === 'bike' ? '#gs-bike' : '#gs-outfit'), all = items(kind), id = store.state.game.pick[kind];
      D.clear(sel);
      sel.appendChild(h('option', { value: NONE }, 'Réglages par défaut'));
      for (const it of all) {
        const s = L.summary(kind, it.data);
        sel.appendChild(h('option', { value: it.id }, it.name + (s && s.title ? ' — ' + s.title : '')));
      }
      sel.value = id === NONE ? NONE : (all.some((x) => x.id === id) ? id : (all[0] ? all[0].id : NONE));
      sel.onchange = () => setPick(kind, sel.value);
    }
  }

  /* ---------- composition de l'état de la partie ---------- */

  const freshWeather = (startAt) => ({ enabled: false, source: 'api', startAt: startAt || '', snapshot: null, utcOffset: 0, fetchedAt: 0, fetchedFor: '', custom: { baseT: 20, temp: [], rain: [] } });
  const tomorrow = () => { const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  /** Recopie dans l'état de l'application le parcours, l'athlète, le vélo et la tenue choisis, puis la météo choisie. */
  function compose() {
    const st = store.state, G = st.game;
    G.display = is3d() ? '3d' : '2d';
    const keyBefore = store.profile ? We.routeKey(store.profile) : '';
    const wxBefore = st.weather;
    const route = C.compose(st, Object.assign({}, G.pick, { route: pickId('route'), athlete: pickId('athlete') }));
    if (route) {
      st.weather = wxBefore || freshWeather();       // (la météo du parcours enregistré n'est pas reprise : voir plus bas)
      PYR.routeModel.computeMissing();
      PYR.routeModel.rebuildProfile();
    }
    if (ownSky()) composeSky(route, wxBefore, keyBefore);
    else {
      // la météo suit le parcours : changer de parcours abandonne celle qui avait été récupérée
      st.weather = keyBefore && store.profile && We.routeKey(store.profile) === keyBefore && wxBefore ? wxBefore : freshWeather(wxBefore && wxBefore.startAt);
      if (!st.weather.startAt) st.weather.startAt = tomorrow();
    }
    if (PYR.gearEdit) PYR.gearEdit.reapply();         // matériel modifié sur la vue 3D (VirtualRide3D)
    applyWeather();
    store.save();
    PYR.app.refreshBindings();
    store.emit('weather', { path: 'weather' });
  }

  function setPick(kind, id) {
    store.state.game.pick[kind] = id;
    store.save();
    if (kind === 'route' && S.views[0]) S.views[0].setPick(id);
    if ((kind === 'bike' || kind === 'outfit') && PYR.gearEdit) PYR.gearEdit.clear(kind);     // un autre vélo ou une autre tenue : on repart de la bibliothèque
    if (kind === 'athlete') $$('#gs-athletes .gs-ath').forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === id)));
    compose();
    renderSummary();
    if (PYR.gearEdit) PYR.gearEdit.refresh();
  }

  /* ---------- 3. météo ---------- */

  /** Météo aléatoire : en 2D, un instantané tiré au hasard qui évolue (seed) et que la simulation lit ; en 3D, le ciel variable de Bike3D (sans effet sur la simulation). */
  function applyWeather() {
    const st = store.state, G = st.game;
    if (S.mode !== 'random' || ownSky()) return;
    const p = store.profile;
    if (ownSky() || !p) { st.weather.enabled = false; st.weather.snapshot = null; st.weather.fetchedFor = ''; return; }
    if (!G.weatherSeed) G.weatherSeed = 1 + Math.floor(Math.random() * 999999);
    const start = Math.floor(Date.now() / 1000);
    const snap = We.randomEvolving(p, G.weatherSeed, { start, hours: 24 });
    if (!snap) return;
    const startAt = We.epochToLocal(start, 0);
    Object.assign(st.weather, { enabled: true, source: 'api', startAt, snapshot: snap, utcOffset: 0, fetchedAt: Date.now(), fetchedFor: We.freshKey(p, startAt) });
  }

  function randomSummary() {
    const w = store.state.weather, el = $('#gs-wx-random-sum');
    if (ownSky() || !el) return;
    if (!w.snapshot || !w.enabled) { el.textContent = ''; return; }
    const T = [].concat(...w.snapshot.T), rain = w.snapshot.rain[0];
    const wetH = rain.filter((x) => x >= 0.2).length;
    el.textContent = `Ce tirage : de ${fmt(Math.min(...T))} à ${fmt(Math.max(...T))} °C, ${wetH ? `pluie pendant ${wetH} h sur les ${rain.length} prochaines` : 'pas de pluie'}, vent jusqu'à ${fmt(Math.max(...[].concat(...w.snapshot.gust)) * 3.6)} km/h.`;
  }

  function setMode(mode, init) {
    const prev = S.mode;
    S.mode = mode === 'date' ? 'date' : 'random';
    store.state.game.weatherMode = S.mode;
    $$('[data-wx-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.wxMode === S.mode)));
    $('#gs-wx-random').hidden = S.mode !== 'random';
    $('#gs-wx-date').hidden = S.mode !== 'date';
    const w = store.state.weather;
    if (S.mode === 'random') applyWeather();
    else if (!init && prev === 'random') { w.enabled = false; w.snapshot = null; w.fetchedFor = ''; w.fetchedAt = 0; }    // le tirage au hasard ne vaut pas pour une date
    store.save();
    store.emit('weather', { path: 'weather' });
    randomSummary();
    renderSummary();
  }

  function renderWeatherPanel() {
    $('#gs-wx-random-note').textContent = ownSky()
      ? "Le ciel de l'univers 3D change tout seul pendant la course : soleil, nuages, pluie, orage ou neige, avec des transitions douces."
      : 'Un temps tiré au hasard, qui évolue pendant la course : perturbations qui passent, pluie, vent qui tourne, température qui suit la journée et l\'altitude. Il agit sur la route (mouillée), la chaleur et le vent.';
    $('#gs-wx-reroll').hidden = ownSky();
    $('#gs-wx-reroll').onclick = () => {
      store.state.game.weatherSeed = 1 + Math.floor(Math.random() * 999999);
      applyWeather(); store.save(); store.emit('weather', { path: 'weather' }); randomSummary(); renderSummary();
    };
    $$('[data-wx-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.wxMode)));
  }

  /* ---------- 3 bis. Ciel et Météo (Virtual Ride 3D) ---------- */

  const SKY_MODES = ['course', 'real', 'game'];
  const skyMode = () => (SKY_MODES.includes(store.state.game.skyMode) ? store.state.game.skyMode : 'game');
  const FLOWS = [0, 1, 10, 60, 300];

  /**
   * Météo de la simulation selon la source choisie : « du parcours » = celle enregistrée avec le parcours (prévisions ou portions décrites à la main),
   * recalée sur la date et l'heure de départ choisies ; « réelle » = les prévisions récupérées pour ce parcours et ce départ (à récupérer) ;
   * « du jeu » = aucune, le ciel est seulement dessiné par la vue 3D.
   */
  function composeSky(route, wxBefore, keyBefore) {
    const st = store.state, mode = skyMode();
    const sameRoute = !!(keyBefore && store.profile && We.routeKey(store.profile) === keyBefore);
    const prev = S.wxOrigin || mode;                          // d'où vient la météo qui était dans l'état : du parcours, des prévisions réelles ou de rien
    let startAt = wxBefore && wxBefore.startAt;
    // prévisions réelles déjà récupérées : gardées pour le cas où l'on quitte cette source puis qu'on y revient
    if (prev === 'real' && sameRoute && wxBefore && wxBefore.source === 'api' && wxBefore.snapshot && !wxBefore.snapshot.custom) S.realWx = wxBefore;
    const rw = route && route.data && route.data.weather;
    if (!startAt) startAt = (rw && rw.startAt) || tomorrow();
    let w;
    if (mode === 'course' && rw && (rw.snapshot || rw.source === 'custom')) {
      w = JSON.parse(JSON.stringify(rw));
      w.startAt = startAt;
      w.enabled = true;
      const sn = w.snapshot;
      if (sn && !sn.custom && w.source !== 'custom') {          // prévisions enregistrées : on les rejoue à partir du nouveau départ
        const e = We.localToEpoch(startAt, sn.off);
        if (Number.isFinite(e)) { const d = e - sn.start; sn.start += d; sn.t0 += d; }
        w.fetchedFor = We.freshKey(store.profile, startAt);
      } else { w.snapshot = null; w.fetchedFor = ''; }        // portions décrites à la main : l'instantané est refait pour le départ (tab-weather.js syncCustom)
    } else if (mode === 'real' && prev === 'real' && sameRoute && wxBefore && wxBefore.source === 'api' && wxBefore.snapshot && !wxBefore.snapshot.custom) {
      w = wxBefore;                                              // les prévisions récupérées (elles ne valent que pour ce départ : isFresh le vérifie)
    } else if (mode === 'real' && S.realWx && sameRoute && S.realWx.fetchedFor === We.freshKey(store.profile, startAt)) {
      w = S.realWx;
    } else {
      w = freshWeather(startAt);
      w.source = 'api';
    }
    if (mode === 'game') { w.enabled = false; w.snapshot = null; w.fetchedFor = ''; }
    w.startAt = startAt;
    S.wxOrigin = mode;
    st.weather = w;
  }

  function skySummary() {
    const g = store.state.game, w = store.state.weather, mode = skyMode(), at = String(w.startAt || '').replace('T', ' à ');
    const TW = { sun: 'soleil', cloud: 'nuageux', rain: 'pluie', storm: 'orage', snow: 'neige', random: 'temps aléatoire' }, TV = { calm: 'vent calme', breeze: 'brise', strong: 'vent fort', storm: 'tempête', random: 'vent aléatoire' };
    if (mode === 'game') return `départ ${at} · ${TW[g.skyWeather] || 'temps aléatoire'}, ${TV[g.skyWind] || 'vent aléatoire'}`;
    if (mode === 'real') return w.snapshot && w.enabled ? `météo réelle du ${at}` : `météo réelle du ${at} (à récupérer)`;
    return w.snapshot && w.enabled ? `météo du parcours, départ ${at}` : 'pas de météo enregistrée avec ce parcours';
  }

  function renderSky() {
    const g = store.state.game, w = store.state.weather, mode = skyMode();
    $$('[data-sky-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.skyMode === mode)));
    for (const m of SKY_MODES) $('#gs-wx-' + m).hidden = m !== mode;
    $$('#gs-flow [data-flow]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.flow) === Number(g.skyFlow))));
    $$('#gs-sky-weather [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === g.skyWeather)));
    $$('#gs-sky-wind [data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === g.skyWind)));
    const inp = $('#gs-start');
    if (document.activeElement !== inp) inp.value = w.startAt || '';
    // météo du parcours : ce que le parcours apporte
    const rw = (find('route', pickId('route')) || { data: {} }).data.weather;
    const has = !!(rw && (rw.snapshot || rw.source === 'custom'));
    $('#gs-wx-course-note').textContent = has
      ? (rw.source === 'custom' ? 'Température, pluie et vent décrits sur la page Parcours de PaceYourRide, appliqués à partir de la date et de l\'heure de départ.' : 'Les prévisions enregistrées avec le parcours, rejouées à partir de la date et de l\'heure de départ.')
      : "Ce parcours n'a pas de météo enregistrée : décris-en une, ou récupère des prévisions, sur la page Parcours de PaceYourRide. En attendant, le ciel du jeu est utilisé.";
    $('#gs-wx-course-sum').textContent = has && w.snapshot ? `${fmt(Math.min(...[].concat(...w.snapshot.T)))} à ${fmt(Math.max(...[].concat(...w.snapshot.T)))} °C` : '';
  }

  function setSkyMode(mode) {
    const g = store.state.game;
    g.skyMode = SKY_MODES.includes(mode) ? mode : 'game';
    compose();
    renderSky();
    renderSummary();
  }

  function initSky() {
    const g = store.state.game;
    if (!SKY_MODES.includes(g.skyMode)) g.skyMode = 'game';
    if (!FLOWS.includes(Number(g.skyFlow))) g.skyFlow = 1;
    $$('[data-sky-mode]').forEach((b) => b.addEventListener('click', () => setSkyMode(b.dataset.skyMode)));
    $$('#gs-flow [data-flow]').forEach((b) => b.addEventListener('click', () => { g.skyFlow = Number(b.dataset.flow); store.save(); renderSky(); }));
    $$('#gs-sky-weather [data-v]').forEach((b) => b.addEventListener('click', () => { g.skyWeather = b.dataset.v; store.save(); renderSky(); renderSummary(); }));
    $$('#gs-sky-wind [data-v]').forEach((b) => b.addEventListener('click', () => { g.skyWind = b.dataset.v; store.save(); renderSky(); renderSummary(); }));
    $('#gs-start').addEventListener('change', (e) => {
      if (!e.target.value) { e.target.value = store.state.weather.startAt; return; }
      store.set('weather.startAt', e.target.value);
      compose();
      renderSky();
      renderSummary();
    });
  }

  /* ---------- départ ---------- */

  function renderSummary() {
    const route = find('route', pickId('route')), ath = find('athlete', pickId('athlete')), p = store.profile;
    const w = store.state.weather;
    const wx = ownSky() ? skySummary() : S.mode === 'random' ? 'météo aléatoire' : (w.snapshot && w.enabled ? 'météo du ' + String(w.startAt).replace('T', ' à ') : 'météo à récupérer');
    $('#gs-go-sum').textContent = route ? [route.name, ath ? (L.summary('athlete', ath.data) || {}).title || ath.name : 'athlète par défaut', wx].join(' · ') : 'Choisis un parcours pour commencer.';
    $('#g-go').disabled = !route || !p;
  }

  async function start(params) {
    if (!store.profile) { D.toast('Choisis d\'abord un parcours.', 'error'); return; }
    if ((ownSky() ? skyMode() === 'real' : S.mode === 'date') && !PYR.tabWeather.isFresh()) {
      await PYR.tabWeather.fetch();
      if (!PYR.tabWeather.isFresh() && !confirm("La météo de cette date n'a pas pu être récupérée. Partir sans météo ?")) return;
    }
    PYR.app.go('race', params || { start: 1 });
  }

  function renderAll() {
    renderCloud();
    renderRoutes();
    renderAthletes();
    compose();
    randomSummary();
    renderSummary();
  }

  const G = {
    init() {
      const st = store.state;
      if (!st.game.pick || typeof st.game.pick !== 'object') st.game.pick = { route: '', athlete: '', bike: '', outfit: '' };
      S.mode = st.game.weatherMode === 'date' ? 'date' : 'random';
      C.load();
      if (ownSky()) initSky(); else renderWeatherPanel();
      $('#g-go').addEventListener('click', () => start());
      $('#g-live-create').addEventListener('click', () => start({ do: 'live-create' }));
      $('#g-live-join').addEventListener('click', () => start({ do: 'live-join' }));
      renderAll();
      // VirtualRide3D : matériel modifié sur la vue 3D (gear-edit.js) ; les changements sont enregistrés tout de suite
      if ($('#gs-gear3d')) PYR.gearEdit.init($('#gs-gear3d'), () => { PYR.app.refreshBindings(); });
      if (ownSky()) renderSky(); else setMode(S.mode, true);
      // le choix se fait sur la page d'accueil : on le relit au retour sur cette page et quand une autre page le change
      const reread = () => { C.load(); renderAll(); };
      window.addEventListener('pageshow', (e) => { if (e.persisted) reread(); });
      window.addEventListener('storage', (e) => { if (e.key === 'paceyourride.v1' || e.key === 'paceyourride.library.v1') reread(); });
      store.on('weather', () => { randomSummary(); if (ownSky()) renderSky(); renderSummary(); });      // météo récupérée, ou tirée à nouveau
      // lecture de Dropbox à l'ouverture, quand l'appareil est connecté
      if (PYR.cloud.status().connected) refresh();
      PYR.cloud.onChange(() => { if (!C.state.busy) renderCloud(); });
    },
    /** Pour les tests de l'interface. */
    _state: S,
  };

  PYR.gameSetup = G;
})(globalThis.PYR = globalThis.PYR || {});
