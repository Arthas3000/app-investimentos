// Gera dados/fiis.json a partir do informe mensal de FII da CVM + COTAHIST (só para ligar CNPJ ao ticker).
// Node 22, sem dependências. ZIP via `unzip` do sistema. Uso: node scripts/atualizar-fiis.mjs
//
// Ligação CNPJ -> ticker (investigada, ver relatório): o informe "geral" traz Codigo_ISIN do fundo; o COTAHIST
// traz CODNEG + CODISI de cada papel (CODBDI 12 = fundos imobiliários). Juntar por ISIN é exato e gratuito.
// O cadastro de FII da CVM (dados.cvm.gov.br/dados/FII/CAD) não existe (404) e o informe não traz o ticker.
//
// Campos do informe usados:
//  geral:        CNPJ_Fundo_Classe, Data_Referencia, Versao, Nome_Fundo_Classe, Segmento_Atuacao, Codigo_ISIN
//  complemento:  Valor_Ativo, Cotas_Emitidas, Valor_Patrimonial_Cotas, Percentual_Dividend_Yield_Mes,
//                Percentual_Rentabilidade_Patrimonial_Mes
//  ativo_passivo: Total_Passivo, Total_Investido e a composição dos ativos (imóveis, CRI, LCI, ...)
// NÃO vêm no informe mensal: FFO, vacância, nº de imóveis, qualidade de crédito, venda de imóveis -> null.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CVM = (ano) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${ano}.zip`;
const COTAHIST_M = (mm, ano) => `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_M${mm}${ano}.ZIP`;
const DY_MAX = 0.2; // ponytail: DY mensal > 20% é erro de preenchimento (ex.: informado em %); mês vira null

// ---------- funções puras ----------

/** CSV da CVM (separador ';', sem aspas, CRLF) -> lista de objetos {coluna: texto}. */
export function lerCsv(texto) {
  const linhas = texto.split(/\r?\n/).filter(Boolean);
  const cab = linhas[0].split(';');
  return linhas.slice(1).map((l) => {
    const c = l.split(';');
    const o = {};
    cab.forEach((k, i) => { o[k] = c[i] ?? ''; });
    return o;
  });
}

const num = (s) => (s === '' || s == null || Number.isNaN(Number(s)) ? null : Number(s));
const arred = (x, n) => (x == null ? null : Number(x.toFixed(n)));

/** O informe é reenviado com Versao maior quando corrigido: fica a maior versão de cada (CNPJ, mês). */
export function ultimaVersao(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const k = `${l.CNPJ_Fundo_Classe}|${l.Data_Referencia}`;
    const v = Number(l.Versao) || 0;
    const a = m.get(k);
    if (!a || v >= a.v) m.set(k, { v, l });
  }
  return [...m.values()].map((x) => x.l);
}

/** COTAHIST (largura fixa) -> Map ISIN -> ticker, só FII (CODBDI 12, mercado à vista 010, ticker XXXX11). */
export function lerCotahistFii(texto, mapa = new Map()) {
  for (const l of texto.split('\n')) {
    if (!l.startsWith('01')) continue;
    if (l.slice(10, 12) !== '12' || l.slice(24, 27) !== '010') continue;
    const t = l.slice(12, 24).trim();
    const isin = l.slice(230, 242).trim();
    if (isin && /^[A-Z]{4}11$/.test(t)) mapa.set(isin, t);
  }
  return mapa;
}

/** 'YYYY-MM-01' -> índice de mês corrido (para achar meses consecutivos). */
const idxMes = (d) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

/**
 * Rendimento por cota (R$) de cada um dos últimos 12 meses, mais recente primeiro.
 * Percentual_Dividend_Yield_Mes = rendimento / VPA do mês anterior (conferido: Efetiva = DY + Patrimonial, e
 * Patrimonial = ΔVPA / VPA anterior), logo rendimento = DY × VPA(mês-1). Sem o mês anterior no informe,
 * VPA(mês-1) = VPA / (1 + Patrimonial). Mês sem dado ou com DY absurdo = null.
 * `serie`: [{ data:'YYYY-MM-01', vpa, dy, pat }]. Devolve { rendMensal, rend12m } (rend12m null se faltar mês).
 */
export function rendimentosMensais(serie) {
  const porMes = new Map(serie.map((s) => [idxMes(s.data), s]));
  const ultimo = Math.max(...porMes.keys());
  const rendMensal = [];
  for (let i = 0; i < 12; i++) {
    const s = porMes.get(ultimo - i);
    let r = null;
    if (s && s.dy != null && s.dy >= 0 && s.dy <= DY_MAX) {
      const ant = porMes.get(ultimo - i - 1)?.vpa ?? (s.vpa != null && s.pat != null ? s.vpa / (1 + s.pat) : null);
      if (ant != null && ant > 0) r = arred(s.dy * ant, 4);
    }
    rendMensal.push(r);
  }
  // ponytail: exige os 12 meses; com 1 mês faltando o 12m ficaria subestimado, então fica null
  const rend12m = rendMensal.every((x) => x != null) ? arred(rendMensal.reduce((a, b) => a + b, 0), 4) : null;
  return { rendMensal, rend12m };
}

const CAMPOS_IMOVEL = ['Direitos_Bens_Imoveis', 'Acoes_Sociedades_Atividades_FII', 'Cotas_Sociedades_Atividades_FII'];
const CAMPOS_PAPEL = ['CRI', 'CRI_CRA', 'LCI', 'LCI_LCA', 'Letras_Hipotecarias', 'LIG', 'Debentures', 'Cedulas_Debentures', 'Notas_Promissorias'];
const soma = (l, campos) => campos.reduce((a, k) => a + (num(l[k]) ?? 0), 0);

/** Mix de ativos do informe (linha de ativo_passivo): tijolo, papel ou híbrido; null sem Total_Investido. */
export function classificarSegmento(ap, corte = 0.6) {
  const base = num(ap.Total_Investido);
  if (!base || base <= 0) return null;
  const imov = soma(ap, CAMPOS_IMOVEL) / base;
  const papel = soma(ap, CAMPOS_PAPEL) / base;
  if (imov >= corte) return 'tijolo';
  if (papel >= corte) return 'papel';
  // ponytail: fundo de fundos (cotas de FII) e mistos caem em "hibrido"; Segmento_Atuacao da CVM segue em segmentoCvm
  return 'hibrido';
}

/** Monta o registro de um fundo. comp = linhas de complemento do CNPJ; ap = linhas de ativo_passivo do CNPJ. */
export function montarFii({ cnpj, nome, segmentoCvm, comp, ap }) {
  const serie = comp
    .map((l) => ({
      data: l.Data_Referencia,
      vpa: num(l.Valor_Patrimonial_Cotas),
      dy: num(l.Percentual_Dividend_Yield_Mes),
      pat: num(l.Percentual_Rentabilidade_Patrimonial_Mes),
      ativo: num(l.Valor_Ativo),
      cotas: num(l.Cotas_Emitidas),
    }))
    .filter((s) => s.vpa != null && s.vpa > 0)
    .sort((a, b) => (a.data < b.data ? -1 : 1));
  if (!serie.length) return null;
  const u = serie[serie.length - 1];
  const apU = ap.find((l) => l.Data_Referencia === u.data);
  const passivo = apU ? num(apU.Total_Passivo) : null;
  return {
    cnpj,
    nome,
    segmento: apU ? classificarSegmento(apU) : null,
    segmentoCvm: segmentoCvm || null,
    dataBase: u.data,
    vpa: arred(u.vpa, 4),
    cotas: u.cotas,
    ...rendimentosMensais(serie),
    alavancagem: passivo != null && u.ativo > 0 ? arred(passivo / u.ativo, 6) : null,
    ffo: null,
    vacancia: null,
    nImoveis: null,
    pctVendaImoveis: null,
    qualidadeCredito: null,
  };
}

// ---------- E/S ----------

const lerZip = (zip, membro) => execFileSync('unzip', ['-p', zip, membro], { maxBuffer: 1 << 30 }).toString('latin1');

async function baixar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) return false;
  writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  return true;
}

export async function gerar(hoje = new Date()) {
  const tmp = mkdtempSync(join(tmpdir(), 'fiis-'));
  try {
    const ano = hoje.getUTCFullYear();
    const geral = [], comp = [], ap = [];
    let anosOk = 0;
    for (const a of [ano, ano - 1]) { // últimos 2 anos; o ano corrente pode ainda não existir em janeiro
      const z = join(tmp, `i${a}.zip`);
      if (!(await baixar(CVM(a), z))) { console.warn(`aviso: informe ${a} indisponível`); continue; }
      anosOk++;
      geral.push(...lerCsv(lerZip(z, `inf_mensal_fii_geral_${a}.csv`)));
      comp.push(...lerCsv(lerZip(z, `inf_mensal_fii_complemento_${a}.csv`)));
      ap.push(...lerCsv(lerZip(z, `inf_mensal_fii_ativo_passivo_${a}.csv`)));
    }
    if (!anosOk) throw new Error('nenhum informe da CVM baixado');

    // tickers: COTAHIST do mês atual e dos 2 anteriores (FII ilíquido pode não negociar no mês)
    const isinTicker = new Map();
    for (const k of [0, 1, 2]) {
      const d = new Date(Date.UTC(ano, hoje.getUTCMonth() - k, 1));
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const z = join(tmp, `c${k}.zip`);
      if (!(await baixar(COTAHIST_M(mm, d.getUTCFullYear()), z))) { console.warn(`aviso: COTAHIST ${mm}/${d.getUTCFullYear()} indisponível`); continue; }
      lerCotahistFii(execFileSync('unzip', ['-p', z], { maxBuffer: 1 << 30 }).toString('latin1'), isinTicker);
    }
    if (!isinTicker.size) throw new Error('COTAHIST indisponível: sem como ligar CNPJ ao ticker');

    const g = ultimaVersao(geral), c = ultimaVersao(comp), p = ultimaVersao(ap);
    const por = (linhas) => { const m = new Map(); for (const l of linhas) (m.get(l.CNPJ_Fundo_Classe) ?? m.set(l.CNPJ_Fundo_Classe, []).get(l.CNPJ_Fundo_Classe)).push(l); return m; };
    const compPor = por(c), apPor = por(p);
    // por CNPJ: linha mais recente do geral com ISIN
    const cad = new Map();
    for (const l of g) {
      if (!l.Codigo_ISIN) continue;
      const a = cad.get(l.CNPJ_Fundo_Classe);
      if (!a || l.Data_Referencia > a.Data_Referencia) cad.set(l.CNPJ_Fundo_Classe, l);
    }

    const ativos = {};
    for (const [cnpj, l] of cad) {
      const ticker = isinTicker.get(l.Codigo_ISIN);
      if (!ticker) continue;
      const f = montarFii({ cnpj, nome: l.Nome_Fundo_Classe, segmentoCvm: l.Segmento_Atuacao, comp: compPor.get(cnpj) ?? [], ap: apPor.get(cnpj) ?? [] });
      if (!f) continue;
      if (!ativos[ticker] || f.dataBase > ativos[ticker].dataBase) ativos[ticker] = f; // ponytail: 2 CNPJs no mesmo ticker -> o informe mais novo
    }
    const ord = Object.fromEntries(Object.entries(ativos).sort(([a], [b]) => (a < b ? -1 : 1)));
    return { versao: 1, geradoEm: hoje.toISOString(), ativos: ord, _stats: { fundosComIsin: cad.size, tickersCotahist: isinTicker.size } };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Um ativo por linha: arquivo pequeno e diff legível. */
export function serializar(o) {
  const linhas = Object.entries(o.ativos).map(([t, v]) => `  ${JSON.stringify(t)}: ${JSON.stringify(v)}`);
  return `{\n "versao": ${o.versao},\n "geradoEm": ${JSON.stringify(o.geradoEm)},\n "ativos": {\n${linhas.join(',\n')}\n }\n}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
  const r = await gerar();
  mkdirSync(join(raiz, 'dados'), { recursive: true });
  writeFileSync(join(raiz, 'dados', 'fiis.json'), serializar(r));
  const v = Object.values(r.ativos);
  console.log(`FIIs com ticker: ${v.length} (fundos com ISIN no informe: ${r._stats.fundosComIsin}; tickers FII no COTAHIST: ${r._stats.tickersCotahist})`);
  console.log(`com rend12m: ${v.filter((x) => x.rend12m != null).length}; com segmento: ${v.filter((x) => x.segmento).length}; com alavancagem: ${v.filter((x) => x.alavancagem != null).length}`);
}
