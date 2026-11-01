// Orquestrador: roda precos, fundamentos e FIIs em sequência e grava dados/meta.json.
// Uso: node scripts/atualizar-dados.mjs
// Tolera falha de UMA fonte: o script filho só grava no fim, então o JSON anterior fica; o erro vai para meta.json.
// Sem diff inútil: se um arquivo só mudou em `geradoEm`, o conteúdo anterior é restaurado (inclusive o meta.json).
// ponytail: filhos em processo separado (CLI existente); só precos e fundamentos usam o cache compartilhado,
//   o de FIIs baixa os próprios ZIPs (CVM FII + COTAHIST mensal), que não se repetem nas outras fontes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const cache = mkdtempSync(join(tmpdir(), 'dados-'));
const lerOuNull = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const semGerado = (t) => t?.replace(/"geradoEm":\s*"[^"]*"/, '"geradoEm":""');

const fontes = [
  { nome: 'precos', url: 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist/', script: 'atualizar-precos.mjs', args: [`--cache=${cache}`], arq: 'risco.json' },
  { nome: 'fundamentos', url: 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/', script: 'atualizar-fundamentos.mjs', args: ['--cache', cache], arq: 'fundamentos.json' },
  { nome: 'fiis', url: 'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/', script: 'atualizar-fiis.mjs', args: [], arq: 'fiis.json' },
];

const resultado = {};
for (const f of fontes) {
  const caminho = join(raiz, 'dados', f.arq), antes = lerOuNull(caminho), t0 = Date.now();
  try {
    execFileSync('node', [join(raiz, 'scripts', f.script), ...f.args], { stdio: 'inherit', cwd: raiz });
    if (antes && semGerado(antes) === semGerado(lerOuNull(caminho))) writeFileSync(caminho, antes);
    resultado[f.nome] = { url: f.url, ok: true };
  } catch (e) {
    resultado[f.nome] = { url: f.url, ok: false, erro: String(e.message).split('\n')[0] };
    console.error(`FALHA em ${f.nome}: ${resultado[f.nome].erro}`);
  }
  console.log(`[${f.nome}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
rmSync(cache, { recursive: true, force: true });

let dataBasePrecos = null;
try { dataBasePrecos = JSON.parse(readFileSync(join(raiz, 'dados', 'risco.json'), 'utf8')).dataBase ?? null; } catch { /* sem risco.json */ }
const metaCaminho = join(raiz, 'dados', 'meta.json'), metaAntes = lerOuNull(metaCaminho);
const meta = { versao: 1, geradoEm: new Date().toISOString(), fontes: resultado, dataBasePrecos };
const texto = JSON.stringify(meta, null, 1) + '\n';
if (!metaAntes || semGerado(metaAntes) !== semGerado(texto)) writeFileSync(metaCaminho, texto);
if (Object.values(resultado).some((r) => !r.ok)) process.exitCode = 1; // job fica vermelho, mas o que deu certo ainda é commitado pelo workflow
