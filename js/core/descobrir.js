// Descobrir: ativos na faixa "barato", com filtro e ordenação. Puro: recebe a análise pronta (analise/analisar.js).

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Um item da lista, ou null se o ativo não está na faixa barato (ou não tem preço ou análise).
 * desconto: ação = margem de segurança; FII = 1 ÷ (P/VP) − 1. posHist = preço ÷ preço de corte do barato (menor = mais fundo).
 */
export function itemDescobrir(ativo, analise) {
  if (!analise || analise.semDados || analise.faixa?.id !== 'barato' || !tem(ativo?.preco)) return null;
  const { valor, indicacao, faixa } = analise;
  const fii = ativo.tipo === 'fii';
  const desconto = fii ? (tem(valor.pvp) && valor.pvp > 0 ? 1 / valor.pvp - 1 : null) : tem(valor.ms) ? valor.ms : null;
  const corte = faixa.limites?.barato;
  return {
    codigo: ativo.codigo, nome: ativo.nome ?? '', classe: fii ? 'fii' : 'acao', preco: ativo.preco, setor: ativo.setor ?? null,
    nota: tem(valor.nota) ? valor.nota : null, ms: tem(valor.ms) ? valor.ms : null, pvp: tem(valor.pvp) ? valor.pvp : null,
    desconto, posHist: tem(corte) && corte > 0 ? (ativo.preco * 100) / corte : null, indicacao, faixa,
  };
}

// Valores ausentes sempre por último; empate pelo código.
const porNumero = (campo, dir) => (a, b) => {
  const x = a[campo], y = b[campo];
  if (x === null && y === null) return a.codigo.localeCompare(b.codigo);
  if (x === null) return 1;
  if (y === null) return -1;
  return (x - y) * dir || a.codigo.localeCompare(b.codigo);
};

export const ORDENS = {
  nota: ['Maior nota de valor', porNumero('nota', -1)],
  desconto: ['Maior desconto sobre o valor', porNumero('desconto', -1)],
  historico: ['Mais abaixo do histórico', porNumero('posHist', 1)],
  codigo: ['Código (A–Z)', (a, b) => a.codigo.localeCompare(b.codigo)],
};

/** filtro: { tipo: 'todos'|'acao'|'fii', q, ocultarEvitar, ord }. Devolve uma lista nova, ordenada. */
export function filtrar(itens, { tipo = 'todos', q = '', ocultarEvitar = false, ord = 'nota' } = {}) {
  const busca = norm(q.trim());
  return itens
    .filter((i) => (tipo === 'todos' || i.classe === tipo)
      && (!ocultarEvitar || i.indicacao?.id !== 'evitar')
      && (!busca || norm(i.codigo).includes(busca) || norm(i.nome).includes(busca)))
    .sort((ORDENS[ord] ?? ORDENS.nota)[1]);
}
