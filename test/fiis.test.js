import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerCsv, ultimaVersao, lerCotahistFii, rendimentosMensais, classificarSegmento, montarFii, serializar } from '../scripts/atualizar-fiis.mjs';

const perto = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const data = (i) => `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`; // i=0 -> 2025-01

test('lerCsv: separador ;, CRLF e colunas vazias', () => {
  const r = lerCsv('A;B;C\r\n1;;3\r\nx;y;z\r\n');
  assert.deepEqual(r, [{ A: '1', B: '', C: '3' }, { A: 'x', B: 'y', C: 'z' }]);
});

test('ultimaVersao: fica a maior versão de cada CNPJ e mês', () => {
  const r = ultimaVersao([
    { CNPJ_Fundo_Classe: 'A', Data_Referencia: '2026-01-01', Versao: '1', v: 'velha' },
    { CNPJ_Fundo_Classe: 'A', Data_Referencia: '2026-01-01', Versao: '2', v: 'nova' },
    { CNPJ_Fundo_Classe: 'A', Data_Referencia: '2026-02-01', Versao: '1', v: 'outro mês' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r.find((l) => l.Data_Referencia === '2026-01-01').v, 'nova');
});

// linha do COTAHIST: tipo 01, BDI nas posições 11-12, ticker 13-24, mercado 25-27, ISIN 231-242
const linha = (bdi, ticker, mercado, isin) => {
  const l = Array(245).fill(' ');
  const poe = (ini, s) => s.split('').forEach((ch, i) => { l[ini - 1 + i] = ch; });
  poe(1, '01'); poe(11, bdi); poe(13, ticker); poe(25, mercado); poe(231, isin);
  return l.join('');
};
test('lerCotahistFii: só FII (BDI 12, à vista, XXXX11) e liga ISIN ao ticker', () => {
  const txt = [
    linha('12', 'HGLG11', '010', 'BRHGLGCTF004'),
    linha('12', 'HGLG11', '010', 'BRHGLGCTF004'), // repetido em outro dia
    linha('02', 'BPAC11', '010', 'BRBPACUNT006'), // unit, não é FII
    linha('12', 'HGLG13', '070', 'BRXXXXCTF000'), // não é à vista: ignorado
    linha('12', 'KNCR12', '010', 'BRKNCRD04M13'), // direito/recibo, não termina em 11
    '00COTAHIST.2026',
  ].join('\n');
  const m = lerCotahistFii(txt);
  assert.deepEqual([...m], [['BRHGLGCTF004', 'HGLG11']]);
});

test('rendimentosMensais: DY × VPA do mês anterior, mais recente primeiro', () => {
  // 14 meses; VPA 100 até o mês 5, depois 200; DY 1% todo mês
  const s = Array.from({ length: 14 }, (_, i) => ({ data: data(i), vpa: i < 6 ? 100 : 200, dy: 0.01, pat: 0 }));
  const { rendMensal, rend12m } = rendimentosMensais(s);
  assert.equal(rendMensal.length, 12);
  perto(rendMensal[0], 2); // último mês: 1% de 200
  perto(rendMensal[6], 2); // mês 7: o VPA do mês anterior (6) já é 200
  perto(rendMensal[7], 1); // mês 6: o VPA do mês anterior (5) ainda é 100
  perto(rendMensal[8], 1);
  perto(rend12m, rendMensal.reduce((a, b) => a + b, 0));
});

test('rendimentosMensais: sem o mês anterior usa VPA/(1+patrimonial)', () => {
  // exatamente 12 meses; no mais antigo, o VPA anterior sai de 110/(1+0.1)=100 -> rendimento 1
  const s = Array.from({ length: 12 }, (_, i) => ({ data: data(i), vpa: 110, dy: 0.01, pat: i === 0 ? 0.1 : 0 }));
  const { rendMensal } = rendimentosMensais(s);
  perto(rendMensal[11], 1);
  perto(rendMensal[0], 1.1);
});

test('rendimentosMensais: mês faltando, DY ausente ou absurdo vira null e rend12m fica null', () => {
  const s = Array.from({ length: 14 }, (_, i) => ({ data: data(i), vpa: 100, dy: 0.01, pat: 0 })).filter((x) => x.data !== '2025-12-01');
  const r = rendimentosMensais(s);
  assert.equal(r.rend12m, null);
  assert.equal(r.rendMensal.filter((x) => x == null).length, 1); // só o mês faltante; o seguinte usa VPA/(1+pat)
  const absurdo = Array.from({ length: 13 }, (_, i) => ({ data: data(i), vpa: 100, dy: i === 12 ? 0.9 : 0.01, pat: 0 }));
  assert.equal(rendimentosMensais(absurdo).rendMensal[0], null);
  const semDy = Array.from({ length: 13 }, (_, i) => ({ data: data(i), vpa: 100, dy: null, pat: 0 }));
  assert.equal(rendimentosMensais(semDy).rend12m, null);
});

test('classificarSegmento: mix de ativos', () => {
  const ap = (o) => ({ Total_Investido: '1000', ...o });
  assert.equal(classificarSegmento(ap({ Direitos_Bens_Imoveis: '900', CRI: '50' })), 'tijolo');
  assert.equal(classificarSegmento(ap({ Direitos_Bens_Imoveis: '100', CRI: '500', LCI_LCA: '200' })), 'papel');
  assert.equal(classificarSegmento(ap({ Direitos_Bens_Imoveis: '400', CRI: '400' })), 'hibrido');
  assert.equal(classificarSegmento(ap({ FII: '900' })), 'hibrido'); // fundo de fundos
  assert.equal(classificarSegmento({ Total_Investido: '' }), null);
  assert.equal(classificarSegmento({ Total_Investido: '0', CRI: '5' }), null);
});

test('montarFii: último mês, alavancagem = passivo / ativo, campos fora do informe = null', () => {
  const comp = Array.from({ length: 13 }, (_, i) => ({
    Data_Referencia: data(i), Valor_Patrimonial_Cotas: '100', Percentual_Dividend_Yield_Mes: '0.01',
    Percentual_Rentabilidade_Patrimonial_Mes: '0', Valor_Ativo: i === 12 ? '2000' : '1000', Cotas_Emitidas: '50',
  }));
  const ap = [{ Data_Referencia: data(12), Total_Passivo: '500', Total_Investido: '1900', Direitos_Bens_Imoveis: '1900' }];
  const f = montarFii({ cnpj: '1', nome: 'X', segmentoCvm: 'Logística', comp, ap });
  assert.equal(f.dataBase, data(12));
  assert.equal(f.vpa, 100);
  assert.equal(f.cotas, 50);
  assert.equal(f.alavancagem, 0.25);
  assert.equal(f.segmento, 'tijolo');
  assert.equal(f.rend12m, 12);
  for (const k of ['ffo', 'vacancia', 'nImoveis', 'pctVendaImoveis', 'qualidadeCredito']) assert.equal(f[k], null);
  // sem ativo_passivo do mês: alavancagem e segmento null; sem VPA: fundo descartado
  const g = montarFii({ cnpj: '1', nome: 'X', comp, ap: [] });
  assert.equal(g.alavancagem, null);
  assert.equal(g.segmento, null);
  assert.equal(montarFii({ cnpj: '1', nome: 'X', comp: [{ Data_Referencia: data(0), Valor_Patrimonial_Cotas: '' }], ap: [] }), null);
});

test('serializar: gera JSON válido, um ativo por linha', () => {
  const t = serializar({ versao: 1, geradoEm: '2026-01-01T00:00:00Z', ativos: { AAAA11: { vpa: 1 }, BBBB11: { vpa: 2 } } });
  assert.deepEqual(JSON.parse(t).ativos, { AAAA11: { vpa: 1 }, BBBB11: { vpa: 2 } });
  assert.equal(t.split('\n').filter((l) => l.includes('"AAAA11"')).length, 1);
});

test('dados/fiis.json gerado segue o contrato', () => {
  const j = JSON.parse(readFileSync(new URL('../dados/fiis.json', import.meta.url), 'utf8'));
  assert.equal(j.versao, 1);
  for (const t of ['HGLG11', 'KNRI11', 'MXRF11']) {
    const f = j.ativos[t];
    assert.ok(f, t);
    assert.ok(['tijolo', 'papel', 'hibrido'].includes(f.segmento));
    assert.ok(f.vpa > 0 && f.cotas > 0 && f.rendMensal.length === 12);
    assert.ok(f.alavancagem >= 0 && f.alavancagem <= 1);
  }
});

// ---------- informe trimestral (imóveis e resultado), com linhas reais do arquivo de 2026 ----------
import { resumoImoveis, fracao } from '../scripts/atualizar-fiis.mjs';

const CAB_IMOVEL = 'CNPJ_Fundo_Classe;Data_Referencia;Versao;Classe;Nome_Imovel;Endereco;Area;Numero_Unidades;Outras_Caracteristicas_Relevantes;Percentual_Vacancia;Percentual_Inadimplencia;Percentual_Receitas_FII;Percentual_Locado;Percentual_Vendido;Percentual_Conclusao_Obras_Realizado;Percentual_Conclusao_Obras_Previsto;Custo_Construcao_Realizado;Custo_Construcao_Previsto;Percentual_Imovel_Total_Investido';

test('fracao: aceita fração; percentual (até 100) vira fração; resto é null', () => {
  assert.equal(fracao('0.103933'), 0.103933);
  assert.equal(fracao('10.5'), 0.105);
  assert.equal(fracao(''), null);
  assert.equal(fracao('250'), null);
  assert.equal(fracao('-0.1'), null);
});

test('resumoImoveis: só o trimestre mais recente e só imóveis para renda acabados', () => {
  const linhas = lerCsv([CAB_IMOVEL,
    '00.332.266/0001-31;2026-03-31;1;Imóveis para renda acabados;Via Parque Shopping - 100%;Av. Ayrton Senna, 3000;56484.83;188;-;0.103933;0.106526;0.97281199403743;;;;;;;',
    '00.332.266/0001-31;2026-06-30;1;Imóveis para renda acabados;Via Parque Shopping - 100%;Av. Ayrton Senna, 3000;56484.83;189;-;0.169062;0.014417;0.967897;;;;;;;',
    '00.332.266/0001-31;2026-06-30;1;Imóveis para renda acabados;Galpão B;Rua X;10000;1;-;0;0;0.032103;;;;;;;',
    '00.332.266/0001-31;2026-06-30;1;Imóveis para venda em construção;Torre C;Rua Y;5000;10;-;;;0;;;;;;;',
  ].join('\n'));
  const r = resumoImoveis(linhas);
  assert.equal(r.dataBase, '2026-06-30');
  assert.equal(r.nImoveis, 2);
  // vacância ponderada pela parcela da receita: 0,169062 × 0,967897 + 0 × 0,032103, sobre 1
  assert.ok(Math.abs(r.vacancia - 0.169062 * 0.967897) < 1e-6);
  assert.ok(Math.abs(r.inadimplencia - 0.014417 * 0.967897) < 1e-6);
});

test('resumoImoveis: sem receita informada pondera pela área; sem imóvel de renda devolve nulls', () => {
  const r = resumoImoveis(lerCsv([CAB_IMOVEL,
    'X;2026-06-30;1;Imóveis para renda acabados;A;-;100;1;-;0.2;;;;;;;;;',
    'X;2026-06-30;1;Imóveis para renda acabados;B;-;300;1;-;0;;;;;;;;;',
  ].join('\n')));
  assert.ok(Math.abs(r.vacancia - 0.05) < 1e-9); // (0,2×100 + 0×300) / 400
  assert.equal(r.inadimplencia, null);
  assert.deepEqual(resumoImoveis([]), { dataBase: null, nImoveis: null, vacancia: null, inadimplencia: null });
});

import { resumoResultado } from '../scripts/atualizar-fiis.mjs';

test('resumoResultado: FFO de 12 meses = 4 trimestres de resultado em caixa menos venda de imóveis (KNRI11 real)', () => {
  // valores do informe trimestral (CVM), 3º tri/2025 a 2º tri/2026; o 1º tri/2025 fica de fora (só os 4 últimos)
  const tri = [
    ['2025-03-31', '84544645.6', '1169690.99'], ['2025-09-30', '85516834.89', '1169690.99'], ['2025-12-31', '99968690.5', '18828956.14'],
    ['2026-03-31', '122984050.41', '48316842.64'], ['2026-06-30', '73978320.6', '1169691.01'],
  ].map(([d, r, v]) => ({ Data_Referencia: d, Resultado_Trimestral_Liquido_Financeiro: r, Receita_Venda_Investimento_Financeiro: v }));
  const r = resumoResultado([...tri.slice(1), tri[0]], 28204047); // ordem não importa
  const soma = 85516834.89 + 99968690.5 + 122984050.41 + 73978320.6, venda = 1169690.99 + 18828956.14 + 48316842.64 + 1169691.01;
  assert.equal(r.dataBaseTri, '2026-06-30');
  assert.ok(Math.abs(r.ffo - (soma - venda) / 28204047) < 1e-4); // ≈ R$ 11,10 por cota
  assert.ok(Math.abs(r.pctVendaImoveis - venda / soma) < 1e-6); // ≈ 18%
});

test('resumoResultado: menos de 4 trimestres seguidos, sem cotas ou resultado <= 0 -> nulls', () => {
  const l = (d, r, v = '') => ({ Data_Referencia: d, Resultado_Trimestral_Liquido_Financeiro: r, Receita_Venda_Investimento_Financeiro: v });
  const nada = { dataBaseTri: null, ffo: null, pctVendaImoveis: null };
  assert.deepEqual(resumoResultado([l('2026-03-31', '10'), l('2026-06-30', '10')], 100), nada);
  assert.deepEqual(resumoResultado([l('2025-06-30', '10'), l('2025-12-31', '10'), l('2026-03-31', '10'), l('2026-06-30', '10')], 100), nada); // falta set/2025
  assert.deepEqual(resumoResultado([l('2025-09-30', '10'), l('2025-12-31', '10'), l('2026-03-31', '10'), l('2026-06-30', '10')], null), nada);
  const neg = resumoResultado([l('2025-09-30', '-10'), l('2025-12-31', '5'), l('2026-03-31', '1'), l('2026-06-30', '1', '3')], 1);
  assert.equal(neg.ffo, -6); // FFO negativo é informação, fica
  assert.equal(neg.pctVendaImoveis, null); // sem resultado positivo não há parcela
});

test('montarFii: rendimento de 12 meses da B3 (valor anunciado por cota) tem prioridade; a CVM fica de reserva', () => {
  const comp = Array.from({ length: 13 }, (_, i) => ({
    Data_Referencia: data(i), Valor_Patrimonial_Cotas: '100', Percentual_Dividend_Yield_Mes: '0.01',
    Percentual_Rentabilidade_Patrimonial_Mes: '0', Valor_Ativo: '1000', Cotas_Emitidas: '50',
  }));
  const comB3 = montarFii({ cnpj: '1', nome: 'X', comp, ap: [], rendB3: 9.72 });
  assert.deepEqual([comB3.rend12m, comB3.rend12mCvm, comB3.fonteRend], [9.72, 12, 'B3']);
  const semB3 = montarFii({ cnpj: '1', nome: 'X', comp, ap: [] });
  assert.deepEqual([semB3.rend12m, semB3.rend12mCvm, semB3.fonteRend], [12, 12, 'CVM']);
  assert.equal(montarFii({ cnpj: '1', nome: 'X', comp, ap: [], rendB3: 0 }).fonteRend, 'CVM'); // zero na B3 = sem anúncio: fica a CVM
});
