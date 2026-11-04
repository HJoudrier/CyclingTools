/* Virtual Ride 3D Réaliste — manette (API Gamepad : manettes Xbox, PlayStation, et le navigateur des consoles de salon). Les commandes
   sont renvoyées au jeu comme les touches du clavier (bridge.js) ou à la démonstration (demo.js) :
     gâchette droite / gauche : puissance + / − (plus on appuie, plus ça monte vite) ; croix ↑ ↓ : ±10 W (±50 W avec LB) ;
     croix ← → : changer de place sur la route ; A : sprint ; B : roue libre ; X : manger ; L3 : boire ; R3 : ravitaillement ;
     RB : tactique suivante (1 → 9) ; Y : caméra ; Vue (Back) : pilote automatique ; Menu (Start) : pause. */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const k = (key, code, shift) => ({ key, code, shift: !!shift });

export class Pad {
  constructor() {
    this.prev = [];
    this.repeat = {};
    this.trig = 0;
    this.tactic = 0;
    this.connected = false;
    window.addEventListener('gamepadconnected', (e) => {
      this.connected = true;
      const app = window.VR3R;
      if (app && app.toast) app.toast('🎮 Manette connectée<small>gâchettes : puissance · croix : ±10 W et place · Y : caméra</small>', 3200);
      this.id = e.gamepad && e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', () => { this.connected = false; });
  }

  poll(dt, driver) {
    if (!this.connected || !navigator.getGamepads || !driver || !driver.pad) return;
    const pads = navigator.getGamepads();
    const gp = [...pads].find((p) => p && p.connected && p.mapping === 'standard') || [...pads].find((p) => p && p.connected);
    if (!gp) return;
    const b = gp.buttons.map((x) => (typeof x === 'object' ? x.value : x));
    const pressed = (i) => b[i] > 0.5 && !(this.prev[i] > 0.5);
    const held = (i) => b[i] > 0.5;
    // croix ↑ ↓ avec répétition quand on la maintient
    const rep = (i, fn) => {
      if (!held(i)) { this.repeat[i] = 0; return; }
      if (pressed(i)) { fn(); this.repeat[i] = 0.45; return; }
      this.repeat[i] -= dt;
      if (this.repeat[i] <= 0) { fn(); this.repeat[i] = 0.12; }
    };
    const big = held(BTN.LB);
    rep(BTN.UP, () => driver.pad('power', big ? 50 : 10));
    rep(BTN.DOWN, () => driver.pad('power', big ? -50 : -10));
    if (pressed(BTN.LEFT)) driver.pad('lane', -1);
    if (pressed(BTN.RIGHT)) driver.pad('lane', 1);
    // gâchettes : rythme des pas de 10 W selon l'appui
    const t = (b[BTN.RT] || 0) - (b[BTN.LT] || 0);
    if (Math.abs(t) > 0.15) {
      this.trig -= dt;
      if (this.trig <= 0) { driver.pad('power', t > 0 ? 10 : -10); this.trig = 0.26 - 0.2 * Math.min(1, Math.abs(t)); }
    } else this.trig = 0;
    if (pressed(BTN.Y)) driver.pad('camera');
    const send = (kk) => driver.pad('key', kk);
    if (pressed(BTN.A)) send(k('s', 'KeyS'));
    if (pressed(BTN.B)) send(k('0', 'Digit0'));
    if (pressed(BTN.X)) send(k('m', 'KeyM'));
    if (pressed(BTN.L3)) send(k('b', 'KeyB'));
    if (pressed(BTN.R3)) send(k('r', 'KeyR'));
    if (pressed(BTN.BACK)) send(k('a', 'KeyA'));
    if (pressed(BTN.START)) send(k(' ', 'Space'));
    if (pressed(BTN.RB)) { this.tactic = this.tactic % 9 + 1; send(k(String(this.tactic), 'Digit' + this.tactic)); }
    this.prev = b;
  }
}
