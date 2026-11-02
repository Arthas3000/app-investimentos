// Casca do app: rotas por hash, navegação, faixa do pregão. Cada tela é um módulo que devolve uma função de limpeza.
import { icon } from './ui/icons.js';
import { prepararPainel } from './ui/kit.js';
import { estadoPregao, textoPregao } from './data/pregao.js';
import { feriados } from './data/feriados.js';
import * as mercado from './views/mercado.js';
import { aplicarTema } from './data/store.js';
import { oferecerTour } from './ui/tour.js';

aplicarTema(); // tema salvo, antes de qualquer tela montar (evita piscar claro/escuro)

const $ = (s) => document.querySelector(s);
const ABAS = [
  ['home', 'Home', 'home'], ['carteira', 'Carteira', 'wallet'], ['mercado', 'Mercado', 'market'],
  ['simulador', 'Simulador', 'sim'], ['historico', 'Histórico', 'history'],
];

const SEM_ABA = { aporte: 'Aporte', seumes: 'Seu mês', descobrir: 'Descobrir' }; // rotas fora da barra: #aporte (a aba Home continua marcada)
const nomeDe = (id) => ABAS.find(([a]) => a === id)?.[1] ?? SEM_ABA[id] ?? 'Ajustes';

// ---- contexto compartilhado ----
const ctx = {
  feriados: [], ultimaCotacao: null, sheet: $('#sheet'),
  definirUltimaCotacao(d) { ctx.ultimaCotacao = d; pintarPregao(); },
  estado: () => estadoPregao({ now: new Date(), feriados: ctx.feriados, ultimaCotacao: ctx.ultimaCotacao }),
};

function pintarPregao() {
  const e = ctx.estado();
  $('#mkt').dataset.state = e.state;
  $('#mktTxt').textContent = textoPregao(e);
}
setInterval(pintarPregao, 30_000);
feriados(new Date().getFullYear()).then((r) => { ctx.feriados = r.data ?? []; pintarPregao(); });

// ---- navegação ----
$('#nav').innerHTML = ABAS.map(([id, nome, ic]) => `<a href="#${id}" data-id="${id}">${icon(ic, 22)}<span>${nome}</span></a>`).join('');
$('#gear').innerHTML = icon('gear', 22);
$('#voltar').innerHTML = icon('chevronRight', 22); // espelhado no CSS
// Voltar: vai para a última tela diferente da atual (abrir e fechar o modal de um ativo não conta); sem uma, a Home.
let anterior = null, telaAtual = null;
$('#voltar').onclick = () => { location.hash = `#${anterior && anterior !== telaAtual ? anterior : 'home'}`; };
$('#sheetFecha').innerHTML = icon('x');
prepararPainel(ctx.sheet);
$('#sheetFecha').onclick = () => ctx.sheet.close();
// fechar o painel volta para a lista de onde ele abriu (#mercado ou #descobrir; a lista nunca é destruída, então a rolagem fica)
ctx.sheet.addEventListener('close', () => { if (location.hash.includes('/ativo/')) history.replaceState(null, '', location.hash.replace(/\/ativo\/.*$/, '')); });

// Mercado é estático (tela inicial histórica); as demais carregam sob demanda. Se o arquivo da tela não existir
// ou falhar, cai no estado "chega em breve" sem quebrar o app (e tenta de novo na próxima visita).
const VIEWS = { mercado };
const CARREGAR = {
  home: () => import('./views/home.js'),
  carteira: () => import('./views/carteira.js'),
  historico: () => import('./views/historico.js'),
  aporte: () => import('./views/aporte.js'),
  simulador: () => import('./views/simulador.js'),
  ajustes: () => import('./views/ajustes.js'),
  seumes: () => import('./views/seumes.js'),
  descobrir: () => import('./views/descobrir.js'),
};
let limpar = null;
let fila = Promise.resolve(); // hashchanges em sequência: a montagem assíncrona nunca se atropela

async function carregar(id) {
  if (VIEWS[id]) return VIEWS[id];
  try { return (VIEWS[id] = await CARREGAR[id]?.()); } catch { return null; }
}

let primeira = true;
async function ir(id, resto) {
  const trocou = ctx.atual !== id && !primeira;
  primeira = false;
  if (ctx.atual !== id) {
    limpar?.(); limpar = null; ctx.atual = id;
    const v = await carregar(id);
    if (ctx.atual !== id) return; // a pessoa já foi para outra aba enquanto carregava
    if (v) limpar = v.montar($('#view'), ctx);
    else $('#view').innerHTML = `<div class="card empty">${icon('target', 40)}<h3>${nomeDe(id)}</h3><p>Esta tela chega em uma das próximas etapas.</p><a class="btn" href="#mercado">Ver o Mercado</a></div>`;
  }
  if (trocou) $('#titulo').focus({ preventScroll: true }); // leitor de tela anuncia a nova tela; sem rolar
  VIEWS[id]?.rota?.(resto, ctx);
}

function rota() {
  if (!location.hash) history.replaceState(null, '', '#home'); // sem hash: Home
  const [aba = 'home', ...resto] = location.hash.slice(1).split('/');
  const id = ABAS.some(([a]) => a === aba) || Object.hasOwn(SEM_ABA, aba) ? aba : aba === 'ajustes' ? 'ajustes' : 'home';
  const marcada = Object.hasOwn(SEM_ABA, id) ? 'home' : id;
  document.querySelectorAll('#nav a').forEach((a) => (a.dataset.id === marcada ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#titulo').textContent = nomeDe(id);
  if (id !== telaAtual) { anterior = telaAtual; telaAtual = id; }
  $('#voltar').hidden = !(Object.hasOwn(SEM_ABA, id) || id === 'ajustes'); // telas fora da barra de abas
  document.title = `${nomeDe(id)} · Meus aportes`;
  fila = fila.then(() => ir(id, resto)).catch((e) => console.error(e)); // um erro numa tela não trava as próximas
}
$('#skip').onclick = (e) => { e.preventDefault(); $('#view').focus(); }; // href="#view" mudaria o hash e a rota
addEventListener('hashchange', rota);
rota();
pintarPregao();
oferecerTour(); // primeiro acesso: convite discreto, uma única vez
