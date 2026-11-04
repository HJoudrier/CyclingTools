/* Virtual Ride 3D Réaliste — sons, synthétisés (Web Audio, aucun fichier) : le vent (selon la vitesse, plus discret dans les roues),
   le roulement des pneus selon le revêtement (enrobé, pavés qui grondent, gravier qui crisse), le cliquetis de la roue libre, la
   pluie, la rumeur et les encouragements du public quand on passe devant lui, le tonnerre de l'orage. Le son ne démarre qu'après un
   geste (règle des navigateurs). */
export class Sound {
  constructor() { this.on = false; this.ctx = null; }

  setOn(v) {
    this.on = !!v;
    if (this.on && !this.ctx) this._start();
    if (this.ctx) {
      if (this.on && this.ctx.state === 'suspended') this.ctx.resume();
      this.master.gain.setTargetAtTime(this.on ? 0.9 : 0, this.ctx.currentTime, 0.1);
    }
  }

  _start() {
    let C;
    try { C = this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    this.master = C.createGain(); this.master.gain.value = 0; this.master.connect(C.destination);
    // bruit rose (une seconde, en boucle)
    const len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    const src = (filterType, f, q) => {
      const s = C.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2);
      const fl = C.createBiquadFilter(); fl.type = filterType; fl.frequency.value = f; fl.Q.value = q || 0.7;
      const g = C.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master);
      return { f: fl, g };
    };
    this.wind = src('lowpass', 500, 0.5);
    this.roll = src('bandpass', 600, 0.8);
    this.rumble = src('lowpass', 140, 1.2);
    this.crunch = src('highpass', 2500, 0.6);
    this.rain = src('highpass', 1500, 0.4);
    this.crowd = src('bandpass', 900, 1.6);
    this.clickT = 0;
  }

  _click(gain) {
    const C = this.ctx, o = C.createOscillator(), g = C.createGain();
    o.type = 'square'; o.frequency.value = 2400 + Math.random() * 400;
    g.gain.setValueAtTime(gain, C.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + 0.012);
    o.connect(g); g.connect(this.master); o.start(); o.stop(C.currentTime + 0.02);
  }

  _thunder(dist) {
    const C = this.ctx, s = C.createBufferSource();
    const len = C.sampleRate * 3, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { v = v * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = v * Math.exp(-i / (C.sampleRate * (0.6 + Math.random() * 0.02))) * (1 + 3 * Math.exp(-i / 4000)); }
    s.buffer = buf;
    const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300 / (1 + dist);
    const g = C.createGain(); g.gain.value = 1.4 / (1 + dist);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(C.currentTime + dist * 2.9);
  }

  update(dt, app) {
    if (!this.on || !this.ctx || !app.world || !app.driver) return;
    const C = this.ctx, t = C.currentTime, f = app.driver.focus(), W = app.world;
    const v = f.v || 0, surf = W.surfaceAt(f.s);
    const mode = app.director ? app.director.mode : 'chase';
    const near = mode === 'chase' || mode === 'rider' ? 1 : mode === 'tv' || mode === 'roadside' ? 0.55 : 0.2;
    const me = app.driver.me || {};
    const draft = Math.min(0.7, me.dr || 0);
    const set = (n, val, tc) => n.g.gain.setTargetAtTime(val, t, tc || 0.15);
    set(this.wind, Math.min(0.9, v * v * 0.0018 * (1 - draft * 0.6)) * near);
    this.wind.f.frequency.setTargetAtTime(250 + v * 45, t, 0.2);
    const paved = surf === 'asphalt' || surf === 'smooth' || surf === 'rough' || surf === 'wet';
    set(this.roll, Math.min(0.35, v * 0.012) * near * (paved ? 1 : 0.5));
    this.roll.f.frequency.setTargetAtTime(380 + v * 30, t, 0.2);
    set(this.rumble, (surf.startsWith('cobbles') ? Math.min(0.8, v * 0.06) : surf === 'rough' ? v * 0.01 : 0) * near);
    set(this.crunch, (surf.startsWith('gravel') || surf === 'dirt' ? Math.min(0.25, v * 0.02) : 0) * near);
    const wx = W.weather;
    set(this.rain, wx ? Math.min(0.5, wx.rain * 0.55) : 0, 0.8);
    set(this.crowd, Math.min(0.6, (app.riders && app.riders.crowdNear || 0) * 0.015), 0.6);
    // roue libre : cliquetis quand on ne pédale pas
    if ((me.P === undefined ? false : me.P < 15) && v > 2 && near > 0.5) {
      this.clickT -= dt;
      if (this.clickT <= 0) { this._click(0.03); this.clickT = 0.6 / (v * 1.2); }
    }
    // tonnerre : après chaque éclair, avec un retard selon la distance
    const A = W.atmo;
    if (A.thunder) { this._thunder(A.thunder); A.thunder = 0; }
  }
}
