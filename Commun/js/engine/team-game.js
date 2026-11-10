/* author : Hugo Joudrier-Faure */
/* PaceYourRide — mode équipe : le joueur ne choisit pas un coureur mais une équipe World Tour (pros.js) et les coureurs de l'équipe qui prennent
 * le départ ; les autres équipes participent aussi, avec leurs meilleurs coureurs. Le joueur pilote un coureur à la fois et peut basculer de
 * l'un à l'autre (« takeControl » / « releaseControl », race.js) ; les coureurs de son équipe qu'il ne pilote pas courent avec les stratégies
 * (strategy.js) selon leur **plan** : un rôle choisi avant le départ (leader, sprinteur, grimpeur, baroudeur, rouleur, équipier, protecteur,
 * lanceur, poisson pilote, gruppetto), modifiable en course.
 *
 * Configuration (store.state.game.team) : { on, team ('UAE'…), riders ([id 'pro:nom']), plans ({id: rôle}), opp (équipes adverses), size (coureurs
 * par équipe adverse) }. Tout est pur (aucun accès au DOM) ; la course est construite sur une course déjà créée (race.create) avec la règle `strategy`. */
(function (PYR) {
  'use strict';

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const MAX_OWN = 9;          // coureurs d'une équipe dans la course (la règle du Tour : 8 ; 9 pour les anciens grands tours)
  const MIN_SIZE = 4, MAX_SIZE = 9;
  const MAX_FIELD = 110;      // coureurs au départ, au plus (la simulation reste fluide jusqu'à environ cent coureurs)

  /** Plans qu'on peut donner à un coureur de son équipe : le rôle de la stratégie, avec ce qu'il implique. */
  const ROLE_CHOICES = [
    { id: 'captain', label: 'Leader', info: 'Chef de file : les équipiers roulent pour lui, il s\'économise jusqu\'au moment clé.' },
    { id: 'sprinter', label: 'Sprinteur', info: 'Se place pour le sprint, profite du train et du poisson pilote.' },
    { id: 'climber', label: 'Grimpeur', info: 'Vise les points de la montagne et la victoire dans les côtes.' },
    { id: 'baroudeur', label: 'Baroudeur', info: 'Attaque, saute dans les échappées, vise la combativité.' },
    { id: 'rouleur', label: 'Rouleur', info: 'Mène à fond par vent de côté (bordures), contrôle les échappées.' },
    { id: 'domestique', label: 'Équipier', info: 'Roule pour le leader : le place, mène, contrôle, se sacrifie.' },
    { id: 'protector', label: 'Protecteur', info: 'Reste autour du leader, l\'abrite du vent, l\'attend s\'il a crevé.' },
    { id: 'leadout', label: 'Lanceur', info: 'Fait le train : mène à fond un tronçon avant le sprint, puis s\'écarte.' },
    { id: 'pilot', label: 'Poisson pilote', info: 'Précède le sprinteur et le conduit vers l\'avant du peloton.' },
    { id: 'gruppetto', label: 'Gruppetto', info: 'S\'économise : roule à son rythme, sans mission.' },
  ];
  const ROLE_IDS = ROLE_CHOICES.map((r) => r.id);
  const LEADER_ROLES = ['captain', 'sprinter', 'climber'];     // un coureur de ces rôles est le chef de file de l'équipe
  const AMBITION = { captain: 'win', sprinter: 'sprint', climber: 'kom', baroudeur: 'break' };

  const roleLabel = (id) => (ROLE_CHOICES.find((r) => r.id === id) || {}).label || id;

  /* ---------- effectifs ---------- */

  /** Équipes du World Tour : [{id, name, color, riders (éléments de pros.js, du meilleur au moins bon)}], dans l'ordre de la liste. */
  function teams() {
    const Pr = PYR.pros, byTeam = new Map();
    for (const it of Pr.all()) {
      if (!byTeam.has(it.pro.team)) byTeam.set(it.pro.team, []);
      byTeam.get(it.pro.team).push(it);
    }
    return Object.keys(Pr.TEAMS).filter((k) => byTeam.has(k)).map((k) => ({
      id: k, name: Pr.TEAMS[k], color: Pr.TEAM_COLORS[k] || '#6f6d66',
      riders: byTeam.get(k).slice().sort((a, b) => b.pro.level - a.pro.level || b.pro.wkg - a.pro.wkg),
    }));
  }

  const findTeam = (id) => teams().find((t) => t.id === id) || null;

  /** Coureurs retenus par défaut : un leader, un sprinteur, des grimpeurs et des équipiers (au mieux), n au plus. */
  function defaultSelection(teamId, n) {
    const t = findTeam(teamId);
    if (!t) return [];
    const want = clamp(n || 8, 1, MAX_OWN), out = [], take = (it) => { if (it && !out.includes(it) && out.length < want) out.push(it); };
    const best = (types) => t.riders.find((x) => !out.includes(x) && types.includes(x.pro.type));
    take(t.riders[0]);
    take(best(['sprinter']));
    take(best(['stage', 'climber']));
    take(best(['classic', 'puncher']));
    take(best(['tt']));
    for (const it of t.riders) take(it);
    return out.map((x) => x.id);
  }

  /* ---------- plans ---------- */

  const TYPE_ROLE = { stage: 'captain', climber: 'climber', classic: 'captain', puncher: 'captain', sprinter: 'sprinter', tt: 'captain', domestique: 'captain' };

  /**
   * Plans par défaut d'une équipe : le meilleur est le leader (d'après son type) ; derrière un sprinteur, un poisson pilote et des lanceurs (les
   * rouleurs, puncheurs et classiques) ; derrière un autre leader, un protecteur (le meilleur équipier), un baroudeur et des équipiers.
   * items : éléments de pros.js. Renvoie {id: rôle}.
   */
  function defaultPlans(items) {
    const list = items.slice().sort((a, b) => b.pro.level - a.pro.level || b.pro.wkg - a.pro.wkg), plans = {};
    if (!list.length) return plans;
    const lead = list[0];
    plans[lead.id] = TYPE_ROLE[lead.pro.type] || 'captain';
    const rest = list.slice(1), free = () => rest.filter((x) => !plans[x.id]);
    const first = (types) => free().find((x) => types.includes(x.pro.type));
    if (plans[lead.id] === 'sprinter') {
      if (rest.length >= 5) { const p = first(['classic', 'puncher', 'sprinter']) || free()[0]; if (p) plans[p.id] = 'pilot'; }
      const nLo = clamp(Math.floor((free().length + 1) / 2), 1, 3);
      for (let k = 0; k < nLo && free().length > 1; k++) { const x = first(['tt', 'classic', 'puncher', 'domestique']) || free()[0]; plans[x.id] = 'leadout'; }
    } else {
      const p = first(['domestique', 'tt']) || free()[free().length - 1];
      if (p) plans[p.id] = 'protector';
      const b = first(['classic', 'puncher']);
      if (b && free().length > 1) plans[b.id] = 'baroudeur';
      const sp = first(['sprinter']);
      if (sp) plans[sp.id] = 'rouleur';            // un sprinteur dans une équipe de leader : il mène, il ne lance pas
      for (const x of free().filter((y) => y.pro.type === 'tt')) plans[x.id] = 'rouleur';
    }
    for (const x of rest) if (!plans[x.id]) plans[x.id] = 'domestique';
    return plans;
  }

  /** Description d'équipe pour la stratégie ({ambition, leader, riders}) : le chef de file est le premier de la liste au rôle de leader. */
  function layoutFor(ids, plans) {
    const role = (id) => (ROLE_IDS.includes(plans[id]) ? plans[id] : 'domestique');
    const leader = ids.find((id) => LEADER_ROLES.includes(role(id))) || ids.find((id) => role(id) === 'baroudeur') || ids[0];
    return { ambition: AMBITION[role(leader)] || 'win', leader, riders: ids.map((id) => ({ id, role: role(id) })) };
  }

  /* ---------- configuration ---------- */

  /** Configuration vérifiée : équipe connue, coureurs de cette équipe (dans l'ordre de la liste), plans valides, nombre d'équipes adverses. */
  function normalize(cfg) {
    cfg = cfg || {};
    const all = teams();
    const t = all.find((x) => x.id === cfg.team) || null;
    const out = { on: !!cfg.on && !!t, team: t ? t.id : '', riders: [], plans: {}, opp: clamp(Math.floor(Number(cfg.opp)), 0, all.length - 1), size: clamp(Math.floor(Number(cfg.size)), MIN_SIZE, MAX_SIZE) };
    if (!Number.isFinite(Number(cfg.opp))) out.opp = Math.min(9, all.length - 1);
    if (!Number.isFinite(Number(cfg.size))) out.size = 8;
    if (!t) return out;
    const valid = new Set(t.riders.map((x) => x.id));
    out.riders = (Array.isArray(cfg.riders) ? cfg.riders : []).filter((id, i, a) => valid.has(id) && a.indexOf(id) === i).slice(0, MAX_OWN);
    if (!out.riders.length) out.riders = defaultSelection(t.id, 8);
    const items = out.riders.map((id) => t.riders.find((x) => x.id === id));
    const def = defaultPlans(items);
    const given = cfg.plans && typeof cfg.plans === 'object' ? cfg.plans : {};
    for (const id of out.riders) out.plans[id] = ROLE_IDS.includes(given[id]) ? given[id] : def[id];
    // l'opposition ne dépasse pas la taille maximale du peloton
    while (out.opp > 0 && out.riders.length + out.opp * out.size > MAX_FIELD) out.opp--;
    return out;
  }

  /* ---------- course ---------- */

  /**
   * Remplit une course (race.create) : l'équipe du joueur, puis les équipes adverses tirées au hasard (graine de la course), chacune avec ses
   * meilleurs coureurs. opts : {cfg (voir normalize), rider (kit : position, casque…), bike, v0, controlled (id du coureur piloté)}.
   * Les coureurs sont des coureurs virtuels (stratégies) ; celui qui est piloté passe sous le contrôle du joueur. Renvoie
   * {teams: [{index, id, name, color, own, ids}], own: [coureurs], controlled}.
   */
  function populate(race, opts) {
    const Race = PYR.race, Strat = PYR.strategy, Pr = PYR.pros;
    const cfg = normalize(Object.assign({}, opts.cfg, { on: true }));
    const all = teams(), mine = all.find((x) => x.id === cfg.team);
    if (!mine) throw new Error('Équipe inconnue : ' + cfg.team);
    const rnd = PYR.util.mulberry32((race.seed ^ 0x6a09e667) >>> 0), phyRnd = PYR.util.mulberry32((race.seed ^ 0x51ed270b) >>> 0);
    const draw = race.rnd;
    // équipes adverses : tirage de la graine, puis leurs meilleurs coureurs
    const others = all.filter((x) => x.id !== mine.id);
    for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }
    const field = [{ team: mine, own: true, items: cfg.riders.map((id) => mine.riders.find((x) => x.id === id)), plans: cfg.plans }];
    for (const t of others.slice(0, cfg.opp)) {
      const items = t.riders.slice(0, cfg.size);
      if (items.length >= 2) field.push({ team: t, own: false, items, plans: defaultPlans(items) });
    }
    const info = [], layout = { teams: [], solo: [] };
    field.forEach((f, index) => {
      const ids = [];
      for (const it of f.items) {
        const r = Race.addPro(race, it, { rider: opts.rider, bike: opts.bike, v0: opts.v0, id: it.id, color: f.team.color, bot: { teamId: f.team.id } }, draw, phyRnd);
        r.teamId = f.team.id; r.teamName = f.team.name; r.teamIndex = index; r.own = f.own;
        ids.push(it.id);
      }
      info.push({ index, id: f.team.id, name: f.team.name, color: f.team.color, own: f.own, ids });
      layout.teams.push(layoutFor(ids, f.plans));
    });
    Strat.init(race, layout);
    const own = info[0].ids.map((id) => race.riders.find((r) => r.id === id));
    const pick = own.find((r) => r.id === opts.controlled) || own.find((r) => r.id === layout.teams[0].leader) || own[0];
    Race.takeControl(race, pick);
    race.teamGame = { teams: info, cfg, mine: mine.id };
    return { teams: info, own, controlled: pick };
  }

  /** Passe le pilotage à un autre coureur de l'équipe (le précédent reprend son plan de coureur virtuel). Renvoie le coureur piloté, ou null. */
  function switchTo(race, id) {
    const tg = race.teamGame, Race = PYR.race;
    if (!tg) return null;
    const r = race.riders.find((x) => x.id === id && x.own);
    if (!r) return null;
    if (r.human) return r;
    for (const o of race.riders) if (o.own && o.human) Race.releaseControl(race, o);
    return Race.takeControl(race, r);
  }

  /** Coureur piloté actuellement. */
  const controlled = (race) => race.riders.find((r) => r.own && r.human) || null;

  /** Donne un autre plan (rôle) à un coureur de l'équipe du joueur, en course : l'équipe est reformée avec les nouveaux rôles. */
  function setPlan(race, id, role) {
    const tg = race.teamGame;
    if (!tg || !ROLE_IDS.includes(role)) return false;
    const mine = tg.teams[0];
    if (!mine.ids.includes(id)) return false;
    tg.cfg.plans[id] = role;
    PYR.strategy.setTeamRoles(race, 0, layoutFor(mine.ids, tg.cfg.plans));
    return true;
  }

  /** Plan (rôle) d'un coureur de l'équipe du joueur. */
  const planOf = (race, id) => (race.teamGame ? race.teamGame.cfg.plans[id] || null : null);

  /**
   * Classement par équipes : somme des temps de leurs trois premiers arrivés (comme au Tour). Les équipes qui n'ont pas trois arrivés ne sont
   * pas classées au temps : elles suivent, rangées par nombre d'arrivés puis par distance moyenne parcourue de leurs trois premiers.
   * Renvoie [{id, name, color, own, time (s, ou null), finished, rank}].
   */
  function teamStandings(race) {
    const tg = race.teamGame;
    if (!tg) return [];
    const L = race.course.length;
    const rows = tg.teams.map((t) => {
      const rs = t.ids.map((id) => race.riders.find((r) => r.id === id)).filter(Boolean);
      const fin = rs.filter((r) => r.finished).map((r) => r.time).sort((a, b) => a - b);
      const dist = rs.map((r) => (r.finished ? L : r.st.s)).sort((a, b) => b - a).slice(0, 3);
      return { id: t.id, name: t.name, color: t.color, own: t.own, finished: fin.length, time: fin.length >= 3 ? fin[0] + fin[1] + fin[2] : null, dist: dist.reduce((s, x) => s + x, 0) };
    });
    rows.sort((a, b) => {
      if (a.time !== null && b.time !== null) return a.time - b.time;
      if (a.time !== null) return -1;
      if (b.time !== null) return 1;
      return b.finished - a.finished || b.dist - a.dist;
    });
    rows.forEach((r, i) => { r.rank = i + 1; delete r.dist; });
    return rows;
  }

  PYR.teamGame = {
    MAX_OWN, MIN_SIZE, MAX_SIZE, MAX_FIELD, ROLE_CHOICES, ROLE_IDS, LEADER_ROLES,
    roleLabel, teams, findTeam, defaultSelection, defaultPlans, layoutFor, normalize, populate, switchTo, controlled, setPlan, planOf, teamStandings,
  };
})(globalThis.PYR = globalThis.PYR || {});
