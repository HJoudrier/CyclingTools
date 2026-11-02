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
    // la météo suit le parcours : changer de parcours abandonne celle qui avait été récupérée
    st.weather = keyBefore && store.profile && We.routeKey(store.profile) === keyBefore && wxBefore ? wxBefore : freshWeather(wxBefore && wxBefore.startAt);
    if (!st.weather.startAt) st.weather.startAt = tomorrow();
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
    if (S.mode !== 'random') return;
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
    if (ownSky()) { el.textContent = ''; return; }
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

  /* ---------- départ ---------- */

  function renderSummary() {
    const route = find('route', pickId('route')), ath = find('athlete', pickId('athlete')), p = store.profile;
    const w = store.state.weather;
    const wx = S.mode === 'random' ? (ownSky() ? 'ciel variable' : 'météo aléatoire') : (w.snapshot && w.enabled ? 'météo du ' + String(w.startAt).replace('T', ' à ') : 'météo à récupérer');
    $('#gs-go-sum').textContent = route ? [route.name, ath ? (L.summary('athlete', ath.data) || {}).title || ath.name : 'athlète par défaut', wx].join(' · ') : 'Choisis un parcours pour commencer.';
    $('#g-go').disabled = !route || !p;
  }

  async function start(params) {
    if (!store.profile) { D.toast('Choisis d\'abord un parcours.', 'error'); return; }
    if (S.mode === 'date' && !PYR.tabWeather.isFresh()) {
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
      renderWeatherPanel();
      $('#g-go').addEventListener('click', () => start());
      $('#g-live-create').addEventListener('click', () => start({ do: 'live-create' }));
      $('#g-live-join').addEventListener('click', () => start({ do: 'live-join' }));
      renderAll();
      // VirtualRide3D : matériel modifié sur la vue 3D (gear-edit.js) ; les changements sont enregistrés tout de suite
      if ($('#gs-gear3d')) PYR.gearEdit.init($('#gs-gear3d'), () => { PYR.app.refreshBindings(); });
      setMode(S.mode, true);
      // le choix se fait sur la page d'accueil : on le relit au retour sur cette page et quand une autre page le change
      const reread = () => { C.load(); renderAll(); };
      window.addEventListener('pageshow', (e) => { if (e.persisted) reread(); });
      window.addEventListener('storage', (e) => { if (e.key === 'paceyourride.v1' || e.key === 'paceyourride.library.v1') reread(); });
      store.on('weather', () => { randomSummary(); renderSummary(); });      // météo récupérée, ou tirée à nouveau
      // lecture de Dropbox à l'ouverture, quand l'appareil est connecté
      if (PYR.cloud.status().connected) refresh();
      PYR.cloud.onChange(() => { if (!C.state.busy) renderCloud(); });
    },
    /** Pour les tests de l'interface. */
    _state: S,
  };

  PYR.gameSetup = G;
})(globalThis.PYR = globalThis.PYR || {});
