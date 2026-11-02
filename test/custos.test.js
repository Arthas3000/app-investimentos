import test from 'node:test';
import assert from 'node:assert/strict';
import { TARIFAS_B3, lerPct, tarifasDe, custosOperacao, irrfVenda, pctTotalB3, custoOrdem } from '../js/core/custos.js';

const OFICIAL = tarifasDe({});

test('tarifas padrão: tabela oficial da B3 (ADTV até R$ 3 mi, não day trade) e TTA de 0,00225%', () => {
  assert.deepEqual(TARIFAS_B3, { tNeg: '0,0050', tLiq: '0,0224', tTta: '0,00225' });
  assert.deepEqual(OFICIAL, { negociacao: 0.005, liquidacao: 0.0224, tta: 0.00225, corretagem: 0, iss: 0 });
  assert.ok(Math.abs(pctTotalB3(OFICIAL) - 0.02965) < 1e-12); // 0,0050 + 0,0224 + 0,00225
});

test('nota real de 28/10/2026 (Clear): R$ 580,47 em compras -> 0,13 + 0,02 + 0,01 = R$ 0,16', () => {
  const c = custosOperacao(58047, OFICIAL); // 27 × 17,59 + 6 × 17,59
  assert.deepEqual(c, { liquidacao: 13, negociacao: 2, tta: 1, b3: 16, corretagem: 0, iss: 0, total: 16 });
});

test('cada tarifa é cortada no centavo (não arredondada); corretagem e ISS somam por ordem', () => {
  // 0,0050% de R$ 580,47 = 0,0290 -> R$ 0,02 (arredondando daria 0,03 e não bateria com a nota)
  assert.equal(custosOperacao(58047, OFICIAL).negociacao, 2);
  const c = custosOperacao(1_000_000, { ...OFICIAL, corretagem: 490, iss: 5 }); // R$ 10.000, corretagem R$ 4,90, ISS 5%
  assert.deepEqual([c.liquidacao, c.negociacao, c.tta, c.corretagem, c.iss, c.total], [224, 50, 22, 490, 25, 811]);
  assert.equal(custosOperacao(0, OFICIAL).total, 0);
});

test('custoOrdem: zero sem ordem; com ordem, fixo + percentual (função para o aporte)', () => {
  const f = custoOrdem({ ...OFICIAL, corretagem: 100 });
  assert.equal(f(0), 0);
  assert.equal(f(58047), 116);
});

test('IR retido na venda (0,005%): só a partir de R$ 1,00 de imposto', () => {
  assert.equal(irrfVenda(1_999_999), 0); // R$ 19.999,99 -> R$ 0,99: não retém
  assert.equal(irrfVenda(2_000_000), 100); // R$ 20.000,00 -> R$ 1,00
  assert.equal(irrfVenda(5_000_000), 250);
});

test('lerPct: aceita vírgula, ponto e "%"; fora de 0 a 1% ou texto inválido = null; vazio = 0', () => {
  assert.equal(lerPct('0,0224'), 0.0224);
  assert.equal(lerPct('0.00225%'), 0.00225);
  assert.equal(lerPct(' 0,005 % '), 0.005);
  assert.equal(lerPct(''), 0);
  assert.equal(lerPct('abc'), null);
  assert.equal(lerPct('2'), null);
  assert.equal(lerPct('-0,01'), null);
  assert.equal(lerPct('5', { max: 10 }), 5); // ISS vai até 10%
});

test('tarifasDe: textos guardados -> números; inválido vira null para a tela explicar', () => {
  const t = tarifasDe({ tNeg: '0,0050', tLiq: '0,0224', tTta: '0,0019', taxa: 'R$ 4,90', iss: '5' }, (s) => (s === 'R$ 4,90' ? 490 : null));
  assert.deepEqual(t, { negociacao: 0.005, liquidacao: 0.0224, tta: 0.0019, corretagem: 490, iss: 5 });
  assert.equal(tarifasDe({ tLiq: 'x' }).liquidacao, null);
});
