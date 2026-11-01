// Risco: volatilidade, queda máxima, beta e concentração (HHI). Números em fração (0.25 = 25%), exceto HHI.
const MIN_OBS = 20;

/** Retornos simples entre pontos consecutivos de uma série de preços. */
export function retornos(precos) {
  const r = [];
  for (let i = 1; i < precos.length; i++) r.push(precos[i] / precos[i - 1] - 1);
  return r;
}

const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Volatilidade anual = desvio padrão amostral diário × √252. null com menos de 20 observações. */
export function volatilidadeAnual(rets) {
  if (rets.length < MIN_OBS) return null;
  const m = media(rets);
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

/**
 * Queda máxima pico-a-vale (fração positiva: 0.25 = queda de 25%), com aportes neutralizados.
 * pontos: [{ v: valor no fim do dia, aporte?: dinheiro novo que entrou nesse dia }].
 * Cada dia rende (v − aporte)/v_anterior − 1, e a queda sai do índice acumulado desses rendimentos.
 * Para um ativo sozinho, passe só { v: preço }.
 */
export function quedaMaxima(pontos) {
  let indice = 1, pico = 1, pior = 0;
  for (let i = 1; i < pontos.length; i++) {
    const ant = pontos[i - 1].v;
    if (!(ant > 0)) continue;
    indice *= (pontos[i].v - (pontos[i].aporte ?? 0)) / ant;
    pico = Math.max(pico, indice);
    pior = Math.max(pior, 1 - indice / pico);
  }
  return pior;
}

/** Beta = covariância(ativo, mercado) ÷ variância(mercado). Séries do mesmo tamanho; null com menos de 20 pontos. */
export function beta(ativo, mercado) {
  if (ativo.length !== mercado.length || ativo.length < MIN_OBS) return null;
  const ma = media(ativo), mm = media(mercado);
  let cov = 0, vm = 0;
  for (let i = 0; i < ativo.length; i++) { cov += (ativo[i] - ma) * (mercado[i] - mm); vm += (mercado[i] - mm) ** 2; }
  return vm < 1e-18 ? null : cov / vm; // mercado "parado": o resíduo de ponto flutuante daria um beta falso
}

/** HHI = Σ(peso%)², com pesos em pontos percentuais somando 100. Nº efetivo de ativos = 10000 ÷ HHI. */
export function hhi(pesosPct) {
  const valor = pesosPct.reduce((s, w) => s + w * w, 0);
  return { hhi: valor, nEfetivo: valor > 0 ? 10_000 / valor : 0, faixa: faixaHhi(valor) };
}

// Faixas 1000 / 1800 / 2500 (escolha nossa para os rótulos; os limites vêm da especificação).
export function faixaHhi(valor) {
  return valor <= 1000 ? 'diversificada' : valor <= 1800 ? 'moderada' : valor <= 2500 ? 'concentrada' : 'muito concentrada';
}
