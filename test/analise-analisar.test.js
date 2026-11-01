import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarCtx, analisar } from '../js/analise/analisar.js';

const rk = (o = {}) => ({ vol1a: 0.3, vol3a: 0.3, queda3a: 0.3, queda5a: 0.4, beta: 1, queda12m: 0.2, liquidezDiaria: 2e6, saltos: 0, ...o });
const fa = { tipo: 'geral', estatal: false, roe12m: 0.2, roeTri: 0.05, lucrosTri: [1, 1, 1, 1, 1, 1, 1, 1], dlEbitda: 1, liqCorrente: 1.5, roic: 0.12, crescReceita12m: 0.1, vpa: 10, lpa12m: 2, payout: null, dy: null };
const dados = {
  fundamentos: { ativos: { AAA3: fa, BBB3: fa, CCC3: fa } },
  fiis: { ativos: { FFF11: { segmento: 'tijolo', vpa: 100, rend12m: 8, rendMensal: [], alavancagem: 0.1, ffo: null } } },
  risco: { ibov: 'BOVA11', ativos: { AAA3: rk({ queda12m: 0.1 }), BBB3: rk({ queda12m: 0.3 }), CCC3: rk({ queda12m: 0.2, saltos: 1 }), FFF11: rk(), BOVA11: rk({ queda12m: 0.15 }) } },
};
const setores = { AAA3: 'S', BBB3: 'S', CCC3: 'S' };
const ctx = montarCtx({ ...dados, cdi: 0.1, setores });

test('montarCtx: medianas e notas de estabilidade', () => {
  assert.equal(ctx.queda12mSetor.S, 0.2);
  assert.equal(ctx.queda12mIbov, 0.15);
  assert.equal(ctx.queda12mFiis, 0.2);
  assert.equal(ctx.estabSetor.S.n, 3);
  assert.equal(ctx.estabSetor.tijolo.mediana, null); // 1 FII: sem nota de segmento
});

test('analisar: ação, aviso de saltos e sem dados', () => {
  const a = analisar({ ticker: 'AAA3', classe: 'acao', preco: 10, dados, ctx, setor: 'S' });
  assert.ok(a.valor && a.estab && a.indicacao.id && a.estabSetor);
  assert.equal(a.aviso, null);
  const c = analisar({ ticker: 'CCC3', classe: 'acao', preco: 10, dados, ctx, setor: 'S' });
  assert.match(c.aviso, /desdobramento/);
  assert.ok(c.indicacao.motivos.includes(c.aviso));
  assert.deepEqual(analisar({ ticker: 'ZZZ3', classe: 'acao', preco: 1, dados, ctx }), { semDados: true });
});

test('analisar: FII sem FFO/vacância tem nota parcial e faixa', () => {
  const f = analisar({ ticker: 'FFF11', classe: 'fii', preco: 90, dados, ctx });
  assert.equal(f.valor.semNota, false);
  assert.ok(f.valor.cobertura >= 0.5 && f.valor.cobertura < 0.75);
  assert.equal(f.faixa.id, 'barato'); // P/VP 0,90, único sinal
});

test('analisar: faixa de ação usa a margem de segurança e os preços de 5 anos', () => {
  const p5 = Array.from({ length: 100 }, (_, i) => (i + 1) * 10); // R$ 0,10 a 10,00
  const a = analisar({ ticker: 'AAA3', classe: 'acao', preco: 10, dados, ctx, setor: 'S', precos5a: p5 });
  assert.equal(a.faixa.sinais.length, 2);
  assert.ok(['barato', 'normal', 'caro'].includes(a.faixa.id));
});

// Fumaça com os dados reais do repositório.
const lerJson = (p) => JSON.parse(readFileSync(new URL(`../dados/${p}`, import.meta.url), 'utf8'));
const real = { fundamentos: lerJson('fundamentos.json'), fiis: lerJson('fiis.json'), risco: lerJson('risco.json') };
const ctxReal = montarCtx({ ...real, cdi: 0.14, setores: {} });
const IDS = ['candidata', 'cautela', 'boa', 'atencao', 'evitar', 'neutro'];

test('fumaça: PETR4, ITUB4, HGLG11 com dados reais', () => {
  for (const [ticker, classe, preco] of [['PETR4', 'acao', 35], ['ITUB4', 'acao', 35], ['HGLG11', 'fii', 160]]) {
    const a = analisar({ ticker, classe, preco, dados: real, ctx: ctxReal });
    assert.ok(!a.semDados, ticker);
    assert.ok(a.valor.nota === null || (a.valor.nota >= 0 && a.valor.nota <= 10));
    assert.ok(a.valor.cobertura >= 0 && a.valor.cobertura <= 1);
    assert.ok(IDS.includes(a.indicacao.id));
    assert.ok(Array.isArray(a.indicacao.motivos));
  }
});
