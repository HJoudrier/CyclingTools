/* author : Hugo Joudrier-Faure */
/* Tests du profil en sept spécialités (Commun/js/engine/rider-radar.js) : bornes, cohérence avec le type des coureurs du World Tour, effet du poids,
 * de la puissance, de l'aérodynamisme et de la carte physiologique. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PYR } = require('./helpers.js');
const R = PYR.riderRadar, P = PYR.pros;

const ids = R.CATEGORIES.map((c) => c.id);
const rider = (o) => Object.assign({ sex: 'm', age: 30, weight: 70, height: 178, ftp: 300 }, o);

test('radar : sept spécialités, scores entiers de 0 à 100, ordre du meilleur au moins bon', () => {
  assert.deepEqual(ids, ['climb', 'sprint', 'flat', 'tt', 'stage', 'classic', 'punch']);
  for (const it of P.all()) {
    const r = R.scores(it.data.rider);
    for (const id of ids) assert.ok(Number.isInteger(r.scores[id]) && r.scores[id] >= 0 && r.scores[id] <= 100, `${it.name} ${id} ${r.scores[id]}`);
    assert.equal(new Set(r.best).size, 7);
    assert.equal(r.profile, R.CATEGORIES.find((c) => c.id === r.best[0]).label);
  }
});

test('radar : la catégorie vient des watts par kilo (FTP et 5 min), du sexe ; un coureur du World Tour est Pro quoi qu\'il arrive', () => {
  assert.deepEqual(R.DIVISIONS.map((d) => d.id), ['pro', 'elite', 'cat1', 'cat2', 'cat3', 'cat4', 'leisure']);
  const div = (o) => R.division(rider(o)).division.id;
  // même ordre que les niveaux de Coggan : 5 W/kg ≈ 1ʳᵉ catégorie, 4,1 ≈ 2ᵉ, 3,5 ≈ 3ᵉ–4ᵉ, 2,6 loisir
  assert.equal(div({ ftp: 420, weight: 70 }), 'pro');
  assert.ok(['elite', 'cat1'].includes(div({ ftp: 350, weight: 70 })));
  assert.equal(div({ ftp: 320, weight: 78 }), 'cat2');
  assert.ok(['cat3', 'cat4'].includes(div({ ftp: 250, weight: 72 })));
  assert.equal(div({ ftp: 190, weight: 75 }), 'leisure');
  // à puissance égale une femme est classée plus haut (tableaux de référence par sexe)
  const order = (id) => R.DIVISIONS.findIndex((d) => d.id === id);
  assert.ok(order(div({ ftp: 230, weight: 58, sex: 'f' })) < order(div({ ftp: 230, weight: 58 })));
  // tous les coureurs du World Tour sont Pro (forcé) ; sans forçage, aucun n'est sous « Élite »
  for (const it of P.all()) {
    assert.equal(R.scores(it.data.rider, { worldTour: true }).division.id, 'pro');
    assert.ok(['pro', 'elite'].includes(R.scores(it.data.rider).division.id), it.name);
  }
});

test('radar : l\'échelle suit la catégorie, donc un profil se lit parmi ses pairs et non par son niveau absolu', () => {
  // un grimpeur de 2ᵉ catégorie (léger, peu de sprint) montre ses forces et faiblesses aussi nettement qu\'un pro
  const cat2 = R.scores(rider({ ftp: 290, weight: 60, height: 172, pmax: 800, wPrime: 15 }));
  assert.equal(cat2.division.id, 'cat1');
  assert.ok(cat2.scores.climb - cat2.scores.sprint >= 20, JSON.stringify(cat2.scores));
  // le même profil à une puissance plus basse reste lisible (pas de zéros partout) ; sans échelle de catégorie il tomberait à 0 en grimpeur
  const low = R.scores(rider({ ftp: 190, weight: 52, height: 165, pmax: 600, wPrime: 12 }));
  assert.equal(low.division.id, 'cat3');
  assert.ok(low.scores.climb > 0 && Math.max(...ids.map((id) => low.scores[id])) - Math.min(...ids.map((id) => low.scores[id])) >= 20);
  // sprint : un pro isolé garde un score en rapport avec son niveau de sprint
  assert.ok(R.scores(P.all().find((x) => x.name === 'Jonathan Milan').data.rider, { worldTour: true }).scores.sprint >= 95);
});

test('radar : les spécialistes du World Tour ressortent dans leur spécialité', () => {
  const s = (name) => R.scores(P.all().find((x) => x.name === name).data.rider);
  const pogi = s('Tadej Pogačar'), milan = s('Jonathan Milan'), ganna = s('Filippo Ganna'), kuss = s('Sepp Kuss');
  assert.ok(pogi.scores.climb >= 90 && pogi.scores.stage >= 90 && pogi.best[0] === 'climb');
  assert.ok(milan.scores.sprint >= 90 && milan.best[0] === 'sprint' && milan.scores.climb < 60);
  assert.ok(ganna.scores.tt >= 85 && ganna.scores.flat >= 90 && ganna.scores.climb < pogi.scores.climb - 20);
  assert.ok(kuss.scores.climb > kuss.scores.sprint + 40);
  // la spécialité mise en avant par le calcul est cohérente avec le type donné au coureur dans 95 % des cas
  const OK = { climber: ['climb', 'stage'], stage: ['stage', 'climb', 'tt'], tt: ['tt', 'flat', 'classic'], classic: ['classic', 'punch', 'flat', 'sprint'], puncher: ['punch', 'classic', 'climb'], sprinter: ['sprint', 'punch'], domestique: ids };
  const all = P.all();
  const ok = all.filter((it) => OK[it.pro.type].includes(R.scores(it.data.rider).best[0])).length;
  assert.ok(ok / all.length >= 0.95, `${ok} / ${all.length}`);
});

test('radar : le poids, la puissance, l\'aérodynamisme et la carte physiologique agissent comme attendu', () => {
  // (échelle Pro imposée : sinon un athlète plus lourd ou moins puissant changerait de catégorie, donc d'échelle)
  const base = R.scores(rider({ ftp: 380, weight: 72, pmax: 1100 }), { worldTour: true });
  // plus léger à puissance égale : meilleur grimpeur ; plus lourd : moins bon grimpeur
  assert.ok(R.scores(rider({ ftp: 380, weight: 62, pmax: 1100 }), { worldTour: true }).scores.climb > base.scores.climb);
  assert.ok(R.scores(rider({ ftp: 380, weight: 85, pmax: 1100 }), { worldTour: true }).scores.climb < base.scores.climb);
  // plus de puissance : mieux partout où la puissance compte
  const strong = R.scores(rider({ ftp: 440, weight: 72, pmax: 1100 }), { worldTour: true });
  for (const id of ['climb', 'flat', 'tt', 'stage', 'classic']) assert.ok(strong.scores[id] > base.scores[id], id);
  // plus petit et léger = moins de CdA : meilleur W/CdA, donc meilleur rouleur à puissance égale
  assert.ok(R.metrics(rider({ height: 170 })).wCdaTT > R.metrics(rider({ height: 190 })).wCdaTT);
  // Pmax énorme : sprinteur
  const sprinter = R.scores(rider({ ftp: 380, weight: 72, pmax: 1900, wPrime: 28 }), { worldTour: true });
  assert.ok(sprinter.scores.sprint > base.scores.sprint + 20 && sprinter.best[0] === 'sprint');
  // fibres lentes et VO2max (carte athlète) : endurance, donc courses par étapes
  const slow = R.scores(rider({ ftp: 380, weight: 72, pmax: 1100, physio: { fI: 70, vo2max: 85 } }), { worldTour: true }), fast = R.scores(rider({ ftp: 380, weight: 72, pmax: 1100, physio: { fI: 38, vo2max: 62 } }), { worldTour: true });
  assert.ok(slow.scores.stage > fast.scores.stage && fast.scores.sprint > slow.scores.sprint);
  // le CdA ne dépend que du corps : l'équipement du moment ne change pas les scores
  assert.deepEqual(R.scores(rider({ ftp: 380, weight: 72, pmax: 1100, position: 'upright', clothing: 'loose' }), { worldTour: true }).scores, base.scores);
});
