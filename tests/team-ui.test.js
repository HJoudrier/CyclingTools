/* author : Hugo Joudrier-Faure */
/* Mode équipe, interface : le câblage des pages (étape « Équipe » de chaque page de choix, panneau des coureurs de chaque écran de course),
 * des scripts, des styles et de l'état par défaut. (Le comportement est testé dans team-game.test.js ; l'interface a été vérifiée dans Chromium.) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APPS = ['VirtualRide2D', 'VirtualRide3D', 'VirtualRide3DRealiste'];

test('pages de choix : l\'étape « Équipe » (deux modes, zone de l\'équipe, note), la feuille de style', () => {
  for (const app of APPS) {
    const html = read(`${app}/index.html`);
    assert.match(html, /id="gs-team-sec"/, app);
    assert.match(html, /data-team-mode="solo"/, app);
    assert.match(html, /data-team-mode="team"/, app);
    assert.match(html, /id="gs-team"/, app);
    assert.match(html, /id="gs-team-note"/, app);
    assert.match(html, /css\/team\.css/, app);
  }
});

test('écrans de course : le panneau des coureurs de l\'équipe, masqué par défaut, et la feuille de style', () => {
  for (const app of APPS) {
    const html = read(`${app}/course.html`);
    assert.match(html, /<section class="team-panel" id="team-panel"[^>]*hidden/, app);
    assert.match(html, /css\/team\.css/, app);
  }
});

test('chargeur : les modules du mode équipe sont chargés, le moteur avant les écrans', () => {
  const boot = read('Commun/js/boot.js');
  const at = (f) => boot.indexOf(`Commun/js/${f}`);
  for (const f of ['engine/team-game.js', 'jeu/team-setup.js', 'jeu/team-panel.js']) assert.ok(at(f) > 0, f);
  assert.ok(at('engine/pros.js') < at('engine/team-game.js'), 'pros.js avant team-game.js');
  assert.ok(at('engine/strategy.js') < at('engine/race.js'));
  assert.ok(at('engine/team-game.js') < at('jeu/team-setup.js') && at('jeu/team-setup.js') < at('jeu/tab-game.js'));
  assert.ok(at('jeu/team-panel.js') < at('jeu/tab-game.js'));
});

test('état : la configuration d\'équipe par défaut (mode désactivé) et son rechargement quand elle change', () => {
  assert.match(read('Commun/js/core/store.js'), /team: \{ on: false, team: '', riders: \[\], plans: \{\}, opp: 9, size: 8 \}/);
  assert.match(read('Commun/js/jeu/tab-game.js'), /pullSec\|peloton\|strategy\|team\|source/);
  assert.match(read('Commun/js/app.js'), /#gs-team-sec/);
});

test('feuille de style : les classes que dessinent les modules existent', () => {
  const css = read('Commun/css/team.css');
  const js = read('Commun/js/jeu/team-setup.js') + read('Commun/js/jeu/team-panel.js');
  for (const cls of new Set([...js.matchAll(/class: '([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^(tg|tp)-/.test(c)))) {
    assert.ok(css.includes('.' + cls), `.${cls}`);
  }
});
