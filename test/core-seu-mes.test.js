import test from 'node:test';
import assert from 'node:assert/strict';
import { resumoMes, serieMensal, marcos, novosMarcos, fechamentoMes } from '../js/core/seu-mes.js';

const T = [
  { id: 1, tipo: 'compra', data: '2026-01-10', ativo: 'AAA3', qtd: 10, preco: 1000, taxas: 50 }, // custo 10.050
  { id: 2, tipo: 'compra', data: '2026-02-05', ativo: 'BBB3', qtd: 5, preco: 2000 }, // custo 10.000
  { id: 3, tipo: 'provento', data: '2026-02-20', ativo: 'AAA3', valor: 300 },
  { id: 4, tipo: 'compra', data: '2026-02-25', ativo: 'AAA3', qtd: 5, preco: 1200, taxas: 20 }, // custo 6.020
  { id: 5, tipo: 'compra', data: '2026-02-26', ativo: 'AAA3', qtd: 99, preco: 1, excluido: true }, // ignorada
];
const JAN = { AAA3: 1100 }, FEV = { AAA3: 1300, BBB3: 1800 };
const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('fechamentoMes: último pregão do mês, null se não há pregão no mês', () => {
  const s = { d: [20260129, 20260130, 20260227, 20260302], p: [100, 110, 120, 130] };
  assert.equal(fechamentoMes(s, '2026-01'), 110);
  assert.equal(fechamentoMes(s, '2026-02'), 120);
  assert.equal(fechamentoMes(s, '2025-12'), null); // antes da série
  assert.equal(fechamentoMes({ d: [20260130], p: [110] }, '2026-03'), null); // série acaba antes do mês
  assert.equal(fechamentoMes(null, '2026-01'), null);
});

test('resumoMes: fevereiro conferido à mão', () => {
  const r = resumoMes({ transacoes: T, mes: '2026-02', precosMes: FEV, precosAnterior: JAN, alvos: { AAA3: 60, BBB3: 30, CCC3: 10 } });
  // aportes: 5×2000 + 5×1200 = 16.000, taxas 20 (a compra excluída não conta)
  assert.deepEqual(r.aportes, { total: 16020, bruto: 16000, taxas: 20, n: 2 });
  assert.deepEqual(r.proventos, { total: 300, n: 1, porAtivo: [{ ativo: 'AAA3', valor: 300 }] });
  // fim de fev: 15×1300 + 5×1800 = 28.500; custo 16.070 + 10.000 = 26.070 (caixa negativo não entra)
  assert.deepEqual(r.fim, { patrimonio: 28500, investido: 26070 });
  // fim de jan: 10×1100 = 11.000; custo 10.050
  assert.deepEqual(r.anterior, { patrimonio: 11000, investido: 10050 });
  assert.equal(r.evolucao.patrimonio.valor, 17500);
  perto(r.evolucao.patrimonio.pct, (17500 / 11000) * 100);
  assert.equal(r.evolucao.investido.valor, 16020);
  perto(r.evolucao.investido.pct, (16020 / 10050) * 100);
  // pesos: AAA3 19.500/28.500, BBB3 9.000/28.500
  const [a, b, c] = r.alvos;
  assert.deepEqual([a.ativo, b.ativo, c.ativo], ['AAA3', 'BBB3', 'CCC3']);
  perto(a.peso, (19500 / 28500) * 100); perto(a.distancia, (19500 / 28500) * 100 - 60);
  perto(b.peso, (9000 / 28500) * 100); perto(b.distancia, (9000 / 28500) * 100 - 30);
  assert.deepEqual(c, { ativo: 'CCC3', peso: 0, alvo: 10, distancia: -10 }); // alvo sem posição
  assert.deepEqual(r.estimados, []);
  assert.equal(r.vazio, false);
});

test('resumoMes: sem preço de fim de mês usa o custo e avisa; sem alvo, distância null', () => {
  const r = resumoMes({ transacoes: T, mes: '2026-02', precosMes: { AAA3: 1300 }, precosAnterior: JAN });
  assert.deepEqual(r.estimados, ['BBB3']);
  assert.equal(r.fim.patrimonio, 19500 + 10000); // BBB3 ao custo
  assert.equal(r.alvos[0].alvo, null); assert.equal(r.alvos[0].distancia, null);
});

test('resumoMes: 1º mês sem mês anterior (pct null) e mês sem nada é vazio', () => {
  const r = resumoMes({ transacoes: T, mes: '2026-01', precosMes: JAN });
  assert.equal(r.evolucao.patrimonio.pct, null);
  assert.equal(r.evolucao.patrimonio.valor, 11000);
  assert.deepEqual(r.aportes, { total: 10050, bruto: 10000, taxas: 50, n: 1 });
  assert.equal(resumoMes({ transacoes: [], mes: '2026-02' }).vazio, true);
});

test('serieMensal: um ponto por mês desde a 1ª transação', () => {
  const s = serieMensal({ transacoes: T, precosPorMes: { '2026-01': JAN, '2026-02': FEV }, ate: '2026-03' });
  assert.deepEqual(s.map((x) => [x.mes, x.patrimonio, x.investido]), [
    ['2026-01', 11000, 10050], ['2026-02', 28500, 26070],
    ['2026-03', 26070, 26070], // março sem preços: tudo ao custo
  ]);
  assert.deepEqual(s[2].estimados, ['AAA3', 'BBB3']);
  assert.deepEqual(serieMensal({ transacoes: [], ate: '2026-03' }), []);
  assert.deepEqual(serieMensal({ transacoes: T, ate: '2025-12' }), []);
});

const compra = (id, data) => ({ id, tipo: 'compra', data, ativo: 'AAA3', qtd: 1, preco: 100 });

test('marcos: primeiro aporte e primeiro provento, ignorando excluídas e futuras', () => {
  const m = marcos({
    transacoes: [{ ...compra(1, '2026-01-02'), excluido: true }, compra(2, '2026-11-12'), { id: 3, tipo: 'provento', data: '2026-12-01', ativo: 'AAA3', valor: 5 }, compra(4, '2027-01-01')],
    patrimonioPorMes: [], hoje: '2026-11-20',
  });
  assert.deepEqual(m, [{ id: 'primeiro-aporte', data: '2026-11-12', texto: 'Primeiro aporte registrado em 12/11/2026' }]);
});

test('marcos: 6 meses seguidos exige meses consecutivos; um buraco recomeça a conta', () => {
  const seguidos = [1, 2, 3, 4, 5, 6].map((n) => compra(n, `2026-0${n}-${n === 3 ? '20' : '10'}`));
  assert.equal(marcos({ transacoes: seguidos, hoje: '2026-06-30' }).find((x) => x.id === 'aportes-6-meses').data, '2026-06-10');
  assert.equal(marcos({ transacoes: seguidos.slice(0, 5), hoje: '2026-06-30' }).some((x) => x.id === 'aportes-6-meses'), false);
  const buraco = [1, 2, 3, 5, 6, 7].map((n) => compra(n, `2026-0${n}-10`)); // falta abril
  assert.equal(marcos({ transacoes: buraco, hoje: '2026-07-31' }).some((x) => x.id === 'aportes-6-meses'), false);
  // 12 seguidos: jan/2026 a dez/2026; vários aportes no mesmo mês contam uma vez só
  const ano = [...Array(12)].map((_, i) => compra(i + 1, `2026-${String(i + 1).padStart(2, '0')}-05`)).concat(compra(99, '2026-12-06'));
  const r = marcos({ transacoes: ano, hoje: '2026-12-31' });
  assert.equal(r.find((x) => x.id === 'aportes-6-meses').data, '2026-06-05');
  assert.equal(r.find((x) => x.id === 'aportes-12-meses').data, '2026-12-05');
});

test('marcos: patrimônio de R$ 10 mil, 50 mil e 100 mil (fim do mês; mês corrente usa hoje)', () => {
  const pm = [{ mes: '2026-01', patrimonio: 900_000 }, { mes: '2026-02', patrimonio: 1_000_000 }, { mes: '2026-03', patrimonio: 5_200_000 }, { mes: '2026-04', patrimonio: 20_000_000 }];
  const r = marcos({ transacoes: [], patrimonioPorMes: pm, hoje: '2026-03-15' }); // abril é futuro: fora
  assert.deepEqual(r, [
    { id: 'patrimonio-10k', data: '2026-02-28', texto: 'Patrimônio acima de R$ 10 mil em 02/2026' },
    { id: 'patrimonio-50k', data: '2026-03-15', texto: 'Patrimônio acima de R$ 50 mil em 03/2026' },
  ]);
  assert.equal(marcos({ transacoes: [], patrimonioPorMes: pm, hoje: '2026-04-30' }).at(-1).id, 'patrimonio-100k');
});

test('novosMarcos: só os que ainda não foram mostrados', () => {
  const al = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(novosMarcos(al, ['b']), [{ id: 'a' }, { id: 'c' }]);
  assert.deepEqual(novosMarcos(al), al);
  assert.deepEqual(novosMarcos(al, ['a', 'b', 'c']), []);
});
