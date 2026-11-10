/* author : Hugo Joudrier-Faure */
/* Maquettes du compteur : dessins en SVG (carte, profil, courbe de consigne, frise des tronçons, cadran, anneaux, projection des réserves).
 * Rien n'est lu sur le réseau : la carte est un fond stylisé. Les valeurs sont celles d'une même sortie fictive, communes aux trois propositions. */
(function () {
  'use strict';

  const ZONE = ['#8ec5f2', '#7fd48a', '#f1d95a', '#f4a24c', '#ee6a5a', '#c4509a', '#8c52c9'];   // zones de puissance (Commun/js/ui : ZONE_FILL)
  const FTP = 280;
  const zoneOf = (P) => { const r = P / FTP; return r < 0.55 ? 0 : r < 0.75 ? 1 : r < 0.9 ? 2 : r < 1.05 ? 3 : r < 1.2 ? 4 : r < 1.5 ? 5 : 6; };

  /** Données de la sortie fictive. */
  const D = {
    km: 42.3, total: 100,
    seg: [
      // tronçons à venir à partir de l'instant présent : durée (s), puissance (W), étiquette
      { d: 135, P: 250, l: 'faux plat' }, { d: 180, P: 310, l: 'côte 6 %' }, { d: 340, P: 220, l: 'plateau' }, { d: 120, P: 270, l: 'bosse' },
      { d: 420, P: 160, l: 'descente' }, { d: 200, P: 330, l: 'côte 8 %' }, { d: 260, P: 235, l: '' }, { d: 300, P: 205, l: '' },
    ],
    segDone: 45,          // s déjà roulées sur le tronçon en cours
  };

  /* ---------- relief : quelques côtes sur 100 km ---------- */
  function ele(x) {
    const b = (c, h, w) => h * Math.exp(-((x - c) * (x - c)) / (2 * w * w));
    return 210 + 18 * Math.sin(x / 3.1) + 9 * Math.sin(x / 1.3 + 1) + b(18, 140, 3.2) + b(47, 330, 3.0) + b(53, 120, 2) + b(74, 240, 3.6) + b(88, 90, 2.2) + x * 0.6;
  }

  const css = (el, k) => getComputedStyle(el).getPropertyValue(k).trim();
  const put = (sel, svg) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; el.innerHTML = svg; return el; };
  const f1 = (x) => x.toFixed(1);

  /* ======================================================================
   * Carte stylisée : vue orientée dans le sens de la marche, le cycliste au tiers bas, un virage à droite devant.
   * o : { dark, align ('xMidYMid' …), zoom (1 : rue, 0.6 : plus large) }
   * ====================================================================== */
  function carte(sel, o = {}) {
    const dk = !!o.dark;
    const C = dk
      ? { bg: '#1c2024', park: '#1d2b22', park2: '#22322a', water: '#1a3451', bld: '#2a2d31', road: '#33373d', roadE: '#3b3f46', main: '#5a4c2c', mainE: '#6b5a33', lbl: '#9aa0a6', done: '#eb6834', ahead: '#4a96f0', casing: '#0d0f11' }
      : { bg: '#eef0ea', park: '#d5e8cc', park2: '#c9e2bf', water: '#b9d8f1', bld: '#e0ddd4', road: '#ffffff', roadE: '#d6d3ca', main: '#fbe3a6', mainE: '#e2c47a', lbl: '#6b6a64', done: '#eb6834', ahead: '#2a78d6', casing: '#ffffff' };
    const bld = [];
    // pâtés de maisons du village (en haut à droite) et quelques fermes
    const blocks = [[250, 150, 34, 22], [292, 146, 26, 30], [326, 160, 38, 20], [258, 190, 22, 26], [300, 196, 30, 20], [340, 198, 24, 28], [262, 98, 30, 22], [306, 104, 22, 18], [344, 110, 30, 22],
      [70, 520, 20, 16], [96, 534, 14, 14], [300, 560, 22, 18], [322, 582, 16, 14], [44, 300, 24, 18], [120, 210, 20, 14]];
    for (const [x, y, w, h] of blocks) bld.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${C.bld}"/>`);
    const svg = `<svg viewBox="0 0 390 700" preserveAspectRatio="${o.align || 'xMidYMid'} slice" width="100%" height="100%">
      <rect width="390" height="700" fill="${C.bg}"/>
      <path d="M-20 360 C40 330 90 380 110 430 C130 480 60 520 -20 500 Z" fill="${C.park}"/>
      <path d="M260 420 C320 400 400 420 410 470 L410 640 C360 650 300 620 280 570 C262 520 230 450 260 420 Z" fill="${C.park2}"/>
      <path d="M-20 620 C60 600 120 640 140 720 L-20 720 Z" fill="${C.park}"/>
      <path d="M40 40 C80 20 140 30 150 70 C160 110 90 130 50 110 C20 96 10 60 40 40 Z" fill="${C.park2}"/>
      <path d="M-20 238 C60 250 120 226 200 236 C270 245 330 232 410 214" stroke="${C.water}" stroke-width="16" fill="none" stroke-linecap="round"/>
      ${bld.join('')}
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M-20 600 C80 590 150 560 192 520 M192 520 C240 500 330 500 410 470" stroke="${C.roadE}" stroke-width="9"/>
        <path d="M-20 600 C80 590 150 560 192 520 M192 520 C240 500 330 500 410 470" stroke="${C.road}" stroke-width="6"/>
        <path d="M216 300 C226 220 232 120 242 -20" stroke="${C.roadE}" stroke-width="9"/>
        <path d="M216 300 C226 220 232 120 242 -20" stroke="${C.road}" stroke-width="6"/>
        <path d="M-20 140 C60 150 150 170 228 182 C300 192 350 180 410 176" stroke="${C.roadE}" stroke-width="8"/>
        <path d="M-20 140 C60 150 150 170 228 182 C300 192 350 180 410 176" stroke="${C.road}" stroke-width="5"/>
        <path d="M90 720 C100 650 140 600 192 520" stroke="${C.roadE}" stroke-width="7"/>
        <path d="M90 720 C100 650 140 600 192 520" stroke="${C.road}" stroke-width="4"/>
        <path d="M195 760 C195 640 185 560 190 470 C195 380 200 330 215 300 C240 270 300 265 420 250" stroke="${C.mainE}" stroke-width="13"/>
        <path d="M195 760 C195 640 185 560 190 470 C195 380 200 330 215 300 C240 270 300 265 420 250" stroke="${C.main}" stroke-width="10"/>
        <!-- trace du parcours : roulé (orange) et à venir (bleu) -->
        <path d="M195 760 C195 640 185 560 190 470" stroke="${C.casing}" stroke-width="11" opacity="0.9"/>
        <path d="M195 760 C195 640 185 560 190 470" stroke="${C.done}" stroke-width="6"/>
        <path d="M190 470 C195 380 200 330 215 300 C240 270 300 265 420 250" stroke="${C.casing}" stroke-width="12" opacity="0.9"/>
        <path d="M190 470 C195 380 200 330 215 300 C240 270 300 265 420 250" stroke="${C.ahead}" stroke-width="7"/>
      </g>
      <text x="241" y="196" font-size="11" font-weight="700" fill="${C.lbl}" transform="rotate(-84 241 196)">Chemin des Prés</text>
      <text x="318" y="252" font-size="12" font-weight="800" fill="${C.lbl}" transform="rotate(-5 318 252)">D12</text>
      <text x="30" y="226" font-size="11" font-style="italic" font-weight="600" fill="${dk ? '#5d84ad' : '#5b8fbf'}">L'Ouche</text>
      <text x="290" y="134" font-size="12" font-weight="800" fill="${C.lbl}" letter-spacing="1">VELARS</text>
      <!-- virage à venir et position du cycliste -->
      <circle cx="215" cy="300" r="6" fill="${dk ? '#0d0f11' : '#222'}" stroke="#fff" stroke-width="2.5"/>
      <path d="M190 470 L176 430 L204 430 Z" fill="${C.ahead}" opacity="0.28"/>
      <circle cx="190" cy="470" r="12" fill="#eb6834" stroke="#fff" stroke-width="3.5"/>
    </svg>`;
    return put(sel, svg);
  }

  /* ======================================================================
   * Profil d'élévation : colonnes colorées par zone de puissance du plan, position actuelle.
   * o : { w, h, from, to (km), dark, axis (true : km et altitudes), climbs (étiquettes des côtes) }
   * ====================================================================== */
  function profil(sel, o = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const w = o.w || el.clientWidth, h = o.h || el.clientHeight, a = o.from ?? 0, b = o.to ?? D.total;
    const n = Math.round(w / 3), padB = o.axis ? 16 : 2, padT = o.climbs ? 18 : 4;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= n; i++) { const e = ele(a + (b - a) * i / n); lo = Math.min(lo, e); hi = Math.max(hi, e); }
    lo -= (hi - lo) * 0.25; hi += (hi - lo) * 0.06;
    const X = (x) => (x - a) / (b - a) * w, Y = (e) => h - padB - (e - lo) / (hi - lo) * (h - padB - padT);
    const cols = [];
    for (let i = 0; i < n; i++) {
      const x0 = a + (b - a) * i / n, x1 = a + (b - a) * (i + 1) / n, e0 = ele(x0), e1 = ele(x1);
      const grade = (e1 - e0) / ((x1 - x0) * 1000);
      const P = grade > 0.07 ? 330 : grade > 0.045 ? 310 : grade > 0.025 ? 275 : grade > 0.008 ? 250 : grade > -0.01 ? 220 : 150;
      const past = x1 <= D.km;
      cols.push(`<path d="M${f1(X(x0))} ${h - padB} L${f1(X(x0))} ${f1(Y(e0))} L${f1(X(x1))} ${f1(Y(e1))} L${f1(X(x1))} ${h - padB} Z" fill="${past ? (o.dark ? '#3a3a38' : '#d2d0c8') : ZONE[zoneOf(P)]}"/>`);
    }
    let line = '';
    for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; line += (i ? 'L' : 'M') + f1(X(x)) + ' ' + f1(Y(ele(x))); }
    const ink = o.dark ? '#f2f2ee' : '#2b2a27', ink2 = o.dark ? '#a9a79f' : '#6f6d66';
    const cx = X(D.km), cy = Y(ele(D.km));
    let extra = '';
    if (o.axis) {
      const span = b - a, step = span > 60 ? 20 : span >= 20 ? 10 : span > 6 ? 2 : 1;
      for (let k = Math.ceil(a / step) * step; k <= b; k += step) { const x = X(k), an = x < 18 ? 'start' : x > w - 18 ? 'end' : 'middle'; extra += `<text x="${f1(Math.min(w - 1, Math.max(1, x)))}" y="${h - 3}" font-size="10" text-anchor="${an}" fill="${ink2}">${k} km</text>`; }
    }
    if (o.climbs) {
      for (const [c, lbl] of [[47, '2e cat.'], [74, '3e cat.'], [18, '4e']]) {
        if (c < a || c > b) continue;
        const e = Math.max(ele(c - 0.4), ele(c), ele(c + 0.4));
        extra += `<text x="${f1(X(c))}" y="${f1(Math.max(11, Y(e) - 5))}" font-size="10" font-weight="800" text-anchor="middle" fill="${ink}">${lbl}</text>`;
      }
    }
    return put(el, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      ${cols.join('')}<path d="${line}" fill="none" stroke="${ink2}" stroke-width="1.4"/>
      <line x1="${f1(cx)}" y1="${padT - 2}" x2="${f1(cx)}" y2="${h - padB}" stroke="${ink}" stroke-width="2"/>
      <circle cx="${f1(cx)}" cy="${f1(cy)}" r="5" fill="${ink}" stroke="${o.dark ? '#000' : '#fff'}" stroke-width="2"/>${extra}</svg>`);
  }

  /* ======================================================================
   * Courbe de consigne (comme drawTrajectory de tab-ride.js) : tube ± 5 %, puissance moyenne sur 3 s, consigne à venir.
   * o : { w, h, past (s), ahead (s), dark, step (s avant le changement de consigne) }
   * ====================================================================== */
  function tube(sel, o = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const w = o.w || el.clientWidth, h = o.h || el.clientHeight, past = o.past || 30, ahead = o.ahead || 15;
    const stepAt = o.step ?? 135, tgt = (t) => (t < stepAt ? 250 : 310);
    const good = css(el, '--good') || '#0ca30c', goodBg = css(el, '--good-bg'), warn = css(el, '--warn'), low = css(el, '--low');
    const ink = css(el, '--ink'), ink2 = css(el, '--ink-2');
    const lo = 200, hi = 340, left = 30, right = 8, top = 8, bot = h - 18;
    const X = (t) => left + (t + past) / (past + ahead) * (w - left - right), Y = (p) => bot - (p - lo) / (hi - lo) * (bot - top);
    const tol = (p) => p * 0.05;
    // tube en marches
    let up = '', dn = '';
    const N = past + ahead;
    for (let i = 0; i < N; i++) {
      const t = -past + i, p = tgt(t);
      up += (i ? 'L' : 'M') + f1(X(t)) + ' ' + f1(Y(p + tol(p))) + 'L' + f1(X(t + 1)) + ' ' + f1(Y(p + tol(p)));
    }
    for (let i = N - 1; i >= 0; i--) { const t = -past + i, p = tgt(t); dn += 'L' + f1(X(t + 1)) + ' ' + f1(Y(p - tol(p))) + 'L' + f1(X(t)) + ' ' + f1(Y(p - tol(p))); }
    let mid = '';
    for (let i = 0; i < N; i++) { const t = -past + i, p = tgt(t); mid += (i ? 'L' : 'M') + f1(X(t)) + ' ' + f1(Y(p)) + 'L' + f1(X(t + 1)) + ' ' + f1(Y(p)); }
    // mesures : bruit autour de la consigne, une sortie au-dessus du tube puis un creux
    const meas = (t) => 248 + 7 * Math.sin(t * 0.9) + 5 * Math.sin(t * 2.3 + 1) + (t > -48 && t < -38 ? 22 * Math.sin((t + 48) / 10 * Math.PI) : 0) + (t > -22 && t < -15 ? -18 * Math.sin((t + 22) / 7 * Math.PI) : 0);
    let raw = '', seg = '';
    for (let t = -past; t <= 0; t++) raw += (t === -past ? 'M' : 'L') + f1(X(t)) + ' ' + f1(Y(meas(t) + 9 * Math.sin(t * 3.7))) ;
    for (let t = -past + 1; t <= 0; t++) {
      const p0 = meas(t - 1), p1 = meas(t), d = p1 - 250, c = Math.abs(d) <= tol(250) ? good : d > 0 ? warn : low;
      seg += `<path d="M${f1(X(t - 1))} ${f1(Y(p0))} L${f1(X(t))} ${f1(Y(p1))}" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`;
    }
    const ticks = o.ticks || [-past, 0, ahead];
    const lab = (t) => (t === 0 ? 'maintenant' : (t > 0 ? '+' : '−') + (Math.abs(t) >= 60 ? (Math.abs(t) / 60) + ' min' : Math.abs(t) + ' s'));
    const nowX = X(0), cy = Y(meas(0));
    return put(el, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="inherit">
      <path d="${up}${dn}Z" fill="${goodBg}"/><path d="${up}${dn}Z" fill="none" stroke="${good}" stroke-width="1.4"/>
      <rect x="${f1(nowX)}" y="${top}" width="${f1(w - right - nowX)}" height="${bot - top}" fill="${goodBg}" opacity="0.35"/>
      <path d="${mid}" fill="none" stroke="${good}" stroke-width="1" stroke-dasharray="4 3"/>
      <path d="${raw}" fill="none" stroke="${ink2}" stroke-width="1" opacity="0.35"/>${seg}
      <line x1="${f1(nowX)}" y1="${top}" x2="${f1(nowX)}" y2="${bot}" stroke="${ink}" stroke-width="1" opacity="0.5"/>
      <circle cx="${f1(nowX)}" cy="${f1(cy)}" r="5.5" fill="${good}" stroke="${ink}" stroke-width="2"/>
      ${stepAt < ahead ? `<text x="${f1(X(stepAt) + 4)}" y="${f1(Y(310 + tol(310)) - 4)}" font-size="12" font-weight="800" fill="${ink}">310 W</text>` : ''}
      <text x="${f1(nowX + 6)}" y="${f1(Y(250 + tol(250)) - 4)}" font-size="12" font-weight="800" fill="${ink}">250 W</text>
      <text x="${left - 4}" y="${top + 9}" font-size="10" text-anchor="end" fill="${ink2}">${hi}</text>
      <text x="${left - 4}" y="${bot}" font-size="10" text-anchor="end" fill="${ink2}">${lo}</text>
      ${ticks.map((t) => `<text x="${f1(Math.max(left + 18, Math.min(w - 26, X(t))))}" y="${h - 4}" font-size="10" text-anchor="middle" fill="${ink2}">${lab(t)}</text>`).join('')}
    </svg>`);
  }

  /* ======================================================================
   * Frise des tronçons à venir (entraînement structuré) : largeur = durée, hauteur = puissance, couleur = zone.
   * o : { w, h, minutes (horizon), dark, labels }
   * ====================================================================== */
  function frise(sel, o = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const w = o.w || el.clientWidth, h = o.h || el.clientHeight, horizon = (o.minutes || 25) * 60 + D.segDone;
    const ink = css(el, '--ink'), ink2 = css(el, '--ink-2'), surf2 = css(el, '--surface-2');
    const top = o.labels ? 18 : 4, bot = h - 16, X = (t) => t / horizon * w, Y = (p) => bot - p / 360 * (bot - top);
    let t = 0, out = '';
    const segs = [{ d: D.segDone, P: 250, done: true }].concat(D.seg.map((s, i) => (i === 0 ? Object.assign({}, s, { d: s.d }) : s)));
    for (const s of segs) {
      if (t >= horizon) break;
      const d = Math.min(s.d, horizon - t), x0 = X(t), x1 = X(t + d);
      const col = s.done ? (o.dark ? '#4a4a47' : '#c9c7bf') : ZONE[zoneOf(s.P)];
      out += `<rect x="${f1(x0 + 0.75)}" y="${f1(Y(s.P))}" width="${f1(Math.max(1, x1 - x0 - 1.5))}" height="${f1(bot - Y(s.P))}" rx="3" fill="${col}"/>`;
      if (o.labels && !s.done && x1 - x0 > 26) out += `<text x="${f1((x0 + x1) / 2)}" y="${f1(Y(s.P) - 4)}" font-size="11" font-weight="800" text-anchor="middle" fill="${ink}">${s.P}</text>`;
      t += d;
    }
    const nowX = X(D.segDone);
    // ligne de la PC (285 W) et graduations en minutes
    let ax = '';
    for (let m = 0; m * 60 <= horizon - D.segDone; m += (o.minutes || 25) > 12 ? 5 : 2) {
      const x = X(D.segDone + m * 60);
      ax += `<text x="${f1(m === 0 ? Math.max(0, x - 8) : Math.min(w - 2, x))}" y="${h - 3}" font-size="10" text-anchor="${m === 0 ? 'start' : x > w - 30 ? 'end' : 'middle'}" fill="${ink2}">${m === 0 ? 'maint.' : '+' + m + ' min'}</text>`;
    }
    return put(el, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="0" y="${top}" width="${w}" height="${bot - top}" fill="${surf2}" opacity="0.0"/>
      ${out}
      <line x1="0" y1="${f1(Y(285))}" x2="${w}" y2="${f1(Y(285))}" stroke="${ink2}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
      <text x="${w - 2}" y="${f1(Y(285) + 11)}" font-size="10" font-weight="800" text-anchor="end" fill="${ink}" stroke="${css(el, '--surface')}" stroke-width="3" paint-order="stroke">PC 285</text>
      <line x1="${f1(nowX)}" y1="${top - 2}" x2="${f1(nowX)}" y2="${bot + 2}" stroke="${ink}" stroke-width="2.5"/>
      <path d="M${f1(nowX - 5)} ${top - 6} L${f1(nowX + 5)} ${top - 6} L${f1(nowX)} ${top} Z" fill="${ink}"/>
      ${ax}</svg>`);
  }

  /* ======================================================================
   * Cadran en arc (proposition B) : plage 150–350 W, zone cible ± 5 %, repère de la puissance actuelle.
   * ====================================================================== */
  function cadran(sel, o = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const S = o.size || 330, cx = S / 2, cy = S / 2, R = S / 2 - 24, lo = 150, hi = 350, a0 = 150, sweep = 240;
    const ang = (p) => (a0 + (p - lo) / (hi - lo) * sweep) * Math.PI / 180;
    const pt = (p, r) => [cx + r * Math.cos(ang(p)), cy + r * Math.sin(ang(p))];
    const arc = (p0, p1, r) => { const [x0, y0] = pt(p0, r), [x1, y1] = pt(p1, r); const large = (p1 - p0) / (hi - lo) * sweep > 180 ? 1 : 0; return `M${f1(x0)} ${f1(y0)} A${r} ${r} 0 ${large} 1 ${f1(x1)} ${f1(y1)}`; };
    let ticks = '';
    for (let p = lo; p <= hi; p += 25) {
      const [x0, y0] = pt(p, R + 13), [x1, y1] = pt(p, R + 4), [tx, ty] = pt(p, R - 26);
      ticks += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>`;
      if (p % 50 === 0) ticks += `<text x="${f1(tx)}" y="${f1(ty + 4)}" font-size="12" font-weight="700" text-anchor="middle" fill="rgba(255,255,255,0.75)">${p}</text>`;
    }
    const cur = o.value || 248, [mx, my] = pt(cur, R);
    return put(el, `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
      <path d="${arc(lo, hi, R)}" stroke="rgba(255,255,255,0.22)" stroke-width="22" fill="none" stroke-linecap="round"/>
      <path d="${arc(lo, 237.5, R)}" stroke="rgba(120,190,255,0.55)" stroke-width="22" fill="none"/>
      <path d="${arc(262.5, hi, R)}" stroke="rgba(255,190,80,0.55)" stroke-width="22" fill="none"/>
      <path d="${arc(237.5, 262.5, R)}" stroke="#ffffff" stroke-width="30" fill="none"/>
      ${ticks}
      <circle cx="${f1(mx)}" cy="${f1(my)}" r="17" fill="#0b0b0b" stroke="#fff" stroke-width="4"/>
      <circle cx="${f1(mx)}" cy="${f1(my)}" r="6" fill="#2fc42f"/>
    </svg>`);
  }

  /* ---------- anneau (proposition B) ---------- */
  function anneau(sel, o) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const S = o.size || 150, r = S / 2 - 12, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, o.frac));
    let tick = '';
    if (o.plan !== undefined) {
      const a = -Math.PI / 2 + o.plan * 2 * Math.PI, x0 = S / 2 + (r - 14) * Math.cos(a), y0 = S / 2 + (r - 14) * Math.sin(a), x1 = S / 2 + (r + 14) * Math.cos(a), y1 = S / 2 + (r + 14) * Math.sin(a);
      tick = `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
    }
    const second = o.frac2 ? `<circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${o.color2}" stroke-width="16" stroke-dasharray="${f1(o.frac2 * c)} ${f1(c)}" stroke-dashoffset="${f1(-f * c)}" transform="rotate(-90 ${S / 2} ${S / 2})"/>` : '';
    return put(el, `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
      <circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${o.track || 'rgba(255,255,255,0.12)'}" stroke-width="16"/>
      <circle cx="${S / 2}" cy="${S / 2}" r="${r}" fill="none" stroke="${o.color}" stroke-width="16" stroke-linecap="${o.frac2 ? 'butt' : 'round'}" stroke-dasharray="${f1(f * c)} ${f1(c)}" transform="rotate(-90 ${S / 2} ${S / 2})"/>
      ${second}${tick}
    </svg>`);
  }

  /* ======================================================================
   * Projection des réserves jusqu'à l'arrivée (proposition C) : glycogène et hydratation, roulé (plein) et prévu (tirets), plan (gris).
   * ====================================================================== */
  function projection(sel, o = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const w = o.w || el.clientWidth, h = o.h || el.clientHeight;
    const ink = css(el, '--ink'), ink2 = css(el, '--ink-2'), bad = css(el, '--bad'), badBg = css(el, '--bad-bg'), gly = css(el, '--gly-muscle'), low = css(el, '--low');
    const left = 30, right = 10, top = 10, bot = h - 18;
    const X = (k) => left + k / 100 * (w - left - right), Y = (p) => bot - p / 100 * (bot - top);
    const glyR = (k) => 100 - k * 0.98 + (k > 30 ? 6 : 0) + (k > 38 ? 2 : 0);           // roulé : 100 % → 62 % à 42,3 km (un gel à 30 km)
    const glyP = (k) => 62 - (k - D.km) * 0.66 + (k > 50 ? 5 : 0) + (k > 66 ? 4 : 0);   // prévu, avec les prises du plan
    const plan = (k) => 100 - k * 0.78;
    const hyR = (k) => 100 - k * 0.36, hyP = (k) => 85 - (k - D.km) * 0.42 + (k > 60 ? 6 : 0);
    const path = (fn, a, b) => { let s = ''; for (let k = a; k <= b + 1e-6; k += 0.5) s += (s ? 'L' : 'M') + f1(X(k)) + ' ' + f1(Y(fn(k))); return s; };
    const intakes = [[50, 'gel'], [66, 'barre'], [82, 'gel']];
    return put(el, `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="${left}" y="${f1(Y(20))}" width="${w - left - right}" height="${f1(bot - Y(20))}" fill="${badBg}"/>
      <text x="${left + 4}" y="${f1(bot - 4)}" font-size="10" font-weight="700" fill="${bad}">fringale</text>
      ${[0, 50, 100].map((p) => `<text x="${left - 4}" y="${f1(Y(p) + 3)}" font-size="10" text-anchor="end" fill="${ink2}">${p}</text>`).join('')}
      ${[0, 25, 50, 75, 100].map((k) => `<text x="${f1(Math.min(w - 16, Math.max(left + 6, X(k))))}" y="${h - 4}" font-size="10" text-anchor="middle" fill="${ink2}">${k}${k === 100 ? ' km' : ''}</text>`).join('')}
      <path d="${path(plan, 0, 100)}" fill="none" stroke="${ink2}" stroke-width="1.2" stroke-dasharray="2 3" opacity="0.8"/>
      <path d="${path(hyR, 0, D.km)}" fill="none" stroke="${low}" stroke-width="2.5"/>
      <path d="${path(hyP, D.km, 100)}" fill="none" stroke="${low}" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${path(glyR, 0, D.km)}" fill="none" stroke="${gly}" stroke-width="3"/>
      <path d="${path(glyP, D.km, 100)}" fill="none" stroke="${gly}" stroke-width="2.5" stroke-dasharray="5 4"/>
      <line x1="${f1(X(D.km))}" y1="${top}" x2="${f1(X(D.km))}" y2="${bot}" stroke="${ink}" stroke-width="1.5" opacity="0.7"/>
      ${intakes.map(([k, l]) => `<g><circle cx="${f1(X(k))}" cy="${f1(Y(glyP(k)) - 12)}" r="8" fill="${css(el, '--warn')}"/><text x="${f1(X(k))}" y="${f1(Y(glyP(k)) - 8.5)}" font-size="10" font-weight="800" text-anchor="middle" fill="#000">${l === 'gel' ? 'G' : 'B'}</text></g>`).join('')}
      <circle cx="${f1(X(D.km))}" cy="${f1(Y(62))}" r="5" fill="${gly}" stroke="${ink}" stroke-width="1.5"/>
      <circle cx="${f1(X(D.km))}" cy="${f1(Y(85))}" r="4.5" fill="${low}" stroke="${ink}" stroke-width="1.5"/>
      <text x="${f1(X(100) - 2)}" y="${f1(Y(glyP(100)) - 6)}" font-size="11" font-weight="800" text-anchor="end" fill="${gly}">${Math.round(glyP(100))} %</text>
      <text x="${f1(X(100) - 2)}" y="${f1(Y(hyP(100)) - 6)}" font-size="11" font-weight="800" text-anchor="end" fill="${low}">${Math.round(hyP(100))} %</text>
    </svg>`);
  }

  window.MQ = { D, ZONE, zoneOf, ele, carte, profil, tube, frise, cadran, anneau, projection };
})();
