import test from 'node:test';
import assert from 'node:assert/strict';
import { faixaPreco, percentil } from '../js/analise/preco.js';

// 100 fechamentos de 1,00 a 100,00 reais (em centavos): o preço de R$ N tem N-1 abaixo e 1 igual -> percentil N-0,5.
const p5 = Array.from({ length: 100 }, (_, i) => (i + 1) * 100);

test('percentil: bordas conferidas à mão', () => {
  assert.equal(percentil(26, p5), 25.5); // 25 abaixo + 0,5 empate
  assert.equal(percentil(25, p5), 24.5);
  assert.equal(percentil(0.5, p5), 0);
  assert.equal(percentil(500, p5), 100);
  assert.equal(percentil(10, p5.slice(0, 59)), null); // poucos pontos
  assert.equal(percentil(null, p5), null);
});

test('ação: percentil 24,5 (barato) + MS normal -> barato', () => {
  const f = faixaPreco({ classe: 'acao', preco: 25, precos5a: p5, valor: 0.14 });
  assert.equal(f.id, 'barato'); // -1 + 0
  assert.match(f.motivos[0], /25º percentil|24º percentil|25º/);
});

test('ação: percentil 25,5 é normal; MS exatamente +15% vira barato', () => {
  assert.equal(faixaPreco({ classe: 'acao', preco: 26, precos5a: p5, valor: 0.14 }).id, 'normal');
  assert.equal(faixaPreco({ classe: 'acao', preco: 26, precos5a: p5, valor: 0.15 }).id, 'barato');
  assert.equal(faixaPreco({ classe: 'acao', preco: 26, precos5a: p5, valor: -0.15 }).id, 'caro');
});

test('ação: sinais opostos se anulam -> normal', () => {
  const f = faixaPreco({ classe: 'acao', preco: 25, precos5a: p5, valor: -0.3 });
  assert.equal(f.id, 'normal');
  assert.equal(f.sinais.length, 2);
});

test('percentil 75,5 (caro): limite inferior de caro', () => {
  assert.equal(faixaPreco({ classe: 'acao', preco: 76, precos5a: p5, valor: 0 }).id, 'caro'); // +1 + 0
  assert.equal(faixaPreco({ classe: 'acao', preco: 75, precos5a: p5, valor: 0 }).id, 'normal'); // 74,5
});

test('FII: P/VP 0,95 barato, 1,05 caro, 1,00 normal (só P/VP, com 1 dado)', () => {
  const f = (valor) => faixaPreco({ classe: 'fii', preco: 50, precos5a: null, valor });
  assert.equal(f(0.95).id, 'barato');
  assert.equal(f(0.96).id, 'normal');
  assert.equal(f(1.05).id, 'caro');
  assert.ok(f(1.0).motivos.includes('Com base em 1 dado'));
});

test('sem sinal: indefinido', () => {
  const f = faixaPreco({ classe: 'acao', preco: 10, precos5a: [], valor: null });
  assert.equal(f.id, 'indefinido');
  assert.equal(f.sinais.length, 0);
});
