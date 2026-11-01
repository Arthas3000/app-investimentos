import test from 'node:test';
import assert from 'node:assert/strict';
import { notaValorAcao, notaValorFii, clip, parcial } from '../js/analise/valor.js';

// Valores esperados calculados à parte em Python (KE=0,18; G=0,05; parcial = pontos × clip((v−pior)/(melhor−pior))).
const perto = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const fund = {
  tipo: 'geral', estatal: false, roe12m: 0.20, roeTri: 0.05, lucrosTri: [1, 1, 1, 1, 1, 1, 1, 1],
  dlEbitda: 1, liqCorrente: 1.4, roic: 0.10, crescReceita12m: 0.05, vpa: 10, lpa12m: 3, payout: 0.5, dy: 0.06,
};
const risco = { queda12m: 0.25 };
const ctx = { cdi: 0.10, queda12mSetor: 0.20, queda12mIbov: 0.10 };
const base = { preco: 15, fund, risco, ctx };

test('clip e parcial', () => {
  assert.equal(clip(-1), 0);
  assert.equal(clip(2), 1);
  assert.equal(parcial(100, 0.125, 0, 0.25), 50);
  assert.equal(parcial(100, 3, 5, 0), 40); // menor é melhor
  assert.equal(parcial(100, 9, 5, 0), 0);
});

test('ação completa: P/VP justo, MS, preço justo e os quatro pilares', () => {
  const r = notaValorAcao(base);
  perto(r.roen, 0.20);
  perto(r.pvp, 1.5);
  perto(r.pvpJusto, 1.153846153846154); // (0,20−0,05)/(0,18−0,05)
  perto(r.ms, -0.23076923076923073); // pvpJusto/1,5 − 1
  assert.equal(r.precoJusto, 11.54);
  perto(r.pilares.p3.pontos, 185); // ROEn 80 + ROIC 50 + cresc. 40 + lucros 15
  perto(r.pilares.p1.pontos, 137.5846153846154); // 40,38 + 22,2 (30×0,74) + 75
  perto(r.pilares.p2.pontos, 205);
  perto(r.pilares.p4.pontos, 168);
  assert.equal(r.cobertura, 1);
  assert.equal(r.semNota, false);
  assert.equal(r.score, 696);
  assert.equal(r.nota, 6.96);
});

test('MS positiva: preço abaixo do justo', () => {
  const r = notaValorAcao({ ...base, preco: 8 }); // P/VP 0,8
  perto(r.ms, 1.153846153846154 / 0.8 - 1); // +44,2%
  assert.ok(r.ms > 0);
  assert.equal(r.precoJusto, 11.54);
});

test('commodity usa só o ROE de 12 meses', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, tipo: 'commodity', roe12m: 0.10, roeTri: 0.30 } });
  perto(r.roen, 0.10); // geral daria (0,10+1,20)/2 = 0,65
  perto(r.pvpJusto, 0.3846153846153846); // 0,05/0,13
});

test('estatal perde 15 pontos em Qualidade', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, estatal: true } });
  perto(r.pilares.p3.pontos, 170);
  assert.ok(r.motivos.some((m) => m.includes('Estatal')));
});

test('dado ausente redistribui o peso dentro do pilar', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, dlEbitda: null, liqCorrente: null } });
  // sobra só o earnings yield (0,2 > Ke): ganha os 250 do pilar
  perto(r.pilares.p2.pontos, 250);
  assert.equal(r.pilares.p2.itens[0].valor, null);
  assert.equal(r.pilares.p2.itens[2].max, 250);
  perto(r.cobertura, 0.85); // 1000 − 100 − 50
  assert.equal(r.semNota, false);
  assert.ok(r.motivos.some((m) => m.includes('parcial')));
});

test('proventos ausentes (hoje sempre): pilar zerado, cobertura parcial', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, dy: null, payout: null } });
  assert.equal(r.pilares.p4.pontos, 0);
  perto(r.cobertura, 0.8);
  assert.equal(r.semNota, false);
});

test('pouca cobertura: sem nota', () => {
  const r = notaValorAcao({ preco: 15, fund: { vpa: 10, roe12m: 0.2, roeTri: 0.05 }, risco: {}, ctx: {} });
  perto(r.cobertura, 0.34); // MS 150 + tendência 90 + ROEn 100
  assert.equal(r.semNota, true);
  assert.equal(r.nota, null);
  assert.equal(r.score, null);
});

test('sem VPA: P/VP, MS e preço justo ficam null', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, vpa: null } });
  assert.equal(r.pvp, null);
  assert.equal(r.ms, null);
  assert.equal(r.precoJusto, null);
});

test('banco usa CET1 e inadimplência', () => {
  const r = notaValorAcao({ ...base, fund: { ...fund, tipo: 'banco', cet1: 0.115, inadimplencia: 0.035 } });
  perto(r.pilares.p2.itens[0].pontos, 50); // CET1 11,5% fica no meio de 9% a 14%
  assert.equal(r.pilares.p3.itens[1].nome, 'Inadimplência');
  perto(r.pilares.p3.itens[1].pontos, 37.5);
});

// FII: preço 100, VPA 110, rend 9, FFO 8, CDI 10% (líquido 8,5%).
const fii = {
  segmento: 'tijolo', vpa: 110, rend12m: 9, ffo: 8, alavancagem: 0.3, vacancia: 0.05, nImoveis: 5, pctVendaImoveis: 0,
  rendMensal: [0.8, 0.8, 0.8, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75, 0.7, 0.7, 0.7],
};

test('FII completo: quatro pilares e nota', () => {
  const r = notaValorFii({ preco: 100, fund: fii, risco: { queda12m: 0.15, liquidezDiaria: 1e6 }, ctx: { cdi: 0.10, queda12mFiis: 0.10 } });
  perto(r.pilares.p1.pontos, 181.77489177489178); // P/VP 0,909 ponderado por FFO/rend 0,889
  perto(r.pilares.p2.pontos, 143.74613003095976);
  perto(r.pilares.p3.pontos, 169.44444444444446);
  perto(r.pilares.p4.pontos, 143.33333333333331);
  assert.equal(r.cobertura, 1);
  assert.equal(r.score, 638);
  assert.equal(r.nota, 6.38);
  assert.ok(r.motivos.some((m) => m.includes('FFO cobre só 89%')));
});

test('FII de papel sem FFO: pesos redistribuídos e sem nota', () => {
  const papel = { segmento: 'papel', vpa: 100, rend12m: 10, alavancagem: 0.2, qualidadeCredito: 0.8, rendMensal: Array(12).fill(0.8) };
  const r = notaValorFii({ preco: 100, fund: papel, risco: { queda12m: 0.1, liquidezDiaria: 1e6 }, ctx: { cdi: 0.10, queda12mFiis: 0.10 } });
  perto(r.pilares.p1.pontos, 120.28571428571426);
  perto(r.pilares.p2.pontos, 136.99690402476782); // 170 de 250 com dado, escalado
  perto(r.pilares.p3.pontos, 200); // crédito 0,8 × 250
  perto(r.pilares.p4.pontos, 166.66666666666669); // só DY, escalado a 200
  perto(r.cobertura, 0.72);
  assert.equal(r.semNota, false); // FII: nota parcial a partir de 50%
  assert.equal(r.score, 624); // 120,29 + 137,00 + 200 + 166,67
  assert.match(r.motivos.join('|'), /Nota parcial: dados cobrem 72% do modelo; faltam .*Cobertura pelo FFO/);
});

test('FII abaixo de 50% de cobertura: sem nota', () => {
  const r = notaValorFii({ preco: 100, fund: { segmento: 'papel', vpa: 100 }, risco: {}, ctx: {} });
  assert.ok(r.cobertura < 0.5);
  assert.equal(r.semNota, true);
  assert.equal(r.nota, null);
});
