// Dados da análise gerados pelo workflow: dados/{fundamentos,fiis,risco,meta}.json e dados/precos/{T}.json.
// Mesma origem do index.html (URL relativa). Cache de 6 h. O app abre normalmente sem esses arquivos.
import { comCache } from './cache.js';

const TTL = 6 * 3600_000;

class Ausente extends Error {}

// Devolve { data, savedAt, stale } | { ausente:true } | { erro:Error, offline:boolean }.
// Arquivo ausente (404 ou página HTML no lugar do JSON) não é erro: é só "ainda não gerado".
async function carregar(caminho) {
  const r = await comCache(`dados:${caminho}`, TTL, async () => {
    const res = await fetch(new URL(`dados/${caminho}`, document.baseURI), { cache: 'no-cache' });
    if (res.status === 404) throw new Ausente();
    if (!res.ok) throw new Error(`Erro ${res.status} ao ler ${caminho}`);
    try { return await res.json(); } catch { throw new Ausente(); }
  });
  if (r.data) return { data: r.data, savedAt: r.savedAt, stale: r.stale };
  if (r.error instanceof Ausente) return { ausente: true };
  return { erro: r.error, offline: r.error instanceof TypeError || navigator.onLine === false };
}

// uma leitura por sessão e arquivo; falhas não ficam gravadas (a próxima abertura tenta de novo)
const memo = new Map();
function unico(caminho) {
  if (!memo.has(caminho)) {
    const p = carregar(caminho).then((r) => { if (r.erro) memo.delete(caminho); return r; });
    memo.set(caminho, p);
  }
  return memo.get(caminho);
}

/** Os quatro arquivos de uma vez: { fundamentos, fiis, risco, meta }, cada um no formato de carregar(). */
export async function carregarDados() {
  const [fundamentos, fiis, risco, meta] = await Promise.all(['fundamentos', 'fiis', 'risco', 'meta'].map((n) => unico(`${n}.json`)));
  return { fundamentos, fiis, risco, meta };
}

/** Série de preços de 5 anos de um ticker: data = { t, d:[AAAAMMDD], p:[centavos] }. */
export const carregarPrecos = (ticker) => unico(`precos/${encodeURIComponent(ticker)}.json`);
