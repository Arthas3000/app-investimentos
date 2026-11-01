// Nota de estabilidade (0-10) por ativo e por setor. Pura: sem DOM, rede ou Date.
import { COBERTURA } from './constantes.js';

// Faixas { pior, melhor } e peso (pontos de 1000). pior > melhor significa "quanto menor, melhor".
// Valores iniciais nossos (escolha de calibração, não fato): ajuste aqui.
export const FAIXAS = {
  vol1a: { pior: 0.6, melhor: 0.15 },
  vol3a: { pior: 0.6, melhor: 0.15 },
  queda3a: { pior: 0.6, melhor: 0.15 },
  queda5a: { pior: 0.7, melhor: 0.2 },
  beta: { pior: 1.6, melhor: 0.6 },
  oscilacaoLucro: { pior: 1, melhor: 0.1 },   // desvio padrão ÷ |média| dos lucros trimestrais
  triPrejuizo: { pior: 0.5, melhor: 0 },      // fração dos trimestres com prejuízo
  liquidez: { pior: 100_000, melhor: 5_000_000 }, // R$/dia, em escala logarítmica
};
export const PESOS = { vol1a: 150, vol3a: 150, queda3a: 125, queda5a: 125, beta: 150, oscilacaoLucro: 100, triPrejuizo: 100, liquidez: 100 };
const PILARES = [
  ['vol', 'Volatilidade', ['vol1a', 'vol3a']],
  ['queda', 'Queda máxima', ['queda3a', 'queda5a']],
  ['beta', 'Beta', ['beta']],
  ['lucro', 'Estabilidade do lucro', ['oscilacaoLucro', 'triPrejuizo']],
  ['liquidez', 'Liquidez', ['liquidez']],
];
const NOMES = {
  vol1a: 'Volatilidade 1 ano', vol3a: 'Volatilidade 3 anos', queda3a: 'Queda máxima 3 anos', queda5a: 'Queda máxima 5 anos',
  beta: 'Beta', oscilacaoLucro: 'Oscilação do lucro', triPrejuizo: 'Trimestres com prejuízo', liquidez: 'Liquidez diária',
};
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const FMT = {
  vol1a: pct, vol3a: pct, queda3a: pct, queda5a: pct, triPrejuizo: pct,
  beta: (x) => x.toFixed(2).replace('.', ','),
  oscilacaoLucro: (x) => x.toFixed(2).replace('.', ','),
  liquidez: (x) => `R$ ${(x / 1e6).toFixed(1).replace('.', ',')} mi`,
};

const clip = (x) => Math.min(1, Math.max(0, x));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function valores(fund, risco) {
  const lt = Array.isArray(fund?.lucrosTri) ? fund.lucrosTri.filter((x) => num(x) !== null) : [];
  let oscilacaoLucro = null;
  if (lt.length >= 4) { // menos de 4 trimestres não diz nada sobre estabilidade
    const m = lt.reduce((s, x) => s + x, 0) / lt.length;
    const dp = Math.sqrt(lt.reduce((s, x) => s + (x - m) ** 2, 0) / (lt.length - 1));
    oscilacaoLucro = m === 0 ? null : dp / Math.abs(m);
  }
  return {
    vol1a: num(risco?.vol1a), vol3a: num(risco?.vol3a), queda3a: num(risco?.queda3a), queda5a: num(risco?.queda5a),
    beta: num(risco?.beta), oscilacaoLucro,
    triPrejuizo: lt.length >= 4 ? lt.filter((x) => x < 0).length / lt.length : null,
    liquidez: num(risco?.liquidezDiaria) > 0 ? risco.liquidezDiaria : null,
  };
}

function fracao(id, v) {
  const { pior, melhor } = FAIXAS[id];
  if (id === 'liquidez') return clip((Math.log10(v) - Math.log10(pior)) / (Math.log10(melhor) - Math.log10(pior)));
  return clip((v - pior) / (melhor - pior));
}

/**
 * Nota de estabilidade de um ativo. Entrada { fund, risco } (fund pode ser null: FII não tem lucrosTri).
 * Dado ausente: o peso sai do pilar e é redistribuído entre os itens que sobram; pilar inteiro sem dado sai do
 * score (normalizado sobre o que tem dado) e reduz a cobertura. Cobertura < COBERTURA.parcial: sem nota.
 */
export function notaEstabilidade({ fund = null, risco = null } = {}) {
  const v = valores(fund, risco);
  const pilares = {};
  const motivos = [];
  let comDado = 0, pontosTotal = 0, maxTotal = 0;
  for (const [id, nome, ids] of PILARES) {
    const itens = ids.map((i) => {
      const max = PESOS[i] / 10;
      if (v[i] === null) return { nome: NOMES[i], pontos: 0, max, valor: null };
      return { nome: NOMES[i], pontos: max * fracao(i, v[i]), max, valor: v[i], id: i };
    });
    const pesoDado = itens.filter((i) => i.valor !== null).reduce((s, i) => s + i.max, 0);
    const maxPilar = itens.reduce((s, i) => s + i.max, 0);
    const pontos = pesoDado ? (itens.reduce((s, i) => s + i.pontos, 0) / pesoDado) * maxPilar : 0;
    pilares[id] = { nome, pontos, max: maxPilar, itens: itens.map(({ id: _, ...r }) => r) };
    comDado += pesoDado;
    if (pesoDado) { pontosTotal += pontos; maxTotal += maxPilar; }
    for (const i of itens) if (i.valor !== null && i.pontos / i.max < 0.4) motivos.push(`${i.nome} fraca: ${FMT[i.id](i.valor)}`);
  }
  const cobertura = comDado / 100;
  const semNota = cobertura < COBERTURA.parcial;
  const score = semNota ? null : (pontosTotal / maxTotal) * 1000;
  return { nota: score === null ? null : score / 100, score, pilares, cobertura, semNota, motivos };
}

// Quantil com interpolação linear sobre vetor ordenado.
function quantil(a, q) {
  const p = (a.length - 1) * q, i = Math.floor(p);
  return i + 1 < a.length ? a[i] + (a[i + 1] - a[i]) * (p - i) : a[i];
}

/** Nota do setor/segmento: mediana e dispersão (amplitude interquartil) das notas dos ativos. Ignora null. n<3: sem nota. */
export function notaSetor(notasDosAtivos) {
  const a = notasDosAtivos.filter((x) => num(x) !== null).sort((x, y) => x - y);
  if (a.length < 3) return { mediana: null, dispersao: null, n: a.length };
  return { mediana: quantil(a, 0.5), dispersao: quantil(a, 0.75) - quantil(a, 0.25), n: a.length };
}
