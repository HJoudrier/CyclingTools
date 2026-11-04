/* author : Hugo Joudrier-Faure */
/* Tests du choix de la page Wikipédia d'un coureur (Commun/js/ui/pro-photo.js) : la bonne personne, avec photo, ou rien. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PYR } = require('./helpers.js');
require(path.join(__dirname, '..', 'Commun/js/ui/pro-photo.js'));
const PP = PYR.proPhoto;

const page = (index, title, description, thumb) => ({ pageid: index, index, title, description, thumbnail: thumb === false ? undefined : { source: 'https://upload.wikimedia.org/' + index + '.jpg' } });
const result = (...pages) => ({ query: { pages: Object.fromEntries(pages.map((p) => [p.pageid, p])) } });

test('photo des pros : la page d\'un cycliste au bon nom, avec photo ; jamais une autre personne', () => {
  assert.equal(PP.pick(result(page(1, 'Tadej Pogačar', 'coureur cycliste slovène')), 'Tadej Pogačar').title, 'Tadej Pogačar');
  // accents et casse ignorés, résultat le mieux classé
  assert.equal(PP.pick(result(page(2, 'Sepp Kuss', 'Cyclist'), page(1, 'Sepp Kuss (homonyme)', 'Road cyclist')), 'SEPP KUSS').index, 1);
  // pas de photo, pas de cyclisme dans la description, autre prénom : refusés
  assert.equal(PP.pick(result(page(1, 'Tadej Pogačar', 'coureur cycliste', false)), 'Tadej Pogačar'), null);
  assert.equal(PP.pick(result(page(1, 'Tadej Pogačar', 'chanteur')), 'Tadej Pogačar'), null);
  assert.equal(PP.pick(result(page(1, 'Jan Pogačar', 'coureur cycliste')), 'Tadej Pogačar'), null);
  assert.equal(PP.pick({}, 'Tadej Pogačar'), null);
  assert.equal(PP.pick(null, 'x y'), null);
});

test('photo des pros : requête vers Wikipédia français puis anglais, depuis le navigateur', () => {
  const fr = PP.searchUrl('fr', 'Wout van Aert'), en = PP.searchUrl('en', 'Wout van Aert');
  assert.match(fr, /^https:\/\/fr\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(en, /^https:\/\/en\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(fr, /gsrsearch=Wout%20van%20Aert%20cycliste/);
  assert.match(en, /gsrsearch=Wout%20van%20Aert%20cyclist/);
  assert.match(fr, /origin=\*/);
  assert.match(fr, /piprop=thumbnail/);
});
