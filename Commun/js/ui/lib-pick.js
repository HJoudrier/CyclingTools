/* author : Hugo Joudrier-Faure */
/* PaceYourRide — choisir un parcours ou un athlète dans la bibliothèque, de la même façon dans toutes les applications (accueil de PaceYourRide,
 * Virtual Ride 2D, Virtual Ride 3D, compteur) : un carrousel de parcours (le tracé sur la carte en 2D, une vue 3D dans Virtual Ride 3D, avec distance, D+, D−) et des
 * cartes d'athlète. Les mêmes fenêtres permettent d'ajouter un parcours (fichier GPX) ou un athlète (formulaire).
 * Les fonctions dessinent à partir d'une liste d'éléments {id, name, savedAt, data, project?} (library.js) et rendent la main par des rappels ;
 * elles ne touchent ni au stockage ni à Dropbox (voir lib-cache.js pour les jeux et le compteur, home.js pour PaceYourRide). */
(function (PYR) {
  'use strict';

  const D = PYR.dom, L = PYR.library;
  const { h, $$ } = D;

  const fmt = (x, d) => (Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('fr-FR');

  const profiles = new Map();
  function profileOf(it) {
    const key = it.id + '@' + it.savedAt + '@' + (it.project ? JSON.stringify(it.data.route && it.data.route.name) : '');
    if (!profiles.has(key)) profiles.set(key, L.routeProfile(it.data));
    return profiles.get(key);
  }

  /** Petits boutons d'action d'une carte (renommer, retirer…) : actions(it) → [{label, title, fn}]. Un clic ne choisit pas la carte. */
  function actionsEl(it, actions) {
    const list = actions ? actions(it) : [];
    if (!list || !list.length) return null;
    return h('div', { class: 'gs-card-acts' }, list.map((a) => h('button', { class: 'btn ghost icon', type: 'button', title: a.title || a.label, 'aria-label': a.title || a.label,
      onclick: (e) => { e.stopPropagation(); a.fn(); } }, a.label)));
  }

  /**
   * Position du défilement d'un carrousel, par élément hôte : un carrousel redessiné (autre élément choisi, passage 2D / 3D) reprend là où l'autre
   * en était, sans repartir du début ni défiler jusqu'à l'élément choisi.
   */
  const SCROLL = new WeakMap();

  /** Place le défilement tout de suite (sans l'animation ni l'accroche au bord des cartes, le temps du geste). */
  function jump(track, left) {
    const sb = track.style.scrollBehavior, ss = track.style.scrollSnapType;
    track.style.scrollBehavior = 'auto'; track.style.scrollSnapType = 'none';
    track.scrollLeft = left;
    requestAnimationFrame(() => { track.style.scrollBehavior = sb; track.style.scrollSnapType = ss; });
  }

  /**
   * Met un carrousel en place : à la position qu'il avait avant son redessin (memo de l'hôte) tant que l'élément choisi y reste visible, sinon
   * l'élément choisi au centre ; à la première fois, l'élément choisi au centre (ou le début). Renvoie faux si le carrousel n'a pas encore de taille.
   */
  function settle(track, key, sel) {
    if (!track.clientWidth) return false;
    const saved = SCROLL.get(key);
    const centerOf = (el) => el.offsetLeft - track.offsetLeft - (track.clientWidth - el.clientWidth) / 2;
    let left;
    if (saved !== undefined) {
      left = saved;
      if (sel) {
        const a = sel.offsetLeft - track.offsetLeft;
        if (a + sel.clientWidth < saved || a > saved + track.clientWidth) left = centerOf(sel);      // le choix a changé ailleurs : on le montre
      }
    } else left = sel ? centerOf(sel) : 0;
    left = Math.max(0, Math.min(left, track.scrollWidth - track.clientWidth));
    if (Math.abs(track.scrollLeft - left) > 1) jump(track, left);
    SCROLL.set(key, left);
    return true;
  }

  /**
   * Profil d'élévation d'un parcours (SVG), avec ce que le parcours y place : côtes classées (zone du pied au sommet, catégorie), sprints,
   * zones de ravitaillement et revêtements autres que la route lisse. p : profil (library.routeProfile), data : le parcours (checkpoints,
   * feedZones, surfaces ; distances en km). Renvoie { svg, legend } ou null sans altitude.
   */
  function elevationProfile(p, data) {
    if (!p || !p.hasEle || !p.ele || p.n < 2) return null;
    const NS = 'http://www.w3.org/2000/svg', Wd = 360, Hh = 92, top = 16, bot = 14, left = 2, right = 2;
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
    const km = p.length / 1000;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.n; i++) { lo = Math.min(lo, p.ele[i]); hi = Math.max(hi, p.ele[i]); }
    const span = Math.max(40, hi - lo), base = lo - span * 0.06, rng = span * 1.12;
    const X = (k) => left + Math.min(1, Math.max(0, k / km)) * (Wd - left - right);
    const Y = (e) => top + (1 - (e - base) / rng) * (Hh - top - bot);
    const eleAt = (k) => p.ele[Math.min(p.n - 1, Math.max(0, Math.round((k * 1000) / p.step)))];
    const svg = el('svg', { class: 'gp', viewBox: `0 0 ${Wd} ${Hh}`, role: 'img', 'aria-label': 'Profil d\'élévation du parcours' });
    const stride = Math.max(1, Math.floor(p.n / 240));
    let line = '';
    for (let i = 0; i < p.n; i += stride) line += (line ? 'L' : 'M') + X((i * p.step) / 1000).toFixed(1) + ' ' + Y(p.ele[i]).toFixed(1);
    line += 'L' + X(km).toFixed(1) + ' ' + Y(p.ele[p.n - 1]).toFixed(1);
    const cps = Array.isArray(data && data.checkpoints) ? data.checkpoints : [], feeds = Array.isArray(data && data.feedZones) ? data.feedZones : [];
    const kom = cps.filter((c) => c && c.type === 'kom' && Number(c.km) > 0), spr = cps.filter((c) => c && c.type === 'sprint' && Number(c.km) > 0);
    // côtes : du pied au sommet, sous la courbe
    for (const c of kom) {
      const a = Math.max(0, Number(c.startKm) || 0), b = Math.min(km, Number(c.km));
      if (b <= a) continue;
      let d = `M${X(a).toFixed(1)} ${(Hh - bot).toFixed(1)}`;
      for (let k = a; k < b; k += Math.max(0.05, (b - a) / 40)) d += `L${X(k).toFixed(1)} ${Y(eleAt(k)).toFixed(1)}`;
      d += `L${X(b).toFixed(1)} ${Y(eleAt(b)).toFixed(1)}L${X(b).toFixed(1)} ${(Hh - bot).toFixed(1)}Z`;
      el('path', { d, class: 'gp-kom' }, svg);
    }
    el('path', { d: line + `L${X(km).toFixed(1)} ${(Hh - bot).toFixed(1)}L${X(0).toFixed(1)} ${(Hh - bot).toFixed(1)}Z`, class: 'gp-area' }, svg);
    el('path', { d: line, class: 'gp-line', fill: 'none' }, svg);
    // revêtements (bande du bas) puis ravitaillements
    const strip = Hh - bot + 3;
    const Ph = PYR.physics;
    const surf = (Array.isArray(data && data.surfaces) ? data.surfaces : []).filter((r) => r && Number(r.endKm) > Number(r.startKm));
    let rough = 0;
    for (const r of surf) {
      const f = Ph && Ph.surfaceFactor ? Ph.surfaceFactor(r) : 1;
      if (!(f > 1.15)) continue;
      rough++;
      const t = Math.min(0.999, Math.log(f) / Math.log(6));
      el('rect', { x: X(Number(r.startKm)).toFixed(1), y: strip, width: Math.max(1.5, X(Number(r.endKm)) - X(Number(r.startKm))).toFixed(1), height: 3, class: 'gp-surf', 'fill-opacity': (0.45 + 0.55 * t).toFixed(2) }, svg).appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: 'Revêtement dégradé' }));
    }
    for (const z of feeds) {
      const a = Number(z.startKm), b = Number(z.endKm);
      if (!(b > a)) continue;
      el('rect', { x: X(a).toFixed(1), y: strip + 4, width: Math.max(2, X(b) - X(a)).toFixed(1), height: 4, rx: 1, class: 'gp-feed' }, svg).appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: `Ravitaillement km ${fmt(a, 1)}–${fmt(b, 1)}` }));
    }
    // sprints (point vert sur la courbe), sommets (triangle et catégorie)
    for (const c of spr) {
      const x = X(Number(c.km)), y = Y(eleAt(Number(c.km)));
      el('line', { x1: x, x2: x, y1: y, y2: Hh - bot, class: 'gp-stem' }, svg);
      const g = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 3.6, class: 'gp-sprint' }, svg);
      g.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: `Sprint km ${fmt(Number(c.km), 1)}` }));
    }
    for (const c of kom) {
      const x = X(Number(c.km)), y = Y(eleAt(Number(c.km))), cat = PYR.classif && PYR.classif.catOf ? PYR.classif.catOf(c.cat) : null;
      const t = el('path', { d: `M${(x - 4.5).toFixed(1)} ${(y - 1).toFixed(1)}L${x.toFixed(1)} ${(y - 8).toFixed(1)}L${(x + 4.5).toFixed(1)} ${(y - 1).toFixed(1)}Z`, class: 'gp-summit' }, svg);
      t.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: `Côte ${cat ? cat.name : ''} : sommet km ${fmt(Number(c.km), 1)}` }));
      const lbl = el('text', { x: x.toFixed(1), y: Math.max(8, y - 10).toFixed(1), class: 'gp-cat', 'text-anchor': 'middle' }, svg);
      lbl.textContent = cat ? (cat.id === 'hc' ? 'HC' : cat.id) : '';
    }
    // distances aux extrémités
    el('text', { x: 2, y: Hh - 1, class: 'gp-ax' }, svg).textContent = '0 km';
    el('text', { x: Wd - 2, y: Hh - 1, class: 'gp-ax', 'text-anchor': 'end' }, svg).textContent = fmt(km, 1) + ' km';
    const legend = [kom.length ? `▲ ${kom.length} côte${kom.length > 1 ? 's' : ''}` : '', spr.length ? `● ${spr.length} sprint${spr.length > 1 ? 's' : ''}` : '', feeds.length ? `▬ ${feeds.length} ravito${feeds.length > 1 ? 's' : ''}` : '', rough ? '▬ revêtement dégradé' : ''].filter(Boolean);
    return { svg, legend };
  }

  /**
   * Carrousel de parcours dans `host`. o : {items, pick (identifiant choisi), view ('2d' : le tracé sur la carte ; '3d' : une vue 3D), onPick(id),
   * actions(it), projectLabel, emptyText}. Renvoie {destroy, setPick(id)}.
   */
  function routeCarousel(host, o) {
    D.clear(host);
    const views = [];
    const list = o.items.map((it) => ({ it, p: profileOf(it) })).filter((x) => x.p);
    const is3d = o.view === '3d';
    const track = h('div', { class: 'gs-track', tabindex: '0', role: 'listbox', 'aria-label': 'Parcours' });
    const prev = h('button', { class: 'gs-arrow', type: 'button', 'aria-label': 'Parcours précédent', onclick: () => track.scrollBy({ left: -track.clientWidth * 0.8 }) }, '‹');
    const next = h('button', { class: 'gs-arrow', type: 'button', 'aria-label': 'Parcours suivant', onclick: () => track.scrollBy({ left: track.clientWidth * 0.8 }) }, '›');
    const arrows = () => { prev.disabled = track.scrollLeft <= 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
    const key = o.scrollKey || host;
    track.addEventListener('scroll', PYR.util.debounce(arrows, 80));
    track.addEventListener('scroll', () => SCROLL.set(key, track.scrollLeft));
    track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); } });
    for (const { it, p } of list) {
      const vis = is3d ? h('canvas', { 'aria-hidden': 'true' }) : h('div', { class: 'gs-map', 'aria-hidden': 'true' });
      const stat = (cls, label, value) => h('span', { class: cls }, h('small', null, label), h('b', null, value));
      const on = it.id === o.pick;
      const profileBox = (pp, item) => {
        const ep = elevationProfile(pp, item.data);
        if (!ep) return null;
        return h('div', { class: 'gs-profile' }, ep.svg, ep.legend.length ? h('div', { class: 'gp-legend' }, ep.legend.map((t) => h('span', null, t))) : null);
      };
      const card = h('div', { class: 'gs-route', role: 'option', tabindex: '-1', 'aria-selected': String(on), dataset: { id: it.id },
        'aria-label': `${it.name}, ${fmt(p.length / 1000, 1)} km, D+ ${fmt(p.up)} m, D− ${fmt(p.down)} m` },
      vis,
      h('div', { class: 'gs-route-info' },
        h('span', { class: 'gs-route-name', title: it.name }, it.name),
        h('div', { class: 'gs-route-stats' },
          stat('', 'Distance', fmt(p.length / 1000, 1) + ' km'),
          stat('up', 'D+', p.hasEle ? '▲ ' + fmt(p.up) + ' m' : '—'),
          stat('down', 'D−', p.hasEle ? '▼ ' + fmt(p.down) + ' m' : '—')),
        h('div', { class: 'gs-route-stats gs-route-alt' },
          stat('', 'Altitude min', p.hasEle ? fmt(Math.min.apply(null, p.ele)) + ' m' : '—'),
          stat('', 'Altitude max', p.hasEle ? fmt(Math.max.apply(null, p.ele)) + ' m' : '—')),
        profileBox(p, it),
        it.project ? h('span', { class: 'gs-route-tag' }, o.projectLabel || 'Projet en cours de PaceYourRide') : null,
        actionsEl(it, o.actions)));
      card.addEventListener('click', () => { if (vis.dataset.dragged === '1') { vis.dataset.dragged = ''; return; } o.onPick(it.id); });
      track.appendChild(card);
      views.push(is3d ? PYR.routeThumb.mount(vis, p) : PYR.routeThumb.mountMap(vis, p));
    }
    host.append(h('div', { class: 'gs-car' }, prev, track, next));
    if (list.length && PYR.mapTile) host.append(h('p', { class: 'gs-attr' }, 'Fond de carte : ' + PYR.mapTile.attribution));
    if (!list.length) host.appendChild(h('p', { class: 'hint gs-empty' }, o.emptyText || 'Aucun parcours pour le moment.'));
    // le carrousel n'est pas toujours affiché quand on le remplit (fenêtre fermée) : on le place dès qu'il a une taille
    const place = () => { settle(track, key, track.querySelector('[aria-selected="true"]')); arrows(); };
    place();
    setTimeout(place, 60);
    return {
      destroy() { for (const v of views) v.destroy(); },
      setPick(id) {
        $$('.gs-route', track).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === id)));
      },
    };
  }

  /**
   * Toile d'araignée des sept spécialités d'un athlète (rider-radar.js) : anneaux à 25, 50, 75 et 100, un axe par spécialité, la surface des scores (par rapport à la
   * catégorie de l'athlète : Pro, Élite, 1ʳᵉ catégorie…), et en pointillés la moyenne de sa catégorie. r : résultat de riderRadar.scores. opts.w : largeur du dessin (viewBox 240 × 178).
   */
  function radarSvg(r) {
    const NS = 'http://www.w3.org/2000/svg', Wd = 240, Hh = 178, cx = Wd / 2, cy = 92, R = 58, RL = 70;
    const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k of Object.keys(attrs || {})) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
    const cats = PYR.riderRadar.CATEGORIES, n = cats.length;
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, v, rr) => [cx + Math.cos(ang(i)) * (rr || R) * v / 100, cy + Math.sin(ang(i)) * (rr || R) * v / 100];
    const poly = (vals) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(',')).join(' ');
    const svg = el('svg', { class: 'gs-radar', viewBox: `0 0 ${Wd} ${Hh}`, role: 'img', 'aria-label': 'Forces et faiblesses : ' + cats.map((c) => `${c.label} ${r.scores[c.id]}`).join(', ') });
    for (const ring of [25, 50, 75, 100]) el('polygon', { points: poly(cats.map(() => ring)), class: 'gr-ring' + (ring === 100 ? ' gr-out' : '') }, svg);
    cats.forEach((c, i) => { const [x, y] = pt(i, 100); el('line', { x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1), class: 'gr-axis' }, svg); });
    el('polygon', { points: poly(cats.map((c) => PYR.riderRadar.REF[c.id])), class: 'gr-ref' }, svg).appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: 'Moyenne de la catégorie' }));
    el('polygon', { points: poly(cats.map((c) => r.scores[c.id])), class: 'gr-area' }, svg);
    cats.forEach((c, i) => {
      const [x, y] = pt(i, r.scores[c.id]), top = r.best[0] === c.id;
      const dot = el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: top ? 3.6 : 2.4, class: 'gr-dot' + (top ? ' gr-top' : '') }, svg);
      dot.appendChild(Object.assign(document.createElementNS(NS, 'title'), { textContent: `${c.label} : ${r.scores[c.id]} / 100 — ${c.info}` }));
      const [lx, ly] = pt(i, 100, RL), a = Math.cos(ang(i));
      const t = el('text', { x: lx.toFixed(1), y: (ly + 3).toFixed(1), class: 'gr-lbl' + (top ? ' gr-top' : ''), 'text-anchor': Math.abs(a) < 0.2 ? 'middle' : a > 0 ? 'start' : 'end' }, svg);
      t.textContent = c.short + ' ';
      el('tspan', { class: 'gr-val' }, t).textContent = String(r.scores[c.id]);
    });
    return svg;
  }

  /**
   * Carrousel d'athlètes (accueil) : deux onglets, « Mes athlètes » (la bibliothèque et l'athlète du projet) et « Coureurs World Tour » (pros.js, avec
   * filtres par équipe et par type, tri et recherche) ; chaque carte donne la photo (celle de l'athlète, ou pour un pro celle de Wikipédia, pro-photo.js),
   * l'identité, la morphologie, FTP, W/kg, PC, W′, Pmax (et W/CdA pour un pro), le niveau, et les actions de actions(it).
   * o : { mine: [éléments], pick, onPick(id), actions(it), onAdd, pros (bool), emptyText }. Renvoie { destroy, setPick(id) }.
   */
  const ATH = { tab: 'mine', team: '', type: '', sort: 'team', q: '' };       // l'état des filtres survit aux redessins

  function athleteCarousel(host, o) {
    D.clear(host);
    const Pr = o.pros && PYR.pros ? PYR.pros : null;
    if (!Pr) ATH.tab = 'mine';
    let pick = o.pick, io = null;
    const norm = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
    const tabBtn = (id, label) => h('button', { type: 'button', role: 'radio', 'aria-pressed': String(ATH.tab === id), onclick: () => { ATH.tab = id; SCROLL.delete(host); redraw(); } }, label);
    const teamSel = Pr ? h('select', { 'aria-label': 'Équipe', onchange: (e) => { ATH.team = e.target.value; drawTrack(true); } }, h('option', { value: '' }, 'Toutes les équipes'), Object.keys(Pr.TEAMS).map((k) => h('option', { value: k, selected: ATH.team === k }, Pr.TEAMS[k]))) : null;
    const typeSel = Pr ? h('select', { 'aria-label': 'Type de coureur', onchange: (e) => { ATH.type = e.target.value; drawTrack(true); } }, h('option', { value: '' }, 'Tous les types'), Object.keys(Pr.TYPES).map((k) => h('option', { value: k, selected: ATH.type === k }, Pr.TYPES[k].label))) : null;
    const sorts = [['team', 'Par équipe'], ['wkg', 'Par W/kg'], ['watts', 'Par puissance (W)'], ['cda', 'Par W/CdA'], ['pmax', 'Par Pmax'], ['name', 'Par nom']];
    const sortSel = Pr ? h('select', { 'aria-label': 'Tri', onchange: (e) => { ATH.sort = e.target.value; drawTrack(true); } }, sorts.map(([v, t]) => h('option', { value: v, selected: ATH.sort === v }, t))) : null;
    const search = Pr ? h('input', { type: 'search', placeholder: 'Rechercher un coureur…', 'aria-label': 'Rechercher un coureur', autocomplete: 'off', value: ATH.q, oninput: (e) => { ATH.q = e.target.value; drawTrack(true); } }) : null;
    const nPro = Pr ? Pr.RIDERS.length : 0;
    const bar = h('div', { class: 'gs-add gs-ath-bar' },
      o.onAdd ? h('button', { class: 'btn', type: 'button', onclick: o.onAdd }, '＋ Nouvel athlète') : null,
      Pr ? h('div', { class: 'seg-control', role: 'radiogroup', 'aria-label': 'Athlètes' }, tabBtn('mine', `Mes athlètes (${o.mine.length})`), tabBtn('pro', `Coureurs World Tour (${nPro})`)) : null,
      Pr && ATH.tab === 'pro' ? h('div', { class: 'gs-ath-filters' }, teamSel, typeSel, sortSel, search) : null);
    const track = h('div', { class: 'gs-track gs-ath-track', tabindex: '0', role: 'listbox', 'aria-label': 'Athlètes' });
    const prev = h('button', { class: 'gs-arrow', type: 'button', 'aria-label': 'Athlète précédent', onclick: () => track.scrollBy({ left: -track.clientWidth * 0.8 }) }, '‹');
    const next = h('button', { class: 'gs-arrow', type: 'button', 'aria-label': 'Athlète suivant', onclick: () => track.scrollBy({ left: track.clientWidth * 0.8 }) }, '›');
    const arrows = () => { prev.disabled = track.scrollLeft <= 4; next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4; };
    track.addEventListener('scroll', PYR.util.debounce(arrows, 80));
    track.addEventListener('scroll', () => SCROLL.set(host, track.scrollLeft));
    track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); } });
    const count = h('span', { class: 'gs-pros-n' });
    const note = h('p', { class: 'gs-attr' });
    host.append(bar, h('div', { class: 'gs-car' }, prev, track, next), note);

    const stat = (label, value, cls) => h('span', { class: cls || '' }, h('small', null, label), h('b', null, value));
    function card(it) {
      const r = Object.assign({}, PYR.library.newAthlete().rider, it.data && it.data.rider);
      let a = null;
      try { a = PYR.physio.buildAthlete(r); } catch (e) { /* profil illisible : identité seule */ }
      const kg = Number(r.weight) || 0, ftp = a ? Math.round(a.ftp) : Number(r.ftp) || 0, wkg = kg && ftp ? ftp / kg : 0;
      const born = PYR.util.ageFrom(r.birthDate), age = born !== null ? born : Number(r.age) || 0;
      const color = it.pro && Pr ? Pr.TEAM_COLORS[it.pro.team] || '#6f6d66' : '#eb6834';
      const photo = h('div', { class: 'gs-ath-photo', style: { '--tc': color }, 'aria-hidden': 'true' });
      const avatar = !it.pro && PYR.avatar ? PYR.avatar.span(64, color, r) : null;
      if (avatar) photo.appendChild(avatar); else photo.appendChild(h('span', { class: 'gs-ath-ini' }, initials(r.name || it.name)));
      if (it.pro && PYR.proPhoto) photo.dataset.pro = it.name;
      let radar = null, division = null;
      if (PYR.riderRadar) {
        try {
          const rs = PYR.riderRadar.scores(r, { worldTour: !!it.pro });
          division = rs.division;
          radar = h('div', { class: 'gs-ath-radar' }, radarSvg(rs), h('div', { class: 'gs-ath-spec', title: `Échelle de la catégorie « ${division.label} » : un score de 100 est le meilleur de cette catégorie. Spécialités qui s'en détachent le plus.` }, 'Profil : ', h('b', null, PYR.riderRadar.CATEGORIES.find((c) => c.id === rs.best[0]).label), ' · ', PYR.riderRadar.CATEGORIES.find((c) => c.id === rs.best[1]).short));
        } catch (e) { radar = null; }
      }
      const who = it.pro ? `${Pr.TEAMS[it.pro.team]} · ${it.pro.typeLabel}` : [r.sex === 'f' ? 'Femme' : 'Homme', age ? `${age} ans` : ''].filter(Boolean).join(' · ');
      const on = it.id === pick;
      const el = h('div', { class: 'gs-athc', role: 'option', tabindex: '-1', 'aria-selected': String(on), dataset: { id: it.id } },
        h('div', { class: 'gs-ath-head' }, photo,
          h('div', { class: 'gs-ath-id' }, h('b', { class: 'gs-ath-name', title: r.name || it.name }, (r.name || it.name || 'Athlète sans nom'), it.edited ? h('span', { class: 'gs-pro-edited', title: 'Profil modifié et enregistré dans ta bibliothèque' }, ' · modifié') : null),
            h('small', { class: 'gs-ath-who', title: who }, who), division ? h('span', { class: 'gs-div gs-div-' + division.id, title: `Catégorie : ${division.label} (d'après les watts par kilo à la FTP et sur 5 min)` }, division.label) : null, it.project ? h('small', { class: 'gs-route-tag' }, o.projectLabel || 'Projet en cours') : null)),
        radar,
        h('div', { class: 'gs-route-stats gs-ath-stats' }, stat('Poids', kg ? fmt(kg, 1) + ' kg' : '—'), stat('Taille', Number(r.height) ? fmt(Number(r.height)) + ' cm' : '—'), stat('FTP', ftp ? fmt(ftp) + ' W' : '—')),
        h('div', { class: 'gs-route-stats gs-ath-stats' }, stat('W/kg', wkg ? fmt(wkg, 2) : '—'), stat('PC', a ? fmt(a.cp) + ' W' : '—'), stat("W′", a ? fmt(a.w0 / 1000, 1) + ' kJ' : '—')),
        h('div', { class: 'gs-route-stats gs-ath-stats' }, stat('Pmax', a ? fmt(a.pmax) + ' W' : '—'), it.pro && Pr ? stat('W/CdA', fmt(Pr.wattsPerCdA(it))) : stat('W/CdA', a ? fmt(PYR.riderRadar ? PYR.riderRadar.metrics(r).wCdaRoad : 0) : '—')),
        actionsEl(it, o.actions));
      el.addEventListener('click', () => o.onPick(it.id));
      return el;
    }

    function items() {
      if (ATH.tab !== 'pro' || !Pr) return o.mine;
      const q = norm(ATH.q.trim());
      let rows = Pr.all().filter((it) => (!ATH.team || it.pro.team === ATH.team) && (!ATH.type || it.pro.type === ATH.type) && (!q || norm(it.name).includes(q)));
      const key = { wkg: (it) => it.pro.wkg, watts: (it) => it.data.rider.cp, cda: (it) => Pr.wattsPerCdA(it), pmax: (it) => it.data.rider.pmax }[ATH.sort];
      if (ATH.sort === 'name') rows = rows.slice().sort((x, y) => x.name.localeCompare(y.name, 'fr'));
      else if (key) rows = rows.slice().sort((x, y) => key(y) - key(x));
      return rows;
    }

    function loadPhoto(box) {
      if (box.dataset.loaded || !box.dataset.pro) return;
      box.dataset.loaded = '1';
      PYR.proPhoto.get(box.dataset.pro).then((ph) => {
        if (!ph || !box.isConnected) return;
        box.style.backgroundImage = `url("${ph.src}")`;
        box.classList.add('has-photo');
        box.title = 'Photo : Wikipédia / Wikimedia Commons';
        const ini = box.querySelector('.gs-ath-ini');
        if (ini) ini.remove();
        box.dataset.page = ph.page;
      });
    }

    function drawTrack(fresh) {
      if (fresh) SCROLL.delete(host);
      if (io) io.disconnect();
      D.clear(track);
      const list = items();
      for (const it of list) track.appendChild(card(it));
      count.textContent = '';
      note.textContent = ATH.tab === 'pro' ? `${list.length} coureur${list.length > 1 ? 's' : ''} · ${PYR.proPhoto ? PYR.proPhoto.credit : ''}` : '';
      if (!list.length) track.appendChild(h('p', { class: 'hint gs-empty' }, ATH.tab === 'pro' ? 'Aucun coureur ne correspond.' : (o.emptyText || 'Aucun athlète.')));
      if (globalThis.IntersectionObserver) {
        io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { loadPhoto(e.target); io.unobserve(e.target); } }, { root: track, rootMargin: '300px' });
        $$('.gs-ath-photo', track).forEach((b) => io.observe(b));
      } else $$('.gs-ath-photo', track).forEach(loadPhoto);
      const place = () => { settle(track, host, track.querySelector('[aria-selected="true"]')); arrows(); };
      place();
      setTimeout(place, 60);
    }

    let child = null;
    function redraw() { if (io) io.disconnect(); child = athleteCarousel(host, Object.assign({}, o, { pick })); }
    drawTrack();
    return {
      destroy() { if (io) io.disconnect(); if (child) child.destroy(); },
      setPick(id) { if (child) { child.setPick(id); return; } pick = id; $$('.gs-athc', track).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === id))); },
    };
  }

  /** Cartes d'athlète dans `host`. o : {items, pick, onPick(id), actions(it), emptyText}. */
  function athleteCards(host, o) {
    D.clear(host);
    const box = h('div', { class: 'gs-cards', role: 'listbox', 'aria-label': 'Athlètes' });
    for (const it of o.items) {
      const s = L.summary('athlete', it.data) || { title: it.name, detail: '' };
      box.appendChild(h('div', { class: 'gs-ath', role: 'option', tabindex: '0', 'aria-selected': String(it.id === o.pick), dataset: { id: it.id },
        onclick: () => o.onPick(it.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onPick(it.id); } } },
      h('b', null, it.project ? s.title + ' (' + String(o.projectLabel || 'projet en cours').toLowerCase() + ')' : it.name), h('small', null, s.detail), actionsEl(it, o.actions)));
    }
    host.appendChild(box);
    if (!o.items.length) host.appendChild(h('p', { class: 'hint gs-empty' }, o.emptyText || "Aucun athlète enregistré : l'athlète par défaut sera utilisé."));
    if (o.pros && PYR.pros) host.appendChild(prosBlock(o));
    return { setPick(id) { $$('.gs-ath', host).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === id))); } };
  }

  /**
   * Catégorie « Coureurs World Tour » (pros.js) : un bloc repliable à part, avec un filtre par équipe, par type de coureur et par nom. Chaque carte
   * donne l'équipe, le type, le poids, la PC (W et W/kg), la Pmax et le rapport FTP / CdA estimé. o : { pick, onPick(id) }.
   */
  function prosBlock(o) {
    const Pr = PYR.pros, all = Pr.all();
    const selected = String(o.pick || '').startsWith('pro:');
    const teamSel = h('select', { 'aria-label': 'Équipe' }, h('option', { value: '' }, 'Toutes les équipes'), Object.keys(Pr.TEAMS).map((k) => h('option', { value: k }, Pr.TEAMS[k])));
    const typeSel = h('select', { 'aria-label': 'Type de coureur' }, h('option', { value: '' }, 'Tous les types'), Object.keys(Pr.TYPES).map((k) => h('option', { value: k }, Pr.TYPES[k].label)));
    const sortSel = h('select', { 'aria-label': 'Tri' }, h('option', { value: 'team' }, 'Par équipe'), h('option', { value: 'wkg' }, 'Par W/kg'), h('option', { value: 'watts' }, 'Par puissance (W)'),
      h('option', { value: 'cda' }, 'Par W/CdA'), h('option', { value: 'pmax' }, 'Par Pmax'), h('option', { value: 'name' }, 'Par nom'));
    const search = h('input', { type: 'search', placeholder: 'Rechercher un coureur…', 'aria-label': 'Rechercher un coureur', autocomplete: 'off' });
    const count = h('span', { class: 'gs-pros-n' });
    const list = h('div', { class: 'gs-cards gs-pros-list', role: 'listbox', 'aria-label': 'Coureurs World Tour' });
    const norm = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const KEY = { wkg: (it) => it.pro.wkg, watts: (it) => it.data.rider.cp, cda: (it) => Pr.wattsPerCdA(it), pmax: (it) => it.data.rider.pmax };

    // ✎ ouvre le coureur sur la page Athlète pour le modifier (« Enregistrer » le range dans la bibliothèque, sous son nom) ; ↺ rend le profil d'origine
    const proActions = (it) => ((o.onEdit || o.onReset) ? h('div', { class: 'gs-card-acts' },
      o.onEdit ? h('button', { class: 'btn ghost icon', type: 'button', title: `Ouvrir et modifier « ${it.name} » sur la page Athlète`, 'aria-label': `Ouvrir et modifier ${it.name}`, onclick: (e) => { e.stopPropagation(); o.onEdit(it); } }, '✎') : null,
      o.onReset && it.edited ? h('button', { class: 'btn ghost icon', type: 'button', title: `Rendre à « ${it.name} » son profil d'origine`, 'aria-label': `Rétablir le profil d'origine de ${it.name}`, onclick: (e) => { e.stopPropagation(); o.onReset(it); } }, '↺') : null) : null);

    function render() {
      const q = norm(search.value.trim());
      let rows = all.filter((it) => (!teamSel.value || it.pro.team === teamSel.value) && (!typeSel.value || it.pro.type === typeSel.value) && (!q || norm(it.name).includes(q)));
      if (sortSel.value === 'name') rows = rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      else if (KEY[sortSel.value]) rows = rows.slice().sort((a, b) => KEY[sortSel.value](b) - KEY[sortSel.value](a));
      D.clear(list);
      count.textContent = rows.length + ' coureur' + (rows.length > 1 ? 's' : '');
      for (const it of rows) {
        const r = it.data.rider, p = it.pro;
        list.appendChild(h('div', { class: 'gs-ath gs-pro', role: 'option', tabindex: '0', 'aria-selected': String(it.id === o.pick), dataset: { id: it.id },
          onclick: () => o.onPick(it.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onPick(it.id); } } },
        h('b', null, it.name, it.edited ? h('span', { class: 'gs-pro-edited', title: "Profil modifié et enregistré dans ta bibliothèque" }, ' · modifié') : null),
        h('small', { class: 'gs-pro-team' }, Pr.TEAMS[p.team] + ' · ' + p.typeLabel),
        h('small', null, fmt(r.weight, 0) + ' kg · ' + fmt(r.height) + ' cm · ' + r.age + ' ans'),
        h('small', null, 'PC ' + fmt(r.cp) + ' W (' + fmt(p.wkg, 2) + ' W/kg) · W′ ' + fmt(r.wPrime, 1) + ' kJ'),
        h('small', null, 'Pmax ' + fmt(r.pmax) + ' W · ' + fmt(Pr.wattsPerCdA(it)) + ' W/CdA'),
        proActions(it)));
      }
      if (!rows.length) list.appendChild(h('p', { class: 'hint gs-empty' }, 'Aucun coureur ne correspond.'));
    }
    for (const el of [teamSel, typeSel, sortSel]) el.addEventListener('change', render);
    search.addEventListener('input', render);
    render();

    const typeNote = h('p', { class: 'hint gs-pros-note' }, 'Profils estimés d\'après la taille, le poids, le type de coureur et le palmarès (ce ne sont pas des mesures). ',
      Object.keys(Pr.TYPES).map((k) => h('span', { class: 'gs-pros-ty' }, h('b', null, Pr.TYPES[k].label), ' : ' + Pr.TYPES[k].info + ' ')));
    const box = h('details', { class: 'gs-pros' }, h('summary', null, '🚴 Coureurs World Tour (' + all.length + ') ', count),
      typeNote, h('div', { class: 'gs-pros-bar' }, teamSel, typeSel, sortSel, search), list);
    if (selected) box.open = true;
    return box;
  }

  /** Ouvre le sélecteur de fichier GPX ; rappelle fn({name, data, hasEle}) avec le parcours lu (lib-cache.js routeFromGpx), ou affiche l'erreur. */
  function chooseGpx(fn) {
    const input = h('input', { type: 'file', accept: '.gpx,application/gpx+xml,text/xml', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return;
      try {
        const r = PYR.libCache.routeFromGpx(await D.readFile(f));
        if (!r.name) r.name = String(f.name || '').replace(/\.(pyr-parcours\.)?gpx$/i, '').slice(0, 60) || L.defaultRouteName();
        r.data.route.name = r.name;
        fn(r);
      } catch (e) { D.toast('Parcours illisible : ' + e.message, 'error', 6000); }
    });
    document.body.appendChild(input);
    input.click();
  }

  /** Fenêtre « Ajouter un athlète » : rappelle fn({name, data}) avec l'athlète (library.js newAthlete) quand on valide. */
  function athleteDialog(fn) {
    const t = new Date(), p2 = (x) => String(x).padStart(2, '0');
    const day = (y) => `${t.getFullYear() - y}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
    const inp = (id, label, attrs) => h('div', { class: 'field' }, h('label', { for: id }, label), h('input', Object.assign({ id }, attrs)));
    const err = h('p', { class: 'wz-warn', role: 'alert', hidden: true });
    const name = inp('lp-name', 'Nom', { type: 'text', maxlength: '30', autocomplete: 'off', value: L.defaultAthleteName() });
    const sex = h('select', { id: 'lp-sex' }, h('option', { value: 'm' }, 'Homme'), h('option', { value: 'f' }, 'Femme'));
    const val = (id) => dlg.querySelector('#' + id).value;
    const form = h('form', { method: 'dialog', novalidate: true, class: 'gs-dlg-form',
      onsubmit: (e) => {
        e.preventDefault();
        const nm = val('lp-name').trim() || L.defaultAthleteName(), age = PYR.util.ageFrom(val('lp-birth'));
        const bad = age === null ? 'Renseigne la date de naissance.' : age < 8 || age > 99 ? 'La date de naissance doit correspondre à un âge de 8 à 99 ans.'
          : [['lp-weight', 'poids'], ['lp-height', 'taille'], ['lp-ftp', 'FTP']].map(([id, l]) => (val(id) === '' ? `Renseigne le ${l}.` : '')).find(Boolean);
        if (bad) { err.textContent = bad; err.hidden = false; return; }
        dlg.close();
        fn({ name: nm, data: L.newAthlete({ name: nm, sex: val('lp-sex'), birthDate: val('lp-birth'), weight: val('lp-weight'), height: val('lp-height'), ftp: val('lp-ftp') }) });
      } },
    h('h3', null, 'Ajouter un athlète'),
    name,
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: 'lp-sex' }, 'Sexe (références de niveau)'), sex), inp('lp-birth', 'Date de naissance', { type: 'date', min: '1900-01-01', max: day(8), value: day(35) })),
    h('div', { class: 'grid3' }, inp('lp-weight', 'Poids (kg)', { type: 'number', min: '25', max: '200', step: '0.1', value: '72' }), inp('lp-height', 'Taille (cm)', { type: 'number', min: '120', max: '230', step: '1', value: '178' }), inp('lp-ftp', 'FTP (W)', { type: 'number', min: '50', max: '600', step: '1', value: '250' })),
    h('p', { class: 'hint' }, 'La puissance critique, le W′ et la courbe de puissance record se règlent ensuite dans PaceYourRide (page Athlète).'),
    err,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Annuler'), h('button', { class: 'btn primary', type: 'submit' }, 'Ajouter à ma bibliothèque')));
    const dlg = h('dialog', { class: 'modal gs-dlg', 'aria-label': 'Ajouter un athlète' }, form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    const n = dlg.querySelector('#lp-name');
    n.focus(); n.select();
  }

  /* ---------- les sélecteurs complets : les mêmes dans PaceYourRide, Virtual Ride 2D, Virtual Ride 3D et le compteur ---------- */

  const VIEW_KEY = (PYR.storageNs || 'paceyourride') + '.pickview';
  /** Vue des parcours choisie ('2d' : le tracé sur la carte ; '3d' : une vue 3D), gardée pour l'application ; `dflt` tant qu'on n'a pas choisi. */
  function viewPref(dflt) {
    let v = null;
    try { v = localStorage.getItem(VIEW_KEY); } catch (e) { /* stockage indisponible */ }
    return v === '3d' || v === '2d' ? v : (dflt === '3d' ? '3d' : '2d');
  }

  /**
   * Sélecteur de parcours : une barre (« Ajouter un parcours », autres boutons, bascule 2D / 3D) puis le carrousel (routeCarousel).
   * o : routeCarousel + {onAdd (ajout d'un fichier GPX), extra ([{label, title, fn}] : autres boutons), defaultView ('2d' | '3d')}.
   * Renvoie {destroy, setPick(id)}.
   */
  function routePicker(host, o) {
    D.clear(host);
    let view = viewPref(o.defaultView), car = null, pick = o.pick;
    const area = h('div', { class: 'gs-route-area' });
    const seg = h('div', { class: 'seg-control gs-view', role: 'radiogroup', 'aria-label': 'Vue des parcours' },
      ['2d', '3d'].map((v) => h('button', { type: 'button', role: 'radio', dataset: { view: v }, 'aria-pressed': String(v === view),
        title: v === '2d' ? 'Le tracé sur le fond de carte' : 'Le tracé en 3D, posé à son altitude : glisse pour le faire tourner', onclick: () => setView(v) }, v === '2d' ? '2D' : '3D')));
    const bar = h('div', { class: 'gs-add' },
      o.onAdd ? h('button', { class: 'btn', type: 'button', title: 'Ajouter un parcours à ta bibliothèque : un fichier GPX, ou un parcours complet exporté par PaceYourRide', onclick: o.onAdd }, '＋ Ajouter un parcours (GPX)') : null,
      (o.extra || []).map((b) => h('button', { class: 'btn', type: 'button', title: b.title || b.label, onclick: b.fn }, b.label)), seg);
    host.append(bar, area);
    function draw() {
      if (car) car.destroy();
      car = routeCarousel(area, Object.assign({}, o, { pick, view, scrollKey: host, onPick: (id) => { pick = id; o.onPick(id); } }));
    }
    function setView(v) {
      if (v === view) return;
      view = v;
      try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* stockage indisponible */ }
      $$('[data-view]', seg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
      draw();
    }
    draw();
    return { destroy() { if (car) car.destroy(); }, setPick(id) { pick = id; if (car) car.setPick(id); } };
  }

  /** Sélecteur d'athlète : une barre (« Ajouter un athlète ») puis les cartes (athleteCards). o : athleteCards + {onAdd}. */
  function athletePicker(host, o) {
    D.clear(host);
    const area = h('div');
    host.append(h('div', { class: 'gs-add' }, o.onAdd ? h('button', { class: 'btn', type: 'button', onclick: o.onAdd }, '＋ Ajouter un athlète') : null), area);
    return athleteCards(area, o);
  }

  PYR.libPick = { radarSvg, athleteCarousel, elevationProfile, routeCarousel, athleteCards, routePicker, athletePicker, viewPref, chooseGpx, athleteDialog, profileOf };
})(globalThis.PYR = globalThis.PYR || {});
