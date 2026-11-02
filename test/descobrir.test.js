import test from 'node:test';
import assert from 'node:assert/strict';
import { itemDescobrir, filtrar, ORDENS } from '../js/core/descobrir.js';

const an = (o = {}) => ({
  valor: { nota: 6, ms: 0.3, pvp: null, ...o.valor },
  indicacao: { id: 'neutro', rotulo: 'Neutro', motivos: [], ...o.indicacao },
  faixa: { id: 'barato', rotulo: 'Barato', motivos: ['m'], sinais: [], limites: { barato: 1000, caro: 2000 }, ...o.faixa },
});
const ativo = (codigo, o = {}) => ({ codigo, nome: `${codigo} S.A.`, tipo: 'acao', preco: 9, setor: 'Finance', ...o });

test('itemDescobrir: só entra o que está na faixa barato e com análise', () => {
  assert.equal(itemDescobrir(ativo('AAA3'), { semDados: true }), null);
  assert.equal(itemDescobrir(ativo('AAA3'), null), null);
  assert.equal(itemDescobrir(ativo('AAA3'), an({ faixa: { id: 'normal' } })), null);
  const i = itemDescobrir(ativo('AAA3'), an());
  assert.equal(i.codigo, 'AAA3');
  assert.equal(i.classe, 'acao');
  assert.equal(i.desconto, 0.3); // ação: margem de segurança
  assert.equal(i.posHist, 0.9); // R$ 9,00 ÷ corte de R$ 10,00
});

test('itemDescobrir: FII usa 1 ÷ P/VP − 1 como desconto; sem preço fica de fora', () => {
  const f = itemDescobrir(ativo('FFF11', { tipo: 'fii' }), an({ valor: { ms: null, pvp: 0.8 } }));
  assert.equal(f.classe, 'fii');
  assert.ok(Math.abs(f.desconto - 0.25) < 1e-12);
  assert.equal(itemDescobrir(ativo('AAA3', { preco: null }), an()), null);
});

const lista = [
  itemDescobrir(ativo('BBB3'), an({ valor: { nota: 8, ms: 0.1 }, indicacao: { id: 'evitar' } })),
  itemDescobrir(ativo('AAA3', { nome: 'Ação Ãmbar' }), an({ valor: { nota: 5, ms: 0.5 } })),
  itemDescobrir(ativo('CCC11', { tipo: 'fii', preco: 5 }), an({ valor: { nota: null, ms: null, pvp: 0.9 } })),
  itemDescobrir(ativo('DDD3', { preco: 9.9 }), an({ valor: { nota: 8, ms: 0.2 }, faixa: { limites: null } })),
];

test('filtrar: tipo, busca sem acento por código ou nome e ocultar Evitar', () => {
  const cods = (o) => filtrar(lista, { tipo: 'todos', q: '', ocultarEvitar: false, ord: 'codigo', ...o }).map((i) => i.codigo);
  assert.deepEqual(cods(), ['AAA3', 'BBB3', 'CCC11', 'DDD3']);
  assert.deepEqual(cods({ tipo: 'fii' }), ['CCC11']);
  assert.deepEqual(cods({ q: 'ambar' }), ['AAA3']);
  assert.deepEqual(cods({ q: 'ddd' }), ['DDD3']);
  assert.deepEqual(cods({ ocultarEvitar: true }), ['AAA3', 'CCC11', 'DDD3']);
});

test('ordens: nota (sem nota por último, empate pelo código), desconto e posição no histórico', () => {
  const cods = (ord) => filtrar(lista, { tipo: 'todos', q: '', ocultarEvitar: false, ord }).map((i) => i.codigo);
  assert.deepEqual(cods('nota'), ['BBB3', 'DDD3', 'AAA3', 'CCC11']);
  assert.deepEqual(cods('desconto'), ['AAA3', 'DDD3', 'CCC11', 'BBB3']); // 50%, 20%, 11,1%, 10%
  assert.deepEqual(cods('historico'), ['CCC11', 'AAA3', 'BBB3', 'DDD3']); // 0,5; 0,9; 0,9 (código); sem limite por último
  assert.deepEqual(Object.keys(ORDENS), ['nota', 'desconto', 'historico', 'codigo']);
});
