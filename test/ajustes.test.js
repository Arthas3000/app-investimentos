import test from 'node:test';
import assert from 'node:assert/strict';
import { validarAporte, validarCustos, dataBr } from '../js/views/ajustes.js';
import { PASSOS, passoSeguinte, ladoDoCartao } from '../js/ui/tour.js';
import { FREQUENCIAS, frequenciaValida, temaValido, chavesParaApagar, CHAVES_DADOS, prefs, salvarPrefs } from '../js/data/store.js';

test('frequência: só 30, 60 e 120 s', () => {
  assert.deepEqual(FREQUENCIAS, [30, 60, 120]);
  assert.ok(frequenciaValida(30) && frequenciaValida('120'));
  assert.ok(!frequenciaValida(45) && !frequenciaValida(0) && !frequenciaValida(null) && !frequenciaValida('abc'));
});

test('tema: automático, claro ou escuro', () => {
  assert.ok(['auto', 'claro', 'escuro'].every(temaValido));
  assert.ok(!temaValido('dark') && !temaValido(undefined));
});

test('aporte: valor em reais e dia de 1 a 31', () => {
  const v = validarAporte('R$ 1.500,00', '5');
  assert.deepEqual(v.aporte, { valor: 150000, dia: 5 });
  assert.equal(validarAporte('500', '31').aporte.dia, 31);
  assert.equal(validarAporte('500', '1').ok, true);
  for (const dia of ['0', '32', '', 'x', '1.5', '-3']) assert.equal(validarAporte('500', dia).ok, false, `dia ${dia}`);
  assert.equal(validarAporte('', '5').ok, false);
  assert.equal(validarAporte('R$ 0,00', '5').ok, false);
  assert.equal(validarAporte('', '').erros.length, 2);
});

test('custos: taxa vazia = 0, lote vazio = 1, lote inteiro de 1 a 9999', () => {
  const v = validarCustos('', '');
  assert.deepEqual([v.ok, v.taxa, v.lote, v.textos], [true, 0, 1, { taxa: '', lote: '1' }]);
  const w = validarCustos('R$ 4,90', '100');
  assert.deepEqual([w.taxa, w.lote, w.textos.taxa], [490, 100, 'R$ 4,90']);
  for (const lote of ['0', '1,5', 'a', '-1', '10000']) assert.equal(validarCustos('', lote).ok, false, `lote ${lote}`);
  assert.equal(validarCustos('abc', '1').ok, false);
  assert.match(validarCustos('abc', '0').erros.join(' '), /taxa.*lote/i);
});

test('dataBr', () => assert.equal(dataBr('2026-10-30'), '30/10/2026'));

test('apagar: o token só sai se a pessoa pedir; ajustes não são dados', () => {
  assert.deepEqual(chavesParaApagar(false), CHAVES_DADOS);
  assert.ok(!CHAVES_DADOS.includes('brapi.token') && !CHAVES_DADOS.includes('prefs'));
  assert.ok(chavesParaApagar(true).includes('brapi.token'));
  for (const k of ['carteira.v1', 'aporte.cfg.v1', 'marcos.v1', 'home.analises.v1']) assert.ok(CHAVES_DADOS.includes(k));
});

test('prefs: valor desconhecido volta ao padrão', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    assert.deepEqual([prefs().cotacaoSegundos, prefs().tema], [60, 'auto']);
    salvarPrefs({ cotacaoSegundos: 30, tema: 'escuro' });
    assert.deepEqual([prefs().cotacaoSegundos, prefs().tema], [30, 'escuro']);
    mem.set('prefs', JSON.stringify({ cotacaoSegundos: 7, tema: 'rosa' }));
    assert.deepEqual([prefs().cotacaoSegundos, prefs().tema], [60, 'auto']);
    mem.set('prefs', '{quebrado');
    assert.equal(prefs().cotacaoSegundos, 60);
  } finally { delete globalThis.localStorage; }
});

test('tour guiado: passa por todas as abas, com texto e tela em cada passo', () => {
  assert.ok(PASSOS.length >= 18 && PASSOS.length <= 26, `${PASSOS.length} passos`);
  assert.equal(new Set(PASSOS.map((p) => p.id)).size, PASSOS.length, 'ids únicos');
  const telas = ['home', 'carteira', 'mercado', 'descobrir', 'simulador', 'historico', 'ajustes'];
  for (const p of PASSOS) {
    assert.ok(p.titulo && p.texto, p.id);
    assert.ok(telas.includes(p.rota.slice(1).split('/')[0]), `${p.id}: rota ${p.rota}`);
    assert.ok(p.texto.split(/\s+/).length <= 60, `${p.id}: texto curto`);
    if (p.alvo) assert.ok(p.semAlvo, `${p.id}: diz o que fazer quando o elemento não existe`);
  }
  for (const t of telas) assert.ok(PASSOS.some((p) => p.rota.startsWith(`#${t}`)), `passa por ${t}`);
  assert.ok(!PASSOS[0].alvo && !PASSOS.at(-1).alvo, 'abre e fecha sem destaque');
  assert.doesNotMatch(PASSOS.map((p) => `${p.texto} ${p.semAlvo ?? ''}`).join(' '), /recomendamos|compre agora|venda agora|urgente/i);
  assert.equal(passoSeguinte(0, -1), 0);
  assert.equal(passoSeguinte(0, 1), 1);
  assert.equal(passoSeguinte(PASSOS.length - 1, 1), null);
});

test('tour guiado: cartão fica do lado oposto ao destaque', () => {
  assert.equal(ladoDoCartao({ top: 100, bottom: 200 }, 800), 'base');
  assert.equal(ladoDoCartao({ top: 500, bottom: 650 }, 800), 'topo');
  assert.equal(ladoDoCartao(null, 800), 'base');
});
