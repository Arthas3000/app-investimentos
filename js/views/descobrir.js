// Descobrir: ativos com preço na faixa "barato" pelos próprios dados, com busca, filtros e ordenação.
// "Ver análise" abre o mesmo modal do Mercado (#descobrir/ativo/CODIGO); "Pesquisar fora" leva a sites externos.
// A faixa usa os preços de corte de risco.json (limBarato/limCaro), sem baixar o arquivo de preços de cada ativo.
import { icon } from '../ui/icons.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { listarAtivos } from '../data/brapi.js';
import { prefs } from '../data/store.js';
import { fmtQuando } from '../data/pregao.js';
import { carregarDados } from '../data/dados.js';
import { analisar } from '../analise/analisar.js';
import { itemDescobrir, filtrar, ORDENS } from '../core/descobrir.js';
import * as mercado from './mercado.js';

const LOTE = 30;
const IND_ICONE = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reais = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num2 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nota1 = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctS = (f) => `${f >= 0 ? '+' : '−'}${Math.round(Math.abs(f) * 100)}%`;

// Sites externos de consulta (abrem em nova aba). Só leitura pública; nada do usuário vai junto além do código.
function linksFora(i) {
  const t = encodeURIComponent(i.codigo.toLowerCase()), fii = i.classe === 'fii';
  return [
    ['Notícias no Google', `https://news.google.com/search?q=${encodeURIComponent(i.codigo)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`],
    ['Status Invest', `https://statusinvest.com.br/${fii ? 'fundos-imobiliarios' : 'acoes'}/${t}`],
    ['Investidor10', `https://investidor10.com.br/${fii ? 'fiis' : 'acoes'}/${t}/`],
  ];
}

// filtros ficam no módulo: voltar do modal ou de outra tela encontra a lista como estava
const filtro = { tipo: 'todos', q: '', ord: 'nota', ocultarEvitar: true };

export function rota(partes, ctx) { mercado.rota(partes, ctx); }

export function montar(root, ctx) {
  let itens = [], lista = [], mostrados = 0, vivo = true, carregando = false;
  let estado = { fase: 'carregando' }; // carregando | pronto | semAnalise | erroDados | erroPrecos

  root.innerHTML = `
    <p class="dsc-intro">Ativos cujo preço está <strong>abaixo do normal deles</strong>, pelos últimos 5 anos e pelo valor estimado ${botaoAjuda('faixaPreco')}. Barato não é promessa de alta: use como ponto de partida para estudar.</p>
    <div class="filters">
      <div class="field search"><span>${icon('search')}</span><input id="dq" type="search" autocomplete="off" enterkeyhint="search" placeholder="Buscar por código ou nome" aria-label="Buscar entre os ativos baratos"></div>
      <div class="chips" role="group" aria-label="Tipo de ativo">
        <button class="chip" type="button" data-tipo="todos">Todos</button><button class="chip" type="button" data-tipo="acao">Ações</button><button class="chip" type="button" data-tipo="fii">FIIs</button>
      </div>
      <div class="dsc-linha">
        <div class="field"><label for="dord">Ordenar por</label><select id="dord">${Object.entries(ORDENS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
        <label class="dsc-check"><input type="checkbox" id="devitar"> Ocultar marcados como “Evitar”</label>
      </div>
    </div>
    <div id="dAviso"></div>
    <p class="dsc-conta" id="dConta" role="status" aria-live="polite"></p>
    <div class="dsc-lista" id="dLista"></div>
    <button type="button" class="btn btn--ghost btn--block" id="dMais" hidden></button>
    <p class="src" id="dFonte"></p>
    <aside class="card an an--aviso"><strong>Material educacional, não é recomendação</strong>
      <p>A lista sai só de números (preços, balanços e risco). Notícias e fatos relevantes não entram: por isso o atalho “Pesquisar fora”. Resultado passado não garante resultado futuro.</p></aside>`;
  const soltarAjuda = ligarAjuda(root, ctx);
  const $ = (s) => root.querySelector(s);

  // ---------- desenho ----------
  const selo = (cls, ic, txt) => `<span class="badge ${cls}">${icon(ic)}${esc(txt)}</span>`;
  function cartao(i) {
    const id = `d-${i.codigo.replace(/\W/g, '')}`;
    const valorTxt = i.classe === 'fii'
      ? (i.pvp == null ? null : ['P/VP', num2(i.pvp)])
      : (i.ms == null ? null : ['Margem de segurança', pctS(i.ms)]);
    const corte = i.faixa.limites?.barato;
    return `<article class="card dsc" aria-labelledby="${id}">
      <div class="dsc__top">
        <a class="dsc__id" id="${id}" href="#descobrir/ativo/${encodeURIComponent(i.codigo)}">
          <strong>${esc(i.codigo)}${i.classe === 'fii' ? '<span class="badge">FII</span>' : ''}</strong><span class="dsc__nome">${esc(i.nome)}</span></a>
        <span class="dsc__preco num">${reais(i.preco)}</span>
      </div>
      <p class="dsc__selos">${selo('ind-candidata', 'tag', i.faixa.rotulo)}${selo(`ind-${i.indicacao.id}`, IND_ICONE[i.indicacao.id] ?? 'minus', i.indicacao.rotulo)}</p>
      <dl class="kv dsc__kv">
        <div><dt>Nota de valor</dt><dd class="num">${i.nota == null ? 'Sem nota' : `${nota1(i.nota)} de 10`}</dd></div>
        ${valorTxt ? `<div><dt>${valorTxt[0]}</dt><dd class="num">${valorTxt[1]}</dd></div>` : ''}
        ${corte ? `<div><dt>Barato pelo histórico até</dt><dd class="num">${reais(corte / 100)}</dd></div>` : ''}
      </dl>
      <ul class="dsc__motivos" aria-label="Por que está na faixa barato">${i.faixa.motivos.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <div class="dsc__acoes">
        <a class="btn" href="#descobrir/ativo/${encodeURIComponent(i.codigo)}" aria-label="Ver análise de ${esc(i.codigo)}">Ver análise</a>
        <details class="dsc__fora"><summary class="btn btn--ghost">${icon('search')}Pesquisar fora</summary>
          <ul>${linksFora(i).map(([n, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)} <span class="muted">sobre ${esc(i.codigo)}</span><span class="sr-only"> (abre em nova aba)</span>${icon('chevronRight', 16)}</a></li>`).join('')}</ul>
        </details>
      </div>
    </article>`;
  }

  function pintarLista({ focar = null } = {}) {
    const el = $('#dLista');
    if (estado.fase === 'carregando') {
      el.setAttribute('aria-busy', 'true');
      el.innerHTML = '<div class="skeleton dsc-sk"></div>'.repeat(4);
      $('#dConta').textContent = 'Buscando os ativos…'; $('#dMais').hidden = true; return;
    }
    el.removeAttribute('aria-busy');
    if (estado.fase !== 'pronto') { el.innerHTML = ''; $('#dConta').textContent = ''; $('#dMais').hidden = true; return; }
    if (!itens.length) {
      el.innerHTML = `<div class="card empty">${icon('search', 40)}<h3>Nenhum ativo na faixa barato agora</h3><p>Pelos números de hoje, nenhuma ação ou FII está abaixo do normal dele. A lista se atualiza sozinha com os preços.</p><a class="btn btn--ghost" href="#mercado">Ver todos no Mercado</a></div>`;
      $('#dConta').textContent = ''; $('#dMais').hidden = true; return;
    }
    if (!lista.length) {
      el.innerHTML = `<div class="card empty">${icon('search', 40)}<h3>Nenhum ativo com esses filtros</h3><p>Há ${itens.length} ${itens.length === 1 ? 'ativo barato' : 'ativos baratos'} no total. Tente outro código, nome ou filtro.</p><button class="btn btn--ghost" type="button" id="dLimpar">Limpar filtros</button></div>`;
      $('#dConta').textContent = 'Nenhum ativo com esses filtros.'; $('#dMais').hidden = true;
      $('#dLimpar').addEventListener('click', () => { Object.assign(filtro, { tipo: 'todos', q: '', ocultarEvitar: false }); sincronizar(); aplicar(); });
      return;
    }
    el.innerHTML = lista.slice(0, mostrados).map(cartao).join('');
    const resta = lista.length - mostrados;
    $('#dMais').hidden = resta <= 0;
    $('#dMais').textContent = `Mostrar mais ${Math.min(LOTE, resta)} de ${resta}`;
    $('#dConta').textContent = `${lista.length} ${lista.length === 1 ? 'ativo' : 'ativos'} na faixa barato${lista.length < itens.length ? ` (de ${itens.length})` : ''}.`;
    if (focar !== null) el.querySelectorAll('.dsc__id')[focar]?.focus(); // o primeiro dos que acabaram de entrar
  }

  function pintarAviso({ d, r }) {
    const av = [], card = (ic, titulo, txt, botao = true) => `<div class="card empty" role="alert">${icon(ic, 40)}<h3>${titulo}</h3><p>${txt}</p>${botao ? '<button class="btn btn--ghost" type="button" data-tentar>Tentar de novo</button>' : ''}</div>`;
    if (estado.fase === 'semAnalise') av.push(card('clock', 'A análise ainda não foi gerada', 'Os arquivos de dados (pasta dados/) ainda não existem neste endereço. Eles são gerados todo dia útil, à noite.', false));
    if (estado.fase === 'erroDados') av.push(card('wifiOff', d.offline ? 'Sem conexão' : 'Não consegui ler os dados da análise', d.offline ? 'Não há cópia guardada neste aparelho. Quando a conexão voltar, tente de novo.' : 'Os arquivos de dados podem estar em atualização.'));
    if (estado.fase === 'erroPrecos') av.push(card('wifiOff', 'Não consegui buscar os preços', `${esc(r?.error?.message ?? '')} Sem o preço de agora não dá para comparar com o histórico.`));
    if (estado.fase === 'pronto') {
      if (r?.error) av.push(`<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Usando os últimos preços, de ${fmtQuando(new Date(r.savedAt))}.</span></div>`);
      const semLimites = !Object.values(d.risco.data?.ativos ?? {}).some((x) => typeof x?.limBarato === 'number');
      if (semLimites) av.push(`<div class="notice" role="status">${icon('clock')}<span>Até a próxima atualização dos dados, a faixa usa só o valor estimado (margem de segurança ou P/VP), sem a comparação com os 5 anos.</span></div>`);
    }
    $('#dAviso').innerHTML = av.join('');
    $('#dAviso').querySelector('[data-tentar]')?.addEventListener('click', () => carregar());
  }

  function aplicar({ manter = false } = {}) {
    lista = filtrar(itens, filtro);
    mostrados = Math.min(lista.length, manter ? Math.max(LOTE, mostrados) : LOTE);
    pintarLista();
  }
  function sincronizar() {
    root.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tipo === filtro.tipo)));
    $('#dq').value = filtro.q; $('#dord').value = filtro.ord; $('#devitar').checked = filtro.ocultarEvitar;
  }

  // ---------- dados ----------
  async function carregar({ atualizando = false } = {}) {
    if (carregando) return;
    carregando = true;
    if (!itens.length) { estado = { fase: 'carregando' }; $('#dAviso').innerHTML = ''; pintarLista(); }
    const aberto = ctx.estado().state !== 'fechado';
    const [r, d, cdi] = await Promise.all([
      listarAtivos({ ttlMs: aberto ? prefs().cotacaoSegundos * 1000 : 12 * 3600_000 }), carregarDados(), mercado.cdiAnual(),
    ]);
    carregando = false;
    if (!vivo) return;
    if ([d.fundamentos, d.fiis, d.risco].every((x) => x.ausente)) estado = { fase: 'semAnalise' };
    else if (d.fundamentos.erro || d.fiis.erro) estado = { fase: 'erroDados' };
    else if (!r.data) estado = { fase: 'erroPrecos' };
    else {
      const dados = { fundamentos: d.fundamentos.data, fiis: d.fiis.data, risco: d.risco.data };
      const cx = mercado.ctxDe(d, r.data, cdi);
      itens = r.data
        .filter((a) => (a.tipo === 'fii' ? dados.fiis : dados.fundamentos)?.ativos?.[a.codigo])
        .map((a) => itemDescobrir(a, analisar({ ticker: a.codigo, classe: a.tipo, preco: a.preco, dados, ctx: cx, setor: a.setor ?? null })))
        .filter(Boolean);
      estado = { fase: 'pronto' };
      $('#dFonte').textContent = `Preços: brapi, de ${fmtQuando(new Date(r.savedAt))}${aberto ? ' (ações podem ter atraso de cerca de 30 minutos)' : ''}. Histórico e balanços: B3 e CVM, arquivo de ${fmtQuando(new Date(d.risco.data?.geradoEm ?? d.fundamentos.data.geradoEm))}.`;
    }
    pintarAviso({ d, r });
    if (estado.fase === 'pronto') aplicar({ manter: atualizando }); else pintarLista();
  }

  // ---------- eventos ----------
  root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { filtro.tipo = b.dataset.tipo; sincronizar(); aplicar(); }));
  $('#dq').addEventListener('input', (e) => { filtro.q = e.target.value; aplicar(); });
  $('#dord').addEventListener('change', (e) => { filtro.ord = e.target.value; aplicar(); });
  $('#devitar').addEventListener('change', (e) => { filtro.ocultarEvitar = e.target.checked; aplicar(); });
  $('#dMais').addEventListener('click', () => { const de = mostrados; mostrados = Math.min(lista.length, mostrados + LOTE); pintarLista({ focar: de }); });
  sincronizar();

  // preços novos com o pregão aberto e a tela visível (mesmo intervalo do Mercado)
  // não redesenha enquanto a pessoa está no meio da lista (foco num cartão ou "Pesquisar fora" aberto)
  const ocupado = () => $('#dLista').contains(document.activeElement) || !!root.querySelector('.dsc__fora[open]');
  const timer = setInterval(() => { if (!document.hidden && ctx.estado().state !== 'fechado' && !ocupado()) carregar({ atualizando: true }); }, Math.max(60, prefs().cotacaoSegundos) * 1000);
  carregar();
  return () => { vivo = false; soltarAjuda(); clearInterval(timer); };
}
