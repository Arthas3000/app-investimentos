// Proventos estimados: posição na data com × dividendo por cota da API. Sempre marcados como estimados.
import { arredonda, mulDiv } from './money.js';
import { calcular } from './posicoes.js';
import { addMeses, mesDe } from './datas.js';

/** Cotas que a pessoa tinha ao fim da data (compra no dia da data com ainda dá direito). */
export const qtdNaData = (transacoes, ativo, data) =>
  calcular(transacoes.filter((t) => t.data <= data)).posicoes.get(ativo)?.qtd ?? 0;

/**
 * @param dividendos { [ativo]: [{ dataCom:'AAAA-MM-DD', pagamento:'AAAA-MM-DD', valor: reais por cota }] }
 * @returns [{ ativo, dataCom, pagamento, qtd, valor (centavos), estimado: true }] por data de pagamento
 */
export function estimarProventos(transacoes, dividendos) {
  const out = [];
  for (const [ativo, lista] of Object.entries(dividendos)) {
    for (const d of lista) {
      const qtd = qtdNaData(transacoes, ativo, d.dataCom);
      if (!qtd) continue;
      // valor por cota pode ter frações de centavo: 1 real = 1e6 "micro", 1 centavo = 1e4 micro
      const valor = mulDiv(qtd, arredonda(d.valor * 1e6), 10_000);
      out.push({ ativo, dataCom: d.dataCom, pagamento: d.pagamento, qtd, valor, estimado: true });
    }
  }
  return out.sort((a, b) => (a.pagamento < b.pagamento ? -1 : a.pagamento > b.pagamento ? 1 : a.ativo.localeCompare(b.ativo)));
}

/** Soma por mês de pagamento: { 'AAAA-MM': centavos }. */
export function porMes(proventos) {
  const m = {};
  for (const p of proventos) m[mesDe(p.pagamento)] = (m[mesDe(p.pagamento)] ?? 0) + p.valor;
  return m;
}

/** Soma dos pagamentos nos 12 meses até `hoje` (inclusive). Média mensal = soma ÷ 12. */
export function soma12m(proventos, hoje) {
  const ini = addMeses(hoje, -12);
  return proventos.filter((p) => p.pagamento > ini && p.pagamento <= hoje).reduce((s, p) => s + p.valor, 0);
}
