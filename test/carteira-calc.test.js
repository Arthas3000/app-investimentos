import test from 'node:test';
import assert from 'node:assert/strict';
import { visaoCarteira, desdeUltimaVisita, proximoAporte } from '../js/core/carteira-calc.js';

const T = [
  { id: 1, tipo: 'compra', data: '2026-01-15', ativo: 'PETR4', qtd: 100, preco: 3000 }, // custo 300000
  { id: 2, tipo: 'compra', data: '2026-01-16', ativo: 'HGLG11', qtd: 10, preco: 16000 }, // custo 160000
  { id: 3, tipo: 'compra', data: '2026-01-17', ativo: 'VALE3', qtd: 5, preco: 6000 }, // sem preço
];

test('visão: valores, peso e distância do alvo em pontos percentuais', () => {
  const v = visaoCarteira({ transacoes: T, alvos: { PETR4: 50, HGLG11: 30 } }, { PETR4: 4000, HGLG11: 20000 });
  // PETR4 valor 400000, HGLG11 valor 200000 -> saldo 600000
  assert.equal(v.saldo, 600000);
  assert.deepEqual(v.itens.map((i) => i.ativo), ['PETR4', 'HGLG11', 'VALE3']); // maior valor primeiro, sem preço no fim
  const [p, h, vale] = v.itens;
  assert.ok(Math.abs(p.peso - 66.6667) < 1e-3);
  assert.ok(Math.abs(p.distancia - (66.6667 - 50)) < 1e-3);
  assert.ok(Math.abs(h.distancia - (33.3333 - 30)) < 1e-3);
  assert.equal(p.resultado, 100000);
  assert.deepEqual([vale.preco, vale.valor, vale.peso, vale.distancia], [null, null, null, null]);
  assert.deepEqual(v.semPreco, ['VALE3']);
  assert.equal(v.itens.find((i) => i.ativo === 'VALE3').qtd, 5);
});

test('sem alvo a distância é null; aceita Map de preços', () => {
  const v = visaoCarteira({ transacoes: T }, new Map([['PETR4', 3000]]));
  assert.equal(v.itens[0].distancia, null);
  assert.equal(v.itens[0].alvo, null);
});

test('acompanhados com qtd 0: fora da carteira, preço opcional, distância do alvo', () => {
  const v = visaoCarteira(
    { transacoes: T, acompanhados: [{ ticker: 'PETR4', desde: '2026-01-01' }, { ticker: 'ITUB4', desde: '2026-02-01' }, { ticker: 'MXRF11', desde: '2026-02-02' }], alvos: { ITUB4: 10 } },
    { ITUB4: 3500 });
  assert.deepEqual(v.acompanhados.map((a) => a.ativo), ['ITUB4', 'MXRF11']); // PETR4 já é posição
  assert.deepEqual(v.acompanhados[0], { ativo: 'ITUB4', desde: '2026-02-01', qtd: 0, preco: 3500, alvo: 10, distancia: -10 });
  assert.equal(v.acompanhados[1].preco, null);
});

test('estado vazio e erros de reprocessamento passam adiante', () => {
  assert.equal(visaoCarteira({}, {}).vazio, true);
  assert.equal(visaoCarteira({ acompanhados: [{ ticker: 'A1', desde: null }] }, {}).vazio, false);
  const v = visaoCarteira({ transacoes: [{ id: 1, tipo: 'venda', data: '2026-01-01', ativo: 'X1', qtd: 1, preco: 100 }] }, {});
  assert.equal(v.erros.length, 1);
});

test('desdeUltimaVisita é stub: sempre []', () => {
  assert.deepEqual(desdeUltimaVisita({ ultimaVisita: '2026-01-01' }, { PETR4: {} }), []);
});

test('próximo aporte: este mês, próximo mês, hoje conta, dia 31 em mês curto', () => {
  const a = { valor: 50000, dia: 10 };
  assert.deepEqual(proximoAporte(a, '2026-03-05'), { data: '2026-03-10', dias: 5, valor: 50000 });
  assert.deepEqual(proximoAporte(a, '2026-03-10'), { data: '2026-03-10', dias: 0, valor: 50000 });
  assert.deepEqual(proximoAporte(a, '2026-03-11'), { data: '2026-04-10', dias: 30, valor: 50000 });
  assert.equal(proximoAporte({ valor: 1, dia: 31 }, '2026-04-05').data, '2026-04-30');
  assert.equal(proximoAporte({ valor: 1, dia: 31 }, '2026-02-01').data, '2026-02-28');
  assert.equal(proximoAporte({ valor: 1, dia: 31 }, '2026-12-31').data, '2026-12-31');
  assert.equal(proximoAporte({ valor: 1, dia: 15 }, '2026-12-20').data, '2027-01-15');
  assert.equal(proximoAporte(null, '2026-03-05'), null);
  assert.equal(proximoAporte({ valor: 1, dia: 0 }, '2026-03-05'), null);
  assert.equal(proximoAporte({ dia: 5 }, '2026-03-01').valor, null);
});
