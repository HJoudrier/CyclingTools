/* Virtual Ride 3D Réaliste — précipitations et état du sol :
   - pluie : des dizaines de milliers de traînées de gouttes autour de la caméra, inclinées par le vent, éclairées par le ciel ; la
     vue en est d'autant plus bouchée que la pluie est forte ;
   - neige : des flocons qui tombent lentement en tourbillonnant ;
   - le sol : la route et les prés se mouillent sous la pluie (sombres et brillants, flaques, ondes des gouttes) puis sèchent en
     quelques minutes ; la neige blanchit peu à peu les prés, les arbres et les bords de route, puis fond.
   Avec PaceYourRide, la pluie (mm/h), la température et la chaussée mouillée viennent de la météo de la course ; seule, la vue suit
   le temps choisi (paramètre wx de l'adresse). */
import * as THREE from 'three';

const BOX = new THREE.Vector3(36, 18, 36);

const VERT = /* glsl */`
attribute vec4 aSeed;        // position dans la boîte (0..1), phase
uniform vec3 uCamP, uBox, uWindP;
uniform float uTimeP, uFall, uLen, uSnowMode, uCount, uAmount;
varying float vA;
varying vec2 vQ;
void main() {
  vec3 p = aSeed.xyz * uBox;
  // chute et dérive au vent, puis repli dans la boîte qui suit la caméra
  float t = uTimeP * (0.85 + 0.3 * aSeed.w);
  p.y -= t * uFall;
  p.xz += t * uWindP.xz * mix(1.0, 0.6, uSnowMode);
  if (uSnowMode > 0.5) p.xz += vec2(sin(t * 1.3 + aSeed.w * 40.0), cos(t * 1.1 + aSeed.w * 30.0)) * 0.35;
  vec3 c = uCamP - uBox * 0.5;
  p = c + mod(p - c, uBox);
  // assez de gouttes pour l'intensité demandée : les autres disparaissent
  float alive = step(aSeed.w, uAmount);
  vec3 vel = normalize(vec3(uWindP.x, -uFall, uWindP.z));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
  // traînée : un quadrilatère allongé dans la direction de la chute, vu de face
  vec2 side = normalize(vec2(-vv.y, vv.x) + 1e-5);
  float w = uSnowMode > 0.5 ? 0.012 : 0.0035;
  float L = uSnowMode > 0.5 ? 0.012 : uLen;
  mv.xyz += vec3(side * position.x * w, 0.0) + vv * position.y * L;
  vQ = position.xy;
  vA = alive * smoothstep(0.5, 3.0, -mv.z) * (1.0 - smoothstep(16.0, 22.0, -mv.z));
  gl_Position = projectionMatrix * mv;
  if (alive < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const FRAG = /* glsl */`
uniform vec3 uColP;
uniform float uSnowMode, uOpacity;
varying float vA;
varying vec2 vQ;
void main() {
  float a;
  if (uSnowMode > 0.5) a = smoothstep(1.0, 0.3, length(vQ * vec2(1.0, 2.0)));
  else a = (1.0 - abs(vQ.x)) * smoothstep(0.0, 0.3, vQ.y + 0.5) * smoothstep(0.0, 0.3, 0.5 - vQ.y);
  gl_FragColor = vec4(uColP, a * vA * uOpacity);
}
`;

export class Weather {
  constructor(world) {
    this.world = world;
    const Q = world.Q;
    this.count = Q.grass >= 1.5 ? 60000 : Q.grass >= 1 ? 36000 : 18000;
    this.u = world.atmo.u;
    this.wet = 0; this.snow = this.u.uSnow.value; this.rain = 0;
    this.env = null;
    this.raceK = 1;
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    const seeds = new Float32Array(this.count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = this.count;
    this.uniforms = {
      uCamP: { value: new THREE.Vector3() }, uBox: { value: BOX }, uWindP: { value: new THREE.Vector3() }, uTimeP: { value: 0 },
      uFall: { value: 8 }, uLen: { value: 0.5 }, uSnowMode: { value: 0 }, uCount: { value: this.count }, uAmount: { value: 0 },
      uColP: { value: new THREE.Color(0.5, 0.5, 0.55) }, uOpacity: { value: 0.35 },
    };
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    world.engine.scene.add(this.mesh);
  }

  /** Conditions de PaceYourRide : {rain (mm/h), T (°C), wet (0–1)} ; now : sans transition. */
  setEnv(env, now) {
    this.env = env || null;
    if (now && env) {
      const r = Number(env.rain) || 0;
      this.rain = Math.min(1, r / 6);
      this.wet = Math.max(Number(env.wet) || 0, r > 0.1 ? 0.8 : 0);
    }
  }

  update(dt, camera) {
    const A = this.world.atmo, u = this.u;
    const env = this.env;
    // pluie et neige : d'après la course, ou d'après le temps affiché
    let rainT, snowing;
    if (env && Number.isFinite(env.rain)) {
      rainT = Math.min(1, env.rain / 6);
      snowing = rainT > 0.02 && (Number(env.T) <= 1 || A.state === 'neige');
    } else {
      rainT = A.state === 'orage' ? 0.9 : A.state === 'pluie' ? 0.55 : A.state === 'neige' ? 0.45 : 0;
      snowing = A.state === 'neige';
    }
    this.rain += (rainT - this.rain) * (1 - Math.exp(-dt / 8));
    // chaussée : mouillée vite sous la pluie, sèche en quelques minutes (plus vite au soleil)
    const wetT = env && Number.isFinite(env.wet) ? Math.max(env.wet, this.rain > 0.05 && !snowing ? 0.85 : 0) : (this.rain > 0.05 && !snowing ? 1 : 0);
    const kWet = wetT > this.wet ? dt / 20 : dt / 240;
    this.wet += (wetT - this.wet) * Math.min(1, kWet);
    if (snowing) this.snow = Math.min(1, this.snow + dt / 70 * (0.3 + this.rain));
    else if (A.landscape_hiver !== true) this.snow = Math.max(0, this.snow - dt / 400 * (Number(env && env.T) > 4 ? 2 : 1));
    u.uWet.value = this.wet;
    u.uRain.value = snowing ? 0 : this.rain;
    u.uSnow.value = Math.max(this.snow, this.world.snowBase || 0);
    // particules
    const U = this.uniforms;
    const amount = this.rain;
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    U.uTimeP.value += dt;
    U.uCamP.value.copy(camera.position);
    const w = A.wind;
    U.uWindP.value.set(w.x * 0.6, 0, w.y * 0.6);
    U.uSnowMode.value = snowing ? 1 : 0;
    U.uFall.value = snowing ? 1.2 : 8.5;
    U.uLen.value = 0.45 + 0.004 * U.uFall.value * 60 * 0.016;
    U.uAmount.value = Math.min(1, amount * 1.15);
    // les gouttes renvoient la lumière du ciel (plus claires à contre-jour)
    const sky = A.u.uCloudAmb.value;
    U.uColP.value.copy(sky).multiplyScalar(snowing ? 2.2 : 1.4);
    U.uOpacity.value = snowing ? 0.9 : 0.28 + 0.2 * A.u.uStorm.value;
    // la brume de pluie dans le brouillard du post-traitement
    A.u.uFogDensity.value += 0.00035 * amount * (snowing ? 1.5 : 1);
  }
}
