// Confere dados entre fontes oficiais independentes e gera dados/conferencia.json. Roda depois dos coletores.
// Uso: node scripts/conferir-fontes.mjs   (Node 22, sem dependências)
//
// A fonte primária continua valendo; a conferência só marca divergência para o app avisar no dado:
//  - Rendimento mensal de FII: CVM (informe mensal, DY × VPA) x B3 (proventos do fundo), últimos 6 meses.
//  - Número de ações: CVM (composição do capital, em circulação) x B3 (total, inclui tesouraria).
//  - IPCA mensal: Banco Central (SGS 433) x IBGE (SIDRA, tabela 1737, variável 63), últimos 12 meses.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOL_REND = 0.05, TOL_ACOES = 0.05, MESES_FII = 6;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const mesIdx = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * fii: { rendMensal (R$, mais recente primeiro), dataBase 'AAAA-MM-01' } (fiis.json). p: proventos B3 do ticker.
 * Cada mês M da CVM casa com um rendimento da B3 com data com em M ou M+1. Divergente = diferença > 5%.
 * ok = false quando mais da metade dos meses comparados diverge. null sem o que comparar.
 */
export function conferirFii(fii, p) {
  if (!fii?.rendMensal || !fii.dataBase || !p?.length) return null;
  const rend = p.filter((x) => x[3] === 'REND');
  const base = mesIdx(fii.dataBase);
  let comparados = 0, divergentes = 0, maxDif = 0;
  for (let i = 0; i < Math.min(MESES_FII, fii.rendMensal.length); i++) {
    const cvm = fii.rendMensal[i];
    if (!(cvm > 0)) continue;
    const m = base - i;
    const cand = rend.filter((x) => mesIdx(x[0]) === m || mesIdx(x[0]) === m + 1).map((x) => x[2]);
    if (!cand.length) continue;
    const dif = Math.min(...cand.map((v) => Math.abs(v - cvm) / cvm));
    comparados++;
    if (dif > TOL_REND) divergentes++;
    maxDif = Math.max(maxDif, dif);
  }
  if (!comparados) return null;
  return { comparados, divergentes, maxDif: r4(maxDif), ok: divergentes * 2 <= comparados };
}

/** acoesCvm: ações em circulação (CVM); qtd: { total } da B3. null se faltar um lado ou for FII. */
export function conferirAcoes(acoesCvm, qtd) {
  if (!(acoesCvm > 0) || !(qtd?.total > 0)) return null;
  const dif = r4(Math.abs(qtd.total - acoesCvm) / qtd.total);
  return { cvm: Math.round(acoesCvm), b3: qtd.total, dif, ok: dif <= TOL_ACOES };
}

/** bcb: [{ data:'01/MM/AAAA', valor:'0.07' }]; ibge: linhas do SIDRA [{ D3C:'AAAAMM', V:'0.07' }]. */
export function conferirIpca(bcb, ibge) {
  const doIbge = new Map((ibge ?? []).filter((l) => /^\d{6}$/.test(l.D3C ?? '')).map((l) => [l.D3C, Number(l.V)]));
  let comparados = 0, divergentes = 0;
  for (const { data, valor } of bcb ?? []) {
    const k = `${data.slice(6, 10)}${data.slice(3, 5)}`;
    if (!doIbge.has(k)) continue;
    comparados++;
    if (Math.abs(doIbge.get(k) - Number(valor)) > 0.005) divergentes++;
  }
  return { comparados, divergentes, ok: comparados ? divergentes === 0 : null };
}

// ---------- E/S ----------

async function json(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

export async function conferir(dir, hoje = new Date()) {
  const ler = (n) => { try { return JSON.parse(readFileSync(join(dir, n), 'utf8')); } catch { return null; } };
  const fiis = ler('fiis.json')?.ativos ?? {}, fund = ler('fundamentos.json')?.ativos ?? {}, prov = ler('proventos.json');
  const out = { versao: 1, geradoEm: hoje.toISOString(), fiis: {}, acoes: {}, ipca: null };
  for (const [t, f] of Object.entries(fiis)) {
    const c = conferirFii(f, prov?.ativos?.[t]?.p);
    if (c) out.fiis[t] = c;
  }
  for (const [t, f] of Object.entries(fund)) {
    const c = conferirAcoes(f.acoes, prov?.quantidades?.[t.slice(0, 4)]);
    if (c) out.acoes[t] = c;
  }
  try {
    const [bcb, ibge] = await Promise.all([
      json('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/12?formato=json'),
      json('https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/last%2012'),
    ]);
    out.ipca = conferirIpca(bcb, ibge.slice(1));
  } catch (e) { console.warn(`aviso: IPCA não conferido (${e.message})`); }
  const conta = (o) => { const v = Object.values(o); return { conferidos: v.length, divergentes: v.filter((x) => !x.ok).length }; };
  out.resumo = { fiis: conta(out.fiis), acoes: conta(out.acoes), ipca: out.ipca };
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dados');
  const r = await conferir(dir);
  writeFileSync(join(dir, 'conferencia.json'), `${JSON.stringify(r)}\n`);
  console.log(`conferência: FIIs ${r.resumo.fiis.conferidos} (divergentes ${r.resumo.fiis.divergentes}); ações ${r.resumo.acoes.conferidos} (divergentes ${r.resumo.acoes.divergentes}); IPCA ${JSON.stringify(r.ipca)}`);
}
