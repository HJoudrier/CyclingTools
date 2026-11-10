/* author : Hugo Joudrier-Faure */
/* PaceYourRide — stratégies des coureurs virtuels (règle de course `strategy`).
 *
 * Chaque coureur virtuel a un rôle dans une équipe (ou court pour lui seul) et, selon ce rôle, des objectifs :
 *   win        gagner la course (ou l'étape) : s'économiser jusqu'au moment clé, puis attaquer ou sprinter ;
 *   kom        marquer des points au classement de la montagne : se placer avant la côte, attaquer au pied ou plus près du sommet ;
 *   points     marquer des points aux sprints (intermédiaires et arrivée) : se placer, partir à sa distance de lancement ;
 *   combat     décrocher le dossard de combativité : attaquer, sauter dans les échappées, rester devant le plus longtemps ;
 *   show       montrer le maillot (de leader d'un classement) : rouler aux premières places, dans l'échappée ;
 *   work       rouler pour un leader : mener le peloton, le placer, rester autour de lui, se sacrifier ;
 *   save       s'économiser : abrité, sans relais, sans courir après les attaques ni les roues qui partent ;
 *   safe       rester à l'avant du groupe avant les passages à risque (route étroite, virages, descente, pied d'une côte, vent) ;
 *   echelon    faire des bordures : par vent de côté, mener à fond côté vent pour casser le peloton en éventails ;
 *   control    contrôler les échappées : relayer en tête du peloton à l'allure qui garde l'écart voulu ;
 *   protect    protéger un coureur : l'abriter du vent, rester dans ses roues ou devant lui, l'attendre s'il a crevé ou chuté ;
 *   pilot      poisson pilote : guider le sprinteur vers l'avant du groupe, de roue en roue, dans les derniers kilomètres ;
 *   train      préparer le sprint (faire le train) : mener à fond chacun son tour, du plus loin au plus près, puis s'écarter.
 *
 * Une seconde de course (race.step) : `tick` (équipes, analyse de la situation commune, combativité, maillots), puis pour chaque coureur
 * virtuel `think` (toutes les 2 à 4 s : choisit un objectif et le traduit en tactique), puis `command` (consigne de puissance de la
 * seconde, pour les plans propres à la stratégie). Ce qui revient à des tactiques existantes (relais, attaque, sprint, dans les roues)
 * les utilise telles quelles ; le reste est le mode « strat » (plans : sit, escort, drive, peel).
 * Tout est tiré d'un flux aléatoire à part (graine ^ constante) : les autres tirages de la course ne sont pas décalés. */
(function (PYR) {
  'use strict';

  const Dr = PYR.draft, Tac = PYR.tactics, Pel = PYR.peloton, Cl = PYR.classif, U = PYR.util;
  const BIKE = Dr.BIKE, clamp = U.clamp;

  /* ---------- catalogues ---------- */

  const GOALS = {
    win: 'Gagner la course', kom: 'Points de la montagne', points: 'Points des sprints', combat: 'Dossard de combativité',
    show: 'Montrer le maillot', work: 'Rouler pour un leader', save: "S'économiser", safe: 'Rester à l\'avant (chutes, cassures)',
    echelon: 'Faire les bordures', control: 'Contrôler les échappées', protect: 'Protéger un coureur', pilot: 'Poisson pilote',
    train: 'Faire le train',
  };

  /** Rôles : libellé et poids (0 à 1) de chaque objectif ; chaque coureur reçoit ceux de son rôle, à quelques points près. */
  const ROLES = {
    captain: { label: 'Leader', goals: { win: 1, safe: 0.9, save: 0.8, control: 0.3, kom: 0.2, points: 0.1, show: 0.2 } },
    sprinter: { label: 'Sprinteur', goals: { win: 0.8, points: 1, safe: 1, save: 0.8, control: 0.3 } },
    climber: { label: 'Grimpeur', goals: { win: 0.7, kom: 1, safe: 0.6, save: 0.7, combat: 0.3, show: 0.3 } },
    baroudeur: { label: 'Baroudeur', goals: { win: 0.3, combat: 1, show: 0.8, kom: 0.5, points: 0.3, safe: 0.2, echelon: 0.4 } },
    domestique: { label: 'Équipier', goals: { work: 1, protect: 0.8, control: 0.9, echelon: 0.8, safe: 0.5, save: 0.5 } },
    leadout: { label: 'Poisson de tête (train)', goals: { train: 1, work: 0.6, safe: 0.8, control: 0.5, protect: 0.5 } },
    pilot: { label: 'Poisson pilote', goals: { pilot: 1, safe: 0.9, protect: 0.6, work: 0.3 } },
    rouleur: { label: 'Rouleur', goals: { echelon: 0.8, control: 0.5, show: 0.3, combat: 0.4, win: 0.2, safe: 0.5 } },
    gruppetto: { label: 'Gruppetto', goals: { save: 1, safe: 0.5 } },
  };

  /** Ambitions d'une équipe : le rôle de son leader. */
  const LEADER_ROLE = { sprint: 'sprinter', win: 'captain', kom: 'climber', break: 'baroudeur' };

  const TRAIN_START = 3300;   // m : le train se met en place (premier relais) à cette distance de l'arrivée
  const TRAIN_FORM = 1500;    // m : on s'y rassemble en tête avant son départ (remonter dans un peloton dense prend du temps)
  const PILOT_START = 3000;   // m : le poisson pilote prend en charge le sprinteur
  const FINALE_KM = 6500;     // m : les rôles de la finale commencent : on se place (train, poisson pilote, sprint viennent plus près)
  const CONTROL_END = 1500;   // m : plus de contrôle des échappées dans les derniers 1 500 m (tout le monde y est pour la finale)
  const FRONT_RELAY = 10;     // places : on ne relaie qu'aux premières places d'un groupe
  const THINK_MIN = 2, THINK_SPAN = 3;
  const FOLLOW_CHASE = 45;    // m : portée de poursuite d'un coureur sans mission (la règle d'avant : 150 m)
  const PACK_GAP_S = 6;       // s : deux groupes séparés de moins de 6 s ne forment qu'un paquet pour la stratégie (ce n'est pas une échappée)
  const ATTACK_COOLDOWN = 150; // s : entre deux attaques de lancement d'échappée (tout le peloton confondu)

  /* ---------- profil du parcours ---------- */

  /** Résumé du parcours : côtes classées, arrivée au sommet ou sur le plat, parcours vallonné, kilomètres de route à risque. */
  function profileOf(race) {
    const C = race.course, L = C.length, step = C.step, ele = C.ele;
    const climbs = ele ? Cl.findClimbs(ele, step).filter((c) => c.cat) : [];
    const last = climbs.length ? climbs[climbs.length - 1] : null;
    const summit = !!last && L - last.end < 1500;
    let fg = 0, gain = 0;
    if (ele && ele.length > 3) {
      const i1 = ele.length - 1, i0 = Math.max(0, i1 - Math.round(3000 / step));
      fg = (ele[i1] - ele[i0]) / Math.max(1, (i1 - i0) * step);
      for (let i = 1; i < ele.length; i++) if (ele[i] > ele[i - 1]) gain += ele[i] - ele[i - 1];
    }
    // risque par case de 50 m : route étroite, virage serré, descente raide
    const cell = 50, nc = Math.max(1, Math.ceil(L / cell)), danger = new Float32Array(nc);
    for (let k = 0; k < nc; k++) {
      const i = clamp(Math.round((k + 0.5) * cell / step), 0, C.n - 1);
      let d = 0;
      const w = C.width ? C.width[i] : 99;
      if (w < 3.5) d = Math.max(d, 0.8); else if (w < 5) d = Math.max(d, 0.6);
      const kap = C.kappa ? Math.abs(C.kappa[i]) : 0;
      if (kap > 1 / 60) d = Math.max(d, 0.6); else if (kap > 1 / 120) d = Math.max(d, 0.3);
      const g = C.grade ? C.grade[i] : 0;
      if (g < -0.06) d = Math.max(d, 0.5); else if (g < -0.03) d = Math.max(d, 0.2);
      danger[k] = d;
    }
    for (const c of climbs) { // pied des côtes : on veut être placé pour ne pas être lâché quand le rythme monte
      if (c.gain < 60) continue;
      for (let s = Math.max(0, c.start - 900); s < c.start; s += cell) danger[Math.min(nc - 1, Math.floor(s / cell))] = Math.max(danger[Math.min(nc - 1, Math.floor(s / cell))], 0.5);
    }
    return { L, climbs, summit, finishGrade: fg, hilly: L > 0 && gain / L > 0.012, flatFinish: !summit && fg < 0.02, danger, cell };
  }

  /** Risque de la route entre s et s + look (0 à 1). */
  function dangerAhead(S, s, look) {
    const P = S.prof, a = Math.max(0, Math.floor(s / P.cell)), b = Math.min(P.danger.length - 1, Math.floor((s + look) / P.cell));
    let m = 0;
    for (let k = a; k <= b; k++) if (P.danger[k] > m) m = P.danger[k];
    return m;
  }

  /* ---------- équipes et rôles ---------- */

  const hashRnd = (race, k) => U.mulberry32((race.seed ^ k) >>> 0);

  /** Objectifs d'un rôle, avec un peu de caractère propre à chacun. */
  function goalsFor(role, rnd) {
    const out = {};
    for (const k of Object.keys(GOALS)) out[k] = 0;
    for (const [k, v] of Object.entries(ROLES[role].goals)) out[k] = clamp(v + 0.2 * (rnd() - 0.5), 0.05, 1);
    return out;
  }

  function setRole(r, role, team, rnd, extra) {
    const b = r.bot || r.botProfile || {};
    // le rôle accentue le goût du coureur (sans jamais l'affaiblir) : les autres décisions (lignes, attaques) s'en servent
    if (role === 'sprinter') b.sprint = Math.max(b.sprint || 0, 0.8);
    else if (role === 'climber') b.climb = Math.max(b.climb || 0, 0.8);
    else if (role === 'baroudeur') b.aggr = Math.max(b.aggr || 0, 0.38);
    r.strat = Object.assign({
      role, team, goals: goalsFor(role, rnd), goal: 'free', label: ROLES[role].label, since: 0,
      launch: 270 + 90 * rnd(),                 // m : distance de l'arrivée à laquelle il lance son sprint (la règle d'avant : 250 m + 6 × vitesse)
      finalAttack: 800 + 2700 * rnd(),          // m : distance de l'arrivée à laquelle il peut attaquer en solitaire
      showUntil: 0.4 + 0.4 * rnd(),             // part du parcours pendant laquelle il montre son maillot
      lastAttack: -1e9, attacked: false, komSeen: -1, spSeen: -1, noPlanUntil: -1,
    }, extra || {});
  }

  /** Équipes, rôles et objectifs des coureurs virtuels ; layout (facultatif, tests) : {teams: [{ambition, leader, riders: [{id, role}]}], solo: [{id, role}]}. */
  function init(race, layout) {
    const rnd = hashRnd(race, 0x3c6ef372);
    const bots = race.riders.filter((r) => r.bot);
    const S = race.strat = {
      rnd, nBots: bots.length, teams: [], prof: profileOf(race), sit: null, by: new Map(race.riders.map((r) => [r.id, r])),
      lastBreakAttack: -1e9, combat: new Map(), jersey: { points: null, kom: null, lead: null, t: -1e9 }, awarded: false, layout: !!layout,
    };
    for (const r of bots) { r.strat = null; r.tac.plan = null; r.tac.nextThink = 0; }
    if (layout) applyLayout(race, S, layout);
    else autoLayout(race, S, bots, rnd);
    for (const r of bots) if (!r.strat) setRole(r, soloRole(r, bots), -1, rnd);
    return S;
  }

  /** Rôle d'un coureur qui court pour lui seul, d'après ses goûts relatifs au peloton. */
  function soloRole(r, bots) {
    const b = r.bot, n = bots.length || 1;
    const rank = (k) => bots.filter((o) => (o.bot[k] || 0) > (b[k] || 0)).length / n; // 0 = le plus fort du peloton
    if (rank('sprint') < 0.2) return 'sprinter';
    if (rank('climb') < 0.2) return 'climber';
    if (rank('aggr') < 0.3) return 'baroudeur';
    if (b.level < 0.97 && b.aggr < 0.25) return 'gruppetto';
    return 'rouleur';
  }

  function applyLayout(race, S, layout) {
    const rnd = S.rnd, byId = S.by;
    (layout.teams || []).forEach((t, i) => { if (t.riders) S.teams.push(teamFromSpec(S, i, t)); });
    for (const x of layout.solo || []) { const r = byId.get(x.id); if (r && (r.bot || r.botProfile)) setRole(r, x.role, -1, rnd); }
  }

  /** Équipe d'après sa description {ambition, leader, riders: [{id, role}]} (les rôles : ROLES, plus « protector » : équipier protecteur). */
  function teamFromSpec(S, i, t) {
    const rnd = S.rnd, byId = S.by;
    const tm = newTeam(i, t.ambition || 'win');
    for (const x of t.riders) {
      const r = byId.get(x.id);
      if (!r || !(r.bot || r.botProfile)) continue;
      tm.ids.push(r.id);
      if (x.role === 'sprinter' || (!tm.sprinter && t.leader === r.id && tm.ambition === 'sprint')) tm.sprinter = r.id;
      if (x.role === 'pilot') tm.pilot = r.id;
      if (x.role === 'leadout') tm.leadouts.push(r.id);
      if (x.role === 'protector') tm.protector = r.id;
      setRole(r, x.role === 'protector' ? 'domestique' : x.role, i, rnd, x.role === 'protector' ? { protector: true } : null);
    }
    tm.leader = t.leader || tm.ids[0];
    markProtector(S, tm);
    for (const id of tm.ids) wire(S, tm, byId.get(id));
    return tm;
  }

  /**
   * Change les rôles d'une équipe en cours de course (mode équipe : le joueur modifie le plan d'un coureur) : mêmes champs que layout.teams[i].
   * Le train, le contrôle et le reste de l'état de la course sont conservés ; le train se reforme si ses lanceurs ont changé.
   */
  function setTeamRoles(race, i, spec) {
    const S = race.strat;
    if (!S || !S.teams[i]) return null;
    const old = S.teams[i], tm = teamFromSpec(S, i, spec);
    tm.control = old.control;
    if (old.train && old.leadouts.join() === tm.leadouts.join() && old.sprinter === tm.sprinter) tm.train = old.train;
    S.teams[i] = tm;
    return tm;
  }

  const newTeam = (i, ambition) => ({
    i, ambition, ids: [], leader: null, sprinter: null, pilot: null, protector: null, leadouts: [],
    lead: null, inBreak: false, control: null, echelon: false, train: null, mate: null,
  });

  /** Liens d'un équipier : son leader, le sprinteur qu'il guide ou qu'il lance, le coureur qu'il protège. */
  function wire(S, tm, r) {
    const my = r.strat;
    my.leader = tm.leader;
    my.sprinter = tm.sprinter;
    my.protectee = r.id === tm.leader ? null : tm.sprinter || tm.leader;
  }

  function autoLayout(race, S, bots, rnd) {
    const n = bots.length, P = S.prof;
    if (n < 10) return; // trop peu de coureurs pour des équipes : chacun court pour lui seul
    const nTeams = Math.max(2, Math.round(n / 6)), k = clamp(Math.round(n / nTeams), 4, 9), count = Math.min(nTeams, Math.floor(n / k));
    const pool = bots.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const taken = { sprint: 0, win: 0, kom: 0, break: 0 };
    const hasKom = race.cps.some((c) => c.type === 'kom');
    for (let i = 0; i < count; i++) {
      const members = pool.splice(0, k);
      // ambition selon le parcours, en variant d'une équipe à l'autre
      const w = {
        sprint: (P.flatFinish ? 3 : P.hilly ? 0.5 : 1.5) / (1 + taken.sprint),
        win: (P.summit || P.hilly ? 3 : 1.5) / (1 + taken.win),
        kom: (hasKom || P.climbs.length ? 1.2 : 0) / (1 + taken.kom),
        break: 1.2 / (1 + taken.break),
      };
      const tot = w.sprint + w.win + w.kom + w.break;
      let u = rnd() * tot, amb = 'break';
      for (const key of ['sprint', 'win', 'kom', 'break']) { if (u < w[key]) { amb = key; break; } u -= w[key]; }
      taken[amb]++;
      buildTeam(race, S, i, amb, members, rnd);
    }
  }

  /** Rôles d'une équipe : le leader (le mieux adapté à l'ambition), puis selon elle des poissons pilotes, des lanceurs, des équipiers. */
  function buildTeam(race, S, i, amb, members, rnd) {
    const tm = newTeam(i, amb);
    const score = {
      sprint: (r) => (r.bot.sprint || 0) + 0.2 * r.bot.level,
      win: (r) => r.bot.level * (0.6 + 0.4 * Math.max(r.bot.sprint || 0, r.bot.climb || 0)),
      kom: (r) => (r.bot.climb || 0) + 0.2 * r.bot.level,
      break: (r) => (r.bot.aggr || 0) + 0.2 * r.bot.level,
    }[amb];
    const left = members.slice().sort((a, b) => score(b) - score(a));
    const lead = left.shift();
    tm.leader = lead.id;
    tm.ids = [lead.id];
    const give = (r, role, extra) => { tm.ids.push(r.id); setRole(r, role, i, rnd, extra); };
    setRole(lead, LEADER_ROLE[amb], i, rnd);
    if (amb === 'sprint') {
      tm.sprinter = lead.id;
      if (left.length >= 5) { const p = left.shift(); tm.pilot = p.id; give(p, 'pilot'); }
      const nLo = clamp(Math.floor((left.length + 1) / 2), 1, 3);
      for (let j = 0; j < nLo && left.length > 1; j++) { const x = left.shift(); tm.leadouts.push(x.id); give(x, 'leadout'); }
    } else if (amb === 'win') {
      left.sort((a, b) => b.bot.level - a.bot.level);
      const p = left.shift();
      if (p) { tm.protector = p.id; give(p, 'domestique', { protector: true }); }
    } else if (amb === 'break' && left.length > 1) {
      const nb = Math.min(2, left.length - 1); // les autres baroudeurs de l'équipe
      left.sort((a, b) => (b.bot.aggr || 0) - (a.bot.aggr || 0));
      for (let j = 0; j < nb; j++) give(left.shift(), 'baroudeur');
    }
    for (const x of left) give(x, 'domestique');
    markProtector(S, tm);
    for (const id of tm.ids) wire(S, tm, S.by.get(id));
    S.teams.push(tm);
    return tm;
  }

  /** Chaque équipe a son protecteur (lieutenant) : le meilleur de ses équipiers, qui attend et ramène le leader s'il est en difficulté. */
  function markProtector(S, tm) {
    if (tm.protector) { S.by.get(tm.protector).strat.protector = true; return; }
    let best = null;
    for (const id of tm.ids) {
      const r = S.by.get(id);
      if (r.strat.role === 'domestique' && (!best || r.bot.level > best.bot.level)) best = r;
    }
    if (best) { tm.protector = best.id; best.strat.protector = true; }
  }

  /** Le risque de chute au fond d'un gros groupe (accordéon, freinages) par rapport à celui de tête : 1 à l'avant, jusqu'à 1,6 au fond. */
  function depthRisk(rank, size) {
    if (!(size > 1)) return 1;
    return 1 + 0.6 * clamp(rank / (size - 1), 0, 1) * Math.min(1, (size - 10) / 30);
  }

  /* ---------- situation de la course (une fois par seconde, commune à tous) ---------- */

  /**
   * Groupes (par l'aspiration), peloton (le plus gros), échappées devant et groupes de poursuite derrière, avec leur écart en secondes ;
   * vent de côté signé au niveau de la tête du peloton (tb > 0 : il vient de la droite).
   */
  function situation(race, view, S) {
    const act = [];
    for (const e of view.field) if (!e.stopped && !e.finished && view.info.has(e.id)) act.push(e);
    act.sort((a, b) => b.s - a.s);
    // paquets : les groupes d'aspiration se suivent de l'avant vers l'arrière ; deux voisins à moins de PACK_GAP_S secondes se fondent en un seul
    const groups = [], by = new Map();
    let prev = null, prevGroup = -1;
    for (const e of act) {
      const info = view.info.get(e.id);
      let g = groups[groups.length - 1];
      if (!g || (info.group !== prevGroup && (prev.s - e.s - BIKE) / Math.max(3, e.v, prev.v) >= PACK_GAP_S)) {
        g = { i: groups.length, head: e.s, tail: e.s, n: 0, v: e.v, ids: [], gapT: 0 };
        groups.push(g);
      }
      by.set(e.id, { e, info, g, rank: g.n });
      g.n++; g.tail = e.s; g.ids.push(e.id);
      prev = e; prevGroup = info.group;
    }
    const out = { t: race.t, act, groups, by, pel: null, breaks: [], chasers: [], tb: 0, front: act[0] || null, L: race.course.length };
    if (!groups.length) return out;
    // le peloton : le paquet qui garde le plus de l'ancien (il ne change pas à chaque fois que deux paquets ont la même taille), sinon le plus gros
    let pel = groups[0], bestK = -1;
    const prevPel = S.pelIds;
    for (const g of groups) {
      let common = 0;
      if (prevPel) for (const id of g.ids) if (prevPel.has(id)) common++;
      const k = prevPel && prevPel.size ? common / prevPel.size : g.n;
      if (k > bestK + 1e-9 || (Math.abs(k - bestK) < 1e-9 && g.n > pel.n)) { bestK = k; pel = g; }
    }
    if (prevPel && prevPel.size && bestK < 0.5) { pel = groups[0]; for (const g of groups) if (g.n > pel.n) pel = g; } // l'ancien peloton s'est éparpillé : le plus gros
    S.pelIds = new Set(pel.ids);
    out.pel = pel;
    const vp = Math.max(3, pel.v);
    for (const g of groups) {
      if (g === pel) continue;
      if (g.i < pel.i) { g.gapT = (g.tail - pel.head - BIKE) / vp; out.breaks.push(g); }
      else { g.gapT = (pel.tail - g.head - BIKE) / Math.max(3, g.v); out.chasers.push(g); }
    }
    pel.gapT = 0;
    const hd = S.by.get(pel.ids[0]);
    if (hd && hd.cond) out.tb = Pel.yaw(hd);
    return out;
  }

  /** Places visées dans un groupe de n coureurs à toGo mètres de l'arrivée : de plus en plus près de la tête (2 à 12). */
  function rankWanted(toGo, n) {
    return clamp(Math.round(n * (0.04 + 0.21 * clamp((toGo - 400) / 6000, 0, 1))), 2, 12);
  }

  /* ---------- équipes : contrôle, bordures, train (une fois par seconde) ---------- */

  const rider = (S, id) => S.by.get(id);
  /** Niveau d'un coureur virtuel (1 pour celui que le joueur pilote, dont les préférences sont mises de côté). */
  const levelOf = (r) => { const b = r && (r.bot || r.botProfile); return b && b.level > 0 ? b.level : 1; };

  function teamTick(race, S, sit) {
    const L = sit.L;
    for (const tm of S.teams) {
      const ld = sit.by.get(tm.leader) || null;
      tm.lead = ld;
      tm.inBreak = tm.ids.some((id) => { const x = sit.by.get(id); return !!x && x.g.i < sit.pel.i; });
      controlTick(race, S, sit, tm, ld, L);
      echelonTick(S, sit, tm, ld);
      trainTick(race, S, sit, tm, L);
    }
  }

  /** Une équipe qui veut ramener l'échappée : écart voulu (7 s par kilomètre restant, 5 s pour une équipe de leader) et équipiers au travail. */
  function controlTick(race, S, sit, tm, ld, L) {
    const pel = sit.pel;
    let want = false, brk = null;
    if (ld && ld.g === pel && !tm.inBreak && sit.breaks.length && (tm.ambition === 'sprint' || tm.ambition === 'win')) {
      brk = sit.breaks[sit.breaks.length - 1]; // la plus proche du peloton : la première à ramener
      const toGo = L - ld.e.s;
      if (toGo > CONTROL_END && brk.gapT > 4) {
        if (tm.ambition === 'sprint') want = true;
        else { // une équipe de leader n'y va que si l'échappée est dangereuse
          const lv = levelOf(rider(S, tm.leader));
          let best = 0;
          for (const id of brk.ids) best = Math.max(best, levelOf(rider(S, id)));
          want = best >= lv * 0.97 || brk.gapT > 150;
        }
      }
    }
    if (!want) {
      // on ne cesse de contrôler qu'après 15 s sans raison de le faire (l'écart ou le peloton change d'une seconde à l'autre)
      if (tm.control && race.t - tm.control.last < 15) return;
      if (tm.control && race.onEvent) logTeam(race, tm, 'control-stop');
      tm.control = null;
      return;
    }
    const toGo = L - ld.e.s, target = clamp(toGo / 1000 * (tm.ambition === 'sprint' ? 7 : 5), 0, 200);
    const err = brk.gapT - target;
    const was = tm.control ? tm.control.workers : new Set();
    const cand = [];
    for (const id of tm.ids) {
      const r = rider(S, id), x = sit.by.get(id);
      if (!x || !r.bot || x.g !== pel || id === tm.leader || id === tm.sprinter || id === tm.pilot) continue; // (pas celui que pilote le joueur)
      if (r.strat.role !== 'domestique' && r.strat.role !== 'rouleur' && !(r.strat.role === 'leadout' && !tm.train)) continue;
      if (Tac.wFrac(r) < (was.has(id) ? 0.3 : 0.5)) continue;
      cand.push({ id, k: (was.has(id) ? 0 : 100) + x.rank });
    }
    cand.sort((a, b) => a.k - b.k);
    const nMax = clamp(Math.ceil(tm.ids.length / 2), 1, 4);
    const workers = new Set(cand.slice(0, nMax).map((c) => c.id));
    if (!tm.control && race.onEvent) logTeam(race, tm, 'control-start', { gap: Math.round(brk.gapT) });
    tm.control = { gapT: brk.gapT, target, err, frac: clamp(0.9 + 0.004 * err, 0.75, 1.12), workers, last: race.t };
  }

  /** Bordures : vent de côté fort, sur du plat, en groupe assez gros ; l'équipe dont le leader est bien placé y met ses rouleurs. */
  function echelonTick(S, sit, tm, ld) {
    const pel = sit.pel;
    const on = Math.abs(sit.tb) >= 0.3 && pel.n >= 8 && pel.v > 7 && !!ld && ld.g === pel && ld.rank <= Math.max(8, Math.round(0.35 * pel.n)) && !tm.inBreak;
    tm.echelon = on;
  }

  /**
   * Le train : à TRAIN_START m de l'arrivée, les lanceurs (où qu'ils soient) se placent par ordre d'arrivée en tête ; chacun mène un tronçon, du
   * plus loin au plus près. Le suivant ne prend le relais que s'il est vraiment en tête (4 premières places) : sinon celui qui mène continue.
   */
  function trainTick(race, S, sit, tm, L) {
    if (!tm.sprinter || !tm.leadouts.length) return;
    const sp = sit.by.get(tm.sprinter);
    if (!sp) { tm.train = null; return; }
    const toGo = L - sp.e.s, spr = rider(S, tm.sprinter);
    if (!tm.train) {
      if (toGo > TRAIN_START + TRAIN_FORM || sp.g !== sit.pel) return;
      const av = tm.leadouts.filter((id) => rider(S, id).bot).map((id) => sit.by.get(id)).filter(Boolean).sort((a, b) => b.e.s - a.e.s).map((x) => x.e.id);
      if (!av.length) return;
      tm.train = { order: av, A: TRAIN_START, E: spr.strat.launch + 80, phase: 'form', cur: av[0], k: 0, last: av[av.length - 1] };
      if (race.onEvent) logTeam(race, tm, 'train-form', { n: av.length });
    }
    const tr = tm.train, n = tr.order.length, len = (tr.A - tr.E) / n;
    tr.phase = toGo <= tr.E ? 'done' : toGo <= tr.A ? 'run' : 'form';
    tr.len = len;
    tr.on = tr.phase !== 'done';
    // celui dont c'est le tour (le tronçon de sa distance) ; en tête et valide pour mener ; sinon le précédent continue, sinon le suivant disponible
    const k = clamp(Math.floor((tr.A - toGo) / len), 0, n - 1);
    const here = (id) => !!sit.by.get(id);
    const ready = (id) => { const x = sit.by.get(id); return !!x && x.rank <= 4 && Tac.wFrac(rider(S, id)) > 0.2; };
    let cur = null;
    if (tr.phase === 'form') cur = tr.order.find(here) || null;
    else if (here(tr.order[k]) && (ready(tr.order[k]) || k === 0)) cur = tr.order[k];
    for (let j = k - 1; j >= 0 && !cur; j--) if (ready(tr.order[j])) cur = tr.order[j];
    for (let j = k; j < n && !cur; j++) if (here(tr.order[j])) cur = tr.order[j];
    for (let j = k - 1; j >= 0 && !cur; j--) if (here(tr.order[j])) cur = tr.order[j];
    tr.cur = cur;
    tr.k = k;
    const ci = cur ? tr.order.indexOf(cur) : -1;
    // le dernier du train, derrière qui le sprinteur s'abrite : celui qui peut encore mener et qui est vraiment en tête (sinon le sprinteur
    // irait se perdre au fond du peloton pour le rejoindre)
    tr.last = null;
    for (let j = n - 1; j >= 0 && !tr.last; j--) if (here(tr.order[j]) && j >= ci && sit.by.get(tr.order[j]).rank <= 6) tr.last = tr.order[j];
    if (!tr.last) tr.last = cur;
  }

  function logTeam(race, tm, what, data) {
    const ev = Object.assign({ t: race.t, id: tm.leader, name: race.strat.by.get(tm.leader).name, type: 'strategy', what, team: tm.i }, data || {});
    race.events.push(ev);
    if (race.onEvent) race.onEvent(ev);
  }

  /* ---------- combativité et maillots ---------- */

  /**
   * Combativité : chaque seconde passée devant le peloton (à plus de 8 s) marque des points, davantage en solitaire et loin devant ;
   * chaque attaque lancée en vaut 10. Décernée à l'arrivée du vainqueur (dossard rouge).
   */
  function combatTick(race, S, sit) {
    const pel = sit.pel;
    if (!pel) return;
    for (const g of sit.breaks) {
      if (g.gapT < 8) continue;
      const w = (1 + 0.5 * Math.min(g.gapT / 60, 2)) * (g.n === 1 ? 1.5 : 1);
      for (const id of g.ids) S.combat.set(id, (S.combat.get(id) || 0) + w);
    }
  }

  function noteAttack(S, id) { S.combat.set(id, (S.combat.get(id) || 0) + 10); }

  /** Classement de combativité : [{id, name, score, rank}], du plus combatif au moins combatif. */
  function combativity(race) {
    const S = race.strat;
    if (!S) return [];
    const list = [...S.combat.entries()].filter((x) => x[1] > 0).map(([id, score]) => ({ id, name: S.by.get(id) ? S.by.get(id).name : id, score: Math.round(score * 10) / 10 }));
    list.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    list.forEach((x, i) => { x.rank = i + 1; });
    return list;
  }

  /** Les maillots du moment : points (vert), montagne (à pois), tête de la course sur la route. Rafraîchis toutes les 10 s. */
  function jerseys(race) {
    const S = race.strat;
    if (!S) return { points: null, kom: null, lead: null };
    const J = S.jersey;
    if (race.t - J.t >= 10) {
      J.t = race.t;
      const st = Cl.standings(race.cps, race.riders.map((r) => ({ id: r.id, splits: r.splits, s: r.st.s })));
      J.points = st.points.length && st.points[0].pts > 0 ? st.points[0].id : null;
      J.kom = st.kom.length && st.kom[0].pts > 0 ? st.kom[0].id : null;
      let lead = null;
      for (const r of race.riders) if (!r.finished && (!lead || r.st.s > lead.st.s)) lead = r;
      J.lead = lead ? lead.id : null;
    }
    return J;
  }

  function awardTick(race, S) {
    if (S.awarded) return;
    if (!race.riders.some((r) => r.finished)) return;
    S.awarded = true;
    const top = combativity(race)[0];
    if (top && race.onEvent) {
      const ev = { t: race.t, id: top.id, name: top.name, type: 'combat', score: top.score };
      race.events.push(ev);
      race.onEvent(ev);
    }
  }

  /* ---------- une seconde ---------- */

  function tick(race, view) {
    let S = race.strat;
    // équipes dressées au premier pas, et de nouveau si des coureurs virtuels sont arrivés depuis (sauf organisation imposée)
    const nBots = race.riders.reduce((n, r) => n + (r.bot ? 1 : 0), 0);
    if (!S || (S.nBots !== nBots && !S.layout)) S = init(race);
    S.sit = situation(race, view, S);
    if (!S.sit.pel) return;
    for (const g of S.sit.groups) g.movers = 0;
    for (const [id, x] of S.sit.by) {
      const r = S.by.get(id);
      if (!r || !r.strat) continue;
      r.strat.rank = x.rank; r.strat.packN = x.g.n; r.strat.packV = x.g.v;
      if (r.tac.mode === 'strat' && r.tac.phase === 'move') x.g.movers++; // ceux qui sont déjà en train de remonter
    }
    teamTick(race, S, S.sit);
    combatTick(race, S, S.sit);
    jerseys(race);
    awardTick(race, S);
  }

  /* ---------- décisions d'un coureur virtuel ---------- */

  /** Une tactique existante (relais, dans les roues, allure fixe) ; la tactique change seulement si elle n'est pas déjà celle-là. */
  function useMode(r, mode, goal, label) {
    if (r.tac.mode !== mode) Tac.setMode(r, mode, r.st.t);
    r.tac.chase = FOLLOW_CHASE; // « dans les roues » : on ne court pas après ce qui s'en va (sauf mission, ci-dessous)
    note(r, goal, label);
  }

  /** Un plan de la stratégie (mode « strat » : sit, escort, drive, peel). */
  function usePlan(r, kind, p, goal, label) {
    const tac = r.tac;
    if (r.st.t < r.strat.noPlanUntil) { useMode(r, 'follow', 'free'); return; } // garde-fou en cours : dans les roues
    if (tac.mode !== 'strat') Tac.setMode(r, 'strat', r.st.t);
    tac.plan = Object.assign({ kind }, p);
    note(r, goal, label);
  }

  function note(r, goal, label) {
    const my = r.strat;
    if (my.goal !== goal) { my.goal = goal; my.since = r.st.t; }
    my.label = label || ROLES[my.role].label;
  }

  function relay(r, W, goal, label) {
    useMode(r, 'relay', goal, label);
    r.tac.pull = W;
  }

  /** S'écarter une seule fois (8 s), puis rester dans les roues sans plus chercher à mener ni à sprinter : relancé à chaque décision, on ralentirait sans fin. */
  function peelOnce(c, goal, label) {
    const { r, my, t } = c;
    if (my.peeledAt === undefined) my.peeledAt = t;
    if (t < my.peeledAt + 8) usePlan(r, 'peel', { until: my.peeledAt + 8, then: 0.8 }, goal, label);
    else usePlan(r, 'sit', { cap: 0.85 }, 'save', label);
  }

  /**
   * Se placer aux `front` premières places de son paquet (on garde sa place une fois arrivé). Pour monter, il faut de la place : un seul coureur
   * sur six du paquet monte à la fois (un sur trois pour les rôles prioritaires : train, poisson pilote, sprinteur) ; à vouloir tous passer
   * devant, plus personne ne passe. Quand le quota est atteint, on se contente de tenir sa place dans les roues et on montera au prochain tour.
   */
  function place(c, front, goal, label, prio, extra) {
    const { r, me } = c, g = me.g;
    const moving = r.tac.mode === 'strat' && r.tac.phase === 'move'; // déjà compté parmi ceux qui montent
    let f = front;
    if (me.rank > front && !moving) {
      if (g.movers >= Math.max(2, Math.ceil(g.n / (prio ? 3 : 6)))) f = undefined; // pas de place pour monter maintenant
      else g.movers++;
    }
    usePlan(r, 'sit', Object.assign({ front: f, up: prio ? 1.3 : undefined }, extra), goal, label);
  }

  /** Mode d'après les règles d'avant (coureur sans mission) : relais en tête d'un groupe pour ceux qui collaborent, sinon dans les roues. */
  function usual(c) {
    const { r, my, sit, me, toGo, wf, race } = c, b = r.bot;
    const inGroup = me.g.n > 1;
    if (me.g.i < sit.pel.i && !inGroup) { useMode(r, toGo < 8000 ? 'threshold' : 'tempo', 'free'); return; }
    const free = my.role === 'rouleur' || my.role === 'baroudeur';
    if (inGroup && free && wf > 0.3 && b.team > 0.25 && (!r.lat || me.rank < Pel.RELAY_FRONT)) { useMode(r, 'relay', 'free'); return; }
    // un coureur s'est échappé devant : on part en chasse (ou pas)
    const ahead = Tac.nearestAhead(sit.act, r, Tac.CHASE_RANGE);
    if (ahead && ahead.s - r.st.s - BIKE > Dr.GROUP_GAP && wf > 0.35 && (r.tac.mode === 'follow' || c.rnd() < 0.3 + b.aggr)) { useMode(r, 'follow', 'free'); return; }
    useMode(r, inGroup ? 'follow' : toGo < 8000 ? 'threshold' : 'tempo', 'free');
  }

  /** Décision du coureur r pour les prochaines secondes (appelée par race.stepRider, au plus toutes les 2 à 4 s). */
  function think(r, view, race) {
    const tac = r.tac, t = r.st.t, S = race.strat;
    if (!S || !S.sit || !S.sit.pel || !r.strat) return;
    if (t < (tac.nextThink || 0)) return;
    tac.nextThink = t + THINK_MIN + Math.floor(S.rnd() * THINK_SPAN);
    if (tac.mode === 'attack' || tac.mode === 'sprint') return; // se terminent d'eux-mêmes
    const sit = S.sit, me = sit.by.get(r.id);
    if (!me) return;
    const my = r.strat, team = my.team >= 0 ? S.teams[my.team] : null;
    // garde-fou : quoi qu'il arrive, un coureur de la stratégie qui ne roule plus alors que son paquet roule reprend les roues
    if (tac.mode === 'strat' && r.st.v < 2.5 && sit.pel.v > 6 && !r.incident) {
      tac.stall = (tac.stall || 0) + 1;
      if (tac.stall >= 2) { tac.stall = 0; my.noPlanUntil = t + 20; Tac.setMode(r, 'follow', t); tac.plan = null; note(r, 'free', 'Reprend les roues'); return; }
    } else tac.stall = 0;
    const c = {
      r, my, team, S, sit, me, race, t, view, toGo: sit.L - r.st.s, wf: Tac.wFrac(r),
      inPel: me.g === sit.pel, inBreak: me.g.i < sit.pel.i, behind: me.g.i > sit.pel.i, rnd: S.rnd,
    };
    for (const step of STEPS) if (step(c)) return;
    usual(c);
  }

  /* Les décisions, par ordre de priorité : la première qui répond l'emporte. */

  /** Vidé : on ne se bat plus, on s'abrite. */
  function exhausted(c) {
    if (c.wf >= 0.1) return false;
    usePlan(c.r, 'sit', { cap: 0.8, chase: 30 }, 'save', 'Au bout du rouleau : s\'économise');
    return true;
  }

  /** Les rôles de la finale : position, train, poisson pilote, sprint. */
  function finale(c) {
    const { r, my, team, sit, me, toGo, wf, t, race } = c;
    if (toGo > FINALE_KM) return false;
    const size = me.g.n, want = rankWanted(toGo, size), v = r.st.v;
    const launchStd = 250 + 6 * v; // règle d'avant : tout le monde y va
    const train = team && team.train && team.train.on ? team.train : null;
    switch (my.role) {
      case 'sprinter': {
        const lg = my.launch + 4 * Math.max(0, v - 12);
        if (wf > 0.1 && (toGo <= lg || (team && team.train && team.train.phase === 'done' && toGo < team.train.E + 60))) { Tac.setMode(r, 'sprint', t); note(r, 'points', 'Sprint !'); return true; }
        // derrière le dernier du train (ou le poisson pilote) : sur sa roue quand elle est à portée, sinon à la place qui suit la sienne
        const lastE = train && train.phase === 'run' && train.last && sit.by.get(train.last);
        const pil = team && team.pilot && sit.by.get(team.pilot);
        const guide = lastE || (pil && toGo < PILOT_START && pil.g === me.g ? pil : null);
        if (guide && guide.e.s > r.st.s - BIKE) {
          if (guide.e.s - r.st.s < 12) usePlan(r, 'escort', { target: guide.e.id, mode: 'behind', cap: 1.25 }, 'points', lastE ? 'Sprinteur : dans la roue du train' : 'Sprinteur : dans la roue du poisson pilote');
          else place(c, guide.rank + 1, 'points', lastE ? 'Sprinteur : rejoint son train' : 'Sprinteur : rejoint son poisson pilote', true, { cap: 1.25 });
          return true;
        }
        place(c, want, 'points', 'Sprinteur : se place pour le sprint', true);
        return true;
      }
      case 'leadout': {
        const sp = team && team.sprinter && sit.by.get(team.sprinter);
        if (!train || !sp) { // pas de train (sprinteur absent, arrivé trop tard) : il lance pour lui s'il est bien placé, sinon il s'écarte
          if (toGo <= launchStd && wf > 0.2 && me.rank < 8) { Tac.setMode(r, 'sprint', t); note(r, 'win', 'Sprint pour lui-même'); } else usePlan(r, 'sit', { cap: 0.85, chase: 40 }, 'save', 'Lanceur : a terminé son travail');
          return true;
        }
        const idx = train.order.indexOf(r.id), ci = train.order.indexOf(train.cur);
        if (idx < 0) { usePlan(r, 'sit', { cap: 0.9 }, 'work', 'Lanceur : arrivé trop tard pour le train'); return true; }
        if (train.cur === r.id && train.phase !== 'form') {
          usePlan(r, 'drive', { frac: 1.2 + 0.07 * idx, front: 0 }, 'train', `Train : mène à fond (${idx + 1}/${train.order.length})`);
          return true;
        }
        if (train.phase === 'form' || idx >= ci) {
          // pas encore son tour : au sec derrière celui qui mène, ou rassemblé en tête avant le départ du train
          const prev = idx > 0 ? train.order.slice(0, idx).reverse().find((id) => sit.by.get(id) && train.order.indexOf(id) >= ci) : null;
          if (train.phase === 'form' || !prev || train.cur === r.id) place(c, Math.min(2 + idx, 6), 'train', 'Train : se place en tête', true, { cap: 1.15, chase: 60 });
          else usePlan(r, 'escort', { target: prev, mode: 'behind', cap: 1.2 }, 'train', 'Train : dans la roue du train');
          return true;
        }
        peelOnce(c, 'train', 'Train : s\'écarte, le sprint est lancé');
        return true;
      }
      case 'pilot': {
        const sp = team && team.sprinter && sit.by.get(team.sprinter);
        if (!sp || sp.g !== me.g) { if (toGo <= launchStd && wf > 0.2) { Tac.setMode(r, 'sprint', t); note(r, 'win', 'Sprint pour lui-même'); return true; } place(c, want, 'save', 'Poisson pilote : sans sprinteur, se place', false, { cap: 1.1, chase: 40 }); return true; }
        if (sp.e.mode === 'sprint') { peelOnce(c, 'pilot', 'Poisson pilote : le sprinteur est lancé'); return true; }
        if (train || toGo < 600) { usePlan(r, 'escort', { target: team.sprinter, mode: 'behind', cap: 1.15 }, 'pilot', 'Poisson pilote : couvre le sprinteur'); return true; }
        if (toGo < PILOT_START) { usePlan(r, 'guide', { target: team.sprinter, front: want, cap: 1.25 }, 'pilot', 'Poisson pilote : guide le sprinteur vers l\'avant'); return true; }
        place(c, want + 2, 'pilot', 'Poisson pilote : se place', true, { cap: 1.1, chase: 40 });
        return true;
      }
      case 'domestique': {
        const ldr = team && my.protectee && sit.by.get(my.protectee);
        if (ldr && ldr.g === me.g && toGo > 600) { place(c, Math.max(0, ldr.rank - 2), 'protect', 'Équipier : protège son leader jusqu\'au bout', false, { shield: my.protectee, cap: 1.1, up: 1.25 }); return true; }
        usePlan(r, 'sit', { cap: 0.85, chase: 40 }, 'save', 'Équipier : a terminé son travail');
        return true;
      }
      case 'gruppetto': return false;
      default: { // leader, grimpeur, baroudeur, rouleur : position, attaque de loin, sprint
        if (toGo <= launchStd && wf > 0.1 && (me.g.n > 1 || Tac.nearestAhead(sit.act, r, 60))) { Tac.setMode(r, 'sprint', t); note(r, 'win', 'Sprint'); return true; }
        const strong = my.role === 'captain' || my.role === 'climber' || my.role === 'baroudeur';
        if (strong && !my.attacked && toGo < my.finalAttack && toGo > 700 && wf > 0.6 && t - my.lastAttack > 120 && c.rnd() < 0.25 * (0.5 + my.goals.win)) {
          my.attacked = true; my.lastAttack = t; noteAttack(c.S, r.id);
          Tac.setMode(r, 'attack', t);
          note(r, 'win', 'Attaque dans le final');
          if (race.onEvent) race.onEvent({ t, id: r.id, name: r.name, type: 'attack' });
          return true;
        }
        if (me.g.n > 1 && my.goals.safe >= 0.3) { place(c, want, 'safe', 'Se place pour le final'); return true; }
        return false;
      }
    }
  }

  /** Sprints intermédiaires et côtes classées : se placer, puis lancer au bon endroit si le rôle y pousse. */
  function lines(c) {
    const { r, my, sit, me, race, t, S, toGo } = c;
    const cp = race.cps && race.cps[r.nextCp];
    if (!cp || cp.type === 'finish') return false;
    const d = cp.s - r.st.s;
    if (!(d > 0) || toGo < FINALE_KM * 0.5) return false;
    const J = S.jersey, holds = (cp.type === 'sprint' && J.points === r.id) || (cp.type === 'kom' && J.kom === r.id);
    const w = Math.max(cp.type === 'sprint' ? my.goals.points : my.goals.kom, holds ? 0.9 : 0);
    if (w < 0.3 || c.wf < 0.4) return false;
    const keen = (cp.type === 'sprint' ? r.bot.sprint : r.bot.climb) || 0;
    if (cp.type === 'sprint') {
      if (d > 1500) return false;
      const lg = my.launch + 5 * Math.max(0, r.st.v - 10);
      if (d <= lg && my.spSeen !== r.nextCp) {
        my.spSeen = r.nextCp;
        let ahead = 0;
        for (const o of sit.act) if (o.id !== r.id && o.s > r.st.s + 30) ahead++;
        if (Cl.pointsFor(cp, ahead + 1) > 0 && c.rnd() < clamp(keen * (0.5 + w), 0, 1)) { Tac.setMode(r, 'sprint', t, cp.s); note(r, 'points', 'Sprint intermédiaire'); return true; }
        return false;
      }
      if (d > lg && me.g.n > 1) { place(c, Math.max(3, rankWanted(1000, me.g.n)), 'points', 'Se place pour le sprint intermédiaire'); return true; }
      return false;
    }
    // côte classée
    const lead = cp.len > 2200 && my.komLong === undefined ? (my.komLong = c.rnd() < 0.5) : my.komLong;
    const reach = lead ? Math.min(cp.len * 0.7, 4000) : (Tac.KOM_LEAD[cp.cat] || 300) * 1.2;
    if (d > reach + 1200 || (r.st.s < cp.start - 1200)) return false;
    if (d <= reach && my.komSeen !== r.nextCp) {
      my.komSeen = r.nextCp;
      let ahead = 0;
      for (const o of sit.act) if (o.id !== r.id && o.s > r.st.s + 30) ahead++;
      if (Cl.pointsFor(cp, ahead + 1) > 0 && c.rnd() < clamp(keen * (0.5 + w), 0, 1)) {
        Tac.setMode(r, 'attack', t, cp.s);
        my.lastAttack = t; noteAttack(S, r.id);
        note(r, 'kom', 'Attaque pour les points du sommet');
        if (race.onEvent) race.onEvent({ t, id: r.id, name: r.name, type: 'attack', kom: true });
        return true;
      }
      return false;
    }
    if (d > reach && me.g.n > 1) { place(c, Math.max(3, rankWanted(1500, me.g.n)), 'kom', 'Se place avant la côte'); return true; }
    return false;
  }

  /** Un leader, un sprinteur ou un équipier protégé est en difficulté (crevaison, chute, décroché) : on l'attend et on le ramène. */
  function rescue(c) {
    const { r, my, team, sit, me, t, toGo } = c;
    if (!team || !my.protectee || toGo < 1500 || !(my.protector || my.role === 'domestique')) return false;
    if (r.id === team.leader) return false;
    const pid = my.protectee, pe = sit.by.get(pid);
    const field = c.view.field.find((o) => o.id === pid);
    if (!field || field.finished) return false;
    // arrêté (crevaison, chute) : seul le protecteur, plus un équipier, l'attend
    if (!pe) {
      if (my.protector || (team.ids.indexOf(r.id) % 3 === 1)) { usePlan(r, 'escort', { target: pid, mode: 'ahead', gap: 3, cap: 1, until: t + 90 }, 'protect', 'Protège : attend son leader'); return true; }
      return false;
    }
    // décroché dans un groupe derrière nous : on se laisse glisser pour le rejoindre, puis on roule à plusieurs pour revenir
    if (pe.g.i > me.g.i && pe.g.gapT < 120) {
      if (my.protector || r.id === team.protector) { usePlan(r, 'escort', { target: pid, mode: 'ahead', gap: 3, cap: 1, until: t + 90 }, 'protect', 'Protège : va chercher son leader'); return true; }
      return false;
    }
    if (me.g.i > sit.pel.i && pe.g === me.g && c.wf > 0.3) { relay(r, 1.0 * Tac.levels(r).ftp, 'protect', 'Protège : ramène son leader'); return true; }
    return false;
  }

  /** Vent de côté fort : les rouleurs mènent à fond côté vent (bordures), les autres se placent à l'avant pour ne pas être pris dans la cassure. */
  function echelon(c) {
    const { r, my, team, sit, me, wf } = c;
    if (Math.abs(sit.tb) < 0.3 || c.toGo < 1500 || me.g !== sit.pel || sit.pel.n < 8) return false;
    const ftp = Tac.levels(r).ftp;
    const driver = my.goals.echelon >= 0.5 && wf > 0.4 && (team ? team.echelon : sit.pel.v > 8 && c.rnd() < 0.5);
    if (driver) {
      if (me.rank > FRONT_RELAY - 3) place(c, 3, 'echelon', 'Bordures : remonte en tête', true, { cap: 1.25, chase: 60 });
      else relay(r, 1.12 * ftp, 'echelon', 'Bordures : mène à fond côté vent');
      return true;
    }
    if (my.goals.safe >= 0.5 || my.goals.win >= 0.6) {
      place(c, Math.max(4, Math.round(0.12 * sit.pel.n)), 'safe', 'Vent de côté : reste dans la première bordure');
      return true;
    }
    return false;
  }

  /** Dans une échappée : on collabore à une allure tenable ; groupe de poursuite derrière le peloton : on le ramène si l'équipe y a son leader. */
  function escapes(c) {
    const { r, my, team, sit, me, wf, toGo, t } = c;
    const ftp = Tac.levels(r).ftp;
    if (c.inBreak) {
      if (wf < 0.3) { usePlan(r, 'sit', { cap: 0.9, chase: 60 }, 'save', 'Échappée : sur la réserve'); return true; }
      const brk = me.g, gap = brk.gapT;
      const frac = toGo < 3000 ? 1.0 : gap > 90 ? 0.86 : gap > 30 ? 0.92 : 0.98;
      if (brk.n === 1) usePlan(r, 'drive', { frac: Math.max(frac, 0.9), front: 0 }, 'combat', 'Seul devant : tient son avance');
      else relay(r, frac * ftp, my.goals.combat >= 0.5 ? 'combat' : 'break', my.goals.show >= 0.5 ? 'Dans l\'échappée : montre son maillot' : 'Dans l\'échappée : relaie');
      return true;
    }
    if (c.behind) {
      const g = me.g;
      const hasLeader = team && sit.by.get(team.leader) && sit.by.get(team.leader).g === g;
      if (g.n >= 2 && g.gapT < 150 && toGo > 3000 && wf > 0.3 && (hasLeader || my.goals.win >= 0.7 || my.goals.control >= 0.5) && r.id !== (team && team.leader)) {
        relay(r, 1.0 * ftp, 'control', 'Groupe de poursuite : revient sur le peloton');
        return true;
      }
    }
    return false;
  }

  /** Contrôle des échappées : les équipiers de l'équipe qui veut ramener l'échappée relaient en tête du peloton, à l'allure qui garde l'écart voulu. */
  function control(c) {
    const { r, team, me } = c;
    if (!team || !team.control || !team.control.workers.has(r.id) || !c.inPel) return false;
    if (me.rank > FRONT_RELAY) { place(c, FRONT_RELAY - 2, 'control', 'Contrôle : remonte en tête', true, { cap: 1.2, chase: 60 }); return true; }
    relay(r, team.control.frac * Tac.levels(r).ftp, 'control', `Contrôle : l'échappée est à ${Math.round(team.control.gapT)} s (voulu : ${Math.round(team.control.target)} s)`);
    return true;
  }

  /** Lancer une échappée ou sauter dans celle qui part : baroudeurs, combatifs, coureurs qui veulent se montrer. */
  function breakaway(c) {
    const { r, my, sit, me, wf, toGo, t, S, race } = c;
    if (!c.inPel || wf < 0.8 || toGo < 12000 || t < 60 || t - my.lastAttack < 300 || t - S.lastBreakAttack < ATTACK_COOLDOWN) return false;
    const w = my.goals.combat + 0.5 * my.goals.show;
    if (w < 0.4) return false;
    const aggr = r.bot.aggr || 0.2;
    const brk = sit.breaks.length ? sit.breaks[sit.breaks.length - 1] : null;
    // sauter dans une échappée toute proche (moins de 25 s), si elle n'est pas trop nombreuse
    if (brk && brk.gapT < 25 && brk.n < 6 && wf > 0.85 && c.rnd() < 0.04 * w * (0.5 + 2 * aggr)) {
      const tail = sit.by.get(brk.ids[brk.ids.length - 1]);
      my.lastAttack = t; S.lastBreakAttack = t; noteAttack(S, r.id);
      usePlan(r, 'escort', { target: tail.e.id, mode: 'behind', cap: 1.2, until: t + 120 }, 'combat', 'Saute dans l\'échappée');
      return true;
    }
    if (brk && brk.gapT >= 25) return false;
    // attaquer : plutôt en montée, au sommet, au début de la course, et beaucoup moins quand une échappée est déjà devant
    const climb = r.cond.grade > 0.04, early = toGo > 0.6 * sit.L;
    const p = 0.0012 * w * (0.5 + 2.5 * aggr) * (climb ? 3 : 1) * (early ? 1.5 : 1) * (brk ? 0.25 : 1);
    if (c.rnd() < p) {
      my.lastAttack = t; S.lastBreakAttack = t; noteAttack(S, r.id);
      Tac.setMode(r, 'attack', t);
      note(r, 'combat', 'Attaque pour l\'échappée');
      if (race.onEvent) race.onEvent({ t, id: r.id, name: r.name, type: 'attack' });
      return true;
    }
    return false;
  }

  /** Équipier : reste autour de son leader (devant lui, côté vent), ramène la voiture… et se place à l'avant du groupe de son leader. */
  function escort(c) {
    const { r, my, team, sit, me, wf } = c;
    if (!team || !my.protectee || r.id === team.leader || my.role === 'baroudeur') return false;
    if (!(my.role === 'domestique' || my.role === 'leadout' || my.role === 'pilot')) return false;
    const pe = sit.by.get(my.protectee);
    if (!pe || pe.g !== me.g || wf < 0.2) return false;
    if (my.protector) { place(c, Math.max(0, pe.rank - 2), 'protect', 'Protège son leader : devant lui, côté vent', false, { shield: my.protectee, cap: 1.0, up: 1.25 }); return true; }
    // les autres : devant le leader, aux places qui l'abritent
    const front = Math.max(0, pe.rank - 3);
    if (me.rank > front) { place(c, front, 'work', 'Équipier : se place devant son leader', false, { cap: 1.05, chase: 40 }); return true; }
    return false;
  }

  /** Maillot de leader (points ou montagne) : on se montre aux premières places, tant que la course est jeune. */
  function showJersey(c) {
    const { r, my, S, sit, me, wf, toGo } = c;
    const J = S.jersey, wears = J.points === r.id || J.kom === r.id;
    if (!(wears || my.goals.show >= 0.7) || wf < 0.5) return false;
    if (1 - toGo / sit.L > my.showUntil || me.g.n < 4) return false;
    if (me.rank > 4) place(c, 3, 'show', wears ? 'Montre son maillot : remonte' : 'Se montre aux avant-postes', false, { cap: 1.1, chase: 60 });
    else relay(r, 0.88 * Tac.levels(r).ftp, 'show', wears ? 'Montre son maillot en tête' : 'Se montre en tête');
    return true;
  }

  /** Rester à l'avant du groupe avant un passage à risque (étroit, virage, descente, pied de côte). */
  function staySafe(c) {
    const { r, my, S, me, wf } = c;
    if (my.goals.safe < 0.4 || me.g.n < 12 || wf < 0.3) return false;
    const d = dangerAhead(S, r.st.s, 1500);
    if (d < 0.3) return false;
    const front = Math.max(3, Math.round((0.28 - 0.18 * d) * me.g.n * (my.goals.safe))); // plus la route est risquée, plus on veut être devant
    if (me.rank <= front) return false;
    place(c, front, 'safe', 'Reste à l\'avant avant un passage à risque');
    return true;
  }

  /** S'économiser : chefs de file, sprinteurs et grimpeurs jusqu'au moment clé ; gruppetto tout le temps. */
  function saveEnergy(c) {
    const { r, my, me, toGo, sit } = c;
    if (my.role === 'gruppetto') { usePlan(r, 'sit', { cap: r.cond.grade > 0.03 ? 0.92 : 0.85, chase: 40 }, 'save', 'Gruppetto : roule à son rythme'); return true; }
    if ((my.role === 'captain' || my.role === 'sprinter' || my.role === 'climber') && my.goals.save >= 0.5 && me.g.n > 1) {
      place(c, Math.round(0.4 * me.g.n), 'save', 'S\'économise, abrité, pour le moment clé'); // abrité dans le ventre du peloton, pas à l'arrière
      return true;
    }
    return false;
  }

  const STEPS = [exhausted, finale, lines, rescue, echelon, escapes, control, breakaway, escort, showJersey, staySafe, saveEnergy];

  /* ---------- consignes des plans ---------- */

  /** Rang du coureur dans son paquet (tick), à défaut dans son groupe d'aspiration. */
  const rankOf = (r, info) => (r.strat && r.strat.rank !== undefined ? r.strat.rank : info ? info.rank : 0);

  /**
   * Remonter le groupe avec un effort plus franc que celui des tactiques (movePower : 1,1 × FTP au plus) : quitter l'abri d'un peloton compact
   * coûte cher, et les rôles qui doivent être devant (train, poisson pilote, sprinteur, protecteur) ne peuvent pas se contenter d'y arriver
   * dans dix minutes. +1,6 m/s sur la roue devant, jusqu'à p.up × FTP. null s'il n'y a personne devant.
   */
  function climbPower(r, view, info, up) {
    const tac = r.tac, L = Tac.levels(r);
    const ahead = (info && view.field.find((o) => o.id === info.wheel)) || (r.lat ? Tac.nearestAhead(view.field, r, Dr.GROUP_GAP) : null);
    if (!ahead) return null;
    const vLead = ahead.v + clamp((ahead.a || 0) + Tac.slopeChange(r.ctx.course, ahead.s, ahead.v), -2, 1.5);
    const vT = Math.min(vLead + 1.6, r.st.v + Tac.accelMax(r.st.v));
    const hold = Math.max(0, Tac.powerForSpeedRaw(r.setup, r.st.v, vLead, r.cond));
    const cap = Math.min(Tac.followEffort(r, L), Math.max(up * L.ftp, hold));
    tac.phase = 'move'; tac.wheel = ahead.id; tac.front = undefined;
    return clamp(Tac.powerForSpeedRaw(r.setup, r.st.v, vT, r.cond), 0, cap);
  }

  /** Dans les roues avec plafond d'effort ; remonter d'abord aux places demandées ; en tête sans roue : tempo. */
  function sitCmd(r, view, p, L) {
    const tac = r.tac, info = view.info.get(r.id);
    // plafond d'effort pour tenir une roue : celui des coureurs virtuels d'avant (1,1 × PMA) sauf mission d'économie (équipier qui a fini, gruppetto)
    const capW = p.cap ? p.cap * L.ftp : 1.1 * L.pma;
    const rank = rankOf(r, info);
    if (p.front !== undefined && info && info.groupSize > 1 && rank > p.front && Tac.wFrac(r) > 0.25) {
      const P = p.up ? climbPower(r, view, info, p.up) : Tac.movePower(r, view, info);
      if (P !== null) return Math.min(P, Math.max(capW, (p.up || 1.1) * L.ftp));
    }
    // protection : côté vent, un rang à côté du coureur abrité (par vent de côté)
    if (p.shield && r.lat && Math.abs(r.lat.tb) > 0.15) {
      const te = view.field.find((o) => o.id === p.shield);
      if (te && te.y !== undefined && Math.abs(te.s - r.st.s) < 25) Pel.steerTo(r, te.y + (r.lat.tb > 0 ? 1 : -1) * 0.6, r.st.t, 3, r.ctx.course);
    }
    // on laisse filer attaquants et sprinteurs, sauf dans le final : tout le monde y court après les attaques
    const finale = r.ctx.course.length - r.st.s < FINALE_KM;
    const w = Tac.wheelToFollow(view.field, r, p.chase || Tac.CHASE_RANGE, (o) => o.phase !== 'swing' && (finale || !Tac.isAttack(o)));
    if (w) { tac.phase = 'wheel'; tac.wheel = w.id; return Tac.followPower(r, w, capW); }
    tac.phase = null; tac.wheel = null;
    return Tac.steadyPower(r, 'tempo');
  }

  /** Escorte : derrière la roue de la cible (mode « behind »), ou devant elle à un petit écart (mode « ahead »), côté vent si « shield ». */
  function escortCmd(r, view, p, L) {
    const tac = r.tac, t = r.st.t;
    const te = view.field.find((o) => o.id === p.target);
    if (!te || te.finished || (p.until && t >= p.until)) { tac.plan = { kind: 'sit', cap: 1.0, chase: 60 }; return sitCmd(r, view, tac.plan, L); }
    const capW = (p.cap || 1.15) * L.ftp;
    if (p.mode === 'behind') {
      // on ne s'abrite pas derrière quelqu'un qui est derrière nous : si chacun de deux coureurs attendait l'autre, ils s'arrêteraient tous les deux
      if (te.s < r.st.s - BIKE) { tac.plan = { kind: 'sit', cap: p.cap, chase: Tac.CHASE_RANGE }; return sitCmd(r, view, tac.plan, L); }
      tac.wheel = te.id;
      tac.phase = te.s - r.st.s > 25 ? 'move' : 'wheel'; // loin : on cherche une voie libre pour le rejoindre
      return Tac.followPower(r, te, capW);
    }
    tac.wheel = null;
    tac.phase = 'escort';
    if (p.shield && r.lat && te.y !== undefined && Math.abs(r.lat.tb) > 0.15) Pel.steerTo(r, te.y + (r.lat.tb > 0 ? 1 : -1) * 0.6, t, 3, r.ctx.course);
    // > 0 : il n'est pas encore derrière nous à l'écart voulu. Jamais plus lent que lui : celui qui nous suit règle sa vitesse sur la nôtre,
    // et si nous réglons la nôtre sur la sienne en freinant, personne ne mène plus et le groupe s'arrête
    const err = te.s + BIKE + (p.gap === undefined ? 0.8 : p.gap) - r.st.s;
    // plancher : un coureur en mouvement qui nous suit se règle sur nous, nous sur lui, et à deux ils s'arrêtent lentement (équilibre stable à
    // 1 m/s) ; on ne roule donc jamais sous 90 % de l'allure du paquet, sauf pour attendre un coureur arrêté
    const vFloor = te.stopped ? 0 : 0.9 * ((r.strat && r.strat.packV) || 0);
    return Tac.aimSpeed(r, Math.max(vFloor, te.v + clamp(0.35 * err, 0, 1.2)), capW);
  }

  /** Mener à une puissance imposée (aux places de tête d'abord) : le train, le coureur seul devant. */
  function driveCmd(r, view, p, L) {
    const tac = r.tac, info = view.info.get(r.id);
    if (p.front !== undefined && info && info.groupSize > 1 && rankOf(r, info) > p.front && Tac.wFrac(r) > 0.15) {
      const P = Tac.movePower(r, view, info);
      if (P !== null) return Math.max(P, 1.0 * L.ftp);
    }
    tac.phase = 'pull'; tac.wheel = null;
    return p.pow || (p.frac || 1) * L.ftp;
  }

  /** Poisson pilote : monte vers l'avant du groupe à la vitesse que le sprinteur peut suivre, de roue en roue. */
  function guideCmd(r, view, p, L) {
    const tac = r.tac, info = view.info.get(r.id);
    const sp = view.field.find((o) => o.id === p.target);
    const capW = (p.cap || 1.25) * L.ftp;
    if (!sp || sp.finished || sp.stopped) return sitCmd(r, view, { front: p.front, cap: 1.1, chase: 40 }, L);
    const behind = r.st.s - sp.s - BIKE; // écart entre sa roue avant et notre roue arrière (> 0 : il est derrière nous)
    if (info && info.groupSize > 1 && rankOf(r, info) > p.front) {
      const P = Tac.movePower(r, view, info);
      if (P !== null) {
        if (behind > 7) return Tac.aimSpeed(r, Math.max(0, sp.v + 0.2), capW); // il décroche : on l'attend
        return Math.min(P, capW);
      }
    }
    // aux places visées : on tient la roue devant, le sprinteur dans la nôtre
    const w = Tac.wheelToFollow(view.field, r, 30, (o) => o.id !== p.target && o.phase !== 'swing');
    if (w) { tac.phase = 'wheel'; tac.wheel = w.id; return Tac.followPower(r, w, capW); }
    tac.phase = null; tac.wheel = null;
    return Tac.steadyPower(r, 'tempo');
  }

  /** On s'écarte et on se laisse glisser (fin de relais, de train) : un rang de côté, un peu moins vite que le groupe, puis dans les roues. */
  function peelCmd(r, view, p, L) {
    const tac = r.tac, t = r.st.t;
    if (t >= p.until) { tac.plan = { kind: 'sit', cap: p.then || 0.8, chase: 40 }; return sitCmd(r, view, tac.plan, L); }
    if (!p.moved && r.lat) {
      p.moved = true;
      const side = Math.abs(r.lat.tb) > 0.1 ? Math.sign(r.lat.tb) : r.lat.y > 0 ? 1 : -1; // côté vent, sinon vers le bord le plus proche
      Pel.steerTo(r, r.lat.y + side * 2 * Pel.LANE, t, 5, r.ctx.course);
    }
    tac.phase = 'swing'; tac.wheel = null;
    if (p.v0 === undefined) p.v0 = r.st.v;
    return Tac.aimSpeed(r, Math.max(2, p.v0 - 1.2), 0.75 * L.ftp); // fixée au départ : à la vitesse d'avant, moins 1,2 m/s
  }

  function command(r, view, rules) {
    const tac = r.tac, p = tac.plan, L = Tac.levels(r);
    if (!p) return Tac.steadyPower(r, 'tempo');
    switch (p.kind) {
      case 'escort': return escortCmd(r, view, p, L);
      case 'drive': return driveCmd(r, view, p, L);
      case 'guide': return guideCmd(r, view, p, L);
      case 'peel': return peelCmd(r, view, p, L);
      default: return sitCmd(r, view, p, L);
    }
  }

  /** Texte court de ce que fait un coureur virtuel (rôle et objectif du moment). */
  function describe(r) {
    const my = r.strat;
    return my ? `${ROLES[my.role].label} — ${my.label}` : Tac.LABELS.strat;
  }

  /** Libellés (rôle et objectif) d'un coureur : { role, goal, text } ; null sans stratégie. */
  function riderInfo(r) {
    const my = r.strat;
    if (!my) return null;
    return { role: my.role, roleLabel: ROLES[my.role].label, goal: my.goal, goalLabel: GOALS[my.goal] || '', text: my.label, team: my.team };
  }

  PYR.strategy = {
    GOALS, ROLES, LEADER_ROLE, TRAIN_START, TRAIN_FORM, PILOT_START, FINALE_KM,
    init, setTeamRoles, tick, think, command, describe, riderInfo, depthRisk, rankWanted, combativity, jerseys, situation, profileOf, dangerAhead,
  };
})(globalThis.PYR = globalThis.PYR || {});
