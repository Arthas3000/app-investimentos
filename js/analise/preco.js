// Faixa de preço (barato | normal | caro) em relação aos próprios dados do ativo. Pura. Não é recomendação.
// preco em reais; precos5a = fechamentos de 5 anos em centavos (formato de dados/precos/*.json);
// valor = margem de segurança (ação) ou P/VP (FII), ambos de valor.js.
import { FAIXA_PRECO as F } from './constantes.js';

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const ROTULOS = { barato: 'Barato', normal: 'Normal', caro: 'Caro', indefinido: 'Faixa indefinida' };
const n1 = (x, d = 2) => x.toFixed(d).replace('.', ',');

/** Percentil (0-100) do preço entre os fechamentos: fatia abaixo + metade dos empates. null se poucos pontos. */
export function percentil(preco, precos5a) {
  const p = (precos5a ?? []).filter(tem);
  if (!tem(preco) || p.length < F.minPontos) return null;
  const c = preco * 100;
  const abaixo = p.filter((x) => x < c).length, iguais = p.filter((x) => x === c).length;
  return ((abaixo + iguais / 2) / p.length) * 100;
}

export function faixaPreco({ classe, preco, precos5a, valor }) {
  const sinais = [], motivos = [];
  const pc = percentil(preco, precos5a);
  if (pc !== null) {
    const v = pc <= F.percentil.barato ? -1 : pc >= F.percentil.caro ? 1 : 0;
    sinais.push({ id: 'percentil', voto: v });
    motivos.push(`Preço no ${Math.round(pc)}º percentil dos últimos 5 anos`);
  }
  if (classe === 'fii' && tem(valor)) {
    sinais.push({ id: 'pvp', voto: valor <= F.pvp.barato ? -1 : valor >= F.pvp.caro ? 1 : 0 });
    motivos.push(`P/VP de ${n1(valor)} (barato até ${n1(F.pvp.barato)}, caro a partir de ${n1(F.pvp.caro)})`);
  } else if (classe !== 'fii' && tem(valor)) {
    sinais.push({ id: 'ms', voto: valor >= F.ms ? -1 : valor <= -F.ms ? 1 : 0 });
    motivos.push(`Margem de segurança de ${valor >= 0 ? '+' : '−'}${Math.round(Math.abs(valor) * 100)}%`);
  }
  if (!sinais.length) return { id: 'indefinido', rotulo: ROTULOS.indefinido, motivos: ['Sem dados suficientes para comparar o preço'], sinais };
  const soma = sinais.reduce((s, x) => s + x.voto, 0);
  const id = soma <= -1 ? 'barato' : soma >= 1 ? 'caro' : 'normal';
  if (sinais.length === 1) motivos.push('Com base em 1 dado');
  return { id, rotulo: ROTULOS[id], motivos, sinais };
}
