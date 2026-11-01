import test from 'node:test';
import assert from 'node:assert/strict';
import { estimarProventos, porMes, soma12m, qtdNaData } from '../js/core/proventos.js';
import { progresso, aporteMedio, estimarMeta, metaRendaEmPatrimonio } from '../js/core/metas.js';

const T = [
  { id: 2, tipo: 'compra', data: '2026-01-15', ativo: 'PETR4', qtd: 100, preco: 3000, taxas: 100 },
  { id: 3, tipo: 'compra', data: '2026-02-10', ativo: 'PETR4', qtd: 50, preco: 3300, taxas: 50 },
  { id: 4, tipo: 'venda', data: '2026-03-05', ativo: 'PETR4', qtd: 60, preco: 3600, taxas: 80 },
];

test('posição na data com: compra no próprio dia conta, antes da primeira compra não', () => {
  assert.equal(qtdNaData(T, 'PETR4', '2026-01-14'), 0);
  assert.equal(qtdNaData(T, 'PETR4', '2026-01-15'), 100);
  assert.equal(qtdNaData(T, 'PETR4', '2026-02-10'), 150);
  assert.equal(qtdNaData(T, 'PETR4', '2026-03-05'), 90); // venda no dia também já vale
});

const DIV = {
  PETR4: [
    { dataCom: '2026-01-14', pagamento: '2026-01-20', valor: 0.9 }, // sem cotas ainda: ignora
    { dataCom: '2026-01-15', pagamento: '2026-01-31', valor: 0.5 }, // 100 x 0,50 = 50,00
    { dataCom: '2026-02-10', pagamento: '2026-02-28', valor: 0.4321 }, // 150 x 0,4321 = R$ 64,815 = 6481,5 centavos -> 6482
    { dataCom: '2026-03-05', pagamento: '2026-03-30', valor: 0.8 }, // 90 x 0,80 = 72,00
  ],
};

test('proventos estimados: valor por cota com fração de centavo, marcados como estimado', () => {
  const p = estimarProventos(T, DIV);
  assert.deepEqual(p.map((x) => [x.pagamento, x.qtd, x.valor, x.estimado]), [
    ['2026-01-31', 100, 5000, true], ['2026-02-28', 150, 6482, true], ['2026-03-30', 90, 7200, true],
  ]);
  assert.deepEqual(porMes(p), { '2026-01': 5000, '2026-02': 6482, '2026-03': 7200 });
  assert.equal(soma12m(p, '2026-04-15'), 18682);
  assert.equal(soma12m(p, '2027-02-15'), 13682); // janeiro saiu da janela de 12 meses
});

test('progresso corta em 0 e 1 e não divide por zero', () => {
  assert.equal(progresso(25000, 100000), 0.25);
  assert.equal(progresso(150000, 100000), 1);
  assert.equal(progresso(-5, 100), 0);
  assert.equal(progresso(10, 0), 0);
});

test('aporte médio: 6 meses fechados, mês parado conta zero, antes da 1ª compra não conta', () => {
  // abril/2026 é o mês atual (fora); março sem compra = 0; fev 165050; jan 300100; dez/2025 é antes da 1ª compra
  assert.equal(aporteMedio(T, '2026-04-20'), 155050); // (0 + 165050 + 300100) / 3
  // 10 meses de 1000: só os 6 últimos meses fechados entram
  const mensais = Array.from({ length: 10 }, (_, i) => {
    const m = i + 6; // jun/2025 .. mar/2026
    const ano = m > 12 ? 2026 : 2025, mes = m > 12 ? m - 12 : m;
    return { tipo: 'compra', data: `${ano}-${String(mes).padStart(2, '0')}-10`, ativo: 'A', qtd: 1, preco: 1000 };
  });
  assert.equal(aporteMedio(mensais, '2026-04-20'), 1000);
  assert.equal(aporteMedio(T, '2026-01-20'), null); // ainda sem mês fechado: não inventa ritmo
  assert.equal(aporteMedio([], '2026-04-20'), null);
});

test('estimativa da meta só com aportes', () => {
  assert.deepEqual(estimarMeta({ atual: 100000, meta: 1000000, aporteMensal: 150000, hoje: '2026-04-20' }), { meses: 6, data: '2026-10-20' });
  assert.equal(estimarMeta({ atual: 100000, meta: 1000000, aporteMensal: 200000, hoje: '2026-04-20' }).meses, 5); // 4,5 sobe para 5
  assert.deepEqual(estimarMeta({ atual: 1000000, meta: 1000000, aporteMensal: 0, hoje: '2026-04-20' }), { meses: 0, data: '2026-04-20' });
  assert.equal(estimarMeta({ atual: 1, meta: 100, aporteMensal: 0, hoje: '2026-04-20' }), null);
  assert.equal(estimarMeta({ atual: 1, meta: 100, aporteMensal: null, hoje: '2026-04-20' }), null);
});

test('meta de renda vira meta de patrimônio mantendo o rendimento atual', () => {
  // renda de R$ 200/mês sobre R$ 100.000 -> para R$ 1.000/mês precisa de R$ 500.000
  assert.equal(metaRendaEmPatrimonio({ metaRendaMensal: 100000, rendaMensal: 20000, patrimonio: 10000000 }), 50000000);
  assert.equal(metaRendaEmPatrimonio({ metaRendaMensal: 100000, rendaMensal: 0, patrimonio: 10000000 }), null);
});
