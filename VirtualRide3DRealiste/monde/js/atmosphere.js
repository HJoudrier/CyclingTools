/* Virtual Ride 3D Réaliste — atmosphère physique :
   - ciel : diffusion simple de Rayleigh (bleu du ciel) et de Mie (brume, halo du soleil), absorption de l'ozone, et une approximation
     de la diffusion multiple, intégrées par la carte graphique dans une petite table (direction → luminance) recalculée quand le soleil
     bouge ; le dôme du ciel la lit, avec le disque du soleil, la lune et ses phases, les étoiles, et une couche de nuages animée par le vent ;
   - lumière : le soleil (ou la lune la nuit) éclaire avec la couleur que lui laisse l'atmosphère (rouge au coucher), atténuée par les
     nuages ; l'éclairage ambiant vient d'une carte d'environnement calculée à partir de ce ciel (PMREM), avec le sol au-dessous ;
   - brouillard aérien (perspective atmosphérique) : sa couleur est celle du ciel à l'horizon dans la direction regardée (le post-traitement
     de engine.js l'applique d'après la profondeur), ombres des nuages au sol.
   Le temps (soleil, nuageux, pluie, orage, neige) change la couverture nuageuse, la brume et la lumière. */
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { skyPositions } from './astro.js';

const LUT_W = 192, LUT_H = 108;

/** Atmosphère (km) : rayon de la Terre et du haut de l'atmosphère, coefficients de diffusion. */
const ATMO_GLSL = /* glsl */`
const float Rg = 6360.0, Rt = 6460.0;
const vec3 bR = vec3(5.802, 13.558, 33.1) * 1e-3;
const vec3 bO = vec3(0.650, 1.881, 0.085) * 1e-3;
const float HR = 8.0, HM = 1.2;
uniform float uMie;   // densité de la brume (1 : temps clair)
vec2 raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
vec3 extinction(float h) {
  float r = exp(-h / HR), m = exp(-h / HM) * uMie, o = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  return bR * r + vec3(4.4e-3) * m + bO * o;
}
vec3 sunTransmittance(vec3 p, vec3 sd) {
  vec2 tt = raySphere(p, sd, Rt);
  vec2 tg = raySphere(p, sd, Rg);
  if (tg.x > 0.0) return vec3(0.0);
  float L = tt.y, dt = L / 8.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 8; i++) { vec3 q = p + sd * (float(i) + 0.5) * dt; od += extinction(length(q) - Rg) * dt; }
  return exp(-od);
}
float phaseR(float c) { return 3.0 / (16.0 * 3.14159265) * (1.0 + c * c); }
float phaseM(float c, float g) { float g2 = g * g; return 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
// luminance diffusée vers l'observateur (en p, regardant rd) par un soleil de direction sd et d'éclairement 1
vec3 scatter(vec3 ro, vec3 rd, vec3 sd, float maxT) {
  vec2 tt = raySphere(ro, rd, Rt);
  vec2 tg = raySphere(ro, rd, Rg);
  float L = tt.y;
  if (tg.x > 0.0) L = min(L, tg.x);
  L = min(L, maxT);
  const int N = 36;
  float c = dot(rd, sd), pr = phaseR(c), pm = phaseM(c, 0.78);
  vec3 T = vec3(1.0), sum = vec3(0.0);
  float t = 0.0;
  for (int i = 0; i < N; i++) {
    // pas plus fins près de l'observateur
    float t1 = L * pow(float(i + 1) / float(N), 1.6);
    float dt = t1 - t;
    vec3 p = ro + rd * (t + 0.5 * dt);
    float h = length(p) - Rg;
    float r = exp(-h / HR), m = exp(-h / HM) * uMie;
    vec3 ext = extinction(h);
    vec3 Ts = sunTransmittance(p, sd);
    vec3 sR = bR * r, sM = vec3(3.996e-3) * m;
    // diffusion multiple approchée : une part isotrope de la lumière déjà diffusée
    vec3 ms = (sR + sM) * (0.02 + 0.06 * Ts) * smoothstep(-0.25, 0.1, dot(normalize(p), sd));
    vec3 S = (sR * pr + sM * pm) * Ts + ms;
    vec3 Tstep = exp(-ext * dt);
    sum += T * (S - S * Tstep) / max(ext, vec3(1e-7));
    T *= Tstep;
    t = t1;
  }
  return sum;
}
`;

const LUT_FRAG = ATMO_GLSL + /* glsl */`
uniform vec3 uSun;
uniform float uAlt;
varying vec2 vUv;
void main() {
  float az = vUv.x * 6.28318530718;
  float v = vUv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * 1.5707963;
  vec3 rd = vec3(cos(el) * sin(az), sin(el), -cos(el) * cos(az));
  vec3 ro = vec3(0.0, Rg + max(0.005, uAlt), 0.0);
  gl_FragColor = vec4(scatter(ro, rd, uSun, 1e9), 1.0);
}
`;

/** Lecture de la table du ciel : direction → luminance (sans le facteur d'éclairement du soleil). */
export const SKY_LOOKUP = /* glsl */`
uniform sampler2D uSkyLut;
vec3 skyLut(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float v = sign(el) * sqrt(abs(el) / 1.5707963);
  float az = atan(d.x, -d.z);
  if (az < 0.0) az += 6.28318530718;
  return texture(uSkyLut, vec2(az / 6.28318530718, v * 0.5 + 0.5)).rgb;
}
`;

/** Couche nuageuse (m) : densité 0–1 au point (x, z) d'altitude de la couche, avec la couverture et le vent. */
export const CLOUDS_GLSL = NOISE + /* glsl */`
uniform float uCloudCover;   // 0 : ciel bleu, 1 : couvert
uniform vec2 uCloudOff;      // déplacement par le vent (m)
uniform float uCloudAlt;     // altitude de la base (m)
float cloudDensity(vec2 xz) {
  vec2 p = (xz + uCloudOff) / 2600.0;
  float n = vfbm(p, 5);
  float d = vfbm(p * 3.1 + 7.0, 3);
  float base = n * 0.75 + d * 0.25;
  float thr = mix(0.78, 0.18, uCloudCover);
  return smoothstep(thr, thr + mix(0.2, 0.35, uCloudCover), base);
}
`;

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const DOME_FRAG = ATMO_GLSL + SKY_LOOKUP + CLOUDS_GLSL + /* glsl */`
uniform vec3 uSun, uMoon, uSunColor, uMoonColor;
uniform float uSunE, uMoonE, uNight, uTime, uMoonPhase, uStorm, uFlash;
uniform vec3 uCam;
uniform vec3 uCloudLight, uCloudAmb;
varying vec3 vDir;
float starField(vec3 d) {
  vec3 p = d * 260.0;
  vec3 i = floor(p);
  float h = h13(i);
  if (h < 0.9965) return 0.0;
  vec3 c = i + 0.5 + (vec3(h13(i + 1.3), h13(i + 2.7), h13(i + 5.1)) - 0.5) * 0.6;
  float r = length(p - c);
  float tw = 0.75 + 0.25 * sin(uTime * (2.0 + 6.0 * h13(i + 9.0)) + h * 50.0);
  return smoothstep(0.16, 0.0, r) * pow((h - 0.9965) / 0.0035, 2.0) * tw;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 L = skyLut(d) * uSunE;
  // ciel de nuit : la lune éclaire un peu l'atmosphère, et un fond bleu nuit très sombre
  vec3 night = vec3(0.0006, 0.0011, 0.0024) * (0.4 + 0.6 * max(d.y, 0.0)) * uNight;
  L += night;
  float above = smoothstep(-0.02, 0.02, d.y);
  // soleil : disque assombri au bord
  float cs = dot(d, uSun);
  float sunR = 0.0047;
  if (cs > cos(sunR * 1.5)) {
    float x = acos(min(cs, 1.0)) / sunR;
    float limb = x < 1.0 ? 0.4 + 0.6 * sqrt(1.0 - x * x) : 0.0;
    L += uSunColor * uSunE * 2400.0 * limb * above;
  }
  // lune : disque éclairé selon sa phase (terminateur), cratères
  float cm = dot(d, uMoon);
  float moonR = 0.0049;
  if (cm > cos(moonR * 1.2) && uMoon.y > -0.05) {
    vec3 mu = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    vec3 mv = cross(mu, uMoon);
    vec2 q = vec2(dot(d, mu), dot(d, mv)) / moonR;
    float rr = dot(q, q);
    if (rr < 1.0) {
      vec3 n = vec3(q, sqrt(1.0 - rr));
      float ang = uMoonPhase * 6.28318530718;
      vec3 ls = normalize(vec3(-sin(ang), 0.0, -cos(ang)));
      float lit = smoothstep(-0.05, 0.08, dot(n, ls));
      float maria = 0.7 + 0.3 * vnoise(q * 3.0 + 4.0) - 0.2 * smoothstep(0.55, 0.7, vnoise(q * 2.0 + 1.0));
      L += uMoonColor * uMoonE * 600.0 * lit * maria * above + vec3(0.002, 0.0025, 0.003) * uNight;
    }
  }
  // étoiles, effacées par la lueur du ciel
  if (uNight > 0.01 && d.y > 0.0) L += vec3(0.8, 0.85, 1.0) * starField(d) * 0.06 * uNight * (1.0 - uCloudCover) * smoothstep(0.0, 0.15, d.y);
  // nuages
  if (d.y > 0.0 && uCloudCover > 0.001) {
    float t = (uCloudAlt - uCam.y) / max(d.y, 0.01);
    vec2 xz = uCam.xz + d.xz * t;
    float den = cloudDensity(xz);
    if (den > 0.001) {
      float toward = cloudDensity(xz + uSun.xz * 400.0);
      float thick = mix(1.0, 3.0, uCloudCover) * (0.6 + 0.4 * den);
      float light = exp(-toward * 2.2 * thick) * (0.55 + 0.45 * (1.0 - uStorm));
      float silver = phaseM(dot(d, uSun), 0.6) * 4.0;
      vec3 col = uCloudAmb * (0.55 + 0.45 * d.y) * (1.0 - 0.5 * uStorm) + uCloudLight * light * (0.35 + silver * 0.25);
      col *= mix(1.0, 0.45, uCloudCover * uCloudCover * uStorm);
      col += vec3(0.9, 0.92, 1.0) * uFlash * 6.0 * den;
      float a = 1.0 - exp(-den * mix(3.0, 9.0, uCloudCover));
      // au loin, les nuages se fondent dans le ciel (perspective atmosphérique)
      float fade = exp(-t / 38000.0) * smoothstep(0.0, 0.06, d.y);
      L = mix(L, col, a * fade);
    }
  }
  // sous un ciel couvert, la lumière diffuse est grise et uniforme
  L = mix(L, uCloudAmb * (0.7 + 0.3 * max(d.y, 0.0)), uCloudCover * uCloudCover * 0.85 * above);
  L += vec3(0.85, 0.9, 1.0) * uFlash * 2.0 * above;
  gl_FragColor = vec4(L, 1.0);
}
`;

/** Transmittance de l'atmosphère pour le soleil à l'élévation el (rad), calculée en JavaScript (couleur de la lumière directe). */
export function sunTransmittance(el, mie = 1) {
  const Rg = 6360, Rt = 6460, bR = [5.802e-3, 13.558e-3, 33.1e-3], bO = [0.65e-3, 1.881e-3, 0.085e-3];
  const ro = [0, Rg + 0.3, 0], rd = [Math.cos(el), Math.sin(el), 0];
  // intersection avec le sol : soleil couché
  const b = ro[1] * rd[1];
  const cg = Rg * 0 + (ro[1] * ro[1] - Rg * Rg);
  if (b < 0 && b * b - cg > 0) {
    // sous l'horizon géométrique : on prolonge doucement jusqu'à -1°
    if (el < -0.017) return [0, 0, 0];
  }
  const ct = ro[1] * ro[1] - Rt * Rt;
  const L = -b + Math.sqrt(Math.max(0, b * b - ct));
  const N = 48, dt = L / N;
  const od = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * dt;
    const x = ro[0] + rd[0] * t, y = ro[1] + rd[1] * t;
    const h = Math.max(0, Math.hypot(x, y) - Rg);
    const r = Math.exp(-h / 8), m = Math.exp(-h / 1.2) * mie, o = Math.max(0, 1 - Math.abs(h - 25) / 15);
    for (let k = 0; k < 3; k++) od[k] += (bR[k] * r + 4.4e-3 * m + bO[k] * o) * dt;
  }
  return od.map((v) => Math.exp(-v));
}

/** Temps qu'il fait : couverture nuageuse, brume, pluie (mm/h), orage, neige. */
const WEATHER = {
  soleil: { cover: 0.12, mie: 1.0, storm: 0 },
  nuageux: { cover: 0.62, mie: 1.6, storm: 0 },
  couvert: { cover: 0.9, mie: 2.4, storm: 0.25 },
  pluie: { cover: 0.97, mie: 3.6, storm: 0.55 },
  orage: { cover: 1.0, mie: 4.0, storm: 1 },
  neige: { cover: 0.97, mie: 4.5, storm: 0.35 },
};

export class Atmosphere {
  /** opts : {lat, lon, doy, hour, tz} */
  constructor(engine, opts) {
    this.engine = engine;
    this.renderer = engine.renderer;
    this.lat = opts.lat; this.lon = opts.lon; this.doy = opts.doy; this.hour = opts.hour; this.tz = opts.tz;
    this.time = 0;
    this.wind = new THREE.Vector2(3, 1);   // m/s (vers où souffle le vent : x est, y sud)
    this.cloudOff = new THREE.Vector2(Math.random() * 1e4, Math.random() * 1e4);
    this.state = 'soleil';
    this.cur = Object.assign({}, WEATHER.soleil);
    this.tgt = Object.assign({}, WEATHER.soleil);
    this.flash = 0; this.nextFlash = 8;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.lightColor = new THREE.Color(1, 1, 1);
    this.lightIntensity = 5;
    this.sunE = 6.0;          // éclairement du soleil (unités de la scène)
    this.envIntensity = 0.75; // part de l'éclairage du ciel (carte d'environnement)
    this.night = 0;

    // table du ciel
    this.lut = new THREE.WebGLRenderTarget(LUT_W, LUT_H, { type: THREE.HalfFloatType, depthBuffer: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uAlt: { value: 0.3 }, uMie: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false,
    });
    this.lutScene = new THREE.Scene();
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat); q.frustumCulled = false;
    this.lutScene.add(q);
    this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._lutKey = '';

    // uniformes partagés par le dôme, le brouillard, les matériaux (ombres des nuages, pluie…)
    this.u = {
      uSkyLut: { value: this.lut.texture },
      uSun: { value: this.sunDir }, uMoon: { value: this.moonDir },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uMoonColor: { value: new THREE.Color(0.75, 0.82, 1.0) },
      uSunE: { value: this.sunE }, uMoonE: { value: 0 }, uNight: { value: 0 }, uTime: { value: 0 }, uMoonPhase: { value: 0.5 },
      uMie: { value: 1 }, uCloudCover: { value: 0.1 }, uCloudOff: { value: this.cloudOff }, uCloudAlt: { value: 2200 },
      uStorm: { value: 0 }, uFlash: { value: 0 }, uCam: { value: new THREE.Vector3() },
      uCloudLight: { value: new THREE.Color(1, 1, 1) }, uCloudAmb: { value: new THREE.Color(0.5, 0.6, 0.8) },
      uLightDir: { value: this.lightDir }, uLightColor: { value: new THREE.Color(1, 1, 1) },
      uFogDensity: { value: 0.00006 }, uFogHeight: { value: 900 }, uWet: { value: 0 }, uSnow: { value: 0 }, uRain: { value: 0 },
      uWind: { value: new THREE.Vector3(1, 0, 0.3) },
    };

    // dôme du ciel (sans écriture de profondeur : le brouillard de la scène ne s'y applique pas)
    const domeMat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.dome.onBeforeRender = (r, s, cam) => { this.dome.position.copy(cam.position); };

    // scène de la carte d'environnement : le ciel et un sol uniforme dessous
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), domeMat);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(400, 32), new THREE.MeshBasicMaterial({ color: 0x223318 }));
    this.envGround.rotation.x = -Math.PI / 2;
    this.envGround.position.y = -2;
    this.envScene.add(envDome, this.envGround);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = null;
    this._envT = 0;
    this._envKey = '';
    this.groundAlbedo = new THREE.Color(0.2, 0.19, 0.13);   // lumière renvoyée par le sol (route, prés, champs)
  }

  /** Heure locale (0–24) et jour de l'année. */
  setTime(hour, doy) {
    if (Number.isFinite(hour)) this.hour = ((hour % 24) + 24) % 24;
    if (Number.isFinite(doy)) this.doy = doy;
  }

  /** Temps qu'il fait (clé de WEATHER) ; transition douce, sauf now. */
  setWeather(state, now) {
    if (!WEATHER[state]) state = 'soleil';
    this.state = state;
    this.tgt = Object.assign({}, WEATHER[state]);
    if (now) Object.assign(this.cur, this.tgt);
  }

  /** Vent (m/s) d'où il vient (wd, °) : déplacement des nuages, herbe, pluie. */
  setWind(ws, wd) {
    const a = (wd + 180) * Math.PI / 180;    // vers où il souffle
    this.wind.set(Math.sin(a) * ws, -Math.cos(a) * ws);
    const k = Math.min(1.6, ws / 12);
    this.u.uWind.value.set(this.wind.x / Math.max(ws, 0.01), k, this.wind.y / Math.max(ws, 0.01));
  }

  update(dt, camera) {
    this.time += dt;
    const u = this.u;
    u.uTime.value = this.time;
    u.uCam.value.copy(camera.position);
    // transitions du temps (≈ 1 min)
    const k = 1 - Math.exp(-dt / 25);
    for (const key of ['cover', 'mie', 'storm']) this.cur[key] += (this.tgt[key] - this.cur[key]) * k;
    const c = this.cur;
    u.uCloudCover.value = c.cover;
    u.uMie.value = c.mie;
    u.uStorm.value = c.storm;
    this.cloudOff.x += this.wind.x * dt * 1.6;
    this.cloudOff.y += this.wind.y * dt * 1.6;
    u.uCloudAlt.value = Math.max(camera.position.y + 900, mix(2400, 1300, c.cover));
    // soleil et lune
    const P = skyPositions(this.lat, this.lon, this.doy, this.hour, this.tz);
    this.sunDir.set(P.sun.x, P.sun.y, P.sun.z).normalize();
    this.moonDir.set(P.moon.x, P.moon.y, P.moon.z).normalize();
    u.uMoonPhase.value = P.moon.phase;
    const T = sunTransmittance(P.sun.el, c.mie);
    this.sunColor.setRGB(T[0], T[1], T[2]);
    u.uSunColor.value.copy(this.sunColor);
    const sunUp = smooth(-0.1, 0.08, P.sun.y);
    this.night = 1 - smooth(-0.21, -0.02, P.sun.y);
    u.uNight.value = this.night;
    const moonLight = P.moon.light * smooth(-0.05, 0.1, P.moon.y);
    u.uMoonE.value = 0.012 * moonLight;
    // éclairage direct : le soleil, ou la lune quand il fait nuit
    const cloudBlock = 1 - 0.88 * Math.pow(c.cover, 1.6);
    if (P.sun.y > -0.03 || moonLight < 0.02) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.02) this.lightDir.y = 0.02;
      this.lightDir.normalize();
      this.lightColor.copy(this.sunColor);
      this.lightIntensity = this.sunE * 1.25 * sunUp * cloudBlock;
    } else {
      this.lightDir.copy(this.moonDir);
      this.lightColor.setRGB(0.62, 0.72, 1.0);
      this.lightIntensity = 0.035 * moonLight * cloudBlock;
    }
    u.uLightColor.value.copy(this.lightColor).multiplyScalar(this.lightIntensity);
    // nuages : lumière et ambiance
    u.uCloudLight.value.copy(this.sunColor).multiplyScalar(this.sunE * 0.35 * sunUp).add(new THREE.Color(0.02, 0.025, 0.04).multiplyScalar(moonLight));
    const zen = this.sunE * (0.035 + 0.05 * Math.max(0, P.sun.y)) * smooth(-0.15, 0.05, P.sun.y);
    u.uCloudAmb.value.setRGB(zen * 0.85 + 0.0012, zen * 0.9 + 0.0015, zen * 1.0 + 0.0022);
    // orage : éclairs
    if (c.storm > 0.7) {
      this.nextFlash -= dt;
      if (this.nextFlash < 0) { this.flash = 1; this.nextFlash = 4 + Math.random() * 14; this.thunder = 1 + Math.random() * 3; }
    }
    this.flash = Math.max(0, this.flash - dt * 5) * (Math.random() < 0.85 ? 1 : 0.3);
    u.uFlash.value = this.flash;
    // brouillard : plus dense sous la pluie et la neige, au lever et au coucher (brume)
    const hazeDawn = 1 + 1.2 * (1 - smooth(0.05, 0.35, Math.abs(P.sun.y)));
    u.uFogDensity.value = 0.000035 * c.mie * hazeDawn + 0.00025 * c.storm * c.cover;
    // table du ciel recalculée quand le soleil a bougé
    const lightForSky = P.sun.y > -0.12 || moonLight < 0.02 ? this.sunDir : this.moonDir;
    const scaleSky = lightForSky === this.sunDir ? this.sunE : u.uMoonE.value * 6;
    u.uSunE.value = scaleSky;
    const key = [lightForSky.x, lightForSky.y, lightForSky.z].map((v) => v.toFixed(3)).join() + '|' + c.mie.toFixed(2) + '|' + Math.round(camera.position.y / 200);
    if (key !== this._lutKey) {
      this._lutKey = key;
      this.lutMat.uniforms.uSun.value.copy(lightForSky);
      this.lutMat.uniforms.uMie.value = c.mie;
      this.lutMat.uniforms.uAlt.value = Math.max(0.01, camera.position.y / 1000);
      const prev = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.lut);
      this.renderer.render(this.lutScene, this.lutCam);
      this.renderer.setRenderTarget(prev);
    }
    // carte d'environnement (éclairage ambiant) : toutes les deux secondes au plus, quand le ciel a changé
    this._envT -= dt;
    const envKey = key + '|' + c.cover.toFixed(2) + '|' + c.storm.toFixed(2) + '|' + (this.flash > 0.3 ? 1 : 0);
    if (this._envT <= 0 && envKey !== this._envKey) {
      this._envT = 2;
      this._envKey = envKey;
      this.updateEnv();
    }
  }

  /** Recalcule la carte d'environnement (PMREM) : ciel au-dessus, sol éclairé au-dessous. */
  updateEnv() {
    const irr = this.lightIntensity * Math.max(0, this.lightDir.y) + 0.25 * this.u.uSunE.value * 0.12;
    this.envGround.material.color.copy(this.groundAlbedo).multiplyScalar(irr / Math.PI).multiply(new THREE.Color().copy(this.lightColor).lerp(new THREE.Color(1, 1, 1), 0.5));
    const saveCam = this.u.uCam.value.clone();
    this.u.uCam.value.set(0, 0, 0);
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.5, 600, { size: 128 });
    this.u.uCam.value.copy(saveCam);
    this.engine.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  /** Luminance approchée du ciel au zénith (pour l'exposition et les matériaux non éclairés). */
  skyLevel() { return this.u.uSunE.value * 0.06 + this.night * 0.0005; }
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function mix(a, b, t) { return a + (b - a) * t; }

export { WEATHER, ATMO_GLSL };
