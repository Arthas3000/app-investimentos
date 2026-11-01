// Nota de valor (0-10) de ações e FIIs. Funções puras: sem DOM, rede ou relógio.
// Dado ausente (null) tem o peso redistribuído DENTRO do pilar; a cobertura é a parcela dos 1000 pontos com dado.
import { KE, G, FATOR_CDI_LIQ, COBERTURA } from './constantes.js';

export const clip = (x) => Math.min(1, Math.max(0, x));
// pontos × clip((valor − pior) / (melhor − pior)); funciona nos dois sentidos (pior > melhor = menor é melhor).
export const parcial = (pontos, valor, pior, melhor) => pontos * clip((valor - pior) / (melhor - pior));

const tem = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x, d = 2) => x.toFixed(d).replace('.', ',');
const pct = (x) => `${num(x * 100, 0)}%`;
const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const r2 = (x) => Math.round(x * 100) / 100;

// Cada item: { nome, max, valor, pior, melhor, mult? }. Sem valor: o peso vai para os itens com dado.
// ajuste = pontos somados ao pilar depois (ex.: estatal -15); o pilar nunca fica abaixo de 0.
function pilar(nome, max, defs, ajuste) {
  const disponivel = defs.filter((d) => tem(d.valor)).reduce((s, d) => s + d.max, 0);
  const f = disponivel > 0 ? max / disponivel : 0;
  const itens = defs.map((d) => {
    if (!tem(d.valor)) return { nome: d.nome, pontos: 0, max: 0, valor: null };
    const m = d.max * f;
    return { nome: d.nome, pontos: parcial(m, d.valor, d.pior, d.melhor) * (d.mult ?? 1), max: m, valor: d.valor };
  });
  let pontos = itens.reduce((s, i) => s + i.pontos, 0);
  if (ajuste) {
    itens.push({ nome: ajuste.nome, pontos: ajuste.pontos, max: 0, valor: true });
    pontos = Math.max(0, pontos + ajuste.pontos);
  }
  return { nome, pontos, max, itens, disponivel };
}

// Fecha o resultado: soma pilares, cobertura e semNota.
function fecha(pilares, motivos, extra, minimo = COBERTURA.parcial) {
  const lista = Object.values(pilares);
  const cobertura = lista.reduce((s, p) => s + p.disponivel, 0) / 1000;
  const semNota = cobertura < minimo;
  const score = semNota ? null : Math.round(lista.reduce((s, p) => s + p.pontos, 0));
  if (semNota) motivos.push(`Dados cobrem só ${pct(cobertura)} do modelo: sem nota`);
  else if (cobertura < COBERTURA.completa) motivos.push(`Nota parcial: dados cobrem ${pct(cobertura)} do modelo${extra?.faltam?.length ? `; faltam ${extra.faltam.join(', ')}` : ''}`);
  return { nota: semNota ? null : score / 100, score, pilares, cobertura, semNota, motivos, ...extra };
}

const fracao = (p) => (p.disponivel > 0 ? p.pontos / p.max : null);
const lucrosPos = (l) => {
  const v = (l ?? []).filter(tem);
  return v.length ? v.filter((x) => x > 0).length / v.length : null;
};

// ROEn = média(ROE 12m, ROE do último tri × 4); commodity usa só o ROE de 12m.
export function roeNormalizado(fund) {
  if (fund.tipo === 'commodity') return tem(fund.roe12m) ? fund.roe12m : null;
  const v = [fund.roe12m, tem(fund.roeTri) ? fund.roeTri * 4 : null].filter(tem);
  return v.length ? media(v) : null;
}

export function notaValorAcao({ preco, fund, risco, ctx }) {
  fund = fund ?? {}; risco = risco ?? {}; ctx = ctx ?? {};
  const pvp = tem(preco) && tem(fund.vpa) && fund.vpa > 0 ? preco / fund.vpa : null;
  const roen = roeNormalizado(fund);
  // ponytail: P/VP justo negativo (ROEn < g) vira 0; o MS então é -100%.
  const pvpJusto = roen === null ? null : Math.max(0, (roen - G) / (KE - G));
  const ms = pvp !== null && pvpJusto !== null ? pvpJusto / pvp - 1 : null;
  const precoJusto = pvp !== null && pvpJusto !== null ? r2((preco * pvpJusto) / pvp) : null;
  const tendencia = tem(fund.roeTri) && tem(fund.roe12m) && fund.roe12m > 0 ? (fund.roeTri * 4) / fund.roe12m : null;

  const banco = fund.tipo === 'banco', inc = fund.tipo === 'incorporadora';
  const p3 = pilar('Qualidade', 250, [
    { nome: 'ROE normalizado', max: 100, valor: roen, pior: 0, melhor: 0.25 },
    banco
      ? { nome: 'Inadimplência', max: 75, valor: fund.inadimplencia, pior: 0.06, melhor: 0.01 }
      : { nome: 'ROIC', max: 75, valor: fund.roic, pior: 0, melhor: 0.15 },
    { nome: 'Crescimento da receita', max: 50, valor: fund.crescReceita12m, pior: -0.1, melhor: 0.15 },
    { nome: 'Lucros positivos', max: 25, valor: lucrosPos(fund.lucrosTri), pior: 0.5, melhor: 1 },
  ], fund.estatal ? { nome: 'Estatal', pontos: -15 } : null);

  // Queda relativa: queda 12m do ativo menos a média das quedas do setor e do Ibovespa, ponderada pela qualidade (P3).
  // ponytail: var1m/var3m não entram; só a queda desde a máxima de 12m.
  const refs = [ctx.queda12mSetor, ctx.queda12mIbov].filter(tem);
  const rel = tem(risco.queda12m) && refs.length ? risco.queda12m - media(refs) : null;
  const qual = fracao(p3);
  const p1 = pilar('Desconto', 300, [
    { nome: 'Margem de segurança', max: 150, valor: ms, pior: -0.5, melhor: 0.5 },
    { nome: 'Queda relativa', max: 60, valor: rel !== null && qual !== null ? rel : null, pior: 0, melhor: 0.2, mult: qual ?? 1 },
    { nome: 'Tendência do ROE', max: 90, valor: tendencia, pior: 0.5, melhor: 1.1 },
  ]);

  const ey = tem(preco) && preco > 0 && tem(fund.lpa12m) ? fund.lpa12m / preco : null;
  const p2 = pilar('Solidez e valuation', 250, [
    banco
      ? { nome: 'CET1', max: 100, valor: fund.cet1, pior: 0.09, melhor: 0.14 }
      : inc
        ? { nome: 'Dívida líquida / PL', max: 100, valor: fund.dlPl, pior: 1, melhor: 0 }
        : { nome: 'Dívida líquida / EBITDA', max: 100, valor: fund.dlEbitda, pior: 5, melhor: 0 },
    { nome: 'Liquidez corrente', max: 50, valor: fund.liqCorrente, pior: 0.8, melhor: 2 },
    { nome: 'Earnings yield', max: 100, valor: ey, pior: 0, melhor: KE },
  ]);

  // Sustentabilidade: só avaliada se há payout (sem dividendo analisado, não há o que sustentar).
  // ponytail: usa a fração de trimestres com lucro; refinar com cobertura do caixa se houver dado.
  const p4 = pilar('Proventos', 200, [
    { nome: 'Dividend yield', max: 80, valor: fund.dy, pior: 0, melhor: 0.1 },
    { nome: 'Payout', max: 80, valor: fund.payout, pior: 1, melhor: 0.6 },
    { nome: 'Sustentabilidade', max: 40, valor: tem(fund.payout) ? lucrosPos(fund.lucrosTri) : null, pior: 0.5, melhor: 1 },
  ]);

  const motivos = [];
  if (ms !== null) motivos.push(`P/VP ${num(pvp)} contra justo ${num(pvpJusto)}: margem de segurança ${ms >= 0 ? '+' : ''}${pct(ms)}`);
  if (roen !== null) motivos.push(`ROE normalizado de ${pct(roen)}`);
  if (rel !== null) motivos.push(`Queda 12m ${pct(risco.queda12m)}, ${num(rel * 100, 0)} p.p. acima das referências`);
  if (tendencia !== null && tendencia < 0.7) motivos.push(`ROE do trimestre anualizado em ${pct(tendencia)} do de 12 meses`);
  if (fund.estatal) motivos.push('Estatal: -15 pontos em Qualidade');
  if (tem(fund.dlEbitda) && !banco && !inc && fund.dlEbitda > 3) motivos.push(`Dívida líquida/EBITDA alta: ${num(fund.dlEbitda)}`);

  return fecha({ p1, p2, p3, p4 }, motivos, { pvp, pvpJusto, ms, precoJusto, roen });
}

export function notaValorFii({ preco, fund, risco, ctx }) {
  fund = fund ?? {}; risco = risco ?? {}; ctx = ctx ?? {};
  const pvp = tem(preco) && tem(fund.vpa) && fund.vpa > 0 ? preco / fund.vpa : null;
  const dy = tem(preco) && preco > 0 && tem(fund.rend12m) ? fund.rend12m / preco : null;
  // ffo e rend12m em R$/cota nos últimos 12 meses.
  const cobFfo = tem(fund.ffo) && tem(fund.rend12m) && fund.rend12m > 0 ? fund.ffo / fund.rend12m : null;
  const cdiLiq = tem(ctx.cdi) ? ctx.cdi * FATOR_CDI_LIQ : null;
  const ffoYield = tem(fund.ffo) && tem(preco) && preco > 0 ? fund.ffo / preco : null;
  const rm = (fund.rendMensal ?? []).filter(tem); // mais recente primeiro
  // Tendência: média dos 3 últimos meses ÷ média dos 3 mais antigos.
  const tend = rm.length >= 6 && media(rm.slice(-3)) > 0 ? media(rm.slice(0, 3)) / media(rm.slice(-3)) : null;
  const rel = tem(risco.queda12m) && tem(ctx.queda12mFiis) ? risco.queda12m - ctx.queda12mFiis : null;
  const papel = fund.segmento === 'papel';

  // ponytail: sem FFO (hoje sempre null) o P/VP não é ponderado; com FFO, pesa pela cobertura (máx. 1).
  const p1 = pilar('Desconto', 300, [
    { nome: 'P/VP', max: 150, valor: pvp, pior: 1.15, melhor: 0.8, mult: cobFfo === null ? 1 : clip(cobFfo) },
    { nome: 'Queda relativa', max: 80, valor: rel, pior: 0, melhor: 0.2 },
    { nome: 'Tendência do rendimento', max: 70, valor: tend, pior: 0.8, melhor: 1.05 },
  ]);
  const p2 = pilar('Solidez', 250, [
    { nome: 'Alavancagem', max: 100, valor: fund.alavancagem, pior: 0.5, melhor: 0 },
    { nome: 'Liquidez diária', max: 70, valor: risco.liquidezDiaria, pior: 100000, melhor: 2000000 },
    { nome: 'FFO yield vs CDI líquido', max: 80, valor: cdiLiq === null ? null : ffoYield, pior: (cdiLiq ?? 0) * 0.5, melhor: cdiLiq ?? 1 },
  ]);
  const p3 = pilar('Qualidade', 250, [
    papel
      ? { nome: 'Qualidade do crédito', max: 150, valor: fund.qualidadeCredito, pior: 0, melhor: 1 }
      : { nome: 'Vacância', max: 150, valor: fund.vacancia, pior: 0.3, melhor: 0 },
    { nome: 'Diversificação (nº de imóveis)', max: 100, valor: papel ? null : fund.nImoveis, pior: 1, melhor: 10 },
  ]);
  const p4 = pilar('Rendimento', 200, [
    { nome: 'Dividend yield', max: 100, valor: dy, pior: 0, melhor: 0.12 },
    { nome: 'Cobertura pelo FFO', max: 60, valor: cobFfo, pior: 0.7, melhor: 1.1 },
    { nome: 'Rendimento de venda de imóveis', max: 40, valor: fund.pctVendaImoveis, pior: 0.3, melhor: 0 },
  ]);

  const motivos = [];
  if (pvp !== null) motivos.push(`P/VP ${num(pvp)}${pvp < 1 ? ` (desconto de ${pct(1 - pvp)})` : ''}`);
  if (dy !== null) motivos.push(`Rendimento de ${pct(dy)} em 12 meses`);
  if (rel !== null) motivos.push(`Queda 12m ${num(rel * 100, 0)} p.p. acima da mediana dos FIIs`);
  if (tem(fund.alavancagem)) motivos.push(`Alavancagem de ${pct(fund.alavancagem)}`);
  if (cobFfo !== null && cobFfo < 0.9) motivos.push(`FFO cobre só ${pct(cobFfo)} do rendimento`);

  // Rótulo da nota parcial: itens sem dado, sem repetir os que o pilar de papel nunca teria.
  const faltam = [...new Set(Object.values({ p1, p2, p3, p4 }).flatMap((p) => p.itens.filter((i) => i.valor === null && !(papel && /^Diversifica/.test(i.nome))).map((i) => i.nome)))];
  return fecha({ p1, p2, p3, p4 }, motivos, { pvp, dy, coberturaFfo: cobFfo, faltam }, COBERTURA.parcialFii);
}
