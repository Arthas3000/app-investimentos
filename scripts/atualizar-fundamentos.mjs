// Gera dados/fundamentos.json a partir dos dados abertos da CVM (ITR, DFP, composição de capital e FCA).
// Node 22, sem dependências. ZIP via `unzip` do sistema. Uso:
//   node scripts/atualizar-fundamentos.mjs [--cache DIR] [--reusar]
// Sem --cache, baixa para uma pasta temporária e apaga no fim. Com --reusar, usa ZIPs já presentes em DIR.
//
// ============================== FÓRMULAS (copiar para o README) ==============================
// Fonte: demonstrações CONSOLIDADAS (_con), versão mais recente (VERSAO) de cada documento (CNPJ + DT_REFER).
// Valores em R$ (ESCALA_MOEDA MIL x 1000). Razões como fração (0,18 = 18%). Ausente = null.
//
// Trimestre isolado: DRE e DFC vêm acumulados no ano (ITR 2º/3º tri e DFP). Tri = acumulado(E) - acumulado(E-3m),
//   quando a CVM já traz o trimestre isolado usa-se ele. 4º tri = DFP (12m) - acumulado de 9m. Se faltar peça, null.
// LTM (12m) = soma dos 4 últimos trimestres (null se algum faltar).
// Lucro = lucro atribuído aos controladores (3.11.01; bancos 3.09.01); se não houver, lucro consolidado.
// PL = patrimônio líquido consolidado menos participação de não controladores ("PL controladora").
// roe12m  = lucro LTM / média(PL controladora em E, PL em E-12m)   (sem o PL de E-12m, usa só o de E). PL<=0 => null.
// roeTri  = lucro do último tri (NÃO anualizado) / média(PL em E, PL em E-3m). O modelo multiplica por 4.
// lucrosTri = lucro dos 8 últimos trimestres, mais recente primeiro (R$, null onde faltar).
// crescReceita12m = receita LTM / receita LTM de 4 trimestres antes - 1. Receita = conta 3.01
//   (bancos: receitas da intermediação financeira).
// EBIT = conta 3.05 (resultado antes do resultado financeiro e dos tributos). Não existe para bancos.
// EBITDA (APROXIMAÇÃO) = EBIT LTM + depreciação/amortização LTM da DFC método indireto (linhas 6.01.01.x cujo nome
//   cita depreciação, amortização, exaustão ou depleção; exclui custo de captação, juros, valor justo etc.).
//   DFC pelo método direto não traz D&A: EBITDA e DL/EBITDA ficam null. EBITDA <= 0 => dlEbitda null.
// Dívida bruta (APROXIMAÇÃO) = 2.01.04 + 2.02.01 (empréstimos, financiamentos, debêntures e arrendamentos, como a
//   CVM apresenta). Caixa = 1.01.01 + 1.01.02 (caixa e aplicações financeiras de curto prazo).
//   Dívida líquida = dívida bruta - caixa.
// dlEbitda = dívida líquida / EBITDA.   dlPl = dívida líquida / PL consolidado (com minoritários).
// liqCorrente = ativo circulante (1.01) / passivo circulante (2.01). Bancos: null (balanço não classificado).
// roic (APROXIMAÇÃO) = EBIT LTM x (1 - 34%) / (PL consolidado + dívida líquida), saldos do fim de E.
//   34% é a alíquota nominal de IR+CSLL; denominador <= 0 => null.
// vpa (APROXIMAÇÃO) = PL controladora / ações em circulação (total - tesouraria, composição de capital do mesmo
//   DT_REFER, ON + PN somadas). Não separa por classe. Units (ex. TAEE11): vpa x ações por unit, lida da
//   composição do FCA ("1 ON / 2 PN" = 3). Se não der para ler, vpa e lpa12m ficam null para a unit.
// lpa12m (APROXIMAÇÃO) = lucro LTM / as mesmas ações (usa a quantidade atual, não a média ponderada).
// payout, dy, cet1, inadimplencia: sem fonte na CVM (ITR/DFP) => sempre null.
//
// Bancos/financeiras (plano de contas próprio; detectado porque a conta 1.01 do ativo não é "Ativo Circulante",
//   o que também pega seguradoras): só roe, lucros, crescReceita12m, vpa e lpa12m; EBIT, dívida, liquidez e ROIC = null.
//
// Cadastro (FCA, valor_mobiliario): CNPJ -> tickers. Entram ações ON/PN e units negociadas em Bolsa, sem data de fim
//   de negociação. Empresas sem demonstração consolidada, ou sem ITR/DFP nos últimos 15 meses, ficam de fora.
// tipo: "banco" (acima); "incorporadora" = setor FCA de construção civil E (atividade ou nome citam incorporação,
//   empreendimentos, construtora, engenharia ou realty); "commodity" = setor FCA em COMMODITY_SETORES;
//   senão "geral". Heurística: o FCA não traz CNAE.
// estatal = Especie_Controle_Acionario do FCA igual a "Estatal", mais ESTATAIS_EXTRA (holdings confirmadas à mão).
//   O campo "Estatal Holding" do FCA é inconsistente (inclui Light), por isso só entra o que está na lista.
// aproximacoes = lista dos campos acima marcados APROXIMAÇÃO que foram de fato calculados para o ativo, mais
//   "demonstracaoIndividual" quando a empresa não tem consolidado na CVM (sem controladas) e usamos a individual.
// Tickers: o FCA às vezes traz código de negociação inválido; TICKERS_MANUAIS cobre CSNA3, CMIN3, BPAC11/3/5 e MRFG3.
// =============================================================================================

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC';
const ALIQUOTA = 0.34;
const COMMODITY_SETORES = ['petroleo e gas', 'extracao mineral', 'metalurgia e siderurgia', 'papel e celulose',
  'agricultura (acucar, alcool e cana)', 'petroquimicos e borracha'];
const ESTATAIS_EXTRA = ['33.000.167/0001-01']; // Petrobras ("Estatal Holding" no FCA)
const MESES_MAX_ATRASO = 15;
// O FCA traz código de negociação inválido para algumas empresas; estas foram conferidas à mão (CNPJ -> tickers).
const TICKERS_MANUAIS = {
  '33.042.730/0001-04': [{ ticker: 'CSNA3', un: 1 }], // CSN
  '08.902.291/0001-15': [{ ticker: 'CMIN3', un: 1 }], // CSN Mineração
  '30.306.294/0001-45': [{ ticker: 'BPAC11', un: 3 }, { ticker: 'BPAC3', un: 1 }, { ticker: 'BPAC5', un: 1 }], // BTG Pactual (unit = 1 ON + 2 PNA)
  '03.853.896/0001-40': [{ ticker: 'MRFG3', un: 1 }], // Marfrig
};
const EPS_CODIGOS = ['3.99.01.01', '3.99.01.02', '3.99', '3.99.01']; // LPA básico: ON, PN, total (ordem de preferência)

// ---------- utilidades puras ----------
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const r = (x, n = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const soma = (a) => (a.every((x) => x != null) ? a.reduce((s, x) => s + x, 0) : null);
const div = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const media = (a, b) => (a == null ? null : b == null ? a : (a + b) / 2);

// Último dia do mês de `iso` deslocado `dm` meses ("2026-06-30", -3 => "2026-03-31").
export function fimMes(iso, dm) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + dm + 1, 0)).toISOString().slice(0, 10);
}
// Primeiro dia do trimestre que termina em `fim`.
export const inicioTri = (fim) => { const [y, m] = fim.split('-').map(Number); return new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10); };

// fluxos: Map "ini|fim" -> valor (R$). Devolve o fluxo do trimestre que termina em `fim` ou null.
export function trimestre(fluxos, fim) {
  if (!fluxos) return null;
  const direto = fluxos.get(`${inicioTri(fim)}|${fim}`);
  if (direto != null) return direto;
  let acum = null; // acumulado no ano que termina em fim: o mais longo
  for (const [k, v] of fluxos) {
    const [ini, f] = k.split('|');
    if (f === fim && (acum == null || ini < acum.ini)) acum = { ini, v };
  }
  if (!acum) return null;
  const ant = fluxos.get(`${acum.ini}|${fimMes(fim, -3)}`);
  return ant == null ? null : acum.v - ant;
}

// n trimestres (mais recente primeiro) que terminam em `fim`, `fim`-3m, ...
export const trimestres = (fluxos, fim, n) => Array.from({ length: n }, (_, i) => trimestre(fluxos, fimMes(fim, -3 * i)));

// Ações por unit a partir de "1 ON / 2 PN", "1 KLBN3 + 4 KLBN4", "1 ON + 1 PN". null se não der.
export function acoesPorUnit(texto) {
  const partes = String(texto ?? '').split(/[+/]|\be\b/i).map((p) => /(\d+)/.exec(p)?.[1]).filter(Boolean).map(Number);
  return partes.length ? partes.reduce((s, x) => s + x, 0) : null;
}

export function tipoEmpresa({ financeira, setor, atividade, nome }) {
  if (financeira) return 'banco';
  const s = norm(setor);
  if (s.includes('const') && /incorpora|empreend|construtora|engenharia|realty/.test(norm(`${atividade} ${nome}`))) return 'incorporadora';
  if (COMMODITY_SETORES.includes(s.replace(/^emp\. adm\. part\. - /, ''))) return 'commodity';
  return 'geral';
}

// A composição de capital não informa a escala: alguns emissores (Itaú, Vale, Taesa...) enviam em milhares.
// Escolhe 1 ou 1000 pelo que aproxima melhor o LPA publicado (3.99.01.01) do lucro/ações; fator de erro > 6 => null.
export function escalaAcoes(acoes, lucro, eps) {
  if (!(acoes > 0) || !lucro || !eps) return null;
  const [erro, esc] = [1, 1000].map((s) => [Math.abs(Math.log10(Math.abs(lucro / (acoes * s) / eps))), s]).sort((a, b) => a[0] - b[0])[0];
  return erro <= Math.log10(6) ? esc : null;
}

// Entrada (R$, null = ausente):
//  tipo, lucro[8] e receita[8] (tri, mais recente primeiro), ebit[4], da[4], pl[3] (controladora em E, E-3m, E-12m),
//  plTotal, caixa, dividaBruta, ativoCirc, passivoCirc, acoes (em circulação), acoesUnit (multiplicador, padrão 1).
export function derivar(e) {
  const banco = e.tipo === 'banco';
  const lucroLtm = soma(e.lucro.slice(0, 4));
  const plMedio = media(e.pl[0], e.pl[2]);
  const plTriMedio = media(e.pl[0], e.pl[1]);
  const receitaAnt = soma(e.receita.slice(4, 8));
  const ebitLtm = banco ? null : soma(e.ebit);
  const daLtm = banco ? null : soma(e.da);
  const ebitda = ebitLtm != null && daLtm != null ? ebitLtm + daLtm : null;
  const dl = banco || e.dividaBruta == null || e.caixa == null ? null : e.dividaBruta - e.caixa;
  const capital = e.plTotal != null && dl != null ? e.plTotal + dl : null;
  const un = e.acoesUnit === undefined ? 1 : e.acoesUnit; // null = unit ilegível
  const porAcao = (v) => (v == null || !(e.acoes > 0) || un == null ? null : (v / e.acoes) * un);
  const out = {
    roe12m: lucroLtm != null && plMedio > 0 ? r(lucroLtm / plMedio) : null,
    roeTri: e.lucro[0] != null && plTriMedio > 0 ? r(e.lucro[0] / plTriMedio) : null,
    lucrosTri: e.lucro.map((x) => (x == null ? null : Math.round(x))),
    dlEbitda: dl != null && ebitda > 0 ? r(dl / ebitda) : null,
    dlPl: dl != null && e.plTotal > 0 ? r(dl / e.plTotal) : null,
    liqCorrente: banco || !(e.passivoCirc > 0) ? null : r(div(e.ativoCirc, e.passivoCirc)),
    roic: ebitLtm != null && capital > 0 ? r((ebitLtm * (1 - ALIQUOTA)) / capital) : null,
    crescReceita12m: soma(e.receita.slice(0, 4)) != null && receitaAnt > 0 ? r(soma(e.receita.slice(0, 4)) / receitaAnt - 1) : null,
    vpa: r(porAcao(e.pl[0])),
    lpa12m: r(porAcao(lucroLtm)),
  };
  out.aproximacoes = [['ebitda', ebitda], ['dividaLiquida', dl], ['roic', out.roic], ['vpa', out.vpa], ['lpa12m', out.lpa12m]]
    .filter(([, v]) => v != null).map(([k]) => k);
  return out;
}

// ---------- leitura da CVM ----------
function* linhasCsv(buf) {
  const txt = buf.toString('latin1'); // os CSVs da CVM são ISO-8859-1
  let i = 0, cab = null;
  while (i < txt.length) {
    let j = txt.indexOf('\n', i);
    if (j < 0) j = txt.length;
    const l = txt.slice(i, j).replace(/\r$/, '');
    i = j + 1;
    if (!l) continue;
    const c = l.split(';');
    if (!cab) { cab = Object.fromEntries(c.map((k, n) => [k, n])); continue; }
    yield new Proxy(c, { get: (a, k) => a[cab[k]] });
  }
}
const unzipP = (zip, membro) => execFileSync('unzip', ['-p', zip, membro], { maxBuffer: 2 ** 30 });

async function baixar(url, destino, reusar, opcional) {
  if (reusar && existsSync(destino) && statSync(destino).size > 0) return destino;
  const res = await fetch(url);
  if (!res.ok) {
    if (opcional && res.status === 404) { console.warn(`aviso: ${url} ainda não existe (404)`); return null; }
    throw new Error(`${res.status} em ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destino));
  return destino;
}

// Classifica uma linha de demonstração numa chave canônica (ou null para ignorar).
function chave(demo, cd, ds) {
  const n = norm(ds), prof = cd.split('.').length;
  if (demo === 'DRE') {
    if (cd === '3.01') return 'receita';
    if (cd === '3.05' && n.startsWith('resultado antes do resultado financeiro')) return 'ebit';
    if (prof === 3 && /^atribuido a(os)? socios da (empresa )?controladora/.test(n)) return 'lucroCtrl';
    if (prof === 2 && /^lucro(\/| ou )prejuizo (liquido )?(consolidado )?do periodo/.test(n)) return 'lucroCons';
    if (EPS_CODIGOS.includes(cd)) return `eps${cd}`;
  } else if (demo === 'BPA') {
    if (cd === '1.01') return n.startsWith('ativo circulante') ? 'ativoCirc' : 'financeira';
    if (cd === '1.01.01' && n.startsWith('caixa')) return 'caixa';
    if (cd === '1.01.02' && n.startsWith('aplicacoes financeiras')) return 'aplic';
  } else if (demo === 'BPP') {
    if (cd === '2.01' && n.startsWith('passivo circulante')) return 'passivoCirc';
    if ((cd === '2.01.04' || cd === '2.02.01') && /emprestimo|financiamento/.test(n)) return cd === '2.01.04' ? 'dividaCP' : 'dividaLP';
    if (prof === 2 && cd.startsWith('2.') && n.startsWith('patrimonio liquido')) return 'pl';
    if (prof === 3 && cd.startsWith('2.') && n.includes('nao controlador')) return 'plMinor';
  } else if (demo === 'DFC_MI') {
    if (cd.startsWith('6.01.01.') && /deprecia|amortiza|exaust|deple/.test(n)
      && !/emprestimo|financ|debent|captac|transac|encargo|juros|valor justo|hedge|swap|premio|titulos|desagio|agio/.test(n)) return 'da';
  }
  return null;
}

// Lê um CSV de demonstração e devolve Map "cnpj|dtRefer" -> { versao, linhas } só com a última versão e só as contas úteis.
function lerDemonstracao(zip, membro, demo, cnpjs) {
  const docs = new Map();
  for (const l of linhasCsv(unzipP(zip, membro))) {
    const cnpj = l.CNPJ_CIA;
    if (!cnpjs.has(cnpj) || l.MOEDA !== 'REAL') continue;
    const k = chave(demo, l.CD_CONTA, l.DS_CONTA);
    if (!k) continue;
    const versao = Number(l.VERSAO), id = `${cnpj}|${l.DT_REFER}`;
    let d = docs.get(id);
    if (!d || versao > d.versao) { d = { versao, linhas: [] }; docs.set(id, d); } else if (versao < d.versao) continue;
    const vl = Number(l.VL_CONTA) * (l.ESCALA_MOEDA === 'MIL' && !k.startsWith('eps') ? 1000 : 1);
    if (Number.isFinite(vl)) d.linhas.push({ k, cd: l.CD_CONTA, penult: l.ORDEM_EXERC.startsWith('P'), ini: l.DT_INI_EXERC, fim: l.DT_FIM_EXERC, vl, dt: l.DT_REFER, nome: l.DENOM_CIA });
  }
  return docs;
}

// Junta as linhas dos documentos nas séries por empresa. ULTIMO tem prioridade sobre PENULTIMO (que só preenche lacunas).
function aplicar(emp, docsDeVarios) {
  for (const penult of [false, true]) {
    for (const docs of docsDeVarios) for (const [id, d] of docs) {
      const cnpj = id.split('|')[0], e = (emp.get(cnpj) ?? emp.set(cnpj, { fluxos: {}, saldos: {}, refs: new Set(), nome: '' }).get(cnpj));
      // D&A: só as linhas mais rasas (evita contar pai e filho), somadas por período.
      const das = d.linhas.filter((x) => x.k === 'da' && x.penult === penult);
      const rasas = das.filter((x) => !das.some((y) => y !== x && x.cd.startsWith(`${y.cd}.`)));
      const lista = d.linhas.filter((x) => x.k !== 'da' && x.penult === penult);
      const daPorPeriodo = new Map();
      for (const x of rasas) daPorPeriodo.set(`${x.ini}|${x.fim}`, (daPorPeriodo.get(`${x.ini}|${x.fim}`) ?? 0) + x.vl);
      for (const [p, vl] of daPorPeriodo) { const m = (e.fluxos.da ??= new Map()); if (!m.has(p)) m.set(p, vl); }
      for (const x of lista) {
        if (!penult && x.k === 'receita') { e.refs.add(x.dt); e.nome = x.nome; }
        if (x.ini) { const m = (e.fluxos[x.k] ??= new Map()); if (!m.has(`${x.ini}|${x.fim}`)) m.set(`${x.ini}|${x.fim}`, x.vl); }
        else { const m = (e.saldos[x.k] ??= new Map()); if (!m.has(x.fim)) m.set(x.fim, x.vl); }
      }
    }
  }
}

export function lerCadastro(zips) {
  const cad = new Map(); // cnpj -> { nome, setor, atividade, controle, tickers:[{ticker, un}] }
  for (const zip of zips) {
    const sufixo = /_(\d{4})\.zip$/.exec(zip)[1];
    const geral = new Map(), vm = new Map();
    for (const l of linhasCsv(unzipP(zip, `fca_cia_aberta_geral_${sufixo}.csv`))) {
      const ant = geral.get(l.CNPJ_Companhia), v = `${l.Data_Referencia}|${String(l.Versao).padStart(3, '0')}`;
      if (!ant || v > ant.v) geral.set(l.CNPJ_Companhia, { v, l: [l.Nome_Empresarial, l.Setor_Atividade, l.Descricao_Atividade, l.Especie_Controle_Acionario] });
    }
    for (const l of linhasCsv(unzipP(zip, `fca_cia_aberta_valor_mobiliario_${sufixo}.csv`))) {
      const v = `${l.Data_Referencia}|${String(l.Versao).padStart(3, '0')}`, ant = vm.get(l.CNPJ_Companhia);
      if (!ant || v > ant.v) vm.set(l.CNPJ_Companhia, { v, linhas: [] });
      if (v === vm.get(l.CNPJ_Companhia).v) {
        vm.get(l.CNPJ_Companhia).linhas.push({ vmob: l.Valor_Mobiliario, ticker: l.Codigo_Negociacao, comp: l.Composicao_BDR_Unit, mercado: l.Mercado, fim: l.Data_Fim_Negociacao });
      }
    }
    for (const [cnpj, { linhas }] of vm) {
      if (cad.has(cnpj)) continue; // ano mais novo primeiro
      const tickers = [];
      for (const c of linhas) {
        const vmob = norm(c.vmob);
        const ticker = c.ticker.toUpperCase();
        if (c.mercado !== 'Bolsa' || c.fim || !/^[A-Z][A-Z0-9]{3}\d{1,2}$/.test(ticker)) continue;
        if (vmob.startsWith('acoes ordinarias') || vmob.startsWith('acoes preferenciais')) tickers.push({ ticker, un: 1 });
        else if (vmob === 'units') tickers.push({ ticker, un: acoesPorUnit(c.comp) });
      }
      for (const m of TICKERS_MANUAIS[cnpj] ?? []) if (!tickers.some((t) => t.ticker === m.ticker)) tickers.push(m);
      const g = geral.get(cnpj)?.l;
      if (tickers.length && g) cad.set(cnpj, { nome: g[0], setor: g[1], atividade: g[2], controle: g[3], tickers });
    }
  }
  return cad;
}

function lerComposicao(zips) {
  const m = new Map(); // "cnpj|dtRefer" -> { versao, acoes }
  for (const [zip, nome] of zips) for (const l of linhasCsv(unzipP(zip, nome))) {
    const id = `${l.CNPJ_CIA}|${l.DT_REFER}`, versao = Number(l.VERSAO), ant = m.get(id);
    if (ant && ant.versao >= versao) continue;
    const tot = Number(l.QT_ACAO_TOTAL_CAP_INTEGR) || Number(l.QT_ACAO_ORDIN_CAP_INTEGR) + Number(l.QT_ACAO_PREF_CAP_INTEGR);
    const tes = Number(l.QT_ACAO_TOTAL_TESOURO) || Number(l.QT_ACAO_ORDIN_TESOURO) + Number(l.QT_ACAO_PREF_TESOURO) || 0;
    m.set(id, { versao, acoes: tot - tes > 0 ? tot - tes : null });
  }
  return m;
}

const saldo = (e, k, fim) => e.saldos[k]?.get(fim) ?? null;

// Monta a entrada de derivar() para uma empresa e o fim do último trimestre.
function entradaEmpresa(e, fim, tipo, acoesBrutas, acoesUnit) {
  // acumulado do ano que termina em fim: lucro e LPA do mesmo período, para conferir a escala das ações
  // Muitos emissores mandam LPA = 0 no ITR: tenta o LPA não nulo mais recente de qualquer período.
  let esc = null;
  const lpas = EPS_CODIGOS.flatMap((cd) => [...(e.fluxos[`eps${cd}`] ?? [])]).filter(([, v]) => v).sort(([a], [b]) => b.split('|')[1].localeCompare(a.split('|')[1]));
  for (const [per, eps] of lpas) {
    esc = escalaAcoes(acoesBrutas, e.fluxos.lucroCtrl?.get(per) ?? e.fluxos.lucroCons?.get(per), eps);
    if (esc) break;
  }
  if (!esc && acoesBrutas >= 1e8) esc = 1; // ponytail: sem LPA utilizável, só >= 1e8 é seguro (em milhares seriam >= 1e11 ações)
  const acoes = esc ? acoesBrutas * esc : null;
  const lucro = trimestres(e.fluxos.lucroCtrl, fim, 8).map((x, i) => x ?? trimestre(e.fluxos.lucroCons, fimMes(fim, -3 * i)));
  const plCtrl = (f) => { const p = saldo(e, 'pl', f); return p == null ? null : p - (saldo(e, 'plMinor', f) ?? 0); };
  const dCP = saldo(e, 'dividaCP', fim), dLP = saldo(e, 'dividaLP', fim);
  const c1 = saldo(e, 'caixa', fim), c2 = saldo(e, 'aplic', fim);
  return {
    tipo, lucro, receita: trimestres(e.fluxos.receita, fim, 8), ebit: trimestres(e.fluxos.ebit, fim, 4), da: trimestres(e.fluxos.da, fim, 4),
    pl: [plCtrl(fim), plCtrl(fimMes(fim, -3)), plCtrl(fimMes(fim, -12))], plTotal: saldo(e, 'pl', fim),
    caixa: c1 == null ? null : c1 + (c2 ?? 0), dividaBruta: dCP == null && dLP == null ? null : (dCP ?? 0) + (dLP ?? 0),
    ativoCirc: saldo(e, 'ativoCirc', fim), passivoCirc: saldo(e, 'passivoCirc', fim), acoes, acoesUnit,
  };
}

export async function gerar({ hoje = new Date(), cache, reusar = false } = {}) {
  const dir = cache ?? mkdtempSync(join(tmpdir(), 'cvm-fund-'));
  mkdirSync(dir, { recursive: true });
  const ano = hoje.getUTCFullYear(), anos = [ano - 2, ano - 1, ano];
  const zip = {};
  for (const t of ['itr', 'dfp']) for (const a of anos) {
    zip[`${t}${a}`] = await baixar(`${BASE}/${t.toUpperCase()}/DADOS/${t}_cia_aberta_${a}.zip`, join(dir, `${t}_${a}.zip`), reusar, a === ano);
  }
  const fca = [];
  for (const a of [ano, ano - 1]) {
    const z = await baixar(`${BASE}/FCA/DADOS/fca_cia_aberta_${a}.zip`, join(dir, `fca_${a}.zip`), reusar, a === ano);
    if (z) fca.push(z);
  }
  const cad = lerCadastro(fca);
  const cnpjs = new Set(cad.keys());
  console.log(`cadastro: ${cad.size} empresas com ticker`);

  const emp = new Map(), individual = new Set();
  // Empresas sem controladas só entregam a demonstração individual (idêntica à consolidada): segunda passada só para elas.
  for (const sufixo of ['con', 'ind']) {
    const alvo = sufixo === 'con' ? cnpjs : new Set([...cnpjs].filter((c) => !emp.get(c)?.refs.size));
    if (sufixo === 'ind') alvo.forEach((c) => individual.add(c));
    for (const demo of ['DRE', 'BPA', 'BPP', 'DFC_MI']) {
      if (!alvo.size) break;
      const docs = [];
      for (const t of ['itr', 'dfp']) for (const a of anos) {
        if (zip[`${t}${a}`]) docs.push(lerDemonstracao(zip[`${t}${a}`], `${t}_cia_aberta_${demo}_${sufixo}_${a}.csv`, demo, alvo));
      }
      aplicar(emp, docs);
      console.log(`lido ${demo} ${sufixo} (${alvo.size} empresas)`);
    }
  }
  const comp = lerComposicao(['itr', 'dfp'].flatMap((t) => anos.filter((a) => zip[`${t}${a}`]).map((a) => [zip[`${t}${a}`], `${t}_cia_aberta_composicao_capital_${a}.csv`])));

  const limite = fimMes(hoje.toISOString().slice(0, 10), -MESES_MAX_ATRASO);
  const ativos = {}, descartes = { semDemonstracao: [], defasada: [], semLucro: [] };
  for (const [cnpj, c] of cad) {
    const e = emp.get(cnpj);
    const tk = c.tickers.map((t) => t.ticker).join('/');
    if (!e || !e.refs.size) { descartes.semDemonstracao.push(tk); continue; }
    const fim = [...e.refs].sort().at(-1);
    if (fim < limite) { descartes.defasada.push(tk); continue; }
    if ((trimestre(e.fluxos.lucroCtrl, fim) ?? trimestre(e.fluxos.lucroCons, fim)) == null) { descartes.semLucro.push(tk); continue; }
    const financeira = e.saldos.financeira?.has(fim) ?? false;
    const tipo = tipoEmpresa({ financeira, setor: c.setor, atividade: c.atividade, nome: c.nome });
    const acoes = comp.get(`${cnpj}|${fim}`)?.acoes ?? null;
    const estatal = c.controle === 'Estatal' || ESTATAIS_EXTRA.includes(cnpj);
    for (const { ticker, un } of c.tickers) {
      const d = derivar(entradaEmpresa(e, fim, tipo, acoes, un));
      ativos[ticker] = {
        cnpj, nome: c.nome, tipo, estatal, dataBase: fim,
        roe12m: d.roe12m, roeTri: d.roeTri, lucrosTri: d.lucrosTri, dlEbitda: d.dlEbitda, dlPl: d.dlPl,
        liqCorrente: d.liqCorrente, roic: d.roic, crescReceita12m: d.crescReceita12m, vpa: d.vpa, lpa12m: d.lpa12m,
        payout: null, dy: null, cet1: null, inadimplencia: null,
        aproximacoes: individual.has(cnpj) ? [...d.aproximacoes, 'demonstracaoIndividual'] : d.aproximacoes,
      };
    }
  }
  if (!cache) rmSync(dir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(descartes)) console.log(`descartadas ${k}: ${v.length}${process.env.DEBUG ? ` (${v.join(' ')})` : ''}`);
  return { versao: 1, geradoEm: hoje.toISOString(), ativos };
}

function serializar(obj) {
  const linhas = Object.entries(obj.ativos).sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => `  ${JSON.stringify(t)}: ${JSON.stringify(v)}`);
  return `{\n "versao": ${obj.versao},\n "geradoEm": ${JSON.stringify(obj.geradoEm)},\n "ativos": {\n${linhas.join(',\n')}\n }\n}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i < 0 ? undefined : process.argv[i + 1]; };
  const saida = fileURLToPath(new URL('../dados/fundamentos.json', import.meta.url));
  const res = await gerar({ cache: arg('--cache'), reusar: process.argv.includes('--reusar') });
  mkdirSync(fileURLToPath(new URL('../dados/', import.meta.url)), { recursive: true });
  const texto = serializar(res);
  writeFileSync(saida, texto);
  console.log(`${Object.keys(res.ativos).length} ativos, ${(texto.length / 1024).toFixed(0)} KB -> ${saida}`);
}
