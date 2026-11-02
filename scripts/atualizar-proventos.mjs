// Gera dados/proventos.json: dividendos, JCP e rendimentos (B3) e eventos em ações (desdobramento, grupamento,
// bonificação) de cada ação e FII. Também guarda o número de ações/cotas da B3, para conferir com a CVM.
// Uso: node scripts/atualizar-proventos.mjs   (Node 22, sem dependências; ZIP via `unzip` do sistema)
//
// Fontes (verificadas na sondagem de 02/11/2026):
//  - B3, página pública de empresas listadas: listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/{base64}
//    ({"issuingCompany":"PETR","language":"pt-br"}) e, para FII, fundsProxy/fundsCall/GetListedSupplementFunds/{base64}
//    ({"typeFund":7,"cnpj":"0","identifierFund":"HGLG"}). Devolvem cashDividends (cerca dos últimos 12 meses),
//    stockDividends (histórico inteiro) e o número de ações/cotas. Endpoint do próprio site da B3, sem documentação
//    oficial: uma consulta por emissor por dia, em sequência.
//  - COTAHIST mensal da B3: liga o ISIN (que a B3 usa nos proventos) ao código de negociação.
// A B3 só devolve ~12 meses de proventos: o histórico mais longo se acumula com o arquivo anterior (juntarHistorico).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const B3 = 'https://sistemaswebb3-listados.b3.com.br';
const URL_EMPRESA = (c) => `${B3}/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${b64({ issuingCompany: c, language: 'pt-br' })}`;
const URL_FII = (c) => `${B3}/fundsProxy/fundsCall/GetListedSupplementFunds/${b64({ typeFund: 7, cnpj: '0', identifierFund: c })}`;
const COTAHIST_M = (mm, ano) => `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M${mm}${ano}.ZIP`;
const ANOS_HIST = 5; // proventos guardados
const ANOS_EVENTOS = 6; // eventos em ações: cobre a janela de 5 anos dos preços com folga
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');

// ---------- funções puras ----------

/** "0,47156696000" ou "7.442.231.382" -> número; vazio -> null. */
export function numBr(s) {
  if (s == null || String(s).trim() === '') return null;
  const x = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
}

/** "21/08/2026" -> "2026-08-21"; datas inválidas ou de preenchimento (31/12/9999) -> null. */
export function dataBr(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? ''));
  if (!m || Number(m[3]) < 1990 || Number(m[3]) > 2100) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Só o que é renda do acionista entra (DY): dividendo, JCP e rendimento de FII. Amortização e outros: null. */
export function tipoProvento(label) {
  const l = String(label ?? '').toUpperCase();
  if (l.startsWith('DIVIDENDO')) return 'DIV';
  if (l.startsWith('JRS CAP') || l.includes('JUROS')) return 'JCP';
  if (l.startsWith('RENDIMENTO')) return 'REND';
  return null;
}

/** Multiplicador de quantidade do evento: desdobramento e bonificação = 1 + fator/100; grupamento = fator. */
export function fatorEvento(e) {
  const f = numBr(e?.factor), l = String(e?.label ?? '').toUpperCase();
  if (!(f > 0)) return null;
  if (l.startsWith('DESDOBRAMENTO') || l.startsWith('BONIFICACAO')) return Math.round((1 + f / 100) * 1e8) / 1e8;
  if (l.startsWith('GRUPAMENTO')) return f;
  return null;
}

/** COTAHIST (largura fixa) -> Map ISIN -> { ticker, fii } de ações de lote padrão (BDI 02) e FII (BDI 12), à vista. */
export function lerCotahistIsin(texto, mapa = new Map()) {
  for (const l of texto.split(/\r?\n/)) {
    if (l.length < 242 || l.slice(0, 2) !== '01' || l.slice(24, 27) !== '010') continue;
    const bdi = l.slice(10, 12), t = l.slice(12, 24).trim(), isin = l.slice(230, 242).trim();
    if (!isin) continue;
    if (bdi === '02' && /^[A-Z]{4}(3|4|5|6|11)$/.test(t)) mapa.set(isin, { ticker: t, fii: false });
    else if (bdi === '12' && /^[A-Z]{4}\d{2}$/.test(t)) mapa.set(isin, { ticker: t, fii: true });
  }
  return mapa;
}

const anosAntes = (hoje, n) => `${Number(hoje.slice(0, 4)) - n}${hoje.slice(4)}`;
const desc = (a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0);

/**
 * Resposta da B3 de um emissor -> { TICKER: { p: [[dataCom, pagamento, valor, tipo]], ev: [[dataCom, fator, rótulo]] } }.
 * isinTicker: Map ISIN -> ticker (ou { ticker }). Valores em reais por ação/cota; mais recente primeiro.
 */
export function montarAtivos(resp, isinTicker, hoje) {
  const out = {}, tk = (isin) => { const v = isinTicker.get(isin); return typeof v === 'string' ? v : v?.ticker; };
  const de = (t) => (out[t] ??= { p: [], ev: [] });
  for (const c of resp?.cashDividends ?? []) {
    const t = tk(c.isinCode), tipo = tipoProvento(c.label), data = dataBr(c.lastDatePrior), v = numBr(c.rate);
    if (!t || !tipo || !data || !(v > 0)) continue;
    de(t).p.push([data, dataBr(c.paymentDate) ?? '', v, tipo]);
  }
  const corte = anosAntes(hoje, ANOS_EVENTOS);
  for (const e of resp?.stockDividends ?? []) {
    const t = tk(e.isinCode), data = dataBr(e.lastDatePrior), f = fatorEvento(e);
    if (!t || !data || f == null || data < corte) continue;
    de(t).ev.push([data, f, String(e.label).toUpperCase()]);
  }
  for (const v of Object.values(out)) { v.p.sort(desc); v.ev.sort(desc); }
  return out;
}

/** Soma dos proventos com data com nos últimos 365 dias (até hoje). */
export function soma12m(p, hoje) {
  const ini = new Date(`${hoje}T00:00:00Z`); ini.setUTCDate(ini.getUTCDate() - 365);
  const de = ini.toISOString().slice(0, 10);
  return Math.round(p.filter(([d]) => d > de && d <= hoje).reduce((s, [, , v]) => s + v, 0) * 1e8) / 1e8;
}

/** Junta os proventos novos com os do arquivo anterior (sem duplicar) e guarda só os últimos 5 anos. */
export function juntarHistorico(novo, velho = [], hoje) {
  const corte = anosAntes(hoje, ANOS_HIST), vistos = new Set(), out = [];
  for (const x of [...novo, ...velho]) {
    const k = x.join('|');
    if (vistos.has(k) || x[0] < corte) continue;
    vistos.add(k); out.push(x);
  }
  return out.sort(desc);
}

/** Número de ações (empresa) ou de cotas (FII) informado pela B3. */
export function acoesDoEmissor(resp) {
  if (resp?.quantity != null) return { cotas: numBr(resp.quantity) };
  return { on: numBr(resp?.numberCommonShares), pn: numBr(resp?.numberPreferredShares), total: numBr(resp?.totalNumberShares) };
}

// ---------- E/S ----------

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (app-investimentos; dados diarios)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      return Array.isArray(j) ? j[0] : j;
    } catch (e) {
      if (i === 3) throw e;
      await espera(1000 * i);
    }
  }
}

export async function gerar({ hoje = new Date(), anterior = null } = {}) {
  const dia = hoje.toISOString().slice(0, 10);
  const tmp = mkdtempSync(join(tmpdir(), 'prov-'));
  try {
    // ISIN -> ticker: COTAHIST do mês atual e dos 2 anteriores (papel pouco negociado pode faltar num mês)
    const isinTicker = new Map();
    for (const k of [2, 1, 0]) {
      const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - k, 1));
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0'), z = join(tmp, `c${k}.zip`);
      const r = await fetch(COTAHIST_M(mm, d.getUTCFullYear()));
      if (!r.ok) { console.warn(`aviso: COTAHIST ${mm}/${d.getUTCFullYear()} indisponível`); continue; }
      writeFileSync(z, Buffer.from(await r.arrayBuffer()));
      lerCotahistIsin(execFileSync('unzip', ['-p', z], { maxBuffer: 1 << 30 }).toString('latin1'), isinTicker);
    }
    if (!isinTicker.size) throw new Error('COTAHIST indisponível: sem como ligar ISIN ao ticker');

    // emissores: 4 primeiras letras do ticker (PETR3/PETR4 -> PETR; HGLG11 -> HGLG)
    const emissores = new Map();
    for (const { ticker, fii } of isinTicker.values()) emissores.set(`${fii ? 'F' : 'E'}:${ticker.slice(0, 4)}`, { codigo: ticker.slice(0, 4), fii });

    const ativos = {}, quantidades = {};
    let ok = 0, falhas = 0;
    for (const { codigo, fii } of [...emissores.values()].sort((a, b) => a.codigo.localeCompare(b.codigo))) {
      try {
        const resp = await getJson(fii ? URL_FII(codigo) : URL_EMPRESA(codigo));
        if (!resp) { falhas++; continue; }
        ok++;
        quantidades[codigo] = { ...quantidades[codigo], ...acoesDoEmissor(resp) };
        Object.assign(ativos, montarAtivos(resp, isinTicker, dia));
      } catch { falhas++; }
      await espera(120); // uma consulta por vez, com folga
    }
    if (ok < emissores.size * 0.5) throw new Error(`B3 respondeu só ${ok} de ${emissores.size} emissores`);

    // acumula o histórico com o arquivo anterior e calcula a soma de 12 meses
    const velhos = anterior?.ativos ?? {};
    for (const t of new Set([...Object.keys(ativos), ...Object.keys(velhos)])) {
      const n = ativos[t] ?? { p: [], ev: velhos[t]?.ev ?? [] };
      n.p = juntarHistorico(n.p, velhos[t]?.p ?? [], dia);
      if (!n.p.length && !n.ev.length) { delete ativos[t]; continue; }
      ativos[t] = { soma12m: soma12m(n.p, dia), p: n.p, ev: n.ev };
    }
    const ord = Object.fromEntries(Object.entries(ativos).sort(([a], [b]) => (a < b ? -1 : 1)));
    return { versao: 1, geradoEm: hoje.toISOString(), dataBase: dia, ativos: ord, quantidades, _stats: { emissores: emissores.size, ok, falhas } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Um ativo por linha: arquivo pequeno e diff legível. */
export function serializar(o) {
  const linhas = (obj) => Object.entries(obj).map(([t, v]) => `  ${JSON.stringify(t)}: ${JSON.stringify(v)}`).join(',\n');
  return `{\n "versao": ${o.versao},\n "geradoEm": ${JSON.stringify(o.geradoEm)},\n "dataBase": ${JSON.stringify(o.dataBase)},\n "ativos": {\n${linhas(o.ativos)}\n },\n "quantidades": {\n${linhas(o.quantidades)}\n }\n}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..'), arq = join(raiz, 'dados', 'proventos.json');
  let anterior = null;
  try { anterior = existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : null; } catch { /* arquivo anterior corrompido: começa do zero */ }
  const r = await gerar({ anterior });
  mkdirSync(join(raiz, 'dados'), { recursive: true });
  writeFileSync(arq, serializar(r));
  const v = Object.values(r.ativos);
  console.log(`emissores: ${r._stats.emissores} (ok ${r._stats.ok}, falhas ${r._stats.falhas}); ativos com proventos 12m: ${v.filter((x) => x.soma12m > 0).length}; com eventos em ações: ${v.filter((x) => x.ev.length).length}`);
}
