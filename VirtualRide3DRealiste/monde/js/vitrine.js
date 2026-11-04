/* Virtual Ride 3D Réaliste — vitrine (vitrine.html) : le vélo et le cycliste réalistes, équipés comme ils rouleront dans la course,
   pédalent sur place dans un studio photo (fond uni de la couleur de la page, éclairage doux de studio, ombre au sol). On tourne
   autour en glissant (souris ou doigt), on s'approche à la molette ou en pinçant, un double-clic revient à la vue de départ ; sans
   geste, la caméra tourne doucement. Même protocole que la vitrine de Bike3D (VirtualRide3D/univers/js/showroom.js) :
     PaceYourRide → vitrine : gear {gear, color, bg, dark, rider} ; run {on}
     vitrine → PaceYourRide : hello {view: 'showroom'} ; status {state: 'ready'}
   Ouverte seule, elle lit l'équipement dans l'adresse : vitrine.html?frame=tt&wheels=disc&position=tt_pro&helmet=tt&sex=f… */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Riders } from './riders.js';
import { QUALITY } from './engine.js';

const V = 1;
const TARGET = new THREE.Vector3(0, 0.95, 0.02);
const HOME = { yaw: -1.08, pitch: 0.18, dist: 3.1 };
const $ = (id) => document.getElementById(id);

const S = {
  running: true, yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, idle: 0, got: false, announce: false,
  color: '#eb6834', gear: { frame: 'alu', wheels: 'alu' }, rider: true,
};

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;
// lumière principale de studio (boîte à lumière au-dessus, de trois quarts) et contre-jour
const key = new THREE.DirectionalLight('#fff6ea', 2.6);
key.position.set(2.2, 4.2, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1.6; key.shadow.camera.right = 1.6; key.shadow.camera.top = 2.2; key.shadow.camera.bottom = -0.4;
key.shadow.bias = -0.0002; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#dfe8ff', 1.4);
rim.position.set(-2.5, 2.2, -3);
scene.add(rim);
// sol et fond (cyclorama) : la couleur de la page
const floorMat = new THREE.MeshStandardMaterial({ color: '#e6e6e4', roughness: 0.92 });
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), floorMat);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
// home-trainer : pieds, bloc de résistance, cale de la roue avant
const trainerMat = new THREE.MeshPhysicalMaterial({ color: '#1c1d20', roughness: 0.45, clearcoat: 0.6 });
const trainer = new THREE.Group();
const legs = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.07), trainerMat); legs.position.set(0, 0.02, -0.5); trainer.add(legs);
for (const sx of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.36, 0.05), trainerMat); arm.position.set(sx * 0.11, 0.2, -0.5); arm.rotation.z = sx * 0.25; trainer.add(arm); }
const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 24), new THREE.MeshStandardMaterial({ color: '#5a5d63', metalness: 1, roughness: 0.3 }));
drum.rotation.z = Math.PI / 2; drum.position.set(0, 0.06, -0.38); trainer.add(drum);
const block = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.3), trainerMat); block.position.set(0, 0.025, 0.57); trainer.add(block);
trainer.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
scene.add(trainer);

// le cycliste, avec le rendu des coureurs (riders.js) sur une « route » immobile
const engine = { renderer, scene, camera, Q: QUALITY.haute, prepare: (m) => m, csm: null };
const world = {
  engine, atmo: { u: { uWet: { value: 0 } } },
  path: { sample: (s, o) => Object.assign(o || {}, { x: 0, y: -0.04, z: 0, tx: 0, tz: 1, rx: 1, rz: 0, grade: 0, curv: 0 }) },
  terrain: { heightAt: () => 0 }, halfAt: () => 3,
};
let riders = null, gearKey = '';

function setGear(g) {
  const gear = Object.assign({ frame: 'alu', wheels: 'alu' }, g || {});
  const key2 = JSON.stringify(gear);
  if (key2 === gearKey) return;
  gearKey = key2;
  if (!riders) riders = new Riders(world, { me: { gear }, noBots: true });
  else riders.setGear(gear);
}

function setBg(hex, dark) {
  const c = new THREE.Color(hex);
  scene.background = c;
  document.body.style.background = hex;
  document.body.classList.toggle('dark', !!dark);
  floorMat.color.copy(c).offsetHSL(0, 0, dark ? 0.04 : -0.05);
}

function setRider(v) { S.rider = !!v; $('btn-rider').setAttribute('aria-pressed', String(S.rider)); }

/* ---------------------------------------------------------------- caméra en orbite */

function placeCamera() {
  const d = S.dist;
  camera.position.set(TARGET.x + Math.sin(S.yaw) * Math.cos(S.pitch) * d, TARGET.y + Math.sin(S.pitch) * d, TARGET.z + Math.cos(S.yaw) * Math.cos(S.pitch) * d);
  camera.lookAt(TARGET);
}

function bindInput() {
  let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: S.yaw, pitch: S.pitch }; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); S.idle = 0; $('hint').classList.add('off'); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || pinch) return;
    S.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
    S.pitch = Math.max(-0.05, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.006));
    S.idle = 0;
  });
  const end = () => { drag = null; canvas.classList.remove('drag'); };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); S.dist = Math.max(1.3, Math.min(6, S.dist * (1 + Math.sign(e.deltaY) * 0.1))); S.idle = 0; }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) { pinch = null; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) S.dist = Math.max(1.3, Math.min(6, pinch.dist * pinch.d / d));
    else pinch = { d, dist: S.dist };
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', () => { pinch = null; });
  canvas.addEventListener('dblclick', () => { S.yaw = HOME.yaw; S.pitch = HOME.pitch; S.dist = HOME.dist; S.idle = 0; });
  $('btn-reset').addEventListener('click', () => { S.yaw = HOME.yaw; S.pitch = HOME.pitch; S.dist = HOME.dist; });
  $('btn-rider').addEventListener('click', () => setRider(!S.rider));
}

function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------- messages */

const host = window.parent !== window ? window.parent : window.opener;
function post(msg) { if (!host) return; try { host.postMessage(Object.assign({ pyr3d: V }, msg), '*'); } catch (e) { /* fenêtre fermée */ } }
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.pyr3d !== V || typeof m.type !== 'string') return;
  if (host && e.source !== host) return;
  if (m.type === 'gear') {
    S.got = true;
    if (typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color)) S.color = m.color;
    if (typeof m.bg === 'string' && /^#[0-9a-f]{6}$/i.test(m.bg)) setBg(m.bg, !!m.dark);
    if (typeof m.rider === 'boolean') setRider(m.rider);
    setGear(m.gear || {});
    S.announce = true;
  } else if (m.type === 'run') {
    S.running = m.on !== false;
    lastT = performance.now();
  }
});

/* ---------------------------------------------------------------- démarrage */

const q = new URLSearchParams(location.search);
if (q.get('color')) S.color = q.get('color');
setBg(q.get('bg') || '#ebebea', q.get('dark') === '1');
if (q.get('rider') === '0') setRider(false);
const fromUrl = {};
for (const k of ['frame', 'wheels', 'tire', 'position', 'helmet', 'clothing', 'glasses', 'socks', 'shoes', 'sex']) if (q.get(k)) fromUrl[k] = q.get(k);
setGear(Object.keys(fromUrl).length || !host ? Object.assign({ frame: 'alu', wheels: 'alu' }, fromUrl) : S.gear);
bindInput();
window.addEventListener('resize', resize);
resize();
if (host) { const hello = () => { if (!S.got) { post({ type: 'hello', view: 'showroom' }); setTimeout(hello, 1000); } }; hello(); }

let lastT = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!S.running || !riders) return;
  S.idle += dt;
  if (S.idle > 4) S.yaw += dt * 0.12;
  placeCamera();
  riders.set([{ id: 'me', name: 'Toi', color: S.color, kind: 'avatar', s: 0, lat: 0, v: 9, P: 220 }], 'me');
  riders.update(dt, camera);
  // vélo seul : le corps (tous niveaux de détail) caché
  for (const M of riders.models.values()) for (const b of [M.fine, M.mid, M.coarse]) if (b) b.mesh.visible = S.rider;
  renderer.render(scene, camera);
  if (S.announce) { S.announce = false; post({ type: 'status', state: 'ready' }); }
});
