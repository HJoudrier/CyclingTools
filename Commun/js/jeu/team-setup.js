/* author : Hugo Joudrier-Faure */
/* PaceYourRide — page de choix des jeux : l'étape « Équipe » (mode équipe, team-game.js). Le joueur choisit de piloter un seul coureur (le choix d'avant)
 * ou de **gérer une équipe** : une des équipes du World Tour (pros.js), les coureurs qui prennent le départ (neuf au plus), le plan de chacun (son
 * rôle : leader, sprinteur, grimpeur, baroudeur, rouleur, équipier, protecteur, lanceur, poisson pilote, gruppetto) et les équipes adverses.
 * Le choix est gardé dans l'état de l'application (game.team) que l'écran de course relit. */
(function (PYR) {
  'use strict';

  const D = PYR.dom, store = PYR.store, TG = PYR.teamGame;
  const { $, $$, h } = D;

  const cfg = () => store.state.game.team || {};
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(-2).join('').toUpperCase();
  const photoCache = new Map();
  /** Couleur de maillot de l'équipe, en variable CSS (--tc) de l'élément (une propriété personnalisée ne passe pas par Object.assign(el.style)). */
  const tint = (el, color) => { el.style.setProperty('--tc', color); return el; };

  /** Remplace les initiales d'une pastille par la photo du coureur quand elle est connue (Wikipédia, gardée sur l'appareil ; hors ligne : initiales). */
  function loadPhoto(el, name) {
    if (!PYR.proPhoto) return;
    const apply = (ph) => { if (ph && ph.src && el.isConnected) { el.style.backgroundImage = `url("${ph.src}")`; el.textContent = ''; } };
    if (photoCache.has(name)) { apply(photoCache.get(name)); return; }
    PYR.proPhoto.get(name).then((ph) => { photoCache.set(name, ph); apply(ph); }, () => {});
  }

  /** Enregistre la configuration (vérifiée) et redessine. */
  function commit(next) {
    const merged = Object.assign({}, cfg(), next);
    const norm = TG.normalize(merged);
    norm.on = !!merged.on && !!norm.team;
    store.set('game.team', norm);
    render();
    if (PYR.gameSetup && PYR.gameSetup.refreshSummary) PYR.gameSetup.refreshSummary();
  }

  /** Résumé pour la barre de départ : « UAE Team Emirates XRG (8 coureurs), 9 équipes adverses ». */
  function summary() {
    const c = TG.normalize(cfg());
    if (!c.on) return null;
    const t = TG.findTeam(c.team);
    return `${t.name} (${c.riders.length} coureur${c.riders.length > 1 ? 's' : ''}), ${c.opp} équipe${c.opp > 1 ? 's' : ''} adverse${c.opp > 1 ? 's' : ''}`;
  }

  function rider(it, c, color) {
    const on = c.riders.includes(it.id), full = !on && c.riders.length >= TG.MAX_OWN;
    const cb = h('input', { type: 'checkbox', checked: on, disabled: full, 'aria-label': `Retenir ${it.name}`, onchange: (e) => {
      const set = new Set(c.riders);
      if (e.target.checked) set.add(it.id); else set.delete(it.id);
      const plans = Object.assign({}, c.plans);
      if (!e.target.checked) delete plans[it.id];
      // la liste suit l'ordre de l'effectif (du meilleur au moins bon)
      commit({ riders: TG.findTeam(c.team).riders.map((x) => x.id).filter((id) => set.has(id)), plans });
    } });
    const sel = h('select', { disabled: !on, 'aria-label': `Plan de ${it.name}`, title: 'Le plan (rôle) du coureur quand tu ne le pilotes pas ; modifiable en course',
      onchange: (e) => commit({ plans: Object.assign({}, c.plans, { [it.id]: e.target.value }) }) },
      [on ? null : h('option', { value: '', selected: true }, '—')].concat(TG.ROLE_CHOICES.map((r) => h('option', { value: r.id, selected: on && (c.plans[it.id] || '') === r.id, title: r.info }, r.label))));
    const ph = tint(h('span', { class: 'tg-photo' }, initials(it.name)), color);
    loadPhoto(ph, it.name);
    return h('li', { class: 'tg-rider' + (on ? ' is-on' : '') },
      h('label', { class: 'tg-pick' }, cb, ph,
        h('span', { class: 'tg-id' }, h('strong', null, it.name), h('span', { class: 'muted' }, `${it.pro.typeLabel} · niveau ${it.pro.level}`))),
      h('span', { class: 'tg-stats muted', title: 'Poids, puissance critique par kilo' }, `${it.data.rider.weight} kg · ${it.pro.wkg} W/kg`),
      sel);
  }

  function render() {
    const c = TG.normalize(cfg()), host = $('#gs-team'), on = !!cfg().on && c.on;
    $$('[data-team-mode]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.teamMode === 'team') === on)));
    host.hidden = !on;
    $('#gs-team-note').hidden = !on;
    if (!on) { D.clear(host); return; }
    const teams = TG.teams(), mine = teams.find((t) => t.id === c.team);
    D.clear(host);
    host.appendChild(h('h3', null, 'Ton équipe'));
    host.appendChild(h('div', { class: 'tg-teams', role: 'listbox', 'aria-label': 'Équipes du World Tour' }, teams.map((t) => tint(h('button', {
      type: 'button', class: 'tg-team', role: 'option', 'aria-selected': String(t.id === c.team),
      onclick: () => commit({ team: t.id, riders: [], plans: {} }),
    }, h('i', { class: 'tg-dot' }), h('span', null, h('strong', null, t.name), h('small', { class: 'muted' }, `${t.riders.length} coureurs`))), t.color))));
    host.appendChild(h('h3', null, `Coureurs au départ : ${c.riders.length} sur ${TG.MAX_OWN} au plus`));
    host.appendChild(h('div', { class: 'toolbar tg-tools' },
      h('button', { class: 'btn', type: 'button', onclick: () => commit({ riders: TG.defaultSelection(c.team, 8), plans: {} }), title: 'Le leader, un sprinteur, un grimpeur et des équipiers' }, 'Sélection conseillée'),
      h('button', { class: 'btn', type: 'button', onclick: () => commit({ plans: {} }), title: 'Un plan par coureur d\'après son type : leader, protecteur, lanceurs…' }, 'Plans conseillés'),
      h('span', { class: 'hint' }, 'Tu pilotes un coureur à la fois et tu bascules de l\'un à l\'autre en course ; les autres roulent selon leur plan.')));
    host.appendChild(h('ul', { class: 'tg-roster' }, mine.riders.map((it) => rider(it, c, mine.color))));
    host.appendChild(h('h3', null, 'Équipes adverses'));
    host.appendChild(h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', null, 'Nombre d\'équipes adverses (0 à ' + (teams.length - 1) + ')'),
        h('select', { 'aria-label': 'Nombre d\'équipes adverses', onchange: (e) => commit({ opp: Number(e.target.value) }) },
          Array.from({ length: teams.length }, (_, i) => h('option', { value: i, selected: i === c.opp }, String(i))))),
      h('div', { class: 'field' }, h('label', null, 'Coureurs par équipe adverse (leurs meilleurs)'),
        h('select', { 'aria-label': 'Coureurs par équipe adverse', onchange: (e) => commit({ size: Number(e.target.value) }) },
          Array.from({ length: TG.MAX_SIZE - TG.MIN_SIZE + 1 }, (_, i) => TG.MIN_SIZE + i).map((i) => h('option', { value: i, selected: i === c.size }, String(i)))))));
    const total = c.riders.length + c.opp * c.size;
    host.appendChild(h('p', { class: 'hint tg-total' }, `Peloton : ${total} coureurs, ${c.opp + 1} équipes.` + (total >= TG.MAX_FIELD - c.size ? ' (limite du peloton atteinte)' : '')));
  }

  function init() {
    if (!store.state.game.team || typeof store.state.game.team !== 'object') store.state.game.team = TG.normalize({});
    $$('[data-team-mode]').forEach((b) => b.addEventListener('click', () => {
      const wantTeam = b.dataset.teamMode === 'team';
      commit({ on: wantTeam, team: cfg().team || 'UAE' });
    }));
    render();
  }

  PYR.teamSetup = { init, render, summary };
})(globalThis.PYR = globalThis.PYR || {});
