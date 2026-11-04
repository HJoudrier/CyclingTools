/* Virtual Ride 3D Réaliste — herbe : des brins en vraie géométrie autour de la caméra (40 m en qualité haute), calculés par la carte
   graphique : une grille de carrés de 1 m suit la caméra, chaque carré porte des brins dont la place, la hauteur, l'orientation et la
   teinte viennent d'un hachage de la position dans le monde (ils ne bougent pas quand la grille avance). Une texture d'altitude et de
   densité autour de la caméra (0,5 m par pixel, mise à jour quand on avance) pose les brins sur le relief et ne les laisse pousser que
   dans les prés, les accotements et les champs verts (ni sur la route, ni dans l'eau). Les brins se courbent au vent par rafales,
   laissent passer la lumière, et des fleurs piquent les prés au printemps et en été. */
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const MAP = 256, RES = 0.5;          // texture de sol : 256 × 256 pixels de 0,5 m (128 m de côté)
const BLADES = 40;                    // brins par carré de 1 m (près de la caméra)
const SEG = 4;                        // segments par brin

const GRASS_VERT_PARS = NOISE + /* glsl */`
attribute vec3 aBlade;       // indice du brin dans le carré, position le long du brin (0..1), côté (−1, 1)
attribute vec2 aPatch;       // décalage du carré dans la grille (m)
uniform sampler2D uGround;   // r : altitude − uBaseY, g : densité, b : sécheresse, a : fleurs
uniform vec2 uMapOrigin;     // coin de la texture (m)
uniform vec3 uCamG;
uniform float uBaseY, uRadius, uTimeG, uDensity;
uniform vec3 uWindG;
varying float vT;
varying vec3 vGCol;
varying float vFlower;
varying vec3 vGW;
`;
const GRASS_VERT = /* glsl */`
vec2 origin = floor(uCamG.xz) + aPatch;
float bi = aBlade.x;
vec2 seed = origin + vec2(bi * 0.137, bi * 0.731);
vec2 r2 = h22(seed * 1.31 + 0.5);
vec2 wp = origin + r2;
vec2 muv = (wp - uMapOrigin) / (${MAP.toFixed(1)} * ${RES.toFixed(2)});
vec4 G = texture2D(uGround, muv);
float dist = length(wp - uCamG.xz);
// moins de brins au loin, mais plus larges (la prairie reste pleine)
float keep = bi / ${BLADES.toFixed(1)};
float lod = mix(1.0, 0.22, smoothstep(6.0, uRadius, dist));
float alive = step(keep, lod * uDensity) * step(h12(seed + 9.1), G.g) * step(dist, uRadius) * step(0.001, muv.x) * step(muv.x, 0.999) * step(0.001, muv.y) * step(muv.y, 0.999);
float hgt = mix(0.18, 0.55, h12(seed + 3.3)) * mix(0.55, 1.15, G.g) * (1.0 - 0.35 * G.b) * smoothstep(uRadius, uRadius * 0.85, dist);
float wid = mix(0.004, 0.009, h12(seed + 5.5)) * (1.0 + 2.2 * smoothstep(5.0, uRadius, dist)) / max(lod, 0.3);
float ang = h12(seed + 7.7) * 6.2831853;
vec2 dir = vec2(cos(ang), sin(ang));
float t = aBlade.y;
// vent : rafales qui avancent dans la prairie, et courbure naturelle du brin
float gust = 0.5 + 0.5 * sin(dot(wp, uWindG.xz) * 0.25 - uTimeG * (1.4 + uWindG.y) + vnoise(wp * 0.07) * 4.0);
float bend = (0.25 + 0.6 * h12(seed + 1.7)) * t * t;
vec2 wdir = uWindG.xz;
vec2 lean = dir * bend * 0.35 + wdir * t * t * (0.08 + 0.4 * uWindG.y * (0.4 + 0.6 * gust));
vec3 pBase = vec3(wp.x, G.r + uBaseY - 0.02, wp.y);
vec2 side = vec2(-dir.y, dir.x);
transformed = pBase + vec3(lean.x * hgt + side.x * wid * aBlade.z * (1.0 - t), t * hgt * (1.0 - 0.25 * length(lean)), lean.y * hgt + side.y * wid * aBlade.z * (1.0 - t));
transformed *= alive;
transformed += (1.0 - alive) * vec3(uCamG.x, -1e4, uCamG.z);
// normale : celle du brin, ramenée vers le haut (les prairies paraissent douces)
objectNormal = normalize(vec3(side.x, 0.0, side.y) * 0.35 * aBlade.z + vec3(0.0, 1.0, 0.0) + vec3(dir.x, 0.0, dir.y) * 0.3);
vT = t;
float dry = G.b;
vec3 green = mix(vec3(0.045, 0.085, 0.016), vec3(0.09, 0.13, 0.03), h12(seed + 11.0));
vec3 straw = vec3(0.20, 0.17, 0.08);
vGCol = mix(green, straw, clamp(dry * (0.7 + 0.6 * h12(seed + 13.0)), 0.0, 1.0));
vFlower = step(1.0 - G.a * 0.06, h12(seed + 17.0)) * step(0.85, t);
vGW = transformed;
`;

const GRASS_FRAG_PARS = /* glsl */`
varying float vT;
varying vec3 vGCol;
varying float vFlower;
varying vec3 vGW;
uniform vec3 uLightDirG, uLightColG;
`;

export class Grass {
  constructor(world) {
    this.world = world;
    const E = this.engine = world.engine;
    const Q = world.Q;
    this.radius = Q.grass >= 1.5 ? 55 : Q.grass >= 1 ? 40 : 26;
    const u = world.atmo.u;
    // sol autour de la caméra
    this.data = new Float32Array(MAP * MAP * 4);
    this.tex = new THREE.DataTexture(this.data, MAP, MAP, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.origin = new THREE.Vector2(1e9, 1e9);
    this.baseY = 0;
    this.uniforms = {
      uGround: { value: this.tex }, uMapOrigin: { value: new THREE.Vector2() }, uCamG: { value: new THREE.Vector3() },
      uBaseY: { value: 0 }, uRadius: { value: this.radius }, uTimeG: u.uTime, uDensity: { value: Math.min(1, Q.grass) },
      uWindG: u.uWind, uLightDirG: u.uLightDir, uLightColG: u.uLightColor, uSnowG: u.uSnow,
    };
    this.mesh = this._build();
    E.scene.add(this.mesh);
    this.flowers = world.season.green * (world.landscape.P.flowers || 0.4) * (1 - world.season.dry * 0.6);
    this.timer = 0;
  }

  _build() {
    // un carré : BLADES brins de SEG segments
    const pos = [], blade = [], idx = [];
    for (let b = 0; b < BLADES; b++) {
      const base = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        for (const s of [-1, 1]) { pos.push(0, 0, 0); blade.push(b, t, s); }
      }
      for (let k = 0; k < SEG; k++) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0), 3));
    g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 3));
    g.setIndex(idx);
    const R = this.radius, cells = [];
    for (let z = -R; z < R; z++) for (let x = -R; x < R; x++) if (Math.hypot(x + 0.5, z + 0.5) < R + 1) cells.push(x, z);
    g.setAttribute('aPatch', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
    g.instanceCount = cells.length / 2;
    this.count = g.instanceCount;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    const U = this.uniforms;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + GRASS_VERT_PARS)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\nvec3 transformed = vec3(0.0);\n' + GRASS_VERT)
        .replace('#include <begin_vertex>', '');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GRASS_FRAG_PARS + 'uniform float uSnowG;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 gc = vGCol * (0.45 + 0.75 * vT);
          vec3 fl = mix(vec3(0.9, 0.88, 0.8), mix(vec3(0.85, 0.7, 0.08), vec3(0.45, 0.25, 0.7), step(0.5, fract(vGW.x * 3.7 + vGW.z * 1.3))), step(0.4, fract(vGW.x * 1.9 - vGW.z * 2.3)));
          diffuseColor.rgb = mix(gc, fl, vFlower);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.92), uSnowG * vT * 0.8);`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.75, 0.42, vT);')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          {
            vec3 Lv = normalize((viewMatrix * vec4(uLightDirG, 0.0)).xyz);
            vec3 V = normalize(vViewPosition);
            float back = pow(clamp(dot(V, Lv), 0.0, 1.0), 4.0);
            reflectedLight.directDiffuse += diffuseColor.rgb * uLightColG * back * 0.6 * vT;
            // les brins du bas sont dans l'ombre des autres
            reflectedLight.directDiffuse *= mix(0.45, 1.0, vT);
            reflectedLight.indirectDiffuse *= mix(0.35, 1.0, vT);
          }`);
    };
    m.customProgramCacheKey = () => 'grass-v1';
    this.engine.prepare(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  // altitude, densité d'herbe, sécheresse et fleurs autour de (cx, cz), d'après les tuiles fines du terrain
  _refresh(cx, cz) {
    const T = this.world.terrain, L = this.world.landscape;
    const ox = Math.floor(cx - MAP * RES / 2), oz = Math.floor(cz - MAP * RES / 2);
    this.origin.set(ox, oz);
    const D = this.data;
    const q = T.heightAt(cx, cz);
    this.baseY = q === null ? 0 : Math.round(q);
    const half = L.roadHalf;
    let last = null;
    for (let j = 0; j < MAP; j++) {
      const z = oz + (j + 0.5) * RES;
      for (let i = 0; i < MAP; i++) {
        const x = ox + (i + 0.5) * RES;
        const o = (j * MAP + i) * 4;
        let slot = last;
        if (!slot || x < slot.x0 || z < slot.z0 || x >= slot.x0 + slot.size || z >= slot.z0 + slot.size) { const s = T.fineTile(x, z); slot = s ? s.data : null; last = slot; }
        if (!slot) { D[o] = -1000; D[o + 1] = 0; D[o + 2] = 0; D[o + 3] = 0; continue; }
        const V = slot.seg + 1, st = slot.size / slot.seg;
        const fx = (x - slot.x0) / st, fz = (z - slot.z0) / st;
        const ix = Math.min(V - 2, Math.floor(fx)), iz = Math.min(V - 2, Math.floor(fz)), ax = fx - ix, az = fz - iz, k = iz * V + ix;
        const bil = (A, s, c) => (A[k * s + c] * (1 - ax) + A[(k + 1) * s + c] * ax) * (1 - az) + (A[(k + V) * s + c] * (1 - ax) + A[(k + V + 1) * s + c] * ax) * az;
        D[o] = bil(slot.H, 1, 0) - this.baseY;
        const grass = bil(slot.w0, 4, 0), dry = bil(slot.w0, 4, 1), soil = bil(slot.w0, 4, 3);
        const rd = bil(slot.roadD, 1, 0), under = slot.under[k] || slot.under[k + V + 1];
        let dens = Math.min(1, grass * 1.15 + dry * 0.9) * (1 - Math.min(1, soil * 1.5));
        if (rd < half + 0.35 || under) dens = 0;
        else if (rd < half + 1.4) dens *= (rd - half - 0.35) / 1.05;
        D[o + 1] = dens;
        D[o + 2] = dry / Math.max(0.05, grass + dry);
        D[o + 3] = this.flowers * Math.min(1, grass * 1.5);
      }
    }
    this.tex.needsUpdate = true;
    const U = this.uniforms;
    U.uMapOrigin.value.copy(this.origin);
    U.uBaseY.value = this.baseY;
  }

  update(dt, camera) {
    const p = camera.position;
    const U = this.uniforms;
    U.uCamG.value.copy(p);
    // assez loin du sol (hélicoptère), pas d'herbe
    const gh = this.world.terrain.heightAt(p.x, p.z);
    this.mesh.visible = gh !== null && p.y - gh < 60;
    this.timer -= dt;
    const cx = this.origin.x + MAP * RES / 2, cz = this.origin.y + MAP * RES / 2;
    if (this.mesh.visible && (Math.abs(p.x - cx) > 14 || Math.abs(p.z - cz) > 14 || this.timer < 0)) {
      this.timer = 2.5;   // aussi quand de nouvelles tuiles arrivent
      this._refresh(p.x, p.z);
    }
  }
}
