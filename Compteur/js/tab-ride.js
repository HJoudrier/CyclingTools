/* author : Hugo Joudrier-Faure */
/* PaceYourRide — compteur (Compteur/index.html, téléphone) : suivre le plan de puissance optimal pendant une vraie sortie, avec un capteur de
 * puissance Bluetooth et le GPS du téléphone.
 *
 * La page affiche l'avance ou le retard sur le plan (position lissée sur quelques secondes), la puissance à tenir sur le tronçon en
 * cours, les réserves (W′, glycogène, hydratation) et les rappels d'alimentation. Quand on s'écarte du plan (écart de temps, consigne non
 * respectée, W′ qui s'éloigne de celui du plan), le plan du reste du parcours est recalculé depuis l'état réel : le passé est figé
 * (Commun/js/engine/ride.js, optimizer.js avec `start`).
 * La logique est dans Commun/js/engine/ride.js et nutrition.js ; ce module ne fait que relier les capteurs, l'état et l'affichage. */
(function (PYR) {
  'use strict';

  const U = PYR.util, D = PYR.dom, store = PYR.store, R = PYR.ride, Fu = PYR.fuel, Nu = PYR.nutrition, Sx = PYR.sensors;
  const { h, $ } = D;

  const SESSION_KEY = 'paceyourride.compteur.session.v1';
  const SAVE_EVERY = 15;                    // s : sauvegarde de la sortie en cours
  const SPEEDS = [1, 5, 10, 20, 50];        // vitesses du mode démo
  const KEEP_MS = 90000;                    // ms : mesures des capteurs gardées en attendant leur seconde
  const MIXES = [['', 'Aucun'], ['water', 'Eau'], ['hypo', 'Hypotonique'], ['iso', 'Énergétique'], ['hyper', 'Hypertonique']];
  const SLOT_LABEL = ['Bidon 1', 'Bidon 2', 'Bidon 3', 'Camelback'];
  const FOOD_LABEL = { gel: 'Gel double source', gelglu: 'Gel glucose', gelplus: 'Gel haute dose', gelcaf: 'Gel caféiné', bar: 'Barre', barmini: 'Mini-barre' };
  const SENS_LABEL = { low: 'Faible', normal: 'Normale', high: 'Forte' };
  const POWER_VIEWS = [['gauge', 'Jauge (ligne et intervalle)'], ['dial', 'Cadran']];

  const V = {};                             // éléments du DOM
  const run = {
    mode: 'prep',                           // 'prep' | 'live' | 'done'
    plan: null, planRes: null, adopted: null, base: null, baseFp: '',
    sess: null, coach: null, nut: null, timer: null,
    demo: null, demoWall: 0, demoSpeed: 5,
    replayAct: null, replayName: '', replayInfo: null,   // sortie enregistrée à rejouer dans le mode démo (GPX, TCX, FIT)
    power: [], fix: [], hrs: [], cads: [],  // mesures des capteurs, datées
    panels: new Set(),                      // panneaux de capteurs affichés (page de démarrage, menu de la sortie)
    mapOn: false, mapHome: null, turns: [], mapRaf: 0,   // carte de la sortie (attachMap)
    mix: null, mixTab: 'course', mixSig: '',                                           // défi contre des coureurs virtuels (ride-mixed.js)
    lastFix: null, powerOn: false, hrOn: false, gpsOn: false, gpsErr: '',
    paused: false, replanning: false, lastSave: 0, lastRender: 0,
    profNear: true, profPts: null,
    al: { seg: -1, over: null, under: null, last: 0, eat: null, drink: null, wbal: false, gps: false, pwr: false },
    busy: false, segPlan: null, nutKey: '',
  };

  const setTxt = (el, s) => { if (el && el._t !== s) { el.textContent = s; el._t = s; } };
  const setAttr = (el, k, v) => { if (el && el.getAttribute(k) !== String(v)) el.setAttribute(k, v); };
  const cfg = () => store.state.ride.cfg;
  const hmm = (sec) => U.fmtClock(sec);
  const km = (m, d = 1) => U.fmt(m / 1000, d);
  const gapText = (sec) => (Math.abs(sec) < 1 ? '0:00' : hmm(Math.abs(sec)));

  /* ---------- empreinte des réglages d'un plan (Commun/js/ui/plan-link.js) ---------- */
  const fingerprint = () => PYR.planLink.fingerprint();

  /* ---------- entrées de l'optimiseur ---------- */
  function buildBase() {
    const base = PYR.simInputs.build(undefined, { plan: true });
    return base;
  }

  const refIsForm = (margin) => PYR.planLink.refIsForm(margin);
  const planRef = (athlete, margin, w) => PYR.planLink.planRef(athlete, margin, w);
  /** Athlète suivi pendant la sortie (W′bal de la jauge, temps tenable). */
  function sessionAthlete(base) {
    if (!refIsForm(base.margin)) return base.athlete;
    const k = 1 - base.margin;
    return PYR.physio.scaleAthlete(base.athlete, k, k);
  }

  /** Entrées de la sortie : la météo est lue à l'heure réelle (départ + temps écoulé), pas à l'heure prévue au départ. */
  function sessionBase(startMs) {
    const base = buildBase();
    const w = base.course.weather;
    if (w) base.course = Object.assign({}, base.course, { weather: Object.assign({}, w, { start: Math.floor(startMs / 1000) }) });
    base.athleteFresh = PYR.physio.buildAthlete(store.state.rider);   // sans la chaleur moyenne du plan (modèle physiologique)
    return base;
  }

  /**
   * Carte athlète du modèle physiologique pour la sortie (réglage « Modèle physiologique », activé par défaut) : celle du profil, à
   * l'échelle de la forme quand la sortie se lit sur le profil ajusté. null sans le modèle.
   */
  function physioCard(base) {
    if (!PYR.metabo || cfg().physio === false) return null;
    const c = PYR.metabo.card(store.state.rider, base.athleteFresh || PYR.physio.buildAthlete(store.state.rider));
    const k = refIsForm(base.margin) ? 1 - base.margin : 1;
    return k === 1 ? c : PYR.metabo.scaleCard(c, k, k);
  }

  /* ======================================================================
   * Plan
   * ====================================================================== */
  function loadStoredPlan() {
    const r = store.state.ride;
    run.plan = r.plan ? R.unpackPlan(r.plan) : null;
    if (!run.plan) run.planRes = null;
  }

  function savePlan(plan, source) {
    run.plan = plan;
    PYR.planLink.save(plan, source);
  }

  /** Le plan calculé sur la page Pacing optimal, s'il est à jour, devient celui de la sortie. */
  function adoptPerfPlan(force) {
    const res = store.plan;
    if (!res || store.planStale || !store.profile || (!force && run.adopted === res)) return false;
    run.adopted = res;
    savePlan(R.planFromResult(res, res.inputs ? res.inputs.length : store.profile.length, planRef(res.athlete, res.margin)), 'perf');
    return true;
  }

  async function computePlan() {
    if (run.busy) return;
    let inputs;
    try { inputs = buildBase(); } catch (e) { D.toast(e.message, 'error'); return; }
    const algo = store.state.perf.algo;
    inputs.algo = algo === 'analytic' || algo === 'gradient' || algo === 'hybrid' ? algo : 'analytic';
    run.busy = true;
    V.planBtn.disabled = true; V.planProg.hidden = false; V.planFill.style.width = '2%';
    setTxt(V.planBtn, 'Calcul en cours…');
    await U.sleep(20);
    try {
      const res = await PYR.optimizer.optimize(inputs, (f) => { V.planFill.style.width = Math.round(Math.max(2, f * 100)) + '%'; });
      if (!res.ok) { D.toast(res.error, 'error'); return; }
      savePlan(R.planFromResult(res, inputs.course.length, planRef(inputs.athlete, inputs.margin)), 'ride');
      D.toast(`Plan calculé en ${U.fmt(res.elapsedMs / 1000, 1)} s : ${U.fmtDuration(res.tFinish)}.`);
    } catch (e) {
      console.error(e);
      D.toast('Erreur pendant le calcul : ' + e.message, 'error');
    } finally {
      run.busy = false; V.planBtn.disabled = false; setTxt(V.planBtn, 'Calculer le plan');
      setTimeout(() => { V.planProg.hidden = true; }, 400);
      renderPrep();
    }
  }

  /* ======================================================================
   * Préparation
   * ====================================================================== */
  const card = (title, ...kids) => h('div', { class: 'rd-card' }, title ? h('h3', null, title) : null, ...kids);
  const rowEl = (label, ...kids) => h('div', { class: 'rd-row' }, h('span', { class: 'rd-lbl' }, label), h('span', { class: 'rd-ctl' }, ...kids));

  function selectEl(options, value, onChange) {
    const s = h('select', null, ...options.map(([v, l]) => h('option', { value: v }, l)));
    s.value = String(value);
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }
  function checkEl(label, value, onChange) {
    const c = h('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', () => onChange(c.checked));
    return h('label', { class: 'rd-check' }, c, label);
  }
  /**
   * Curseur avec sa valeur affichée à côté. L'étiquette suit le doigt (« input ») ; on.input(v) est appelée pendant le glissement,
   * on.change(v) quand on relâche (ou après une touche du clavier).
   */
  function sliderEl(value, min, max, step, fmt, on) {
    const r = h('input', { type: 'range', min, max, step, 'aria-label': 'Durée de la moyenne (s)' });
    r.value = value;
    const lbl = h('span', { class: 'val' }, fmt(Number(value)));
    r.addEventListener('input', () => { lbl.textContent = fmt(Number(r.value)); if (on.input) on.input(Number(r.value)); });
    r.addEventListener('change', () => on.change(Number(r.value)));
    return h('span', { class: 'rd-slider' }, r, lbl);
  }
  function numEl(value, min, max, step, onChange) {
    const n = h('input', { type: 'number', min, max, step, inputmode: 'numeric' });
    n.value = value;
    n.addEventListener('change', () => { const v = Math.min(max, Math.max(min, Number(n.value) || 0)); n.value = v; onChange(v); });
    return n;
  }

  /**
   * Champ de la forme du plan (% de capacités) : même réglage que « Forme » de la page Pacing optimal, changer
   * l'un change l'autre. after(v) est appelée avec la nouvelle valeur.
   */
  function marginEl(after) {
    const n = h('input', { type: 'number', min: 10, max: 300, step: 1, inputmode: 'decimal', 'aria-label': 'Forme du plan (% de mes capacités)' });
    n.value = store.state.perf.formPct;
    n.addEventListener('change', () => {
      const v = Math.min(300, Math.max(10, Number(n.value) || 100));
      n.value = v;
      store.set('perf.formPct', v);
      document.querySelectorAll('[data-bind="perf.formPct"]').forEach((o) => { o.value = v; });
      if (after) after(v);
    });
    return n;
  }

  function buildPrep() {
    const rs = store.state.ride;
    V.prep = h('section', { class: 'rd-prep' });

    // reprise d'une sortie interrompue
    V.resume = h('div', { class: 'rd-card rd-resume', hidden: true },
      h('h3', null, 'Une sortie est en cours'), V.resumeTxt = h('p', null),
      h('div', { class: 'rd-btns' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => resumeSession() }, 'Reprendre'),
        h('button', { class: 'btn', type: 'button', onclick: () => { clearSaved(); renderPrep(); } }, 'Abandonner')));

    V.pmapBox = h('div', { class: 'rd-pmap' });
    V.distLine = h('p', { class: 'rd-line' });
    V.mapCard = h('div', { class: 'rd-pblock' }, V.distLine, V.pmapBox);
    V.pprof = h('canvas', { class: 'rd-pprof' });
    V.pprofAuto = h('button', { class: 'btn', type: 'button', onclick: () => autoCheckpoints() }, 'Placer sprints et côtes automatiquement');
    V.upLine = h('p', { class: 'rd-line' });
    V.pprofCard = h('div', { class: 'rd-pblock' }, V.upLine, V.pprof, h('div', { class: 'rd-btns' }, V.pprofAuto));
    // parcours et plan
    V.routeLine = h('p', { class: 'rd-line' });
    V.planLine = h('p', { class: 'rd-line' });
    V.planWarn = h('p', { class: 'rd-warn', hidden: true });
    V.planBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => computePlan() }, 'Calculer le plan');
    V.perfBtn = h('button', { class: 'btn', type: 'button', onclick: () => { adoptPerfPlan(true); renderPrep(); D.toast('Plan repris.'); } }, 'Reprendre le plan calculé ici');
    V.planFill = h('div', { class: 'progress-fill' });
    V.planProg = h('div', { class: 'progress', hidden: true }, V.planFill);
    V.segTable = h('table', { class: 'rd-table' });
    V.margin = marginEl();
    // choix du parcours et de l'athlète dans la bibliothèque de PaceYourRide (Dropbox), comme dans les jeux ; on peut en ajouter
    V.cloudLine = h('p', { class: 'rd-line' });
    V.cloudBtn = h('button', { class: 'btn', type: 'button', onclick: () => cloudAction() }, '↻ Actualiser');
    V.pickRoutes = h('div', { class: 'gs-pick-routes' });
    V.pickAth = h('div', { class: 'gs-pick-ath' });
    V.pickBike = h('select', { 'aria-label': 'Vélo', onchange: () => pickItem('bike', V.pickBike.value) });
    V.pickOutfit = h('select', { 'aria-label': 'Tenue et position', onchange: () => pickItem('outfit', V.pickOutfit.value) });
    V.cloudCard = card('Parcours et athlète', V.cloudLine, h('div', { class: 'rd-btns' }, V.cloudBtn),
    V.pickRoutes, V.pickAth,
    h('div', { class: 'grid2' }, rowEl('Vélo', V.pickBike), rowEl('Tenue et position', V.pickOutfit)),
    h('p', { class: 'rd-note' }, 'Les parcours, athlètes, vélos et tenues sont ceux de Wattlas, lus dans ton Dropbox ; le plan optimal vient avec le projet en cours de Plan (ou calcule-le ici).'));
    V.routeCard = card('Parcours', V.routeLine, V.mapCard, V.pprofCard);
    V.formRef = selectEl([['athlete', 'Profil de l\'athlète à 100 %'], ['form', 'Profil ajusté à la forme']], store.state.perf.formRef, (v) => store.set('perf.formRef', v));
    V.formRefRow = rowEl('W′bal et temps tenable sur', V.formRef);
    V.formRefRow.hidden = true;
    V.planCard = card('Plan', V.planLine, V.planWarn,
      rowEl('Forme du plan (% de mes capacités)', h('span', { class: 'rd-inline' }, V.margin, ' %')), V.formRefRow,
      h('div', { class: 'rd-btns' }, V.planBtn, V.perfBtn), V.planProg,
      h('details', { class: 'rd-details' }, h('summary', null, 'Voir les tronçons du plan'), h('div', { class: 'rd-scroll-x' }, V.segTable)));

    // parcours en intégralité (carte) et profil avec les sprints et les côtes classées

    // défi contre des coureurs virtuels : réglages du mode jeu (nombre, niveau) et points de passage de la page Parcours
    V.mixSum = h('p', { class: 'rd-line' });
    V.mixWarn = h('p', { class: 'rd-warn', hidden: true });
    V.mixAuto = h('button', { class: 'btn', type: 'button', onclick: () => autoCheckpoints() }, 'Placer sprints et côtes automatiquement');
    V.mixCard = card('Défi contre des coureurs virtuels',
      checkEl('Rouler contre des coureurs virtuels', rs.cfg.mixed, (v) => { store.set('ride.cfg.mixed', v); renderPrep(); }),
      h('p', { class: 'rd-note' }, 'Des coureurs de ton niveau parcourent le même tracé, sans aspiration : sprints et côtes classées, classement et position de chacun sur la carte. Ils partent quand tu franchis la ligne.'),
      V.mixSum, V.mixWarn, h('div', { class: 'rd-btns' }, V.mixAuto));

    // capteurs
    V.sens = sensorPanel();
    V.sens.keep = true;
    V.pwrNote = h('p', { class: 'rd-note' }, Sx.power.supported
      ? 'Capteurs de puissance (pédales, manivelle, moyeu) et home-trainers, en Bluetooth basse consommation. Réveille le capteur (quelques tours de pédale) ; il ne se connecte qu\'à un appareil à la fois (coupe-le sur ton compteur). Si ton capteur n\'apparaît pas, « Autre appareil… » liste tout ce qui émet. L\'ANT+ n\'est pas accessible depuis un navigateur : la plupart des capteurs sont aussi en Bluetooth.'
      : 'Ce navigateur n\'a pas de Bluetooth : la puissance sera estimée d\'après la vitesse et la pente (moins précis). Sur iPhone, le navigateur Bluefy permet le Bluetooth ; sur Android, Chrome.');
    const dm = rs.demo;
    V.demoChk = checkEl('Mode démo : un cycliste simulé roule à ta place', false, (v) => { V.demoOpts.hidden = !v; renderPrep(); });
    V.replayFile = h('input', { type: 'file', accept: '.gpx,.tcx,.fit,application/gpx+xml,application/xml,text/xml,application/octet-stream', hidden: true, onchange: onReplayFile });
    V.replayPick = h('button', { class: 'btn', type: 'button', onclick: () => V.replayFile.click() }, 'Choisir une sortie…');
    V.replayClear = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => { run.replayAct = null; run.replayName = ''; run.replayInfo = null; renderReplay(); renderPrep(); } }, 'Retirer');
    V.replaySt = h('p', { class: 'rd-note' });
    V.biasRow = rowEl('Il suit la consigne à', h('span', { class: 'rd-inline' }, numEl(dm.bias, -40, 40, 1, (v) => store.set('ride.demo.bias', v)), ' % près'));
    V.demoOpts = h('div', { class: 'rd-demo-opts', hidden: true },
      rowEl('Rejouer une sortie enregistrée', V.replayPick, V.replayClear, V.replayFile),
      V.replaySt,
      rowEl('Vitesse du temps', selectEl(SPEEDS.map((x) => [x, '×' + x]), dm.speed, (v) => store.set('ride.demo.speed', Number(v)))),
      V.biasRow);
    renderReplay();
    V.sensCard = card('Capteurs',
      V.sens.gps, ...V.sens.pwr, V.pwrNote, V.sens.avg, V.sens.alt, ...V.sens.hr,
      h('div', { class: 'rd-sep' }), V.demoChk, V.demoOpts);

    // alimentation
    V.kitBox = h('div', { class: 'rd-kit' });
    V.nutSum = h('div', { class: 'rd-nutsum' });
    V.nutList = h('ol', { class: 'rd-events' });
    V.nutCard = card('Alimentation et boisson',
      h('p', { class: 'rd-note' }, 'Ce que tu emportes. Le plan d\'alimentation en découle : combien de glucides par heure, quand boire, quand manger.'),
      V.kitBox, V.nutSum, h('details', { class: 'rd-details' }, h('summary', null, 'Voir le calendrier prévu'), V.nutList));

    // réglages
    const c = rs.cfg;
    V.setCard = card('Réglages',
      checkEl('Recalculer le plan automatiquement', c.auto, (v) => store.set('ride.cfg.auto', v)),
      rowEl('Sensibilité du recalcul', selectEl(Object.entries(SENS_LABEL), c.sens, (v) => store.set('ride.cfg.sens', v))),
      rowEl('Lissage de l\'écart', selectEl([[5, '5 s'], [8, '8 s'], [12, '12 s'], [20, '20 s']], c.gapTau, (v) => store.set('ride.cfg.gapTau', Number(v)))),
      rowEl('Annoncer un changement de consigne', selectEl([[0, 'jamais'], [5, '5 s avant'], [10, '10 s avant'], [15, '15 s avant'], [20, '20 s avant']], c.lookahead, (v) => store.set('ride.cfg.lookahead', Number(v)))),
      rowEl('Mises à jour météo', selectEl([[5, 'toutes les 5 min'], [15, 'toutes les 15 min'], [30, 'toutes les 30 min'], [60, 'toutes les 60 min']], c.weatherMin, (v) => { store.set('ride.cfg.weatherMin', Number(v)); }), h('span', { class: 'rd-st' }, 'si la météo est activée')),
      rowEl('Consigne (vue Puissance)', selectEl(POWER_VIEWS, c.powerView === 'dial' ? 'dial' : 'gauge', (v) => store.set('ride.cfg.powerView', v))),
      h('div', { class: 'rd-checks' },
        checkEl('Bips', c.sound, (v) => { store.set('ride.cfg.sound', v); if (v) Sx.alerts.unlock(); }),
        checkEl('Vibrations', c.vibrate, (v) => store.set('ride.cfg.vibrate', v)),
        checkEl('Voix', c.voice, (v) => { store.set('ride.cfg.voice', v); if (v) { Sx.alerts.unlock(); Sx.alerts.speak('Voix activée'); } })),
      h('div', { class: 'rd-checks' },
        checkEl('Profil d\'élévation sur la carte', c.mapProfile, (v) => store.set('ride.cfg.mapProfile', v)),
        // réserves du modèle physiologique (carte athlète de la page Athlète) : glycogène par fibres, glycémie, température, eau, FC prévue
        checkEl('Modèle physiologique (carte athlète)', c.physio !== false, (v) => store.set('ride.cfg.physio', v)),
        ));

    V.startBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => startLive() }, 'Démarrer la sortie');
    V.startHint = h('p', { class: 'rd-note center' });
    V.liveBox = h('div', { id: 'live-box' });
    V.liveCard = card('Partie de Course', V.liveBox);
    V.prep.append(V.resume, V.liveCard, V.cloudCard, V.routeCard, V.planCard, V.mixCard, V.sensCard, V.nutCard, V.setCard, V.startBtn, V.startHint);
    buildKit();
  }

  function buildKit() {
    const rs = store.state.ride;
    D.clear(V.kitBox);
    // 'kit' : le plan de la page Pacing optimal vérifié sur le modèle physiologique dépend du matériel emporté
    const save = () => { store.save(); renderNutrition(); store.emit('kit'); };
    SLOT_LABEL.forEach((lbl, i) => {
      V.kitBox.append(rowEl(lbl, selectEl(MIXES, rs.kit.slots[i] || '', (v) => { rs.kit.slots[i] = v; save(); })));
    });
    const foods = h('div', { class: 'rd-foods' });
    for (const k of Fu.FOOD_IDS) {
      foods.append(h('label', { class: 'rd-food' }, h('span', null, `${FOOD_LABEL[k]} (${Fu.FOODS[k].carbs} g)`), numEl(rs.kit.items[k] || 0, 0, 6, 1, (v) => { rs.kit.items[k] = v; save(); })));
    }
    V.kitBox.append(h('div', { class: 'rd-sep' }), foods);
  }

  function renderPrep() {
    if (run.mode !== 'prep') return;
    const p = store.profile, rs = store.state.ride;
    adoptPerfPlan(false);
    if (!run.plan) loadStoredPlan();
    // parcours
    V.routeLine.hidden = !!p;                                    // sans parcours : seul ce message s'affiche
    setTxt(V.routeLine, 'Aucun parcours : crée-le dans Plan, puis récupère-le ici depuis Dropbox.');
    if (p) {
      const st = p.stats || {};
      setTxt(V.distLine, `Distance : ${km(p.length)} km`);
      setTxt(V.upLine, `Dénivelé positif : ${U.fmt(st.up || 0)} m / Dénivelé négatif : ${U.fmt(st.down || 0)} m`);
    }
    const plan = run.plan;
    if (document.activeElement !== V.margin) V.margin.value = store.state.perf.formPct;   // modifiée sur la page Pacing optimal
    V.formRef.value = store.state.perf.formRef;
    V.formRefRow.hidden = Number(store.state.perf.formPct) === 100;                        // sans effet à 100 % de forme
    V.planBtn.disabled = !p || run.busy;
    V.perfBtn.hidden = !(store.plan && !store.planStale);
    if (plan) {
      const avg = plan.P.length ? plan.P.reduce((a, b) => a + b, 0) / plan.P.length : 0;
      const dur = plan.tFinish - plan.t0;
      setTxt(V.planLine, `Plan : ${U.fmtDuration(dur)} · ${U.fmt(plan.length / Math.max(1, dur) * 3.6, 1)} km/h · ${U.fmt(avg)} W en moyenne`);
      const stale = rs.planInfo && rs.planInfo.fp !== fingerprint();
      const diffLen = p && Math.abs(plan.length - p.length) > 50;
      V.planWarn.hidden = !(stale || diffLen);
      setTxt(V.planWarn, diffLen ? 'Ce plan ne correspond plus au parcours : recalcule-le.' : 'Le parcours, le cycliste ou le vélo ont changé depuis le calcul : recalcule le plan.');
      renderSegTable(plan);
    } else {
      setTxt(V.planLine, 'Pas encore de plan. Calcule-le ici, ou dans Plan (page Pacing optimal) puis récupère-le depuis Dropbox.');
      V.planWarn.hidden = true;
      D.clear(V.segTable);
    }
    renderCloud();
    V.cloudCard.hidden = inGame();
    renderPrepMap();
    renderPrepProfile();
    // défi contre des coureurs virtuels
    renderMixPrep();
    // capteurs
    renderSensors();
    // départ
    const demo = V.demoChk.querySelector('input').checked;
    const can = !!p && !!plan && (demo || run.gpsOn || run.lastFix);
    V.startBtn.disabled = !can;
    setTxt(V.startHint, !p ? 'Il faut un parcours.' : !plan ? 'Il faut un plan.' : !(demo || run.gpsOn) ? 'Active le GPS (ou le mode démo) pour démarrer.' : demo ? (run.replayAct ? `Mode démo : la sortie « ${run.replayName} » est rejouée, rien n'est mesuré.` : 'Mode démo : rien n\'est mesuré, un cycliste simulé suit la consigne.')
      : Sx.power.state === 'on' ? 'Prêt : GPS et capteur de puissance.' : 'Sans capteur de puissance, elle sera estimée d\'après la vitesse, la météo et la pente.');
    renderNutrition();
    renderResume();
  }

  /* ---------- parcours et athlète : la bibliothèque de PaceYourRide, lue dans Dropbox (lib-cache.js), propre à cette application ---------- */
  const LC = PYR.libCache;
  const pickOf = () => { const G = store.state.game; if (!G.pick || typeof G.pick !== 'object') G.pick = { route: '', athlete: '', bike: '', outfit: '' }; return G.pick; };
  let pickViews = [];

  function renderCloud() {
    const st = PYR.cloud.status(), c = LC.state, n = (k) => c.lib[PYR.library.KINDS[k].list].length;
    const when = c.pulledAt ? new Date(c.pulledAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    setTxt(V.cloudLine, run.cloudBusy ? 'Échange avec Dropbox…' : run.cloudMsg ? run.cloudMsg
      : !st.connected ? 'Dropbox non connecté : connecte-le pour retrouver les parcours et athlètes de Wattlas.'
        : `Dropbox connecté · ${n('route')} parcours, ${n('athlete')} athlète${n('athlete') > 1 ? 's' : ''}${when ? ' · lu le ' + when : ''}`);
    V.cloudBtn.disabled = !!run.cloudBusy;
    setTxt(V.cloudBtn, st.connected ? '↻ Actualiser' : 'Se connecter à Dropbox');
  }

  /** Le parcours et l'athlète se choisissent (et se créent, ou se modifient) sur la page d'accueil du site, pour toutes les applications. */
  const goHome = () => { store.saveNow(); const go = () => { location.href = (PYR.root || '') + 'index.html'; }; PYR.kv.flush().then(go, go); };
  const chosen = (kind) => LC.find(kind, LC.pickId(kind, LC.PROJECT_ID));

  function renderPickers() {
    const pick = pickOf();
    for (const v of pickViews) v.destroy();
    const route = chosen('route'), ath = chosen('athlete');
    pickViews = [PYR.libPick.routePicker(V.pickRoutes, { items: route ? [route] : [], pick: route ? route.id : '', onPick: () => {}, projectLabel: "Choisi sur l'accueil",
      extra: [{ label: "↩ Changer de parcours (page d'accueil)", title: "Le parcours se choisit, se crée ou se modifie sur la page d'accueil du site", fn: goHome }],
      emptyText: "Aucun parcours choisi : choisis ou crée un parcours sur la page d'accueil du site." })];
    PYR.libPick.athletePicker(V.pickAth, { items: ath ? [ath] : [], pick: ath ? ath.id : '', onPick: () => {}, actions: () => [], emptyText: "Aucun athlète choisi : l'athlète par défaut est utilisé. Choisis-en un sur la page d'accueil du site." });
    V.pickAth.querySelector('.gs-add').appendChild(h('button', { class: 'btn', type: 'button', onclick: goHome }, "↩ Changer d'athlète (page d'accueil)"));
    for (const [kind, sel] of [['bike', V.pickBike], ['outfit', V.pickOutfit]]) {
      D.clear(sel);
      sel.appendChild(h('option', { value: 'none' }, 'Réglages par défaut'));
      for (const it of LC.items(kind)) sel.appendChild(h('option', { value: it.id }, it.name));
      sel.value = pick[kind] === 'none' ? 'none' : (LC.pickId(kind, pick[kind]) || 'none');
    }
  }

  /** Recopie le choix dans l'état du compteur (les réglages propres au téléphone, alertes et mode démo, sont gardés), puis recharge le plan enregistré. */
  function composeSelection() {
    if (run.mode !== 'prep' || inGame()) return;      // dans une partie, le parcours est celui de la partie
    const keep = { cfg: store.state.ride.cfg, demo: store.state.ride.demo, plan: store.state.ride.plan, info: store.state.ride.planInfo };
    const pick = Object.assign({}, pickOf(), { route: LC.PROJECT_ID, athlete: LC.PROJECT_ID });
    if (!LC.compose(store.state, pick)) return;
    store.state.ride.cfg = keep.cfg; store.state.ride.demo = keep.demo;
    PYR.routeModel.computeMissing();
    PYR.routeModel.rebuildProfile();
    // un plan calculé ici pour ce même choix vaut mieux que celui du projet de PaceYourRide
    if (keep.plan && keep.info && keep.info.fp === PYR.planLink.fingerprint()) { store.state.ride.plan = keep.plan; store.state.ride.planInfo = keep.info; }
    run.plan = null; run.base = null; run.segPlan = null;
    loadStoredPlan();
    store.save();
  }

  function pickItem(kind, id) {
    pickOf()[kind] = id;
    composeSelection();
    renderPickers(); renderCloud(); renderPrep();
  }

  function cloudAction() {
    if (!PYR.cloud.status().connected) { PYR.cloud.login().catch((e) => D.toast(e.message, 'error')); return; }
    pullFromCloud(true);
  }

  /** Lit la bibliothèque dans Dropbox. À l'ouverture (force faux), le choix est recomposé si la bibliothèque a changé. */
  async function pullFromCloud(force) {
    if (run.cloudBusy || run.mode !== 'prep' || !PYR.cloud.status().connected) return;
    run.cloudBusy = true; run.cloudMsg = ''; renderCloud();
    try {
      const r = await LC.refresh();
      if (r === 'vide') run.cloudMsg = 'Ton Dropbox ne contient encore rien : ajoute un parcours et un athlète ici, ou ouvre Plan.';
      else if (force) D.toast('Bibliothèque lue dans Dropbox.');
    } catch (e) { run.cloudMsg = e.message; if (force) D.toast(e.message, 'error'); }
    run.cloudBusy = false;
    composeSelection();
    renderPickers(); renderCloud(); renderPrep();
  }

  /* ---------- partie Virtual Ride rejointe avec le GPS (live.js) ---------- */

  const inGame = () => !!(PYR.live && PYR.live.session && PYR.live.session.race);

  /**
   * Le Compteur rejoint une partie d'un jeu Virtual Ride (il ne l'organise pas) : le parcours de la partie remplace celui du compteur, on fait la sortie
   * pour de vrai, et la position donnée par le GPS (le cycliste « sur la vraie route »), la puissance du capteur et la vitesse sont envoyées aux autres joueurs.
   * live.js appelle armLive à chaque heure de départ donnée, leaveLive quand on quitte la partie.
   */
  PYR.liveHost = {
    joinOnly: true,
    armLive(local) {
      const first = !run.live;
      run.live = Object.assign(run.live || { trace: { s: [], P: [] }, last: 0, done: false }, { startAt: local });
      if (run.mode !== 'prep') return;
      if (first) {
        run.plan = null; run.base = null; run.segPlan = null;
        loadStoredPlan();
        D.toast('Partie rejointe : le parcours de la partie est chargé. Calcule ton plan puis démarre ta sortie à l\'heure du départ.', undefined, 7000);
      }
      renderPrep();
      if ((!run.plan || PYR.planLink.isStale()) && !run.busy && store.profile) computePlan();
    },
    leaveLive() {
      run.live = null;
      if (V.liveBar) V.liveBar.hidden = true;
      if (run.mode === 'prep') renderPrep();
    },
  };

  /** Chaque demi-seconde de la sortie : la position, la vitesse et la puissance partent vers les autres joueurs ; chaque seconde de course est gardée pour l'arrivée. */
  function liveTick(sess, g) {
    const L = run.live;
    if (!L || !g || !PYR.live.inRace()) return;
    const now = Date.now(), raceT = (now - L.startAt) / 1000, tr = L.trace;
    const k = Math.floor(raceT);
    if (k >= 0) {
      if (!tr.s.length) for (let i = 0; i < k; i++) { tr.s.push(0); tr.P.push(0); }     // avant le départ de la sortie : au départ, sans puissance
      while (tr.s.length <= k) { tr.s.push(g.s); tr.P.push(Math.round(g.p3)); }
    }
    if (now - L.last >= 500) {
      L.last = now;
      PYR.live.sendState({ t: raceT, s: g.s, v: Math.max(0, g.v), P: Math.round(g.p3), w: U.clamp(g.wbalFrac, 0, 1), tac: 'manual', k: PYR.presence.CODE.road });
    }
    renderLiveBar(g);
  }

  /** Où je suis dans la partie : mon rang, et le joueur juste devant et juste derrière avec l'écart en mètres. */
  function renderLiveBar(g) {
    const opp = PYR.live.opponents().filter((o) => !o.finished || o.s > 0);
    if (!opp.length) { V.liveBar.hidden = true; return; }
    const ahead = opp.filter((o) => o.s > g.s).sort((a, b) => a.s - b.s)[0], behind = opp.filter((o) => o.s <= g.s).sort((a, b) => b.s - a.s)[0];
    const rank = 1 + opp.filter((o) => o.s > g.s).length;
    const txt = `Course · ${PYR.classifView.ordinal(rank)} sur ${opp.length + 1}` + (ahead ? ` · devant : ${ahead.name} +${distTxt(ahead.s - g.s)}` : '') + (behind ? ` · derrière : ${behind.name} −${distTxt(g.s - behind.s)}` : '');
    V.liveBar.hidden = false;
    setTxt(V.liveBar, txt);
  }

  /** Arrivée de la sortie sur le parcours de la partie : le temps et la trace sont envoyés (classement final de tous les joueurs). */
  function liveFinish(sess) {
    const L = run.live;
    if (!L || L.done || !PYR.live.inRace() || sess.s < sess.course.length - 25) return;
    L.done = true;
    const t = Math.max(1, Math.round((Date.now() - L.startAt) / 1000)), tr = L.trace;
    while (tr.s.length <= t) { tr.s.push(sess.course.length); tr.P.push(0); }
    PYR.live.finish({ time: t, s: tr.s.slice(0, t + 1), P: tr.P.slice(0, t + 1) });
  }

  /* ---------- parcours en intégralité et profil, avant le départ ---------- */
  const CP_TEXT = (c) => (c.type === 'sprint' ? 'S' : c.cat === 'hc' ? 'HC' : String(c.cat));

  /** Sprints et côtes classées du parcours (sans l'arrivée). */
  function prepCps() {
    const cps = mixCps();
    return cps ? cps.filter((c) => c.type === 'sprint' || c.type === 'kom') : [];
  }

  /** Carte annexe (sans lien avec celle de la page Parcours) : tout le tracé, départ, arrivée, sprints et côtes. Aucune interaction, pour ne pas gêner le défilement. */
  function renderPrepMap() {
    const p = store.profile;
    V.mapCard.hidden = !p;
    if (!p) return;
    const spec = PYR.map.baseSpec();
    if (!run.pmap) {
      run.pmap = L.map(V.pmapBox, { zoomControl: false, dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: false, zoomSnap: 0.25 });
      run.pmapLayers = L.layerGroup().addTo(run.pmap);
      run.pmapSig = '';
    }
    if (run.pmapBase !== spec.id) {
      if (run.pmapTiles) run.pmap.removeLayer(run.pmapTiles);
      run.pmapTiles = L.tileLayer(spec.url, { maxZoom: spec.maxZoom, subdomains: spec.subdomains || 'abc', attribution: spec.attribution, crossOrigin: true }).addTo(run.pmap);
      run.pmapBase = spec.id;
    }
    const cps = prepCps();
    const sig = [Math.round(p.length), p.n, p.lat[0].toFixed(4), p.lng[p.n - 1].toFixed(4), cps.map((c) => c.type + Math.round(c.s)).join(',')].join('|');
    const map = run.pmap;
    map.invalidateSize({ animate: false });
    if (sig === run.pmapSig && run.pmapW === V.pmapBox.clientWidth) return;
    run.pmapSig = sig; run.pmapW = V.pmapBox.clientWidth;
    const g = run.pmapLayers;
    g.clearLayers();
    const pts = [], stride = Math.max(1, Math.floor(p.n / 600));
    for (let i = 0; i < p.n; i += stride) pts.push([p.lat[i], p.lng[i]]);
    pts.push([p.lat[p.n - 1], p.lng[p.n - 1]]);
    g.addLayer(L.polyline(pts, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }));
    g.addLayer(L.polyline(pts, { color: '#2a78d6', weight: 4.5, opacity: 1, interactive: false }));
    const icon = (cls, txt, size) => L.divIcon({ className: '', html: `<div class="${cls}">${txt}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    g.addLayer(L.marker(pts[0], { icon: icon('wp-icon wp-start', 'D', 24), interactive: false, keyboard: false, zIndexOffset: 500 }));
    g.addLayer(L.marker(pts[pts.length - 1], { icon: icon('wp-icon wp-end', 'A', 24), interactive: false, keyboard: false, zIndexOffset: 500 }));
    for (const c of cps) {
      const ll = PYR.map.latLngAt(c.s);
      if (ll) g.addLayer(L.marker(ll, { icon: icon('cp-icon ' + c.type, CP_TEXT(c), 24), interactive: false, keyboard: false, zIndexOffset: 600 }));
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [26, 26], animate: false });
  }

  function renderPrepProfile() {
    const p = store.profile;
    V.pprofCard.hidden = !p;
    if (!p) return;
    const cps = prepCps();
    V.pprofAuto.parentNode.hidden = cps.length > 0;
    drawPrepProfile(cps);
  }

  /** Profil du parcours entier : sommets des côtes classées (zone rouge sous la courbe et pastille de catégorie) et sprints (trait vert et « S »). */
  function drawPrepProfile(cps) {
    const cv = V.pprof, p = store.profile;
    if (!p || !cv.isConnected) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(document.documentElement), col = (k, d) => css.getPropertyValue(k).trim() || d;
    const ink2 = col('--ink-2', '#555'), border = col('--border', '#ddd'), accent = col('--accent', '#2a78d6');
    const L0 = p.length, left = 40, right = 8, top = 24, bot = hgt - 18, pw = w - left - right;
    const eleAt = (m) => p.ele[U.clamp(Math.round(m / p.step), 0, p.n - 1)];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.n; i++) { const e = p.ele[i]; if (e < lo) lo = e; if (e > hi) hi = e; }
    const pad = Math.max(10, (hi - lo) * 0.1);
    lo = Math.floor((lo - pad) / 10) * 10; hi = Math.ceil((hi + pad) / 10) * 10;
    if (hi - lo < 40) hi = lo + 40;
    const X = (m) => left + m / L0 * pw, Y = (e) => bot - (e - lo) / (hi - lo) * (bot - top);
    const cols = Math.max(40, Math.min(p.n - 1, Math.floor(pw)));
    const curve = () => { for (let i = 0; i <= cols; i++) { const m = L0 * i / cols; if (i) ctx.lineTo(X(m), Y(eleAt(m))); else ctx.moveTo(X(m), Y(eleAt(m))); } };
    // repères : altitude (haut, bas) et kilomètres
    ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = ink2; ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const e of [hi, lo]) { ctx.beginPath(); ctx.moveTo(left, Y(e) + 0.5); ctx.lineTo(w - right, Y(e) + 0.5); ctx.stroke(); ctx.fillText(Math.round(e) + ' m', left - 4, Math.min(hgt - 20, Math.max(8, Y(e)))); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const km = L0 / 1000, steps = [1, 2, 5, 10, 20, 25, 50, 100], want = Math.max(3, Math.floor(pw / 70));
    const stepKm = steps.find((s) => km / s <= want) || 100;
    for (let k = 0; k * stepKm <= km; k++) ctx.fillText(k * stepKm + (k === 0 ? ' km' : ''), Math.min(w - 12, Math.max(left + 8, X(k * stepKm * 1000))), hgt - 4);
    // surface sous la courbe, puis dénivelé des côtes classées en rouge
    ctx.beginPath(); curve(); ctx.lineTo(X(L0), bot); ctx.lineTo(X(0), bot); ctx.closePath();
    ctx.fillStyle = accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    for (const c of cps) {
      if (c.type !== 'kom') continue;
      const a = Math.max(0, c.start || 0), n = Math.max(8, Math.round((c.s - a) / L0 * cols));
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const m = a + (c.s - a) * i / n; if (i) ctx.lineTo(X(m), Y(eleAt(m))); else ctx.moveTo(X(m), Y(eleAt(m))); }
      ctx.lineTo(X(c.s), bot); ctx.lineTo(X(a), bot); ctx.closePath();
      ctx.fillStyle = '#d62828'; ctx.globalAlpha = 0.38; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); curve(); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // sprints et sommets : trait vertical jusqu'à la courbe et pastille au-dessus
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    for (const c of cps) {
      const x = X(c.s), yc = Y(eleAt(c.s)), kom = c.type === 'kom', color = kom ? '#d62828' : '#1d9a4a', by = Math.max(11, yc - 15);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, yc); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, by, 9, 0, Math.PI * 2); ctx.fillStyle = kom ? '#fff' : color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = kom ? color : '#fff'; ctx.stroke();
      ctx.fillStyle = kom ? color : '#fff'; ctx.font = '700 10px system-ui, sans-serif'; ctx.fillText(CP_TEXT(c), x, by + 0.5);
    }
  }

  /* ---------- défi contre des coureurs virtuels : réglages ---------- */
  const LEVEL_TXT = { weaker: 'plus faible que toi', equal: 'de ton niveau', stronger: 'plus forts que toi', mixed: 'de niveaux variés' };

  /** Points de passage du défi : ceux de la page Parcours (sprints, côtes classées) et l'arrivée. */
  function mixCps() {
    const p = store.profile;
    return p ? PYR.classif.fromList(store.state.checkpoints, p) : null;
  }

  function renderMixPrep() {
    const on = !!cfg().mixed, g = store.state.game;
    V.mixSum.hidden = V.mixWarn.hidden = !on;
    V.mixAuto.parentNode.hidden = !on;
    if (!on) return;
    const n = Math.max(0, Math.min(PYR.race.MAX_BOTS, Math.floor(Number(g.bots) || 0))), cps = mixCps(), txt = cps ? PYR.classifView.cpsText(cps) : '';
    setTxt(V.mixSum, `${n} coureur${n > 1 ? 's' : ''} virtuel${n > 1 ? 's' : ''}, ${LEVEL_TXT[g.botLevel] || LEVEL_TXT.equal} (réglages du mode jeu)${txt ? ' · ' + txt : ''}.`);
    const warn = !n ? 'Aucun coureur virtuel : règle leur nombre dans le mode jeu.' : cps && !PYR.classif.active(cps) ? 'Pas de sprint ni de côte classée sur ce parcours : seule l\'arrivée compte.' : '';
    V.mixWarn.hidden = !warn;
    setTxt(V.mixWarn, warn);
    V.mixAuto.hidden = !(cps && !PYR.classif.active(cps));
  }

  /** Place des sprints et des côtes classées sur le parcours (comme la page Parcours) quand il n'y en a pas. */
  function autoCheckpoints() {
    const p = store.profile;
    if (!p) return;
    const found = PYR.classif.toItems(PYR.classif.build(p, { sprints: 2, kom: true }));
    if (!found.length) { D.toast('Aucun sprint ni côte classée possible sur ce parcours.', 'error'); return; }
    store.state.checkpoints = found;
    store.state.checkpoints.sort((a, b) => a.km - b.km);
    store.emit('checkpoints');
    store.save();
    D.toast(`${PYR.classifView.cpsText(PYR.classif.fromList(found, p))} placé(s).`);
    renderPrep();
  }

  const BLE_STATE = { on: 'connecté', connecting: 'connexion…', reconnecting: 'reconnexion…', lost: 'perdu', off: 'non connecté' };

  /**
   * Panneau des capteurs (GPS, puissance, cardio) : lignes à placer dans la page de démarrage et dans le menu de la sortie. Tous les
   * panneaux ouverts sont tenus à jour par renderSensors. on.alpha(α) : appelée quand on change la part de l'altitude mesurée ; on.avg(n) :
   * quand on change la durée de la moyenne de la puissance affichée.
   * Renvoie { gps, pwr: [lignes], avg (puissance affichée), alt (réglage de l'estimation, masqué quand un capteur de puissance est connecté),
   * hr: [lignes], refresh }.
   */
  function sensorPanel(on) {
    on = on || {};
    const avg = rowEl('Puissance affichée', sliderEl(cfg().powerAvg, 1, 60, 1, (v) => (v === 1 ? 'instantanée' : `moy. ${v} s`), {
      input: (v) => { if (on.avg) on.avg(v); },
      change: (v) => { store.set('ride.cfg.powerAvg', v); if (on.avg) on.avg(v); },
    }));
    avg.title = 'Valeur de la vignette Puissance du bandeau : de la puissance instantanée (1 s) à la moyenne sur 60 s.';
    const gpsBtn = h('button', { class: 'btn', type: 'button', onclick: () => toggleGps() }, 'Activer le GPS');
    const gpsSt = h('span', { class: 'rd-st' });
    const pwrBtn = h('button', { class: 'btn', type: 'button', onclick: () => connectPower('service') }, 'Connecter');
    const pwrAny = h('button', { class: 'btn ghost', type: 'button', onclick: () => connectPower('any') }, 'Autre appareil…');
    const pwrRec = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => reconnectKnown('power') }, 'Reconnecter');
    const pwrSt = h('div', { class: 'rd-st rd-live-st' });
    const hrBtn = h('button', { class: 'btn', type: 'button', onclick: () => connectHr('service') }, 'Connecter');
    const hrRec = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => reconnectKnown('hr') }, 'Reconnecter');
    const hrSt = h('div', { class: 'rd-st rd-live-st' });
    const alt = h('div', { class: 'rd-alt' },
      rowEl('Sans capteur : part de l\'altitude mesurée', h('span', { class: 'rd-inline' }, numEl(Math.round(cfg().altAlpha * 100), 0, 100, 10, (v) => {
        store.set('ride.cfg.altAlpha', v / 100);
        if (on.alpha) on.alpha(v / 100);
      }), ' %')),
      h('p', { class: 'rd-note' }, 'Sans capteur, la puissance est estimée d\'après la vitesse, la météo et la pente. Cette part de la dénivelée vient des altitudes mesurées par le GPS (bruitées), le reste de l\'altitude corrigée du parcours. 0 % : le parcours seul.'));
    const P = {
      gps: rowEl('GPS', gpsBtn, gpsSt),
      pwr: [rowEl('Puissance', pwrRec, pwrBtn, pwrAny), pwrSt],
      avg, alt,
      hr: [rowEl('Cardio (facultatif)', hrRec, hrBtn), hrSt],
      refresh() {
        gpsBtn.textContent = run.gpsOn ? 'Couper' : 'Activer le GPS';
        let g = run.gpsErr ? run.gpsErr : run.gpsOn ? 'recherche du signal…' : 'inactif';
        if (run.lastFix && run.gpsOn) {
          g = `±${Math.round(run.lastFix.acc)} m`;
          const near = nearStart(run.lastFix);
          if (run.mode === 'prep' && near !== null) g += near < 200 ? ' · au départ' : ` · à ${km(near)} km du départ`;
        }
        setTxt(gpsSt, g);
        const Pw = Sx.power, H = Sx.hr, now = Date.now();
        alt.hidden = Pw.state === 'on';
        pwrBtn.textContent = Pw.state === 'on' ? 'Déconnecter' : 'Connecter';
        pwrAny.hidden = Pw.state === 'on' || !Pw.supported;
        pwrBtn.hidden = !Pw.supported;
        pwrRec.hidden = !(Pw.canReconnect && Pw.state === 'off');
        if (Pw.known) pwrRec.textContent = 'Reconnecter ' + (Pw.known.name || '');
        let t = Pw.supported ? BLE_STATE[Pw.state] : 'non disponible';
        if (Pw.state === 'on') {
          t = `${Pw.name || 'connecté'} · ${Pw.profile ? Pw.profile.replace(/^un /, '') : ''}`;
          const l = Pw.last;
          if (!l) t += ' · en attente de mesure (pédale quelques tours)';
          else {
            const age = (now - l.ts) / 1000, v = l.v;
            t += Number.isFinite(v.w) ? ` · ${Math.round(v.w)} W` : ' · pas de puissance dans ce profil';
            if (Number.isFinite(v.cad) && v.cad > 0) t += ` · ${Math.round(v.cad)} tr/min`;
            t += age > 4 ? ` · silencieux depuis ${Math.round(age)} s` : '';
          }
        } else if (Pw.error) t += ' · ' + Pw.error;
        setTxt(pwrSt, t);
        hrBtn.textContent = H.state === 'on' ? 'Déconnecter' : 'Connecter';
        hrBtn.hidden = !H.supported;
        hrRec.hidden = !(H.canReconnect && H.state === 'off');
        if (H.known) hrRec.textContent = 'Reconnecter ' + (H.known.name || '');
        let th = H.supported ? BLE_STATE[H.state] : 'non disponible';
        if (H.state === 'on') th = `${H.name || 'connecté'}${H.last && H.last.v && H.last.v.hr ? ' · ' + Math.round(H.last.v.hr) + ' bpm' : ''}`;
        else if (H.error) th += ' · ' + H.error;
        setTxt(hrSt, th);
      },
    };
    run.panels.add(P);
    P.refresh();
    return P;
  }

  /** Remet à jour tous les panneaux de capteurs ouverts (page de démarrage, menu de la sortie). */
  function renderSensors() {
    for (const P of run.panels) {
      if (!P.keep && !P.gps.isConnected) { run.panels.delete(P); continue; }
      P.refresh();
    }
  }
  /** Un capteur a changé : la page de démarrage se redessine, sinon seuls les panneaux de capteurs. */
  const sensorsChanged = () => { if (run.mode === 'prep') renderPrep(); else renderSensors(); };

  function renderSegTable(plan) {
    if (run.segPlan === plan) return;
    run.segPlan = plan;
    let course = null;
    try { course = (run.base || (run.base = buildBase())).course; } catch (e) { /* pas de parcours */ }
    D.clear(V.segTable);
    V.segTable.append(h('thead', null, h('tr', null, ...['N°', 'Km', 'Puissance', 'Pente', 'Durée'].map((x) => h('th', null, x)))));
    const body = h('tbody');
    R.segments(plan, course).forEach((g, i) => body.append(h('tr', null, h('td', null, i + 1), h('td', null, `${km(g.a)} → ${km(g.b)}`),
      h('td', null, `${Math.round(g.P / 5) * 5} W`), h('td', null, `${U.fmt(g.grade * 100, 1)} %`), h('td', null, hmm(g.t1 - g.t0)))));
    V.segTable.append(body);
  }

  /** Distance (m) entre la position et le départ du parcours (null sans parcours). */
  function nearStart(fix) {
    const p = store.profile;
    if (!p) return null;
    return U.haversine(fix.lat, fix.lng, p.lat[0], p.lng[0]);
  }

  /** Plan d'alimentation d'après le plan de puissance et le matériel. */
  function nutritionFor(plan) {
    const st = store.state, rider = st.rider;
    const base = run.base;
    const cp = base ? base.athlete.cp : (Number(rider.cp) || Number(rider.ftp) || 250);
    const ftp = base ? base.athlete.ftp : (Number(rider.ftp) || 250);
    return Nu.planNutrition({
      P: plan.P, dur: plan.tFinish - plan.t0, mass: Number(rider.weight) || 72, cp, ftp,
      tempC: Number(st.env.temperature), gut: Number(rider.gut) || 0, kit: st.ride.kit,
    });
  }

  function renderNutrition() {
    if (!V.nutSum) return;
    const key = run.plan ? `${run.plan.tFinish}|${run.plan.n}|${JSON.stringify(store.state.ride.kit)}|${store.state.rider.weight}|${store.state.rider.gut}` : '';
    if (key === run.nutKey && V.nutSum.firstChild) return;
    run.nutKey = key;
    D.clear(V.nutSum); D.clear(V.nutList);
    if (!run.plan) { V.nutSum.append(h('p', { class: 'rd-note' }, 'Le plan d\'alimentation apparaît dès qu\'il y a un plan de puissance.')); return; }
    const nut = nutritionFor(run.plan);
    run.nutPreview = nut;
    const L = (x, d = 1) => U.fmt(x, d);
    V.nutSum.append(
      h('p', { class: 'rd-line' }, nut.mode === 'none' ? 'Sortie courte : de l\'eau suffit, pas de glucides à prévoir.'
        : `Visé : ${nut.carbsPerH} g de glucides par heure · ${L(nut.fluidPerH)} L de boisson par heure`),
      h('p', { class: 'rd-line' }, `À prendre : ${nut.need.gels} gel${nut.need.gels > 1 ? 's' : ''}, ${nut.need.bars} barre${nut.need.bars > 1 ? 's' : ''}, ${L(nut.need.liters)} L en gorgées de rappel. `
        + `Emporté : ${nut.have.gels} gel${nut.have.gels > 1 ? 's' : ''}, ${nut.have.bars} barre${nut.have.bars > 1 ? 's' : ''}, ${L(nut.have.liters)} L.`),
      h('p', { class: 'rd-line' }, `Prévision avec ce plan : glycogène au plus bas à ${Math.round(nut.sim.minG * 100)} %, perte d'eau de ${L(nut.sim.lossPct)} % du poids à l'arrivée.`));
    for (const w of nut.warnings) V.nutSum.append(h('p', { class: 'rd-warn' }, w));
    const names = { gel: 'gel', gelglu: 'gel glucose', gelplus: 'gel haute dose', bar: 'barre', barmini: 'mini-barre', drink: 'boire' };
    for (const e of nut.events) V.nutList.append(h('li', null, `${hmm(e.t)} · ${e.type === 'drink' ? 'boire une gorgée' : 'manger : ' + (names[e.kind] || e.kind)}`));
  }

  /* ======================================================================
   * Capteurs
   * ====================================================================== */
  function onFix(f) {
    run.lastFix = f;
    run.fix.push(f);
    const lim = Date.now() - KEEP_MS;
    while (run.fix.length && run.fix[0].ts < lim) run.fix.shift();
    run.gpsErr = '';
    if (run.mode === 'prep' && !run.renderSoon) { run.renderSoon = setTimeout(() => { run.renderSoon = 0; renderPrep(); }, 1000); }
  }

  function toggleGps() {
    if (run.gpsOn) { Sx.gps.stop(); run.gpsOn = false; run.lastFix = null; sensorsChanged(); return; }
    Sx.alerts.unlock();
    run.gpsOn = Sx.gps.start(onFix, (e) => {
      run.gpsErr = e.code === 1 ? 'autorisation refusée' : e.message || 'signal perdu';
      if (e.code === 1) run.gpsOn = false;
      sensorsChanged();
    });
    sensorsChanged();
  }

  /** Mesures du capteur de puissance : puissance (si le profil en donne), cadence, et fréquence cardiaque d'un home-trainer. */
  const onPower = (v, ts) => {
    if (Number.isFinite(v.w)) { run.power.push({ ts, w: v.w }); trim(run.power); }
    if (Number.isFinite(v.cad)) { run.cads.push({ ts, w: v.cad }); trim(run.cads); }
    if (Number.isFinite(v.hr) && v.hr > 0 && Sx.hr.state !== 'on') { run.hrs.push({ ts, w: v.hr }); trim(run.hrs); }
  };
  const onPowerState = (s) => { run.powerOn = s === 'on'; sensorsChanged(); };
  const onHr = (v, ts) => { if (Number.isFinite(v.hr) && v.hr > 0) { run.hrs.push({ ts, w: v.hr }); trim(run.hrs); } };
  const onHrState = (s) => { run.hrOn = s === 'on'; sensorsChanged(); };

  async function connectPower(mode) {
    if (Sx.power.state === 'on') { Sx.power.disconnect(); run.powerOn = false; sensorsChanged(); return; }
    try { await Sx.power.connect(mode, onPower, onPowerState); } catch (e) { if (e.name !== 'NotFoundError') D.toast('Capteur de puissance : ' + e.message, 'error'); }
    sensorsChanged();
  }

  async function connectHr(mode) {
    if (Sx.hr.state === 'on') { Sx.hr.disconnect(); run.hrOn = false; sensorsChanged(); return; }
    try { await Sx.hr.connect(mode, onHr, onHrState); } catch (e) { if (e.name !== 'NotFoundError') D.toast('Ceinture cardio : ' + e.message, 'error'); }
    sensorsChanged();
  }

  /** Reconnexion à l'appareil déjà autorisé, sans liste de choix (après un rechargement de la page, ou à l'ouverture du compteur). */
  async function reconnectKnown(kind) {
    const dev = kind === 'power' ? Sx.power : Sx.hr;
    try { await (kind === 'power' ? dev.reconnect(onPower, onPowerState) : dev.reconnect(onHr, onHrState)); }
    catch (e) { D.toast((kind === 'power' ? 'Capteur de puissance : ' : 'Ceinture cardio : ') + e.message, 'error'); }
    sensorsChanged();
  }

  function trim(list) { const lim = Date.now() - KEEP_MS; while (list.length && list[0].ts < lim) list.shift(); }
  const meanIn = (list, a, b) => { let s = 0, n = 0; for (const x of list) if (x.ts >= a && x.ts < b) { s += x.w; n++; } return n ? s / n : undefined; };
  const lastIn = (list, a, b) => { let r = null; for (const x of list) if (x.ts >= a && x.ts < b) r = x; return r; };

  /* ======================================================================
   * Sortie en cours
   * ====================================================================== */
  function alertsOn() { return run.mode === 'live' && !run.paused; }

  function notify(kind, text, urgent) {
    const c = cfg(), now = Date.now();
    if (!alertsOn()) return;
    if (!urgent && now - run.al.last < 4000) return;
    run.al.last = now;
    const pat = Sx.alerts.PATTERNS[kind] || Sx.alerts.PATTERNS.info;
    if (c.sound) Sx.alerts.tones(pat.tones);
    if (c.vibrate) Sx.alerts.vibrate(pat.vib);
    if (c.voice && text) Sx.alerts.speak(text);
    if (text) setBanner(text, kind);
  }

  let bannerTimer = 0;
  function setBanner(text, kind) {
    if (!V.banner) return;
    V.banner.textContent = text;
    V.banner.dataset.kind = kind || 'info';
    V.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { V.banner.hidden = true; }, 6000);
  }

  /* ---------- mode démo : rejouer une sortie enregistrée ---------- */

  /** Texte de l'état : fichier chargé, durée, puissance, part du parcours couverte. */
  function renderReplay() {
    const info = run.replayInfo;
    V.replayClear.hidden = !run.replayAct;
    V.biasRow.hidden = !!run.replayAct;
    setTxt(V.replaySt, !run.replayAct
      ? 'Sans fichier, un cycliste simulé suit la consigne. Avec un fichier GPX, TCX ou FIT d\'une sortie faite sur ce même parcours, ses positions, sa vitesse, sa puissance et son cœur sont rejoués à la place.'
      : `${run.replayName}${info ? ` : ${U.fmtClock(info.duration)} sur le parcours, ${info.hasPower ? `puissance moyenne ${U.fmt(info.avgPower, 0)} W` : 'sans puissance (elle sera estimée)'}${info.hasHr ? ', cœur' : ''}${info.hasCad ? ', cadence' : ''}.` : ' (sera vérifiée au départ).'}`);
  }

  async function onReplayFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let act, info = null;
    try {
      act = PYR.replay.load(await f.arrayBuffer());
      let base = null;
      try { base = buildBase(); } catch (err) { /* pas de parcours ou de plan : la vérification aura lieu au départ */ }
      if (base) info = PYR.replay.create({ activity: act, course: base.course }).info;
    } catch (err) {
      D.toast('Sortie refusée : ' + err.message, 'error');
      return;
    }
    run.replayAct = act; run.replayName = f.name; run.replayInfo = info;
    renderReplay();
    renderPrep();
  }

  async function startLive() {
    if (run.mode !== 'prep' || !run.plan) return;
    Sx.alerts.unlock();
    const demo = V.demoChk.querySelector('input').checked;
    const startMs = Date.now();
    let base;
    try { base = sessionBase(startMs); } catch (e) { D.toast(e.message, 'error'); return; }
    const st = store.state, rider = st.rider;
    let demoRider = null;
    if (demo) {
      try {
        demoRider = run.replayAct ? PYR.replay.create({ activity: run.replayAct, course: base.course })
          : R.createDemo({ course: base.course, setup: base.setup, athlete: sessionAthlete(base), seed: startMs % 9973, bias: st.ride.demo.bias / 100 });
      } catch (e) { D.toast(e.message, 'error'); return; }
    }
    run.base = base;
    clearSaved();
    const sess = R.createSession({
      course: base.course, setup: base.setup, athlete: sessionAthlete(base), mass: Number(rider.weight) || 72, kit: st.ride.kit, gut: Number(rider.gut) || 0,
      tempC: Number(st.env.temperature), startMs, cfg: st.ride.cfg, physio: physioCard(base),
    });
    sess.setPlan(run.plan, 'plan initial');
    run.sess = sess;
    run.nut = nutritionFor(run.plan);
    run.coach = Nu.createCoach(run.nut);
    run.demo = demoRider;
    run.demoSpeed = st.ride.demo.speed;
    run.demoWall = startMs;
    run.power.length = 0; run.hrs.length = 0; run.cads.length = 0;
    run.mix = cfg().mixed && store.profile ? createMix(base, (Math.random() * 4294967296) >>> 0) : null;
    if (run.mix && !run.mix.n) run.mix = null;                   // aucun coureur virtuel : pas de défi
    run.fc0 = null;
    enterLive();
  }

  /** Défi contre des coureurs virtuels : réglages du mode jeu (nombre, niveau), points de passage de la page Parcours, graine tirée au départ. */
  function mixOptions(base, n) {
    const st = store.state;
    return { course: base.course, gustSeed: base.seed, rider: st.rider, bike: st.bike, colors: PYR.race.palette(PYR.challenges.COLORS, n) };
  }
  function createMix(base, seed) {
    const st = store.state, n = Math.max(0, Math.min(PYR.race.MAX_BOTS, Math.floor(Number(st.game.bots) || 0)));
    // niveau « égal » étalonné sur le temps du plan du cycliste (ce qu'il peut faire de mieux) : « de ton niveau » est alors vrai
    const target = run.plan ? run.plan.tFinish - run.plan.t0 : 0;
    return PYR.rideMixed.create(Object.assign(mixOptions(base, n), { cps: mixCps(), rules: {}, seed, n, level: st.game.botLevel, targetTime: target }));
  }

  /* ---------- défi contre des coureurs virtuels : pendant la sortie ---------- */
  const MIX_BUDGET_MS = 6;                     // ms de calcul des coureurs virtuels par tour d'horloge
  const ME_COLOR = '#eb6834';

  /** Un tour d'horloge du défi : départ, coureurs virtuels, passages aux sprints et aux sommets (annonces). */
  function mixTick(sess) {
    const m = run.mix;
    if (!m) return;
    const Cl = PYR.classif, CV = PYR.classifView;
    for (const e of PYR.rideMixed.update(m, sess, MIX_BUDGET_MS)) {
      const gap = e.gap > 0.05 ? ` (${CV.gapText(e.gap)})` : e.gap < -0.05 ? ` (${U.fmt(-e.gap, 0)} s d'avance)` : '';
      notify('info', `${Cl.shortLabel(e.point, m.cps)} : ${CV.ordinal(e.rank)}${gap}${e.pts ? ' · ' + CV.pts(e.pts) : ''}`, true);
    }
  }

  const gapTxt = (s) => (s < 60 ? `${Math.round(s)} s` : hmm(s));
  const distTxt = (m) => (Math.abs(m) < 1000 ? `${Math.round(Math.abs(m) / 10) * 10} m` : `${U.fmt(Math.abs(m) / 1000, 1)} km`);

  /** Lignes du classement affichées : les premiers, et ceux qui entourent le cycliste (gros peloton). */
  function mixRows(rows) {
    if (rows.length <= 9) return rows;
    const i = rows.findIndex((r) => r.me), keep = new Set([0, 1, rows.length - 1]);
    for (let k = i - 3; k <= i + 3; k++) if (k >= 0 && k < rows.length) keep.add(k);
    return rows.filter((r, k) => keep.has(k));
  }

  /** Carte de classement, pastille de place du bandeau et classements annexes (4 fois par seconde au plus). */
  function renderMix() {
    const m = run.mix, sess = run.sess;
    V.mix.hidden = V.chRank.hidden = !m;
    if (!m) return;
    const Mx = PYR.rideMixed, CV = PYR.classifView, started = m.t0 !== null;
    const rows = Mx.board(m, sess, sess.t), me = rows.find((r) => r.me);
    const act = PYR.classif.active(m.cps), hasKom = m.cps.some((c) => c.type === 'kom');
    setTxt(V.chRank, started ? `${CV.ordinal(me.rank)}/${rows.length}` : 'départ');
    setTxt(V.mixHead, started ? `Tu es ${CV.ordinal(me.rank)} sur ${rows.length}` : 'Les coureurs partent quand tu franchis la ligne de départ');
    V.mixTabs.hidden = !act;
    V.mixTabBtn.kom.hidden = !hasKom;
    if (!act && run.mixTab !== 'course') run.mixTab = 'course';
    for (const k of ['course', 'points', 'kom']) V.mixTabBtn[k].setAttribute('aria-pressed', String(run.mixTab === k));
    if (run.mixTab === 'course') {
      const shown = mixRows(rows);
      const sig = 'c|' + shown.map((r) => `${r.id}:${r.rank}:${started ? Math.round(r.dt) : 0}:${Math.round(r.dm / 10)}`).join('|');
      if (run.mixSig === sig) return;
      run.mixSig = sig;
      D.clear(V.mixBody);
      const tb = h('tbody');
      for (const r of shown) {
        const rel = r.me || !started ? null : r.dt > 0 ? 'ahead' : 'behind';
        tb.appendChild(h('tr', { class: r.me ? 'me' : '' },
          h('td', null, String(r.rank)),
          h('td', null, h('span', { class: 'dot', style: { background: r.color || ME_COLOR } }), r.name),
          h('td', { class: 'g ' + (rel || '') }, rel ? `${rel === 'ahead' ? '▲' : '▼'} ${gapTxt(Math.abs(r.dt))}` : ''),
          h('td', { class: 'd' }, rel ? distTxt(r.dm) : '')));
      }
      V.mixBody.appendChild(h('table', { class: 'rd-mix-table' }, tb));
    } else {
      const key = `${run.mixTab}|${sess.t}|${m.splits.filter((x) => x !== null).length}`;
      if (run.mixSig === key) return;
      run.mixSig = key;
      const sd = Mx.standings(m, sess), nm = Mx.names(m), name = (id) => (nm.get(id) ? nm.get(id).name : id);
      D.clear(V.mixBody);
      V.mixBody.appendChild(CV.table(run.mixTab === 'kom' ? sd.kom : sd.points, name, 'me', run.mixTab === 'kom' ? 'kom' : 'green'));
    }
  }

  function enterLive() {
    run.mode = 'live'; run.paused = false; run.replanning = false;
    run.al = { seg: -1, over: null, under: null, last: 0, eat: null, drink: null, wbal: false, gps: false, pwr: false };
    run.profPts = null;
    run.wxBusy = false; run.wxNextT = run.sess.t + cfg().weatherMin * 60;      // prochaine mise à jour de la météo (instant de la sortie, s)
    run.stats = null; buildUpCum();
    run.fc = null; run.fcJob = null; run.fcMarks = null; run.fcT = -1e9; run.fcDirty = false;
    setMode('live');
    run.view = -1; run.dotSig = ''; run.headH = 0;
    setView(Math.max(0, viewList().indexOf(cfg().view)), true);        // la dernière vue regardée
    Sx.wake.request();
    if (!run.demo && !run.gpsOn) toggleGps();
    clearInterval(run.timer);
    run.timer = setInterval(tick, 250);
    tick();
  }

  /** Les mesures de la seconde k de la sortie (réelles ou simulées). */
  function inputsFor(sess, k) {
    if (run.demo && run.demo.replay) {
      const out = run.demo.step();
      const estimate = out.power === undefined && out.fix ? sess.estimate(out.fix.speed) : undefined;     // sortie sans puissance : estimée comme sans capteur
      return { power: out.power, hr: out.hr, cad: out.cad, fix: out.fix, estimate, done: out.done };
    }
    if (run.demo) {
      const g = sess.guidance();
      const out = run.demo.step(g ? g.target : 0);
      return { power: out.power, fix: out.fix, hr: undefined, done: out.done };
    }
    const a = sess.startMs + k * 1000, b = a + 1000;
    const f0 = lastIn(run.fix, a, b);
    const f = f0 ? Object.assign({}, f0, { age: (b - f0.ts) / 1000 }) : null;   // le point date d'avant la fin de la seconde
    const power = meanIn(run.power, a, b);
    const hr = meanIn(run.hrs, a, b);
    const cad = meanIn(run.cads, a, b);
    let estimate;
    if (power === undefined && !run.powerOn) estimate = sess.estimate(f && Number.isFinite(f.speed) ? f.speed : undefined);
    return { power, hr, cad, sensorOn: run.powerOn, fix: f, estimate };
  }

  function tick() {
    const sess = run.sess;
    if (!sess || run.mode !== 'live') return;
    const now = Date.now();
    let due;
    if (run.demo) {
      if (run.replanning) run.demoWall += now - (run.lastTick || now);      // le temps simulé attend le recalcul
      due = Math.floor((now - run.demoWall) / 1000 * run.demoSpeed);
    } else due = Math.floor((now - sess.startMs) / 1000);
    run.lastTick = now;
    let guard = 0;
    while (sess.t < due && !sess.finished && guard++ < 900) {
      const inp = inputsFor(sess, sess.t);
      sess.step(inp);
      if (inp.done && !sess.finished) sess.finished = true;
      const rq = sess.takeReplanRequest();
      if (rq && !run.paused) replan(rq.reason);
    }
    weatherTick(sess);
    coachTick();
    forecastTick(sess);
    mixTick(sess);
    const g = sess.guidance();
    if (g) { alertsTick(g); render(g); liveTick(sess, g); }
    if (sess.t - run.lastSave >= SAVE_EVERY) saveSession();
    if (sess.finished) finish();
  }

  /* ---------- mise à jour de la météo pendant la sortie ---------- */
  const WX_RETRY_S = 120;                      // s : nouvel essai après un échec (réseau coupé)

  /** La météo se rafraîchit toutes les cfg.weatherMin minutes, seulement si elle est utilisée par le parcours ; chaque mise à jour recalcule le plan. */
  function weatherTick(sess) {
    const course = run.base && run.base.course;
    if (!course || !course.weather || course.weather.custom || run.wxBusy || run.replanning || run.paused || sess.finished) return;
    if (!(sess.t >= run.wxNextT) || sess.course.length - sess.s < 400) return;     // près de l'arrivée, plus de recalcul
    refreshWeather(sess);
  }

  async function refreshWeather(sess) {
    run.wxBusy = true;
    try {
      const course = run.base.course, We = PYR.weather, startEpoch = Math.floor(sess.startMs / 1000);
      // prévisions aux mêmes points du tracé, autour de l'heure de départ réelle de la sortie
      const res = await PYR.services.fetchWeather(course.weather.stations, We.epochToLocal(startEpoch, course.weather.off));
      if (run.sess !== sess || run.mode !== 'live') return;
      const w = We.normalize(Object.assign({}, res.snapshot, { start: startEpoch }));
      if (!w) throw new Error('prévisions invalides');
      course.weather = w;                                      // le parcours est partagé avec la séance, le recalcul et les coureurs virtuels
      for (let k = 0; k < w.stations.length && !course.hasGusts; k++) for (let i = 0; i < w.n; i++) if (w.gust[k][i] > w.ws[k][i] + 0.3) { course.hasGusts = true; break; }
      sess.weatherChanged();
      run.wxNextT = sess.t + cfg().weatherMin * 60;
      await replan('météo mise à jour');
    } catch (e) {
      console.warn('Mise à jour de la météo impossible', e);
      run.wxNextT = sess.t + WX_RETRY_S;
      D.toast('Météo indisponible : nouvel essai dans 2 min.', 'error');
    } finally {
      run.wxBusy = false;
    }
  }

  /** Recalcul du plan du reste du parcours, depuis l'état réel. */
  async function replan(reason) {
    const sess = run.sess;
    if (!sess || run.replanning || sess.finished) return;
    if (sess.course.length - sess.s < 400) { D.toast('Trop près de l\'arrivée pour recalculer.'); return; }
    run.replanning = true; sess.replanning = true;
    setBanner('Recalcul du plan : ' + reason + '…', 'plan');
    const t0 = Date.now();
    try {
      const wScale = refIsForm(run.base.margin) ? 1 : 1 - run.base.margin;
      const input = sess.replanInput(run.base, wScale);
      const res = await PYR.optimizer.optimize(input);
      if (run.sess !== sess || run.mode !== 'live') return;
      if (!res.ok) { D.toast('Recalcul impossible : ' + res.error, 'error'); return; }
      const before = sess.plan.tFinish;
      sess.setPlan(R.planFromResult(res, run.base.course.length, planRef(input.athlete, run.base.margin, input.start.wbal / wScale)), reason);
      const d = sess.plan.tFinish - before;
      notify('plan', `Plan mis à jour : arrivée ${hmm(sess.plan.tFinish)}`, true);
      setBanner(`Plan mis à jour (${reason}) : arrivée ${hmm(sess.plan.tFinish)}${Math.abs(d) >= 1 ? ' (' + U.fmtDelta(d) + ')' : ''}`, 'plan');
      run.lastReplanMs = Date.now() - t0;
      run.fcJob = null; run.fcDirty = true;                       // la prévision des réserves suit le nouveau plan
      saveSession();
    } catch (e) {
      console.error(e);
      D.toast('Erreur de recalcul : ' + e.message, 'error');
    } finally {
      run.replanning = false; sess.replanning = false;
    }
  }

  /* ---------- alimentation en cours de sortie ---------- */
  function coachTick() {
    const sess = run.sess;
    if (!sess || !run.coach) return null;
    const g = sess.guidance();
    if (!g) return null;
    const plan = sess.plan, ftp = sess.athlete.ftp;
    const k = Math.max(0, Math.floor(sess.t - plan.t0));
    let easy = false;
    if (plan.P.length) {
      let s = 0, n = 0;
      for (let i = k; i < Math.min(plan.P.length, k + 300); i++) { s += plan.P[i]; n++; }
      easy = n > 0 && s / n < 0.75 * ftp;
    }
    const f = sess.fuel, st = g.fuelStatus;
    run.rem = run.coach.update(sess.t, {
      P3: g.p10, cp: sess.athlete.cp, G: g.energy, lossPct: g.lossPct, remaining: g.remainPlanT, easy, stock: { gels: st.gels, bars: st.bars },
    });
    return run.rem;
  }

  function takeFood(kind) {
    const sess = run.sess;
    if (!sess || !kind) return;
    const label = sess.eat(kind);
    if (label) { run.coach.taken('eat', sess.t); run.al.eat = null; run.fcDirty = true; D.toast('Noté : ' + label); coachTick(); render(sess.guidance()); }
  }
  function takeDrink(idx) {
    const sess = run.sess;
    if (!sess) return;
    const q = sess.drink(idx);
    if (q > 0) { run.coach.taken('drink', sess.t); run.al.drink = null; run.fcDirty = true; D.toast(`Noté : ${U.fmt(q * 1000)} mL`); coachTick(); render(sess.guidance()); }
    else D.toast('Plus rien à boire dans ce contenant.', 'error');
  }

  /* ---------- alertes ---------- */
  function alertsTick(g) {
    if (!alertsOn()) return;
    const A = run.al, c = cfg(), t = g.t;
    // changement de consigne à venir
    if (c.lookahead > 0 && g.next && g.segTimeLeft <= c.lookahead && A.seg !== g.segIndex && g.segTimeLeft > 0.5) {
      A.seg = g.segIndex;
      const to = Math.round(g.next.P / 5) * 5, d = to - g.target;
      if (Math.abs(d) >= 10) notify(d > 0 ? 'up' : 'down', to < 15 ? 'Roue libre' : `${d > 0 ? 'Plus fort' : 'Relâche'}, ${to} watts`);
    }
    // consigne non respectée depuis 10 s (trop fort) ou 15 s (trop faible), puis au plus toutes les 45 s / 60 s
    A.over = g.cue === 'way_over' ? (A.over === null ? t : A.over) : null;
    A.under = g.cue === 'way_under' && g.target >= 80 ? (A.under === null ? t : A.under) : null;
    if (A.over !== null && t - A.over >= 10 && t - (A.tOver === undefined ? -99 : A.tOver) > 45) { A.tOver = t; notify('down', 'Trop fort, relâche un peu'); }
    if (A.under !== null && t - A.under >= 15 && t - (A.tUnder === undefined ? -99 : A.tUnder) > 60) { A.tUnder = t; notify('up', 'Plus fort pour tenir le plan'); }
    // W′ presque vide
    if (g.wbalFrac < 0.12 && g.p3 > run.sess.athlete.cp && !A.wbal) { A.wbal = true; notify('warn', 'Attention, W prime presque vide', true); }
    if (g.wbalFrac > 0.3) A.wbal = false;
    // capteurs
    if (g.gpsLost && !A.gps) { A.gps = true; notify('warn', 'Signal GPS perdu', true); }
    if (!g.gpsLost) A.gps = false;
    if (g.powerLost && !A.pwr && !run.demo) { A.pwr = true; notify('warn', 'Capteur de puissance perdu', true); }
    if (!g.powerLost) A.pwr = false;
    // alimentation
    const r = run.rem;
    if (r) {
      for (const [key, lbl, say] of [['eat', 'Manger', 'Pense à manger'], ['drink', 'Boire', 'Pense à boire']]) {
        const x = r[key];
        if (!x || x.deferred || x.inS > 0) { if (!x || x.inS > 0) A[key] = null; continue; }
        if (A[key] === null || t - A[key] >= 120) { A[key] = t; notify('eat', x.empty ? 'Plus rien à manger' : say, x.urgent); }
      }
    }
  }

  /* ======================================================================
   * Affichage de la sortie : un en-tête fixe (écart au plan, capteurs, puis vitesse · puissance · FC) et des vues entre lesquelles on
   * balaie l'écran — carte, puissance cible, corps et sortie, classement du défi —, signalées par des points en bas. Thème sombre.
   * ====================================================================== */
  const VIEWS = [['map', 'Carte'], ['pow', 'Puissance cible'], ['body', 'Corps et sortie'], ['mix', 'Classement']];
  const viewList = () => VIEWS.filter(([k]) => k !== 'mix' || !!run.mix).map(([k]) => k);
  const viewName = () => viewList()[run.view] || 'map';
  const viewOn = (k) => run.mode === 'live' && viewName() === k;
  const round5 = (p) => Math.round(p / 5) * 5;
  const svgOf = (html) => { const b = document.createElement('span'); b.innerHTML = html; return b.firstChild; };

  function buildLive() {
    V.live = h('section', { class: 'rd-live rd-dark', hidden: true });
    V.banner = h('div', { class: 'rd-banner', hidden: true });

    // ---------- en-tête : écart au plan, rappel d'alimentation, capteurs, menu ; puis vitesse, puissance, FC
    V.gapLbl = h('span', { class: 'l' });
    V.gapVal = h('b', { class: 'num' });
    V.gap = h('span', { class: 'rd-gap', 'data-state': 'even' }, V.gapLbl, V.gapVal);
    V.nutPill = h('button', { class: 'rd-nutpill', type: 'button', hidden: true, title: 'Poches : manger ou boire', onclick: () => togglePockets() });
    V.chGps = h('span', { class: 'rd-chip' }, 'GPS');
    V.chPwr = h('span', { class: 'rd-chip' }, 'PUISS.');
    V.chHr = h('span', { class: 'rd-chip' }, 'FC');
    V.chPlan = h('span', { class: 'rd-chip plan', hidden: true }, 'Recalcul…');
    V.chRank = h('span', { class: 'rd-chip rank', hidden: true, title: 'Ta place parmi les coureurs virtuels' });
    V.menuBtn = h('button', { class: 'rd-icon', type: 'button', 'aria-label': 'Réglages et actions', onclick: () => openMenu() }, '⋯');
    V.status = h('div', { class: 'rd-status' }, V.gap, V.nutPill, h('span', { class: 'rd-chips' }, V.chRank, V.chPlan, V.chGps, V.chPwr, V.chHr), V.menuBtn);
    const tile = (cls, label) => {
      const val = h('div', { class: 'v num' }), sub = h('div', { class: 's' });
      return { el: h('div', { class: 'rd-tile ' + cls }, h('div', { class: 'l' }, label), val, sub), val, sub };
    };
    V.hSpeed = tile('speed', 'Vitesse'); V.hPow = tile('pow', 'Puissance'); V.hHr = tile('hr', 'FC');
    V.hud = h('div', { class: 'rd-hud' }, V.hSpeed.el, V.hPow.el, V.hHr.el);
    V.liveBar = h('div', { class: 'rd-livebar', hidden: true });
    V.head = h('header', { class: 'rd-head' }, V.status, V.liveBar, V.hud);

    // ---------- vue Carte : l'élément #map de la page y est déplacé le temps de la sortie (attachMap)
    V.mTurnArrow = h('span', { class: 'a' }); V.mTurnTxt = h('span', { class: 't' });
    V.mapTurn = h('div', { class: 'rd-map-turn', hidden: true }, V.mTurnArrow, V.mTurnTxt);
    V.mapNorth = h('div', { class: 'rd-map-north', hidden: true, title: 'Nord' }, h('span', { class: 'ar' }), h('span', { class: 'n' }, 'N'));
    V.mapAttr = h('div', { class: 'rd-map-attr' });     // l'attribution de Leaflet, quand la carte tourne (la sienne est alors hors de la vue)
    V.mapProf = h('canvas', { class: 'rd-map-prof', hidden: true, onclick: () => { run.profNear = !run.profNear; if (run.sess) drawProfile(run.sess.guidance()); } });
    V.profBtn = h('button', { class: 'rd-mbtn rd-prof-btn', type: 'button', 'aria-label': 'Profil d\'élévation', title: 'Afficher ou masquer le profil d\'élévation',
      onclick: () => { store.set('ride.cfg.mapProfile', !cfg().mapProfile); if (run.sess) render(run.sess.guidance()); } },
    svgOf('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20 9 8l4 6 3-4 6 10z"/></svg>'));
    V.segT = h('b', { class: 'num' }); V.segN = h('span');
    V.segLeft = h('div', { class: 'rd-segpill', title: 'Temps et distance restants sur le tronçon, puis la consigne suivante' }, V.segT, V.segN);
    V.mapBox = h('div', { class: 'rd-map', hidden: true }, V.mapTurn, V.mapNorth, V.mapAttr, V.segLeft, V.profBtn, V.mapProf);
    V.mapView = h('div', { class: 'rd-view map' }, V.mapBox);

    // ---------- vue Puissance : consigne au centre (jauge ou cadran, au choix), fin du tronçon, frise des tronçons à venir
    V.segLine = h('div', { class: 'rd-segline' });
    V.gTgt = h('div', { class: 'rd-tgt num' });
    V.gCur = h('span', { class: 'rd-cur num' });
    V.gZone = h('span', { class: 'rd-zone' });
    V.gBand = h('div', { class: 'band' }); V.gMark = h('div', { class: 'mk' });
    V.gLo = h('span', { class: 'num' }); V.gBandTxt = h('span', { class: 'b num' }); V.gHi = h('span', { class: 'num' });
    V.gaugeBox = h('div', { class: 'rd-gaugebox' },
      h('div', { class: 'rd-tgt-lbl' }, 'Cible'), V.gTgt, h('div', { class: 'rd-cur-row' }, V.gCur, V.gZone),
      h('div', { class: 'rd-gauge' }, V.gBand, V.gMark),
      h('div', { class: 'rd-gauge-l' }, V.gLo, h('span', null, 'trop faible'), V.gBandTxt, h('span', null, 'trop fort'), V.gHi));
    V.dialBox = buildDial();
    V.center = h('div', { class: 'rd-card rd-pw-center', 'data-cue': 'ok', role: 'button', tabindex: '0', title: 'Toucher : jauge ou cadran',
      onclick: () => togglePowerView(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePowerView(); } } }, V.gaugeBox, V.dialBox);
    V.cdT = h('div', { class: 'v num' }); V.cdS = h('div', { class: 's' });
    V.nxL = h('div', { class: 'l' }); V.nxP = h('span'); V.nxA = h('span', { class: 'ar' }); V.nxS = h('div', { class: 's' });
    V.nx = h('div', { class: 'c nx' }, V.nxL, h('div', { class: 'v num' }, V.nxP, V.nxA), V.nxS);
    V.cd = h('div', { class: 'rd-cd' }, h('div', { class: 'c' }, h('div', { class: 'l' }, 'Fin du tronçon'), V.cdT, V.cdS), V.nx);
    V.est = h('div', { class: 'rd-est', hidden: true });
    V.frise = h('canvas', { class: 'rd-frise' });
    V.friseCard = h('div', { class: 'rd-card rd-frise-card' }, h('div', { class: 'rd-lbl0' }, h('span', null, 'Les 25 prochaines minutes'), h('span', null, 'tronçons du plan')), V.frise);
    V.pow = h('div', { class: 'rd-view pow' }, V.segLine, V.center, V.cd, V.est, V.friseCard);

    // ---------- vue Corps et sortie
    const reserve = (name, cls) => {
      const fill = h('div', { class: 'fill' }), tick = h('div', { class: 'tick', hidden: true });
      const val = h('span', { class: 'val' }), sub = h('span', { class: 'sub' });
      const el = h('div', { class: 'rd-res-row ' + (cls || '') }, h('span', { class: 'nm' }, name), h('div', { class: 'track' }, fill, tick), val, sub);
      return { el, fill, tick, val, sub };
    };
    V.rW = reserve('W′', 'big');
    V.cpNow = h('span', { class: 'rd-cpnow', hidden: true });     // modèle physiologique : puissance critique du moment ; son info-bulle détaille l'état du corps
    V.tenable = h('div', { class: 'rd-tenable' });
    V.wCard = h('div', { class: 'rd-card rd-wcard' }, h('div', { class: 'rd-lbl0' }, h('span', null, 'Réserve anaérobie'), V.cpNow), V.rW.el, V.tenable);
    V.resCv = h('canvas', { class: 'rd-rescv' });
    V.lgG = h('span'); V.lgH = h('span');
    V.resCard = h('div', { class: 'rd-card rd-rescard' },
      h('div', { class: 'rd-lbl0' }, h('span', null, 'Glycogène et hydratation jusqu\'à l\'arrivée'), h('span', null, '%')), V.resCv,
      h('div', { class: 'rd-legend' }, h('span', { class: 'gly' }, h('i'), V.lgG), h('span', { class: 'hyd' }, h('i'), V.lgH),
        h('span', { class: 'key' }, '— roulé · – – prévu · ··· prévu au départ')));
    V.rT = reserve('Chaleur interne', 'thin');      // modèle physiologique : température centrale, de 37 à 40 °C
    V.tCard = h('div', { class: 'rd-card rd-tcard', hidden: true }, V.rT.el);
    const stat = (label) => {
      const v = h('div', { class: 'v num' }), s = h('div', { class: 's' });
      return { el: h('div', { class: 'rd-stat' }, h('div', { class: 'l' }, label), v, s), v, s };
    };
    V.sTime = stat('Temps'); V.sDist = stat('Distance'); V.sUp = stat('D+');
    V.sAvg = stat('Moyenne'); V.sNp = stat('Normalisée'); V.sWork = stat('Travail');
    V.stats = h('div', { class: 'rd-card rd-stats' }, h('div', { class: 'rd-lbl0' }, h('span', null, 'Sortie en cours')),
      h('div', { class: 'rd-stat-grid' }, V.sTime.el, V.sDist.el, V.sUp.el, V.sAvg.el, V.sNp.el, V.sWork.el));
    // rappels : manger, boire
    const slot = (icon, name) => {
      const txt = h('span', { class: 'txt' }), btn = h('button', { class: 'btn', type: 'button' }, 'Pris');
      const el = h('div', { class: 'rd-nut-item', 'data-state': 'later' }, h('span', { class: 'ic' }, icon), h('span', { class: 'nm' }, name), txt, btn);
      return { el, txt, btn };
    };
    V.nEat = slot('🍌', 'Manger'); V.nDrink = slot('💧', 'Boire');
    V.nEat.btn.addEventListener('click', () => { const r = run.rem && run.rem.eat; takeFood(r && r.kind ? r.kind : defaultFood()); });
    V.nDrink.btn.addEventListener('click', () => takeDrink());
    V.stock = h('div', { class: 'rd-stock' });
    V.nutQuick = h('div', { class: 'rd-quick' },
      h('button', { class: 'btn small', type: 'button', onclick: () => takeFood('gel') }, '+ Gel'),
      h('button', { class: 'btn small', type: 'button', onclick: () => takeFood('bar') }, '+ Barre'),
      h('button', { class: 'btn small', type: 'button', onclick: () => takeDrink() }, '+ Gorgée'),
      h('button', { class: 'btn small', type: 'button', onclick: () => openFood() }, 'Autre…'));
    V.nut = h('div', { class: 'rd-card rd-nut' }, V.nEat.el, V.nDrink.el, V.nutQuick, V.stock);
    V.body = h('div', { class: 'rd-view body' }, V.wCard, V.resCard, V.tCard, V.stats, V.nut);

    // ---------- vue Classement (défi contre des coureurs virtuels)
    V.mixHead = h('div', { class: 'rd-mix-head' });
    V.mixTabBtn = {};
    for (const [k, label] of [['course', 'Course'], ['points', 'Points'], ['kom', 'Montagne']]) {
      V.mixTabBtn[k] = h('button', { class: 'rd-mbtn small', type: 'button', onclick: () => { run.mixTab = k; run.mixSig = ''; if (run.sess) renderMix(); } }, label);
    }
    V.mixTabs = h('div', { class: 'rd-mix-tabs', hidden: true }, V.mixTabBtn.course, V.mixTabBtn.points, V.mixTabBtn.kom);
    V.mixBody = h('div', { class: 'rd-mix-body' });
    V.mix = h('div', { class: 'rd-card rd-mix', hidden: true }, h('h3', null, 'Classement'), V.mixHead, V.mixTabs, V.mixBody);
    V.mixView = h('div', { class: 'rd-view mixv', hidden: true }, V.mix);

    // ---------- vues, points de navigation, poches
    V.pager = h('div', { class: 'rd-pager' }, V.mapView, V.pow, V.body, V.mixView);
    V.pager.addEventListener('scroll', onPagerScroll, { passive: true });
    V.dots = h('nav', { class: 'rd-dots', 'aria-label': 'Vues du compteur' });
    V.pockets = h('div', { class: 'rd-pockets', hidden: true, role: 'dialog', 'aria-label': 'Poches' });   // aliments et boissons (renderPockets)
    V.live.append(V.head, V.pager, V.dots, V.pockets, V.banner);
  }

  /** Cadran (au choix avec la jauge) : arc de 240°, bande de la cible ± tolérance, repère de la puissance des 3 dernières secondes. */
  function buildDial() {
    const box = h('div', { class: 'rd-dialbox' });
    const svg = svgOf('<svg class="rd-dial" viewBox="0 0 280 280" aria-hidden="true"><path class="trk"/><path class="lo"/><path class="hi"/><path class="band"/>'
      + '<g class="ticks"></g><circle class="mk" r="14"/><circle class="mk2" r="6"/></svg>');
    V.dSvg = { trk: svg.querySelector('.trk'), lo: svg.querySelector('.lo'), hi: svg.querySelector('.hi'), band: svg.querySelector('.band'),
      ticks: svg.querySelector('.ticks'), mk: svg.querySelector('.mk'), mk2: svg.querySelector('.mk2') };
    V.dTgt = h('div', { class: 't num' }); V.dCur = h('div', { class: 'c num' }); V.dZone = h('div', { class: 'rd-zone' });
    box.append(svg, h('div', { class: 'ctr' }, h('div', { class: 'rd-tgt-lbl' }, 'Cible'), V.dTgt, V.dCur), V.dZone);
    return box;
  }

  const defaultFood = () => {
    const st = run.sess ? Fu.status(run.sess.fuel) : null;
    return st && st.gels > 0 ? 'gel' : 'bar';
  };

  function togglePause() {
    run.paused = !run.paused;
    V.live.classList.toggle('paused', run.paused);
    if (run.sess) { run.sess.cfg.auto = run.paused ? false : cfg().auto; }
  }

  function confirmEnd() {
    D.modal({
      title: 'Terminer la sortie ?', body: [h('p', null, 'L\'enregistrement s\'arrête. Tu pourras exporter la trace en GPX.')],
      actions: [{ label: 'Continuer' }, { label: 'Terminer', primary: true, onClick: () => { finish(true); } }],
    });
  }

  function togglePowerView() {
    store.set('ride.cfg.powerView', cfg().powerView === 'dial' ? 'gauge' : 'dial');
    if (run.sess) render(run.sess.guidance());
  }

  /* ---------- navigation entre les vues ---------- */
  function onPagerScroll() {
    if (run.pgRaf) return;
    run.pgRaf = requestAnimationFrame(() => {
      run.pgRaf = 0;
      const w = V.pager.clientWidth;
      if (w > 0) setView(Math.round(V.pager.scrollLeft / w));
    });
  }

  /** Vue i (dans viewList) ; scroll : 'smooth' ou true (instantané) pour y amener le défilement. */
  function setView(i, scroll) {
    const list = viewList();
    i = U.clamp(Math.round(i) || 0, 0, list.length - 1);
    const changed = i !== run.view;
    run.view = i;
    if (scroll && V.pager.clientWidth) V.pager.scrollTo({ left: i * V.pager.clientWidth, behavior: scroll === 'smooth' ? 'smooth' : 'auto' });
    renderDots();
    if (!changed) return;
    V.live.dataset.view = list[i];
    if (cfg().view !== list[i]) store.set('ride.cfg.view', list[i]);
    if (run.sess && run.mode === 'live') {
      if (list[i] === 'map' && run.mapOn) { run.mapKey = null; PYR.map.map.invalidateSize({ animate: false }); }
      render(run.sess.guidance());
    }
  }

  function renderDots() {
    const list = viewList(), sig = list.join(',') + '|' + run.view;
    V.mixView.hidden = !run.mix;
    if (run.dotSig === sig) return;
    run.dotSig = sig;
    D.clear(V.dots);
    list.forEach((k, i) => V.dots.append(h('button', {
      class: 'dot', type: 'button', 'aria-label': (VIEWS.find((x) => x[0] === k) || [k, k])[1], 'aria-current': i === run.view ? 'page' : 'false',
      onclick: () => setView(i, 'smooth'),
    })));
  }

  /** Mise à jour de l'écran (4 fois par seconde au plus) : l'en-tête toujours, puis la vue visible. */
  function render(g) {
    if (!g || run.mode !== 'live') return;
    renderHead(g);
    renderDots();
    const v = viewName();
    if (v === 'pow') renderPower(g);
    if (v === 'body') renderBody(g);
    renderNut(g);
    renderMix();
    mapTick(g);
    if (v === 'map') drawProfile(g);
  }

  function renderHead(g) {
    const sess = run.sess;
    setAttr(V.chGps, 'data-ok', g.offCourse ? 'off' : g.gpsLost ? 'no' : run.demo || run.lastFix ? 'yes' : 'no');
    setTxt(V.chGps, g.offCourse ? 'HORS TRACÉ' : 'GPS');
    setAttr(V.chPwr, 'data-ok', run.demo || run.powerOn ? 'yes' : g.powerEstimated ? 'est' : 'no');
    setTxt(V.chPwr, g.powerEstimated ? 'PUISS. ~' : 'PUISS.');
    const hrIn = run.hrOn || (run.demo && run.demo.replay && sess.hr > 0);
    setAttr(V.chHr, 'data-ok', hrIn ? 'yes' : 'none');
    V.chPlan.hidden = !run.replanning;
    // vitesse, et celle du tronçon dans le plan
    setTxt(V.hSpeed.val, U.fmt(g.v * 3.6, 1));
    setTxt(V.hSpeed.sub, g.seg ? `cible ${U.fmt(g.seg.kmh, 1)}` : 'km/h');
    // puissance : la vignette prend la couleur de la consigne
    const tg = g.target;
    setAttr(V.hPow.el, 'data-cue', g.cue);
    setTxt(V.hPow.val, Math.round(g.pDisp) + '');
    setTxt(V.hPow.sub, tg < 15 ? 'roue libre' : `cible ${tg}`);
    setAttr(V.hPow.el, 'title', g.pDispN === 1 ? 'Puissance instantanée (W)' : `Puissance moyenne sur ${g.pDispN} s (W)`);
    // FC : ceinture, ou cœur de la sortie rejouée ; modèle physiologique : FC prévue
    const hr = hrIn && sess.hr > 0 ? Math.round(sess.hr) : 0;
    const ph = g.fuelStatus && g.fuelStatus.phys, hf = ph && ph.hrFit;
    setTxt(V.hHr.val, hr ? hr + '' : '–');
    setTxt(V.hHr.sub, hr ? (ph ? `prévue ${Math.round(ph.HR)}` : 'bpm') : ph ? `prévue ${Math.round(ph.HR)}` : run.hrOn ? 'en attente' : 'pas de ceinture');
    setAttr(V.hHr.el, 'title', hf ? `FC prévue par le modèle physiologique, recalé sur ta FC depuis ${hmm(hf.n)}.` : '');
    // écart au plan
    const gap = g.gap, state = Math.abs(gap) < 3 ? 'even' : gap > 0 ? 'ahead' : 'behind';
    setAttr(V.gap, 'data-state', state);
    setTxt(V.gapLbl, state === 'even' ? 'dans le plan' : state === 'ahead' ? 'en avance' : 'en retard');
    setTxt(V.gapVal, (state === 'even' ? '±' : state === 'ahead' ? '+' : '−') + gapText(gap));
    const m = Math.round(g.gapM);
    setAttr(V.gap, 'title', `${m >= 0 ? '+' : '−'}${Math.abs(m)} m · arrivée ${hmm(g.finishProj)}${Math.abs(g.finishDelta0) >= 1 ? ` (${U.fmtDelta(g.finishDelta0)} sur le plan de départ)` : ''}`);
    // hauteur de l'en-tête : les vues se placent dessous, la carte passe dessous
    const hh = V.head.offsetHeight;
    if (hh && hh !== run.headH) { run.headH = hh; V.live.style.setProperty('--head-h', hh + 'px'); }
  }

  function renderPower(g) {
    setTxt(V.segLine, g.seg ? `Tronçon ${g.segIndex + 1}/${g.segCount} · km ${km(g.seg.a)} → ${km(g.seg.b)} · pente ${U.fmt(g.grade * 100, 1)} %` : '');
    const dial = cfg().powerView === 'dial', tg = g.target, coast = tg < 15;
    V.center.classList.toggle('dial', dial);
    setAttr(V.center, 'data-cue', g.cue);
    // plage affichée : la cible ± 30 % (roue libre : 0 à 150 W) ; la bande est le tube de la consigne
    const lo = coast ? 0 : Math.floor(tg * 0.7 / 10) * 10, hi = coast ? 150 : Math.ceil(tg * 1.3 / 10) * 10;
    const bLo = coast ? 0 : g.band[0], bHi = coast ? 40 : g.band[1], p = g.p3;
    const zone = (g.zonePct === null ? '–' : Math.round(g.zonePct * 100) + ' %') + ' dans la cible' + (g.cad > 0 ? ` · ${Math.round(g.cad)} tr/min` : '');
    const tgtTxt = coast ? 'Roue libre' : tg + '';
    if (!dial) {
      const f = (x) => U.clamp((x - lo) / (hi - lo), 0, 1) * 100;
      setTxt(V.gTgt, tgtTxt); V.gTgt.classList.toggle('word', coast);
      setTxt(V.gCur, Math.round(p) + ' W'); setTxt(V.gZone, zone);
      V.gBand.style.left = f(bLo).toFixed(1) + '%'; V.gBand.style.width = (f(bHi) - f(bLo)).toFixed(1) + '%';
      V.gMark.style.left = f(p).toFixed(1) + '%';
      setTxt(V.gLo, lo + ''); setTxt(V.gHi, hi + ''); setTxt(V.gBandTxt, `${Math.round(bLo)} – ${Math.round(bHi)}`);
    } else {
      setTxt(V.dTgt, tgtTxt); V.dTgt.classList.toggle('word', coast);
      setTxt(V.dCur, Math.round(p) + ' W'); setTxt(V.dZone, zone);
      updateDial(lo, hi, bLo, bHi, p, tg);
    }
    // fin du tronçon et consigne suivante
    setTxt(V.cdT, g.seg ? hmm(g.segTimeLeft) : '–');
    setTxt(V.cdS, g.seg ? distTxt(g.toSegEnd) : '');
    if (g.next) {
      const to = round5(g.next.P), d = to - tg;
      setTxt(V.nxL, `Ensuite · ${hmm(g.next.t1 - g.next.t0)}`);
      setTxt(V.nxP, to < 15 ? 'Roue libre' : to + ' W'); setTxt(V.nxA, d >= 10 ? '▲' : d <= -10 ? '▼' : '');
      setTxt(V.nxS, `pente ${U.fmt(g.next.grade * 100, 1)} %`);
      V.nx.style.setProperty('--zc', ZONE_FILL[PYR.physio.zoneIndex(g.next.P, run.sess.athlete.ftp)]);
    } else { setTxt(V.nxL, 'Ensuite'); setTxt(V.nxP, 'Arrivée'); setTxt(V.nxA, ''); setTxt(V.nxS, 'dernier tronçon'); V.nx.style.removeProperty('--zc'); }
    // sans capteur : la puissance estimée sur 30 s
    const e = g.powerEstimated ? g.est30 : null;
    V.est.hidden = !e;
    if (e) {
      const pct = Math.round(e.alpha * 100), dh = (x) => (x >= 0 ? '+' : '−') + U.fmt(Math.abs(x), 1) + ' m';
      setTxt(V.est, `Puissance estimée sur ${e.n} s : ${Math.round(e.P)} W`);
      V.est.title = `Bilan d'énergie sur ${e.n} s d'après la vitesse, la météo et la dénivelée ${dh(e.dh)} : ${pct} % altitude mesurée`
        + (Number.isFinite(e.dhMeas) ? ` (${dh(e.dhMeas)})` : ' (pas de mesure)') + `, ${100 - pct} % tracé (${dh(e.dhCourse)}).` + (g.altForced ? ' Hors parcours : l\'altitude du tracé ne compte plus.' : '');
    }
    drawFrise(g);
  }

  /** Cadran : les arcs ne sont redessinés que si la plage ou la bande changent ; le repère suit la puissance. */
  function updateDial(lo, hi, bLo, bHi, p, tg) {
    const R0 = 112, cx = 140, cy = 140, a0 = 150, sweep = 240;
    const ang = (v) => (a0 + U.clamp((v - lo) / (hi - lo), 0, 1) * sweep) * Math.PI / 180;
    const pt = (v, r) => [cx + r * Math.cos(ang(v)), cy + r * Math.sin(ang(v))];
    const arc = (v0, v1, r) => {
      const [x0, y0] = pt(v0, r), [x1, y1] = pt(v1, r), large = ang(v1) - ang(v0) > Math.PI ? 1 : 0;
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    const key = `${lo}|${hi}|${Math.round(bLo)}|${Math.round(bHi)}`;
    if (key !== run.dialKey) {
      run.dialKey = key;
      const S = V.dSvg;
      S.trk.setAttribute('d', arc(lo, hi, R0)); S.lo.setAttribute('d', arc(lo, bLo, R0)); S.hi.setAttribute('d', arc(bHi, hi, R0));
      S.band.setAttribute('d', arc(bLo, Math.max(bHi, bLo + 0.5), R0));
      let t = '';
      for (let i = 0; i <= 8; i++) {
        const v = lo + (hi - lo) * i / 8, [x0, y0] = pt(v, R0 + 14), [x1, y1] = pt(v, R0 + 22);
        t += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
      }
      for (const v of [lo, tg >= 15 ? tg : (lo + hi) / 2, hi]) {
        const [x, y] = pt(v, R0 - 30);
        t += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${Math.round(v)}</text>`;
      }
      S.ticks.innerHTML = t;
    }
    const [mx, my] = pt(p, R0);
    for (const c of [V.dSvg.mk, V.dSvg.mk2]) { c.setAttribute('cx', mx.toFixed(1)); c.setAttribute('cy', my.toFixed(1)); }
  }

  function renderBody(g) {
    const sess = run.sess;
    const pct = (x) => Math.round(U.clamp(x, 0, 1) * 100);
    const signed = (x) => Math.round(x * 100);                    // négatif : le profil de l'athlète est dépassé
    // W′ et puissance critique du moment
    V.rW.fill.style.width = pct(g.wbalFrac) + '%';
    V.rW.tick.hidden = false; V.rW.tick.style.left = pct(g.wbalPlanFrac) + '%';
    setTxt(V.rW.val, signed(g.wbalFrac) + ' %'); setTxt(V.rW.sub, `plan ${signed(g.wbalPlanFrac)} %`);
    setAttr(V.rW.el, 'data-lvl', g.wbalFrac < 0 ? 'neg' : g.wbalFrac < 0.15 ? 'low' : g.wbalFrac < 0.4 ? 'mid' : 'ok');
    const te = g.tenable;
    setTxt(V.tenable, te && Number.isFinite(te.t) ? `À ${Math.round(g.p3)} W, tu tiens encore ${hmm(te.t)}${te.by === 'wprime' ? ' (W′)' : ' (courbe record)'}` : g.p3 > 20 ? `À ${Math.round(g.p3)} W, tu peux tenir jusqu'à l'arrivée` : '');
    const gs = g.fuelStatus, ph = gs && gs.phys, hf = ph && ph.hrFit;
    V.cpNow.hidden = !ph;
    if (ph) {
      setTxt(V.cpNow, `PC actuelle ${Math.round(ph.CP2e)} W · ${Math.round(ph.cpK * 100)} %`);
      const hr = (run.hrOn || (run.demo && run.demo.replay)) && sess.hr > 0 ? Math.round(sess.hr) : 0, dHr = hr ? hr - Math.round(ph.HR) : 0;
      const sg = (x, d, u) => `${x >= 0 ? '+' : '−'}${U.fmt(Math.abs(x), d)} ${u}`;
      V.cpNow.title = `Modèle physiologique : puissance critique du moment ${Math.round(ph.CP2e)} W (${Math.round(ph.cpK * 100)} % de la fraîche), glycémie ${U.fmt(ph.glu, 1)} mmol/L, `
        + `glycogène des fibres lentes / rapides / du foie ${Math.round(ph.gI * 100)} / ${Math.round(ph.gII * 100)} / ${Math.round(ph.gL * 100)} %, FC prévue ${Math.round(ph.HR)}`
        + `${hr ? ` (mesurée ${hr}, ${dHr >= 0 ? '+' : '−'}${Math.abs(dHr)})` : ''}, natrémie ${Math.round(ph.Na)} mmol/L.`
        + (hf ? `\nRecalé sur ta FC depuis ${hmm(hf.n)} (filtre de Kalman) : FC de repos ${Math.round(hf.HRrest)} bpm (${sg(hf.dRest, 0, 'bpm')}), FC max ${Math.round(hf.HRmax)} bpm (${sg(hf.dMax, 0, 'bpm')}),`
          + ` chaleur que la météo ne voit pas ${sg(hf.Q, 0, 'W')} ; incertitude sur le noyau ± ${U.fmt(hf.sdTc, 1)} °C.` : '');
      setAttr(V.cpNow, 'data-warn', ph.hypo || ph.hypoNa || ph.critical ? '1' : '');
    }
    // glycogène et hydratation : valeurs du moment dans la légende du graphique
    const tb = g.timeToBonk;
    setTxt(V.lgG, `Glycogène ${pct(g.energy)} % · ${g.bonk ? 'fringale !' : tb < 5400 ? `fringale dans ${hmm(tb)}` : `${g.trend >= 0 ? '+' : '−'}${U.fmt(Math.abs(g.trend) * 100, 0)} %/h`}`);
    const sp = gs && gs.split;
    setAttr(V.lgG.parentNode, 'title', (sp ? `Muscles ${pct(sp.muscle)} %, foie ${pct(sp.liver)} %. ` : '')
      + (gs && gs.gut > 1 ? `Glucides avalés pas encore absorbés : ${Math.round(gs.gut)} g (absorption ${Math.round(gs.absorbing)} g/h).` : ''));
    setTxt(V.lgH, `Hydratation ${pct(g.hydration)} % · −${U.fmt(g.lossPct, 1)} % du poids`);
    // chaleur interne (modèle physiologique) : barre fine de 37 à 40 °C
    V.tCard.hidden = !ph;
    if (ph) {
      V.rT.fill.style.width = pct((ph.Tc - 37) / 3) + '%';
      setTxt(V.rT.val, U.fmt(ph.Tc, 1) + ' °C');
      setTxt(V.rT.sub, ph.critical ? 'trop chaud !' : ph.hot ? 'ralentis, bois' : `sueur ${U.fmt(ph.SR, 1)} L/h`);
      setAttr(V.rT.el, 'data-lvl', ph.Tc >= 39.5 ? 'low' : ph.Tc >= 38.8 ? 'mid' : 'ok');
      setAttr(V.rT.el, 'title', (hf ? 'Température centrale du modèle, recalée sur la fréquence cardiaque mesurée (filtre de Kalman)' : 'Température centrale prévue par le modèle (sans ceinture cardio, rien ne la recale)')
        + ` ; sueur ${U.fmt(ph.SR, 1)} L/h.`);
    }
    // statistiques de la sortie
    const st = updateStats(sess), n = sess.t;
    setTxt(V.sTime.v, hmm(g.t)); setTxt(V.sTime.s, `reste ${hmm(g.remainPlanT)}`);
    setTxt(V.sDist.v, km(g.s) + ' km'); setTxt(V.sDist.s, `reste ${km(g.remaining)} km`);
    const up = upAt(g.s);
    setTxt(V.sUp.v, U.fmt(up) + ' m'); setTxt(V.sUp.s, `reste ${U.fmt(Math.max(0, run.upTot - up))} m`);
    setTxt(V.sAvg.v, n ? Math.round(st.work / n) + ' W' : '–'); setTxt(V.sAvg.s, n ? `${U.fmt(st.work / n / Math.max(1, sess.mass), 1)} W/kg` : '');
    const np = st.cnt ? Math.pow(st.s4 / st.cnt, 0.25) : 0, ftp = sess.athlete.ftp;
    setTxt(V.sNp.v, np ? Math.round(np) + ' W' : '–'); setTxt(V.sNp.s, np && ftp ? `IF ${U.fmt(np / ftp, 2)}` : '');
    setTxt(V.sWork.v, U.fmt(st.work / 1000) + ' kJ'); setTxt(V.sWork.s, gs ? `${Math.round(sess.fuel.burned)} g de glucides` : '');
    drawReserves(g);
  }

  /** Puissance moyenne, normalisée (moyenne glissante sur 30 s à la puissance 4, comme le bilan) et travail : cumulés seconde après seconde. */
  function updateStats(sess) {
    const S = run.stats || (run.stats = { k: 0, work: 0, acc: 0, s4: 0, cnt: 0 });
    const P = sess.Pk;
    for (; S.k < sess.t; S.k++) {
      const k = S.k, p = P[k];
      S.work += p; S.acc += p;
      if (k >= 30) S.acc -= P[k - 30];
      if (k >= 29) { const m = S.acc / 30; S.s4 += m * m * m * m; S.cnt++; }
    }
    return S;
  }

  /** Dénivelé positif cumulé du parcours (profil de la page), pour le D+ roulé et restant. */
  function buildUpCum() {
    const p = store.profile;
    if (!p) { run.upCum = null; run.upTot = 0; return; }
    const c = new Float32Array(p.n);
    for (let i = 1; i < p.n; i++) c[i] = c[i - 1] + Math.max(0, p.ele[i] - p.ele[i - 1]);
    run.upCum = c; run.upStep = p.step; run.upTot = c[p.n - 1];
  }
  const upAt = (s) => (run.upCum ? run.upCum[U.clamp(Math.floor(s / run.upStep), 0, run.upCum.length - 1)] : 0);

  function renderNut(g) {
    const r = run.rem || coachTick();
    const show = (it, x, noun) => {
      if (!x) { setAttr(it.el, 'data-state', 'off'); setTxt(it.txt, 'plus utile avant l\'arrivée'); return; }
      const st = x.inS <= 0 ? (x.urgent ? 'urgent' : 'due') : x.inS < 120 ? 'soon' : 'later';
      setAttr(it.el, 'data-state', x.deferred ? 'soon' : st);
      setTxt(it.txt, x.empty ? 'plus rien dans les poches' : x.deferred ? 'après cet effort' : x.inS <= 0 ? (x.urgent ? 'maintenant !' : `maintenant${noun ? ' : ' + noun : ''}`) : `dans ${hmm(x.inS)}${noun ? ' · ' + noun : ''}`);
    };
    const lbl = (k) => (k === 'gel' ? 'un gel' : k === 'bar' ? 'une barre' : '');
    show(V.nEat, r && r.eat, r && r.eat && !r.eat.empty ? lbl(r.eat.kind) : '');
    show(V.nDrink, r && r.drink, '');
    // l'heure de manger ou de boire : une pastille dans l'en-tête, sur toutes les vues ; elle ouvre les poches
    const due = (x) => (x && !x.deferred && x.inS <= 0 ? (x.urgent ? 2 : 1) : 0);
    const dEat = due(r && r.eat), dDrink = due(r && r.drink), need = Math.max(dEat, dDrink);
    V.nutPill.hidden = !need;
    setTxt(V.nutPill, dEat && dDrink ? '🍌💧 Manger, boire' : dEat ? '🍌 Manger' : '💧 Boire');
    setAttr(V.nutPill, 'data-urgent', need === 2 ? '1' : '');
    renderPockets(g);
    const st = g.fuelStatus;
    setTxt(V.stock, `${st.gels} gel${st.gels > 1 ? 's' : ''} · ${st.bars} barre${st.bars > 1 ? 's' : ''} · ${U.fmt(st.fluid, 1)} L`
      + (st.gut > 1 ? ` · ${Math.round(st.gut)} g en cours d'absorption (${Math.round(st.absorbing)} g/h)` : ''));
  }

  /* ---------- prévision des réserves jusqu'à l'arrivée (ride.js, forecastJob) ---------- */
  const FC_EVERY = 60, FC_BUDGET = 2500, FC_STEP = 30;

  /**
   * Prises à venir pour la prévision : manger et boire au rythme du plan d'alimentation, à partir des prochains rappels du coach (qui se
   * calent sur ce qui a vraiment été pris), tant qu'il en reste dans les poches. dt : secondes d'ici.
   */
  function forecastEvents(sess) {
    const nut = run.nut, r = run.rem, ev = [];
    if (!nut || !r || !sess.plan) return ev;
    const remaining = sess.plan.tFinish - sess.plan.tAt(sess.s);
    if (r.eat && !r.eat.empty && nut.food.everyS > 0) {
      const stock = Object.assign({}, sess.fuel.items);
      for (let dt = Math.max(0, r.eat.inS); dt < remaining - Nu.NO_FOOD_LAST; dt += nut.food.everyS) {
        const kind = Nu.pickFood(stock, false);
        if (!kind) break;
        ev.push({ dt, type: 'eat', kind });
      }
    }
    if (r.drink && nut.drink.everyS > 0) for (let dt = Math.max(0, r.drink.inS); dt < remaining; dt += nut.drink.everyS) ev.push({ dt, type: 'drink' });
    return ev;
  }

  /** Relance la prévision toutes les FC_EVERY s de sortie (ou aussitôt après une prise, un recalcul, la météo), par tranches de FC_BUDGET s. */
  function forecastTick(sess) {
    if (!sess.plan || run.replanning) return;
    if (!run.fcJob && (run.fcDirty || sess.t - run.fcT >= FC_EVERY)) {
      run.fcDirty = false; run.fcT = sess.t;
      run.fcEv = forecastEvents(sess);
      run.fcJob = sess.forecastJob(run.fcEv, FC_STEP);
    }
    const job = run.fcJob;
    if (!job || !job.run(FC_BUDGET)) return;
    run.fcJob = null;
    run.fc = job.out;
    // pastilles des prises (manger) le long de la prévision
    const plan = sess.plan, t0 = plan.tAt(job.s);
    run.fcMarks = run.fcEv.filter((e) => e.type === 'eat').map((e) => ({ s: plan.sAt(t0 + e.dt), kind: e.kind }));
    if (!run.fc0) run.fc0 = { s: job.out.s.slice(), G: job.out.G.slice(), hyd: job.out.hyd.slice() };   // prévu au départ : la première prévision
  }

  /* ---------- dessins de la vue Puissance et de la vue Corps ---------- */
  /** Canevas à la taille affichée (densité de l'écran comprise) : { ctx, w, h }, ou null s'il n'est pas visible. */
  function fitCanvas(cv) {
    if (!cv.isConnected) return null;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return null;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return { ctx, w, h: hgt };
  }

  /** Couleurs du thème de la sortie (sombre), lues sur l'élément de la sortie. */
  function liveColors() {
    const css = getComputedStyle(V.live), c = (k, d) => css.getPropertyValue(k).trim() || d;
    return {
      ink: c('--ink', '#fff'), ink2: c('--ink-2', '#c3c2b7'), border: c('--border-strong', 'rgba(255,255,255,0.24)'), surface: c('--surface', '#1a1a19'),
      good: c('--rd-good', '#2fc42f'), warn: c('--rd-warn', '#f2b327'), bad: c('--rd-bad', '#ee5a5a'), badBg: c('--rd-bad-bg', 'rgba(238,90,90,0.22)'),
      low: c('--rd-low', '#4a96f0'), gly: c('--gly-muscle', '#34c05a'), past: c('--surface-2', '#232321'),
    };
  }

  const FRISE_MIN = 25;            // min de tronçons à venir dans la frise
  const FRISE_PAST = 120;          // s au plus de la part déjà roulée du tronçon en cours

  /** Frise des tronçons à venir (histogramme) : largeur = durée prévue, hauteur = puissance, couleur = zone ; ligne de la PC. */
  function drawFrise(g) {
    const c = fitCanvas(V.frise), sess = run.sess, segs = sess.segs;
    if (!c || !segs.length || g.segIndex < 0) return;
    const { ctx, w, h: hgt } = c, ftp = sess.athlete.ftp, cp = sess.athlete.cp, col = liveColors();
    const dur = (sg) => (sg.b - sg.a) / Math.max(1, sg.kmh / 3.6);
    const cur = segs[g.segIndex];
    const past = Math.min(FRISE_PAST, Math.max(0, dur(cur) - g.segTimeLeft));
    const horizon = FRISE_MIN * 60 + past;
    const bars = [{ d: past, P: cur.P, done: true }, { d: g.segTimeLeft, P: cur.P }];
    for (let i = g.segIndex + 1, t = past + g.segTimeLeft; i < segs.length && t < horizon; i++) { const d = dur(segs[i]); bars.push({ d, P: segs[i].P }); t += d; }
    let pmax = cp * 1.25;
    for (const b of bars) pmax = Math.max(pmax, b.P * 1.1);
    const top = 16, bot = hgt - 16, X = (t) => t / horizon * w, Y = (p) => bot - Math.max(0, p) / pmax * (bot - top);
    ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    let t = 0, lastLbl = -99;
    for (const b of bars) {
      if (t >= horizon) break;
      const d = Math.min(b.d, horizon - t), x0 = X(t), x1 = X(t + d);
      if (x1 - x0 > 0.5) {
        const y = Math.min(bot - 3, Y(b.P));
        ctx.fillStyle = b.done ? col.past : ZONE_FILL[PYR.physio.zoneIndex(b.P, ftp)];
        ctx.fillRect(x0 + 0.75, y, Math.max(1, x1 - x0 - 1.5), bot - y);
        if (!b.done && x1 - x0 > 22 && x0 - lastLbl > 24) { ctx.fillStyle = col.ink; ctx.fillText(b.P < 15 ? 'RL' : round5(b.P) + '', (x0 + x1) / 2, y - 2); lastLbl = x0; }
      }
      t += d;
    }
    // puissance critique
    const yc = Y(cp);
    ctx.strokeStyle = col.ink2; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, yc); ctx.lineTo(w, yc); ctx.stroke(); ctx.setLineDash([]);
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.font = '700 10px system-ui, sans-serif';
    ctx.lineWidth = 3; ctx.strokeStyle = col.surface; ctx.strokeText('PC', w - 2, yc + 2); ctx.fillStyle = col.ink2; ctx.fillText('PC', w - 2, yc + 2);
    // maintenant
    const nx = X(past);
    ctx.strokeStyle = col.ink; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(nx, top - 2); ctx.lineTo(nx, bot + 1); ctx.stroke();
    ctx.fillStyle = col.ink; ctx.beginPath(); ctx.moveTo(nx - 5, top - 8); ctx.lineTo(nx + 5, top - 8); ctx.lineTo(nx, top - 2); ctx.closePath(); ctx.fill();
    // graduations : toutes les 5 min
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = col.ink2; ctx.textBaseline = 'alphabetic';
    for (let m = 0; m <= FRISE_MIN; m += 5) {
      const x = X(past + m * 60);
      ctx.textAlign = m === 0 ? (x < 20 ? 'left' : 'center') : x > w - 24 ? 'right' : 'center';
      ctx.fillText(m === 0 ? 'maint.' : `+${m} min`, Math.min(w - 1, x), hgt - 3);
    }
  }

  /**
   * Glycogène et hydratation, du départ à l'arrivée (km) : roulé (trait plein, enregistré par la séance), prévu jusqu'à l'arrivée (tirets,
   * prévision avec les prises à venir, pastilles G et B), prévu au départ (pointillé) ; zone de fringale sous 20 %.
   */
  function drawReserves(g) {
    const c = fitCanvas(V.resCv), sess = run.sess;
    if (!c) return;
    const { ctx, w, h: hgt } = c, L = sess.course.length, col = liveColors();
    const left = 28, right = 8, top = 10, bot = hgt - 16;
    const X = (s) => left + U.clamp(s / L, 0, 1) * (w - left - right), Y = (f) => bot - U.clamp(f, 0, 1) * (bot - top);
    // fringale, grille et axes
    ctx.fillStyle = col.badBg; ctx.fillRect(left, Y(0.2), w - left - right, bot - Y(0.2));
    ctx.font = '700 10px system-ui, sans-serif'; ctx.fillStyle = col.bad; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('fringale', left + 4, bot - 4);
    ctx.strokeStyle = col.border; ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = col.ink2; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const f of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(left, Y(f)); ctx.lineTo(w - right, Y(f)); ctx.stroke(); ctx.fillText(Math.round(f * 100) + '', left - 4, Y(f)); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const stepKm = L > 120000 ? 50 : L > 50000 ? 25 : L > 20000 ? 10 : 5;
    for (let k = 0; k * 1000 <= L; k += stepKm) {
      const x = X(k * 1000);
      ctx.textAlign = x > w - 30 ? 'right' : 'center';
      ctx.fillText(String(k), x, hgt - 3);
    }
    ctx.textAlign = 'right'; ctx.fillText('km', w - right, hgt - 3);
    const path = (S, F, n, color, width, dash) => {
      if (n < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = X(S[i]), y = Y(F[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // prévu au départ
    const f0 = run.fc0;
    if (f0) { ctx.globalAlpha = 0.6; path(f0.s, f0.hyd, f0.s.length, col.low, 1.2, [1.5, 3]); path(f0.s, f0.G, f0.s.length, col.gly, 1.2, [1.5, 3]); ctx.globalAlpha = 1; }
    // roulé : un point toutes les quelques secondes
    const tr = sess.track(), n = tr.n, stp = Math.max(1, Math.floor(n / 400)), m = Math.floor((n - 1) / stp) + 1;
    if (n > 1) {
      const S = new Float32Array(m), G = new Float32Array(m), Hh = new Float32Array(m);
      for (let i = 0, k = 0; i < m; i++, k = Math.min(n - 1, k + stp)) { S[i] = tr.s[k]; G[i] = tr.gStock[k] / tr.g0; Hh[i] = tr.hydration[k]; }
      S[m - 1] = tr.s[n - 1]; G[m - 1] = tr.gStock[n - 1] / tr.g0; Hh[m - 1] = tr.hydration[n - 1];
      path(S, Hh, m, col.low, 2.5); path(S, G, m, col.gly, 3);
    }
    // prévu jusqu'à l'arrivée, et les prises
    const fc = run.fc;
    if (fc) {
      path(fc.s, fc.hyd, fc.s.length, col.low, 2, [6, 4]); path(fc.s, fc.G, fc.s.length, col.gly, 2.5, [6, 4]);
      const at = (s) => { let i = 1; while (i < fc.s.length - 1 && fc.s[i] < s) i++; const a = fc.s[i - 1], b = fc.s[i], q = b > a ? U.clamp((s - a) / (b - a), 0, 1) : 0; return fc.G[i - 1] + (fc.G[i] - fc.G[i - 1]) * q; };
      ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const mk of run.fcMarks || []) {
        if (mk.s < g.s || mk.s > L) continue;
        const x = X(mk.s), y = Math.max(top + 8, Y(at(mk.s)) - 12);
        ctx.fillStyle = col.warn; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#000'; ctx.fillText(Fu.FOODS[mk.kind] && Fu.FOODS[mk.kind].cat === 'bar' ? 'B' : 'G', x, y + 0.5);
      }
      const last = fc.s.length - 1;
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      const yG = Y(fc.G[last]), yH = Y(fc.hyd[last]), lab = (y, other) => Math.max(top + 12, Math.abs(y - other) < 13 && y <= other ? Math.min(y, other - 13) : y - 3);
      ctx.fillStyle = col.gly; ctx.fillText(Math.round(fc.G[last] * 100) + ' %', w - right - 2, lab(yG, yH));
      ctx.fillStyle = col.low; ctx.fillText(Math.round(fc.hyd[last] * 100) + ' %', w - right - 2, lab(yH, yG));
    }
    // maintenant
    const x = X(g.s);
    ctx.strokeStyle = col.ink; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke(); ctx.globalAlpha = 1;
    for (const [f, cl] of [[g.hydration, col.low], [g.energy, col.gly]]) { ctx.fillStyle = cl; ctx.strokeStyle = col.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, Y(f), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }

  /* ---------- profil ---------- */
  const ZONE_FILL = ['#8ec5f2', '#7fd48a', '#f1d95a', '#f4a24c', '#ee6a5a', '#c4509a', '#8c52c9'];

  function profileColumns(course) {
    if (run.profPts && run.profPts.course === course) return run.profPts;
    const n = 400, ele = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) ele[i] = PYR.course.eleAt(course, course.length * i / n);
    run.profPts = { course, n, ele };
    return run.profPts;
  }

  /** Profil d'élévation par-dessus la carte (bouton ⛰ de la vue Carte, réglage « Profil d'élévation sur la carte »). */
  function drawProfile(g) {
    if (!V.mapProf.hidden) drawProfileOn(V.mapProf, g, null);
  }

  function drawProfileOn(cv, g, cap) {
    if (!cv.isConnected) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = cv.clientHeight;
    if (!w || !hgt) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const sess = run.sess, course = sess.course, L = course.length, s = g.s;
    const near = run.profNear;
    let a = near ? Math.max(0, s - 800) : 0, b = near ? Math.min(L, Math.max(a + 3000, s + 5200)) : L;
    if (b - a < 3000) a = Math.max(0, b - 3000);
    const cols = Math.max(40, Math.min(220, Math.floor(w / 3)));
    const el = new Float32Array(cols + 1);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= cols; i++) { const e = PYR.course.eleAt(course, a + (b - a) * i / cols); el[i] = e; if (e < lo) lo = e; if (e > hi) hi = e; }
    const pad = Math.max(8, (hi - lo) * 0.15);
    lo -= pad; hi += pad;
    const top = 14, bot = hgt - 14, X = (m) => (m - a) / (b - a) * w, Y = (e) => bot - (e - lo) / (hi - lo) * (bot - top);
    const ftp = sess.athlete.ftp;
    const segs = sess.segs;
    // remplissage : couleur de la zone de puissance cible pour ce qui reste à rouler, gris pour le passé
    let si = 0;
    for (let i = 0; i < cols; i++) {
      const m = a + (b - a) * (i + 0.5) / cols;
      let fill;
      if (m < s) fill = 'rgba(128,128,128,0.28)';
      else {
        while (si < segs.length - 1 && m >= segs[si].b) si++;
        const sg = segs[Math.min(si, segs.length - 1)];
        fill = sg ? ZONE_FILL[PYR.physio.zoneIndex(sg.P, ftp)] + 'cc' : 'rgba(128,128,128,0.2)';
      }
      ctx.fillStyle = fill;
      const x0 = X(a + (b - a) * i / cols), x1 = X(a + (b - a) * (i + 1) / cols) + 0.6;
      const yy = Y((el[i] + el[i + 1]) / 2);
      ctx.fillRect(x0, yy, x1 - x0, bot - yy);
    }
    const css = getComputedStyle(V.live);
    const ink = css.getPropertyValue('--ink').trim() || '#000', ink2 = css.getPropertyValue('--ink-2').trim() || '#555';
    ctx.strokeStyle = ink2; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i <= cols; i++) { const x = X(a + (b - a) * i / cols), y = Y(el[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // limites de tronçons (mode proche) et étiquettes de puissance
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'top';
    if (near) {
      ctx.fillStyle = ink; ctx.strokeStyle = 'rgba(128,128,128,0.5)'; ctx.lineWidth = 1;
      let lastX = -99;
      for (const sg of segs) {
        if (sg.a < s - 50 || sg.a > b) continue;
        const x = X(Math.max(sg.a, a));
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
        if (x - lastX > 34) { ctx.fillText(Math.round(sg.P / 5) * 5 + '', Math.min(w - 26, x + 3), 1); lastX = x; }
      }
    }
    // défi : lignes des sprints et des sommets, puis les coureurs virtuels
    if (run.mix) {
      ctx.lineWidth = 2; ctx.font = '700 10px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      for (const cp of run.mix.cps) {
        if (cp.type === 'finish' || cp.s < a || cp.s > b) continue;
        const x = X(cp.s), col = cp.type === 'sprint' ? '#1d9a4a' : '#d62828';
        ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x, top + 8); ctx.lineTo(x, bot); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText(cp.type === 'sprint' ? 'S' : cp.cat === 'hc' ? 'HC' : cp.cat, x, top - 2);
      }
      ctx.textAlign = 'start';
      for (const o of PYR.rideMixed.positions(run.mix, sess.t)) {
        if (o.s < a || o.s > b) continue;
        ctx.fillStyle = o.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X(o.s), Y(PYR.course.eleAt(course, o.s)), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // position
    const px = X(s);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, top - 4); ctx.lineTo(px, bot); ctx.stroke();
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(px, Y(PYR.course.eleAt(course, s)), 5, 0, Math.PI * 2); ctx.fill();
    if (cap) setTxt(cap, near ? `km ${km(a)} → ${km(b)} · touche pour voir tout le parcours` : 'Parcours entier · touche pour zoomer autour de toi');
  }

  /* ---------- carte ---------- */
  /** La carte suit toujours la position du coureur : aucune interaction (un doigt posé sur la carte ne bloque pas le défilement de la page). */
  function lockMap() {
    const map = PYR.map.map;
    for (const k of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) if (map[k]) map[k].disable();
  }

  /** La carte de la page vient s'installer dans l'écran de la sortie. */
  function attachMap() {
    const M = PYR.map, p = store.profile;
    if (run.mapOn || !p || !M.map) return;
    run.mapOn = true;
    run.mapHome = { parent: M.map.getContainer().parentNode, view: [M.map.getCenter(), M.map.getZoom()] };
    V.mapBox.hidden = false;
    V.mapBox.insertBefore(M.map.getContainer(), V.mapBox.firstChild);
    // fond sombre le temps de la sortie, sans changer le fond choisi par l'utilisateur (rendu par detachMap)
    run.baseBefore = M.baseId();
    if (run.baseBefore !== 'dark') M.setBase('dark', { temp: true });
    M.setMode('plain');
    M.map.invalidateSize();
    run.turns = PYR.nav.turns(p);
    if (run.mix && PYR.classif.active(run.mix.cps)) M.setCheckpoints(run.mix.cps, []);   // sprints et côtes classées du défi
    run.segFor = null;
    run.segLayer = L.layerGroup().addTo(M.map);               // tronçons du plan, sous le tracé roulé (drawSegLayer)
    run.turnLayer = L.layerGroup().addTo(M.map);
    for (const t of run.turns) {
      const ll = M.latLngAt(t.s);
      if (ll) run.turnLayer.addLayer(L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#222', fillOpacity: 1, interactive: false, renderer: M.renderer }));
    }
    // manche à air à côté du cycliste : dans la carte (elle tourne avec elle), contre-tournée par --rot pour rester à droite du point (voir ride.css)
    const sockSvg = '<svg class="wsock-sv" viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-6 0 L6 0 L4.6 -7.5 L-4.6 -7.5 Z" fill="#fff"/><path d="M-4.6 -7.5 L4.6 -7.5 L3.3 -14.5 L-3.3 -14.5 Z" fill="#eb6834"/>'
      + '<path d="M-3.3 -14.5 L3.3 -14.5 L2 -21 L-2 -21 Z" fill="#fff"/><path d="M-6 0 L6 0 L4.6 -7.5 L3.3 -14.5 L2 -21 L-2 -21 L-3.3 -14.5 L-4.6 -7.5 Z" fill="none" stroke="#333" stroke-width="1" stroke-linejoin="round"/>'
      + '<circle r="3.4" fill="#333" stroke="#fff" stroke-width="1.2"/></svg>';
    run.sockEl = h('div', { class: 'wsock', hidden: true }); run.sockEl.innerHTML = sockSvg + '<div class="wsock-t"><b></b><span></span></div>';
    run.sock = L.marker([0, 0], { icon: L.divIcon({ className: '', html: run.sockEl, iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: 950 });
    run.turnLayer.addLayer(run.sock);
    run.sockTxt = '';
    run.turnNow = L.circleMarker([0, 0], { radius: 10, color: '#fff', weight: 3, fillColor: '#eb6834', fillOpacity: 1, interactive: false, renderer: M.renderer });
    run.mapZoom = 0; run.mapZoomAt = 0; run.mapTurnS = null; run.mapAngle = null; run.mapKey = null;
    run.mapS = null; run.mapT = null; run.mapOff = null; run.mapDimAt = 0; run.mapMoveAt = 0; run.mapEma = 0; run.progLine = null;
    D.clear(V.mapAttr);
    lockMap();
    mapTick(run.sess.guidance());
  }

  /** La carte retourne à sa place dans la page (autre onglet, fin de la sortie, carte masquée). */
  function detachMap() {
    if (!run.mapOn) return;
    const M = PYR.map, home = run.mapHome;
    run.mapOn = false;
    const map = M.map;
    for (const k of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) if (map[k]) map[k].enable();
    V.mapBox.classList.remove('rot');
    V.mapNorth.hidden = true;
    const st = map.getContainer().style;                         // la carte reprend sa place et son orientation d'origine
    st.right = st.bottom = st.width = st.height = st.left = st.top = st.transform = '';
    run.mapKey = null;
    stopMapLoop();
    M.layers.progress.clearLayers(); run.progLine = null;
    M.setGameMarkers(null);
    if (run.mix) { M.setCheckpoints(null); store.emit('checkpoints'); }      // la page Parcours redessine ses propres points de passage
    if (run.turnLayer) { run.turnLayer.remove(); run.turnLayer = null; }
    if (run.turnNow) { run.turnNow.remove(); run.turnNow = null; }
    if (run.segLayer) { run.segLayer.remove(); run.segLayer = null; run.segFor = null; }
    if (run.baseBefore && run.baseBefore !== 'dark') M.setBase(run.baseBefore, { temp: true });
    run.baseBefore = null;
    run.sock = null; run.sockEl = null;
    if (home && home.parent) home.parent.insertBefore(map.getContainer(), home.parent.firstChild);
    V.mapBox.hidden = true;
    togglePockets(false);
    M.setMode('grade');
    map.invalidateSize();
    if (home && home.view) map.setView(home.view[0], home.view[1], { animate: false });   // la vue de la page Parcours est rendue telle qu'elle était
  }

  /** Une mise à jour de la carte (appelée par render, 4 fois par seconde au plus). */
  function mapTick(g) {
    const c = cfg(), M = PYR.map;
    const visible = document.body.dataset.tab === 'ride';
    const want = visible && !!store.profile;
    if (want && !run.mapOn) attachMap();
    else if (!want && run.mapOn) detachMap();
    const prof = want && c.mapProfile;
    V.mapProf.hidden = !prof;
    V.mapBox.classList.toggle('has-prof', prof);
    setAttr(V.profBtn, 'aria-pressed', String(!!c.mapProfile));
    // fin du tronçon (temps, distance) et consigne suivante
    V.segLeft.hidden = !g.seg;
    if (g.seg) {
      setTxt(V.segT, `${hmm(g.segTimeLeft)} · ${distTxt(g.toSegEnd)}`);
      setTxt(V.segN, `fin du tronçon, puis ${g.next ? (g.next.P < 15 ? 'roue libre' : round5(g.next.P) + ' W') : 'l\'arrivée'}`);
    }
    // la carte passe sous l'en-tête et sous les pastilles du bas : le cycliste est placé dans la partie visible (mapFrame)
    run.mapPad = { top: run.headH || 0, bottom: (prof ? 84 : 0) + 76 };
    if (!run.mapOn) return;
    const map = M.map, now = Date.now();
    if (run.segFor !== run.sess.segs) drawSegLayer();
    updateProgress(g.s);
    // la position n'est connue qu'une fois par seconde : la boucle d'animation (mapFrame) l'extrapole entre deux mises à jour
    run.mapT = { s: g.s, v: g.v, t: g.t, at: performance.now() };
    if (run.mapS === null) run.mapS = g.s;
    M.setGameMarkers(run.mapS, mixOthers(g.t));
    updateSock(run.mapS, g.t);
    // prochain virage : marqueur, texte, et niveau de zoom
    const t = PYR.nav.nextTurn(run.turns, g.s), dist = t ? t.s - g.s : Infinity;
    if (t && run.mapTurnS !== t.s) {
      run.mapTurnS = t.s;
      run.turnNow.setLatLng(M.latLngAt(t.s));
      if (!run.turnLayer.hasLayer(run.turnNow)) run.turnLayer.addLayer(run.turnNow);
    } else if (!t && run.mapTurnS !== null) { run.mapTurnS = null; run.turnLayer.removeLayer(run.turnNow); }
    V.mapTurn.hidden = !(t && dist < 800);
    if (t && dist < 800) {
      const d = PYR.nav.describe(t);
      setTxt(V.mTurnArrow, d.arrow);
      setTxt(V.mTurnTxt, `${dist < 20 ? 'maintenant' : (dist < 100 ? Math.round(dist / 5) * 5 : Math.round(dist / 10) * 10) + ' m'} · ${d.text}`);
    }
    // zoom : plus près à l'approche d'un virage (au plus une fois par 4 s, sauf pour se rapprocher du virage) ; le zoom est animé par Leaflet
    const z = Math.min(map.getMaxZoom(), PYR.nav.zoomFor(dist, g.v));
    if (z !== run.mapZoom && (z > run.mapZoom || now - run.mapZoomAt > 4000)) {
      const first = run.mapZoom === 0;                          // le premier niveau s'applique d'un coup, les suivants sont animés
      run.mapZoom = z; run.mapZoomAt = now;
      map.setZoomAround(M.latLngAt(run.mapS), z, { animate: !first });
    }
    if (viewOn('map')) startMapLoop(); else stopMapLoop();      // la carte ne s'anime que sur sa vue
  }

  /** Tronçons du plan sur la carte : chacun à la couleur de sa zone de puissance, un point à chaque limite et la consigne à son début. */
  function drawSegLayer() {
    const M = PYR.map, p = store.profile, sess = run.sess, g = run.segLayer;
    run.segFor = sess.segs;
    if (!g || !p) return;
    g.clearLayers();
    const ftp = sess.athlete.ftp;
    for (const sg of sess.segs) {
      const i0 = U.clamp(Math.floor(sg.a / p.step), 0, p.n - 1), i1 = U.clamp(Math.ceil(sg.b / p.step), 0, p.n - 1);
      const pts = [];
      for (let i = i0; i <= i1; i++) pts.push([p.lat[i], p.lng[i]]);
      if (pts.length < 2) continue;
      g.addLayer(L.polyline(pts, { color: ZONE_FILL[PYR.physio.zoneIndex(sg.P, ftp)], weight: 7, opacity: 0.95, renderer: M.renderer, interactive: false }));
      const pos = M.latLngAt(sg.a);
      if (!pos) continue;
      g.addLayer(L.circleMarker(pos, { radius: 4, color: '#111', weight: 2, fillColor: '#fff', fillOpacity: 1, renderer: M.renderer, interactive: false }));
      const lbl = h('b', null, sg.P < 15 ? 'RL' : String(round5(sg.P)));
      g.addLayer(L.marker(pos, { icon: L.divIcon({ className: 'seg-icon', html: lbl, iconSize: [0, 0], iconAnchor: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: 300 }));
    }
  }

  /**
   * Vent à la distance s et à l'instant t de la sortie : { ws (m/s), from (° d'où il vient) }, ou null sans vent.
   * Météo du parcours quand elle est utilisée, sinon les portions de vent saisies à la main.
   */
  function windAt(s, t) {
    const C = run.sess.course;
    const i = Math.max(0, Math.min(C.n - 1, Math.floor(s / C.step)));
    let ws, from;
    if (C.weather) { const o = PYR.weather.at(C.weather, s, C.weather.start + t, run.wx || (run.wx = {})); ws = o.ws; from = o.wd; }
    else { ws = C.wMean[i]; from = C.windDir[i]; }
    if (!(ws > 0.2) || !Number.isFinite(from)) return null;
    return { ws, from };
  }

  /** Manche à air : posée à côté du cycliste, pointée vers où le vent va (dans le repère de l'écran) ; texte : vitesse du vent (km/h). */
  function updateSock(s, t) {
    const mk = run.sock, el = run.sockEl;
    if (!mk || !el) return;
    const w = windAt(s, t);
    if (el.hidden !== !w) el.hidden = !w;
    if (!w) return;
    mk.setLatLng(PYR.map.latLngAt(s));
    const toward = (w.from + 180) % 360, screen = toward - (run.mapAngle || 0);
    el.style.setProperty('--wsa', screen.toFixed(1) + 'deg');
    const kmh = Math.round(w.ws * 3.6), key = kmh + '|' + Math.round(w.from);
    if (key === run.sockTxt) return;
    run.sockTxt = key;
    el.querySelector('b').textContent = String(kmh);
    el.querySelector('span').textContent = 'km/h';
    el.title = `Vent de ${PYR.weather.compass(w.from)} : ${kmh} km/h`;
  }

  /** Coureurs virtuels à l'instant t (fractionnaire) de la sortie, pour la carte ; recalculés au plus tous les 100 ms en gros peloton. */
  function mixOthers(t) {
    const m = run.mix;
    if (!m) return [];
    const now = performance.now();
    if (m.n > 12 && run.mapOthers && now - run.mapOthersAt < 100) return run.mapOthers;
    run.mapOthersAt = now;
    return (run.mapOthers = PYR.rideMixed.positions(m, t));
  }

  /** Tracé déjà roulé : la polyligne s'allonge, au lieu d'être reconstruite. */
  function updateProgress(s) {
    const p = store.profile, M = PYR.map;
    if (!run.progLine) {
      run.progLine = L.polyline([], { color: '#eb6834', weight: 8, opacity: 1, renderer: M.renderer, interactive: false }).addTo(M.layers.progress);
      run.progIdx = -1;
    }
    const i1 = Math.min(p.n - 1, Math.floor(s / p.step));
    for (let i = run.progIdx + 1; i <= i1; i++) run.progLine.addLatLng([p.lat[i], p.lng[i]]);
    if (i1 > run.progIdx) run.progIdx = i1;
  }

  /* Animation de la carte : requestAnimationFrame à cadence adaptative. Entre deux positions (1 par seconde), le cycliste est extrapolé à sa
   * vitesse ; l'angle suit le cap avec une constante de temps (indépendante de la cadence) ; la caméra se déplace au sous-pixel. Le pas de
   * rafraîchissement dépend de la vitesse visible (pixels par seconde à ce zoom, degrés par seconde de la rotation) et du temps que
   * prend une image sur cet appareil : image à chaque rafraîchissement d'écran quand ça bouge, 8 images par seconde à l'arrêt. */
  const FRAME_MIN = 16, FRAME_MAX = 125;
  function startMapLoop() {
    if (run.mapRaf || !run.mapOn) return;
    run.mapLast = performance.now(); run.mapInterval = FRAME_MIN;
    run.mapRaf = requestAnimationFrame(mapFrame);
  }
  function stopMapLoop() { if (run.mapRaf) cancelAnimationFrame(run.mapRaf); run.mapRaf = 0; }

  function mapFrame(now) {
    run.mapRaf = 0;
    if (!run.mapOn || !run.mapT || !viewOn('map')) return;
    run.mapRaf = requestAnimationFrame(mapFrame);
    const dtMs = now - run.mapLast;
    if (dtMs < run.mapInterval - 4) return;                       // cadence adaptative : on saute cette image
    run.mapLast = now;
    const t0 = performance.now(), dt = Math.min(0.25, dtMs / 1000);
    const M = PYR.map, map = M.map, p = store.profile, T = run.mapT;
    if (map._animatingZoom) return;                               // pendant le zoom animé, Leaflet déplace lui-même la carte
    // position : extrapolée depuis la dernière mesure, puis lissée (les corrections d'une mesure à l'autre s'absorbent)
    const pred = Math.min(p.length, T.s + T.v * Math.min(1.5, (t0 - T.at) / 1000));
    const prevS = run.mapS;
    run.mapS += (pred - run.mapS) * (1 - Math.exp(-dt / 0.25));
    // cap : celui de la route un peu en avance (la carte tourne avant le virage), avec une constante de temps de 0,3 s
    const ahead = PYR.nav.bearingAt(p, Math.min(p.length, run.mapS + 25));
    const prevA = run.mapAngle === null ? ahead : run.mapAngle;
    run.mapAngle = prevA + (((ahead - prevA + 540) % 360) - 180) * (1 - Math.exp(-dt / 0.3));
    layoutMap(run.mapAngle);
    // caméra : le cycliste est placé en arrière du centre de la partie visible (entre l'en-tête et les pastilles du bas), dans le sens de
    // la marche, pour voir plus de route devant lui
    const pad = run.mapPad || { top: 0, bottom: 0 }, visH = Math.max(120, (run.mapH || 300) - pad.top - pad.bottom);
    const hd = run.mapAngle * Math.PI / 180, k = (pad.top - pad.bottom) / 2 + 0.22 * Math.min(run.mapW || 300, visH);
    const want = { x: -Math.sin(hd) * k, y: Math.cos(hd) * k }, off = run.mapOff || (run.mapOff = { x: want.x, y: want.y });
    const e = 1 - Math.exp(-dt / 0.4);
    off.x += (want.x - off.x) * e; off.y += (want.y - off.y) * e;
    const ll = M.latLngAt(run.mapS);
    const moved = panCamera(map, ll, off);
    M.setGameMarkers(run.mapS, mixOthers(T.t + Math.min(1.2, (t0 - T.at) / 1000)));
    updateSock(run.mapS, T.t + Math.min(1.2, (t0 - T.at) / 1000));
    // la carte « settle » (tuiles, tracé) toutes les 0,5 s de déplacement continu, et à l'arrêt
    if (moved) { if (!run.mapMoveAt) run.mapMoveAt = now; else if (now - run.mapMoveAt > 500) { run.mapMoveAt = 0; map.fire('moveend'); } }
    else if (run.mapMoveAt) { run.mapMoveAt = 0; map.fire('moveend'); }
    // prochain pas : vitesse visible en pixels par seconde (zoom, latitude) et en degrés par seconde
    const mpp = 156543.03 * Math.cos(ll[0] * Math.PI / 180) / Math.pow(2, map.getZoom());
    const pxS = Math.abs(run.mapS - prevS) / Math.max(dt, 1e-3) / mpp, degS = Math.abs(run.mapAngle - prevA) / Math.max(dt, 1e-3);
    const visual = Math.max(pxS, 4 * degS), work = performance.now() - t0;
    run.mapEma = (run.mapEma || work) * 0.9 + work * 0.1;
    run.mapInterval = Math.min(FRAME_MAX, Math.max(FRAME_MIN, 1000 / Math.max(8, visual), 2.2 * run.mapEma));
  }

  /** Déplace la carte pour que le point soit à `off` du centre, au sous-pixel. Renvoie true si la carte a bougé. */
  function panCamera(map, ll, off) {
    const size = map.getSize();
    if (typeof map._rawPanBy !== 'function' || typeof map._getMapPanePos !== 'function') {   // volet interne indisponible : pas entier
      const c = map.latLngToContainerPoint(ll), dx = Math.round(c.x - size.x / 2 - off.x), dy = Math.round(c.y - size.y / 2 - off.y);
      if (!dx && !dy) return false;
      map.panBy([dx, dy], { animate: false });
      return true;
    }
    const p = map.project(ll), o = map.getPixelOrigin(), pane = map._getMapPanePos();
    const dx = p.x - o.x + pane.x - (size.x / 2 + off.x), dy = p.y - o.y + pane.y - (size.y / 2 + off.y);
    if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) return false;
    if (Math.abs(dx) > size.x || Math.abs(dy) > size.y) { map.panBy([dx, dy], { animate: false }); return true; }   // très loin : déplacement complet
    map._rawPanBy(L.point(dx, dy));
    map.fire('move');
    return true;
  }

  /**
   * Orientation de la carte : angle (° , cap vers le haut de l'écran) ou null pour nord en haut. L'élément carte, tourné, est agrandi
   * jusqu'à sa diagonale et centré : aucun coin vide n'apparaît. Les interactions Leaflet ne sont pas corrigées de la rotation, d'où
   * la carte droite en mode libre.
   */
  function layoutMap(angle) {
    const el = PYR.map.map.getContainer(), box = V.mapBox, rot = angle !== null;
    const nowMs = performance.now();
    if (!run.mapDimAt || nowMs - run.mapDimAt > 500) { run.mapDimAt = nowMs; run.mapW = box.clientWidth; run.mapH = box.clientHeight; }   // mesures : pas à chaque image
    const w = run.mapW, h2 = run.mapH, key = rot ? w + 'x' + h2 : '';
    if (box.classList.contains('rot') !== rot) box.classList.toggle('rot', rot);
    if (V.mapNorth.hidden === rot) V.mapNorth.hidden = !rot;
    if (rot) {
      V.mapNorth.style.transform = `rotate(${-angle}deg)`;
      if (!V.mapAttr.firstChild) V.mapAttr.innerHTML = PYR.map.map.attributionControl.getContainer().innerHTML;
    }
    if (run.mapKey !== key) {
      run.mapKey = key;
      const s = el.style;
      if (rot) {
        const D = Math.ceil(Math.hypot(w, h2));
        s.right = s.bottom = 'auto'; s.width = s.height = D + 'px'; s.left = (w - D) / 2 + 'px'; s.top = (h2 - D) / 2 + 'px';
      } else { s.right = s.bottom = s.width = s.height = s.left = s.top = s.transform = ''; }
      PYR.map.map.invalidateSize({ animate: false });
    }
    if (rot) el.style.transform = `rotate(${-angle}deg)`;
    el.style.setProperty('--rot', rot ? `${angle}deg` : '0deg');    // les étiquettes et pastilles des marqueurs se contre-tournent (voir ride.css)
  }

  /* ---------- menu et feuilles ---------- */
  function openMenu() {
    const sess = run.sess;
    if (!sess) return;
    const c = cfg();
    const log = sess.planLog.map((p) => h('li', null, `${hmm(p.t)} · km ${km(p.s)} · ${p.reason} → arrivée ${hmm(p.tFinish)}`));
    const sp = sensorPanel({   // les deux réglages s'appliquent aussitôt
      alpha: (a) => { sess.cfg.altAlpha = a; render(sess.guidance()); },
      avg: (n) => { sess.cfg.powerAvg = n; render(sess.guidance()); },
    });
    const act = (label, cls, fn) => h('button', { class: 'btn ' + cls, type: 'button', onclick: () => { dlg.close(); fn(); } }, label);
    const dlg = D.modal({
      title: 'Sortie', wide: true,
      body: [
        h('div', { class: 'rd-btns' },
          act(run.paused ? 'Reprendre' : 'Pause', '', () => togglePause()),
          act('Recalculer le plan', '', () => replan('à la demande')),
          act('Terminer', 'danger', () => confirmEnd())),
        h('p', { class: 'rd-note' }, run.paused ? 'En pause : alertes et recalculs automatiques suspendus.' : 'Pause : suspend les alertes et les recalculs automatiques.'),
        rowEl('Mises à jour météo', selectEl([[5, 'toutes les 5 min'], [15, 'toutes les 15 min'], [30, 'toutes les 30 min'], [60, 'toutes les 60 min']], c.weatherMin, (v) => { store.set('ride.cfg.weatherMin', Number(v)); if (run.wxNextT !== undefined) run.wxNextT = sess.t + Number(v) * 60; })),
        h('div', { class: 'rd-checks' },
          checkEl('Recalcul automatique', c.auto && !run.paused, (v) => { store.set('ride.cfg.auto', v); sess.cfg.auto = v; }),
          checkEl('Bips', c.sound, (v) => { store.set('ride.cfg.sound', v); if (v) Sx.alerts.unlock(); }),
          checkEl('Vibrations', c.vibrate, (v) => store.set('ride.cfg.vibrate', v)),
          checkEl('Voix', c.voice, (v) => { store.set('ride.cfg.voice', v); if (v) Sx.alerts.unlock(); })),
        h('div', { class: 'rd-checks' },
          checkEl('Profil d\'élévation sur la carte', c.mapProfile, (v) => { store.set('ride.cfg.mapProfile', v); render(sess.guidance()); }),
          ),
        rowEl('Consigne (vue Puissance)', selectEl(POWER_VIEWS, c.powerView === 'dial' ? 'dial' : 'gauge', (v) => { store.set('ride.cfg.powerView', v); render(sess.guidance()); })),
        rowEl('Sensibilité', selectEl(Object.entries(SENS_LABEL), c.sens, (v) => { store.set('ride.cfg.sens', v); sess.cfg.sens = v; })),
        rowEl('Lissage de l\'écart', selectEl([[5, '5 s'], [8, '8 s'], [12, '12 s'], [20, '20 s']], c.gapTau, (v) => { store.set('ride.cfg.gapTau', Number(v)); sess.cfg.gapTau = Number(v); })),
        rowEl('Forme du plan (% de mes capacités)', h('span', { class: 'rd-inline' }, (() => {
          const m = marginEl((v) => {
            if (run.base) run.base.margin = 1 - v / 100;                    // les recalculs de la sortie repartent de cette base
            dlg.close();
            replan(`forme à ${v} %`);
          });
          m.disabled = store.state.perf.formRef === 'form';                 // W′bal suit le profil ajusté au départ : la forme est figée pendant la sortie
          return m;
        })(), ' %')),
        h('p', { class: 'rd-note' }, store.state.perf.formRef === 'form'
          ? 'W′bal suit le profil ajusté à la forme du départ : pour la changer en cours de sortie, choisis le profil de l\'athlète à 100 % dans la préparation.'
          : 'Changer la forme recalcule aussitôt le plan du reste du parcours ; W′bal reste lu sur le profil de l\'athlète à 100 %.'),
        h('h4', null, 'Capteurs'),
        sp.gps, ...sp.pwr, sp.avg, sp.alt, ...sp.hr,
        h('h4', null, 'Plans successifs'), h('ol', { class: 'rd-events' }, ...log),
        run.demo ? h('div', null, h('h4', null, run.demo.replay ? 'Mode démo : sortie rejouée' : 'Mode démo'),
          h('div', { class: 'rd-btns' },
            run.demo.replay ? null : h('button', { class: 'btn', type: 'button', onclick: () => { run.demo.mood(-0.25, 120); D.toast('Coup de mou : −25 % pendant 2 min.'); } }, 'Coup de mou'),
            run.demo.replay ? null : h('button', { class: 'btn', type: 'button', onclick: () => { run.demo.mood(0.3, 60); D.toast('Attaque : +30 % pendant 1 min.'); } }, 'Attaque'),
            h('button', { class: 'btn', type: 'button', onclick: () => { Sx.alerts.unlock(); notify('eat', 'Test des alertes', true); } }, 'Tester les alertes')),
          rowEl('Vitesse du temps', selectEl(SPEEDS.map((x) => [x, '×' + x]), run.demoSpeed, (v) => {
            const now = Date.now(), el = (now - run.demoWall) / 1000 * run.demoSpeed;
            run.demoSpeed = Number(v); run.demoWall = now - el / run.demoSpeed * 1000;   // le temps écoulé ne saute pas
          }))) : null,
      ],
      actions: [{ label: 'Fermer' }],
    });
    return dlg;
  }

  /* ---------- poches sur la carte ---------- */
  function togglePockets(open) {
    const on = open === undefined ? V.pockets.hidden : open;
    if (on && run.mode !== 'live') return;
    V.pockets.hidden = !on;
    run.pkSig = '';
    clearTimeout(run.pkTimer);
    document.removeEventListener('pointerdown', pocketsOutside, true);
    if (on) { armPockets(); document.addEventListener('pointerdown', pocketsOutside, true); }
    if (on && run.sess) renderPockets(run.sess.guidance());
  }

  const POCKETS_MS = 15000;                    // les poches se referment seules après ce délai sans prise
  function armPockets() { clearTimeout(run.pkTimer); run.pkTimer = setTimeout(() => togglePockets(false), POCKETS_MS); }
  /** Un toucher hors de la vignette la ferme (la pastille « Manger / Boire » de l'en-tête, elle, l'ouvre et la ferme par son propre clic). */
  function pocketsOutside(e) {
    if (V.pockets.contains(e.target) || V.nutPill.contains(e.target)) return;
    togglePockets(false);
  }

  /** Liste des aliments et boissons des poches : un clic mange ou boit une gorgée. Reconstruite seulement quand son contenu change. */
  function renderPockets(g) {
    if (V.pockets.hidden || !run.sess) return;
    const st = g.fuelStatus, r = run.rem;
    const foods = Fu.FOOD_IDS.filter((k) => st.stock[k] > 0);
    const sig = JSON.stringify([foods.map((k) => st.stock[k]), st.containers.map((c) => Math.round(c.vol * 1000)), r && r.eat ? [r.eat.kind, r.eat.inS <= 0] : 0, r && r.drink ? r.drink.inS <= 0 : 0]);
    if (run.pkSig === sig) return;
    run.pkSig = sig;
    const item = (cls, label, sub, fn, disabled) => h('button', { class: 'rd-pk-item ' + cls, type: 'button', disabled: !!disabled, onclick: fn }, h('span', { class: 'nm' }, label), h('span', { class: 'q' }, sub));
    const eatNow = r && r.eat && !r.eat.deferred && r.eat.inS <= 0 ? r.eat.kind : null;
    const list = [h('div', { class: 'rd-pk-sec first' }, 'Manger')];
    if (!foods.length) list.push(h('div', { class: 'rd-pk-none' }, 'Plus rien à manger dans les poches.'));
    for (const k of foods) list.push(item(eatNow === k ? 'rec' : '', FOOD_LABEL[k], '× ' + st.stock[k], () => { armPockets(); takeFood(k); }));
    list.push(h('div', { class: 'rd-pk-sec' }, 'Boire une gorgée'));
    const drinkNow = r && r.drink && !r.drink.deferred && r.drink.inS <= 0;
    if (!st.containers.length) list.push(h('div', { class: 'rd-pk-none' }, 'Aucun bidon emporté.'));
    st.containers.forEach((c) => list.push(item(drinkNow && c.vol >= 0.001 ? 'rec' : '', `${SLOT_LABEL[Fu.SLOTS.indexOf(c.type) >= 0 ? c.i : 0] || c.type} · ${(Fu.MIXES[c.mix] || {}).label || c.mix}`, `${U.fmt(c.vol, 2)} L`,
      () => { armPockets(); takeDrink(c.i); }, c.vol < 0.001)));
    D.clear(V.pockets);
    V.pockets.append(...list);
  }

  function openFood() {
    const sess = run.sess;
    if (!sess) return;
    const f = sess.fuel, st = Fu.status(f);
    const body = [h('h4', null, 'Manger')];
    const foods = h('div', { class: 'rd-btns wrap' });
    for (const k of Fu.FOOD_IDS) foods.append(h('button', { class: 'btn', type: 'button', onclick: () => { takeFood(k); dlg.close(); } }, `${FOOD_LABEL[k]} (${st.stock[k]})`));
    body.push(foods, h('h4', null, 'Boire une gorgée'));
    const cs = h('div', { class: 'rd-btns wrap' });
    st.containers.forEach((c) => cs.append(h('button', { class: 'btn', type: 'button', disabled: c.vol < 0.001, onclick: () => { takeDrink(c.i); dlg.close(); } },
      `${SLOT_LABEL[Fu.SLOTS.indexOf(c.type) >= 0 ? c.i : 0] || c.type} · ${(Fu.MIXES[c.mix] || {}).label || c.mix} · ${U.fmt(c.vol, 2)} L`)));
    body.push(cs, h('h4', null, 'Ravitaillement'), h('div', { class: 'rd-btns wrap' },
      h('button', { class: 'btn', type: 'button', onclick: () => { sess.refill(); D.toast('Bidons remplis.'); dlg.close(); } }, 'Remplir les bidons'),
      h('button', { class: 'btn', type: 'button', onclick: () => { sess.addFood('gel', 1); D.toast('+1 gel dans les poches'); dlg.close(); } }, '+1 gel reçu'),
      h('button', { class: 'btn', type: 'button', onclick: () => { sess.addFood('bar', 1); D.toast('+1 barre dans les poches'); dlg.close(); } }, '+1 barre reçue')));
    const dlg = D.modal({ title: 'Alimentation', wide: true, body, actions: [{ label: 'Fermer' }] });
  }

  /* ======================================================================
   * Fin, sauvegarde, reprise
   * ====================================================================== */
  function saveSession() {
    const sess = run.sess;
    if (!sess) return;
    run.lastSave = sess.t;
    try {
      PYR.kv.setItem(SESSION_KEY, JSON.stringify({
        session: sess.pack(), coach: { lastEat: run.coach.lastEat, lastDrink: run.coach.lastDrink }, demo: !!run.demo, savedAt: Date.now(),
        mix: run.mix ? PYR.rideMixed.pack(run.mix) : null,
        fc0: run.fc0 ? { s: Array.from(run.fc0.s, (x) => Math.round(x)), G: Array.from(run.fc0.G, (x) => Math.round(x * 1000) / 1000), hyd: Array.from(run.fc0.hyd, (x) => Math.round(x * 1000) / 1000) } : null,
      }));
    } catch (e) { console.warn('Sauvegarde de la sortie impossible', e); }
  }
  function readSaved() { try { const r = PYR.kv.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function clearSaved() { try { PYR.kv.removeItem(SESSION_KEY); } catch (e) { /* rien */ } }

  function renderResume() {
    const d = readSaved();
    V.resume.hidden = !(d && d.session && !d.demo && run.mode === 'prep');
    if (!V.resume.hidden) setTxt(V.resumeTxt, `Interrompue à ${hmm(d.session.t)} (${km(d.session.S[0] !== undefined ? d.session.S.reduce((a, b) => a + b, 0) / 10 : 0)} km), enregistrée à ${new Date(d.savedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`);
  }

  function resumeSession() {
    const d = readSaved();
    if (!d || !d.session) return;
    let base;
    try { base = sessionBase(d.session.startMs); } catch (e) { D.toast(e.message, 'error'); return; }
    const st = store.state, rider = st.rider;
    const sess = R.createSession({
      course: base.course, setup: base.setup, athlete: sessionAthlete(base), mass: Number(rider.weight) || 72, kit: d.session.kit, gut: d.session.gut || 0,
      tempC: Number(st.env.temperature), startMs: d.session.startMs, cfg: Object.assign({}, st.ride.cfg), physio: physioCard(base),
    });
    if (!sess.restore(d.session)) { D.toast('Sortie illisible.', 'error'); return; }
    if (!sess.plan) { D.toast('Plan introuvable dans la sauvegarde.', 'error'); return; }
    run.base = base; run.sess = sess; run.demo = null;
    run.plan = sess.plan0 || sess.plan;
    run.nut = Nu.planNutrition({
      P: run.plan.P, dur: run.plan.tFinish - run.plan.t0, mass: sess.mass, cp: base.athlete.cp, ftp: base.athlete.ftp, tempC: sess.tempC, gut: d.session.gut || 0, kit: d.session.kit,
    });
    run.coach = Nu.createCoach(run.nut);
    run.coach.restore(d.coach);
    run.mix = d.mix ? PYR.rideMixed.unpack(d.mix, mixOptions(base, d.mix.n)) : null;   // les coureurs virtuels sont rattrapés en quelques tours d'horloge
    const f0 = d.fc0;
    run.fc0 = f0 && Array.isArray(f0.s) && f0.s.length > 1 ? { s: Float32Array.from(f0.s), G: Float32Array.from(f0.G), hyd: Float32Array.from(f0.hyd) } : null;
    run.power.length = 0; run.fix.length = 0; run.cads.length = 0;
    if (!run.gpsOn) toggleGps();
    // les capteurs connus se reconnectent tout seuls, sans liste de choix (si le navigateur le permet)
    if (Sx.power.canReconnect && Sx.power.state === 'off') reconnectKnown('power');
    if (Sx.hr.canReconnect && Sx.hr.state === 'off') reconnectKnown('hr');
    enterLive();
  }

  /** Fin de la sortie : écran de bilan et export. */
  function finish(manual) {
    const sess = run.sess;
    if (!sess || run.mode !== 'live') return;
    clearInterval(run.timer); run.timer = null;
    liveFinish(sess);
    detachMap();
    Sx.wake.release();
    if (run.gpsOn) { Sx.gps.stop(); run.gpsOn = false; run.lastFix = null; }
    clearSaved();
    mixTick(sess);                                               // dernier passage (arrivée) du cycliste
    if (!manual && !run.mix) notify('info', 'Arrivée. Bien joué !', true);   // avec le défi, l'annonce de l'arrivée donne la place
    run.mode = 'done';
    buildDone();
    setMode('done');
    if (run.mix) finishMix();
  }

  /** Bilan du défi : les coureurs virtuels finissent leur course (par petites tranches de calcul), puis les classements s'affichent. */
  function finishMix() {
    const m = run.mix, sess = run.sess;
    const step = () => {
      if (run.mix !== m || run.mode !== 'done') return;
      const done = PYR.rideMixed.finishAll(m, 25);
      PYR.rideMixed.update(m, sess, 0);
      if (!done) { setTimeout(step, 0); return; }
      renderDoneMix();
    };
    step();
  }

  function renderDoneMix() {
    const m = run.mix, sess = run.sess;
    if (!m || !V.doneMix) return;
    const Mx = PYR.rideMixed, CV = PYR.classifView, nm = Mx.names(m), name = (id) => (nm.get(id) ? nm.get(id).name : id);
    const sd = Mx.standings(m, sess), me = sd.general.find((x) => x.id === 'me');
    D.clear(V.doneMix);
    const tb = h('tbody');
    for (const x of sd.general) {
      tb.appendChild(h('tr', { class: x.id === 'me' ? 'me' : '' },
        h('td', null, String(x.rank)), h('td', null, h('span', { class: 'dot', style: { background: (nm.get(x.id) && nm.get(x.id).color) || ME_COLOR } }), name(x.id)),
        h('td', null, x.time !== null ? hmm(x.time) : '–')));
    }
    V.doneMix.append(
      h('h3', null, `Défi : tu termines ${CV.ordinal(me ? me.rank : 0)} sur ${sd.general.length}`),
      CV.scrollable(h('div', { class: 'table-wrap' }, h('table', { class: 'simple num leaderboard' }, h('thead', null, h('tr', null, ...['#', 'Cycliste', 'Temps'].map((x) => h('th', null, x)))), tb)), sd.general.length),
      PYR.classif.active(m.cps) ? CV.block(m.cps, sd, { name, meId: 'me', full: true }) : null);
  }

  function buildDone() {
    const sess = run.sess, T = sess.track(), n = T.n;
    D.clear(V.done);
    let work = 0, np = 0;
    for (let k = 0; k < n; k++) work += T.P[k];
    if (n >= 30) {
      let acc = 0, s4 = 0, cnt = 0;
      for (let k = 0; k < n; k++) { acc += T.P[k]; if (k >= 30) acc -= T.P[k - 30]; if (k >= 29) { const m = acc / 30; s4 += m * m * m * m; cnt++; } }
      np = Math.pow(s4 / cnt, 0.25);
    }
    const g = sess.guidance();
    const tile = (l, v) => D.stat(l, v);
    const plan0 = sess.plan0;
    const wmin = (() => { let w = sess.athlete.w0, mn = w; for (let k = 0; k < n; k++) { w = PYR.physio.wbalStep(w, T.P[k], sess.athlete.cp, sess.athlete.w0, 1, sess.athlete.recF); if (w < mn) mn = w; } return mn; })();
    const done = sess.s >= sess.course.length - 50;
    V.done.append(h('div', { class: 'rd-card' },
      h('h3', null, done ? 'Sortie terminée' : 'Sortie arrêtée'),
      h('div', { class: 'stats' },
        tile('Temps', hmm(n)), tile('Distance', km(sess.s) + ' km'),
        tile('Plan de départ', plan0 ? hmm(plan0.tFinish) : '–'), tile('Écart', plan0 && done ? U.fmtDelta(n - plan0.tFinish) : '–'),
        tile('Puissance moy.', n ? Math.round(work / n) + ' W' : '–'), tile('Puissance norm.', np ? Math.round(np) + ' W' : '–'),
        tile('W′ minimal', Math.round(wmin / sess.athlete.w0 * 100) + ' %'), tile('Glycogène final', g ? Math.round(g.energy * 100) + ' %' : '–'),
        tile('Recalculs', Math.max(0, sess.planLog.length - 1) + ''), tile('Prises', sess.intakes.length + ''),
        ...(g && g.fuelStatus && g.fuelStatus.phys ? [
          tile('Temp. centrale max', U.fmt(g.fuelStatus.phys.maxTc, 1) + ' °C'), tile('Glycémie min.', U.fmt(g.fuelStatus.phys.minGlu, 1) + ' mmol/L'),
          tile('Sueur', U.fmt(g.fuelStatus.phys.sweatL, 1) + ' L'), tile('Glucides brûlés', Math.round(g.fuelStatus.phys.choTot) + ' g'),
          tile('PC effective finale', Math.round(g.fuelStatus.phys.cpK * 100) + ' %'),
          // recalage par la FC : FC de repos et max apprises, à reporter dans la carte athlète (page Athlète) si elles se confirment
          ...(g.fuelStatus.phys.hrFit && g.fuelStatus.phys.hrFit.n >= 600 ? [tile('FC repos / max recalées', `${Math.round(g.fuelStatus.phys.hrFit.HRrest)} / ${Math.round(g.fuelStatus.phys.hrFit.HRmax)} bpm`)] : [])] : [])),
      h('h4', null, 'Enregistrer l\'activité'),
      h('p', { class: 'rd-note' }, 'Un point par seconde : position, altitude, distance, vitesse, puissance, cardio, cadence, W′bal et glycogène dépensé (cardio et cadence s\'ils étaient mesurés).'),
      h('div', { class: 'rd-btns' }, ...PYR.activityExport.FORMATS.map((fm, i) => h('button', { class: 'btn' + (i === 0 ? ' primary' : ''), type: 'button', title: fm.hint, onclick: () => exportActivity(fm.id) }, fm.label))),
      h('ul', { class: 'rd-export-hints' }, ...PYR.activityExport.FORMATS.map((fm) => h('li', null, h('strong', null, fm.label), ' : ' + fm.hint))),
      h('div', { class: 'rd-btns' },
        h('button', { class: 'btn', type: 'button', onclick: () => { run.mode = 'prep'; run.sess = null; run.demo = null; run.mix = null; setMode('prep'); renderPrep(); } }, 'Nouvelle sortie'))));
    V.doneMix = h('div', { class: 'rd-card rd-done-mix', hidden: !run.mix }, h('p', { class: 'rd-note' }, 'Calcul des arrivées des coureurs virtuels…'));
    V.done.append(V.doneMix);
  }

  /** Enregistre l'activité dans l'un des formats d'activity-export.js (FIT, TCX, GPX, CSV). */
  function exportActivity(id) {
    const sess = run.sess;
    if (!sess) return;
    if (sess.t < 2) { D.toast('Sortie trop courte pour être enregistrée.', 'error'); return; }
    try {
      const out = PYR.activityExport.build(sess, id, `Sortie du ${new Date(sess.startMs).toLocaleDateString('fr-FR')}`);
      D.download(out.filename, new Blob([out.data], { type: out.mime }), out.mime);
    } catch (e) {
      console.error(e);
      D.toast('Export impossible : ' + e.message, 'error');
    }
  }

  /* ======================================================================
   * Page
   * ====================================================================== */
  function setMode(m) {
    V.prep.hidden = m !== 'prep'; V.live.hidden = m !== 'live'; V.done.hidden = m !== 'done';
    document.body.dataset.ride = m;
    V.back.hidden = m === 'live';
    setTxt(V.title, m === 'live' ? 'Sortie en cours' : m === 'done' ? 'Bilan' : 'Compteur');
    if (V.scroll) V.scroll.scrollTop = 0;
  }

  function build() {
    const root = $('#ride');
    D.clear(root);
    V.root = root;
    V.back = h('button', { class: 'btn ghost', type: 'button', onclick: () => PYR.app.back() }, '‹ Retour');
    V.title = h('strong', { class: 'rd-title' }, 'Compteur');
    V.top = h('header', { class: 'rd-top' }, V.back, V.title);
    // la page est recouverte par le compteur plein écran : le menu des pages du site (js/menu.js) passe dans son bandeau, à droite
    const menu = document.querySelector('.burger-wrap');
    if (menu) { menu.classList.add('rd-menu'); V.top.append(menu); }
    buildPrep(); buildLive();
    V.done = h('section', { class: 'rd-done', hidden: true });
    V.col = h('div', { class: 'rd-col' }, V.prep, V.live, V.done);
    V.scroll = h('div', { class: 'rd-scroll' }, V.col);
    root.append(V.top, V.scroll);
  }

  const T = {
    init() {
      const rs = store.state.ride;
      if (!rs) return;
      build();
      PYR.cloud.onChange(() => { if (run.mode === 'prep') renderCloud(); });
      LC.load();
      composeSelection();
      renderPickers(); renderCloud();
      pullFromCloud(false);                                       // la bibliothèque est relue dans Dropbox à l'ouverture
      // le parcours et l'athlète se choisissent sur la page d'accueil : on les relit au retour sur cette page
      window.addEventListener('pageshow', (e) => { if (e.persisted && run.mode === 'prep') { const again = () => { LC.load(); composeSelection(); renderPickers(); renderCloud(); renderPrep(); }; PYR.kv.refresh().then(again, again); } });
      ['profile', 'rider', 'bike', 'env', 'perf', 'weather', 'surfaces', 'winds'].forEach((e) => store.on(e, () => { if (run.mode === 'prep' && document.body.dataset.tab === 'ride') renderPrep(); }));
      // la référence de W′bal est inscrite dans le plan : un plan repris de la page Pacing optimal est repris à nouveau, les autres sont signalés périmés (empreinte)
      store.on('formref', () => {
        if (run.mode !== 'prep') return;
        const info = store.state.ride.planInfo;
        if (info && info.source === 'perf' && store.plan && !store.planStale) adoptPerfPlan(true);
        if (document.body.dataset.tab === 'ride') renderPrep();
      });
      window.addEventListener('pagehide', () => { if (run.mode === 'live') saveSession(); });
      // flèches gauche et droite : vue précédente ou suivante
      document.addEventListener('keydown', (e) => {
        if (run.mode !== 'live' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.target.closest('input, select, textarea, .modal')) return;
        e.preventDefault();
        setView(run.view + (e.key === 'ArrowRight' ? 1 : -1), 'smooth');
      });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && run.mode === 'live') saveSession(); });
      window.addEventListener('resize', () => {
        if (run.mode === 'live' && run.sess) { setView(run.view, true); render(run.sess.guidance()); }
        else if (run.mode === 'prep' && document.body.dataset.tab === 'ride') renderPrep();
      });
    },
    onShow() {
      clearInterval(run.bleTimer);
      run.bleTimer = setInterval(() => { if (document.body.dataset.tab === 'ride') renderSensors(); }, 1000);
      if (run.mode === 'prep') { run.base = null; run.segPlan = null; loadStoredPlan(); renderPrep(); }
      else if (run.mode === 'live' && run.sess) render(run.sess.guidance());
      document.body.dataset.ride = run.mode;
    },
    onHide() { detachMap(); /* la sortie continue en arrière-plan ; la carte retourne à la page */ },
    /** Le plan de la page Pacing optimal devient celui de la sortie (appelé par tab-perf.js dès qu'il est calculé). */
    adoptPerfPlan,
    /** Plan enregistré avec le projet, s'il correspond encore au parcours, à l'athlète et au vélo (fantôme du jeu sur une autre page). */
    savedPlan() {
      return PYR.planLink.saved();
    },
    /** Pour les tests de l'interface : accès à l'état. */
    _run: run,
  };

  PYR.tabRide = T;
})(globalThis.PYR = globalThis.PYR || {});
