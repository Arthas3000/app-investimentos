// Compositor: encadeia valor, estabilidade e indicação por ativo. Puro (sem DOM, rede ou relógio).
import { notaValorAcao, notaValorFii } from './valor.js';
import { notaEstabilidade, notaSetor } from './estabilidade.js';
import { indicar } from './indicacao.js';
import { faixaPreco } from './preco.js';

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const AVISO_SALTOS = 'Preço histórico com desdobramento ou grupamento: risco pode estar distorcido';

function mediana(v) {
  const a = v.filter(tem).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Agrupa valores por chave e aplica f a cada grupo.
function porGrupo(pares, f) {
  const g = {};
  for (const [k, v] of pares) if (k) (g[k] ??= []).push(v);
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, f(v)]));
}

/**
 * Contexto comum a todos os ativos. setores: ticker -> setor (brapi).
 * Devolve { cdi, queda12mIbov, queda12mFiis, queda12mSetor:{setor:mediana}, estab:{ticker:nota},
 * estabSetor:{setor|segmento: {mediana,dispersao,n}} }.
 */
export function montarCtx({ risco, fundamentos, fiis, cdi, setores = {} }) {
  const r = risco?.ativos ?? {}, acoes = fundamentos?.ativos ?? {}, fs = fiis?.ativos ?? {};
  const tAcoes = Object.keys(acoes), tFiis = Object.keys(fs);
  const estab = {};
  for (const t of tAcoes) estab[t] = notaEstabilidade({ fund: acoes[t], risco: r[t] }).nota;
  for (const t of tFiis) estab[t] = notaEstabilidade({ fund: null, risco: r[t] }).nota;
  return {
    cdi,
    queda12mIbov: r[risco?.ibov ?? 'BOVA11']?.queda12m ?? null,
    queda12mFiis: mediana(tFiis.map((t) => r[t]?.queda12m)),
    queda12mSetor: porGrupo(tAcoes.map((t) => [setores[t], r[t]?.queda12m]), mediana),
    estab,
    estabSetor: {
      ...porGrupo(tAcoes.map((t) => [setores[t], estab[t]]), notaSetor),
      ...porGrupo(tFiis.map((t) => [fs[t].segmento, estab[t]]), notaSetor),
    },
  };
}

/** classe: 'acao' | 'fii'. dados: { fundamentos, fiis, risco }. */
export function analisar({ ticker, classe, preco, dados, ctx = {}, setor = null, precos5a = null }) {
  const fii = classe === 'fii';
  let fund = (fii ? dados?.fiis : dados?.fundamentos)?.ativos?.[ticker];
  if (!fund) return { semDados: true };
  const risco = dados?.risco?.ativos?.[ticker] ?? null;
  const chaveSetor = fii ? fund.segmento : setor;
  const c = { ...ctx, queda12mSetor: ctx.queda12mSetor?.[chaveSetor] ?? null };
  // DY da ação: proventos de 12 meses (B3) ÷ preço de agora; o workflow não grava DY porque o preço muda
  if (!fii && fund.dy == null && typeof fund.prov12m === 'number' && preco > 0) fund = { ...fund, dy: Math.round((fund.prov12m / preco) * 1e6) / 1e6 };
  const valor = (fii ? notaValorFii : notaValorAcao)({ preco, fund, risco, ctx: c });
  const estab = notaEstabilidade({ fund: fii ? null : fund, risco });
  const indicacao = indicar({ classe: fii ? 'fii' : 'acao', valor, estab, fund, risco, preco, ctx: c });
  const aviso = risco?.saltos > 0 ? AVISO_SALTOS : null;
  if (aviso) indicacao.motivos = [...indicacao.motivos, aviso];
  const limites = risco ? { barato: risco.limBarato, caro: risco.limCaro } : null; // sem a série: limites do workflow
  const faixa = faixaPreco({ classe: fii ? 'fii' : 'acao', preco, precos5a, limites, valor: fii ? valor.pvp : valor.ms });
  return { valor, estab, estabSetor: ctx.estabSetor?.[chaveSetor] ?? null, indicacao, faixa, aviso };
}
