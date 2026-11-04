/* Virtual Ride 3D Réaliste — position du soleil et de la lune (formules approchées, à quelques dixièmes de degré près), saison
   et durée du jour, d'après la latitude et la longitude du parcours, le jour de l'année et l'heure locale. Module pur (testé sous
   Node) : aucun accès à three.js ni au DOM.
   Repère du monde (celui de Bike3D) : x vers l'est, y vers le haut, z vers le sud (z = -nord). */

const DEG = Math.PI / 180;

/** Jour de l'année (1–366) d'une date JavaScript (heure locale). */
export function dayOfYear(d) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
}

/** Décalage horaire approché (h) d'un lieu : fuseau de sa longitude, l'Europe à l'heure de Paris, et l'heure d'été (fin mars – fin octobre
 *  dans l'hémisphère nord, l'inverse au sud, sauf près de l'équateur). */
export function utcOffset(lat, lon, doy) {
  let tz = Math.round(lon / 15);
  if (lat > 35 && lat < 72 && lon > -10 && lon < 25) tz = 1; // Europe de l'Ouest et centrale : UTC+1 (Paris, Madrid, Berlin…)
  if (lat > 35 && lat < 72 && lon > -10 && lon < -5.5) tz = 0; // Portugal
  const north = lat > 23, south = lat < -23;
  const dst = (north && doy >= 87 && doy < 301) || (south && (doy >= 277 || doy < 95));
  return tz + (dst ? 1 : 0);
}

/** Déclinaison du soleil (rad) et équation du temps (min) au jour doy. */
export function solarDeclination(doy) {
  const g = 2 * Math.PI / 365 * (doy - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  return { decl, eot };
}

/** Direction (vecteur unitaire du monde) d'un astre de déclinaison decl et d'angle horaire H (rad) vu à la latitude lat (°). */
export function dirFromHour(lat, decl, H) {
  const phi = lat * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // azimut compté depuis le nord, vers l'est
  const cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(phi)) / Math.max(1e-6, Math.cos(el) * Math.cos(phi));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (Math.sin(H) > 0) az = 2 * Math.PI - az;
  const c = Math.cos(el);
  return { x: c * Math.sin(az), y: Math.sin(el), z: -c * Math.cos(az), el, az };
}

/**
 * Soleil et lune à l'heure locale hour (0–24, heure des montres) du jour doy, à la latitude lat et longitude lon (°).
 * Renvoie {sun: {x, y, z, el, az}, moon: {x, y, z, el, az, phase (0 nouvelle lune … 0,5 pleine lune), light (part éclairée 0–1)}, solarNoon (h)}.
 */
export function skyPositions(lat, lon, doy, hour, tz) {
  const { decl, eot } = solarDeclination(doy);
  const off = Number.isFinite(tz) ? tz : utcOffset(lat, lon, doy);
  // temps solaire vrai : heure locale − fuseau + longitude / 15 + équation du temps
  const solar = hour - off + lon / 15 + eot / 60;
  const H = (solar - 12) * 15 * DEG;
  const sun = dirFromHour(lat, decl, H);
  // lune : âge approché de la lunaison (référence : nouvelle lune du 6 janvier 2000 à 18 h 14 UTC, jour 6,76 de l'année 2000)
  const synodic = 29.530588853;
  const days = 365.2422 * 26 + doy + (hour - off) / 24; // années depuis 2000 ramenées à un cycle quelconque : seule la phase compte
  const age = (((days - 6.76) % synodic) + synodic) % synodic;
  const phase = age / synodic;
  // la lune suit le soleil avec un retard d'angle horaire égal à son élongation ; sa déclinaison oscille de ±28° sur un mois
  const elong = phase * 2 * Math.PI;
  const mdecl = decl * Math.cos(elong) + 0.09 * Math.sin(elong * 1.07 + 0.7) + Math.asin(Math.sin(23.44 * DEG) * Math.sin(elong)) * (decl >= 0 ? -0.4 : 0.4);
  const moon = dirFromHour(lat, Math.max(-0.5, Math.min(0.5, mdecl)), H - elong);
  moon.phase = phase;
  moon.light = (1 - Math.cos(elong)) / 2;
  const solarNoon = 12 + off - lon / 15 - eot / 60;
  return { sun, moon, solarNoon };
}

/** Jour de l'année d'une saison du paysage de Bike3D (son ambiance) quand la date n'est pas connue. */
export function doyOfAmbiance(id) {
  return { printemps: 120, ete: 196, automne: 288, soir: 222, hiver: 25 }[id] || 172;
}

/**
 * Saison de la végétation (0–1) à un jour de l'année et une latitude : {green (feuillage vert), autumn (feuilles colorées), bare
 * (arbres nus), dry (herbe sèche), snowy (neige probable)}. Hémisphère sud : six mois de décalage.
 */
export function season(doy, lat) {
  const d = lat < 0 ? (doy + 182) % 365 : doy;
  const bell = (c, w) => { let x = Math.abs(d - c); x = Math.min(x, 365 - x); return Math.max(0, 1 - x / w); };
  const autumn = Math.min(1, bell(295, 32) * 1.4);
  const bare = Math.min(1, bell(15, 75) * 1.5);
  const dry = Math.min(1, bell(215, 45) * (Math.abs(lat) < 46 ? 1.4 : 0.9));
  const snowy = Math.min(1, bell(20, 55) * 1.3);
  const green = Math.max(0, 1 - autumn - bare);
  return { green, autumn, bare, dry, snowy };
}
