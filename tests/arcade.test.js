/* author : Hugo Joudrier-Faure */
/* Tests du niveau Arcade (règle `arcade`, réglage game.realism) : seuls comptent l'intensité de l'effort, le glycogène (endurance) et le W′
 * (effort court) ; ni chaleur, ni courbe de puissance record, ni hydratation. Et la FC simple (fuel.js), sans le modèle physiologique. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor, DEFAULT_RIDER, DEFAULT_BIKE } = require('./helpers.js');

const Race = PYR.race, Fu = PYR.fuel, Sim = PYR.sim, Tac = PYR.tactics;

function newRace(rules, len) {
  const { course, setup, athlete } = setupFor(makeProfile([{ len: len || 6000, grade: 0 }]));
  const race = Race.create({ course, rules, seed: 11, gustSeed: 1 });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0: 8, rider: DEFAULT_RIDER });
  return { race, me, athlete };
}

test('règles : le niveau Arcade impose l\'énergie et écarte le modèle physiologique', () => {
  const a = Race.normRules({ realism: 'arcade', fuel: false, physio: true });
  assert.equal(a.arcade, true);
  assert.equal(a.fuel, true);
  assert.equal(a.physio, false);
  assert.equal(Race.normRules({ arcade: true }).arcade, true);
  const s = Race.normRules({ realism: 'simulation', fuel: true, physio: true });
  assert.equal(s.arcade, false);
  assert.equal(s.physio, true);
  assert.equal(Race.normRules({}).arcade, false);
});

test('Arcade : pas de courbe de puissance record, seule la puissance maximale et le W′ limitent', () => {
  const { me, athlete } = newRace({ realism: 'arcade' });
  assert.deepEqual(Array.from(me.ctx.win), [1]);
  assert.ok(me.fuel && me.fuel.arcade && !me.fuel.phy, 'énergie Arcade, sans modèle physiologique');
  // l'enveloppe d'un effort maximal reste à la puissance maximale
  assert.ok(Math.abs(me.ctx.env[600] - athlete.mmp(1)) < 1);
  // la durée tenable ne vient que du W′ (ou de la fringale)
  const tte = Race.timeToExhaustion(me, 1.2 * me.ctx.cp);
  assert.notEqual(tte.by, 'record');
  const sim = newRace({ fuel: true });
  assert.ok(sim.me.ctx.win.length > 10, 'Simulation : la courbe record limite toujours');
});

test('Arcade : la chaleur ne réduit pas la capacité, en Simulation si', () => {
  const orig = Sim.conditions;
  Sim.conditions = function (ctx, s, t, c) { orig.apply(this, arguments); c.heatK = 0.8; c.Tapp = 38; };
  try {
    const a = newRace({ realism: 'arcade' });
    const b = newRace({ fuel: true });
    for (let i = 0; i < 5; i++) { Race.step(a.race); Race.step(b.race); }
    assert.ok(a.me.st.capK > 0.99, `Arcade : capK ${a.me.st.capK}`);
    assert.ok(b.me.st.capK < 0.85, `Simulation : capK ${b.me.st.capK}`);
  } finally { Sim.conditions = orig; }
});

test('Arcade : ni sueur ni boisson, pour le joueur comme pour les coureurs virtuels', () => {
  const { race, me } = newRace({ realism: 'arcade' }, 15000);
  const bots = Race.addBots(race, { n: 3, level: 'equal', rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 8 });
  Tac.setMode(me, 'manual', 0);
  me.tac.cmd = 1.0 * me.ctx.cp;
  for (let i = 0; i < 900; i++) Race.step(race);
  for (const r of [me, ...bots]) {
    const s = Fu.status(r.fuel);
    assert.equal(s.hydration, 1, `${r.name} : hydratation ${s.hydration}`);
    assert.equal(r.fuel.deficit, 0);
    assert.ok(s.energy < 1, `${r.name} : le glycogène baisse`);
  }
  assert.equal(Fu.drink(me.fuel, me.st.t), 0, 'pas de boisson en Arcade');
});

test('Arcade : manger fait remonter l\'endurance en moins d\'une minute', () => {
  const f = Fu.create(72, { arcade: true });
  f.G = 0.5 * f.G0;
  const g0 = f.G;
  assert.equal(Fu.eat(f, 100, 'gel'), 'gel');
  for (let i = 0; i < 40; i++) Fu.step(f, 0, 250, 20);
  assert.equal(f.fast, 0, 'tout le gel est passé');
  assert.ok(f.G - g0 > 20, `+${(f.G - g0).toFixed(1)} g en 40 s`);
  // la durée avant la fringale tient compte de la réserve rapide
  f.G = 0.3 * f.G0;
  const before = Fu.timeToBonk(f, 250, 250);
  Fu.eat(f, 200, 'bar');
  assert.ok(Fu.timeToBonk(f, 250, 250) > before);
});

test('FC simple : elle suit l\'intensité avec retard, entre la FC de repos et la FC maximale', () => {
  const f = Fu.create(72, { arcade: true, hrRest: 50, hrMax: 190 });
  assert.equal(Fu.status(f).hr, 50);
  for (let i = 0; i < 10; i++) Fu.step(f, 250, 250, 20);
  const early = Fu.status(f).hr;
  for (let i = 0; i < 600; i++) Fu.step(f, 250, 250, 20);
  const steady = Fu.status(f).hr;
  assert.ok(early > 50 && early < steady, `FC après 10 s : ${early}, après 10 min : ${steady}`);
  assert.ok(steady > 170 && steady <= 190, `FC à la PC : ${steady}`);
  for (let i = 0; i < 600; i++) Fu.step(f, 500, 250, 20);
  assert.ok(Fu.status(f).hr <= 190, 'jamais au-delà de la FC maximale');
  for (let i = 0; i < 900; i++) Fu.step(f, 0, 250, 20);
  assert.ok(Fu.status(f).hr < 90, `retour au calme : ${Fu.status(f).hr}`);
  // en Simulation sans modèle physiologique, la même FC simple est donnée
  const g = Fu.create(72, {});
  for (let i = 0; i < 300; i++) Fu.step(g, 200, 250, 20);
  assert.ok(Fu.status(g).hr > 100);
});

test('Arcade : la FC du coureur suit les bornes de son profil', () => {
  const rider = Object.assign({}, DEFAULT_RIDER, { age: 40, physio: { hrRest: 48, hrMax: 182 } });
  const { course, setup, athlete } = setupFor(makeProfile([{ len: 3000, grade: 0 }]));
  const race = Race.create({ course, rules: { realism: 'arcade' }, seed: 3, gustSeed: 1 });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0: 8, rider });
  assert.equal(me.fuel.hrRest, 48);
  assert.equal(me.fuel.hrMax, 182);
  const other = Race.addRider(race, { id: 'o', name: 'Autre', setup, athlete, v0: 8, rider: Object.assign({}, DEFAULT_RIDER, { age: 40 }) });
  assert.equal(other.fuel.hrMax, Math.round(208 - 0.7 * 40));
});
