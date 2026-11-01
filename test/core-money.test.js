import test from 'node:test';
import assert from 'node:assert/strict';
import { arredonda, centavos, mulDiv } from '../js/core/money.js';
import { ehData, addMeses } from '../js/core/datas.js';

test('arredonda: meio para longe do zero, tolerante a erro binário', () => {
  assert.equal(arredonda(2.5), 3);
  assert.equal(arredonda(-2.5), -3);
  assert.equal(arredonda(0.5), 1);
  assert.equal(arredonda(-0.4), 0);
  assert.equal(Object.is(arredonda(-0.4), -0), false);
  assert.equal(arredonda(1.005 * 100), 101); // 100.49999999999999 em binário
  assert.throws(() => arredonda(NaN));
});
test('centavos de reais', () => {
  assert.equal(centavos(19.99), 1999);
  assert.equal(centavos(0.285), 29); // 0.285*100 = 28.499999999999996
  assert.equal(centavos(52.71), 5271);
});
test('mulDiv exato, meio para longe do zero (valores conferidos em Python)', () => {
  assert.equal(mulDiv(7, 1, 2), 4);
  assert.equal(mulDiv(-7, 1, 2), -4);
  assert.equal(mulDiv(7, -1, 2), -4);
  assert.equal(mulDiv(-7, -1, 2), 4);
  assert.equal(mulDiv(5, 1, 3), 2);
  assert.equal(mulDiv(1, 1, 3), 0);
  assert.equal(mulDiv(123456789012, 987654321, 100000000), 1219326311245); // o produto (1,2e20) passa de 2^53; o resultado cabe
  assert.throws(() => mulDiv(123456789012, 987654321, 1000)); // resultado 1,2e17 não cabe em inteiro seguro
  assert.throws(() => mulDiv(1, 1, 0));
  assert.throws(() => mulDiv(1.5, 1, 2));
  assert.throws(() => mulDiv(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1));
});
test('datas', () => {
  assert.equal(ehData('2026-02-28'), true);
  assert.equal(ehData('2026-02-30'), false);
  assert.equal(ehData('26-02-28'), false);
  assert.equal(addMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(addMeses('2024-01-31', 1), '2024-02-29');
  assert.equal(addMeses('2026-12-15', 2), '2027-02-15');
  assert.equal(addMeses('2026-01-15', -1), '2025-12-15');
  assert.equal(addMeses('2026-03-31', -1), '2026-02-28');
});
