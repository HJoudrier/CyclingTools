/* Virtual Ride 3D Réaliste — moteur de rendu : WebGL 2, rendu HDR (demi-flottants) avec antialiasing multi-échantillons, ombres en
   cascade (CSM : nettes près du coureur, jusqu'à un kilomètre et plus), puis le post-traitement :
     1. occlusion ambiante (GTAO, d'après la profondeur) ;
     2. composition : occlusion, perspective atmosphérique (brouillard de hauteur coloré par le ciel dans la direction regardée, halo du
        soleil), ombres des nuages qui passent au sol ;
     3. halo lumineux (bloom) des zones très claires (soleil, reflets, phares) ;
     4. exposition automatique (adaptation de l'œil : sous-bois, nuit, plein soleil), courbe de tons AgX, étalonnage (contraste,
        saturation, balance des blancs), vignettage, léger grain, puis sortie sRGB.
   Qualités : moyenne, haute (défaut), ultra ; la résolution s'adapte pour tenir 60 images par seconde (mode auto). */
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { SKY_LOOKUP, CLOUDS_GLSL } from './atmosphere.js';

export const QUALITY = {
  moyenne: { label: 'Moyenne', msaa: 2, shadow: 2048, cascades: 3, shadowFar: 450, ao: true, aoHalf: true, bloom: true, maxDpr: 1, grass: 0.55, treeNear: 65, impostorFar: 1800, terrain: [300, 1200, 5000], tex: 1024, people: 0.5 },
  haute: { label: 'Haute', msaa: 4, shadow: 2048, cascades: 4, shadowFar: 800, ao: true, aoHalf: true, bloom: true, maxDpr: 1.25, grass: 1, treeNear: 95, impostorFar: 3000, terrain: [420, 1700, 7500], tex: 1024, people: 1 },
  ultra: { label: 'Ultra', msaa: 4, shadow: 4096, cascades: 4, shadowFar: 1300, ao: true, aoHalf: false, bloom: true, maxDpr: 2, grass: 1.7, treeNear: 140, impostorFar: 4500, terrain: [520, 2200, 10000], tex: 2048, people: 1.4 },
};

const FS_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const COMPOSITE_FRAG = SKY_LOOKUP + CLOUDS_GLSL + /* glsl */`
uniform sampler2D tColor, tDepth, tAO, tAdapt;
uniform float uExpComp, uMinExp, uMaxExp, uManualExp;
uniform mat4 uInvProj, uCamWorld;
uniform vec3 uCamPos, uSun, uLightDir;
uniform float uSunE, uFogDensity, uFogHeight, uAOOn, uNear, uFar, uRain, uNight, uDebug;
uniform vec3 uSunColor, uLightColor;
varying vec2 vUv;
float phaseHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main() {
  vec4 col = texture2D(tColor, vUv);
  float z = texture2D(tDepth, vUv).x;
  vec3 c = col.rgb;
  if (z < 0.999999) {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc; vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 ray = wp - uCamPos;
    float dist = length(ray);
    vec3 rd = ray / dist;
    // occlusion ambiante, atténuée au loin
    if (uAOOn > 0.5) {
      float ao = texture2D(tAO, vUv).r;
      c *= mix(1.0, ao, 0.85 * (1.0 - smoothstep(150.0, 600.0, dist)));
    }
    // ombre des nuages : la couche nuageuse au-dessus du point, dans la direction du soleil
    if (uCloudCover > 0.02 && uLightDir.y > 0.02) {
      float t = (uCloudAlt - wp.y) / uLightDir.y;
      float d = cloudDensity(wp.xz + uLightDir.xz * t);
      float k = smoothstep(0.02, 0.4, uCloudCover) * (1.0 - smoothstep(0.75, 1.0, uCloudCover));
      c *= 1.0 - 0.62 * d * k;
    }
    // brouillard de hauteur : épaisseur optique intégrée entre la caméra et le point (densité en exp(-y / H))
    float H = uFogHeight;
    float y0 = uCamPos.y, dy = rd.y * dist;
    float base = uFogDensity * exp(-max(y0, -200.0) / H);
    float od = abs(dy) > 0.01 ? base * H * (1.0 - exp(-dy / H)) / (dy / dist) : base * dist;
    od = max(od, 0.0);
    float T = exp(-od);
    vec3 fd = normalize(vec3(rd.x, max(rd.y, 0.015), rd.z));
    vec3 inscatter = skyLut(fd) * uSunE;
    // halo du soleil dans la brume et la pluie
    inscatter += uLightColor * phaseHG(dot(rd, uLightDir), 0.72) * 0.35;
    // sous la pluie, un voile gris plus uniforme
    inscatter = mix(inscatter, vec3(dot(inscatter, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.95, 0.98, 1.05), 0.6 * uRain);
    c = c * T + inscatter * (1.0 - T);
    if (uDebug > 0.5) c = uDebug < 1.5 ? vec3(fract(dist / 100.0), dist / 3000.0, z) : uDebug < 2.5 ? vec3(texture2D(tAO, vUv).r) : col.rgb;
  }
  // exposition (adaptation de l'œil, image précédente) : l'image HDR qui suit est déjà exposée (gris moyen ≈ 0,18)
  float avg = texture2D(tAdapt, vec2(0.5)).r;
  float ex = uManualExp > 0.0 ? uManualExp : clamp(0.18 / max(avg, 1e-6), uMinExp, uMaxExp);
  // valeurs bornées (demi-flottants, halo) ; la nuit reste sombre (l'œil ne s'adapte pas au-delà de ×12)
  vec3 outC = min(c * ex * uExpComp, vec3(48.0));
  if (outC != outC) outC = vec3(0.0);
  gl_FragColor = vec4(outC, ex * uExpComp);
}
`;

// luminance moyenne (logarithmique) de l'image, pour l'exposition automatique
const LUM_FRAG = /* glsl */`
uniform sampler2D tColor;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tColor, vUv);
  vec3 c = t.rgb / max(t.a, 1e-6);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // le centre de l'image compte plus (le coureur, la route)
  float w = 1.0 - 0.6 * length(vUv - 0.5);
  gl_FragColor = vec4(log(max(l, 1e-5)) * w, w, 0.0, 1.0);
}
`;
const ADAPT_FRAG = /* glsl */`
uniform sampler2D tLum, tPrev;
uniform float uK, uLodMax;
varying vec2 vUv;
void main() {
  vec2 s = textureLod(tLum, vec2(0.5), uLodMax).rg;
  float cur = exp(s.r / max(s.g, 1e-4));
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (prev <= 0.0 || prev != prev) prev = cur;
  gl_FragColor = vec4(mix(prev, cur, uK), 0.0, 0.0, 1.0);
}
`;

const FINAL_FRAG = /* glsl */`
#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D tColor;
uniform float uTime, uGrain, uVignette, uSat, uContrast;
uniform vec3 uWhite;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  c *= uWhite;
  c = ACESFilmicToneMapping(c);
  // étalonnage : contraste autour du gris moyen, saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = clamp((c - 0.18) * uContrast + 0.18, 0.0, 1.0);
  // vignettage
  vec2 d = vUv - 0.5;
  c *= 1.0 - uVignette * dot(d, d) * 1.6;
  vec3 o = sRGBTransferOETF(vec4(c, 1.0)).rgb;
  // grain de film, très léger, et tramage contre les bandes
  o += (hash(vUv * 1031.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
  gl_FragColor = vec4(o, 1.0);
}
`;

function fsMesh(mat) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; return m; }

export class Engine {
  constructor(canvas, qualityName) {
    this.canvas = canvas;
    this.qName = QUALITY[qualityName] ? qualityName : 'haute';
    this.Q = QUALITY[this.qName];
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: /[?&]capture/.test(location.search) });
    r.setPixelRatio(1);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;   // la conversion sRGB est faite par la dernière passe
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.gl = r.getContext();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.2, 30000);
    this.camera.position.set(0, 2, 5);
    this.scene.add(this.camera);
    this.scale = 1;            // échelle de résolution (adaptative)
    this.autoScale = true;
    this.time = 0;
    this.exposureComp = 1;
    this.manualExposure = 0;
    this.white = new THREE.Color(1, 1, 1);
    this.frameMs = 16;
    this._fpsAcc = 0; this._fpsN = 0; this.fps = 60;
    this._buildTargets();
    this._buildPasses();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Ombres en cascade autour de la caméra, éclairées par le soleil (ou la lune). */
  setupShadows() {
    const Q = this.Q;
    this.csm = new CSM({
      maxFar: Q.shadowFar, cascades: Q.cascades, mode: 'practical', parent: this.scene, shadowMapSize: Q.shadow,
      lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera: this.camera, lightIntensity: 4, lightNear: 1, lightFar: 6000, lightMargin: 400,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.shadow.bias = -0.00025;
      l.shadow.normalBias = 0.04;
      l.shadow.radius = 2;
    }
    return this.csm;
  }

  /** Prépare un matériau pour les ombres en cascade, en gardant sa propre modification du shader. */
  prepare(mat) {
    if (!this.csm) return mat;
    const own = mat.onBeforeCompile;
    const ownKey = mat.customProgramCacheKey;
    this.csm.setupMaterial(mat);
    const csmHook = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => { csmHook.call(mat, shader, renderer); if (own && own !== csmHook) own.call(mat, shader, renderer); };
    if (ownKey) mat.customProgramCacheKey = ownKey;
    return mat;
  }

  _buildTargets() {
    const Q = this.Q;
    const depth = new THREE.DepthTexture(4, 4);
    depth.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: Q.msaa, depthTexture: depth, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.rtHDR = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtAO = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.rtLum = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.rtAdapt = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false }));
    this._adaptI = 0;
  }

  _buildPasses() {
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.texture }, tDepth: { value: this.rtScene.depthTexture }, tAO: { value: this.rtAO.texture },
        uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uAOOn: { value: this.Q.ao ? 1 : 0 }, uNear: { value: 0.2 }, uFar: { value: 30000 }, uDebug: { value: 0 },
        tAdapt: { value: this.rtAdapt[0].texture }, uExpComp: { value: 1 }, uMinExp: { value: 0.02 }, uMaxExp: { value: 12 }, uManualExp: { value: 0 },
      },
      vertexShader: FS_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.compositeScene = new THREE.Scene(); this.compositeScene.add(fsMesh(this.compositeMat));
    this.lumMat = new THREE.ShaderMaterial({ uniforms: { tColor: { value: this.rtHDR.texture } }, vertexShader: FS_VERT, fragmentShader: LUM_FRAG, depthTest: false, depthWrite: false });
    this.lumScene = new THREE.Scene(); this.lumScene.add(fsMesh(this.lumMat));
    this.adaptMat = new THREE.ShaderMaterial({ uniforms: { tLum: { value: this.rtLum.texture }, tPrev: { value: null }, uK: { value: 0.05 }, uLodMax: { value: 8 } }, vertexShader: FS_VERT, fragmentShader: ADAPT_FRAG, depthTest: false, depthWrite: false });
    this.adaptScene = new THREE.Scene(); this.adaptScene.add(fsMesh(this.adaptMat));
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtHDR.texture }, uTime: { value: 0 },
        uGrain: { value: 0.01 }, uVignette: { value: 0.3 }, uSat: { value: 1.05 }, uContrast: { value: 1.04 },
        uWhite: { value: this.white }, toneMappingExposure: { value: 1 },
      },
      vertexShader: FS_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
    });
    this.finalScene = new THREE.Scene(); this.finalScene.add(fsMesh(this.finalMat));
    // occlusion ambiante : profondeur seule (les normales sont reconstruites), demi-résolution
    if (this.Q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, 4, 4);
      this.gtao.setGBuffer(this.rtScene.depthTexture);
      this.gtao.output = GTAOPass.OUTPUT.Denoise;
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 2.5, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    }
    if (this.Q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.16, 0.5, 1.1);
    }
  }

  /** Raccorde les uniformes de l'atmosphère (ciel, nuages, brouillard) au post-traitement. */
  attachAtmosphere(atmo) {
    this.atmo = atmo;
    Object.assign(this.compositeMat.uniforms, {
      uSkyLut: atmo.u.uSkyLut, uSun: atmo.u.uSun, uSunE: atmo.u.uSunE, uFogDensity: atmo.u.uFogDensity, uFogHeight: atmo.u.uFogHeight,
      uCloudCover: atmo.u.uCloudCover, uCloudOff: atmo.u.uCloudOff, uCloudAlt: atmo.u.uCloudAlt, uLightDir: atmo.u.uLightDir,
      uSunColor: atmo.u.uSunColor, uLightColor: atmo.u.uLightColor, uRain: atmo.u.uRain, uNight: atmo.u.uNight,
    });
    this.compositeMat.needsUpdate = true;
    this.scene.add(atmo.dome);
  }

  resize() {
    const w = Math.max(2, this.canvas.clientWidth || window.innerWidth), h = Math.max(2, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.Q.maxDpr);
    this.cssW = w; this.cssH = h;
    this.renderer.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._dpr = dpr;
    this._applyScale();
  }

  _applyScale() {
    const W = Math.max(2, Math.round(this.cssW * this._dpr * this.scale)), H = Math.max(2, Math.round(this.cssH * this._dpr * this.scale));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.rtScene.setSize(W, H);
    this.rtHDR.setSize(W, H);
    const aw = this.Q.aoHalf ? Math.ceil(W / 2) : W, ah = this.Q.aoHalf ? Math.ceil(H / 2) : H;
    this.rtAO.setSize(aw, ah);
    if (this.gtao) this.gtao.setSize(aw, ah);
    if (this.bloom) this.bloom.setSize(Math.ceil(W / 2), Math.ceil(H / 2));
    if (this.csm) this.csm.updateFrustums();
  }

  /** Une image : la scène en HDR, puis les passes ; dt en secondes réelles. */
  render(dt) {
    const r = this.renderer, cam = this.camera;
    this.time += dt;
    r.info.reset();
    if (this.csm) this.csm.update();
    // 1. scène
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    // 2. occlusion ambiante
    if (this.gtao) {
      this.gtao.camera = cam;
      this.gtao.render(r, this.rtAO, this.rtScene);
    }
    // 3. composition (brouillard, ombres des nuages)
    const cu = this.compositeMat.uniforms;
    cu.tAdapt.value = this.rtAdapt[this._adaptI].texture;
    cu.uExpComp.value = this.exposureComp;
    cu.uManualExp.value = this.manualExposure;
    cu.uInvProj.value.copy(cam.projectionMatrixInverse);
    cu.uCamWorld.value.copy(cam.matrixWorld);
    cu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    r.setRenderTarget(this.rtHDR);
    r.render(this.compositeScene, this.fsCam);
    // 4. exposition automatique (avant le halo, qui écrit dans l'alpha)
    r.setRenderTarget(this.rtLum);
    r.render(this.lumScene, this.fsCam);
    const a = this.rtAdapt[this._adaptI], b = this.rtAdapt[1 - this._adaptI];
    this.adaptMat.uniforms.tPrev.value = a.texture;
    this.adaptMat.uniforms.uK.value = 1 - Math.exp(-dt * 1.8);
    r.setRenderTarget(b);
    r.render(this.adaptScene, this.fsCam);
    this._adaptI = 1 - this._adaptI;
    // 5. halo lumineux
    if (this.bloom) this.bloom.render(r, null, this.rtHDR, dt, false);
    // 6. tons, étalonnage, écran
    const fu = this.finalMat.uniforms;
    fu.uTime.value = this.time;
    r.setRenderTarget(null);
    r.setViewport(0, 0, r.domElement.width, r.domElement.height);
    r.render(this.finalScene, this.fsCam);
    this._trackFps(dt);
  }

  // résolution adaptative : vise 60 images par seconde, entre 60 % et 100 % de la résolution
  _trackFps(dt) {
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc < 1) return;
    this.fps = this._fpsN / this._fpsAcc;
    this._fpsAcc = 0; this._fpsN = 0;
    if (!this.autoScale) return;
    let s = this.scale;
    if (this.fps < 52) s -= 0.06; else if (this.fps > 59 && s < 1) s += 0.03;
    s = Math.max(0.6, Math.min(1, s));
    if (Math.abs(s - this.scale) > 0.001) { this.scale = s; this._applyScale(); }
  }

  stats() {
    const i = this.renderer.info;
    return { fps: Math.round(this.fps), calls: i.render.calls, tris: i.render.triangles, scale: this.scale, w: this.W, h: this.H };
  }
}
