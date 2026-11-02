// Tour guiado "Como usar": passa de tela em tela, destaca o elemento real e explica o que ele mostra.
// Um <dialog> próprio cobre a tela (o #sheet é das telas); Pular, Voltar, Próximo e Esc a qualquer momento.
// O texto e a navegação são puros (PASSOS, passoSeguinte, ladoDoCartao); só abrirTour/oferecerTour tocam o DOM.
import { icon } from './icons.js';
import { prefs, salvarPrefs } from '../data/store.js';
import { ROTULOS } from '../analise/indicacao.js';

const ESTILO_SELO = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };
const EXEMPLO = 'PETR4'; // ativo usado para mostrar a análise no Mercado

// rota: tela aberta no passo. alvo: seletores (o primeiro visível é destacado). semAlvo: texto quando ele não existe
// (ex.: carteira vazia). sheet: o alvo está dentro do painel de análise.
export const PASSOS = [
  { id: 'inicio', rota: '#home', titulo: 'Como usar o app',
    texto: 'Este tour passa por cada aba e mostra o que cada informação significa, direto na tela. Leva uns 3 minutos. Use Próximo e Voltar, ou Pular para sair quando quiser.' },
  { id: 'abas', rota: '#home', alvo: ['#nav'], titulo: 'As cinco abas',
    texto: 'Home é o resumo. Carteira mostra cada ativo seu. Mercado lista todas as ações e FIIs da B3. Simulador testa aportes no passado. Histórico guarda suas movimentações. A engrenagem no topo abre os Ajustes.',
    semAlvo: 'A barra com as cinco abas fica na parte de baixo da tela (no computador, à esquerda).' },
  { id: 'descobrir', rota: '#home', alvo: ['.descobrir-btn'], titulo: 'Descobrir ativos baratos',
    texto: 'Abre a lista de ações e FIIs cujo preço está abaixo do normal deles, pelos últimos 5 anos e pelo valor estimado. É um ponto de partida para estudar.',
    semAlvo: 'No topo da Home há um botão para descobrir ativos com preço baixo.' },
  { id: 'saldo', rota: '#home', alvo: ['#hCard:not([hidden])'], titulo: 'Saldo da carteira',
    texto: 'Quanto sua carteira vale agora, quanto você investiu, o resultado e a variação de hoje. O olho esconde os valores quando houver gente por perto.',
    semAlvo: 'O saldo aparece aqui assim que você registrar a primeira compra.' },
  { id: 'aporte', rota: '#home', alvo: ['#hAporte:not(:empty)'], titulo: 'Aporte do mês',
    texto: 'No dia do aporte, este cartão abre a proposta: quantas cotas de cada ativo comprar para chegar perto dos alvos da carteira. Você compra na corretora e confirma aqui o que comprou.',
    semAlvo: 'Defina o valor e o dia do aporte em Ajustes para este cartão aparecer na Home.' },
  { id: 'desde', rota: '#home', alvo: ['#hDesde:not(:empty)'], titulo: 'Desde a sua última visita',
    texto: 'Avisa quando um ativo seu mudou de indicação ou de faixa de preço (por exemplo, de normal para caro) desde a última vez que você abriu o app.',
    semAlvo: 'Quando algo mudar nos seus ativos entre uma visita e outra, o aviso aparece na Home.' },
  { id: 'mais', rota: '#home', alvo: ['#hMais'], titulo: 'Registrar movimentação',
    texto: 'O botão + registra compra, venda, depósito, retirada, transferência ou provento. O app não envia ordens: você registra o que já fez na corretora. Errou? Há Desfazer, e dá para corrigir no Histórico.',
    semAlvo: 'O botão + no canto da Home registra compras, vendas e proventos.' },

  { id: 'ativo', rota: '#carteira', alvo: ['#sMeus .pos', '#sMeus'], titulo: 'Cada ativo seu',
    texto: 'Preço médio, custo, resultado em reais e em %, quanto ele pesa na carteira e os proventos que você lançou. Toque no código para abrir a análise completa.',
    semAlvo: 'Registre uma compra para cada ativo aparecer aqui com preço médio e resultado.' },
  { id: 'selos', rota: '#carteira', alvo: ['#sMeus .pos__selos', '#sMeus'], titulo: 'Indicação automática', selos: true,
    texto: 'Cada selo resume os números do ativo com ícone e texto, nunca só com cor. É uma classificação por regras fixas, sempre com os motivos na análise. Notícias não entram.',
    semAlvo: 'Os selos aparecem nos seus ativos e no Mercado.' },
  { id: 'faixa', rota: '#carteira', alvo: ['#sMeus .pos__faixa'], titulo: 'Barato, normal ou caro',
    texto: 'Compara o preço de hoje com os últimos 5 anos do próprio ativo e com o valor estimado. “Chegou ao preço normal” e “Preço alto pelos números” ajudam a saber quando revisar se vale manter.',
    semAlvo: 'Em cada ativo seu aparece a faixa de preço (barato, normal ou caro), com o preço pago e a faixa de 5 anos.' },
  { id: 'alvo', rota: '#carteira', alvo: ['#sMeus .pos__alvo'], titulo: 'Alvo % da carteira',
    texto: 'Quanto você quer que cada ativo pese na carteira. O aporte do mês usa esses alvos para dividir o dinheiro, priorizando quem está mais abaixo do alvo.',
    semAlvo: 'Cada ativo seu tem um campo de alvo %: o aporte do mês usa esses números.' },
  { id: 'renda', rota: '#carteira', alvo: ['#sRenda:not(:empty)'], titulo: 'Renda passiva',
    texto: 'Dividendos e rendimentos por mês e por ano, a partir dos proventos que você lançou. Nada é estimado sem o seu lançamento.',
    semAlvo: 'A renda passiva aparece quando você lança proventos no Histórico.' },
  { id: 'metas', rota: '#carteira', alvo: ['#sMetas:not(:empty)', '#sRisco:not(:empty)'], titulo: 'Metas, concentração e risco',
    texto: 'Metas de patrimônio e de renda com progresso e estimativa de prazo. Abaixo, a concentração da carteira e o risco: volatilidade e maior queda.',
    semAlvo: 'Metas, concentração e risco aparecem na Carteira assim que houver ativos.' },

  { id: 'filtros', rota: '#mercado', alvo: ['#view .filters'], titulo: 'Mercado: busca e filtros',
    texto: 'Todas as ações e FIIs da B3. Busque por código ou nome, filtre por tipo e setor e ordene por altas, quedas, preço ou volume.',
    semAlvo: 'No Mercado você busca e filtra todas as ações e FIIs da B3.' },
  { id: 'indicacao', rota: `#mercado/ativo/${EXEMPLO}`, sheet: true, alvo: ['#sheet .an__ind', '#sheetBody'], titulo: 'A análise de um ativo',
    texto: `Tocar num ativo abre a análise (aqui, ${EXEMPLO} como exemplo). No topo: a indicação automática e os números que a justificam.`,
    semAlvo: 'A análise aparece quando os dados do ativo carregam.' },
  { id: 'faixaAn', rota: `#mercado/ativo/${EXEMPLO}`, sheet: true, alvo: ['#sheet [aria-labelledby="h-fx"]'], titulo: 'Preço frente aos próprios dados',
    texto: 'A posição do preço nos últimos 5 anos e a margem de segurança (ações) ou o P/VP (FIIs) votam juntos em barato, normal ou caro.',
    semAlvo: 'A faixa de preço aparece quando há histórico de preços do ativo.' },
  { id: 'notaValor', rota: `#mercado/ativo/${EXEMPLO}`, sheet: true, alvo: ['#sheet [aria-labelledby="h-nv"]'], titulo: 'Nota de valor',
    texto: 'De 0 a 10, somando quatro pilares: desconto, solidez, qualidade e proventos. Item sem dado tem o peso redistribuído. Toque em “?” ao lado de cada termo para ver um exemplo.',
    semAlvo: 'A nota de valor aparece quando há balanços do ativo.' },
  { id: 'estab', rota: `#mercado/ativo/${EXEMPLO}`, sheet: true, alvo: ['#sheet [aria-labelledby="h-es"]'], titulo: 'Nota de estabilidade',
    texto: 'Quanto o preço e o lucro oscilam: volatilidade, maior queda, beta e liquidez. Fica lado a lado com a mediana do setor, para comparar.',
    semAlvo: 'A nota de estabilidade aparece quando há dados de risco do ativo.' },

  { id: 'descobrirLista', rota: '#descobrir', alvo: ['#dLista .dsc', '#dLista'], titulo: 'Descobrir',
    texto: 'Cada cartão mostra a nota, o desconto e até que preço o ativo conta como barato. “Ver análise” abre os números completos; “Pesquisar fora” leva a notícias e outros sites.',
    semAlvo: 'A lista aparece quando os preços e os dados da análise carregam.' },
  { id: 'simulador', rota: '#simulador', alvo: ['#simRaiz .sim-card', '#simRaiz'], titulo: 'Simulador',
    texto: 'Monte uma carteira e veja como ela teria ido no passado, com aportes mensais, contra Ibovespa, CDI e IPCA. Resultado passado não garante futuro.',
    semAlvo: 'O Simulador usa os arquivos de preços do app.' },
  { id: 'historico', rota: '#historico', alvo: ['#view .filters'], titulo: 'Histórico',
    texto: 'Todas as movimentações, com filtros por tipo, ativo e período. Corrigir ou excluir nunca apaga de verdade: sempre há como desfazer. Daqui também sai o backup.',
    semAlvo: 'O Histórico lista todas as suas movimentações.' },
  { id: 'token', rota: '#ajustes', alvo: ['#ajTkForm', '#view .aj'], titulo: 'Ajustes: cotação ao vivo',
    texto: 'Cole aqui o token gratuito da brapi para ver cotações ao vivo. Ele fica só neste aparelho e nunca vai para o backup. Aqui também ficam aporte, lembrete, tema e backup.',
    semAlvo: 'Em Ajustes ficam o token da brapi, o aporte, o tema e o backup.' },
  { id: 'fim', rota: '#home', titulo: 'Pronto',
    texto: 'Tudo o que você registra fica só neste aparelho. Este tour fica em Ajustes, em “Como usar”, para rever quando quiser. Material educacional: nada aqui é recomendação.' },
];

/** Índice do passo depois de andar `delta` (-1 volta, +1 avança). Depois do último devolve null (= concluir). */
export function passoSeguinte(i, delta, total = PASSOS.length) {
  const j = i + delta;
  if (j >= total) return null;
  return Math.max(0, j);
}

/** O cartão fica do lado oposto ao destaque: alvo na metade de cima -> cartão embaixo, e vice-versa. */
export function ladoDoCartao(rect, alturaTela) {
  if (!rect) return 'base';
  return (rect.top + rect.bottom) / 2 > alturaTela / 2 ? 'topo' : 'base';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const visivel = (el) => !!el && el.getClientRects().length > 0 && !el.closest('[hidden]');
const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Espera um dos seletores aparecer (as telas carregam dados de forma assíncrona). null se não aparecer a tempo.
function esperarAlvo(seletores, ms = 4000) {
  const achar = () => seletores.map((s) => document.querySelector(s)).find(visivel) ?? null;
  return new Promise((ok) => {
    const t0 = performance.now();
    const tentar = () => {
      const el = achar();
      if (el && !el.closest('[aria-busy="true"]')) return ok(el);
      if (performance.now() - t0 > ms) return ok(el);
      setTimeout(tentar, 120);
    };
    tentar();
  });
}

let aberto = null;

/** Abre o tour guiado. Ao fechar de qualquer jeito, volta para a tela de onde saiu e a oferta de primeiro acesso não volta. */
export function abrirTour() {
  if (aberto) return;
  salvarPrefs({ tourOferecido: true });
  const origem = location.hash || '#home';
  const sheet = document.querySelector('#sheet');
  if (sheet?.open) sheet.close();
  const dlg = document.createElement('dialog');
  dlg.className = 'tour-guia';
  dlg.setAttribute('aria-labelledby', 'tourTitulo');
  dlg.innerHTML = '<div class="tour-guia__anel" hidden></div><section class="tour-guia__card" aria-describedby="tourTexto"></section>';
  document.body.append(dlg);
  aberto = dlg;
  const anel = dlg.querySelector('.tour-guia__anel'), card = dlg.querySelector('.tour-guia__card');
  let i = 0, alvo = null, vez = 0, trocando = false;

  // o painel de análise também é um dialog modal: quando ele abre por cima, o tour volta para a frente
  // (o evento close dessa troca chega depois, numa tarefa própria: `trocando` fica ligado até ele passar)
  function paraFrente() {
    if (!sheet?.open) return;
    trocando = true; dlg.close(); dlg.showModal();
  }

  function posicionar() {
    const r = alvo && visivel(alvo) ? alvo.getBoundingClientRect() : null;
    card.dataset.lado = ladoDoCartao(r, innerHeight);
    anel.hidden = !r;
    if (!r) return;
    // o destaque fica só na parte da tela que o cartão não cobre (alvo mais alto que a tela é cortado)
    const m = 6, rc = card.getBoundingClientRect();
    const [lim0, lim1] = card.dataset.lado === 'base' ? [2, rc.top - 8] : [rc.bottom + 8, innerHeight - 2];
    const top = Math.max(lim0, r.top - m), bottom = Math.min(lim1, r.bottom + m);
    anel.hidden = bottom - top < 16;
    Object.assign(anel.style, { top: `${top}px`, left: `${Math.max(2, r.left - m)}px`, width: `${Math.min(innerWidth - 4, r.width + 2 * m)}px`, height: `${Math.max(0, bottom - top)}px` });
  }

  function corpo(p, achou) {
    const selos = p.selos
      ? `<ul class="tour__selos">${Object.entries(ROTULOS).map(([id, r]) => `<li><span class="badge ind-${id}">${icon(ESTILO_SELO[id])}${esc(r)}</span></li>`).join('')}</ul>` : '';
    return `<p id="tourTexto">${esc(p.alvo && !achou ? p.semAlvo : p.texto)}</p>${selos}`;
  }

  function pintarCard(p, achou, { foco = true } = {}) {
    const ultimo = i === PASSOS.length - 1;
    card.innerHTML = `<div class="tour-guia__topo"><p class="tour__n">Passo ${i + 1} de ${PASSOS.length}</p>
        <button class="btn btn--quiet" data-a="pular" type="button">${ultimo ? 'Fechar' : 'Pular'}</button></div>
      <h2 id="tourTitulo" tabindex="-1">${esc(p.titulo)}</h2>
      <div class="tour__corpo">${corpo(p, achou)}</div>
      <div class="tour__barra" aria-hidden="true"><i style="width:${Math.round(((i + 1) / PASSOS.length) * 100)}%"></i></div>
      <div class="tour__acoes">
        <button class="btn btn--ghost" data-a="voltar" type="button"${i === 0 ? ' hidden' : ''}>Voltar</button>
        <button class="btn" data-a="seguir" type="button">${ultimo ? 'Concluir' : 'Próximo'}</button>
      </div>`;
    if (foco) card.querySelector('#tourTitulo').focus({ preventScroll: true }); // o leitor de tela anuncia o novo passo
  }

  async function ir(n, { foco = true } = {}) {
    i = n; const p = PASSOS[i], minha = ++vez;
    alvo = null; anel.hidden = true;
    pintarCard(p, true, { foco });
    if (!p.sheet && sheet?.open) sheet.close(); // sair da análise antes de trocar de tela
    if (location.hash !== p.rota) location.hash = p.rota;
    const el = p.alvo ? await esperarAlvo(p.alvo) : null;
    if (minha !== vez || !dlg.isConnected) return; // a pessoa já avançou
    paraFrente();
    alvo = el;
    if (p.alvo) pintarCard(p, !!el, { foco });
    if (el) el.scrollIntoView({ block: card.dataset.lado === 'topo' ? 'end' : 'start', behavior: reduzido() ? 'auto' : 'smooth' });
    posicionar();
    setTimeout(() => { if (minha === vez) posicionar(); }, reduzido() ? 0 : 400); // depois da rolagem suave
  }

  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pular') dlg.close();
    else if (a === 'voltar') ir(passoSeguinte(i, -1));
    else if (a === 'seguir') { const j = passoSeguinte(i, +1); if (j == null) dlg.close(); else ir(j); }
  });
  const reposicionar = () => posicionar();
  addEventListener('resize', reposicionar);
  addEventListener('scroll', reposicionar, true);
  dlg.addEventListener('close', () => {
    if (trocando) { trocando = false; return; }
    aberto = null; vez++; dlg.remove();
    removeEventListener('resize', reposicionar); removeEventListener('scroll', reposicionar, true);
    if (sheet?.open) sheet.close();
    if (location.hash !== origem) location.hash = origem;
    document.getElementById('view')?.focus({ preventScroll: true });
  });
  dlg.showModal();
  ir(0, { foco: false });
  dlg.querySelector('[data-a="seguir"]').focus();
}

/** Primeiro acesso: um convite pequeno, sem tirar o foco de ninguém, uma única vez (dispensar ou aceitar conta). */
export function oferecerTour({ atraso = 1500 } = {}) {
  if (prefs().tourOferecido) return;
  setTimeout(() => {
    if (prefs().tourOferecido || aberto) return;
    salvarPrefs({ tourOferecido: true }); // mesmo ignorado, não reaparece
    const box = document.createElement('section');
    box.className = 'tour-convite';
    box.setAttribute('aria-label', 'Convite para o tour');
    box.innerHTML = `<p>Primeira vez por aqui? Há um tour guiado de 3 minutos pelas abas.</p>
      <div><button class="btn btn--quiet" data-a="nao" type="button">Agora não</button><button class="btn" data-a="sim" type="button">Ver o tour</button></div>`;
    box.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      box.remove();
      if (a === 'sim') abrirTour();
    });
    document.body.append(box);
    setTimeout(() => box.remove(), 20_000);
  }, atraso);
}
