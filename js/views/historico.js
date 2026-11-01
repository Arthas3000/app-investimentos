// Histórico: todas as movimentações, filtros, corrigir/excluir com desfazer, provento manual, backup JSON.
import { icon } from '../ui/icons.js';
import { brl, aviso, animarValor } from '../ui/kit.js';
import { ler, adicionarTransacao, corrigir, excluir, definirPrefs, exportarBackup, importarBackup, ouvir } from '../data/carteira.js';
import { calcular } from '../core/posicoes.js';
import { filtrar, agruparPorMes, totalMov, ativosUsados, COM_COTAS } from '../core/historico-filtro.js';

const TIPOS = { compra: ['Compra', 'trend'], venda: ['Venda', 'tag'], deposito: ['Depósito', 'plus'], retirada: ['Retirada', 'minus'], transferencia: ['Transferência de custódia', 'chevronRight'], provento: ['Provento', 'check'] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dataBR = (iso) => iso.split('-').reverse().join('/');
const mesBR = (m) => { const [y, n] = m.split('-').map(Number); return new Date(y, n - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()).replace(' De ', ' de '); };
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const reaisCampo = (c) => (c == null ? '' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }));
/** "1.234,56" ou "12,5" -> centavos; vazio -> undefined; ilegível -> NaN. ponytail: sem máscara ao digitar, só leitura tolerante. */
function lerCentavos(txt) {
  const s = String(txt ?? '').replace(/R\$|\s|\./g, '');
  if (!s) return undefined;
  return /^\d+(,\d{1,2})?$/.test(s) ? Math.round(Number(s.replace(',', '.')) * 100) : NaN;
}

// filtros ficam no módulo: voltar de outra aba encontra a lista como estava
const filtro = { tipo: 'todos', ativo: '', de: '', ate: '', excluidas: false };

export function montar(root, ctx) {
  let vivo = true;
  const $ = (s) => root.querySelector(s);
  const sheet = ctx.sheet, sheetBody = sheet.querySelector('#sheetBody');
  const abrirPainel = (titulo, html) => { sheet.querySelector('#sheetTitulo').textContent = titulo; sheetBody.innerHTML = html; if (!sheet.open) sheet.showModal(); return sheetBody; };

  root.innerHTML = `
    <div class="hist-acoes">
      <button class="btn" id="provento">${icon('plus')}Lançar provento</button>
      <button class="btn btn--ghost" id="exportar">Exportar backup</button>
      <button class="btn btn--ghost" id="importar">Importar backup</button>
      <input type="file" id="arquivo" accept="application/json,.json" hidden>
    </div>
    <div class="filters">
      <div class="filters__row">
        <div class="field"><label for="f-tipo">Tipo</label><select id="f-tipo"><option value="todos">Todos</option>${Object.entries(TIPOS).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select></div>
        <div class="field"><label for="f-ativo">Ativo</label><select id="f-ativo"></select></div>
      </div>
      <div class="filters__row">
        <div class="field"><label for="f-de">De</label><input type="date" id="f-de"></div>
        <div class="field"><label for="f-ate">Até</label><input type="date" id="f-ate"></div>
      </div>
      <label class="hist-check"><input type="checkbox" id="f-exc"> Mostrar excluídas</label>
    </div>
    <div id="aviso"></div>
    <div id="lista" aria-live="polite"></div>`;
  $('#f-tipo').value = filtro.tipo; $('#f-de').value = filtro.de; $('#f-ate').value = filtro.ate; $('#f-exc').checked = filtro.excluidas;

  const valor = (c) => (ler().prefs.ocultarValores ? '••••' : brl(c));

  // ---------- desenho ----------
  const linha = (t, avisos) => {
    const [nome, ic] = TIPOS[t.tipo], cotas = COM_COTAS.includes(t.tipo), sinal = t.tipo === 'compra' || t.tipo === 'retirada' ? '−' : t.tipo === 'transferencia' ? '' : '+';
    const det = cotas
      ? `${t.qtd} × ${valor(t.preco)}${t.taxas ? ` · taxas ${valor(t.taxas)}` : ''}`
      : t.tipo === 'provento' ? 'Pago ao ativo' : '';
    return `<li class="hist-row${t.excluido ? ' is-excluida' : ''}" data-id="${t.id}">
      <span class="hist-row__tipo">${icon(ic, 18)}<span>${nome}</span></span>
      <span class="hist-row__ativo">${esc(t.ativo ?? '')}</span>
      <span class="hist-row__data muted">${dataBR(t.data)}</span>
      <span class="hist-row__total num">${sinal}${valor(totalMov(t))}</span>
      <span class="hist-row__det muted">${det}${t.excluido ? ' <span class="badge ind-neutro">Excluída</span>' : ''}${t.corrigeId ? ` <span class="badge">Corrige a #${t.corrigeId}</span>` : ''}</span>
      ${avisos.has(t.id) ? `<span class="notice hist-row__aviso">${icon('alert', 16)}<span>Não entra na carteira: ${esc(avisos.get(t.id))}</span></span>` : ''}
      ${t.excluido ? '' : `<span class="hist-row__acoes"><button class="btn btn--quiet" data-corrigir="${t.id}" aria-label="Corrigir ${nome.toLowerCase()} ${esc(t.ativo ?? '')} de ${dataBR(t.data)}">Corrigir</button><button class="btn btn--quiet" data-excluir="${t.id}" aria-label="Excluir ${nome.toLowerCase()} ${esc(t.ativo ?? '')} de ${dataBR(t.data)}">Excluir</button></span>`}
    </li>`;
  };

  function desenhar() {
    if (!vivo) return;
    let estado;
    try { estado = ler(); } catch { estado = null; }
    if (!estado) {
      $('#lista').innerHTML = `<div class="card empty">${icon('alert', 40)}<h3>Não foi possível ler seus dados</h3><p>O armazenamento deste navegador não respondeu. Nada foi apagado.</p><button class="btn" id="tentar">Tentar de novo</button></div>`;
      $('#tentar').onclick = () => { carregando(); setTimeout(desenhar, 150); };
      return;
    }
    const usados = ativosUsados(estado.transacoes);
    if (filtro.ativo && !usados.includes(filtro.ativo)) filtro.ativo = '';
    $('#f-ativo').innerHTML = `<option value="">Todos</option>${usados.map((a) => `<option>${esc(a)}</option>`).join('')}`;
    $('#f-ativo').value = filtro.ativo;

    // venda maior que a posição etc.: o cálculo pula a movimentação e aqui ela vira aviso, nunca quebra a tela
    const avisos = new Map(calcular(estado.transacoes).erros.map((e) => [e.id, e.erros[0]]));
    $('#aviso').innerHTML = avisos.size
      ? `<div class="notice" role="status">${icon('alert', 16)}<span>${avisos.size === 1 ? '1 movimentação não está sendo contada' : `${avisos.size} movimentações não estão sendo contadas`} na carteira. Veja as marcadas abaixo e corrija a data ou a quantidade.</span></div>` : '';

    if (!estado.transacoes.length) {
      $('#lista').innerHTML = `<div class="card empty">${icon('history', 40)}<h3>Nenhuma movimentação ainda</h3><p>Compras, vendas, depósitos e proventos que você registrar aparecem aqui, do mais recente ao mais antigo. Você também pode importar um backup.</p></div>`;
      return;
    }
    const lista = filtrar(estado.transacoes, filtro);
    if (!lista.length) {
      $('#lista').innerHTML = `<div class="card empty">${icon('search', 40)}<h3>Nada com esses filtros</h3><p>Tente outro período ou tipo.</p><button class="btn btn--ghost" id="limpar">Limpar filtros</button></div>`;
      $('#limpar').onclick = () => { Object.assign(filtro, { tipo: 'todos', ativo: '', de: '', ate: '', excluidas: false }); sincronizar(); desenhar(); };
      return;
    }
    $('#lista').innerHTML = agruparPorMes(lista).map((g) => `
      <section class="hist-mes" aria-label="${mesBR(g.mes)}">
        <h2 class="hist-mes__head"><span>${mesBR(g.mes)}</span><span class="num ${g.total > 0 ? 'gain' : g.total < 0 ? 'loss' : ''}" title="Efeito líquido no caixa do mês">${g.total > 0 ? '+' : g.total < 0 ? '−' : ''}${valor(Math.abs(g.total))}</span></h2>
        <ul class="card hist-list">${g.itens.map((t) => linha(t, avisos)).join('')}</ul>
      </section>`).join('') + `<p class="src">Total do mês: entradas menos saídas de caixa (compras e retiradas saem; vendas, depósitos e proventos entram). Dados guardados só neste aparelho.</p>`;
  }
  const sincronizar = () => { $('#f-tipo').value = filtro.tipo; $('#f-de').value = filtro.de; $('#f-ate').value = filtro.ate; $('#f-exc').checked = filtro.excluidas; };
  const carregando = () => { $('#lista').innerHTML = '<div class="skeleton skeleton--row"></div><div class="skeleton skeleton--row"></div><div class="skeleton skeleton--row"></div>'; };

  // ---------- filtros ----------
  $('#f-tipo').onchange = (e) => { filtro.tipo = e.target.value; desenhar(); };
  $('#f-ativo').onchange = (e) => { filtro.ativo = e.target.value; desenhar(); };
  $('#f-de').onchange = (e) => { filtro.de = e.target.value; desenhar(); };
  $('#f-ate').onchange = (e) => { filtro.ate = e.target.value; desenhar(); };
  $('#f-exc').onchange = (e) => { filtro.excluidas = e.target.checked; desenhar(); };

  // ---------- painéis ----------
  const campo = (id, rotulo, v, extra = '') => `<div class="field"><label for="${id}">${rotulo}</label><input id="${id}" name="${id}" value="${esc(v)}" ${extra}></div>`;
  const formHtml = (t, titulo) => {
    const cotas = COM_COTAS.includes(t.tipo);
    return `<form id="form" novalidate>
      ${campo('data', 'Data', t.data, 'type="date" required')}
      ${t.tipo === 'provento' || cotas ? `${campo('ativo', 'Ativo (código)', t.ativo ?? '', 'autocomplete="off" list="ativos" autocapitalize="characters"')}<datalist id="ativos">${ativosUsados(ler().transacoes).map((a) => `<option value="${esc(a)}">`).join('')}</datalist>` : ''}
      ${cotas ? `${campo('qtd', 'Quantidade de cotas', t.qtd ?? '', 'inputmode="numeric"')}${campo('preco', 'Preço por cota (R$)', reaisCampo(t.preco), 'inputmode="decimal"')}${campo('taxas', 'Taxas (R$, opcional)', reaisCampo(t.taxas), 'inputmode="decimal"')}`
        : campo('valor', 'Valor (R$)', reaisCampo(t.valor), 'inputmode="decimal"')}
      <div id="erros" role="alert"></div>
      <button class="btn btn--block" type="submit">${titulo}</button>
    </form>`;
  };
  /** Lê o formulário aberto; valor ilegível vira NaN e a validação do núcleo responde no tom de ajuda. */
  function lerForm(tipo) {
    const f = sheetBody.querySelector('#form'), v = (n) => f.elements[n]?.value ?? '';
    const o = { tipo, data: v('data') };
    if (f.elements.ativo) o.ativo = v('ativo').trim().toUpperCase();
    if (COM_COTAS.includes(tipo)) {
      o.qtd = /^\d+$/.test(v('qtd').trim()) ? Number(v('qtd')) : NaN;
      o.preco = lerCentavos(v('preco')); o.taxas = lerCentavos(v('taxas')) ?? 0;
    } else o.valor = lerCentavos(v('valor'));
    return o;
  }
  const mostrarErros = (erros) => { sheetBody.querySelector('#erros').innerHTML = `<div class="field__error">${icon('alert', 16)}<span>${erros.map(esc).join(' ')}</span></div>`; };
  const semArmazenamento = () => aviso('Não foi possível gravar neste navegador (armazenamento cheio ou bloqueado).');

  function painelProvento() {
    abrirPainel('Lançar provento', formHtml({ tipo: 'provento', data: hoje() }, 'Salvar provento'));
    sheetBody.querySelector('#form').onsubmit = (e) => {
      e.preventDefault();
      const r = adicionarTransacao(lerForm('provento'));
      if (r.ok === false) return mostrarErros(r.erros);
      if (r.semArmazenamento) return semArmazenamento();
      sheet.close(); aviso('Provento lançado.', r.desfazer);
    };
  }
  function painelCorrigir(id) {
    const t = ler().transacoes.find((x) => x.id === id);
    if (!t) return;
    abrirPainel(`Corrigir ${TIPOS[t.tipo][0].toLowerCase()}`, `<p class="muted">A versão antiga fica guardada como excluída; você pode ver em "Mostrar excluídas".</p>${formHtml(t, 'Salvar correção')}`);
    sheetBody.querySelector('#form').onsubmit = (e) => {
      e.preventDefault();
      const r = corrigir(id, lerForm(t.tipo));
      if (r.ok === false) return mostrarErros(r.erros);
      if (r.semArmazenamento) return semArmazenamento();
      sheet.close(); aviso('Movimentação corrigida.', r.desfazer);
    };
  }

  // ---------- eventos da lista ----------
  $('#lista').onclick = (e) => {
    const c = e.target.closest('[data-corrigir]'), x = e.target.closest('[data-excluir]');
    if (c) painelCorrigir(Number(c.dataset.corrigir));
    if (x) {
      const r = excluir(Number(x.dataset.excluir));
      if (r.ok === false) return;
      if (r.semArmazenamento) return semArmazenamento();
      aviso('Movimentação excluída. Ela continua guardada.', r.desfazer);
    }
  };
  $('#provento').onclick = painelProvento;

  // ---------- backup ----------
  $('#exportar').onclick = () => {
    const url = URL.createObjectURL(new Blob([exportarBackup()], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `carteira-backup-${hoje()}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    aviso('Backup salvo. Ele não leva o token da fonte de dados.');
  };
  $('#importar').onclick = () => { $('#arquivo').value = ''; $('#arquivo').click(); };
  $('#arquivo').onchange = async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    let texto;
    try { texto = await arq.text(); } catch { return abrirPainel('Importar backup', '<p>Não foi possível ler o arquivo. Tente de novo. Seus dados atuais não foram alterados.</p>'); }
    const s = ler(), temDados = s.transacoes.length || s.acompanhados.length || Object.keys(s.alvos).length || Object.keys(s.metas).length || s.aporte;
    const fazer = () => {
      const r = importarBackup(texto);
      if (r.ok) { sheet.close(); aviso('Backup importado.'); }
      else abrirPainel('Importar backup', `<div class="notice" role="alert">${icon('alert', 16)}<span>${esc(r.mensagem)}</span></div><button class="btn btn--block" id="ok">Entendi</button>`).querySelector('#ok').onclick = () => sheet.close();
    };
    if (!temDados) return fazer();
    const b = abrirPainel('Importar backup', `<p>Importar substitui tudo o que está salvo neste aparelho (${s.transacoes.length} movimentações) pelo conteúdo de "${esc(arq.name)}". Faça "Exportar backup" antes se quiser guardar os dados atuais.</p><button class="btn btn--block" id="sim">Substituir pelos dados do arquivo</button><button class="btn btn--ghost btn--block" id="nao">Cancelar</button>`);
    b.querySelector('#nao').onclick = () => sheet.close();
    b.querySelector('#sim').onclick = fazer;
  };

  carregando();
  const pronto = setTimeout(desenhar, 0); // ponytail: leitura é local e instantânea; o esqueleto só cobre o primeiro quadro
  const parar = ouvir(desenhar);
  return () => { vivo = false; clearTimeout(pronto); parar(); };
}
