/* author : Hugo Joudrier-Faure */
/* Aspiration au cœur d'un grand peloton : la traînée par position est comparée à la simulation de Blocken et al. (2018) —
 * 121 coureurs à 15 m/s en triangle (1, 2, … 10 de front, puis 9 et 10 en alternance sur 17 rangs), traînée rapportée à celle d'un coureur seul. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR } = require('./helpers.js');

const Pel = PYR.peloton;
const WIDTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 10, 9, 10, 9, 10, 9];

/** Traînée relative (k = 1 − R) de chacun des 121 coureurs : tableau de rangs, chaque rang du bord gauche au bord droit. */
function formation(rowGap = 2.1, lane = 0.6) {
  const list = [], at = [];
  let id = 0;
  WIDTHS.forEach((w, r) => {
    at[r] = [];
    for (let k = 0; k < w; k++) { list.push({ id, s: 1000 - r * rowGap, v: 15, y: (k - (w - 1) / 2) * lane, tb: 0 }); at[r].push(id++); }
  });
  const f = Pel.field(list);
  return at.map((ids) => ids.map((i) => f.get(i).k));
}

test('Blocken 2018 : 121 coureurs — le cœur ne subit que ≈ 5 % de la traînée seul au vent', () => {
  const g = formation();
  assert.equal(g.reduce((n, r) => n + r.length, 0), 121);
  for (let r = 10; r < 17; r++) {
    const mid = g[r].slice(2, g[r].length - 2);
    for (const k of mid) assert.ok(k >= 0.045 && k <= 0.09, `rang ${r + 1} : cœur ${k}`);
  }
});

test('Blocken 2018 : celui qui mène gagne ≈ 14 % devant un grand peloton (86 % de la traînée)', () => {
  const k = formation()[0][0];
  assert.ok(k > 0.82 && k < 0.92, `meneur ${k}`);
});

test('Blocken 2018 : les coureurs de flanc des premiers rangs gardent 50 à 70 % de la traînée', () => {
  const g = formation();
  for (let r = 3; r < 10; r++) {
    const edge = [g[r][0], g[r][g[r].length - 1]];
    for (const k of edge) assert.ok(k > 0.5 && k < 0.7, `rang ${r + 1} : flanc ${k}`);
  }
});

test('Blocken 2018 : l\'abri croît avec la profondeur et vers le centre ; le flanc arrière est bien plus abrité que le flanc avant', () => {
  const g = formation();
  const centre = (r) => g[r][Math.floor(g[r].length / 2)];
  for (let r = 1; r < 8; r++) assert.ok(centre(r) <= centre(r - 1) + 1e-9, `rang ${r + 1} pas plus exposé que ${r}`);
  for (let r = 4; r < 10; r++) assert.ok(g[r][1] < g[r][0], 'le second du bord est plus abrité que le coureur du bord');
  const rearFlank = Math.min(...[12, 14, 16].map((r) => Math.max(g[r][0], g[r][g[r].length - 1])));
  const frontFlank = g[6][0];
  assert.ok(rearFlank < 0.5 * frontFlank + 0.2, `flanc arrière ${rearFlank} vs flanc avant ${frontFlank}`);
});

test('un coureur seul ou en file indienne n\'est pas touché par le renfort du peloton', () => {
  const f = Pel.field([{ id: 'a', s: 100, v: 12, y: 0, tb: 0 }, { id: 'b', s: 97.5, v: 12, y: 0, tb: 0 }]);
  assert.ok(Math.abs(f.get('a').k - (1 - 0.03)) < 0.03 && f.get('a').k > 0.95, 'meneur d\'un duo : 2 à 4 %');
  assert.ok(f.get('b').k > 0.55 && f.get('b').k < 0.72, `suiveur direct ≈ −35 % (${f.get('b').k})`);
});
