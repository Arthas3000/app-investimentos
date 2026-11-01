import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrar, agruparPorMes, totalMov, efeitoCaixa, ativosUsados } from '../js/core/historico-filtro.js';

const T = [
  { id: 1, tipo: 'deposito', data: '2026-01-05', valor: 100000 },
  { id: 2, tipo: 'compra', data: '2026-01-10', ativo: 'ITSA4', qtd: 10, preco: 1000, taxas: 50 },
  { id: 3, tipo: 'venda', data: '2026-02-03', ativo: 'ITSA4', qtd: 5, preco: 1200, taxas: 20 },
  { id: 4, tipo: 'provento', data: '2026-02-03', ativo: 'MXRF11', valor: 800 },
  { id: 5, tipo: 'compra', data: '2026-02-20', ativo: 'MXRF11', qtd: 1, preco: 1000, excluido: true },
];

test('totais e efeito no caixa', () => {
  assert.equal(totalMov(T[1]), 10050);
  assert.equal(totalMov(T[2]), 5980);
  assert.equal(efeitoCaixa(T[1]), -10050);
  assert.equal(efeitoCaixa({ tipo: 'transferencia', qtd: 2, preco: 100 }), 0);
});

test('filtrar: ordem, excluídas, tipo, ativo, período', () => {
  assert.deepEqual(filtrar(T).map((t) => t.id), [4, 3, 2, 1]); // empate de data: id maior primeiro
  assert.deepEqual(filtrar(T, { excluidas: true }).map((t) => t.id), [5, 4, 3, 2, 1]);
  assert.deepEqual(filtrar(T, { tipo: 'compra' }).map((t) => t.id), [2]);
  assert.deepEqual(filtrar(T, { ativo: 'mxrf11' }).map((t) => t.id), [4]);
  assert.deepEqual(filtrar(T, { de: '2026-01-10', ate: '2026-02-03' }).map((t) => t.id), [4, 3, 2]);
});

test('agruparPorMes: total ignora excluídas', () => {
  const g = agruparPorMes(filtrar(T, { excluidas: true }));
  assert.deepEqual(g.map((x) => [x.mes, x.itens.length, x.total]), [['2026-02', 3, 5980 + 800], ['2026-01', 2, 100000 - 10050]]);
  assert.deepEqual(agruparPorMes([]), []);
});

test('ativosUsados', () => assert.deepEqual(ativosUsados(T), ['ITSA4', 'MXRF11']));
