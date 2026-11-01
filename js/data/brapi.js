// Cliente da brapi (chamado direto do navegador; CORS liberado). Token opcional, vai no cabeçalho.
import { comCache } from './cache.js';
import { token } from './store.js';

const BASE = 'https://brapi.dev/api';

export class ApiError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.status = status; this.code = code; }
}

// Plano grátis permite 1 requisição simultânea: fila simples.
let fila = Promise.resolve();
function emFila(fn) { const p = fila.then(fn, fn); fila = p.catch(() => {}); return p; }

async function get(path) {
  return emFila(async () => {
    const t = token.get();
    let r;
    try { r = await fetch(BASE + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} }); }
    catch { throw new ApiError('Sem conexão com a brapi.', { code: 'OFFLINE' }); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(body.message || `Erro ${r.status} na brapi.`, { status: r.status, code: body.code });
    return body;
  });
}

const tipoDe = (s) => (s.type === 'stock' ? 'acao' : s.subType === 'fii' ? 'fii' : s.type === 'fund' ? 'fundo' : s.type);

/** Normaliza um item de /quote/list. */
export function normalizarLista(s) {
  return {
    codigo: s.stock, nome: s.name, preco: s.close, varDia: s.change, volume: s.volume,
    valorMercado: s.market_cap, setor: s.sector, subsetor: s.subsector, tipo: tipoDe(s), logo: s.logo,
  };
}

/** Todas as ações e FIIs da B3 numa chamada (ou duas). Preço e variação já vêm junto. */
export function listarAtivos({ ttlMs, agora } = {}) {
  return comCache('brapi:lista:v2', ttlMs ?? 60_000, async () => {
    const out = [];
    for (let page = 1; ; page++) {
      const b = await get(`/quote/list?limit=2000&page=${page}`);
      out.push(...b.stocks.map(normalizarLista));
      if (!b.hasNextPage) break;
    }
    // só ações e FIIs, nada de BDR, ETF, fundos de outras classes nem mercado fracionário (código termina em número + F)
    return out.filter((a) => (a.tipo === 'acao' || a.tipo === 'fii') && !/\dF$/.test(a.codigo));
  }, agora);
}

/** Cotação de um ativo (o plano grátis só aceita 1 ticker). */
export function cotacao(codigo, { ttlMs, agora } = {}) {
  return comCache(`brapi:q:${codigo}`, ttlMs ?? 60_000, async () => {
    const b = await get(`/quote/${encodeURIComponent(codigo)}?modules=summaryProfile`);
    return b.results[0];
  }, agora);
}

/** Histórico diário (grátis: até 3 meses). */
export function historico(codigo, range = '3mo', { agora } = {}) {
  const DIA = 24 * 3600_000;
  return comCache(`brapi:h:${codigo}:${range}`, DIA, async () => {
    const b = await get(`/quote/${encodeURIComponent(codigo)}?range=${range}&interval=1d`);
    return b.results[0].historicalDataPrice ?? [];
  }, agora);
}

/** Hora da cotação mais recente da lista, para o estado "atrasado". */
export const horaCotacao = (q) => (q?.regularMarketTime ? new Date(q.regularMarketTime) : null);
