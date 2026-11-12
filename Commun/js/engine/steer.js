/* author : Hugo Joudrier-Faure */
/* PaceYourRide — trajectoire manuelle (Course 3D) : le joueur pilote la position latérale de son coureur comme dans un jeu de course.
 * Modèle « arcade vélo » en coordonnées de la route (y : écart au milieu de la chaussée, du signe de course.kappa à l'intérieur d'un
 * virage, comme peloton.pathFactor) :
 *   - la commande u (−1 à 1) demande une vitesse latérale vyCmd = u · VY_MAN(v), atteinte avec un retard τ ;
 *   - sans commande, le coureur suit la route ; mais en virage, l'accélération latérale v²·κ (courbure à sa position, plus serrée à la
 *     corde) prend sur l'adhérence : il ne reste pour se déplacer de côté que ce qu'elle laisse, et au-delà de la limite le coureur est
 *     poussé vers l'extérieur, sans pouvoir corriger. Pris trop vite, un virage fait sortir de la route :
 *     il faut freiner (le freinage automatique est coupé en trajectoire manuelle, sim.step avec cond.manual) ;
 *   - bord de la chaussée (edgeOf), puis bas-côté (VERGE) : on y roule plus lentement (roulement ×3) et on risque la chute, d'autant plus
 *     qu'on va vite (vergeRisk) ; au-delà, c'est la sortie de route (exitRisk). Traverser un coureur tombé : pileupRisk.
 * Les entrées (touches, manette, gyroscope, contrôleurs VR) sont mises en forme ici (axis, keyRamp, tiltAxis) ; elles sont lues dans
 * Commun/js/jeu/steer-input.js.
 * Aide à la trajectoire (guide) : sur les 80 m à venir, la corde (lissée, contre le bord intérieur dans les virages serrés) et la vitesse
 * conseillée (la limite d'adhérence à la corde, avec le freinage nécessaire en amont) ; la vue 3D la dessine en chevrons sur la route.
 * Sans DOM : testé dans tests/steer.test.js. */
(function (PYR) {
  'use strict';

  const TAU = 0.3;          // s : temps de réponse de la vitesse latérale
  const VY_MAX = 1.8;       // m/s : vitesse latérale maximale demandée (à partir de 6 m/s)
  const VY_PER_V = 0.3;     // … et au plus 0,3 × la vitesse (à l'arrêt, on ne se déplace pas de côté)
  const GRIP_K = 1.5;       // adhérence = 1,5 × l'accélération latérale du freinage automatique (course.aLat) : un joueur adroit passe plus vite
  const A_LAT = 4.4;        // m/s² : accélération latérale du jeu quand le parcours n'en donne pas (sim-inputs.js, CORNERING)
  const X_MAX = 0.6;        // borne de y·κ dans la courbure à la position (on ne divise jamais par presque zéro)
  const VERGE = 1.5;        // m : largeur du bas-côté au-delà de la chaussée
  const HALF_3D = 3;        // m : demi-largeur de la plateforme de route de la vue 3D (landscape.js, roadHalf)
  const SUB_DT = 0.05;      // s : sous-pas d'intégration
  // aide à la trajectoire
  const GUIDE_LEN = 80;     // m : longueur du guide devant le coureur
  const GUIDE_STEP = 4;     // m : un point (un chevron) tous les 4 m
  const GUIDE_EXTRA = 150;  // m : on regarde aussi les virages au-delà, pour freiner à temps
  const LINE_R0 = 300, LINE_R1 = 90; // m : rayon au-delà duquel on ne prend pas la corde, en deçà duquel on la prend à fond (peloton.js)
  const LINE_EDGE = 0.6;    // m : la corde passe à cette distance du bord intérieur
  const LINE_SMOOTH = 15;   // m : la courbure est moyennée sur ± 15 m (on entre et on sort de la corde progressivement)
  const GUIDE_SAFE = 0.95;  // vitesse conseillée : 95 % de la limite d'adhérence
  const V_FREE = 30;        // m/s : vitesse conseillée sans virage (pas de limite)
  const CORNER_V = 18;      // m/s : un virage dont la limite est sous 65 km/h est annoncé (« Virage 32 km/h »)

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const kmh = (v) => v * 3.6;

  /** Vitesse latérale maximale (m/s) à la vitesse v (m/s). */
  const vyMax = (v) => Math.min(VY_MAX, VY_PER_V * Math.max(0, v));

  /** Demi-largeur de la chaussée (m) à la distance s, bornée à maxHalf (Course 3D : la plateforme de la vue fait 6 m). */
  function edgeOf(course, s, maxHalf) {
    const cap = maxHalf > 0 ? maxHalf : Infinity;
    if (!course || !course.width) return Math.min(3, cap);
    let i = (s / course.step) | 0;
    if (i < 0) i = 0; else if (i >= course.n) i = course.n - 1;
    return Math.min(Math.max(0.6, course.width[i] / 2), cap);
  }

  /** Courbure (1/m) du tracé à la distance s. */
  function kappaAt(course, s) {
    if (!course || !course.kappa) return 0;
    let i = (s / course.step) | 0;
    if (i < 0) i = 0; else if (i >= course.n) i = course.n - 1;
    return course.kappa[i] || 0;
  }

  /** Adhérence latérale (m/s²) : celle du parcours (aLat du freinage automatique) × GRIP_K, moins sur route mouillée (cond.brakeK). */
  function gripOf(course, cond) {
    const a = course && course.aLat > 0 ? course.aLat : A_LAT;
    const k = cond && cond.brakeK > 0 ? cond.brakeK : 1;
    return GRIP_K * a * k;
  }

  /** État latéral d'un coureur piloté à la main (champs ajoutés à r.lat) : vitesse latérale, et dérive du moment (pour le HUD). */
  function init(L) {
    L.vy = 0;
    L.drift = 0;
    return L;
  }

  /**
   * Avance la trajectoire de dt secondes (simulées). L : r.lat (y, vy) ; v : vitesse (m/s) ; kappa : courbure du tracé (1/m) ;
   * u : commande (−1 à 1, vers les y positifs) ; grip : adhérence (m/s²). Sous-pas de SUB_DT au plus. Renvoie y.
   */
  function step(L, dt, v, kappa, u, grip) {
    if (!(dt > 0)) return L.y;
    if (!Number.isFinite(L.vy)) init(L);
    const n = Math.max(1, Math.ceil(dt / SUB_DT)), h = dt / n;
    const cmd = clamp(Number(u) || 0, -1, 1) * vyMax(v), g = grip > 0 ? grip : GRIP_K * A_LAT;
    let drift = 0;
    for (let k = 0; k < n; k++) {
      // courbure à la position : plus serrée à la corde (y du signe de κ), plus douce à l'extérieur
      const yk = clamp(L.y * kappa, -X_MAX, X_MAX);
      const ky = kappa / (1 - yk);
      const need = v * v * Math.abs(ky);
      // l'adhérence sert d'abord à suivre la route ; il ne reste pour se déplacer de côté que ce qu'elle laisse (rien à la limite)
      const avail = need < g ? g - need : 0;
      const aCmd = clamp((cmd - L.vy) / TAU, -avail, avail);
      drift = need > g ? -Math.sign(kappa) * (need - g) : 0;
      L.vy += (aCmd + drift) * h;
      L.y += L.vy * h;
    }
    L.drift = drift;
    return L.y;
  }

  /** Corde (m, du signe de κ à l'intérieur) à la distance s : nulle en ligne droite, contre le bord intérieur (moins LINE_EDGE) dans un virage serré. */
  function lineAt(course, s, maxHalf) {
    let k = 0, n = 0;
    for (let e = -LINE_SMOOTH; e <= LINE_SMOOTH; e += 3) { k += kappaAt(course, s + e); n++; }
    k /= n;
    const a0 = 1 / LINE_R0, a1 = 1 / LINE_R1, t = clamp((Math.abs(k) - a0) / (a1 - a0), 0, 1);
    return Math.sign(k) * t * t * (3 - 2 * t) * Math.max(0, edgeOf(course, s, maxHalf) - LINE_EDGE);
  }

  /**
   * Aide à la trajectoire depuis la distance s0 : {pts : [{d (m devant), s, y (corde), v (vitesse conseillée, m/s)}], corner : {d, v} | null}.
   * La vitesse conseillée est la limite d'adhérence du virage à la corde (v² · κ à la position ≤ gripOf), réduite du freinage
   * (course.aBrake, moins sur route mouillée) pour les virages plus loin ; corner : le virage le plus lent du guide, s'il est sous 65 km/h.
   * o : {cond (conditions : brakeK), maxHalf (demi-largeur bornée, Course 3D), len, step}.
   */
  function guide(course, s0, o) {
    o = o || {};
    const L = course && course.length > 0 ? course.length : 0;
    if (!L) return { pts: [], corner: null };
    const len = o.len > 0 ? o.len : GUIDE_LEN, st = o.step > 0 ? o.step : GUIDE_STEP;
    const g = gripOf(course, o.cond), bk = o.cond && o.cond.brakeK > 0 ? o.cond.brakeK : 1;
    const aB = (course.aBrake > 0 ? course.aBrake : 3.5) * bk;
    const h = Math.max(2, course.step || 5), n = Math.ceil((len + GUIDE_EXTRA) / h) + 2;
    const raw = new Float64Array(n), vc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.min(L, s0 + i * h), k = kappaAt(course, s), x = clamp(lineAt(course, s, o.maxHalf) * k, -X_MAX, X_MAX);
      raw[i] = Math.abs(k) > 1e-5 ? Math.min(V_FREE, GUIDE_SAFE * Math.sqrt(g * (1 - x) / Math.abs(k))) : V_FREE;
      vc[i] = raw[i];
    }
    for (let i = n - 2; i >= 0; i--) vc[i] = Math.min(vc[i], Math.sqrt(vc[i + 1] * vc[i + 1] + 2 * aB * h));
    const at = (d) => { const f = d / h, i = Math.min(n - 2, Math.floor(f)); return vc[i] + (vc[i + 1] - vc[i]) * (f - i); };
    const pts = [];
    for (let d = st; d <= len + 1e-6 && s0 + d <= L; d += st) pts.push({ d, s: s0 + d, y: lineAt(course, s0 + d, o.maxHalf), v: at(d) });
    let corner = null;
    for (let i = 0; i * h <= len; i++) if (raw[i] < CORNER_V && (!corner || raw[i] < corner.v)) corner = { d: i * h, v: raw[i] };
    return { pts, corner };
  }

  /** Où est le coureur : 'road' (sur la chaussée), 'verge' (sur le bas-côté) ou 'out' (hors de la route). */
  function zone(y, edge) {
    const a = Math.abs(y);
    return a <= edge ? 'road' : a <= edge + VERGE ? 'verge' : 'out';
  }

  /** Probabilité de chute pendant une seconde sur le bas-côté, à la vitesse v (m/s) : ≈ 1 % à 20 km/h, ≈ 25 % à 40 km/h. */
  function vergeRisk(v) {
    const x = (kmh(v) - 12) / 28;
    return x <= 0 ? 0 : clamp(0.25 * Math.pow(x, 2.2), 0, 0.6);
  }

  /** Probabilité de chute en sortant complètement de la route à la vitesse v (m/s) : rare à 15 km/h, presque sûre à 50 km/h. */
  function exitRisk(v) {
    const x = (kmh(v) - 10) / 38;
    return clamp(x > 0 ? Math.pow(x, 1.5) : 0, 0.03, 0.97);
  }

  /** Probabilité de chute en roulant sur un coureur tombé à la vitesse v (m/s). */
  function pileupRisk(v) {
    return kmh(v) < 8 ? 0.15 : kmh(v) < 15 ? 0.45 : 0.8;
  }

  /* ---------- mise en forme des entrées ---------- */

  /** Axe analogique (stick, gâchette) : zone morte, puis courbe douce (précis autour du centre). */
  function axis(x, dead) {
    const d = dead >= 0 ? dead : 0.12;
    const a = Math.abs(Number(x) || 0);
    if (a <= d) return 0;
    const t = Math.min(1, (a - d) / (1 - d));
    return Math.sign(x) * (0.35 * t + 0.65 * t * t);
  }

  /** Touches : la commande u monte vers dir (−1, 0 ou 1) à 4/s en appui, revient à 0 à 6/s au relâchement. */
  function keyRamp(u, dir, dt) {
    const rate = dir ? 4 : 6, target = dir || 0;
    const d = target - u, m = rate * Math.max(0, dt);
    return Math.abs(d) <= m ? target : u + Math.sign(d) * m;
  }

  /** Gyroscope : inclinaison (°, celle de tilt.offset) → commande ; zone morte de 3°, plein braquage à 22°. */
  function tiltAxis(deg) {
    const a = Math.abs(Number(deg) || 0);
    if (a <= 3) return 0;
    return Math.sign(deg) * Math.min(1, (a - 3) / 19);
  }

  PYR.steer = { TAU, VY_MAX, GRIP_K, VERGE, HALF_3D, GUIDE_LEN, GUIDE_STEP, V_FREE, vyMax, edgeOf, kappaAt, gripOf, lineAt, guide, init, step, zone, vergeRisk, exitRisk, pileupRisk, axis, keyRamp, tiltAxis };
})(globalThis.PYR = globalThis.PYR || {});
