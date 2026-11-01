import test from 'node:test';
import assert from 'node:assert/strict';
import { calcular, validar, resumo, precoMedio } from '../js/core/posicoes.js';

// Cenário conferido à mão (centavos):
//  compra 100 PETR4 a 30,00 + 1,00 de taxa  -> custo 300100
//  compra  50 PETR4 a 33,00 + 0,50          -> custo 465150, 150 cotas
//  venda   60 PETR4 a 36,00 - 0,80          -> tira 465150*60/150 = 186060 -> custo 279090, 90 cotas
//  transferência 10 HGLG11 a 160,00         -> custo 160000
//  caixa = 500000 - 300100 - 165050 + 215920 + 4500 - 10000 = 245270
const T = [
  { id: 1, tipo: 'deposito', data: '2026-01-10', valor: 500000 },
  { id: 2, tipo: 'compra', data: '2026-01-15', ativo: 'PETR4', qtd: 100, preco: 3000, taxas: 100 },
  { id: 3, tipo: 'compra', data: '2026-02-10', ativo: 'PETR4', qtd: 50, preco: 3300, taxas: 50 },
  { id: 4, tipo: 'venda', data: '2026-03-05', ativo: 'PETR4', qtd: 60, preco: 3600, taxas: 80 },
  { id: 5, tipo: 'transferencia', data: '2026-03-20', ativo: 'HGLG11', qtd: 10, preco: 16000 },
  { id: 6, tipo: 'provento', data: '2026-04-01', ativo: 'PETR4', valor: 4500 },
  { id: 7, tipo: 'retirada', data: '2026-04-02', valor: 10000 },
];

test('posições, custo proporcional na venda e caixa', () => {
  const r = calcular(T);
  assert.deepEqual(r.posicoes.get('PETR4'), { qtd: 90, custo: 279090 });
  assert.deepEqual(r.posicoes.get('HGLG11'), { qtd: 10, custo: 160000 });
  assert.equal(r.caixa, 245270);
  assert.deepEqual(r.erros, []);
  assert.equal(precoMedio(r.posicoes.get('PETR4')), 3101); // 279090 / 90 exato
});

test('a ordem de entrada não importa, só a data (e o registro em caso de empate)', () => {
  const embaralhada = [T[3], T[6], T[0], T[2], T[5], T[1], T[4]];
  const r = calcular(embaralhada);
  assert.deepEqual(r.posicoes.get('PETR4'), { qtd: 90, custo: 279090 });
  assert.equal(r.caixa, 245270);
});

test('venda maior que a posição é pulada e explicada', () => {
  const r = calcular([...T, { id: 8, tipo: 'venda', data: '2026-03-06', ativo: 'PETR4', qtd: 200, preco: 3500 }]);
  assert.deepEqual(r.erros, [{ id: 8, erros: ['A venda é maior que as 90 cotas que você tem.'] }]);
  assert.equal(r.posicoes.get('PETR4').qtd, 90); // nada mudou
  assert.equal(r.caixa, 245270);
});

test('corrigir uma compra pode invalidar uma venda posterior: avisa em vez de quebrar', () => {
  const t = T.map((x) => (x.id === 2 ? { ...x, excluido: true } : x)); // some a compra de 100
  const r = calcular(t); // sobram 50; a venda de 60 deixa de caber
  assert.equal(r.erros[0].id, 4);
  assert.equal(r.posicoes.get('PETR4').qtd, 50);
});

test('vender tudo remove a posição; custo some junto', () => {
  const r = calcular([
    { id: 1, tipo: 'compra', data: '2026-01-02', ativo: 'X', qtd: 3, preco: 33 },
    { id: 2, tipo: 'venda', data: '2026-01-03', ativo: 'X', qtd: 3, preco: 40 },
  ]);
  assert.equal(r.posicoes.has('X'), false);
  assert.equal(r.caixa, -99 + 120);
});

test('custo proporcional arredonda meio para longe do zero (100 em 3 cotas, vende 1 -> sobra 67)', () => {
  const r = calcular([
    { id: 1, tipo: 'compra', data: '2026-01-02', ativo: 'X', qtd: 3, preco: 1, taxas: 97 },
    { id: 2, tipo: 'venda', data: '2026-01-03', ativo: 'X', qtd: 1, preco: 1 },
  ]);
  assert.deepEqual(r.posicoes.get('X'), { qtd: 2, custo: 67 });
});

test('validar: mensagens de ajuda', () => {
  assert.deepEqual(validar({ tipo: 'compra', data: '2026-02-30', ativo: 'A', qtd: 1, preco: 1 }), ['Informe uma data válida.']);
  assert.deepEqual(validar({ tipo: 'compra', data: '2026-01-01', ativo: 'A', qtd: 0, preco: 1 }), ['A quantidade precisa ser um número inteiro maior que zero.']);
  assert.deepEqual(validar({ tipo: 'compra', data: '2026-01-01', ativo: 'A', qtd: 1, preco: 0 }), ['Informe o preço por cota.']);
  assert.deepEqual(validar({ tipo: 'venda', data: '2026-01-01', ativo: 'A', qtd: 40, preco: 1 }, 30), ['A venda é maior que as 30 cotas que você tem.']);
  assert.deepEqual(validar({ tipo: 'venda', data: '2026-01-01', ativo: 'A', qtd: 2, preco: 1 }, 1), ['A venda é maior que a 1 cota que você tem.']);
  assert.deepEqual(validar({ tipo: 'venda', data: '2026-01-01', ativo: 'A', qtd: 1, preco: 1 }, 0), ['Você não tem cotas de A para vender.']);
  assert.deepEqual(validar({ tipo: 'deposito', data: '2026-01-01', valor: 0 }), ['Informe um valor maior que zero.']);
  assert.deepEqual(validar({ tipo: 'compra', data: '2026-01-01', ativo: 'A', qtd: 1, preco: 1, taxas: -1 }), ['As taxas não podem ser negativas.']);
  assert.deepEqual(validar({ tipo: 'compra', data: '2026-01-01', ativo: 'A', qtd: 1.5, preco: 1 }), ['A quantidade precisa ser um número inteiro maior que zero.']);
  assert.deepEqual(validar({ tipo: 'xyz', data: '2026-01-01' }), ['Tipo de movimentação desconhecido.']);
  assert.deepEqual(validar({ tipo: 'venda', data: '2026-01-01', ativo: 'A', qtd: 30, preco: 1 }, 30), []);
});

test('resumo: saldo, custo, resultado e pesos; ativo sem preço fica de fora', () => {
  const { posicoes } = calcular(T);
  const r = resumo(posicoes, { PETR4: 3500, HGLG11: 16500 });
  assert.equal(r.saldo, 480000); // 90*3500 + 10*16500
  assert.equal(r.custo, 439090);
  assert.equal(r.resultado, 40910);
  assert.ok(Math.abs(r.resultadoPct - 0.09316996515520735) < 1e-12); // 40910/439090, conferido em Python
  assert.equal(r.itens.find((i) => i.ativo === 'PETR4').peso, 0.65625); // 315000/480000
  const sem = resumo(posicoes, new Map([['PETR4', 3500]]));
  assert.deepEqual(sem.semPreco, ['HGLG11']);
  assert.equal(sem.saldo, 315000);
  assert.equal(sem.custo, 279090); // o custo do ativo sem preço também sai, senão o % distorce
});

test('resumo de carteira vazia não divide por zero', () => {
  const r = resumo(new Map(), {});
  assert.deepEqual([r.saldo, r.custo, r.resultado, r.resultadoPct], [0, 0, 0, null]);
});
