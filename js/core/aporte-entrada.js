// Entrada e saída do assistente de aporte. Puro (sem DOM, rede nem relógio): rateio de alvos em centésimos de ponto,
// montagem da entrada de propor() a partir da carteira/preços/análises, ajuste de cotas, gravação em lote e lembrete .ics.
import { visaoCarteira } from './carteira-calc.js';
import { propor } from './aporte.js';
import { validar } from './posicoes.js';
import { gerarIcs } from './ics.js';

export const UNID = 10_000; // 100,00% em centésimos de ponto: os alvos são repartidos em inteiros e fecham exatamente

// ---------- rateio ----------

/** Reparte `total` (inteiro) em partes proporcionais a `pesos` (inteiros >= 0), por maior resto; a soma é sempre `total`. */
export function ratear(total, pesos) {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('total inválido');
  const soma = pesos.reduce((s, p) => s + BigInt(p), 0n);
  const w = soma === 0n ? pesos.map(() => 1n) : pesos.map((p) => BigInt(p));
  const W = soma === 0n ? BigInt(pesos.length) : soma;
  if (!pesos.length) return [];
  const T = BigInt(total);
  const q = w.map((p) => (T * p) / W), r = w.map((p) => (T * p) % W);
  let falta = Number(T - q.reduce((s, x) => s + x, 0n));
  const ordem = w.map((_, i) => i).sort((a, b) => (r[b] > r[a] ? 1 : r[b] < r[a] ? -1 : a - b)); // maior resto; empate: primeiro da lista
  const out = q.map(Number);
  for (const i of ordem) { if (falta-- <= 0) break; out[i]++; }
  return out;
}

const emPct = (u) => u / 100;
const emUnid = (pct) => Math.round(pct * 100);

/** Soma dos alvos em centésimos de ponto (10000 = 100%). Valores ausentes contam 0. */
export const somaUnid = (alvos) => Object.values(alvos).reduce((s, v) => s + (Number.isFinite(v) ? emUnid(v) : 0), 0);

/** Pesos iguais: { TICKER: pct } somando exatamente 100. */
export function pesosIguais(tickers) {
  const p = ratear(UNID, tickers.map(() => 1));
  return Object.fromEntries(tickers.map((t, i) => [t, emPct(p[i])]));
}

/** Por grupo: cada grupo recebe a mesma fatia e, dentro dele, os ativos dividem em partes iguais. itens: [{ticker, grupo}]. */
export function pesosPorGrupo(itens) {
  const grupos = [...new Set(itens.map((i) => i.grupo ?? 'Outros'))].sort();
  const fatia = ratear(UNID, grupos.map(() => 1));
  const out = {};
  grupos.forEach((g, k) => {
    const membros = itens.filter((i) => (i.grupo ?? 'Outros') === g);
    ratear(fatia[k], membros.map(() => 1)).forEach((u, j) => { out[membros[j].ticker] = emPct(u); });
  });
  return out;
}

/** Leva o que a pessoa digitou a 100% mantendo as proporções. Soma zero: devolve igual. */
export function normalizarPara100(alvos) {
  const ks = Object.keys(alvos), pesos = ks.map((k) => Math.max(0, emUnid(alvos[k] || 0)));
  if (pesos.every((p) => p === 0)) return { ...alvos };
  const u = ratear(UNID, pesos);
  return Object.fromEntries(ks.map((k, i) => [k, emPct(u[i])]));
}

/** '12,5' / '12.5%' -> 12.5 (0 a 100, até 2 casas). Vazio ou inválido: null. */
export function paraPct(texto) {
  const s = String(texto ?? '').replace(/[%\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n <= 100 ? n : null;
}

/** 12.5 -> '12,5'; 33.33 -> '33,33'; 10 -> '10'. */
export const fmtPct = (n, max = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: max });

// ---------- entrada de propor() ----------

/**
 * Ativos no formato de propor(). tickers: ordem de exibição; valores/precos: Map ticker -> centavos;
 * analises: Map ticker -> {nota, ms, faixa, evitar}; alvos: { ticker: pct }.
 */
export function montarAtivos({ tickers, valores, precos, analises, alvos }) {
  return tickers.map((t) => {
    const a = analises.get(t) ?? {};
    return {
      ticker: t, valor: valores.get(t) ?? 0, alvoPct: alvos[t] ?? 0, preco: precos.get(t) ?? null,
      nota: a.nota ?? null, ms: a.ms ?? null, evitar: !!a.evitar, ...(a.faixa ? { faixa: a.faixa } : {}),
    };
  });
}

/** Mensagens de ajuda sobre a configuração (números já lidos; null = inválido). cfg: {aporte, taxa, lote, teto, intensidade}. */
export function validarCfg(cfg, alvos) {
  const e = [];
  if (!(cfg.aporte > 0)) e.push('Informe o valor do aporte, em reais.');
  if (cfg.taxa == null) e.push('A taxa por ordem precisa ser um valor em reais (pode ser zero).');
  if (!(cfg.lote >= 1)) e.push('O lote precisa ser um número inteiro, de 1 em diante.');
  if (cfg.teto === undefined) e.push('O teto precisa ser um percentual de 1 a 100, ou fique sem teto.');
  if (somaUnid(alvos) === 0) e.push('Defina o alvo de pelo menos um ativo, ou use um dos atalhos acima.');
  return e;
}

/**
 * Proposta a partir do estado da carteira. cfg: {aporte, taxa, lote, teto (pct|null), intensidade (0..100), evitar}.
 * Devolve também os ativos (para recalcular ao ajustar cotas) e a visão (pesos atuais, ativos sem preço).
 */
export function propostaDe({ estado, precos, analises, alvos = estado.alvos, cfg }) {
  const v = visaoCarteira(estado, precos);
  const tickers = [...v.itens, ...v.acompanhados].map((i) => i.ativo);
  const valores = new Map(v.itens.map((i) => [i.ativo, i.valor ?? 0]));
  const ativos = montarAtivos({ tickers, valores, precos, analises, alvos });
  const prop = propor(
    { aporte: cfg.aporte, taxaPorOrdem: cfg.taxa, lote: cfg.lote, intensidade: cfg.intensidade / 100, teto: cfg.teto, ativos },
    { ignorarEvitar: cfg.evitar },
  );
  return { ativos, prop, visao: v };
}

/**
 * Recalcula totais e pesos para as cotas escolhidas (cotas: { ticker: n }). Mesma regra de propor():
 * total + taxas + sobra = aporte, taxa só em ativo com ordem. `excede` quando as compras e taxas passam do aporte.
 */
export function resumir({ ativos, cotas, aporte, taxaPorOrdem }) {
  const V = ativos.reduce((s, a) => s + a.valor, 0);
  const custo = (a) => (cotas[a.ticker] ?? 0) * (a.preco ?? 0);
  const total = ativos.reduce((s, a) => s + custo(a), 0);
  const taxas = ativos.filter((a) => (cotas[a.ticker] ?? 0) > 0).length * taxaPorOrdem;
  const V2 = V + total;
  const linhas = ativos.map((a) => ({
    ticker: a.ticker, cotas: cotas[a.ticker] ?? 0, preco: a.preco, custo: custo(a), alvoPct: a.alvoPct,
    pesoAntes: V ? (a.valor / V) * 100 : 0, pesoDepois: V2 ? ((a.valor + custo(a)) / V2) * 100 : 0,
  }));
  const sobra = aporte - total - taxas;
  return { linhas, total, taxas, sobra, excede: sobra < 0 };
}

/** Cotas depois de tocar em + ou −: anda de lote em lote e nunca fica abaixo de zero. */
export const passoCotas = (atual, sentido, lote) => Math.max(0, atual + sentido * lote);

// ---------- gravação ----------

/**
 * Compras confirmadas -> transações. itens: [{ticker, qtd, preco, taxas}] (qtd 0 ou vazia = não comprou, fica de fora).
 * Valida todas antes de gravar qualquer uma.
 */
export function transacoesDeCompra(itens, data) {
  const transacoes = [], erros = [];
  for (const i of itens) {
    if (!i.qtd) continue;
    const t = { tipo: 'compra', data, ativo: i.ticker, qtd: i.qtd, preco: i.preco, ...(i.taxas ? { taxas: i.taxas } : {}) };
    const falhas = validar(t, 0);
    if (falhas.length) erros.push(`${i.ticker}: ${falhas[0]}`);
    else transacoes.push(t);
  }
  if (!transacoes.length && !erros.length) erros.push('Informe a quantidade de pelo menos um ativo que você comprou.');
  return { transacoes, erros };
}

/**
 * Grava todas ou nenhuma: se uma falhar, desfaz as já gravadas. `adicionar` é adicionarTransacao (ou um falso em teste).
 * @returns {{ok:true, desfazer:()=>boolean, semArmazenamento:boolean}|{ok:false, erros:string[]}}
 */
export function gravarLote(transacoes, adicionar) {
  const feitas = [];
  for (const t of transacoes) {
    const r = adicionar(t);
    if (r.ok === false) {
      for (const f of feitas.reverse()) f.desfazer?.();
      return { ok: false, erros: [`${t.ativo}: ${r.erros?.[0] ?? 'não consegui gravar'}`, 'Nada foi registrado.'] };
    }
    feitas.push(r);
  }
  return { ok: true, desfazer: () => feitas.map((f) => f.desfazer?.()).every(Boolean), semArmazenamento: feitas.some((f) => f.semArmazenamento) };
}

// ---------- datas e lembrete ----------

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
/** '2026-11-05' -> 'novembro' */
export const mesPorExtenso = (iso) => MESES[Number(iso.slice(5, 7)) - 1];

/** Date -> 'AAAAMMDDTHHMMSSZ' (UTC), o formato do DTSTAMP. */
export const dtstampIcs = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

/** Texto .ics do lembrete mensal. hoje: 'AAAA-MM-DD' local; agora: Date (os dois vêm de fora, daqui não se lê o relógio). */
export function icsDoAporte({ dia, hoje, agora }) {
  return gerarIcs({
    dia, inicio: hoje, dtstamp: dtstampIcs(agora), uid: 'aporte@app-investimentos', titulo: 'Aporte do mês',
    descricao: 'Abra o app e veja a proposta do aporte. Material educacional, não é recomendação.',
  });
}
