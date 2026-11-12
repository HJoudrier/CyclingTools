/* author : Hugo Joudrier-Faure */
/* Wattlas — Course 3D (cartoon) : l'écran de jeu en plein écran. La vue 3D remplit la fenêtre, sans entête ni panneau latéral ; toutes les
 * informations passent dans un HUD superposé, dont chaque élément se désactive (menu, onglet « Affichage » ; réglage ui.hud3d) :
 *   - en haut : puissance, vitesse et FC, puis pente, distance restante, temps, prochain point, météo, et l'alerte de course ;
 *   - en haut à droite : le classement de l'étape (les cinq premiers et ta place) ;
 *   - en bas : la vignette de chaque coureur, avec son effort en % de la PC (crans de 5 %), son endurance (glycogène, en vert), son effort
 *     court (W′, en rouge) et ses actions : remonter en tête, attaquer, suivre les attaques, sprinter, rouler en tête, prendre le relais,
 *     rester dans les roues, manger.
 * Mode équipe : toutes les vignettes de l'équipe sur grand écran ; sur téléphone, le coureur piloté sur la vue de course, ses équipiers
 * sur une seconde vue, à balayer. Échap (ou ☰) ouvre le menu : reprendre, profil de l'étape, classements, affichage, recommencer, quitter.
 * game-mobile.js garde la machine d'états de l'écran de course (enter, leave, sync, téléphone ou grand écran) et délègue ici le montage et
 * l'affichage ; la logique reste dans tab-game.js (setPct, act, togglePause, switchRider). Actif seulement sur VirtualRide3D/course.html
 * (body data-hud="overlay").
 * Trajectoire (vignette du coureur piloté, touche V) : automatique (à la corde) ou manuelle (← → et F, manette, gyroscope, contrôleurs VR :
 * jeu/steer-input.js).
 * Téléphone (paysage) : une autre disposition (doc/maquettes-course3d, D, F et I). En haut, le coureur actif (◀ ▶ vers le coéquipier le
 * plus proche derrière ou devant), sa puissance (éclair), sa vitesse et sa FC (cœur) ; à gauche, l'équipe et la trajectoire ; à droite, la
 * radio d'équipe (les actions du coureur actif, en liste) et le menu. En bas, Freiner, l'effort (aspiration, aérobie, anaérobie) et
 * Accélérer (à tapoter).
 * Sensations (maquette I, réglables dans l'onglet Affichage) : sur téléphone, le bord de l'écran rougit et bat au rythme du cœur quand
 * l'anaérobie se vide, et le téléphone vibre (battements, bas-côté, chute, coup de frein) ; dans la vue 3D, les marqueurs des
 * coéquipiers (un toucher pilote ce coureur) et la respiration (bridge.js, audio.js). */
(function (PYR) {
  'use strict';

  const D = PYR.dom, U = PYR.util, store = PYR.store, { $, h } = D;
  const Fu = PYR.fuel, Sim = PYR.sim, Tac = PYR.tactics, Steer = PYR.steer;

  const PCT_MAX = 150, PCT_STEP = 5;            // effort : de 0 à 150 % de la PC, par crans de 5 %
  const PRESETS = [55, 75, 90, 100, 120];        // touches 1 à 5 : récupération, endurance, tempo, seuil, au-dessus
  const UPDATE_MS = 150, RANK_MS = 500;
  const SVG = 'http://www.w3.org/2000/svg';

  /** Éléments du HUD qu'on peut masquer (onglet « Affichage » du menu), dans l'ordre de l'onglet. */
  const WIDGETS = [
    { id: 'power', label: 'Puissance' }, { id: 'speed', label: 'Vitesse' }, { id: 'hr', label: 'Fréquence cardiaque' },
    { id: 'draft', label: 'Aspiration (watts économisés)' },
    { id: 'grade', label: 'Pente' }, { id: 'togo', label: 'Distance restante' }, { id: 'time', label: 'Temps de course' },
    { id: 'next', label: 'Prochain point (sprint, sommet, arrivée)' }, { id: 'wx', label: 'Météo à ta position' },
    { id: 'banner', label: 'Alertes de course (fringale, chute, W′ épuisé…)' }, { id: 'rank', label: 'Classement de l\'étape' },
    { id: 'riders', label: 'Vignettes des coureurs (effort, endurance, actions)' },
  ];
  /** Sensations (onglet « Affichage », à part des éléments) : actives par défaut. */
  const FEEL = [
    { id: 'redEdge', label: 'Bord de l\'écran rouge qui bat au rythme du cœur quand l\'anaérobie se vide (téléphone)' },
    { id: 'markers', label: 'Marqueurs des coéquipiers dans la vue 3D (touche-les pour les piloter)' },
    { id: 'breath', label: 'Respiration du coureur (son de la vue 3D)' },
    { id: 'vibe', label: 'Vibrations (téléphone Android : battements, bas-côté, chute, freinage)' },
  ];
  const EDGE_FROM = 0.4, VIBE_FROM = 0.2; // anaérobie (W′) : le bord rougit sous 40 %, le téléphone bat sous 20 %

  /** Actions d'un coureur (vignette), avec leur touche pour le coureur piloté et leur dessin (tracés d'une icône 24 × 24). */
  const ACTIONS = [
    { id: 'moveup', key: 'U', label: 'Remonter en tête', help: 'Remonter aux premières places du groupe, puis rester dans les roues', d: ['M6 13l6-6 6 6', 'M6 19l6-6 6 6'] },
    { id: 'attack', key: '6', label: 'Attaquer', help: 'Attaquer : une accélération, puis un effort tenu une minute (jusqu\'au sommet dans une côte classée)', d: ['M13 2 4 14h7l-1 8 9-12h-7z'] },
    { id: 'cover', key: 'S', label: 'Suivre les attaques', help: 'Rester aux premières places et sauter dans la roue de ceux qui attaquent', d: ['M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6', 'M12 1v4M12 19v4M1 12h4M19 12h4'] },
    { id: 'sprint', key: '', label: 'Sprinter jusqu\'à la ligne', help: 'Un seul appui : à fond jusqu\'à la ligne si elle est proche (35 s au plus). Pour doser, tapote Accélérer (touche 7)', d: ['M5 21V4', 'M5 4h12l-3 4 3 4H5'] },
    { id: 'front', key: 'T', label: 'Rouler en tête', help: 'Remonter en tête du groupe et mener à l\'effort de la barre, sans relais', d: ['M4 12h12', 'm11 6 6 6-6 6', 'M21 4v16'] },
    { id: 'relay', key: '9', label: 'Prendre le relais', help: 'Relayer : mener le groupe à son tour (à l\'effort de la barre), puis se laisser glisser', d: ['M20 12a8 8 0 0 1-14 5.3', 'M4 12a8 8 0 0 1 14-5.3', 'M18 3v4h-4', 'M6 21v-4h4'] },
    { id: 'follow', key: '8', label: 'Rester dans les roues', help: 'Rester abrité dans la roue de celui de devant', d: ['M3 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M15 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M6 17l4-8h5l3 8', 'M10 9 8 5h3'] },
    { id: 'eat', key: 'M', label: 'Manger', help: 'Manger un gel ou une barre : l\'endurance remonte', d: ['M12 7c-3-2-7 0-7 5s3 9 7 9 7-4 7-9-4-7-7-5z', 'M12 7c0-2 1-4 3-4'] },
  ];
  const ICON = {
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    auto: ['M5 20 12 4l7 16', 'M8 14h8'],
    cam: ['M3 7h4l2-3h6l2 3h4v13H3z', 'M12 9a4 4 0 1 0 0 8 4 4 0 1 0 0-8'],
    minus: ['M5 12h14'], plus: ['M5 12h14', 'M12 5v14'],
    brake: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18', 'M8 12h8'],
    tilt: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M3 9l2 3-2 3', 'M21 9l-2 3 2 3'],
    team: ['M9 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7.5', 'M22 21v-1a6 6 0 0 0-4-5.6'],
    left: ['M15 6l-6 6 6 6'], right: ['M9 6l6 6-6 6'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    accel: ['M5 13l7-7 7 7', 'M5 20l7-7 7 7'],
    // radio d'équipe : un casque à micro (les consignes du directeur sportif)
    radio: ['M4 14v-2a8 8 0 0 1 16 0v2', 'M4 14a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2', 'M20 14a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2', 'M18 16v1a4 4 0 0 1-4 4h-2'],
    rotate: ['M4 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z', 'M16 3a5 5 0 0 1 5 5', 'M19 8l2 0 0-2'],
  };
  const HEART = 'M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z';
  /** Trajectoire du coureur piloté : automatique à la corde, automatique large, manuelle. */
  const STEERS = [
    { id: 'auto', label: 'Auto', help: 'Pilote automatique : il prend les virages à la corde, s\'écarte pour remonter, évite les chutes et freine pour toi' },
    { id: 'manual', label: 'Manuelle', help: 'Tu pilotes : ← → (stick gauche, inclinaison du téléphone, contrôleurs VR) et tu freines (F, gâchette gauche, bouton Frein). Trop vite en virage ou hors de la route : chute probable' },
  ];
  const SRC_ICON = { keys: '⌨', gamepad: '🎮', vr: '🥽', tilt: '📱' };

  const H = {};
  const E = {};                                  // éléments construits par build()
  const S = { mode: null, cards: new Map(), key: '', me: null, at: 0, rankAt: 0, menu: null, pausedByMenu: false, page: 0, parked: [], pos: new Map(), pop: null, locked: false,
    feel: { wf: 1, hr: 0, zone: 'road', v: 0, crash: false }, beatAt: 0, rumbleAt: 0, beat: 0, vibeTimer: null };
  const P = {};                                  // téléphone : éléments construits par buildPhone()
  let T = null, G = null;

  const on = () => PYR.appId === 'jeu3d' && document.body.dataset.hud === 'overlay';
  H.on = on;

  /* ---------- outils ---------- */
  function icon(paths) {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'h3-ico');
    for (const d of paths) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    }
    return s;
  }
  const tint = (el, color) => { if (color) el.style.setProperty('--tc', color); return el; };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase();
  const fmt = (x, d) => (Number.isFinite(x) ? U.fmt(x, d) : '–');
  const snap5 = (p) => U.clamp(Math.round(p / PCT_STEP) * PCT_STEP, 0, PCT_MAX);
  const prefs = () => Object.assign({}, store.state.ui.hud3d || {});
  const riders = () => (G && G.team ? G.team.own : G && G.me ? [G.me] : []);

  function photo(el, name) {
    if (!PYR.proPhoto || !G || !G.team) return;
    PYR.proPhoto.get(name).then((ph) => { if (ph && ph.src && el.isConnected) { el.style.backgroundImage = `url("${ph.src}")`; el.textContent = ''; } }, () => {});
  }

  /** Déplace un élément de la page (profil, classements, résultat) dans le menu, et le remet à sa place ensuite. */
  function park(el, target) {
    if (!el || !target) return;
    const ph = document.createComment('hud3d');
    el.parentNode.insertBefore(ph, el);
    S.parked.push({ el, ph });
    target.appendChild(el);
  }
  function unpark() {
    while (S.parked.length) {
      const { el, ph } = S.parked.pop();
      if (ph.parentNode) { ph.parentNode.insertBefore(el, ph); ph.remove(); }
    }
    if (G && G.chart) G.chart.surface.request();
  }

  /* ---------- construction ---------- */
  function stat(id, label, unit) {
    const v = h('strong', null, '–');
    const el = h('div', { class: `h3-stat h3-w-${id}` }, h('span', null, label), v, unit ? h('em', null, unit) : null);
    return { el, v };
  }
  function chip(id, title) {
    const el = h('div', { class: `h3-chip h3-w-${id}`, title: title || '' });
    return el;
  }

  function build() {
    E.power = stat('power', 'Puissance', 'W');
    E.speed = stat('speed', 'Vitesse', 'km/h');
    E.hr = stat('hr', 'FC', 'bpm');
    E.grade = chip('grade', 'Pente à ta position');
    E.togo = chip('togo', 'Distance jusqu\'à l\'arrivée');
    E.time = chip('time', 'Temps de course');
    E.next = chip('next', 'Prochain point de passage : sprint intermédiaire, sommet classé ou arrivée');
    E.wx = chip('wx', 'Météo à ta position : température, vent sur ton cap, pluie');
    E.top = h('div', { class: 'h3-top' },
      h('div', { class: 'h3-stats' }, E.power.el, E.speed.el, E.hr.el),
      h('div', { class: 'h3-chips' }, E.draft = chip('draft', 'Watts que tu n\'as pas à dépenser grâce à l\'aspiration (dans les roues)'), E.grade, E.togo, E.time, E.next, E.wx,
        E.steer = chip('steer', 'Trajectoire du coureur piloté (touche V : automatique ↔ manuelle)')));
    E.menuBtn = h('button', { class: 'h3-tool', type: 'button', title: 'Menu (Échap) : reprendre, profil de l\'étape, classements, affichage, quitter', 'aria-label': 'Menu', onclick: () => H.menu() }, icon(ICON.menu));
    E.tools = h('div', { class: 'h3-tools' }, E.menuBtn);
    E.rankList = h('ol', { class: 'h3-rank-list' });
    E.rankHead = h('div', { class: 'h3-rank-head' }, 'Étape');
    E.rank = h('div', { class: 'h3-rank h3-w-rank', 'aria-live': 'off' }, E.rankHead, E.rankList);
    E.dock = h('div', { class: 'h3-dock h3-w-riders' });
    // téléphone, mode équipe : la vue de course (coureur piloté) et la vue de l'équipe, à balayer
    E.teamList = h('div', { class: 'h3-team-list' });
    E.page1 = h('section', { class: 'h3-page h3-page-race', 'aria-label': 'Course' });
    E.page2 = h('section', { class: 'h3-page h3-page-team', 'aria-label': 'Ton équipe' }, h('h3', null, 'Ton équipe'), E.teamList);
    E.pager = h('div', { class: 'h3-pager h3-w-riders' }, E.page1, E.page2);
    E.pager.addEventListener('scroll', () => {
      const p = Math.round(E.pager.scrollLeft / Math.max(1, E.pager.clientWidth));
      if (p !== S.page) { S.page = p; renderDots(); }
    }, { passive: true });
    E.dots = h('div', { class: 'h3-dots', role: 'tablist', 'aria-label': 'Vues' },
      [0, 1].map((i) => h('button', { type: 'button', role: 'tab', 'aria-label': i ? 'Ton équipe' : 'Course', onclick: () => showPage(i) })));
    // trajectoire manuelle sur téléphone : frein à maintenir (à gauche, sous le pouce) et gyroscope
    E.brake = h('button', { class: 'h3-brake', type: 'button', 'aria-label': 'Frein (maintenir)', title: 'Frein : maintiens appuyé (touche F, gâchette gauche)' }, icon(ICON.brake), h('span', null, 'Frein'));
    const brake = (on) => (e) => { if (e.cancelable) e.preventDefault(); PYR.steerInput.setBrakeButton(on); E.brake.classList.toggle('on', on); };
    E.brake.addEventListener('pointerdown', brake(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) E.brake.addEventListener(ev, brake(false));
    E.tiltBtn = h('button', { class: 'h3-tiltbtn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Piloter en inclinant le téléphone', title: 'Gyroscope : incline le téléphone pour piloter (touche pour l\'activer ou le couper)' }, icon(ICON.tilt), h('span', null, 'Gyro'));
    E.tiltBtn.addEventListener('click', async () => {
      const on = await PYR.steerInput.setTilt(!PYR.steerInput.tiltOn);
      if (!on && !PYR.steerInput.tiltOn && E.tiltBtn.getAttribute('aria-pressed') === 'false') D.toast('Gyroscope indisponible (capteur absent ou permission refusée) : pilote avec les boutons ou la manette.', 'error');
      E.tiltBtn.setAttribute('aria-pressed', String(PYR.steerInput.tiltOn));
    });
    E.drive = h('div', { class: 'h3-drive', hidden: true }, E.tiltBtn, E.brake);
    E.root = h('div', { class: 'h3', hidden: true }, E.top, E.tools, E.rank, E.dock, E.dots, E.drive);
    $('.map-wrap').append(E.root);
    buildPhone();
  }

  /* ---------- téléphone en paysage : la disposition D (haut et bas), la liste d'actions de F ---------- */
  function svgHeart() {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'h3p-heart');
    const pa = document.createElementNS(SVG, 'path');
    pa.setAttribute('d', HEART);
    s.appendChild(pa);
    return s;
  }

  function buildPhone() {
    const btn = (cls, title, kids, onclick) => h('button', { class: cls, type: 'button', title, 'aria-label': title, onclick }, ...kids);
    // en haut à gauche : l'équipe, la trajectoire (auto / manuelle), le gyroscope (manuelle)
    P.teamBtn = btn('h3p-sq', 'Ton équipe : choisis le coureur à piloter', [icon(ICON.team)], (e) => { e.stopPropagation(); togglePop('team'); });
    P.steerBtns = STEERS.map((m) => h('button', { type: 'button', 'data-steer': m.id, title: m.help, 'aria-pressed': 'false', onclick: () => { T.setSteer(m.id); update(true); } }, m.label));
    P.steer = h('div', { class: 'h3p-seg', role: 'group', 'aria-label': 'Trajectoire' }, h('span', { class: 'h3-lbl' }, 'Traj.'), ...P.steerBtns);
    P.gyro = btn('h3p-sq h3p-gyro', 'Gyroscope : incline le téléphone pour piloter', [icon(ICON.tilt)], async () => {
      const ok = await PYR.steerInput.setTilt(!PYR.steerInput.tiltOn);
      if (!ok && !PYR.steerInput.tiltOn) D.toast('Gyroscope indisponible (capteur absent ou permission refusée).', 'error');
      update(true);
    });
    P.tl = h('div', { class: 'h3p-tl' }, P.teamBtn, h('div', { class: 'h3p-row' }, P.steer, P.gyro));
    // en haut au centre : le coureur actif ; ◀ ▶ : le coéquipier le plus proche derrière ou devant
    const near = (dir) => (e) => { e.stopPropagation(); const n = T.nearRider(dir); if (n) T.switchRider(n.r.id); update(true); };
    P.prevL = h('small'); P.nextL = h('small');
    P.prev = btn('h3p-nav', 'Coéquipier le plus proche derrière', [icon(ICON.left), P.prevL], near(-1));
    P.next = btn('h3p-nav', 'Coéquipier le plus proche devant', [icon(ICON.right), P.nextL], near(1));
    P.tag = h('i', { class: 'h3p-tag' });
    P.name = h('strong', { class: 'h3p-name' });
    P.sub = h('span', { class: 'h3p-sub' });
    P.pw = h('b'); P.sp = h('b'); P.hr = h('b');
    P.heart = svgHeart();
    P.top = h('div', { class: 'h3p-top' }, P.prev,
      h('div', { class: 'h3p-mid' },
        h('div', { class: 'h3p-who' }, P.tag, P.name, P.sub),
        h('div', { class: 'h3p-stats' },
          h('span', { class: 'h3p-pw h3-w-power', title: 'Puissance' }, icon(ICON.bolt), P.pw, h('em', null, 'W')),
          h('span', { class: 'h3-w-speed', title: 'Vitesse' }, P.sp, h('em', null, 'km/h')),
          h('span', { class: 'h3p-hrbox h3-w-hr', title: 'Fréquence cardiaque' }, P.heart, P.hr))),
      P.next);
    P.warn = h('div', { class: 'h3p-warn', hidden: true });
    // en haut à droite (avec le menu) : la radio d'équipe, qui ouvre les actions du coureur actif
    P.radio = btn('h3-tool h3p-radio phone-only', 'Radio d\'équipe : les actions du coureur actif', [icon(ICON.radio)], (e) => { e.stopPropagation(); togglePop('acts'); });
    E.tools.prepend(P.radio);
    // en bas : Freiner (on le tient), l'effort, Accélérer (on le tapote)
    P.brake = h('button', { class: 'h3p-round h3p-brake', type: 'button', 'aria-label': 'Freiner (maintiens appuyé)' }, h('span', { class: 'in' }, icon(ICON.brake), 'FREINER'));
    const brake = (on) => (e) => {
      if (e.cancelable) e.preventDefault();
      if (on && !P.brake.classList.contains('on')) vibrate(20);
      PYR.steerInput.setBrakeButton(on); P.brake.classList.toggle('on', on);
    };
    P.brake.addEventListener('pointerdown', brake(true));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) P.brake.addEventListener(ev, brake(false));
    P.accel = h('button', { class: 'h3p-round h3p-accel', type: 'button', 'aria-label': 'Accélérer (tapote à répétition)' },
      h('span', { class: 'in' }, icon(ICON.accel), 'ACCÉLÉRER', h('small', null, 'tapote !')));
    P.accel.addEventListener('pointerdown', (e) => { if (e.cancelable) e.preventDefault(); T.sprintTap(); update(true); });
    P.fill = h('i', { class: 'h3-fill' });
    P.boost = h('i', { class: 'h3p-boost' });
    P.now = h('i', { class: 'h3-now' });
    P.track = h('div', { class: 'h3-track', role: 'slider', tabindex: '0', 'aria-label': 'Effort du coureur actif (% de la PC)', 'aria-valuemin': '0', 'aria-valuemax': String(PCT_MAX) },
      P.fill, P.boost, h('i', { class: 'h3-cp', style: `left:${(100 / PCT_MAX * 100).toFixed(2)}%` }), P.now);
    bindTrack({ get r() { return G.me; }, track: P.track });
    P.val = h('b', { class: 'h3-pct' }, '–');
    P.minus = h('button', { class: 'h3-step', type: 'button', 'aria-label': 'Effort −5 %', onclick: () => nudge(G.me, -PCT_STEP) }, icon(ICON.minus));
    P.plus = h('button', { class: 'h3-step', type: 'button', 'aria-label': 'Effort +5 %', onclick: () => nudge(G.me, PCT_STEP) }, icon(ICON.plus));
    P.draft = h('span', { class: 'h3p-draft h3-w-draft', title: 'Watts que tu n\'as pas à dépenser grâce à l\'aspiration' });
    P.aer = h('i'); P.ana = h('i');
    P.aerRow = h('div', { class: 'h3p-m h3p-aer', title: 'Aérobie : le glycogène (endurance). Manger la recharge.' }, h('span', null, 'Aérobie'), h('div', { class: 'h3-gauge' }, P.aer));
    P.anaRow = h('div', { class: 'h3p-m h3p-ana', title: 'Anaérobie : la réserve W′ (efforts au-dessus de 100 % de la PC)' }, h('span', null, 'Anaérobie'), h('div', { class: 'h3-gauge' }, P.ana));
    P.low = h('div', { class: 'h3p-low' },
      h('div', { class: 'h3p-effort' }, h('span', { class: 'h3-lbl' }, 'Effort'), P.minus, P.track, P.plus, P.val),
      h('div', { class: 'h3p-meters' }, P.draft, P.aerRow, P.anaRow));
    // fenêtres : l'équipe (à gauche), les actions (à droite)
    P.popTeam = h('div', { class: 'h3p-pop h3p-pop-team', hidden: true, role: 'dialog', 'aria-label': 'Ton équipe' });
    P.popActs = h('div', { class: 'h3p-pop h3p-pop-acts', hidden: true, role: 'dialog', 'aria-label': 'Actions du coureur actif' });
    P.edge = h('div', { class: 'h3p-edge', 'aria-hidden': 'true' });
    P.rotate = h('div', { class: 'h3p-rotate' }, icon(ICON.rotate), h('p', null, 'Tourne ton téléphone : la course se joue en paysage.'));
    P.root = h('div', { class: 'h3p' }, P.edge, P.tl, P.top, P.warn, P.low, P.brake, P.accel, P.popTeam, P.popActs, P.rotate);
    E.root.appendChild(P.root);
    // un toucher ailleurs ferme les fenêtres ; le premier toucher demande le plein écran et le paysage (quand le navigateur le permet)
    document.addEventListener('pointerdown', (e) => {
      if (S.mode !== 'phone') return;
      if (S.pop && !P.popTeam.contains(e.target) && !P.popActs.contains(e.target) && !P.teamBtn.contains(e.target) && !P.radio.contains(e.target)) togglePop(null);
      lockLandscape();
    }, true);
  }

  /** Plein écran et paysage, au premier toucher (un geste est nécessaire) ; sans effet si le navigateur ne le permet pas (iPhone). */
  function lockLandscape() {
    if (S.locked) return;
    S.locked = true;
    const el = document.documentElement;
    const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* refusé */ } };
    try {
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock, () => {});
      else lock();
    } catch (e) { /* refusé */ }
  }

  /** Ouvre la fenêtre 'team' ou 'acts' (une seule à la fois) ; null ou la même : ferme. */
  function togglePop(which) {
    S.pop = which && S.pop !== which ? which : null;
    P.popTeam.hidden = S.pop !== 'team';
    P.popActs.hidden = S.pop !== 'acts';
    P.teamBtn.setAttribute('aria-expanded', String(S.pop === 'team'));
    P.radio.setAttribute('aria-expanded', String(S.pop === 'acts'));
    if (S.pop) renderPops();
  }

  /** Contenu des fenêtres : l'équipe (un toucher pilote le coureur), les actions du coureur actif (une colonne). */
  function renderPops() {
    if (S.pop === 'team' && G.team) {
      D.clear(P.popTeam);
      P.popTeam.appendChild(h('div', { class: 'h3p-pophead' }, 'Ton équipe · touche un coureur pour le piloter'));
      for (const r of G.team.own) {
        const en = r.fuel ? Fu.status(r.fuel).energy : 0, w = U.clamp(r.st.wbal / Math.max(1, Sim.w0Of(r.ctx, r.st)), 0, 1);
        const ph = tint(h('span', { class: 'tg-photo h3-photo' }, initials(r.name)), r.color || G.team.teams[0].color);
        photo(ph, r.name);
        const p = S.pos.get(r.id);
        P.popTeam.appendChild(h('button', {
          class: 'h3p-rider' + (r === G.me ? ' on' : ''), type: 'button', disabled: r.finished ? true : undefined,
          onclick: () => { T.switchRider(r.id); togglePop(null); update(true); },
        }, ph, h('span', { class: 'h3p-rn' }, h('strong', null, r.name), h('small', null, [r.strat ? r.strat.label : '', p ? `${p}ᵉ` : '', r === G.me ? 'actif' : r.finished ? 'arrivé' : ''].filter(Boolean).join(' · '))),
        h('span', { class: 'h3p-minibars' }, h('i', { class: 'e', style: `width:${(en * 100).toFixed(0)}%` }), h('i', { class: 'w', style: `width:${(w * 100).toFixed(0)}%` }))));
      }
    } else if (S.pop === 'acts') {
      D.clear(P.popActs);
      const me = G.me, mode = me.tac.mode, lay = Tac.layersOf(me);
      P.popActs.appendChild(h('div', { class: 'h3p-pophead' }, `Radio : ${G.team ? me.name.split(' ')[0] : 'ton coureur'}`));
      for (const a of ACTIONS) {
        const on = a.id === 'relay' ? lay.relay : a.id === 'cover' ? lay.cover : a.id === 'follow' ? mode === 'follow' && !lay.cover && !lay.relay : a.id === mode;
        const extra = a.id === 'eat' && me.fuel ? `${Fu.count(me.fuel, 'gel') + Fu.count(me.fuel, 'bar')} en poche` : '';
        P.popActs.appendChild(h('button', {
          class: 'h3p-act' + (on ? ' on' : ''), type: 'button', title: a.help, disabled: me.finished || (a.id === 'eat' && !me.fuel) ? true : undefined,
          onclick: () => { T.act(a.id, me); togglePop(null); update(true); },
        }, icon(a.d), h('span', null, a.label), extra ? h('small', null, extra) : null));
      }
    }
  }

  /** Le téléphone, à chaque mise à jour du HUD. */
  function renderPhone(s) {
    const me = G.me;
    if (!s || !me) return;
    const team = !!G.team;
    // le coureur actif, sa place, ce qu'il fait
    P.name.textContent = team ? me.name : (store.state.rider.name || 'Toi');
    P.tag.style.background = me.color || (team ? G.team.teams[0].color : '#e8791d');
    const p = S.pos.get(me.id) || s.rank;
    const what = me.incident ? (me.incident.type === 'crash' ? 'chute !' : 'crevaison !') : G.auto ? 'pilote automatique' : (Tac.LABELS[me.tac.mode] || '');
    P.sub.textContent = [p && s.total ? `${p}ᵉ/${s.total}` : '', what].filter(Boolean).join(' · ');
    P.pw.textContent = fmt(s.p, 0);
    P.sp.textContent = fmt(s.v, 1);
    P.hr.textContent = Number.isFinite(s.hrBpm) ? fmt(s.hrBpm, 0) : '–';
    // ◀ ▶ : coéquipiers les plus proches (mode équipe)
    const b = team ? T.nearRider(-1) : null, a = team ? T.nearRider(1) : null;
    const short = (r) => String(r.name).split(/\s+/)[0];
    P.prev.hidden = P.next.hidden = !team;
    P.prev.disabled = !b; P.next.disabled = !a;
    const gap = (d, sign) => (Math.abs(d) < 0.5 ? '0 m' : `${sign}${fmt(Math.abs(d), 0)} m`);
    P.prevL.textContent = b ? `${short(b.r)} ${gap(b.d, '−')}` : '—';
    P.nextL.textContent = a ? `${short(a.r)} ${gap(a.d, '+')}` : '—';
    P.teamBtn.hidden = !team;
    // trajectoire
    const ok = T.steerable(), manual = ok && T.steerMode() === 'manual';
    P.steer.hidden = !ok;
    for (const x of P.steerBtns) x.setAttribute('aria-pressed', String(x.dataset.steer === T.steerMode()));
    P.gyro.hidden = !manual;
    P.gyro.setAttribute('aria-pressed', String(PYR.steerInput.tiltOn));
    P.warn.hidden = !S.steerWarn;
    if (S.steerWarn) P.warn.textContent = S.steerWarn;
    // effort : consigne, ce qu'ajoute Accélérer, puissance produite
    const set = T.pctOf(me), cur = T.pctNow(me), base = set === null ? cur : set;
    P.fill.style.width = (U.clamp(base / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    P.fill.classList.toggle('auto', set === null);
    const over = s.boost > 0 ? Math.max(0, cur - base) : 0;
    P.boost.style.left = (U.clamp(base / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    P.boost.style.width = (U.clamp(over / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    P.now.style.left = (U.clamp(cur / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    P.track.setAttribute('aria-valuenow', String(Math.round(base)));
    P.val.textContent = `${fmt(base, 0)} %`;
    P.val.classList.toggle('auto', set === null);
    // aspiration, aérobie, anaérobie
    const dr = Number(s.draft) || 0;
    P.draft.textContent = dr >= 3 ? `Aspiration −${fmt(dr, 0)} W` : 'Aspiration –';
    P.draft.classList.toggle('zero', dr < 3);
    P.aerRow.hidden = !s.fuel;
    if (s.fuel) { P.aer.style.width = (U.clamp(s.fuel.energy, 0, 1) * 100).toFixed(1) + '%'; P.aerRow.classList.toggle('low', s.fuel.energy < 0.2); }
    P.ana.style.width = (U.clamp(s.wf, 0, 1) * 100).toFixed(1) + '%';
    P.anaRow.classList.toggle('low', s.wf < 0.2);
    // Accélérer : l'anneau se remplit à chaque appui et se vide en une seconde
    P.accel.style.setProperty('--fill', (U.clamp(s.boost || 0, 0, 1) * 360).toFixed(0) + 'deg');
    // le cœur bat à la FC ; le bord de l'écran rougit quand l'anaérobie passe sous 40 % et bat avec lui
    const hr = Number.isFinite(s.hrBpm) && s.hrBpm > 30 ? s.hrBpm : 0;
    const beat = hr ? 60 / hr : 0;
    if (Math.abs(beat - S.beat) > 0.03 * Math.max(beat, 0.1)) { S.beat = beat; P.root.style.setProperty('--beat', (beat || 1).toFixed(3) + 's'); }
    P.heart.classList.toggle('beat', !!hr && !me.incident);
    const red = feelOn('redEdge') && !me.finished ? U.clamp((EDGE_FROM - s.wf) / EDGE_FROM, 0, 1) : 0;
    P.edge.style.setProperty('--edge', red.toFixed(2));
    P.edge.classList.toggle('on', red > 0.02);
    // pour les vibrations (vibeTick)
    const L = T.steerable() ? me.lat : null;
    S.feel.wf = s.wf; S.feel.hr = hr; S.feel.v = s.v;
    S.feel.zone = L && L.manual ? Steer.zone(L.y, Steer.edgeOf(G.ctx.course, me.st.s, L.edgeMax)) : 'road';
    const crash = !!(me.incident && me.incident.type === 'crash');
    if (crash && !S.feel.crash) vibrate([220, 80, 320]);
    S.feel.crash = crash;
    if (S.pop) renderPops();
  }

  /* ---------- sensations : vibrations (navigator.vibrate : Android ; rien sur iPhone) ---------- */
  const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const feelOn = (id) => prefs()[id] !== false;
  function vibrate(pattern) {
    if (S.mode !== 'phone' || !canVibrate() || !feelOn('vibe')) return;
    try { navigator.vibrate(pattern); } catch (e) { /* refusé (pas encore de geste sur la page) */ }
  }
  /** Toutes les 50 ms, sur téléphone : battement de cœur (anaérobie sous 20 %), grondement sur le bas-côté ou hors de la route. */
  function vibeTick() {
    if (S.mode !== 'phone' || !G || !G.running || G.finished || document.hidden) return;
    const f = S.feel, now = performance.now();
    if (f.zone !== 'road' && f.v > 7 && now >= S.rumbleAt) { vibrate(f.zone === 'out' ? 60 : 35); S.rumbleAt = now + (f.zone === 'out' ? 140 : 200); return; }
    if (f.wf < VIBE_FROM && f.hr > 0 && now >= S.beatAt) { vibrate([22, 110, 14]); S.beatAt = now + 60000 / f.hr; }
  }
  /** Réglages d'immersion pour la vue 3D (trame de view3d.js) : marqueurs des coéquipiers, respiration. */
  function fx() { return S.mode ? { mk: feelOn('markers'), br: feelOn('breath') } : null; }

  /** Vignette d'un coureur : identité, effort, endurance, effort court, actions. */
  function card(r) {
    const color = r.color || (G.team ? G.team.teams[0].color : null);
    const ph = tint(h('span', { class: 'tg-photo h3-photo' }, initials(r.name)), color);
    photo(ph, r.name);
    const c = { r };
    c.name = h('strong', { class: 'h3-name' }, r.name || 'Toi');
    c.place = h('span', { class: 'h3-place' });
    c.state = h('span', { class: 'h3-state' });
    c.badge = h('span', { class: 'h3-badge' }, 'piloté');
    // effort : barre de 0 à 150 % de la PC, crans de 5 % ; remplissage = consigne, trait = puissance produite
    c.fill = h('i', { class: 'h3-fill' });
    c.now = h('i', { class: 'h3-now' });
    c.track = h('div', {
      class: 'h3-track', role: 'slider', tabindex: '0', 'aria-label': `Effort de ${r.name || 'ton coureur'} (% de la PC)`,
      'aria-valuemin': '0', 'aria-valuemax': String(PCT_MAX), 'aria-valuenow': '0',
    }, c.fill, h('i', { class: 'h3-cp', style: `left:${(100 / PCT_MAX * 100).toFixed(2)}%`, title: '100 % : ta puissance critique' }), c.now);
    c.val = h('b', { class: 'h3-pct' }, '–');
    c.minus = h('button', { class: 'h3-step', type: 'button', 'aria-label': 'Effort −5 %', title: 'Effort −5 %', onclick: (e) => { e.stopPropagation(); nudge(r, -PCT_STEP); } }, icon(ICON.minus));
    c.plus = h('button', { class: 'h3-step', type: 'button', 'aria-label': 'Effort +5 %', title: 'Effort +5 %', onclick: (e) => { e.stopPropagation(); nudge(r, PCT_STEP); } }, icon(ICON.plus));
    bindTrack(c);
    c.endu = h('i');
    c.anaer = h('i');
    c.enduRow = h('div', { class: 'h3-meter h3-endu', title: 'Endurance : le glycogène (aérobie). Il baisse avec l\'effort ; à vide, c\'est la fringale. Manger le recharge.' }, h('span', null, 'Endurance'), h('div', { class: 'h3-gauge' }, c.endu));
    c.anaerRow = h('div', { class: 'h3-meter h3-anaer', title: 'Effort court : la réserve W′ (anaérobie). Elle se vide au-dessus de 100 % de la PC et se recharge en dessous.' }, h('span', null, 'Effort court'), h('div', { class: 'h3-gauge' }, c.anaer));
    c.btns = new Map();
    const acts = h('div', { class: 'h3-acts', role: 'toolbar', 'aria-label': `Actions de ${r.name || 'ton coureur'}` });
    for (const a of ACTIONS) {
      const b = h('button', { class: 'h3-act', type: 'button', 'data-act': a.id, 'aria-pressed': 'false', 'aria-label': a.label, title: `${a.label} — ${a.help}` }, icon(a.d), h('span', null, a.label));
      b.addEventListener('click', (e) => { e.stopPropagation(); T.act(a.id, r); update(true); });
      c.btns.set(a.id, b);
      acts.appendChild(b);
    }
    // équipier : rendre la main à la stratégie, ou le piloter (caméra et clavier)
    c.auto = h('button', { class: 'h3-mini', type: 'button', title: 'Rendre ce coureur à la stratégie de son rôle (ses propres décisions)', onclick: (e) => { e.stopPropagation(); T.act('auto', r); update(true); } }, icon(ICON.auto), 'Auto');
    c.pilot = h('button', { class: 'h3-mini', type: 'button', title: 'Piloter ce coureur : la caméra le suit, le clavier le commande', onclick: (e) => { e.stopPropagation(); T.switchRider(r.id); } }, icon(ICON.cam), 'Piloter');
    c.mates = h('div', { class: 'h3-mates' }, c.auto, c.pilot);
    // trajectoire (coureur piloté) : automatique ou manuelle
    c.steerBtns = STEERS.map((m) => h('button', {
      type: 'button', 'data-steer': m.id, 'aria-pressed': 'false', title: m.help,
      onclick: (e) => { e.stopPropagation(); T.setSteer(m.id); update(true); },
    }, m.label));
    c.steerRow = h('div', { class: 'h3-steer', role: 'group', 'aria-label': 'Trajectoire' }, h('span', { class: 'h3-lbl' }, 'Trajectoire'), h('div', { class: 'h3-seg' }, ...c.steerBtns));
    c.el = tint(h('article', { class: 'h3-card', 'data-id': r.id },
      h('header', { class: 'h3-head' }, ph, h('div', { class: 'h3-id' }, h('div', null, c.name, c.badge), c.state), c.place),
      h('div', { class: 'h3-effort' }, h('span', { class: 'h3-lbl' }, 'Effort'), c.minus, c.track, c.plus, c.val),
      c.enduRow, c.anaerRow, acts, c.steerRow, c.mates), color);
    return c;
  }

  /** Barre d'effort : toucher ou glisser (crans de 5 %), molette, flèches au clavier quand elle a le focus. */
  function bindTrack(c) {
    const t = c.track;
    let drag = false;
    const pick = (e) => {
      const b = t.getBoundingClientRect();
      T.setPct(snap5((e.clientX - b.left) / Math.max(1, b.width) * PCT_MAX), c.r);
      update(true);
    };
    t.addEventListener('pointerdown', (e) => { drag = true; t.setPointerCapture(e.pointerId); pick(e); e.preventDefault(); e.stopPropagation(); });
    t.addEventListener('pointermove', (e) => { if (drag) pick(e); });
    t.addEventListener('pointerup', () => { drag = false; });
    t.addEventListener('pointercancel', () => { drag = false; });
    t.addEventListener('wheel', (e) => { e.preventDefault(); nudge(c.r, e.deltaY < 0 ? PCT_STEP : -PCT_STEP); }, { passive: false });
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      nudge(c.r, d * (e.shiftKey ? 5 : 1) * PCT_STEP);
    });
  }

  function nudge(r, d) {
    const cur = T.pctOf(r);
    T.setPct(snap5((cur === null ? T.pctNow(r) : cur) + d), r);
    update(true);
  }

  /** (Re)construit les vignettes quand la liste des coureurs change (nouvelle course, autre équipe). */
  function ensureCards() {
    const list = riders();
    const key = list.map((r) => r.id).join('|') + '#' + (G.race ? G.race.seed : '');
    if (key === S.key) return;
    S.key = key;
    S.cards.clear();
    for (const r of list) S.cards.set(r.id, card(r));
    S.me = null;
    placeCards();
  }

  /** Range les vignettes : toutes en bas (grand écran), ou le coureur piloté sur la vue de course et ses équipiers sur la seconde vue. */
  function placeCards() {
    const paged = S.mode === 'phone' && S.cards.size > 1;
    E.root.classList.toggle('h3-paged', paged);
    E.root.classList.toggle('h3-team', S.cards.size > 1);
    D.clear(E.dock); D.clear(E.teamList);
    if (paged) {
      E.root.insertBefore(E.pager, E.dots);
      E.page1.appendChild(E.dock);
      E.dock.hidden = false;
    } else {
      E.pager.remove();
      E.root.insertBefore(E.dock, E.dots);
    }
    for (const c of S.cards.values()) {
      if (paged && c.r !== G.me) E.teamList.appendChild(c.el);
      else E.dock.appendChild(c.el);
    }
    S.me = G.me;
    renderDots();
  }

  function showPage(i) {
    S.page = i;
    E.pager.scrollTo({ left: i * E.pager.clientWidth, behavior: 'smooth' });
    renderDots();
  }
  function renderDots() {
    const paged = E.root.classList.contains('h3-paged');
    E.dots.hidden = !paged;
    [...E.dots.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === S.page)));
  }

  /* ---------- affichage ---------- */
  /** Applique les éléments masqués (ui.hud3d) : attribut lu par hud3d.css, y compris pour l'alerte (#hud-banner) hors du HUD. */
  function applyPrefs() {
    const p = prefs();
    document.body.dataset.h3Off = WIDGETS.filter((w) => p[w.id] === false).map((w) => w.id).join(' ');
  }

  function update(force) {
    if (!S.mode || !G || !G.me || !G.st) return;
    const now = performance.now();
    if (!force && now - S.at < UPDATE_MS) return;
    S.at = now;
    ensureCards();
    if (S.me !== G.me) placeCards();
    const s = T.snapshot();
    if (s) {
      E.power.v.textContent = fmt(s.p, 0);
      E.power.el.classList.toggle('cap', !!s.capped);
      E.speed.v.textContent = fmt(s.v, 1);
      E.hr.v.textContent = Number.isFinite(s.hrBpm) ? fmt(s.hrBpm, 0) : '–';
      E.grade.textContent = `${fmt(s.grade, 1)} %`;
      E.togo.textContent = `${fmt(s.rest / 1000, s.rest < 10000 ? 1 : 0)} km`;
      E.time.textContent = U.fmtClock(s.t);
    }
    mirror(E.next, $('#hud-next'));
    mirror(E.wx, $('#hud-wx'));
    if (s) { const dr = Number(s.draft) || 0; E.draft.hidden = dr < 3; if (dr >= 3) E.draft.textContent = `Aspiration −${fmt(dr, 0)} W`; }
    // téléphone : frein, gyroscope et classement se posent au-dessus de la vignette (sa hauteur change avec son contenu)
    if (S.mode === 'phone') E.root.style.setProperty('--h3-dock-h', E.dock.offsetHeight + 'px');
    renderSteer();
    if (now - S.rankAt > RANK_MS || force) { S.rankAt = now; renderRank(); }
    if (S.mode === 'phone') { renderPhone(s); return; }
    for (const c of S.cards.values()) renderCard(c);
  }

  /** Trajectoire : la puce du haut (mode, source des commandes, alertes de bas-côté et de virage trop rapide), frein et gyroscope (téléphone). */
  function renderSteer() {
    const me = G.me, ok = T.steerable(), L = ok ? me.lat : null, manual = !!(L && L.manual);
    E.drive.hidden = true; // (ancienne disposition du téléphone : le frein et le gyroscope sont maintenant dans buildPhone)
    E.steer.hidden = !ok;
    S.steerWarn = '';
    if (!ok) return;
    let text, warn = false;
    if (!manual) text = 'Trajectoire auto';
    else {
      const inp = G.steerIn || PYR.steerInput.read(0);
      text = `Trajectoire manuelle ${SRC_ICON[inp.source] || ''}`;
      const zn = Steer.zone(L.y, Steer.edgeOf(G.ctx.course, me.st.s, L.edgeMax));
      if (me.incident) text = 'Chute…';
      else if (zn !== 'road') { text = zn === 'verge' ? '⚠ Bas-côté : reviens sur la route !' : '⚠ Hors de la route !'; warn = true; }
      else if (Math.abs(L.drift || 0) > 0.3) { text = '⚠ Trop vite pour le virage : freine !'; warn = true; }
      else if (inp.brake > 0.05) text += ' · frein';
    }
    if (E.steer.textContent !== text) E.steer.textContent = text;
    E.steer.classList.toggle('warn', warn);
    if (warn) S.steerWarn = text;
    E.tiltBtn.setAttribute('aria-pressed', String(PYR.steerInput.tiltOn));
  }

  /** Recopie une puce de tab-game.js (prochain point, météo) : texte et visibilité. */
  function mirror(el, src) {
    const show = !!src && !src.hidden && !!src.textContent.trim();
    el.hidden = !show;
    if (show && el.textContent !== src.textContent) el.textContent = src.textContent;
  }

  function renderCard(c) {
    const r = c.r, piloted = r === G.me, out = !!r.finished;
    c.el.classList.toggle('is-me', piloted);
    c.el.classList.toggle('is-out', out);
    c.badge.hidden = !piloted || !G.team;
    c.mates.hidden = piloted || !G.team || out;
    c.steerRow.hidden = !piloted || out || !T.steerable();
    if (!c.steerRow.hidden) { const m = T.steerMode(); for (const b of c.steerBtns) b.setAttribute('aria-pressed', String(b.dataset.steer === m)); }
    c.auto.disabled = !r.order;
    c.auto.setAttribute('aria-pressed', String(!r.order));
    // effort : consigne (null : la tactique règle la puissance) et puissance produite, en % de la PC du coureur
    const set = T.pctOf(r), cur = T.pctNow(r);
    c.fill.style.width = (U.clamp((set === null ? cur : set) / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    c.fill.classList.toggle('auto', set === null);
    c.now.style.left = (U.clamp(cur / PCT_MAX, 0, 1) * 100).toFixed(1) + '%';
    c.track.setAttribute('aria-valuenow', String(Math.round(set === null ? cur : set)));
    c.val.textContent = out ? '–' : set === null ? `${fmt(cur, 0)} %` : `${fmt(set, 0)} %`;
    c.val.title = set === null ? 'Puissance produite (la tactique règle l\'effort)' : `Consigne : ${fmt(set, 0)} % de la PC (${fmt(set / 100 * r.ctx.cp, 0)} W)`;
    c.val.classList.toggle('auto', set === null);
    // endurance (glycogène) et effort court (W′)
    const en = r.fuel ? Fu.status(r.fuel) : null;
    c.enduRow.hidden = !en;
    if (en) {
      c.endu.style.width = (U.clamp(en.energy, 0, 1) * 100).toFixed(1) + '%';
      c.enduRow.classList.toggle('low', en.energy < 0.2);
    }
    const w = U.clamp(r.st.wbal / Math.max(1, Sim.w0Of(r.ctx, r.st)), 0, 1);
    c.anaer.style.width = (w * 100).toFixed(1) + '%';
    c.anaerRow.classList.toggle('low', w < 0.2);
    // action en cours
    const mode = r.tac.mode, lay = Tac.layersOf(r);
    for (const [id, b] of c.btns) {
      const pressed = (piloted || r.order) && (id === 'relay' ? lay.relay : id === 'cover' ? lay.cover : id === 'follow' ? mode === 'follow' && !lay.cover && !lay.relay : id === mode);
      b.setAttribute('aria-pressed', String(!!pressed));
      b.disabled = out || (id === 'eat' && !r.fuel);
    }
    let state = '', warn = false;
    if (out) state = `arrivé en ${U.fmtClock(r.time)}`;
    else if (r.incident) { state = r.incident.type === 'crash' ? 'chute !' : 'crevaison !'; warn = true; }
    else if (en && en.bonk) { state = 'fringale : mange !'; warn = true; }
    else if (piloted) state = G.auto ? 'pilote automatique' : Tac.describe(r, G.rules || {});
    else if (r.order) state = `ordre : ${Tac.LABELS[mode] || mode}`;
    else state = r.strat ? r.strat.label : Tac.LABELS[mode] || '';
    if (c.state.textContent !== state) { c.state.textContent = state; c.state.title = state; }
    c.state.classList.toggle('warn', warn);
  }

  /** Classement de l'étape : les cinq premiers, puis toi (et tes équipiers en mode équipe), avec l'écart sur la tête. */
  function renderRank() {
    const rows = T.boardRows ? T.boardRows() : [];
    D.clear(E.rankList);
    E.rank.hidden = rows.length < 2;
    if (rows.length < 2) return;
    // téléphone : les trois premiers et toi seulement (la place de tes équipiers est sur leur vignette)
    const phone = S.mode === 'phone';
    const lead = rows[0], mine = new Set(riders().map((r) => r.id));
    const mineRow = (x) => x.me || (!phone && mine.has(x.id));
    const gapOf = (x) => {
      if (x === lead) return lead.fin ? U.fmtClock(lead.time) : 'tête';
      if (x.fin && lead.fin) return '+' + U.fmtClock(Math.max(0, x.time - lead.time));
      if (x.fin) return U.fmtClock(x.time);
      return '+' + U.fmtClock(Math.max(0, lead.dt - x.dt));
    };
    // place de chaque coureur des vignettes
    const pos = S.pos = new Map(rows.map((x, i) => [x.me ? G.me.id : x.id, i + 1]));
    for (const c of S.cards.values()) { const p = pos.get(c.r.id); c.place.textContent = p ? `${p}ᵉ` : ''; }
    const show = new Set(rows.slice(0, phone ? 3 : 5));
    for (const x of rows) if (mineRow(x)) show.add(x);
    let prev = -1;
    rows.forEach((x, i) => {
      if (!show.has(x)) return;
      if (prev >= 0 && i > prev + 1) E.rankList.appendChild(h('li', { class: 'h3-gap', 'aria-hidden': 'true' }, '…'));
      prev = i;
      E.rankList.appendChild(h('li', { class: mineRow(x) ? 'mine' : null, value: String(i + 1) },
        h('span', { class: 'h3-r' }, String(i + 1)), tint(h('i', { class: 'h3-dot' }), x.color), h('span', { class: 'h3-n' }, x.me && !G.team ? 'Toi' : x.name), h('span', { class: 'h3-g' }, gapOf(x))));
    });
    E.rankHead.textContent = `Étape · ${rows.length} coureurs`;
  }

  /* ---------- menu (Échap) ---------- */
  /** Ouvre le menu sur l'onglet tab ('race', 'profile', 'classif', 'display', 'result'). La course est mise en pause, sauf en direct. */
  H.menu = function (tab) {
    if (!S.mode) return;
    if (S.pop) togglePop(null);
    if (S.menu && !S.menu.closed) { S.menu.close(); return; }
    S.pausedByMenu = false;
    if (G.running && !G.finished && G.mode !== 'live') { T.togglePause(); S.pausedByMenu = true; }
    const tabs = [
      { id: 'race', label: 'Course' }, { id: 'profile', label: 'Profil' }, { id: 'classif', label: 'Classements' }, { id: 'display', label: 'Affichage' },
    ];
    if (G.finished) tabs.unshift({ id: 'result', label: 'Résultat' });
    const seg = h('div', { class: 'seg-control h3-tabs', role: 'tablist' });
    const body = h('div', { class: 'h3-menu-body' });
    const panes = {};
    const open = (id) => {
      for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.tab === id));
      for (const k of Object.keys(panes)) panes[k].hidden = k !== id;
      if (id === 'profile' && G.chart) { // toute l'étape (la largeur choisie au zoom revient à la fermeture du menu)
        const z = G.chart.zoom;
        if (S.span === undefined) S.span = z.userSpan;
        z.manual = false; z.userSpan = 1; z.ensureVisible(z.lastF);
        setTimeout(() => G.chart.surface.request(), 30);
      }
    };
    for (const t of tabs) seg.appendChild(h('button', { type: 'button', role: 'tab', 'data-tab': t.id, onclick: () => open(t.id) }, t.label));
    panes.race = paneRace();
    panes.profile = h('div', { class: 'h3-pane h3-pane-profile' });
    panes.classif = h('div', { class: 'h3-pane' });
    panes.display = paneDisplay();
    if (G.finished) panes.result = h('div', { class: 'h3-pane' });
    for (const k of Object.keys(panes)) body.appendChild(panes[k]);
    // le profil de l'étape (le graphique de la page, qui suit le coureur) et les classements viennent dans le menu le temps qu'il est ouvert
    park($('.bottom-view[data-view="game"]'), panes.profile);
    park($('#game-classif'), panes.classif);
    if (panes.result) park($('#game-result'), panes.result);
    const actions = [];
    if (G.mode !== 'live') actions.push({ label: 'Recommencer', onClick: () => { T.reset(); T.start(); } });
    actions.push({ label: 'Choix de la partie', onClick: () => quitTo('game') });
    actions.push({ label: 'Quitter vers l\'accueil', danger: true, onClick: () => quitTo('home') });
    actions.push({ label: G.finished ? 'Fermer' : 'Reprendre', primary: true });
    S.menu = D.modal({
      title: G.finished ? 'Arrivée' : G.mode === 'live' ? 'Menu (la course continue)' : 'Pause',
      body: [seg, body], actions, wide: true,
      onClose: () => {
        if (S.span !== undefined && G.chart) { const z = G.chart.zoom; z.userSpan = S.span; z.ensureVisible(z.lastF); }
        S.span = undefined;
        unpark();
        S.menu = null;
        if (S.pausedByMenu && !G.running && !G.finished) T.togglePause();
        S.pausedByMenu = false;
        update(true);
      },
    });
    S.menu.el.classList.add('h3-menu');
    open(tab || (G.finished ? 'result' : 'race'));
  };

  function quitTo(page) {
    S.pausedByMenu = false; // on part : pas de reprise
    PYR.app.go(page);
  }

  /** Onglet « Course » : où l'on en est, et les touches. */
  function paneRace() {
    const s = T.snapshot();
    const lines = [];
    if (s) {
      lines.push(h('p', null, `${fmt(s.s / 1000, 1)} km parcourus, ${fmt(s.rest / 1000, 1)} km avant l'arrivée · ${U.fmtClock(s.t)} de course`));
      if (s.rank && s.total) lines.push(h('p', null, `${s.rank}ᵉ sur ${s.total}`));
    }
    const rules = G.rules || {};
    lines.push(h('p', { class: 'hint' }, rules.arcade
      ? 'Niveau Arcade : l\'effort, l\'endurance (glycogène) et l\'effort court (W′) ; ni chaleur, ni courbe de puissance record, ni hydratation.'
      : 'Niveau Simulation : le modèle complet de la page de choix.'));
    const k = (keys, what) => h('div', null, ...keys.map((x) => h('kbd', null, x)), ' ', what);
    if (S.mode !== 'phone') lines.push(h('div', { class: 'keys h3-keys' },
      k(['↑', '↓'], 'effort ±5 % (Maj : ±25 %)'), k(['1', '…', '5'], 'effort 55, 75, 90, 100, 120 %'), k(['0'], 'roue libre'),
      k(['U'], 'remonter en tête'), k(['6'], 'attaquer'), k(['S'], 'suivre les attaques'), k(['7'], 'accélérer (tapote)'),
      k(['T'], 'rouler en tête'), k(['9'], 'relais'), k(['8'], 'dans les roues'), k(['M'], 'manger'),
      G.team ? k(['N'], 'coureur suivant') : null, k(['C'], 'caméra'), k(['H'], 'masquer le HUD'), k(['P'], 'profil'),
      k(['V'], 'trajectoire auto ↔ manuelle'), k(['←', '→'], 'piloter (manuelle) ou changer de rang'), k(['F'], 'freiner'),
      k(['Espace'], 'pause'), k(['Échap'], 'menu')));
    if (S.mode !== 'phone') lines.push(h('div', { class: 'h3-padkeys' }, h('h4', null, 'Manette'), h('p', { class: 'hint' }, 'Stick gauche : trajectoire (manuelle) · gâchette gauche : frein · stick droit ↑ ↓ : effort · ' + PYR.steerInput.PAD_ACTIONS.map((a) => a.label).join(' · '))));
    return h('div', { class: 'h3-pane' }, ...lines);
  }

  /** Onglet « Affichage » : une case par élément du HUD. */
  function paneDisplay() {
    const p = prefs();
    const box = h('div', { class: 'field checks h3-display' });
    for (const w of WIDGETS) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = p[w.id] !== false;
      cb.addEventListener('change', () => {
        const next = Object.assign(prefs(), { [w.id]: cb.checked });
        store.set('ui.hud3d', next, true);
        applyPrefs();
        update(true);
      });
      box.appendChild(h('label', null, cb, ' ', w.label));
    }
    const feel = h('div', { class: 'field checks h3-display' });
    for (const w of FEEL) {
      if (w.id === 'vibe' && !canVibrate()) continue; // iPhone : pas de vibrations depuis une page web
      const cb = h('input', { type: 'checkbox' });
      cb.checked = p[w.id] !== false;
      cb.addEventListener('change', () => { store.set('ui.hud3d', Object.assign(prefs(), { [w.id]: cb.checked }), true); update(true); });
      feel.appendChild(h('label', null, cb, ' ', w.label));
    }
    return h('div', { class: 'h3-pane' }, h('p', { class: 'hint' }, 'Les éléments affichés par-dessus la vue 3D. La touche H masque ou affiche tout le HUD.'), box,
      h('h4', { class: 'h3-feel-head' }, 'Sensations'), feel);
  }

  /* ---------- clavier (tab-game.onKey le passe ici d'abord ; vrai si la touche est prise) ---------- */
  H.onKey = function (e) {
    if (!S.mode) return false;
    const k = e.key, kl = k.length === 1 ? k.toLowerCase() : k;
    const me = G.me;
    if (k === 'Escape') { H.menu(); return true; }
    if (kl === 'h') { document.body.toggleAttribute('data-h3-hidden'); return true; }
    if (kl === 'p') { H.menu('profile'); return true; }
    if (kl === 'c') { if (PYR.view3d) PYR.view3d.command('camera'); return true; }
    if (!me) return false;
    // trajectoire : V bascule automatique ↔ manuelle ; en manuelle, ← → et F se tiennent enfoncées (le relâchement : steer-input.js)
    if (T.steerable()) {
      if (kl === 'v') { T.toggleSteer(); update(true); return true; }
      if (kl === 'f' || (T.steerMode() === 'manual' && (k === 'ArrowLeft' || k === 'ArrowRight'))) { PYR.steerInput.key(k, e.code, true); return true; }
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') { nudge(me, (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 25 : PCT_STEP)); return true; }
    if (k === 'PageUp' || k === 'PageDown') { nudge(me, (k === 'PageUp' ? 25 : -25)); return true; }
    if (k === '0') { T.setPct(0, me); update(true); return true; }
    const n = '12345'.indexOf(k);
    if (n >= 0) { T.setPct(PRESETS[n], me); update(true); return true; }
    // 7 : Accélérer, à appuis répétés (l'effort monte au-delà de la barre, puis retombe sans appui)
    if (k === '7') { T.sprintTap(); update(true); return true; }
    const a = ACTIONS.find((x) => x.key && x.key.toLowerCase() === kl);
    if (a) { T.act(a.id, me); update(true); return true; }
    return false;
  };

  /* ---------- montage (game-mobile.js) ---------- */
  H.mount = function (mode) {
    S.mode = mode;
    S.key = '';
    S.page = 0;
    E.root.dataset.mode = mode;
    E.root.hidden = false;
    // boutons de la vue 3D (caméra, son, autre fenêtre) avec le menu, en haut à droite
    if (PYR.view3d) for (const b of PYR.view3d.buttons()) E.tools.appendChild(b);
    applyPrefs();
    ensureCards();
    placeCards();
    if (S.pop) togglePop(null);
    clearInterval(S.vibeTimer);
    S.vibeTimer = mode === 'phone' && canVibrate() ? setInterval(vibeTick, 50) : null;
    update(true);
  };

  H.unmount = function () {
    if (S.menu && !S.menu.closed) S.menu.close();
    S.mode = null;
    E.root.hidden = true;
    clearInterval(S.vibeTimer); S.vibeTimer = null;
    document.body.removeAttribute('data-h3-hidden');
  };
  H.fx = fx;

  H.update = (s) => update(false);
  /** Effort du coureur piloté ±d % (manette). */
  H.effort = (d) => { if (S.mode && G.me) nudge(G.me, d); };
  H.refresh = () => update(true);

  /** Arrivée : le menu s'ouvre sur le résultat (Rejouer, Quitter). */
  H.finished = function () {
    if (S.menu && !S.menu.closed) S.menu.close();
    setTimeout(() => H.menu('result'), 400);
  };

  /** Liens de la carte de départ (avant la course, sans entête : retour à la page de choix ou à l'accueil). */
  function lobbyLinks() {
    const panel = $('.side .panel[data-panel="game"]');
    if (!panel || panel.querySelector('.h3-lobby-nav')) return;
    const root = PYR.root || '../';
    panel.prepend(h('nav', { class: 'h3-lobby-nav', 'aria-label': 'Navigation' },
      h('a', { class: 'btn ghost small', href: 'index.html' }, '← Choix de la partie'),
      h('a', { class: 'btn ghost small', href: root + 'index.html' }, 'Accueil')));
  }

  H.init = function () {
    if (!on() || E.root) return;
    T = PYR.tabGame;
    G = T.state;
    build();
    lobbyLinks();
    applyPrefs();
  };

  H.STEERS = STEERS;
  H.WIDGETS = WIDGETS;
  H.ACTIONS = ACTIONS;
  H.PCT_MAX = PCT_MAX;
  H.PCT_STEP = PCT_STEP;
  H.PRESETS = PRESETS;
  PYR.hud3d = H;
})(globalThis.PYR = globalThis.PYR || {});
