import test from 'node:test';
import assert from 'node:assert/strict';
import { conferirFii, conferirAcoes, conferirIpca } from '../scripts/conferir-fontes.mjs';

// HGLG11: rendimentos da B3 (sondagem de 02/11/2026) e os mesmos meses calculados do informe mensal da CVM.
const B3_HGLG = [
  ['2026-09-30', '2026-10-15', 1.17, 'REND'], ['2026-08-31', '', 1.17, 'REND'], ['2026-07-31', '', 1.17, 'REND'],
  ['2026-06-30', '', 1.10, 'REND'], ['2026-05-29', '', 1.10, 'REND'], ['2026-04-30', '', 1.10, 'REND'],
];

test('conferirFii: CVM e B3 batem mês a mês (tolerância de 5%)', () => {
  const cvm = [1.1702, 1.1695, 1.17, 1.1, 1.1, 1.0999, null, 1.1, 1.1, 1.1, 1.1, 1.1]; // set/2026 primeiro
  const r = conferirFii({ rendMensal: cvm, dataBase: '2026-09-01' }, B3_HGLG);
  assert.deepEqual({ comparados: r.comparados, divergentes: r.divergentes, ok: r.ok }, { comparados: 6, divergentes: 0, ok: true });
});

test('conferirFii: data com no mês seguinte também casa; valor diferente vira divergência', () => {
  const b3 = [['2026-10-05', '', 1.0, 'REND'], ['2026-09-04', '', 1.0, 'REND'], ['2026-08-05', '', 2.0, 'REND']];
  const r = conferirFii({ rendMensal: [1.0, 1.0, 1.0], dataBase: '2026-09-01' }, b3);
  assert.equal(r.comparados, 3);
  assert.equal(r.divergentes, 1); // julho: CVM 1,00 x B3 2,00
  assert.equal(r.maxDif, 1); // diferença medida sobre a CVM (fonte primária): |2 − 1| ÷ 1
  assert.equal(r.ok, true); // 1 de 3 não basta para marcar o fundo
  const ruim = conferirFii({ rendMensal: [1, 1, 1], dataBase: '2026-09-01' }, b3.map(([d, p, , t]) => [d, p, 3, t]));
  assert.equal(ruim.ok, false);
});

test('conferirFii: sem dado de um lado não compara', () => {
  assert.equal(conferirFii({ rendMensal: [1, 1], dataBase: '2026-09-01' }, []), null);
  assert.equal(conferirFii(null, B3_HGLG), null);
});

test('conferirAcoes: CVM (em circulação) x B3 (total); tolerância de 5% cobre ações em tesouraria', () => {
  assert.deepEqual(conferirAcoes(12_888_732_761 * 0.99, { total: 12_888_732_761 }), { cvm: 12_759_845_433, b3: 12_888_732_761, dif: 0.01, ok: true });
  assert.equal(conferirAcoes(1000, { total: 2000 }).ok, false);
  assert.equal(conferirAcoes(null, { total: 2000 }), null);
  assert.equal(conferirAcoes(1000, { cotas: 1000 }), null); // FII não tem "ações"
});

test('conferirIpca: Banco Central x IBGE, mês a mês (sondagem: jul–set/2026 iguais)', () => {
  const bcb = [{ data: '01/07/2026', valor: '0.07' }, { data: '01/08/2026', valor: '-0.32' }, { data: '01/09/2026', valor: '0.82' }];
  const ibge = [{ D3C: '202607', V: '0.07' }, { D3C: '202608', V: '-0.32' }, { D3C: '202609', V: '0.82' }];
  assert.deepEqual(conferirIpca(bcb, ibge), { comparados: 3, divergentes: 0, ok: true });
  assert.deepEqual(conferirIpca(bcb, [{ D3C: '202609', V: '0.90' }]), { comparados: 1, divergentes: 1, ok: false });
  assert.deepEqual(conferirIpca([], ibge), { comparados: 0, divergentes: 0, ok: null });
});
