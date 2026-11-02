// Baixa o COTAHIST da B3 dos últimos 5 anos e gera dados/precos/{TICKER}.json e dados/risco.json.
// Uso: node scripts/atualizar-precos.mjs [--ano-fim=2026] [--saida=dados] [--cache=/tmp/cotahist]
// Node 22, sem dependências; o ZIP é lido com `unzip -p` do sistema.
// PREÇO AJUSTADO por desdobramento, grupamento e bonificação com os eventos da B3 (dados/proventos.json); sem
// ajuste por dividendos. Sem o arquivo de proventos, fica o preço bruto do COTAHIST (ver lib/cotahist.mjs).
// Um desdobramento vira um salto falso na série e distorce volatilidade, queda máxima e beta; `saltos` (dias com
// variação >= 30%) em risco.json marca os ativos suspeitos. Ajuste por eventos corporativos ficou fora desta etapa.
import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { parseLinha } from './lib/cotahist.mjs';
import { retornos, volatilidadeAnual, quedaMaxima, beta } from '../js/core/risco.js';
import { limitesFaixa } from '../js/analise/preco.js';

const URL_BASE = 'https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A';
const ANOS = 5;
const PREGOES_ANO = 252;
const TOLERANCIA = 5; // pregões: o papel pode estrear até 5 pregões depois do início da janela e ainda contar como "janela cheia"
const arred = (x, c = 6) => (x == null ? null : Math.round(x * 10 ** c) / 10 ** c);
const iso = (d) => `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6)}`;

/**
 * Ajusta a série por eventos em ações (B3, dados/proventos.json): cada preço com data até a data com do evento é
 * dividido pelo fator (desdobramento 1:2 -> 2; grupamento 10:1 -> 0,1; bonificação de 5% -> 1,05). Centavos inteiros.
 * datas em AAAAMMDD; ev = [[AAAA-MM-DD, fator, rótulo]]. Eventos fora da série não mudam nada.
 */
export function ajustarEventos(datas, precos, ev = []) {
  const validos = ev.map(([d, f]) => [Number(d.replaceAll('-', '')), f]).filter(([d, f]) => f > 0 && d >= datas[0] && d < datas[datas.length - 1]);
  if (!validos.length) return { precos, aplicados: 0 };
  const out = precos.map((p, i) => {
    let fator = 1;
    for (const [d, f] of validos) if (datas[i] <= d) fator *= f;
    return fator === 1 ? p : Math.round(p / fator);
  });
  return { precos: out, aplicados: validos.length };
}

async function baixar(ano, cache) {
  const arq = join(cache, `COTAHIST_A${ano}.ZIP`);
  if (await stat(arq).then((s) => s.size > 0, () => false)) return arq;
  for (let tentativa = 1; ; tentativa++) {
    try {
      const res = await fetch(`${URL_BASE}${ano}.ZIP`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(arq));
      return arq;
    } catch (e) {
      await unlink(arq).catch(() => {});
      if (tentativa === 3) throw new Error(`COTAHIST ${ano}: ${e.message}`);
    }
  }
}

/** Lê um ZIP do COTAHIST e acumula em `acervo`: ticker → { tipo, dias: Map(data → [fechamentoCentavos, volumeReais]) }. */
async function ler(zip, acervo) {
  const unzip = spawn('unzip', ['-p', zip], { stdio: ['ignore', 'pipe', 'inherit'] });
  unzip.stdout.setEncoding('latin1'); // 1 byte = 1 caractere, as colunas são por posição
  const fim = new Promise((ok, erro) => unzip.on('close', (c) => (c === 0 ? ok() : erro(new Error(`unzip saiu com ${c}`)))));
  for await (const linha of createInterface({ input: unzip.stdout, crlfDelay: Infinity })) {
    const r = parseLinha(linha);
    if (!r) continue;
    let a = acervo.get(r.ticker);
    if (!a) acervo.set(r.ticker, (a = { tipo: r.tipo, dias: new Map() }));
    a.dias.set(r.data, [r.fechamento, r.volume]);
  }
  await fim;
}

/** Indicadores de risco de um papel. P e V alinhados ao calendário do BOVA11 (preço repetido nos dias sem negócio; null antes da estreia). */
function indicadores(P, V, ini, mercado, nPregoes) {
  const N = P.length;
  // Últimos n+1 preços, ou null se o papel não tem histórico até o início da janela.
  const janela = (n) => (N - 1 - n < 0 || ini > N - 1 - n + TOLERANCIA ? null : P.slice(N - 1 - n));
  const vol = (n) => { const j = janela(n); return j && arred(volatilidadeAnual(retornos(j))); };
  const queda = (n) => { const j = janela(n); return j && arred(quedaMaxima(j.map((v) => ({ v })))); };
  const variacao = (n) => { const j = janela(n); return j && arred(j[n] / j[0] - 1); };
  const j12 = janela(PREGOES_ANO);
  // ponytail: beta de até 3 anos (mínimo 1 ano) sobre preços repetidos nos dias sem negócio; em papel pouco líquido o beta fica subestimado.
  const ib = Math.max(ini, N - 1 - 3 * PREGOES_ANO);
  const betaOk = N - 1 - ib >= PREGOES_ANO;
  const nLiq = Math.min(60, N - ini);
  const rets = retornos(P.slice(ini));
  return {
    vol1a: vol(PREGOES_ANO),
    vol3a: vol(3 * PREGOES_ANO),
    queda3a: queda(3 * PREGOES_ANO),
    queda5a: queda(N - 1),
    beta: betaOk ? arred(beta(retornos(P.slice(ib)), retornos(mercado.slice(ib)))) : null,
    var1m: variacao(21),
    var3m: variacao(63),
    var12m: variacao(PREGOES_ANO),
    queda12m: j12 && arred(1 - j12[j12.length - 1] / Math.max(...j12)),
    liquidezDiaria: nLiq >= 20 ? Math.round(V.slice(N - nLiq).reduce((s, x) => s + x, 0) / nLiq) : null,
    nPregoes,
    saltos: rets.filter((r) => Math.abs(r) >= 0.3).length,
  };
}

/**
 * Gera dados/precos/*.json e dados/risco.json a partir do COTAHIST dos últimos 5 anos (mais o ano anterior, para fechar a janela de 5 anos).
 * @param {{ anoFim?:number, saida?:string, cache?:string }} opcoes
 */
export async function atualizarPrecos({ anoFim = new Date().getFullYear(), saida = 'dados', cache, eventos = {} } = {}) {
  const proprio = !cache;
  cache ??= await mkdtemp(join(tmpdir(), 'cotahist-'));
  await mkdir(cache, { recursive: true });
  try {
    const acervo = new Map();
    for (let ano = anoFim - ANOS; ano <= anoFim; ano++) await ler(await baixar(ano, cache), acervo);

    // Janela: 5 anos corridos até a última data com negócio do BOVA11 (proxy do Ibovespa).
    const bova = acervo.get('BOVA11');
    if (!bova) throw new Error('BOVA11 ausente do COTAHIST');
    const ultima = Math.max(...bova.dias.keys());
    const corte = ultima - ANOS * 10000; // AAAAMMDD menos 5 anos
    const calendario = [...bova.dias.keys()].filter((d) => d > corte).sort((a, b) => a - b);
    const N = calendario.length;
    const bovaP = calendario.map((d) => bova.dias.get(d)[0] / 100);

    await mkdir(join(saida, 'precos'), { recursive: true });
    const ativos = {}, gerados = new Set();
    let ajustados = 0;
    for (const [ticker, { dias }] of [...acervo].sort(([a], [b]) => a.localeCompare(b))) {
      const datas = [...dias.keys()].filter((d) => d > corte).sort((a, b) => a - b);
      // Descarta papel sem negócio recente (fora de linha) ou com menos de 20 pregões na janela.
      if (datas.length < 20 || datas[datas.length - 1] < calendario[N - 10]) continue;
      // preço ajustado por desdobramento/grupamento/bonificação (B3); sem o arquivo de proventos, fica o bruto
      const aj = ajustarEventos(datas, datas.map((d) => dias.get(d)[0]), eventos[ticker]);
      const centavos = aj.precos;
      if (aj.aplicados) ajustados++;
      await writeFile(join(saida, 'precos', `${ticker}.json`), JSON.stringify({ t: ticker, d: datas, p: centavos }));
      gerados.add(`${ticker}.json`);

      // Alinha ao calendário: repete o último preço nos dias sem negócio.
      const P = new Array(N).fill(null), V = new Array(N).fill(0);
      let k = 0, ultimo = null, ini = N;
      for (let i = 0; i < N; i++) {
        while (k < datas.length && datas[k] <= calendario[i]) { ultimo = centavos[k] / 100; k++; }
        if (datas[k - 1] === calendario[i]) V[i] = dias.get(calendario[i])[1];
        P[i] = ultimo;
        if (ultimo != null && ini === N) ini = i;
      }
      // Preços de corte da faixa barato/normal/caro (centavos), da mesma série de precos/{TICKER}.json: o app compara o
      // preço ao vivo com eles sem baixar o arquivo de preços de cada ativo (tela Descobrir).
      const lim = limitesFaixa(centavos);
      ativos[ticker] = { ...indicadores(P, V, ini, bovaP, datas.length), limBarato: lim?.barato ?? null, limCaro: lim?.caro ?? null };
    }
    for (const f of await readdir(join(saida, 'precos'))) if (f.endsWith('.json') && !gerados.has(f)) await unlink(join(saida, 'precos', f));

    // dataBase não está no contrato original; acrescentada para o app avisar se o dado ficou velho.
    const risco = { versao: 1, geradoEm: new Date().toISOString(), dataBase: iso(ultima), ibov: 'BOVA11', ativos };
    await writeFile(join(saida, 'risco.json'), JSON.stringify(risco));
    return { ativos: gerados.size, ultima, pregoes: N, ajustados };
  } finally {
    if (proprio) await rm(cache, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1];
  const t0 = Date.now();
  const saida = arg('saida') ?? 'dados';
  // eventos em ações de dados/proventos.json (gerado antes, pelo orquestrador); sem ele, preços brutos
  let eventos = {};
  try { eventos = Object.fromEntries(Object.entries(JSON.parse(readFileSync(join(saida, 'proventos.json'), 'utf8')).ativos).map(([t, v]) => [t, v.ev])); } catch { console.warn('aviso: sem dados/proventos.json, preços sem ajuste por eventos'); }
  const r = await atualizarPrecos({ anoFim: arg('ano-fim') ? Number(arg('ano-fim')) : undefined, saida, cache: arg('cache'), eventos });
  console.log(`${r.ativos} ativos (${r.ajustados} ajustados por eventos), ${r.pregoes} pregões até ${r.ultima}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
