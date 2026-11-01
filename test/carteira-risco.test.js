import test from 'node:test';
import assert from 'node:assert/strict';
import { pesoPorGrupo, concentracao, variacaoDia, serieCarteira, riscoCarteira, rendaPassiva, proventosLancados, statusMetas, reaisParaCentavos } from '../js/core/carteira-risco.js';

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('peso por grupo: soma por classe, ordem por valor, sem grupo e valor zero', () => {
  const itens = [{ ativo: 'A', valor: 6000 }, { ativo: 'B', valor: 3000 }, { ativo: 'C', valor: 1000 }, { ativo: 'D', valor: 0 }];
  const g = pesoPorGrupo(itens, (a) => ({ A: 'Ação', B: 'FII', C: 'Ação' })[a] ?? null);
  assert.deepEqual(g.map((x) => [x.grupo, x.valor, x.peso, x.ativos]), [['Ação', 7000, 70, ['A', 'C']], ['FII', 3000, 30, ['B']]]);
  assert.equal(pesoPorGrupo([{ ativo: 'Z', valor: 10 }], () => null)[0].grupo, 'Sem classificação');
  assert.deepEqual(pesoPorGrupo([], () => 'x'), []);
});

test('concentração: HHI e nº efetivo conferidos à mão', () => {
  // pesos 50/30/20: 2500 + 900 + 400 = 3800; efetivo 10000/3800
  const c = concentracao([{ ativo: 'A', valor: 5000 }, { ativo: 'B', valor: 3000 }, { ativo: 'C', valor: 2000 }]);
  assert.equal(c.hhi, 3800); perto(c.nEfetivo, 10000 / 3800); assert.equal(c.faixa, 'muito concentrada');
  assert.deepEqual(c.maior, { ativo: 'A', peso: 50 }); assert.equal(c.n, 3);
  // 4 ativos iguais: 4 × 625 = 2500 (limite da faixa "concentrada"), efetivo 4
  const q = concentracao([1, 2, 3, 4].map((i) => ({ ativo: `T${i}`, valor: 100 })));
  assert.equal(q.hhi, 2500); assert.equal(q.nEfetivo, 4); assert.equal(q.faixa, 'concentrada');
  assert.equal(concentracao([{ ativo: 'A', valor: 0 }]), null);
});

test('variação do dia: valor de ontem = valor ÷ (1 + variação)', () => {
  // 11000 com +10% veio de 10000 (+1000); 5000 com −20% veio de 6250 (−1250): −250 sobre 16250
  const v = variacaoDia([{ ativo: 'A', valor: 11000 }, { ativo: 'B', valor: 5000 }, { ativo: 'C', valor: 900 }], { A: 10, B: -20 });
  assert.equal(v.valor, -250); perto(v.pct, (-250 / 16250) * 100); assert.equal(v.n, 2);
  assert.equal(variacaoDia([{ ativo: 'A', valor: 100 }], {}), null);
  assert.equal(variacaoDia([{ ativo: 'A', valor: 100 }], new Map([['A', -100]])), null); // −100% não tem "ontem"
});

// A: 2 cotas, B: 1 cota. A tem um dia a mais (99) que B não tem: fica de fora. Valores e resultados conferidos em Python.
const A = [1007, 1007, 1017, 1037, 1037, 1047, 1067, 1067, 1077, 1097, 1097, 1107, 1127, 1127, 1137, 1157, 1157, 1167, 1187, 1187, 1197, 1217, 1217];
const B = [2011, 1991, 2001, 1981, 1991, 1971, 1981, 1961, 1971, 1951, 1961, 1941, 1951, 1931, 1941, 1921, 1931, 1911, 1921, 1901, 1911, 1891, 1901];
const dias = A.map((_, i) => 20260101 + i);
const series = { A: { d: [...dias, 20269999], p: [...A, 5000] }, B: { d: dias, p: B } };
const carteira = [{ ativo: 'A', qtd: 2 }, { ativo: 'B', qtd: 1 }];

test('série da carteira: soma qtd × preço nos dias em comum', () => {
  const s = serieCarteira(carteira, series);
  assert.equal(s.v.length, 23); assert.equal(s.v[0], 2 * 1007 + 2011); assert.equal(s.v[22], 4335); assert.deepEqual(s.d, dias);
  assert.deepEqual(s.usados, ['A', 'B']); assert.deepEqual(s.fora, []);
});

test('série da carteira: ativo sem histórico vai para "fora" e não zera os outros', () => {
  const s = serieCarteira([...carteira, { ativo: 'X', qtd: 5 }], series);
  assert.deepEqual(s.fora, ['X']); assert.equal(s.v[0], 4025);
  assert.deepEqual(serieCarteira([{ ativo: 'X', qtd: 1 }], {}), { d: [], v: [], usados: [], fora: ['X'] });
  // dias sem nenhum ponto em comum: série vazia, não erro
  assert.equal(serieCarteira(carteira, { A: { d: [1, 2], p: [1, 2] }, B: { d: [3, 4], p: [1, 2] } }).v.length, 0);
});

test('risco da carteira: volatilidade (22 retornos) e queda máxima conferidas em Python', () => {
  const r = riscoCarteira(carteira, series);
  perto(r.vol, 0.08483599209104767, 1e-12); perto(r.queda, 0.004968944099378869, 1e-12);
  assert.equal(r.pregoes, 23); assert.equal(r.de, 20260101); assert.equal(r.ate, 20260123);
});

test('risco da carteira: menos de 20 retornos = sem volatilidade, mas a queda máxima existe', () => {
  const curto = { A: { d: dias.slice(0, 10), p: A.slice(0, 10) }, B: { d: dias.slice(0, 10), p: B.slice(0, 10) } };
  const r = riscoCarteira(carteira, curto);
  assert.equal(r.vol, null); assert.ok(r.queda >= 0);
  const vazio = riscoCarteira(carteira, {});
  assert.equal(vazio.vol, null); assert.equal(vazio.queda, null); assert.equal(vazio.pregoes, 0);
});

test('risco da carteira: queda máxima pico-a-vale de 50% à mão', () => {
  const s = { A: { d: [1, 2, 3, 4, 5, 6], p: [1000, 1200, 900, 1000, 600, 1100] } };
  perto(riscoCarteira([{ ativo: 'A', qtd: 1 }], s).queda, 0.5);
});

const prov = (id, data, valor, ativo = 'MXRF11', extra = {}) => ({ id, tipo: 'provento', data, valor, ativo, ...extra });

test('renda passiva: 12 meses civis, média mensal, por ativo; ignora excluídos e outros tipos', () => {
  const tr = [
    prov(1, '2026-10-15', 1000), prov(2, '2026-10-20', 500, 'HGLG11'), prov(3, '2026-05-10', 2500),
    prov(4, '2025-12-05', 600), prov(5, '2025-11-30', 9999), // fora da janela (nov/2025), mas conta no total geral
    prov(6, '2026-09-01', 7777, 'MXRF11', { excluido: true }),
    { id: 7, tipo: 'compra', data: '2026-10-01', ativo: 'MXRF11', qtd: 1, preco: 1000 },
  ];
  const r = rendaPassiva(tr, '2026-11-02');
  assert.equal(r.meses.length, 12); assert.equal(r.meses[0].mes, '2025-12'); assert.equal(r.meses[11].mes, '2026-11');
  assert.equal(r.meses.find((m) => m.mes === '2026-10').valor, 1500);
  assert.equal(r.meses.find((m) => m.mes === '2026-07').valor, 0);
  assert.equal(r.total12, 1500 + 2500 + 600); assert.equal(r.mediaMensal, 383); // 4600 ÷ 12 = 383,33
  assert.deepEqual(r.porAtivo, { MXRF11: 1000 + 2500 + 600 + 9999, HGLG11: 500 });
  assert.equal(r.total, 14599); assert.equal(r.temDados, true);
});

test('renda passiva: sem proventos lançados', () => {
  const r = rendaPassiva([{ id: 1, tipo: 'compra', data: '2026-01-01', ativo: 'A', qtd: 1, preco: 100 }], '2026-11-02');
  assert.equal(r.temDados, false); assert.equal(r.total12, 0); assert.equal(r.mediaMensal, 0); assert.deepEqual(proventosLancados([]), []);
});

test('metas: patrimônio com ritmo do histórico; renda convertida em patrimônio; prazo', () => {
  // compras: 10 × R$ 100,00 em ago/26 (100000) e 5 × R$ 200,00 + R$ 10,00 de taxas em out/26 (101000); set sem compra.
  // Meses fechados antes de nov/26: out, set, ago -> (101000 + 0 + 100000) ÷ 3 = 67000
  const tr = [
    { id: 1, tipo: 'compra', data: '2026-08-10', ativo: 'A', qtd: 10, preco: 10000 },
    { id: 2, tipo: 'compra', data: '2026-10-05', ativo: 'A', qtd: 5, preco: 20000, taxas: 1000 },
  ];
  const m = statusMetas({ metas: { patrimonio: 1_000_000, rendaMensal: 40_000, prazoAnos: 2 }, patrimonio: 400_000, rendaMensal: 10_000, transacoes: tr, aporte: { valor: 50_000, dia: 5 }, hoje: '2026-11-15' });
  assert.equal(m.aporteMensal, 67_000); assert.equal(m.origemAporte, 'historico');
  assert.equal(m.patrimonio.prog, 0.4);
  assert.deepEqual(m.patrimonio.estimativa, { meses: 9, data: '2027-08-15' }); // 600000 ÷ 67000 = 8,95 -> 9
  assert.equal(m.renda.prog, 0.25); assert.equal(m.renda.patrimonioNecessario, 1_600_000); // 40000 × 400000 ÷ 10000
  assert.equal(m.renda.estimativa.meses, 18); // 1200000 ÷ 67000 = 17,9 -> 18
  assert.deepEqual(m.prazo, { anos: 2, data: '2028-11-15', dentro: true });
});

test('metas: sem histórico usa o aporte definido; sem nenhum ritmo não inventa estimativa; renda zero não converte', () => {
  const a = statusMetas({ metas: { patrimonio: 1_000_000 }, patrimonio: 500_000, rendaMensal: 0, aporte: { valor: 100_000, dia: 5 }, hoje: '2026-11-15' });
  assert.equal(a.origemAporte, 'definido'); assert.equal(a.patrimonio.estimativa.meses, 5);
  const b = statusMetas({ metas: { patrimonio: 1_000_000, rendaMensal: 5000, prazoAnos: 1 }, patrimonio: 500_000, rendaMensal: 0, hoje: '2026-11-15' });
  assert.equal(b.aporteMensal, null); assert.equal(b.patrimonio.estimativa, null);
  assert.equal(b.renda.patrimonioNecessario, null); assert.equal(b.renda.estimativa, null); assert.equal(b.prazo.dentro, null);
  assert.deepEqual(statusMetas({ patrimonio: 0, rendaMensal: 0, hoje: '2026-11-15' }), { aporteMensal: null, origemAporte: null, patrimonio: null, renda: null, prazo: null });
});

test('metas: meta já atingida e prazo estourado', () => {
  const m = statusMetas({ metas: { patrimonio: 100_000, prazoAnos: 1 }, patrimonio: 150_000, rendaMensal: 0, hoje: '2026-11-15' });
  assert.equal(m.patrimonio.prog, 1); assert.equal(m.patrimonio.estimativa.meses, 0);
  const l = statusMetas({ metas: { patrimonio: 12_000_000, prazoAnos: 1 }, patrimonio: 0, rendaMensal: 0, aporte: { valor: 100_000, dia: 1 }, hoje: '2026-11-15' });
  assert.equal(l.patrimonio.estimativa.meses, 120); assert.equal(l.prazo.dentro, false);
});

test('reais digitados viram centavos; texto estranho vira null', () => {
  const ok = { '1.500,50': 150050, 'R$ 2000': 200000, '10,5': 1050, '1.5': 150, '1.500': 150000, '0,99': 99, ' 12 ': 1200, '1.234.567,89': 123456789 };
  for (const [txt, c] of Object.entries(ok)) assert.equal(reaisParaCentavos(txt), c, txt);
  for (const txt of ['', 'abc', '0', '0,00', '-5', '1,234', '1,2,3', '10,555', null, '1e3']) assert.equal(reaisParaCentavos(txt), null, String(txt));
});
