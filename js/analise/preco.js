// Faixa de preço (barato | normal | caro) em relação aos próprios dados do ativo. Pura. Não é recomendação.
// preco em reais; precos5a = fechamentos de 5 anos em centavos (formato de dados/precos/*.json);
// valor = margem de segurança (ação) ou P/VP (FII), ambos de valor.js.
// Sem a série, limites = { barato, caro } em centavos (de limitesFaixa, gravados em risco.json) dá o mesmo voto.
import { FAIXA_PRECO as F } from './constantes.js';

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const ROTULOS = { barato: 'Barato', normal: 'Normal', caro: 'Caro', indefinido: 'Faixa indefinida' };
const n1 = (x, d = 2) => x.toFixed(d).replace('.', ',');
const reais = (c) => `R$ ${n1(c / 100)}`;

// Percentil (0-100) de um preço em centavos: fatia abaixo + metade dos empates.
function percentilCent(c, p) {
  const abaixo = p.filter((x) => x < c).length, iguais = p.filter((x) => x === c).length;
  return ((abaixo + iguais / 2) / p.length) * 100;
}

/** Percentil (0-100) do preço entre os fechamentos. O preço é arredondado para centavos, como os fechamentos. null se poucos pontos. */
export function percentil(preco, precos5a) {
  const p = (precos5a ?? []).filter(tem);
  if (!tem(preco) || p.length < F.minPontos) return null;
  return percentilCent(Math.round(preco * 100), p);
}

/**
 * Preços de corte da faixa, em centavos: barato = maior preço com percentil ≤ 25; caro = menor com percentil ≥ 75.
 * O percentil não diminui quando o preço sobe, então busca binária. null se poucos pontos.
 */
export function limitesFaixa(precos5a) {
  const p = (precos5a ?? []).filter(tem);
  if (p.length < F.minPontos) return null;
  const min = Math.min(...p), max = Math.max(...p);
  let lo = min - 1, hi = max + 1; // percentil(lo) = 0, percentil(hi) = 100
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (percentilCent(m, p) <= F.percentil.barato) lo = m; else hi = m; }
  const barato = lo;
  lo = min - 1; hi = max + 1;
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (percentilCent(m, p) >= F.percentil.caro) hi = m; else lo = m; }
  return { barato, caro: hi };
}

export function faixaPreco({ classe, preco, precos5a, limites = null, valor }) {
  const sinais = [], motivos = [];
  const temSerie = (precos5a ?? []).filter(tem).length >= F.minPontos;
  const lim = temSerie ? limitesFaixa(precos5a) : tem(limites?.barato) && tem(limites?.caro) ? { barato: limites.barato, caro: limites.caro } : null;
  const pc = temSerie ? percentil(preco, precos5a) : null;
  if (pc !== null) {
    const v = pc <= F.percentil.barato ? -1 : pc >= F.percentil.caro ? 1 : 0;
    sinais.push({ id: 'percentil', voto: v });
    motivos.push(`Preço no ${Math.round(pc)}º percentil dos últimos 5 anos`);
  } else if (lim && tem(preco)) {
    const c = Math.round(preco * 100);
    const v = c <= lim.barato ? -1 : c >= lim.caro ? 1 : 0;
    sinais.push({ id: 'percentil', voto: v });
    motivos.push(v < 0 ? `Preço entre os 25% fechamentos mais baixos dos últimos 5 anos (até ${reais(lim.barato)})`
      : v > 0 ? `Preço entre os 25% fechamentos mais altos dos últimos 5 anos (a partir de ${reais(lim.caro)})`
        : `Preço na faixa do meio dos últimos 5 anos, entre ${reais(lim.barato)} e ${reais(lim.caro)}`);
  }
  if (classe === 'fii' && tem(valor)) {
    sinais.push({ id: 'pvp', voto: valor <= F.pvp.barato ? -1 : valor >= F.pvp.caro ? 1 : 0 });
    motivos.push(`P/VP de ${n1(valor)} (barato até ${n1(F.pvp.barato)}, caro a partir de ${n1(F.pvp.caro)})`);
  } else if (classe !== 'fii' && tem(valor)) {
    sinais.push({ id: 'ms', voto: valor >= F.ms ? -1 : valor <= -F.ms ? 1 : 0 });
    motivos.push(`Margem de segurança de ${valor >= 0 ? '+' : '−'}${Math.round(Math.abs(valor) * 100)}%`);
  }
  if (!sinais.length) return { id: 'indefinido', rotulo: ROTULOS.indefinido, motivos: ['Sem dados suficientes para comparar o preço'], sinais, limites: lim };
  const soma = sinais.reduce((s, x) => s + x.voto, 0);
  const id = soma <= -1 ? 'barato' : soma >= 1 ? 'caro' : 'normal';
  if (sinais.length === 1) motivos.push('Com base em 1 dado');
  return { id, rotulo: ROTULOS[id], motivos, sinais, limites: lim };
}
