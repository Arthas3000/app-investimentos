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
// Informe TRIMESTRAL (licença ODbL, CVM): imovel (vacância, inadimplência, parcela da receita por imóvel) e
// resultado_contabil_financeiro (resultado em caixa do trimestre e receita de venda de imóveis). Qualidade de crédito
// dos CRIs não existe em nenhum dos dois -> null.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CVM = (ano) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${ano}.zip`;
const CVM_TRI = (ano) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/inf_trimestral_fii_${ano}.zip`;
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
export function montarFii({ cnpj, nome, segmentoCvm, comp, ap, imoveis = [], resultado = [], rendB3 = null }) {
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
    ...rendimentos(rendimentosMensais(serie), rendB3),
    alavancagem: passivo != null && u.ativo > 0 ? arred(passivo / u.ativo, 6) : null,
    // do informe trimestral: FFO (aproximação), venda de imóveis, vacância, inadimplência e nº de imóveis de renda
    ...resumoTrimestral(imoveis, resultado, u.cotas),
    qualidadeCredito: null, // ponytail: o informe não traz rating dos CRIs
  };
}

// ---------- informe trimestral ----------

/** Percentual do informe como fração: aceita 0,1039 ou 10,39 (alguns fundos informam em %); fora de [0, 100] é null. */
export function fracao(s) {
  const x = num(s);
  if (x == null || x < 0 || x > 100) return null;
  return x > 1 ? x / 100 : x;
}

/**
 * Imóveis para renda acabados do trimestre mais recente de um fundo (linhas de inf_trimestral_fii_imovel).
 * Vacância e inadimplência ponderadas pela parcela da receita do fundo (Percentual_Receitas_FII); sem ela, pela área.
 */
export function resumoImoveis(linhas) {
  const vazio = { dataBase: null, nImoveis: null, vacancia: null, inadimplencia: null };
  const renda = linhas.filter((l) => /renda acabado/i.test(l.Classe ?? ''));
  if (!renda.length) return vazio;
  const dataBase = renda.reduce((m, l) => (l.Data_Referencia > m ? l.Data_Referencia : m), '');
  const u = renda.filter((l) => l.Data_Referencia === dataBase);
  const usaReceita = u.some((l) => (fracao(l.Percentual_Receitas_FII) ?? 0) > 0);
  const peso = (l) => (usaReceita ? fracao(l.Percentual_Receitas_FII) : num(l.Area)) ?? 0;
  const media = (campo) => {
    const v = u.map((l) => [fracao(l[campo]), peso(l)]).filter(([x, w]) => x != null && w > 0);
    const tw = v.reduce((a, [, w]) => a + w, 0);
    return tw > 0 ? arred(v.reduce((a, [x, w]) => a + x * w, 0) / tw, 6) : null;
  };
  return { dataBase, nImoveis: u.length, vacancia: media('Percentual_Vacancia'), inadimplencia: media('Percentual_Inadimplencia') };
}

const trimestreSeguinte = (d) => {
  const [a, m] = [Number(d.slice(0, 4)), Number(d.slice(5, 7))];
  return m === 12 ? `${a + 1}-03-31` : `${a}-${{ 3: '06-30', 6: '09-30', 9: '12-31' }[m]}`;
};

/**
 * Resultado dos últimos 4 trimestres seguidos de um fundo (linhas de inf_trimestral_fii_resultado_contabil_financeiro,
 * já na última versão). Colunas do trimestre (não acumuladas): Resultado_Trimestral_Liquido_Financeiro (caixa) e
 * Receita_Venda_Investimento_Financeiro. Aproximação de FFO (R$/cota, 12 meses) = soma do resultado em caixa menos
 * a receita de venda de imóveis, ÷ cotas. pctVendaImoveis = venda ÷ resultado (0 a 1).
 */
export function resumoResultado(linhas, cotas) {
  const nada = { dataBaseTri: null, ffo: null, pctVendaImoveis: null };
  const por = new Map(linhas.map((l) => [l.Data_Referencia, l]));
  const datas = [...por.keys()].sort();
  const u = datas.at(-1);
  if (!u || !(cotas > 0)) return nada;
  const q = [u]; // 4 trimestres seguidos terminando no mais recente
  while (q.length < 4) { const ant = datas.filter((d) => trimestreSeguinte(d) === q[0]); if (!ant.length) return nada; q.unshift(ant[0]); }
  const res = q.reduce((a, d) => a + (num(por.get(d).Resultado_Trimestral_Liquido_Financeiro) ?? 0), 0);
  const venda = q.reduce((a, d) => a + Math.max(0, num(por.get(d).Receita_Venda_Investimento_Financeiro) ?? 0), 0);
  return {
    dataBaseTri: u,
    ffo: arred((res - venda) / cotas, 4),
    pctVendaImoveis: res > 0 ? arred(Math.min(1, venda / res), 6) : null,
  };
}

// rend12m: soma dos rendimentos anunciados à B3 (por cota, data com nos últimos 12 meses) quando houver; o cálculo
// pelo informe mensal (DY × VPA) erra em fundo que emitiu cotas no período e fica como reserva e conferência.
function rendimentos(cvm, rendB3) {
  const b3 = typeof rendB3 === 'number' && rendB3 > 0;
  return { rendMensal: cvm.rendMensal, rend12m: b3 ? rendB3 : cvm.rend12m, rend12mCvm: cvm.rend12m, fonteRend: b3 ? 'B3' : 'CVM' };
}

function resumoTrimestral(imoveis, resultado, cotas) {
  const im = resumoImoveis(imoveis), rs = resumoResultado(resultado, cotas);
  return { ffo: rs.ffo, pctVendaImoveis: rs.pctVendaImoveis, vacancia: im.vacancia, inadimplencia: im.inadimplencia, nImoveis: im.nImoveis, dataBaseTri: rs.dataBaseTri ?? im.dataBase };
}

// ---------- E/S ----------

const lerZip = (zip, membro) => execFileSync('unzip', ['-p', zip, membro], { maxBuffer: 1 << 30 }).toString('latin1');

async function baixar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) return false;
  writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
  return true;
}

export async function gerar(hoje = new Date(), proventos = null) {
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

    // informe trimestral (imóveis e resultado): falha aqui não derruba o arquivo, os campos ficam null
    const imovel = [], resultado = [];
    for (const a of [ano, ano - 1]) {
      const z = join(tmp, `t${a}.zip`);
      if (!(await baixar(CVM_TRI(a), z))) { console.warn(`aviso: informe trimestral ${a} indisponível`); continue; }
      try {
        imovel.push(...lerCsv(lerZip(z, `inf_trimestral_fii_imovel_${a}.csv`)));
        resultado.push(...lerCsv(lerZip(z, `inf_trimestral_fii_resultado_contabil_financeiro_${a}.csv`)));
      } catch (e) { console.warn(`aviso: informe trimestral ${a} ilegível: ${e.message}`); }
    }

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
    // imóvel: várias linhas por fundo e trimestre (uma por imóvel); fica a maior versão de cada trimestre
    const maxVer = new Map();
    for (const l of imovel) { const k = `${l.CNPJ_Fundo_Classe}|${l.Data_Referencia}`; maxVer.set(k, Math.max(maxVer.get(k) ?? 0, Number(l.Versao) || 0)); }
    const imovelPor = por(imovel.filter((l) => (Number(l.Versao) || 0) === maxVer.get(`${l.CNPJ_Fundo_Classe}|${l.Data_Referencia}`)));
    const resPor = por(ultimaVersao(resultado));
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
      const f = montarFii({ cnpj, nome: l.Nome_Fundo_Classe, segmentoCvm: l.Segmento_Atuacao, comp: compPor.get(cnpj) ?? [], ap: apPor.get(cnpj) ?? [], imoveis: imovelPor.get(cnpj) ?? [], resultado: resPor.get(cnpj) ?? [], rendB3: proventos?.[ticker]?.soma12m ?? null });
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
  // rendimentos anunciados à B3 (dados/proventos.json, gerado antes pelo orquestrador); sem ele, vale a CVM
  let proventos = null;
  try { proventos = JSON.parse(readFileSync(join(raiz, 'dados', 'proventos.json'), 'utf8')).ativos; } catch { console.warn('aviso: sem dados/proventos.json, rend12m vem só da CVM'); }
  const r = await gerar(new Date(), proventos);
  mkdirSync(join(raiz, 'dados'), { recursive: true });
  writeFileSync(join(raiz, 'dados', 'fiis.json'), serializar(r));
  const v = Object.values(r.ativos);
  console.log(`FIIs com ticker: ${v.length} (fundos com ISIN no informe: ${r._stats.fundosComIsin}; tickers FII no COTAHIST: ${r._stats.tickersCotahist})`);
  console.log(`rendimento da B3: ${v.filter((x) => x.fonteRend === 'B3').length}; com rend12m: ${v.filter((x) => x.rend12m != null).length}; com segmento: ${v.filter((x) => x.segmento).length}; com alavancagem: ${v.filter((x) => x.alavancagem != null).length}`);
  console.log(`do trimestral: ffo ${v.filter((x) => x.ffo != null).length}; vacância ${v.filter((x) => x.vacancia != null).length}; nº de imóveis ${v.filter((x) => x.nImoveis != null).length}; venda de imóveis ${v.filter((x) => x.pctVendaImoveis != null).length}`);
}
