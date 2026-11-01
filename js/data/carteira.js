// Estado do usuário (transações, acompanhados, alvos, metas, aporte, preferências) em localStorage, chave `carteira.v1`.
// Nada aqui é apagado de verdade: excluir/corrigir marcam `excluido:true` (e `corrigeId`), então tudo tem desfazer.
// O token da brapi mora em outra chave (data/store.js) e este módulo nunca o lê: por isso nunca vai para o backup.
import { validar, calcular } from '../core/posicoes.js';
import { ehData } from '../core/datas.js';

export const CHAVE = 'carteira.v1';
const TIPOS = ['compra', 'venda', 'transferencia', 'deposito', 'retirada', 'provento'];
const CAMPOS_TRANSACAO = ['id', 'tipo', 'data', 'ativo', 'qtd', 'preco', 'taxas', 'valor', 'excluido', 'corrigeId'];
const AJUDA_BACKUP = 'Use um arquivo gerado por "Exportar backup" neste app. Seus dados atuais não foram alterados.';

export const estadoVazio = () => ({
  transacoes: [], acompanhados: [], alvos: {}, metas: {}, aporte: null,
  prefs: { ocultarValores: false, primeirosPassosDispensados: [] }, ultimaVisita: null,
});

const ticker = (t) => String(t ?? '').trim().toUpperCase();
const ehObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const hojeLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Copia só os campos conhecidos (um backup ou um bug nunca leva campo estranho para dentro do estado). */
function limparTransacao(t) {
  const o = {};
  for (const k of CAMPOS_TRANSACAO) if (t[k] !== undefined && t[k] !== null) o[k] = t[k];
  if (o.ativo) o.ativo = ticker(o.ativo);
  return o;
}

/**
 * Valida e normaliza um estado inteiro (usado ao importar). Devolve { estado } ou { erros: string[] }.
 * Campos ausentes viram o padrão; campos com formato errado são erro (melhor recusar do que importar pela metade).
 */
export function validarEstado(bruto) {
  if (!ehObj(bruto)) return { erros: ['O arquivo não tem o formato de um backup da carteira.'] };
  const e = [], s = estadoVazio();

  if (bruto.transacoes !== undefined && !Array.isArray(bruto.transacoes)) e.push('A lista de movimentações está em formato inesperado.');
  const ids = new Set();
  (Array.isArray(bruto.transacoes) ? bruto.transacoes : []).forEach((t, i) => {
    if (!ehObj(t)) return e.push(`Movimentação ${i + 1}: formato inesperado.`);
    const l = limparTransacao(t);
    if (l.id == null) e.push(`Movimentação ${i + 1}: sem identificador.`);
    else if (ids.has(l.id)) e.push(`Movimentação ${i + 1}: identificador repetido (${l.id}).`);
    else ids.add(l.id);
    // venda maior que a posição é checada no cálculo (vira aviso na tela), aqui só a forma de cada registro
    const falhas = validar(l, Number.MAX_SAFE_INTEGER);
    if (falhas.length) e.push(`Movimentação ${i + 1}: ${falhas[0]}`);
    else s.transacoes.push(l);
  });

  if (bruto.acompanhados !== undefined && !Array.isArray(bruto.acompanhados)) e.push('A lista de ativos acompanhados está em formato inesperado.');
  for (const a of Array.isArray(bruto.acompanhados) ? bruto.acompanhados : []) {
    const tk = ticker(a?.ticker);
    if (!tk) { e.push('Há um ativo acompanhado sem código.'); continue; }
    if (!s.acompanhados.some((x) => x.ticker === tk)) s.acompanhados.push({ ticker: tk, desde: ehData(a.desde) ? a.desde : null });
  }

  if (bruto.alvos !== undefined) {
    if (!ehObj(bruto.alvos)) e.push('Os alvos estão em formato inesperado.');
    else for (const [k, v] of Object.entries(bruto.alvos)) {
      if (typeof v === 'number' && v >= 0 && v <= 100) s.alvos[ticker(k)] = v;
      else e.push(`Alvo de ${k}: use um percentual entre 0 e 100.`);
    }
  }

  if (ehObj(bruto.metas)) {
    for (const k of ['patrimonio', 'rendaMensal', 'prazoAnos']) {
      const v = bruto.metas[k];
      if (v == null) continue;
      if (Number.isSafeInteger(v) && v > 0) s.metas[k] = v; else e.push(`Meta "${k}" inválida.`);
    }
  } else if (bruto.metas != null) e.push('As metas estão em formato inesperado.');

  if (ehObj(bruto.aporte)) {
    const { valor, dia } = bruto.aporte;
    if (Number.isSafeInteger(valor) && valor > 0 && Number.isInteger(dia) && dia >= 1 && dia <= 31) s.aporte = { valor, dia };
    else e.push('O aporte mensal está inválido (valor em centavos e dia de 1 a 31).');
  } else if (bruto.aporte != null) e.push('O aporte mensal está em formato inesperado.');

  if (ehObj(bruto.prefs)) {
    s.prefs.ocultarValores = bruto.prefs.ocultarValores === true;
    if (Array.isArray(bruto.prefs.primeirosPassosDispensados)) s.prefs.primeirosPassosDispensados = bruto.prefs.primeirosPassosDispensados.filter((x) => typeof x === 'string');
  }
  s.ultimaVisita = typeof bruto.ultimaVisita === 'string' ? bruto.ultimaVisita : null;
  return e.length ? { erros: e } : { estado: s };
}

/**
 * Cria a carteira sobre um storage tipo localStorage (getItem/setItem). Em teste, passe um objeto simples.
 * `agora` injeta o relógio (devolve Date).
 */
export function criarCarteira(storage, agora = () => new Date()) {
  const ouvintes = new Set();
  const avisar = () => ouvintes.forEach((f) => { try { f(); } catch { /* ouvinte quebrado não derruba os outros */ } });
  // Cache só enquanto o texto salvo não mudou: outra aba que gravou muda o texto e o estado é relido (nada de regravar estado velho).
  let cache = null, visto = null;
  const bruto = () => { try { return storage.getItem(CHAVE); } catch { return null; } };

  function ler() {
    const raw = bruto();
    if (cache && raw === visto) return structuredClone(cache);
    let obj = null;
    try { obj = JSON.parse(raw ?? 'null'); } catch { /* corrompido: começa vazio, mas só sobrescreve se a pessoa salvar */ }
    cache = validarEstado(obj ?? {}).estado ?? estadoVazio();
    visto = raw;
    return structuredClone(cache);
  }
  function salvar(estado) {
    cache = structuredClone(estado);
    const raw = JSON.stringify(cache);
    try { storage.setItem(CHAVE, raw); visto = raw; } catch { visto = bruto(); return false; } // cheio/modo privado: a tela decide o que dizer; o estado segue só em memória
    avisar();
    return true;
  }
  const mudar = (fn) => { // só grava quando a operação deu certo
    const s = ler(), r = fn(s);
    return r.ok === false || salvar(s) ? r : { ...r, semArmazenamento: true };
  };

  /** Cotas do ativo na data (reprocessa só até ela), ignorando a transação `ignorar`. */
  const qtdEm = (s, ativo, data, ignorar) =>
    calcular(s.transacoes.filter((t) => t.id !== ignorar && t.data <= data)).posicoes.get(ativo)?.qtd ?? 0;
  const proximoId = (s) => s.transacoes.reduce((m, t) => Math.max(m, Number.isInteger(t.id) ? t.id : 0), 0) + 1;

  function adicionarTransacao(entrada) {
    return mudar((s) => {
      const t = limparTransacao(entrada);
      delete t.excluido; delete t.corrigeId;
      const erros = validar(t, qtdEm(s, t.ativo, t.data));
      if (erros.length) return { ok: false, erros };
      t.id = proximoId(s);
      s.transacoes.push(t);
      return { ok: true, id: t.id, desfazer: () => excluir(t.id).ok };
    });
  }

  /** Marca como excluída (nunca apaga). Devolve { ok, desfazer }. */
  function excluir(id) {
    return mudar((s) => {
      const t = s.transacoes.find((x) => x.id === id);
      if (!t || t.excluido) return { ok: false, erros: ['Movimentação não encontrada.'] };
      t.excluido = true;
      return { ok: true, desfazer: () => mudar((s2) => { const x = s2.transacoes.find((y) => y.id === id); if (x) delete x.excluido; return { ok: !!x }; }).ok };
    });
  }

  /** Corrigir = marcar a antiga como excluída e criar a nova com `corrigeId`. Desfazer restaura a antiga e marca a nova como excluída. */
  function corrigir(id, mudancas) {
    return mudar((s) => {
      const antiga = s.transacoes.find((x) => x.id === id);
      if (!antiga || antiga.excluido) return { ok: false, erros: ['Movimentação não encontrada.'] };
      const nova = { ...limparTransacao(antiga), ...limparTransacao(mudancas ?? {}) };
      delete nova.excluido;
      const erros = validar(nova, qtdEm(s, nova.ativo, nova.data, id));
      if (erros.length) return { ok: false, erros };
      nova.id = proximoId(s); nova.corrigeId = id;
      antiga.excluido = true;
      s.transacoes.push(nova);
      return {
        ok: true, id: nova.id,
        desfazer: () => mudar((s2) => {
          const a = s2.transacoes.find((x) => x.id === id), n = s2.transacoes.find((x) => x.id === nova.id);
          if (!a || !n) return { ok: false };
          delete a.excluido; n.excluido = true;
          return { ok: true };
        }).ok,
      };
    });
  }

  function acompanhar(codigo) {
    const tk = ticker(codigo);
    if (!tk) return { ok: false, erros: ['Informe o código do ativo.'] };
    return mudar((s) => {
      if (s.acompanhados.some((a) => a.ticker === tk)) return { ok: true, jaAcompanhava: true };
      s.acompanhados.push({ ticker: tk, desde: hojeLocal(agora()) });
      return { ok: true };
    });
  }
  const desacompanhar = (codigo) => mudar((s) => {
    const tk = ticker(codigo), n = s.acompanhados.length;
    s.acompanhados = s.acompanhados.filter((a) => a.ticker !== tk);
    return { ok: s.acompanhados.length < n };
  });

  /** pct de 0 a 100; null remove o alvo. */
  function definirAlvo(codigo, pct) {
    const tk = ticker(codigo);
    if (!tk) return { ok: false, erros: ['Informe o código do ativo.'] };
    if (pct != null && !(typeof pct === 'number' && pct >= 0 && pct <= 100)) return { ok: false, erros: ['O alvo precisa ser um percentual entre 0 e 100.'] };
    return mudar((s) => { if (pct == null) delete s.alvos[tk]; else s.alvos[tk] = pct; return { ok: true }; });
  }

  const definirMetas = (m) => mudar((s) => { s.metas = { ...s.metas, ...m }; for (const k of Object.keys(s.metas)) if (s.metas[k] == null) delete s.metas[k]; return { ok: true }; });
  const definirAporte = (a) => mudar((s) => { s.aporte = a ? { valor: a.valor, dia: a.dia } : null; return { ok: true }; });
  const definirPrefs = (p) => mudar((s) => { s.prefs = { ...s.prefs, ...p }; return { ok: true }; });
  const marcarVisita = () => mudar((s) => { s.ultimaVisita = agora().toISOString(); return { ok: true }; });

  /** JSON do estado. Só os campos do estado entram: o token da brapi vive em outra chave e não passa por aqui. */
  function exportarBackup() {
    return JSON.stringify({ formato: 'carteira-backup', versao: 1, exportadoEm: agora().toISOString(), dados: ler() }, null, 2);
  }

  /** Valida tudo antes de gravar; qualquer problema = nada muda. @returns {{ok:true}|{ok:false, mensagem:string, erros:string[]}} */
  function importarBackup(texto) {
    let obj;
    try { obj = JSON.parse(texto); } catch {
      return { ok: false, erros: [], mensagem: `Este arquivo não é um JSON válido. ${AJUDA_BACKUP}` };
    }
    const v = validarEstado(ehObj(obj) && 'dados' in obj ? obj.dados : obj);
    if (v.erros) return { ok: false, erros: v.erros, mensagem: `Não foi possível importar: ${v.erros.slice(0, 3).join(' ')} ${AJUDA_BACKUP}` };
    return salvar(v.estado) ? { ok: true } : { ok: false, erros: [], mensagem: 'Não foi possível gravar neste navegador (armazenamento cheio ou bloqueado). Seus dados atuais foram mantidos.' };
  }

  /** Avisa as telas quando o estado muda. Devolve a função para parar de ouvir. */
  function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

  return { ler, salvar, adicionarTransacao, corrigir, excluir, acompanhar, desacompanhar, definirAlvo, definirMetas, definirAporte, definirPrefs, marcarVisita, exportarBackup, importarBackup, ouvir, atualizar: avisar };
}

// ---- instância do app (localStorage do navegador; criada na primeira chamada para o módulo carregar também em node) ----
let padrao = null;
const c = () => (padrao ??= criarCarteira(globalThis.localStorage ?? { getItem: () => null, setItem: () => { throw new Error('sem storage'); } }));
export const ler = () => c().ler();
export const salvar = (e) => c().salvar(e);
export const adicionarTransacao = (t) => c().adicionarTransacao(t);
export const corrigir = (id, m) => c().corrigir(id, m);
export const excluir = (id) => c().excluir(id);
export const acompanhar = (t) => c().acompanhar(t);
export const desacompanhar = (t) => c().desacompanhar(t);
export const definirAlvo = (t, p) => c().definirAlvo(t, p);
export const definirMetas = (m) => c().definirMetas(m);
export const definirAporte = (a) => c().definirAporte(a);
export const definirPrefs = (p) => c().definirPrefs(p);
export const marcarVisita = () => c().marcarVisita();
export const exportarBackup = () => c().exportarBackup();
export const importarBackup = (t) => c().importarBackup(t);
export const ouvir = (fn) => c().ouvir(fn);
// outra aba/janela gravou: as telas abertas aqui se atualizam
globalThis.addEventListener?.('storage', (e) => { if (e.key === CHAVE || e.key === null) c().atualizar(); });
