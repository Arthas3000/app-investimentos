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
