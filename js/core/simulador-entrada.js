// Entrada e saída do Simulador (#simulador). Puro (sem DOM, rede nem relógio): período, pesos, validação do que a pessoa
// digitou, montagem dos argumentos de simular() e os números/textos do resultado (gráfico, tabelas, formatação).
// ponytail: importa a leitura/formatação de dinheiro de ui/registrar.js (puras, testadas em home.test.js) em vez de copiá-las.
import { addMeses } from './datas.js';
import { UNID, ratear, somaUnid, paraPct, fmtPct } from './aporte-entrada.js';
import { paraCentavos, paraInteiro, formatarCentavos } from '../ui/registrar.js';

export const MAX_ATIVOS = 10;
export const PERIODOS = [
  { id: '1a', rotulo: '1 ano', meses: 12 }, { id: '3a', rotulo: '3 anos', meses: 36 },
  { id: '5a', rotulo: '5 anos', meses: 60 }, { id: 'max', rotulo: 'Desde o início dos dados', meses: null },
];
export const ESTRATEGIAS = [
  { id: 'pesos-fixos', rotulo: 'Pesos fixos', frase: 'A cada aporte, o simulador compra e vende para a carteira voltar aos pesos que você escolheu.' },
  { id: 'rebalancear-aportes', rotulo: 'Só com aportes', frase: 'Só compra: cada aporte vai para o que estiver mais abaixo do peso escolhido, sem vender nada.' },
];
export const estadoInicial = () => ({ ativos: [], inicial: '', mensal: '', dia: '5', periodo: '3a', taxa: '', estrategia: 'pesos-fixos' });

const TICKER = /^[A-Z0-9]{4,7}$/;

/** Estado guardado (localStorage, pode estar velho ou mexido à mão) -> estado seguro. Campo estranho cai no padrão. */
export function limparEstado(bruto) {
  const e = estadoInicial(), b = bruto && typeof bruto === 'object' ? bruto : {};
  const txt = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  if (Array.isArray(b.ativos)) {
    const vistos = new Set();
    for (const a of b.ativos) {
      const t = txt(a?.ticker, 7)?.toUpperCase();
      if (!t || !TICKER.test(t) || vistos.has(t) || vistos.size >= MAX_ATIVOS) continue;
      vistos.add(t);
      e.ativos.push({ ticker: t, nome: txt(a.nome, 80) ?? '', peso: txt(a.peso, 8) ?? '' });
    }
  }
  for (const k of ['inicial', 'mensal', 'taxa']) e[k] = txt(b[k], 20) ?? e[k];
  e.dia = txt(b.dia, 2) ?? e.dia;
  if (PERIODOS.some((p) => p.id === b.periodo)) e.periodo = b.periodo;
  if (ESTRATEGIAS.some((s) => s.id === b.estrategia)) e.estrategia = b.estrategia;
  return e;
}

// ---------- período ----------

/**
 * Período escolhido, limitado ao que os preços têm. `primeira`/`ultima`: 'AAAA-MM-DD' do calendário do Ibovespa (BOVA11);
 * `primeirasAtivos`: 1ª data de cada ativo escolhido ("desde o início" começa no ativo mais antigo).
 * -> { inicio, fim, limitado (pediu mais do que há), opcao }
 */
export function periodoDe(opcao, { primeira, ultima, primeirasAtivos = [] }) {
  const p = PERIODOS.find((x) => x.id === opcao) ?? PERIODOS[1];
  if (p.meses) {
    const ini = addMeses(ultima, -p.meses);
    return ini < primeira ? { inicio: primeira, fim: ultima, limitado: true, opcao: p.id } : { inicio: ini, fim: ultima, limitado: false, opcao: p.id };
  }
  const m = primeirasAtivos.filter(Boolean).sort()[0];
  return { inicio: m && m > primeira ? m : primeira, fim: ultima, limitado: false, opcao: p.id };
}

/** 20211101 ou '2021-11-01' -> '2021-11-01'. */
export const isoDe = (d) => { const s = String(d); return s.includes('-') ? s : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
export const fmtData = (iso) => iso.split('-').reverse().join('/');
/** Para o Banco Central (dataInicial): 1º dia do mês do início, 'DD/MM/AAAA'. O mês inteiro entra porque o IPCA é dado por mês. */
export const deBcb = (inicio) => `01/${inicio.slice(5, 7)}/${inicio.slice(0, 4)}`;

/** '2023-10-30' a '2026-10-30' -> '3 anos'; '2025-12-01' a '2026-10-30' -> '10 meses'. */
export function duracaoTexto(inicio, fim) {
  const [a, m, d] = inicio.split('-').map(Number), [a2, m2, d2] = fim.split('-').map(Number);
  const meses = (a2 - a) * 12 + (m2 - m) - (d2 < d ? 1 : 0);
  if (meses < 1) return 'menos de 1 mês';
  const an = Math.floor(meses / 12), mm = meses % 12;
  const A = an ? `${an} ano${an > 1 ? 's' : ''}` : '', M = mm ? `${mm} ${mm > 1 ? 'meses' : 'mês'}` : '';
  return A && M ? `${A} e ${M}` : A || M;
}

// ---------- pesos ----------

const emTexto = (pct) => fmtPct(pct);
/** Pesos iguais somando exatamente 100%: [{ticker, peso:'33,34'}...] (o resto vai para os primeiros). */
export function pesosIguaisTexto(tickers) {
  return ratear(UNID, tickers.map(() => 1)).map((u, i) => ({ ticker: tickers[i], peso: emTexto(u / 100) }));
}

/**
 * Pesos da carteira atual a partir de visaoCarteira().itens: pelo valor de hoje; se algum ativo está sem preço, pelo custo (nunca inventa).
 * Soma exatamente 100%. Ignora quem tem valor e custo zerados.
 */
export function pesosDaCarteiraTexto(itens) {
  const todosComValor = itens.length > 0 && itens.every((i) => Number.isFinite(i.valor));
  const v = itens.map((i) => Math.max(0, Math.round((todosComValor ? i.valor : i.custo) || 0)));
  const sel = itens.map((i, k) => ({ i, v: v[k] })).filter((x) => x.v > 0);
  if (!sel.length) return [];
  return ratear(UNID, sel.map((x) => x.v)).map((u, k) => ({ ticker: sel[k].i.ativo, peso: emTexto(u / 100) }));
}

/** Soma dos pesos digitados em pontos percentuais (centésimos exatos) e o que falta/sobra para 100. Peso ilegível conta 0. */
export function somaPesos(ativos) {
  const u = somaUnid(Object.fromEntries(ativos.map((a) => [a.ticker, paraPct(a.peso) ?? 0])));
  return { soma: u / 100, falta: (UNID - u) / 100, ok: u === UNID };
}

// ---------- validação ----------

/**
 * Textos digitados -> argumentos de simular() (sem preços, Ibovespa, CDI e IPCA, que vêm da rede).
 * Devolve { erros:[{campo, msg}], entrada|null }. Aporte vazio conta 0; dia só vale se houver aporte mensal.
 */
export function validar(est, dados = {}) {
  const erros = [], falha = (campo, msg) => erros.push({ campo, msg });
  const ativos = est.ativos ?? [];
  if (!ativos.length) falha('ativos', 'Escolha pelo menos um ativo.');
  if (ativos.length > MAX_ATIVOS) falha('ativos', `Use no máximo ${MAX_ATIVOS} ativos.`);
  const pesos = ativos.map((a) => paraPct(a.peso));
  ativos.forEach((a, k) => { if (pesos[k] == null) falha(`peso:${a.ticker}`, `Peso de ${a.ticker}: use um número de 0 a 100, como 25 ou 12,5.`); });
  if (ativos.length && pesos.every((p) => p != null)) {
    const s = somaPesos(ativos);
    if (!s.ok) falha('ativos', `Os pesos somam ${fmtPct(s.soma)}%; precisam somar 100%.`);
    else if (pesos.every((p) => p === 0)) falha('ativos', 'Dê peso maior que zero a pelo menos um ativo.');
  }
  const din = (txt, campo, nome) => {
    if (!String(txt ?? '').trim()) return 0;
    const c = paraCentavos(txt);
    if (c == null) falha(campo, `${nome}: digite um valor em reais, como R$ 1.000,00.`);
    return c ?? 0;
  };
  const aporteInicial = din(est.inicial, 'inicial', 'Aporte inicial');
  const aporteMensal = din(est.mensal, 'mensal', 'Aporte mensal');
  const taxaPorOrdem = din(est.taxa, 'taxa', 'Taxa por ordem');
  if (!erros.some((e) => e.campo === 'inicial' || e.campo === 'mensal') && aporteInicial + aporteMensal === 0) falha('inicial', 'Informe o aporte inicial ou o mensal.');
  let diaAporte = 1;
  if (aporteMensal > 0) {
    diaAporte = String(est.dia ?? '').trim() ? paraInteiro(est.dia) : null;
    if (!(diaAporte >= 1 && diaAporte <= 31)) { falha('dia', 'Dia do aporte: um número de 1 a 31.'); diaAporte = 1; }
  }
  if (!ESTRATEGIAS.some((s) => s.id === est.estrategia)) falha('estrategia', 'Escolha a estratégia.');
  if (!dados.primeira || !dados.ultima) falha('periodo', 'Ainda não há histórico de preços para simular.');
  if (erros.length) return { erros, entrada: null };
  const per = periodoDe(est.periodo, dados);
  return {
    erros,
    entrada: {
      carteira: ativos.map((a, k) => ({ ticker: a.ticker, pesoPct: pesos[k] })),
      aporteInicial, aporteMensal, diaAporte, estrategia: est.estrategia, taxaPorOrdem,
      inicio: per.inicio, fim: per.fim, periodo: per,
    },
  };
}

// ---------- formatação ----------

/** 0.1234 -> '+12,34%'; -0.05 -> '−5,00%'; null -> '—'. Sempre com sinal e símbolo: a cor nunca é o único sinal. */
export function fmtRetorno(f) {
  if (f == null || !Number.isFinite(f)) return '—';
  const a = Math.abs(f * 100), t = a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${Number(a.toFixed(2)) === 0 ? '' : f < 0 ? '−' : '+'}${t}%`;
}
/** Queda máxima (fração positiva) -> '−24,25%'. */
export const fmtQueda = (q) => (q == null || !Number.isFinite(q) ? '—' : `${q > 0.00005 ? '−' : ''}${(q * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
/** Ganho em centavos com sinal: '+R$ 1.070,64' / '−R$ 10,00'. */
export const fmtGanho = (c) => `${c > 0 ? '+' : ''}${formatarCentavos(c)}`;
/** Valor curto para a escala do gráfico: R$ 950, R$ 12,5 mil, R$ 1,2 mi. */
export function fmtCompacto(c) {
  const r = c / 100, n = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  return r >= 1e6 ? `R$ ${n(r / 1e6)} mi` : r >= 1e3 ? `R$ ${n(r / 1e3)} mil` : `R$ ${n(Math.round(r))}`;
}

// ---------- resultado ----------

export const NOMES = { carteira: 'Sua carteira simulada', ibov: 'Ibovespa (BOVA11)', cdi: 'CDI', ipca: 'IPCA' };
/** Linhas do quadro comparativo. Sem CDI ou sem IPCA a linha some (zero de rendimento não é resultado); sem IPCA não há retorno real. */
export function quadro(res, { cdi = true, ipca = true } = {}) {
  return ['carteira', 'ibov', cdi && 'cdi', ipca && 'ipca'].filter(Boolean)
    .map((id) => ({ id, nome: NOMES[id], ...res.resumo[id], real: ipca ? res.resumo[id].real : null }));
}

/** Posições (0..n-1) de no máximo `max` pontos, igualmente espaçadas, sempre com o primeiro e o último. */
export function indicesAmostra(n, max = 240) {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: max }, (_, k) => Math.round((k * (n - 1)) / (max - 1)));
}

/**
 * Geometria do gráfico das séries `ids` (caminhos SVG 'd' em W x H; eixo y de 0 até o teto). Mesma posição x em todas as linhas.
 * -> { linhas:[{id, d}], grade:[{y, valor}], teto, inicio, fim, pontos }
 */
export function grafico(series, ids, { W = 320, H = 140, max = 240 } = {}) {
  const n = series[ids[0]].length, idx = indicesAmostra(n, max);
  const teto = Math.max(1, ...ids.flatMap((id) => idx.map((i) => series[id][i].valor))) * 1.05;
  const x = (k) => (idx.length < 2 ? 0 : (k / (idx.length - 1)) * W);
  const y = (v) => H - (v / teto) * H;
  const linhas = ids.map((id) => ({ id, d: idx.map((i, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)} ${y(series[id][i].valor).toFixed(1)}`).join(' ') }));
  const grade = [1, 2, 3].map((q) => ({ y: +y((teto * q) / 4).toFixed(1), valor: Math.round((teto * q) / 4) }));
  return { linhas, grade, teto, inicio: series[ids[0]][0].data, fim: series[ids[0]][n - 1].data, pontos: idx.length };
}

/** Posições da tabela equivalente ao gráfico: o 1º dia, o último pregão de cada mês e, se forem muitos, de 2 em 2 / 3 em 3... (sempre com o último). */
export function indicesTabela(serie, maxLinhas = 13) {
  const fins = [];
  serie.forEach((p, i) => { if (i === serie.length - 1 || serie[i + 1].data.slice(0, 7) !== p.data.slice(0, 7)) fins.push(i); });
  const passo = Math.max(1, Math.ceil((fins.length - 1) / (maxLinhas - 1)));
  const sel = fins.filter((_, k) => (fins.length - 1 - k) % passo === 0);
  return sel[0] === 0 ? sel : [0, ...sel];
}

/** Frase para leitor de tela sobre o gráfico: valor final de cada série. `fmt` formata centavos. */
export function descricaoGrafico(series, ids, fmt) {
  const a = series[ids[0]], ult = a.length - 1;
  return `Gráfico de linhas de ${fmtData(a[0].data)} a ${fmtData(a[ult].data)}. Valor final: ${ids.map((id) => `${NOMES[id]} ${fmt(series[id][ult].valor)}`).join('; ')}.`;
}
