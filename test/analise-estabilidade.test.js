import test from 'node:test';
import assert from 'node:assert/strict';
import { notaEstabilidade, notaSetor, FAIXAS } from '../js/analise/estabilidade.js';

const perto = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const MELHOR = { vol1a: 0.15, vol3a: 0.15, queda3a: 0.15, queda5a: 0.2, beta: 0.6, liquidezDiaria: 5_000_000 };
const LUCRO_BOM = [100, 100, 100, 100, 100, 100, 100, 100];

test('tudo no melhor: nota 10, cobertura 1', () => {
  const r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: MELHOR });
  perto(r.nota, 10); perto(r.score, 1000); perto(r.cobertura, 1);
  assert.equal(r.semNota, false); assert.deepEqual(r.motivos, []);
});

test('tudo no pior: nota 0, com motivos', () => {
  const risco = { vol1a: 0.6, vol3a: 0.6, queda3a: 0.6, queda5a: 0.7, beta: 1.6, liquidezDiaria: 100_000 };
  const r = notaEstabilidade({ fund: { lucrosTri: [-1, 3, -1, 3, -1, 3, -1, 3] }, risco });
  perto(r.nota, 0);
  assert.equal(r.motivos.length, 8);
  assert.ok(r.motivos.includes('Volatilidade 1 ano fraca: 60%'));
});

test('componentes isolados (valor no meio da faixa = metade dos pontos)', () => {
  // vol1a 0,375 = meio entre 0,6 e 0,15 -> 7,5 de 15 pontos; resto no melhor
  let r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: { ...MELHOR, vol1a: 0.375 } });
  perto(r.pilares.vol.pontos, 22.5); perto(r.nota, 10 - 0.75);
  // beta 1,1 = meio entre 1,6 e 0,6 -> 7,5 de 15
  r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: { ...MELHOR, beta: 1.1 } });
  perto(r.pilares.beta.pontos, 7.5);
  // queda5a 0,45 = meio entre 0,7 e 0,2 -> 6,25 de 12,5
  r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: { ...MELHOR, queda5a: 0.45 } });
  perto(r.pilares.queda.pontos, 12.5 + 6.25);
  // liquidez 500 mil: log10 entre 5 e 6,699 -> (5,699-5)/(6,699-5)
  r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: { ...MELHOR, liquidezDiaria: 500_000 } });
  perto(r.pilares.liquidez.pontos, 10 * (Math.log10(5) / Math.log10(50)));
});

test('lucro: 2 de 8 trimestres com prejuízo e oscilação calculada à mão', () => {
  // lucros [10,10,10,10,10,10,-10,-10]: média 5, dp amostral = sqrt(8*... ) 
  const lt = [10, 10, 10, 10, 10, 10, -10, -10];
  const m = 5, dp = Math.sqrt((6 * 25 + 2 * 225) / 7);
  const osc = dp / m;
  const esperadoOsc = 10 * Math.min(1, Math.max(0, (osc - FAIXAS.oscilacaoLucro.pior) / (FAIXAS.oscilacaoLucro.melhor - FAIXAS.oscilacaoLucro.pior)));
  const esperadoPrej = 10 * (0.25 - 0.5) / (0 - 0.5); // 5
  const r = notaEstabilidade({ fund: { lucrosTri: lt }, risco: MELHOR });
  perto(r.pilares.lucro.itens[1].pontos, esperadoPrej);
  perto(r.pilares.lucro.itens[0].pontos, esperadoOsc);
  assert.equal(r.pilares.lucro.itens[1].valor, 0.25);
});

test('dado ausente redistribui dentro do pilar', () => {
  const { vol3a, ...sem } = MELHOR;
  const r = notaEstabilidade({ fund: { lucrosTri: LUCRO_BOM }, risco: { ...sem, vol1a: 0.375 } });
  // só vol1a: 50% de 30 pontos do pilar
  perto(r.pilares.vol.pontos, 15); perto(r.cobertura, 0.85);
  assert.equal(r.pilares.vol.itens[1].valor, null);
});

test('FII sem lucro: pilar sai, cobertura 0,8, nota normalizada', () => {
  const r = notaEstabilidade({ fund: null, risco: MELHOR });
  perto(r.cobertura, 0.8); perto(r.nota, 10); assert.equal(r.semNota, false);
  assert.equal(r.pilares.lucro.itens.every((i) => i.valor === null), true);
});

test('cobertura abaixo de 75%: sem nota', () => {
  const r = notaEstabilidade({ fund: null, risco: { vol1a: 0.2, vol3a: 0.2, queda3a: 0.2, queda5a: 0.2 } });
  perto(r.cobertura, 0.55); assert.equal(r.semNota, true); assert.equal(r.nota, null); assert.equal(r.score, null);
  assert.equal(notaEstabilidade({}).nota, null);
});

test('menos de 4 trimestres não avalia o lucro', () => {
  const r = notaEstabilidade({ fund: { lucrosTri: [1, 2, 3] }, risco: MELHOR });
  perto(r.cobertura, 0.8);
});

test('setor: mediana ímpar e par, amplitude interquartil, ignora null', () => {
  let s = notaSetor([2, 8, 5, null, 6, 4]); // ordenado 2,4,5,6,8: mediana 5; Q1=4, Q3=6
  assert.deepEqual(s, { mediana: 5, dispersao: 2, n: 5 });
  s = notaSetor([1, 2, 3, 4]); // mediana 2,5; Q1=1,75, Q3=3,25
  perto(s.mediana, 2.5); perto(s.dispersao, 1.5); assert.equal(s.n, 4);
});

test('setor com menos de 3 notas: sem nota', () => {
  assert.deepEqual(notaSetor([7, 8, null]), { mediana: null, dispersao: null, n: 2 });
  assert.deepEqual(notaSetor([]), { mediana: null, dispersao: null, n: 0 });
});
