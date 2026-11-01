// Banco Central SGS (CORS liberado, sem token). Séries: 12 = CDI diário (% a.d.), 433 = IPCA mensal (%).
import { comCache } from './cache.js';

export const SERIES = { cdi: 12, ipca: 433 };
const DIA = 24 * 3600_000;

// 'DD/MM/AAAA' -> 'AAAA-MM-DD'
const isoDe = (br) => br.split('/').reverse().join('-');

/** Últimos N pontos da série, como [{data:'AAAA-MM-DD', valor:number}]. Cache de 1 dia.
 *  Atenção: a API SGS limita séries diárias a 20 valores neste endpoint (400 acima disso); para períodos longos use `desde`. */
export function ultimos(serie, n = 30, { agora } = {}) {
  return comCache(`bcb:${serie}:u${n}`, DIA, async () => {
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/${n}?formato=json`);
    if (!r.ok) throw new Error(`BCB respondeu ${r.status}`);
    return (await r.json()).map((p) => ({ data: isoDe(p.data), valor: Number(p.valor) }));
  }, agora);
}

const brDe = (iso) => iso.split('-').reverse().join('/');

/** Pontos da série de `dataInicial` ('AAAA-MM-DD') até hoje (ou `agora`, ms), como [{data:'AAAA-MM-DD', valor:number}]. Cache de 1 dia. */
export function desde(serie, dataInicial, { agora } = {}) {
  const fim = new Date(agora ?? Date.now()).toISOString().slice(0, 10);
  return comCache(`bcb:${serie}:d${dataInicial}`, DIA, async () => {
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=${brDe(dataInicial)}&dataFinal=${brDe(fim)}`, { signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`BCB respondeu ${r.status}`);
    return (await r.json()).map((p) => ({ data: isoDe(p.data), valor: Number(p.valor) }));
  }, agora);
}
