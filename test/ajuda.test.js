import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOSSARIO, botaoAjuda } from '../js/ui/ajuda.js';

const CHAVES = 'pvp margemSeguranca dy roe roen payout ffo hhi nEfetivo volatilidade quedaMaxima beta twr xirr nominalReal precoJusto notaValor notaEstabilidade faixaPreco cobertura earningsYield dlEbitda liquidezCorrente roic percentil5a alvoPct teto intensidade lote'.split(' ');

test('todas as chaves existem e têm campos não vazios', () => {
  for (const k of CHAVES) {
    const e = GLOSSARIO[k];
    assert.ok(e, k);
    for (const c of ['termo', 'curto', 'exemplo', 'comoLer']) assert.ok(typeof e[c] === 'string' && e[c].trim(), `${k}.${c}`);
  }
});

test('sem recomendação: "recomend" só com negação', () => {
  for (const [k, e] of Object.entries(GLOSSARIO))
    for (const t of [e.curto, e.exemplo, e.comoLer]) if (/recomend/i.test(t)) assert.match(t, /(n[ãa]o|nunca)[^.]*recomend/i, k);
});

test('botaoAjuda: aria-label, chave escapada e chave desconhecida vazia', () => {
  assert.match(botaoAjuda('pvp'), /aria-label="O que é P\/VP\?"/);
  assert.equal(botaoAjuda('nao-existe'), '');
  GLOSSARIO.__x = { termo: '<b>"x"</b>', curto: 'a', exemplo: 'b', comoLer: 'c' };
  const h = botaoAjuda('__x'); delete GLOSSARIO.__x;
  assert.ok(!h.includes('<b>') && h.includes('&lt;b&gt;&quot;x&quot;'));
});

test('toda chave usada em botaoAjuda(...) nas telas existe no glossário', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../js/views/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const [, k] of src.matchAll(/botaoAjuda\('([^']+)'\)/g)) assert.ok(GLOSSARIO[k], `${f}: ${k}`);
  }
  assert.ok(GLOSSARIO.nominalReal);
});
