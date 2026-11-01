import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarIcs, dobrar, escaparTexto } from '../js/core/ics.js';

const base = { titulo: 'Aporte mensal', hora: '09:00', uid: 'aporte-1@app', dtstamp: '20261101T120000Z' };
const linhasDe = (txt) => txt.split('\r\n');

test('gerarIcs: saída literal com RRULE, escape e VALARM', () => {
  const txt = gerarIcs({ ...base, dia: 15, descricao: 'Revise, depois confirme; sem pressa', inicio: '2026-11-01' });
  assert.equal(txt, [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//App Investimentos//Lembrete de aporte//PT-BR',
    'BEGIN:VEVENT',
    'UID:aporte-1@app',
    'DTSTAMP:20261101T120000Z',
    'DTSTART:20261115T090000',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=15',
    'SUMMARY:Aporte mensal',
    'DESCRIPTION:Revise\\, depois confirme\\; sem pressa',
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Lembrete: Aporte mensal',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n');
});

test('gerarIcs: dia 29-31 vira BYMONTHDAY=28 (limitação marcada com ponytail)', () => {
  const txt = gerarIcs({ ...base, dia: 31, inicio: '2026-11-20' });
  assert.match(txt, /^RRULE:FREQ=MONTHLY;BYMONTHDAY=28$/m);
  assert.match(txt, /^DTSTART:20261128T090000$/m);
});

test('gerarIcs: inicio depois do dia começa no mês seguinte (com virada de ano)', () => {
  const txt = gerarIcs({ ...base, dia: 5, inicio: '2026-12-20' });
  assert.match(txt, /^DTSTART:20270105T090000$/m);
});

test('gerarIcs: valida entradas', () => {
  assert.throws(() => gerarIcs({ ...base, dia: 0, inicio: '2026-11-01' }), RangeError);
  assert.throws(() => gerarIcs({ ...base, dia: 10, hora: '25:00', inicio: '2026-11-01' }), RangeError);
  assert.throws(() => gerarIcs({ ...base, dia: 10, inicio: '2026-02-30' }), RangeError);
});

test('dobrar: linhas de até 75 octetos, desdobra de volta ao original', () => {
  const linha = 'DESCRIPTION:' + 'x'.repeat(100);
  const dobrada = dobrar(linha);
  const partes = linhasDe(dobrada);
  assert.equal(partes[0], 'DESCRIPTION:' + 'x'.repeat(63));
  assert.equal(partes[1], ' ' + 'x'.repeat(37));
  assert.equal(dobrada.replace(/\r\n /g, ''), linha);
});

test('dobrar: não quebra caractere UTF-8 de 2 octetos', () => {
  const linha = 'SUMMARY:' + 'ç'.repeat(50);
  const partes = linhasDe(dobrar(linha));
  for (const p of partes) assert.ok(Buffer.byteLength(p) <= 75, p);
  assert.equal(partes.map((p, i) => (i ? p.slice(1) : p)).join(''), linha);
});

test('escaparTexto: barra, vírgula, ponto e vírgula e quebra', () => {
  assert.equal(escaparTexto('a\\b,c;d\ne'), 'a\\\\b\\,c\\;d\\ne');
});
