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
  function meters() {
    return `<div class="meters"><div class="meter">Endurance <div class="gauge endu"><i style="width:${D.endu * 100}%"></i></div></div>
      <div class="meter">Effort court <div class="gauge anaer"><i style="width:${D.anaer * 100}%"></i></div></div></div>`;
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
  // perspective de fond.jpg (844 × 390) : point de fuite (442, 145) ; à la hauteur y, l'axe de la route est à 442 − 0,335·(y − 145) et un
  // mètre de côté vaut (y − 145) / 3 px ; la profondeur z (m) donne y = 145 + 980 / z (le bas de l'image est à 4 m)
  const VX = 442, VY = 145, K = 980;
  function proj(X, z) {
    const y = VY + K / z, d = y - VY;
    return [VX - 0.335 * d + X * d / 3, y];
  }
  const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  /** Trajectoire idéale : depuis la place du coureur (à droite), vers la corde d'un virage à gauche qui commence à ≈ 45 m. */
  const ideal = (z) => 1.75 - 4.0 * sm((z - 8) / 28);
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
  function chevrons() {
    // chevrons allongés (comme les flèches peintes sur la route) : vus de la caméra basse, un chevron court s'écrase
    const shape = [[-0.75, 0], [0, 2.2], [0.75, 0], [0.75, 0.9], [0, 3.1], [-0.75, 0.9]];
    let out = '';
    for (let z = 52; z >= 6; z -= 4.6) {
      const X = ideal(z), t = sm((z - 9) / 24);
      const pts = shape.map(([u, v]) => proj(X + u, z + v)).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      out += `<polygon points="${pts}" fill="${color(t)}" fill-opacity="${(0.92 - 0.25 * (z / 60)).toFixed(2)}" stroke="#fff" stroke-opacity="0.7" stroke-width="${Math.max(0.4, 6 / z).toFixed(2)}"/>`;
    }
    const [lx, ly] = proj(ideal(46), 46);
    out += `<g transform="translate(${(lx - 6).toFixed(1)},${(ly - 30).toFixed(1)})"><rect x="-46" y="-13" width="92" height="22" rx="11" fill="rgb(229,72,77)" stroke="#fff" stroke-width="1.2"/>
      <text x="0" y="3" text-anchor="middle" font-size="12" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">Virage ${D.advice} km/h</text></g>`;
    return `<svg class="road" viewBox="0 0 844 390" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
  }

  /** Bouton Accélérer rond : anneau rempli (remplissage d'Accélérer : chaque appui monte, il se vide en une seconde). */
  const ring = (p) => `background: conic-gradient(var(--h3-effort) ${(p * 360).toFixed(0)}deg, rgba(255,255,255,0.18) 0)`;

  window.M = { D, ico, ACTIONS, effort, meters, draft, traj, name, info, sub, arrow, actionsMenu, teamMenu, chevrons, ring, fr };
})();
