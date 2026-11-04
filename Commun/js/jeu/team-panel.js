/* author : Hugo Joudrier-Faure */
/* PaceYourRide — écran de course, mode équipe (team-game.js) : la liste des coureurs de l'équipe du joueur, une vignette par coureur.
 * Chaque vignette donne le coureur (photo ou initiales, nom, couleur de maillot), son plan (rôle, modifiable en course) et ce qu'il fait,
 * sa vitesse, sa puissance, son rang dans la course, son écart avec la tête, sa réserve W′, son énergie, et son état (crevaison, chute,
 * arrivé). Le coureur piloté est en surbrillance ; un clic sur une autre vignette (ou N / Maj+N) donne la main à ce coureur.
 * Le panneau se met à jour au rythme du HUD (tab-game.js renderHud). Fin de course : classement par équipes (result). */
(function (PYR) {
  'use strict';

  const D = PYR.dom, U = PYR.util, { $, h } = D;
  const TG = () => PYR.teamGame;
  const UPDATE_MS = 250;

  const S = { cards: new Map(), team: null, at: 0, photos: new Map() };

  const game = () => PYR.tabGame.state;
  const tint = (el, color) => { el.style.setProperty('--tc', color); return el; };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase();
  const clock = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

  function photo(el, name) {
    if (!PYR.proPhoto) return;
    const apply = (ph) => { if (ph && ph.src && el.isConnected) { el.style.backgroundImage = `url("${ph.src}")`; el.textContent = ''; } };
    if (S.photos.has(name)) { apply(S.photos.get(name)); return; }
    PYR.proPhoto.get(name).then((ph) => { S.photos.set(name, ph); apply(ph); }, () => {});
  }

  /** Dessine les vignettes des coureurs de l'équipe (appelé à chaque nouvelle course) ; team null : le panneau est masqué (jeu d'un seul coureur). */
  function build(team) {
    const box = $('#team-panel');
    if (!box) return;
    S.cards.clear(); S.team = team || null;
    D.clear(box);
    box.hidden = !team;
    if (!team) return;
    const info = team.teams[0];
    box.appendChild(h('header', null,
      h('h3', null, tint(h('i', { class: 'tg-dot' }), info.color), info.name),
      h('span', { class: 'hint' }, 'Clique un coureur ou touche N (Maj+N : le précédent) pour le piloter.')));
    const list = h('div', { class: 'tp-list', role: 'list', 'aria-label': 'Coureurs de ton équipe' });
    team.own.forEach((r, i) => {
      const ph = tint(h('span', { class: 'tg-photo' }, initials(r.name)), info.color);
      photo(ph, r.name);
      const c = {
        r,
        speed: h('b', null, '–'), power: h('b', null, '–'), rank: h('b', null, '–'), gap: h('b', null, '–'),
        wbal: h('i'), energy: h('i'), state: h('span'), goal: h('small'), badge: h('span', { class: 'tp-badge' }, 'piloté'),
        sel: h('select', { 'aria-label': `Plan de ${r.name}`, title: 'Le plan du coureur quand tu ne le pilotes pas',
          onclick: (e) => e.stopPropagation(), onkeydown: (e) => e.stopPropagation(),
          onchange: (e) => { TG().setPlan(game().race, r.id, e.target.value); update(true); } },
          TG().ROLE_CHOICES.map((x) => h('option', { value: x.id, title: x.info }, x.label))),
      };
      c.el = tint(h('div', { class: 'tp-card', role: 'listitem', tabindex: '0', 'data-id': r.id, title: `Piloter ${r.name}`,
        onclick: () => PYR.tabGame.switchRider(r.id),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); PYR.tabGame.switchRider(r.id); } } },
        h('div', { class: 'tp-head' }, ph,
          h('span', { class: 'tp-id' }, h('strong', null, r.name), c.goal),
          c.badge, h('span', { class: 'tp-key', title: 'Numéro dans la liste' }, String(i + 1))),
        h('div', { class: 'tp-stats' },
          h('span', null, 'km/h', c.speed), h('span', null, 'Watts', c.power), h('span', null, 'Rang', c.rank), h('span', { title: 'Écart avec le premier de la course' }, 'Écart', c.gap)),
        h('div', { class: 'tp-meters' },
          h('div', { class: 'tp-meter w', title: 'Réserve W′ (efforts au-dessus de la puissance critique)' }, c.wbal),
          h('div', { class: 'tp-meter e', title: 'Énergie (glycogène)' }, c.energy)),
        h('div', { class: 'tp-do' }, c.state, c.sel)), info.color);
      S.cards.set(r.id, c);
      list.appendChild(c.el);
    });
    box.appendChild(list);
    update(true);
  }

  /** Met les vignettes à jour (au plus quatre fois par seconde, sauf force). */
  function update(force) {
    const G = game(), team = S.team;
    if (!team || !G.race) return;
    const now = performance.now();
    if (!force && now - S.at < UPDATE_MS) return;
    S.at = now;
    const race = G.race, L = race.course.length;
    // rang de chacun dans la course : les arrivés au temps, puis les autres à la distance
    const order = race.riders.slice().sort((a, b) => (a.finished && b.finished ? a.time - b.time : a.finished ? -1 : b.finished ? 1 : b.st.s - a.st.s));
    const rank = new Map(order.map((r, i) => [r.id, i + 1]));
    const head = order[0], headS = head.finished ? L : head.st.s;
    const Fu = PYR.fuel, Sim = PYR.sim;
    for (const c of S.cards.values()) {
      const r = c.r, piloted = r === G.me, out = r.finished;
      c.el.classList.toggle('is-me', piloted);
      c.el.classList.toggle('is-out', out && !piloted);
      c.el.setAttribute('aria-current', String(piloted));
      c.badge.hidden = !piloted;
      c.speed.textContent = out ? '–' : U.fmt(r.st.v * 3.6, 0);
      c.power.textContent = out ? '–' : U.fmt(r.lastP || 0, 0);
      const rk = rank.get(r.id);
      c.rank.textContent = `${rk}/${order.length}`;
      if (out) c.gap.textContent = U.fmtClock(r.time);
      else if (rk === 1) c.gap.textContent = 'tête';
      else c.gap.textContent = '+' + clock((headS - r.st.s) / Math.max(3, r.st.v));
      const w = U.clamp(r.st.wbal / Math.max(1, Sim.w0Of(r.ctx, r.st)), 0, 1);
      c.wbal.style.width = (w * 100).toFixed(0) + '%';
      c.wbal.parentElement.classList.toggle('low', w < 0.2);
      const en = r.fuel ? Fu.status(r.fuel) : null;
      c.energy.style.width = en ? (U.clamp(en.energy, 0, 1) * 100).toFixed(0) + '%' : '0%';
      c.energy.parentElement.classList.toggle('low', !!en && en.energy < 0.2);
      c.energy.parentElement.hidden = !en;
      let state = '', warn = false;
      if (out) state = 'arrivé';
      else if (r.incident) { state = r.incident.type === 'crash' ? '⚠ chute' : '⚠ crevaison'; warn = true; }
      else if (en && en.bonk) { state = '⚠ fringale'; warn = true; }
      else if (piloted) state = PYR.tactics.describe(r, G.rules || {}).slice(0, 40);
      c.state.textContent = state;
      c.state.className = warn ? 'tp-warn' : '';
      c.goal.textContent = piloted ? 'Tu le pilotes' : (r.strat ? r.strat.label : '');
      const plan = TG().planOf(race, r.id);
      if (plan && document.activeElement !== c.sel) c.sel.value = plan;
    }
  }

  /** Classement par équipes (somme des temps des trois premiers de chaque équipe) en tête des résultats de fin de course. */
  function result(box) {
    const G = game(), st = TG().teamStandings(G.race), mine = G.team.teams[0].id;
    const me = st.find((x) => x.id === mine);
    box.appendChild(h('h4', null, me ? `Ton équipe termine ${me.rank}ᵉ sur ${st.length} au classement par équipes.` : 'Course terminée.'));
    box.appendChild(h('div', { class: 'hint' }, 'Classement par équipes : somme des temps des trois premiers arrivés de chaque équipe.'));
    box.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'simple num leaderboard' },
      h('thead', null, h('tr', null, ['#', 'Équipe', 'Temps', 'Arrivés'].map((x) => h('th', null, x)))),
      h('tbody', null, st.map((x) => h('tr', { class: x.own ? 'me' : '' },
        h('td', null, String(x.rank)),
        h('td', null, tint(h('i', { class: 'tg-dot', style: { display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' } }), x.color), x.name),
        h('td', null, x.time !== null ? U.fmtDuration(x.time) : '–'),
        h('td', null, String(x.finished))))))));
  }

  PYR.teamPanel = { build, update, result };
})(globalThis.PYR = globalThis.PYR || {});
