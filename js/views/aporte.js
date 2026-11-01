// Assistente de aporte (#aporte): 1 valor › 2 revisar a proposta › 3 confirmar o que foi comprado.
// Material educacional, nada aqui é recomendação. O app não envia ordens: só registra o que a pessoa diz que comprou.
import { icon } from '../ui/icons.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { aviso, vibrar } from '../ui/kit.js';
import { formatarCentavos, mascaraReais, paraCentavos, paraInteiro, soDigitos, listaDePrecos, hojeIso } from '../ui/registrar.js';
import { ler, definirAlvo, definirAporte, definirPrefs, adicionarTransacao } from '../data/carteira.js';
import { visaoCarteira } from '../core/carteira-calc.js';
import { centavos } from '../core/money.js';
import {
  UNID, somaUnid, pesosIguais, pesosPorGrupo, normalizarPara100, paraPct, fmtPct, validarCfg, propostaDe, resumir,
  passoCotas, transacoesDeCompra, gravarLote, mesPorExtenso,
} from '../core/aporte-entrada.js';
import { fmtQuando } from '../data/pregao.js';
import { carregarDados, carregarPrecos } from '../data/dados.js';
import { ultimos, SERIES } from '../data/bcb.js';
import { analisar, montarCtx } from '../analise/analisar.js';
import { esc, seloFaixa } from './home.js';

// ---------- configuração guardada ----------
// ponytail: definirPrefs aceita qualquer chave, mas validarEstado (data/carteira.js) só relê ocultarValores e
// primeirosPassosDispensados ao recarregar a página; por isso uma cópia vai também para uma chave própria. Tirar a cópia quando a carteira passar a guardar `prefs.aporte`.
const CHAVE_CFG = 'aporte.cfg.v1';
const CFG0 = { valor: '', teto: '', intensidade: 50, taxa: '', lote: '1', evitar: true };

export function lerCfg() {
  const dentro = ler().prefs.aporte;
  if (dentro && typeof dentro === 'object') return { ...CFG0, ...dentro };
  try { return { ...CFG0, ...JSON.parse(localStorage.getItem(CHAVE_CFG) || '{}') }; } catch { return { ...CFG0 }; }
}
function gravarCfg(c) {
  definirPrefs({ aporte: c });
  try { localStorage.setItem(CHAVE_CFG, JSON.stringify(c)); } catch { /* sem armazenamento: vale só nesta visita */ }
}

/** Textos digitados -> números para propor(): taxa vazia = 0, lote vazio = 1, teto vazio = sem teto; inválido vira null/undefined (validarCfg explica). */
export function cfgNumerica(t, aporte) {
  const teto = t.teto.trim() ? (paraPct(t.teto) > 0 ? paraPct(t.teto) : undefined) : null;
  return {
    aporte: aporte ?? 0,
    taxa: t.taxa.trim() ? paraCentavos(t.taxa) : 0,
    lote: t.lote.trim() ? paraInteiro(t.lote) : 1,
    teto, intensidade: Number(t.intensidade), evitar: !!t.evitar,
  };
}

// ---------- dados (preços e análises) ----------
async function cdiAnual() {
  const v = (await ultimos(SERIES.cdi, 1)).data?.at(-1)?.valor;
  return v > 0 ? (1 + v / 100) ** 252 - 1 : null;
}

/**
 * Nota de valor, margem de segurança, faixa de preço e "evitar" de cada ativo, só com o que já está em dados/ (sem dados: mapa vazio
 * e a proposta segue só pelos alvos). Map ticker -> {nota, ms, faixa, faixaSel:[id, rótulo], evitar}.
 */
export async function levantarAnalises({ tickers, lista, precos }) {
  const out = new Map();
  const d = await carregarDados();
  if ([d.fundamentos, d.fiis, d.risco].every((x) => !x.data)) return out;
  const tipos = new Map(lista.map((a) => [a.codigo, a.tipo]));
  const setores = Object.fromEntries(lista.filter((a) => a.tipo === 'acao' && a.setor).map((a) => [a.codigo, a.setor]));
  const cx = montarCtx({ risco: d.risco.data, fundamentos: d.fundamentos.data, fiis: d.fiis.data, cdi: await cdiAnual().catch(() => null), setores });
  const prs = await Promise.all(tickers.map((t) => carregarPrecos(t)));
  tickers.forEach((t, k) => {
    const classe = tipos.get(t) ?? (d.fiis.data?.ativos?.[t] ? 'fii' : 'acao');
    if (!(classe === 'fii' ? d.fiis : d.fundamentos).data) return;
    const p = precos.get(t);
    const a = analisar({ ticker: t, classe, preco: p == null ? null : p / 100, dados: { fundamentos: d.fundamentos.data, fiis: d.fiis.data, risco: d.risco.data }, ctx: cx, setor: setores[t] ?? null, precos5a: prs[k].data?.p ?? null });
    if (a.semDados) return;
    out.set(t, {
      nota: a.valor.nota ?? null, ms: Number.isFinite(a.valor.ms) ? a.valor.ms : null,
      faixa: a.faixa.id === 'indefinido' ? null : a.faixa.id, faixaSel: [a.faixa.id, a.faixa.rotulo], evitar: a.indicacao.id === 'evitar',
    });
  });
  return out;
}

/** Preços da brapi (mesma lista do resto do app): { lista, precos: Map ticker -> centavos, savedAt, erro, stale }. */
export async function buscarPrecos(ctx) {
  const r = await listaDePrecos(ctx);
  const lista = r.data ?? [];
  const precos = new Map(lista.filter((a) => Number.isFinite(a.preco) && a.preco > 0).map((a) => [a.codigo, centavos(a.preco)]));
  if (r.data && !r.stale && r.savedAt) ctx.definirUltimaCotacao(new Date(r.savedAt));
  return { lista, precos, savedAt: r.savedAt, erro: r.error, stale: r.stale };
}

/**
 * Proposta com o que está salvo (valor do aporte, alvos e escolhas), para o cartão da Home. Nunca lança.
 * @returns {Promise<{estado:'sem-aporte'|'sem-alvos'|'erro'|'ok', prop?, ativos?, cfg?}>}
 */
export async function propostaPadrao({ lista, precos }) {
  try {
    const estado = ler();
    if (!estado.aporte?.valor) return { estado: 'sem-aporte' };
    const v = visaoCarteira(estado, precos), tickers = [...v.itens, ...v.acompanhados].map((i) => i.ativo);
    if (!tickers.some((t) => estado.alvos[t] > 0)) return { estado: 'sem-alvos' };
    const cfg = cfgNumerica(lerCfg(), estado.aporte.valor);
    if (validarCfg(cfg, estado.alvos).length) return { estado: 'erro' };
    const analises = await levantarAnalises({ tickers, lista, precos });
    return { estado: 'ok', cfg, ...propostaDe({ estado, precos, analises, cfg }) };
  } catch (e) {
    console.error(e);
    return { estado: 'erro' };
  }
}

// ---------- tela ----------
const PASSOS = ['Valor', 'Revisar', 'Confirmar'];
const nota1 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const soNumero = (v) => v.replace(/[^\d.,]/g, '').slice(0, 6);
const cotaTxt = (n) => `${n} cota${n === 1 ? '' : 's'}`;

const RASCUNHO = 'aporte.rascunho'; // passo 1 digitado e ainda não confirmado: sobrevive a Voltar (só nesta aba)
const lerRascunho = () => { try { return JSON.parse(sessionStorage.getItem(RASCUNHO) || '{}'); } catch { return {}; } };

export function montar(root, ctx) {
  let vivo = true;
  const est0 = ler(), cfg0 = lerCfg();
  const S = {
    passo: 1, feito: null, erros: [], msg: '',
    valor: est0.aporte ? formatarCentavos(est0.aporte.valor) : cfg0.valor, dia: est0.aporte ? String(est0.aporte.dia) : '',
    alvos: {}, teto: cfg0.teto, intensidade: cfg0.intensidade, taxa: cfg0.taxa, lote: cfg0.lote, evitar: cfg0.evitar,
    prop: null, ativos: null, cotas: null, orig: null, aberto: false, // proposta e ajustes
    data: hojeIso(), compra: {}, // passo 3
  };
  Object.assign(S, lerRascunho());
  const guardarRascunho = () => { try { sessionStorage.setItem(RASCUNHO, JSON.stringify({ valor: S.valor, dia: S.dia, alvos: S.alvos, teto: S.teto, intensidade: S.intensidade, taxa: S.taxa, lote: S.lote, evitar: S.evitar })); } catch { /* sem sessionStorage: perde só ao voltar */ } };
  const D = { estado: 'carregando', lista: [], precos: new Map(), analises: new Map(), savedAt: null, erro: null, stale: false, pronto: null };

  root.innerHTML = '<div id="apTopo"></div><div id="apCorpo"></div>';
  const $ = (s) => root.querySelector(s);
  const visao = () => visaoCarteira(ler(), D.precos);
  const lote = () => (S.lote.trim() ? paraInteiro(S.lote) : 1) || 1;

  const marcador = () => {
    const s = ctx.estado().state;
    if (s === 'aberto') return '';
    const [ic, t] = s === 'atrasado' ? ['alert', 'cotação atrasada'] : ['clock', 'pregão fechado, último preço'];
    return `<span class="mkt-mark" role="img" aria-label="${t}">${icon(ic, 14)}</span>`;
  };

  // ---------- dados ----------
  function carregar() {
    D.estado = 'carregando';
    D.pronto = (async () => {
      const r = await buscarPrecos(ctx);
      if (!vivo) return;
      Object.assign(D, { lista: r.lista, precos: r.precos, savedAt: r.savedAt, erro: r.erro, stale: r.stale });
      D.estado = r.erro && !r.lista.length ? 'erro' : 'ok';
      pintarAvisos(); pintarSelos();
      if (D.estado !== 'ok') return;
      const v = visao();
      D.analises = await levantarAnalises({ tickers: [...v.itens, ...v.acompanhados].map((i) => i.ativo), lista: r.lista, precos: r.precos }).catch(() => new Map());
      if (vivo && S.passo === 1) pintarSelos();
    })().catch(() => { D.estado = 'erro'; D.erro = new Error('falha inesperada'); if (vivo) pintarAvisos(); });
  }

  function avisosDados() {
    if (D.estado === 'carregando') return '<div class="notice" role="status"><span>Buscando os preços de hoje…</span></div>';
    if (D.estado === 'erro') return `<div class="notice" role="alert">${icon('wifiOff')}<span>Não consegui buscar os preços: ${esc((D.erro?.message ?? 'sem conexão').replace(/\.$/, ''))}. Sem eles não dá para montar a proposta.</span><button type="button" class="btn btn--quiet" data-act="tentar">Tentar de novo</button></div>`;
    const n = [];
    if (D.erro) n.push(`<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Usando os últimos preços, de ${fmtQuando(new Date(D.savedAt))}.</span></div>`);
    const sem = visao().semPreco;
    if (sem.length) n.push(`<div class="notice" role="status">${icon('alert')}<span>Sem preço agora para ${esc(sem.join(', '))}: ${sem.length > 1 ? 'ficam' : 'fica'} de fora da proposta e o valor atual ${sem.length > 1 ? 'deles' : 'dele'} não entra na conta.</span></div>`);
    return n.join('');
  }
  const pintarAvisos = () => { const el = $('#apAvisos'); if (el) el.innerHTML = avisosDados(); };

  // ---------- partes comuns ----------
  function progresso() {
    const atual = S.feito ? 4 : S.passo;
    return `<ol class="ap-prog" aria-label="Passos do aporte">${PASSOS.map((n, i) => `
      <li ${i + 1 === atual ? 'aria-current="step"' : ''} class="${i + 1 < atual ? 'is-feito' : ''}"><span class="ap-prog__n">${i + 1 < atual ? icon('check', 14) : i + 1}</span><span>${n}<span class="sr-only"> (passo ${i + 1} de 3${i + 1 < atual ? ', concluído' : ''})</span></span></li>`).join('')}</ol>`;
  }
  const erros = () => `<div id="apErros" role="alert">${S.erros.map((m) => `<p class="field__error">${icon('alert', 16)}<span>${esc(m)}</span></p>`).join('')}</div>`;
  const edu = '<p class="ap-edu">Material educacional, não é recomendação. O app não envia ordens: você compra na sua corretora e confirma aqui o que foi comprado.</p>';

  function render({ foco = true } = {}) {
    $('#apTopo').innerHTML = progresso();
    $('#apCorpo').innerHTML = S.feito ? htmlFeito() : S.passo === 1 ? html1() : S.passo === 2 ? html2() : html3();
    if (foco) $('#apTit')?.focus({ preventScroll: false });
  }

  // ---------- passo 1: valor, alvos e preferências ----------
  function itensAlvo() { const v = visao(); return [...v.itens, ...v.acompanhados]; }

  function html1() {
    const itens = itensAlvo();
    for (const i of itens) if (!(i.ativo in S.alvos)) S.alvos[i.ativo] = ler().alvos[i.ativo] != null ? fmtPct(ler().alvos[i.ativo]) : '';
    if (!itens.length) {
      return `<div class="card empty">${icon('wallet', 40)}<h2 id="apTit" tabindex="-1">Primeiro, uma carteira</h2>
        <p>Para propor um aporte preciso saber quais ativos você tem ou acompanha. Registre uma compra ou acompanhe um ativo no Mercado.</p>
        <div class="home-btns"><a class="btn" href="#home">Ir para a Home</a><a class="btn btn--ghost" href="#mercado">Ver o Mercado</a></div></div>`;
    }
    return `
      <h2 class="ap-h" id="apTit" tabindex="-1">Passo 1: quanto aportar e para onde</h2>
      <div id="apAvisos" class="ap-avisos">${avisosDados()}</div>
      <section class="card ap-card" aria-labelledby="apH1">
        <h3 id="apH1">Valor do aporte</h3>
        <div class="reg__duo">
          <div class="field"><label for="apValor">Quanto vai investir</label><input id="apValor" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(S.valor)}"></div>
          <div class="field"><label for="apDia">Dia do mês (1 a 31)</label><input id="apDia" inputmode="numeric" autocomplete="off" placeholder="5" maxlength="2" value="${esc(S.dia)}"></div>
        </div>
      </section>
      <section class="card ap-card" aria-labelledby="apH2">
        <h3 id="apH2">Alvo por ativo ${botaoAjuda('alvoPct')}</h3>
        <p class="muted">Quanto de cada ativo você quer ter na carteira, em %. Os atalhos preenchem uma sugestão que você pode mudar.</p>
        <div class="chips" role="group" aria-label="Atalhos de alvo">
          <button type="button" class="chip" data-act="iguais">Pesos iguais</button>
          <button type="button" class="chip" data-act="classe">Por classe</button>
          <button type="button" class="chip" data-act="setor">Por setor</button>
        </div>
        <ul class="ap-alvos" aria-label="Alvos">${itens.map((i) => `
          <li class="ap-alvo">
            <div class="ap-alvo__id">
              <span class="ap-alvo__cod"><strong>${esc(i.ativo)}</strong><span data-sel="${esc(i.ativo)}">${selo(i.ativo)}</span></span>
              <span class="ap-alvo__meta"><span data-peso="${esc(i.ativo)}">${pesoHoje(i)}</span><span data-nota="${esc(i.ativo)}">${notaTxt(i.ativo)}</span></span>
            </div>
            <div class="field ap-pct"><label class="sr-only" for="alvo-${esc(i.ativo)}">Alvo de ${esc(i.ativo)}, em %</label>
              <input id="alvo-${esc(i.ativo)}" data-alvo="${esc(i.ativo)}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(S.alvos[i.ativo])}"><span aria-hidden="true">%</span></div>
          </li>`).join('')}</ul>
        <div id="apSoma" class="ap-soma" aria-live="polite">${htmlSoma()}</div>
      </section>
      <section class="card ap-card" aria-labelledby="apH3">
        <h3 id="apH3">Como repartir</h3>
        <div class="field"><label for="apTeto">Teto por ativo, em % da carteira (opcional)</label>
          <input id="apTeto" inputmode="decimal" autocomplete="off" placeholder="Sem teto" value="${esc(S.teto)}" aria-describedby="apTetoD">
          <p class="field__hint" id="apTetoD">Nenhum ativo passa desse peso depois do aporte. ${botaoAjuda('teto')}</p></div>
        <div class="field"><label for="apInt">Peso da nota de valor e do preço: <output id="apIntOut" for="apInt">${S.intensidade}%</output></label>
          <input id="apInt" type="range" min="0" max="100" step="5" value="${S.intensidade}" aria-describedby="apIntD">
          <p class="field__hint" id="apIntD">Em 0% o aporte segue só os alvos. Quanto mais alto, mais cotas vão para ativos com nota de valor melhor e preço mais barato, sem passar do alvo. ${botaoAjuda('intensidade')}</p>
          <p class="ap-legenda">Faixa de preço, comparada com o histórico do próprio ativo: ${seloFaixa(['barato', 'Barato'])} ${seloFaixa(['normal', 'Normal'])} ${seloFaixa(['caro', 'Caro'])}</p></div>
        <div class="reg__duo">
          <div class="field"><label for="apTaxa">Taxa por ordem</label><input id="apTaxa" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(S.taxa)}"></div>
          <div class="field"><label for="apLote">Lote (cotas por vez)</label><input id="apLote" inputmode="numeric" autocomplete="off" placeholder="1" maxlength="4" value="${esc(S.lote)}" aria-describedby="apLoteD"><p class="field__hint" id="apLoteD">Menor quantidade negociável. ${botaoAjuda('lote')}</p></div>
        </div>
        <label class="ap-check"><input type="checkbox" id="apEvitar" ${S.evitar ? 'checked' : ''}><span>Não propor ativos com Sinais de alerta</span></label>
      </section>
      ${erros()}
      <div class="ap-acoes ap-acoes--um"><button type="button" class="btn" data-act="revisar" id="apRevisar">Ver proposta</button></div>
      <p class="ap-edu">Material educacional, não é recomendação.</p>`;
  }

  const pesoHoje = (i) => (i.qtd === 0 ? 'Só consulta' : D.estado === 'carregando' ? 'Buscando o preço…' : i.peso != null ? `${fmtPct(i.peso, 1)}% da carteira hoje` : 'sem preço agora');
  const selo = (t) => { const a = D.analises.get(t); return a?.faixaSel ? seloFaixa(a.faixaSel) : ''; };
  const notaTxt = (t) => { const a = D.analises.get(t); return a?.nota != null ? ` · nota de valor ${nota1(a.nota)}` : ''; };
  function pintarSelos() {
    root.querySelectorAll('[data-sel]').forEach((el) => { el.innerHTML = selo(el.dataset.sel); });
    const por = new Map(itensAlvo().map((i) => [i.ativo, i]));
    root.querySelectorAll('[data-peso]').forEach((el) => { el.textContent = pesoHoje(por.get(el.dataset.peso)); });
    root.querySelectorAll('[data-nota]').forEach((el) => { el.textContent = notaTxt(el.dataset.nota); });
  }

  // alvos digitados: { valores, ruins }
  function alvosDigitados() {
    const valores = {}, ruins = [];
    for (const [t, txt] of Object.entries(S.alvos)) {
      if (!txt.trim()) continue;
      const p = paraPct(txt);
      if (p == null) ruins.push(t); else valores[t] = p;
    }
    return { valores, ruins };
  }
  function htmlSoma() {
    const { valores, ruins } = alvosDigitados(), u = somaUnid(valores);
    const linha = `Soma dos alvos: <strong class="num">${fmtPct(u / 100)}%</strong>`;
    let ajuda = '';
    if (ruins.length) ajuda = `<span>Confira ${esc(ruins.join(', '))}: use um número de 0 a 100.</span>`;
    else if (u === 0) ajuda = '<span>Nenhum alvo definido ainda.</span>';
    else if (u === UNID) ajuda = `${icon('check', 16)}<span>Fechou 100%.</span>`;
    else ajuda = `<span>${u < UNID ? `Faltam ${fmtPct((UNID - u) / 100)} pontos` : `Passam ${fmtPct((u - UNID) / 100)} pontos`} para 100%. Dá para seguir assim, mas o ideal é fechar 100%.</span>
      <button type="button" class="btn btn--quiet" data-act="normalizar">Ajustar para 100%</button>`;
    return `<p>${linha}</p><p class="ap-soma__ajuda">${ajuda}</p>${S.msg ? `<p class="muted">${esc(S.msg)}</p>` : ''}`;
  }
  const pintarSoma = () => { const el = $('#apSoma'); if (el) el.innerHTML = htmlSoma(); };

  function preencher(valores, msg) {
    for (const [t, p] of Object.entries(valores)) S.alvos[t] = fmtPct(p);
    S.msg = msg;
    root.querySelectorAll('[data-alvo]').forEach((inp) => { inp.value = S.alvos[inp.dataset.alvo] ?? ''; });
    pintarSoma();
  }
  const tipoDe = (t) => D.lista.find((a) => a.codigo === t)?.tipo ?? (/11$/.test(t) ? 'fii' : 'acao');
  const grupoClasse = (t) => (tipoDe(t) === 'fii' ? 'FIIs' : 'Ações');
  // ponytail: setor é o da brapi (um por ação) e todos os FIIs ficam juntos; separar por segmento (tijolo, papel) exige os arquivos de dados.
  const grupoSetor = (t) => (tipoDe(t) === 'fii' ? 'FIIs' : D.lista.find((a) => a.codigo === t)?.setor ?? null);

  function coletar() {
    const e = [], { valores, ruins } = alvosDigitados();
    const aporte = paraCentavos(S.valor), dia = S.dia.trim() ? paraInteiro(S.dia) : null;
    if (S.dia.trim() && !(dia >= 1 && dia <= 31)) e.push('O dia do aporte vai de 1 a 31.');
    if (ruins.length) e.push(`Alvo de ${ruins.join(', ')}: use um número de 0 a 100, com até 2 casas decimais.`);
    const cfg = cfgNumerica(S, aporte);
    e.push(...validarCfg(cfg, valores));
    return { e: [...new Set(e)], cfg, valores, dia, aporte };
  }

  async function revisar(btn) {
    const c = coletar();
    S.erros = c.e;
    if (c.e.length) { $('#apErros').outerHTML = erros(); $('#apErros').scrollIntoView({ block: 'center' }); return; }
    btn.disabled = true; btn.textContent = 'Calculando…';
    await D.pronto;
    if (!vivo) return;
    if (D.estado === 'erro' || !D.precos.size) {
      S.erros = ['Ainda não tenho os preços de hoje. Confira a conexão e toque em "Tentar de novo".'];
      render({ foco: false }); return;
    }
    // guarda as escolhas (alvos, aporte e preferências)
    for (const i of itensAlvo()) definirAlvo(i.ativo, c.valores[i.ativo] ?? null);
    const salvo = ler().aporte;
    if (c.aporte > 0 && (c.dia || salvo)) definirAporte({ valor: c.aporte, dia: c.dia ?? salvo.dia });
    gravarCfg({ valor: S.valor, teto: S.teto, intensidade: S.intensidade, taxa: S.taxa, lote: S.lote, evitar: S.evitar });
    try { sessionStorage.removeItem(RASCUNHO); } catch { /* ok */ } // confirmado: agora vale o que foi salvo
    try {
      const r = propostaDe({ estado: ler(), precos: D.precos, analises: D.analises, alvos: c.valores, cfg: c.cfg });
      Object.assign(S, { prop: r.prop, ativos: r.ativos, cfgN: c.cfg, cotas: Object.fromEntries(r.prop.linhas.map((l) => [l.ticker, l.cotas])), compra: {}, erros: [], passo: 2, aberto: false });
      S.orig = { ...S.cotas };
    } catch (e) {
      S.erros = [`Não consegui montar a proposta: ${e.message}`];
      render({ foco: false }); return;
    }
    render();
    scrollTo(0, 0);
  }

  // ---------- passo 2: revisar ----------
  const resumo = () => resumir({ ativos: S.ativos, cotas: S.cotas, aporte: S.cfgN.aporte, taxaPorOrdem: S.cfgN.taxa });

  function linhaRev(l, motivos) {
    const a = S.ativos.find((x) => x.ticker === l.ticker), ajustou = S.cotas[l.ticker] !== S.orig[l.ticker];
    const motivo = ajustou ? 'Quantidade ajustada por você.' : motivos.get(l.ticker);
    const sel = D.analises.get(l.ticker)?.faixaSel;
    const pesoTxt = `Peso ${fmtPct(l.pesoAntes, 1)}% → ${fmtPct(l.pesoDepois, 1)}%${l.alvoPct ? ` (alvo ${fmtPct(l.alvoPct)}%)` : ''}`;
    return `<li class="ap-lin" data-lin="${esc(l.ticker)}">
      <div class="ap-lin__txt">
        <p class="ap-lin__cod"><strong>${esc(l.ticker)}</strong>${sel ? seloFaixa(sel) : ''}</p>
        <p class="ap-lin__det num">${l.cotas > 0 ? `${cotaTxt(l.cotas)} × ${formatarCentavos(l.preco)}${marcador()} = <strong>${formatarCentavos(l.custo)}</strong>` : a.preco != null ? `Preço ${formatarCentavos(a.preco)}${marcador()}` : 'Sem preço agora'}</p>
        <p class="ap-lin__peso num">${pesoTxt}</p>
        <p class="ap-lin__motivo muted">${esc(motivo)}</p>
      </div>
      <div class="ap-step" role="group" aria-label="Cotas de ${esc(l.ticker)}">
        <button type="button" class="icon-btn" data-act="menos" data-t="${esc(l.ticker)}" aria-label="Menos ${S.cfgN.lote > 1 ? `${S.cfgN.lote} cotas` : 'uma cota'} de ${esc(l.ticker)}" ${l.cotas <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
        <output class="num" aria-live="polite">${l.cotas}</output>
        <button type="button" class="icon-btn" data-act="mais" data-t="${esc(l.ticker)}" aria-label="Mais ${S.cfgN.lote > 1 ? `${S.cfgN.lote} cotas` : 'uma cota'} de ${esc(l.ticker)}" ${a.preco == null ? 'disabled' : ''}>${icon('plus')}</button>
      </div></li>`;
  }

  function html2() {
    const R = resumo(), motivos = new Map(S.prop.linhas.map((l) => [l.ticker, l.motivo]));
    const com = R.linhas.filter((l) => l.cotas > 0), sem = R.linhas.filter((l) => l.cotas === 0);
    const mes = mesPorExtenso(hojeIso());
    const avisosProp = S.prop.avisos.map((m) => `<div class="notice" role="status">${icon('alert')}<span>${esc(m)}</span></div>`).join('');
    return `
      <h2 class="ap-h" id="apTit" tabindex="-1">Passo 2: revisar a proposta de ${mes}</h2>
      ${edu}
      <div id="apAvisos" class="ap-avisos">${avisosDados()}${avisosProp}</div>
      <section class="card ap-card" aria-label="Resumo da proposta">
        <dl class="kv">
          <div><dt>Aporte</dt><dd class="num">${formatarCentavos(S.cfgN.aporte)}</dd></div>
          <div><dt>Compras</dt><dd class="num" id="apTotal">${formatarCentavos(R.total)}</dd></div>
          <div><dt>Taxas</dt><dd class="num" id="apTaxas">${formatarCentavos(R.taxas)}</dd></div>
          <div><dt>Sobra</dt><dd class="num" id="apSobra">${formatarCentavos(R.sobra)}</dd></div>
        </dl>
        <p class="notice" id="apExcede" role="status" ${R.excede ? '' : 'hidden'}>${icon('alert')}<span>As compras e taxas passam do aporte em ${formatarCentavos(Math.abs(R.sobra))}. Pode seguir se você tem esse saldo; senão, tire algumas cotas.</span></p>
        <p class="src">Preços: brapi, consultados ${D.savedAt ? `em ${fmtQuando(new Date(D.savedAt))}` : 'agora'}${D.stale ? ' (última consulta guardada)' : ''}. ${ctx.estado().state === 'aberto' ? '' : 'Pregão fechado: vale o último preço.'}</p>
      </section>
      ${com.length ? `<section class="card ap-card" aria-labelledby="apH4"><h3 id="apH4">Para comprar</h3><ul class="ap-lins">${com.map((l) => linhaRev(l, motivos)).join('')}</ul></section>`
        : `<div class="card empty">${icon('target', 40)}<h3>Nada a comprar com esses números</h3><p>${S.cfgN.aporte && R.sobra === S.cfgN.aporte ? 'O valor não cobre um lote dos ativos abaixo do alvo, ou todos já estão no alvo.' : 'Você tirou todas as cotas.'} Volte e mude o valor, os alvos ou o lote.</p></div>`}
      ${sem.length ? `<details class="card ap-card ap-sem" ${S.aberto ? 'open' : ''}><summary>Sem compra neste aporte (${sem.length})</summary><ul class="ap-lins">${sem.map((l) => linhaRev(l, motivos)).join('')}</ul></details>` : ''}
      <div class="ap-acoes"><button type="button" class="btn btn--ghost" data-act="voltar">Voltar</button><button type="button" class="btn" data-act="confirmar" ${com.length ? '' : 'disabled'}>Já comprei: confirmar</button></div>`;
  }

  function mudarCotas(t, sentido) {
    const a = S.ativos.find((x) => x.ticker === t);
    if (!a || (sentido > 0 && a.preco == null)) return;
    S.cotas[t] = passoCotas(S.cotas[t] ?? 0, sentido, S.cfgN.lote);
    const detalhes = $('.ap-sem');
    S.aberto = (detalhes?.open ?? false) || S.cotas[t] === 0; // a linha que zerou desce para cá: deixa à vista
    render({ foco: false });
    const meus = `[data-t="${CSS.escape(t)}"]:not([disabled])`;
    (root.querySelector(`[data-act="${sentido > 0 ? 'mais' : 'menos'}"]${meus}`) ?? root.querySelector(meus))?.focus({ preventScroll: true });
  }

  // ---------- passo 3: confirmar o que foi comprado ----------
  function iniciarCompra() {
    for (const l of S.prop.linhas) {
      const n = S.cotas[l.ticker] ?? 0, c = S.compra[l.ticker];
      if (n <= 0) { delete S.compra[l.ticker]; continue; }
      if (c && c.base === n) continue; // a pessoa já mexeu nesta linha e a proposta não mudou
      const a = S.ativos.find((x) => x.ticker === l.ticker);
      S.compra[l.ticker] = { base: n, qtd: String(n), preco: formatarCentavos(a.preco), taxas: S.cfgN.taxa ? formatarCentavos(S.cfgN.taxa) : '' };
    }
  }
  const lido = (t) => {
    const c = S.compra[t];
    return { ticker: t, qtd: paraInteiro(c.qtd) || 0, preco: c.preco.trim() ? paraCentavos(c.preco) : null, taxas: c.taxas.trim() ? paraCentavos(c.taxas) : 0 };
  };
  const subtotal = (t) => { const i = lido(t); return i.qtd && i.preco ? i.qtd * i.preco + (i.taxas ?? 0) : null; };
  function textoTotal() {
    const ts = Object.keys(S.compra), soma = ts.reduce((s, t) => s + (subtotal(t) ?? 0), 0);
    return `Total pago, com taxas: <strong class="num">${formatarCentavos(soma)}</strong>`;
  }

  function html3() {
    iniciarCompra();
    const ts = Object.keys(S.compra);
    return `
      <h2 class="ap-h" id="apTit" tabindex="-1">Passo 3: o que você comprou</h2>
      <p class="muted">Faça as compras na sua corretora e confira abaixo o que foi executado. Ajuste a quantidade, o preço e as taxas de verdade. Só ao tocar em "Registrar o que comprei" as compras entram na carteira.</p>
      ${edu}
      <section class="card ap-card" aria-labelledby="apH5">
        <h3 id="apH5">Data das compras</h3>
        <div class="field"><label for="apData">Data</label><input id="apData" type="date" max="${hojeIso()}" value="${esc(S.data)}"></div>
      </section>
      ${ts.map((t) => { const c = S.compra[t]; return `
        <section class="card ap-card ap-comp" aria-labelledby="apC-${esc(t)}">
          <h3 id="apC-${esc(t)}">${esc(t)}</h3>
          <div class="reg__duo">
            <div class="field"><label for="cq-${esc(t)}">Quantidade comprada</label><input id="cq-${esc(t)}" data-c="qtd" data-t="${esc(t)}" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(c.qtd)}"></div>
            <div class="field"><label for="cp-${esc(t)}">Preço por cota</label><input id="cp-${esc(t)}" data-c="preco" data-t="${esc(t)}" inputmode="numeric" autocomplete="off" value="${esc(c.preco)}"></div>
          </div>
          <div class="field"><label for="ct-${esc(t)}">Taxas (opcional)</label><input id="ct-${esc(t)}" data-c="taxas" data-t="${esc(t)}" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(c.taxas)}"></div>
          <p class="ap-sub" data-sub="${esc(t)}" aria-live="polite">${subTxt(t)}</p>
        </section>`; }).join('')}
      <p class="ap-soma" id="apTotal3" aria-live="polite">${textoTotal()}</p>
      ${erros()}
      <div class="ap-acoes"><button type="button" class="btn btn--ghost" data-act="voltar">Voltar</button><button type="button" class="btn" data-act="registrar">Registrar o que comprei</button></div>`;
  }
  const subTxt = (t) => { const s = subtotal(t); return s == null ? 'Informe quantidade e preço.' : `Subtotal: ${formatarCentavos(s)}`; };

  function registrar() {
    const { transacoes, erros: falhas } = transacoesDeCompra(Object.keys(S.compra).map(lido), S.data);
    if (falhas.length) { S.erros = falhas; $('#apErros').outerHTML = erros(); $('#apErros').scrollIntoView({ block: 'center' }); return; }
    const g = gravarLote(transacoes, adicionarTransacao);
    if (!g.ok) { S.erros = g.erros; $('#apErros').outerHTML = erros(); $('#apErros').scrollIntoView({ block: 'center' }); return; }

    // novo peso da carteira com os preços de hoje
    const v = visaoCarteira(ler(), D.precos), antes = new Map(resumo().linhas.map((l) => [l.ticker, l.pesoAntes]));
    const comprados = transacoes.map((t) => t.ativo);
    S.feito = {
      mes: mesPorExtenso(S.data), n: transacoes.length, total: transacoes.reduce((s, t) => s + t.qtd * t.preco + (t.taxas ?? 0), 0),
      pesos: comprados.map((t) => ({ t, antes: antes.get(t) ?? 0, depois: v.itens.find((i) => i.ativo === t)?.peso ?? null, alvo: S.ativos.find((a) => a.ticker === t)?.alvoPct || null })),
    };
    S.erros = [];
    render();
    vibrar();
    aviso(`Aporte registrado: ${S.feito.n} ${S.feito.n === 1 ? 'compra' : 'compras'}.${g.semArmazenamento ? ' O navegador não deixou gravar: vale só até fechar esta aba.' : ''}`, () => {
      g.desfazer();
      if (!vivo) return;
      S.feito = null; S.passo = 3; render();
      aviso('Registro desfeito. Nada ficou na carteira.');
    });
  }

  function htmlFeito() {
    const f = S.feito;
    return `
      <section class="ap-feito" aria-labelledby="apTit">
        <svg class="ap-feito__check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11"/><path pathLength="1" d="M7 12.5 10.5 16 17 8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h2 class="ap-h" id="apTit" tabindex="-1">Aporte de ${esc(f.mes)} registrado</h2>
        <p class="muted">${f.n} ${f.n === 1 ? 'compra' : 'compras'}, ${formatarCentavos(f.total)} no total. Você pode desfazer pelo aviso por alguns segundos.</p>
        <ul class="ap-pesos" aria-label="Novo peso na carteira">${f.pesos.map((p) => `
          <li><strong>${esc(p.t)}</strong><span class="num">${fmtPct(p.antes, 1)}% → ${p.depois == null ? '—' : `${fmtPct(p.depois, 1)}%`}${p.alvo ? ` · alvo ${fmtPct(p.alvo)}%` : ''}</span></li>`).join('')}</ul>
        <a class="btn" href="#home">Voltar para a Home</a>
        <p class="ap-edu">Material educacional, não é recomendação.</p>
      </section>`;
  }

  // ---------- eventos ----------
  const soltarAjuda = ligarAjuda(root, ctx);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const ato = b.dataset.act;
    if (ato === 'iguais') preencher(pesosIguais(itensAlvo().map((i) => i.ativo)), 'Preenchi pesos iguais. Ajuste como quiser.');
    else if (ato === 'classe') preencher(pesosPorGrupo(itensAlvo().map((i) => ({ ticker: i.ativo, grupo: grupoClasse(i.ativo) }))), 'Preenchi metade para cada classe, dividida por igual entre os ativos dela. Ajuste como quiser.');
    else if (ato === 'setor') preencher(pesosPorGrupo(itensAlvo().map((i) => ({ ticker: i.ativo, grupo: grupoSetor(i.ativo) }))), 'Preenchi o mesmo peso para cada setor, dividido por igual entre os ativos dele. Ajuste como quiser.');
    else if (ato === 'normalizar') preencher(normalizarPara100(alvosDigitados().valores), 'Ajustei mantendo as proporções que você tinha digitado.');
    else if (ato === 'revisar') revisar(b);
    else if (ato === 'tentar') { carregar(); pintarAvisos(); }
    else if (ato === 'voltar') { S.passo -= 1; S.erros = []; render(); }
    else if (ato === 'confirmar') { S.passo = 3; S.erros = []; render(); }
    else if (ato === 'mais' || ato === 'menos') mudarCotas(b.dataset.t, ato === 'mais' ? 1 : -1);
    else if (ato === 'registrar') registrar();
  });
  root.addEventListener('input', (e) => {
    const el = e.target, id = el.id;
    if (el.dataset.alvo) { el.value = S.alvos[el.dataset.alvo] = soNumero(el.value); S.msg = ''; pintarSoma(); }
    else if (id === 'apValor') el.value = S.valor = mascaraReais(el.value);
    else if (id === 'apDia') el.value = S.dia = soDigitos(el.value).slice(0, 2);
    else if (id === 'apTeto') el.value = S.teto = soNumero(el.value);
    else if (id === 'apTaxa') el.value = S.taxa = mascaraReais(el.value);
    else if (id === 'apLote') el.value = S.lote = soDigitos(el.value).slice(0, 4);
    else if (id === 'apInt') { S.intensidade = Number(el.value); $('#apIntOut').textContent = `${S.intensidade}%`; }
    else if (id === 'apData') S.data = el.value;
    else if (el.dataset.c) {
      const t = el.dataset.t, k = el.dataset.c;
      el.value = S.compra[t][k] = k === 'qtd' ? soDigitos(el.value).slice(0, 9) : mascaraReais(el.value);
      root.querySelector(`[data-sub="${CSS.escape(t)}"]`).textContent = subTxt(t);
      $('#apTotal3').innerHTML = textoTotal();
    }
  });
  root.addEventListener('input', guardarRascunho);
  root.addEventListener('change', (e) => { if (e.target.id === 'apEvitar') { S.evitar = e.target.checked; guardarRascunho(); } });

  carregar();
  render({ foco: false });
  // vindo do cartão da Home (#aporte/proposta): se tudo já está salvo e válido, vai direto à proposta; senão fica no passo 1 mostrando o que falta
  if (location.hash === '#aporte/proposta') queueMicrotask(() => $('#apRevisar')?.click());
  return () => { vivo = false; soltarAjuda(); };
}
