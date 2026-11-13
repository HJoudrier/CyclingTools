/* Virtual Ride 3D Réaliste — les coureurs : le joueur (son vélo, sa tenue et sa position, ceux du magasin de PaceYourRide) et le peloton
   (coureurs virtuels, fantômes, autres joueurs en direct). Les corps sont animés par la carte graphique : la pose de chaque coureur
   (pédalage, danseuse, position recroquevillée en descente, tête qui suit la route) est calculée ici, os par os, et rangée dans une
   texture ; un seul maillage instancié dessine tous les corps d'un même modèle, qui lisent leurs os dans cette texture (avec leurs
   ombres). Deux niveaux de détail : le corps fin près de la caméra, le corps simplifié au loin. Les vélos sont instanciés aussi : cadre
   à la couleur de l'équipe, roues et pédalier qui tournent. Le vélo s'incline dans les virages et suit la pente. */
import * as THREE from 'three';
import { joints, restJoints, boneEnds, boneFrame, buildBody, restInverse, morphology, BONES, REGION } from './body.js';
import { buildBike, plan, normGear, WHEEL_R } from './bike.js';

const NB = BONES.length;
const MAXR = 128;
const CROWD_ROW = MAXR - 1;   // ligne de la texture des os réservée au public (os à l'identité : pose de référence)
const FINE_D = 9, MID_D = 45, VIS_D = 900;   // corps fin (joueur et tout près), intermédiaire, simplifié ; vélo complet jusqu'à MID_D

const BODY_VERT_PARS = /* glsl */`
uniform sampler2D uBones;
attribute vec4 aSkinI;
attribute vec4 aSkinW;
attribute vec4 aRegW;       // poids des zones (maillot, cuissard, peau, chaussette)
varying vec4 vRegW;
attribute vec4 aRef;        // position de référence ; w : zone
attribute vec3 aJersey;
attribute vec3 aAccent;
attribute vec4 aLook;       // couleur du casque (rgb), motif du maillot
attribute vec4 aSkinRow;    // teint (rgb), ligne de la texture des os
flat varying float vRegion;
varying vec3 vRef;
flat varying vec3 vJersey;
flat varying vec3 vAccent;
flat varying vec4 vLook;
flat varying vec3 vSkinTone;
mat4 boneMat(float b) {
  int x = int(b + 0.5) * 4, y = int(aSkinRow.w + 0.5);
  return mat4(texelFetch(uBones, ivec2(x, y), 0), texelFetch(uBones, ivec2(x + 1, y), 0), texelFetch(uBones, ivec2(x + 2, y), 0), texelFetch(uBones, ivec2(x + 3, y), 0));
}
mat4 skinMat() {
  return boneMat(aSkinI.x) * aSkinW.x + boneMat(aSkinI.y) * aSkinW.y + boneMat(aSkinI.z) * aSkinW.z + boneMat(aSkinI.w) * aSkinW.w;
}
`;

const BODY_FRAG = /* glsl */`
flat varying float vRegion;
varying vec4 vRegW;
varying vec3 vRef;
flat varying vec3 vJersey;
flat varying vec3 vAccent;
flat varying vec4 vLook;
flat varying vec3 vSkinTone;
uniform vec3 uShorts, uSock, uShoe, uGlove;
uniform float uWetB;
float bRough; float bMetal; float bCoat; float bSheen;
vec3 jerseyColor(vec3 p) {
  int pat = int(vLook.w + 0.5);
  float a = 0.0;
  float rel = p.y - 1.25;   // hauteur par rapport au buste
  if (pat == 1) a = step(abs(rel - 0.02), 0.045);                         // bande sur la poitrine
  else if (pat == 2) a = step(0.11, abs(p.x));                            // flancs
  else if (pat == 3) a = step(0.1, rel);                                  // épaules
  else if (pat == 4) a = step(abs(p.x), 0.035);                           // bande verticale
  else if (pat == 5) a = step(0.5, fract(rel * 9.0));                     // cerceaux
  else if (pat == 6) a = smoothstep(-0.2, 0.2, rel);                      // dégradé
  return mix(vJersey, vAccent, a);
}
vec3 bodyAlbedo() {
  int R = int(vRegion + 0.5);
  // peau, maillot, cuissard, chaussette ou gant : la zone la plus présente au pixel. Les poids des deux zones d'un bord (ourlet de
  // la manche, du cuissard, de la chaussette, col, gant) se croisent exactement sur le bord : une ligne nette entre les sommets.
  float hem = 0.0;
  if (dot(vRegW, vec4(1.0)) > 0.01) {
    float m = max(max(vRegW.x, vRegW.y), max(vRegW.z, vRegW.w));
    // chaussette ou gant : les pieds sont en bas, les mains en haut (pose de référence)
    R = m == vRegW.x ? ${REGION.JERSEY} : m == vRegW.y ? ${REGION.SHORTS} : m == vRegW.z ? ${REGION.SKIN} : (vRef.y < 0.62 ? ${REGION.SOCK} : ${REGION.GLOVE});
    // ourlet : une bande un peu plus sombre au bord du tissu, côté tissu
    float second = vRegW.x + vRegW.y + vRegW.z + vRegW.w - m;
    hem = R == ${REGION.SKIN} ? 0.0 : smoothstep(0.08, 0.3, second);
  }
  bRough = 0.5; bMetal = 0.0; bCoat = 0.0; bSheen = 0.0;
  if (R == ${REGION.SKIN}) { bRough = 0.48; return vSkinTone; }
  if (R == ${REGION.JERSEY}) { bRough = 0.62; bSheen = 0.35; return jerseyColor(vRef) * (1.0 - 0.3 * hem); }
  if (R == ${REGION.SHORTS}) { bRough = 0.38 + 0.3 * hem; bSheen = 0.3; return uShorts + vec3(0.035) * hem; }
  if (R == ${REGION.SOCK}) { bRough = 0.85; bSheen = 0.4; return uSock * (1.0 - 0.18 * hem); }
  if (R == ${REGION.SHOE}) { bRough = 0.3; bCoat = 0.7; return uShoe; }
  if (R == ${REGION.HELMET}) { bRough = 0.25; bCoat = 1.0; return vLook.rgb; }
  if (R == ${REGION.LENS}) { bRough = 0.06; bMetal = 0.9; bCoat = 1.0; return vec3(0.03, 0.035, 0.05); }
  if (R == ${REGION.GLOVE}) { bRough = 0.7; return uGlove; }
  if (R == ${REGION.HAIR}) { bRough = 0.55; bSheen = 0.5; return vec3(0.09, 0.05, 0.025); }
  if (R == ${REGION.SOLE}) { bRough = 0.6; return vec3(0.02); }
  bRough = 0.5; return vec3(0.02);
}
`;

function bodyMaterial(engine, U, colors) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(1, 1, 1), clearcoat: 0.01, clearcoatRoughness: 0.15 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uBones: U.uBones, uShorts: { value: colors.shorts }, uSock: { value: colors.sock }, uShoe: { value: colors.shoe }, uGlove: { value: colors.glove }, uWetB: U.uWet });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BODY_VERT_PARS)
      .replace('#include <beginnormal_vertex>', `mat4 skinM = skinMat();
        vec3 objectNormal = normalize((skinM * vec4(normal, 0.0)).xyz);
        vRegion = aRef.w; vRegW = aRegW; vRef = aRef.xyz; vJersey = aJersey; vAccent = aAccent; vLook = aLook; vSkinTone = aSkinRow.rgb;`)
      .replace('#include <begin_vertex>', 'vec3 transformed = (skinM * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + BODY_FRAG)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = bodyAlbedo();')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(bRough, bRough * 0.5, uWetB);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = bMetal;')
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat = bCoat;
        material.clearcoatRoughness = 0.12;
        material.sheenColor = diffuseColor.rgb * 0.6 + 0.25 * bSheen;
        material.sheenColor *= bSheen;
        material.sheenRoughness = 0.4;`);
  };
  m.customProgramCacheKey = () => 'body-v2';
  engine.prepare(m);
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = U.uBones;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BODY_VERT_PARS)
      .replace('#include <begin_vertex>', 'mat4 skinM = skinMat();\nvec3 transformed = (skinM * vec4(position, 1.0)).xyz;');
  };
  depth.customProgramCacheKey = () => 'body-depth';
  return { material: m, depth };
}

const BIKE_VERT_PARS = /* glsl */`
attribute vec4 aMat;
attribute vec3 aPaint;
attribute vec3 aPaint2;
varying vec4 vMat;
flat varying vec3 vPaint;
flat varying vec3 vPaint2;
`;
function bikeMaterial(engine, U) {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWetK = U.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BIKE_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vPaint = aPaint; vPaint2 = aPaint2;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vMat; flat varying vec3 vPaint; flat varying vec3 vPaint2; uniform float uWetK;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vMat.w > 0.75) diffuseColor.rgb = vPaint; else if (vMat.w > 0.25) diffuseColor.rgb = vPaint2;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(vMat.x, vMat.x * 0.6, uWetK);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.y;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.clearcoat = vMat.z;');
  };
  m.customProgramCacheKey = () => 'bike-v1';
  engine.prepare(m);
  return m;
}

/* ---------------------------------------------------------------- lots instanciés */

class Batch {
  constructor(group, geo, mat, depth, cap, attrs) {
    this.cap = cap;
    const g = geo.clone();
    this.attrs = {};
    for (const [name, size] of attrs) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      this.attrs[name] = a;
    }
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    if (depth) this.mesh.customDepthMaterial = depth;
    group.add(this.mesh);
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(matrix, vals) {
    if (this.n >= this.cap) return;
    const k = this.n++;
    matrix.toArray(this.mesh.instanceMatrix.array, k * 16);
    if (vals) for (const name in vals) { const a = this.attrs[name], v = vals[name]; for (let q = 0; q < a.itemSize; q++) a.array[k * a.itemSize + q] = v[q]; }
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
  }
  dispose(group) { group.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

const TEAM_PATTERNS = [1, 2, 3, 4, 5, 6, 0, 2];
const hex = (c) => { const col = new THREE.Color(c); return [col.r, col.g, col.b]; };
const SKINS = ['#dba383', '#cf9571', '#b97f5c', '#9a6644', '#74462b', '#e2b091'].map((c) => hex(c));   // teints hâlés des coureurs

/* ---------------------------------------------------------------- les coureurs */

export class Riders {
  /** opts : {me : {name, color, gear}} */
  constructor(world, opts) {
    this.world = world;
    const E = this.engine = world.engine;
    this.group = new THREE.Group();
    this.group.name = 'coureurs';
    E.scene.add(this.group);
    this.boneData = new Float32Array(NB * 4 * MAXR * 4);
    this.boneTex = new THREE.DataTexture(this.boneData, NB * 4, MAXR, THREE.RGBAFormat, THREE.FloatType);
    this.boneTex.needsUpdate = true;
    this.U = { uBones: { value: this.boneTex }, uWet: world.atmo.u.uWet };
    this.colors = { shorts: new THREE.Color(0.012, 0.012, 0.014), sock: new THREE.Color(0.8, 0.8, 0.78), shoe: new THREE.Color(0.75, 0.75, 0.74), glove: new THREE.Color(0.02, 0.02, 0.02) };
    const bm = bodyMaterial(E, this.U, this.colors);
    this.bodyMat = bm.material; this.bodyDepth = bm.depth;
    this.bikeMat = bikeMaterial(E, this.U);
    this.state = new Map();      // id → état d'animation
    this.list = [];
    this.meId = null;
    this.me = opts.me || {};
    this.models = new Map();     // clé d'équipement → {body fin, body grossier, vélo, lots}
    this.cameraMode = 'chase';
    this._m = new THREE.Matrix4(); this._m2 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._pq = {}; this._pq2 = {};
    // phare du joueur : il éclaire la route la nuit (sans ombre ; allumé au crépuscule)
    this.lamp = new THREE.SpotLight('#fff3dc', 0, 70, 0.42, 0.55, 2);
    this.lamp.castShadow = false;
    this.group.add(this.lamp, this.lamp.target);
    this.setGear(this.me.gear);
    // les modèles du peloton sont préparés tout de suite (pas d'à-coup quand les coureurs arrivent)
    const sex = this.meGear.sex;
    if (!opts.noBots) { this._botModel(sex, 0); this._botModel(sex, 1); }
  }

  /** Équipement du joueur (magasin) : son modèle est reconstruit. */
  setGear(gear) {
    const G = normGear(Object.assign({ frame: 'aero', wheels: 'c45' }, gear || {}));
    const key = JSON.stringify(G);
    if (key === this.meKey) return;
    this.meKey = key;
    this.meGear = G;
    this._model('me|' + key, G, 1);
  }

  /** Modèle (corps fin et simplifié, vélo) d'un équipement, avec ses lots instanciés. */
  _model(key, G, cap) {
    if (this.models.has(key)) return this.models.get(key);
    const bike = buildBike(G);
    // le corps ne dépend que de la morphologie, de la position et de la tenue : les coureurs virtuels le partagent
    const bodyKey = cap === 1 ? key : 'bot|' + G.sex;
    this.bodies = this.bodies || new Map();
    let BD = this.bodies.get(bodyKey);
    if (!BD) {
      const morph = morphology(G.sex);
      const P = plan(bike.layout, G.position, false, morph);
      const J = restJoints(P, bike.layout.BB, morph);
      const fineGeo = buildBody(J, G, cap === 1 ? 0.0095 : 0.0125);
      const midGeo = cap === 1 ? null : buildBody(J, G, 0.021);
      const coarseGeo = cap === 1 ? null : buildBody(J, G, 0.036);
      renameSkin(fineGeo); if (midGeo) renameSkin(midGeo); if (coarseGeo) renameSkin(coarseGeo);
      BD = { morph, P, J, fineGeo, midGeo, coarseGeo, restInv: restInverse(J), stand: plan(bike.layout, 'hoods', true, morph) };
      this.bodies.set(bodyKey, BD);
    }
    const { morph, fineGeo, midGeo, coarseGeo } = BD, P = BD.P;
    const far = cap === 1 ? null : buildBike(G, true);
    const bodyAttrs = [['aJersey', 3], ['aAccent', 3], ['aLook', 4], ['aSkinRow', 4]];
    const bikeAttrs = [['aPaint', 3], ['aPaint2', 3]];
    const M = {
      key, G, layout: bike.layout, morph, restInv: BD.restInv,
      plans: { seat: P, stand: BD.stand },
      fine: new Batch(this.group, fineGeo, this.bodyMat, this.bodyDepth, cap === 1 ? 1 : 16, bodyAttrs),
      mid: midGeo ? new Batch(this.group, midGeo, this.bodyMat, this.bodyDepth, cap, bodyAttrs) : null,
      coarse: coarseGeo ? new Batch(this.group, coarseGeo, this.bodyMat, this.bodyDepth, cap, bodyAttrs) : null,
      bikeFar: far ? new Batch(this.group, far.static, this.bikeMat, null, cap, bikeAttrs) : null,
      bike: new Batch(this.group, bike.static, this.bikeMat, null, cap, bikeAttrs),
      front: new Batch(this.group, bike.front, this.bikeMat, null, cap, bikeAttrs),
      rear: new Batch(this.group, bike.rear, this.bikeMat, null, cap, bikeAttrs),
      crank: new Batch(this.group, bike.crank, this.bikeMat, null, cap, bikeAttrs),
    };
    this.models.set(key, M);
    return M;
  }

  // vélos des coureurs virtuels : aéro ou grimpeur, selon le coureur ; même sexe que le joueur (une course de femmes)
  _botModel(sex, kind) {
    const G = normGear({ frame: kind ? 'climber' : 'aero', wheels: kind ? 'c45' : 'c65', position: 'hoods', helmet: 'road', clothing: 'fitted', glasses: 'sport', socks: 'classic', shoes: kind ? 'road' : 'carbon', sex });
    return this._model('bot|' + sex + kind, G, MAXR);
  }

  /**
   * Liste des coureurs à montrer (le pilote : bridge.js ou demo.js), à chaque image : [{id, name, color, kind, s (abscisse de Bike3D),
   * lat (m), v (m/s), P (W), standing, tuck, sex, fin, st}] ; meId : le joueur.
   */
  set(list, meId) {
    this.list = list;
    this.meId = meId;
  }

  _anim(o, dt) {
    let a = this.state.get(o.id);
    if (!a) {
      const h = hashStr(o.id);
      a = { crank: (h % 628) / 100, wheel: 0, stand: 0, tuck: 0, roll: 0, look: 0, h, lastS: o.s, yawRate: 0, latPrev: o.lat || 0, steer: 0 };
      this.state.set(o.id, a);
    }
    const v = Math.max(0, o.v || 0);
    a.wheel += v / WHEEL_R * dt;
    const pedaling = (o.P === undefined ? v > 1 : o.P > 15) && v > 0.3 && !o.st;
    if (pedaling) {
      const wheelRpm = v / (2 * Math.PI * WHEEL_R) * 60;
      const ratio = Math.max(1.3, Math.min(4.4, wheelRpm / 88));
      a.crank += (wheelRpm / ratio) / 60 * Math.PI * 2 * dt;
    } else {
      const target = Math.round((a.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      a.crank += (target - a.crank) * (1 - Math.exp(-dt * 4));
    }
    a.stand += ((o.standing ? 1 : 0) - a.stand) * (1 - Math.exp(-dt * 5));
    a.tuck += ((o.tuck ? 1 : 0) - a.tuck) * (1 - Math.exp(-dt * 3));
    return a;
  }

  update(dt, camera) {
    const W = this.world, path = W.path, cam = camera.position;
    for (const M of this.models.values()) for (const b of [M.fine, M.mid, M.coarse, M.bike, M.bikeFar, M.front, M.rear, M.crank]) if (b) b.begin();
    const list = this.list || [];
    let row = 0;
    const meM = this.models.get('me|' + this.meKey);
    for (const o of list) {
      if (row >= CROWD_ROW) break;
      const isMe = o.id === this.meId;
      const q = path.sample(o.s, this._pq);
      const lat = o.lat || 0;
      const x = q.x + q.rx * lat, z = q.z + q.rz * lat, y = q.y + 0.04;
      const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
      if (!isMe && d > VIS_D) continue;
      const a = this._anim(o, dt);
      const M = isMe && meM ? meM : this._botModel(o.sex === 'f' || (o.sex === undefined && this.meGear.sex === 'f') ? 'f' : 'm', a.h % 3 === 0 ? 1 : 0);
      // cap, inclinaison dans les virages, pente
      const q2 = path.sample(o.s + 2, this._pq2);
      const yaw0 = Math.atan2(q.tx, q.tz), yaw1 = Math.atan2(q2.tx, q2.tz);
      let dyaw = yaw1 - yaw0; if (dyaw > Math.PI) dyaw -= 2 * Math.PI; if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      const kappa = dyaw / 2;
      const latV = dt > 0 ? (lat - a.latPrev) / dt : 0;
      a.latPrev = lat;
      const v = Math.max(0, o.v || 0);
      a.steer += (Math.atan2(latV, Math.max(2, v)) - a.steer) * (1 - Math.exp(-dt * 4));
      const rollT = -Math.atan(v * v * kappa / 9.81) - a.steer * 0.8;
      a.roll += (Math.max(-0.6, Math.min(0.6, rollT)) - a.roll) * (1 - Math.exp(-dt * 6));
      const sway = Math.sin(a.crank) * 0.12 * a.stand;
      this._e.set(-Math.atan(q.grade), yaw0 + a.steer, a.roll + sway);
      this._q.setFromEuler(this._e);
      this._m.compose(this._p.set(x, y, z), this._q, this._s);
      // pose du corps → texture des os
      this._pose(M, a, row);
      const look = [];
      const col = hex(o.color || '#6f6d66');
      const acc = isMe ? hex('#1d1a2b') : accentOf(col, a.h);
      const helmet = isMe ? col : (a.h % 2 ? [0.9, 0.9, 0.9] : col);
      const pat = isMe ? 1 : TEAM_PATTERNS[a.h % TEAM_PATTERNS.length];
      look.push(helmet[0], helmet[1], helmet[2], pat);
      const sk = SKINS[a.h % SKINS.length];
      const vals = { aJersey: col, aAccent: acc, aLook: look, aSkinRow: [sk[0], sk[1], sk[2], row] };
      const lod = isMe || !M.mid ? M.fine : d < FINE_D && M.fine.n < M.fine.cap ? M.fine : d < MID_D ? M.mid : M.coarse;
      lod.push(this._m, vals);
      // vélo : cadre, roues, pédalier ; au loin, un seul maillage allégé
      const paint = isMe ? hex(o.bikeColor || '#22252b') : col, paint2 = isMe ? col : acc;
      const pv = { aPaint: paint, aPaint2: paint2 };
      if (!isMe && M.bikeFar && d > MID_D) { M.bikeFar.push(this._m, pv); o._lean = a.roll; row++; continue; }
      M.bike.push(this._m, pv);
      const L = M.layout;
      this._m2.makeRotationX(a.wheel).setPosition(L.frontAxle);
      M.front.push(this._m2.premultiply(this._m), pv);
      this._m2.makeRotationX(a.wheel).setPosition(L.rearAxle);
      M.rear.push(this._m2.premultiply(this._m), pv);
      this._m2.makeRotationX(a.crank).setPosition(L.BB);
      M.crank.push(this._m2.premultiply(this._m), pv);
      o._lean = a.roll;
      if (isMe) {
        const night = this.world.atmo && this.world.atmo.night !== undefined ? this.world.atmo.night : 0;
        this.lamp.intensity = 45 * night;
        this.lamp.position.set(0, 1.0, 0.75).applyMatrix4(this._m);
        this.lamp.target.position.set(0, 0, 14).applyMatrix4(this._m);
      }
      row++;
    }
    this.boneTex.needsUpdate = true;
    for (const M of this.models.values()) for (const b of [M.fine, M.mid, M.coarse, M.bike, M.bikeFar, M.front, M.rear, M.crank]) if (b) b.end();
    this._updateCrowd(cam);
    // vue cycliste : on ne dessine pas son propre corps (la tête cacherait la route)
    if (meM) meM.fine.mesh.visible = this.cameraMode !== 'rider';
  }

  _pose(M, a, row) {
    const S = M.plans.seat, T = M.plans.stand;
    const st = a.stand, tk = a.tuck * (1 - st) * (S.tuckK || 1);
    const lerpV = (p, q, t) => p.clone().lerp(q, t);
    const P = {
      pelvis: lerpV(S.pelvis, T.pelvis, st), shoulder: lerpV(S.shoulder, T.shoulder, st),
      hands: [lerpV(S.hands[0], T.hands[0], st), lerpV(S.hands[1], T.hands[1], st)],
      elbows: S.elbows && st < 0.5 ? S.elbows : null,
    };
    if (tk > 0.01) {
      // recroquevillé : le bassin bascule en avant sur la selle (il ne descend presque pas), les épaules descendent sur le cintre
      P.pelvis.y -= 0.012 * tk; P.pelvis.z += 0.025 * tk; P.shoulder.y -= 0.15 * tk; P.shoulder.z += 0.075 * tk;
      if (S.drops) { P.hands[0].lerp(S.drops[0], tk); P.hands[1].lerp(S.drops[1], tk); }
    }
    // le haut du corps d'un coureur reste presque immobile assis ; en danseuse, il monte et descend à chaque coup de pédale
    const bob = Math.sin(a.crank * 2) * (0.003 + 0.007 * st);
    P.pelvis.y += bob; P.shoulder.y += bob * 0.6;
    const sw = -Math.sin(a.crank) * 0.08 * st;
    P.pelvis.x += sw; P.shoulder.x += sw * 1.4;
    // le bassin bascule un peu sur la selle : la hanche de la jambe qui pousse descend
    const J = joints(P, a.crank, M.layout.BB, M.morph, { look: a.steer * 0.25, roll: 0.03 * Math.cos(a.crank) * (1 - st), stand: st });
    const ends = boneEnds(J);
    const D = this.boneData, base = row * NB * 16;
    for (let b = 0; b < NB; b++) {
      const [p, q, lat] = ends[b];
      boneFrame(p, q, lat, this._m2, b === 2 ? a.steer * 0.25 : 0);
      this._m2.multiply(M.restInv[b]);
      this._m2.toArray(D, base + b * 16);
    }
  }

  /** Public au bord de la route (roadside.js) : [{x, y, z, yaw, up (bras levés)}] ; dessiné près de la caméra. */
  addCrowd(list) {
    this.crowdList = list || [];
    if (!this.crowdList.length) return;
    // os de la ligne du public à l'identité : chacun reste dans sa pose de référence (debout)
    const D = this.boneData, base = CROWD_ROW * NB * 16, I = new THREE.Matrix4().toArray();
    for (let b = 0; b < NB; b++) D.set(I, base + b * 16);
    this.boneTex.needsUpdate = true;
    const bodyAttrs = [['aJersey', 3], ['aAccent', 3], ['aLook', 4], ['aSkinRow', 4]];
    this.crowdModels = [['m', false], ['m', true], ['f', false]].map(([sex, up]) => {
      const J = standingJoints(sex, up);
      const geo = buildBody(J, { helmet: 'none', glasses: 'none', clothing: 'loose', socks: 'short', shoes: 'flat', sex }, 0.026);
      renameSkin(geo);
      return new Batch(this.group, geo, this.bodyMat, this.bodyDepth, 900, bodyAttrs);
    });
    this._crowdAt = new THREE.Vector3(1e9, 0, 0);
  }

  _updateCrowd(cam) {
    if (!this.crowdModels || cam.distanceToSquared(this._crowdAt) < 64) return;
    this._crowdAt.copy(cam);
    const T = this.world.terrain;
    for (const b of this.crowdModels) b.begin();
    const R2 = 240 * 240, m = this._m, q = this._q, up = new THREE.Vector3(0, 1, 0);
    let near = 0;
    for (let i = 0; i < this.crowdList.length; i++) {
      const c = this.crowdList[i];
      const dx = c.x - cam.x, dz = c.z - cam.z;
      if (dx * dx + dz * dz > R2) continue;
      if (dx * dx + dz * dz < 1600) near++;
      if (c.gy === undefined) { const h = T.heightAt(c.x, c.z); if (h === null) continue; c.gy = Math.max(h, c.y - 1.5); }
      const h = hashStr('p' + i);
      const b = this.crowdModels[c.up ? 1 : h % 4 === 0 ? 2 : 0];
      q.setFromAxisAngle(up, c.yaw);
      m.compose(this._p.set(c.x, c.gy, c.z), q, this._s.set(1, 0.94 + (h % 13) / 100, 1));
      const shirt = CROWD_COLORS[h % CROWD_COLORS.length];
      const sk = SKINS[(h >>> 3) % SKINS.length];
      b.push(m, { aJersey: shirt, aAccent: shirt, aLook: [0.1, 0.1, 0.1, 0], aSkinRow: [sk[0], sk[1], sk[2], CROWD_ROW] });
    }
    for (const b of this.crowdModels) b.end();
    this.crowdNear = near;
  }

  /** Position du joueur pour la caméra (vue cycliste : la tête). */
  focusOf(id) {
    const a = this.state.get(id);
    return a ? { lean: a.roll } : { lean: 0 };
  }
}

const CROWD_COLORS = ['#c8102e', '#f2c230', '#ffffff', '#1f5fbf', '#2f8f5a', '#e8e4dc', '#222222', '#ff7a1a', '#7a2a8c', '#9fc5e8', '#f4a6c0', '#556b2f'].map((c) => hex(c));

/** Articulations d'un spectateur debout (face à +z), bras le long du corps ou levés. */
function standingJoints(sex, up) {
  const f = sex === 'f', s = f ? 0.95 : 1;
  const J = {
    pelvis: new THREE.Vector3(0, 0.95 * s, 0), chest: new THREE.Vector3(0, 1.2 * s, 0.0), neck: new THREE.Vector3(0, 1.45 * s, -0.005),
    head: new THREE.Vector3(0, 1.6 * s, 0.015),
  };
  for (const [k, sx] of [['L', -1], ['R', 1]]) {
    J['sh' + k] = new THREE.Vector3(sx * (f ? 0.17 : 0.19), 1.41 * s, -0.01);
    if (up) { J['el' + k] = new THREE.Vector3(sx * 0.3, 1.66 * s, 0.03); J['wr' + k] = new THREE.Vector3(sx * 0.34, 1.92 * s, 0.05); J['hd' + k] = new THREE.Vector3(sx * 0.35, 2.02 * s, 0.05); }
    else { J['el' + k] = new THREE.Vector3(sx * 0.23, 1.13 * s, -0.02); J['wr' + k] = new THREE.Vector3(sx * 0.25, 0.88 * s, 0.03); J['hd' + k] = new THREE.Vector3(sx * 0.26, 0.79 * s, 0.04); }
    J['hip' + k] = new THREE.Vector3(sx * 0.09, 0.92 * s, 0.01);
    J['kn' + k] = new THREE.Vector3(sx * 0.1, 0.5 * s, 0.03);
    J['an' + k] = new THREE.Vector3(sx * 0.1, 0.09, -0.01);
    J['toe' + k] = new THREE.Vector3(sx * 0.11, 0.09, 0.14);   // l'os du pied est parallèle à la semelle : pied à plat
  }
  return J;
}

function renameSkin(g) {
  g.setAttribute('aSkinI', new THREE.Float32BufferAttribute(Float32Array.from(g.attributes.skinIndex.array), 4));
  g.setAttribute('aSkinW', g.attributes.skinWeight);
  g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
}

function accentOf(c, h) {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (h % 3 === 0) return [0.85, 0.85, 0.83];
  return l > 0.3 ? [0.02, 0.02, 0.025] : [0.85, 0.85, 0.83];
}

function hashStr(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
