/* author : Hugo Joudrier-Faure */
/* Tests du mode équipe (team-game.js) : effectifs World Tour, plans, champ de départ, bascule du coureur piloté, classement par équipes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR, makeProfile, setupFor, DEFAULT_RIDER, DEFAULT_BIKE } = require('./helpers.js');

const TG = PYR.teamGame, Race = PYR.race, Pel = PYR.peloton, Strat = PYR.strategy;

function newRace(cfg, o) {
  const { segs = [{ len: 6000, grade: 0.005 }], seed = 3, rules = {} } = o || {};
  const { course } = setupFor(makeProfile(segs));
  const race = Race.create({ course, rules: Object.assign({ peloton: true, strategy: true }, rules), seed, gustSeed: 1 });
  const res = TG.populate(race, { cfg, rider: DEFAULT_RIDER, bike: DEFAULT_BIKE, v0: 0 });
  Pel.grid(race);
  return { race, res };
}

test('effectifs : vingt équipes du World Tour, leurs coureurs du meilleur au moins bon, couleur de maillot', () => {
  const ts = TG.teams();
  assert.equal(ts.length, 20);
  for (const t of ts) {
    assert.ok(t.name && /^#/.test(t.color), t.id);
    assert.ok(t.riders.length >= 5, `${t.id} : ${t.riders.length} coureurs`);
    for (let i = 1; i < t.riders.length; i++) assert.ok(t.riders[i - 1].pro.level >= t.riders[i].pro.level);
    assert.ok(t.riders.every((r) => r.pro.team === t.id && r.data.rider.ftp > 0));
  }
  assert.equal(TG.findTeam('UAE').riders[0].name, 'Tadej Pogačar');
  assert.equal(TG.findTeam('XXX'), null);
});

test('sélection par défaut : le meilleur, un sprinteur, un grimpeur, au plus 9 coureurs, sans doublon', () => {
  const sel = TG.defaultSelection('UAE', 8);
  assert.equal(sel.length, 8);
  assert.equal(new Set(sel).size, 8);
  assert.equal(sel[0], 'pro:tadej-pogacar');
  const t = TG.findTeam('UAE'), type = (id) => t.riders.find((r) => r.id === id).pro.type;
  assert.ok(sel.some((id) => type(id) === 'sprinter'), 'un sprinteur');
  assert.equal(TG.defaultSelection('UAE', 99).length, TG.MAX_OWN);
  assert.equal(TG.defaultSelection('XXX', 8).length, 0);
  // équipe plus petite que demandé
  assert.equal(TG.defaultSelection('LOT', 9).length, TG.findTeam('LOT').riders.length);
});

test('plans par défaut : un leader selon son type, protecteur et baroudeur, ou sprinteur avec pilote et lanceurs', () => {
  const uae = TG.defaultPlans(TG.defaultSelection('UAE', 8).map((id) => TG.findTeam('UAE').riders.find((r) => r.id === id)));
  assert.equal(uae['pro:tadej-pogacar'], 'captain');
  const roles = Object.values(uae);
  assert.equal(roles.filter((r) => r === 'captain').length, 1);
  assert.ok(roles.includes('protector'));
  assert.ok(roles.every((r) => TG.ROLE_IDS.includes(r)));
  // une équipe dont le meilleur est un sprinteur : train
  const fake = TG.findTeam('UAE').riders.slice(0, 8).map((r, i) => Object.assign({}, r, { pro: Object.assign({}, r.pro, { type: i === 0 ? 'sprinter' : i < 4 ? 'tt' : 'domestique', level: 100 - i }) }));
  const sp = TG.defaultPlans(fake);
  assert.equal(sp[fake[0].id], 'sprinter');
  assert.ok(Object.values(sp).includes('pilot') && Object.values(sp).includes('leadout'));
  assert.deepEqual(TG.defaultPlans([]), {});
});

test('configuration : vérifiée (équipe, coureurs, plans, effectifs, taille du peloton)', () => {
  assert.equal(TG.normalize(null).on, false);
  assert.equal(TG.normalize({ on: true, team: 'XXX' }).on, false);
  const c = TG.normalize({ on: true, team: 'TVL', riders: ['pro:jonas-vingegaard', 'pro:inconnu', 'pro:jonas-vingegaard'], plans: { 'pro:jonas-vingegaard': 'sprinter', x: 'captain' }, opp: 500, size: 50 });
  assert.equal(c.on, true);
  assert.deepEqual(c.riders, ['pro:jonas-vingegaard']);
  assert.equal(c.plans['pro:jonas-vingegaard'], 'sprinter');
  assert.equal(c.size, TG.MAX_SIZE);
  assert.ok(c.riders.length + c.opp * c.size <= TG.MAX_FIELD, 'peloton limité');
  assert.ok(c.opp >= 1);
  const d = TG.normalize({ on: true, team: 'TVL' });
  assert.equal(d.riders.length, 8, 'sans choix : la sélection conseillée');
  assert.equal(d.opp, 9);
  assert.ok(Object.values(d.plans).every((r) => TG.ROLE_IDS.includes(r)));
  assert.equal(TG.normalize({ on: true, team: 'TVL', plans: { 'pro:jonas-vingegaard': 'nimporte' } }).plans['pro:jonas-vingegaard'], 'captain', 'plan invalide : celui par défaut');
});

test('départ : mon équipe et les équipes adverses avec leurs couleurs, un seul coureur piloté, les stratégies en place', () => {
  const { race, res } = newRace({ team: 'UAE', riders: ['pro:tadej-pogacar', 'pro:joao-almeida', 'pro:adam-yates', 'pro:pascal-ackermann'], opp: 5, size: 6 });
  assert.equal(res.teams.length, 6);
  assert.equal(race.riders.length, 4 + 5 * 6);
  assert.equal(res.teams[0].own, true);
  assert.equal(res.teams[0].id, 'UAE');
  assert.ok(res.teams.slice(1).every((t) => !t.own && t.id !== 'UAE' && t.ids.length === 6));
  assert.equal(new Set(race.riders.map((r) => r.id)).size, race.riders.length, 'identifiants uniques');
  for (const t of res.teams) for (const id of t.ids) {
    const r = race.riders.find((x) => x.id === id);
    assert.equal(r.teamId, t.id);
    assert.equal(r.color, t.color);
    assert.equal(r.own, t.own);
    assert.ok(r.strat && r.strat.team === t.index, 'chacun a son rôle dans son équipe');
  }
  const piloted = race.riders.filter((r) => r.human);
  assert.equal(piloted.length, 1);
  assert.equal(piloted[0].id, 'pro:tadej-pogacar', 'le leader est piloté au départ');
  assert.equal(piloted[0].bot, null);
  assert.equal(TG.controlled(race), piloted[0]);
  assert.equal(race.strat.teams.length, 6);
  // les équipes adverses sont les mêmes avec la même graine, différentes avec une autre
  const names = (seed) => newRace({ team: 'UAE', opp: 5, size: 6 }, { seed }).res.teams.map((t) => t.id).join();
  assert.equal(names(3), names(3));
  assert.notEqual(names(3), names(4));
  assert.throws(() => TG.populate(race, { cfg: { team: 'XXX' }, rider: DEFAULT_RIDER, bike: DEFAULT_BIKE }), /inconnue/);
});

test('bascule : le coureur précédent reprend son rôle de coureur virtuel, le nouveau est piloté', () => {
  const { race, res } = newRace({ team: 'UAE', riders: ['pro:tadej-pogacar', 'pro:joao-almeida', 'pro:adam-yates'], opp: 3, size: 5 });
  const [a, b, c] = res.own;
  for (let i = 0; i < 60; i++) Race.step(race);
  assert.ok(a.human && !b.human);
  assert.ok(b.bot, 'les autres sont décidés par la stratégie');
  assert.equal(TG.switchTo(race, b.id), b);
  assert.ok(b.human && b.bot === null && b.botProfile);
  assert.ok(!a.human && a.bot, 'le précédent est rendu à la stratégie');
  assert.equal(race.riders.filter((r) => r.human).length, 1);
  assert.equal(TG.controlled(race), b);
  assert.equal(b.tac.mode, 'follow');
  assert.equal(b.lat.roam, false);
  assert.equal(a.lat.roam, true);
  for (let i = 0; i < 60; i++) Race.step(race);
  assert.ok(a.st.v > 3 && b.st.v > 3, 'tous les deux roulent');
  assert.ok(a.tac.mode !== 'manual', 'décidé par la stratégie');
  // même coureur : rien ne change ; coureur d'une autre équipe ou inconnu : refusé
  assert.equal(TG.switchTo(race, b.id), b);
  const foreign = race.riders.find((r) => !r.own);
  assert.equal(TG.switchTo(race, foreign.id), null);
  assert.equal(TG.switchTo(race, 'nobody'), null);
  assert.equal(TG.controlled(race), b);
  // retour
  TG.switchTo(race, c.id); TG.switchTo(race, a.id);
  assert.ok(a.human && !b.human && !c.human && b.bot && c.bot);
});

test('plans : changer le rôle d\'un équipier en course reforme l\'équipe (leader, sprinteur, protecteur) sans toucher aux autres', () => {
  const { race, res } = newRace({ team: 'UAE', riders: ['pro:tadej-pogacar', 'pro:joao-almeida', 'pro:adam-yates', 'pro:pascal-ackermann', 'pro:brandon-mcnulty'], opp: 2, size: 5 });
  const by = (id) => race.riders.find((r) => r.id === id);
  assert.equal(TG.planOf(race, 'pro:pascal-ackermann'), 'rouleur');
  assert.equal(by('pro:pascal-ackermann').strat.role, 'rouleur');
  const otherTeam = race.strat.teams[1];
  assert.ok(TG.setPlan(race, 'pro:pascal-ackermann', 'sprinter'));
  assert.equal(TG.planOf(race, 'pro:pascal-ackermann'), 'sprinter');
  assert.equal(by('pro:pascal-ackermann').strat.role, 'sprinter');
  assert.equal(race.strat.teams[0].sprinter, 'pro:pascal-ackermann');
  assert.equal(by('pro:joao-almeida').strat.protectee, 'pro:pascal-ackermann', 'les équipiers travaillent pour le sprinteur');
  assert.equal(race.strat.teams[1], otherTeam, 'les autres équipes ne bougent pas');
  // le leader passe au sprinteur quand il devient leader : « leader » à Pogačar retiré
  assert.ok(TG.setPlan(race, 'pro:tadej-pogacar', 'baroudeur'));
  assert.equal(race.strat.teams[0].leader, 'pro:pascal-ackermann');
  assert.equal(race.strat.teams[0].ambition, 'sprint');
  // refus : rôle inconnu, coureur adverse
  assert.equal(TG.setPlan(race, 'pro:tadej-pogacar', 'x'), false);
  assert.equal(TG.setPlan(race, race.riders.find((r) => !r.own).id, 'captain'), false);
  // le coureur piloté peut changer de plan sans que la course s'arrête
  const piloted = TG.controlled(race);
  assert.ok(TG.setPlan(race, piloted.id, 'domestique'));
  for (let i = 0; i < 120; i++) Race.step(race);
  assert.ok(res.own.every((r) => r.st.v > 3));
});

test('course d\'équipe : tout le monde arrive, un coureur piloté change de main en course, classement par équipes', () => {
  const { race, res } = newRace({ team: 'IGD', opp: 4, size: 6 }, { segs: [{ len: 7000, grade: 0.01 }], rules: { events: true, fuel: true, form: true } });
  let k = 0;
  while (race.riders.some((r) => !r.finished) && race.t < 3 * 3600) {
    Race.step(race);
    if (++k % 150 === 0) TG.switchTo(race, res.own[(k / 150) % res.own.length].id);
  }
  assert.ok(race.riders.every((r) => r.finished), 'tous arrivent');
  assert.equal(race.riders.filter((r) => r.human).length, 1);
  const st = TG.teamStandings(race);
  assert.equal(st.length, 5);
  assert.deepEqual(st.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.ok(st.every((r) => r.time > 0), 'équipes de 6 : trois arrivés au moins');
  for (let i = 1; i < st.length; i++) assert.ok(st[i - 1].time <= st[i].time);
  assert.ok(st.some((r) => r.own && r.id === 'IGD'));
  // somme des trois meilleurs temps
  const t0 = res.teams.find((t) => t.id === st[0].id);
  const times = t0.ids.map((id) => race.riders.find((r) => r.id === id).time).sort((a, b) => a - b);
  assert.ok(Math.abs(st[0].time - (times[0] + times[1] + times[2])) < 1e-6);
});

test('classement par équipes en cours de route : par arrivés, puis par distance', () => {
  const { race } = newRace({ team: 'UAE', opp: 3, size: 5 });
  for (let i = 0; i < 100; i++) Race.step(race);
  const st = TG.teamStandings(race);
  assert.ok(st.every((r) => r.time === null && r.finished === 0));
  assert.deepEqual(TG.teamStandings({ teamGame: null }), []);
});

test('stratégie : un leader ou un lanceur piloté par le joueur ne fait pas planter le contrôle, le train ni les ouvriers', () => {
  const ids = ['pro:pascal-ackermann', 'pro:joao-almeida', 'pro:adam-yates', 'pro:jay-vine', 'pro:brandon-mcnulty', 'pro:marc-hirschi'];
  const plans = { 'pro:pascal-ackermann': 'sprinter', 'pro:joao-almeida': 'pilot', 'pro:adam-yates': 'leadout', 'pro:jay-vine': 'leadout', 'pro:brandon-mcnulty': 'domestique', 'pro:marc-hirschi': 'domestique' };
  const { race } = newRace({ team: 'UAE', riders: ids, plans, opp: 5, size: 6 }, { segs: [{ len: 14000, grade: 0 }] });
  const by = (id) => race.riders.find((r) => r.id === id);
  TG.switchTo(race, 'pro:pascal-ackermann');          // le sprinteur est piloté : ses lanceurs le lancent quand même
  for (let i = 0; i < 1500 && race.riders.some((r) => !r.finished); i++) {
    Race.step(race);
    if (i === 400) TG.switchTo(race, 'pro:adam-yates');   // un lanceur piloté : il ne fait plus partie du train
  }
  Race.runToEnd(race, 3 * 3600);
  assert.ok(race.riders.every((r) => r.finished));
  assert.ok(by('pro:pascal-ackermann').strat.role === 'sprinter');
});

test('peloton d\'équipes : 20 équipes de 5, aussi rapide que le peloton de 90', () => {
  const t0 = Date.now();
  const { race } = newRace({ team: 'UAE', riders: TG.defaultSelection('UAE', 8), opp: 19, size: 5 }, { segs: [{ len: 20000, grade: 0 }] });
  assert.equal(race.riders.length, 8 + 19 * 5);
  for (let i = 0; i < 300; i++) Race.step(race);
  assert.ok(Date.now() - t0 < 15000, `${Date.now() - t0} ms`);
});
