// Custos de uma ordem de compra ou venda no mercado à vista (ações, FIIs, ETFs; lote ou fracionário; não day trade).
// Puro: valores em centavos inteiros, percentuais em % (0,0224 = 0,0224%).
//
// Tarifas da B3 (Tarifação de Produtos de Renda Variável, versão 3, em vigor desde 08/2025; investidor com ADTV mensal
// até R$ 3 milhões; não day trade):
//  - negociação (na nota: "Emolumentos") ......... 0,0050%
//  - CCP (na nota: "Taxa de liquidação") ......... 0,0224%
//  - transferência de ativos (TTA) ............... fixada por ano conforme o volume do mercado (0,00135% a 0,00260%);
//    0,00225% até confirmar o valor de 2026 (uma nota de R$ 580,47 só restringiu a 0,00190%, 0,00225% ou 0,00260%).
// Cada tarifa é cortada no centavo, sem arredondar: reproduz a nota real (0,0290 -> R$ 0,02 de emolumentos).
// A B3 calcula sobre o total do dia do investidor; aqui, por ordem: várias ordens no mesmo dia podem diferir em centavos.

export const TARIFAS_B3 = { tNeg: '0,0050', tLiq: '0,0224', tTta: '0,00225' };
const UNID = 1e5; // % -> unidades de 0,00001% (inteiras), para a conta em centavos não sofrer com ponto flutuante

/** "0,0224", "0.0224%" -> 0.0224. Vazio = 0. Fora de [0, max] ou inválido = null. */
export function lerPct(texto, { max = 1 } = {}) {
  const s = String(texto ?? '').replace('%', '').trim().replace(',', '.');
  if (s === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const x = Number(s);
  return x >= 0 && x <= max ? x : null;
}

/**
 * Textos guardados (aporte.cfg: tNeg, tLiq, tTta, taxa = corretagem em R$, iss em %) -> números.
 * Texto ausente usa a tabela oficial (corretagem e ISS: zero). paraCentavos converte a corretagem (fica fora daqui).
 */
export function tarifasDe(t, paraCentavos = () => 0) {
  const v = (k) => (t?.[k] == null ? TARIFAS_B3[k] : t[k]);
  const corr = String(t?.taxa ?? '').trim();
  return {
    negociacao: lerPct(v('tNeg')), liquidacao: lerPct(v('tLiq')), tta: lerPct(v('tTta')),
    corretagem: corr ? paraCentavos(corr) : 0, iss: lerPct(t?.iss ?? '', { max: 10 }),
  };
}

export const pctTotalB3 = (tar) => (tar.negociacao ?? 0) + (tar.liquidacao ?? 0) + (tar.tta ?? 0);

const corta = (valor, pct) => Math.floor((valor * Math.round((pct ?? 0) * UNID)) / (100 * UNID));

/** Custos de uma ordem de `valor` centavos: cada tarifa da B3 cortada no centavo, mais corretagem e ISS sobre ela. */
export function custosOperacao(valor, tar) {
  if (!(valor > 0)) return { liquidacao: 0, negociacao: 0, tta: 0, b3: 0, corretagem: 0, iss: 0, total: 0 };
  const liquidacao = corta(valor, tar.liquidacao), negociacao = corta(valor, tar.negociacao), tta = corta(valor, tar.tta);
  const corretagem = tar.corretagem ?? 0, iss = Math.round((corretagem * Math.round((tar.iss ?? 0) * UNID)) / (100 * UNID));
  const b3 = liquidacao + negociacao + tta;
  return { liquidacao, negociacao, tta, b3, corretagem, iss, total: b3 + corretagem + iss };
}

/** Custo total de uma ordem em função do valor (0 sem ordem): usado pelo aporte para ver quantas cotas cabem. */
export const custoOrdem = (tar) => (valor) => (valor > 0 ? custosOperacao(valor, tar).total : 0);

/** IR retido na fonte na venda ("dedo-duro"), 0,005% do valor; abaixo de R$ 1,00 de imposto não há retenção. Não é custo: é compensado no IR. */
export function irrfVenda(valor) {
  const ir = Math.floor((valor * 5) / 100000);
  return ir >= 100 ? ir : 0;
}
