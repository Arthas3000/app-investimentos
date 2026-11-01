// Carteira: saldo, ativos com preço médio/resultado/alvo/notas, ativos só para consulta, renda passiva, metas,
// concentração e risco. Preços vêm da lista da brapi (uma chamada, em cache); notas e faixas da análise em cache,
// calculadas depois do primeiro desenho para nunca bloquear a tela.
import { icon } from '../ui/icons.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { animarValor, aviso, brl } from '../ui/kit.js';
import { listarAtivos } from '../data/brapi.js';
import { prefs as prefsApp } from '../data/store.js';
import { fmtQuando } from '../data/pregao.js';
import { carregarDados, carregarPrecos } from '../data/dados.js';
import { ultimos, SERIES } from '../data/bcb.js';
import * as usuario from '../data/carteira.js';
import { visaoCarteira } from '../core/carteira-calc.js';
import { centavos } from '../core/money.js';
import { addMeses } from '../core/datas.js';
import { concentracao, pesoPorGrupo, variacaoDia, riscoCarteira, rendaPassiva, statusMetas, reaisParaCentavos } from '../core/carteira-risco.js';
import { analisar, montarCtx } from '../analise/analisar.js';
import { COBERTURA } from '../analise/constantes.js';

const SETORES = {
  Finance: 'Finanças', Utilities: 'Energia, água e gás', 'Producer Manufacturing': 'Indústria', 'Process Industries': 'Indústria de processos',
  'Retail Trade': 'Varejo', 'Non-Energy Minerals': 'Mineração e siderurgia', Transportation: 'Transportes', 'Commercial Services': 'Serviços comerciais',
  'Consumer Durables': 'Bens duráveis', 'Consumer Non-Durables': 'Bens não duráveis', 'Industrial Services': 'Serviços industriais',
  'Health Services': 'Saúde (serviços)', 'Distribution Services': 'Distribuição', 'Consumer Services': 'Serviços ao consumidor',
  'Technology Services': 'Tecnologia (serviços)', Communications: 'Comunicações', 'Energy Minerals': 'Petróleo e carvão',
  'Electronic Technology': 'Eletrônicos', 'Health Technology': 'Saúde (tecnologia)', Miscellaneous: 'Outros',
};
const SEGMENTOS = { tijolo: 'FIIs de tijolo', papel: 'FIIs de papel', hibrido: 'FIIs híbridos' };
const IND_ICONE = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };
const FAIXA_ESTILO = { barato: ['candidata', 'tag'], normal: ['neutro', 'minus'], caro: ['atencao', 'trend'] };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const num = (n, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const pctS = (n) => (n == null ? '—' : `${sinal(n)}${num(Math.abs(n), 2)}%`);
const cls = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
const p2 = (n) => String(n).padStart(2, '0');
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const dataBr = (iso) => iso.split('-').reverse().join('/');
const dataNum = (n) => { const s = String(n); return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
const mesAno = (iso, longo = true) => new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString('pt-BR', { month: longo ? 'long' : 'short', year: 'numeric' });
const OCULTO = '<span role="img" aria-label="valor oculto">••••</span>';

const seloHtml = (ind) => `<span class="badge ind-${ind.id}">${icon(IND_ICONE[ind.id])}${esc(ind.rotulo)}</span>`;
const faixaHtml = (f) => {
  const e = FAIXA_ESTILO[f?.id];
  return e ? `<span class="badge ind-${e[0]}" title="Preço comparado com os dados do próprio ativo">${icon(e[1])}${esc(f.rotulo)}</span>` : '';
};

// ---------- a tela montada (rota() abre os painéis #carteira/acompanhar e #carteira/metas) ----------
let tela = null;
export function rota(partes) { tela?.rota(partes); }

export function montar(root, ctx) {
  const dlg = ctx.sheet;
  let est = usuario.ler();
  let lista = [], base = new Map(), precos = new Map(), info = { savedAt: null, erro: null, stale: false, carregando: true };
  let series = new Map(), tentadas = new Set(), dArq = null, analises = new Map(), estadoAn = 'carregando', cdi = null, memoCtx = { k: [], v: null };
  let rendaPorAtivo = {};
  let registrar = null, vivo = true, sujo = false, pendente = false, painel = null, rodando = false, repetir = false;

  root.innerHTML = `
    <section class="balance card" id="sSaldo" aria-label="Saldo da carteira" hidden>
      <div class="balance__label"><span>Saldo da carteira</span><button class="icon-btn" id="olho" type="button"></button></div>
      <div class="balance__value num" id="vSaldo">—</div>
      <div class="balance__sub" id="subSaldo"></div>
    </section>
    <div id="sAvisos"></div><div id="sMeus"></div><div id="sAcomp"></div><div id="sRenda"></div><div id="sMetas"></div><div id="sRisco"></div><div id="sFim"></div>`;
  const $ = (s) => root.querySelector(s);
  const pintar = (el, html) => { if (el._h !== html) { el.innerHTML = html; el._h = html; } };

  const oculto = () => est.prefs.ocultarValores;
  const R = (c) => (c == null ? '—' : oculto() ? OCULTO : brl(c));
  const RS = (c) => (c == null ? '—' : oculto() ? OCULTO : `${sinal(c)}${brl(Math.abs(c))}`);
  const marcador = () => {
    const s = ctx.estado().state;
    if (s === 'aberto') return '';
    const [ic, t] = s === 'atrasado' ? ['alert', 'cotação atrasada'] : ['clock', 'pregão fechado, último preço'];
    return `<span class="mkt-mark" role="img" aria-label="${t}">${icon(ic, 14)}</span>`;
  };

  // ---------- dados derivados ----------
  const tickers = () => [...new Set([...est.transacoes.filter((t) => !t.excluido && t.ativo).map((t) => t.ativo), ...est.acompanhados.map((a) => a.ticker)])];
  const classeDe = (t) => base.get(t)?.tipo ?? (dArq?.fiis.data?.ativos?.[t] ? 'fii' : 'acao');
  // preço: o da lista; se o ativo não está nela, o último fechamento do arquivo de preços (com a data à mostra); senão traço
  function precosEfetivos() {
    const m = new Map(precos);
    for (const t of tickers()) if (!m.has(t) && series.get(t)) m.set(t, series.get(t).p.at(-1));
    return m;
  }
  const dataDoArquivo = (t) => (!precos.has(t) && series.get(t) ? series.get(t).d.at(-1) : null);

  // ---------- desenho ----------
  function desenhar() {
    if (!vivo) return;
    if (sujo) { pendente = true; return; } // não troca a tela enquanto a pessoa digita
    const foco = root.contains(document.activeElement) ? document.activeElement.id : '';
    const ef = precosEfetivos(), v = visaoCarteira(est, ef), hoje = hojeLocal();
    const comValor = v.itens.filter((i) => i.valor != null);
    const patrimonio = v.saldo + Math.max(v.caixa, 0);
    const renda = rendaPassiva(est.transacoes, hoje);
    rendaPorAtivo = renda.porAtivo;

    // saldo (o número fica no mesmo elemento para animar até o novo valor)
    $('#sSaldo').hidden = v.vazio;
    const olho = $('#olho');
    olho.innerHTML = icon(oculto() ? 'eyeOff' : 'eye', 22);
    olho.setAttribute('aria-pressed', oculto());
    olho.setAttribute('aria-label', 'Ocultar valores');
    const semPrecoNenhum = v.itens.length > 0 && !comValor.length;
    const alvoSaldo = $('#vSaldo');
    if (semPrecoNenhum) { alvoSaldo.textContent = '—'; delete alvoSaldo.dataset.v; } else animarValor(alvoSaldo, patrimonio, oculto() ? () => '••••' : brl);
    const dia = variacaoDia(comValor, new Map(lista.map((a) => [a.codigo, a.varDia])));
    pintar($('#subSaldo'), semPrecoNenhum ? '<span>Sem preços agora: o saldo aparece quando a cotação chegar.</span>' : `
      <span>Investido: ${R(v.custo)}</span>
      <span>Resultado: ${v.custo > 0 ? `<span class="num">${RS(v.resultado)} (${pctS(v.resultadoPct * 100)})</span>` : '—'}</span>
      ${dia ? `<span>Hoje: <span class="num">${RS(dia.valor)} (${pctS(dia.pct)})</span></span>` : ''}
      ${v.caixa > 0 ? `<span>Caixa: ${R(v.caixa)}</span>` : ''}`);

    pintar($('#sAvisos'), avisos(v));
    pintar($('#sMeus'), v.vazio ? vazioHtml() : secMeus(v));
    pintar($('#sAcomp'), v.acompanhados.length ? secAcomp(v) : '');
    pintar($('#sRenda'), v.vazio ? '' : secRenda(renda, patrimonio));
    const status = statusMetas({ metas: est.metas, patrimonio, rendaMensal: renda.mediaMensal, transacoes: est.transacoes, aporte: est.aporte, hoje });
    pintar($('#sMetas'), v.vazio ? '' : secMetas(status));
    pintar($('#sRisco'), v.vazio ? '' : secRisco(comValor));
    pintar($('#sFim'), rodape());
    if (foco) root.querySelector(`#${CSS.escape(foco)}`)?.focus({ preventScroll: true });
  }

  function avisos(v) {
    const n = [];
    if (info.erro && lista.length) n.push(`<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Mostrando os últimos preços, de ${fmtQuando(new Date(info.savedAt))}.</span></div>`);
    if (info.erro && !lista.length && !info.carregando) n.push(`<div class="card empty" role="alert">${icon('wifiOff', 40)}<h3>Não consegui buscar os preços</h3><p>${esc(info.erro.message)} Vou tentar de novo sozinho.</p><button class="btn btn--ghost" data-acao="tentar">Tentar de novo</button></div>`);
    if (v.semPreco.length) n.push(`<div class="notice" role="status">${icon('alert')}<span>Sem preço agora para ${v.semPreco.map(esc).join(', ')}: ${v.semPreco.length > 1 ? 'ficaram fora' : 'ficou fora'} do saldo e do resultado.</span></div>`);
    if (v.erros.length) n.push(`<div class="notice" role="status">${icon('alert')}<span>${v.erros.length === 1 ? 'Uma movimentação não pôde ser somada' : `${v.erros.length} movimentações não puderam ser somadas`} (por exemplo, uma venda maior que as cotas na data). Confira no Histórico.</span></div>`);
    if (estadoAn === 'ausente') n.push(`<div class="notice" role="status">${icon('clock')}<span>A análise (notas, indicação e faixa de preço) ainda não está disponível neste endereço. Preços e resultado continuam valendo.</span></div>`);
    if (estadoAn === 'offline' || estadoAn === 'erro') n.push(`<div class="notice" role="status">${icon('wifiOff')}<span>${estadoAn === 'offline' ? 'Sem conexão e sem cópia guardada' : 'Não consegui ler os arquivos'} da análise: notas e faixas ficam de fora por enquanto.</span></div>`);
    return n.join('');
  }

  const botoes = () => `<div class="sec__acoes">${registrar ? `<button class="btn" type="button" data-reg="">${icon('plus')}Registrar compra</button>` : ''}<a class="btn btn--ghost" href="#carteira/acompanhar">${icon('search')}Acompanhar ativo</a></div>`;

  const vazioHtml = () => `<div class="card empty">${icon('wallet', 40)}<h3>Sua carteira ainda está vazia</h3>
    <p>Registre uma compra para ver saldo, resultado e notas, ou acompanhe ativos só para consulta.</p>${botoes()}</div>`;

  // selos e notas de um ativo
  function seloEnotas(c) {
    const a = analises.get(c);
    if (estadoAn === 'carregando') return { selos: '<span class="skeleton pos__sk" aria-busy="true"></span>', nv: '<span class="skeleton pos__sk" aria-busy="true"></span>', ne: '<span class="skeleton pos__sk" aria-busy="true"></span>' };
    if (!a || a.semDados) {
      const t = estadoAn === 'ok' ? 'Sem análise para este ativo' : 'Análise indisponível';
      return { selos: `<span class="muted">${t}</span>`, nv: '—', ne: '—' };
    }
    const nv = a.valor.semNota ? 'Sem nota' : `${num(a.valor.nota)} de 10${a.valor.cobertura < COBERTURA.completa ? `<br><span class="badge badge--consulta">nota parcial · ${Math.round(a.valor.cobertura * 100)}% dos dados</span>` : ''}`;
    const ne = a.estab.semNota ? 'Sem nota' : `${num(a.estab.nota)} de 10`;
    return { selos: seloHtml(a.indicacao) + faixaHtml(a.faixa), nv, ne };
  }

  const distTxt = (alvo, d) => {
    if (alvo == null) return 'Sem alvo definido.';
    if (d == null) return 'Sem preço para comparar com o alvo.';
    if (Math.abs(d) < 0.05) return 'No alvo.';
    return d < 0 ? `${num(-d)} pp abaixo do alvo.` : `${num(d)} pp acima do alvo.`;
  };
  const campoAlvo = (c, alvo, d, aj = '') => {
    const id = c.replace(/\W/g, '');
    return `<div class="pos__alvo"><div class="field"><label for="al-${id}">Alvo (% da carteira)</label>
      <input id="al-${id}" data-alvo="${esc(c)}" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${alvo ?? ''}" aria-describedby="di-${id}"></div>
      <p class="pos__dist" id="di-${id}">${distTxt(alvo, d)}${aj}</p></div>`;
  };
  const idHtml = (c, b) => `<a class="pos__id" href="#mercado/ativo/${encodeURIComponent(c)}" aria-label="${esc(c)}, ver análise completa no Mercado"><strong>${esc(c)}</strong>${classeDe(c) === 'fii' ? '<span class="badge">FII</span>' : ''}<span class="pos__nome">${esc(b?.nome ?? '')}</span></a>`;

  function secMeus(v) {
    const somaAlvos = Object.values(est.alvos).reduce((s, x) => s + x, 0);
    const aguarda = info.carregando && !lista.length && v.itens.length;
    const cards = aguarda
      ? '<div class="skeleton skeleton--row" aria-busy="true"></div>'.repeat(Math.min(3, v.itens.length))
      : v.itens.map((i, k) => {
        const a1 = k === 0, b = base.get(i.ativo), s = seloEnotas(i.ativo), arq = dataDoArquivo(i.ativo), rec = rendaPorAtivo[i.ativo];
        return `<article class="card pos" data-c="${esc(i.ativo)}">
          <div class="pos__top">${idHtml(i.ativo, b)}<div class="pos__val"><span class="num pos__valor">${R(i.valor)}</span><span class="muted num">${i.qtd} ${i.qtd === 1 ? 'cota' : 'cotas'}</span></div></div>
          <p class="pos__selos">${s.selos}</p>
          <dl class="kv pos__kv">
            <div><dt>Preço atual</dt><dd class="num">${marcador()}${i.preco == null ? '—' : brl(i.preco)}${arq ? ` <span class="muted">(de ${dataNum(arq).slice(0, 5)})</span>` : ''}</dd></div>
            <div><dt>Preço médio</dt><dd class="num">${R(i.precoMedio)}</dd></div>
            <div><dt>Custo</dt><dd class="num">${R(i.custo)}</dd></div>
            <div><dt>Resultado</dt><dd class="num ${cls(i.resultado)}">${i.resultado == null ? '—' : `${RS(i.resultado)} (${pctS(i.resultadoPct == null ? null : i.resultadoPct * 100)})`}</dd></div>
            <div><dt>% da carteira</dt><dd class="num">${i.peso == null ? '—' : `${num(i.peso)}%`}</dd></div>
            <div><dt>Proventos recebidos</dt><dd class="num">${rec ? R(rec) : '—'}</dd></div>
            <div><dt>Nota de valor${a1 ? botaoAjuda('notaValor') : ''}</dt><dd>${s.nv}</dd></div>
            <div><dt>Nota de estabilidade${a1 ? botaoAjuda('notaEstabilidade') : ''}</dt><dd>${s.ne}</dd></div>
          </dl>
          ${campoAlvo(i.ativo, i.alvo, i.distancia, a1 ? botaoAjuda('alvoPct') : '')}
        </article>`;
      }).join('');
    return `<section aria-labelledby="h-meus" class="sec"><div class="sec__head"><h2 id="h-meus">Meus ativos</h2>${somaAlvos > 0 ? `<span class="muted num">Soma dos alvos: ${num(somaAlvos)}%${somaAlvos > 100.05 ? ' (passa de 100%)' : ''}</span>` : ''}</div>
      ${botoes()}${v.itens.length ? `<div class="sec__lista">${cards}</div>` : '<div class="card empty"><p>Você ainda não tem cotas. Registre uma compra para elas aparecerem aqui.</p></div>'}</section>`;
  }

  function secAcomp(v) {
    return `<section aria-labelledby="h-acomp" class="sec"><div class="sec__head"><h2 id="h-acomp">Só consulta</h2></div>
      <p class="muted sec__nota">Ativos que você acompanha sem ter cotas. Servem só para consulta até você registrar uma compra; já podem ter alvo %.</p>
      <div class="sec__lista">${v.acompanhados.map((i, k) => {
        const a1 = k === 0 && !v.itens.length, b = base.get(i.ativo), s = seloEnotas(i.ativo), arq = dataDoArquivo(i.ativo);
        return `<article class="card pos pos--consulta" data-c="${esc(i.ativo)}">
          <div class="pos__top">${idHtml(i.ativo, b)}<div class="pos__val"><span class="badge badge--consulta">Só consulta</span><span class="muted num">0 cotas</span></div></div>
          <p class="pos__selos">${s.selos}</p>
          <dl class="kv pos__kv">
            <div><dt>Preço atual</dt><dd class="num">${marcador()}${i.preco == null ? '—' : brl(i.preco)}${arq ? ` <span class="muted">(de ${dataNum(arq).slice(0, 5)})</span>` : ''}</dd></div>
            <div><dt>Acompanhando desde</dt><dd class="num">${i.desde ? dataBr(i.desde) : '—'}</dd></div>
            <div><dt>Nota de valor${a1 ? botaoAjuda('notaValor') : ''}</dt><dd>${s.nv}</dd></div><div><dt>Nota de estabilidade${a1 ? botaoAjuda('notaEstabilidade') : ''}</dt><dd>${s.ne}</dd></div>
          </dl>
          ${campoAlvo(i.ativo, i.alvo, i.distancia, a1 ? botaoAjuda('alvoPct') : '')}
          <div class="sec__acoes">${registrar ? `<button class="btn btn--ghost" type="button" data-reg="${esc(i.ativo)}">Registrar compra</button>` : ''}<button class="btn btn--quiet" type="button" data-parar="${esc(i.ativo)}">Parar de acompanhar</button></div>
        </article>`;
      }).join('')}</div></section>`;
  }

  // ---------- renda passiva ----------
  function graficoRenda(r) {
    const W = 300, H = 112, topo = 8, base_ = 92, max = Math.max(...r.meses.map((m) => m.valor), 1), larg = W / 12;
    const barras = r.meses.map((m, k) => {
      const h = m.valor ? Math.max(3, (m.valor / max) * (base_ - topo)) : 0;
      return `${m.valor ? `<rect x="${(k * larg + 4).toFixed(1)}" y="${(base_ - h).toFixed(1)}" width="${(larg - 8).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--brand)"/>` : ''}
        <text x="${(k * larg + larg / 2).toFixed(1)}" y="106" text-anchor="middle" font-size="9" fill="var(--muted)">${mesAno(`${m.mes}-15`, false).split(' ')[0].replace('.', '').slice(0, 3)}</text>`;
    }).join('');
    const rotulo = oculto() ? 'Proventos por mês nos últimos 12 meses (valores ocultos)' : `Proventos por mês nos últimos 12 meses, total ${brl(r.total12)}`;
    return `<svg class="renda__graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="${rotulo}"><line x1="0" x2="${W}" y1="${base_}" y2="${base_}" stroke="var(--border)"/>${barras}</svg>`;
  }
  function secRenda(r, patrimonio) {
    if (!r.temDados) {
      return `<section class="card sec" aria-labelledby="h-renda"><h2 id="h-renda">Renda passiva</h2>
        <div class="vazio-in">${icon('trend', 28)}<p>Ainda não há proventos lançados. Quando você lançar no Histórico os dividendos e rendimentos que recebe, a renda por mês e por ano aparece aqui. Nada é estimado sem o seu lançamento.</p></div>
        <a class="btn btn--ghost" href="#historico">Ir para o Histórico</a></section>`;
    }
    const yoc = patrimonio > 0 ? (r.total12 / patrimonio) * 100 : null;
    return `<section class="card sec" aria-labelledby="h-renda"><h2 id="h-renda">Renda passiva</h2>
      <dl class="kv kv--3"><div><dt>Por mês (média)</dt><dd class="num">${R(r.mediaMensal)}</dd></div><div><dt>Por ano (12 meses)</dt><dd class="num">${R(r.total12)}</dd></div>
        <div><dt>Sobre o patrimônio</dt><dd class="num">${yoc == null ? '—' : `${num(yoc)}% a.a.`}</dd></div></dl>
      ${graficoRenda(r)}
      <details class="det"><summary>Ver os valores de cada mês</summary><ul class="det__lista">${r.meses.map((m) => `<li><span>${mesAno(`${m.mes}-15`)}</span><span class="num">${R(m.valor)}</span></li>`).join('')}</ul></details>
      <p class="src">Soma dos proventos que você lançou no Histórico nos últimos 12 meses, dividida por 12 (mês sem lançamento conta zero). Não é previsão nem vem de nenhuma API.</p></section>`;
  }

  // ---------- metas ----------
  const barraMeta = (rotulo, atual, meta, prog) => `<div class="bar"><div class="bar__top"><span>${rotulo}</span><span class="num">${num(prog * 100, 0)}%</span></div>
    <div class="bar__trilho" aria-hidden="true"><i style="width:${Math.round(prog * 100)}%"></i></div>
    <p class="muted num" style="font-size:var(--fs-sm)">${R(atual)} de ${R(meta)}</p></div>`;
  function textoEstimativa(e, status) {
    if (!e) return status.origemAporte ? 'Ainda não consigo estimar a data.' : 'Sem aportes registrados nem aporte mensal definido: não consigo estimar a data, e prefiro não inventar um ritmo.';
    if (e.meses === 0) return 'Meta atingida.';
    if (e.meses > 600) return 'No ritmo atual a meta levaria mais de 50 anos: aumentar o aporte muda bastante essa conta.';
    const ritmo = status.origemAporte === 'historico' ? 'média dos seus últimos aportes' : 'aporte mensal que você definiu';
    return `No ritmo de ${R(status.aporteMensal)} por mês (${ritmo}), a meta chega em cerca de ${e.meses} ${e.meses === 1 ? 'mês' : 'meses'} (${mesAno(e.data)}). Conta só os aportes, sem valorização nem proventos.`;
  }
  function secMetas(status) {
    const m = est.metas, edita = `<a class="btn btn--ghost" href="#carteira/metas">${m.patrimonio || m.rendaMensal || m.prazoAnos ? 'Editar metas' : 'Definir metas'}</a>`;
    if (!status.patrimonio && !status.renda) {
      return `<section class="card sec" aria-labelledby="h-metas"><h2 id="h-metas">Metas</h2><div class="vazio-in">${icon('target', 28)}<p>Você ainda não definiu metas. Escolha um patrimônio ou uma renda mensal que quer alcançar e acompanhe o progresso com calma.</p></div>${edita}</section>`;
    }
    const p = status.patrimonio, r = status.renda;
    return `<section class="card sec" aria-labelledby="h-metas"><h2 id="h-metas">Metas</h2>
      ${p ? `<div class="meta">${barraMeta('Patrimônio', p.atual, p.meta, p.prog)}<p>${textoEstimativa(p.estimativa, status)}</p></div>` : ''}
      ${r ? `<div class="meta">${barraMeta('Renda mensal (média dos proventos)', r.atual, r.meta, r.prog)}
        <p>${r.patrimonioNecessario ? `Com o rendimento atual da carteira, essa renda pediria um patrimônio de cerca de ${R(r.patrimonioNecessario)}. ${textoEstimativa(r.estimativa, status)}` : 'Quando houver proventos lançados, calculo o patrimônio que essa renda pediria.'}</p></div>` : ''}
      ${status.prazo ? `<p>Prazo: ${status.prazo.anos} ${status.prazo.anos === 1 ? 'ano' : 'anos'} (até ${mesAno(status.prazo.data)}). ${status.prazo.dentro == null ? 'Sem estimativa de data para comparar.' : status.prazo.dentro ? 'A estimativa cai dentro do prazo.' : 'A estimativa passa do prazo; ajustar o aporte ou o prazo muda isso.'}</p>` : ''}
      ${edita}<p class="src">Estimativas simples, só com aportes. Não são previsão.</p></section>`;
  }

  // ---------- concentração e risco ----------
  function secRisco(comValor) {
    const itens = comValor.map((i) => ({ ativo: i.ativo, valor: i.valor, qtd: i.qtd }));
    const c = concentracao(itens);
    if (!c) return `<section class="card sec" aria-labelledby="h-risco"><h2 id="h-risco">Concentração e risco</h2><div class="vazio-in">${icon('shield', 28)}<p>Preciso do preço de pelo menos um ativo para calcular a concentração. Assim que a cotação chegar, os números aparecem aqui.</p></div></section>`;
    const classeG = pesoPorGrupo(itens, (a) => (classeDe(a) === 'fii' ? 'FIIs' : 'Ações'));
    const setorG = pesoPorGrupo(itens, (a) => (classeDe(a) === 'fii' ? (SEGMENTOS[dArq?.fiis.data?.ativos?.[a]?.segmento] ?? 'FIIs') : (SETORES[base.get(a)?.setor] ?? base.get(a)?.setor)));
    const barras = (g) => g.map((x) => `<div class="bar"><div class="bar__top"><span>${esc(x.grupo)}</span><span class="num">${num(x.peso)}%</span></div><div class="bar__trilho" aria-hidden="true"><i style="width:${Math.round(x.peso)}%"></i></div></div>`).join('');
    const faixaTxt = { diversificada: 'diversificada', moderada: 'moderadamente concentrada', concentrada: 'concentrada', 'muito concentrada': 'muito concentrada' }[c.faixa];

    // risco histórico: precisa dos arquivos de preço dos ativos
    const rk = riscoCarteira(itens, Object.fromEntries(series));
    const pendenteArq = tickers().some((t) => !tentadas.has(t));
    const totalV = itens.reduce((s, i) => s + i.valor, 0), usadoV = itens.filter((i) => rk.usados.includes(i.ativo)).reduce((s, i) => s + i.valor, 0);
    const saltos = rk.usados.filter((t) => dArq?.risco.data?.ativos?.[t]?.saltos > 0);
    let risco;
    if (pendenteArq && !rk.pregoes) risco = '<div class="skeleton" style="height:64px" aria-busy="true"></div>';
    else if (!rk.pregoes) risco = `<p>Sem histórico de preços para os seus ativos neste endereço: volatilidade e queda máxima ficam de fora até os dados de preço existirem.</p>`;
    else risco = `<dl class="kv"><div><dt>Volatilidade ao ano${botaoAjuda('volatilidade')}</dt><dd class="num">${rk.vol == null ? '—' : `${num(rk.vol * 100)}%`}</dd></div><div><dt>Queda máxima${botaoAjuda('quedaMaxima')}</dt><dd class="num">${rk.queda == null ? '—' : `${num(rk.queda * 100)}%`}</dd></div></dl>
      <p class="src">Calculado com ${rk.usados.length} de ${itens.length} ativos (${num((usadoV / totalV) * 100, 0)}% do valor)${rk.fora.length ? `, sem histórico de ${rk.fora.map(esc).join(', ')}` : ''}, em ${rk.pregoes} pregões de ${dataNum(rk.de)} a ${dataNum(rk.ate)}. Simula as cotas de hoje mantidas por todo o período (não é o histórico do seu patrimônio). Preços da B3 (COTAHIST)${dArq?.risco.data?.dataBase ? ` até ${dataBr(dArq.risco.data.dataBase)}` : ''}.${rk.vol == null ? ' Poucos dias em comum para a volatilidade.' : ''}</p>
      ${saltos.length ? `<p class="src">Desdobramento ou grupamento no histórico de ${saltos.map(esc).join(', ')}: o risco pode estar distorcido.</p>` : ''}`;

    return `<section class="card sec" aria-labelledby="h-risco"><h2 id="h-risco">Concentração e risco</h2>
      <dl class="kv"><div><dt>Concentração (HHI)${botaoAjuda('hhi')}</dt><dd class="num">${num(c.hhi, 0)}</dd></div><div><dt>Nº efetivo de ativos${botaoAjuda('nEfetivo')}</dt><dd class="num">${num(c.nEfetivo)}</dd></div></dl>
      <p>Carteira ${faixaTxt}: ${c.n} ${c.n === 1 ? 'ativo' : 'ativos'}, que pesam como ${num(c.nEfetivo)} de mesmo tamanho. Maior posição: ${esc(c.maior.ativo)}, com ${num(c.maior.peso)}%.</p>
      <div class="rk"><h3>Por classe</h3>${barras(classeG)}</div>
      <div class="rk"><h3>Por setor</h3>${barras(setorG)}</div>
      <div class="rk"><h3>Oscilação da carteira</h3>${risco}</div>
      <details class="det"><summary>Como ler estes números</summary><ul class="det__texto">
        <li>HHI soma o quadrado do peso (em %) de cada ativo. Até 1.000 é diversificada; até 1.800, moderada; até 2.500, concentrada; acima disso, muito concentrada.</li>
        <li>Nº efetivo é 10.000 ÷ HHI: quantos ativos de mesmo peso dariam a mesma concentração.</li>
        <li>Volatilidade mostra o quanto o valor costuma oscilar em um ano. Queda máxima é a maior queda do pico até o vale no período.</li>
        <li>É material de estudo, não recomendação. Resultado passado não garante resultado futuro.</li></ul></details></section>`;
  }

  function rodape() {
    const partes = [];
    if (info.savedAt) partes.push(`Preços: brapi · consultado em ${fmtQuando(new Date(info.savedAt))}. Ações podem ter atraso de cerca de 30 minutos.`);
    const g = dArq?.fundamentos.data?.geradoEm ?? dArq?.fiis.data?.geradoEm;
    if (g) partes.push(`Notas, faixas e risco: CVM e B3, arquivo gerado em ${fmtQuando(new Date(g))}.`);
    return `<p class="src">${partes.join(' ')}</p>
      <aside class="card pos-aviso"><strong>Material educacional, não é recomendação</strong><p>Notas, indicações e a faixa barato, normal ou caro são leituras de números (balanços, preços e risco) e comparam o ativo com os próprios dados. Notícias e fatos relevantes não entram. Resultado passado não garante resultado futuro.</p></aside>`;
  }

  // ---------- carregamento ----------
  async function carregarLista({ forcar = false } = {}) {
    const seg = prefsApp().cotacaoSegundos, aberto = ctx.estado().state !== 'fechado';
    const r = await listarAtivos({ ttlMs: forcar || (aberto && lista.length) ? seg * 1000 : 12 * 3600_000 });
    if (!vivo) return;
    info = { savedAt: r.savedAt, erro: r.error, stale: r.stale, carregando: false };
    if (r.data) {
      lista = r.data; base = new Map(lista.map((a) => [a.codigo, a]));
      precos = new Map(lista.filter((a) => Number.isFinite(a.preco) && a.preco > 0).map((a) => [a.codigo, centavos(a.preco)]));
      if (!r.stale && r.savedAt) ctx.definirUltimaCotacao(new Date(r.savedAt));
    }
    desenhar();
  }

  async function cdiAnual() {
    const x = (await ultimos(SERIES.cdi, 1)).data?.at(-1)?.valor;
    return x > 0 ? (1 + x / 100) ** 252 - 1 : null;
  }
  function ctxAnalise(d) {
    const k = [d.fundamentos.data, d.fiis.data, d.risco.data, lista, cdi];
    if (k.every((x, i) => x === memoCtx.k[i])) return memoCtx.v;
    const setores = Object.fromEntries(lista.filter((a) => a.tipo === 'acao' && a.setor).map((a) => [a.codigo, a.setor]));
    const v = montarCtx({ risco: d.risco.data, fundamentos: d.fundamentos.data, fiis: d.fiis.data, cdi, setores });
    memoCtx = { k, v };
    return v;
  }

  // arquivos de preço dos meus ativos (um por ativo, mesma origem), depois as notas; cada etapa redesenha
  async function enriquecer() {
    if (rodando) { repetir = true; return; }
    rodando = true;
    try {
      do {
        repetir = false;
        const falta = tickers().filter((t) => !tentadas.has(t));
        const [, d, c] = await Promise.all([
          Promise.all(falta.map(async (t) => { const r = await carregarPrecos(t); tentadas.add(t); if (r.data) series.set(t, r.data); })),
          carregarDados(), dArq ? cdi : cdiAnual().catch(() => null),
        ]);
        if (!vivo) return;
        dArq = d; cdi = c;
        const arqs = [d.fundamentos, d.fiis, d.risco], quebrado = arqs.find((x) => x.erro && !x.data);
        estadoAn = arqs.every((x) => x.ausente) ? 'ausente' : quebrado ? (quebrado.offline ? 'offline' : 'erro') : 'ok';
        desenhar(); // preços de arquivo e risco já aparecem antes das notas
        if (estadoAn === 'ok' && (lista.length || d.fiis.data)) {
          const cx = ctxAnalise(d), ef = precosEfetivos();
          for (const t of tickers()) {
            const classe = classeDe(t), arquivo = classe === 'fii' ? d.fiis : d.fundamentos;
            if (!arquivo.data) continue;
            analises.set(t, analisar({ ticker: t, classe, preco: ef.has(t) ? ef.get(t) / 100 : null, dados: { fundamentos: d.fundamentos.data, fiis: d.fiis.data, risco: d.risco.data }, ctx: cx, setor: base.get(t)?.setor ?? null, precos5a: series.get(t)?.p ?? null }));
          }
          desenhar();
        }
      } while (repetir && vivo);
    } catch { estadoAn = 'erro'; desenhar(); } finally { rodando = false; }
  }

  // ---------- painéis ----------
  function abrirPainel(nome, html) {
    dlg.querySelector('#sheetTitulo').textContent = nome;
    dlg.querySelector('#sheetBody').innerHTML = html;
    painel = nome;
    if (!dlg.open) dlg.showModal();
    return dlg.querySelector('#sheetBody');
  }
  const aoFechar = () => { painel = null; if (location.hash.startsWith('#carteira/')) history.replaceState(null, '', '#carteira'); };
  dlg.addEventListener('close', aoFechar);

  async function painelAcompanhar() {
    const corpo = abrirPainel('Acompanhar ativo', `<p class="muted">Acompanhar serve só para consulta: o ativo aparece na Carteira com o selo “Só consulta”, sem cotas, até você registrar uma compra. Ele já pode receber alvo %.</p>
      <div class="field search"><span>${icon('search')}</span><input id="pq" type="search" autocomplete="off" placeholder="Buscar por código ou nome" aria-label="Buscar ativo por código ou nome"></div>
      <div id="pr" aria-live="polite"></div>`);
    const q = corpo.querySelector('#pq'), saida = corpo.querySelector('#pr');
    if (!lista.length) { // aberto direto pelo endereço: a lista ainda pode estar a caminho
      saida.innerHTML = '<div class="skeleton skeleton--row" aria-busy="true"></div>';
      await carregarLista();
    }
    let emCarteira = new Set();
    const linha = (a) => {
      const na = emCarteira.has(a.codigo);
      const ja = est.acompanhados.some((x) => x.ticker === a.codigo);
      return `<li><div class="asset-row"><span class="asset-row__logo" aria-hidden="true">${esc(a.codigo.slice(0, 2))}</span>
        <span class="col"><span class="asset-row__code">${esc(a.codigo)}${a.tipo === 'fii' ? '<span class="badge">FII</span>' : ''}</span><span class="asset-row__name">${esc(a.nome)}</span></span>
        <button class="btn btn--ghost" type="button" data-seg="${esc(a.codigo)}" ${na || ja ? 'disabled' : ''}>${na ? 'Na carteira' : ja ? 'Acompanhando' : 'Acompanhar'}</button></div></li>`;
    };
    const buscar = () => {
      if (!lista.length) { saida.innerHTML = `<div class="empty" role="alert">${icon('wifiOff', 40)}<h3>Lista indisponível</h3><p>Não consegui buscar os ativos agora. Tente de novo em instantes.</p></div>`; return; }
      emCarteira = new Set(visaoCarteira(est, {}).itens.map((i) => i.ativo));
      const t = norm(q.value.trim());
      if (!t) { saida.innerHTML = '<p class="muted">Digite parte do código ou do nome do ativo.</p>'; return; }
      const r = lista.filter((a) => norm(a.codigo).includes(t) || norm(a.nome).includes(t));
      saida.innerHTML = r.length ? `<ul class="asset-list">${r.slice(0, 40).map(linha).join('')}</ul>${r.length > 40 ? `<p class="src">Mostrando 40 de ${r.length}. Refine a busca.</p>` : ''}` : '<div class="empty"><h3>Nenhum ativo encontrado</h3><p>Tente outro código ou nome.</p></div>';
    };
    q.addEventListener('input', buscar);
    saida.addEventListener('click', (e) => {
      const b = e.target.closest('[data-seg]');
      if (!b) return;
      const c = b.dataset.seg;
      if (usuario.acompanhar(c).ok === false) return;
      b.disabled = true; b.textContent = 'Acompanhando';
      aviso(`${c} entrou na sua lista de consulta.`, () => { usuario.desacompanhar(c); b.disabled = false; b.textContent = 'Acompanhar'; });
    });
    buscar();
    q.focus();
  }

  function painelMetas() {
    const m = est.metas, val = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
    const corpo = abrirPainel('Metas', `<p class="muted">Deixe em branco o que não quiser acompanhar. Os valores são só para você acompanhar o progresso.</p>
      <form id="fm" class="form" novalidate>
        <div class="field"><label for="mp">Patrimônio que quero alcançar (R$)</label><input id="mp" inputmode="decimal" autocomplete="off" placeholder="Ex.: 100.000,00" value="${val(m.patrimonio)}"></div>
        <div class="field"><label for="mr">Renda mensal que quero receber (R$)</label><input id="mr" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1.000,00" value="${val(m.rendaMensal)}"></div>
        <div class="field"><label for="ma">Prazo (anos)</label><input id="ma" inputmode="numeric" autocomplete="off" placeholder="Ex.: 10" value="${m.prazoAnos ?? ''}"></div>
        <button class="btn btn--block" type="submit">Salvar metas</button></form>`);
    corpo.querySelector('#fm').addEventListener('submit', (e) => {
      e.preventDefault();
      const campo = (id, ler, msg) => {
        const el = corpo.querySelector(id), f = el.closest('.field'), t = el.value.trim();
        f.removeAttribute('data-invalid'); f.querySelector('.field__error')?.remove();
        if (!t) return { ok: true, v: null };
        const v = ler(t);
        if (v != null) return { ok: true, v };
        f.dataset.invalid = ''; f.insertAdjacentHTML('beforeend', `<p class="field__error" role="alert">${icon('alert', 16)}${msg}</p>`);
        return { ok: false };
      };
      const p = campo('#mp', reaisParaCentavos, 'Use um valor em reais maior que zero, como 100.000,00.');
      const r = campo('#mr', reaisParaCentavos, 'Use um valor em reais maior que zero, como 1.000,00.');
      const a = campo('#ma', (t) => (/^\d{1,2}$/.test(t) && +t >= 1 ? +t : null), 'Use um número inteiro de anos, de 1 a 99.');
      if (!(p.ok && r.ok && a.ok)) { corpo.querySelector('[data-invalid] input')?.focus(); return; }
      usuario.definirMetas({ patrimonio: p.v, rendaMensal: r.v, prazoAnos: a.v });
      dlg.close();
      aviso('Metas salvas.');
    });
  }

  // ---------- eventos ----------
  const soltarAjuda = ligarAjuda(root, ctx);
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#olho')) usuario.definirPrefs({ ocultarValores: !oculto() });
    else if (t.closest('[data-reg]')) registrar?.abrirRegistro(ctx, { tipo: 'compra', ativo: t.closest('[data-reg]').dataset.reg || undefined });
    else if (t.closest('[data-parar]')) {
      const c = t.closest('[data-parar]').dataset.parar;
      usuario.desacompanhar(c);
      aviso(`${c} saiu da sua lista de consulta.`, () => usuario.acompanhar(c));
    } else if (t.closest('[data-acao="tentar"]')) { info.carregando = true; carregarLista({ forcar: true }); }
  });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-alvo]')) sujo = true; });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches('[data-alvo]')) return;
    sujo = false;
    const f = el.closest('.field'), txt = el.value.trim(), v = txt === '' ? null : Number(txt);
    f.removeAttribute('data-invalid'); f.querySelector('.field__error')?.remove();
    const r = Number.isFinite(v) || v === null ? usuario.definirAlvo(el.dataset.alvo, v) : { ok: false };
    if (r.ok === false) {
      f.dataset.invalid = ''; f.insertAdjacentHTML('beforeend', `<p class="field__error" role="alert">${icon('alert', 16)}Use um percentual entre 0 e 100, como 12,5.</p>`);
      return;
    }
    if (pendente) { pendente = false; desenhar(); }
  });
  root.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-alvo]') && !e.target.closest('.field')?.hasAttribute('data-invalid')) { sujo = false; if (pendente) { pendente = false; desenhar(); } } });

  const parar = usuario.ouvir(() => { est = usuario.ler(); desenhar(); enriquecer(); });
  // atualiza sozinho: com pregão aberto e aba visível, confere a cada 15 s se venceu o intervalo (ou se a primeira busca falhou)
  const timer = setInterval(() => {
    if (document.hidden) return;
    const venceu = info.savedAt && Date.now() - info.savedAt >= prefsApp().cotacaoSegundos * 1000;
    if (!lista.length || (ctx.estado().state !== 'fechado' && venceu)) carregarLista();
  }, 15_000);
  const visivel = () => { if (!document.hidden && ctx.estado().state !== 'fechado') carregarLista(); };
  document.addEventListener('visibilitychange', visivel);

  // "Registrar compra" só existe se o painel de registro já foi entregue
  import('../ui/registrar.js').then((m) => { if (vivo && typeof m.abrirRegistro === 'function') { registrar = m; desenhar(); } }, () => {});

  tela = {
    rota(partes) {
      if (partes[0] === 'acompanhar') painelAcompanhar();
      else if (partes[0] === 'metas') painelMetas();
      else if (painel && dlg.open) dlg.close();
    },
  };
  desenhar();
  carregarLista().then(() => { if (vivo) enriquecer(); });
  return () => {
    vivo = false; tela = null; soltarAjuda(); parar(); clearInterval(timer);
    document.removeEventListener('visibilitychange', visivel);
    dlg.removeEventListener('close', aoFechar);
    if (painel && dlg.open) dlg.close();
  };
}
