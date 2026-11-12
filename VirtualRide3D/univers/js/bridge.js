/* Bike3D — vue 3D pilotée par PaceYourRide (index.html?pyr).
   PaceYourRide simule la course (physiologie, météo réelle, aspiration, coureurs virtuels, joueurs en direct) ;
   Bike3D ne fait plus que la montrer : il construit le paysage autour du parcours reçu et place chaque coureur là où
   la simulation le met. La page est ouverte dans un cadre (iframe) par-dessus la carte de l'écran de course VirtualRide3D/, ou dans une
   fenêtre à part (second écran, devant le home-trainer) ; les deux échangent des messages (postMessage) :

   PaceYourRide → Bike3D (tous les messages portent pyr3d: 1)
     course : {quality ('low' | 'medium' | 'high' : qualité du paysage), detail ('auto' | 'simple' | 'detailed' | 'realistic' : détail des cyclistes),
                relief ('procedural' : relief inventé | 'real' : relief réel, celui de la carte autour du parcours, voir B3D.Dem),  key (empreinte : on ne reconstruit que si elle change), name, seed (même graine pour tous les joueurs
                d'une course en direct : même paysage), lat[], lng[], ele[] (points du parcours, m), length (m),
                cps : [{type: 'sprint' | 'kom' | 'finish', s, start (pied d'une côte), cat ('hc', '1'…'4')}],
                feed : [{s, end}] (zones de ravitaillement), me : {name, color, gear (équipement du joueur : voir gear)},
                surfaces : [{s, end, kind ('smooth' | 'asphalt' | 'rough' | 'cobbles' | 'cobbles_hard' | 'gravel_hard' |
                'gravel_loose' | 'dirt' | 'wet' | 'grass'), w (largeur, m)}] (portions de revêtement), roadW (largeur hors portions, m) }
     frame  : { t (temps de course, s), k (secondes de course par seconde réelle : ×1 … ×50), run (la course avance),
                me (identifiant du joueur), riders : [{id, name, color, sex ('m' | 'f' ; absent : celui du joueur), kind ('avatar' | 'trainer' | 'road' | 'bot' | 'ghost'),
                s (m depuis le départ), y (m, + à droite ; absent : file unique), v (m/s), P (W), w (W′ restant, 0–1),
                dr (abri : part de la traînée économisée), st (arrêté), fin (arrivé)}],
                env : {hour (heure locale, si la météo est connue), T (°C), rain (mm/h), ws (m/s), wd (° d'où vient le vent)} }
     gear   : { gear : {frame, wheels, tire, position, helmet, clothing, glasses, socks, shoes, sex} } (vélo et tenue du joueur, ceux de
                la vitrine du magasin, voir B3D.Cyclist.GEAR ; un nouvel équipement change le cycliste sans reconstruire le paysage)
     cmd    : { cmd: 'camera' | 'sound' | 'reroll' | 'hud', on }
   Bike3D → PaceYourRide
     hello  : la vue est prête à recevoir le parcours (renvoyé chaque seconde tant qu'il n'est pas arrivé)
     status : { state: 'building' | 'ready' | 'error', seed, text, cam, sound }
     key    : { key, code, shift } (touches renvoyées au mode jeu quand la vue a le focus ; C change de caméra ici) */
(function (root) {
  'use strict';
  const B3D = root.B3D = root.B3D || {};
  const { clamp, lerp, hashString } = B3D.util;
  const $ = (id) => document.getElementById(id);

  const V = 1;                    // version du protocole
  const MAX_AGE = 0.3;            // s réelles : au-delà, on ne prolonge plus le mouvement depuis la dernière image reçue
  const SNAP = 40;                // m : saut plus grand (reprise, nouveau départ) : on se place directement
  const LANES = [0, 0.75, -0.75, 1.5, -1.5, 2.2, -2.2]; // voies des coureurs sans position latérale (file unique côté simulation)
  const KIND_ICON = { avatar: '🎮 ', trainer: '🏠 ', road: '🚴 ', bot: '', ghost: '👻 ' };
  const KIND_LABEL = { avatar: 'avatar', trainer: 'home-trainer', road: 'sur la route' };
  const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

  function wanted() { return /[?&]pyr(=|&|$)/.test(location.search); }

  // Voies pour les coureurs dont la simulation ne donne pas la position latérale : chacun garde la sienne tant qu'elle
  // est libre, sinon prend la plus proche où personne ne roule à moins de 1,9 m devant ou derrière, sur la largeur de la
  // chaussée là où il est (o.half) ; sur un chemin trop étroit, on roule en file au milieu.
  function assignLanes(list) {
    const placed = [];
    list.sort((a, b) => b.sT - a.sT);
    for (const o of list) {
      const cur = o.laneT === undefined ? 0 : o.laneT;
      const lim = Math.max(0, o.half - 0.4);
      let best = null, bestC = Infinity, any = 0, anyC = Infinity;
      for (const ln of LANES) {
        if (Math.abs(ln) > lim) continue;
        const c = Math.abs(ln - cur) + Math.abs(ln) * 0.15;
        if (c < anyC) { anyC = c; any = ln; }
        let busy = false;
        for (const p of placed) if (Math.abs(p.sT - o.sT) < 1.9 && Math.abs(p.laneT - ln) < 0.6) { busy = true; break; }
        if (busy) continue;
        if (c < bestC) { bestC = c; best = ln; }
      }
      o.laneT = best === null ? any : best;
      placed.push(o);
    }
  }

  const Bridge = {
    wanted,
    game: null,
    hostWin: null,
    embedded: false,
    timeK: 0,       // secondes de course par seconde réelle (0 : course arrêtée)
    fr: null,       // dernière image reçue
    frAt: 0,        // heure de réception (ms, horloge locale)
    key: null,      // empreinte du parcours affiché
    ready: false,

    attach(game) {
      this.game = game;
      game.ext = this;
      document.body.classList.add('pyr');
      this.embedded = window.parent !== window;
      this.hostWin = this.embedded ? window.parent : window.opener;
      // HUD de la vue : dans une fenêtre à part (second écran), pas dans le cadre où le mode jeu affiche déjà le sien
      this.hudOn = /[?&]hud=1/.test(location.search) || !this.embedded;
      game.hide('screen-menu');
      game.show('screen-loading');
      game.setLoading(0, 'En attente du parcours de Wattlas…');
      window.addEventListener('message', (e) => this.onMessage(e));
      window.addEventListener('keydown', (e) => this.onKey(e), true);
      window.addEventListener('keyup', (e) => this.onKeyUp(e), true);
      this.buildVR();
      // le son ne démarre qu'après un geste (règle des navigateurs) ; une touche brève sur la vue change de caméra
      let down = null;
      window.addEventListener('pointerdown', (e) => {
        if (this.soundOn) game.sound.start();
        down = e.target === game.renderer.domElement ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
      });
      window.addEventListener('pointerup', (e) => {
        if (!down || !this.ready) return;
        const tap = performance.now() - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
        down = null;
        if (tap) this.camera();
      });
      this.soundOn = !this.embedded;
      game.sound.setMuted(!this.soundOn);
      this.buildHud();
      if (!this.hostWin) {
        game.setLoading(0, 'Cette vue s\'ouvre depuis l\'écran de course de Course 3D (page Jeu, « Univers 3D »).');
        return;
      }
      // l'application n'écoute peut-être pas encore : on se signale chaque seconde jusqu'à recevoir le parcours
      const hello = () => { if (!this.key) { this.post({ type: 'hello' }); setTimeout(hello, 1000); } };
      hello();
    },

    // caméra suivante (poursuite, large, TV, vue cycliste, drone), annoncée brièvement
    camera() {
      const g = this.game;
      g.cycleCamera();
      g.toast('🎥 ' + g.cameraName(), 1100);
      this.status();
    },

    fail(text) {
      this.post({ type: 'status', state: 'error', text });
      const g = this.game;
      if (g) { g.show('screen-loading'); g.setLoading(0, '⚠️ ' + text); }
    },

    post(msg) {
      if (!this.hostWin) return;
      try { this.hostWin.postMessage(Object.assign({ pyr3d: V }, msg), '*'); } catch (e) { /* fenêtre fermée */ }
    },

    status(extra) {
      const g = this.game;
      this.post(Object.assign({ type: 'status', state: this.ready ? 'ready' : 'building', seed: g.seed, cam: g.camIndex, sound: this.soundOn, vr: !!(g.vr && g.vr.supported) }, extra || {}));
    },

    onMessage(e) {
      const m = e.data;
      if (!m || m.pyr3d !== V || typeof m.type !== 'string') return;
      if (this.hostWin && e.source !== this.hostWin) return; // seule l'application qui nous a ouverts pilote la vue
      if (m.type === 'course') this.onCourse(m);
      else if (m.type === 'frame') this.onFrame(m);
      else if (m.type === 'gear') this.setGear(m.gear);
      else if (m.type === 'cmd') this.onCmd(m);
    },

    onCmd(m) {
      const g = this.game;
      if (m.cmd === 'camera') { if (this.ready) this.camera(); }
      else if (m.cmd === 'sound') {
        this.soundOn = m.on === undefined ? !this.soundOn : !!m.on;
        if (this.soundOn) g.sound.start();
        g.sound.setMuted(!this.soundOn);
        if (!this.soundOn) g.sound.silence();
      } else if (m.cmd === 'reroll') {
        // autre paysage autour du même parcours (pour soi : les autres joueurs gardent le leur)
        if (this.course && !g.building) this.build(this.course, (this.seed + 7919) % 1000000);
      } else if (m.cmd === 'vr') {
        // casque demandé depuis le menu de Course 3D : essai direct ; si le navigateur veut un geste dans ce cadre, une carte le demande
        if (this.ready && g.vr && g.vr.supported && !g.vr.presenting) g.vr.enter({ quiet: true }).then((ok) => { if (!ok) this.armVR(true); });
      } else if (m.cmd === 'hud') {
        this.hudOn = m.on === undefined ? !this.hudOn : !!m.on;
        this.hud.classList.toggle('hidden', !this.hudOn || !this.ready);
      }
      this.status();
    },

    // ------------------------------------------------------------ parcours et monde
    onCourse(m) {
      if (!Array.isArray(m.lat) || !Array.isArray(m.lng) || m.lat.length < 2 || m.lat.length !== m.lng.length) {
        this.fail('Parcours reçu illisible.');
        return;
      }
      // qualité du parcours et détail des cyclistes choisis dans PaceYourRide (sans toucher aux réglages enregistrés de la vue seule)
      const g0 = this.game, st = g0.settings;
      if (B3D.TileManager.QUALITY[m.quality] && m.quality !== st.quality) { st.quality = m.quality; if (g0.renderer) g0.applyQuality(); }
      if (m.detail === 'auto' || (B3D.Cyclist.DETAILS || []).includes(m.detail)) st.riderDetail = m.detail;
      if (m.relief === 'real' || m.relief === 'procedural') st.relief = m.relief;
      if (m.key && m.key === this.key) { this.setGear(m.me && m.me.gear); return; }
      if (this.game.building) { this.pending = m; return; } // on attend la fin de la génération en cours
      this.key = m.key || String(Date.now());
      const seed = (num(m.seed, hashString(this.key)) >>> 0) % 1000000;
      this.build(m, seed);
    },

    build(m, seed) {
      const g = this.game;
      const ele = Array.isArray(m.ele) ? m.ele : [];
      const points = m.lat.map((lat, i) => ({ lat: +lat, lon: +m.lng[i], ele: Number.isFinite(+ele[i]) && ele[i] !== null ? +ele[i] : null }));
      let route;
      try { route = new B3D.Route({ name: String(m.name || 'Parcours Wattlas').slice(0, 80), points }); } catch (err) { this.fail(err.message); return; }
      this.course = m;
      this.seed = seed;
      this.pyrLen = num(m.length, 0) > 0 ? m.length : route.length;
      this.kS = route.length / this.pyrLen; // les deux tracés sont lissés différemment : on se repère en proportion
      this.ready = false;
      this.skyApplied = null;       // le ciel du nouveau paysage reprend les réglages du joueur
      this.me = m.me || {};
      this.gearLate = false;
      this.setGear(this.me.gear, true);
      this.hud.classList.add('hidden');
      if (g.peloton) { g.peloton.dispose(); g.peloton = null; }
      this.castKey = null;
      g.route = route;
      g.state = 'menu';
      g.show('screen-loading');
      this.status();
      g.buildWorld(seed, route.sStart + Math.min(200, route.length * 0.1));
    },

    // abscisse Bike3D d'une distance de PaceYourRide
    toS(s) { return this.game.route.toS(clamp(s, 0, this.pyrLen) * this.kS); },

    // maillot du joueur : sa couleur dans PaceYourRide
    jersey() {
      const c = this.me && /^#[0-9a-f]{6}$/i.test(this.me.color) ? this.me.color : '#eb6834';
      return { name: 'PaceYourRide', base: c, accent: '#1d1a2b', style: 'stripe' };
    },

    // équipement du joueur (vélo, roues, position, tenue) ; build : le monde va être construit avec
    setGear(g, build) {
      if (!g || typeof g !== 'object' || Array.isArray(g)) return;
      const key = JSON.stringify(B3D.Cyclist.normGear(g));
      if (key === this.gearKey) return;
      this.gearKey = key;
      this.gearObj = g;
      if (build) return;
      if (this.ready && !this.game.building) this.game.swapCyclist();
      else this.gearLate = true; // reçu pendant la construction : on change de cycliste une fois le monde prêt
    },

    gear() { return this.gearObj || null; },

    onLandscape(L) {
      const m = this.course, cps = Array.isArray(m.cps) ? m.cps : [];
      const cat = (c) => (c === 'hc' ? 0 : clamp(parseInt(c, 10) || 4, 1, 4));
      L.extPoints = {
        sprints: cps.filter((c) => c && c.type === 'sprint').map((c) => this.toS(num(c.s, 0))),
        koms: cps.filter((c) => c && c.type === 'kom').map((c) => ({ s0: this.toS(num(c.start, num(c.s, 0) - 1000)), s1: this.toS(num(c.s, 0)), cat: cat(c.cat) })),
        feeds: (Array.isArray(m.feed) ? m.feed : []).filter((z) => z && z.end > z.s).map((z) => ({ s0: this.toS(z.s), s1: this.toS(z.end) }))
      };
      // revêtements (portions de PaceYourRide) : rang du revêtement et demi-largeur de la chaussée à chaque échantillon de la route ;
      // la plateforme garde sa largeur (6 m), une chaussée plus étroite a des bas-côtés, une plus large est dessinée à 6 m
      const route = this.game.route, n = route.n, sp = route.spacing, ids = B3D.road.SURFACE_IDS;
      const hw = (w, d) => clamp(num(w, d * 2) / 2, 0.9, L.roadHalf);
      const def = hw(m.roadW, L.roadHalf);
      L.surf = new Uint8Array(n);
      L.surfHalf = new Float32Array(n).fill(def);
      for (const p of Array.isArray(m.surfaces) ? m.surfaces : []) {
        const k = p ? ids.indexOf(p.kind) : -1;
        if (k < 0 || !(num(p.end, 0) > num(p.s, 0))) continue;
        const a = this.toS(p.s), b = this.toS(p.end), h = hw(p.w, def);
        for (let i = Math.max(0, Math.floor(a / sp) - 1); i < n && (i + 0.5) * sp < b; i++) {
          if ((i + 0.5) * sp < a) continue;
          L.surf[i] = k; L.surfHalf[i] = h;
        }
      }
    },

    // demi-largeur de la chaussée à l'abscisse s (Bike3D)
    halfAt(s) {
      const g = this.game, L = g.L, route = g.route;
      if (!L || !L.surfHalf) return L ? L.roadHalf : 3;
      const i = clamp(Math.round(s / route.spacing), 0, route.n - 1);
      return L.bridgeMask[i] ? L.roadHalf : L.surfHalf[i];
    },

    onWorldReady() {
      const g = this.game, route = g.route;
      g.ride = {
        s: route.sStart, lat: 0, latV: 0, v: 0, effort: 0, target: 0, braking: false,
        reserve: 1, bonk: false, draft: 0, msg: null,
        time: 0, maxV: 0, flamme: false, crowd: 0, standing: false, tuck: false,
        villagesSeen: new Set(), lastStrokes: 0, mooT: 1.5, bellT: 0, cowCheck: 0, cow: null, finishT: 0
      };
      g._rs = route.sample(g.ride.s, {});
      g.playerProxy = { isPlayer: true, s: g.ride.s, lat: 0, v: 0, done: false, state: 'player', name: this.me.name || 'Toi' };
      if (g.convoy) g.convoy.reset(null, g.playerProxy);
      g.camState = null;
      if (this.gearLate) { this.gearLate = false; g.swapCyclist(); }
      g.placeCyclistAtStart();
      // l'heure et le temps suivent la course de PaceYourRide (météo réelle si elle est connue)
      if (g.atmo) { g.atmo.setFlow(0); this.baseHour = g.atmo.hour; g.atmo.setWeather(g.atmo.state); }
      this.finished = false;
      this.envSet = false;
      this.sector = null;
      this.ready = true;
      g.state = 'pyr';
      this.hud.classList.toggle('hidden', !this.hudOn);
      this.status(g.reliefNote ? { text: g.reliefNote } : null);
      if (g.reliefNote) g.toast('⛰️ ' + g.reliefNote, 4000); // relief réel demandé mais indisponible : relief inventé
      if (this.pending) { const p = this.pending; this.pending = null; this.onCourse(p); }
    },

    // ------------------------------------------------------------ positions
    onFrame(m) {
      if (!Array.isArray(m.riders)) return;
      this.fr = m;
      this.frAt = performance.now();
      this.timeK = m.run ? clamp(num(m.k, 1), 0, 100) : 0;
      if (m.sky && typeof m.sky === 'object') { this.sky = m.sky; this.skyApplied = null; }       // réglages « Ciel et Météo » de la page Jeu (nouveaux ou changés)
    },

    // appelée par la boucle de Bike3D (état « pyr »)
    frame(dt) {
      const g = this.game;
      g.updateRide(dt);
      this.applyEnv(dt);
      if (this.hudOn) this.updateHud();
      this.pollPad();
      this.watchVR();
      g.sound.breathe(dt, this.breathOf());
    },

    // ------------------------------------------------------------ Course 3D : immersion
    // Respiration du coureur piloté : rythme d'après sa FC et son effort, halètement quand sa réserve anaérobie (W′) se vide.
    breathOf() {
      const F = this.fr;
      if (!F || !F.fx || !F.fx.br || !this.timeK) return null;
      const me = F.riders.find((o) => o.id === F.me);
      if (!me || me.st || me.fin || num(me.v, 0) < 1) return null;
      const hr = num(me.hr, 0), eff = clamp(num(me.P, 0) / this.cpW(), 0, 1.4), w = clamp(num(me.w, 1), 0, 1);
      const byHr = hr > 0 ? clamp((hr - 70) / (185 - 70), 0, 1) : clamp(eff / 1.2, 0, 1);
      const pant = clamp((0.4 - w) / 0.4, 0, 1);
      return { rate: 15 + 35 * Math.max(byHr, eff / 1.4, pant * 0.9), level: clamp(0.25 + 0.55 * eff + 0.3 * pant, 0, 1), pant };
    },

    // après la caméra, à chaque image : ce qui se place d'après elle
    overlay() {
      this.drawGuide();
      this.marks();
    },

    // Aide à la trajectoire (trajectoire manuelle) : des chevrons posés sur la route le long de la corde, tous les 4 m sur 80 m, colorés
    // d'après ta vitesse et la vitesse conseillée (vert : ça passe ; jaune, orange, rouge : ralentis, freine) ; « Virage N km/h » au-dessus
    // du virage annoncé. La trame porte {s0, pts : [d, y, v], corner : [d, v]} (steer.guide, calculé 5 fois par seconde).
    drawGuide() {
      const g = this.game, F = this.fr, G = F && F.guide;
      const meO = F ? F.riders.find((o) => o.id === F.me) : null;
      const on = !!(G && meO && this.ready && Array.isArray(G.pts) && G.pts.length && !meO.st && !meO.fin);
      if (!on) { if (this.gd) { this.gd.mesh.visible = false; this.gd.label.hidden = true; } return; }
      if (!this.gd) {
        const sh = new THREE.Shape();
        // chevron allongé, pointe vers l'avant (+y du dessin, +z après rotation) : 1,6 m de large, 2,8 m de long. La caméra de poursuite
        // voit la route de très bas : la longueur s'écrase, la largeur reste ; plus petit, il ne serait qu'un trait
        sh.moveTo(0, 1.8); sh.lineTo(0.8, 0.3); sh.lineTo(0.8, -1.0); sh.lineTo(0, 0.6); sh.lineTo(-0.8, -1.0); sh.lineTo(-0.8, 0.3); sh.closePath();
        const geo = new THREE.ShapeGeometry(sh);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
        const mesh = new THREE.InstancedMesh(geo, mat, 24);
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const label = document.createElement('div');
        label.className = 'pyr-turn';
        label.hidden = true;
        document.body.appendChild(label);
        this.gd = { mesh, label, o: new THREE.Object3D(), c: new THREE.Color(), q: {}, v: new THREE.Vector3() };
      }
      const D = this.gd, mesh = D.mesh, route = g.route, q = D.q, o = D.o;
      if (mesh.parent !== g.scene) g.scene.add(mesh);
      mesh.visible = true;
      const vNow = Math.max(0, num(meO.v, 0)), sNow = num(meO.s, 0), pts = G.pts, s0 = num(G.s0, 0);
      // couleur d'après le rapport vitesse / vitesse conseillée : vert sous 90 %, rouge au-delà de 115 %
      const tint = (vAdv) => { const t = clamp((vNow / Math.max(1, vAdv) - 0.9) / 0.25, 0, 1); return D.c.setHSL(0.33 * (1 - t), 1, 0.55 - 0.07 * t); };
      let n = 0;
      for (let i = 0; i < pts.length && n < mesh.count; i++) {
        const [d, y, v] = pts[i], s = s0 + d;
        if (s < sNow + 2.5) continue; // sous le coureur ou déjà dépassé
        const p = pts[i - 1] || pts[i], nx = pts[i + 1] || pts[i];
        const slope = (nx[0] - p[0]) > 0 ? (nx[1] - p[1]) / (nx[0] - p[0]) : 0;
        route.sample(this.toS(s), q);
        o.position.set(q.x + q.rx * y, q.y + 0.12, q.z + q.rz * y); // au-dessus de la chaussée (bombée), comme les marquages peints
        o.rotation.set(-Math.atan(q.grade || 0), Math.atan2(q.tx + q.rx * slope, q.tz + q.rz * slope), 0, 'YXZ');
        o.scale.setScalar(1);
        o.updateMatrix();
        mesh.setMatrixAt(n, o.matrix);
        mesh.setColorAt(n, tint(v));
        n++;
      }
      // les chevrons inutilisés : à l'échelle zéro
      o.scale.setScalar(0); o.updateMatrix();
      for (let i = n; i < mesh.count; i++) mesh.setMatrixAt(i, o.matrix);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // « Virage N km/h » au-dessus du virage annoncé (pas en VR)
      const L = D.label, c = G.corner;
      const cs = c ? s0 + c[0] : 0;
      if (!c || cs < sNow - 5 || (g.vr && g.vr.presenting)) { L.hidden = true; return; }
      const near = pts.reduce((a, p) => (Math.abs(s0 + p[0] - cs) < Math.abs(s0 + a[0] - cs) ? p : a), pts[0]);
      route.sample(this.toS(cs), q);
      const v = D.v.set(q.x + q.rx * near[1], q.y + 1.2, q.z + q.rz * near[1]).project(g.camera);
      if (!(v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1)) { L.hidden = true; return; }
      L.hidden = false;
      // « freine ! » : quand tu vas déjà plus vite que la vitesse conseillée là où tu es (le premier chevron devant toi)
      const ahead = pts.find((p) => s0 + p[0] >= sNow + 1.5) || pts[pts.length - 1];
      const kmh = Math.round(c[1] * 3.6), fast = vNow > ahead[2] * 1.03;
      const text = 'Virage ' + kmh + ' km/h' + (fast ? ' · freine !' : '');
      if (L.textContent !== text) L.textContent = text;
      L.classList.toggle('fast', fast);
      L.style.transform = 'translate(' + ((v.x + 1) / 2 * window.innerWidth).toFixed(1) + 'px,' + ((1 - v.y) / 2 * window.innerHeight).toFixed(1) + 'px) translate(-50%, -100%)';
    },

    // Marqueurs des coéquipiers (mode équipe) au-dessus de leur tête : losange aux couleurs de l'équipe, initiales, aérobie et anaérobie ;
    // le coureur piloté en jaune. Un toucher fait piloter ce coureur (message « pick »). Appelée après la caméra, à chaque image.
    marks() {
      const g = this.game, F = this.fr;
      const on = !!(F && F.fx && F.fx.mk && this.ready && !(g.vr && g.vr.presenting) && F.riders.some((o) => o.own && o.id !== F.me));
      if (!on) { if (this.mk) this.mk.layer.hidden = true; return; }
      if (!this.mk) {
        const layer = document.createElement('div');
        layer.className = 'pyr-marks';
        document.body.appendChild(layer);
        this.mk = { layer, els: new Map(), v: new THREE.Vector3() };
      }
      const M = this.mk, P = g.peloton, cam = g.camera, W = window.innerWidth, H = window.innerHeight;
      M.layer.hidden = false;
      const pos = new Map();
      if (P) P.riders.forEach((r) => { if (r.pid !== undefined && r.pos) pos.set(r.pid, r.pos); });
      pos.set(F.me, g.cyclist.root.position);
      const seen = new Set(), placed = [];
      for (const o of F.riders) {
        if (!o.own) continue;
        const p = pos.get(o.id);
        if (!p) continue;
        seen.add(o.id);
        let el = M.els.get(o.id);
        if (!el) {
          el = document.createElement('button');
          el.type = 'button';
          el.className = 'pyr-mark';
          el.innerHTML = '<i class="d"></i><b></b><span class="bars"><i class="e"></i><i class="w"></i></span>';
          el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.post({ type: 'pick', id: el.dataset.id }); });
          M.layer.appendChild(el);
          M.els.set(o.id, el);
          el.dataset.id = o.id;
          el.querySelector('b').textContent = String(o.name || '?').split(/\s+/).filter(Boolean).map((x) => x[0]).slice(-2).join('').toUpperCase();
          el.title = 'Piloter ' + String(o.name || 'ce coureur');
          el.setAttribute('aria-label', el.title);
        }
        const act = o.id === F.me;
        const dist = p.distanceTo(cam.position);
        const v = M.v.copy(p);
        v.y += act ? 2.25 : 2.05;
        v.project(cam);
        const vis = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05 && dist < 160 && !(act && dist < 4);
        el.hidden = !vis;
        if (!vis) continue;
        const k = clamp(1.2 - dist / 70, 0.55, 1.1); // plus petit au loin
        placed.push({ el, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, k, dist });
        el.style.setProperty('--tc', o.color || '#d4202c');
        el.classList.toggle('act', act);
        el.classList.toggle('out', !!(o.st || o.fin));
        el.style.zIndex = String(1000 - Math.round(dist));
        el.querySelector('.e').style.width = (clamp(num(o.e, 1), 0, 1) * 100).toFixed(0) + '%';
        el.querySelector('.w').style.width = (clamp(num(o.w, 1), 0, 1) * 100).toFixed(0) + '%';
      }
      // coureurs groupés : les marqueurs qui se chevauchent forment une rangée serrée, centrée au-dessus du groupe ; deux rangées qui se
      // touchent n'en font plus qu'une
      for (const m of placed) { m.w = 40 * m.k; m.h = 44 * m.k; }
      const rowOf = (gr) => {
        const tot = gr.reduce((a, m) => a + m.w + 2, -2), cx = gr.reduce((a, m) => a + m.x, 0) / gr.length;
        return { x0: cx - tot / 2, x1: cx + tot / 2, y: gr.length > 1 ? Math.min(...gr.map((m) => m.y)) : gr[0].y, h: Math.max(...gr.map((m) => m.h)) };
      };
      const groups = placed.map((m) => [m]);
      for (let pass = 0; pass < 12 && groups.length > 1; pass++) {
        const rows = groups.map(rowOf);
        let hit = null;
        for (let a = 0; a < rows.length && !hit; a++) {
          for (let b = a + 1; b < rows.length; b++) {
            const A = rows[a], B = rows[b];
            if (A.x0 < B.x1 + 1 && B.x0 < A.x1 + 1 && Math.abs(A.y - B.y) < (A.h + B.h) / 2) { hit = [a, b]; break; }
          }
        }
        if (!hit) break;
        groups[hit[0]] = groups[hit[0]].concat(groups[hit[1]]).sort((a, b) => a.x - b.x);
        groups.splice(hit[1], 1);
      }
      for (const gr of groups) {
        const row = rowOf(gr);
        let x = row.x0;
        for (const m of gr) {
          const px = gr.length > 1 ? x + m.w / 2 : m.x;
          x += m.w + 2;
          m.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + row.y.toFixed(1) + 'px) translate(-50%, -100%) scale(' + m.k.toFixed(2) + ')';
        }
      }
      for (const [id, el] of M.els) if (!seen.has(id)) { el.remove(); M.els.delete(id); }
    },

    // ------------------------------------------------------------ manette et VR (trajectoire manuelle de Wattlas, steer-input.js)
    // manette : quand cette vue a le focus, c'est elle qui la lit ; elle la relaie dans la disposition standard (au plus 30 fois par seconde)
    pollPad() {
      if (!this.hostWin || !navigator.getGamepads || (this.game.vr && this.game.vr.presenting)) return;
      if (document.hasFocus && !document.hasFocus()) return;
      let gp = null;
      for (const p of navigator.getGamepads() || []) { if (p && p.connected !== false) { if (p.mapping === 'standard') { gp = p; break; } if (!gp) gp = p; } }
      if (!gp) return;
      const now = performance.now();
      if (now - (this.padAt || 0) < 33) return;
      this.padAt = now;
      const val = (b) => (b ? Number(b.value) || (b.pressed ? 1 : 0) : 0);
      this.post({ type: 'pad', src: 'gamepad', axes: Array.from(gp.axes || []).slice(0, 4), buttons: Array.from(gp.buttons || []).slice(0, 17).map(val) });
    },

    // contrôleurs VR (vr.js, état « pyr ») : la même disposition qu'une manette — stick gauche, stick droit, A B (main droite), X Y (main
    // gauche), grips (LB, RB), gâchettes (LT : frein, RT : sprint), clic des sticks (L3, R3)
    vrPad(pads) {
      const now = performance.now();
      if (!this.hostWin || now - (this.vrPadAt || 0) < 33) return;
      this.vrPadAt = now;
      const L = pads.left, R = pads.right;
      const ax = (gp, i) => (gp && gp.axes && gp.axes.length > i ? Number(gp.axes[i]) || 0 : 0);
      const bt = (gp, i) => (gp && gp.buttons && gp.buttons[i] ? Number(gp.buttons[i].value) || (gp.buttons[i].pressed ? 1 : 0) : 0);
      const b = new Array(17).fill(0);
      b[0] = bt(R, 4); b[1] = bt(R, 5); b[2] = bt(L, 4); b[3] = bt(L, 5);
      b[4] = bt(L, 1); b[5] = bt(R, 1); b[6] = bt(L, 0); b[7] = bt(R, 0);
      b[10] = bt(L, 3); b[11] = bt(R, 3);
      this.post({ type: 'pad', src: 'vr', axes: [ax(L, 2), ax(L, 3), ax(R, 2), ax(R, 3)], buttons: b });
    },

    // carte « Touche ici pour passer dans le casque » : le casque ne se lance que d'un geste dans ce cadre (demande venue du menu)
    armVR(on) {
      if (!this.vrArm) {
        const c = this.vrArm = document.createElement('div');
        c.className = 'pyr-vrarm hidden';
        c.innerHTML = '<button type="button" class="go">🥽 Touche ici pour passer dans le casque</button><button type="button" class="no">Annuler</button>';
        c.querySelector('.go').addEventListener('click', (e) => { e.stopPropagation(); this.armVR(false); if (this.game.vr) this.game.vr.enter(); });
        c.querySelector('.no').addEventListener('click', (e) => { e.stopPropagation(); this.armVR(false); });
        c.addEventListener('pointerdown', (e) => e.stopPropagation());
        document.body.appendChild(c);
      }
      this.vrArm.classList.toggle('hidden', !on);
    },

    // bouton « VR » de la vue ouverte dans une autre fenêtre (dans la page de jeu de Course 3D, le casque se lance depuis le menu, onglet
    // Affichage) ; l'application est prévenue quand on le met ou l'enlève
    buildVR() {
      if (this.embedded || !this.hostWin) return;
      const b = this.vrBtn = document.createElement('button');
      b.type = 'button';
      b.className = 'pyr-vr hidden';
      b.textContent = '🥽 VR';
      b.title = 'Rouler dans le casque de réalité virtuelle (stick gauche : trajectoire, gâchette gauche : frein)';
      b.addEventListener('click', (e) => { e.stopPropagation(); if (this.ready && this.game.vr) this.game.vr.enter(); });
      document.body.appendChild(b);
    },

    watchVR() {
      const vr = this.game.vr, on = !!(vr && vr.presenting);
      if (this.vrBtn) this.vrBtn.classList.toggle('hidden', !(this.ready && vr && vr.supported && !on));
      if (on && this.vrArm) this.armVR(false);
      if (on !== !!this.vrWas) { this.vrWas = on; this.post({ type: 'vr', on }); }
    },

    onKeyUp(e) {
      if (!this.ready || !this.hostWin) return;
      if (/^(ArrowLeft|ArrowRight|KeyF)$/.test(e.code)) this.post({ type: 'keyup', key: e.key, code: e.code });
    },

    // position cible (abscisse Bike3D) d'un coureur : celle de l'image reçue, prolongée à sa vitesse depuis
    targetS(o, ext) {
      const run = !o.fin && !o.st;
      return this.toS(num(o.s, 0) + (run ? num(o.v, 0) * ext : 0));
    },

    // appelée par updateRide à la place de la physique du joueur et du peloton
    drive(dtReal, dt) {
      const F = this.fr, g = this.game, R = g.ride;
      if (!F || !R) return;
      const route = g.route;
      const ext = Math.min(MAX_AGE, (performance.now() - this.frAt) / 1000) * this.timeK;
      const meO = F.riders.find((o) => o.id === F.me) || null;
      const others = F.riders.filter((o) => o !== meO);
      const follow = (a, sT) => (Math.abs(sT - a) > SNAP ? sT : a + (sT - a) * (1 - Math.exp(-dtReal / 0.08)));
      const lanes = [];
      // le joueur
      if (meO) {
        R.sT = this.targetS(meO, ext);
        R.s = follow(R.s, R.sT);
        R.v = meO.st ? 0 : num(meO.v, 0);
        if (R.v > R.maxV) R.maxV = R.v;
        R.effort = Math.max(0, num(meO.P, 0));
        R.draft = clamp(num(meO.dr, 0), 0, 0.7);
        R.time = num(F.t, 0);
        R.half = this.halfAt(R.sT);
        // trajectoire manuelle (free) : le joueur peut aller sur le bas-côté (1,5 m au-delà de la chaussée, steer.js VERGE)
        const lim = meO.free ? R.half + 1.5 : R.half - 0.35;
        if (Number.isFinite(meO.y)) R.laneT = clamp(meO.y, -lim, lim);
        else lanes.push(R);
        if (meO.fin && !this.finished) this.onFinish();
      }
      // les autres : coureurs virtuels, fantômes, joueurs en direct (avatars, home-trainers, cyclistes sur la route)
      this.syncCast(others);
      const P = g.peloton;
      if (P) {
        P.riders.forEach((r, i) => {
          const o = others[i];
          r.sT = this.targetS(o, ext);
          r.s = follow(r.s, r.sT);
          r.v = o.st || o.fin ? 0 : num(o.v, 0);
          r.power = Number.isFinite(o.P) ? o.P : r.v > 1 ? 180 : 0;
          r.done = !!o.fin;
          r.state = o.st ? 'flat' : 'follow';
          r.half = this.halfAt(r.sT);
          if (Number.isFinite(o.y)) r.laneT = clamp(o.y, -(r.half - 0.35), r.half - 0.35);
          else lanes.push(r);
        });
      }
      if (lanes.length) assignLanes(lanes);
      // déplacement latéral lissé ; latV (m par seconde de course) sert au braquage et à l'inclinaison
      const side = (a) => {
        const tgt = a.laneT === undefined ? 0 : a.laneT;
        const nl = a.lat + (tgt - a.lat) * (1 - Math.exp(-dtReal * 5));
        const lv = dt > 1e-4 ? (nl - a.lat) / dt : 0;
        a.latV = lerp(a.latV || 0, lv, 1 - Math.exp(-dtReal * 8));
        a.lat = nl;
      };
      if (meO) side(R);
      if (P) for (const r of P.riders) side(r);
      // allure du joueur : danseuse dans les côtes raides, position aéro dans les descentes rapides
      const q = route.sample(R.s, g._rs);
      const cp = this.cpW();
      R.standing = R.effort > cp * 0.95 && q.grade > 0.06 && R.v < 8.5;
      R.tuck = R.effort < 40 && R.v > 14 && q.grade < -0.02;
      this.sectorCheck(R.s);
      const X = g.playerProxy;
      X.s = R.s; X.lat = R.lat; X.v = R.v;
      if (P) {
        P.playerDraft = R.draft;
        P.playerDraftSrc = null;
        P.sortList();
        this.groups(P);
      }
    },

    // entrée dans un secteur pavé ou un chemin : annonce, comme les villages
    sectorCheck(s) {
      const g = this.game, list = B3D.road.sectors(g.route, g.L);
      const cur = list.find((x) => s >= x.s0 && s < x.s1) || null;
      if (cur === this.sector) return;
      this.sector = cur;
      if (!cur || !this.timeK) return;
      const S = B3D.road.SURFACES[cur.k], info = S.sector;
      const km = ((cur.s1 - cur.s0) / 1000).toFixed(1).replace('.', ',');
      g.toast(info.icon + ' ' + info.title.charAt(0) + info.title.slice(1).toLowerCase() + ' n°' + cur.n + '<small>' + S.name + ' · ' + km + ' km · ' + '★'.repeat(info.stars) + '☆'.repeat(5 - info.stars) + '</small>', 2800);
    },

    // puissance critique approchée du joueur (danseuse), d'après sa vitesse et ses watts habituels
    cpW() { return num(this.course && this.course.cp, 280); },

    // les coureurs à l'écran : un peloton « marionnette » (même rendu que les coureurs de Bike3D), reconstruit quand la liste change
    syncCast(list) {
      const g = this.game, key = list.map((o) => o.id).join('|');
      if (key !== this.castKey) {
        this.castKey = key;
        const old = g.peloton;
        g.peloton = null;
        if (list.length) {
          const P = new B3D.Peloton(g.scene, g.route, g.L, {
            count: list.length, phys: g.phys, teams: B3D.race.TEAMS, playerColor: this.jersey().base,
            detail: B3D.Cyclist.detailLevel(g.riderDetail()), sex: g.playerSex()
          });
          const prev = new Map(old ? old.riders.map((r) => [r.pid, r]) : []);
          P.riders.forEach((r, i) => {
            const o = list[i], p = prev.get(o.id);
            r.pid = o.id;
            Object.assign(r, { s: p ? p.s : this.toS(num(o.s, 0)), lat: p ? p.lat : 0, latV: 0, v: 0, power: 0, cp: 300, done: false, state: 'follow' });
            if (p) r.laneT = p.laneT;
          });
          P.player = g.playerProxy;
          P.list = P.riders.concat([g.playerProxy]);
          P.groups = [];
          P.time = 0;
          g.peloton = P;
          if (g.atmo) g.applyNightLights();
        }
        if (old) old.dispose();
        if (g.convoy) g.convoy.peloton = g.peloton;
      }
      const P = g.peloton;
      if (P) list.forEach((o, i) => P.setLook(i, (KIND_ICON[o.kind] || '') + String(o.name || 'Cycliste').slice(0, 30), o.color, o.sex));
    },

    // groupes (écart de moins de 10 m) : la caravane suit celui du joueur et celui de tête
    groups(P) {
      const groups = [];
      let gr = null;
      for (const r of P.list) {
        if (r.done) continue;
        if (!gr || gr.last.s - r.s > 10) { gr = { members: [], leader: r, last: r, head: r }; groups.push(gr); }
        gr.members.push(r);
        gr.last = r;
        r.group = gr;
      }
      P.groups = groups;
    },

    onFinish() {
      const g = this.game, route = g.route;
      this.finished = true;
      const fp = route.sample(route.sEnd, {});
      const span = g.L.roadHalf + 1.4;
      for (const side of [-1, 1]) g.confetti.burst(fp.x + fp.rx * span * side, fp.y + 5.8, fp.z + fp.rz * span * side, 220);
      g.toast('🏁 Arrivée !', 2400);
    },

    // ------------------------------------------------------------ ciel et météo
    applyEnv(dt) {
      const g = this.game, A = g.atmo, F = this.fr;
      if (!A || !F) return;
      const env = F.env || {}, sky = this.sky;
      const flow = sky ? num(sky.flow, 1) : 1;
      A.setHour(Number.isFinite(env.hour) ? env.hour : this.baseHour + num(F.t, 0) * flow / 3600);
      // date et lieu : la course du soleil et la durée du jour suivent le jour de l'année et la latitude (sinon la saison de l'ambiance du paysage)
      if (Number.isFinite(env.doy) && this.course && this.course.lat && this.course.lat.length) {
        const lat = this.course.lat, lng = this.course.lng, i = lat.length >> 1;
        A.setSite(env.doy, num(lat[i], 45), num(lng[i], 5), sky && Number.isFinite(sky.off) ? sky.off : this.guessOffset(num(lng[i], 5), num(lat[i], 45), env.doy));
      }
      // météo du jeu : le ciel de Bike3D choisit (ou garde) le temps et le vent réglés par le joueur, à son rythme (vitesse du temps du ciel)
      if (sky && sky.mode === 'game') {
        A.setWeatherRate(flow <= 0 ? 0 : Math.max(1, Math.min(12, flow / 10)));
        A.setExternalWind(null);
        const key = sky.weather + '|' + sky.wind;
        if (this.skyApplied !== key) {
          this.skyApplied = key;
          const W = { sun: 'soleil', cloud: 'nuageux', rain: 'pluie', storm: 'orage', snow: 'neige', random: 'variable' }[sky.weather] || 'variable';
          const V = { calm: 'calme', breeze: 'brise', strong: 'fort', storm: 'tempete', random: 'auto' }[sky.wind] || 'auto';
          A.setWeather(W);
          if (V === 'auto') A.setWind(A._pick([['calme', 2], ['brise', 4], ['fort', 2.5], ['tempete', 0.6]])); else A.setWind(V);
          if (W !== 'variable') Object.assign(A.cur, A.tgt);      // un temps imposé est là tout de suite, sans transition
        }
        return;
      }
      this._envT = (this._envT || 0) - dt;
      if (this._envT > 0) return;
      this._envT = 0.5;
      // vent réel (mesuré à 10 m) ; sans vent dans la simulation, le vent de Bike3D reste celui du paysage
      if (Number.isFinite(env.ws) && Number.isFinite(env.wd)) A.setExternalWind(env.ws, env.wd);
      else A.setExternalWind(null);
      if (!Number.isFinite(env.rain)) return;
      // pluie (mm/h) → temps affiché, avec un peu d'hystérésis pour ne pas clignoter autour des seuils
      const r = env.rain, cur = A.state, wet = cur === 'pluie' || cur === 'orage' || cur === 'neige';
      let want;
      if (r >= (wet ? 0.15 : 0.3)) want = num(env.T, 10) <= 1 ? 'neige' : r >= (cur === 'orage' ? 5 : 7) && num(env.gust, 0) > 12 ? 'orage' : 'pluie';
      else if (r > 0.02 || num(env.rh, 0) > 92) want = 'nuageux';
      else want = cur === 'nuageux' && r > 0 ? 'nuageux' : 'soleil';
      if (want !== cur || A.mode !== want) A.setWeather(want);
      // première lecture : le ciel est tout de suite celui de la course, sans transition
      if (!this.envSet) {
        this.envSet = true;
        Object.assign(A.cur, A.tgt);
        A.wet = A.cur.rain > 0.2 || num(env.wet, 0) > 0.3 ? 1 : 0;
      }
    },

    // décalage horaire probable du lieu (h) quand la météo n'en donne pas : heure de l'Europe centrale (à l'est de 5° O) ou orientale (à l'est de 24° E),
    // avec l'heure d'été de fin mars à fin octobre ; ailleurs un fuseau par 15° de longitude
    guessOffset(lng, lat, doy) {
      if (lat > 35 && lat < 72 && lng >= -5 && lng < 45) return (lng < 24 ? 1 : 2) + (doy >= 86 && doy <= 300 ? 1 : 0);
      return Math.round(lng / 15);
    },

    // ------------------------------------------------------------ clavier
    onKey(e) {
      if (!this.ready) return;
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) this.camera();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (!this.hostWin) return;
      // le reste (puissance, tactiques, rang, alimentation, pause…) revient au mode jeu
      if (/^(Arrow|Page|Space)/.test(e.code) || e.key === ' ') e.preventDefault();
      if (!e.repeat || /^Arrow/.test(e.code)) this.post({ type: 'key', key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
      e.stopImmediatePropagation();
    },

    // ------------------------------------------------------------ HUD (fenêtre à part)
    buildHud() {
      const h = this.hud = document.createElement('div');
      h.id = 'pyr-hud';
      h.className = 'pyr-hud hidden';
      h.innerHTML = '<div class="ph-main"><b id="ph-speed">0</b><small>km/h</small></div>' +
        '<div class="ph-row"><span id="ph-power">0 W</span><span id="ph-grade">0 %</span></div>' +
        '<div class="ph-row"><span id="ph-time">0:00</span><span id="ph-dist">0 km</span></div>' +
        '<div class="ph-row"><span id="ph-rank"></span><span id="ph-wbal"></span></div>' +
        '<div class="ph-row"><span id="ph-surf"></span></div>' +
        '<div class="ph-btns"><button id="ph-cam" title="Changer de caméra (C)">🎥</button><button id="ph-sound" title="Son">🔇</button></div>';
      document.body.appendChild(h);
      h.querySelector('#ph-cam').addEventListener('click', () => this.camera());
      h.querySelector('#ph-sound').addEventListener('click', () => this.onCmd({ cmd: 'sound' }));
    },

    updateHud() {
      const now = performance.now();
      if (now - (this._hudT || 0) < 120) return;
      this._hudT = now;
      const F = this.fr, R = this.game.ride;
      if (!F || !R) return;
      const meO = F.riders.find((o) => o.id === F.me);
      const set = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
      const q = this.game._rs;
      set('ph-speed', String(Math.round(R.v * 3.6)));
      set('ph-power', Math.round(R.effort) + ' W');
      set('ph-grade', (q ? Math.round(q.grade * 100) : 0) + ' %');
      set('ph-time', B3D.util.formatTime(num(F.t, 0)));
      const done = meO ? num(meO.s, 0) : 0;
      set('ph-dist', (done / 1000).toFixed(1).replace('.', ',') + ' / ' + (this.pyrLen / 1000).toFixed(1).replace('.', ',') + ' km');
      if (meO) {
        const racers = F.riders.filter((o) => o.kind !== 'ghost');
        const ahead = racers.filter((o) => o !== meO && (o.fin && !meO.fin ? true : o.s > meO.s)).length;
        set('ph-rank', racers.length > 1 ? (ahead + 1) + 'ᵉ / ' + racers.length : (KIND_LABEL[meO.kind] || ''));
        set('ph-wbal', Number.isFinite(meO.w) ? '🔋 ' + Math.round(clamp(meO.w, 0, 1) * 100) + ' %' : '');
      }
      // revêtement sous les roues (hors asphalte ordinaire)
      const L = this.game.L, k = L && L.surf && q ? L.surf[q.i] : 0;
      set('ph-surf', k ? B3D.road.SURFACES[k].name : '');
      $('ph-sound').textContent = this.soundOn ? '🔊' : '🔇';
    }
  };

  B3D.bridge = Bridge;
})(window);
