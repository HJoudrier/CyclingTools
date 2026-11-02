/* author : Hugo Joudrier-Faure */
/* PaceYourRide — le profil d'un athlète en sept « spécialités », pour un graphique en toile d'araignée (accueil) : grimpeur, sprinteur, rouleur,
 * contre-la-montre, courses par étapes, classiques, puncheur. Chaque score (0 à 100) est calculé à partir de ce que le modèle sait de l'athlète :
 *   - physiologie : courbe de puissance record (FTP, puissance sur 1, 5, 20 min, Pmax), puissance critique, W′ ;
 *   - métabolisme (metabo.js, carte athlète) : VO₂max, proportion de fibres lentes, oxydation des lipides, pouvoir tampon ;
 *   - aérodynamique : le CdA du corps (taille, poids) en position route et en position contre-la-montre, d'où les watts par m² de CdA ;
 *   - poids : les watts par kilo (la montée) et la puissance absolue (le plat, le vent).
 * L'échelle est celle du peloton professionnel : 100 = le meilleur du World Tour dans cette spécialité, 0 = un cycliste de loisir. Les scores sont
 * des repères relatifs (une spécialité n'exclut pas les autres) : un grimpeur léger a un faible score de rouleur, un rouleur lourd un faible score de
 * grimpeur, un leader de grand tour est bon presque partout.
 *   const r = PYR.riderRadar.scores(rider);   // { scores: { climb, sprint, flat, tt, stage, classic, punch }, metrics, best: [ids triés], profile }
 * Pure (testée sous Node) : aucune interface. */
(function (PYR) {
  'use strict';

  /** Spécialités, dans l'ordre des branches du graphique (en partant du haut, dans le sens des aiguilles d'une montre). */
  const CATEGORIES = [
    { id: 'climb', label: 'Grimpeur', short: 'Grimpeur', info: 'Watts par kilo à 5 min, 20 min et 1 h, VO₂max.' },
    { id: 'sprint', label: 'Sprinteur', short: 'Sprint', info: 'Pmax, puissance sur quelques secondes, W′, fibres rapides.' },
    { id: 'flat', label: 'Rouleur', short: 'Rouleur', info: 'Puissance absolue et watts par m² de CdA en position route, endurance.' },
    { id: 'tt', label: 'Contre-la-montre', short: 'CLM', info: 'Watts par m² de CdA en position chrono, puissance à 20–60 min.' },
    { id: 'stage', label: 'Courses par étapes', short: 'Étapes', info: 'Montée, chrono et récupération : fibres lentes, lipides, VO₂max.' },
    { id: 'classic', label: 'Classiques', short: 'Classiques', info: 'Puissance absolue, Pmax, W′, aérodynamisme, endurance.' },
    { id: 'punch', label: 'Puncheur', short: 'Puncheur', info: 'Efforts de 1 à 5 min : puissance par kilo, W′, pouvoir tampon.' },
  ];

  const STRETCH_LO = 32, STRETCH_HI = 98;
  /** Score moyen du peloton World Tour (pros.js) dans chaque spécialité : la spécialité d'un athlète est celle où il s'en détache le plus. */
  const REF = { climb: 70, sprint: 68, flat: 77, tt: 78, stage: 71, classic: 72, punch: 73 };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  /** x ramené de [lo, hi] à [0, 100]. */
  // (les bornes données plus bas vont du 5ᵉ centile du peloton pro, moins une marge, au 95ᵉ ; EXT prolonge l'échelle vers le bas pour que le profil d'un
  // cycliste amateur, loin du peloton, reste lisible au lieu de tomber à 0 partout)
  const EXT = 0.3;
  const sc = (x, lo, hi) => 100 * clamp((x - (lo - EXT * (hi - lo))) / ((hi - lo) * (1 + EXT)), 0, 1);
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
      p5Kg: a.mmp(300) / kg, p1Kg: a.mmp(60) / kg, p15s: a.mmp(15), p5s: a.mmp(5),
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
   * Scores de l'athlète (0–100) dans chaque spécialité. rider : le profil au format de la bibliothèque (poids, taille, FTP, records, carte physio…).
   * Renvoie { scores, metrics, best (identifiants triés de la spécialité qui se détache le plus de la moyenne du peloton à la moins marquée), profile (libellé de la première) }.
   */
  function scores(rider) {
    const m = metrics(rider);
    // échelles : de la valeur d'un cycliste de loisir bien entraîné (0) à celle du meilleur du World Tour (≈ 100) ; le 5ᵉ centile du peloton pro est vers 50
    // endurance : fibres lentes (la fatigue d'une longue étape, la récupération d'un jour à l'autre) et VO₂max
    const endurance = mix([0.7, sc(m.slow, 34, 70)], [0.3, sc(m.vo2, 65, 87)]);
    const climb = mix([0.5, sc(m.ftpKg, 3.8, 6.6)], [0.25, sc(m.p5Kg, 5.1, 7.8)], [0.15, sc(m.p20Kg, 4.4, 7.1)], [0.1, sc(m.vo2, 57, 87)]);
    const sprint = mix([0.4, sc(m.pmax, 300, 1900)], [0.2, sc(m.pmaxKg, 8, 24.4)], [0.2, sc(m.p15s, 250, 1300)], [0.1, sc(m.wPrime, 0, 30)], [0.1, sc(100 - m.slow, 5, 54)]);
    const flat = mix([0.4, sc(m.wCdaRoad, 830, 1500)], [0.3, sc(m.ftp, 140, 465)], [0.15, sc(m.p20, 120, 505)], [0.15, endurance]);
    const tt = mix([0.55, sc(m.wCdaTT, 1000, 2150)], [0.2, sc(m.ftp, 140, 465)], [0.15, sc(m.p20Kg, 4.4, 7.1)], [0.1, endurance]);
    const stage = mix([0.4, climb], [0.2, tt], [0.25, endurance], [0.15, sc(m.ftpKg, 3.8, 6.6)]);
    const classic = mix([0.25, sc(m.ftp, 140, 465)], [0.2, sc(m.pmax, 300, 1900)], [0.15, sc(m.wPrime, 0, 30)], [0.2, sc(m.wCdaRoad, 830, 1500)], [0.2, endurance]);
    const punch = mix([0.25, sc(m.p1Kg, 6.0, 10.7)], [0.35, sc(m.p5Kg, 5.1, 7.8)], [0.2, sc(m.wPrimeKg, 0.05, 0.39)], [0.1, sc(m.buffer, 0.7, 1.29)], [0.1, sc(m.pmaxKg, 8, 24.4)]);
    const out = { climb, sprint, flat, tt, stage, classic, punch };
    // le peloton pro occupe le haut de l'échelle ci-dessus ; on étire de 32 à 98 vers 0 à 100 pour que les forces et les faiblesses d'un athlète se voient
    for (const k of Object.keys(out)) out[k] = Math.round(clamp((out[k] - STRETCH_LO) / (STRETCH_HI - STRETCH_LO), 0, 1) * 100);
    const best = CATEGORIES.map((c) => c.id).sort((x, y) => (out[y] - REF[y]) - (out[x] - REF[x]));
    return { scores: out, metrics: m, best, profile: CATEGORIES.find((c) => c.id === best[0]).label };
  }

  PYR.riderRadar = { CATEGORIES, REF, scores, metrics, sc };
})(globalThis.PYR = globalThis.PYR || {});
