// Assistente de aporte: quanto comprar de cada ativo. Puro: centavos inteiros, sem DOM, rede nem relógio.
// Passos: necessidades (quanto falta para o alvo) › fatores (preferência por nota e MS) ›
// waterFilling (reparte o aporte em centavos) › paraLotes (cotas inteiras + "um lote a mais") › propor.
import { arredonda } from './money.js';

const ESCALA = 1_000_000; // fator em inteiro (milionésimos) para repartir com BigInt, sem float
const deTotal = (p, T) => arredonda((p * T) / 100); // p% de T em centavos
const fmt = (x) => x.toFixed(1).replace('.', ',');
const porTicker = (a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
const desempate = (a, b) => b.nec - a.nec || porTicker(a, b); // maior necessidade, depois ticker

/** max(0, alvo% × T − valor) de cada ativo, em centavos. */
export const necessidades = (ativos, T) => ativos.map((a) => Math.max(0, deTotal(a.alvoPct, T) - a.valor));

/** Score = média de nota/10 e clip(0,1)(0,5 + ms/2); sem nota = média dos demais. Fator = max(0,1; 1 + intensidade × z). */
export function fatores(ativos, intensidade) {
  const base = ativos.map((a) => {
    if (a.nota == null) return null;
    if (a.ms == null) return a.nota / 10;
    return (a.nota / 10 + Math.min(1, Math.max(0, 0.5 + a.ms / 2))) / 2;
  });
  const conhecidos = base.filter((s) => s != null);
  const neutro = conhecidos.length ? conhecidos.reduce((s, x) => s + x, 0) / conhecidos.length : 0;
  const s = base.map((x) => x ?? neutro);
  const media = s.reduce((t, x) => t + x, 0) / (s.length || 1);
  const desvio = Math.max(0, ...s.map((x) => Math.abs(x - media)));
  return s.map((x) => Math.max(0.1, 1 + intensidade * (desvio > 1e-12 ? (x - media) / desvio : 0)));
}

/**
 * Reparte `aporte` proporcional a `peso` (BigInt), sem passar de `cap` de ninguém; quem enche sai e o
 * resto é repartido de novo. Centavos que sobram do piso vão por maior resto (desempate: maior nec, ticker).
 * itens: [{ticker, nec, cap, peso}] -> alocado por item (mesma ordem).
 */
export function waterFilling(itens, aporte) {
  const alloc = itens.map(() => 0);
  let vivos = itens.map((_, i) => i).filter((i) => itens[i].cap > 0);
  let R = aporte;
  while (R > 0 && vivos.length) {
    const W = vivos.reduce((t, i) => t + itens[i].peso, 0n);
    const Rb = BigInt(R);
    // quem tem cota proporcional >= cap enche (todos de uma vez: tirá-los só aumenta a cota dos outros)
    const cheios = new Set(vivos.filter((i) => Rb * itens[i].peso >= BigInt(itens[i].cap) * W));
    if (cheios.size) {
      for (const i of cheios) { alloc[i] = itens[i].cap; R -= itens[i].cap; }
      vivos = vivos.filter((i) => !cheios.has(i));
      continue;
    }
    const partes = vivos.map((i) => ({ i, q: (Rb * itens[i].peso) / W, r: (Rb * itens[i].peso) % W, ...itens[i] }));
    let resto = R - partes.reduce((t, p) => t + Number(p.q), 0);
    partes.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : desempate(a, b)));
    for (const p of partes) alloc[p.i] = Number(p.q) + (resto-- > 0 ? 1 : 0); // q fracionário < cap: q+1 <= cap
    R = 0;
  }
  return alloc;
}

/**
 * Converte o alocado em lotes inteiros. Os custos da ordem saem do próprio alocado: o maior número de lotes com
 * cotas × preço + custo(cotas × preço) <= alocado. `custo(valor)` = custo total da ordem (0 sem ordem): taxa fixa por
 * ordem e/ou tarifas percentuais da B3 (core/custos.js). Um número no lugar da função = taxa fixa por ordem.
 * Com o troco, um lote a mais por vez para quem fica mais abaixo do alvo, enquanto couber (custos e teto incluídos).
 * itens: [{ticker, nec, valor, preco, lote, alvoAbs, tetoAbs}] -> {cotas, troco}
 */
export function paraLotes(itens, alloc, aporte, custo) {
  if (typeof custo !== 'function') { const t = custo ?? 0; custo = (v) => (v > 0 ? t : 0); }
  const comCusto = (a, n) => n * a.preco + custo(n * a.preco);
  const cotas = itens.map((a, i) => {
    let lotes = Math.floor(alloc[i] / (a.preco * a.lote));
    while (lotes > 0 && comCusto(a, lotes * a.lote) > alloc[i]) lotes--;
    return lotes * a.lote;
  });
  const gasto = () => itens.reduce((t, a, i) => t + comCusto(a, cotas[i]), 0);
  let troco = aporte - gasto();
  for (;;) {
    const cand = itens
      .map((a, i) => {
        const tem = a.valor + cotas[i] * a.preco, lote = a.preco * a.lote;
        return { ...a, i, falta: a.alvoAbs - tem, custo: comCusto(a, cotas[i] + a.lote) - comCusto(a, cotas[i]), cabeTeto: tem + lote <= a.tetoAbs };
      })
      .filter((c) => c.falta > 0 && c.cabeTeto && c.custo <= troco)
      .sort((a, b) => b.falta - a.falta || desempate(a, b));
    if (!cand.length) break;
    cotas[cand[0].i] += cand[0].lote;
    troco -= cand[0].custo;
  }
  return { cotas, troco };
}

const inteiro = (n, nome, min = 0) => {
  if (!Number.isInteger(n) || n < min) throw new RangeError(`${nome} inválido`);
};

/**
 * Proposta de aporte. Ver contrato em .model-router/run-3/context.md.
 * ativos: [{ticker, valor, alvoPct, preco, nota, ms, evitar, lote?, faixa?}] (faixa opcional, só entra no motivo).
 * -> {linhas:[{ticker, cotas, preco, custo, pesoAntes, pesoDepois, alvoPct, motivo}], total, taxas, sobra, avisos}
 * Linhas: todos os ativos, em ordem de ticker (cotas 0 para quem não recebe). Pesos em % (0..100).
 */
export function propor({ aporte, taxaPorOrdem = 0, custo = null, lote = 1, intensidade = 0.5, teto = null, ativos }, { ignorarEvitar = true } = {}) {
  inteiro(aporte, 'aporte'); inteiro(taxaPorOrdem, 'taxa'); inteiro(lote, 'lote', 1);
  // custo da ordem pelo valor (taxa fixa + tarifas da B3); sem a função, só a taxa fixa por ordem
  const custoDe = custo ?? ((v) => (v > 0 ? taxaPorOrdem : 0));
  const todos = [...ativos].sort(porTicker); // ordem de entrada não muda nada
  const V = todos.reduce((t, a) => (inteiro(a.valor, `valor de ${a.ticker}`), t + a.valor), 0);
  const T = V + aporte;
  const tetoAbs = teto == null ? Infinity : Math.floor(Number(((teto * T) / 100).toPrecision(15)));
  const avisos = [];
  const nec = necessidades(todos, T);

  const itens = todos.map((a, i) => {
    const it = { ...a, nec: nec[i], lote: a.lote ?? lote, alvoAbs: deTotal(a.alvoPct, T), tetoAbs, cap: 0, fora: null };
    inteiro(it.lote, `lote de ${a.ticker}`, 1);
    if (a.evitar && ignorarEvitar) { it.fora = 'com sinais de alerta'; avisos.push(`${a.ticker}: com sinais de alerta, ficou de fora`); }
    else if (a.preco == null || a.preco <= 0) { it.fora = 'sem preço'; avisos.push(`${a.ticker}: sem preço, ficou de fora`); }
    else if (!(a.alvoPct > 0)) it.fora = 'alvo 0%';
    else { inteiro(a.preco, `preço de ${a.ticker}`, 1); it.cap = Math.max(0, Math.min(it.nec, tetoAbs - a.valor)); }
    return it;
  });

  const rec = itens.filter((a) => a.cap > 0);
  fatores(rec, intensidade).forEach((f, k) => { rec[k].peso = BigInt(rec[k].nec) * BigInt(Math.round(f * ESCALA)); });
  const alloc = waterFilling(rec, aporte);
  const { cotas, troco } = paraLotes(rec, alloc, aporte, custoDe);
  rec.forEach((a, k) => { a.cotas = cotas[k]; });

  const total = itens.reduce((t, a) => t + (a.cotas ?? 0) * a.preco, 0) || 0;
  const V2 = V + total;
  const linhas = itens.map((a) => {
    const n = a.cotas ?? 0, custo = n * (a.preco ?? 0);
    const pesoAntes = V ? (a.valor / V) * 100 : 0;
    const pesoDepois = V2 ? ((a.valor + custo) / V2) * 100 : 0;
    return { ticker: a.ticker, cotas: n, preco: a.preco ?? null, custo, pesoAntes, pesoDepois, alvoPct: a.alvoPct, motivo: motivo(a, n, pesoAntes) };
  });
  const taxas = rec.reduce((t, a) => t + custoDe(a.cotas * a.preco), 0);
  return { linhas, total, taxas, sobra: troco, avisos };
}

function motivo(a, cotas, pesoAntes) {
  if (a.fora) return a.fora;
  if (a.nec === 0) return 'já no alvo';
  if (a.cap === 0) return 'no teto';
  if (!cotas) return 'aporte não cobre um lote';
  const pts = a.alvoPct - pesoAntes;
  const partes = [pts > 0 ? `${fmt(pts)} pontos abaixo do alvo` : 'perto do alvo'];
  if (a.nota != null) partes.push(`nota de valor ${fmt(a.nota)}`);
  if (a.faixa) partes.push(`faixa ${a.faixa}`);
  return partes.join('; ');
}
