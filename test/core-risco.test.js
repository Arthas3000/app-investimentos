import test from 'node:test';
import assert from 'node:assert/strict';
import { retornos, volatilidadeAnual, quedaMaxima, beta, hhi, faixaHhi } from '../js/core/risco.js';

// 26 preços e 26 pontos de um "mercado" correlacionado. Resultados esperados calculados à parte em Python
// (statistics.stdev × √252; cov/var; pico-a-vale).
const P = [100.0, 103.52, 105.53, 105.22, 102.87, 99.75, 97.44, 97.19, 99.24, 102.78, 106.28, 108.24, 107.87, 105.5, 102.37, 100.1, 99.9, 102.01, 105.57, 109.05, 110.95, 110.53, 108.12, 104.99, 102.76, 102.62];
const M = [1000.0, 1031.05, 1045.79, 1039.7, 1020.31, 998.65, 982.52, 978.48, 991.44, 1019.95, 1051.5, 1068.88, 1063.28, 1041.21, 1017.15, 1002.62, 1001.99, 1015.75, 1041.6, 1071.14, 1089.89, 1086.72, 1064.0, 1036.92, 1021.44, 1023.61];
const perto = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('retornos simples', () => {
  const r = retornos([100, 110, 99]);
  perto(r[0], 0.1); perto(r[1], -0.1);
});
test('volatilidade anual e mínimo de 20 observações', () => {
  perto(volatilidadeAnual(retornos(P)), 0.37602451380425234);
  assert.equal(volatilidadeAnual(retornos(P).slice(0, 19)), null);
  assert.notEqual(volatilidadeAnual(retornos(P).slice(0, 20)), null);
});
test('beta contra o mercado', () => {
  perto(beta(retornos(P), retornos(M)), 1.2156230976604159);
  assert.equal(beta(retornos(P).slice(0, 10), retornos(M).slice(0, 10)), null);
  assert.equal(beta(retornos(P), retornos(M).slice(1)), null); // tamanhos diferentes
  assert.equal(beta(retornos(P), retornos(P).map(() => 0.01)), null); // mercado sem variação
});
test('queda máxima de um ativo (pico-a-vale)', () => {
  perto(quedaMaxima(P.map((v) => ({ v }))), 0.07902965981237564);
  assert.equal(quedaMaxima([{ v: 1 }, { v: 2 }, { v: 3 }]), 0); // só sobe
});
test('queda máxima da carteira neutraliza aportes', () => {
  // 100 -> 90 (-10%) -> 190 com aporte de 100 (rendimento 0%) -> 171 (-10%): índice 1, .9, .9, .81 => queda 19%
  const q = quedaMaxima([{ v: 100 }, { v: 90 }, { v: 190, aporte: 100 }, { v: 171 }]);
  perto(q, 0.19);
  // sem neutralizar pareceria só 10% (190 -> 171)
});
test('HHI, número efetivo e faixas 1000/1800/2500', () => {
  const a = hhi([50, 30, 20]);
  assert.equal(a.hhi, 3800); perto(a.nEfetivo, 10000 / 3800); assert.equal(a.faixa, 'muito concentrada');
  assert.deepEqual(hhi(Array(10).fill(10)), { hhi: 1000, nEfetivo: 10, faixa: 'diversificada' });
  assert.equal(hhi([25, 25, 25, 25]).faixa, 'concentrada'); // 2500
  assert.equal(faixaHhi(1800), 'moderada'); assert.equal(faixaHhi(1801), 'concentrada');
  assert.equal(faixaHhi(2501), 'muito concentrada');
  assert.deepEqual(hhi([]), { hhi: 0, nEfetivo: 0, faixa: 'diversificada' });
});
