/* Virtual Ride 3D Réaliste — vue pilotée par PaceYourRide (index.html?pyr), avec le même protocole que l'univers cartoon de Bike3D
   (VirtualRide3D/univers/js/bridge.js, version 1) : PaceYourRide simule la course, cette vue la montre.

   PaceYourRide → vue (messages pyr3d: 1)
     course : {key, name, seed, lat[], lng[], ele[], length, cps, feed, surfaces, roadW, me: {name, color, gear}, cp}
     frame  : {t, k, run, me, riders: [{id, name, color, sex, kind, s, y, v, P, w, dr, st, fin}], env: {hour, doy, T, rain, ws, wd, gust, rh, wet}}
     gear   : {gear}           (équipement du joueur : vélo, roues, position, tenue)
     cmd    : {cmd: 'camera' | 'sound' | 'reroll' | 'hud', on}
   vue → PaceYourRide
     hello  : prête à recevoir le parcours (chaque seconde tant qu'il n'est pas arrivé)
     status : {state: 'building' | 'ready' | 'error', seed, text, cam, sound}
     key    : {key, code, shift, ctrl, alt, meta} (touches renvoyées au jeu ; C change de caméra ici) */
const V = 1;
const MAX_AGE = 0.3;     // s réelles : au-delà, on ne prolonge plus le mouvement depuis la dernière image reçue
const SNAP = 40;         // m : saut plus grand (reprise, nouveau départ) : on se place directement
const LANES = [0, 0.75, -0.75, 1.5, -1.5, 2.2, -2.2];
const KIND_ICON = { avatar: '🎮 ', trainer: '🏠 ', road: '🚴 ', bot: '', ghost: '👻 ' };
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const $ = (id) => document.getElementById(id);

/** Voies des coureurs sans position latérale (comme Bike3D) : chacun garde la sienne si elle est libre. */
export function assignLanes(list) {
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

/** Temps qu'il fait d'après la pluie (mm/h), la température et les rafales (avec un peu d'hystérésis), comme Bike3D. */
export function weatherOf(env, cur) {
  const r = num(env.rain, 0), wet = cur === 'pluie' || cur === 'orage' || cur === 'neige';
  if (r >= (wet ? 0.15 : 0.3)) return num(env.T, 10) <= 1 ? 'neige' : r >= (cur === 'orage' ? 5 : 7) && num(env.gust, 0) > 12 ? 'orage' : 'pluie';
  if (r > 0.02 || num(env.rh, 0) > 92) return 'nuageux';
  return cur === 'nuageux' && r > 0 ? 'nuageux' : 'soleil';
}

export class Bridge {
  constructor(app) {
    this.app = app;
    this.embedded = window.parent !== window;
    this.hostWin = this.embedded ? window.parent : window.opener;
    this.key = null;
    this.fr = null; this.frAt = 0; this.timeK = 0;
    this.ready = false;
    this.cast = new Map();
    this.me = null;
    this.hudOn = /[?&]hud=1/.test(location.search) || !this.embedded;
    this.soundOn = !this.embedded;
    this.list = [];
  }

  start() {
    window.addEventListener('message', (e) => this.onMessage(e));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    // un toucher bref sur la vue change de caméra ; le son ne démarre qu'après un geste
    let down = null;
    const canvas = this.app.engine.renderer.domElement;
    window.addEventListener('pointerdown', (e) => { if (this.soundOn) this.app.setSound(true); down = e.target === canvas ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; });
    window.addEventListener('pointerup', (e) => {
      if (!down || !this.ready) return;
      const tap = performance.now() - down.t < 350 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
      down = null;
      if (tap) this.app.camera();
    });
    this.app.setSound(false);
    $('hud').classList.toggle('hidden', true);
    if (!this.hostWin) {
      this.app.progress(0, 'Cette vue s\'ouvre depuis l\'écran de course de Virtual Ride 3D Réaliste (PaceYourRide).');
      return;
    }
    this.app.progress(0, 'En attente du parcours de PaceYourRide…');
    const hello = () => { if (!this.key) { this.post({ type: 'hello' }); setTimeout(hello, 1000); } };
    hello();
  }

  post(msg) {
    if (!this.hostWin) return;
    try { this.hostWin.postMessage(Object.assign({ pyr3d: V }, msg), '*'); } catch (e) { /* fenêtre fermée */ }
  }

  status(extra) {
    const d = this.app.director;
    this.post(Object.assign({ type: 'status', state: this.ready ? 'ready' : 'building', seed: this.seed, cam: d ? d.index : 0, sound: this.soundOn }, extra || {}));
  }

  fail(text) { this.post({ type: 'status', state: 'error', text }); }

  onMessage(e) {
    const m = e.data;
    if (!m || m.pyr3d !== V || typeof m.type !== 'string') return;
    if (this.hostWin && e.source !== this.hostWin) return;
    if (m.type === 'course') this.onCourse(m);
    else if (m.type === 'frame') this.onFrame(m);
    else if (m.type === 'gear') this.setGear(m.gear);
    else if (m.type === 'cmd') this.onCmd(m);
  }

  onCmd(m) {
    if (m.cmd === 'camera') { if (this.ready) this.app.camera(); }
    else if (m.cmd === 'sound') { this.soundOn = m.on === undefined ? !this.soundOn : !!m.on; this.app.setSound(this.soundOn); }
    else if (m.cmd === 'reroll') { if (this.course && !this.building) this.build(this.course, (this.seed + 7919) % 1000000); }
    else if (m.cmd === 'hud') { this.hudOn = m.on === undefined ? !this.hudOn : !!m.on; $('hud').classList.toggle('hidden', !this.hudOn || !this.ready); }
    this.status();
  }

  setGear(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return;
    this.gear = g;
    if (this.app.riders && this.app.riders.setGear) this.app.riders.setGear(g);
  }

  onCourse(m) {
    if (!Array.isArray(m.lat) || !Array.isArray(m.lng) || m.lat.length < 2 || m.lat.length !== m.lng.length) { this.fail('Parcours reçu illisible.'); return; }
    if (m.key && m.key === this.key) { this.setGear(m.me && m.me.gear); return; }
    if (this.building) { this.pending = m; return; }
    this.key = m.key || String(Date.now());
    const seed = (num(m.seed, 1234) >>> 0) % 1000000;
    this.build(m, seed);
  }

  async build(m, seed) {
    this.building = true;
    this.ready = false;
    this.course = m;
    this.seed = seed;
    this.status();
    const ele = Array.isArray(m.ele) ? m.ele : [];
    const points = m.lat.map((lat, i) => ({ lat: +lat, lon: +m.lng[i], ele: Number.isFinite(+ele[i]) && ele[i] !== null ? +ele[i] : null }));
    if (m.me && m.me.gear) this.gear = m.me.gear;
    const course = {
      name: String(m.name || 'Parcours PaceYourRide').slice(0, 80), points, seed, length: num(m.length, 0),
      surfaces: m.surfaces, roadW: m.roadW, cps: m.cps, feed: m.feed, me: Object.assign({}, m.me || {}, { gear: this.gear }),
    };
    // l'heure de départ sans météo datée : tirée de la graine (la même pour tous les joueurs d'une course en direct)
    this.baseHour = 9 + (seed % 800) / 100;
    try {
      const env = this.fr && this.fr.env ? this.fr.env : {};
      await this.app.buildWorld(course, { hour: Number.isFinite(env.hour) ? env.hour : this.baseHour, doy: Number.isFinite(env.doy) ? env.doy : undefined });
    } catch (e) {
      console.error(e);
      this.building = false;
      this.fail(e.message || String(e));
      this.app.fail(e.message || String(e));
      return;
    }
    this.world = this.app.world;
    this.cast.clear();
    this.envSet = false;
    this.finished = false;
    this.sector = null;
    this.building = false;
    this.ready = true;
    $('hud').classList.toggle('hidden', !this.hudOn);
    this.status();
    if (this.pending) { const p = this.pending; this.pending = null; this.onCourse(p); }
  }

  onFrame(m) {
    if (!Array.isArray(m.riders)) return;
    this.fr = m;
    this.frAt = performance.now();
    this.timeK = m.run ? clamp(num(m.k, 1), 0, 100) : 0;
  }

  /** Abscisse de Bike3D d'un coureur (prolongée à sa vitesse depuis la dernière image). */
  targetS(o, ext) {
    const run = !o.fin && !o.st;
    return this.world.toS(num(o.s, 0) + (run ? num(o.v, 0) * ext : 0));
  }

  frame(dt) {
    const F = this.fr, W = this.world;
    if (!F || !W || !this.ready) return;
    const ext = Math.min(MAX_AGE, (performance.now() - this.frAt) / 1000) * this.timeK;
    const dtRace = dt * this.timeK;
    const follow = (a, sT) => (Math.abs(sT - a) > SNAP ? sT : a + (sT - a) * (1 - Math.exp(-dt / 0.08)));
    const lanes = [];
    const list = [];
    for (const o of F.riders) {
      let c = this.cast.get(o.id);
      const sT = this.targetS(o, ext);
      if (!c) { c = { id: String(o.id), s: sT, lat: 0, laneT: 0 }; this.cast.set(o.id, c); }
      c.sT = sT;
      c.s = follow(c.s, sT);
      c.v = o.st || o.fin ? 0 : num(o.v, 0);
      c.P = Number.isFinite(o.P) ? o.P : c.v > 1 ? 180 : 0;
      c.dr = num(o.dr, 0);
      c.name = (KIND_ICON[o.kind] || '') + String(o.name || 'Cycliste').slice(0, 30);
      c.color = /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#6f6d66';
      c.kind = o.kind; c.sex = o.sex; c.fin = !!o.fin; c.st = !!o.st;
      c.half = W.halfAt(sT);
      if (Number.isFinite(o.y)) c.laneT = clamp(o.y, -(c.half - 0.35), c.half - 0.35);
      else lanes.push(c);
      list.push(c);
    }
    if (lanes.length) assignLanes(lanes);
    for (const c of list) c.lat += (c.laneT - c.lat) * (1 - Math.exp(-dt * 5));
    // allure : danseuse dans les côtes raides, position aéro dans les descentes rapides
    const cp = num(this.course && this.course.cp, 280), q = {};
    for (const c of list) {
      W.path.sample(c.s, q);
      c.standing = c.P > cp * 0.95 && q.grade > 0.06 && c.v < 8.5;
      c.tuck = c.P < 40 && c.v > 14 && q.grade < -0.02;
    }
    // le joueur en premier ; les fantômes à part (même rendu)
    const meId = String(F.me);
    list.sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : 0));
    this.me = list.find((c) => c.id === meId) || null;
    this.list = list;
    if (this.app.riders) this.app.riders.set(list, meId, dt);
    this.applyEnv(dt, F, dtRace);
    this.sectorCheck();
    if (this.me && this.me.fin && !this.finished) { this.finished = true; this.app.toast('🏁 Arrivée !', 2600); }
    if (this.hudOn) this.updateHud();
    // pour les fenêtres sans PaceYourRide visible : vitesse de défilement du temps
    if (this.app.weather) this.app.weather.raceK = this.timeK;
  }

  focus() {
    const m = this.me;
    if (!m) {
      const W = this.world || this.app.world;
      return { s: W && W.route ? W.route.sStart + 30 : 30, lat: 0, v: 0, head: 1.55 };
    }
    const surf = this.world ? this.world.surfaceAt(m.s) : 'asphalt';
    return { s: m.s, lat: m.lat, v: m.v, head: 1.55, shake: surf.startsWith('cobbles') ? (surf === 'cobbles_hard' ? 1.6 : 1) : surf === 'gravel_loose' || surf === 'dirt' ? 0.4 : 0, lean: m._lean || 0 };
  }

  // météo à la position et à l'heure du joueur
  applyEnv(dt, F, dtRace) {
    const W = this.world, A = W.atmo, env = F.env || {};
    A.setTime(Number.isFinite(env.hour) ? env.hour : this.baseHour + num(F.t, 0) / 3600, Number.isFinite(env.doy) ? env.doy : undefined);
    this._envT = (this._envT || 0) - dt;
    if (this._envT > 0 && this.envSet) return;
    this._envT = 0.5;
    if (Number.isFinite(env.ws) && Number.isFinite(env.wd)) A.setWind(env.ws, env.wd);
    const want = Number.isFinite(env.rain) ? weatherOf(env, A.state) : A.state;
    if (want !== A.state) A.setWeather(want, !this.envSet);
    if (this.app.weather) this.app.weather.setEnv(env, !this.envSet);
    this.envSet = true;
  }

  sectorCheck() {
    const W = this.world, m = this.me;
    if (!m || !W.sectors) return;
    const cur = W.sectors.find((x) => m.s >= x.s0 && m.s < x.s1) || null;
    if (cur === this.sector) return;
    this.sector = cur;
    if (!cur || !this.timeK) return;
    const km = ((cur.s1 - cur.s0) / 1000).toFixed(1).replace('.', ',');
    this.app.toast(cur.icon + ' ' + cur.title.charAt(0) + cur.title.slice(1).toLowerCase() + ' n°' + cur.n + '<small>' + cur.name + ' · ' + km + ' km · ' + '★'.repeat(cur.stars) + '☆'.repeat(5 - cur.stars) + '</small>', 2800);
  }

  onKey(e) {
    if (!this.ready) return;
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!e.repeat) this.app.camera();
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) return;   // plein écran (main.js)
    if (!this.hostWin) return;
    if (/^(Arrow|Page|Space)/.test(e.code) || e.key === ' ') e.preventDefault();
    if (!e.repeat || /^Arrow/.test(e.code)) this.post({ type: 'key', key: e.key, code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey });
    e.stopImmediatePropagation();
  }

  /** Commande de la manette (input.js) : renvoyée au jeu comme une touche. */
  pad(cmd, v) {
    if (cmd === 'camera') { this.app.camera(); return; }
    const key = (k, code, shift) => this.post({ type: 'key', key: k, code, shift: !!shift });
    if (cmd === 'power') key(v > 0 ? 'ArrowUp' : 'ArrowDown', v > 0 ? 'ArrowUp' : 'ArrowDown', Math.abs(v) >= 50);
    else if (cmd === 'lane') key(v > 0 ? 'ArrowRight' : 'ArrowLeft', v > 0 ? 'ArrowRight' : 'ArrowLeft');
    else if (cmd === 'key') key(v.key, v.code, v.shift);
  }

  updateHud() {
    const now = performance.now();
    if (now - (this._hudT || 0) < 120) return;
    this._hudT = now;
    const F = this.fr, m = this.me, W = this.world;
    if (!F || !m) return;
    const meO = F.riders.find((o) => String(o.id) === String(F.me));
    const set = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
    const q = W.path.sample(m.s, {});
    set('h-speed', String(Math.round(m.v * 3.6)));
    set('h-power', Math.round(num(meO && meO.P, 0)) + ' W');
    set('h-grade', Math.round(q.grade * 100) + ' %');
    set('h-time', fmtTime(num(F.t, 0)));
    const done = meO ? num(meO.s, 0) : 0;
    set('h-dist', (done / 1000).toFixed(1).replace('.', ',') + ' / ' + (W.pyrLen / 1000).toFixed(1).replace('.', ',') + ' km');
    if (meO) {
      const racers = F.riders.filter((o) => o.kind !== 'ghost');
      const ahead = racers.filter((o) => o !== meO && (o.fin && !meO.fin ? true : o.s > meO.s)).length;
      set('h-rank', racers.length > 1 ? (ahead + 1) + 'ᵉ / ' + racers.length : '');
      set('h-wbal', Number.isFinite(meO.w) ? '🔋 ' + Math.round(clamp(meO.w, 0, 1) * 100) + ' %' : '');
    }
    const surf = W.surfaceAt(m.s);
    set('h-surf', surf === 'asphalt' ? '' : (W.surfaceName ? W.surfaceName(surf) : surf));
    const env = F.env || {};
    set('h-wx', Number.isFinite(env.T) ? Math.round(env.T) + ' °C' : '');
  }
}

function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
