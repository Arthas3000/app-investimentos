// Service worker do app. COMO ATUALIZAR: a cada mudança em qualquer arquivo do app shell (index.html, css/, js/,
// ícones, manifest) suba o número de VERSAO abaixo (ex.: v1 -> v2). Isso cria um cache novo, o `activate` apaga os
// antigos e o app passa a usar os arquivos novos. Arquivo novo/removido em css/ ou js/ também precisa entrar/sair
// de PRECACHE (o `npm test` falha se a lista e o disco divergirem). Dados (dados/*.json, dados/precos/*) não
// dependem da versão: são atualizados sozinhos em segundo plano.
const VERSAO = 'v7';
const CACHE = `aportes-${VERSAO}`;

const PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'favicon.ico',
  'favicon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'css/ajuda.css',
  'css/ajustes.css',
  'css/aporte.css',
  'css/app.css',
  'css/carteira.css',
  'css/components.css',
  'css/descobrir.css',
  'css/historico.css',
  'css/home.css',
  'css/seumes.css',
  'css/simulador.css',
  'css/tokens.css',
  'js/analise/analisar.js',
  'js/analise/constantes.js',
  'js/analise/estabilidade.js',
  'js/analise/indicacao.js',
  'js/analise/preco.js',
  'js/analise/valor.js',
  'js/app.js',
  'js/core/aporte-entrada.js',
  'js/core/aporte.js',
  'js/core/carteira-calc.js',
  'js/core/carteira-risco.js',
  'js/core/datas.js',
  'js/core/descobrir.js',
  'js/core/historico-filtro.js',
  'js/core/ics.js',
  'js/core/metas.js',
  'js/core/money.js',
  'js/core/posicoes.js',
  'js/core/proventos.js',
  'js/core/risco.js',
  'js/core/simulador.js',
  'js/core/simulador-entrada.js',
  'js/core/seu-mes.js',
  'js/data/bcb.js',
  'js/data/brapi.js',
  'js/data/cache.js',
  'js/data/carteira.js',
  'js/data/dados.js',
  'js/data/feriados.js',
  'js/data/pregao.js',
  'js/data/store.js',
  'js/pwa.js',
  'js/ui/ajuda.js',
  'js/ui/icons.js',
  'js/ui/kit.js',
  'js/ui/tour.js',
  'js/ui/registrar.js',
  'js/views/aporte.js',
  'js/views/ajustes.js',
  'js/views/carteira.js',
  'js/views/descobrir.js',
  'js/views/historico.js',
  'js/views/home.js',
  'js/views/mercado.js',
  'js/views/seumes.js',
  'js/views/simulador.js',
];

const OFFLINE_HTML = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Sem conexão</title><body style="font:16px system-ui;margin:2rem;line-height:1.5"><h1>Sem conexão</h1>'
  + '<p>Não foi possível abrir o app agora. Conecte-se à internet e tente de novo; seus dados salvos neste aparelho continuam guardados.</p></body></html>';

const url = (p) => new URL(p, self.registration.scope).href;

self.addEventListener('install', (e) => {
  // ponytail: addAll falha se 1 arquivo faltar (instala tudo ou nada); cache: 'reload' ignora o cache HTTP
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(PRECACHE.map((p) => new Request(url(p), { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('aportes-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// busca na rede e guarda a cópia (só respostas ok)
async function atualizar(req) {
  const res = await fetch(req, { cache: 'no-cache' });
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  // APIs externas (api.bcb.gov.br, brapi.dev) e qualquer outra origem: direto à rede, o app tem cache próprio
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  const rel = u.pathname.slice(new URL(self.registration.scope).pathname.length);

  const navegacao = req.mode === 'navigate';
  const shell = navegacao || PRECACHE.includes(rel);
  const dados = /^dados\/(?:[^/]+\.json|precos\/.+)$/.test(rel);
  if (!shell && !dados) return;

  e.respondWith((async () => {
    const chave = navegacao ? url('index.html') : req;
    const emCache = await caches.match(chave, { ignoreSearch: navegacao });
    // shell: cache-first com atualização em segundo plano; dados: stale-while-revalidate (mesma mecânica)
    const rede = atualizar(chave).catch(() => null);
    if (emCache) { e.waitUntil(rede); return emCache; }
    const res = await rede;
    if (res) return res;
    return navegacao ? new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      : Response.error();
  })());
});
