// Ajustes locais. O token da brapi mora só aqui (localStorage) e nunca entra no backup.
const K_TOKEN = 'brapi.token';
const K_PREFS = 'prefs';
export const FREQUENCIAS = [30, 60, 120]; // segundos entre atualizações de cotação
export const TEMAS = ['auto', 'claro', 'escuro'];
const DEFAULTS = { cotacaoSegundos: 60, tema: 'auto', tourOferecido: false };

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado: ignora */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

export const token = {
  get: () => ls.get(K_TOKEN) || '',
  set: (t) => (t ? ls.set(K_TOKEN, t.trim()) : ls.del(K_TOKEN)),
};
export const frequenciaValida = (n) => FREQUENCIAS.includes(Number(n));
export const temaValido = (t) => TEMAS.includes(t);

/** Valor desconhecido (arquivo mexido à mão) cai no padrão em vez de quebrar as telas. */
export function prefs() {
  let p;
  try { p = { ...DEFAULTS, ...JSON.parse(ls.get(K_PREFS) || '{}') }; } catch { p = { ...DEFAULTS }; }
  if (!frequenciaValida(p.cotacaoSegundos)) p.cotacaoSegundos = DEFAULTS.cotacaoSegundos;
  if (!temaValido(p.tema)) p.tema = DEFAULTS.tema;
  return p;
}
export function salvarPrefs(p) { ls.set(K_PREFS, JSON.stringify({ ...prefs(), ...p })); }

/** Tema no <html>: 'auto' remove o atributo (vale o do sistema); 'claro'/'escuro' forçam. Chamado cedo, em app.js. */
export function aplicarTema(t = prefs().tema) {
  const el = globalThis.document?.documentElement;
  if (!el) return;
  if (t === 'claro') el.dataset.theme = 'light';
  else if (t === 'escuro') el.dataset.theme = 'dark';
  else delete el.dataset.theme;
}

// ---- apagar tudo ----
/** Chaves do localStorage que são "dados da pessoa". Ajustes (tema, frequência) e o token ficam, salvo se a pessoa pedir. */
export const CHAVES_DADOS = ['carteira.v1', 'aporte.cfg.v1', 'marcos.v1', 'home.analises.v1'];

/** Chaves a remover, conforme a opção do token. */
export const chavesParaApagar = (comToken) => (comToken ? [...CHAVES_DADOS, K_TOKEN] : [...CHAVES_DADOS]);

/** Esvazia o cache de dados (IndexedDB "mercado", o mesmo de data/cache.js). Esvaziar em vez de apagar o banco evita ficar travado por conexões abertas. */
function limparCaches() {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open('mercado', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        try {
          const t = r.result.transaction('kv', 'readwrite');
          t.objectStore('kv').clear();
          t.oncomplete = t.onerror = t.onabort = () => { r.result.close(); ok(); };
        } catch { ok(); }
      };
      r.onerror = () => ok();
    } catch { ok(); }
  });
}

/** Apaga os dados da pessoa e os caches. Quem chamar deve recarregar a página (há cópias em memória). */
export async function apagarTudo({ comToken = false } = {}) {
  for (const k of chavesParaApagar(comToken)) ls.del(k);
  await limparCaches();
}
