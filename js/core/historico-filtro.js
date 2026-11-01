// Filtro e agrupamento do Histórico (puro). Transação: ver posicoes.js. Valores em centavos.
import { mulDiv } from './money.js';

export const COM_COTAS = ['compra', 'venda', 'transferencia'];

/** Valor da movimentação em centavos (sempre positivo): cotas × preço (+ taxas na compra, − taxas na venda) ou o valor lançado. */
export function totalMov(t) {
  if (!COM_COTAS.includes(t.tipo)) return t.valor ?? 0;
  const bruto = mulDiv(t.qtd, t.preco, 1), taxas = t.taxas ?? 0;
  return t.tipo === 'compra' ? bruto + taxas : t.tipo === 'venda' ? bruto - taxas : bruto;
}

/** Efeito no caixa (centavos, com sinal). Transferência de custódia não mexe no caixa. */
export function efeitoCaixa(t) {
  if (t.tipo === 'compra' || t.tipo === 'retirada') return -totalMov(t);
  if (t.tipo === 'venda' || t.tipo === 'deposito' || t.tipo === 'provento') return totalMov(t);
  return 0;
}

/**
 * f = { tipo:'todos'|tipo, ativo:'' (código, sem diferenciar maiúsculas), de:'AAAA-MM-DD'|'', ate:'AAAA-MM-DD'|'', excluidas:boolean }.
 * Mais recentes primeiro (empate de data: registro mais novo primeiro). Excluídas só entram com f.excluidas.
 */
export function filtrar(transacoes, f = {}) {
  const ativo = String(f.ativo ?? '').trim().toUpperCase();
  return transacoes
    .filter((t) => (f.excluidas || !t.excluido)
      && (!f.tipo || f.tipo === 'todos' || t.tipo === f.tipo)
      && (!ativo || (t.ativo ?? '').toUpperCase() === ativo)
      && (!f.de || t.data >= f.de)
      && (!f.ate || t.data <= f.ate))
    .map((t, i) => [t, i])
    .sort(([a, i], [b, j]) => (a.data < b.data ? 1 : a.data > b.data ? -1 : j - i))
    .map(([t]) => t);
}

/** Agrupa uma lista já ordenada por mês. total = efeito líquido no caixa do mês (excluídas não contam). */
export function agruparPorMes(lista) {
  const grupos = [];
  for (const t of lista) {
    const mes = t.data.slice(0, 7);
    let g = grupos[grupos.length - 1];
    if (g?.mes !== mes) grupos.push((g = { mes, itens: [], total: 0 }));
    g.itens.push(t);
    if (!t.excluido) g.total += efeitoCaixa(t);
  }
  return grupos;
}

/** Códigos que aparecem nas movimentações, em ordem alfabética (para o filtro de ativo). */
export const ativosUsados = (transacoes) => [...new Set(transacoes.map((t) => t.ativo).filter(Boolean))].sort();
