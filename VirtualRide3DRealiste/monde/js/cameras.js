/* Virtual Ride 3D Réaliste — caméras de la course, comme à la télévision :
     poursuite (derrière le coureur, amortie), moto TV (devant, de trois quarts, téléobjectif), hélicoptère (haut et loin, qui tourne
     lentement), vue cycliste (sur le vélo), bord de route (caméra posée qui regarde passer le coureur, puis se replace plus loin),
     drone (au-dessus, qui précède), réalisation automatique (change de plan toutes les 10 à 20 secondes).
   La caméra ne passe jamais sous le terrain. */
import * as THREE from 'three';

export const CAMERAS = [
  { id: 'chase', name: 'Poursuite' },
  { id: 'tv', name: 'Moto TV' },
  { id: 'heli', name: 'Hélicoptère' },
  { id: 'rider', name: 'Vue cycliste' },
  { id: 'roadside', name: 'Bord de route' },
  { id: 'drone', name: 'Drone' },
  { id: 'auto', name: 'Réalisation automatique' },
];

const _q = {}, _q2 = {};
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Director {
  constructor(engine, world) {
    this.engine = engine;
    this.world = world;
    this.cam = engine.camera;
    this.index = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fov = 55;
    this.cut = true;
    this.autoT = 0;
    this.autoMode = 'chase';
    this.side = 1;
    this.road = null;
    this.shake = 0;
    this.time = 0;
  }

  get mode() { const m = CAMERAS[this.index].id; return m === 'auto' ? this.autoMode : m; }
  name() { return CAMERAS[this.index].name; }

  next() { this.index = (this.index + 1) % CAMERAS.length; this.cut = true; this.road = null; }
  set(id) { const i = CAMERAS.findIndex((c) => c.id === id); if (i >= 0) { this.index = i; this.cut = true; this.road = null; } }

  ground(x, z) {
    const h = this.world.terrain.heightAt(x, z);
    return h === null ? -1e9 : h;
  }

  /**
   * f : le coureur suivi {s (abscisse de Bike3D), lat (m, + à droite), v (m/s), lean (rad), head (y de la tête, m au-dessus de la route)}.
   * dt : secondes réelles.
   */
  update(dt, f) {
    this.time += dt;
    const P = this.world.path;
    const q = P.sample(f.s, _q);
    const px = q.x + q.rx * f.lat, pz = q.z + q.rz * f.lat, py = q.y + 0.04;
    let mode = this.mode;
    if (CAMERAS[this.index].id === 'auto') {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        const list = ['chase', 'tv', 'heli', 'roadside', 'drone', 'tv', 'chase'];
        let m = this.autoMode;
        while (m === this.autoMode) m = list[Math.floor(Math.random() * list.length)];
        this.autoMode = m; mode = m;
        this.autoT = 9 + Math.random() * 11;
        this.cut = true; this.road = null; this.side = Math.random() < 0.5 ? -1 : 1;
      }
    }
    let fov = 55, k = 6;
    const tgt = _t;
    const look = this.look;
    if (mode === 'chase') {
      // derrière et au-dessus, en suivant la route (amortie)
      const back = 4.6 + Math.min(2.2, f.v * 0.06);
      const b = P.sample(f.s - back, _q2);
      tgt.set(b.x + b.rx * f.lat * 0.8, b.y + 1.85, b.z + b.rz * f.lat * 0.8);
      const a = P.sample(f.s + 6, _q2);
      look.set(a.x + a.rx * f.lat * 0.6, a.y + 1.0, a.z + a.rz * f.lat * 0.6);
      fov = 58; k = 7;
    } else if (mode === 'tv') {
      // moto devant, de trois quarts, longue focale
      const a = P.sample(f.s + 14, _q2);
      tgt.set(a.x + a.rx * this.side * 3.4, a.y + 1.6, a.z + a.rz * this.side * 3.4);
      look.set(px, py + 1.0, pz);
      fov = 24; k = 3;
    } else if (mode === 'heli') {
      const ang = this.time * 0.05;
      const r = 120;
      tgt.set(px + Math.cos(ang) * r, py + 85, pz + Math.sin(ang) * r);
      look.set(px, py + 1, pz);
      fov = 22; k = 1.2;
    } else if (mode === 'rider') {
      const a = P.sample(f.s + 0.55, _q2);
      tgt.set(a.x + a.rx * f.lat, a.y + (f.head || 1.55), a.z + a.rz * f.lat);
      const b = P.sample(f.s + 25, _q2);
      look.set(b.x + b.rx * f.lat * 0.5, b.y + 0.6, b.z + b.rz * f.lat * 0.5);
      fov = 68; k = 30;
    } else if (mode === 'roadside') {
      // posée sur le bas-côté devant le coureur ; une fois dépassée, elle se replace plus loin
      if (!this.road || f.s - this.road.s > 18) {
        const s = f.s + 70 + Math.random() * 30;
        const b = P.sample(s, _q2);
        const side = Math.random() < 0.5 ? -1 : 1;
        const off = this.world.halfAt(s) + 2.2 + Math.random() * 3;
        const x = b.x + b.rx * side * off, z = b.z + b.rz * side * off;
        const gy = Math.max(this.ground(x, z), b.y - 2);
        this.road = { s, x, y: gy + 0.9 + Math.random() * 0.8, z };
        this.cut = true;
      }
      tgt.set(this.road.x, this.road.y, this.road.z);
      look.set(px, py + 1.0, pz);
      const d = Math.hypot(px - this.road.x, pz - this.road.z);
      fov = THREE.MathUtils.clamp(2 * Math.atan(3.2 / Math.max(d, 1)) * 180 / Math.PI, 14, 60);
      k = 1000;
    } else {
      // drone : au-dessus et devant, regarde le coureur arriver
      const a = P.sample(f.s + 26, _q2);
      tgt.set(a.x + a.rx * this.side * 4, a.y + 24, a.z + a.rz * this.side * 4);
      look.set(px, py + 0.8, pz);
      fov = 45; k = 2;
    }
    // pas sous le terrain (ni sous la route)
    const gy = this.ground(tgt.x, tgt.z);
    if (tgt.y < gy + 0.6) tgt.y = gy + 0.6;
    if (this.cut || this.pos.distanceToSquared(tgt) > 150 * 150) { this.pos.copy(tgt); this.fov = fov; this.cut = false; }
    else {
      const a = 1 - Math.exp(-dt * k);
      this.pos.lerp(tgt, a);
      this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    }
    const cam = this.cam;
    cam.position.copy(this.pos);
    if (this.shake > 0 && mode !== 'heli') {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.02;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.02;
    }
    cam.up.copy(_up);
    cam.lookAt(look);
    if (mode === 'rider' && f.lean) cam.rotateZ(-f.lean * 0.5);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // plan proche plus court pour la vue cycliste (le cintre), sinon on garde de la précision au loin
    const near = mode === 'rider' ? 0.08 : 0.25;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    return mode;
  }
}
