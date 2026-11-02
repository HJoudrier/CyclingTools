/* author : Hugo Joudrier-Faure */
/* PaceYourRide — le profil d'un athlète en sept « spécialités », pour un graphique en toile d'araignée (accueil) : grimpeur, sprinteur, rouleur,
 * contre-la-montre, courses par étapes, classiques, puncheur. Chaque score (0 à 100) est calculé à partir de ce que le modèle sait de l'athlète :
 *   - physiologie : courbe de puissance record (FTP, puissance sur 1, 5, 20 min, Pmax), puissance critique, W′ ;
 *   - métabolisme (metabo.js, carte athlète) : VO₂max, proportion de fibres lentes, oxydation des lipides, pouvoir tampon ;
 *   - aérodynamique : le CdA du corps (taille, poids) en position route et en position contre-la-montre, d'où les watts par m² de CdA ;
 *   - poids : les watts par kilo (la montée) et la puissance absolue (le plat, le vent).
 * L'échelle dépend de la catégorie de l'athlète (Pro, Élite, 1ʳᵉ à 4ᵉ catégorie, Loisir : DIVISIONS, d'après ses watts par kilo) : un score de 100 est le
 * meilleur d'une catégorie dans cette spécialité, pas du peloton. Les scores sont des repères relatifs (une spécialité n'exclut pas les autres) : un grimpeur léger a un faible score de rouleur, un rouleur lourd un faible score de
 * grimpeur, un leader de grand tour est bon presque partout.
 *   const r = PYR.riderRadar.scores(rider);   // { scores: { climb, sprint, flat, tt, stage, classic, punch }, metrics, best: [ids triés], profile }
 * Pure (testée sous Node) : aucune interface. */
(function (PYR) {
  'use strict';

  /** Spécialités, dans l'ordre des branches du graphique (en partant du haut, dans le sens des aiguilles d'une montre). */
  const CATEGORIES = [
    { id: 'climb', label: 'Grimpeur', short: 'Grimpeur', info: 'Watts par kilo à 5 min, 20 min et 1 h, VO₂max.' },
    { id: 'sprint', label: 'Sprinteur', short: 'Sprint', info: 'Puissance sur 5, 15 et 30 s, sur 1 min (approche du sprint), W′, fibres rapides.' },
    { id: 'flat', label: 'Rouleur', short: 'Rouleur', info: 'Puissance absolue et watts par m² de CdA en position route, endurance.' },
    { id: 'tt', label: 'Contre-la-montre', short: 'CLM', info: 'Watts par m² de CdA en position chrono, puissance à 20–60 min.' },
    { id: 'stage', label: 'Courses par étapes', short: 'Étapes', info: 'Montée, chrono et récupération : fibres lentes, lipides, VO₂max.' },
    { id: 'classic', label: 'Classiques', short: 'Classiques', info: 'Puissance absolue, Pmax, W′, aérodynamisme, endurance.' },
    { id: 'punch', label: 'Puncheur', short: 'Puncheur', info: 'Efforts de 1 à 5 min : puissance par kilo, W′, pouvoir tampon.' },
  ];

  const STRETCH_LO = 30, STRETCH_HI = 98;
  /** Score moyen du peloton World Tour (pros.js) dans chaque spécialité : la spécialité d'un athlète est celle où il s'en détache le plus. */
  const REF = { climb: 61, sprint: 60, flat: 70, tt: 71, stage: 62, classic: 64, punch: 65 };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  /**
   * Catégories de niveau (du plus haut au plus bas), avec le rapport minimal de l'athlète au niveau « classe mondiale » de Coggan et Allen
   * (benchmarks.js : 60 % de la FTP et 40 % de la puissance sur 5 min, rapportées au poids ; ni le sprint ni la durée d'un effort ne comptent : la catégorie est un niveau d'endurance et de PMA) et le facteur rho par lequel on réduit les échelles du graphique
   * (le centre de la catégorie rapporté à celui du peloton World Tour, dont les échelles sont celles du code ci-dessous). Les seuils prolongent ceux de
   * Coggan : « exceptionnel » (pro continental, élite nationale) ≈ 0,91, « excellent » (catégorie 1) ≈ 0,82, « très bon » (catégorie 2) ≈ 0,735…
   */
  const DIVISIONS = [
    { id: 'pro', label: 'Pro (World Tour)', short: 'Pro', min: 0.91, rho: 1.0 },
    { id: 'elite', label: 'Élite', short: 'Élite', min: 0.85, rho: 0.92 },
    { id: 'cat1', label: '1ʳᵉ catégorie', short: '1ʳᵉ cat.', min: 0.78, rho: 0.85 },
    { id: 'cat2', label: '2ᵉ catégorie', short: '2ᵉ cat.', min: 0.70, rho: 0.77 },
    { id: 'cat3', label: '3ᵉ catégorie', short: '3ᵉ cat.', min: 0.61, rho: 0.68 },
    { id: 'cat4', label: '4ᵉ catégorie', short: '4ᵉ cat.', min: 0.52, rho: 0.59 },
    { id: 'leisure', label: 'Loisir', short: 'Loisir', min: 0, rho: 0.47 },
  ];

  /** x ramené de [lo, hi] à [0, 100]. */
  const sc = (x, lo, hi) => 100 * clamp((x - lo) / (hi - lo), 0, 1);
  /** Moyenne pondérée de [poids, score]. */
  const mix = (...parts) => { let w = 0, s = 0; for (const [k, v] of parts) { w += k; s += k * v; } return s / w; };

  // vélo et tenue de référence : le CdA ne doit dépendre que du corps de l'athlète (taille, poids), pas de son équipement du moment
  const BIKE = { weight: 7.5, load: 1.5, frame: 'road', wheels: 'low', tire: 'road', drivetrain: 'clean', shoes: 'road', wheelMass: 2.2 };
  const ROAD = { position: 'drops', helmet: 'road', clothing: 'fitted', glasses: 'sport', socks: 'classic', shave: 'legs' };
  const CHRONO = { position: 'tt', helmet: 'tt', clothing: 'skinsuit_tt', glasses: 'sport', socks: 'aero', shave: 'legs' };

  function cdaOf(rider, outfit) {
    const P = PYR.physics;
    if (P && P.buildSetup) {
      try { return P.buildSetup(Object.assign({}, rider, outfit), BIKE).cda; } catch (e) { /* repli ci-dessous */ }
    }
    const a = P && P.frontalRef ? P.frontalRef(rider.height, rider.weight) : 0.335;
    return a * (outfit === CHRONO ? 0.74 : 0.92);
  }

  /** Mesures dont les scores sont tirés (voir en tête de fichier). */
  function metrics(rider) {
    const r = rider || {};
    const kg = Number(r.weight) > 0 ? Number(r.weight) : 72;
    const a = PYR.physio.buildAthlete(r);
    let card = null;
    try { card = PYR.metabo ? PYR.metabo.card(r, a).values : null; } catch (e) { card = null; }
    const m = {
      kg,
      ftp: a.ftp, ftpKg: a.ftp / kg,
      p20: a.mmp(1200), p20Kg: a.mmp(1200) / kg,
      p5Kg: a.mmp(300) / kg, p1Kg: a.mmp(60) / kg, p1: a.mmp(60), p30s: a.mmp(30), p15s: a.mmp(15), p5s: a.mmp(5),
      pmax: a.pmax, pmaxKg: a.pmax / kg,
      wPrime: a.w0 / 1000, wPrimeKg: a.w0 / 1000 / kg,
      cp: a.cp,
      vo2: card ? card.vo2max : 0, slow: card ? card.fI : 55, buffer: card ? card.buffer : 1,
    };
    m.cdaRoad = cdaOf(r, ROAD); m.cdaTT = cdaOf(r, CHRONO);
    m.wCdaRoad = a.ftp / m.cdaRoad; m.wCdaTT = a.ftp / m.cdaTT;
    return m;
  }

  /**
   * Catégorie de l'athlète d'après ses watts par kilo (FTP et 5 min) rapportés aux seuils « classe mondiale » de benchmarks.js (selon son
   * sexe). Renvoie { division (une entrée de DIVISIONS), ratio }.
   */
  function division(rider, m) {
    m = m || metrics(rider);
    const B = PYR.bench, sex = rider && rider.sex === 'f' ? 'f' : 'm';
    let ratio;
    if (B && B.thresholds) {
      const t = (e) => B.thresholds(sex, e)[0];
      ratio = 0.6 * (m.ftpKg / t('ftp')) + 0.4 * (m.p5Kg / t('p300'));
    } else ratio = m.ftpKg / (sex === 'f' ? 5.36 : 6.04);
    return { division: DIVISIONS.find((d) => ratio >= d.min) || DIVISIONS[DIVISIONS.length - 1], ratio };
  }

  /**
   * Scores de l'athlète (0–100) dans chaque spécialité, par rapport à sa catégorie : les échelles sont celles du peloton World Tour réduites du facteur
   * de la catégorie (division), pour que le graphique montre les forces et les faiblesses d'un coureur parmi ses pairs, pas son niveau absolu.
   * rider : le profil au format de la bibliothèque (poids, taille, FTP, records, carte physio…). opts.worldTour : coureur du World Tour (catégorie Pro,
   * quelle que soit sa puissance). Renvoie { scores, division, ratio, metrics, best (identifiants triés de la spécialité qui se détache le plus de la
   * moyenne à la moins marquée), profile (libellé de la première) }.
   */
  function scores(rider, opts) {
    const m = metrics(rider);
    const d = division(rider, m);
    const div = opts && opts.worldTour ? DIVISIONS[0] : d.division;
    const k = div.rho, kv = Math.pow(k, 0.6);
    // échelles du peloton pro (5ᵉ centile moins une marge, 95ᵉ centile) ramenées à la catégorie : puissances × k, VO₂max × k^0,6 ; les fibres lentes et le
    // pouvoir tampon sont des qualités de l'athlète, pas de son niveau : leurs échelles ne changent pas
    const S = (x, lo, hi) => sc(x, lo * k, hi * k);
    const V = (x, lo, hi) => sc(x, lo * kv, hi * kv);
    // la puissance de sprint dépend moins de la catégorie que celle d'endurance (un amateur sprinte à 1 100–1 400 W, un pro à 1 500–2 000 W) : k^0,45
    const ks = Math.pow(k, 0.45), Q = (x, lo, hi) => sc(x, lo * ks, hi * ks);
    // endurance : fibres lentes (la fatigue d'une longue étape, la récupération d'un jour à l'autre) et VO₂max
    const endurance = mix([0.7, sc(m.slow, 34, 70)], [0.3, V(m.vo2, 65, 87)]);
    const climb = mix([0.5, S(m.ftpKg, 3.8, 6.6)], [0.25, S(m.p5Kg, 5.1, 7.8)], [0.15, S(m.p20Kg, 4.4, 7.1)], [0.1, V(m.vo2, 57, 87)]);
    // sprint : de la pointe (5 s) au sprint long (15, 30 s) et à la séquence d'approche (1 min : rouler vite pour se placer) ; la Pmax d'une seconde n'y compte plus
    const sprint = mix([0.22, Q(m.p5s, 258, 1615)], [0.28, Q(m.p15s, 300, 1302)], [0.20, Q(m.p30s, 321, 1052)], [0.15, Q(m.p1, 333, 824)], [0.05, Q(m.wPrime, 0, 30)], [0.10, sc(100 - m.slow, 5, 54)]);
    const flat = mix([0.4, S(m.wCdaRoad, 830, 1500)], [0.3, S(m.ftp, 140, 465)], [0.15, S(m.p20, 120, 505)], [0.15, endurance]);
    const tt = mix([0.55, S(m.wCdaTT, 1000, 2150)], [0.2, S(m.ftp, 140, 465)], [0.15, S(m.p20Kg, 4.4, 7.1)], [0.1, endurance]);
    const stage = mix([0.4, climb], [0.2, tt], [0.25, endurance], [0.15, S(m.ftpKg, 3.8, 6.6)]);
    const classic = mix([0.25, S(m.ftp, 140, 465)], [0.2, Q(m.pmax, 300, 1900)], [0.15, Q(m.wPrime, 0, 30)], [0.2, S(m.wCdaRoad, 830, 1500)], [0.2, endurance]);
    const punch = mix([0.25, S(m.p1Kg, 6.0, 10.7)], [0.35, S(m.p5Kg, 5.1, 7.8)], [0.2, Q(m.wPrimeKg, 0.05, 0.39)], [0.1, sc(m.buffer, 0.7, 1.29)], [0.1, Q(m.pmaxKg, 8, 24.4)]);
    const out = { climb, sprint, flat, tt, stage, classic, punch };
    // le peloton occupe le haut de l'échelle ; on étire de 30 à 98 vers 0 à 100 pour que les forces et les faiblesses d'un athlète se voient
    for (const id of Object.keys(out)) out[id] = Math.round(clamp((out[id] - STRETCH_LO) / (STRETCH_HI - STRETCH_LO), 0, 1) * 100);
    const best = CATEGORIES.map((c) => c.id).sort((x, y) => (out[y] - REF[y]) - (out[x] - REF[x]));
    return { scores: out, division: div, ratio: d.ratio, metrics: m, best, profile: CATEGORIES.find((c) => c.id === best[0]).label };
  }

  PYR.riderRadar = { CATEGORIES, DIVISIONS, REF, scores, division, metrics, sc };
})(globalThis.PYR = globalThis.PYR || {});
