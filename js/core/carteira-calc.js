// Lógica pura da Carteira (sem DOM, sem storage, sem relógio: quem chama passa "hoje" e os preços).
import { calcular, resumo, precoMedio } from './posicoes.js';
import { addMeses } from './datas.js';

const preco = (precos, c) => (precos instanceof Map ? precos.get(c) : precos?.[c]);
const temPreco = (p) => Number.isSafeInteger(p) && p > 0;

/**
 * Visão da Carteira.
 * - `itens`: ativos com cota, do maior valor para o menor; sem preço entram no fim com preco/valor/resultado/peso = null
 *   (nunca inventa número). `distancia` = peso% − alvo%, em pontos percentuais (+ acima do alvo, − abaixo); null sem alvo ou sem preço.
 * - `acompanhados`: tickers seguidos que NÃO estão na carteira (qtd 0), com preço se houver e distância do alvo (peso 0 − alvo).
 * - totais (saldo, custo, resultado) só somam ativos com preço; `semPreco` lista os outros.
 * @param {{transacoes:object[], acompanhados?:{ticker:string,desde:string}[], alvos?:Record<string,number>}} estado
 * @param {Map<string,number>|Record<string,number>} precos código -> centavos
 */
export function visaoCarteira({ transacoes = [], acompanhados = [], alvos = {} }, precos = {}) {
  const { posicoes, caixa, erros } = calcular(transacoes);
  const r = resumo(posicoes, precos);
  const alvo = (a) => (Number.isFinite(alvos[a]) ? alvos[a] : null);
  const dist = (pesoPct, a) => (alvo(a) == null || pesoPct == null ? null : pesoPct - alvo(a));

  const comPreco = r.itens.map((i) => {
    const peso = i.peso * 100;
    return { ...i, peso, alvo: alvo(i.ativo), distancia: dist(peso, i.ativo) };
  }).sort((a, b) => b.valor - a.valor);
  const sem = r.semPreco.map((ativo) => {
    const p = posicoes.get(ativo);
    return { ativo, qtd: p.qtd, custo: p.custo, precoMedio: precoMedio(p), preco: null, valor: null, resultado: null, resultadoPct: null, peso: null, alvo: alvo(ativo), distancia: null };
  });

  const seguidos = acompanhados.filter((a) => !posicoes.has(a.ticker)).map((a) => {
    const p = preco(precos, a.ticker);
    return { ativo: a.ticker, desde: a.desde, qtd: 0, preco: temPreco(p) ? p : null, alvo: alvo(a.ticker), distancia: dist(0, a.ticker) };
  });

  return {
    saldo: r.saldo, custo: r.custo, resultado: r.resultado, resultadoPct: r.resultadoPct, caixa,
    itens: [...comPreco, ...sem], acompanhados: seguidos, semPreco: r.semPreco, erros,
    vazio: posicoes.size === 0 && seguidos.length === 0,
  };
}

/**
 * "O que mudou desde a última visita" (ex.: ativo que passou de caro para normal).
 * ponytail: stub. Ainda não há análise em cache por ativo para comparar; devolve [] sempre.
 * Quando houver, `analises` será { TICKER: { faixa, nota, em } } e o retorno uma lista de
 * { ticker, tipo:'faixa'|'nota', de, para } só com o que mudou depois de `ultimaVisita`.
 * @param {{ultimaVisita?:string|null}} estado
 * @param {Record<string,object>} [analises]
 * @returns {{ticker:string, tipo:'faixa'|'nota', de:string, para:string}[]}
 */
export function desdeUltimaVisita(estado, analises = {}) { // eslint-disable-line no-unused-vars
  return [];
}

/**
 * Próxima data de aporte a partir de hoje (hoje conta). `aporte` = { valor (centavos), dia (1-31) }.
 * Dia 31 num mês de 30 dias cai no último dia do mês. Sem aporte válido -> null.
 * @returns {{data:string, dias:number, valor:number|null}|null}
 */
export function proximoAporte(aporte, hoje) {
  const dia = aporte?.dia;
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return null;
  const mes = hoje.slice(0, 7);
  const base = `${mes}-${String(dia).padStart(2, '0')}`;
  let data = addMeses(base, 0); // ajusta dia inexistente (31 em abril)
  if (data < hoje) data = addMeses(base, 1);
  const dias = Math.round((Date.parse(`${data}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
  return { data, dias, valor: Number.isSafeInteger(aporte.valor) && aporte.valor > 0 ? aporte.valor : null };
}
