import test from 'node:test';
import assert from 'node:assert/strict';
import { simular, twr, xirr, ipcaAcumulado, anualizado } from '../js/core/simulador.js';

// Valores esperados calculados à parte em Python (mesma regra, implementação independente).
const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('twr: aporte não conta como rendimento', () => {
  perto(twr([{ valor: 100 }, { valor: 110 }, { valor: 210, aporte: 100 }]), 0.1);
  perto(twr([{ valor: 100 }, { valor: 110 }, { valor: 231, aporte: 100 }]), 1.1 * (131 / 110) - 1); // 0,31
});

test('twr anualizado só com 1 ano ou mais', () => {
  assert.equal(anualizado(0.1, 364), null);
  perto(anualizado(0.21, 730), 0.1, 1e-3);
  perto(anualizado(0.1, 365), 0.1, 1e-12);
});

test('xirr: -100 hoje, +110 em 1 ano = 10%', () => {
  perto(xirr([{ data: '2025-01-01', valor: -100 }, { data: '2026-01-01', valor: 110 }]), 0.1, 1e-9);
  perto(xirr([{ data: '2025-01-01', valor: -1000 }, { data: '2025-07-01', valor: -500 }, { data: '2026-01-01', valor: 1700 }]), 0.16093584964263574, 1e-9);
  assert.equal(xirr([{ data: '2025-01-01', valor: -100 }]), null); // sem entrada
});

test('xirr cai na bisseção quando o chute ruim faz Newton sair do domínio', () => {
  // retorno de ~-90% em 1 ano: Newton a partir de 10% passa de -1
  perto(xirr([{ data: '2025-01-01', valor: -100 }, { data: '2026-01-01', valor: 10 }]), -0.9, 1e-9);
});

test('ipcaAcumulado: meses cheios e pro rata no mês', () => {
  const ipca = [{ data: '2025-01-01', valor: 1 }, { data: '2025-02-01', valor: 0.5 }, { data: '2025-03-01', valor: 0.8 }];
  perto(ipcaAcumulado(ipca, '2025-01-01', '2025-03-01'), 1.01 * 1.005 - 1, 1e-12);
  perto(ipcaAcumulado(ipca, '2025-01-01', '2025-01-16'), 0.004826285396822394, 1e-12); // 1,01^(15/31) − 1
  perto(ipcaAcumulado([], '2025-01-01', '2025-03-01'), 0, 1e-12);
});

// 8 pregões, 4 meses. Aportes: inicial 02/01; mensais (dia ≥ 2) em 03/02, 03/03 e 15/04 (01/04 é dia 1).
const D = ['20250102', '20250115', '20250203', '20250217', '20250303', '20250317', '20250401', '20250415'];
const serie = (p) => ({ d: D, p });
const base = {
  carteira: [{ ticker: 'AAA', pesoPct: 50 }, { ticker: 'BBB', pesoPct: 30 }, { ticker: 'CCC', pesoPct: 20 }],
  aporteInicial: 100000, aporteMensal: 50000, diaAporte: 2,
  precos: {
    AAA: serie([1000, 1100, 1050, 1200, 1150, 1300, 1250, 1400]),
    BBB: serie([2000, 1900, 2100, 2000, 2200, 2100, 2300, 2400]),
    CCC: serie([500, 520, 480, 510, 530, 550, 540, 560]),
  },
  ibov: serie([100, 102, 101, 105, 104, 108, 107, 110]),
  cdi: D.map((d) => ({ data: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, valor: 0.05 })),
  ipca: [{ data: '2025-01-01', valor: 1 }, { data: '2025-02-01', valor: 0.5 }, { data: '2025-03-01', valor: 0.8 }, { data: '2025-04-01', valor: 0.4 }],
  inicio: '2025-01-01', fim: '2025-12-31',
};

test('pesos fixos: 3 ativos sintéticos por 4 meses', () => {
  const r = simular({ ...base, estrategia: 'pesos-fixos' });
  assert.deepEqual(r.final, { cotas: { AAA: 106, BBB: 37, CCC: 106 }, caixa: 570 });
  assert.equal(r.series.carteira.at(-1).valor, 297130);
  perto(r.resumo.carteira.twr, 0.2787580447478297, 1e-12);
  assert.equal(r.series.carteira.length, 8);
  assert.equal(r.mesesDeAporte, 3);
});

test('rebalancear com aportes: só compra, 3 ativos por 4 meses', () => {
  const r = simular({ ...base, estrategia: 'rebalancear-aportes' });
  assert.deepEqual(r.final, { cotas: { AAA: 106, BBB: 37, CCC: 107 }, caixa: 490 });
  assert.equal(r.series.carteira.at(-1).valor, 297610);
  perto(r.resumo.carteira.twr, 0.28160010705142224, 1e-12);
});

test('taxa por ordem entra no caixa (uma por compra/venda)', () => {
  const f = simular({ ...base, estrategia: 'pesos-fixos', taxaPorOrdem: 100 });
  assert.deepEqual(f.final, { cotas: { AAA: 105, BBB: 37, CCC: 105 }, caixa: 1350 });
  assert.equal(f.series.carteira.at(-1).valor, 295950);
  const a = simular({ ...base, estrategia: 'rebalancear-aportes', taxaPorOrdem: 100 });
  assert.deepEqual(a.final, { cotas: { AAA: 106, BBB: 37, CCC: 105 }, caixa: 350 });
  assert.equal(a.series.carteira.at(-1).valor, 296350);
});

test('benchmarks recebem os mesmos aportes nas mesmas datas', () => {
  const r = simular(base);
  // Ibovespa: cotas fracionárias; TWR do índice = 110/100 − 1
  assert.equal(r.series.ibov.at(-1).valor, 267340);
  perto(r.resumo.ibov.twr, 0.1, 1e-5); // séries em centavos inteiros: arredondamento
  // CDI com taxa diária constante de 0,05% (7 intervalos)
  assert.equal(r.series.cdi.at(-1).valor, 250551);
  perto(r.resumo.cdi.twr, 1.0005 ** 7 - 1, 1e-5);
  assert.equal(r.series.ipca.at(-1).valor, 253671);
  for (const k of ['carteira', 'ibov', 'cdi', 'ipca']) {
    assert.deepEqual(r.series[k].map((p) => p.aportadoAcum), r.series.carteira.map((p) => p.aportadoAcum));
    assert.deepEqual(r.series[k].map((p) => p.data), r.series.carteira.map((p) => p.data));
  }
});

test('IPCA: retorno do IPCA = IPCA acumulado, real ~ 0; real da carteira desconta o IPCA', () => {
  const r = simular(base);
  perto(r.ipcaPeriodo, 0.024749309785581097, 1e-12);
  perto(r.resumo.ipca.twr, r.ipcaPeriodo, 1e-5);
  perto(r.resumo.ipca.real, 0, 1e-5);
  perto(r.resumo.carteira.real, (1 + r.resumo.carteira.twr) / (1 + r.ipcaPeriodo) - 1, 1e-12);
});

test('invariantes: aportes somam, valor nunca negativo, determinístico, queda máxima', () => {
  for (const estrategia of ['pesos-fixos', 'rebalancear-aportes']) {
    const r = simular({ ...base, estrategia, taxaPorOrdem: 500 });
    const soma = r.aportes.reduce((t, a) => t + a.valor, 0);
    assert.equal(soma, base.aporteInicial + r.mesesDeAporte * base.aporteMensal);
    assert.equal(r.series.carteira.at(-1).aportadoAcum, soma);
    assert.ok(Object.values(r.series).every((s) => s.every((p) => p.valor >= 0)));
    assert.ok(r.final.caixa >= 0);
    assert.deepEqual(simular({ ...base, estrategia, taxaPorOrdem: 500 }), r);
    assert.ok(r.quedaMaxima >= 0 && r.quedaMaxima < 1);
  }
});

test('ativo sem histórico no início entra depois, com aviso; ativo sem nada fica de fora', () => {
  const precos = { ...base.precos, CCC: { d: D.slice(3), p: [510, 530, 550, 540, 560] }, ZZZ: { d: [], p: [] } };
  const r = simular({ ...base, precos, carteira: [...base.carteira, { ticker: 'ZZZ', pesoPct: 10 }] });
  assert.ok(r.avisos.some((a) => a.startsWith('CCC: sem preço no início') && a.includes('2025-02-17')));
  assert.ok(r.avisos.some((a) => a.startsWith('ZZZ: sem histórico')));
  assert.ok(r.final.cotas.CCC > 0 && !('ZZZ' in r.final.cotas)); // CCC entra no aporte de 03/03
});

test('premissas listadas; período sem pregão devolve vazio com aviso', () => {
  const r = simular(base);
  assert.ok(r.premissas.some((p) => p.includes('sem ajuste')) && r.premissas.some((p) => p.includes('Sem proventos')) && r.premissas.some((p) => p.includes('BOVA11')));
  const v = simular({ ...base, inicio: '2030-01-01', fim: '2030-02-01' });
  assert.equal(v.resumo, null);
  assert.equal(v.series.carteira.length, 0);
  assert.ok(v.avisos.length);
});

test('entradas inválidas', () => {
  assert.throws(() => simular({ ...base, estrategia: 'x' }), RangeError);
  assert.throws(() => simular({ ...base, inicio: '2025-02-30' }), RangeError);
  assert.throws(() => simular({ ...base, aporteMensal: 1.5 }), RangeError);
  assert.throws(() => simular({ ...base, carteira: [{ ticker: 'AAA', pesoPct: 0 }] }), RangeError);
});
