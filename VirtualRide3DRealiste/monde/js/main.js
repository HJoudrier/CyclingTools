/* Virtual Ride 3D Réaliste — démarrage de la vue : moteur, monde, caméras, coureurs ; pilotée par PaceYourRide (index.html?pyr, dans le
   cadre de l'écran de course ou une fenêtre à part : js/bridge.js), ou seule en démonstration (index.html : un parcours d'exemple de
   Bike3D et un petit peloton qui roule tout seul). Paramètres de l'adresse : q=moyenne|haute|ultra (qualité), demo=marmottes|hc|campagne,
   hud=1 (compteur), stats=1 (images par seconde), cam=chase|tv|heli|rider|roadside|drone|auto, hour=14.5, wx=pluie|orage|neige|nuageux. */
import * as THREE from 'three';
import { Engine, QUALITY } from './engine.js';
import { World } from './world.js';
import { Director, CAMERAS } from './cameras.js';
import { Riders } from './riders.js';
import { Vegetation } from './vegetation.js';
import { Grass } from './grass.js';
import { Water } from './water.js';
import { Roadside } from './roadside.js';
import { Weather } from './weather.js';
import { Bridge } from './bridge.js';
import { Demo } from './demo.js';
import { Pad } from './input.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const QKEY = 'pyr.realiste.qualite';
const CAPTURE = Q.get('capture') === '1';

function qualityName() {
  const q = Q.get('q');
  if (q && QUALITY[q]) return q;
  try { const s = localStorage.getItem(QKEY); if (s && QUALITY[s]) return s; } catch (e) { /* stockage indisponible */ }
  return 'haute';
}

const App = {
  engine: null, world: null, director: null, riders: null, driver: null, running: false, last: 0,

  init() {
    const canvas = $('view');
    if (!canvas.getContext('webgl2')) {
      this.fail('Ce navigateur n\'a pas WebGL 2 : le monde réaliste demande un PC ou une console de salon récents (Chrome, Edge, Firefox, Safari à jour).');
      return;
    }
    try {
      this.engine = new Engine(canvas, qualityName());
    } catch (e) {
      this.fail('Impossible de démarrer le rendu 3D : ' + e.message);
      return;
    }
    if (Q.get('scale')) { this.engine.autoScale = false; this.engine.scale = Math.max(0.3, Math.min(1, +Q.get('scale'))); this.engine._applyScale(); }
    this.sound = new Sound();
    this.pad = new Pad();
    this.bindUi();
    // piloté par PaceYourRide, ou démonstration
    this.driver = /[?&]pyr(=|&|$)/.test(location.search) ? new Bridge(this) : new Demo(this, Q.get('demo') || 'marmottes');
    this.driver.start();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  },

  progress(f, text) {
    $('ld-fill').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';
    if (text) $('ld-text').textContent = text;
  },

  fail(text) {
    const L = $('loading');
    L.classList.remove('done');
    L.classList.add('error');
    $('ld-text').textContent = '⚠️ ' + text;
    if (this.driver && this.driver.fail) this.driver.fail(text);
  },

  /** Construit le monde d'un parcours (course : voir World), puis les coureurs ; résout quand on peut rouler. */
  async buildWorld(course, opts) {
    const E = this.engine;
    $('loading').classList.remove('done');
    this.ready = false;
    if (this.world) this.disposeWorld();
    const world = new World(E, course, Object.assign({ onProgress: (f, t) => this.progress(f, t) }, opts));
    this.world = world;
    await world.build();
    this.progress(0.32, 'Coureurs et vélos…');
    await new Promise((r) => requestAnimationFrame(r));
    this.riders = world.riders = world.add(new Riders(world, { me: course.me || {} }));
    this.progress(0.33, 'Eau, villages, forêts…');
    await new Promise((r) => requestAnimationFrame(r));
    world.add(new Water(world));
    world.add(new Roadside(world));
    this.veg = world.add(new Vegetation(world));
    this.grass = world.add(new Grass(world));
    this.weather = world.weather = world.add(new Weather(world));
    this.director = new Director(E, world);
    const cam = Q.get('cam');
    if (cam) this.director.set(cam);
    if (Q.get('wx')) world.atmo.setWeather(Q.get('wx'), true);
    // on attend que le terrain proche soit prêt (la caméra est déjà à sa place)
    const focus = this.driver.focus();
    const t0 = performance.now();
    for (;;) {
      this.director.update(1 / 60, focus);
      world.update(1 / 60, E.camera);
      const p = world.terrain.pendingNear(E.camera.position, 600);
      const f = p.total ? 1 - p.left / p.total : 0;
      this.progress(0.35 + 0.6 * f, 'Paysage : ' + Math.round(f * 100) + ' %');
      if ((p.total && p.left === 0) || performance.now() - t0 > 45000) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    // une première image pour compiler les shaders avant de lever le rideau
    this.progress(0.97, 'Lumière…');
    world.atmo.updateEnv();
    E.renderer.compile(E.scene, E.camera);
    E.render(1 / 60);
    this.ready = true;
    $('loading').classList.add('done');
    return world;
  },

  disposeWorld() {
    const E = this.engine;
    if (this.world && this.world.terrain) this.world.terrain.dispose();
    for (const o of E.scene.children.slice()) if (o !== E.camera) E.scene.remove(o);
    this.world = null;
  },

  loop(now) {
    requestAnimationFrame(this.loop);
    if (CAPTURE) return;
    const dt = Math.min(0.1, Math.max(0.0005, (now - (this.last || now)) / 1000));
    this.last = now;
    this.step(dt);
  },

  /** Captures (essais) : n images à pas fixe, puis l'image en PNG. */
  capture(n, dt) {
    for (let i = 0; i < (n || 1); i++) this.step(dt || 1 / 30);
    return this.engine.renderer.domElement.toDataURL('image/png');
  },

  step(dt) {
    this.pad.poll(dt, this.driver);
    if (!this.ready || !this.world) return;
    const E = this.engine;
    this.driver.frame(dt);
    const focus = this.driver.focus();
    this.director.shake = focus.shake || 0;
    const mode = this.director.update(dt, focus);
    if (this.riders) this.riders.cameraMode = mode;
    this.world.update(dt, E.camera);
    E.render(dt);
    this.sound.update(dt, this);
    if (this._stats) {
      this._statsT = (this._statsT || 0) - dt;
      if (this._statsT < 0) {
        this._statsT = 0.5;
        const s = E.stats();
        $('stats').textContent = `${s.fps} i/s · ${s.w}×${s.h} (${Math.round(s.scale * 100)} %)\n${s.calls} appels · ${(s.tris / 1e6).toFixed(2)} M triangles`;
      }
    }
  },

  /* ---------- interface de la vue ---------- */

  toast(html, ms) {
    const el = $('toast');
    el.innerHTML = html;
    el.hidden = false;
    el.classList.remove('out');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 400); }, ms || 2000);
  },

  camera() {
    if (!this.director) return;
    this.director.next();
    this.toast('🎥 ' + this.director.name(), 1100);
    if (this.driver.status) this.driver.status();
  },

  bindUi() {
    $('b-cam').addEventListener('click', () => this.camera());
    $('b-sound').addEventListener('click', () => this.setSound(!this.sound.on));
    $('b-full').addEventListener('click', () => this.fullscreen());
    $('b-quality').addEventListener('click', () => $('menu').classList.toggle('hidden'));
    $('m-close').addEventListener('click', () => $('menu').classList.add('hidden'));
    const seg = $('m-quality');
    for (const [id, q] of Object.entries(QUALITY)) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = q.label; b.dataset.q = id;
      b.setAttribute('aria-pressed', String(id === this.engine.qName));
      b.addEventListener('click', () => {
        try { localStorage.setItem(QKEY, id); } catch (e) { /* stockage indisponible */ }
        location.reload();
      });
      seg.appendChild(b);
    }
    $('m-auto').checked = this.engine.autoScale;
    $('m-auto').addEventListener('change', (e) => { this.engine.autoScale = e.target.checked; if (!e.target.checked) { this.engine.scale = 1; this.engine._applyScale(); } });
    this._stats = Q.get('stats') === '1';
    $('m-stats').checked = this._stats;
    $('stats').classList.toggle('hidden', !this._stats);
    $('m-stats').addEventListener('change', (e) => { this._stats = e.target.checked; $('stats').classList.toggle('hidden', !this._stats); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) { this.fullscreen(); e.preventDefault(); }
    });
  },

  setSound(on) {
    this.sound.setOn(on);
    $('b-sound').textContent = on ? '🔊' : '🔇';
    if (this.driver.status) this.driver.status();
  },

  fullscreen() {
    const d = document;
    if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
    else d.documentElement.requestFullscreen().catch(() => {});
  },
};

window.addEventListener('error', (e) => { if (!App.ready) App.fail(String(e.message || e)); });
window.addEventListener('unhandledrejection', (e) => { if (!App.ready) App.fail(String((e.reason && e.reason.message) || e.reason)); });
window.VR3R = App;
App.init();

export { App, CAMERAS, THREE };
