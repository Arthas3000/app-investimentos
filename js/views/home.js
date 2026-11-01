// Home: saldo, meus ativos, "desde a sua última visita" e primeiros passos. Material educacional, nada aqui é recomendação.
import { icon } from '../ui/icons.js';
import { animarValor, aviso, piscar } from '../ui/kit.js';
import { abrirRegistro, listaDePrecos, formatarCentavos, mascaraReais, paraCentavos, paraInteiro, soDigitos, hojeIso } from '../ui/registrar.js';
import { ler, definirPrefs, definirAporte, marcarVisita, ouvir } from '../data/carteira.js';
import { visaoCarteira, proximoAporte } from '../core/carteira-calc.js';
import { arredonda, centavos } from '../core/money.js';
import { icsDoAporte, mesPorExtenso } from '../core/aporte-entrada.js';
import { token, prefs } from '../data/store.js';
import { fmtQuando } from '../data/pregao.js';
import { carregarDados, carregarPrecos } from '../data/dados.js';
import { ultimos, SERIES } from '../data/bcb.js';
import { marcos as calcMarcos, novosMarcos } from '../core/seu-mes.js';
import { lerVistos } from './seumes.js';
import { analisar, montarCtx } from '../analise/analisar.js';

// ---------- lógica pura (testada em test/home.test.js) ----------

const pt = (n, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** '+R$ 1,00' / '−R$ 1,00' */
export const sinalBrl = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${formatarCentavos(Math.abs(c))}`;
/** fração -> '+2,35%' / '−0,50%' */
export const sinalPct = (f) => (f == null ? '—' : `${f > 0 ? '+' : f < 0 ? '−' : ''}${pt(Math.abs(f) * 100)}%`);
/** '2026-12-05' -> '5/12' */
export const diaMes = (iso) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;

/**
 * Variação do dia da carteira. `itens`: da visão (com `valor` em centavos); `varDias`: Map código -> variação do dia em %.
 * Ativo sem preço ou sem variação fica de fora (`parcial` avisa). Sem nenhum: null.
 * Valor antes = valor atual ÷ (1 + variação).
 */
export function variacaoDia(itens, varDias) {
  let valor = 0, base = 0, n = 0, comValor = 0;
  for (const i of itens) {
    if (i.valor == null) continue;
    comValor++;
    const v = varDias.get(i.ativo);
    if (!Number.isFinite(v) || v <= -100) continue;
    const antes = arredonda(i.valor / (1 + v / 100));
    valor += i.valor - antes; base += antes; n++;
  }
  return n ? { valor, pct: base > 0 ? valor / base : null, parcial: n < comValor } : null;
}

/**
 * O que mudou entre dois retratos { TICKER: { ind:[id, rótulo], faixa:[id, rótulo] } }: indicação e faixa de preço.
 * Só compara ativos que estão nos dois; faixa "indefinido" não conta como mudança.
 * @returns {{ticker:string, tipo:'indicacao'|'faixa', de:string, para:string}[]}
 */
export function mudancasAnalise(antes = {}, agora = {}) {
  const out = [];
  for (const [ticker, a] of Object.entries(agora)) {
    const b = antes[ticker];
    if (!b) continue;
    for (const [campo, tipo] of [['ind', 'indicacao'], ['faixa', 'faixa']]) {
      const x = b[campo], y = a[campo];
      if (!x || !y || x[0] === y[0] || x[0] === 'indefinido' || y[0] === 'indefinido') continue;
      out.push({ ticker, tipo, de: x[1], para: y[1] });
    }
  }
  return out;
}

/** 'Seu próximo aporte é em 5/12.' (ou 'Seu aporte é hoje, 5/12.'); vazio sem aporte definido. */
export function textoProximoAporte(aporte, hoje) {
  const p = proximoAporte(aporte, hoje);
  if (!p) return '';
  return p.dias === 0 ? `Seu aporte é hoje, ${diaMes(p.data)}.` : `Seu próximo aporte é em ${diaMes(p.data)}.`;
}

/** Cartões de primeiros passos que ainda valem: não concluídos e não dispensados, na ordem de exibição. */
export function passosPendentes({ estado, temToken, dispensados = [] }) {
  const feito = {
    fonte: !!temToken,
    ativo: estado.transacoes.some((t) => !t.excluido) || estado.acompanhados.length > 0,
    aporte: !!estado.aporte,
  };
  return ['fonte', 'ativo', 'aporte'].filter((id) => !feito[id] && !dispensados.includes(id));
}

// ---------- apresentação ----------

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cls = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
const OCULTO = '••••';
const CHAVE_RETRATO = 'home.analises.v1'; // retrato das indicações da última visita (a carteira.v1 não tem lugar para isso)

// ponytail: estes selos repetem os do Mercado (views/mercado.js não os exporta e esta tarefa não mexe nele); unificar num módulo de UI quando houver uma terceira tela.
const IND_ICONE = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };
const FAIXA_ESTILO = { barato: ['candidata', 'tag'], normal: ['neutro', 'minus'], caro: ['atencao', 'trend'] };
const seloInd = ([id, rotulo]) => `<span class="badge ind-${esc(id)}">${icon(IND_ICONE[id] ?? 'minus')}${esc(rotulo)}</span>`;
export const seloFaixa = ([id, rotulo]) => {
  const e = FAIXA_ESTILO[id];
  return e ? `<span class="badge ind-${e[0]}" title="Preço comparado com os dados do próprio ativo">${icon(e[1])}${esc(rotulo)}</span>` : '';
};

const lerRetrato = () => { try { return JSON.parse(localStorage.getItem(CHAVE_RETRATO) || 'null')?.ativos ?? {}; } catch { return {}; } };
const gravarRetrato = (ativos) => { try { localStorage.setItem(CHAVE_RETRATO, JSON.stringify({ em: new Date().toISOString(), ativos })); } catch { /* sem armazenamento: some só o aviso de mudanças */ } };

// CDI anual (fração) a partir do último CDI diário do BCB; sem rede fica null e o modelo se adapta.
async function cdiAnual() {
  const v = (await ultimos(SERIES.cdi, 1)).data?.at(-1)?.valor;
  return v > 0 ? (1 + v / 100) ** 252 - 1 : null;
}

const PASSOS = {
  fonte: 'Conecte a fonte de dados',
  ativo: 'Acompanhe ou registre o primeiro ativo',
  aporte: 'Defina o valor e o dia do aporte',
};

export function montar(root, ctx) {
  let vivo = true, carregou = false, carregando = false, erro = null, savedAt = null, stale = false;
  let precos = new Map(), varDias = new Map(), nomes = new Map(), tipos = new Map(), logos = new Map(), lista = [];
  let visao = null, analise = 'pendente'; // 'pendente' | 'feita' | 'sem'
  let emAnalise = false, saiu = false, mudancas = [];
  let aporteSt = 'pendente', aporteRes = null, emAporte = false; // cartão do aporte: 'pendente' | 'sem-preco' | 'sem-alvos' | 'erro' | 'ok'
  const selos = new Map(); // código -> { ind:[id, rótulo], faixa:[id, rótulo] }, só do que está em cache nesta visita
  const retratoAnterior = lerRetrato();
  const hoje = () => hojeIso();

  root.innerHTML = `
    <section class="card balance" id="hCard" aria-label="Saldo da carteira" hidden>
      <div class="balance__label"><span>Saldo da carteira</span><button class="icon-btn" id="hOlho" type="button" aria-label="Ocultar valores" aria-pressed="false"></button></div>
      <p class="balance__value num" id="hSaldo">—</p>
      <div class="balance__sub">
        <span>Investido <strong class="num" id="hInv">—</strong></span>
        <span>Resultado <strong class="num" id="hRes">—</strong></span>
        <span><span id="hDiaT">Hoje</span> <strong class="num" id="hDia">—</strong></span>
        <span id="hCaixaW" hidden>Caixa <strong class="num" id="hCaixa"></strong></span>
      </div>
    </section>
    <div class="home-avisos" id="hAvisos"></div>
    <section id="hAporte" aria-label="Aporte do mês"></section>
    <section id="hDesde" aria-labelledby="hDesdeT"></section>
    <section id="hAtivos"></section>
    <section id="hSeuMes" aria-labelledby="hSeuMesT"></section>
    <section id="hPassos" aria-labelledby="hPassosT"></section>
    <p class="src home-fim" id="hFonte"></p>
    <button type="button" class="fab" id="hMais" aria-label="Registrar movimentação">${icon('plus', 24)}</button>`;
  const $ = (s) => root.querySelector(s);
  const ordem = (id, n) => { $(id).style.order = n; };

  const marcador = () => {
    const s = ctx.estado().state;
    if (s === 'aberto') return '';
    const [ic, t] = s === 'atrasado' ? ['alert', 'cotação atrasada'] : ['clock', 'pregão fechado, último preço'];
    return `<span class="mkt-mark" role="img" aria-label="${t}">${icon(ic, 14)}</span>`;
  };

  // ---------- desenho ----------
  function pintarSaldo() {
    const est = ler(), oculto = est.prefs.ocultarValores;
    const card = $('#hCard');
    card.hidden = !visao || visao.itens.length === 0;
    if (card.hidden) return;
    const olho = $('#hOlho');
    olho.innerHTML = icon(oculto ? 'eyeOff' : 'eye', 22);
    olho.setAttribute('aria-pressed', oculto);
    const carregandoPreco = !carregou;
    card.setAttribute('aria-busy', carregandoPreco);
    const temSaldo = visao.itens.some((i) => i.valor != null);
    const caixa = Math.max(0, visao.caixa);
    const saldo = $('#hSaldo');
    saldo.classList.toggle('is-loading', carregandoPreco);
    if (carregandoPreco) saldo.textContent = '';
    else if (!temSaldo) { delete saldo.dataset.v; saldo.textContent = '—'; }
    else if (oculto) { delete saldo.dataset.v; saldo.textContent = OCULTO; }
    else animarValor(saldo, visao.saldo + caixa, formatarCentavos);
    const v = (c) => (oculto ? OCULTO : formatarCentavos(c));
    $('#hInv').textContent = temSaldo ? v(visao.custo) : '—';
    $('#hRes').textContent = temSaldo ? `${oculto ? OCULTO : sinalBrl(visao.resultado)} (${sinalPct(visao.resultadoPct)})` : '—';
    const dia = temSaldo ? variacaoDia(visao.itens, varDias) : null;
    $('#hDiaT').textContent = ctx.estado().state === 'aberto' ? 'Hoje' : 'No último pregão';
    $('#hDia').textContent = dia ? `${oculto ? OCULTO : sinalBrl(dia.valor)} (${sinalPct(dia.pct)})${dia.parcial ? ' *' : ''}` : '—';
    $('#hCaixaW').hidden = caixa === 0 || !temSaldo;
    $('#hCaixa').textContent = v(caixa);
  }

  function linha(i) {
    const oculto = ler().prefs.ocultarValores, s = selos.get(i.ativo), nome = nomes.get(i.ativo) ?? '', logo = logos.get(i.ativo);
    const cota = `${oculto ? OCULTO : i.qtd} cota${i.qtd === 1 && !oculto ? '' : 's'}`;
    const precoTxt = i.preco != null ? formatarCentavos(i.preco) : '—';
    const peso = i.peso != null ? `${pt(i.peso, 1)}% da carteira` : '';
    const fim = !carregou
      ? '<span class="skeleton home-sk"></span><span class="skeleton home-sk home-sk--s"></span>'
      : `<span class="asset-row__price num">${i.valor != null ? (oculto ? OCULTO : formatarCentavos(i.valor)) : '—'}</span>
         <span class="asset-row__chg num ${cls(i.resultado)}"><span class="sr-only">Resultado </span>${sinalPct(i.resultadoPct)}</span>`;
    return `<li><a class="asset-row home-row" href="#mercado/ativo/${encodeURIComponent(i.ativo)}" data-c="${esc(i.ativo)}">
      <span class="asset-row__logo" aria-hidden="true">${logo ? `<img src="${esc(logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${esc(i.ativo.slice(0, 2))}</span>
      <span class="col">
        <span class="asset-row__code">${esc(i.ativo)}${tipos.get(i.ativo) === 'fii' ? '<span class="badge">FII</span>' : ''}${s ? seloInd(s.ind) + seloFaixa(s.faixa) : ''}</span>
        <span class="asset-row__name">${esc(nome)}</span>
        <span class="home-row__meta">${cota}${peso ? ` · ${peso}` : ''}${carregou ? ` · Preço <span class="num cell">${precoTxt}</span>${i.preco != null ? marcador() : ''}` : ''}</span>
      </span>
      <span class="asset-row__end">${fim}</span>
    </a></li>`;
  }

  function pintarAtivos() {
    const el = $('#hAtivos');
    if (!visao) { el.innerHTML = ''; return; }
    if (!visao.itens.length) {
      el.innerHTML = `<div class="card empty">${icon('wallet', 40)}<h2>Sua carteira está vazia</h2>
        <p>Registre uma compra que você já fez para ver o saldo, o resultado e a participação de cada ativo.</p>
        <button type="button" class="btn" data-reg>${icon('plus')}Registrar compra</button></div>`;
      return;
    }
    el.innerHTML = `<h2 class="home-h">Meus ativos</h2><ul class="asset-list card" aria-label="Meus ativos">${visao.itens.map(linha).join('')}</ul>`;
  }

  function pintarAvisos() {
    const av = [];
    if (carregou && erro && !lista.length) {
      av.push(`<div class="notice" role="alert">${icon('wifiOff')}<span>Não consegui buscar os preços: ${esc(erro.message)} Mostro o que você registrou, sem valores. Vou tentar de novo sozinho.</span><button type="button" class="btn btn--quiet" data-retry>Tentar de novo</button></div>`);
    } else if (carregou && erro) {
      av.push(`<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Mostrando os últimos preços, de ${fmtQuando(new Date(savedAt))}.</span></div>`);
    }
    if (carregou && visao?.semPreco.length && lista.length) {
      av.push(`<div class="notice" role="status">${icon('alert')}<span>Sem preço agora para ${esc(visao.semPreco.join(', '))}. Fica${visao.semPreco.length > 1 ? 'm' : ''} fora do saldo.</span></div>`);
    }
    if (visao?.erros.length) {
      av.push(`<div class="notice" role="status">${icon('alert')}<span>${visao.erros.length === 1 ? '1 movimentação não entrou' : `${visao.erros.length} movimentações não entraram`} no cálculo (por exemplo, uma venda maior que as cotas que você tinha). <a href="#historico">Ver no Histórico</a></span></div>`);
    }
    $('#hAvisos').innerHTML = av.join('');
  }

  function pintarDesde() {
    const el = $('#hDesde');
    if (!visao || !visao.itens.length) { el.innerHTML = ''; return; }
    let corpo;
    if (analise === 'pendente') corpo = '<div class="skeleton" style="height:20px"></div>';
    else if (mudancas.length) {
      const nome = { indicacao: 'indicação', faixa: 'faixa de preço' };
      corpo = `<ul class="an__list">${mudancas.map((m) => `<li><strong>${esc(m.ticker)}</strong>: ${nome[m.tipo]} passou de ${esc(m.de)} para ${esc(m.para)}.</li>`).join('')}</ul>
        <p class="muted">Um retrato dos números, não um aviso para comprar ou vender.</p>`;
    } else corpo = `<p>Tudo em dia. ${esc(textoProximoAporte(ler().aporte, hoje()))}</p>`;
    el.innerHTML = `<div class="card home-desde"><h2 class="home-h" id="hDesdeT">Desde a sua última visita</h2>${corpo}</div>`;
  }

  // ponytail: na Home só entram marcos que dependem de transações; os de patrimônio precisam dos preços mensais e aparecem ao abrir Seu mês.
  function pintarSeuMes() {
    const ts = ler().transacoes;
    let novo = false;
    try { novo = novosMarcos(calcMarcos({ transacoes: ts, hoje: hoje() }), lerVistos()).length > 0; } catch { /* sem marco: segue só com a entrada */ }
    $('#hSeuMes').innerHTML = `<div class="card home-desde"><h2 class="home-h" id="hSeuMesT">Seu mês</h2>
      <p>${novo ? 'Há um marco novo no Seu mês. ' : ''}Veja aportes, proventos e o seu caminho mês a mês.</p>
      <a class="btn btn--ghost" href="#seumes">Abrir Seu mês</a></div>`;
  }

  function pintarPassos() {
    const est = ler();
    const ids = passosPendentes({ estado: est, temToken: token.get(), dispensados: est.prefs.primeirosPassosDispensados });
    const el = $('#hPassos');
    if (!ids.length) { el.innerHTML = ''; return; }
    const corpo = {
      fonte: `<p>A lista de preços já funciona sem nada. Para a cotação ao vivo de cada ativo, use um token gratuito da brapi:</p>
        <ol class="muted home-ol"><li>Crie uma conta grátis em brapi.dev.</li><li>No painel, copie o seu token.</li><li>Cole abaixo. Ele fica só neste aparelho.</li></ol>
        <div class="field"><label for="pTk">Token da brapi</label><input id="pTk" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <button type="button" class="btn btn--block" id="pTkOk">Salvar token</button>`,
      ativo: `<p>Registre uma compra que você já fez ou olhe o Mercado e acompanhe um ativo para consulta.</p>
        <div class="home-btns"><button type="button" class="btn" data-reg>Registrar compra</button><a class="btn btn--ghost" href="#mercado">Ver o Mercado</a></div>`,
      aporte: `<p>Com o valor e o dia, a Home mostra quando é o seu próximo aporte.</p>
        <form class="home-aporte" data-aporte novalidate>
          <div class="field"><label for="pAporteV">Valor do aporte</label><input id="pAporteV" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"></div>
          <div class="field"><label for="pAporteD">Dia do mês (1 a 31)</label><input id="pAporteD" inputmode="numeric" autocomplete="off" placeholder="5" maxlength="2"></div>
          <div role="alert" data-erro></div>
          <button type="submit" class="btn btn--block">Salvar aporte</button></form>`,
    };
    el.innerHTML = `<h2 class="home-h" id="hPassosT">Primeiros passos</h2><ul class="home-passos">${ids.map((id) => `
      <li class="card passo"><div class="passo__top"><h3>${PASSOS[id]}</h3>
        <button type="button" class="icon-btn" data-dispensar="${id}" aria-label="Dispensar: ${PASSOS[id]}">${icon('x')}</button></div>${corpo[id]}</li>`).join('')}</ul>`;
  }

  // Cartão do aporte: no dia, a proposta pronta (feita com o que está salvo); nos outros dias, só o aviso discreto.
  function pintarAporte() {
    const el = $('#hAporte'), est = ler(), p = proximoAporte(est.aporte, hoje());
    if (!p) { el.innerHTML = ''; return; }
    const lembrete = `<button type="button" class="btn btn--quiet" data-ics>${icon('clock')}Lembrete na agenda</button>`;
    const nota29 = est.aporte.dia > 28 ? '<p class="muted">Na agenda, os dias 29 a 31 viram dia 28.</p>' : '';
    if (p.dias !== 0) {
      el.innerHTML = `<div class="card ap-home ap-home--calmo"><h2 class="home-h">Próximo aporte em ${diaMes(p.data)}</h2>
        <div class="home-btns"><a class="btn btn--ghost" href="#aporte">Planejar</a>${lembrete}</div>${nota29}</div>`;
      return;
    }
    const mes = mesPorExtenso(p.data), r = aporteRes;
    let corpo;
    if (aporteSt === 'pendente') corpo = '<div class="skeleton" style="height:20px"></div><div class="skeleton" style="height:20px;margin-top:8px;width:60%"></div>';
    else if (aporteSt === 'sem-alvos') corpo = `<p>Defina quanto quer ter de cada ativo para ver a proposta deste mês.</p><div class="home-btns"><a class="btn" href="#aporte">Definir alvos</a>${lembrete}</div>`;
    else if (aporteSt === 'sem-preco') corpo = `<p>${icon('wifiOff', 16)} Sem preços agora, a proposta aparece quando a cotação chegar.</p><div class="home-btns"><a class="btn btn--ghost" href="#aporte/proposta">Abrir o assistente</a>${lembrete}</div>`;
    else if (aporteSt === 'erro' || !r?.prop) corpo = `<p>Não consegui montar a proposta com o que está salvo. Abra o assistente para conferir os números.</p><div class="home-btns"><a class="btn btn--ghost" href="#aporte">Abrir o assistente</a>${lembrete}</div>`;
    else {
      const com = r.prop.linhas.filter((l) => l.cotas > 0);
      const lista4 = com.slice(0, 4).map((l) => `${l.cotas} × ${esc(l.ticker)}`).join(' · ') + (com.length > 4 ? ` · mais ${com.length - 4}` : '');
      corpo = `<p>${com.length ? `${lista4}` : 'Com esses números não há compra a propor.'}</p>
        <p class="muted num">Aporte ${formatarCentavos(r.cfg.aporte)} · compras ${formatarCentavos(r.prop.total)} · sobra ${formatarCentavos(r.prop.sobra)}</p>
        <p class="muted">Material educacional, não é recomendação.</p>
        <div class="home-btns"><a class="btn" href="#aporte/proposta">Ver proposta</a>${lembrete}</div>`;
    }
    el.innerHTML = `<div class="card ap-home"><h2 class="home-h">Aporte de ${mes}</h2>${corpo}${nota29}</div>`;
  }

  async function calcularAporte() {
    if (emAporte || !vivo || proximoAporte(ler().aporte, hoje())?.dias !== 0) return;
    emAporte = true;
    try {
      if (!lista.length) aporteSt = carregou ? 'sem-preco' : 'pendente';
      else {
        const { propostaPadrao } = await import('./aporte.js');
        const r = await propostaPadrao({ lista, precos });
        if (!vivo) return;
        aporteSt = r.estado === 'sem-aporte' ? 'erro' : r.estado; aporteRes = r;
      }
    } catch (e) {
      console.error(e); aporteSt = 'erro';
    } finally {
      emAporte = false;
      if (vivo) pintarAporte();
    }
  }

  function baixarIcs() {
    const a = ler().aporte;
    if (!a) return;
    const url = URL.createObjectURL(new Blob([icsDoAporte({ dia: a.dia, hoje: hoje(), agora: new Date() })], { type: 'text/calendar;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'lembrete-aporte.ics' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    aviso('Lembrete baixado. Abra o arquivo para adicioná-lo à agenda do celular.');
  }

  function pintarFonte() {
    $('#hFonte').textContent = savedAt
      ? `Fonte dos preços: brapi · consultado em ${fmtQuando(new Date(savedAt))}. Ações podem ter atraso de cerca de 30 minutos.${selos.size ? ' Indicação e faixa de preço: dados da CVM e da B3, material educacional, não é recomendação.' : ''}`
      : '';
  }

  function recalcular() {
    const est = ler();
    visao = visaoCarteira(est, precos);
    ordem('#hCard', 0); ordem('#hAvisos', 1); ordem('#hAporte', 2); ordem('#hSeuMes', 3); ordem('#hAtivos', 4); ordem('#hDesde', 5);
    ordem('#hPassos', visao.itens.length ? 6 : 4); // carteira vazia: os passos vêm logo depois do convite
    ordem('#hFonte', 7);
  }
  // `passos` fica de fora das atualizações de preço: redesenhar apagaria o que a pessoa está digitando (token, aporte)
  function pintar({ passos = false } = {}) {
    recalcular();
    pintarSaldo(); pintarAvisos(); pintarAporte(); pintarAtivos(); pintarDesde(); pintarSeuMes(); pintarFonte();
    if (passos) pintarPassos();
  }

  // ---------- dados ----------
  async function carregar({ primeira = false } = {}) {
    if (carregando) return;
    carregando = true;
    const r = await listaDePrecos(ctx, { primeira });
    carregando = false;
    if (!vivo) return;
    erro = r.error; savedAt = r.savedAt; stale = r.stale;
    const antes = precos;
    if (r.data) {
      lista = r.data;
      precos = new Map(); varDias = new Map(); nomes = new Map(); tipos = new Map(); logos = new Map();
      for (const a of r.data) {
        if (Number.isFinite(a.preco) && a.preco > 0) precos.set(a.codigo, centavos(a.preco));
        varDias.set(a.codigo, a.varDia); nomes.set(a.codigo, a.nome); tipos.set(a.codigo, a.tipo); logos.set(a.codigo, a.logo);
      }
      if (!stale && savedAt) ctx.definirUltimaCotacao(new Date(savedAt));
    }
    const primeiraVez = !carregou;
    carregou = true;
    pintar();
    if (!primeiraVez) root.querySelectorAll('.home-row').forEach((a) => {
      const c = a.dataset.c, d = (precos.get(c) ?? 0) - (antes.get(c) ?? precos.get(c) ?? 0);
      if (d) piscar(a.querySelector('.cell'), d);
    });
    setTimeout(calcularAporte, 0);
    if (r.data) setTimeout(analisarCarteira, 50);
    else if (analise === 'pendente') { analise = 'sem'; pintarDesde(); } // sem preços não há o que comparar: não deixa o esqueleto girando
  }

  // Indicação e faixa dos ativos da carteira, só com o que está em cache/dados (sem bloquear a tela).
  // ponytail: refaz o contexto de todos os ativos a cada rodada (como o modal do Mercado); memoizar se pesar.
  async function analisarCarteira() {
    if (emAnalise || !vivo || !visao?.itens.length) return;
    emAnalise = true;
    try {
      const d = await carregarDados();
      if (!vivo) return;
      if ([d.fundamentos, d.fiis, d.risco].every((x) => x.ausente || x.erro)) { analise = 'sem'; mudancas = []; return; }
      const cdi = await cdiAnual();
      const setores = Object.fromEntries(lista.filter((a) => a.tipo === 'acao' && a.setor).map((a) => [a.codigo, a.setor]));
      const ctxA = montarCtx({ risco: d.risco.data, fundamentos: d.fundamentos.data, fiis: d.fiis.data, cdi, setores });
      const tickers = visao.itens.map((i) => i.ativo);
      const prs = await Promise.all(tickers.map((t) => carregarPrecos(t)));
      if (!vivo) return;
      tickers.forEach((t, k) => {
        const classe = tipos.get(t) ?? (d.fiis.data?.ativos?.[t] ? 'fii' : 'acao');
        if (!(classe === 'fii' ? d.fiis : d.fundamentos).data) return;
        const preco = precos.get(t);
        const a = analisar({ ticker: t, classe, preco: preco == null ? null : preco / 100, dados: { fundamentos: d.fundamentos.data, fiis: d.fiis.data, risco: d.risco.data }, ctx: ctxA, setor: setores[t] ?? null, precos5a: prs[k].data?.p ?? null });
        if (!a.semDados) selos.set(t, { ind: [a.indicacao.id, a.indicacao.rotulo], faixa: [a.faixa.id, a.faixa.rotulo] });
      });
      analise = 'feita';
      mudancas = mudancasAnalise(retratoAnterior, Object.fromEntries(selos));
    } catch (e) {
      console.error(e); analise = 'sem'; mudancas = [];
    } finally {
      emAnalise = false;
      if (vivo) { pintarAtivos(); pintarDesde(); pintarFonte(); }
    }
  }

  // ---------- eventos ----------
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#hOlho')) { definirPrefs({ ocultarValores: !ler().prefs.ocultarValores }); return; }
    if (t.closest('#hMais, [data-reg]')) { abrirRegistro(ctx, { tipo: 'compra' }); return; }
    if (t.closest('[data-retry]')) { carregar(); return; }
    if (t.closest('[data-ics]')) { baixarIcs(); return; }
    const dis = t.closest('[data-dispensar]');
    if (dis) {
      const est = ler();
      definirPrefs({ primeirosPassosDispensados: [...new Set([...est.prefs.primeirosPassosDispensados, dis.dataset.dispensar])] });
      root.focus();
      return;
    }
    if (t.closest('#pTkOk')) {
      const v = $('#pTk').value.trim();
      if (!v) { $('#pTk').focus(); return; }
      token.set(v); pintarPassos(); aviso('Token salvo neste aparelho.');
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'pAporteV') e.target.value = mascaraReais(e.target.value);
    else if (e.target.id === 'pAporteD') e.target.value = soDigitos(e.target.value).slice(0, 2);
  });
  root.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-aporte]'); if (!f) return;
    e.preventDefault();
    const valor = paraCentavos($('#pAporteV').value), dia = paraInteiro($('#pAporteD').value);
    const faltas = [!valor && 'Informe o valor do aporte, em reais.', !(dia >= 1 && dia <= 31) && 'Informe o dia do mês, de 1 a 31.'].filter(Boolean);
    if (faltas.length) { f.querySelector('[data-erro]').innerHTML = faltas.map((m) => `<p class="field__error">${icon('alert', 16)}<span>${m}</span></p>`).join(''); return; }
    definirAporte({ valor, dia });
  });

  // a carteira mudou (registro, desfazer, olho, dispensar): redesenha com os preços que já temos
  let ativosAntes = ler().transacoes.length;
  const parar = ouvir(() => {
    if (!vivo) return;
    pintar({ passos: true });
    const n = ler().transacoes.length;
    if (n !== ativosAntes) { ativosAntes = n; analise = 'pendente'; pintarDesde(); setTimeout(analisarCarteira, 50); aporteSt = 'pendente'; pintarAporte(); setTimeout(calcularAporte, 50); }
  });

  // a cada 15 s confere se venceu o intervalo (pregão aberto e aba visível) ou se a primeira busca falhou
  const timer = setInterval(() => {
    if (document.hidden) return;
    const venceu = savedAt && Date.now() - savedAt >= (prefs().cotacaoSegundos || 60) * 1000;
    if (!lista.length || (ctx.estado().state !== 'fechado' && venceu)) carregar();
  }, 15_000);
  const visivel = () => { if (!document.hidden && ctx.estado().state !== 'fechado') carregar(); };
  document.addEventListener('visibilitychange', visivel);

  // ao sair: marca a visita e guarda o retrato das indicações para comparar na próxima
  function sair() {
    if (saiu) return;
    saiu = true;
    if (analise === 'feita') {
      const tem = new Set(visao?.itens.map((i) => i.ativo));
      gravarRetrato({ ...Object.fromEntries(Object.entries(retratoAnterior).filter(([t]) => tem.has(t))), ...Object.fromEntries(selos) });
    }
    marcarVisita();
  }
  addEventListener('pagehide', sair);

  pintar({ passos: true });
  carregar({ primeira: true }).then(() => { if (vivo && ctx.estado().state !== 'fechado') carregar(); }); // do cache na hora; depois atualiza se o pregão está aberto

  return () => {
    vivo = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visivel);
    removeEventListener('pagehide', sair);
    parar(); // antes de marcar a visita, para a própria gravação não redesenhar uma tela que saiu
    sair();
  };
}
