import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const sw = readFileSync(join(raiz, 'sw.js'), 'utf8');
const lista = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

function varrer(dir) {
  return readdirSync(join(raiz, dir)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(join(raiz, p)).isDirectory() ? varrer(p) : [relative(raiz, join(raiz, p))];
  });
}
const estaticos = [...varrer('css'), ...varrer('js')].filter((f) => /\.(css|js)$/.test(f));

test('todo css/js está no precache', () => {
  assert.deepEqual(estaticos.filter((f) => !lista.includes(f)), []);
});
test('todo item do precache existe em disco', () => {
  assert.deepEqual(lista.filter((f) => !existsSync(join(raiz, f))), []);
});
test('precache sem duplicatas e com shell + ícones do manifest', () => {
  assert.equal(new Set(lista).size, lista.length);
  const m = JSON.parse(readFileSync(join(raiz, 'manifest.webmanifest'), 'utf8'));
  for (const i of m.icons) assert.ok(lista.includes(i.src), i.src);
  assert.ok(lista.includes('index.html'));
});
test('cache versionado', () => {
  assert.match(sw, /const VERSAO = '[^']+'/);
});
