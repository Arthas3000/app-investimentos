// Feriados nacionais (BrasilAPI, CORS liberado). Cache de 30 dias por ano.
import { comCache } from './cache.js';

/** @returns {Promise<{data:string[], stale:boolean, error:Error|null, savedAt:number|null}>} datas 'AAAA-MM-DD' */
export function feriados(ano, { agora } = {}) {
  return comCache(`feriados:${ano}`, 30 * 24 * 3600_000, async () => {
    const r = await fetch(`https://brasilapi.com.br/api/feriados/v1/${ano}`);
    if (!r.ok) throw new Error(`BrasilAPI respondeu ${r.status}`);
    return (await r.json()).map((f) => f.date);
  }, agora);
}
