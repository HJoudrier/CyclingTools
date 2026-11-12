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
  for (const cls of ['h3-steer', 'h3-seg', 'h3-drive', 'h3-brake', 'h3-tiltbtn']) assert.ok(CSS.includes('.' + cls), cls);
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

test('éléments du HUD : ceux du menu « Affichage » sont ceux de l\'état par défaut, tous affichés sauf le temps et la météo', () => {
  const widgets = idsOf('WIDGETS');
  const m = read('Commun/js/core/store.js').match(/hud3d: \{([^}]+)\}/);
  assert.ok(m, 'ui.hud3d dans store.js');
  const def = Object.fromEntries([...m[1].matchAll(/(\w+): (true|false)/g)].map((x) => [x[1], x[2] === 'true']));
  assert.deepEqual(Object.keys(def).sort(), widgets.slice().sort());
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
