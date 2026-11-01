// "Seu mês": resumo mensal, série de patrimônio e marcos. Puro: sem DOM, sem rede, sem relógio (quem chama passa "hoje").
// Dinheiro em centavos inteiros. Percentuais saem como número de 0 a 100 (23,5 = 23,5%). Transações `excluido` são ignoradas.
// Preço de fim de mês ausente para um ativo = usa o custo (preço médio) e lista o ativo em `estimados` (nunca inventa preço).
import { calcular } from './posicoes.js';
import { mulDiv } from './money.js';
import { addMeses, mesDe } from './datas.js';

const proxMes = (mes, n = 1) => mesDe(addMeses(`${mes}-01`, n));
const fimDoMes = (mes) => `${mes}-31`; // limite de texto: nenhuma data válida do mês passa de 31
const br = (iso) => iso.split('-').reverse().join('/');
const soma = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const bruto = (t) => mulDiv(t.qtd, t.preco, 1);

/**
 * Último fechamento do mês numa série { d:[AAAAMMDD], p:[centavos] } (como em dados/precos/{T}.json).
 * null se a série não tem nenhum pregão dentro desse mês.
 */
export function fechamentoMes(serie, mes) {
  const { d, p } = serie ?? {};
  if (!Array.isArray(d) || !Array.isArray(p)) return null;
  const ini = Number(mes.replace('-', '')) * 100, fim = ini + 31;
  for (let k = Math.min(d.length, p.length) - 1; k >= 0; k--) {
    if (d[k] > fim) continue;
    return d[k] > ini && Number.isSafeInteger(p[k]) && p[k] > 0 ? p[k] : null; // o mais recente <= fim; se é de outro mês, não há
  }
  return null;
}

/** Posições no fim do mês: patrimônio = valor de mercado + caixa positivo (mesma regra da Carteira); investido = custo das posições. */
function fotografia(transacoes, mes, precos) {
  const { posicoes, caixa, erros } = calcular(transacoes.filter((t) => !t.excluido && t.data <= fimDoMes(mes)));
  const itens = [], estimados = [];
  let valorTotal = 0, investido = 0;
  for (const [ativo, p] of posicoes) {
    const pr = precos?.[ativo];
    const ok = Number.isSafeInteger(pr) && pr > 0;
    if (!ok) estimados.push(ativo);
    const valor = ok ? mulDiv(p.qtd, pr, 1) : p.custo;
    itens.push({ ativo, valor });
    valorTotal += valor; investido += p.custo;
  }
  return { patrimonio: valorTotal + Math.max(caixa, 0), investido, valorTotal, itens, estimados, erros };
}

const evolucao = (atual, antes) => ({ valor: atual - antes, pct: antes > 0 ? ((atual - antes) / antes) * 100 : null });

/**
 * Resumo de um mês.
 * @param {{transacoes:object[], mes:string, precosMes:Record<string,number>, precosAnterior?:Record<string,number>, alvos?:Record<string,number>}} e
 *   precosMes / precosAnterior: fechamento do fim do mês (e do mês anterior) por ticker, em centavos.
 * @returns {{mes, aportes:{total,bruto,taxas,n}, proventos:{total,n,porAtivo:{ativo,valor}[]}, fim:{patrimonio,investido}, anterior:{patrimonio,investido},
 *   evolucao:{patrimonio:{valor,pct}, investido:{valor,pct}}, alvos:{ativo,peso,alvo,distancia}[], estimados:string[], vazio:boolean}}
 */
export function resumoMes({ transacoes = [], mes, precosMes = {}, precosAnterior = {}, alvos = {} }) {
  const fim = fotografia(transacoes, mes, precosMes);
  const ant = fotografia(transacoes, proxMes(mes, -1), precosAnterior);
  const invalidas = new Set(fim.erros.map((e) => e.id)); // venda sem cotas etc.: fora da carteira, fora do resumo
  const doMes = transacoes.filter((t) => !t.excluido && mesDe(t.data) === mes && !invalidas.has(t.id));

  const compras = doMes.filter((t) => t.tipo === 'compra');
  const taxas = soma(compras, (t) => t.taxas ?? 0), brutoCompras = soma(compras, bruto);
  const prov = doMes.filter((t) => t.tipo === 'provento');
  const porAtivo = [...prov.reduce((m, t) => m.set(t.ativo, (m.get(t.ativo) ?? 0) + t.valor), new Map())]
    .map(([ativo, valor]) => ({ ativo, valor })).sort((a, b) => b.valor - a.valor || (a.ativo < b.ativo ? -1 : 1));

  const alvo = (a) => (Number.isFinite(alvos[a]) ? alvos[a] : null);
  const peso = (v) => (fim.valorTotal > 0 ? (v / fim.valorTotal) * 100 : 0);
  const linhas = fim.itens.map(({ ativo, valor }) => {
    const p = peso(valor), a = alvo(ativo);
    return { ativo, peso: p, alvo: a, distancia: a == null ? null : p - a };
  });
  for (const a of Object.keys(alvos)) { // alvo definido para um ativo que não está na carteira: peso 0
    if (!linhas.some((l) => l.ativo === a) && alvo(a) != null) linhas.push({ ativo: a, peso: 0, alvo: alvo(a), distancia: -alvo(a) });
  }
  linhas.sort((a, b) => b.peso - a.peso || (b.alvo ?? 0) - (a.alvo ?? 0) || (a.ativo < b.ativo ? -1 : 1));

  return {
    mes,
    aportes: { total: brutoCompras + taxas, bruto: brutoCompras, taxas, n: compras.length },
    proventos: { total: soma(prov, (t) => t.valor), n: prov.length, porAtivo },
    fim: { patrimonio: fim.patrimonio, investido: fim.investido },
    anterior: { patrimonio: ant.patrimonio, investido: ant.investido },
    evolucao: { patrimonio: evolucao(fim.patrimonio, ant.patrimonio), investido: evolucao(fim.investido, ant.investido) },
    alvos: linhas,
    estimados: fim.estimados,
    vazio: !doMes.length && !fim.itens.length,
  };
}

/**
 * Patrimônio e investido no fim de cada mês, do mês da 1ª transação até `ate` (inclusive).
 * `precosPorMes`: { 'AAAA-MM': { TICKER: centavos } }. [] se não há transações ou `ate` é anterior à 1ª.
 * @returns {{mes:string, patrimonio:number, investido:number, estimados:string[]}[]}
 */
export function serieMensal({ transacoes = [], precosPorMes = {}, ate }) {
  const ativas = transacoes.filter((t) => !t.excluido);
  if (!ativas.length) return [];
  const ini = mesDe(ativas.reduce((m, t) => (t.data < m ? t.data : m), ativas[0].data));
  const out = [];
  for (let m = ini; m <= ate; m = proxMes(m)) {
    const f = fotografia(transacoes, m, precosPorMes[m]);
    out.push({ mes: m, patrimonio: f.patrimonio, investido: f.investido, estimados: f.estimados });
  }
  return out;
}

const LIMIARES = [['patrimonio-10k', 1_000_000, 'R$ 10 mil'], ['patrimonio-50k', 5_000_000, 'R$ 50 mil'], ['patrimonio-100k', 10_000_000, 'R$ 100 mil']];
const ultimoDia = (mes) => { const [y, m] = mes.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/**
 * Marcos já alcançados até `hoje`, do mais antigo para o mais novo: { id, data:'AAAA-MM-DD', texto }.
 * Aporte = compra. "Meses seguidos" = meses-calendário consecutivos, cada um com ao menos uma compra; o marco fica para sempre
 * (parar de aportar não tira nada). Patrimônio é medido no fim do mês (no mês corrente, vale `hoje`).
 * @param {{transacoes:object[], patrimonioPorMes:{mes:string,patrimonio:number}[], hoje:string}} e
 */
export function marcos({ transacoes = [], patrimonioPorMes = [], hoje }) {
  const ts = transacoes.filter((t) => !t.excluido && t.data <= hoje).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const out = [];
  const compras = ts.filter((t) => t.tipo === 'compra');
  if (compras.length) out.push({ id: 'primeiro-aporte', data: compras[0].data, texto: `Primeiro aporte registrado em ${br(compras[0].data)}` });
  const prov = ts.find((t) => t.tipo === 'provento');
  if (prov) out.push({ id: 'primeiro-provento', data: prov.data, texto: `Primeiro provento recebido em ${br(prov.data)}` });

  const primeiraDoMes = new Map();
  for (const t of compras) if (!primeiraDoMes.has(mesDe(t.data))) primeiraDoMes.set(mesDe(t.data), t.data);
  let seq = 0, antes = null;
  const feito = new Set();
  for (const m of primeiraDoMes.keys()) { // as chaves entram em ordem de data
    seq = antes && proxMes(antes) === m ? seq + 1 : 1; antes = m;
    for (const n of [6, 12]) if (seq === n && !feito.has(n)) {
      feito.add(n);
      out.push({ id: `aportes-${n}-meses`, data: primeiraDoMes.get(m), texto: `${n} meses seguidos com aporte, completados em ${br(primeiraDoMes.get(m))}` });
    }
  }

  const mesHoje = mesDe(hoje);
  const pm = patrimonioPorMes.filter((x) => x.mes <= mesHoje).sort((a, b) => (a.mes < b.mes ? -1 : 1));
  for (const [id, limiar, nome] of LIMIARES) {
    const x = pm.find((y) => y.patrimonio >= limiar);
    if (x) out.push({ id, data: x.mes === mesHoje ? hoje : `${x.mes}-${String(ultimoDia(x.mes)).padStart(2, '0')}`, texto: `Patrimônio acima de ${nome} em ${x.mes.slice(5)}/${x.mes.slice(0, 4)}` });
  }
  return out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)); // sort estável: empate mantém a ordem acima
}

/** Marcos que a pessoa ainda não viu. `jaMostrados`: lista de ids. */
export function novosMarcos(alcancados, jaMostrados = []) {
  const vistos = new Set(jaMostrados);
  return alcancados.filter((m) => !vistos.has(m.id));
}
