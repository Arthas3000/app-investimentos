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

// ---------- limites da faixa (o workflow grava em risco.json; o app compara o preço ao vivo com eles) ----------
import { limitesFaixa } from '../js/analise/preco.js';

test('percentil arredonda o preço para centavos (52,71 × 100 não vira 5271,000…01)', () => {
  assert.equal(percentil(52.71, Array(60).fill(5271)), 50);
});

test('limitesFaixa: maior centavo barato e menor centavo caro, conferidos à mão', () => {
  // R$ 25,99 tem 25 fechamentos abaixo (percentil 25: barato); R$ 26,00 empata (25,5: normal).
  // R$ 75,01 tem 75 abaixo (75: caro); R$ 75,00 empata (74,5: normal).
  assert.deepEqual(limitesFaixa(p5), { barato: 2599, caro: 7501 });
  assert.equal(limitesFaixa(p5.slice(0, 59)), null);
  assert.equal(limitesFaixa(null), null);
  assert.deepEqual(limitesFaixa(Array(80).fill(1000)), { barato: 999, caro: 1001 }); // tudo empatado: só o próprio preço é normal
});

test('faixa pelos limites dá o mesmo resultado da série inteira (500 casos aleatórios)', () => {
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 500; k++) {
    const n = 60 + Math.floor(rnd() * 300), base = 500 + Math.floor(rnd() * 9000);
    const serie = Array.from({ length: n }, () => base + Math.floor(rnd() * 400) - 200);
    const preco = (base + Math.floor(rnd() * 600) - 300) / 100;
    const valor = rnd() < 0.3 ? null : rnd() - 0.5;
    const classe = rnd() < 0.5 ? 'acao' : 'fii';
    const a = faixaPreco({ classe, preco, precos5a: serie, valor });
    const b = faixaPreco({ classe, preco, precos5a: null, limites: limitesFaixa(serie), valor });
    assert.equal(b.id, a.id, `caso ${k}`);
    assert.deepEqual(b.sinais, a.sinais, `caso ${k}`);
    assert.deepEqual(b.limites, a.limites);
  }
});

test('faixa pelos limites: motivos mostram os preços de corte', () => {
  const lim = { barato: 2599, caro: 7501 };
  assert.match(faixaPreco({ classe: 'acao', preco: 20, limites: lim, valor: null }).motivos[0], /mais baixos dos últimos 5 anos \(até R\$ 25,99\)/);
  assert.match(faixaPreco({ classe: 'acao', preco: 50, limites: lim, valor: null }).motivos[0], /R\$ 25,99 e R\$ 75,01/);
  assert.match(faixaPreco({ classe: 'acao', preco: 80, limites: lim, valor: null }).motivos[0], /mais altos dos últimos 5 anos \(a partir de R\$ 75,01\)/);
  assert.equal(faixaPreco({ classe: 'acao', preco: 50, limites: null, valor: null }).id, 'indefinido');
});
