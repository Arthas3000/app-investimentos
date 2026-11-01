import test from 'node:test';
import assert from 'node:assert/strict';
import { indicar, ROTULOS } from '../js/analise/indicacao.js';

const valor = (o = {}) => ({ nota: 7.5, ms: 0.24, cobertura: 1, semNota: false, pilares: { p3: { pontos: 100, max: 250 } }, ...o });
const fund = (o = {}) => ({ tipo: 'geral', estatal: false, roe12m: 0.2, roeTri: 0.05, lucrosTri: [100, 90], dlEbitda: 1, payout: 0.5, ...o });
const risco = (o = {}) => ({ var12m: -0.2, var3m: -0.1, ...o });
const acao = (o = {}) => indicar({ classe: 'acao', valor: valor(), estab: { nota: 7 }, fund: fund(), risco: risco(), preco: 10, ctx: {}, ...o });
const fii = (o = {}) => indicar({ classe: 'fii', valor: valor({ ms: null }), estab: { nota: 7 }, fund: { vpa: 100, rend12m: 10, ffo: 12, alavancagem: 0.1 }, risco: risco(), preco: 90, ctx: {}, ...o });

test('rótulos fixos', () => {
  assert.equal(ROTULOS.candidata, 'Preço atrativo pelos números');
  assert.equal(ROTULOS.neutro, 'Neutro');
});

test('candidata: nota 7 exata e MS > 0, com motivo numérico', () => {
  const r = acao({ valor: valor({ nota: 7 }) });
  assert.equal(r.id, 'candidata');
  assert.equal(r.rotulo, 'Preço atrativo pelos números');
  assert.ok(r.motivos.includes('Margem de segurança de 24%'));
});

test('borda: nota 6,99 com MS > 0 vira cautela, MS 0 não é desconto', () => {
  assert.equal(acao({ valor: valor({ nota: 6.99 }) }).id, 'cautela');
  assert.equal(acao({ valor: valor({ nota: 6, ms: 0.01 }) }).id, 'cautela');
  assert.equal(acao({ valor: valor({ nota: 8, ms: 0 }) }).id, 'neutro');
  assert.equal(acao({ valor: valor({ nota: 5.99 }) }).id, 'neutro');
});

test('cautela por cada alerta', () => {
  assert.equal(acao({ valor: valor({ cobertura: 0.8 }) }).id, 'cautela');
  assert.equal(acao({ fund: fund({ estatal: true }) }).id, 'cautela');
  assert.equal(acao({ fund: fund({ dlEbitda: 3.5 }) }).id, 'cautela');
  assert.equal(acao({ estab: { nota: 3.9 } }).id, 'cautela');
  assert.equal(acao({ estab: { nota: 4 } }).id, 'candidata');
  assert.equal(acao({ fund: fund({ dlEbitda: 3 }) }).id, 'candidata');
  assert.match(acao({ valor: valor({ cobertura: 0.8 }) }).motivos.join('|'), /Nota parcial \(80%/);
});

test('boa: P3 em 70% e MS <= 0; 69% não', () => {
  const v = (pontos, ms) => valor({ nota: 5, ms, pilares: { p3: { pontos, max: 250 } } });
  assert.equal(acao({ valor: v(175, -0.1) }).id, 'boa');
  assert.equal(acao({ valor: v(175, 0) }).id, 'boa');
  assert.equal(acao({ valor: v(172, -0.1) }).id, 'neutro');
  assert.equal(acao({ valor: v(200, 0.1) }).id, 'neutro');
});

test('atencao: payout > 100% (100% exato não)', () => {
  assert.equal(acao({ fund: fund({ payout: 1.01 }) }).id, 'atencao');
  assert.equal(acao({ fund: fund({ payout: 1 }) }).id, 'candidata');
});

test('evitar: tendência do ROE < 0,7, prejuízo, ROE < Ke com alavancagem; exige queda de preço', () => {
  // tendência = 0,12*4/0,5... roeTri 0,03*4=0,12 / 0,2 = 0,6
  assert.equal(acao({ fund: fund({ roeTri: 0.03 }) }).id, 'evitar');
  // 0,7 exato (0,035*4/0,2) não é armadilha
  assert.notEqual(acao({ fund: fund({ roeTri: 0.035 }) }).id, 'evitar');
  assert.equal(acao({ fund: fund({ lucrosTri: [-5, 10] }) }).id, 'evitar');
  assert.equal(acao({ fund: fund({ roe12m: 0.1, roeTri: 0.025, dlEbitda: 4 }) }).id, 'evitar');
  assert.notEqual(acao({ fund: fund({ roe12m: 0.1, roeTri: 0.025, dlEbitda: 2 }) }).id, 'evitar');
  assert.notEqual(acao({ fund: fund({ lucrosTri: [-5, 10] }), risco: risco({ var12m: 0.1, var3m: 0.02 }) }).id, 'evitar');
});

test('ordem de precedência: evitar > atencao > candidata > cautela > boa > neutro', () => {
  const ruim = fund({ lucrosTri: [-5], payout: 1.5 });
  assert.equal(acao({ fund: ruim }).id, 'evitar');
  assert.equal(acao({ fund: fund({ payout: 1.5 }) }).id, 'atencao'); // sobre candidata
  assert.equal(acao({ fund: fund({ payout: 1.5 }), valor: valor({ ms: -0.1, pilares: { p3: { pontos: 250, max: 250 } } }) }).id, 'atencao'); // sobre boa
  assert.equal(acao().id, 'candidata'); // sobre cautela
  assert.equal(acao({ valor: valor({ nota: 6.5 }) }).id, 'cautela'); // sobre boa/neutro
});

test('sem nota: neutro com Dados insuficientes; nota parcial não bloqueia', () => {
  const r = acao({ valor: valor({ semNota: true, nota: null, cobertura: 0.5 }) });
  assert.equal(r.id, 'neutro');
  assert.deepEqual(r.motivos, ['Dados insuficientes']);
  assert.equal(acao({ valor: null }).id, 'neutro');
});

test('FII: P/VP < 0,95 candidata; 0,95 exato não é desconto', () => {
  assert.equal(fii().id, 'candidata'); // 0,90
  assert.equal(fii({ preco: 95 }).id, 'neutro'); // 0,95 exato
  assert.equal(fii({ preco: 94.99 }).id, 'candidata');
  assert.match(fii().motivos[0], /P\/VP de 0,90/);
});

test('FII: cobertura FFO < 0,9 vira atenção; 0,9 exato não', () => {
  assert.equal(fii({ fund: { vpa: 100, rend12m: 10, ffo: 8.9 } }).id, 'atencao');
  assert.equal(fii({ fund: { vpa: 100, rend12m: 10, ffo: 9 } }).id, 'candidata');
  assert.equal(fii({ fund: { vpa: 100, rend12m: 10, ffo: 12, pctVendaImoveis: 0.4 } }).id, 'atencao');
});

test('FII: boa com P3 alto e P/VP >= 1; alavancagem alta gera cautela', () => {
  const v = valor({ ms: null, nota: 5, pilares: { p3: { pontos: 200, max: 250 } } });
  assert.equal(fii({ preco: 105, valor: v }).id, 'boa');
  assert.equal(fii({ fund: { vpa: 100, rend12m: 10, ffo: 12, alavancagem: 0.5 } }).id, 'cautela');
});

test('motivos nunca têm texto de urgência', () => {
  const textos = [acao(), acao({ fund: fund({ payout: 2 }) }), fii()].flatMap((r) => r.motivos).join(' ');
  assert.doesNotMatch(textos, /agora|corra|última chance|urgente|imperd/i);
});
