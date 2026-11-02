// Indicação automática por ativo, sempre com os números que a justificam. Pura: sem DOM, rede ou relógio.
// Precedência: Evitar > Atenção ao rendimento > Preço atrativo pelos números > Atrativo, com ressalvas
//   > Boa, mas sem desconto > Neutro. Limites gerais em constantes.js; os daqui são só deste módulo.
import { KE, COBERTURA, LIMITES } from './constantes.js';

export const ROTULOS = {
  candidata: 'Preço atrativo pelos números',
  cautela: 'Atrativo, com ressalvas',
  boa: 'Boa, mas sem desconto',
  atencao: 'Atenção ao rendimento',
  evitar: 'Evitar',
  neutro: 'Neutro',
};

export const LIMITES_LOCAIS = {
  dlEbitdaAlta: 3,        // ação: DL/EBITDA acima disso é alavancagem alta
  dlPlAlta: 1,            // incorporadora: DL/PL acima disso
  estabBaixa: 4,          // nota de estabilidade abaixo disso é baixa
  fiiAlavancagemAlta: 0.3, // FII: passivo/ativo acima disso
  fiiVendaImoveis: 0.25,  // FII: parcela do rendimento vinda de venda de imóveis acima disso
};

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const pct = (x) => `${num(x * 100, 0)}%`;
const res = (id, motivos) => ({ id, rotulo: ROTULOS[id], motivos });

function alavancagemAlta(fund) {
  if (fund.tipo === 'banco') return null;
  if (fund.tipo === 'incorporadora') return tem(fund.dlPl) && fund.dlPl > LIMITES_LOCAIS.dlPlAlta ? `Dívida líquida/PL alta: ${num(fund.dlPl)}` : null;
  return tem(fund.dlEbitda) && fund.dlEbitda > LIMITES_LOCAIS.dlEbitdaAlta ? `Dívida líquida/EBITDA alta: ${num(fund.dlEbitda)}` : null;
}

// Fundamentos piorando: tendência do ROE < limite, prejuízo no último trimestre, ou ROE abaixo do Ke com alavancagem alta.
function piora(fund) {
  const m = [];
  const tend = tem(fund.roeTri) && tem(fund.roe12m) && fund.roe12m > 0 ? (fund.roeTri * 4) / fund.roe12m : null;
  if (tend !== null && tend < LIMITES.evitar.tendenciaRoe) m.push(`ROE do trimestre anualizado em ${pct(tend)} do de 12 meses`);
  const ultimo = (fund.lucrosTri ?? []).find(tem);
  if (tem(ultimo) && ultimo < 0) m.push('Prejuízo no último trimestre');
  const alav = alavancagemAlta(fund);
  if (tem(fund.roe12m) && fund.roe12m < KE && alav) m.push(`ROE de 12 meses de ${pct(fund.roe12m)}, abaixo do custo de capital de ${pct(KE)}, com ${alav.charAt(0).toLowerCase()}${alav.slice(1)}`);
  return m;
}

/**
 * classe: 'acao' | 'fii'. valor: saída de notaValorAcao/notaValorFii. estab: { nota }. fund: fundamentos do ativo.
 * risco: { var12m, var3m, ... }. preco: em reais. Devolve { id, rotulo, motivos }.
 */
export function indicar({ classe, valor, estab, fund, risco, preco }) {
  const fii = classe === 'fii';
  fund = fund ?? {}; risco = risco ?? {};
  const caiu = (tem(risco.var12m) && risco.var12m < 0) || (tem(risco.var3m) && risco.var3m < 0);

  // Evitar (só ações): preço caiu e os fundamentos pioraram.
  if (!fii && caiu) {
    const m = piora(fund);
    if (m.length) return res('evitar', [`Preço em queda (12 meses: ${tem(risco.var12m) ? pct(risco.var12m) : 'sem dado'})`, ...m]);
  }

  // Atenção ao rendimento.
  if (fii) {
    const cobFfo = tem(fund.ffo) && tem(fund.rend12m) && fund.rend12m > 0 ? fund.ffo / fund.rend12m : null;
    const m = [];
    if (cobFfo !== null && cobFfo < LIMITES.atencao.coberturaFfo) m.push(`FFO cobre só ${pct(cobFfo)} do rendimento`);
    if (tem(fund.pctVendaImoveis) && fund.pctVendaImoveis > LIMITES_LOCAIS.fiiVendaImoveis) m.push(`${pct(fund.pctVendaImoveis)} do rendimento veio de venda de imóveis`);
    if (m.length) return res('atencao', m);
  } else if (tem(fund.payout) && fund.payout > LIMITES.atencao.payout) {
    return res('atencao', [`Payout de ${pct(fund.payout)}: distribui mais do que lucra`]);
  }

  if (!valor || valor.semNota || !tem(valor.nota)) return res('neutro', ['Dados insuficientes']);

  const pvp = fii && tem(preco) && tem(fund.vpa) && fund.vpa > 0 ? preco / fund.vpa : null;
  const desconto = fii ? pvp !== null && pvp < LIMITES.fiiPvpDesconto : tem(valor.ms) && valor.ms > 0;
  const semDesconto = fii ? pvp !== null && pvp >= LIMITES.fiiPvpDesconto : tem(valor.ms) && valor.ms <= 0;
  const motivoPreco = fii
    ? (pvp !== null ? `P/VP de ${num(pvp)}` : null)
    : (tem(valor.ms) ? `Margem de segurança de ${pct(valor.ms)}` : null);
  const motivoNota = `Nota de valor ${num(valor.nota, 1)}`;

  // Alertas que rebaixam "candidata" para "cautela". Nos FIIs a nota é sempre parcial (a CVM não traz FFO
  // nem vacância), então a nota parcial só é alerta nas ações.
  const alertas = [];
  if (!fii && tem(valor.cobertura) && valor.cobertura < COBERTURA.completa) alertas.push(`Nota parcial (${pct(valor.cobertura)} dos dados)`);
  if (!fii && fund.estatal) alertas.push('Estatal');
  if (!fii) { const a = alavancagemAlta(fund); if (a) alertas.push(a); }
  if (fii && tem(fund.alavancagem) && fund.alavancagem > LIMITES_LOCAIS.fiiAlavancagemAlta) alertas.push(`Alavancagem de ${pct(fund.alavancagem)}`);
  if (tem(estab?.nota) && estab.nota < LIMITES_LOCAIS.estabBaixa) alertas.push(`Estabilidade baixa: nota ${num(estab.nota, 1)}`);
  if (!fii) alertas.push(...piora(fund)); // fundamentos piorando sem queda de preço: não é armadilha, mas pesa

  if (desconto && valor.nota >= LIMITES.candidata.nota && !alertas.length) return res('candidata', [motivoPreco, motivoNota]);
  if (desconto && valor.nota >= LIMITES.cautela.nota) return res('cautela', [motivoPreco, motivoNota, ...alertas]);

  const p3 = valor.pilares?.p3;
  const qualidade = p3 && p3.max > 0 ? p3.pontos / p3.max : null;
  if (semDesconto && qualidade !== null && qualidade >= LIMITES.boa.p3) {
    return res('boa', [`Qualidade em ${pct(qualidade)} do máximo`, motivoPreco].filter(Boolean));
  }
  return res('neutro', [motivoNota, motivoPreco].filter(Boolean));
}
