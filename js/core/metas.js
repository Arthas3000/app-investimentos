// Metas: progresso e data estimada pelo ritmo médio de aportes dos últimos 6 meses.
import { mulDiv } from './money.js';
import { addMeses, mesDe } from './datas.js';

/** Fração de 0 a 1 (cortada em 1). */
export const progresso = (atual, meta) => (meta > 0 ? Math.min(1, Math.max(0, atual / meta)) : 0);

/**
 * Aporte médio mensal (centavos) = compras (custo com taxas) dos até 6 meses fechados antes do mês de `hoje`.
 * Meses sem compra dentro da janela contam como zero; meses antes da primeira compra não contam.
 * Sem nenhum mês fechado de histórico devolve null (não inventa ritmo).
 */
export function aporteMedio(transacoes, hoje, meses = 6) {
  const compras = transacoes.filter((t) => t.tipo === 'compra' && !t.excluido && t.data < `${mesDe(hoje)}-01`);
  if (!compras.length) return null;
  const primeiro = compras.reduce((m, t) => (t.data < m ? t.data : m), compras[0].data);
  const primeiroMes = mesDe(primeiro);
  let total = 0, n = 0;
  for (let i = 1; i <= meses; i++) {
    const mes = mesDe(addMeses(`${mesDe(hoje)}-01`, -i));
    if (mes < primeiroMes) break;
    n++;
    total += compras.filter((t) => mesDe(t.data) === mes).reduce((s, t) => s + mulDiv(t.qtd, t.preco, 1) + (t.taxas ?? 0), 0);
  }
  return n ? mulDiv(total, 1, n) : null;
}

/**
 * Quando a meta de patrimônio chega, só com aportes (sem contar valorização nem proventos reinvestidos: estimativa conservadora).
 * @returns {{meses:number, data:string}|null} null se o ritmo é desconhecido ou zero
 */
export function estimarMeta({ atual, meta, aporteMensal, hoje }) {
  if (atual >= meta) return { meses: 0, data: hoje };
  if (!aporteMensal || aporteMensal <= 0) return null;
  const meses = Math.ceil((meta - atual) / aporteMensal);
  return { meses, data: addMeses(hoje, meses) };
}

/**
 * Converte uma meta de renda mensal em meta de patrimônio, mantendo o rendimento atual da carteira
 * (renda mensal ÷ patrimônio). null se a carteira ainda não gera renda.
 */
export function metaRendaEmPatrimonio({ metaRendaMensal, rendaMensal, patrimonio }) {
  if (!(rendaMensal > 0) || !(patrimonio > 0)) return null;
  return mulDiv(metaRendaMensal, patrimonio, rendaMensal);
}
