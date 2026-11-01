// Simulador (#simulador): 1 montar a carteira › 2 resultado (#simulador/resultado). Material educacional: dados passados,
// nunca previsão nem recomendação. A lógica pura (período, pesos, validação, gráfico, formatação) fica em core/simulador-entrada.js.
import { icon } from '../ui/icons.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { aviso } from '../ui/kit.js';
import { mascaraReais, filtrarAtivos, listaDePrecos, formatarCentavos, soDigitos } from '../ui/registrar.js';
import { ler } from '../data/carteira.js';
import { visaoCarteira } from '../core/carteira-calc.js';
import { centavos } from '../core/money.js';
import { carregarPrecos } from '../data/dados.js';
import { SERIES, desde } from '../data/bcb.js';
import { fmtQuando } from '../data/pregao.js';
import { simular } from '../core/simulador.js';
import {
  MAX_ATIVOS, PERIODOS, ESTRATEGIAS, NOMES, estadoInicial, limparEstado, periodoDe, isoDe, fmtData, duracaoTexto,
  pesosIguaisTexto, pesosDaCarteiraTexto, somaPesos, validar, fmtRetorno, fmtQueda, fmtGanho, quadro, grafico, indicesTabela,
  descricaoGrafico, fmtCompacto,
} from '../core/simulador-entrada.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const R = formatarCentavos;

// ---------- escolhas guardadas ----------
// Vivem no módulo (voltar do resultado ou trocar de aba não perde nada) e em localStorage (sobrevivem a recarregar a página).
const CHAVE = 'simulador.cfg.v1';
let S = null;
const lerSalvo = () => { try { return limparEstado(JSON.parse(localStorage.getItem(CHAVE))); } catch { return estadoInicial(); } };
const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(S)); } catch { /* sem armazenamento: vale só nesta visita */ } };

let inst = null; // tela montada, para a rota #simulador/resultado
export const rota = (partes) => inst?.rota(partes);

// ---------- dados ----------
const hist = new Map(); // ticker -> {d, p} (só sucesso; falha tenta de novo)
/** Histórico de preços de um ativo (dados/precos/T.json): {d,p} ou {motivo:'ausente'|'erro'}. */
async function historico(t) {
  if (hist.has(t)) return hist.get(t);
  const r = await carregarPrecos(t);
  if (r.data?.d?.length) { hist.set(t, r.data); return r.data; }
  return { motivo: r.ausente ? 'ausente' : 'erro' };
}

/** CDI/IPCA do BCB desde `inicio` (início do mês), no formato que a tela usa. */
async function bcb(serie, inicio) {
  const r = await desde(serie, `${inicio.slice(0, 7)}-01`);
  return r.data?.length ? { dados: r.data, savedAt: r.savedAt, stale: r.stale } : { dados: null, erro: r.error };
}

const ESTILO = { carteira: 'cheia', ibov: 'tracejada', cdi: 'pontilhada', ipca: 'traço e ponto' };

// ---------- tela ----------
export function montar(root, ctx) {
  S ??= lerSalvo();
  let vivo = true, passo = 'montar', corrida = 0, empilhou = false, buscaAtual = 0;
  const D = { base: 'carregando', ibov: null, lista: [], listaEstado: 'carregando', savedAt: null, erroBase: null };
  root.innerHTML = '<div class="sim" id="simRaiz"></div>';
  const raiz = root.querySelector('#simRaiz');
  const $ = (s) => raiz.querySelector(s);
  const soltarAjuda = ligarAjuda(root, ctx);

  const dados = () => (D.ibov ? {
    primeira: isoDe(D.ibov.d[0]), ultima: isoDe(D.ibov.d.at(-1)),
    primeirasAtivos: S.ativos.map((a) => hist.get(a.ticker)?.d?.[0]).filter(Boolean).map(isoDe),
  } : {});
  const nomeDe = (t) => D.lista.find((a) => a.codigo === t)?.nome ?? S.ativos.find((a) => a.ticker === t)?.nome ?? '';

  async function carregarBase() {
    D.base = 'carregando'; D.listaEstado = 'carregando';
    if (passo === 'montar') pintarMontar();
    const [b, l] = await Promise.all([carregarPrecos('BOVA11'), listaDePrecos(ctx).catch((error) => ({ data: null, error }))]);
    if (!vivo) return;
    D.lista = l.data ?? []; D.listaEstado = D.lista.length ? 'ok' : 'erro'; D.savedAt = l.savedAt;
    if (b.data?.d?.length) { D.ibov = b.data; D.base = 'ok'; } else { D.base = b.ausente ? 'ausente' : 'erro'; D.erroBase = b.erro ?? null; }
    if (passo === 'montar') pintarMontar();
    // ativos guardados da última vez: busca o início do histórico de cada um (para "desde o início" e para avisar se sumiu)
    if (D.base === 'ok') await Promise.all(S.ativos.map((a) => historico(a.ticker)));
    if (vivo && passo === 'montar') { pintarAtivos(); pintarPeriodo(); }
  }

  // ---------- passo 1: montar ----------
  function avisosBase() {
    if (D.base === 'carregando') return '<div class="notice" role="status"><span>Carregando o histórico de preços…</span></div>';
    if (D.base === 'ausente') return '';
    if (D.base === 'erro') return `<div class="notice" role="alert">${icon('wifiOff')}<span>Não consegui ler o histórico de preços${navigator.onLine === false ? ': sem conexão' : ''}. <button type="button" class="btn btn--quiet" id="simTentar">Tentar de novo</button></span></div>`;
    return D.listaEstado === 'erro' ? `<div class="notice" role="status">${icon('wifiOff')}<span>Sem a lista de ativos agora (brapi). Digite o código exato do ativo para adicioná-lo.</span></div>` : '';
  }

  const edu = '<p class="sim-edu">Simulação com dados passados; não é previsão nem recomendação.</p>';

  function pintarMontar() {
    if (D.base === 'ausente') {
      raiz.innerHTML = `<div class="card empty">${icon('trend', 40)}<h2 id="simTit" tabindex="-1">Ainda não há histórico de preços</h2>
        <p>O simulador usa os arquivos de preços do app (pasta dados/precos), que ainda não foram gerados. Quando existirem, esta tela passa a funcionar.</p>
        <a class="btn" href="#mercado">Ver o Mercado</a></div>${edu}`;
      return;
    }
    const pronta = D.base === 'ok';
    raiz.innerHTML = `
      <h2 class="sim-h" id="simTit" tabindex="-1">Simulador de carteira</h2>
      ${passos('montar')}
      <p class="muted sim-intro">Veja como uma carteira teria se saído no passado, em comparação com o Ibovespa, o CDI e a inflação (IPCA). É um exercício para entender, não uma promessa.</p>
      <div id="simAvisos" class="sim-avisos">${avisosBase()}</div>

      <section class="card sim-card" aria-labelledby="simH1">
        <h3 id="simH1">1. Ativos e pesos</h3>
        <div class="home-btns"><button type="button" class="btn btn--ghost" id="simMinha"${pronta ? '' : ' disabled'}>Usar minha carteira</button></div>
        <div class="field"><label for="simBusca">Adicionar ativo (código ou nome)</label>
          <div class="search"><span>${icon('search', 20)}</span><input id="simBusca" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" aria-describedby="simMsg"${pronta ? '' : ' disabled'}></div>
          <ul class="reg-sug" id="simSug" aria-label="Sugestões de ativos" hidden></ul>
          <p class="field__hint" id="simMsg" role="status"></p></div>
        <ul class="sim-ativos" id="simAtivos"></ul>
        <div id="simSoma" class="sim-soma" aria-live="polite"></div>
      </section>

      <section class="card sim-card" aria-labelledby="simH2">
        <h3 id="simH2">2. Aportes</h3>
        <div class="field"><label for="simInicial">Aporte inicial (opcional)</label><input id="simInicial" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(S.inicial)}"></div>
        <div class="reg__duo">
          <div class="field"><label for="simMensal">Aporte mensal (opcional)</label><input id="simMensal" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(S.mensal)}"></div>
          <div class="field"><label for="simDia">Dia do mês (1 a 31)</label><input id="simDia" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="5" value="${esc(S.dia)}"></div>
        </div>
        <p class="field__hint">O aporte inicial entra no primeiro pregão do período. Os mensais entram no primeiro pregão em ou depois do dia escolhido, a partir do mês seguinte.</p>
      </section>

      <section class="card sim-card" aria-labelledby="simH3">
        <h3 id="simH3">3. Período</h3>
        <div class="chips" role="group" aria-label="Período da simulação">${PERIODOS.map((p) => `<button type="button" class="chip" data-per="${p.id}" aria-pressed="${p.id === S.periodo}">${p.rotulo}</button>`).join('')}</div>
        <p class="field__hint" id="simPer" aria-live="polite"></p>
      </section>

      <section class="card sim-card" aria-labelledby="simH4">
        <h3 id="simH4">4. Custos e estratégia</h3>
        <div class="field"><label for="simTaxa">Taxa por ordem de compra ou venda (opcional)</label><input id="simTaxa" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${esc(S.taxa)}"></div>
        <fieldset class="sim-estr"><legend>Como a carteira acompanha os pesos</legend>
          ${ESTRATEGIAS.map((e) => `<label class="sim-radio"><input type="radio" name="simEstr" value="${e.id}"${e.id === S.estrategia ? ' checked' : ''}><span><strong>${e.rotulo}</strong><span class="muted">${e.frase}</span></span></label>`).join('')}
        </fieldset>
      </section>

      <div id="simErros" role="alert"></div>
      <button type="button" class="btn btn--block" id="simGo"${pronta ? '' : ' disabled'}>Simular</button>
      ${edu}`;
    pintarAtivos(); pintarPeriodo();
  }

  function passos(atual) {
    return `<ol class="sim-passos" aria-label="Passos da simulação"><li ${atual === 'montar' ? 'aria-current="step"' : ''}><span class="sim-passos__n">1</span>Montar<span class="sr-only">${atual === 'montar' ? ' (passo atual)' : ''}</span></li><li ${atual === 'resultado' ? 'aria-current="step"' : ''}><span class="sim-passos__n">2</span>Resultado<span class="sr-only">${atual === 'resultado' ? ' (passo atual)' : ''}</span></li></ol>`;
  }

  const msg = (t) => { const el = $('#simMsg'); if (el) el.textContent = t; };

  function pintarAtivos() {
    const ul = $('#simAtivos'); if (!ul) return;
    ul.innerHTML = S.ativos.length ? S.ativos.map((a) => {
      const h = hist.get(a.ticker), n = nomeDe(a.ticker);
      return `<li class="sim-ativo"><div class="sim-ativo__id"><strong>${esc(a.ticker)}</strong>${n ? `<span class="muted sim-ativo__nome">${esc(n)}</span>` : ''}
        <span class="src">${h ? `Preços desde ${fmtData(isoDe(h.d[0]))}` : D.base === 'ok' ? 'Histórico ainda não conferido' : ''}</span></div>
        <div class="sim-pct"><label class="sr-only" for="simP-${esc(a.ticker)}">Peso de ${esc(a.ticker)}, em porcentagem</label>
          <input id="simP-${esc(a.ticker)}" data-peso="${esc(a.ticker)}" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(a.peso)}"><span aria-hidden="true">%</span></div>
        <button type="button" class="icon-btn" data-rem="${esc(a.ticker)}" aria-label="Remover ${esc(a.ticker)}">${icon('x', 20)}</button></li>`;
    }).join('') : `<li class="sim-vazio muted">Nenhum ativo ainda. Busque um ativo acima ou use os da sua Carteira.</li>`;
    pintarSoma();
  }

  function pintarSoma() {
    const el = $('#simSoma'); if (!el) return;
    if (!S.ativos.length) { el.innerHTML = ''; return; }
    const s = somaPesos(S.ativos), n = (x) => x.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    const t = s.ok ? `Soma dos pesos: 100%. Está certo.` : s.falta > 0 ? `Soma dos pesos: ${n(s.soma)}%. Faltam ${n(s.falta)} pontos para 100%.` : `Soma dos pesos: ${n(s.soma)}%. Passou ${n(-s.falta)} pontos de 100%.`;
    el.innerHTML = `<p class="sim-soma__t">${icon(s.ok ? 'check' : 'alert', 18)}<span>${t}</span></p>${S.ativos.length > 1 ? '<button type="button" class="btn btn--quiet" id="simIguais">Pesos iguais</button>' : ''}`;
  }

  function pintarPeriodo() {
    const el = $('#simPer'); if (!el) return;
    root.querySelectorAll('[data-per]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.per === S.periodo));
    const d = dados();
    if (!d.primeira) { el.textContent = D.base === 'carregando' ? 'Carregando o histórico de preços…' : ''; return; }
    const p = periodoDe(S.periodo, d);
    el.textContent = `De ${fmtData(p.inicio)} a ${fmtData(p.fim)} (${duracaoTexto(p.inicio, p.fim)}). ${p.limitado ? `Os preços do app começam em ${fmtData(d.primeira)}, então o período começou aí. ` : ''}Dados de preço até ${fmtData(d.ultima)}.`;
  }

  function sugestoes() {
    const ul = $('#simSug'), inp = $('#simBusca'); if (!ul || !inp) return;
    const q = inp.value.trim().toUpperCase();
    const ja = new Set(S.ativos.map((a) => a.ticker));
    let itens = filtrarAtivos(D.lista, q, 8).filter((a) => !ja.has(a.codigo));
    // sem a lista da brapi (ou ativo fora dela): o código digitado vale, o app confere o histórico ao adicionar
    if (q && /^[A-Z0-9]{4,7}$/.test(q) && !ja.has(q) && !itens.some((a) => a.codigo === q)) itens = [...itens, { codigo: q, nome: 'adicionar este código' }];
    ul.innerHTML = itens.map((a) => `<li><button type="button" class="reg-sug__item" data-add="${esc(a.codigo)}"><span class="reg-sug__nome"><b>${esc(a.codigo)}</b> <span class="muted">${esc(a.nome ?? '')}</span></span></button></li>`).join('');
    ul.hidden = !itens.length;
  }

  const iguais = (ativos) => ativos.length > 0 && pesosIguaisTexto(ativos.map((a) => a.ticker)).every((p, k) => p.peso === ativos[k].peso);
  function equilibrar() { pesosIguaisTexto(S.ativos.map((a) => a.ticker)).forEach((p, k) => { S.ativos[k].peso = p.peso; }); }

  async function adicionar(cod, nome = '') {
    cod = cod.toUpperCase();
    if (S.ativos.some((a) => a.ticker === cod)) return msg(`${cod} já está na lista.`);
    if (S.ativos.length >= MAX_ATIVOS) return msg(`No máximo ${MAX_ATIVOS} ativos por simulação.`);
    const eu = ++buscaAtual;
    msg(`Conferindo o histórico de preços de ${cod}…`);
    const h = await historico(cod);
    if (!vivo || eu !== buscaAtual) return;
    if (h.motivo) return msg(h.motivo === 'ausente' ? `Não há histórico de preços de ${cod} nos arquivos do app, então não dá para simular com ele.` : `Não consegui ler o histórico de ${cod} agora (sem conexão?). Tente de novo.`);
    const eram = !S.ativos.length || iguais(S.ativos);
    S.ativos.push({ ticker: cod, nome: nome || nomeDe(cod), peso: '' });
    if (eram) equilibrar();
    gravar(); msg(`${cod} adicionado.`);
    const inp = $('#simBusca'); inp.value = ''; sugestoes(); pintarAtivos(); pintarPeriodo(); inp.focus();
  }

  async function usarMinha() {
    const precos = new Map(D.lista.filter((a) => a.preco > 0).map((a) => [a.codigo, centavos(a.preco)]));
    const v = visaoCarteira(ler(), precos);
    if (!v.itens.length) return msg('Você ainda não tem ativos na Carteira. Registre uma compra ou busque os ativos acima.');
    msg('Conferindo o histórico de preços dos seus ativos…');
    const itens = v.itens.slice(0, MAX_ATIVOS), hs = await Promise.all(itens.map((i) => historico(i.ativo)));
    if (!vivo) return;
    const com = itens.filter((_, k) => !hs[k].motivo), sem = itens.filter((_, k) => hs[k].motivo).map((i) => i.ativo);
    const pesos = pesosDaCarteiraTexto(com);
    if (!pesos.length) return msg(`Nenhum ativo da sua Carteira tem histórico de preços no app${sem.length ? ` (${sem.join(', ')})` : ''}.`);
    const antes = S.ativos;
    S.ativos = pesos.map((p) => ({ ...p, nome: nomeDe(p.ticker) }));
    gravar(); pintarAtivos(); pintarPeriodo();
    const base = precos.size && com.every((i) => Number.isFinite(i.valor)) ? `valor de hoje${D.savedAt ? ` (brapi, ${fmtQuando(new Date(D.savedAt))})` : ''}` : 'valor investido (sem preço atual)';
    msg(`Pesos da sua Carteira pelo ${base}.${sem.length ? ` Ficaram de fora, sem histórico de preços: ${sem.join(', ')}.` : ''}${v.itens.length > MAX_ATIVOS ? ` Só os ${MAX_ATIVOS} maiores entraram.` : ''}`);
    if (antes.length) aviso('Ativos substituídos pelos da sua Carteira.', () => { S.ativos = antes; gravar(); if (passo === 'montar') { pintarAtivos(); pintarPeriodo(); } });
  }

  function mostrarErros(erros) {
    const el = $('#simErros'); if (!el) return;
    el.innerHTML = erros.map((e) => `<p class="field__error">${icon('alert', 16)}<span>${esc(e.msg)}</span></p>`).join('');
    if (erros.length) el.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  function irMontar() {
    passo = 'montar'; corrida++;
    pintarMontar();
    raiz.querySelector('#simTit')?.focus();
  }

  function aoSimular() {
    const v = validar(S, dados());
    if (v.erros.length) return mostrarErros(v.erros);
    mostrarErros([]);
    empilhou = true;
    location.hash = '#simulador/resultado'; // vira rota(['resultado']) e o Voltar do navegador volta para montar
  }

  // ---------- passo 2: resultado ----------
  async function resultado() {
    const eu = ++corrida;
    passo = 'resultado';
    raiz.innerHTML = `${cabecalho()}<div class="sim-carregando" aria-busy="true"><p role="status" class="muted">Calculando a simulação…</p>
      <div class="skeleton sim-sk"></div><div class="skeleton sim-sk"></div><div class="skeleton sim-sk sim-sk--g"></div></div>`;
    raiz.querySelector('#simTit')?.focus();
    const falhou = (titulo, texto) => {
      if (eu !== corrida || !vivo) return;
      raiz.innerHTML = `${cabecalho()}<div class="card empty" role="alert">${icon('alert', 40)}<h3>${esc(titulo)}</h3><p>${esc(texto)}</p>
        <div class="home-btns"><button type="button" class="btn" id="simVoltar2">Ajustar a simulação</button><button type="button" class="btn btn--ghost" id="simRepetir">Tentar de novo</button></div></div>`;
      raiz.querySelector('#simTit')?.focus();
    };
    try {
      if (D.base === 'carregando') await carregarBase();
      if (eu !== corrida || !vivo) return;
      if (D.base !== 'ok') return falhou('Sem o histórico de preços', 'Não consegui ler os arquivos de preços do app. Confira a conexão e tente de novo.');
      const tickers = S.ativos.map((a) => a.ticker);
      const hs = await Promise.all(tickers.map(historico));
      const faltam = tickers.filter((_, k) => hs[k].motivo);
      if (faltam.length) return falhou('Faltam preços', `Sem histórico de preços para ${faltam.join(', ')}. Volte e remova ${faltam.length > 1 ? 'esses ativos' : 'esse ativo'}.`);
      const v = validar(S, dados());
      if (v.erros.length) { history.replaceState(null, '', '#simulador'); empilhou = false; irMontar(); return mostrarErros(v.erros); }
      const { periodo, ...args } = v.entrada;
      const [cdi, ipca] = await Promise.all([bcb(SERIES.cdi, args.inicio), bcb(SERIES.ipca, args.inicio)]);
      if (eu !== corrida || !vivo) return;
      await new Promise((r) => setTimeout(r, 0)); // deixa o esqueleto aparecer antes do cálculo (que roda em ~20 ms; passando de ~50 ms, trocar por um Worker)
      const t0 = performance.now();
      const res = simular({ ...args, precos: Object.fromEntries(tickers.map((t, k) => [t, hs[k]])), ibov: D.ibov, cdi: cdi.dados ?? [], ipca: ipca.dados ?? [] });
      const ms = performance.now() - t0;
      raiz.innerHTML = htmlResultado({ res, args, periodo, cdi, ipca, ms });
      raiz.dataset.ms = ms.toFixed(1);
      raiz.querySelector('#simTit')?.focus();
    } catch (e) {
      console.error(e);
      falhou('Não deu para simular', e instanceof RangeError ? e.message : 'Algo inesperado aconteceu. Volte, confira os campos e tente de novo.');
    }
  }

  function cabecalho() {
    return `<div class="sim-topo"><button type="button" class="btn btn--ghost sim-voltar" id="simVoltar">${icon('chevronRight', 18)}<span>Voltar e ajustar</span></button></div>
      <h2 class="sim-h" id="simTit" tabindex="-1">Resultado da simulação</h2>${passos('resultado')}`;
  }

  function htmlResultado({ res, args, periodo, cdi, ipca, ms }) {
    const temCdi = !!cdi.dados, temIpca = !!ipca.dados;
    const resumo = `${args.carteira.map((c) => `${esc(c.ticker)} ${c.pesoPct.toLocaleString('pt-BR')}%`).join(' · ')} · ${fmtData(args.inicio)} a ${fmtData(args.fim)} (${duracaoTexto(args.inicio, args.fim)}) · ${ESTRATEGIAS.find((e) => e.id === args.estrategia).rotulo.toLowerCase()}`;
    // sem a série, o aviso "sem dado em N pregões" só repete o que a faixa acima já diz
    res.avisos = res.avisos.filter((a) => !(!temCdi && a.startsWith('CDI sem dado')) && !(!temIpca && a.startsWith('IPCA sem dado')));
    const falta = [!temCdi && 'o CDI', !temIpca && 'o IPCA'].filter(Boolean);
    const notas = [
      falta.length ? `<div class="notice" role="status">${icon('wifiOff')}<span>Não consegui buscar ${falta.join(' e ')} no Banco Central${navigator.onLine === false ? ' (sem conexão)' : ''}. O resultado abaixo está sem ${falta.join(' e sem ')}${!temIpca ? '; sem o IPCA também não há retorno real' : ''}.</span></div>` : '',
      ...[['CDI', cdi], ['IPCA', ipca]].filter(([, x]) => x.stale).map(([n, x]) => `<div class="notice" role="status">${icon('clock')}<span>${n}: sem conexão agora, usei os últimos dados guardados, de ${fmtQuando(new Date(x.savedAt))}.</span></div>`),
    ].join('');
    if (!res.resumo) {
      return `${cabecalho()}<p class="muted sim-resumo">${resumo}</p>${notas}<div class="card empty">${icon('target', 40)}<h3>Sem pregões nesse período</h3><p>${esc(res.avisos.join(' '))}</p><button type="button" class="btn" id="simVoltar2">Ajustar a simulação</button></div>${edu}`;
    }
    const ids = ['carteira', 'ibov', temCdi && 'cdi', temIpca && 'ipca'].filter(Boolean);
    const q = quadro(res, { cdi: temCdi, ipca: temIpca }), c = q[0];
    const sinal = (f) => `<span class="${f > 0.00005 ? 'gain' : f < -0.00005 ? 'loss' : ''}">${fmtRetorno(f)}</span>`;
    const linha = (rot, val, ajuda = '') => `<div><dt>${rot}${ajuda}</dt><dd class="num">${val}</dd></div>`;
    const cartao = (r, primeiro) => `<section class="card sim-comp__c${primeiro ? ' sim-comp__c--eu' : ''}" aria-labelledby="simC-${r.id}"><h4 id="simC-${r.id}">${r.nome}</h4>
      <dl class="sim-kv">
        ${linha('Valor final', R(r.valorFinal))}${linha('Aportado', R(r.aportado))}${linha('Ganho', `<span class="${r.ganho > 0 ? 'gain' : r.ganho < 0 ? 'loss' : ''}">${fmtGanho(r.ganho)}</span>`)}
        ${linha('Retorno nominal (TWR)', sinal(r.twr), primeiro ? botaoAjuda('twr') : '')}
        ${temIpca ? linha('Retorno real (descontado o IPCA)', sinal(r.real), primeiro ? botaoAjuda('nominalReal') : '') : ''}
        ${linha('TWR ao ano', r.twrAnual == null ? '<span class="muted">só com 1 ano ou mais</span>' : sinal(r.twrAnual))}
        ${linha('XIRR ao ano', r.xirr == null ? '—' : sinal(r.xirr), primeiro ? botaoAjuda('xirr') : '')}
      </dl></section>`;

    const g = grafico(res.series, ids), W = 320, H = 140;
    const grade = g.grade.map((x) => `<path class="sim-grade" d="M0 ${x.y} L${W} ${x.y}"/>`).join('');
    const linhas = g.linhas.slice().reverse().map((l) => `<path class="sim-k sim-k--${l.id}" d="${l.d}"/>`).join(''); // carteira por cima
    const leg = ids.map((id) => `<li><svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true"><path class="sim-k sim-k--${id} sim-k--leg" d="M2 6 H38"/></svg><span>${NOMES[id]} <span class="muted">(${ESTILO[id]})</span></span></li>`).join('');
    const ti = indicesTabela(res.series.carteira);
    const tabela = `<table><caption class="sr-only">Valor de cada série em datas escolhidas, em reais</caption><thead><tr><th scope="col">Data</th>${ids.map((id) => `<th scope="col">${NOMES[id]}</th>`).join('')}<th scope="col">Aportado</th></tr></thead>
      <tbody>${ti.map((i) => `<tr><th scope="row">${fmtData(res.series.carteira[i].data)}</th>${ids.map((id) => `<td class="num">${R(res.series[id][i].valor)}</td>`).join('')}<td class="num">${R(res.series.carteira[i].aportadoAcum)}</td></tr>`).join('')}</tbody></table>`;

    const datasPrecos = fmtData(isoDe(D.ibov.d.at(-1)));
    const fonteBcb = [temCdi && 'CDI', temIpca && 'IPCA'].filter(Boolean);
    return `${cabecalho()}
      <p class="muted sim-resumo">${resumo}</p>${notas}
      ${res.avisos.length ? `<section class="card sim-avisos-s" aria-labelledby="simAv"><h3 id="simAv">${icon('alert', 20)} Atenção a estes pontos</h3><ul>${res.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>` : ''}
      <section class="card balance" aria-labelledby="simBal"><span class="balance__label" id="simBal">Valor final da carteira simulada</span>
        <span class="balance__value num">${R(c.valorFinal)}</span>
        <span class="balance__sub"><span>Aportado ${R(c.aportado)}</span><span>Ganho ${fmtGanho(c.ganho)}</span></span></section>
      <div class="sim-comp">${q.map((r, k) => cartao(r, k === 0)).join('')}</div>
      <p class="field__hint">Nominal é o retorno sem descontar a inflação; real é o retorno depois de descontar o IPCA do período. ${botaoAjuda('nominalReal')}
        O Ibovespa é representado pelo BOVA11, o CDI é o de um aplicador que rende 100% do CDI, e todos recebem os mesmos aportes nas mesmas datas.</p>

      <section class="card sim-card" aria-labelledby="simQ"><h3 id="simQ">Queda máxima da carteira ${botaoAjuda('quedaMaxima')}</h3>
        <p class="sim-v num">${fmtQueda(res.quedaMaxima)}</p>
        <p class="muted">A maior queda do valor da carteira, do topo até o fundo seguinte, sem contar o dinheiro que você colocou. Mostra o pior momento no passado; o futuro pode ser diferente.</p></section>

      <section class="card sim-graf" aria-labelledby="simG"><h3 id="simG">Evolução do valor</h3>
        <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(descricaoGrafico(res.series, ids, R))}">${grade}${linhas}</svg>
        <div class="sim-graf__eixo muted"><span>${fmtData(g.inicio)}</span><span>${fmtData(g.fim)}</span></div>
        <ul class="sim-leg" aria-label="Legenda">${leg}</ul>
        <p class="src">Linhas de grade em ${g.grade.map((x) => fmtCompacto(x.valor)).join(', ')}. O valor inclui o que foi aportado.</p>
        <details class="sim-det"><summary>Ver os valores em tabela</summary><div class="sim-tab">${tabela}</div></details></section>

      <section class="card sim-card" aria-labelledby="simPre"><h3 id="simPre">Premissas desta simulação</h3>
        <ul class="sim-prem">${res.premissas.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>

      <p class="src sim-fonte">Preços: fechamento da B3, arquivos dados/precos do app, até ${datasPrecos}.${fonteBcb.length ? ` ${fonteBcb.join(' e ')}: Banco Central (séries SGS ${[temCdi && SERIES.cdi, temIpca && SERIES.ipca].filter(Boolean).join(' e ')}), guardados ${fmtQuando(new Date(Math.min(...[temCdi && cdi.savedAt, temIpca && ipca.savedAt].filter(Boolean))))}.` : ''} Cálculo feito em ${ms.toFixed(0)} ms neste aparelho.</p>
      ${edu}
      <button type="button" class="btn btn--ghost btn--block" id="simVoltar2">Ajustar a simulação</button>`;
  }

  // ---------- eventos ----------
  const aoClicar = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add) adicionar(b.dataset.add, D.lista.find((a) => a.codigo === b.dataset.add)?.nome);
    else if (b.dataset.rem) {
      const eram = iguais(S.ativos);
      S.ativos = S.ativos.filter((a) => a.ticker !== b.dataset.rem);
      if (eram && S.ativos.length) equilibrar();
      gravar(); pintarAtivos(); pintarPeriodo(); sugestoes(); $('#simBusca')?.focus();
    } else if (b.dataset.per) { S.periodo = b.dataset.per; gravar(); pintarPeriodo(); }
    else if (b.id === 'simIguais') { equilibrar(); gravar(); pintarAtivos(); $('#simIguais')?.focus(); }
    else if (b.id === 'simMinha') usarMinha();
    else if (b.id === 'simGo') aoSimular();
    else if (b.id === 'simTentar') carregarBase();
    else if (b.id === 'simRepetir') resultado();
    else if (b.id === 'simVoltar' || b.id === 'simVoltar2') {
      if (empilhou) { empilhou = false; history.back(); } else { history.replaceState(null, '', '#simulador'); irMontar(); }
    }
  };
  const aoDigitar = (e) => {
    const t = e.target, id = t.id;
    if (id === 'simBusca') return sugestoes();
    if (t.dataset.peso) { t.value = t.value.replace(/[^\d.,]/g, '').slice(0, 6); S.ativos.find((a) => a.ticker === t.dataset.peso).peso = t.value; pintarSoma(); }
    else if (id === 'simInicial') t.value = S.inicial = mascaraReais(t.value);
    else if (id === 'simMensal') t.value = S.mensal = mascaraReais(t.value);
    else if (id === 'simTaxa') t.value = S.taxa = mascaraReais(t.value);
    else if (id === 'simDia') t.value = S.dia = soDigitos(t.value).slice(0, 2);
    else if (t.name === 'simEstr') S.estrategia = t.value;
    else return;
    gravar(); mostrarErros([]);
  };
  const aoTeclar = (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'simBusca') return;
    e.preventDefault();
    const primeiro = $('#simSug .reg-sug__item');
    if (primeiro) adicionar(primeiro.dataset.add, D.lista.find((a) => a.codigo === primeiro.dataset.add)?.nome);
  };
  root.addEventListener('click', aoClicar);
  root.addEventListener('input', aoDigitar);
  root.addEventListener('change', aoDigitar);
  root.addEventListener('keydown', aoTeclar);
  root.addEventListener('focusin', (e) => { if (e.target.id === 'simBusca') sugestoes(); });

  inst = {
    rota(partes) {
      const quer = partes[0] === 'resultado';
      if (quer && passo !== 'resultado') {
        const v = validar(S, dados());
        // recarregou direto em #simulador/resultado: sem dados ainda, o resultado() espera a base; com campos inválidos volta para montar
        if (D.base === 'ok' && v.erros.length) { history.replaceState(null, '', '#simulador'); irMontar(); mostrarErros(v.erros); } else resultado();
      } else if (!quer && passo === 'resultado') irMontar();
    },
  };

  pintarMontar();
  carregarBase();
  return () => { vivo = false; corrida++; inst = null; soltarAjuda(); root.removeEventListener('click', aoClicar); root.removeEventListener('input', aoDigitar); root.removeEventListener('change', aoDigitar); root.removeEventListener('keydown', aoTeclar); };
}
