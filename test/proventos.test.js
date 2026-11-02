import test from 'node:test';
import assert from 'node:assert/strict';
import { numBr, dataBr, tipoProvento, fatorEvento, lerCotahistIsin, montarAtivos, soma12m, juntarHistorico, acoesDoEmissor } from '../scripts/atualizar-proventos.mjs';

// Trechos reais das respostas da B3 (sondagem de 02/11/2026).
const PETR = {
  numberCommonShares: '7.442.231.382', numberPreferredShares: '5.446.501.379', totalNumberShares: '12.888.732.761', code: 'PETR',
  cashDividends: [
    { assetIssued: 'BRPETRACNOR9', paymentDate: '21/12/2026', rate: '0,47156696000', relatedTo: 'Anual/2026', approvedOn: '06/08/2026', isinCode: 'BRPETRACNOR9', label: 'DIVIDENDO', lastDatePrior: '21/08/2026' },
    { assetIssued: 'BRPETRACNOR9', paymentDate: '23/11/2026', rate: '0,67407131000', relatedTo: 'Anual/2026', approvedOn: '06/08/2026', isinCode: 'BRPETRACNOR9', label: 'JRS CAP PROPRIO', lastDatePrior: '21/08/2026' },
    { assetIssued: 'BRPETRACNPR6', paymentDate: '21/12/2026', rate: '0,47156696000', relatedTo: 'Anual/2026', approvedOn: '06/08/2026', isinCode: 'BRPETRACNPR6', label: 'DIVIDENDO', lastDatePrior: '21/08/2026' },
    { assetIssued: 'BRPETRACNOR9', paymentDate: '20/08/2025', rate: '0,35048636000', relatedTo: 'Anual/2025', approvedOn: '11/05/2025', isinCode: 'BRPETRACNOR9', label: 'JRS CAP PROPRIO', lastDatePrior: '01/06/2025' },
  ],
  stockDividends: [
    { assetIssued: 'BRPETRACNOR9', factor: '100,00000000000', approvedOn: '25/04/2008', isinCode: 'BRPETRACNOR9', label: 'DESDOBRAMENTO', lastDatePrior: '25/04/2008' },
  ],
};
const MGLU_EV = [
  { factor: '5,00000000000', isinCode: 'BRMGLUACNOR2', label: 'BONIFICACAO', lastDatePrior: '29/12/2025' },
  { factor: '0,10000000000', isinCode: 'BRMGLUACNOR2', label: 'GRUPAMENTO', lastDatePrior: '24/05/2024' },
  { factor: '300,00000000000', isinCode: 'BRMGLUACNOR2', label: 'DESDOBRAMENTO', lastDatePrior: '13/10/2020' },
  { factor: '100,00000000000', isinCode: 'BRITSAR14OR8', label: 'RESG TOTAL RV', lastDatePrior: '06/07/2012' },
];
const ISIN = new Map([['BRPETRACNOR9', 'PETR3'], ['BRPETRACNPR6', 'PETR4'], ['BRMGLUACNOR2', 'MGLU3']]);
const HOJE = '2026-11-02';

test('numBr e dataBr: formatos da B3', () => {
  assert.equal(numBr('0,47156696000'), 0.47156696);
  assert.equal(numBr('7.442.231.382'), 7442231382);
  assert.equal(numBr(''), null);
  assert.equal(numBr(undefined), null);
  assert.equal(dataBr('21/08/2026'), '2026-08-21');
  assert.equal(dataBr('31/12/9999'), null);
  assert.equal(dataBr('lixo'), null);
});

test('tipoProvento e fatorEvento', () => {
  assert.equal(tipoProvento('DIVIDENDO'), 'DIV');
  assert.equal(tipoProvento('JRS CAP PROPRIO'), 'JCP');
  assert.equal(tipoProvento('RENDIMENTO'), 'REND');
  assert.equal(tipoProvento('AMORTIZACAO'), null); // devolução de capital não entra no DY
  assert.equal(fatorEvento(MGLU_EV[0]), 1.05); // bonificação de 5%
  assert.equal(fatorEvento(MGLU_EV[1]), 0.1); // grupamento 10:1
  assert.equal(fatorEvento(MGLU_EV[2]), 4); // desdobramento 1:4 (+300%)
  assert.equal(fatorEvento(MGLU_EV[3]), null);
});

test('lerCotahistIsin: ações (BDI 02) e FII (BDI 12) no mercado à vista ligam ISIN ao ticker', () => {
  const linha = (bdi, ticker, isin, mercado = '010') => `01${'20261030'}${bdi}${ticker.padEnd(12)}${mercado}`.padEnd(230, ' ') + isin.padEnd(12) + '000';
  const m = lerCotahistIsin([linha('02', 'PETR4', 'BRPETRACNPR6'), linha('12', 'HGLG11', 'BRHGLGCTF004'), linha('96', 'PETR4F', 'BRPETRACNPR6'), linha('02', 'XPTO3', 'BRXPTOACNOR1', '070')].join('\n'));
  assert.deepEqual([...m], [['BRPETRACNPR6', { ticker: 'PETR4', fii: false }], ['BRHGLGCTF004', { ticker: 'HGLG11', fii: true }]]);
});

test('montarAtivos: proventos por ticker, eventos com fator, só tipos que entram no DY', () => {
  const a = montarAtivos(PETR, ISIN, HOJE);
  assert.deepEqual(Object.keys(a).sort(), ['PETR3', 'PETR4']);
  assert.deepEqual(a.PETR3.p[0], ['2026-08-21', '2026-12-21', 0.47156696, 'DIV']); // mais recente primeiro
  assert.equal(a.PETR3.p.length, 3);
  assert.deepEqual(a.PETR3.ev, []); // desdobramento de 2008 está fora da janela de 6 anos
  const m = montarAtivos({ cashDividends: [], stockDividends: MGLU_EV }, ISIN, HOJE);
  // o desdobramento de 13/10/2020 fica fora da janela de 6 anos (a partir de 02/11/2020); os preços cobrem 5
  assert.deepEqual(m.MGLU3.ev, [['2025-12-29', 1.05, 'BONIFICACAO'], ['2024-05-24', 0.1, 'GRUPAMENTO']]);
  assert.deepEqual(montarAtivos({ stockDividends: MGLU_EV }, ISIN, '2026-10-01').MGLU3.ev.at(-1), ['2020-10-13', 4, 'DESDOBRAMENTO']);
});

test('soma12m: data com nos últimos 365 dias', () => {
  const p = [['2026-08-21', '', 1, 'DIV'], ['2025-11-03', '', 2, 'JCP'], ['2025-11-02', '', 4, 'DIV'], ['2027-01-01', '', 8, 'DIV']];
  assert.equal(soma12m(p, HOJE), 3); // 02/11/2025 fica fora (365 dias antes); data futura fica fora
  assert.equal(soma12m([], HOJE), 0);
});

test('juntarHistorico: acumula com o arquivo anterior sem duplicar e corta em 5 anos', () => {
  const novo = [['2026-08-21', '2026-12-21', 0.5, 'DIV']];
  const velho = [['2026-08-21', '2026-12-21', 0.5, 'DIV'], ['2024-03-01', '2024-04-01', 0.3, 'JCP'], ['2020-01-01', '2020-02-01', 9, 'DIV']];
  assert.deepEqual(juntarHistorico(novo, velho, HOJE), [['2026-08-21', '2026-12-21', 0.5, 'DIV'], ['2024-03-01', '2024-04-01', 0.3, 'JCP']]);
});

test('acoesDoEmissor: ON, PN e total da B3 (para conferir com a CVM)', () => {
  assert.deepEqual(acoesDoEmissor(PETR), { on: 7442231382, pn: 5446501379, total: 12888732761 });
  assert.deepEqual(acoesDoEmissor({ quantity: '45.601.745' }), { cotas: 45601745 });
});
