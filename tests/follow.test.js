/* author : Hugo Joudrier-Faure */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor, DEFAULT_RIDER, DEFAULT_BIKE } = require('./helpers.js');

const Race = PYR.race, Tac = PYR.tactics, Pel = PYR.peloton, Dr = PYR.draft;

/** Le joueur en « Dans les roues » dans un peloton de coureurs virtuels, sur un parcours vallonné ; renvoie ses consignes seconde par seconde. */
function playerInPack(seed, T) {
  const segs = [];
  for (let i = 0; i < 6; i++) segs.push({ len: 1500, grade: 0 }, { len: 800, grade: 0.04 }, { len: 800, grade: -0.03 }, { len: 1000, grade: 0.01 });
  const { course, setup, athlete } = setupFor(makeProfile(segs), { surfaces: [], winds: [] }, { temperature: 20, roadWidth: 6 });
  const race = Race.create({ course, rules: { peloton: true }, seed, gustSeed: 1 });
  Race.addBots(race, { n: 25, level: 'mixed', rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 8 });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0: 8 });
  Pel.grid(race); race.riders.forEach((r) => { r.st.s += 200; r.prevS = r.st.s; });
  Tac.setMode(me, 'follow', 0);
  const P = []; let sheltered = 0;
  for (let t = 0; t < T; t++) { Race.step(race); P.push(me.lastP); if (me.draft && me.draft.k < 0.9) sheltered++; }
  return { P, sheltered, athlete };
}

test('dans les roues (peloton) : l\'effort est lissé, sans enchaînement 0 W / pic au-dessus de la PC', () => {
  let jumps = 0, sheltered = 0, total = 0;
  for (const seed of [1, 2, 3, 5, 7, 9]) {
    const { P, sheltered: sh, athlete } = playerInPack(seed, 600);
    for (let i = 1; i < P.length; i++) if (Math.abs(P[i] - P[i - 1]) > 150) jumps++;
    // jamais plus que l'effort maximal « dans les roues » (1,3 × PMA)
    assert.ok(Math.max(...P) <= 1.3 * athlete.mmp(180) + 1, `pic ${Math.round(Math.max(...P))} W`);
    sheltered += sh; total += P.length;
  }
  // avant : plus de 350 sauts de plus de 150 W sur ces 3 600 s ; ici quelques dizaines (reprise d'une roue qui s'échappe, relances en bosse)
  assert.ok(jumps <= 60, `${jumps} sauts de plus de 150 W en 3 600 s`);
  assert.ok(sheltered > 0.7 * total, `abrité ${sheltered} s sur ${total}`);
});

test('dans les roues : une roue qui s\'éloigne un peu fait monter la puissance doucement, sans pic', () => {
  const { course, setup, athlete } = setupFor(makeProfile([{ len: 8000, grade: 0 }]));
  const race = Race.create({ course, rules: { peloton: true }, seed: 7, gustSeed: 1 });
  const lead = Race.addRider(race, { id: 'lead', name: 'A', setup, athlete, v0: 10 });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0: 10 });
  lead.st.s = 30; me.st.s = 27; Pel.setY(me, 0.75);          // 1,2 m de trop entre les roues
  Tac.setMode(lead, 'threshold', 0);
  Tac.setMode(me, 'follow', 0);
  let pMax = 0, pPrev = null, dMax = 0;
  for (let i = 0; i < 90; i++) { Race.step(race); pMax = Math.max(pMax, me.lastP); if (pPrev !== null) dMax = Math.max(dMax, Math.abs(me.lastP - pPrev)); pPrev = me.lastP; }
  const gap = lead.st.s - me.st.s - Dr.BIKE;
  assert.ok(gap > 0 && gap < 1.5, `écart final ${gap.toFixed(2)} m`);
  assert.ok(pMax < 1.1 * athlete.cp + 60, `pas de pic : ${Math.round(pMax)} W (PC ${Math.round(athlete.cp)} W)`);
  assert.ok(dMax < 150, `variation maximale ${Math.round(dMax)} W d'une seconde à l'autre`);
});

test('dans les roues : la roue ralentit, la puissance baisse avec elle, sans freiner ni toucher la roue, et sans pic ensuite', () => {
  const { course, setup, athlete } = setupFor(makeProfile([{ len: 8000, grade: 0 }]));
  const race = Race.create({ course, rules: { peloton: true }, seed: 7, gustSeed: 1 });
  const lead = Race.addRider(race, { id: 'lead', name: 'A', setup, athlete, v0: 10.4 });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup, athlete, v0: 10.4 });
  lead.st.s = 30; me.st.s = 27.6; Pel.setY(me, 0.75);
  Tac.setMode(lead, 'threshold', 0);
  Tac.setMode(me, 'follow', 0);
  let pBefore = 0, pMin = Infinity, brakes = 0, pAfter = 0, closest = Infinity;
  for (let i = 0; i < 120; i++) {
    if (i === 20) Tac.setMode(lead, 'recover', race.t);     // la roue passe de 250 W à 125 W : on arrive dessus
    Race.step(race);
    if (i === 19) pBefore = me.lastP;
    if (i >= 20) {
      pMin = Math.min(pMin, me.lastP);
      if (me.st.braking) brakes++;
      closest = Math.min(closest, lead.st.s - me.st.s - Dr.BIKE);
      if (i >= 60) pAfter = Math.max(pAfter, me.lastP);
    }
  }
  assert.ok(pMin < 0.6 * pBefore, `la puissance baisse avec la roue : ${Math.round(pBefore)} W puis ${Math.round(pMin)} W`);
  assert.ok(brakes <= 3, `${brakes} s de freinage`);
  assert.ok(closest > -0.5, `les roues ne se chevauchent pas : ${closest.toFixed(2)} m`);
  assert.ok(pAfter < 1.05 * athlete.cp, `ensuite pas de pic : ${Math.round(pAfter)} W`);
});
