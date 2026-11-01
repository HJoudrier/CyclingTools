/* Virtual Ride 3D Réaliste — démonstration (la vue ouverte seule, sans PaceYourRide) : un parcours d'exemple de Bike3D et un petit
   peloton qui roule tout seul (puissance constante, vitesse d'après la pente, aspiration dans les roues). Le joueur est le coureur
   orange ; ↑ ↓ changent sa puissance, ← → sa place sur la route. Sert aussi aux captures d'écran et aux essais de performance. */
const SAMPLES = {
  marmottes: 'col-des-marmottes.gpx',
  hc: 'col-hors-categorie.gpx',
  campagne: 'balade-en-campagne.gpx',
};
const NAMES = ['Lucas Morel', 'Hugo Lambert', 'Théo Garnier', 'Nathan Faure', 'Enzo Rousseau', 'Louis Mercier', 'Jules Bonnet', 'Mathis Fontaine', 'Paul Chevalier', 'Arthur Robin', 'Tom Gauthier', 'Noé Perrin', 'Léo Masson', 'Gabin Dupuis', 'Sacha Roux', 'Adam Picard'];
const TEAMS = ['#1f5fbf', '#d8262f', '#f2c230', '#1d8a4f', '#262626', '#e8e4dc', '#7a2a8c', '#0b9bb8'];

export class Demo {
  constructor(app, which) {
    this.app = app;
    this.which = SAMPLES[which] ? which : 'marmottes';
    this.riders = [];
    this.t = 0;
    this.me = null;
    this.powerT = 230;
  }

  async start() {
    const app = this.app;
    try {
      app.progress(0.01, 'Parcours d\'exemple…');
      const url = new URL('../../../VirtualRide3D/univers/samples/' + SAMPLES[this.which], import.meta.url);
      const txt = await (await fetch(url)).text();
      const gpx = window.B3D.gpx.parse(txt);
      const q = new URLSearchParams(location.search);
      const course = {
        name: gpx.name, points: gpx.points, seed: parseInt(q.get('seed') || '1234', 10),
        me: { name: 'Toi', color: '#eb6834', gear: { frame: q.get('frame') || 'aero', wheels: q.get('wheels') || 'c65', position: q.get('position') || 'hoods', helmet: 'road', clothing: 'fitted', glasses: 'sport', socks: 'classic', shoes: 'road', sex: q.get('sex') === 'f' ? 'f' : 'm' } },
      };
      const hour = q.get('hour') ? +q.get('hour') : 10.5;
      const doy = q.get('doy') ? +q.get('doy') : undefined;
      await app.buildWorld(course, { hour, doy });
      this.world = app.world;
      this._spawn(+(q.get('n') || 24), +(q.get('at') || 600));
      window.addEventListener('keydown', (e) => this.onKey(e));
    } catch (e) {
      console.error(e && e.stack ? e.stack : e);
      app.fail(e.message || String(e));
    }
  }

  _spawn(n, at) {
    const W = this.world, s0 = W.route.sStart + at;
    const list = [];
    this.me = { id: 'me', name: 'Toi', color: '#eb6834', kind: 'avatar', s: s0, lat: 0.4, laneT: 0.4, v: 9, P: 230, cp: 300 };
    list.push(this.me);
    for (let i = 0; i < n; i++) {
      const row = Math.floor((i + 1) / 3), col = (i + 1) % 3;
      list.push({
        id: 'b' + i, name: NAMES[i % NAMES.length], color: TEAMS[i % TEAMS.length], kind: 'bot',
        s: s0 + 6 + row * 1.9 - (i % 2) * 0.4, lat: (col - 1) * 0.75 + (Math.random() - 0.5) * 0.2, laneT: 0, v: 9,
        P: 200 + Math.random() * 60, cp: 280 + Math.random() * 60,
      });
      list[list.length - 1].laneT = list[list.length - 1].lat;
    }
    this.riders = list;
  }

  onKey(e) {
    if (!this.me) return;
    if (e.code === 'ArrowUp') this.powerT = Math.min(900, this.powerT + (e.shiftKey ? 50 : 10));
    else if (e.code === 'ArrowDown') this.powerT = Math.max(0, this.powerT - (e.shiftKey ? 50 : 10));
    else if (e.code === 'ArrowLeft') this.me.laneT = Math.max(-2.3, this.me.laneT - 0.75);
    else if (e.code === 'ArrowRight') this.me.laneT = Math.min(2.3, this.me.laneT + 0.75);
    else if (e.code === 'KeyC') { this.app.camera(); }
    else return;
    e.preventDefault();
  }

  /** Commande venant de la manette (input.js) : mêmes effets que le clavier. */
  pad(cmd, v) {
    if (!this.me) return;
    if (cmd === 'power') this.powerT = Math.max(0, Math.min(900, this.powerT + v));
    else if (cmd === 'lane') this.me.laneT = Math.max(-2.3, Math.min(2.3, this.me.laneT + v * 0.75));
    else if (cmd === 'camera') this.app.camera();
  }

  frame(dt) {
    const W = this.world;
    if (!W || !this.me) return;
    this.t += dt;
    const path = W.path, q = {};
    this.me.P += (this.powerT - this.me.P) * (1 - Math.exp(-dt * 3));
    // physique simple : P = (Crr·m·g + m·g·pente)·v + ½ρCdA·v³ (sans aspiration pour le premier de la file)
    const order = this.riders.slice().sort((a, b) => b.s - a.s);
    for (const r of this.riders) {
      path.sample(r.s, q);
      let draft = 0;
      for (const o of order) {
        if (o === r) continue;
        const d = o.s - r.s;
        if (d > 0.3 && d < 4 && Math.abs(o.lat - r.lat) < 0.8) draft = Math.max(draft, 0.38 * (1 - (d - 0.3) / 4));
      }
      r.dr = draft;
      const P = r === this.me ? r.P : r.P * (1 + 0.15 * Math.max(0, q.grade * 10));
      const m = 78, g = 9.81, cda = 0.32 * (1 - draft), rho = 1.18;
      // résolution de v par quelques itérations de Newton
      let v = Math.max(1, r.v);
      for (let k = 0; k < 4; k++) {
        const f = (0.004 * m * g + m * g * q.grade) * v + 0.5 * rho * cda * v * v * v - P;
        const df = 0.004 * m * g + m * g * q.grade + 1.5 * rho * cda * v * v;
        v = Math.max(0.5, v - f / Math.max(df, 1));
      }
      v = Math.min(v, 22);
      r.v += (v - r.v) * (1 - Math.exp(-dt * 1.2));
      // les coureurs virtuels restent groupés autour du joueur
      if (r !== this.me) {
        const gap = r.s - this.me.s;
        r.v += (-gap * 0.02) * dt * 4;
        if (Math.random() < dt * 0.05) r.laneT = Math.max(-2.2, Math.min(2.2, r.laneT + (Math.random() < 0.5 ? -0.75 : 0.75)));
      }
      r.s += r.v * dt;
      const half = W.halfAt(r.s) - 0.4;
      r.laneT = Math.max(-half, Math.min(half, r.laneT));
      r.lat += (r.laneT - r.lat) * (1 - Math.exp(-dt * 1.5));
      r.standing = q.grade > 0.07 && r.P > r.cp * 0.9;
      r.tuck = q.grade < -0.04 && r.v > 13;
    }
    // séparation : pas deux coureurs au même endroit
    for (let a = 0; a < order.length; a++) for (let b = a + 1; b < Math.min(order.length, a + 6); b++) {
      const A = order[a], B = order[b];
      if (A.s - B.s < 1.8 && Math.abs(A.lat - B.lat) < 0.55) { B.s = Math.min(B.s, A.s - 1.8); }
    }
    if (W.end && this.me.s > W.route.sEnd - 50) this._spawn(this.riders.length - 1, 300);
    if (this.app.riders && this.app.riders.set) this.app.riders.set(this.riders, 'me', dt);
  }

  focus() {
    const W = this.world || this.app.world;
    const at = +(new URLSearchParams(location.search).get('at') || 600);
    const m = this.me || { s: W && W.route ? W.route.sStart + at : at, lat: 0.4, v: 0 };
    return { s: m.s, lat: m.lat || 0, v: m.v || 0, head: 1.55, shake: W && W.ready ? (W.surfaceAt(m.s).startsWith('cobbles') ? 1 : 0) : 0 };
  }
}
