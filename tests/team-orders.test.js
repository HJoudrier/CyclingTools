/* author : Hugo Joudrier-Faure */
/* Tests des ordres du joueur à ses équipiers (race.giveOrder, Course 3D) et des tactiques « Remonter en tête » et « Rouler en tête ». */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor, DEFAULT_RIDER, DEFAULT_BIKE } = require('./helpers.js');

const TG = PYR.teamGame, Race = PYR.race, Pel = PYR.peloton, Tac = PYR.tactics;

function teamRace(o) {
  const { len = 12000, seed = 3, size = 6, opp = 3 } = o || {};
  const { course } = setupFor(makeProfile([{ len, grade: 0 }]));
  const race = Race.create({ course, rules: { peloton: true, strategy: true }, seed, gustSeed: 1 });
  const cfg = { team: 'UAE', riders: ['pro:tadej-pogacar', 'pro:joao-almeida', 'pro:adam-yates', 'pro:brandon-mcnulty'], opp, size };
  const res = TG.populate(race, { cfg, rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 0 });
  Pel.grid(race);
  return { race, res };
}

const run = (race, n) => { for (let i = 0; i < n; i++) Race.step(race); };
// place dans son groupe à la seconde écoulée (0 : en tête)
const rankIn = (race, r) => (r.draft && r.draft.groupSize > 1 ? r.draft.rank : 0);

test('ordre : allure libre à 90 % de la PC, sans la stratégie', () => {
  const { course } = setupFor(makeProfile([{ len: 8000, grade: 0 }]));
  const race = Race.create({ course, rules: {}, seed: 5, gustSeed: 1 });
  const [b] = Race.addBots(race, { n: 1, level: 'equal', rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 8 });
  const o = Race.giveOrder(race, b, { mode: 'manual', pct: 90 });
  assert.equal(o.mode, 'manual');
  assert.equal(b.tac.mode, 'manual');
  run(race, 120);
  assert.equal(b.tac.mode, 'manual', 'la tactique des coureurs virtuels ne reprend pas la main');
  assert.ok(Math.abs(b.lastPcmd - 0.9 * b.ctx.cp) < 1, `consigne ${Math.round(b.lastPcmd)} W pour ${Math.round(0.9 * b.ctx.cp)} W`);
  // le joueur ne reçoit pas d'ordre, il pilote
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup: b.setup, athlete: b.athlete, v0: 8 });
  assert.equal(Race.giveOrder(race, me, { mode: 'front' }), null);
});

test('ordre levé : l\'équipier reprend sa stratégie', () => {
  const { race, res } = teamRace();
  run(race, 40);
  const b = res.own[1];
  Race.giveOrder(race, b, { mode: 'manual', pct: 60 });
  run(race, 30);
  assert.equal(b.tac.mode, 'manual');
  Race.clearOrder(race, b);
  assert.equal(b.order, null);
  run(race, 30);
  assert.notEqual(b.tac.mode, 'manual', 'décidé par la stratégie');
});

test('ordre ponctuel : une attaque finie rend l\'ordre d\'avant', () => {
  const { course } = setupFor(makeProfile([{ len: 10000, grade: 0 }]));
  const race = Race.create({ course, rules: {}, seed: 5, gustSeed: 1 });
  const [b] = Race.addBots(race, { n: 1, level: 'equal', rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 8 });
  Race.giveOrder(race, b, { mode: 'manual', pct: 80 });
  Race.giveOrder(race, b, { mode: 'attack' });
  assert.equal(b.tac.mode, 'attack');
  assert.ok(b.order.once && b.order.prev && b.order.prev.mode === 'manual');
  run(race, 5);
  assert.ok(b.lastPcmd > b.ctx.cp, 'à fond pendant l\'attaque');
  run(race, 70);
  assert.ok(b.order && b.order.mode === 'manual' && !b.order.once, 'l\'ordre d\'avant reprend');
  assert.ok(Math.abs(b.tac.cmd - 0.8 * b.ctx.cp) < 1);
});

test('rouler en tête : l\'équipier remonte puis mène son groupe', () => {
  const { race, res } = teamRace({ len: 14000 });
  run(race, 90);
  // le dernier de son équipe, du moins le plus en arrière
  const b = res.own.slice(1).sort((x, y) => x.st.s - y.st.s)[0];
  const r0 = rankIn(race, b);
  Race.giveOrder(race, b, { mode: 'front', pct: 105 });
  let led = 0;
  for (let i = 0; i < 240; i++) {
    Race.step(race);
    if (i > 120 && b.tac.phase === 'pull') led++;
  }
  assert.equal(b.tac.mode, 'front');
  assert.ok(led > 60, `en tête ${led} s sur 120 (place de départ ${r0})`);
});

test('remonter en tête : l\'équipier gagne des places puis reste dans les roues', () => {
  const { race, res } = teamRace({ len: 14000, size: 8, opp: 5 });
  run(race, 120);
  const b = res.own.slice(1).sort((x, y) => (y.draft.rank || 0) - (x.draft.rank || 0))[0];
  const r0 = rankIn(race, b);
  Race.giveOrder(race, b, { mode: 'moveup' });
  let best = r0;
  for (let i = 0; i < 180; i++) { Race.step(race); best = Math.min(best, rankIn(race, b)); }
  assert.ok(r0 > Tac.frontPlaces(b.draft.groupSize || 1), `il part de loin : place ${r0}`);
  assert.ok(best <= Tac.frontPlaces(b.draft.groupSize || 1) + 1, `place ${r0} → ${best}`);
  assert.ok(b.tac.mode === 'follow' || b.tac.mode === 'moveup');
});

test('changement de coureur piloté avec « keep » : celui qu\'on quitte garde sa tactique et son effort', () => {
  const { race, res } = teamRace();
  const [a, b] = res.own;
  run(race, 40);
  Tac.setMode(a, 'manual', a.st.t);
  a.tac.cmd = 0.85 * a.ctx.cp;
  TG.switchTo(race, b.id, { keep: true });
  assert.ok(b.human && !a.human);
  assert.ok(a.order && a.order.mode === 'manual', 'ordre gardé');
  assert.ok(Math.abs(a.order.pct - 85) < 0.5, `effort ${a.order.pct} %`);
  run(race, 20);
  assert.equal(a.tac.mode, 'manual');
  // sans keep, comme avant : rendu à la stratégie
  TG.switchTo(race, a.id);
  assert.equal(a.order, null, 'le coureur piloté n\'a plus d\'ordre');
  assert.ok(!b.order, 'rendu à la stratégie, sans ordre');
});
