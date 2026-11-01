// Comportamentos compartilhados: número animado, aviso com desfazer, painel arrastável, formatação.
export const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (n) => `${n >= 0 ? '+' : ''}${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Anima o texto de `el` do valor atual até `to` (centavos) em 300–600 ms. Sem movimento se reduzido. */
export function animarValor(el, to, formatar = brl, ms = 450) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = to;
  if (from === to || reduzido()) { el.textContent = formatar(to); return; }
  const t0 = performance.now();
  const passo = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - (1 - k) ** 3; // desacelera
    el.textContent = formatar(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

/** Pisca a célula em verde (subiu) ou vermelho (caiu). */
export function piscar(el, delta) {
  if (!delta) return;
  const c = delta > 0 ? 'flash-up' : 'flash-down';
  el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(c);
}

/** Aviso "Desfazer" por 5 s; o tempo pára com o mouse em cima ou o foco dentro. O contêiner role=status já está no index.html. */
export function aviso(texto, onUndo, ms = 5000) {
  const host = document.querySelector('.toast-host') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toast-host', role: 'status' }));
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = '<span></span>'; t.firstChild.textContent = texto;
  if (onUndo) {
    const b = document.createElement('button'); b.textContent = 'Desfazer';
    b.onclick = () => { onUndo(); t.remove(); };
    t.append(b);
  }
  let resta = ms, ini = 0, id = 0, pausas = 0;
  const correr = () => { ini = Date.now(); id = setTimeout(() => t.remove(), resta); };
  const pausar = () => { if (pausas++ === 0) { clearTimeout(id); resta -= Date.now() - ini; } };
  const seguir = () => { if (pausas > 0 && --pausas === 0) correr(); };
  t.addEventListener('mouseenter', pausar); t.addEventListener('mouseleave', seguir);
  t.addEventListener('focusin', pausar); t.addEventListener('focusout', seguir);
  host.append(t);
  correr();
}

/** Painel <dialog class="sheet">: fecha arrastando para baixo (celular), com Esc ou tocando fora. */
export function prepararPainel(dlg) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const grip = dlg.querySelector('.sheet__grip, .sheet__head');
  if (!grip) return;
  let y0 = null;
  grip.addEventListener('pointerdown', (e) => { y0 = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointermove', (e) => {
    if (y0 == null || reduzido()) return;
    dlg.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
  });
  const fim = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null; dlg.style.transform = '';
    if (dy > 90) dlg.close();
  };
  grip.addEventListener('pointerup', fim); grip.addEventListener('pointercancel', fim);
}

export function vibrar() { try { navigator.vibrate?.(15); } catch { /* sem suporte */ } }
