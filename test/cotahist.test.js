import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLinha } from '../scripts/lib/cotahist.mjs';

// Monta uma linha do COTAHIST (245 colunas) campo a campo, na ordem do layout da B3.
const treze = (centavos) => String(centavos).padStart(13, '0');
function linha({ tipo = '01', data = '20260102', bdi = '02', ticker = 'PETR4', mercado = '010', especi = 'PN  EDJ N2', fechamento = 5271, volume = 123456789, fator = 1 } = {}) {
  return (
    tipo + data + bdi + ticker.padEnd(12) + mercado + 'PETROBRAS'.padEnd(12) + especi.padEnd(10) + '   ' + 'R$  ' + // 1-56
    treze(5000) + treze(5300) + treze(4990) + treze(5150) + treze(fechamento) + treze(5270) + treze(5272) + // abertura, máxima, mínima, média, fechamento, oferta de compra e de venda
    '00123' + '000000000000004000' + String(volume).padStart(18, '0') + // negócios, quantidade, volume
    treze(0) + '0' + '99991231' + String(fator).padStart(7, '0') + treze(0) + 'BRPETRACNPR6' + '223' // exercício, opção, vencimento, fator, pontos, ISIN, distribuição
  );
}

test('linha sintética: 245 colunas e campos conferidos à mão', () => {
  const l = linha();
  assert.equal(l.length, 245);
  // data nas colunas 3-10, ticker em 13-24, PREULT em 109-121 (52,71 = 5271 centavos), VOLTOT em 171-188 (R$ 1.234.567,89)
  assert.deepEqual(parseLinha(l), { data: 20260102, ticker: 'PETR4', tipo: 'acao', fechamento: 5271, volume: 1234567.89 });
});

test('FII (BDI 12, espécie CI com marcação) e BOVA11 (BDI 14) entram; o resto não', () => {
  assert.equal(parseLinha(linha({ bdi: '12', ticker: 'HGLG11', especi: 'CI  ER' })).tipo, 'fii');
  assert.equal(parseLinha(linha({ bdi: '14', ticker: 'BOVA11', especi: 'CI' })).tipo, 'etf');
  assert.equal(parseLinha(linha({ bdi: '14', ticker: 'IVVB11', especi: 'CI' })), null); // outro ETF
  assert.equal(parseLinha(linha({ bdi: '96', ticker: 'PETR4F' })), null); // fracionário
  assert.equal(parseLinha(linha({ mercado: '070', ticker: 'PETRA100' })), null); // opção
  assert.equal(parseLinha(linha({ bdi: '02', ticker: 'AAPL34', especi: 'DRN' })), null); // BDR
  assert.equal(parseLinha(linha({ fator: 1000 })), null); // cotado por lote de 1000
  assert.equal(parseLinha(linha({ tipo: '00' })), null); // cabeçalho
  assert.equal(parseLinha(linha({ fechamento: 0 })), null); // sem fechamento
});
