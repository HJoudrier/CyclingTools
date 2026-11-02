/* author : Hugo Joudrier-Faure */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
const P = globalThis.PYR.pros, Ph = globalThis.PYR.physio;

const byName = (n) => P.all().find((x) => x.name === n);

test('coureurs World Tour : identifiants uniques, équipes et types connus, valeurs bornées', () => {
  const all = P.all();
  assert.ok(all.length >= 200, 'un peloton complet');
  assert.equal(new Set(all.map((x) => x.id)).size, all.length);
  for (const it of all) {
    const r = it.data.rider;
    assert.ok(P.TEAMS[it.pro.team], it.name + ' : équipe');
    assert.ok(P.TYPES[it.pro.type], it.name + ' : type');
    assert.ok(r.weight >= 55 && r.weight <= 90 && r.height >= 160 && r.height <= 200, it.name + ' : morphologie');
    assert.ok(r.cp / r.weight >= 4.8 && r.cp / r.weight <= 7.1, it.name + ' : PC en W/kg');
    assert.ok(r.pmax / r.weight >= 13 && r.pmax / r.weight <= 26, it.name + ' : Pmax en W/kg');
    assert.ok(r.wPrime >= 12 && r.wPrime <= 40, it.name + ' : W′');
    assert.ok(r.ftp < r.cp && r.ftp > 0.9 * r.cp, it.name + ' : FTP sous la PC');
    assert.ok(r.physio.vo2max >= 65 && r.physio.vo2max <= 92 && r.physio.fI >= 38 && r.physio.fI <= 75, it.name + ' : carte physiologique');
    let last = Infinity;
    for (const d of Object.keys(r.records).map(Number).sort((a, b) => a - b)) { assert.ok(r.records[d] <= last, it.name + ' : courbe décroissante à ' + d); last = r.records[d]; }
  }
});

test('coureurs World Tour : les types se distinguent (grimpeur W/kg, rouleur W/CdA, sprinteur Pmax)', () => {
  const kg = (n) => byName(n).pro.wkg, pm = (n) => byName(n).data.rider.pmax / byName(n).data.rider.weight;
  assert.ok(kg('Tadej Pogačar') > kg('Jonathan Milan') && kg('Jonas Vingegaard') > kg('Filippo Ganna'), 'les leaders et grimpeurs ont la meilleure PC par kilo');
  assert.ok(pm('Jonathan Milan') > pm('Jonas Vingegaard') && pm('Mathieu van der Poel') > pm('Sepp Kuss'), 'sprinteurs et coureurs de classiques : Pmax');
  assert.ok(byName('Filippo Ganna').data.rider.cp > byName('Jonas Vingegaard').data.rider.cp, 'le rouleur est plus puissant en valeur absolue');
  assert.ok(P.wattsPerCdA(byName('Filippo Ganna')) > P.wattsPerCdA(byName('Sepp Kuss')), 'bon rapport W/CdA pour le rouleur');
  assert.ok(kg('Tadej Pogačar') > kg('Marco Haller'), 'le niveau compte dans un même type');
});

test('coureurs World Tour : un profil est exploitable par le moteur et retrouvé par son identifiant', () => {
  const it = P.find('pro:tadej-pogacar');
  assert.equal(it.name, 'Tadej Pogačar');
  assert.ok(P.has(it.id) && !P.has('pro:inconnu') && P.find('pro:inconnu') === null);
  const a = Ph.buildAthlete(it.data.rider);
  assert.equal(a.cp, it.data.rider.cp);
  assert.equal(a.cpSource, 'saisie');
  assert.ok(Math.abs(a.fit.cp - a.cp) / a.cp < 0.03, 'la PC saisie est cohérente avec la courbe');
  assert.ok(a.mmp(1200) > a.mmp(3600) && a.mmp(300) > a.mmp(1200));
  assert.deepEqual(P.build(P.RIDERS[0]), P.build(P.RIDERS[0]), 'profil déterministe');
});
