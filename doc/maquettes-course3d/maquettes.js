/* author : Hugo Joudrier-Faure */
/* Maquettes de l'écran de jeu de Course 3D sur téléphone (paysage) : données d'une même course fictive, icônes (celles du jeu,
 * Commun/js/jeu/hud3d.js), composants communs et chevrons de l'aide à la trajectoire, dessinés en perspective sur la route de fond.jpg.
 * Rien n'est lu sur le réseau. */
(function () {
  'use strict';

  /** Course fictive, commune aux trois propositions. */
  const D = {
    rider: 'Tadej Pogačar', role: 'Leader', place: 3, field: 28, tactic: 'Dans les roues',
    P: 312, v: 38.4, hr: 152, draft: 48, grade: 2.1, km: 12.4, total: 42,
    effort: 95, now: 112, boost: 0.6, boostTo: 128,   // % de la PC : consigne, puissance produite ; Accélérer : remplissage et effort atteint
    endu: 0.72, anaer: 0.58,
    ahead: { name: 'João Almeida', d: '+12 m' }, behind: { name: 'Adam Yates', d: '−30 m' },
    team: [
      { n: 'Tadej Pogačar', i: 'TP', role: 'Leader', place: 3, e: 0.72, w: 0.58, on: true },
      { n: 'João Almeida', i: 'JA', role: 'Équipier', place: 2, e: 0.66, w: 0.81 },
      { n: 'Isaac del Toro', i: 'ID', role: 'Grimpeur', place: 6, e: 0.78, w: 0.92 },
      { n: 'Adam Yates', i: 'AY', role: 'Équipier', place: 11, e: 0.51, w: 0.44 },
      { n: 'Pascal Ackermann', i: 'PA', role: 'Sprinteur', place: 15, e: 0.83, w: 0.97 },
    ],
    advice: 28,   // km/h conseillés dans le virage qui vient
  };

  /** Icônes (tracés 24 × 24) : celles des actions de hud3d.js, et quelques autres. */
  const I = {
    moveup: ['M6 13l6-6 6 6', 'M6 19l6-6 6 6'],
    attack: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    cover: ['M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6', 'M12 1v4M12 19v4M1 12h4M19 12h4'],
    sprint: ['M5 21V4', 'M5 4h12l-3 4 3 4H5'],
    front: ['M4 12h12', 'm11 6 6 6-6 6', 'M21 4v16'],
    relay: ['M20 12a8 8 0 0 1-14 5.3', 'M4 12a8 8 0 0 1 14-5.3', 'M18 3v4h-4', 'M6 21v-4h4'],
    follow: ['M3 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M15 17a3 3 0 1 0 6 0 3 3 0 1 0-6 0', 'M6 17l4-8h5l3 8', 'M10 9 8 5h3'],
    eat: ['M12 7c-3-2-7 0-7 5s3 9 7 9 7-4 7-9-4-7-7-5z', 'M12 7c0-2 1-4 3-4'],
    brake: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18', 'M8 12h8'],
    accel: ['M5 13l7-7 7 7', 'M5 20l7-7 7 7'],
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    team: ['M9 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7.5', 'M22 21v-1a6 6 0 0 0-4-5.6'],
    bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
    cam: ['M3 7h4l2-3h6l2 3h4v13H3z', 'M12 9a4 4 0 1 0 0 8 4 4 0 1 0 0-8'],
    minus: ['M5 12h14'], plus: ['M5 12h14', 'M12 5v14'],
    up: ['M6 15l6-6 6 6'], down: ['M6 9l6 6 6-6'], left: ['M15 6l-6 6 6 6'], right: ['M9 6l6 6-6 6'],
  };
  const ico = (n, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${I[n].map((d) => `<path d="${d}"/>`).join('')}</svg>`;

  /** Les huit actions, dans l'ordre du menu. */
  const ACTIONS = [
    ['moveup', 'Remonter en tête'], ['attack', 'Attaquer'], ['cover', 'Suivre les attaques'], ['sprint', 'Sprinter jusqu\'à la ligne'],
    ['front', 'Rouler en tête'], ['relay', 'Prendre le relais'], ['follow', 'Rester dans les roues'], ['eat', 'Manger'],
  ];

  const fr = (x, d) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pc = (p) => (100 * p / 150).toFixed(1) + '%';

  /** Barre d'effort (% de la PC), avec le dépassement d'Accélérer (hachuré) ; steps : boutons − et +. */
  function effort(steps) {
    return `<div class="effort"><span class="lbl">Effort</span>${steps ? `<span class="step">${ico('minus')}</span>` : '<span></span>'}
      <div class="track"><i class="set" style="width:${pc(D.effort)}"></i><i class="boost" style="left:${pc(D.effort)};width:${pc(D.boostTo - D.effort)}"></i>
      <i class="cp" style="left:${pc(100)}"></i><i class="now" style="left:${pc(D.now)}"></i></div>
      ${steps ? `<span class="step">${ico('plus')}</span>` : '<span></span>'}<span class="pct">${D.effort} %</span></div>`;
  }

  /** Endurance (vert) et effort court (rouge). */
  function meters(aero) {
    const [a, b] = aero ? ['Aérobie', 'Anaérobie'] : ['Endurance', 'Effort court'];
    return `<div class="meters"><div class="meter">${a} <div class="gauge endu"><i style="width:${D.endu * 100}%"></i></div></div>
      <div class="meter">${b} <div class="gauge anaer"><i style="width:${D.anaer * 100}%"></i></div></div></div>`;
  }

  const draft = () => `<span class="chip draft" title="Watts économisés grâce à l'aspiration">Aspiration −${D.draft} W</span>`;
  const traj = () => '<span class="seg" title="Trajectoire"><span>Auto</span><span class="on">Manuelle</span></span>';
  const name = () => `<span class="name"><i class="tag"></i>${D.rider}</span>`;
  const info = () => `${fr(D.km, 1)} / ${D.total} km · +${fr(D.grade, 1)} % · ${D.place}ᵉ/${D.field}`;
  const sub = () => `${D.role} · ${D.place}ᵉ/${D.field} · ${fr(D.km, 1)} / ${D.total} km · +${fr(D.grade, 1)} % · ${D.tactic}`;

  /** Flèche vers le coéquipier le plus proche devant (ahead) ou derrière. */
  function arrow(which, dir, cls) {
    const o = which === 'ahead' ? D.ahead : D.behind;
    return `<div class="arrow glass ${cls || ''}"><b>${ico(dir)}</b><small>${o.name.split(' ')[0]} ${o.d}</small></div>`;
  }

  /** Menu des actions du coureur actif (dessiné ouvert) ; compact : icônes seules. */
  function actionsMenu(style, cols) {
    return `<div class="menu glass${cols === 2 ? ' cols2' : ''}" style="${style}">
      <div class="row head" style="height:24px;font-size:11px;color:var(--h3-ink-2)">Actions de ${D.rider.split(' ')[0]} (coureur actif)</div>
      ${ACTIONS.map(([id, l]) => `<div class="row${id === 'follow' ? ' on' : ''}">${ico(id)}${l}${id === 'eat' ? '<small>3 gels</small>' : ''}</div>`).join('')}
    </div>`;
  }

  /** Liste de l'équipe (dessinée ouverte) : un toucher fait du coureur le coureur actif. */
  function teamMenu(style) {
    return `<div class="menu glass" style="${style}">
      <div class="row" style="height:24px;font-size:11px;color:var(--h3-ink-2)">Ton équipe · touche un coureur pour le piloter</div>
      ${D.team.map((r) => `<div class="rider${r.on ? ' on' : ''}"><span class="av">${r.i}</span>
        <span><span class="name" style="font-size:13px">${r.n}</span><br><span class="sub">${r.role} · ${r.place}ᵉ${r.on ? ' · actif' : ''}</span></span>
        <span class="minibars"><span class="gauge endu"><i style="width:${r.e * 100}%"></i></span><span class="gauge anaer"><i style="width:${r.w * 100}%"></i></span></span></div>`).join('')}
    </div>`;
  }

  /* ---------- chevrons de l'aide à la trajectoire ---------- */
  // perspective de chaque fond (844 × 390), relevée sur l'image : à la hauteur y (d = y − VY sous l'horizon), l'axe de la route est en cx(d)
  // et un mètre de côté vaut sx(d) px ; la profondeur z (m) donne y = VY + K / z
  const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const VIEWS = {
    // fond.jpg : caméra de poursuite ; vers la corde d'un virage à gauche qui commence à ≈ 45 m
    chase: { VY: 145, K: 980, cx: (d) => 442 - 0.335 * d, sx: (d) => d / 3, z0: 6, z1: 52, dz: 4.6, k: 1,
      ideal: (z) => 1.75 - 4.0 * sm((z - 8) / 28), tz: (z) => sm((z - 9) / 24), label: 46 },
    // fond-cycliste.jpg : vue du cycliste (les yeux au-dessus du guidon)
    rider: { VY: 186.3, K: 611, cx: () => 420, sx: (d) => 0.653 * d, z0: 5, z1: 44, dz: 3.4, k: 0.75,
      ideal: (z) => 1.8 - 3.8 * sm((z - 6) / 26), tz: (z) => sm((z - 7) / 20), label: 36 },
    // fond-large.jpg : caméra large, derrière le peloton
    wide: { VY: 134.5, K: 2044, cx: (d) => 436.3 - 0.0833 * d, sx: (d) => 0.215 * d, z0: 10, z1: 95, dz: 6.5, k: 1.3,
      ideal: (z) => 1.4 - 3.0 * sm((z - 14) / 55), tz: (z) => sm((z - 14) / 50), label: 84 },
  };
  /** Couleur selon l'écart entre la vitesse et la vitesse conseillée : vert (de la marge) → jaune → orange → rouge (ralentis, freine). */
  const STOPS = [[0, [52, 181, 82]], [0.45, [255, 210, 63]], [0.7, [255, 140, 40]], [1, [229, 72, 77]]];
  function color(t) {
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i], k = (t - t0) / (t1 - t0);
        return `rgb(${a.map((x, j) => Math.round(x + (b[j] - x) * k)).join(',')})`;
      }
    }
    return 'rgb(229,72,77)';
  }
  function chevrons(view, opts) {
    const V = VIEWS[view || 'chase'], o = opts || {};
    const proj = (X, z) => { const y = V.VY + V.K / z, d = y - V.VY; return [V.cx(d) + X * V.sx(d), y]; };
    // chevrons allongés (comme les flèches peintes sur la route) : vus de la caméra basse, un chevron court s'écrase
    const shape = [[-0.75, 0], [0, 2.2], [0.75, 0], [0.75, 0.9], [0, 3.1], [-0.75, 0.9]].map(([u, v]) => [u * V.k, v * V.k]);
    let out = '';
    for (let z = V.z1; z >= V.z0; z -= V.dz) {
      const X = V.ideal(z), t = V.tz(z);
      const pts = shape.map(([u, v]) => proj(X + u, z + v)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      out += `<polygon points="${pts}" fill="${color(t)}" fill-opacity="${((o.alpha || 0.92) - 0.25 * (z / V.z1)).toFixed(2)}" stroke="#fff" stroke-opacity="0.7" stroke-width="${Math.max(0.4, 6 / z).toFixed(2)}"/>`;
    }
    if (o.label !== false) {
      const [lx, ly] = proj(V.ideal(V.label), V.label);
      out += `<g transform="translate(${(lx - 6).toFixed(1)},${(ly - 30).toFixed(1)})"><rect x="-46" y="-13" width="92" height="22" rx="11" fill="rgb(229,72,77)" stroke="#fff" stroke-width="1.2"/>
        <text x="0" y="3" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">Virage ${D.advice} km/h</text></g>`;
    }
    return `<svg class="road" viewBox="0 0 844 390" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
  }

  /* ---------- HUD en deux parties : le haut (coureur actif, vitesse, puissance, FC) ---------- */
  /** Barre du haut : ◀ (coéquipier derrière), le coureur actif et ses chiffres, ▶ (coéquipier devant). */
  function topBar(cls, withDraft) {
    return `<div class="topbar glass ${cls || ''}">${arrow('behind', 'left')}
      <div class="tb-mid"><div class="tb-name">${name()}<span class="sub">${D.place}ᵉ/${D.field} · ${D.tactic}</span></div>
        <div class="tb-stats"><span><span class="big">${D.P}</span><span class="unit">W</span></span><span><span class="big">${fr(D.v, 1)}</span><span class="unit">km/h</span></span>
        <span><span class="big">${D.hr}</span><span class="unit">bpm</span></span>${withDraft ? draft() : ''}</div></div>
      ${arrow('ahead', 'right')}</div>`;
  }

  /** Cadran d'effort (demi-cercle, 0 à 150 % de la PC) : consigne (aiguille), dépassement d'Accélérer, puissance produite ; Aérobie et
   * Anaérobie en arcs extérieurs, à gauche et à droite. r : rayon (px). */
  function dial(r) {
    const W = 2 * r + 60, H = r + 34, cx = W / 2, cy = r + 22;
    const pt = (p, rr) => { const a = Math.PI * (1 - p / 150); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
    const arc = (p0, p1, rr) => { const [x0, y0] = pt(p0, rr), [x1, y1] = pt(p1, rr); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
    // arcs extérieurs : aérobie (gauche, de 0 à 75) et anaérobie (droite, de 75 à 150), remplis depuis le bas
    const aer = 75 * D.endu, ana = 75 * D.anaer;
    const [nx, ny] = pt(D.effort, r - 26), [mx, my] = pt(D.now, r - 2);
    return `<svg class="dial" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
      <path d="${arc(0, 150, r - 12)}" stroke="rgba(14,17,22,0.72)" stroke-width="30" fill="none"/>
      <path d="${arc(0, 100, r - 12)}" stroke="rgba(255,255,255,0.18)" stroke-width="18" fill="none"/>
      <path d="${arc(100, 150, r - 12)}" stroke="rgba(229,72,77,0.45)" stroke-width="18" fill="none"/>
      <path d="${arc(0, D.effort, r - 12)}" stroke="#ffd23f" stroke-width="18" fill="none"/>
      <path d="${arc(D.effort, D.boostTo, r - 12)}" stroke="url(#hatch)" stroke-width="18" fill="none"/>
      <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,140,40,0.85)"/><rect width="3" height="6" fill="#ffd23f"/></pattern></defs>
      <path d="${arc(0, 75, r + 8)}" stroke="rgba(255,255,255,0.15)" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="${arc(0, aer, r + 8)}" stroke="#34b552" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="${arc(75, 150, r + 8)}" stroke="rgba(255,255,255,0.15)" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="${arc(150 - ana, 150, r + 8)}" stroke="#e5484d" stroke-width="7" fill="none" stroke-linecap="round"/>
      ${(() => { const [a, b] = pt(100, r - 24), [c, d] = pt(100, r); return `<line x1="${a.toFixed(1)}" y1="${b.toFixed(1)}" x2="${c.toFixed(1)}" y2="${d.toFixed(1)}" stroke="#fff" stroke-width="2.5"/>`; })()}
      <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="4" fill="#111" stroke="#fff" stroke-width="1.5"/>
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="6" fill="#fff"/>
      <text x="${cx}" y="${cy - 26}" text-anchor="middle" font-size="26" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">${D.effort} %</text>
      <text x="${cx}" y="${cy - 11}" text-anchor="middle" font-size="9" font-weight="700" fill="rgba(255,255,255,0.75)" font-family="system-ui, sans-serif" letter-spacing="0.6">EFFORT · PC</text>
      <text x="${(pt(4, r + 22)[0]).toFixed(1)}" y="${cy + 10}" text-anchor="start" font-size="9" font-weight="800" fill="#8fe3a2" font-family="system-ui, sans-serif">AÉROBIE</text>
      <text x="${(pt(146, r + 22)[0]).toFixed(1)}" y="${cy + 10}" text-anchor="end" font-size="9" font-weight="800" fill="#ff9b9b" font-family="system-ui, sans-serif">ANAÉROBIE</text>
    </svg>`;
  }

  /** Bouton Accélérer rond : anneau rempli (remplissage d'Accélérer : chaque appui monte, il se vide en une seconde). */
  const ring = (p) => `background: conic-gradient(var(--h3-effort) ${(p * 360).toFixed(0)}deg, rgba(255,255,255,0.18) 0)`;

  window.M = { D, ico, ACTIONS, effort, meters, draft, traj, name, info, sub, arrow, actionsMenu, teamMenu, chevrons, ring, fr, topBar, dial, sm };
})();
