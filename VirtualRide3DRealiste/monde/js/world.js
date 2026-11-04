/* Virtual Ride 3D Réaliste — le monde autour d'un parcours : il reprend le tracé et le paysage de Bike3D (B3D.Route, B3D.Landscape,
   même graine : tous les joueurs d'une course en direct ont le même monde, et le même que dans l'univers cartoon), les revêtements
   et les points de passage de PaceYourRide, puis construit le rendu réaliste : atmosphère, terrain, route, eau, végétation, villages,
   bord de route. update(dt, caméra) fait vivre le tout (tuiles, ciel, météo). */
import * as THREE from 'three';
import { Atmosphere } from './atmosphere.js';
import { Terrain } from './terrain.js';
import { RoadPath, buildRoad, SURFACE_IDS, SURFACE_INFO } from './road.js';
import { bakeAll } from './textures.js';
import { doyOfAmbiance, season } from './astro.js';

const B3D_BASE = new URL('../../../VirtualRide3D/univers/js/', import.meta.url).href;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

export class World {
  /**
   * course : {name, points: [{lat, lon, ele}], seed, length (m, PaceYourRide), surfaces: [{s, end, kind, w}], roadW, cps, feed}
   * opts : {doy, hour, onProgress(f, text)}
   */
  constructor(engine, course, opts = {}) {
    this.engine = engine;
    this.Q = engine.Q;
    this.course = course;
    this.opts = opts;
    this.systems = [];
  }

  async build() {
    const B3D = window.B3D, E = this.engine, c = this.course, prog = this.opts.onProgress || (() => {});
    window.THREE = window.THREE || THREE;   // Bike3D se sert de THREE.Color (palettes)
    prog(0.02, 'Tracé du parcours…');
    await frame();
    const route = this.route = new B3D.Route({ name: String(c.name || 'Parcours').slice(0, 80), points: c.points });
    const seed = (num(c.seed, 1234) >>> 0) % 1000000;
    this.seed = seed;
    prog(0.06, 'Relief, rivières et villages…');
    await frame();
    const L = this.landscape = new B3D.Landscape(route, seed);
    this.pyrLen = num(c.length, 0) > 0 ? c.length : route.length;
    this.kS = route.length / this.pyrLen;
    this._applySurfaces(c);
    this.path = new RoadPath(route);
    this.sectors = this._sectors();
    // saison : la date de la course si elle est connue, sinon celle de l'ambiance tirée par Bike3D
    this.doy = num(this.opts.doy, doyOfAmbiance(L.amb.id));
    this.season = season(this.doy, route.lat0);
    prog(0.1, 'Textures (enrobé, herbe, roche…)');
    await frame();
    this.tex = bakeAll(E.renderer, this.Q.tex >= 2048 ? 'ultra' : 'haute');
    E.setupShadows();
    this.atmo = new Atmosphere(E, { lat: route.lat0, lon: route.lon0, doy: this.doy, hour: num(this.opts.hour, 10.5) });
    E.attachAtmosphere(this.atmo);
    // un paysage d'hiver (ambiance de Bike3D) en saison froide : la neige reste au sol
    this.snowBase = this.season.snowy > 0.5 && L.amb.id === 'hiver' ? 0.85 : 0;
    this.atmo.u.uSnow.value = this.snowBase;
    prog(0.14, 'Terrain…');
    this.terrain = new Terrain({
      engine: E, Q: this.Q, tex: this.tex, atmo: this.atmo, landscape: L, route,
      workerInit: { base: B3D_BASE, name: route.name, points: c.points, seed, dry: this.season.dry * (route.lat0 < 46 ? 1 : 0.6), margin: Math.max(6000, this.Q.terrain[2] + 2500) },
    });
    await this.terrain.start();
    prog(0.3, 'Route…');
    await frame();
    this.road = buildRoad(this);
    this.ready = true;
    return this;
  }

  /** Revêtements et largeurs de PaceYourRide sur les échantillons de Bike3D (comme js/bridge.js de l'univers cartoon). */
  _applySurfaces(c) {
    const L = this.landscape, route = this.route, n = route.n, sp = route.spacing;
    const hw = (w, d) => clamp(num(w, d * 2) / 2, 0.9, L.roadHalf);
    const def = hw(c.roadW, L.roadHalf);
    L.surf = new Uint8Array(n);
    L.surfHalf = new Float32Array(n).fill(def);
    for (const p of Array.isArray(c.surfaces) ? c.surfaces : []) {
      const k = p ? SURFACE_IDS.indexOf(p.kind) : -1;
      if (k < 0 || !(num(p.end, 0) > num(p.s, 0))) continue;
      const a = this.toS(p.s), b = this.toS(p.end), h = hw(p.w, def);
      for (let i = Math.max(0, Math.floor(a / sp) - 1); i < n && (i + 0.5) * sp < b; i++) {
        if ((i + 0.5) * sp < a) continue;
        L.surf[i] = k; L.surfHalf[i] = h;
      }
    }
    const cps = Array.isArray(c.cps) ? c.cps : [];
    const cat = (x) => (x === 'hc' ? 0 : clamp(parseInt(x, 10) || 4, 1, 4));
    this.points = {
      sprints: cps.filter((x) => x && x.type === 'sprint').map((x) => this.toS(num(x.s, 0))),
      koms: cps.filter((x) => x && x.type === 'kom').map((x) => ({ s0: this.toS(num(x.start, num(x.s, 0) - 1000)), s1: this.toS(num(x.s, 0)), cat: cat(x.cat) })),
      feeds: (Array.isArray(c.feed) ? c.feed : []).filter((z) => z && z.end > z.s).map((z) => ({ s0: this.toS(z.s), s1: this.toS(z.end) })),
    };
  }

  /** Secteurs pavés et chemins de plus de 80 m : numérotés à rebours jusqu'à l'arrivée (« secteur pavé n°3 »). */
  _sectors() {
    const L = this.landscape, route = this.route, n = route.n, sp = route.spacing, out = [];
    let a = -1, k = 0;
    for (let i = 0; i <= n; i++) {
      const id = i < n ? SURFACE_IDS[L.surf[i]] : null;
      const info = id && SURFACE_INFO[id];
      const kk = info && info.sector ? L.surf[i] : -1;
      if (a >= 0 && kk !== k) {
        const s0 = a * sp, s1 = i * sp;
        if (s1 - s0 > 80) { const inf = SURFACE_INFO[SURFACE_IDS[k]]; out.push({ s0, s1, k, title: inf.sector, name: inf.name, stars: inf.stars, icon: inf.sector.startsWith('SECTEUR') ? '🧱' : inf.sector.startsWith('HERBE') ? '🌾' : '🪨' }); }
        a = -1;
      }
      if (a < 0 && kk >= 0) { a = i; k = kk; }
    }
    out.forEach((x, j) => { x.n = out.length - j; });
    return out;
  }

  surfaceName(id) { return (SURFACE_INFO[id] || SURFACE_INFO.asphalt).name; }

  /** Abscisse de Bike3D (m) d'une distance de PaceYourRide. */
  toS(d) { return this.route.toS(clamp(d, 0, this.pyrLen) * this.kS); }

  /** Demi-largeur de la chaussée à l'abscisse s. */
  halfAt(s) {
    const L = this.landscape, i = clamp(Math.round(s / this.route.spacing), 0, this.route.n - 1);
    return L.bridgeMask[i] ? L.roadHalf : L.surfHalf[i];
  }

  /** Revêtement (identifiant) à l'abscisse s. */
  surfaceAt(s) {
    const i = clamp(Math.round(s / this.route.spacing), 0, this.route.n - 1);
    return SURFACE_IDS[this.landscape.surf[i]] || 'asphalt';
  }

  add(system) { this.systems.push(system); return system; }

  update(dt, camera) {
    if (!this.ready) return;
    const A = this.atmo;
    A.update(dt, camera);
    // la lumière des ombres en cascade suit le soleil (ou la lune)
    const csm = this.engine.csm;
    if (csm) {
      csm.lightDirection.copy(A.lightDir).negate();
      for (const l of csm.lights) { l.color.copy(A.lightColor); l.intensity = A.lightIntensity; }
    }
    this.engine.scene.environmentIntensity = A.envIntensity;
    this.terrain.update(camera.position);
    for (const s of this.systems) s.update(dt, camera);
  }
}

function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }
