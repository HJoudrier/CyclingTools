/* Wattlas — vecteurs de référence pour le moteur porté en C# (projet Unity, VirtualRideUnity/Wattlas).
 *
 * Charge le moteur JavaScript comme les tests du site (tests/helpers.js), joue des cas types et écrit entrées et sorties
 * dans un fichier JSON. Les tests C# (Assets/_Wattlas/Tests/Domaine) relisent ce fichier et comparent leurs résultats :
 * si le moteur JavaScript change, on relance ce script et les tests C# montrent tout de suite l'écart.
 *
 *   node VirtualRideUnity/outils/vecteurs.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { PYR } = require(path.join(__dirname, '..', '..', 'tests', 'helpers.js'));

const Ph = PYR.physics, Ca = PYR.catalog, Si = PYR.sim, Pi = PYR.physio;
const sortie = path.join(__dirname, '..', 'Wattlas', 'Assets', '_Wattlas', 'Tests', 'Domaine', 'Vecteurs', 'physique.json');

const out = { source: 'Commun/js/engine (physics.js, catalog.js, sim.js, physio.js)', densite: [], densiteHumide: [], surfaceFrontale: [],
  reglages: [], puissance: [], vitesse: [], acceleration: [], roulage: [], wprime: [], recuperation: [] };

for (const alt of [0, 500, 1500, 2800]) for (const t of [-5, 15, 32]) out.densite.push({ alt, t, rho: Ph.airDensity(alt, t) });
for (const [alt, t, rh, p] of [[0, 20, 50, 1013.25], [1200, 8, 90, 1020], [2500, 30, 10, 1005], [300, 25, 100, 998]]) {
  out.densiteHumide.push({ alt, t, rh, p, rho: Ph.airDensityHumid(alt, t, rh, p) });
}
for (const h of [160, 178, 192]) for (const m of [55, 72, 90]) out.surfaceFrontale.push({ taille: h, masse: m, a: Ph.frontalRef(h, m) });

// réglages complets : sélection du magasin + cycliste
const selections = [
  {},
  { frame: 'aero', wheels: 'c45', tires: 'race', kit: 'aero', helmet: 'aero', glasses: 'shield', socks: 'aero', shoes: 'carbon', drivetrain: 'wax' },
  { frame: 'tt', wheels: 'disc', tires: 'tubeless', suit: 'tt', helmet: 'tt', shoes: 'aero', shave: 'full' },
  { frame: 'gravel', wheels: 'gravel', tires: 'gravel', kit: 'loose', helmet: 'city', glasses: 'none', socks: 'short', shoes: 'mtb' },
  { frame: 'climber', wheels: 'climb', tires: 'road', suit: 'road', shave: 'legs' },
];
const cyclistes = [
  { weight: 72, height: 178, position: 'hoods' },
  { weight: 58, height: 165, position: 'drops' },
  { weight: 85, height: 190, position: 'tt_pro' },
  { weight: 66, height: 172, position: 'upright' },
];
const setups = [];
selections.forEach((sel, i) => {
  const cy = cyclistes[i % cyclistes.length];
  const { rider, bike } = Ca.fullSetup(sel, Object.assign({}, cy), {});
  const S = Ph.buildSetup(rider, bike);
  setups.push(S);
  out.reglages.push({ selection: sel, cycliste: cy, mass: S.mass, massEff: S.massEff, wheelMass: S.wheelMass, aRef: S.aRef, cda: S.cda,
    crr: S.crr, eta: S.eta, fMax: S.fMax, vSpin: S.vSpin });
});

// régime établi
setups.slice(0, 3).forEach((S, i) => {
  for (const v of [3, 8, 12, 15]) for (const g of [-0.05, 0, 0.03, 0.08]) for (const [cf, rho, wh, wc] of [[1, 1.2, 0, 0], [2.2, 1.1, 3, 2]]) {
    out.puissance.push({ reglage: i, v, pente: g, crrK: cf, rho, ventFace: wh, ventTravers: wc, P: Ph.steadyPower(S, v, g, cf, rho, wh, wc) });
  }
  for (const P of [100, 250, 400]) for (const g of [-0.04, 0, 0.05]) {
    out.vitesse.push({ reglage: i, P, pente: g, crrK: 1, rho: 1.18, ventFace: 0, ventTravers: 0, v: Ph.steadySpeed(S, P, g, 1, 1.18, 0, 0) });
  }
});

// accélération instantanée (sim.accel)
function cond(g, crrK, rho, wh, wc, S) {
  const th = Math.atan(g);
  return { rho, wh, wc, sinT: Math.sin(th), cosT: Math.cos(th), crr: S.crr * crrK, cdaK: 1 };
}
setups.slice(0, 2).forEach((S, i) => {
  for (const v of [0, 0.3, 5, 11]) for (const P of [0, 150, 900]) for (const g of [0, 0.06]) {
    out.acceleration.push({ reglage: i, v, P, pente: g, crrK: 1, rho: 1.2, ventFace: 1.5, ventTravers: 0, a: Si.accel(S, v, P, cond(g, 1, 1.2, 1.5, 0, S)) });
  }
});

// roulage : intégration de Heun à sous-pas, comme sim.step (sans plafond de puissance, sans freinage)
function rouler(S, P, g, wh, n, duree, v0) {
  const c = cond(g, 1, 1.2, wh, 0, S), h = 1 / n, vMin = 1.0;
  let v = v0, s = 0;
  const points = [];
  for (let t = 0; t < duree; t++) {
    for (let q = 0; q < n; q++) {
      const b1 = Si.accel(S, v, P, c);
      let w1 = v + h * b1; if (w1 < 0) w1 = 0;
      const b2 = Si.accel(S, w1, P, c);
      let w = v + 0.5 * h * (b1 + b2); if (w < 0) w = 0;
      if (w < vMin && P > 20) w = vMin;
      s += 0.5 * (v + w) * h; v = w;
    }
    if ([1, 10, 60, duree].includes(t + 1)) points.push({ t: t + 1, v, s });
  }
  return points;
}
for (const [i, P, g, wh, n, v0] of [[0, 250, 0, 0, 4, 0], [1, 400, 0.02, 2, 4, 5], [0, 180, 0.08, 0, 2, 3], [2, 0, -0.06, 0, 4, 8], [0, 15, 0.12, 0, 4, 2]]) {
  out.roulage.push({ reglage: i, P, pente: g, ventFace: wh, sousPas: n, v0, duree: 120, points: rouler(setups[i], P, g, wh, n, 120, v0) });
}

// W′ (modèle de Skiba) et récupération selon l'âge
let w = 20000;
for (const P of [400, 400, 380, 150, 150, 0, 300, 250]) {
  const avant = w;
  w = Pi.wbalStep(w, P, 280, 20000, 1, 0.92);
  out.wprime.push({ avant, P, cp: 280, w0: 20000, dt: 1, recF: 0.92, apres: w });
}
for (const age of [18, 30, 45, 70, 0]) out.recuperation.push({ age, recF: Pi.ageRecoveryFactor(age) });

fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, JSON.stringify(out, null, 1) + '\n');
console.log('vecteurs écrits :', path.relative(process.cwd(), sortie),
  Object.entries(out).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${v.length}`).join(', '));
