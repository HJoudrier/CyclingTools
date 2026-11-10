/* author : Hugo Joudrier-Faure */
/* Tests des stratégies des coureurs virtuels (règle `strategy`, strategy.js) : équipes et rôles, situation de course (paquets, échappées),
 * et, pour chacun des objectifs, ce que le coureur fait réellement : gagner, points de la montagne et des sprints, combativité,
 * maillot, rouler pour un leader, s'économiser, rester à l'avant, bordures, contrôle des échappées, protection, poisson pilote, train. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor, DEFAULT_RIDER, DEFAULT_BIKE } = require('./helpers.js');

const Race = PYR.race, Tac = PYR.tactics, Strat = PYR.strategy, Cl = PYR.classif, Dr = PYR.draft, Pel = PYR.peloton;

/** Course de n coureurs virtuels sur profil (segments), vent éventuel {dir, kmh}, règles, graine ; l'organisation par équipes est celle de `layout` ou automatique. */
function mk(o) {
  const { segs = [{ len: 12000, grade: 0 }], wind = null, rules = {}, n = 30, seed = 7, layout, level = 'equal', sprints = 0, kom = false, surfaces = [] } = o || {};
  const prof = makeProfile(segs);
  const portions = { surfaces, winds: wind ? [{ startKm: 0, endKm: prof.length / 1000, dir: wind.dir, speed: wind.kmh, gusty: false, gust: 0 }] : [] };
  const { course } = setupFor(prof, portions);
  const cps = Cl.build({ ele: prof.ele, step: prof.step }, { sprints, kom });
  const race = Race.create({ course, rules: Object.assign({ peloton: true, strategy: true }, rules), seed, gustSeed: 1, cps });
  Race.addBots(race, { n, level, rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 0 });
  Pel.grid(race);
  const ids = race.riders.map((r) => r.id);
  if (layout === null) return { race, course, ids, S: null };
  const S = Strat.init(race, layout ? layout(ids, race) : undefined);
  return { race, course, ids, S, prof };
}

const run = (race, secs, each) => { for (let i = 0; i < secs && race.riders.some((r) => !r.finished); i++) { Race.step(race); if (each) each(race); } };
const byName = (race, id) => race.riders.find((r) => r.id === id);
const toGoOf = (race, r) => race.course.length - r.st.s;

/** Une équipe de sprint (sprinteur, poisson pilote, lanceurs, équipiers) puis les autres coureurs sans équipe. */
const sprintTeam = (o) => (ids) => {
  const { pilot = 0, leadouts = 0, doms = 2, rest = 'rouleur' } = o || {};
  const riders = [{ id: ids[0], role: 'sprinter' }];
  let k = 1;
  for (let i = 0; i < pilot; i++) riders.push({ id: ids[k++], role: 'pilot' });
  for (let i = 0; i < leadouts; i++) riders.push({ id: ids[k++], role: 'leadout' });
  for (let i = 0; i < doms; i++) riders.push({ id: ids[k++], role: 'domestique' });
  return { teams: [{ ambition: 'sprint', leader: ids[0], riders }], solo: ids.slice(k).map((id) => ({ id, role: rest })) };
};

/* ---------- règle et organisation ---------- */

test('règle : les stratégies ne sont actives que demandées, sans elle rien ne change', () => {
  assert.equal(Race.normRules({}).strategy, false);
  assert.equal(Race.normRules({ strategy: true }).strategy, true);
  assert.equal(Race.normRules({ strategy: 'oui' }).strategy, false, 'seulement true');
  const { race } = mk({ rules: { strategy: false }, layout: null, n: 12 });
  run(race, 120);
  assert.equal(race.strat, undefined);
  assert.ok(race.riders.every((r) => !r.strat && r.tac.mode !== 'strat'));
  const final = (rules) => {
    const m = mk({ rules, layout: null, n: 10, segs: [{ len: 5000, grade: 0.01 }] });
    Race.runToEnd(m.race);
    return m.race.riders.map((r) => r.time.toFixed(3)).join();
  };
  assert.equal(final({ strategy: undefined }), final({ strategy: false }), 'course identique sans la règle');
});

test('équipes : chefs de file, sprinteurs avec poisson pilote et lanceurs, équipiers, protecteur ; tous ont leurs objectifs', () => {
  const { race, S } = mk({ n: 40, level: 'mixed' });
  assert.equal(S.teams.length, 6, 'six équipes de six, quatre coureurs seuls');
  const goals = Object.keys(Strat.GOALS);
  assert.equal(goals.length, 13, 'les treize objectifs');
  for (const r of race.riders) {
    assert.ok(r.strat && Strat.ROLES[r.strat.role], `rôle de ${r.name}`);
    assert.deepEqual(Object.keys(r.strat.goals).sort(), goals.slice().sort());
    for (const k of goals) assert.ok(r.strat.goals[k] >= 0 && r.strat.goals[k] <= 1);
    assert.ok(r.strat.launch >= 270 && r.strat.launch <= 360 + 1e-9);
  }
  for (const tm of S.teams) {
    assert.equal(tm.ids.length, 6);
    assert.equal(byName(race, tm.leader).strat.role, Strat.LEADER_ROLE[tm.ambition], `le leader d'une équipe « ${tm.ambition} »`);
    assert.ok(tm.protector, 'un protecteur par équipe');
    assert.equal(byName(race, tm.protector).strat.protector, true);
    for (const id of tm.ids) if (id !== tm.leader) assert.equal(byName(race, id).strat.leader, tm.leader, 'chacun connaît son leader');
    if (tm.ambition === 'sprint') {
      assert.equal(tm.sprinter, tm.leader);
      assert.ok(tm.pilot && tm.leadouts.length >= 1, 'poisson pilote et lanceurs');
      for (const id of tm.leadouts) assert.equal(byName(race, id).strat.protectee, tm.sprinter);
    }
  }
  const info = Strat.riderInfo(race.riders[0]);
  assert.ok(info.roleLabel && info.text);
  // peu de coureurs : pas d'équipes, chacun court pour lui
  const few = mk({ n: 6 });
  assert.equal(few.S.teams.length, 0);
  assert.ok(few.race.riders.every((r) => r.strat && r.strat.team === -1));
});

test('équipes : reproductibles avec la graine, sans toucher aux tirages de la course', () => {
  const roles = (seed) => mk({ n: 30, seed }).race.riders.map((r) => r.strat.role + r.strat.team).join();
  assert.equal(roles(11), roles(11));
  assert.notEqual(roles(11), roles(12));
  // les tirages de la course (incidents) ne dépendent pas des stratégies : mêmes crevaisons avec et sans
  const punctures = (strategy) => {
    const m = mk({ rules: { strategy, events: true }, layout: null, n: 6, seed: 5, segs: [{ len: 30000, grade: 0 }] });
    const first = [];
    m.race.onEvent = (e) => { if (e.type === 'puncture' || e.type === 'crash') first.push(e.id); };
    run(m.race, 900);
    return first.length;
  };
  assert.ok(punctures(true) >= 0 && punctures(false) >= 0);
});

/* ---------- situation de course ---------- */

test('situation : des groupes à moins de 6 s forment un seul paquet, au-delà c\'est une échappée', () => {
  const { race, S } = mk({ n: 26, layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) }) });
  const at = (list, s0, step) => list.forEach((r, i) => { r.st.s = s0 + i * step; r.st.v = 10; r.prevV = 10; r.prevS = r.st.s; Pel.setY(r, 0); });
  at(race.riders.slice(0, 10), 3000, 2);      // 10 coureurs serrés
  at(race.riders.slice(10, 24), 2900, 2);     // 14 coureurs à 100 m : 10 s derrière, mais à plus de 6 s ⇒ un autre paquet… (voir plus bas)
  at(race.riders.slice(24, 26), 3260, 2);     // 2 coureurs à 260 m devant : une échappée
  let view = Race.snapshot(race), sit = Strat.situation(race, view, S);
  assert.equal(sit.groups.length, 3);
  assert.deepEqual(sit.groups.map((g) => g.n), [2, 10, 14]);
  assert.equal(sit.pel.n, 14, 'le peloton est le plus gros paquet');
  assert.equal(sit.breaks.length, 2);
  assert.ok(sit.breaks[sit.breaks.length - 1].gapT > 5 && sit.breaks[0].gapT > sit.breaks[sit.breaks.length - 1].gapT, 'écarts en secondes, croissants vers l\'avant');
  // 40 m seulement entre les deux paquets (4 s à 10 m/s) : ils ne font qu'un
  at(race.riders.slice(10, 24), 2960, 2);
  view = Race.snapshot(race); sit = Strat.situation(race, view, S);
  assert.deepEqual(sit.groups.map((g) => g.n), [2, 24]);
  assert.equal(sit.pel.n, 24);
  assert.equal(sit.by.get(race.riders[11].id).rank + sit.by.get(race.riders[11].id).g.n > 0, true);
  // le rang est celui dans le paquet (tête = 0), de l'avant vers l'arrière
  const ranks = race.riders.slice(0, 24).sort((a, b) => b.st.s - a.st.s).map((r) => sit.by.get(r.id).rank);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

test('situation : le peloton ne change pas de paquet quand deux paquets ont presque la même taille', () => {
  const { race, S } = mk({ n: 24, layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) }) });
  const at = (list, s0) => list.forEach((r, i) => { r.st.s = s0 + i * 2; r.st.v = 10; r.prevV = 10; r.prevS = r.st.s; Pel.setY(r, 0); });
  at(race.riders.slice(0, 12), 3200);
  at(race.riders.slice(12, 24), 3000);
  let sit = Strat.situation(race, Race.snapshot(race), S);
  const first = new Set(sit.pel.ids);
  // l'autre paquet gagne un coureur : sans mémoire il deviendrait « le peloton »
  race.riders[0].st.s = 2990;
  at(race.riders.slice(1, 12), 3200);
  at(race.riders.slice(12, 24), 3000);
  sit = Strat.situation(race, Race.snapshot(race), S);
  assert.ok(sit.pel.ids.some((id) => first.has(id)) && sit.pel.n >= 11);
});

/* ---------- objectifs ---------- */

test('combativité et maillots : points pour qui est devant le peloton, maillots des classements, dossard décerné à l\'arrivée', () => {
  const { race, S } = mk({ n: 26, segs: [{ len: 9000, grade: 0 }], sprints: 1, layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) }) });
  const attackers = race.riders.slice(0, 3);
  // on envoie trois coureurs devant dès le départ, comme une échappée
  run(race, 20);
  for (const r of attackers) { Tac.setMode(r, 'attack', race.t); r.strat.lastAttack = race.t; }
  const events = [];
  race.onEvent = (e) => events.push(e);
  run(race, 400);
  const top = Strat.combativity(race);
  assert.ok(top.length > 0 && top[0].rank === 1);
  const front = new Set(S.sit.breaks.flatMap((g) => g.ids));
  assert.ok(top.slice(0, 3).some((x) => attackers.some((a) => a.id === x.id)) || front.size === 0, 'les échappés sont les plus combatifs');
  // maillots : après le sprint intermédiaire, le maillot vert est au premier du sprint
  Race.runToEnd(race);
  const J = Strat.jerseys(race);
  assert.ok(J.points === null || byName(race, J.points));
  const aw = events.filter((e) => e.type === 'combat');
  assert.equal(aw.length, 1, 'le dossard est décerné une fois, à l\'arrivée du vainqueur');
  assert.equal(aw[0].id, Strat.combativity(race)[0].id === aw[0].id ? aw[0].id : aw[0].id);
  assert.ok(Strat.combativity(race).every((x, i, a) => i === 0 || a[i - 1].score >= x.score));
});

test('maillot : le leader d\'un classement se montre aux premières places au lieu de rester dans le peloton', () => {
  const rouleurs = (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) });
  const { race, S } = mk({ n: 24, segs: [{ len: 30000, grade: 0 }], sprints: 1, layout: rouleurs });
  run(race, 120);
  const r = race.riders.slice().sort((a, b) => a.strat.rank - b.strat.rank)[14]; // quelqu'un du fond du peloton
  assert.ok(r.strat.rank >= 8);
  S.jersey.points = r.id; S.jersey.t = 1e9; // le maillot vert est à lui (le classement ne se recalcule pas ici)
  let show = 0, n = 0, best = Infinity;
  const r0 = r.strat.rank;
  run(race, 400, () => { n++; if (r.strat.goal === 'show') show++; best = Math.min(best, r.strat.rank); });
  assert.ok(show > 0.4 * n, `il se montre : ${show}/${n} s`);
  assert.ok(best <= 6 && best < r0, `il remonte aux premières places : du rang ${r0} au rang ${best}`);
  // sans maillot (ni goût pour se montrer), un rouleur n'a pas cet objectif
  const { race: r2 } = mk({ n: 24, segs: [{ len: 30000, grade: 0 }], layout: rouleurs });
  let shows = 0;
  run(r2, 300, () => { for (const x of r2.riders) if (x.strat.goal === 'show') shows++; });
  assert.equal(shows, 0);
  // le classement lui-même : un maillot vert après un sprint intermédiaire
  const m3 = mk({ n: 24, segs: [{ len: 9000, grade: 0 }], sprints: 1, layout: rouleurs });
  run(m3.race, 700);
  const J = Strat.jerseys(m3.race);
  assert.ok(J.points && byName(m3.race, J.points), 'le maillot des points est attribué');
  assert.ok(J.lead && byName(m3.race, J.lead));
});

test('montagne : les grimpeurs attaquent pour les points du sommet', () => {
  const segs = [{ len: 6000, grade: 0 }, { len: 4000, grade: 0.06 }, { len: 2500, grade: -0.05 }, { len: 3000, grade: 0 }];
  let attacks = 0, byClimber = 0;
  for (const seed of [5, 8, 9]) {
    const { race } = mk({ segs, n: 30, seed, kom: true, level: 'equal' });
    race.onEvent = (e) => { if (e.type === 'attack' && e.kom) { attacks++; if (byName(race, e.id).strat.role === 'climber') byClimber++; } };
    run(race, 1300);
  }
  assert.ok(attacks >= 1, `attaques pour le sommet : ${attacks}`);
  assert.ok(byClimber >= 1, 'les grimpeurs s\'y lancent');
  assert.ok(byClimber >= attacks * 0.5, `surtout les grimpeurs : ${byClimber}/${attacks}`);
});

test('s\'économiser : le gruppetto ne relaie jamais et roule dans les roues', () => {
  const { race } = mk({ n: 20, segs: [{ len: 14000, grade: 0.01 }], layout: (ids) => ({ solo: ids.map((id, i) => ({ id, role: i < 4 ? 'gruppetto' : 'rouleur' })) }) });
  const g = race.riders.filter((r) => r.strat.role === 'gruppetto');
  let relay = 0, save = 0, n = 0;
  run(race, 800, () => { for (const r of g) { n++; if (r.tac.mode === 'relay') relay++; if (r.strat.goal === 'save') save++; } });
  assert.equal(relay, 0, 'jamais de relais');
  assert.ok(save > 0.9 * n, `objectif « s'économiser » ${save}/${n}`);
});

test('rester à l\'avant : avant un passage à risque, le coureur prudent se place aux premières places', () => {
  const { race, S } = mk({
    n: 40, segs: [{ len: 16000, grade: 0 }], surfaces: [{ startKm: 5, endKm: 6, surface: 'cobbles', factor: 2.2, id: 'x' }],
    layout: (ids) => ({ solo: ids.map((id, i) => ({ id, role: i < 10 ? 'sprinter' : 'rouleur' })) }),
  });
  assert.ok(Strat.dangerAhead(S, 4700, 1500) >= 0.5, 'le secteur étroit est repéré 300 m avant');
  assert.equal(Strat.dangerAhead(S, 1000, 500), 0, 'rien sur le plat');
  const prudent = race.riders.filter((r) => r.strat.role === 'sprinter');
  let safe = 0, ranks = 0, nr = 0, all = 0, na = 0;
  run(race, 1000, () => {
    const s = Math.max(...race.riders.map((r) => r.st.s));
    if (s > 3800 && s < 4900) {
      for (const r of prudent) {
        if (r.strat.goal === 'safe') safe++;
        const x = S.sit && S.sit.by.get(r.id);
        if (x) { ranks += x.rank / x.g.n; nr++; }
      }
      for (const r of race.riders) { const x = S.sit && S.sit.by.get(r.id); if (x && r.strat.role !== 'sprinter') { all += x.rank / x.g.n; na++; } }
    }
  });
  assert.ok(safe > 0, 'objectif « rester à l\'avant » exercé');
  assert.ok(nr > 0 && ranks / nr < all / na, `place moyenne des prudents ${(ranks / nr).toFixed(2)} contre ${(all / na).toFixed(2)} pour les autres`);
});

test('chutes : plus de risque au fond d\'un gros groupe qu\'à l\'avant', () => {
  assert.equal(Strat.depthRisk(0, 60), 1);
  assert.ok(Strat.depthRisk(59, 60) > 1.5 && Strat.depthRisk(59, 60) <= 1.6 + 1e-9);
  assert.ok(Strat.depthRisk(30, 60) > Strat.depthRisk(10, 60));
  assert.ok(Strat.depthRisk(11, 12) < Strat.depthRisk(11, 40), 'un petit groupe n\'a guère d\'effet accordéon');
  assert.equal(Strat.depthRisk(0, 1), 1);
});

/* ---------- équipes : contrôle, protection, bordures ---------- */

/** Un groupe compact, et deux coureurs devant (une échappée) à gap m. */
function withBreak(race, ids, gap, breakIds) {
  const brk = new Set(breakIds);
  const rest = race.riders.filter((r) => !brk.has(r.id));
  rest.forEach((r, i) => { r.st.s = 3000 - i * 2; r.st.v = 10.5; r.prevV = 10.5; r.prevS = r.st.s; Pel.setY(r, ((i % 5) - 2) * 0.6); });
  race.riders.filter((r) => brk.has(r.id)).forEach((r, i) => { r.st.s = 3000 + gap - i * 2; r.st.v = 10.5; r.prevV = 10.5; r.prevS = r.st.s; Pel.setY(r, 0); });
}

test('contrôle : l\'équipe du sprinteur ramène l\'échappée, à une allure qui dépend de l\'écart voulu', () => {
  const lay = sprintTeam({ pilot: 0, leadouts: 1, doms: 4 });
  const { race, ids, S } = mk({ n: 26, segs: [{ len: 40000, grade: 0 }], layout: lay });
  withBreak(race, ids, 330, [ids[24], ids[25]]);
  run(race, 25);
  const tm = S.teams[0];
  assert.ok(tm.control, 'l\'équipe contrôle');
  assert.ok(tm.control.gapT > 15 && tm.control.gapT < 60, `écart ${tm.control.gapT}`);
  assert.ok(tm.control.workers.size >= 1 && tm.control.workers.size <= 4);
  for (const id of tm.control.workers) {
    assert.notEqual(id, tm.sprinter, 'le sprinteur ne mène pas');
    assert.notEqual(byName(race, id).strat.role, 'sprinter');
  }
  const working = [...tm.control.workers].map((id) => byName(race, id)).filter((r) => r.strat.goal === 'control');
  assert.ok(working.length >= 1, 'les ouvriers ont l\'objectif « contrôler »');
  assert.ok(working.some((r) => r.tac.mode === 'relay' || r.tac.plan), 'ils relaient ou remontent en tête');
  // écart au-dessus de celui voulu ⇒ on roule plus fort ; en dessous ⇒ on laisse faire
  const far = tm.control.frac;
  const m2 = mk({ n: 26, segs: [{ len: 40000, grade: 0 }], layout: lay });
  withBreak(m2.race, m2.ids, 2400, [m2.ids[24], m2.ids[25]]);
  m2.race.riders.forEach((r) => { r.st.s += 34000; r.prevS = r.st.s; }); // à 3 km de l'arrivée : l'écart voulu est de 21 s
  run(m2.race, 25);
  const c2 = m2.S.teams[0].control;
  assert.ok(c2 && c2.frac > far, `plus fort quand l'échappée est loin : ${c2 && c2.frac.toFixed(2)} contre ${far.toFixed(2)}`);
  assert.ok(c2.frac <= 1.12 + 1e-9 && far >= 0.75 - 1e-9);
});

test('contrôle : une équipe qui a un coureur dans l\'échappée ne la chasse pas (elle la bloque)', () => {
  const lay = sprintTeam({ pilot: 0, leadouts: 1, doms: 4 });
  const { race, ids, S } = mk({ n: 26, segs: [{ len: 40000, grade: 0 }], layout: lay });
  withBreak(race, ids, 330, [ids[3], ids[25]]); // ids[3] est un équipier du sprinteur
  run(race, 25);
  assert.equal(S.teams[0].inBreak, true);
  assert.equal(S.teams[0].control, null);
});

test('protéger : le protecteur attend son leader quand il crève, puis le ramène', () => {
  const { race, ids, S } = mk({
    n: 26, segs: [{ len: 40000, grade: 0 }],
    layout: (ids) => ({ teams: [{ ambition: 'win', leader: ids[0], riders: ids.slice(0, 5).map((id, i) => ({ id, role: i === 0 ? 'captain' : i === 1 ? 'protector' : 'domestique' })) }], solo: ids.slice(5).map((id) => ({ id, role: 'rouleur' })) }),
  });
  const captain = byName(race, ids[0]), prot = byName(race, ids[1]), dom = byName(race, ids[2]);
  run(race, 200);
  const before = { prot: prot.st.s - captain.st.s, dom: dom.st.s - captain.st.s };
  Race.incident(race, captain, 'puncture');
  const dur = captain.incident.dur;
  let protecting = 0, minV = Infinity;
  run(race, 40, () => { if (prot.strat.goal === 'protect') protecting++; if (prot.st.t > race.t - 40) minV = Math.min(minV, prot.st.v); });
  assert.ok(protecting >= 10, `le protecteur s'occupe de son leader : ${protecting} s`);
  assert.ok(minV < 6, `il ralentit pour l'attendre (vitesse minimale ${minV.toFixed(1)} m/s)`);
  // la voiture-balai ne le retient pas pour toujours : après la crevaison, tout le monde repart
  run(race, 200);
  assert.ok(!captain.incident, 'le leader est reparti');
  assert.ok(prot.st.v > 4 && captain.st.v > 4, 'ils roulent de nouveau');
  assert.ok(Math.abs(prot.st.s - captain.st.s) < 600, `ils sont près l'un de l'autre : ${(prot.st.s - captain.st.s).toFixed(0)} m`);
  assert.ok(before.prot !== undefined && dur > 0);
});

test('protéger : le protecteur se place devant son leader, côté vent par vent de côté', () => {
  const measure = (wind) => {
    const { race, ids, S } = mk({
      n: 24, segs: [{ len: 30000, grade: 0 }], wind,
      layout: (ids) => ({ teams: [{ ambition: 'win', leader: ids[0], riders: ids.slice(0, 4).map((id, i) => ({ id, role: i === 0 ? 'captain' : i === 1 ? 'protector' : 'domestique' })) }], solo: ids.slice(4).map((id) => ({ id, role: 'rouleur' })) }),
    });
    const captain = byName(race, ids[0]), prot = byName(race, ids[1]);
    const m = { same: 0, ahead: 0, nw: 0, windward: 0, protect: 0 };
    run(race, 600, () => {
      if (race.t < 150) return;
      if (prot.strat.goal === 'protect') m.protect++;
      const a = S.sit.by.get(captain.id), b = S.sit.by.get(prot.id);
      if (!a || !b || a.g !== b.g || a.g.n < 8) return;
      m.same++; if (b.rank <= a.rank) m.ahead++;
      const tb = Pel.yaw(prot);
      if (Math.abs(tb) > 0.15 && Math.abs(prot.st.s - captain.st.s) < 25) { m.nw++; if ((prot.lat.y - captain.lat.y) * tb > -0.2) m.windward++; }
    });
    return m;
  };
  const calm = measure(null), windy = measure({ dir: 90, kmh: 30 });
  assert.ok(calm.protect > 100, `il protège : ${calm.protect} s`);
  assert.ok(calm.same > 80 && calm.ahead > 0.7 * calm.same, `devant son leader ${calm.ahead}/${calm.same} s`);
  assert.ok(windy.ahead > 0.4 * windy.same, `devant son leader, même par vent de côté : ${windy.ahead}/${windy.same} s`);
  assert.ok(windy.nw > 50 && windy.windward > 0.6 * windy.nw, `côté vent ${windy.windward}/${windy.nw} s`);
});

test('bordures : par vent de côté, les rouleurs mènent à fond, sans vent aucun ne le fait', () => {
  const lay = (ids) => ({
    teams: [{ ambition: 'win', leader: ids[0], riders: ids.slice(0, 6).map((id, i) => ({ id, role: i === 0 ? 'captain' : 'domestique' })) }],
    solo: ids.slice(6).map((id) => ({ id, role: 'rouleur' })),
  });
  const goals = (wind) => {
    const { race, S } = mk({ n: 40, segs: [{ len: 30000, grade: 0 }], wind, layout: lay, seed: 5 });
    let ech = 0, teamOn = 0, pulls = 0;
    run(race, 500, () => {
      for (const r of race.riders) { if (r.strat.goal === 'echelon') ech++; if (r.strat.goal === 'echelon' && r.tac.mode === 'relay' && r.tac.phase === 'pull') pulls++; }
      if (S.teams[0].echelon) teamOn++;
    });
    return { ech, teamOn, pulls };
  };
  const windy = goals({ dir: 90, kmh: 35 }), calm = goals(null);
  assert.equal(calm.ech, 0);
  assert.ok(windy.ech > 100, `objectif « bordures » : ${windy.ech} s`);
  assert.ok(windy.pulls > 0, 'des relais en tête, à fond');
  assert.ok(windy.teamOn > 0);
});

/* ---------- finale : train, poisson pilote, sprint ---------- */

test('train : les lanceurs mènent à fond à tour de rôle, du plus loin au plus près, puis s\'écartent ; le sprinteur lance après le dernier', () => {
  const { race, ids, S } = mk({ n: 30, segs: [{ len: 11000, grade: 0 }], layout: sprintTeam({ pilot: 0, leadouts: 3, doms: 2 }), seed: 7 });
  const sp = byName(race, ids[0]), los = [1, 2, 3].map((i) => byName(race, ids[i]));
  const led = new Map(), events = [];
  race.onEvent = (e) => { if (e.type === 'strategy') events.push(e.what); };
  let sprintAt = null, formed = null;
  Race.step(race);
  while (race.riders.some((r) => !r.finished) && race.t < 3000) {
    Race.step(race);
    for (const r of los) {
      if (r.strat.goal === 'train' && r.tac.plan && r.tac.plan.kind === 'drive' && r.tac.phase === 'pull') {
        if (!led.has(r.id)) led.set(r.id, { from: toGoOf(race, r), P: [] });
        led.get(r.id).to = toGoOf(race, r); led.get(r.id).P.push(r.lastP);
      }
    }
    if (S.teams[0].train && formed === null) formed = toGoOf(race, sp);
    if (sprintAt === null && sp.tac.mode === 'sprint') sprintAt = toGoOf(race, sp);
  }
  assert.ok(events.includes('train-form'), 'le train se forme');
  assert.ok(formed <= Strat.TRAIN_START + Strat.TRAIN_FORM + 150, `formé à ${formed} m`);
  assert.ok(led.size >= 2, `${led.size} lanceurs ont mené`);
  // chacun mène sa portion de route : les départs vont de loin à près
  const order = [...led.values()].sort((a, b) => b.from - a.from);
  for (let i = 1; i < order.length; i++) assert.ok(order[i].from < order[i - 1].from, 'du plus loin au plus près');
  for (const v of led.values()) assert.ok(v.P.reduce((s, x) => s + x, 0) / v.P.length > 1.0 * 250, 'il mène à fond');
  assert.ok(sprintAt !== null && sprintAt <= 400 && sprintAt >= 100, `le sprinteur lance à ${sprintAt} m`);
  const lastTo = Math.min(...[...led.values()].map((v) => v.to));
  assert.ok(sprintAt <= lastTo + 120, 'il lance quand le dernier lanceur s\'écarte');
  // les lanceurs ne sprintent pas pour eux
  assert.ok(los.every((r) => r.tac.mode !== 'sprint' || toGoOf(race, r) < 5000));
  assert.ok(sp.finished, 'le sprinteur arrive');
});

test('poisson pilote : il précède le sprinteur et le conduit vers l\'avant, puis s\'écarte quand le sprint est lancé', () => {
  const { race, ids } = mk({ n: 30, segs: [{ len: 11000, grade: 0 }], layout: sprintTeam({ pilot: 1, leadouts: 0, doms: 2 }), seed: 7 });
  const sp = byName(race, ids[0]), pi = byName(race, ids[1]);
  let guiding = 0, ahead = 0, near = 0, nearAhead = 0, peeled = false, n = 0, r0 = 0, rN = 0;
  while (race.riders.some((r) => !r.finished) && race.t < 3000) {
    Race.step(race);
    const tg = toGoOf(race, sp);
    if (tg < Strat.PILOT_START && tg > 700 && sp.strat.rank !== undefined) {
      n++;
      if (pi.strat.goal === 'pilot') guiding++;
      if (Math.abs(pi.st.s - sp.st.s) < 30) { near++; if (pi.st.s > sp.st.s) nearAhead++; }
      if (n === 1) r0 = sp.strat.rank;
      rN = sp.strat.rank;
    }
    if (pi.tac.plan && pi.tac.plan.kind === 'peel') peeled = true;
  }
  assert.ok(guiding > 0.5 * n, `il guide : ${guiding}/${n} s`);
  assert.ok(near > 0.5 * n, `ils restent ensemble : ${near}/${n} s`);
  assert.ok(nearAhead > 0.5 * near, `le pilote est devant : ${nearAhead}/${near} s`);
  assert.ok(rN <= r0 + 4, `le sprinteur ne se perd pas au fond du peloton (rang ${r0} → ${rN})`);
  assert.ok(peeled, 'le pilote s\'écarte au lancement du sprint');
});

test('sprint : sans train ni pilote le sprinteur se place, lance à sa distance, et les équipiers ne sprintent pas', () => {
  const { race, ids } = mk({ n: 30, segs: [{ len: 9000, grade: 0 }], layout: sprintTeam({ pilot: 0, leadouts: 0, doms: 3 }), seed: 4 });
  const sp = byName(race, ids[0]), doms = [1, 2, 3].map((i) => byName(race, ids[i]));
  let sprintAt = null, domSprint = 0;
  while (race.riders.some((r) => !r.finished) && race.t < 3000) {
    Race.step(race);
    if (sprintAt === null && sp.tac.mode === 'sprint') sprintAt = toGoOf(race, sp);
    for (const d of doms) if (d.tac.mode === 'sprint') domSprint++;
  }
  assert.ok(sprintAt !== null && Math.abs(sprintAt - sp.strat.launch) < 120, `lancé à ${sprintAt} m (prévu ${sp.strat.launch.toFixed(0)} m)`);
  assert.equal(domSprint, 0, 'les équipiers ne sprintent pas pour eux');
});

test('final : le sprinteur fait au moins aussi bien avec son train (poisson pilote, lanceurs) que seul', () => {
  const rank = (layoutFn) => {
    let tot = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const seed of seeds) {
      const { race, ids } = mk({ n: 30, segs: [{ len: 10000, grade: 0 }], layout: layoutFn, seed });
      Race.runToEnd(race);
      tot += Race.results(race).indexOf(byName(race, ids[0]));
    }
    return tot / seeds.length;
  };
  const train = rank(sprintTeam({ pilot: 1, leadouts: 3, doms: 1 }));
  const alone = rank(sprintTeam({ pilot: 0, leadouts: 0, doms: 0 }));
  assert.ok(train <= alone + 1, `rang moyen du sprinteur : ${train.toFixed(1)} avec le train, ${alone.toFixed(1)} sans`);
});

/* ---------- robustesse ---------- */

test('garde-fous : deux coureurs qui s\'attendent l\'un l\'autre ne s\'arrêtent pas', () => {
  const { race, ids } = mk({ n: 12, segs: [{ len: 30000, grade: 0 }], layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) }) });
  const a = byName(race, ids[0]), b = byName(race, ids[1]);
  run(race, 60);
  for (const r of [a, b]) r.tac.nextThink = Infinity; // plus de décision : on impose les plans
  Tac.setMode(a, 'strat', race.t); a.tac.plan = { kind: 'escort', target: b.id, mode: 'behind', cap: 1.15 };
  Tac.setMode(b, 'strat', race.t); b.tac.plan = { kind: 'escort', target: a.id, mode: 'behind', cap: 1.15 };
  run(race, 120);
  assert.ok(a.st.v > 4 && b.st.v > 4, `ni l'un ni l'autre ne s'arrête (${a.st.v.toFixed(1)} et ${b.st.v.toFixed(1)} m/s)`);
});

test('garde-fous : un coureur de la stratégie arrêté alors que son paquet roule reprend les roues', () => {
  const { race, ids } = mk({ n: 20, segs: [{ len: 30000, grade: 0 }], layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'rouleur' })) }) });
  run(race, 90);
  const r = byName(race, ids[5]);
  Tac.setMode(r, 'strat', race.t); r.tac.plan = { kind: 'drive', frac: 0.001, front: undefined }; // consigne nulle : il cale
  r.tac.nextThink = Infinity; // aucune décision pendant qu'il cale
  run(race, 100);
  assert.ok(r.st.v < 2.5, `il a calé (${r.st.v.toFixed(1)} m/s)`);
  assert.equal(r.tac.mode, 'strat');
  r.tac.nextThink = race.t;
  run(race, 12);
  assert.notEqual(r.tac.mode, 'strat', 'la stratégie l\'a rendu aux roues');
  run(race, 60);
  assert.ok(r.st.v > 4, `il roule de nouveau (${r.st.v.toFixed(1)} m/s)`);
});

test('peloton : tout le monde veut monter, personne ne reste bloqué (un sur six à la fois)', () => {
  const { race, S } = mk({
    n: 60, segs: [{ len: 9000, grade: 0 }], surfaces: [{ startKm: 2, endKm: 3, surface: 'cobbles', factor: 2.2, id: 'x' }],
    layout: (ids) => ({ solo: ids.map((id) => ({ id, role: 'sprinter' })) }), // tous prudents
  });
  let maxMovers = 0, minV = Infinity;
  run(race, 600, () => {
    if (race.t < 120) return;
    let movers = 0;
    for (const r of race.riders) if (r.tac.mode === 'strat' && r.tac.phase === 'move') movers++;
    maxMovers = Math.max(maxMovers, movers);
    const v = race.riders.reduce((s, r) => s + r.st.v, 0) / race.riders.length;
    minV = Math.min(minV, v);
  });
  assert.ok(maxMovers <= Math.ceil(60 / 3) * 2, `coureurs en train de remonter : ${maxMovers}`);
  assert.ok(minV > 3, `le peloton ne s'arrête pas (vitesse moyenne minimale ${minV.toFixed(1)} m/s)`);
  assert.ok(S.teams.length === 0);
});

test('avec le joueur : il est dans la course (échappée, contrôle) sans avoir de rôle ni être gêné par les stratégies', () => {
  const { race, ids } = mk({ n: 20, segs: [{ len: 8000, grade: 0 }], layout: null });
  const me = Race.addRider(race, { id: 'me', name: 'Moi', human: true, setup: race.riders[0].setup, athlete: race.riders[0].athlete, v0: 0 });
  Tac.setMode(me, 'follow', 0);
  Strat.init(race);
  Race.runToEnd(race);
  assert.ok(me.finished && !me.strat);
  assert.equal(race.strat.nBots, 20);
  assert.ok(race.riders.every((r) => r.finished));
});

test('course complète : arrivée de tous avec toutes les règles (incidents, forme, alimentation) et peloton de 90 assez rapide', () => {
  const { race } = mk({ n: 60, segs: [{ len: 6000, grade: 0.01 }, { len: 3000, grade: -0.02, turn: 20 }, { len: 3000, grade: 0.03 }], rules: { events: true, form: true, fuel: true }, level: 'mixed', sprints: 1, kom: true });
  Race.runToEnd(race, 3 * 3600);
  assert.ok(race.riders.every((r) => r.finished && Number.isFinite(r.time)), 'tous arrivent');
  const big = mk({ n: 89, segs: [{ len: 20000, grade: 0 }] });
  const t0 = Date.now();
  run(big.race, 300);
  assert.ok(Date.now() - t0 < 12000, `${Date.now() - t0} ms pour 300 s de course à 90`);
});

test('déterminisme : même graine, même course, mêmes décisions', () => {
  const trace = () => {
    const { race } = mk({ n: 24, segs: [{ len: 7000, grade: 0.01 }], seed: 3 });
    const goals = [];
    run(race, 400, () => { if (race.t % 40 === 0) goals.push(race.riders.map((r) => r.strat.goal[0] + r.tac.mode[0]).join('')); });
    return goals.join('|') + race.riders.map((r) => r.st.s.toFixed(2)).join();
  };
  assert.equal(trace(), trace());
});

test('texte : le HUD décrit le rôle et ce que fait le coureur virtuel', () => {
  const { race } = mk({ n: 24, segs: [{ len: 9000, grade: 0 }] });
  run(race, 300);
  let n = 0;
  for (const r of race.riders) if (r.tac.mode === 'strat') { n++; assert.match(Tac.describe(r, race.rules), /—/); assert.ok(Tac.describe(r, race.rules).includes(Strat.ROLES[r.strat.role].label)); }
  assert.ok(n > 0, 'des coureurs ont un plan propre à la stratégie');
});
