/* Virtual Ride 3D Réaliste — eau : les lacs, les mares et les rivières du paysage de Bike3D. Une surface à son niveau, transparente
   sur les bords peu profonds (on voit le fond), plus sombre et bleu-vert au large, qui reflète le ciel (carte d'environnement, effet
   de Fresnel : miroir à jour frisant, transparente vue d'en haut), avec des vaguelettes animées par le vent sur les lacs et le courant
   qui file dans les rivières, les reflets du soleil, et les ondes de la pluie. */
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const FRAG_PARS = NOISE + /* glsl */`
uniform float uTimeW, uRainW;
uniform vec3 uWindW;
varying vec3 vWW;
varying vec2 vFlow;      // x : profondeur (m), y : vitesse du courant (m/s)
varying vec2 vUvW;       // rivière : u à travers, v le long (m)
vec3 waterNormal(vec3 p) {
  float t = uTimeW;
  vec2 q = p.xz;
  vec2 g = vec2(0.0);
  float e = 0.05;
  // vagues : deux couches de bruit qui dérivent (vent) ou filent (courant)
  vec2 drift = vFlow.y > 0.01 ? vec2(0.0) : uWindW.xz * t * 0.4;
  vec2 rq = vFlow.y > 0.01 ? vec2(vUvW.x, vUvW.y - t * vFlow.y) : q;
  float amp = 0.08 + 0.25 * uWindW.y;
  for (int k = 0; k < 3; k++) {
    float sc = 0.35 * pow(2.1, float(k));
    vec2 o = drift * (1.0 + 0.4 * float(k)) + float(k) * 13.7;
    float h0 = gnoise(rq * sc + o), hx = gnoise((rq + vec2(e, 0.0)) * sc + o), hz = gnoise((rq + vec2(0.0, e)) * sc + o);
    g += vec2(hx - h0, hz - h0) / e * amp / pow(1.8, float(k));
  }
  // gouttes de pluie
  if (uRainW > 0.05) {
    vec2 c = floor(q * 2.0), f = fract(q * 2.0) - 0.5;
    float ph = fract(t * 1.3 + h12(c));
    float d = length(f - (h22(c) - 0.5) * 0.6);
    g += (f / max(d, 1e-3)) * sin(d * 40.0 - ph * 20.0) * smoothstep(0.3 * ph + 0.05, 0.3 * ph, d) * (1.0 - ph) * uRainW * 0.5;
  }
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`;

function waterMaterial(engine, u) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x0b2a2e, roughness: 0.035, metalness: 0, transparent: true, ior: 1.333, specularIntensity: 1, depthWrite: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTimeW: u.uTime, uRainW: u.uRain, uWindW: u.uWind });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFlow; attribute vec2 aUvW; varying vec3 vWW; varying vec2 vFlow; varying vec2 vUvW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz; vFlow = aFlow; vUvW = aUvW;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float depthW = max(vFlow.x, 0.0);
        // couleur de l'eau : vert-brun près du bord, bleu sombre au large ; transparence sur les bords peu profonds
        vec3 shallow = vec3(0.10, 0.12, 0.08), deep = vec3(0.012, 0.035, 0.045);
        diffuseColor.rgb = mix(shallow, deep, smoothstep(0.2, 3.0, depthW));
        float viewUp = abs(normalize(cameraPosition - vWW).y);
        diffuseColor.a = mix(0.92, 0.55, viewUp) * smoothstep(0.0, 0.9, depthW) + 0.05;`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(waterNormal(vWW), 0.0)).xyz);');
  };
  m.customProgramCacheKey = () => 'water-v1';
  engine.prepare(m);
  return m;
}

export class Water {
  constructor(world) {
    this.world = world;
    const L = world.landscape, E = world.engine;
    this.material = waterMaterial(E, world.atmo.u);
    this.group = new THREE.Group();
    this.group.name = 'eau';
    const pos = [], flow = [], uvw = [], idx = [];
    const add = (x, y, z, depth, speed, u, v) => { pos.push(x, y, z); flow.push(depth, speed); uvw.push(u, v); return pos.length / 3 - 1; };
    // lacs et mares : un éventail jusqu'un peu au-delà du rivage (le terrain recouvre le bord)
    for (const lk of L.lakes || []) {
      const N = lk.kind === 'pond' ? 28 : 72, ox = lk.x, oz = lk.z;
      const c = add(ox, lk.level, oz, lk.depth, 0, 0, 0);
      const ring = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        for (const [f, dep] of [[0.6, lk.depth * 0.64], [1.0, 0.05], [1.1, -0.2]]) {
          const r = L.lakeRadius(lk, a) * f;
          ring.push(add(ox + Math.cos(a) * r, lk.level, oz + Math.sin(a) * r, dep, 0, 0, 0));
        }
      }
      for (let k = 0; k < N; k++) {
        const a0 = k * 3, a1 = ((k + 1) % N) * 3;
        idx.push(c, ring[a1], ring[a0]);
        for (let q = 0; q < 2; q++) idx.push(ring[a0 + q], ring[a1 + q], ring[a0 + q + 1], ring[a1 + q], ring[a1 + q + 1], ring[a0 + q + 1]);
      }
    }
    // rivières : un ruban le long du lit, au niveau de l'eau
    for (const rv of L.rivers || []) {
      const n = rv.x.length;
      let along = 0, prev = null;
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        let tx = rv.x[i1] - rv.x[i0], tz = rv.z[i1] - rv.z[i0];
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        if (i > 0) along += Math.hypot(rv.x[i] - rv.x[i - 1], rv.z[i] - rv.z[i - 1]);
        const w = rv.rw[i] + 1.6, y = rv.wl[i];
        const row = [];
        for (const [f, dep] of [[-1, -0.1], [-0.6, 0.8], [0, 1.9], [0.6, 0.8], [1, -0.1]]) row.push(add(rv.x[i] - tz * w * f, y, rv.z[i] + tx * w * f, dep, 0.9, f * w, along));
        if (prev) for (let q = 0; q < 4; q++) idx.push(prev[q], row[q], prev[q + 1], prev[q + 1], row[q], row[q + 1]);
        prev = row;
      }
    }
    if (!idx.length) { this.mesh = null; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('aUvW', new THREE.Float32BufferAttribute(uvw, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    // le monde est centré sur le parcours : les coordonnées restent petites
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
    E.scene.add(this.group);
  }

  update() {}
}
