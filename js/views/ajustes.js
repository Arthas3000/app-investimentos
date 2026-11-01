// Ajustes (#ajustes): cotações e API, aporte, custos e lotes, metas, backup, fontes de dados, tema, tour e apagar tudo.
// A lógica pura (validações) fica no topo e é testada em test/ajustes.test.js. Material educacional, nada aqui é recomendação.
import { icon } from '../ui/icons.js';
import { aviso } from '../ui/kit.js';
import { formatarCentavos, mascaraReais, paraCentavos, soDigitos, hojeIso } from '../ui/registrar.js';
import { abrirTour } from '../ui/tour.js';
import { ler, definirAporte, definirPrefs, exportarBackup, importarBackup } from '../data/carteira.js';
import { token, prefs, salvarPrefs, aplicarTema, apagarTudo, FREQUENCIAS, TEMAS, frequenciaValida, temaValido } from '../data/store.js';
import { icsDoAporte } from '../core/aporte-entrada.js';
import { carregarDados } from '../data/dados.js';
import { lerCache } from '../data/cache.js';
import { fmtQuando } from '../data/pregao.js';
import { lerCfg, cfgNumerica } from './aporte.js';
import { esc } from './home.js';

// ---------- lógica pura ----------

/** Valor (texto em R$) e dia (1 a 31) do aporte. @returns {{ok:boolean, aporte?:{valor:number,dia:number}, erros:string[]}} */
export function validarAporte(valorTxt, diaTxt) {
  const erros = [];
  const valor = paraCentavos(valorTxt);
  if (!(valor > 0)) erros.push('Informe o valor do aporte em reais, maior que zero.');
  const d = String(diaTxt ?? '').trim();
  const dia = /^\d{1,2}$/.test(d) ? Number(d) : null;
  if (!(dia >= 1 && dia <= 31)) erros.push('O dia do aporte vai de 1 a 31.');
  return erros.length ? { ok: false, erros } : { ok: true, aporte: { valor, dia }, erros };
}

/** Taxa por ordem (vazia = R$ 0,00) e lote padrão (vazio = 1, inteiro de 1 a 9999). Devolve os textos como o assistente de aporte os guarda. */
export function validarCustos(taxaTxt, loteTxt) {
  const erros = [];
  const t = String(taxaTxt ?? '').trim(), l = String(loteTxt ?? '').trim();
  const taxa = t ? paraCentavos(t) : 0;
  if (taxa == null) erros.push('A taxa por ordem precisa ser um valor em reais (pode ser zero).');
  const lote = l ? (/^\d{1,4}$/.test(l) ? Number(l) : null) : 1;
  if (!(lote >= 1)) erros.push('O lote precisa ser um número inteiro, de 1 em diante.');
  return erros.length ? { ok: false, erros } : { ok: true, taxa, lote, textos: { taxa: taxa > 0 ? formatarCentavos(taxa) : '', lote: String(lote) }, erros };
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. */
export const dataBr = (iso) => String(iso ?? '').split('-').reverse().join('/');

// ---------- gravação ----------
const CHAVE_CFG = 'aporte.cfg.v1';
// ponytail: o assistente de aporte guarda a cfg em prefs.aporte e numa cópia no localStorage (gravarCfg em aporte.js não é exportado), então repito as duas gravações. Reusar gravarCfg quando for exportado.
function gravarCustos(textos) {
  const cfg = { ...lerCfg(), ...textos };
  const r = definirPrefs({ aporte: cfg });
  try { localStorage.setItem(CHAVE_CFG, JSON.stringify(cfg)); } catch { return false; }
  return r.semArmazenamento !== true;
}

const SEM_ARMAZENAMENTO = 'Não consegui gravar neste navegador (armazenamento cheio ou bloqueado). Nada foi alterado.';
const NOME_FONTE = { precos: 'Preços históricos (B3, série histórica)', fundamentos: 'Balanços das empresas (CVM)', fiis: 'Fundos imobiliários (CVM)' };

// ---------- a tela ----------
export function montar(root, ctx) {
  let vivo = true;
  let mostrarToken = false;

  const msg = (id, texto, erro = false) => {
    const el = root.querySelector(`#${id}`);
    if (el) { el.innerHTML = texto ? `${erro ? icon('alert', 16) + ' ' : ''}${esc(texto)}` : ''; el.dataset.erro = erro ? '1' : ''; }
  };
  const erros = (id, lista) => msg(id, lista.join(' '), true);

  function html() {
    const est = ler(), ap = est.aporte, cfg = cfgNumerica(lerCfg(), ap?.valor), p = prefs(), tk = token.get();
    const freq = FREQUENCIAS.map((s) => `<label class="aj__opcao"><input type="radio" name="freq" value="${s}"${p.cotacaoSegundos === s ? ' checked' : ''}><span>${s} s</span></label>`).join('');
    const tema = TEMAS.map((t) => `<label class="aj__opcao"><input type="radio" name="tema" value="${t}"${p.tema === t ? ' checked' : ''}><span>${{ auto: 'Automático', claro: 'Claro', escuro: 'Escuro' }[t]}</span></label>`).join('');
    return `
    <section class="card aj" aria-labelledby="aj-api"><h2 id="aj-api">Cotações e API</h2>
      <p class="muted" id="ajTkEstado">${tk ? 'Token da brapi salvo neste aparelho. Ele nunca entra no backup.' : 'Sem token: a brapi entrega só a lista de ativos, sem a cotação ao vivo de cada um. A análise não depende dele.'}</p>
      <details class="aj__passos"${tk ? '' : ' open'}><summary>Como conseguir o token (grátis)</summary>
        <ol><li>Crie uma conta grátis em <a href="https://brapi.dev" target="_blank" rel="noopener noreferrer">brapi.dev</a>.</li><li>No painel, copie o seu token.</li><li>Cole abaixo. Ele fica só neste aparelho.</li></ol></details>
      <form id="ajTkForm" class="aj__form" novalidate>
        <div class="field"><label for="ajTk">Token da brapi</label>
          <div class="aj__linha"><input id="ajTk" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(tk)}">
          <button class="btn btn--ghost" type="button" id="ajTkVer" aria-pressed="false">Mostrar</button></div></div>
        <div class="aj__acoes"><button class="btn" type="submit">Salvar token</button>
          <button class="btn btn--ghost" type="button" id="ajTkRemover"${tk ? '' : ' hidden'}>Remover token</button></div>
        <p class="aj__msg" id="ajTkMsg" role="status"></p>
      </form>
      <fieldset class="aj__grupo"><legend>Atualizar as cotações a cada</legend><div class="aj__opcoes">${freq}</div>
        <p class="field__hint">Só atualiza sozinho com o pregão aberto e a tela visível. Intervalos maiores poupam o limite gratuito da brapi (15.000 consultas por mês).</p>
        <p class="aj__msg" id="ajFreqMsg" role="status"></p></fieldset>
    </section>

    <section class="card aj" aria-labelledby="aj-aporte"><h2 id="aj-aporte">Aporte</h2>
      <form id="ajApForm" class="aj__form" novalidate>
        <div class="aj__duas">
          <div class="field"><label for="ajApValor">Valor do aporte mensal</label><input id="ajApValor" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${ap ? esc(formatarCentavos(ap.valor)) : ''}"></div>
          <div class="field"><label for="ajApDia">Dia do mês (1 a 31)</label><input id="ajApDia" inputmode="numeric" autocomplete="off" maxlength="2" placeholder="5" value="${ap ? ap.dia : ''}"></div>
        </div>
        <div class="aj__acoes"><button class="btn" type="submit">Salvar aporte</button>
          <button class="btn btn--ghost" type="button" id="ajApRemover"${ap ? '' : ' hidden'}>Remover aporte</button></div>
        <p class="aj__msg" id="ajApMsg" role="status"></p>
      </form>
      <div class="aj__lembrete"><button class="btn btn--ghost" type="button" id="ajIcs"${ap ? '' : ' disabled'}>${icon('clock', 18)} Lembrete na agenda</button>
        <p class="field__hint" id="ajIcsDica">${ap ? 'Baixa um arquivo .ics que se repete todo mês. Abra-o no celular para adicionar à agenda. Para os dias 29 a 31, o lembrete cai no dia 28.' : 'Salve o valor e o dia do aporte para gerar o lembrete.'}</p></div>
    </section>

    <section class="card aj" aria-labelledby="aj-custos"><h2 id="aj-custos">Custos e lotes</h2>
      <p class="muted">Usados pelo assistente de aporte para calcular quantas cotas cabem no valor.</p>
      <form id="ajCuForm" class="aj__form" novalidate>
        <div class="aj__duas">
          <div class="field"><label for="ajTaxa">Taxa por ordem</label><input id="ajTaxa" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00" value="${cfg.taxa ? esc(formatarCentavos(cfg.taxa)) : ''}"></div>
          <div class="field"><label for="ajLote">Lote padrão (cotas por vez)</label><input id="ajLote" inputmode="numeric" autocomplete="off" maxlength="4" placeholder="1" value="${cfg.lote > 1 ? cfg.lote : ''}"></div>
        </div>
        <p class="field__hint">Deixe em branco para taxa zero e lote de 1 cota (mercado fracionário).</p>
        <div class="aj__acoes"><button class="btn" type="submit">Salvar custos</button></div>
        <p class="aj__msg" id="ajCuMsg" role="status"></p>
      </form>
    </section>

    <section class="card aj" aria-labelledby="aj-metas"><h2 id="aj-metas">Metas</h2>
      <p class="muted">Patrimônio, renda mensal e prazo que você quer alcançar. O progresso aparece na Carteira.</p>
      <a class="btn btn--ghost" id="ajMetasLink" href="#carteira/metas">${Object.keys(est.metas).length ? 'Editar metas' : 'Definir metas'}</a>
    </section>

    <section class="card aj" aria-labelledby="aj-backup"><h2 id="aj-backup">Backup</h2>
      <p class="muted">Seus dados ficam só neste aparelho. O backup é um arquivo que você guarda onde quiser. Ele não leva o token da brapi.</p>
      <div class="aj__acoes"><button class="btn" type="button" id="ajExp">Exportar backup</button>
        <button class="btn btn--ghost" type="button" id="ajImp">Importar backup</button></div>
      <input type="file" id="ajArq" accept="application/json,.json" hidden>
      <p class="aj__msg" id="ajBkMsg" role="status"></p>
    </section>

    <section class="card aj" aria-labelledby="aj-fontes"><h2 id="aj-fontes">Fontes de dados</h2>
      <div id="ajFontes" aria-live="polite"><div class="skeleton aj__sk"></div><div class="skeleton aj__sk"></div><div class="skeleton aj__sk"></div></div>
    </section>

    <section class="card aj" aria-labelledby="aj-tema"><h2 id="aj-tema">Tema</h2>
      <fieldset class="aj__grupo"><legend class="sr-only">Tema</legend><div class="aj__opcoes">${tema}</div>
        <p class="field__hint">Automático segue o tema do seu aparelho.</p></fieldset>
    </section>

    <section class="card aj" aria-labelledby="aj-tour"><h2 id="aj-tour">Como usar</h2>
      <p class="muted">Um tour de 5 passos curtos: as abas, como registrar uma compra, como fazer o aporte e o que significam os selos.</p>
      <button class="btn btn--ghost" type="button" id="ajTour">Ver o tour</button>
    </section>

    <section class="card aj" aria-labelledby="aj-apagar"><h2 id="aj-apagar">Apagar todos os dados</h2>
      <p class="muted">Remove deste aparelho sua carteira, movimentações, alvos, metas, aporte e dados guardados em cache. Não tem volta. Se quiser uma cópia, exporte o backup antes.</p>
      <button class="btn btn--ghost aj__apagar" type="button" id="ajApagar">Apagar todos os dados…</button>
    </section>`;
  }
  root.innerHTML = html();
  const $ = (s) => root.querySelector(s);

  // ---------- fontes de dados (assíncrono: carregando, vazio, erro, sem conexão) ----------
  async function pintarFontes() {
    const cot = await lerCache('brapi:lista:v2');
    const d = await carregarDados();
    if (!vivo) return;
    const li = (nome, texto) => `<li><strong>${esc(nome)}</strong><span>${texto}</span></li>`;
    const itens = [li('Cotações (brapi.dev)', cot?.savedAt
      ? `Última consulta neste aparelho: ${fmtQuando(new Date(cot.savedAt))}. Ações podem ter atraso de cerca de 30 minutos.`
      : 'Ainda não consultadas neste aparelho. Abra o Mercado para buscar.')];
    const m = d.meta;
    if (m.data) {
      for (const [k, f] of Object.entries(m.data.fontes ?? {})) {
        itens.push(li(NOME_FONTE[k] ?? k, `${f.ok ? 'Atualizada na última geração' : 'A última atualização falhou; vale o que já estava guardado'}. <span class="muted">${esc(f.url ?? '')}</span>`));
      }
      itens.unshift(li('Arquivos de análise', `Gerados em ${m.data.geradoEm ? fmtQuando(new Date(m.data.geradoEm)) : 'data desconhecida'}${m.data.dataBasePrecos ? `, com preços até ${dataBr(m.data.dataBasePrecos)}` : ''}${m.stale ? ' (cópia guardada, sem conexão)' : ''}.`));
    } else if (m.ausente) {
      itens.push(li('Arquivos de análise', 'Ainda não foram gerados neste endereço. Preços e cotações continuam funcionando.'));
    } else {
      itens.push(li('Arquivos de análise', m.offline ? 'Sem conexão e sem cópia guardada. Quando a conexão voltar, abra Ajustes de novo.' : `Não consegui ler (${esc(m.erro?.message ?? 'erro desconhecido')}). Podem estar em atualização.`));
    }
    itens.push(li('CDI e IPCA', 'Banco Central do Brasil (SGS), atualizados uma vez por dia.'));
    itens.push(li('Feriados', 'BrasilAPI, para saber os dias de pregão.'));
    $('#ajFontes').innerHTML = `<ul class="aj__fontes">${itens.join('')}</ul><p class="src">Material educacional, não é recomendação. Resultado passado não garante resultado futuro.</p>`;
  }
  pintarFontes().catch((e) => {
    console.error(e);
    if (vivo) $('#ajFontes').innerHTML = '<p class="muted">Não consegui listar as fontes agora. Tente abrir Ajustes de novo.</p>';
  });

  // ---------- token e frequência ----------
  const estadoToken = () => {
    const tk = token.get();
    $('#ajTkEstado').textContent = tk ? 'Token da brapi salvo neste aparelho. Ele nunca entra no backup.' : 'Sem token: a brapi entrega só a lista de ativos, sem a cotação ao vivo de cada um. A análise não depende dele.';
    $('#ajTkRemover').hidden = !tk;
  };
  $('#ajTkVer').onclick = (e) => {
    mostrarToken = !mostrarToken;
    $('#ajTk').type = mostrarToken ? 'text' : 'password';
    e.currentTarget.textContent = mostrarToken ? 'Ocultar' : 'Mostrar';
    e.currentTarget.setAttribute('aria-pressed', mostrarToken);
  };
  $('#ajTkForm').onsubmit = (e) => {
    e.preventDefault();
    const v = $('#ajTk').value.trim();
    if (!v) return erros('ajTkMsg', ['Cole o token da brapi no campo acima. Para tirar o token, use “Remover token”.']), $('#ajTk').focus();
    token.set(v);
    if (token.get() !== v) return erros('ajTkMsg', [SEM_ARMAZENAMENTO]);
    msg('ajTkMsg', 'Token salvo. As cotações ao vivo passam a usá-lo.'); estadoToken();
  };
  $('#ajTkRemover').onclick = () => {
    token.set('');
    $('#ajTk').value = '';
    msg('ajTkMsg', 'Token removido deste aparelho.'); estadoToken();
  };
  root.querySelectorAll('input[name="freq"]').forEach((r) => r.addEventListener('change', () => {
    const s = Number(r.value);
    if (!frequenciaValida(s)) return;
    salvarPrefs({ cotacaoSegundos: s });
    msg('ajFreqMsg', `Cotações a cada ${s} segundos, quando o pregão estiver aberto.`);
  }));

  // ---------- aporte ----------
  const DICA_ICS = 'Baixa um arquivo .ics que se repete todo mês. Abra-o no celular para adicionar à agenda. Para os dias 29 a 31, o lembrete cai no dia 28.';
  /** Relê o estado salvo para os campos (depois de importar ou desfazer). */
  function sincronizar() {
    const ap = ler().aporte, cfg = cfgNumerica(lerCfg(), ap?.valor);
    $('#ajApValor').value = ap ? formatarCentavos(ap.valor) : ''; $('#ajApDia').value = ap ? ap.dia : '';
    $('#ajApRemover').hidden = !ap; $('#ajIcs').disabled = !ap;
    $('#ajIcsDica').textContent = ap ? DICA_ICS : 'Salve o valor e o dia do aporte para gerar o lembrete.';
    $('#ajTaxa').value = cfg.taxa ? formatarCentavos(cfg.taxa) : ''; $('#ajLote').value = cfg.lote > 1 ? cfg.lote : '';
    $('#ajMetasLink').textContent = Object.keys(ler().metas).length ? 'Editar metas' : 'Definir metas';
  }
  $('#ajApValor').oninput = (e) => { e.target.value = mascaraReais(e.target.value); };
  $('#ajApDia').oninput = (e) => { e.target.value = soDigitos(e.target.value).slice(0, 2); };
  $('#ajApForm').onsubmit = (e) => {
    e.preventDefault();
    const v = validarAporte($('#ajApValor').value, $('#ajApDia').value);
    if (!v.ok) return erros('ajApMsg', v.erros);
    const r = definirAporte(v.aporte);
    if (r.semArmazenamento) return erros('ajApMsg', [SEM_ARMAZENAMENTO]);
    msg('ajApMsg', `Aporte de ${formatarCentavos(v.aporte.valor)} no dia ${v.aporte.dia} de cada mês salvo.`);
    sincronizar();
  };
  $('#ajApRemover').onclick = () => {
    const antes = ler().aporte;
    definirAporte(null);
    sincronizar(); msg('ajApMsg', '');
    aviso('Aporte removido.', () => { definirAporte(antes); if (vivo) sincronizar(); });
  };
  $('#ajIcs').onclick = () => {
    const a = ler().aporte;
    if (!a) return;
    const url = URL.createObjectURL(new Blob([icsDoAporte({ dia: a.dia, hoje: hojeIso(), agora: new Date() })], { type: 'text/calendar;charset=utf-8' }));
    baixar(url, 'lembrete-aporte.ics');
    aviso('Lembrete baixado. Abra o arquivo para adicioná-lo à agenda do celular.');
  };

  // ---------- custos e lotes ----------
  $('#ajTaxa').oninput = (e) => { e.target.value = mascaraReais(e.target.value); };
  $('#ajLote').oninput = (e) => { e.target.value = soDigitos(e.target.value).slice(0, 4); };
  $('#ajCuForm').onsubmit = (e) => {
    e.preventDefault();
    const v = validarCustos($('#ajTaxa').value, $('#ajLote').value);
    if (!v.ok) return erros('ajCuMsg', v.erros);
    if (!gravarCustos(v.textos)) return erros('ajCuMsg', [SEM_ARMAZENAMENTO]);
    msg('ajCuMsg', `Salvo: taxa ${formatarCentavos(v.taxa)} por ordem e lote de ${v.lote} ${v.lote === 1 ? 'cota' : 'cotas'}.`);
  };

  // ---------- backup ----------
  function baixar(url, nome) {
    const a = Object.assign(document.createElement('a'), { href: url, download: nome });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  $('#ajExp').onclick = () => {
    baixar(URL.createObjectURL(new Blob([exportarBackup()], { type: 'application/json' })), `carteira-backup-${hojeIso()}.json`);
    msg('ajBkMsg', 'Backup salvo. Guarde o arquivo em um lugar seguro: ele traz toda a sua carteira.');
  };
  $('#ajImp').onclick = () => { $('#ajArq').value = ''; $('#ajArq').click(); };
  $('#ajArq').onchange = async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    if (arq.size > 10_000_000) return erros('ajBkMsg', ['Este arquivo é grande demais para ser um backup da carteira. Use um arquivo gerado por “Exportar backup”. Seus dados atuais não foram alterados.']);
    let texto;
    try { texto = await arq.text(); } catch { return erros('ajBkMsg', ['Não consegui ler o arquivo. Tente escolher de novo. Seus dados atuais não foram alterados.']); }
    const antes = exportarBackup(); // guarda o estado atual: o aviso oferece desfazer, então importar não precisa de confirmação
    const r = importarBackup(texto);
    if (!r.ok) return erros('ajBkMsg', [r.mensagem]);
    msg('ajBkMsg', 'Backup importado. Seus dados foram substituídos pelos do arquivo.');
    aviso('Backup importado.', () => { importarBackup(antes); if (vivo) { sincronizar(); msg('ajBkMsg', 'Importação desfeita. Seus dados voltaram ao que eram.'); } });
    if (vivo) sincronizar();
  };

  // ---------- tema e tour ----------
  root.querySelectorAll('input[name="tema"]').forEach((r) => r.addEventListener('change', () => {
    if (!temaValido(r.value)) return;
    salvarPrefs({ tema: r.value });
    aplicarTema(r.value);
  }));
  $('#ajTour').onclick = abrirTour;

  // ---------- apagar tudo (único diálogo de confirmação do app) ----------
  $('#ajApagar').onclick = () => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet aj-confirma';
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-labelledby', 'ajCfT'); dlg.setAttribute('aria-describedby', 'ajCfD');
    dlg.innerHTML = `<div class="sheet__head"><h2 id="ajCfT">Apagar todos os dados?</h2></div>
      <div class="sheet__body"><p id="ajCfD">Isso apaga deste aparelho sua carteira, movimentações, alvos, metas, aporte, marcos e os dados em cache. <strong>Não tem volta.</strong> Se quiser guardar uma cópia, cancele e exporte o backup antes.</p>
        <label class="aj__check"><input type="checkbox" id="ajCfTk"> Apagar também o token da brapi</label>
        <div class="aj__acoes"><button class="btn" type="button" id="ajCfNao" autofocus>Cancelar</button><button class="btn btn--ghost aj__apagar" type="button" id="ajCfSim">Apagar tudo</button></div>
        <p class="aj__msg" id="ajCfMsg" role="status"></p></div>`;
    document.body.append(dlg);
    dlg.querySelector('#ajCfNao').onclick = () => dlg.close();
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { dlg.remove(); $('#ajApagar')?.focus(); });
    dlg.querySelector('#ajCfSim').onclick = async (e) => {
      e.currentTarget.disabled = true;
      dlg.querySelector('#ajCfMsg').textContent = 'Apagando…';
      await apagarTudo({ comToken: dlg.querySelector('#ajCfTk').checked });
      history.replaceState(null, '', '#home'); // replaceState não dispara hashchange: montar a Home aqui regravaria a carteira
      location.reload(); // há cópias em memória (carteira, cache): recarregar é o jeito de não regravar nada
    };
    dlg.showModal();
  };

  return () => { vivo = false; };
}
