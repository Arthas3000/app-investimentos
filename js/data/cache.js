// Cache de dados de mercado em IndexedDB (memória como reserva se o navegador negar).
const DB = 'mercado', STORE = 'kv';
const mem = new Map();

function open() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((ok, fail) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

/** @returns {Promise<{value:any, savedAt:number}|undefined>} */
export async function lerCache(key) {
  try { return await tx('readonly', (s) => s.get(key)); } catch { return mem.get(key); }
}
export async function gravarCache(key, value, savedAt = Date.now()) {
  const rec = { value, savedAt };
  mem.set(key, rec);
  try { await tx('readwrite', (s) => s.put(rec, key)); } catch { /* fica só na memória */ }
}

/**
 * Devolve o cache se ainda estiver dentro do ttl; senão busca. Se a busca falhar, devolve o cache velho
 * com stale=true (o app mostra os últimos dados com o horário) e o erro.
 * @returns {Promise<{data:any, savedAt:number|null, stale:boolean, error:Error|null}>}
 */
export async function comCache(key, ttlMs, buscar, agora = Date.now()) {
  const hit = await lerCache(key);
  if (hit && agora - hit.savedAt < ttlMs) return { data: hit.value, savedAt: hit.savedAt, stale: false, error: null };
  try {
    const data = await buscar();
    await gravarCache(key, data, agora);
    return { data, savedAt: agora, stale: false, error: null };
  } catch (error) {
    return { data: hit?.value ?? null, savedAt: hit?.savedAt ?? null, stale: !!hit, error };
  }
}
