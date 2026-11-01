// Registrar movimentação: painel (ctx.sheet) com tipo, ativo, quantidade, preço e data.
// A lógica pura (máscara e leitura de R$, busca, montagem e resumo da transação) fica no topo e é testada em test/home.test.js.
import { icon } from './icons.js';
import { aviso } from './kit.js';
import { listarAtivos } from '../data/brapi.js';
import { prefs } from '../data/store.js';
import { fmtQuando } from '../data/pregao.js';
import { adicionarTransacao, ler } from '../data/carteira.js';
import { calcular } from '../core/posicoes.js';
import { centavos, mulDiv } from '../core/money.js';

export const TIPOS = [
  ['compra', 'Compra'], ['venda', 'Venda'], ['deposito', 'Depósito'],
  ['retirada', 'Retirada'], ['transferencia', 'Transferência'], ['provento', 'Provento'],
];
const COM_COTAS = ['compra', 'venda', 'transferencia'];
const COM_ATIVO = [...COM_COTAS, 'provento'];
const MAX_DIGITOS = 11; // até R$ 999.999.999,99

// ---------- lógica pura ----------

/** 'AAAA-MM-DD' da data local (não UTC: às 22h em Brasília ainda é "hoje"). */
export const hojeIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/** 123456 -> 'R$ 1.234,56' (sem Intl: o texto não muda com o navegador). */
export function formatarCentavos(c) {
  const neg = c < 0, a = Math.abs(c);
  const reais = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}R$ ${reais},${String(a % 100).padStart(2, '0')}`;
}

/** Máscara do campo: só os dígitos contam e entram pela direita ('1','12','123' -> 'R$ 1,23'). Sem dígitos: vazio. */
export function mascaraReais(texto) {
  const d = soDigitos(texto).slice(0, MAX_DIGITOS);
  return d ? formatarCentavos(Number(d)) : '';
}

/**
 * Texto de dinheiro para centavos inteiros, ou null se não der para entender.
 * Aceita 'R$ 1.234,56', '1234,5', '12.50' e '1.234' (ponto com 3 dígitos depois = milhar). Nunca negativo.
 */
export function paraCentavos(texto) {
  let s = String(texto ?? '').replace(/R\$|\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const c = centavos(Number(s));
  return Number.isSafeInteger(c) && c <= 10 ** 13 ? c : null;
}

/** Texto para inteiro positivo (quantidade), ou null. */
export function paraInteiro(texto) {
  const d = soDigitos(texto).slice(0, 9);
  return d ? Number(d) : null;
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Busca por código ou nome, sem acento. Código exato primeiro, depois começa com, contém, e nome. */
export function filtrarAtivos(lista, q, limite = 6) {
  const n = norm(String(q ?? '').trim());
  if (!n) return [];
  const pontos = (a) => {
    const c = norm(a.codigo), nome = norm(a.nome);
    return c === n ? 0 : c.startsWith(n) ? 1 : c.includes(n) ? 2 : nome.startsWith(n) ? 3 : nome.includes(n) ? 4 : -1;
  };
  return lista.map((a) => [pontos(a), a]).filter(([p]) => p >= 0)
    .sort((x, y) => x[0] - y[0] || x[1].codigo.localeCompare(y[1].codigo)).slice(0, limite).map(([, a]) => a);
}

/**
 * Campos do formulário (textos) -> transação para adicionarTransacao. Campo vazio fica de fora:
 * quem diz o que falta, em tom de ajuda, é posicoes.validar.
 */
export function montarTransacao({ tipo, data, ativo, qtd, preco, taxas, valor }) {
  const t = { tipo, data };
  const cod = String(ativo ?? '').trim().toUpperCase();
  if (COM_ATIVO.includes(tipo) && cod) t.ativo = cod;
  if (COM_COTAS.includes(tipo)) {
    const q = paraInteiro(qtd), p = paraCentavos(preco);
    if (q) t.qtd = q;
    if (p) t.preco = p;
    const x = paraCentavos(taxas);
    if (x) t.taxas = x;
  } else {
    const v = paraCentavos(valor);
    if (v) t.valor = v;
  }
  return t;
}

/** Frase do aviso depois de registrar (sem comemoração). */
export function resumoRegistro(t) {
  const nome = TIPOS.find(([id]) => id === t.tipo)?.[1] ?? 'Movimentação';
  const reg = t.tipo === 'deposito' || t.tipo === 'provento' ? 'registrado' : 'registrada';
  if (COM_COTAS.includes(t.tipo)) return `${nome} ${reg}: ${t.qtd} × ${t.ativo} a ${formatarCentavos(t.preco)}.`;
  return `${nome} ${reg}: ${formatarCentavos(t.valor)}${t.ativo ? ` de ${t.ativo}` : ''}.`;
}

/** Total estimado de uma compra/venda: qtd × preço, mais taxas na compra e menos taxas na venda. null se faltar dado. */
export function totalEstimado({ tipo, qtd, preco, taxas }) {
  const q = paraInteiro(qtd), p = paraCentavos(preco);
  if (!COM_COTAS.includes(tipo) || !q || !p) return null;
  const x = paraCentavos(taxas) ?? 0;
  try { return mulDiv(q, p, 1) + (tipo === 'compra' ? x : tipo === 'venda' ? -x : 0); } catch { return null; }
}

// ---------- preços atuais (uma lista só para todo o app) ----------

let voo = null;
/**
 * Lista de ativos com preço (brapi, uma ou duas requisições, nunca uma por ativo). Mesma regra do Mercado:
 * pregão aberto vale o intervalo das preferências; fechado vale o cache de 12 h. `primeira`: lê do cache, sem esperar rede.
 * Chamadas ao mesmo tempo dividem a mesma busca.
 */
export function listaDePrecos(ctx, { primeira = false } = {}) {
  const aberto = ctx.estado().state !== 'fechado';
  const ttlMs = !primeira && aberto ? prefs().cotacaoSegundos * 1000 : 12 * 3600_000;
  voo ??= listarAtivos({ ttlMs }).finally(() => { voo = null; });
  return voo;
}

// ---------- painel ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let sessaoAtual = null;

/**
 * Abre o painel de registro. `tipo`: compra | venda | deposito | retirada | transferencia | provento. `ativo`: código já escolhido.
 * Reaproveita o <dialog> do app (ctx.sheet), então vale tanto a partir da Home quanto de dentro do modal do ativo.
 */
export function abrirRegistro(ctx, { tipo = 'compra', ativo = '' } = {}) {
  const dlg = ctx.sheet, body = dlg.querySelector('#sheetBody'), titulo = dlg.querySelector('#sheetTitulo');
  const sessao = (sessaoAtual = {});
  const vivo = () => sessaoAtual === sessao && dlg.open;
  const est = { tipo: TIPOS.some(([id]) => id === tipo) ? tipo : 'compra', ativo: String(ativo).toUpperCase(), qtd: '', preco: '', taxas: '', valor: '', data: hojeIso(), precoManual: false };
  let lista = [], estadoLista = 'carregando', savedAt = null; // 'carregando' | 'ok' | 'erro'
  const nomeTipo = () => TIPOS.find(([id]) => id === est.tipo)[1];

  body.removeAttribute('aria-busy');
  body.innerHTML = `
    <div class="chips" role="group" aria-label="Tipo de movimentação">${TIPOS.map(([id, n]) => `<button type="button" class="chip" data-tipo="${id}" aria-pressed="${id === est.tipo}">${n}</button>`).join('')}</div>
    <form class="reg" id="regForm" novalidate>
      <div class="reg__campos" id="regCampos"></div>
      <p class="reg__total" id="regTotal" aria-live="polite"></p>
      <div id="regErros" role="alert"></div>
      <button class="btn btn--block" type="submit" id="regOk"></button>
    </form>`;
  if (!dlg.open) dlg.showModal();

  const $ = (s) => body.querySelector(s);
  const campos = $('#regCampos');

  const heldCodigos = () => [...calcular(ler().transacoes).posicoes.keys()];
  const achar = (cod) => lista.find((a) => a.codigo === cod);

  function pintarTitulo() {
    titulo.textContent = `Registrar ${nomeTipo().toLowerCase()}`;
    $('#regOk').textContent = `Registrar ${nomeTipo().toLowerCase()}`;
    body.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tipo === est.tipo));
  }

  function pintarCampos() {
    const t = est.tipo, cot = COM_COTAS.includes(t);
    campos.innerHTML = [
      COM_ATIVO.includes(t) && `<div class="field"><label for="rAtivo">Ativo (código ou nome)</label>
        <input id="rAtivo" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" value="${esc(est.ativo)}" aria-describedby="rRef">
        <ul class="reg-sug" id="rSug" aria-label="Sugestões de ativos" hidden></ul><p class="field__hint" id="rRef"></p></div>`,
      cot && `<div class="reg__duo">
        <div class="field"><label for="rQtd">Quantidade</label><input id="rQtd" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="0" value="${esc(est.qtd)}"></div>
        <div class="field"><label for="rPreco">${t === 'transferencia' ? 'Preço médio de origem' : 'Preço por cota'}</label><input id="rPreco" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(est.preco)}"></div></div>`,
      (t === 'compra' || t === 'venda') && `<div class="field"><label for="rTaxas">Taxas (opcional)</label><input id="rTaxas" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(est.taxas)}"></div>`,
      !cot && `<div class="field"><label for="rValor">${t === 'provento' ? 'Valor recebido' : 'Valor'}</label><input id="rValor" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(est.valor)}"></div>`,
      `<div class="field"><label for="rData">Data</label><input id="rData" type="date" max="${hojeIso()}" value="${est.data}"></div>`,
      t === 'transferencia' && '<p class="field__hint">Para cotas que já eram suas em outra corretora. Entram na carteira com o preço médio que você informar.</p>',
    ].filter(Boolean).join('');
    pintarTitulo(); pintarRef(); pintarTotal();
  }

  // sugestões: o que a pessoa digitou; em venda e provento, sem texto, os ativos que ela tem
  function pintarSugestoes() {
    const ul = $('#rSug'); if (!ul) return;
    const q = est.ativo.trim();
    let itens = filtrarAtivos(lista, q);
    if (!q && (est.tipo === 'venda' || est.tipo === 'provento')) itens = heldCodigos().map((c) => achar(c) ?? { codigo: c });
    if (itens.length === 1 && itens[0].codigo === q.toUpperCase()) itens = []; // já escolhido
    ul.innerHTML = itens.map((a) => `<li><button type="button" class="reg-sug__item" data-c="${esc(a.codigo)}"><span class="reg-sug__nome"><b>${esc(a.codigo)}</b> <span class="muted">${esc(a.nome)}</span></span>${a.preco != null ? `<span class="num">${formatarCentavos(centavos(a.preco))}</span>` : ''}</button></li>`).join('');
    ul.hidden = !itens.length;
  }

  // linha de apoio embaixo do ativo: nome, preço de referência com fonte e horário, ou o estado da lista
  function pintarRef() {
    const el = $('#rRef'); if (!el) return;
    const a = achar(est.ativo.trim().toUpperCase());
    if (a) el.textContent = `${a.nome ?? ''}${a.preco != null ? ` · preço de referência ${formatarCentavos(centavos(a.preco))} (brapi, ${fmtQuando(new Date(savedAt))})` : ''}`;
    else el.textContent = estadoLista === 'carregando' ? 'Buscando os preços atuais…'
      : estadoLista === 'erro' ? 'Sem a lista de preços agora. Digite o código e o preço que você pagou.' : '';
  }

  // código reconhecido: preenche o preço atual (compra e venda), a menos que a pessoa já tenha mexido nele
  function aplicarPreco() {
    const a = achar(est.ativo.trim().toUpperCase());
    if (!a || a.preco == null || est.precoManual || !(est.tipo === 'compra' || est.tipo === 'venda')) return;
    est.preco = formatarCentavos(centavos(a.preco));
    const inp = $('#rPreco'); if (inp) inp.value = est.preco;
  }

  function pintarTotal() {
    const tot = totalEstimado(est);
    $('#regTotal').textContent = tot == null ? '' : `Total ${est.tipo === 'venda' ? 'a receber' : 'da operação'}: ${formatarCentavos(tot)}`;
  }

  function escolher(cod) {
    est.ativo = cod;
    const inp = $('#rAtivo'); inp.value = cod;
    aplicarPreco(); pintarSugestoes(); pintarRef(); pintarTotal();
    ($('#rQtd') ?? $('#rValor'))?.focus();
  }

  function erros(lista_) {
    $('#regErros').innerHTML = lista_.map((m) => `<p class="field__error">${icon('alert', 16)}<span>${esc(m)}</span></p>`).join('');
    if (lista_.length) $('#regErros').scrollIntoView({ block: 'center', behavior: 'auto' }); // com o botão fixo embaixo, o aviso não pode ficar fora da vista
  }

  // ---------- eventos ----------
  body.querySelector('.chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tipo]'); if (!b) return;
    est.tipo = b.dataset.tipo; erros([]); pintarCampos(); pintarSugestoes();
  });
  campos.addEventListener('input', (e) => {
    const id = e.target.id, v = e.target.value;
    if (id === 'rAtivo') { est.ativo = v; pintarSugestoes(); aplicarPreco(); pintarRef(); }
    else if (id === 'rQtd') { e.target.value = est.qtd = String(soDigitos(v).slice(0, 9)); }
    else if (id === 'rPreco') { e.target.value = est.preco = mascaraReais(v); est.precoManual = true; }
    else if (id === 'rTaxas') { e.target.value = est.taxas = mascaraReais(v); }
    else if (id === 'rValor') { e.target.value = est.valor = mascaraReais(v); }
    else if (id === 'rData') est.data = v;
    pintarTotal(); erros([]);
  });
  campos.addEventListener('focusin', (e) => { if (e.target.id === 'rAtivo') pintarSugestoes(); });
  campos.addEventListener('click', (e) => { const b = e.target.closest('.reg-sug__item'); if (b) escolher(b.dataset.c); });
  campos.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'rAtivo') return;
    e.preventDefault(); // Enter no ativo escolhe a primeira sugestão (ou segue para o próximo campo)
    const primeira = $('#rSug .reg-sug__item');
    if (primeira) escolher(primeira.dataset.c); else ($('#rQtd') ?? $('#rValor'))?.focus();
  });

  $('#regForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = montarTransacao(est);
    // código que não está na lista da B3 (e não é de um ativo que a pessoa já tem): provável erro de digitação
    if (t.ativo && estadoLista === 'ok' && !achar(t.ativo) && !heldCodigos().includes(t.ativo)) {
      erros([`Não encontrei ${t.ativo} na lista da B3. Confira o código ou escolha uma das sugestões.`]);
      $('#rAtivo')?.focus(); return;
    }
    const r = adicionarTransacao(t);
    if (r.ok === false) { erros(r.erros); return; }
    dlg.close();
    aviso(`${resumoRegistro(t)}${r.semArmazenamento ? ' O navegador não deixou gravar: vale só até fechar esta aba.' : ''}`, r.desfazer);
  });

  pintarCampos();
  const primeiro = !est.ativo && COM_ATIVO.includes(est.tipo) ? '#rAtivo' : COM_COTAS.includes(est.tipo) ? '#rQtd' : '#rValor';
  $(primeiro)?.focus();

  // preços chegam depois: o painel já está usável
  listaDePrecos(ctx).then((r) => {
    if (!vivo()) return;
    lista = r.data ?? []; savedAt = r.savedAt; estadoLista = lista.length ? 'ok' : 'erro';
    aplicarPreco(); pintarRef(); pintarTotal(); pintarSugestoes();
  });
}
