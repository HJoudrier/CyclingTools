/* author : Hugo Joudrier-Faure */
/* Wattlas — Course 3D : les commandes de la trajectoire manuelle (engine/steer.js) et de la manette.
 *   - clavier : ← → maintenues (la commande monte en rampe), F pour freiner ; les touches pressées dans la vue 3D arrivent aussi
 *     (keydown et keyup, view3d.js) ;
 *   - manette (Xbox, disposition standard de l'API Gamepad) : stick gauche (direction), gâchette gauche (frein), et les actions
 *     (PAD_ACTIONS) ; lue ici quand la page a le focus, sinon relayée par la vue 3D (message « pad ») ;
 *   - contrôleurs VR : la vue 3D les traduit dans la même disposition (stick gauche, gâchettes, A B X Y, grips) et les relaie ;
 *   - téléphone : l'inclinaison (gyroscope, tilt.js) donne la direction, en continu ; le bouton « Frein » du HUD freine.
 * read(dt) donne la commande {u (−1 à 1, > 0 vers la droite, comme peloton.nudge), brake (0 à 1), source} ; la source qui a bougé en
 * dernier l'emporte. Les boutons de la manette déclenchent les actions du jeu (tab-game.js, hud3d.js). Chargé seulement pour Course 3D. */
(function (PYR) {
  'use strict';

  const Steer = PYR.steer;
  const DEAD = 0.14;           // zone morte des sticks
  const PAD_FRESH = 400;       // ms : une manette relayée par la vue 3D compte tant que son dernier état a moins de 400 ms
  const EFFORT_REPEAT = 220;   // ms : stick droit ou croix tenus vers le haut / le bas : un cran d'effort à cet intervalle

  /** Boutons de la disposition standard → actions (b : indice du bouton). */
  const PAD_ACTIONS = [
    { b: 0, act: 'follow', label: 'A : rester dans les roues' },
    { b: 1, act: 'eat', label: 'B : manger' },
    { b: 2, act: 'cover', label: 'X : suivre les attaques' },
    { b: 3, act: 'front', label: 'Y : rouler en tête' },
    { b: 4, act: 'prev', label: 'LB : coureur précédent' },
    { b: 5, act: 'next', label: 'RB : coureur suivant' },
    { b: 7, act: 'accel', label: 'RT : accélérer (appuie à répétition)' },
    { b: 8, act: 'steer', label: 'View : trajectoire auto ↔ manuelle' },
    { b: 9, act: 'menu', label: 'Menu : menu (pause)' },
    { b: 10, act: 'attack', label: 'L3 : attaquer' },
    { b: 11, act: 'camera', label: 'R3 : caméra' },
    { b: 12, act: 'up', label: 'Croix ↑ : effort +5 %' },
    { b: 13, act: 'down', label: 'Croix ↓ : effort −5 %' },
    { b: 14, act: 'relay', label: 'Croix ← : prendre le relais' },
    { b: 15, act: 'moveup', label: 'Croix → : remonter en tête' },
  ];

  const I = {
    keys: { left: false, right: false, brake: false },
    keyU: 0,
    pad: null,            // dernier état de manette : {axes, buttons (valeurs 0 à 1), src ('gamepad' | 'vr'), at}
    prev: [],             // boutons au dernier état (fronts montants)
    effortAt: 0,
    tilt: null, tiltOn: false, tiltHandler: null,
    brakeBtn: false,
    last: { keys: 0, gamepad: 0, vr: 0, tilt: 0 },
    source: 'keys',
    onAction: null,       // (act) => void : posé par tab-game.js
    vrOn: false,
  };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const val = (b) => (b && typeof b === 'object' ? Number(b.value) || (b.pressed ? 1 : 0) : Number(b) || 0);

  /** Touche (keydown : down vrai, keyup : faux) ; vrai si elle sert à la trajectoire manuelle. */
  I.key = function (key, code, down) {
    const k = code || key;
    if (k === 'ArrowLeft' || key === 'ArrowLeft') I.keys.left = down;
    else if (k === 'ArrowRight' || key === 'ArrowRight') I.keys.right = down;
    else if (k === 'KeyF' || key === 'f' || key === 'F') I.keys.brake = down;
    else return false;
    I.last.keys = now();
    return true;
  };

  /** Relâche tout (perte du focus, pause, changement de mode). */
  I.release = function () {
    I.keys.left = I.keys.right = I.keys.brake = false;
    I.keyU = 0;
    I.brakeBtn = false;
  };

  /** État de manette relayé par la vue 3D (manette quand la vue a le focus, contrôleurs VR) : {src, axes, buttons}. */
  I.padState = function (m) {
    if (!m || !Array.isArray(m.axes) || !Array.isArray(m.buttons)) return;
    const st = { axes: m.axes.slice(0, 4).map((x) => Math.max(-1, Math.min(1, Number(x) || 0))), buttons: m.buttons.slice(0, 17).map((x) => Math.max(0, Math.min(1, Number(x) || 0))), src: m.src === 'vr' ? 'vr' : 'gamepad', at: now() };
    usePad(st);
  };

  /** Manette lue sur cette page (quand elle a le focus) : la première de disposition standard, sinon la première. */
  function pollLocal() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) return;
    let gp = null;
    for (const p of navigator.getGamepads() || []) { if (p && p.connected !== false) { if (p.mapping === 'standard') { gp = p; break; } if (!gp) gp = p; } }
    if (!gp) return;
    usePad({ axes: Array.from(gp.axes || []).slice(0, 4), buttons: Array.from(gp.buttons || []).map(val).slice(0, 17), src: 'gamepad', at: now() });
  }

  /** Nouvel état de manette : actions sur les fronts montants, effort au stick droit, activité de la source. */
  function usePad(st) {
    const t = st.at;
    const b = st.buttons, p = I.prev;
    const moved = Math.abs(st.axes[0] || 0) > DEAD || (b[6] || 0) > 0.1;
    if (moved) I.last[st.src] = t;
    for (const a of PAD_ACTIONS) {
      const on = (b[a.b] || 0) > 0.5, was = (p[a.b] || 0) > 0.5;
      if (on && !was) { I.last[st.src] = t; fire(a.act); if (a.act === 'up' || a.act === 'down') I.effortAt = t + EFFORT_REPEAT * 2; }
      else if (on && (a.act === 'up' || a.act === 'down') && t >= I.effortAt) { fire(a.act); I.effortAt = t + EFFORT_REPEAT; }
    }
    // stick droit vers le haut / le bas : effort, par crans
    const ry = st.axes[3] || 0;
    if (Math.abs(ry) > 0.6 && t >= I.effortAt) { fire(ry < 0 ? 'up' : 'down'); I.effortAt = t + EFFORT_REPEAT; I.last[st.src] = t; }
    I.prev = b.slice();
    I.pad = st;
  }

  function fire(act) {
    if (I.onAction) { try { I.onAction(act); } catch (e) { /* une action refusée ne casse pas la lecture */ } }
  }

  /** Gyroscope (téléphone) : on / off. Sur iPhone, la permission se demande pendant un geste (le toucher du bouton). Renvoie une promesse de l'état. */
  I.setTilt = async function (on) {
    if (!on) {
      if (I.tiltHandler) window.removeEventListener('deviceorientation', I.tiltHandler);
      I.tiltHandler = null; I.tiltOn = false;
      return false;
    }
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
    if (!DOE || !window.isSecureContext) return false;
    if (typeof DOE.requestPermission === 'function') {
      try { if ((await DOE.requestPermission()) !== 'granted') return false; } catch (e) { return false; }
    }
    I.tilt = PYR.tilt.create();
    I.tiltHandler = (e) => {
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      const roll = PYR.tilt.rollFrom(e.alpha, e.beta, e.gamma, ang);
      PYR.tilt.feed(I.tilt, roll, now()); // lissage et neutralité (les crans de feed ne servent pas ici)
      if (Math.abs(PYR.tilt.offset(I.tilt)) > 3) I.last.tilt = now();
    };
    window.addEventListener('deviceorientation', I.tiltHandler);
    I.tiltOn = true;
    return true;
  };

  /** Reprend la posture du téléphone comme neutre (au départ, à la reprise). */
  I.recalibrate = function () { if (I.tilt) PYR.tilt.recalibrate(I.tilt); };

  /** Bouton « Frein » du HUD (téléphone) : maintenu ou relâché. */
  I.setBrakeButton = function (on) { I.brakeBtn = !!on; if (on) I.last.keys = now(); };

  /** Commande du moment : {u (−1 à 1, > 0 vers la droite), brake (0 à 1), source}. dt : secondes réelles depuis la lecture précédente. */
  I.read = function (dt) {
    pollLocal();
    const t = now();
    const dir = (I.keys.right ? 1 : 0) - (I.keys.left ? 1 : 0);
    I.keyU = Steer.keyRamp(I.keyU, dir, dt);
    const padOk = I.pad && t - I.pad.at < PAD_FRESH;
    const padU = padOk ? Steer.axis(I.pad.axes[0] || 0, DEAD) : 0;
    const padB = padOk ? Steer.axis(I.pad.buttons[6] || 0, 0.05) : 0;
    const tiltU = I.tiltOn && I.tilt ? Steer.tiltAxis(PYR.tilt.offset(I.tilt)) : 0;
    // la source qui a bougé en dernier l'emporte (sans geste récent, celle d'avant reste affichée)
    let src = I.source, best = -1;
    for (const k of ['keys', 'gamepad', 'vr', 'tilt']) if (I.last[k] > best && (k !== 'tilt' || I.tiltOn)) { best = I.last[k]; src = k; }
    if (best > 0) I.source = src;
    let u = 0;
    if (src === 'keys') u = I.keyU;
    else if ((src === 'gamepad' || src === 'vr') && padOk) u = padU;
    else if (src === 'tilt') u = tiltU;
    if (Math.abs(I.keyU) > Math.abs(u)) u = I.keyU; // une touche tenue passe toujours
    const brake = Math.max(I.keys.brake || I.brakeBtn ? 1 : 0, padB);
    return { u, brake, source: I.source };
  };

  I.PAD_ACTIONS = PAD_ACTIONS;
  PYR.steerInput = I;

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => { I.keys.left = I.keys.right = I.keys.brake = false; });
    // touche relâchée sur la page (celles relâchées dans la vue 3D arrivent par view3d.js)
    window.addEventListener('keyup', (e) => I.key(e.key, e.code, false));
    // manette : lue aussi en dehors des images de la course (en pause, Menu reprend la partie)
    let timer = null;
    window.addEventListener('gamepadconnected', (e) => {
      if (!timer) timer = setInterval(pollLocal, 60);
      if (I.onAction) I.onAction('pad-on', e.gamepad && e.gamepad.id);
    });
  }
})(globalThis.PYR = globalThis.PYR || {});
