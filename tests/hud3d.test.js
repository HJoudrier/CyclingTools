/* author : Hugo Joudrier-Faure */
/* Course 3D (cartoon), écran de jeu plein écran et HUD superposé (Commun/js/jeu/hud3d.js) : le câblage des pages, des scripts, des styles,
 * de l'état par défaut et du niveau de réalisme. (Le moteur est testé dans arcade.test.js et team-orders.test.js ; l'écran a été vérifié dans
 * Chromium, sur grand écran et sur téléphone.) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PYR } = require('./helpers.js');
require(path.join(__dirname, '..', 'Commun', 'js', 'jeu', 'view3d.js'));

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HUD = read('Commun/js/jeu/hud3d.js');
const CSS = read('Commun/css/hud3d.css');
/** Identifiants d'une liste du module (« const NAME = [ { id: '…' … } ] »). */
const idsOf = (name) => {
  const block = HUD.slice(HUD.indexOf(`const ${name} = [`), HUD.indexOf('];', HUD.indexOf(`const ${name} = [`)));
  return [...block.matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]);
};

test('écrans de course : seul Course 3D (cartoon) a l\'écran plein écran et son HUD', () => {
  const v3 = read('VirtualRide3D/course.html');
  assert.match(v3, /<body[^>]*data-hud="overlay"/);
  assert.match(v3, /css\/hud3d\.css/);
  for (const app of ['VirtualRide2D', 'VirtualRide3DRealiste']) {
    const html = read(`${app}/course.html`);
    assert.doesNotMatch(html, /data-hud=/, app);
    assert.doesNotMatch(html, /hud3d\.css/, app);
  }
});

test('chargeur : steer-input.js puis hud3d.js ne sont chargés que pour Course 3D, après les écrans de jeu ; steer.js avec le moteur', () => {
  const boot = read('Commun/js/boot.js');
  const lines = boot.split('\n').filter((l) => l.includes('hud3d.js') && !l.trim().startsWith('//'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\s*jeu3d:/);
  assert.match(lines[0], /GAME_UI, \['Commun\/js\/jeu\/steer-input\.js', 'Commun\/js\/jeu\/hud3d\.js'\]/);
  assert.equal(boot.split('\n').filter((l) => l.includes('steer-input.js') && !l.trim().startsWith('//')).length, 1);
  assert.ok(boot.indexOf('engine/steer.js') > 0 && boot.indexOf('engine/steer.js') < boot.indexOf('engine/peloton.js'));
});

test('trajectoire : réglage, page de choix, vignette, touches, messages de la vue 3D, bas-côté dans la vue', () => {
  assert.match(read('Commun/js/core/store.js'), /steer: 'auto',/);
  const page = read('VirtualRide3D/index.html');
  for (const v of ['auto', 'manual']) assert.match(page, new RegExp(`<option value="${v}">`));
  assert.doesNotMatch(page, /<option value="wide">/);
  assert.match(read('Commun/js/core/store.js'), /if \(state\.game\.steer === 'wide'\) state\.game\.steer = 'auto';/);
  assert.match(page, /data-bind="game\.steer"/);
  assert.deepEqual([...HUD.slice(HUD.indexOf('const STEERS = ['), HUD.indexOf('];', HUD.indexOf('const STEERS = ['))).matchAll(/\{ id: '([a-z]+)'/g)].map((m) => m[1]), ['auto', 'manual']);
  assert.match(HUD, /kl === 'v'/);
  assert.match(HUD, /kl === 'f' \|\| \(T\.steerMode\(\) === 'manual' && \(k === 'ArrowLeft' \|\| k === 'ArrowRight'\)\)/);
  for (const cls of ['h3-steer', 'h3p-traj', 'h3-drive', 'h3-brake', 'h3-tiltbtn']) assert.ok(CSS.includes('.' + cls), cls);
  const v3 = read('Commun/js/jeu/view3d.js');
  for (const t of ['keyup', 'pad', 'vr']) assert.match(v3, new RegExp(`m\\.type === '${t}'`));
  assert.match(v3, /xr-spatial-tracking; gamepad/);
  const br = read('VirtualRide3D/univers/js/bridge.js');
  assert.match(br, /meO\.free \? R\.half \+ 1\.5/);
  assert.match(br, /type: 'keyup'/);
  assert.match(br, /type: 'pad', src: 'vr'/);
  assert.match(read('VirtualRide3D/univers/js/vr.js'), /g\.state === 'pyr'/);
  const tg = read('Commun/js/jeu/tab-game.js');
  for (const fn of ['setSteer(mode)', 'toggleSteer()', 'applySteer()', 'steerFrame(dtReal, dtSim)', 'setVrLoop(on)', 'padAction(act, extra)']) assert.ok(tg.includes(`    ${fn} {`), fn);
});

test('actions des vignettes : chacune est un ordre du moteur (ou manger), avec une touche distincte', () => {
  const acts = idsOf('ACTIONS');
  assert.deepEqual(acts, ['moveup', 'attack', 'cover', 'sprint', 'front', 'relay', 'follow', 'eat']);
  for (const a of acts) if (a !== 'eat') assert.ok(PYR.race.ORDER_MODES.includes(a), a);
  const keys = [...HUD.slice(HUD.indexOf('const ACTIONS = ['), HUD.indexOf('const ICON')).matchAll(/key: '(.)'/g)].map((m) => m[1]);
  assert.equal(keys.length, 7, 'Sprinter jusqu\'à la ligne n\'a pas de touche');
  assert.equal(new Set(keys).size, 7);
  // les touches de tactique communes aux jeux ne changent pas : celles du HUD reprennent 6, 8, 9 et S ; 7 accélère (appuis répétés)
  for (const k of ['6', '8', '9', 'S']) assert.ok(keys.includes(k), k);
  assert.match(HUD, /if \(k === '7'\) \{ T\.sprintTap\(\);/);
  for (const id of ['moveup', 'front']) assert.ok(PYR.tactics.LABELS[id], id);
});

test('éléments du HUD : ceux du menu « Affichage » (éléments, sensations) sont ceux de l\'état par défaut, tous actifs sauf le temps et la météo', () => {
  const widgets = idsOf('WIDGETS'), feel = [...HUD.slice(HUD.indexOf('const FEEL = ['), HUD.indexOf('];', HUD.indexOf('const FEEL = ['))).matchAll(/\{ id: '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(feel, ['redEdge', 'markers', 'breath', 'vibe', 'guide']);
  const m = read('Commun/js/core/store.js').match(/hud3d: \{([^}]+)\}/);
  assert.ok(m, 'ui.hud3d dans store.js');
  const def = Object.fromEntries([...m[1].matchAll(/(\w+): (true|false)/g)].map((x) => [x[1], x[2] === 'true']));
  assert.deepEqual(Object.keys(def).sort(), widgets.concat(feel).sort());
  for (const f of feel) assert.equal(def[f], true, f);
  assert.equal(def.time, false);
  assert.equal(def.wx, false);
  for (const w of widgets) assert.ok(w === 'banner' || CSS.includes(`.h3-w-${w}`), `.h3-w-${w}`);
  for (const w of widgets) assert.ok(CSS.includes(`data-h3-off~="${w}"`), `masquer ${w}`);
});

test('feuille de style : les classes h3-* que dessine le module existent', () => {
  const used = new Set([...HUD.matchAll(/class(?:Name)?: '([^']+)'/g)].flatMap((x) => x[1].split(/\s+/)).filter((c) => /^h3-/.test(c)));
  used.add('h3-paged'); used.add('h3-team'); // posées par classList.toggle
  assert.ok(used.size > 20);
  for (const cls of used) assert.ok(CSS.includes('.' + cls), `.${cls}`);
});

test('téléphone en paysage : haut et bas (maquette D), radio d\'équipe et liste d\'actions en une colonne (F), paysage demandé', () => {
  // la couche du téléphone n'apparaît qu'en mode « phone » ; elle remplace les vignettes, le défileur et l'ancienne cellule Frein
  assert.match(CSS, /\.h3\[data-mode="phone"\] \.h3p \{ display: block;/);
  assert.match(CSS, /\.h3\[data-mode="phone"\] \.h3-dock,/);
  assert.match(HUD, /if \(S\.mode === 'phone'\) \{ renderPhone\(s\); return; \}/);
  // les éléments : équipe, trajectoire, ◀ ▶, éclair, cœur, Freiner, Accélérer (tapoté), effort, aspiration, aérobie, anaérobie
  for (const cls of ['h3p-tl', 'h3p-top', 'h3p-nav', 'h3p-heart', 'h3p-brake', 'h3p-accel', 'h3p-low', 'h3p-draft', 'h3p-aer', 'h3p-ana', 'h3p-pop-acts', 'h3p-pop-team', 'h3p-rotate'])
    assert.ok(HUD.includes(cls) && CSS.includes('.' + cls), cls);
  for (const k of ['team', 'bolt', 'radio', 'accel', 'rotate']) assert.match(HUD, new RegExp(`\\n    ${k}: \\[`), k);
  assert.match(HUD, /P\.accel\.addEventListener\('pointerdown', \(e\) => \{ if \(e\.cancelable\) e\.preventDefault\(\); T\.sprintTap\(\);/);
  assert.match(HUD, /PYR\.steerInput\.setBrakeButton\(on\)/);
  assert.match(HUD, /T\.nearRider\(dir\)/);
  // actions du coureur actif, toutes (une colonne), et l'équipe : un toucher pilote le coureur
  assert.match(HUD, /for \(const a of ACTIONS\) \{\n\s+const on = /);
  assert.match(HUD, /onclick: \(\) => \{ T\.switchRider\(r\.id\); togglePop\(null\);/);
  // paysage : plein écran et verrouillage au premier toucher, message en portrait
  assert.match(HUD, /o\.lock\('landscape'\)/);
  assert.match(CSS, /@media \(orientation: portrait\) \{\n\s+\.h3\[data-mode="phone"\] \.h3p-rotate/);
});

test('sensations (maquette I) : bord rouge et cœur au rythme de la FC, vibrations, marqueurs touchables, respiration', () => {
  assert.match(HUD, /P\.root\.style\.setProperty\('--beat'/);
  assert.match(HUD, /U\.clamp\(\(EDGE_FROM - s\.wf\) \/ EDGE_FROM, 0, 1\)/);
  assert.match(CSS, /\.h3p-edge\.on::after \{ animation: h3p-pulse var\(--beat\)/);
  assert.match(CSS, /\.h3p-heart\.beat \{ animation: h3p-heart var\(--beat\)/);
  assert.match(HUD, /navigator\.vibrate\(pattern\)/);
  assert.match(HUD, /if \(w\.id === 'vibe' && !canVibrate\(\)\) continue;/);
  // la vue 3D : réglages dans la trame, marqueurs (message « pick »), respiration
  const V3 = PYR.view3d;
  const f = V3.frameMessage({ t: 1, me: { id: 'a', s: 10, v: 9, hr: 151.4, e: 0.8, own: true }, others: [{ id: 'b', s: 12, own: true, e: 0.5, w: 0.25 }, { id: 'c', s: 3 }], fx: { mk: true, br: false } });
  assert.deepEqual(f.fx, { mk: 1, br: 0 });
  assert.equal(f.riders[0].hr, 151);
  assert.equal(f.riders[1].own, 1);
  assert.equal(f.riders[1].w, 0.25);
  assert.equal(f.riders[2].own, undefined);
  assert.equal(V3.frameMessage({ t: 0, me: { id: 'a' }, others: [] }).fx, undefined);
  assert.match(read('Commun/js/jeu/view3d.js'), /m\.type === 'pick'/);
  const br = read('VirtualRide3D/univers/js/bridge.js');
  assert.match(br, /this\.post\(\{ type: 'pick', id: el\.dataset\.id \}\)/);
  assert.match(br, /g\.sound\.breathe\(dt, this\.breathOf\(\)\)/);
  assert.match(read('VirtualRide3D/univers/js/game.js'), /if \(this\.ext\.overlay\) this\.ext\.overlay\(\);/);
  assert.match(br, /\n    overlay\(\) \{\n      this\.drawGuide\(\);\n      this\.marks\(\);/);
  assert.match(read('VirtualRide3D/univers/js/audio.js'), /\n    breathe\(dt, B\) \{/);
  assert.match(read('VirtualRide3D/univers/css/style.css'), /\.pyr-mark \{/);
});

test('aide à la trajectoire : calculée en trajectoire manuelle, envoyée dans la trame, dessinée en chevrons dans la vue', () => {
  const tg = read('Commun/js/jeu/tab-game.js');
  assert.match(tg, /me\.lat && me\.lat\.manual && !me\.incident && !me\.finished && \(PYR\.hud3d\.fx\(\) \|\| \{\}\)\.gd/);
  assert.match(tg, /PYR\.steer\.guide\(G\.ctx\.course, me\.st\.s, \{ cond: me\.cond, maxHalf: me\.lat\.edgeMax \}\)/);
  const V3 = PYR.view3d;
  const f = V3.frameMessage({ t: 1, me: { id: 'a', s: 100 }, others: [], guide: { pts: [{ d: 4, s: 104, y: 1.234, v: 12.345 }, { d: 8, s: 108, y: 2, v: 11 }], corner: { d: 40, v: 9.87 } } });
  assert.deepEqual(f.guide, { s0: 100, pts: [[4, 1.23, 12.35], [8, 2, 11]], corner: [40, 9.87] });
  assert.equal(V3.frameMessage({ t: 1, me: { id: 'a' }, others: [], guide: { pts: [], corner: null } }).guide, undefined);
  const br = read('VirtualRide3D/univers/js/bridge.js');
  assert.match(br, /new THREE\.InstancedMesh\(geo, mat, 24\)/);
  assert.match(br, /mesh\.setColorAt\(n, tint\(v\)\)/);
  assert.match(br, /'Virage ' \+ kmh \+ ' km\/h' \+ \(fast \? ' · freine !' : ''\)/);
  assert.match(read('VirtualRide3D/univers/css/style.css'), /\.pyr-turn\.fast \{/);
});

test('trajectoire : un seul bouton « Traj. Auto », jaune (pressé) en automatique, qui bascule vers la manuelle', () => {
  assert.doesNotMatch(HUD, /h3p-seg|h3-seg|steerBtns/);
  assert.match(HUD, /onclick: \(e\) => \{ e\.stopPropagation\(\); T\.toggleSteer\(\); update\(true\); \}/);
  assert.match(HUD, /P\.steer = trajBtn\('h3p-traj', 'Traj\. Auto'\)/);
  assert.match(HUD, /P\.steer\.setAttribute\('aria-pressed', String\(T\.steerMode\(\) !== 'manual'\)\)/);
  assert.match(CSS, /\.h3p-traj\[aria-pressed="true"\] \{ background: var\(--h3-effort\)/);
});

test('réalité virtuelle : lancée depuis le menu (onglet Affichage), plus de bouton VR dans la vue intégrée', () => {
  const br = read('VirtualRide3D/univers/js/bridge.js');
  assert.match(br, /buildVR\(\) \{\n\s+if \(this\.embedded \|\| !this\.hostWin\) return;/);
  assert.match(br, /m\.cmd === 'vr'/);
  assert.match(br, /g\.vr\.enter\(\{ quiet: true \}\)\.then\(\(ok\) => \{ if \(!ok\) this\.armVR\(true\); \}\)/);
  assert.match(br, /vr: !!\(g\.vr && g\.vr\.supported\)/);
  const v3 = read('Commun/js/jeu/view3d.js');
  assert.match(v3, /vrSupported, enterVR,/);
  assert.match(HUD, /'Réalité virtuelle'/);
  assert.match(HUD, /PYR\.view3d\.enterVR\(\)/);
  assert.match(read('VirtualRide3D/univers/css/style.css'), /\.pyr-vrarm \{/);
});

test('niveau de réalisme : Arcade ou Simulation sur la page de choix de Course 3D, Arcade par défaut dans Course 3D seulement', () => {
  const html = read('VirtualRide3D/index.html');
  assert.match(html, /id="gs-realism"/);
  assert.match(html, /data-realism="arcade"/);
  assert.match(html, /data-realism="simulation"/);
  assert.match(read('Commun/js/jeu/game-setup.js'), /store\.set\('game\.realism'/);
  assert.match(read('Commun/js/core/store.js'), /realism: PYR\.appId === 'jeu3d' \? 'arcade' : 'simulation'/);
  assert.match(read('Commun/js/jeu/tab-game.js'), /physio\|realism\|pullSec\|peloton\|strategy\|team\|source/);
});

test('écran de course : tab-game.js et game-mobile.js passent au HUD (touches, montage, arrivée)', () => {
  const tg = read('Commun/js/jeu/tab-game.js');
  assert.match(tg, /PYR\.hud3d\.onKey\(e\)/);
  for (const fn of ['pctOf(r)', 'pctNow(r)', 'setPct(pct, r)', 'act(action, r)', 'eatFor(r)']) assert.ok(tg.includes(`    ${fn} {`), fn);
  const gm = read('Commun/js/jeu/game-mobile.js');
  for (const fn of ['PYR.hud3d.mount(mode)', 'PYR.hud3d.unmount()', 'PYR.hud3d.update(s)', 'PYR.hud3d.finished()', 'PYR.hud3d.init()']) assert.ok(gm.includes(fn), fn);
});
