import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNID, ratear, somaUnid, pesosIguais, pesosPorGrupo, normalizarPara100, paraPct, fmtPct, montarAtivos, validarCfg,
  propostaDe, resumir, passoCotas, transacoesDeCompra, gravarLote, mesPorExtenso, dtstampIcs, icsDoAporte,
} from '../js/core/aporte-entrada.js';
import { criarCarteira } from '../js/data/carteira.js';

const soma = (a) => a.reduce((s, x) => s + x, 0);

test('ratear: soma sempre o total, por maior resto, desempate pelo primeiro', () => {
  assert.deepEqual(ratear(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(ratear(UNID, [1, 1, 1]), [3334, 3333, 3333]);
  assert.deepEqual(ratear(100, [0, 0]), [50, 50]); // sem pesos: iguais
  assert.deepEqual(ratear(100, [3, 0, 1]), [75, 0, 25]);
  assert.deepEqual(ratear(5, []), []);
  for (const n of [1, 2, 3, 7, 11, 13]) assert.equal(soma(ratear(UNID, Array.from({ length: n }, (_, i) => i + 1))), UNID);
});

test('pesos iguais: soma exatamente 100,00 para qualquer quantidade', () => {
  assert.deepEqual(pesosIguais(['A', 'B', 'C']), { A: 33.34, B: 33.33, C: 33.33 });
  for (let n = 1; n <= 40; n++) assert.equal(somaUnid(pesosIguais(Array.from({ length: n }, (_, i) => `T${i}`))), UNID, `n=${n}`);
});

test('por grupo (classe ou setor): fatias iguais por grupo, iguais dentro dele, soma 100', () => {
  const itens = [{ ticker: 'A', grupo: 'Ações' }, { ticker: 'B', grupo: 'Ações' }, { ticker: 'C', grupo: 'FIIs' }];
  assert.deepEqual(pesosPorGrupo(itens), { A: 25, B: 25, C: 50 });
  const tres = [{ ticker: 'A', grupo: 'x' }, { ticker: 'B', grupo: 'y' }, { ticker: 'C', grupo: 'z' }, { ticker: 'D', grupo: 'z' }, { ticker: 'E', grupo: null }];
  const p = pesosPorGrupo(tres);
  assert.equal(somaUnid(p), UNID);
  assert.deepEqual(p, { A: 25, B: 25, C: 12.5, D: 12.5, E: 25 }); // grupo ausente vira 'Outros' (fatia própria)
});

test('normalizar: mantém as proporções e fecha em 100', () => {
  assert.deepEqual(normalizarPara100({ A: 20, B: 20, C: 10 }), { A: 40, B: 40, C: 20 });
  assert.equal(somaUnid(normalizarPara100({ A: 10, B: 10, C: 10 })), UNID);
  assert.deepEqual(normalizarPara100({ A: 0, B: 0 }), { A: 0, B: 0 });
  assert.equal(normalizarPara100({ A: 70, B: 0, C: 70 }).B, 0);
});

test('paraPct e fmtPct', () => {
  assert.equal(paraPct('12,5'), 12.5);
  assert.equal(paraPct(' 7.25% '), 7.25);
  assert.equal(paraPct('100'), 100);
  for (const ruim of ['', 'abc', '101', '-1', '1,234', '1,2,3']) assert.equal(paraPct(ruim), null, ruim);
  assert.equal(fmtPct(33.33), '33,33');
  assert.equal(fmtPct(10), '10');
  assert.equal(fmtPct(12.5), '12,5');
});

test('montarAtivos: preço ausente vira null, faixa só quando existe, evitar vem da análise', () => {
  const r = montarAtivos({
    tickers: ['A', 'B'], valores: new Map([['A', 5000]]), precos: new Map([['A', 1000]]),
    analises: new Map([['A', { nota: 7, ms: 0.2, faixa: 'barato', evitar: false }]]), alvos: { A: 60 },
  });
  assert.deepEqual(r[0], { ticker: 'A', valor: 5000, alvoPct: 60, preco: 1000, nota: 7, ms: 0.2, evitar: false, faixa: 'barato' });
  assert.deepEqual(r[1], { ticker: 'B', valor: 0, alvoPct: 0, preco: null, nota: null, ms: null, evitar: false });
});

test('validarCfg: mensagens em tom de ajuda', () => {
  const ok = { aporte: 100000, taxa: 0, lote: 1, teto: null, intensidade: 50 };
  assert.deepEqual(validarCfg(ok, { A: 100 }), []);
  assert.equal(validarCfg({ ...ok, aporte: 0 }, { A: 100 }).length, 1);
  assert.equal(validarCfg({ ...ok, lote: 0 }, { A: 100 }).length, 1);
  assert.equal(validarCfg({ ...ok, teto: undefined, taxa: null }, { A: 100 }).length, 2);
  assert.equal(validarCfg(ok, { A: 0 }).length, 1);
});

const estado = {
  transacoes: [
    { id: 1, tipo: 'compra', data: '2026-01-05', ativo: 'AAA3', qtd: 10, preco: 5000 },
    { id: 2, tipo: 'compra', data: '2026-01-05', ativo: 'BBB4', qtd: 20, preco: 1000 },
  ],
  acompanhados: [{ ticker: 'CCC11', desde: '2026-02-01' }], alvos: { AAA3: 40, BBB4: 30, CCC11: 30 },
};
const precos = new Map([['AAA3', 5000], ['BBB4', 1000], ['CCC11', 2000]]);
const cfg = { aporte: 100000, taxa: 100, lote: 1, teto: null, intensidade: 50, evitar: true };

test('propostaDe + resumir: o recalculo com as cotas da proposta reproduz total, taxas e sobra', () => {
  const { ativos, prop, visao } = propostaDe({ estado, precos, analises: new Map(), cfg });
  assert.deepEqual(ativos.map((a) => a.ticker).sort(), ['AAA3', 'BBB4', 'CCC11']);
  assert.equal(visao.itens.length, 2);
  const cotas = Object.fromEntries(prop.linhas.map((l) => [l.ticker, l.cotas]));
  const r = resumir({ ativos, cotas, aporte: cfg.aporte, taxaPorOrdem: cfg.taxa });
  assert.equal(r.total, prop.total);
  assert.equal(r.taxas, prop.taxas);
  assert.equal(r.sobra, prop.sobra);
  assert.equal(r.total + r.taxas + r.sobra, cfg.aporte);
  assert.equal(r.excede, false);
  for (const l of r.linhas) {
    const p = prop.linhas.find((x) => x.ticker === l.ticker);
    assert.ok(Math.abs(l.pesoDepois - p.pesoDepois) < 1e-9);
  }
});

test('resumir: passar do aporte vira excede, e a taxa só conta onde há ordem', () => {
  const { ativos } = propostaDe({ estado, precos, analises: new Map(), cfg });
  const r = resumir({ ativos, cotas: { AAA3: 30 }, aporte: 100000, taxaPorOrdem: 100 }); // 30 × R$ 50,00 = R$ 1.500,00
  assert.equal(r.total, 150000);
  assert.equal(r.taxas, 100);
  assert.equal(r.sobra, -50100);
  assert.equal(r.excede, true);
  assert.equal(resumir({ ativos, cotas: {}, aporte: 100000, taxaPorOrdem: 100 }).taxas, 0);
});

test('passoCotas: lote a lote, nunca abaixo de zero', () => {
  assert.equal(passoCotas(5, 1, 1), 6);
  assert.equal(passoCotas(100, 1, 100), 200);
  assert.equal(passoCotas(0, -1, 1), 0);
  assert.equal(passoCotas(50, -1, 100), 0);
});

test('transacoesDeCompra: valida tudo antes; qtd 0 fica de fora', () => {
  const ok = transacoesDeCompra([{ ticker: 'A', qtd: 2, preco: 1000, taxas: 100 }, { ticker: 'B', qtd: 0, preco: 500 }], '2026-11-05');
  assert.deepEqual(ok.erros, []);
  assert.deepEqual(ok.transacoes, [{ tipo: 'compra', data: '2026-11-05', ativo: 'A', qtd: 2, preco: 1000, taxas: 100 }]);
  const ruim = transacoesDeCompra([{ ticker: 'A', qtd: 2, preco: 1000 }, { ticker: 'B', qtd: 3, preco: null }], '2026-11-05');
  assert.equal(ruim.erros.length, 1);
  assert.match(ruim.erros[0], /^B: /);
  assert.equal(transacoesDeCompra([{ ticker: 'A', qtd: 0 }], '2026-11-05').erros.length, 1);
  assert.equal(transacoesDeCompra([{ ticker: 'A', qtd: 1, preco: 100 }], 'ontem').erros.length, 1);
});

test('gravarLote: tudo ou nada, e o desfazer cobre o lote inteiro', () => {
  const guardado = new Map();
  const falso = (falhaEm) => (t) => {
    if (t.ativo === falhaEm) return { ok: false, erros: ['recusado'] };
    guardado.set(t.ativo, true);
    return { ok: true, desfazer: () => guardado.delete(t.ativo) };
  };
  const ts = [{ ativo: 'A' }, { ativo: 'B' }, { ativo: 'C' }];
  const falhou = gravarLote(ts, falso('C'));
  assert.equal(falhou.ok, false);
  assert.equal(guardado.size, 0); // A e B foram desfeitas
  assert.deepEqual(falhou.erros, ['C: recusado', 'Nada foi registrado.']);
  const ok = gravarLote(ts, falso('Z'));
  assert.equal(ok.ok, true);
  assert.equal(guardado.size, 3);
  assert.equal(ok.desfazer(), true);
  assert.equal(guardado.size, 0);
});

test('gravarLote com a carteira de verdade: falha no meio não deixa nada', () => {
  const mem = {}; const c = criarCarteira({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } });
  const { transacoes } = transacoesDeCompra([{ ticker: 'A', qtd: 1, preco: 100 }, { ticker: 'B', qtd: 2, preco: 200 }], '2026-11-05');
  const r = gravarLote([...transacoes, { tipo: 'compra', data: '2026-11-05', ativo: 'C', qtd: 0, preco: 1 }], c.adicionarTransacao);
  assert.equal(r.ok, false);
  assert.equal(c.ler().transacoes.filter((t) => !t.excluido).length, 0);
  const bom = gravarLote(transacoes, c.adicionarTransacao);
  assert.equal(bom.ok, true);
  assert.equal(c.ler().transacoes.filter((t) => !t.excluido).length, 2);
  bom.desfazer();
  assert.equal(c.ler().transacoes.filter((t) => !t.excluido).length, 0);
});

test('mês, dtstamp e .ics do aporte', () => {
  assert.equal(mesPorExtenso('2026-11-05'), 'novembro');
  assert.equal(mesPorExtenso('2026-03-01'), 'março');
  assert.equal(dtstampIcs(new Date('2026-11-01T12:34:56.789Z')), '20261101T123456Z');
  const txt = icsDoAporte({ dia: 5, hoje: '2026-11-01', agora: new Date('2026-11-01T12:00:00Z') });
  assert.match(txt, /UID:aporte@app-investimentos\r\n/);
  assert.match(txt, /DTSTAMP:20261101T120000Z\r\n/);
  assert.match(txt, /DTSTART:20261105T090000\r\n/);
  assert.match(txt, /RRULE:FREQ=MONTHLY;BYMONTHDAY=5\r\n/);
});
