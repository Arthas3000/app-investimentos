// Leitura do COTAHIST da B3 (arquivo de largura fixa, 245 colunas, ISO-8859-1, uma linha por papel/dia).
// Posições (base 1): 1-2 tipo de registro (01 = cotação) · 3-10 data AAAAMMDD · 11-12 CODBDI · 13-24 CODNEG ·
// 25-27 TPMERC · 40-49 ESPECI · 109-121 PREULT (fechamento, 13 dígitos com 2 decimais) ·
// 171-188 VOLTOT (volume financeiro em R$, 18 dígitos com 2 decimais) · 211-217 FATCOT (fator de cotação).
//
// LIMITAÇÃO (preço bruto): o COTAHIST não traz fator de ajuste por proventos, desdobramento ou grupamento
// (FATCOT é só "cotado por 1 ou por 1000 papéis"). Os preços aqui são os fechamentos negociados, sem ajuste;
// um desdobramento aparece como um salto falso na série. Quem usa os dados deve tratar esse limite
// (o script de preços conta os saltos grandes em `saltos`, em dados/risco.json).

/**
 * Lê uma linha do COTAHIST. Devolve null se não for cotação aceita:
 * mercado à vista (TPMERC 010), fator de cotação 1, e
 *  - ação de lote padrão (CODBDI 02, espécie ON/PN/UNT, ticker AAAA3/4/5/6/11), ou
 *  - FII (CODBDI 12, espécie CI, ticker AAAA + 2 dígitos), ou
 *  - ETF BOVA11 (CODBDI 14), usado só como proxy do Ibovespa.
 * Ignora fracionário (96), opções (70/78/82...), BDR, direitos, índices etc.
 * A parte final da espécie do FII ("ER", "ES"...) é só marcação do dia e é ignorada.
 * @returns {{ data:number, ticker:string, tipo:'acao'|'fii'|'etf', fechamento:number, volume:number }|null}
 *  fechamento em centavos inteiros; volume em reais.
 */
export function parseLinha(linha) {
  if (linha.length < 217 || linha.slice(0, 2) !== '01') return null;
  if (linha.slice(24, 27) !== '010' || Number(linha.slice(210, 217)) !== 1) return null;
  const bdi = linha.slice(10, 12);
  const ticker = linha.slice(12, 24).trim();
  const especi = linha.slice(39, 49);
  let tipo;
  if (bdi === '02' && /^(ON|PN|UNT)/.test(especi) && /^[A-Z]{4}(3|4|5|6|11)$/.test(ticker)) tipo = 'acao';
  else if (bdi === '12' && especi.startsWith('CI') && /^[A-Z]{4}\d{2}$/.test(ticker)) tipo = 'fii';
  else if (bdi === '14' && ticker === 'BOVA11') tipo = 'etf';
  else return null;
  const fechamento = Number(linha.slice(108, 121));
  if (!(fechamento > 0)) return null;
  return { data: Number(linha.slice(2, 10)), ticker, tipo, fechamento, volume: Number(linha.slice(170, 188)) / 100 };
}
