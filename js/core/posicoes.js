// Posições e caixa a partir da lista de transações. Reprocessa tudo do zero, na ordem de data.
//
// Transação: { id, tipo, data:'AAAA-MM-DD', ativo?, qtd?, preco?, taxas?, valor?, excluido? }
//   tipo: compra | venda | transferencia (entra com qtd e preço médio de origem) | deposito | retirada | provento
//   preco, taxas, valor: centavos inteiros. qtd: inteiro (cotas).
import { mulDiv } from './money.js';
import { ehData } from './datas.js';

const COM_COTAS = ['compra', 'venda', 'transferencia'];
const SO_VALOR = ['deposito', 'retirada', 'provento'];
const inteiroPos = (n) => Number.isSafeInteger(n) && n > 0;

/** Erros em linguagem de ajuda; lista vazia = válida. qtdAtual = cotas que a pessoa tem do ativo nessa data. */
export function validar(t, qtdAtual = 0) {
  const e = [];
  if (![...COM_COTAS, ...SO_VALOR].includes(t.tipo)) return ['Tipo de movimentação desconhecido.'];
  if (!ehData(t.data)) e.push('Informe uma data válida.');
  if (COM_COTAS.includes(t.tipo)) {
    if (!t.ativo) e.push('Escolha o ativo.');
    if (!inteiroPos(t.qtd)) e.push('A quantidade precisa ser um número inteiro maior que zero.');
    if (!inteiroPos(t.preco)) e.push('Informe o preço por cota.');
    if (t.taxas != null && !(Number.isSafeInteger(t.taxas) && t.taxas >= 0)) e.push('As taxas não podem ser negativas.');
    if (t.tipo === 'venda' && inteiroPos(t.qtd) && t.qtd > qtdAtual) {
      e.push(qtdAtual === 0 ? `Você não tem cotas de ${t.ativo ?? 'este ativo'} para vender.`
        : qtdAtual === 1 ? 'A venda é maior que a 1 cota que você tem.'
        : `A venda é maior que as ${qtdAtual} cotas que você tem.`);
    }
  } else {
    if (!inteiroPos(t.valor)) e.push('Informe um valor maior que zero.');
    if (t.tipo === 'provento' && !t.ativo) e.push('Escolha o ativo que pagou o provento.');
  }
  return e;
}

const cmp = ([a, i], [b, j]) => (a.data < b.data ? -1 : a.data > b.data ? 1 : i - j); // empate de data: ordem de registro

/**
 * Posição = { qtd, custo } (custo total em centavos, com taxas). Caixa = depósitos − retiradas − compras + vendas + proventos.
 * Transação inválida no reprocessamento (ex.: uma venda que ficou maior que a posição depois de corrigir uma compra)
 * é pulada e listada em `erros`, para a tela avisar em vez de quebrar.
 * Obs.: o caixa pode ficar negativo se a pessoa nunca registrou depósitos; a tela decide se mostra.
 * @returns {{posicoes: Map<string,{qtd:number,custo:number}>, caixa:number, erros:{id:any,erros:string[]}[]}}
 */
export function calcular(transacoes) {
  const ordem = transacoes.map((t, i) => [t, i]).filter(([t]) => !t.excluido).sort(cmp).map(([t]) => t);
  const posicoes = new Map();
  const erros = [];
  let caixa = 0;
  for (const t of ordem) {
    const pos = posicoes.get(t.ativo) ?? { qtd: 0, custo: 0 };
    const falhas = validar(t, pos.qtd);
    if (falhas.length) { erros.push({ id: t.id, erros: falhas }); continue; }
    const taxas = t.taxas ?? 0;
    const bruto = COM_COTAS.includes(t.tipo) ? mulDiv(t.qtd, t.preco, 1) : 0;
    if (t.tipo === 'compra') { pos.qtd += t.qtd; pos.custo += bruto + taxas; caixa -= bruto + taxas; }
    else if (t.tipo === 'transferencia') { pos.qtd += t.qtd; pos.custo += bruto; }
    else if (t.tipo === 'venda') {
      pos.custo -= mulDiv(pos.custo, t.qtd, pos.qtd); // a venda tira custo na proporção das cotas vendidas
      pos.qtd -= t.qtd; caixa += bruto - taxas;
    }
    else if (t.tipo === 'deposito' || t.tipo === 'provento') caixa += t.valor;
    else caixa -= t.valor; // retirada
    if (COM_COTAS.includes(t.tipo)) pos.qtd === 0 ? posicoes.delete(t.ativo) : posicoes.set(t.ativo, pos);
  }
  return { posicoes, caixa, erros };
}

/** Preço médio em centavos (arredondado só para exibir; o custo total é o valor exato). */
export const precoMedio = (p) => mulDiv(p.custo, 1, p.qtd);

/**
 * Saldo e resultado. `precos`: Map ou objeto código -> centavos. Ativo sem preço fica fora dos totais
 * (nunca inventa número) e vem em `semPreco`. resultadoPct é fração (0.2346 = 23,46%); null se o custo é zero.
 */
export function resumo(posicoes, precos) {
  const preco = (c) => (precos instanceof Map ? precos.get(c) : precos[c]);
  const itens = [], semPreco = [];
  let saldo = 0, custo = 0;
  for (const [ativo, p] of posicoes) {
    const pr = preco(ativo);
    if (!Number.isSafeInteger(pr)) { semPreco.push(ativo); continue; }
    const valor = mulDiv(p.qtd, pr, 1);
    itens.push({ ativo, qtd: p.qtd, custo: p.custo, precoMedio: precoMedio(p), preco: pr, valor, resultado: valor - p.custo, resultadoPct: p.custo > 0 ? (valor - p.custo) / p.custo : null });
    saldo += valor; custo += p.custo;
  }
  for (const i of itens) i.peso = saldo > 0 ? i.valor / saldo : 0;
  const resultado = saldo - custo;
  return { saldo, custo, resultado, resultadoPct: custo > 0 ? resultado / custo : null, itens, semPreco };
}
