// Agregados da Carteira (concentração, risco, renda passiva, metas). Puro: sem DOM, rede, storage nem relógio.
// Dinheiro em centavos inteiros; pesos em pontos percentuais; volatilidade e queda em fração (0.25 = 25%).
import { arredonda, centavos, mulDiv } from './money.js';
import { addMeses, mesDe } from './datas.js';
import { hhi, retornos, volatilidadeAnual, quedaMaxima } from './risco.js';
import { porMes } from './proventos.js';
import { aporteMedio, estimarMeta, metaRendaEmPatrimonio, progresso } from './metas.js';

const SEM_GRUPO = 'Sem classificação';

/**
 * Peso por grupo (classe, setor...). `itens`: [{ativo, valor}] (centavos); `grupoDe(ativo)` -> nome ou null.
 * Só entram ativos com valor > 0. Ordem: maior peso primeiro (empate: nome). Sem classificação cai em "Sem classificação".
 * @returns {{grupo:string, valor:number, peso:number, ativos:string[]}[]}
 */
export function pesoPorGrupo(itens, grupoDe) {
  const lista = itens.filter((i) => i.valor > 0);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  const g = new Map();
  for (const i of lista) {
    const nome = grupoDe(i.ativo) || SEM_GRUPO;
    const x = g.get(nome) ?? { grupo: nome, valor: 0, peso: 0, ativos: [] };
    x.valor += i.valor; x.ativos.push(i.ativo);
    g.set(nome, x);
  }
  for (const x of g.values()) x.peso = (x.valor / total) * 100;
  return [...g.values()].sort((a, b) => b.valor - a.valor || a.grupo.localeCompare(b.grupo));
}

/** HHI e nº efetivo de ativos pelos valores. null sem nenhum ativo com valor. */
export function concentracao(itens) {
  const lista = itens.filter((i) => i.valor > 0);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  if (!lista.length) return null;
  const pesos = lista.map((i) => ({ ativo: i.ativo, peso: (i.valor / total) * 100 }));
  const maior = pesos.reduce((m, p) => (p.peso > m.peso ? p : m), pesos[0]);
  return { ...hhi(pesos.map((p) => p.peso)), n: lista.length, maior };
}

/**
 * Variação do dia da carteira. `varDia`: Map ou objeto ativo -> % do dia (ex.: 2.5). O valor de ontem de cada ativo é
 * valor ÷ (1 + var). Ativo sem variação fica de fora (n diz quantos entraram). null se nenhum entrou.
 * @returns {{valor:number, pct:number, n:number}|null} valor em centavos
 */
export function variacaoDia(itens, varDia) {
  const v = (a) => (varDia instanceof Map ? varDia.get(a) : varDia?.[a]);
  let delta = 0, ontem = 0, n = 0;
  for (const i of itens) {
    const x = v(i.ativo);
    if (!(i.valor > 0) || !Number.isFinite(x) || x <= -100) continue;
    const o = i.valor / (1 + x / 100);
    delta += i.valor - o; ontem += o; n++;
  }
  return n ? { valor: arredonda(delta), pct: (delta / ontem) * 100, n } : null;
}

/**
 * Valor diário da carteira de hoje, como se as cotas atuais tivessem sido mantidas por todo o período.
 * `itens`: [{ativo, qtd}]; `series`: { ATIVO: { d:[AAAAMMDD], p:[centavos] } } (formato de dados/precos/*.json).
 * Usa só os dias em que TODOS os ativos com histórico têm preço; ativo sem histórico vai para `fora`.
 * ponytail: ignora a data real das compras (não é o histórico de patrimônio, é o risco da carteira atual);
 * um ativo novo na bolsa encurta o período de todos. Evoluir para preencher o passado só se isso incomodar.
 * @returns {{d:number[], v:number[], usados:string[], fora:string[]}}
 */
export function serieCarteira(itens, series) {
  const ok = (s) => s && Array.isArray(s.d) && s.d.length > 1 && s.d.length === s.p?.length;
  const usados = itens.filter((i) => ok(series[i.ativo])), fora = itens.filter((i) => !ok(series[i.ativo])).map((i) => i.ativo);
  if (!usados.length) return { d: [], v: [], usados: [], fora };
  const idx = usados.map((i) => new Map(series[i.ativo].d.map((d, k) => [d, k])));
  const d = [], v = [];
  for (const dia of series[usados[0].ativo].d) {
    if (!idx.every((m) => m.has(dia))) continue;
    d.push(dia);
    v.push(usados.reduce((s, i, j) => s + i.qtd * series[i.ativo].p[idx[j].get(dia)], 0));
  }
  return { d, v, usados: usados.map((i) => i.ativo), fora };
}

/**
 * Volatilidade anual (últimos 252 retornos) e queda máxima (período todo) da carteira de hoje. Cada uma é null se faltar dado
 * (volatilidade exige 20 retornos). `pregoes` = dias em comum usados.
 */
export function riscoCarteira(itens, series) {
  const s = serieCarteira(itens, series);
  return {
    vol: volatilidadeAnual(retornos(s.v.slice(-253))),
    queda: s.v.length > 1 ? quedaMaxima(s.v.map((v) => ({ v }))) : null,
    pregoes: s.v.length, de: s.d[0] ?? null, ate: s.d.at(-1) ?? null, usados: s.usados, fora: s.fora,
  };
}

/** Proventos lançados à mão (não excluídos), no formato que core/proventos.js entende (pagamento = data lançada). */
export const proventosLancados = (transacoes) =>
  transacoes.filter((t) => t.tipo === 'provento' && !t.excluido && t.data && t.valor > 0)
    .map((t) => ({ ativo: t.ativo, pagamento: t.data, valor: t.valor }));

/**
 * Renda passiva só dos proventos lançados. `meses`: os 12 meses civis até o mês de `hoje` (mês sem lançamento = 0);
 * total12 = soma desses 12 meses; mediaMensal = total12 ÷ 12. `porAtivo` e `total` somam tudo o que já foi lançado.
 */
export function rendaPassiva(transacoes, hoje) {
  const lista = proventosLancados(transacoes), m = porMes(lista);
  const meses = Array.from({ length: 12 }, (_, k) => { const mes = mesDe(addMeses(`${mesDe(hoje)}-01`, k - 11)); return { mes, valor: m[mes] ?? 0 }; });
  const total12 = meses.reduce((s, x) => s + x.valor, 0);
  const porAtivo = {};
  for (const p of lista) porAtivo[p.ativo] = (porAtivo[p.ativo] ?? 0) + p.valor;
  return { temDados: lista.length > 0, meses, total12, mediaMensal: mulDiv(total12, 1, 12), porAtivo, total: lista.reduce((s, p) => s + p.valor, 0) };
}

/**
 * Progresso das metas. `metas`: { patrimonio?, rendaMensal? (centavos), prazoAnos? }. `patrimonio` = valor atual (centavos);
 * `rendaMensal` = média mensal de proventos (centavos). Ritmo = aporte médio dos 6 meses fechados; sem histórico, o aporte
 * definido em Ajustes; sem nenhum, não há estimativa (nunca inventa ritmo). Estimativa só com aportes (não conta valorização).
 * `prazo.dentro`: a estimativa cai até a data do prazo (null se não há estimativa).
 */
export function statusMetas({ metas = {}, patrimonio, rendaMensal, transacoes = [], aporte = null, hoje }) {
  const medio = aporteMedio(transacoes, hoje);
  const definido = Number.isSafeInteger(aporte?.valor) && aporte.valor > 0 ? aporte.valor : null;
  const aporteMensal = medio > 0 ? medio : definido;
  const origemAporte = medio > 0 ? 'historico' : definido ? 'definido' : null;
  const r = { aporteMensal, origemAporte, patrimonio: null, renda: null, prazo: null };

  if (metas.patrimonio > 0) {
    r.patrimonio = { meta: metas.patrimonio, atual: patrimonio, prog: progresso(patrimonio, metas.patrimonio),
      estimativa: estimarMeta({ atual: patrimonio, meta: metas.patrimonio, aporteMensal, hoje }) };
  }
  if (metas.rendaMensal > 0) {
    const necessario = metaRendaEmPatrimonio({ metaRendaMensal: metas.rendaMensal, rendaMensal, patrimonio });
    r.renda = { meta: metas.rendaMensal, atual: rendaMensal, prog: progresso(rendaMensal, metas.rendaMensal), patrimonioNecessario: necessario,
      estimativa: necessario ? estimarMeta({ atual: patrimonio, meta: necessario, aporteMensal, hoje }) : null };
  }
  if (metas.prazoAnos > 0) {
    const data = addMeses(hoje, metas.prazoAnos * 12), est = (r.patrimonio ?? r.renda)?.estimativa ?? null;
    r.prazo = { anos: metas.prazoAnos, data, dentro: est ? est.data <= data : null };
  }
  return r;
}

/**
 * Texto digitado em reais ("1.500,50", "R$ 2000", "10,5", "1.5") -> centavos inteiros. null se não for um valor positivo
 * com no máximo 2 casas. "1.500" é mil e quinhentos; "1.5" é um real e cinquenta.
 */
export function reaisParaCentavos(txt) {
  let s = String(txt ?? '').replace(/R\$|\s/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const c = centavos(Number(s));
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}
