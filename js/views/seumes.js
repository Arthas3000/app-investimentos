// Seu mês (#seumes, fora da barra): aportes, proventos, patrimônio x investido, alvos x realidade e marcos.
// Preços de fim de mês vêm de dados/precos/{T}.json; sem arquivo, o ativo entra pelo preço médio (e a tela avisa).
import { icon } from '../ui/icons.js';
import { botaoAjuda, ligarAjuda } from '../ui/ajuda.js';
import { brl } from '../ui/kit.js';
import { carregarPrecos } from '../data/dados.js';
import * as usuario from '../data/carteira.js';
import { addMeses, mesDe } from '../core/datas.js';
import { fechamentoMes, resumoMes, serieMensal, marcos as calcMarcos, novosMarcos } from '../core/seu-mes.js';

const CHAVE_MARCOS = 'marcos.v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sinal = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');
const cls = (n) => (n > 0 ? 'gain' : n < 0 ? 'loss' : '');
const p2 = (n) => String(n).padStart(2, '0');
const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const mesLongo = (m) => new Date(+m.slice(0, 4), +m.slice(5) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const mesCurto = (m) => `${m.slice(5)}/${m.slice(0, 4)}`;
const dataBr = (n) => { const s = String(n); return `${s.slice(6)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
const OCULTO = '<span role="img" aria-label="valor oculto">••••</span>';

// marcos já mostrados: chave própria no localStorage; se o navegador negar, vale só nesta sessão
let vistosMem = new Set();
export function lerVistos() {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_MARCOS) ?? '[]');
    if (Array.isArray(v)) vistosMem = new Set([...vistosMem, ...v.filter((x) => typeof x === 'string')]);
  } catch { /* ilegível ou bloqueado: usa a memória */ }
  return [...vistosMem];
}
function gravarVisto(id) {
  vistosMem.add(id);
  try { localStorage.setItem(CHAVE_MARCOS, JSON.stringify([...vistosMem])); } catch { /* só nesta sessão */ }
}

let mesSel = null; // o mês escolhido sobrevive a ir para outra aba e voltar

export function montar(root, ctx) {
  let vivo = true, est = null, falhaLeitura = false, carregando = true;
  let series = new Map(), falhas = [], desatualizado = false;

  root.innerHTML = `
    <div class="sm-mes" id="smNav" hidden>
      <button class="icon-btn sm-seta sm-seta--ant" type="button" id="smAnt" aria-label="Mês anterior">${icon('chevronRight', 22)}</button>
      <span class="sm-mes__txt" id="smMesTxt" aria-live="polite"></span>
      <button class="icon-btn sm-seta" type="button" id="smProx" aria-label="Próximo mês">${icon('chevronRight', 22)}</button>
    </div>
    <div id="smAvisos"></div><div id="smNovos"></div><div id="smCorpo"></div><div id="smCaminho"></div><div id="smFonte"></div>`;
  const $ = (s) => root.querySelector(s);

  const oculto = () => est?.prefs.ocultarValores === true;
  const R = (c) => (oculto() ? OCULTO : brl(c));
  const RS = (c) => (oculto() ? OCULTO : `${sinal(c)}${brl(Math.abs(c))}`);

  // ---------- dados ----------
  async function carregar() {
    carregando = true; falhaLeitura = false; desenhar();
    try { est = usuario.ler(); } catch { falhaLeitura = true; carregando = false; return desenhar(); }
    const ativos = [...new Set(est.transacoes.filter((t) => !t.excluido && t.ativo).map((t) => t.ativo))];
    const rs = await Promise.all(ativos.map((t) => carregarPrecos(t)));
    if (!vivo) return;
    series = new Map(); falhas = []; desatualizado = false;
    rs.forEach((r, i) => {
      if (r.data) { series.set(ativos[i], r.data); if (r.stale) desatualizado = true; }
      else if (r.erro) falhas.push(ativos[i]); // arquivo ausente não é falha: o ativo só entra pelo preço médio
    });
    carregando = false; desenhar();
  }

  const mesesDe = (de, ate) => { const o = []; for (let m = de; m <= ate; m = mesDe(addMeses(`${m}-01`, 1))) o.push(m); return o; };

  // ---------- desenho ----------
  function desenhar() {
    if (!vivo) return;
    if (carregando) {
      $('#smNav').hidden = true; $('#smAvisos').innerHTML = ''; $('#smNovos').innerHTML = ''; $('#smCaminho').innerHTML = ''; $('#smFonte').innerHTML = '';
      $('#smCorpo').innerHTML = '<div class="sm-cards" aria-busy="true" aria-label="Carregando"><div class="skeleton sm-sk"></div><div class="skeleton sm-sk"></div><div class="skeleton sm-sk"></div><div class="skeleton sm-sk"></div></div>';
      return;
    }
    if (falhaLeitura) {
      $('#smCorpo').innerHTML = `<div class="card empty">${icon('alert', 40)}<h2>Não foi possível ler seus dados</h2><p>O armazenamento deste navegador não respondeu. Nada foi apagado.</p><button class="btn" id="smTentar">Tentar de novo</button></div>`;
      $('#smTentar').onclick = carregar;
      return;
    }
    const ts = est.transacoes.filter((t) => !t.excluido);
    if (!ts.length) {
      $('#smNav').hidden = true; $('#smAvisos').innerHTML = ''; $('#smNovos').innerHTML = ''; $('#smCaminho').innerHTML = ''; $('#smFonte').innerHTML = '';
      $('#smCorpo').innerHTML = `<div class="card empty">${icon('target', 40)}<h2>Seu mês aparece aqui</h2><p>Quando você registrar uma compra ou um provento, o resumo do mês e o seu caminho ficam nesta tela.</p><a class="btn" href="#home">Ir para a Home</a></div>`;
      return;
    }

    const hoje = hojeLocal(), atual = mesDe(hoje);
    const primeiro = mesDe(ts.reduce((m, t) => (t.data < m ? t.data : m), ts[0].data));
    if (!mesSel || mesSel > atual || mesSel < primeiro) mesSel = atual < primeiro ? primeiro : atual;
    const ant = mesDe(addMeses(`${mesSel}-01`, -1));

    // preços de fim de cada mês, a partir dos arquivos (ativo sem arquivo ou sem pregão no mês fica de fora e vira "estimado")
    const precosPorMes = {};
    for (const m of mesesDe(primeiro, atual)) {
      const o = {};
      for (const [t, s] of series) {
        // mês corrente ainda sem pregão nos arquivos (ex.: dia 1): vale o último fechamento disponível
        const c = fechamentoMes(s, m) ?? (m === atual ? s.p?.at(-1) : null);
        if (c) o[t] = c;
      }
      precosPorMes[m] = o;
    }
    const serie = serieMensal({ transacoes: est.transacoes, precosPorMes, ate: atual });
    const r = resumoMes({ transacoes: est.transacoes, mes: mesSel, precosMes: precosPorMes[mesSel] ?? {}, precosAnterior: precosPorMes[ant] ?? {}, alvos: est.alvos });
    // marcos de patrimônio só olham meses com todos os preços (nada de marco sobre número aproximado)
    const alc = calcMarcos({ transacoes: est.transacoes, patrimonioPorMes: serie.filter((x) => !x.estimados.length), hoje });
    const vistos = lerVistos(), novos = novosMarcos(alc, vistos);

    pintarNav(primeiro, atual);
    pintarAvisos(r);
    $('#smNovos').innerHTML = novos.map((m) => `<section class="card sm-marco" aria-label="Novo no seu caminho"><p class="sm-marco__t">${esc(m.texto)}</p><button class="btn btn--ghost" type="button" data-visto="${esc(m.id)}">Entendi</button></section>`).join('');
    $('#smCorpo').innerHTML = cartoes(r, mesSel === atual) + grafico(serie.filter((x) => x.mes <= mesSel).slice(-36)) + alvos(r);
    const jaVistos = alc.filter((m) => vistos.includes(m.id));
    $('#smCaminho').innerHTML = jaVistos.length
      ? `<section class="card sm-caminho"><h2 class="sm-h" id="smCaminhoT" tabindex="-1">Seu caminho</h2><ul aria-labelledby="smCaminhoT">${jaVistos.map((m) => `<li>${esc(m.texto)}</li>`).join('')}</ul></section>` : '';
    pintarFonte();
  }

  function pintarNav(primeiro, atual) {
    $('#smNav').hidden = false;
    $('#smMesTxt').textContent = mesLongo(mesSel);
    $('#smAnt').disabled = mesSel <= primeiro; $('#smProx').disabled = mesSel >= atual;
  }

  function pintarAvisos(r) {
    const av = [];
    if (falhas.length) av.push(`<div class="notice" role="alert">${icon('wifiOff')}<span>Não consegui ler os preços de ${esc(falhas.join(', '))} agora. Esses ativos aparecem pelo seu preço médio.</span><button type="button" class="btn btn--quiet" id="smRetry">Tentar de novo</button></div>`);
    else if (desatualizado) av.push(`<div class="notice" role="status">${icon('wifiOff')}<span>Sem conexão. Mostrando os últimos preços salvos neste aparelho.</span></div>`);
    if (r.estimados.length) av.push(`<div class="notice" role="status">${icon('alert')}<span>Sem preço de fim de mês para ${esc(r.estimados.join(', '))}: uso o seu preço médio. O patrimônio deste mês é aproximado.</span></div>`);
    $('#smAvisos').innerHTML = av.length ? `<div class="sm-avisos">${av.join('')}</div>` : '';
  }

  const evol = (e, rotulo) => (e.pct == null
    ? `<span class="muted">${rotulo}: primeiro mês com a carteira</span>`
    : `<span class="${cls(e.valor)}">${RS(e.valor)} (${sinal(e.valor)}${num(Math.abs(e.pct), 2)}%)</span><span class="muted"> ${rotulo}</span>`);

  function cartoes(r, corrente) {
    const nTxt = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    const prov = r.proventos.n
      ? `<ul class="sm-lista">${r.proventos.porAtivo.map((p) => `<li><span>${esc(p.ativo)}</span><span class="num">${R(p.valor)}</span></li>`).join('')}</ul>`
      : '<p class="muted">Nenhum provento registrado neste mês.</p>';
    return `<div class="sm-cards">
      <section class="card sm-card" aria-labelledby="smA"><h2 class="sm-h" id="smA">Aportes do mês</h2>
        ${r.aportes.n ? `<p class="sm-v num">${R(r.aportes.total)}</p><p class="muted">${nTxt(r.aportes.n, 'compra', 'compras')}${r.aportes.taxas ? `, com ${R(r.aportes.taxas)} de taxas` : ''}</p>` : '<p class="sm-v num">—</p><p class="muted">Nenhum aporte registrado neste mês.</p>'}
      </section>
      <section class="card sm-card" aria-labelledby="smP"><h2 class="sm-h" id="smP">Proventos recebidos</h2>
        <p class="sm-v num">${r.proventos.n ? R(r.proventos.total) : '—'}</p>${prov}
      </section>
      <section class="card sm-card" aria-labelledby="smPat"><h2 class="sm-h" id="smPat">Patrimônio${corrente ? ' até agora' : ' no fim do mês'}</h2>
        <p class="sm-v num">${r.fim.patrimonio || r.anterior.patrimonio ? R(r.fim.patrimonio) : '—'}</p><p class="sm-ev num">${evol(r.evolucao.patrimonio, 'sobre o mês anterior')}</p>
      </section>
      <section class="card sm-card" aria-labelledby="smInv"><h2 class="sm-h" id="smInv">Valor investido</h2>
        <p class="sm-v num">${r.fim.investido || r.anterior.investido ? R(r.fim.investido) : '—'}</p><p class="sm-ev num">${evol(r.evolucao.investido, 'sobre o mês anterior')}</p>
      </section>
    </div>
    <p class="field__hint sm-nota">A evolução do patrimônio inclui o que você aportou no mês, não só a variação dos preços. Valor investido é o custo das cotas que você tem, com taxas.</p>`;
  }

  function grafico(pts) {
    if (pts.length < 2) return '<section class="card" aria-labelledby="smGT"><h2 class="sm-h" id="smGT">Patrimônio e valor investido</h2><p class="muted">O gráfico aparece a partir do segundo mês da sua carteira.</p></section>';
    const W = 320, H = 120, max = Math.max(...pts.flatMap((p) => [p.patrimonio, p.investido]), 1) * 1.05;
    const x = (i) => ((i / (pts.length - 1)) * W).toFixed(1), y = (v) => (H - (v / max) * H).toFixed(1);
    const linha = (k) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i)} ${y(p[k])}`).join(' ');
    const [a, b] = [pts[0], pts.at(-1)];
    const rotulo = `Patrimônio e valor investido de ${mesCurto(a.mes)} a ${mesCurto(b.mes)}.${oculto() ? '' : ` Patrimônio foi de ${brl(a.patrimonio)} para ${brl(b.patrimonio)}; valor investido, de ${brl(a.investido)} para ${brl(b.investido)}.`}`;
    const tabela = pts.slice(-12).reverse().map((p) => `<tr><th scope="row">${mesCurto(p.mes)}</th><td class="num">${R(p.patrimonio)}</td><td class="num">${R(p.investido)}</td></tr>`).join('');
    return `<section class="card sm-graf" aria-labelledby="smGT"><h2 class="sm-h" id="smGT">Patrimônio e valor investido</h2>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(rotulo)}"><path class="area" d="${linha('patrimonio')} L${W} ${H} L0 ${H}Z"/><path class="line" d="${linha('patrimonio')}"/><path class="line inv" d="${linha('investido')}"/></svg>
      <div class="sm-graf__eixo muted"><span>${mesCurto(a.mes)}</span><span>${mesCurto(b.mes)}</span></div>
      <p class="sm-leg"><span><i class="sm-leg__a"></i>Patrimônio (linha cheia)</span><span><i class="sm-leg__b"></i>Valor investido (tracejada)</span></p>
      <details class="sm-det"><summary>Ver valores por mês</summary><div class="sm-tab"><table><thead><tr><th scope="col">Mês</th><th scope="col">Patrimônio</th><th scope="col">Investido</th></tr></thead><tbody>${tabela}</tbody></table></div></details>
    </section>`;
  }

  function alvos(r) {
    if (!r.alvos.length) return '';
    const semAlvo = !r.alvos.some((l) => l.alvo != null);
    const linha = (l) => {
      const d = l.distancia;
      const txt = d == null ? 'sem alvo' : Math.abs(d) < 0.05 ? 'no alvo' : `${num(Math.abs(d), 1)} pp ${d > 0 ? 'acima' : 'abaixo'} do alvo`;
      return `<li class="sm-alvo"><div class="sm-alvo__top"><strong>${esc(l.ativo)}</strong><span class="num">${num(l.peso, 1)}%${l.alvo != null ? ` de ${num(l.alvo, 1)}%` : ''}</span></div>
        <div class="sm-bar" aria-hidden="true"><i style="width:${Math.min(100, l.peso).toFixed(1)}%"></i>${l.alvo != null ? `<b style="left:${Math.min(100, l.alvo).toFixed(1)}%"></b>` : ''}</div>
        <div class="muted num">${txt}</div></li>`;
    };
    return `<section class="card" aria-labelledby="smAl"><h2 class="sm-h" id="smAl">Alvos e realidade ${botaoAjuda('alvoPct')}</h2>
      <p class="muted sm-nota">Peso de cada ativo no fim do mês (barra) e o alvo que você definiu (marca). pp = pontos percentuais. Alvo é uma referência sua, não uma recomendação.</p>
      ${semAlvo ? '<p class="muted">Você ainda não definiu alvos. Dá para fazer isso na <a href="#carteira">Carteira</a>.</p>' : ''}
      <ul class="sm-alvos">${r.alvos.map(linha).join('')}</ul></section>`;
  }

  function pintarFonte() {
    const datas = [...series.values()].map((s) => s.d?.at(-1)).filter(Boolean);
    const ate = datas.length ? dataBr(Math.max(...datas)) : null;
    $('#smFonte').innerHTML = `<p class="field__hint sm-fonte">${ate ? `Preços: fechamento do último pregão de cada mês, dos arquivos dados/precos (dados da B3), até ${ate}. ` : 'Sem arquivos de preços: valores pelo seu preço médio. '}Material educacional, não é recomendação.</p>`;
  }

  // ---------- eventos ----------
  const aoClicar = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'smAnt' || b.id === 'smProx') {
      mesSel = mesDe(addMeses(`${mesSel}-01`, b.id === 'smAnt' ? -1 : 1));
      desenhar();
      const alvo = $(`#${b.id}`);
      (alvo.disabled ? $(b.id === 'smAnt' ? '#smProx' : '#smAnt') : alvo).focus(); // o botão que desliga não deixa o foco cair no vazio
    } else if (b.id === 'smRetry') carregar();
    else if (b.dataset.visto) {
      gravarVisto(b.dataset.visto);
      desenhar();
      (root.querySelector('[data-visto]') ?? $('#smCaminhoT'))?.focus();
    }
  };
  root.addEventListener('click', aoClicar);
  const soltarAjuda = ligarAjuda(root, ctx);
  const chaveAtivos = () => [...new Set(est?.transacoes.filter((t) => !t.excluido && t.ativo).map((t) => t.ativo))].sort().join();
  const parar = usuario.ouvir(() => {
    if (carregando) return;
    const antes = chaveAtivos();
    try { est = usuario.ler(); } catch { return; }
    if (chaveAtivos() !== antes) carregar(); else desenhar(); // ativo novo precisa do arquivo de preços dele
  });

  carregar();
  return () => { vivo = false; parar(); soltarAjuda(); root.removeEventListener('click', aoClicar); };
}
