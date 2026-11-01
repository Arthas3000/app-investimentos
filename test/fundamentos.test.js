import test from 'node:test';
import assert from 'node:assert/strict';
import { fimMes, inicioTri, trimestre, trimestres, acoesPorUnit, tipoEmpresa, escalaAcoes, derivar }
  from '../scripts/atualizar-fundamentos.mjs';

test('datas: fim do mês deslocado e início do trimestre', () => {
  assert.equal(fimMes('2026-06-30', -3), '2026-03-31');
  assert.equal(fimMes('2026-03-31', -3), '2025-12-31');
  assert.equal(fimMes('2026-05-31', 1), '2026-06-30');
  assert.equal(fimMes('2026-06-30', -12), '2025-06-30');
  assert.equal(inicioTri('2026-06-30'), '2026-04-01');
  assert.equal(inicioTri('2025-12-31'), '2025-10-01');
});

test('trimestre: desacumula DRE/DFC (2º, 3º e 4º tri) e prefere o trimestre direto', () => {
  const f = new Map([
    ['2026-01-01|2026-03-31', 10],
    ['2026-01-01|2026-06-30', 25],
    ['2026-01-01|2026-09-30', 45],
    ['2026-01-01|2026-12-31', 70],
  ]);
  assert.equal(trimestre(f, '2026-03-31'), 10);
  assert.equal(trimestre(f, '2026-06-30'), 15);
  assert.equal(trimestre(f, '2026-09-30'), 20);
  assert.equal(trimestre(f, '2026-12-31'), 25);
  f.set('2026-04-01|2026-06-30', 16); // CVM trouxe o trimestre isolado
  assert.equal(trimestre(f, '2026-06-30'), 16);
  assert.equal(trimestre(new Map([['2026-01-01|2026-09-30', 45]]), '2026-09-30'), null); // falta o acumulado de 6m
  assert.equal(trimestre(undefined, '2026-09-30'), null);
});

test('trimestres: n últimos, mais recente primeiro, null onde falta', () => {
  const f = new Map([['2026-01-01|2026-03-31', 10], ['2026-01-01|2026-06-30', 25], ['2025-01-01|2025-12-31', 40], ['2025-01-01|2025-09-30', 28]]);
  assert.deepEqual(trimestres(f, '2026-06-30', 4), [15, 10, 12, null]); // Q4/25 = 40-28; Q3/25 sem 6m
});

test('acoesPorUnit lê os formatos do FCA', () => {
  assert.equal(acoesPorUnit('1 ON / 2 PN'), 3);
  assert.equal(acoesPorUnit('1 KLBN3 + 4 KLBN4'), 5);
  assert.equal(acoesPorUnit('1 ON + 1 PN'), 2);
  assert.equal(acoesPorUnit('1 ON E 2 PNA'), 3);
  assert.equal(acoesPorUnit(''), null);
});

test('tipoEmpresa: banco, incorporadora, commodity, geral', () => {
  assert.equal(tipoEmpresa({ financeira: true, setor: 'Bancos' }), 'banco');
  assert.equal(tipoEmpresa({ setor: 'Construção Civil, Mat. Constr. e Decoração', atividade: 'Incorporação Imobiliária', nome: 'X' }), 'incorporadora');
  assert.equal(tipoEmpresa({ setor: 'Construção Civil, Mat. Constr. e Decoração', atividade: 'Fabrica cimento', nome: 'Y' }), 'geral');
  assert.equal(tipoEmpresa({ setor: 'Emp. Adm. Part. - Const. Civil, Mat. Const. e Decoração', atividade: 'Incorporação', nome: 'Z' }), 'incorporadora');
  assert.equal(tipoEmpresa({ setor: 'Extração Mineral', atividade: '', nome: 'Mina' }), 'commodity');
  assert.equal(tipoEmpresa({ setor: 'Emp. Adm. Part. - Petróleo e Gás', atividade: '', nome: 'P' }), 'commodity');
  assert.equal(tipoEmpresa({ setor: 'Energia Elétrica', atividade: '', nome: 'E' }), 'geral');
});

test('escalaAcoes: ações em unidades ou em milhares, conferidas pelo LPA publicado', () => {
  assert.equal(escalaAcoes(11e9, 24e9, 2.2), 1); // lucro 24 bi / 11 bi ações = 2,18
  assert.equal(escalaAcoes(11e6, 24e9, 2.2), 1000); // 11 milhões "de milhares"
  assert.equal(escalaAcoes(11e9, 24e9, 0), null); // LPA zerado no ITR
  assert.equal(escalaAcoes(11e9, 24e9, 40), null); // incoerente nas duas escalas
  assert.equal(escalaAcoes(0, 24e9, 2.2), null);
});

const base = () => ({
  tipo: 'geral',
  lucro: [100, 100, 100, 100, 80, 80, 80, 80],
  receita: [500, 500, 500, 500, 400, 400, 400, 400],
  ebit: [150, 150, 150, 150],
  da: [50, 50, 50, 50],
  pl: [1000, 950, 900],
  plTotal: 1100,
  caixa: 400,
  dividaBruta: 1200,
  ativoCirc: 600,
  passivoCirc: 300,
  acoes: 100,
});

test('derivar: números sintéticos conferidos à mão', () => {
  const d = derivar(base());
  assert.equal(d.roe12m, 0.4211); // 400 / média(1000, 900) = 400/950
  assert.equal(d.roeTri, 0.1026); // 100 / média(1000, 950) = 100/975, não anualizado
  assert.deepEqual(d.lucrosTri, [100, 100, 100, 100, 80, 80, 80, 80]);
  assert.equal(d.crescReceita12m, 0.25); // 2000 / 1600 - 1
  assert.equal(d.dlEbitda, 1); // DL = 1200 - 400 = 800; EBITDA = 600 + 200
  assert.equal(d.dlPl, 0.7273); // 800 / 1100
  assert.equal(d.liqCorrente, 2);
  assert.equal(d.roic, 0.2084); // 600 x 0,66 / (1100 + 800)
  assert.equal(d.vpa, 10);
  assert.equal(d.lpa12m, 4);
  assert.deepEqual(d.aproximacoes, ['ebitda', 'dividaLiquida', 'roic', 'vpa', 'lpa12m']);
});

test('derivar: dado ausente vira null e o resto continua', () => {
  const sem = { ...base(), lucro: [100, 100, null, 100, 80, 80, 80, 80], da: [null, 50, 50, 50] };
  const d = derivar(sem);
  assert.equal(d.roe12m, null); // falta um tri no LTM
  assert.equal(d.lpa12m, null);
  assert.equal(d.roeTri, 0.1026); // o último tri existe
  assert.equal(d.dlEbitda, null); // sem D&A não há EBITDA
  assert.equal(d.dlPl, 0.7273);
  assert.equal(d.lucrosTri[2], null);
  assert.ok(!d.aproximacoes.includes('ebitda'));
});

test('derivar: EBITDA <= 0, PL <= 0 e sem PL de 12m', () => {
  assert.equal(derivar({ ...base(), ebit: [-100, -100, -100, -100], da: [10, 10, 10, 10] }).dlEbitda, null);
  assert.equal(derivar({ ...base(), pl: [-50, -10, 20] }).roe12m, null);
  assert.equal(derivar({ ...base(), pl: [1000, 950, null] }).roe12m, 0.4); // usa só o PL de E
  assert.equal(derivar({ ...base(), plTotal: -5 }).dlPl, null);
});

test('derivar: banco só tem ROE, lucros, crescimento e por ação', () => {
  const d = derivar({ ...base(), tipo: 'banco' });
  assert.equal(d.roe12m, 0.4211);
  assert.equal(d.crescReceita12m, 0.25);
  for (const k of ['dlEbitda', 'dlPl', 'liqCorrente', 'roic']) assert.equal(d[k], null, k);
  assert.deepEqual(d.aproximacoes, ['vpa', 'lpa12m']);
});

test('derivar: unit multiplica o valor por ação; unit ilegível zera vpa/lpa', () => {
  const d = derivar({ ...base(), acoesUnit: 3 });
  assert.equal(d.vpa, 30);
  assert.equal(d.lpa12m, 12);
  const n = derivar({ ...base(), acoesUnit: null });
  assert.equal(n.vpa, null);
  assert.equal(n.lpa12m, null);
});

test('derivar: tudo ausente não quebra', () => {
  const vazio = { tipo: 'geral', lucro: Array(8).fill(null), receita: Array(8).fill(null), ebit: Array(4).fill(null), da: Array(4).fill(null),
    pl: [null, null, null], plTotal: null, caixa: null, dividaBruta: null, ativoCirc: null, passivoCirc: null, acoes: null };
  const d = derivar(vazio);
  for (const k of ['roe12m', 'roeTri', 'dlEbitda', 'dlPl', 'liqCorrente', 'roic', 'crescReceita12m', 'vpa', 'lpa12m']) assert.equal(d[k], null, k);
  assert.deepEqual(d.aproximacoes, []);
});
