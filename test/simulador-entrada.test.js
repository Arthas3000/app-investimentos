import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIODOS, estadoInicial, limparEstado, periodoDe, isoDe, fmtData, deBcb, duracaoTexto, pesosIguaisTexto, pesosDaCarteiraTexto,
  somaPesos, validar, fmtRetorno, fmtQueda, fmtGanho, fmtCompacto, quadro, indicesAmostra, grafico, indicesTabela, descricaoGrafico,
} from '../js/core/simulador-entrada.js';
import { simular } from '../js/core/simulador.js';
import { formatarCentavos } from '../js/ui/registrar.js';

const DADOS = { primeira: '2021-11-01', ultima: '2026-10-30' };
const ok = (over = {}) => ({ ...estadoInicial(), ativos: [{ ticker: 'PETR4', nome: '', peso: '60' }, { ticker: 'VALE3', nome: '', peso: '40' }], inicial: 'R$ 1.000,00', mensal: 'R$ 500,00', ...over });

test('periodoDe: 1, 3 e 5 anos terminam no último pregão e nunca passam do começo dos dados', () => {
  assert.deepEqual(periodoDe('1a', DADOS), { inicio: '2025-10-30', fim: '2026-10-30', limitado: false, opcao: '1a' });
  assert.equal(periodoDe('3a', DADOS).inicio, '2023-10-30');
  const cinco = periodoDe('5a', DADOS); // 30/10/2021 é antes do 1º dado (01/11/2021)
  assert.equal(cinco.inicio, '2021-11-01'); assert.equal(cinco.limitado, true);
  assert.equal(periodoDe('xx', DADOS).opcao, '3a'); // opção desconhecida: padrão de 3 anos
});

test('periodoDe max: começa no ativo mais antigo escolhido, nunca antes do Ibovespa', () => {
  assert.equal(periodoDe('max', DADOS).inicio, '2021-11-01');
  assert.equal(periodoDe('max', { ...DADOS, primeirasAtivos: ['2023-05-02', '2022-03-01'] }).inicio, '2022-03-01');
  assert.equal(periodoDe('max', { ...DADOS, primeirasAtivos: ['2020-01-02'] }).inicio, '2021-11-01');
  assert.equal(periodoDe('1a', { primeira: '2026-06-01', ultima: '2026-10-30' }).limitado, true);
});

test('datas e duração', () => {
  assert.equal(isoDe(20211101), '2021-11-01'); assert.equal(isoDe('2021-11-01'), '2021-11-01');
  assert.equal(fmtData('2026-10-30'), '30/10/2026');
  assert.equal(deBcb('2023-10-30'), '01/10/2023');
  assert.equal(duracaoTexto('2023-10-30', '2026-10-30'), '3 anos');
  assert.equal(duracaoTexto('2025-12-01', '2026-10-30'), '10 meses');
  assert.equal(duracaoTexto('2024-08-15', '2026-10-30'), '2 anos e 2 meses');
  assert.equal(duracaoTexto('2026-10-01', '2026-10-20'), 'menos de 1 mês');
  assert.equal(duracaoTexto('2025-10-30', '2026-11-30'), '1 ano e 1 mês');
});

test('pesos iguais e da carteira somam exatamente 100%', () => {
  const p = pesosIguaisTexto(['A', 'B', 'C']);
  assert.deepEqual(p.map((x) => x.peso), ['33,34', '33,33', '33,33']);
  assert.ok(somaPesos(p).ok);
  const c = pesosDaCarteiraTexto([{ ativo: 'PETR4', valor: 30000, custo: 1 }, { ativo: 'VALE3', valor: 10000, custo: 1 }]);
  assert.deepEqual(c, [{ ticker: 'PETR4', peso: '75' }, { ticker: 'VALE3', peso: '25' }]);
  // sem preço de um deles: usa o custo de todos (não mistura valor com custo) e ignora quem não tem nada
  const s = pesosDaCarteiraTexto([{ ativo: 'A', valor: 5000, custo: 1000 }, { ativo: 'B', valor: null, custo: 3000 }, { ativo: 'C', valor: null, custo: 0 }]);
  assert.deepEqual(s, [{ ticker: 'A', peso: '25' }, { ticker: 'B', peso: '75' }]);
  assert.deepEqual(pesosDaCarteiraTexto([]), []);
  assert.ok(somaPesos(pesosDaCarteiraTexto([{ ativo: 'A', valor: 1, custo: 1 }, { ativo: 'B', valor: 1, custo: 1 }, { ativo: 'C', valor: 1, custo: 1 }])).ok);
});

test('somaPesos: diz quanto falta e aceita vírgula', () => {
  const r = somaPesos([{ ticker: 'A', peso: '12,5' }, { ticker: 'B', peso: '60' }, { ticker: 'C', peso: 'x' }]);
  assert.equal(r.soma, 72.5); assert.equal(r.falta, 27.5); assert.equal(r.ok, false);
});

test('validar: entrada boa vira argumentos de simular()', () => {
  const { erros, entrada } = validar(ok({ taxa: 'R$ 2,50', dia: '10', periodo: '1a', estrategia: 'rebalancear-aportes' }), DADOS);
  assert.deepEqual(erros, []);
  assert.deepEqual({ ...entrada, periodo: undefined }, {
    carteira: [{ ticker: 'PETR4', pesoPct: 60 }, { ticker: 'VALE3', pesoPct: 40 }], aporteInicial: 100000, aporteMensal: 50000, diaAporte: 10,
    estrategia: 'rebalancear-aportes', taxaPorOrdem: 250, inicio: '2025-10-30', fim: '2026-10-30', periodo: undefined,
  });
});

test('validar: cada problema tem campo e mensagem em português simples', () => {
  const campos = (est, d = DADOS) => validar(est, d).erros.map((e) => e.campo);
  assert.deepEqual(campos(ok({ ativos: [] })), ['ativos']);
  assert.deepEqual(campos(ok({ ativos: [{ ticker: 'A', peso: '50' }, { ticker: 'B', peso: '49,99' }] })), ['ativos']);
  assert.match(validar(ok({ ativos: [{ ticker: 'A', peso: '50' }, { ticker: 'B', peso: '49' }] }), DADOS).erros[0].msg, /somam 99%.*100%/);
  assert.deepEqual(campos(ok({ ativos: [{ ticker: 'A', peso: 'abc' }] })), ['peso:A']);
  assert.deepEqual(campos(ok({ inicial: '', mensal: '' })), ['inicial']);
  assert.deepEqual(campos(ok({ inicial: 'oi' })), ['inicial']);
  assert.deepEqual(campos(ok({ dia: '32' })), ['dia']);
  assert.deepEqual(campos(ok({ dia: '' })), ['dia']);
  assert.deepEqual(campos(ok({ taxa: '-3' })), ['taxa']);
  assert.deepEqual(campos(ok({ estrategia: 'nada' })), ['estrategia']);
  assert.deepEqual(campos(ok(), {}), ['periodo']);
  assert.deepEqual(campos(ok({ ativos: Array.from({ length: 11 }, (_, i) => ({ ticker: `T${i}`, peso: '9,09' })) })).includes('ativos'), true);
});

test('validar: só aporte inicial dispensa o dia; só mensal é permitido', () => {
  const a = validar(ok({ mensal: '', dia: '' }), DADOS);
  assert.deepEqual(a.erros, []); assert.equal(a.entrada.aporteMensal, 0); assert.equal(a.entrada.diaAporte, 1);
  assert.deepEqual(validar(ok({ inicial: '' }), DADOS).erros, []);
});

test('limparEstado: ignora lixo, repetidos, excesso e valores desconhecidos', () => {
  assert.deepEqual(limparEstado(null), estadoInicial());
  assert.deepEqual(limparEstado('x'), estadoInicial());
  const e = limparEstado({
    ativos: [{ ticker: 'petr4', peso: '50' }, { ticker: 'PETR4', peso: '10' }, { ticker: '<img>' }, { ticker: 7 }, null, { ticker: 'VALE3', nome: 'Vale', peso: 5 }],
    periodo: '9a', estrategia: 'x', inicial: 'R$ 10,00', mensal: 5, dia: '15',
  });
  assert.deepEqual(e.ativos, [{ ticker: 'PETR4', nome: '', peso: '50' }, { ticker: 'VALE3', nome: 'Vale', peso: '' }]);
  assert.equal(e.periodo, '3a'); assert.equal(e.estrategia, 'pesos-fixos'); assert.equal(e.inicial, 'R$ 10,00'); assert.equal(e.mensal, ''); assert.equal(e.dia, '15');
  const muitos = limparEstado({ ativos: Array.from({ length: 30 }, (_, i) => ({ ticker: `AAAA${i}`, peso: '1' })) });
  assert.equal(muitos.ativos.length, 10);
});

test('formatação: sinal e símbolo sempre, zero sem sinal', () => {
  assert.equal(fmtRetorno(0.1234), '+12,34%'); assert.equal(fmtRetorno(-0.05), '−5,00%'); assert.equal(fmtRetorno(-0.00001), '0,00%');
  assert.equal(fmtRetorno(null), '—'); assert.equal(fmtRetorno(NaN), '—'); assert.equal(fmtRetorno(1.5), '+150,00%');
  assert.equal(fmtQueda(0.2425), '−24,25%'); assert.equal(fmtQueda(0), '0,00%'); assert.equal(fmtQueda(null), '—');
  assert.equal(fmtGanho(107064), '+R$ 1.070,64'); assert.equal(fmtGanho(-1000), '−R$ 10,00'); assert.equal(fmtGanho(0), 'R$ 0,00');
  assert.equal(fmtCompacto(95000), 'R$ 950'); assert.equal(fmtCompacto(1250000), 'R$ 12,5 mil'); assert.equal(fmtCompacto(120000000), 'R$ 1,2 mi');
});

// série sintética de 70 pregões em 3 meses para os testes do resultado
const dias = Array.from({ length: 70 }, (_, i) => { const d = new Date(Date.UTC(2024, 0, 1 + Math.floor(i * 1.4))); return d.toISOString().slice(0, 10); });
const serie = (f) => dias.map((data, i) => ({ data, valor: Math.round(f(i)), aportadoAcum: 100000 }));
const SERIES = { carteira: serie((i) => 100000 + i * 900), ibov: serie((i) => 100000 + i * 500), cdi: serie((i) => 100000 + i * 100), ipca: serie((i) => 100000 + i * 30) };

test('indicesAmostra: no máximo `max` pontos, com o primeiro e o último', () => {
  assert.deepEqual(indicesAmostra(3, 10), [0, 1, 2]);
  const i = indicesAmostra(1248, 240);
  assert.equal(i.length, 240); assert.equal(i[0], 0); assert.equal(i.at(-1), 1247);
  assert.ok(i.every((v, k) => k === 0 || v > i[k - 1]));
});

test('grafico: um caminho por série, mesmo x, dentro do quadro', () => {
  const g = grafico(SERIES, ['carteira', 'ibov', 'cdi', 'ipca'], { W: 320, H: 140, max: 30 });
  assert.equal(g.linhas.length, 4); assert.equal(g.pontos, 30);
  for (const l of g.linhas) {
    const pts = [...l.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    assert.equal(pts.length, 30); assert.equal(pts[0][0], 0); assert.equal(pts.at(-1)[0], 320);
    assert.ok(pts.every(([, y]) => y >= 0 && y <= 140));
  }
  const ult = (id) => +g.linhas.find((l) => l.id === id).d.match(/L[\d.]+ ([\d.]+)$/)[1];
  assert.ok(ult('carteira') < ult('ibov') && ult('ibov') < ult('cdi') && ult('cdi') < ult('ipca')); // y menor = valor maior
  assert.equal(g.grade.length, 3); assert.ok(g.grade[0].y > g.grade[2].y);
  assert.equal(g.inicio, dias[0]); assert.equal(g.fim, dias.at(-1));
});

test('grafico: sem CDI/IPCA desenha só o que existe', () => {
  const g = grafico(SERIES, ['carteira', 'ibov']);
  assert.deepEqual(g.linhas.map((l) => l.id), ['carteira', 'ibov']);
});

test('indicesTabela: começo, fins de mês, e o último sempre', () => {
  const s = SERIES.carteira, t = indicesTabela(s);
  assert.equal(t[0], 0); assert.equal(t.at(-1), s.length - 1);
  assert.ok(t.length <= 14);
  const meses = t.slice(1, -1).map((i) => s[i].data.slice(0, 7));
  assert.deepEqual(meses, [...new Set(meses)]); // um por mês
  // muitos meses: afina, sem passar do limite
  const longa = Array.from({ length: 60 }, (_, m) => ({ data: `${2021 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-15`, valor: 1, aportadoAcum: 1 }));
  const tl = indicesTabela(longa, 13);
  assert.ok(tl.length <= 14); assert.equal(tl.at(-1), 59); assert.equal(tl[0], 0);
});

test('descricaoGrafico: valor final de cada série em texto', () => {
  const t = descricaoGrafico(SERIES, ['carteira', 'cdi'], formatarCentavos);
  assert.match(t, /^Gráfico de linhas de 01\/01\/2024 a /);
  assert.match(t, /Sua carteira simulada R\$ 1\.621,00; CDI R\$ 1\.069,00\./);
});

test('quadro: sem CDI a linha some; sem IPCA some a linha e o retorno real', () => {
  const res = { resumo: Object.fromEntries(['carteira', 'ibov', 'cdi', 'ipca'].map((k) => [k, { valorFinal: 1, aportado: 1, ganho: 0, twr: 0.1, real: 0.05 }])) };
  assert.deepEqual(quadro(res).map((r) => r.id), ['carteira', 'ibov', 'cdi', 'ipca']);
  assert.deepEqual(quadro(res, { cdi: false }).map((r) => r.id), ['carteira', 'ibov', 'ipca']);
  const sem = quadro(res, { ipca: false });
  assert.deepEqual(sem.map((r) => r.id), ['carteira', 'ibov', 'cdi']);
  assert.ok(sem.every((r) => r.real === null));
  assert.equal(quadro(res)[0].real, 0.05);
});

test('integração: entrada validada roda em simular() e o resultado tem tudo que a tela mostra', () => {
  const d = Array.from({ length: 120 }, (_, i) => Number(new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10).replaceAll('-', '')));
  const ps = (b) => ({ d, p: d.map((_, i) => b + i * 3) });
  const { erros, entrada } = validar(ok({ periodo: 'max' }), { primeira: isoDe(d[0]), ultima: isoDe(d.at(-1)), primeirasAtivos: [isoDe(d[0])] });
  assert.deepEqual(erros, []);
  const { periodo, ...args } = entrada;
  const r = simular({ ...args, precos: { PETR4: ps(2000), VALE3: ps(5000) }, ibov: ps(10000), cdi: [], ipca: [] });
  assert.equal(r.series.carteira.length, r.series.ibov.length);
  assert.ok(r.resumo.carteira.valorFinal > 0 && Number.isFinite(r.quedaMaxima));
  assert.ok(r.premissas.length > 5);
  const g = grafico(r.series, ['carteira', 'ibov']);
  assert.equal(g.linhas.length, 2);
  assert.equal(PERIODOS.length, 4);
});
