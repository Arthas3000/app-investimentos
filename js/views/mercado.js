// Mercado: todas as ações e FIIs da B3, com busca, filtros, ordenação e modal do ativo.
import { icon } from '../ui/icons.js';
import { piscar } from '../ui/kit.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { listarAtivos, cotacao, historico } from '../data/brapi.js';
import { prefs, token } from '../data/store.js';
import { fmtQuando } from '../data/pregao.js';
import { carregarDados, carregarPrecos, carregarProventos, carregarConferencia } from '../data/dados.js';
import { ultimos, SERIES } from '../data/bcb.js';
import { analisar, montarCtx } from '../analise/analisar.js';
import { KE, G, COBERTURA } from '../analise/constantes.js';
import { abrirRegistro } from '../ui/registrar.js';
import { ler, acompanhar, desacompanhar } from '../data/carteira.js';

const SETORES = {
  Finance: 'Finanças', Utilities: 'Energia, água e gás', 'Producer Manufacturing': 'Indústria', 'Process Industries': 'Indústria de processos',
  'Retail Trade': 'Varejo', 'Non-Energy Minerals': 'Mineração e siderurgia', Transportation: 'Transportes', 'Commercial Services': 'Serviços comerciais',
  'Consumer Durables': 'Bens duráveis', 'Consumer Non-Durables': 'Bens não duráveis', 'Industrial Services': 'Serviços industriais',
  'Health Services': 'Saúde (serviços)', 'Distribution Services': 'Distribuição', 'Consumer Services': 'Serviços ao consumidor',
  'Technology Services': 'Tecnologia (serviços)', Communications: 'Comunicações', 'Energy Minerals': 'Petróleo e carvão',
  'Electronic Technology': 'Eletrônicos', 'Health Technology': 'Saúde (tecnologia)', Miscellaneous: 'Outros',
};
const ORDEM = {
  codigo: ['Código (A–Z)', (a, b) => a.codigo.localeCompare(b.codigo)],
  alta: ['Maiores altas do dia', (a, b) => (b.varDia ?? -1e9) - (a.varDia ?? -1e9)],
  queda: ['Maiores quedas do dia', (a, b) => (a.varDia ?? 1e9) - (b.varDia ?? 1e9)],
  preco: ['Maior preço', (a, b) => (b.preco ?? 0) - (a.preco ?? 0)],
  volume: ['Mais negociados', (a, b) => (b.volume ?? 0) - (a.volume ?? 0)],
};
const LOTE = 60;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reais = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const cls = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const compacto = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }));

// filtros ficam no módulo: voltar de outra aba encontra a lista como estava
const filtro = { tipo: 'todos', setor: '', q: '', ord: 'codigo' };
let dados = [], precos = new Map();
let rolagem = 0; // rolagem ao sair da tela, devolvida ao voltar
const selos = new Map(); // codigo -> { ind, faixa }, para as linhas da lista que já foram analisadas nesta sessão
const IND_ICONE = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };
// Faixa de preço: texto + ícone; barato usa o azul da indicação (não o verde de ganho), caro o laranja de atenção.
const FAIXA_ESTILO = { barato: ['candidata', 'tag'], normal: ['neutro', 'minus'], caro: ['atencao', 'trend'] };
const faixaHtml = (f) => {
  const e = FAIXA_ESTILO[f?.id];
  return e ? `<span class="badge ind-${e[0]}" data-faixa title="Preço comparado com os dados do próprio ativo">${icon(e[1])}${esc(f.rotulo)}</span>` : '';
};
const seloHtml = (ind) => `<span class="badge ind-${ind.id}">${icon(IND_ICONE[ind.id])}${esc(ind.rotulo)}</span>`;

let appCtx = null; // o contexto do app, para o botão "Registrar compra" do modal abrir o painel de registro
export function montar(root, ctx) {
  appCtx = ctx;
  let savedAt = null, erro = null, mostrados = 0, lista = [], vivo = true, carregando = false;

  root.innerHTML = `
    <div class="filters">
      <div class="field search"><span>${icon('search')}</span><input id="q" type="search" autocomplete="off" placeholder="Buscar por código ou nome" aria-label="Buscar ativo por código ou nome"></div>
      <div class="chips" role="group" aria-label="Tipo de ativo">
        <button class="chip" data-tipo="todos">Todos</button><button class="chip" data-tipo="acao">Ações</button><button class="chip" data-tipo="fii">FIIs</button>
      </div>
      <div class="filters__row">
        <div class="field"><label for="setor">Setor</label><select id="setor"></select></div>
        <div class="field"><label for="ord">Ordenar por</label><select id="ord">${Object.entries(ORDEM).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
      </div>
    </div>
    <div id="aviso"></div>
    <ul class="asset-list card" id="lista" aria-label="Ativos da B3"></ul>
    <div id="mais" aria-hidden="true"></div>
    <p class="src" id="fonte"></p>
    <p class="src">Selos “barato”, “normal” e “caro” comparam o preço com o histórico do próprio ativo ${botaoAjuda('faixaPreco')}</p>`;
  const soltarAjuda = ligarAjuda(root, ctx);
  const $ = (s) => root.querySelector(s);
  $('#q').value = filtro.q; $('#ord').value = filtro.ord;

  // ---------- desenho ----------
  const marcador = () => {
    const s = ctx.estado().state;
    if (s === 'aberto') return '';
    const [ic, t] = s === 'atrasado' ? ['alert', 'cotação atrasada'] : ['clock', 'pregão fechado, último preço'];
    return `<span class="mkt-mark" role="img" aria-label="${t}">${icon(ic, 14)}</span>`;
  };
  const linha = (a) => `
    <li><a class="asset-row" href="#mercado/ativo/${encodeURIComponent(a.codigo)}" data-c="${esc(a.codigo)}">
      <span class="asset-row__logo" aria-hidden="true">${a.logo ? `<img src="${esc(a.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${esc(a.codigo.slice(0, 2))}</span>
      <span class="col"><span class="asset-row__code">${esc(a.codigo)}${a.tipo === 'fii' ? '<span class="badge">FII</span>' : ''}${selos.has(a.codigo) ? seloHtml(selos.get(a.codigo).ind) + faixaHtml(selos.get(a.codigo).faixa) : ''}</span><span class="asset-row__name">${esc(a.nome)}</span></span>
      <span class="asset-row__end"><span class="asset-row__price num">${marcador()}<span class="cell">${reais(a.preco)}</span></span><span class="asset-row__chg num ${cls(a.varDia)}">${pct(a.varDia)}</span></span>
    </a></li>`;

  function aplicarFiltros() {
    const q = norm(filtro.q.trim());
    lista = dados.filter((a) =>
      (filtro.tipo === 'todos' || a.tipo === filtro.tipo) &&
      (!filtro.setor || a.setor === filtro.setor) &&
      (!q || norm(a.codigo).includes(q) || norm(a.nome).includes(q)));
    lista.sort(ORDEM[filtro.ord][1]);
    mostrados = 0;
    $('#lista').innerHTML = '';
    maisLinhas();
    $('#lista').hidden = !lista.length && !!dados.length ? true : false;
    pintarVazio();
  }
  let restaurar = rolagem; // ponytail: devolve a rolagem uma vez, na primeira pintura da lista
  function devolverRolagem() {
    if (!restaurar || !lista.length) return;
    const alvo = restaurar; restaurar = 0;
    while (mostrados < lista.length && document.documentElement.scrollHeight < alvo + innerHeight) maisLinhas();
    scrollTo(0, alvo);
    // content-visibility: auto estima 64 px por linha e corrige a altura ao desenhar; repete até assentar (ponytail: 5 quadros)
    let n = 0; const de_novo = () => { if (vivo && Math.abs(scrollY - alvo) > 2) scrollTo(0, alvo); if (++n < 5) requestAnimationFrame(de_novo); };
    requestAnimationFrame(de_novo);
  }
  // renderização sob demanda: só LOTE linhas por vez, o resto entra ao chegar no fim da lista
  function maisLinhas() {
    const fim = Math.min(lista.length, mostrados + LOTE);
    $('#lista').insertAdjacentHTML('beforeend', lista.slice(mostrados, fim).map(linha).join(''));
    mostrados = fim;
  }
  const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && mostrados < lista.length) maisLinhas(); }, { rootMargin: '600px' });
  io.observe($('#mais'));

  function pintarVazio() {
    const av = $('#aviso'); av.innerHTML = '';
    const ul = $('#lista');
    if (carregando && !dados.length) {
      ul.hidden = false; ul.innerHTML = '<li class="skeleton skeleton--row" style="margin-bottom:8px"></li>'.repeat(8); ul.setAttribute('aria-busy', 'true'); return;
    }
    ul.removeAttribute('aria-busy');
    if (!dados.length) {
      ul.hidden = true;
      av.innerHTML = erro
        ? `<div class="card empty" role="alert">${icon('wifiOff', 40)}<h3>Não consegui buscar os ativos</h3><p>${esc(erro.message)} Vou tentar de novo sozinho.</p></div>`
        : '';
      return;
    }
    if (erro) av.innerHTML = `<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Mostrando os últimos dados, de ${fmtQuando(new Date(savedAt))}.</span></div>`;
    if (!lista.length) av.innerHTML += `<div class="card empty">${icon('search', 40)}<h3>Nenhum ativo encontrado</h3><p>Tente outro código, nome ou filtro.</p><button class="btn btn--ghost" id="limpar">Limpar filtros</button></div>`;
    $('#limpar')?.addEventListener('click', () => { Object.assign(filtro, { tipo: 'todos', setor: '', q: '', ord: 'codigo' }); sincronizar(); aplicarFiltros(); });
  }

  function pintarSetores() {
    const set = [...new Set(dados.filter((a) => a.tipo === 'acao' && a.setor).map((a) => a.setor))].sort((a, b) => (SETORES[a] ?? a).localeCompare(SETORES[b] ?? b));
    $('#setor').innerHTML = '<option value="">Todos os setores</option>' + set.map((s) => `<option value="${esc(s)}">${esc(SETORES[s] ?? s)}</option>`).join('');
    $('#setor').value = filtro.setor;
  }
  function sincronizar() {
    root.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tipo === filtro.tipo));
    $('#q').value = filtro.q; $('#ord').value = filtro.ord; $('#setor').value = filtro.setor;
  }
  function pintarFonte() {
    $('#fonte').textContent = savedAt ? `Fonte: brapi · consultado em ${fmtQuando(new Date(savedAt))}. Preços de ações podem ter atraso de cerca de 30 minutos.` : '';
  }

  // ---------- dados ----------
  async function carregar({ forcar = false } = {}) {
    if (carregando) return;
    carregando = true;
    if (!dados.length) pintarVazio();
    const segundos = prefs().cotacaoSegundos;
    // 1ª leitura: do cache, instantânea. Depois só busca de novo com pregão aberto e o tempo vencido.
    const aberto = ctx.estado().state !== 'fechado';
    const ttl = forcar || (aberto && dados.length) ? segundos * 1000 : 12 * 3600_000; // ponytail: fechado = cache de 12 h, fechamento exato fica para depois
    const r = await listarAtivos({ ttlMs: ttl });
    carregando = false;
    if (!vivo) return;
    erro = r.error; savedAt = r.savedAt;
    if (r.data) {
      const antes = precos; precos = new Map(r.data.map((a) => [a.codigo, a.preco]));
      const primeira = !dados.length;
      dados = r.data;
      if (primeira) pintarSetores();
      aplicarFiltros(); devolverRolagem();
      if (!primeira) $('#lista').querySelectorAll('.asset-row').forEach((a) => {
        const c = a.dataset.c, d = (precos.get(c) ?? 0) - (antes.get(c) ?? precos.get(c) ?? 0);
        if (d) piscar(a.querySelector('.cell'), d);
      });
      if (!r.stale && savedAt) ctx.definirUltimaCotacao(new Date(savedAt));
    } else pintarVazio();
    pintarFonte();
  }

  // ---------- eventos ----------
  root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filtro.tipo = b.dataset.tipo; if (filtro.tipo === 'fii') filtro.setor = ''; sincronizar(); aplicarFiltros(); }));
  $('#q').addEventListener('input', (e) => { filtro.q = e.target.value; aplicarFiltros(); });
  $('#setor').addEventListener('change', (e) => { filtro.setor = e.target.value; if (filtro.setor && filtro.tipo === 'fii') filtro.tipo = 'acao'; sincronizar(); aplicarFiltros(); });
  $('#ord').addEventListener('change', (e) => { filtro.ord = e.target.value; aplicarFiltros(); });
  sincronizar();

  // atualiza sozinho: a cada 15 s confere se venceu o intervalo (pregão aberto e aba visível) ou se a primeira busca falhou
  const timer = setInterval(() => {
    if (document.hidden) return;
    const s = ctx.estado().state;
    const venceu = savedAt && Date.now() - savedAt >= prefs().cotacaoSegundos * 1000;
    if (!dados.length || (s !== 'fechado' && venceu)) carregar();
  }, 15_000);
  const visivel = () => { if (!document.hidden && ctx.estado().state !== 'fechado') carregar(); };
  document.addEventListener('visibilitychange', visivel);

  carregar();
  return () => { vivo = false; rolagem = scrollY; soltarAjuda(); clearInterval(timer); io.disconnect(); document.removeEventListener('visibilitychange', visivel); };
}

// ---------- modal do ativo (rota #mercado/ativo/CODIGO) ----------
export function rota(partes, ctx) {
  if (ctx) appCtx ??= ctx; // aberto de outra tela (Descobrir) antes do Mercado montar: o modal precisa do contexto
  const dlg = document.querySelector('#sheet');
  if (partes[0] !== 'ativo' || !partes[1]) { if (dlg.open) dlg.close(); return; }
  abrirAtivo(decodeURIComponent(partes[1]), dlg);
}

const nota1 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num2 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const perc = (f, d = 1) => `${(f * 100).toLocaleString('pt-BR', { maximumFractionDigits: d })}%`; // fração -> "18,5%"
const dd = (t) => (t == null ? '<span role="img" aria-label="não disponível">—</span>' : t);
const dataIso = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const dataNum = (n) => { const s = String(n); return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
const SEGMENTOS = { tijolo: 'FIIs de tijolo', papel: 'FIIs de papel', hibrido: 'FIIs híbridos' };
const SEGMENTO_FII = { tijolo: 'FII de tijolo', papel: 'FII de papel', hibrido: 'FII híbrido' };

let memoCtx = { k: [], v: null };
// montarCtx percorre todos os ativos: refaz só quando os arquivos, a lista ou o CDI mudam
export function ctxDe(d, lista, cdi) {
  const k = [d.fundamentos.data, d.fiis.data, d.risco.data, lista, cdi];
  if (k.every((x, i) => x === memoCtx.k[i])) return memoCtx.v;
  const setores = Object.fromEntries(lista.filter((a) => a.tipo === 'acao' && a.setor).map((a) => [a.codigo, a.setor]));
  const v = montarCtx({ risco: d.risco.data, fundamentos: d.fundamentos.data, fiis: d.fiis.data, cdi, setores });
  memoCtx = { k, v };
  return v;
}

// CDI anual (fração) a partir do último CDI diário do BCB; sem rede fica null e o modelo se adapta.
export async function cdiAnual() {
  const v = (await ultimos(SERIES.cdi, 1)).data?.at(-1)?.valor;
  return v > 0 ? (1 + v / 100) ** 252 - 1 : null;
}

async function abrirAtivo(codigo, dlg) {
  const body = dlg.querySelector('#sheetBody');
  dlg.querySelector('#sheetTitulo').textContent = codigo;
  body.innerHTML = `<p class="muted">${esc(dados.find((a) => a.codigo === codigo)?.nome ?? '')}</p><div class="skeleton" style="height:56px"></div><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:140px"></div>`;
  body.setAttribute('aria-busy', 'true');
  if (!dlg.open) dlg.showModal();
  dlg._ajuda ??= ligarAjuda(dlg, appCtx); // uma vez por dialog; os "?" do modal abrem o painel dentro dele

  // 1 ticker por chamada no plano grátis: cotação e histórico em sequência (a fila da brapi cuida da ordem)
  const [q, h, d, pr, cdi, lista, provs, conf] = await Promise.all([
    cotacao(codigo), historico(codigo, '3mo'), carregarDados(), carregarPrecos(codigo), cdiAnual(),
    // direto pelo endereço a lista ainda não foi carregada pela tela: lê do cache de 12 h
    dados.length ? dados : listarAtivos({ ttlMs: 12 * 3600_000 }).then((r) => r.data ?? []),
    carregarProventos(), carregarConferencia(),
  ]);
  if (!dlg.open || dlg.querySelector('#sheetTitulo').textContent !== codigo) return;
  body.removeAttribute('aria-busy');

  const base = lista.find((a) => a.codigo === codigo);
  const c = q.data, hist = (h.data ?? []).filter((p) => p.close != null);
  const classe = base ? base.tipo : d.fiis.data?.ativos?.[codigo] ? 'fii' : 'acao';
  // sem token a cotação ao vivo não vem: vale o preço da lista (e sem lista, sem preço)
  const preco = c?.regularMarketPrice ?? base?.preco ?? null, varDia = c?.regularMarketChangePercent ?? base?.varDia;

  const arquivo = classe === 'fii' ? d.fiis : d.fundamentos;
  let a = null;
  if (arquivo.data) {
    a = analisar({ ticker: codigo, classe, preco, dados: { fundamentos: d.fundamentos.data, fiis: d.fiis.data, risco: d.risco.data }, ctx: ctxDe(d, lista, cdi), setor: base?.setor ?? null, precos5a: pr.data?.p ?? null });
    if (!a.semDados) {
      selos.set(codigo, { ind: a.indicacao, faixa: a.faixa });
      const el = document.querySelector(`.asset-row[data-c="${CSS.escape(codigo)}"] .asset-row__code`);
      if (el) { el.querySelectorAll('.badge[class*="ind-"]').forEach((b) => b.remove()); el.insertAdjacentHTML('beforeend', seloHtml(a.indicacao) + faixaHtml(a.faixa)); }
    }
  }
  const fund = arquivo.data?.ativos?.[codigo];
  if (!c && !base && !fund) {
    body.innerHTML = `<div class="empty" role="alert">${icon('wifiOff', 40)}<h3>Sem dados deste ativo</h3><p>${esc(q.error?.message ?? 'Tente de novo em instantes.')}</p></div>`;
    return;
  }

  // série para o gráfico: os 5 anos do arquivo de preços, ou os 3 meses da brapi
  const serie = pr.data ? pr.data.p.map((x) => x / 100) : hist.map((p) => p.close);
  const ult = serie.at(-1);
  const variacao = (n) => (serie.length > n && ult ? (ult / serie.at(-1 - n) - 1) * 100 : null);
  const v3m = pr.data ? variacao(63) : serie.length >= 55 ? (ult / serie[0] - 1) * 100 : null; // sem o arquivo, a série da brapi já é de 3 meses
  const v52 = serie.slice(-252);
  const legenda = pr.data ? `de ${dataNum(pr.data.d[0])} a ${dataNum(pr.data.d.at(-1))}` : 'nos últimos 3 meses';
  const quando = q.savedAt ?? Date.now();
  const setorTxt = SETORES[base?.setor] ?? base?.setor ?? c?.summaryProfile?.industry;
  let seguindo = ler().acompanhados.some((x) => x.ticker === codigo);

  body.innerHTML = `
    <div><p class="muted">${esc(c?.longName ?? base?.nome ?? fund?.nome ?? '')}</p>
      <p>${preco == null ? '<span class="muted">Preço indisponível agora</span>' : `<span style="font-size:var(--fs-xl);font-weight:700" class="num">${reais(preco)}</span>`} <span class="num ${cls(varDia)}">${pct(varDia)}</span></p></div>
    <div class="home-btns"><button type="button" class="btn btn--ghost" id="mSeguir" aria-pressed="${seguindo}">${seguindo ? 'Acompanhando' : 'Acompanhar na carteira'}</button><button type="button" class="btn" id="mComprar">Registrar compra</button></div>
    <p class="src" id="mMsg" role="status"></p>
    ${grafico(serie, legenda)}
    <dl class="kv kv--3">
      <div><dt>Hoje</dt><dd class="num ${cls(varDia)}">${pct(varDia)}</dd></div>
      <div><dt>1 mês</dt><dd class="num ${cls(variacao(21))}">${pct(variacao(21))}</dd></div>
      <div><dt>3 meses</dt><dd class="num ${cls(v3m)}">${pct(v3m)}</dd></div>
      <div><dt>12 meses</dt><dd class="num ${cls(variacao(252))}">${pct(variacao(252))}</dd></div>
      <div><dt>Mín. 52 semanas</dt><dd class="num">${reais(c?.fiftyTwoWeekLow ?? (v52.length > 1 ? Math.min(...v52) : null))}</dd></div>
      <div><dt>Máx. 52 semanas</dt><dd class="num">${reais(c?.fiftyTwoWeekHigh ?? (v52.length > 1 ? Math.max(...v52) : null))}</dd></div>
      <div><dt>Valor de mercado</dt><dd class="num">${compacto(c?.marketCap ?? base?.valorMercado)}</dd></div>
      ${c ? `<div><dt>P/L</dt><dd class="num">${c.priceEarnings != null ? c.priceEarnings.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}</dd></div>
      <div><dt>Lucro por ação</dt><dd class="num">${reais(c.earningsPerShare)}</dd></div>` : ''}
      <div><dt>${classe === 'fii' ? 'Tipo' : 'Setor'}</dt><dd>${esc(classe === 'fii' ? (SEGMENTO_FII[fund?.segmento] ?? 'FII') : (setorTxt ?? '—'))}</dd></div>
    </dl>
    ${q.error?.code === 'MISSING_TOKEN' ? blocoToken() : ''}
    ${analiseHtml({ a, d, arquivo, classe, codigo, fund, base, preco, pr, prov: provs.data?.ativos?.[codigo] ?? null, provOk: !!provs.data, conf: conf.data })}
    <p class="src">Fonte da cotação: ${c ? 'brapi' : 'lista da brapi'} · dados de ${fmtQuando(new Date(quando))}${q.stale || h.stale ? ' (últimos disponíveis, sem conexão)' : ''}.</p>`;

  body.querySelector('#mComprar').addEventListener('click', () => abrirRegistro(appCtx, { tipo: 'compra', ativo: codigo }));
  body.querySelector('#mSeguir').addEventListener('click', (e) => {
    seguindo = !seguindo;
    seguindo ? acompanhar(codigo) : desacompanhar(codigo);
    e.currentTarget.textContent = seguindo ? 'Acompanhando' : 'Acompanhar na carteira';
    e.currentTarget.setAttribute('aria-pressed', seguindo);
    body.querySelector('#mMsg').textContent = seguindo ? `Acompanhando ${codigo}, só para consulta. Aparece na Carteira até você registrar uma compra.` : `${codigo} saiu dos ativos acompanhados.`;
  });
  body.querySelector('#tkOk')?.addEventListener('click', () => {
    const v = body.querySelector('#tk').value.trim();
    if (!v) { body.querySelector('#tk').focus(); return; }
    token.set(v);
    abrirAtivo(codigo, dlg);
  });
  body.querySelector('#outraVez')?.addEventListener('click', () => abrirAtivo(codigo, dlg));
}

// Sem token a brapi só entrega a lista: o passo a passo fica recolhido, a análise não depende dele.
// O cartão "primeiros passos" completo vira da Home (etapa 5).
function blocoToken() {
  return `<details class="card an">
    <summary>Ver a cotação ao vivo (precisa do token gratuito da brapi)</summary>
    <ol class="muted" style="margin:var(--s3) 0;padding-left:var(--s5);font-size:var(--fs-sm)">
      <li>Crie uma conta grátis em brapi.dev.</li><li>No painel, copie o seu token.</li><li>Cole abaixo. Ele fica só neste aparelho.</li></ol>
    <div class="field"><label for="tk">Token da brapi</label><input id="tk" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <button class="btn btn--block" id="tkOk" style="margin-top:var(--s3)">Salvar token</button></details>`;
}

// ---------- análise: um bloco por estado (vazio, erro, sem conexão, sem dados do ativo, sem nota, completo) ----------
const AVISO = `<aside class="an an--aviso card"><strong>Material educacional, não é recomendação</strong>
  <p>Nada aqui é recomendação de compra, venda ou manutenção. O app lê só números (balanços, preços e risco): notícias e fatos relevantes não entram. Resultado passado não garante resultado futuro.</p></aside>`;

const TIPO_PROV = { DIV: 'Dividendo', JCP: 'JCP', REND: 'Rendimento' };

// Proventos dos últimos 12 meses (B3), mais recente primeiro. Sem o arquivo, o bloco não aparece.
function proventosHtml(prov, provOk, codigo, classe) {
  const un = classe === 'fii' ? 'cota' : 'ação';
  if (!provOk) return '';
  const hoje = new Date(), ini = new Date(hoje); ini.setDate(ini.getDate() - 365);
  const de = ini.toISOString().slice(0, 10);
  const p = (prov?.p ?? []).filter(([dc]) => dc > de);
  const corpo = p.length
    ? `<ul class="prov-lista" aria-label="Proventos de ${esc(codigo)}">${p.map(([dc, pg, v, t]) => `<li>
        <span><strong>${TIPO_PROV[t] ?? t}</strong><span class="muted">Data com ${dataIso(dc)}${pg ? ` · pagamento ${dataIso(pg)}` : ''}</span></span>
        <span class="num">R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}<span class="muted"> por ${un}</span></span></li>`).join('')}</ul>
      <p class="muted">Soma de 12 meses: <strong class="num">${reais(prov.soma12m)}</strong> por ${un}. Valores brutos, antes de imposto (o JCP tem 15% retido na fonte).</p>`
    : '<p class="muted">A B3 não informa proventos com data com nos últimos 12 meses para este ativo.</p>';
  return `<section class="card an" aria-labelledby="h-pv"><h3 id="h-pv">Proventos nos últimos 12 meses ${botaoAjuda('dy')}</h3>${corpo}<p class="src">Fonte: B3, empresas listadas.</p></section>`;
}

// Conferência entre fontes oficiais (dados/conferencia.json): uma frase, ou um aviso quando divergem.
function conferenciaHtml(conf, classe, codigo) {
  const pc = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (classe === 'fii') {
    const c = conf?.fiis?.[codigo];
    if (!c) return '';
    return c.ok && !c.divergentes
      ? `<p class="conf conf--ok">${icon('check', 16)}<span>Rendimentos conferidos: CVM e B3 batem nos ${c.comparados} meses comparados.</span></p>`
      : `<p class="conf ${c.ok ? 'conf--ok' : 'conf--div'}">${icon(c.ok ? 'check' : 'alert', 16)}<span>${c.ok ? 'Rendimentos conferidos com ressalva' : 'Atenção: fontes divergem'}: CVM e B3 diferem em ${c.divergentes} de ${c.comparados} meses (até ${pc(c.maxDif)}). O app usa os números da CVM.</span></p>`;
  }
  const c = conf?.acoes?.[codigo];
  if (!c) return '';
  return `<p class="conf ${c.ok ? 'conf--ok' : 'conf--div'}">${icon(c.ok ? 'check' : 'alert', 16)}<span>${c.ok ? `Número de ações conferido com a B3 (diferença de ${pc(c.dif)}, ações em tesouraria incluídas)` : `Atenção: número de ações da CVM e da B3 difere em ${pc(c.dif)}; valor patrimonial e lucro por ação podem estar distorcidos`}.</span></p>`;
}

function analiseHtml({ a, d, arquivo, classe, codigo, fund, base, preco, pr, prov = null, provOk = false, conf = null }) {
  const cartao = (titulo, ic, texto, extra = '') => `<section class="card an an--vazio" aria-labelledby="h-an"><h3 id="h-an">${titulo}</h3><div class="an__msg">${icon(ic, 28)}<p>${texto}</p></div>${extra}</section>${AVISO}`;
  const nenhum = [d.fundamentos, d.fiis, d.risco].every((x) => x.ausente);
  if (nenhum) return cartao('Análise ainda não disponível', 'clock', 'Os arquivos de dados da análise (pasta dados/) ainda não foram gerados neste endereço. Preço e gráfico continuam funcionando.');
  if (arquivo.ausente) return cartao('Sem dados de análise para este tipo de ativo', 'clock', `O arquivo de ${classe === 'fii' ? 'fundos imobiliários' : 'ações'} ainda não foi gerado. Preço e gráfico continuam funcionando.`);
  if (arquivo.erro) {
    return arquivo.offline
      ? cartao('Sem conexão', 'wifiOff', 'Não consegui baixar os dados da análise e não há cópia guardada neste aparelho. Quando a conexão voltar, abra o ativo de novo.', '<button class="btn btn--ghost" id="outraVez">Tentar de novo</button>')
      : cartao('Não consegui ler os dados da análise', 'alert', `${esc(arquivo.erro.message)}. Os arquivos de dados podem estar em atualização.`, '<button class="btn btn--ghost" id="outraVez">Tentar de novo</button>');
  }
  if (!a || a.semDados) return cartao('Este ativo ainda não tem análise', 'search', `Não encontrei ${esc(codigo)} nos dados de ${classe === 'fii' ? 'fundos imobiliários' : 'balanços de empresas'}. Pode ser um ativo recente ou fora do universo analisado. Preço e gráfico continuam valendo.`);

  const { valor, estab, estabSetor, indicacao, faixa } = a;
  const guardado = [arquivo, d.risco].find((x) => x.stale);
  const faltaRisco = d.risco.ausente || d.risco.erro;
  const faltam = [...new Set(Object.values(valor.pilares).flatMap((p) => p.itens.filter((i) => i.valor === null && !(fund.segmento === 'papel' && /^Diversifica/.test(i.nome))).map((i) => i.nome)))];
  const dataBase = dataIso(fund.dataBase), geradoEm = arquivo.data.geradoEm;

  const barra = (p) => {
    const sem = !p.disponivel;
    return `<div class="bar"><div class="bar__top"><span>${esc(p.nome)}</span>${sem ? '<span class="muted">sem dados</span>' : `<span class="num">${Math.round(p.pontos)} de ${p.max} pontos</span>`}</div>
      <div class="bar__trilho" aria-hidden="true"><i style="width:${sem ? 0 : Math.round((p.pontos / p.max) * 100)}%"></i></div></div>`;
  };
  const itens = Object.values(valor.pilares).map((p) => `<li><strong>${esc(p.nome)}</strong><ul>${p.itens.map((i) =>
    `<li>${esc(i.nome)}: ${i.valor === null ? 'sem dado' : `<span class="num">${num2(i.pontos)}${i.max ? ` de ${num2(i.max)}` : ''}</span>`}</li>`).join('')}</ul></li>`).join('');

  const notaValor = valor.semNota
    ? `<div class="an__nota"><strong>Sem nota</strong><span class="badge badge--consulta">cobertura ${perc(valor.cobertura, 0)}</span>${botaoAjuda('cobertura')}</div>
       <p>Os dados disponíveis cobrem ${perc(valor.cobertura, 0)} do modelo, e o mínimo para dar nota é ${perc(classe === 'fii' ? COBERTURA.parcialFii : COBERTURA.parcial, 0)}. Sem inventar números, o app não calcula a nota${faltam.length ? '. Ainda faltam: ' + esc(faltam.join(', ')) : ''}.</p>
       ${valor.motivos.length > 1 ? `<p>O que os números disponíveis mostram:</p><ul class="an__list">${valor.motivos.slice(0, -1).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}`
    : `<div class="an__nota"><strong class="num">${nota1(valor.nota)}</strong><span>de 10</span>${valor.cobertura < COBERTURA.completa ? `<span class="badge badge--consulta">nota parcial · cobertura ${perc(valor.cobertura, 0)}</span>${botaoAjuda('cobertura')}` : ''}</div>
       <div class="an__barras">${Object.values(valor.pilares).map(barra).join('')}</div>
       <details><summary>Ver os itens de cada pilar</summary><ul class="an__list">${itens}</ul></details>
       ${faltam.length ? `<p class="muted">Sem dado (peso redistribuído): ${esc(faltam.join(', '))}.</p>` : ''}`;

  const justo = classe === 'fii' ? '' : `<section class="card an" aria-labelledby="h-pj"><h3 id="h-pj">Preço justo ${botaoAjuda('precoJusto')} e margem de segurança ${botaoAjuda('margemSeguranca')}</h3>${valor.precoJusto != null && preco != null ? `
    <dl class="kv kv--3"><div><dt>Preço atual</dt><dd class="num">${reais(preco)}</dd></div><div><dt>Preço justo</dt><dd class="num">${reais(valor.precoJusto)}</dd></div>
      <div><dt>Margem de segurança</dt><dd class="num">${pct(valor.ms * 100)}</dd></div></dl>
    <p class="muted">Preço justo = preço × (P/VP justo ÷ P/VP). P/VP justo = (ROE normalizado − ${perc(G, 0)}) ÷ (${perc(KE, 0)} − ${perc(G, 0)}); ${perc(KE, 0)} é o custo do capital próprio e ${perc(G, 0)} o crescimento de longo prazo, premissas de estudo e não previsão.</p>`
    : `<p>${preco == null ? 'Sem preço atual agora: o preço justo e a margem de segurança ficam de fora até a cotação voltar.' : 'Sem dados suficientes de lucro e patrimônio para estimar o preço justo.'}</p>`}</section>`;

  const dyAcao = fund.dy ?? (typeof fund.prov12m === 'number' && preco > 0 ? fund.prov12m / preco : null);
  const AJUDA_TERMO = { 'P/VP': 'pvp', 'Rendimento 12 meses': 'dy', FFO: 'ffo', 'FFO 12m por cota': 'ffo', 'Cobertura pelo FFO': 'ffo', 'ROE 12 meses': 'roe', 'Dív. líquida/EBITDA': 'dlEbitda', 'Liquidez corrente': 'liquidezCorrente', ROIC: 'roic', 'Dividend yield': 'dy', Payout: 'payout' };
  const fmtN = (x, f) => (typeof x === 'number' ? f(x) : null);
  const principais = classe === 'fii'
    ? [['P/VP', fmtN(valor.pvp, num2)], ['Rendimento 12 meses', fmtN(valor.dy, (x) => perc(x))], ['Alavancagem', fmtN(fund.alavancagem, (x) => perc(x, 0))],
      ['Liquidez diária', fmtN(d.risco.data?.ativos?.[codigo]?.liquidezDiaria, (x) => `R$ ${compacto(x)}`)], ['Valor patrimonial/cota', fmtN(fund.vpa, reais)], ['Rendimento/cota 12m', fmtN(fund.rend12m, reais)],
      ['FFO 12m por cota', fmtN(fund.ffo, reais)], ['Cobertura pelo FFO', fmtN(valor.coberturaFfo, (x) => perc(x, 0))], ['Vacância', fmtN(fund.vacancia, (x) => perc(x, 1))],
      ['Inadimplência', fmtN(fund.inadimplencia, (x) => perc(x, 1))], ['Nº de imóveis de renda', fmtN(fund.nImoveis, String)], ['Resultado vindo de venda de imóveis', fmtN(fund.pctVendaImoveis, (x) => perc(x, 0))]]
    : [['P/VP', fmtN(valor.pvp, num2)], ['ROE 12 meses', fmtN(fund.roe12m, perc)], ['ROE último trimestre', fmtN(fund.roeTri, perc)],
      [fund.tipo === 'incorporadora' ? 'Dív. líquida/PL' : 'Dív. líquida/EBITDA', fmtN(fund.tipo === 'incorporadora' ? fund.dlPl : fund.dlEbitda, num2)], ['Liquidez corrente', fmtN(fund.liqCorrente, num2)],
      ['ROIC', fmtN(fund.roic, perc)], ['Crescimento da receita', fmtN(fund.crescReceita12m, perc)], ['Valor patrimonial/ação', fmtN(fund.vpa, reais)],
      ['Lucro/ação 12m', fmtN(fund.lpa12m, reais)], ['Proventos/ação 12m', fmtN(fund.prov12m, reais)], ['Dividend yield', fmtN(dyAcao, perc)], ['Payout', fmtN(fund.payout, (x) => perc(x, 0))]];
  const aprox = fund.aproximacoes?.length ? ` Aproximados a partir das demonstrações: ${esc(fund.aproximacoes.join(', '))}.` : '';
  const risco = d.risco.data;

  const nomeGrupo = classe === 'fii' ? (SEGMENTOS[fund.segmento] ?? 'FIIs') : (SETORES[base?.setor] ?? base?.setor);
  const estabBloco = (titulo, nota, sub) => `<div><p class="muted" style="font-size:var(--fs-sm)">${titulo}</p><p><strong class="num" style="font-size:var(--fs-lg)">${nota == null ? '—' : nota1(nota)}</strong>${nota == null ? '' : ' de 10'}</p><p class="muted" style="font-size:var(--fs-xs)">${sub}</p></div>`;

  return `
    ${guardado ? `<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Análise feita com dados guardados de ${fmtQuando(new Date(guardado.savedAt))}.</span></div>` : ''}
    ${faltaRisco ? `<div class="notice" role="status">${icon('alert')}<span>Dados de risco indisponíveis: a nota de estabilidade fica de fora.</span></div>` : ''}
    <section class="card an an__ind" aria-labelledby="h-ind"><h3 id="h-ind">Indicação automática</h3>
      <p>${seloHtml(indicacao)}</p>
      <ul class="an__list">${indicacao.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <p class="muted">Classificação por regras fixas aplicadas aos números, sempre com os motivos acima. É um ponto de partida para estudo.</p></section>
    <section class="card an" aria-labelledby="h-fx"><h3 id="h-fx">Preço frente aos próprios dados ${botaoAjuda('faixaPreco')}</h3>
      <p>${faixaHtml(faixa)}</p>
      <ul class="an__list">${faixa.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <p class="muted">Compara o preço com a faixa de 5 anos do próprio ativo e com o valor justo (margem de segurança nas ações, P/VP nos FIIs). Barato não é promessa de alta, e caro não é ordem de venda: é material de estudo.</p></section>
    <section class="card an" aria-labelledby="h-nv"><h3 id="h-nv">Nota de valor ${botaoAjuda('notaValor')}</h3>${notaValor}</section>
    ${justo}
    <section class="card an" aria-labelledby="h-es"><h3 id="h-es">Nota de estabilidade ${botaoAjuda('notaEstabilidade')}</h3>
      <div class="duo">${estabBloco('Este ativo', estab.nota, estab.semNota ? 'dados insuficientes' : 'quanto maior, mais estável')}
        ${estabBloco(`O setor dele${nomeGrupo ? `: ${esc(nomeGrupo)}` : ''}`, estabSetor?.mediana, estabSetor?.mediana == null ? 'poucos ativos com nota no grupo' : `mediana de ${estabSetor.n} ativos · metade deles fica numa faixa de ${nota1(estabSetor.dispersao)} ponto${estabSetor.dispersao === 1 ? '' : 's'}`)}</div>
      <p class="muted">Combina volatilidade ${botaoAjuda('volatilidade')}, queda máxima ${botaoAjuda('quedaMaxima')}, beta ${botaoAjuda('beta')}, estabilidade do lucro e liquidez. Ibovespa aproximado por BOVA11 (beta e queda relativa).</p>
      ${estab.motivos.length ? `<ul class="an__list">${estab.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}</section>
    <section class="card an" aria-labelledby="h-fu"><h3 id="h-fu">Principais fundamentos</h3>
      <dl class="kv">${principais.map(([n, v]) => `<div><dt>${n}${botaoAjuda(AJUDA_TERMO[n])}</dt><dd class="num">${dd(v)}</dd></div>`).join('')}</dl>
      ${conferenciaHtml(conf, classe, codigo)}
      <p class="src">${classe === 'fii' ? `Informe mensal do fundo de ${dataBase}${fund.dataBaseTri ? ` e trimestral de ${dataIso(fund.dataBaseTri)}` : ''}` : `Demonstrações da empresa de ${dataBase}`} (CVM)${classe === 'fii' ? '' : '; proventos e payout: B3'}. Risco calculado com preços até ${dataIso(risco?.dataBase)} (B3, COTAHIST). Arquivo gerado em ${fmtQuando(new Date(geradoEm))}. “—” é dado não disponível: o cálculo se adapta.${aprox}</p></section>
    ${proventosHtml(prov, provOk, codigo, classe)}
    ${AVISO}`;
}

function grafico(v, legenda) {
  if (v.length < 2) return '<p class="muted" style="font-size:var(--fs-sm)">Histórico indisponível agora.</p>';
  const min = Math.min(...v), max = Math.max(...v), W = 300, H = 96;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * W).toFixed(1)} ${(H - 6 - ((y - min) / (max - min || 1)) * (H - 12)).toFixed(1)}`);
  const linha = 'M' + pts.join(' L');
  return `<div><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Preço ${legenda}: de ${reais(v[0])} a ${reais(v.at(-1))}, mínimo ${reais(min)} e máximo ${reais(max)}"><path class="area" d="${linha} L${W} ${H} L0 ${H}Z"/><path class="line" d="${linha}"/></svg>
    <p class="src">Preço ${legenda}</p></div>`;
}
