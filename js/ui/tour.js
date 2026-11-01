// Tour "Como usar": 5 passos curtos num <dialog> próprio (o #sheet é das telas). Pular a qualquer momento (botão ou Esc).
// O texto e a navegação são puros (PASSOS, passoSeguinte); só abrirTour/oferecerTour tocam o DOM.
import { icon } from './icons.js';
import { prefs, salvarPrefs } from '../data/store.js';
import { ROTULOS } from '../analise/indicacao.js';

const ESTILO_SELO = { candidata: 'tag', cautela: 'alert', boa: 'shield', atencao: 'alert', evitar: 'ban', neutro: 'minus' };

export const PASSOS = [
  { id: 'abas', titulo: 'As cinco abas', itens: [
    ['Home', 'o resumo: saldo, seus ativos e o aporte do mês.'],
    ['Carteira', 'cada ativo com preço médio, alvo e metas.'],
    ['Mercado', 'a lista de ativos da B3, com notas e preços.'],
    ['Simulador', 'um “e se” com aportes mensais.'],
    ['Histórico', 'todas as suas movimentações.'],
  ] },
  { id: 'compra', titulo: 'Como registrar uma compra',
    texto: 'Na Home, toque no botão + e escolha Compra. Informe o ativo, a quantidade e o preço que você pagou, e confirme. O app não envia ordens: você compra na corretora e registra aqui o que já aconteceu. Errou? Há “Desfazer” por 5 segundos, e dá para corrigir depois no Histórico.' },
  { id: 'aporte', titulo: 'Como fazer o aporte do mês',
    texto: 'Em Ajustes, escolha o valor e o dia do aporte (e, se quiser, um lembrete na agenda). Defina o alvo % de cada ativo na Carteira. No dia, o app sugere quantas cotas de cada um, você compra na corretora e confirma o que de fato comprou. A sugestão é um cálculo educacional, não uma recomendação.' },
  { id: 'selos', titulo: 'O que significam os selos', selos: true,
    texto: 'Cada selo vem com ícone e texto, nunca só com cor. Eles resumem números de balanços e preços. Notícias não entram.',
    extra: 'O selo “Só consulta” marca um ativo que você acompanha sem ter cotas. “Barato”, “normal” e “caro” comparam o preço com o histórico do próprio ativo.' },
  { id: 'dados', titulo: 'Seus dados ficam com você',
    texto: 'Tudo o que você registra fica só neste aparelho. Em Ajustes você exporta um backup, troca o tema, muda a frequência das cotações e pode rever este tour quando quiser. O botão ? ao lado de termos técnicos explica cada um com um exemplo.' },
];

/** Índice do passo depois de andar `delta` (-1 volta, +1 avança). Fora do intervalo devolve null no fim (= concluir). */
export function passoSeguinte(i, delta, total = PASSOS.length) {
  const j = i + delta;
  if (j >= total) return null;
  return Math.max(0, j);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function corpo(p) {
  if (p.itens) return `<ul class="tour__lista">${p.itens.map(([a, t]) => `<li><strong>${esc(a)}</strong>: ${esc(t)}</li>`).join('')}</ul>`;
  const selos = p.selos
    ? `<ul class="tour__selos">${Object.entries(ROTULOS).map(([id, r]) => `<li><span class="badge ind-${id}">${icon(ESTILO_SELO[id])}${esc(r)}</span></li>`).join('')}</ul>` : '';
  return `<p>${esc(p.texto)}</p>${selos}${p.extra ? `<p class="muted">${esc(p.extra)}</p>` : ''}`;
}

let aberto = null;

/** Abre o tour. Ao fechar de qualquer jeito, a oferta de primeiro acesso não volta. */
export function abrirTour() {
  if (aberto) return;
  salvarPrefs({ tourOferecido: true });
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet tour';
  dlg.setAttribute('aria-labelledby', 'tourTitulo');
  document.body.append(dlg);
  aberto = dlg;
  let i = 0;

  function pintar({ foco = true } = {}) {
    const p = PASSOS[i], ultimo = i === PASSOS.length - 1;
    dlg.innerHTML = `<div class="sheet__head"><p class="tour__n" id="tourN">Passo ${i + 1} de ${PASSOS.length}</p>
        <button class="btn btn--quiet" data-a="pular" type="button">Pular</button></div>
      <div class="sheet__body">
        <h2 id="tourTitulo" tabindex="-1">${esc(p.titulo)}</h2>
        <div class="tour__corpo">${corpo(p)}</div>
        <div class="tour__pontos" aria-hidden="true">${PASSOS.map((_, k) => `<span${k === i ? ' class="on"' : ''}></span>`).join('')}</div>
        <div class="tour__acoes">
          <button class="btn btn--ghost" data-a="voltar" type="button"${i === 0 ? ' hidden' : ''}>Voltar</button>
          <button class="btn" data-a="seguir" type="button">${ultimo ? 'Concluir' : 'Próximo'}</button>
        </div>
      </div>`;
    if (foco) dlg.querySelector('#tourTitulo').focus(); // o leitor de tela anuncia o novo passo
  }

  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'pular') dlg.close();
    else if (a === 'voltar') { i = passoSeguinte(i, -1); pintar(); }
    else if (a === 'seguir') { const j = passoSeguinte(i, +1); if (j == null) dlg.close(); else { i = j; pintar(); } }
    else if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    aberto = null; dlg.remove();
    document.getElementById('view')?.focus({ preventScroll: true });
  });
  pintar({ foco: false });
  dlg.showModal();
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
    box.innerHTML = `<p>Primeira vez por aqui? Há um tour de 1 minuto.</p>
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
