import test from 'node:test';
import assert from 'node:assert/strict';
import { estadoPregao, diaUtil, textoPregao, fmtQuando, ultimoFechamento } from '../js/data/pregao.js';

// 2026-10-30 é sexta. 13:00 UTC = 10:00 em Brasília.
const at = (iso) => new Date(iso);

test('aberto às 10:00 BRT com cotação recente', () => {
  const now = at('2026-10-30T13:00:00Z');
  assert.equal(estadoPregao({ now, ultimaCotacao: at('2026-10-30T12:58:00Z') }).state, 'aberto');
});
test('fechado antes das 10:00 e às 17:00 em ponto', () => {
  assert.equal(estadoPregao({ now: at('2026-10-30T12:59:00Z') }).state, 'fechado');
  assert.equal(estadoPregao({ now: at('2026-10-30T20:00:00Z') }).state, 'fechado');
});
test('atrasado: aberto mas cotação velha ou ausente', () => {
  const now = at('2026-10-30T15:00:00Z');
  assert.equal(estadoPregao({ now, ultimaCotacao: at('2026-10-30T13:00:00Z') }).state, 'atrasado');
  assert.equal(estadoPregao({ now }).state, 'atrasado');
});
test('fim de semana, feriado e 24/12 fecham', () => {
  assert.equal(diaUtil(at('2026-10-31T15:00:00Z')), false); // sábado
  assert.equal(diaUtil(at('2026-11-02T15:00:00Z'), ['2026-11-02']), false); // feriado
  assert.equal(diaUtil(at('2026-12-24T15:00:00Z')), false);
  assert.equal(diaUtil(at('2026-11-03T15:00:00Z')), true);
});
test('virada de dia usa Brasília, não UTC', () => {
  // 02:00Z de sábado ainda é sexta 23:00 BRT: dia útil, mas fora do horário
  const now = at('2026-10-31T02:00:00Z');
  assert.equal(diaUtil(now), true);
  assert.equal(estadoPregao({ now }).state, 'fechado');
});
test('fechado mostra o fechamento do último pregão, não a hora da consulta', () => {
  const sabado = at('2026-11-01T00:56:00Z'); // sexta 21:56 BRT
  const consultado = at('2026-11-01T00:55:00Z');
  const e = estadoPregao({ now: sabado, ultimaCotacao: consultado });
  assert.equal(e.ultimaCotacao.toISOString(), '2026-10-30T20:00:00.000Z'); // sexta 17:00 BRT
  // fim de semana: volta até a sexta
  assert.equal(ultimoFechamento(at('2026-11-02T12:00:00Z')).toISOString(), '2026-10-30T20:00:00.000Z');
  // segunda feriada: volta até a sexta
  assert.equal(ultimoFechamento(at('2026-11-03T12:00:00Z'), ['2026-11-02']).toISOString(), '2026-10-30T20:00:00.000Z');
  // consulta antiga (antes do fechamento) vence o fechamento
  assert.equal(estadoPregao({ now: sabado, ultimaCotacao: at('2026-10-30T19:30:00Z') }).ultimaCotacao.toISOString(), '2026-10-30T19:30:00.000Z');
});
test('textos', () => {
  assert.equal(textoPregao({ state: 'aberto' }), 'Pregão aberto');
  assert.equal(fmtQuando(at('2026-10-30T20:05:00Z')), '30/10 às 17:05');
  assert.equal(textoPregao({ state: 'fechado', ultimaCotacao: at('2026-10-30T20:05:00Z') }), 'Pregão fechado · último preço de 30/10 às 17:05');
});
