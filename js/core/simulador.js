// Simulador de carteira. Puro: centavos inteiros, sem DOM, rede nem relógio.
// Pregão a pregão no calendário do Ibovespa (BOVA11); a carteira compra cotas inteiras, o Ibovespa, o CDI e
// o IPCA recebem os mesmos aportes nas mesmas datas. Funções de métrica (twr, xirr, ipcaAcumulado) saem separadas.
import { arredonda } from './money.js';
import { ehData } from './datas.js';
import { quedaMaxima } from './risco.js';
import { propor } from './aporte.js';

const iso = (d) => { const s = String(d); return s.includes('-') ? s : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const dias = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5;
const reais = (c) => (c / 100).toFixed(2).replace('.', ',');
const inteiro = (n, nome, min = 0) => { if (!Number.isInteger(n) || n < min) throw new RangeError(`${nome} inválido`); };

/** TWR total (fração: 0.1 = 10%) = Π((valorₜ − aporteₜ) ÷ valorₜ₋₁) − 1. pontos: [{valor, aporte?}] em ordem de data. */
export function twr(pontos) {
  let f = 1;
  for (let i = 1; i < pontos.length; i++) {
    const ant = pontos[i - 1].valor;
    if (ant > 0) f *= (pontos[i].valor - (pontos[i].aporte ?? 0)) / ant; // dia sem patrimônio anterior não rende
  }
  return f - 1;
}

/** Anualiza um retorno total só com 1 ano (365 dias) ou mais; antes disso, null (extrapolar seria enganoso). */
export const anualizado = (retorno, nDias) => (nDias >= 365 ? (1 + retorno) ** (365 / nDias) - 1 : null);

/**
 * XIRR: taxa anual r tal que Σ valor ÷ (1+r)^(dias desde o 1º fluxo ÷ 365) = 0. Newton-Raphson; se não convergir,
 * bisseção em (-1, ∞). fluxos: [{data:'AAAA-MM-DD', valor}] (saída negativa, entrada positiva). null sem solução.
 */
export function xirr(fluxos, chute = 0.1) {
  if (!fluxos.some((x) => x.valor > 0) || !fluxos.some((x) => x.valor < 0)) return null;
  const t0 = fluxos.map((x) => x.data).sort()[0];
  const fl = fluxos.map((x) => ({ v: x.valor, a: dias(t0, x.data) / 365 }));
  const f = (r) => fl.reduce((s, x) => s + x.v / (1 + r) ** x.a, 0);
  const df = (r) => fl.reduce((s, x) => s - (x.a * x.v) / (1 + r) ** (x.a + 1), 0);
  let r = chute;
  for (let i = 0; i < 60; i++) {
    const d = df(r);
    if (!Number.isFinite(d) || d === 0) break;
    const novo = r - f(r) / d;
    if (!Number.isFinite(novo) || novo <= -1) break;
    if (Math.abs(novo - r) < 1e-12) return novo;
    r = novo;
  }
  let lo = -0.999999, hi = 1;
  while (f(lo) * f(hi) > 0 && hi < 1e12) hi *= 2;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const m = (lo + hi) / 2;
    if (f(lo) * f(m) <= 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

// Índice do IPCA numa data: meses anteriores compostos inteiros; o mês corrente, pro rata por dias ((dia−1)/dias do mês).
// Mês sem dado conta como 0% (o aviso sai em simular). ipca: [{data, valor:% no mês}].
function indiceIpca(ipca) {
  const m = ipca.map((x) => ({ ym: x.data.slice(0, 7), f: 1 + x.valor / 100 }));
  return (d) => {
    const ym = d.slice(0, 7), dia = Number(d.slice(8, 10));
    const nDias = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
    return m.reduce((f, x) => f * (x.ym < ym ? x.f : x.ym === ym ? x.f ** ((dia - 1) / nDias) : 1), 1);
  };
}

/** IPCA acumulado entre duas datas 'AAAA-MM-DD' (fração: 0.05 = 5%). */
export function ipcaAcumulado(ipca, de, ate) {
  const idx = indiceIpca(ipca);
  return idx(ate) / idx(de) - 1;
}

/** Métricas de uma série diária [{data, valor, aportadoAcum}]. Retorno nominal = TWR; real desconta o IPCA do período. */
function resumir(serie, ipca) {
  const pontos = serie.map((p, i) => ({ valor: p.valor, aporte: p.aportadoAcum - (i ? serie[i - 1].aportadoAcum : 0) }));
  const ini = serie[0].data, fim = serie.at(-1).data, nDias = dias(ini, fim);
  const t = twr(pontos), valorFinal = serie.at(-1).valor, aportado = serie.at(-1).aportadoAcum;
  const fluxos = pontos.map((p, i) => ({ data: serie[i].data, valor: -p.aporte })).filter((x) => x.valor !== 0);
  fluxos.push({ data: fim, valor: valorFinal });
  return {
    valorFinal, aportado, ganho: valorFinal - aportado,
    twr: t, twrAnual: anualizado(t, nDias), xirr: xirr(fluxos),
    real: (1 + t) / (1 + ipcaAcumulado(ipca, ini, fim)) - 1,
  };
}

const ESTRATEGIAS = ['pesos-fixos', 'rebalancear-aportes'];

/**
 * Simula a carteira. carteira: [{ticker, pesoPct}]; precos: {TICKER:{d:[AAAAMMDD] crescente, p:[centavos]}}; ibov: {d,p};
 * cdi: [{data, valor:% ao dia}]; ipca: [{data, valor:% no mês}]; inicio/fim 'AAAA-MM-DD'.
 * Aporte inicial no 1º pregão; mensais no 1º pregão em/após diaAporte, dos meses seguintes ao do início.
 * -> {series:{carteira,ibov,cdi,ipca}, resumo:{carteira,ibov,cdi,ipca}, quedaMaxima, ipcaPeriodo,
 *     aportes:[{data,valor}], mesesDeAporte, final:{cotas,caixa}, premissas, avisos}
 * séries: [{data, valor, aportadoAcum}] em centavos. Período sem pregão: séries vazias e resumo null, com aviso.
 */
export function simular({
  carteira, aporteInicial = 0, aporteMensal = 0, diaAporte = 1, estrategia = 'pesos-fixos', taxaPorOrdem = 0,
  precos = {}, ibov, cdi = [], ipca = [], inicio, fim,
}) {
  if (!ESTRATEGIAS.includes(estrategia)) throw new RangeError('estratégia inválida');
  inteiro(aporteInicial, 'aporte inicial'); inteiro(aporteMensal, 'aporte mensal');
  inteiro(taxaPorOrdem, 'taxa'); inteiro(diaAporte, 'dia do aporte', 1);
  if (diaAporte > 31 || !ehData(inicio) || !ehData(fim) || inicio > fim) throw new RangeError('período inválido');
  const pesos = new Map();
  for (const c of carteira) {
    if (!(c.pesoPct >= 0)) throw new RangeError(`peso de ${c.ticker} inválido`);
    const t = String(c.ticker).toUpperCase();
    pesos.set(t, (pesos.get(t) ?? 0) + c.pesoPct);
  }
  if (![...pesos.values()].some((p) => p > 0)) throw new RangeError('carteira sem peso');

  const cal = ibov.d.map((d, i) => ({ data: iso(d), p: ibov.p[i] })).filter((x) => x.data >= inicio && x.data <= fim);
  const premissas = [
    'Preços de fechamento brutos, sem ajuste: desdobramento ou grupamento aparece como queda ou alta de preço.',
    'Sem proventos: dividendos e JCP não entram, nem na carteira nem no Ibovespa; o retorno de quem paga proventos fica subestimado.',
    'Sem imposto de renda sobre ganhos ou vendas.',
    taxaPorOrdem ? `Taxa de R$ ${reais(taxaPorOrdem)} por ordem de compra ou venda da carteira.` : 'Sem taxas de corretagem.',
    'Ibovespa representado pelo BOVA11 (só preço), em cotas fracionárias e sem taxa; CDI e IPCA também sem taxa.',
    'CDI: taxas diárias do Banco Central compostas entre um pregão e o seguinte.',
    'IPCA: aportes corrigidos pelo IPCA acumulado (a variação de cada mês é distribuída pelos dias do mês).',
    `Aporte inicial no 1º pregão do período; aportes mensais no 1º pregão em ou depois do dia ${diaAporte} de cada mês, a partir do mês seguinte. Ibovespa, CDI e IPCA recebem os mesmos aportes nas mesmas datas.`,
    'Carteira compra cotas inteiras; a sobra fica em caixa, sem rendimento, e entra no aporte seguinte.',
    estrategia === 'pesos-fixos'
      ? 'Estratégia pesos fixos: a cada aporte a carteira inteira volta aos pesos escolhidos (compra e vende).'
      : 'Estratégia rebalancear com aportes: só compra, e o dinheiro vai para quem está mais abaixo do peso escolhido.',
    'Só entram ativos com histórico de preços no período; os pesos são redistribuídos entre os que já têm preço.',
    'Simulação educacional com dados passados: não é recomendação, e rendimento passado não garante o futuro.',
  ];
  const avisos = [];
  const vazio = { series: { carteira: [], ibov: [], cdi: [], ipca: [] }, resumo: null, quedaMaxima: null, ipcaPeriodo: null,
    aportes: [], mesesDeAporte: 0, final: { cotas: {}, caixa: 0 }, premissas, avisos };
  if (!cal.length) { avisos.push('Sem pregões do Ibovespa no período escolhido.'); return vazio; }
  const primeiro = cal[0].data, ultimo = cal.at(-1).data;

  // um "andador" de preço por ativo: último preço em ou antes do dia (carrega para frente nos dias sem negócio)
  const ativos = [];
  for (const [ticker, pesoPct] of [...pesos].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const s = precos[ticker];
    const ds = (s?.d ?? []).map(iso);
    if (!ds.length || ds[0] > ultimo || ds.at(-1) < primeiro) { avisos.push(`${ticker}: sem histórico de preços no período, ficou de fora.`); continue; }
    if (ds[0] > primeiro) avisos.push(`${ticker}: sem preço no início; entra na carteira no primeiro aporte depois de ${ds[0]}.`);
    if (dias(ds.at(-1), ultimo) > 7) avisos.push(`${ticker}: preços só até ${ds.at(-1)}; depois disso o último preço foi mantido.`);
    ativos.push({ ticker, pesoPct, ds, ps: s.p, j: -1, cotas: 0, preco: null });
  }
  if (!ativos.length) avisos.push('Nenhum ativo da carteira tem preço no período; a carteira ficou só em caixa.');

  const cdiOrd = [...cdi].sort((a, b) => (a.data < b.data ? -1 : 1));
  const ipcaOrd = [...ipca].sort((a, b) => (a.data < b.data ? -1 : 1));
  const idxIpca = indiceIpca(ipcaOrd);
  let cdiPtr = 0, semCdi = 0;
  let caixa = 0, aportadoAcum = 0, unidadesIbov = 0, valCdi = 0, valIpca = 0, mesAportado = '', mesesDeAporte = 0;
  const series = { carteira: [], ibov: [], cdi: [], ipca: [] }, aportes = [], pontosRisco = [];

  cal.forEach(({ data, p }, i) => {
    const ym = data.slice(0, 7);
    let ap = 0, evento = false;
    if (i === 0) { ap = aporteInicial; evento = true; }
    else if (ym !== primeiro.slice(0, 7) && ym !== mesAportado && Number(data.slice(8, 10)) >= diaAporte) {
      ap = aporteMensal; evento = true; mesAportado = ym; mesesDeAporte++;
    }
    aportadoAcum += ap;
    if (ap) aportes.push({ data, valor: ap });
    caixa += ap;

    for (const a of ativos) {
      while (a.j + 1 < a.ds.length && a.ds[a.j + 1] <= data) a.j++;
      a.preco = a.j >= 0 && a.ps[a.j] > 0 ? a.ps[a.j] : null;
    }
    if (evento) caixa = negociar(ativos.filter((a) => a.preco), caixa, estrategia, taxaPorOrdem);

    const valor = caixa + ativos.reduce((t, a) => t + (a.preco ? a.cotas * a.preco : 0), 0);
    series.carteira.push({ data, valor, aportadoAcum });
    pontosRisco.push({ v: valor, aporte: ap });

    // benchmarks
    unidadesIbov += ap / p;
    series.ibov.push({ data, valor: arredonda(unidadesIbov * p), aportadoAcum });
    if (i === 0) { valCdi = ap; valIpca = ap; } else {
      const ant = cal[i - 1].data;
      while (cdiPtr < cdiOrd.length && cdiOrd[cdiPtr].data < ant) cdiPtr++;
      let f = 1, n = 0;
      for (; cdiPtr < cdiOrd.length && cdiOrd[cdiPtr].data < data; cdiPtr++, n++) f *= 1 + cdiOrd[cdiPtr].valor / 100;
      if (!n) semCdi++;
      valCdi = valCdi * f + ap;
      valIpca = (valIpca * idxIpca(data)) / idxIpca(ant) + ap;
    }
    series.cdi.push({ data, valor: arredonda(valCdi), aportadoAcum });
    series.ipca.push({ data, valor: arredonda(valIpca), aportadoAcum });
  });

  if (semCdi) avisos.push(`CDI sem dado em ${semCdi} pregão(ões) do período (tratado como 0%).`);
  const mesesIpca = new Set(ipcaOrd.map((x) => x.data.slice(0, 7)));
  let semIpca = 0;
  for (let m = primeiro.slice(0, 7); m <= ultimo.slice(0, 7); m = proximoMes(m)) if (!mesesIpca.has(m)) semIpca++;
  if (semIpca) avisos.push(`IPCA sem dado em ${semIpca} mês(es) do período (tratado como 0%).`);

  return {
    series,
    resumo: Object.fromEntries(Object.keys(series).map((k) => [k, resumir(series[k], ipcaOrd)])),
    quedaMaxima: quedaMaxima(pontosRisco),
    ipcaPeriodo: ipcaAcumulado(ipcaOrd, primeiro, ultimo),
    aportes, mesesDeAporte,
    final: { cotas: Object.fromEntries(ativos.map((a) => [a.ticker, a.cotas])), caixa },
    premissas, avisos,
  };
}

const proximoMes = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

// Opera num dia de aporte. `disp` = ativos com preço hoje (muda cotas). Pesos renormalizados entre eles. Devolve o caixa novo.
function negociar(disp, caixa, estrategia, taxa) {
  const soma = disp.reduce((t, a) => t + a.pesoPct, 0);
  if (!(soma > 0)) return caixa;
  if (estrategia === 'rebalancear-aportes') {
    if (caixa <= 0) return caixa;
    const r = propor({
      aporte: caixa, taxaPorOrdem: taxa, lote: 1,
      ativos: disp.map((a) => ({ ticker: a.ticker, valor: a.cotas * a.preco, alvoPct: (a.pesoPct / soma) * 100, preco: a.preco, nota: null, ms: null, evitar: false })),
    });
    for (const l of r.linhas) disp.find((a) => a.ticker === l.ticker).cotas += l.cotas;
    return r.sobra;
  }
  // pesos-fixos: vende o excesso, depois compra o que falta (maior déficit primeiro) com o caixa que houver
  const total = caixa + disp.reduce((t, a) => t + a.cotas * a.preco, 0);
  const meta = new Map(disp.map((a) => [a, Math.floor(((a.pesoPct / soma) * total) / a.preco + 1e-9)]));
  for (const a of disp) {
    const n = a.cotas - meta.get(a);
    if (n > 0 && n * a.preco > taxa) { a.cotas -= n; caixa += n * a.preco - taxa; }
  }
  const falta = (a) => (meta.get(a) - a.cotas) * a.preco;
  for (const a of disp.filter((x) => falta(x) > 0).sort((x, y) => falta(y) - falta(x) || (x.ticker < y.ticker ? -1 : 1))) {
    const n = Math.min(meta.get(a) - a.cotas, Math.floor((caixa - taxa) / a.preco));
    if (n > 0) { a.cotas += n; caixa -= n * a.preco + taxa; }
  }
  return caixa;
}
