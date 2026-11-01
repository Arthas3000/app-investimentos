import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatarCentavos, mascaraReais, paraCentavos, paraInteiro, filtrarAtivos, montarTransacao, resumoRegistro, totalEstimado, hojeIso,
} from '../js/ui/registrar.js';
import { variacaoDia, mudancasAnalise, textoProximoAporte, passosPendentes, sinalBrl, sinalPct, diaMes } from '../js/views/home.js';

test('formatarCentavos: milhar com ponto, centavos com vírgula', () => {
  assert.equal(formatarCentavos(123456), 'R$ 1.234,56');
  assert.equal(formatarCentavos(5), 'R$ 0,05');
  assert.equal(formatarCentavos(0), 'R$ 0,00');
  assert.equal(formatarCentavos(100000000), 'R$ 1.000.000,00');
});

test('máscara: os dígitos entram pela direita, só dígitos contam', () => {
  assert.equal(mascaraReais(''), '');
  assert.equal(mascaraReais('abc'), '');
  assert.equal(mascaraReais('1'), 'R$ 0,01');
  assert.equal(mascaraReais('12'), 'R$ 0,12');
  assert.equal(mascaraReais('123'), 'R$ 1,23');
  assert.equal(mascaraReais('R$ 1,23' + '4'), 'R$ 12,34'); // digitou mais um dígito no campo já formatado
  assert.equal(mascaraReais('R$ 12,3'), 'R$ 1,23'); // apagou um dígito
  assert.equal(mascaraReais('0003'), 'R$ 0,03'); // zeros à esquerda não contam
  assert.equal(mascaraReais('9'.repeat(20)), 'R$ 999.999.999,99'); // teto de 11 dígitos
});

test('paraCentavos entende o campo mascarado e o texto colado', () => {
  assert.equal(paraCentavos('R$ 1.234,56'), 123456);
  assert.equal(paraCentavos('38,12'), 3812);
  assert.equal(paraCentavos('1234,5'), 123450);
  assert.equal(paraCentavos('12.50'), 1250); // ponto com 2 dígitos depois = decimal
  assert.equal(paraCentavos('1.234'), 123400); // ponto com 3 dígitos depois = milhar
  assert.equal(paraCentavos('10'), 1000);
  assert.equal(paraCentavos('R$ 0,00'), 0);
  assert.equal(paraCentavos(mascaraReais('4590')), 4590);
});

test('paraCentavos recusa o que não dá para entender', () => {
  for (const ruim of ['', '   ', 'abc', '-5', '1,2,3', 'R$', null, undefined, '12,50x']) assert.equal(paraCentavos(ruim), null, String(ruim));
});

test('paraInteiro: só dígitos, vazio vira null', () => {
  assert.equal(paraInteiro('100'), 100);
  assert.equal(paraInteiro('1.0a0'), 100);
  assert.equal(paraInteiro(''), null);
  assert.equal(paraInteiro('abc'), null);
});

const LISTA = [
  { codigo: 'PETR4', nome: 'Petróleo Brasileiro PN' }, { codigo: 'PETR3', nome: 'Petróleo Brasileiro ON' },
  { codigo: 'VALE3', nome: 'Vale ON' }, { codigo: 'HGLG11', nome: 'CSHG Logística FII' }, { codigo: 'MXRF11', nome: 'Maxi Renda FII' },
];

test('busca por código ou nome, sem acento, código exato primeiro', () => {
  assert.deepEqual(filtrarAtivos(LISTA, 'petr4').map((a) => a.codigo), ['PETR4']);
  assert.deepEqual(filtrarAtivos(LISTA, 'petr').map((a) => a.codigo), ['PETR3', 'PETR4']); // mesmo grau: ordem do código
  assert.deepEqual(filtrarAtivos(LISTA, 'logistica').map((a) => a.codigo), ['HGLG11']);
  assert.deepEqual(filtrarAtivos(LISTA, 'PETROLEO').map((a) => a.codigo), ['PETR3', 'PETR4']);
  assert.deepEqual(filtrarAtivos(LISTA, 'fii').map((a) => a.codigo), ['HGLG11', 'MXRF11']);
  assert.deepEqual(filtrarAtivos(LISTA, ''), []);
  assert.deepEqual(filtrarAtivos(LISTA, 'zzz'), []);
  assert.equal(filtrarAtivos(LISTA, 'o', 2).length, 2); // respeita o limite
});

test('montarTransacao: compra com campos mascarados', () => {
  const t = montarTransacao({ tipo: 'compra', data: '2026-05-20', ativo: ' petr4 ', qtd: '10', preco: 'R$ 38,12', taxas: '', valor: '' });
  assert.deepEqual(t, { tipo: 'compra', data: '2026-05-20', ativo: 'PETR4', qtd: 10, preco: 3812 });
  assert.equal(montarTransacao({ tipo: 'venda', data: '2026-05-20', ativo: 'VALE3', qtd: '5', preco: 'R$ 60,00', taxas: 'R$ 1,50' }).taxas, 150);
});

test('montarTransacao: campo vazio fica de fora (validar explica o que falta)', () => {
  assert.deepEqual(montarTransacao({ tipo: 'compra', data: '2026-05-20', ativo: '', qtd: '', preco: '' }), { tipo: 'compra', data: '2026-05-20' });
  const dep = montarTransacao({ tipo: 'deposito', data: '2026-05-20', ativo: 'PETR4', valor: 'R$ 500,00', qtd: '3' });
  assert.deepEqual(dep, { tipo: 'deposito', data: '2026-05-20', valor: 50000 }); // depósito não leva ativo nem cotas
  assert.deepEqual(montarTransacao({ tipo: 'provento', data: '2026-05-20', ativo: 'mxrf11', valor: 'R$ 12,00' }), { tipo: 'provento', data: '2026-05-20', ativo: 'MXRF11', valor: 1200 });
});

test('resumoRegistro: frase calma, concordando com o gênero', () => {
  assert.equal(resumoRegistro({ tipo: 'compra', ativo: 'PETR4', qtd: 10, preco: 3812 }), 'Compra registrada: 10 × PETR4 a R$ 38,12.');
  assert.equal(resumoRegistro({ tipo: 'deposito', valor: 50000 }), 'Depósito registrado: R$ 500,00.');
  assert.equal(resumoRegistro({ tipo: 'provento', ativo: 'MXRF11', valor: 1200 }), 'Provento registrado: R$ 12,00 de MXRF11.');
  assert.equal(resumoRegistro({ tipo: 'retirada', valor: 100 }), 'Retirada registrada: R$ 1,00.');
});

test('totalEstimado: taxas somam na compra e descontam na venda', () => {
  assert.equal(totalEstimado({ tipo: 'compra', qtd: '10', preco: 'R$ 38,12', taxas: 'R$ 1,00' }), 38220);
  assert.equal(totalEstimado({ tipo: 'venda', qtd: '10', preco: 'R$ 38,12', taxas: 'R$ 1,00' }), 38020);
  assert.equal(totalEstimado({ tipo: 'compra', qtd: '', preco: 'R$ 38,12' }), null);
  assert.equal(totalEstimado({ tipo: 'deposito', qtd: '1', preco: 'R$ 1,00' }), null);
});

test('hojeIso usa a data local, não UTC', () => {
  assert.equal(hojeIso(new Date(2026, 4, 20, 23, 30)), '2026-05-20');
  assert.equal(hojeIso(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});

test('variação do dia: valor antes = valor ÷ (1 + variação)', () => {
  const itens = [{ ativo: 'A', valor: 11000 }, { ativo: 'B', valor: 9000 }];
  const r = variacaoDia(itens, new Map([['A', 10], ['B', -10]]));
  assert.equal(r.valor, 0); // A: 11000-10000 = +1000; B: 9000-10000 = −1000
  assert.equal(r.parcial, false);
  const so = variacaoDia(itens, new Map([['A', 10]]));
  assert.equal(so.valor, 1000);
  assert.equal(so.pct, 0.1);
  assert.equal(so.parcial, true); // B ficou de fora
  assert.equal(variacaoDia(itens, new Map()), null);
  assert.equal(variacaoDia([{ ativo: 'A', valor: null }], new Map([['A', 5]])), null); // sem preço: nada a inventar
});

test('mudanças desde a última visita: só ativos nos dois retratos, indicação e faixa', () => {
  const antes = { A: { ind: ['neutro', 'Neutro'], faixa: ['caro', 'Caro'] }, B: { ind: ['boa', 'Boa'], faixa: ['normal', 'Normal'] }, C: { ind: ['neutro', 'Neutro'], faixa: ['normal', 'Normal'] } };
  const agora = {
    A: { ind: ['candidata', 'Preço atrativo pelos números'], faixa: ['normal', 'Normal'] },
    B: { ind: ['boa', 'Boa'], faixa: ['indefinido', 'Faixa indefinida'] },
    D: { ind: ['evitar', 'Evitar'], faixa: ['barato', 'Barato'] },
  };
  assert.deepEqual(mudancasAnalise(antes, agora), [
    { ticker: 'A', tipo: 'indicacao', de: 'Neutro', para: 'Preço atrativo pelos números' },
    { ticker: 'A', tipo: 'faixa', de: 'Caro', para: 'Normal' },
  ]);
  assert.deepEqual(mudancasAnalise({}, agora), []);
  assert.deepEqual(mudancasAnalise(undefined, undefined), []);
});

test('próximo aporte em texto', () => {
  assert.equal(textoProximoAporte({ valor: 100000, dia: 5 }, '2026-11-01'), 'Seu próximo aporte é em 5/11.');
  assert.equal(textoProximoAporte({ valor: 100000, dia: 5 }, '2026-11-06'), 'Seu próximo aporte é em 5/12.');
  assert.equal(textoProximoAporte({ valor: 100000, dia: 5 }, '2026-11-05'), 'Seu aporte é hoje, 5/11.');
  assert.equal(textoProximoAporte(null, '2026-11-01'), '');
});

test('primeiros passos: somem quando concluídos ou dispensados', () => {
  const vazio = { transacoes: [], acompanhados: [], aporte: null };
  assert.deepEqual(passosPendentes({ estado: vazio, temToken: '', dispensados: [] }), ['fonte', 'ativo', 'aporte']);
  assert.deepEqual(passosPendentes({ estado: vazio, temToken: 'abc', dispensados: ['aporte'] }), ['ativo']);
  const feito = { transacoes: [{ id: 1, excluido: true }], acompanhados: [{ ticker: 'VALE3' }], aporte: { valor: 1, dia: 1 } };
  assert.deepEqual(passosPendentes({ estado: feito, temToken: '', dispensados: [] }), ['fonte']); // acompanhar conta como primeiro ativo
  assert.deepEqual(passosPendentes({ estado: { ...feito, acompanhados: [] }, temToken: 'x' }), ['ativo']); // compra excluída não conta
});

test('formatos de sinal', () => {
  assert.equal(sinalBrl(12345), '+R$ 123,45');
  assert.equal(sinalBrl(-50), '−R$ 0,50');
  assert.equal(sinalBrl(0), 'R$ 0,00');
  assert.equal(sinalPct(0.0235), '+2,35%');
  assert.equal(sinalPct(-0.005), '−0,50%');
  assert.equal(sinalPct(null), '—');
  assert.equal(diaMes('2026-12-05'), '5/12');
});
