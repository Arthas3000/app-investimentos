// Estado do pregão. Função pura: recebe o "agora" e os dados, nunca lê relógio nem rede.

// Ajuste aqui os horários (Brasília, UTC-3 fixo desde 2019). Formato "HH:MM".
export const PREGAO = { abre: '10:00', fecha: '17:00' };
// Dias sem pregão da B3 além dos feriados da BrasilAPI (MM-DD).
export const B3_SEM_PREGAO = ['12-24', '12-31'];
// Cotação mais velha que isso, com pregão aberto, vira "atrasado". A brapi grátis atrasa ~30 min.
export const ATRASO_MAX_MIN = 45;
// ponytail: quarta-feira de cinzas (abre às 13h) não é tratada; adicionar em B3_MEIO_DIA se importar.

const MIN = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Relógio de Brasília como campos UTC de um Date deslocado. */
function brt(date) { return new Date(date.getTime() - 3 * 3600_000); }
const iso = (d) => d.toISOString().slice(0, 10);

/** @param {Set<string>|string[]} feriados datas 'YYYY-MM-DD' */
export function diaUtil(date, feriados = []) {
  const d = brt(date);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (B3_SEM_PREGAO.includes(iso(d).slice(5))) return false;
  return !new Set(feriados).has(iso(d));
}

/**
 * @returns {{state:'aberto'|'fechado'|'atrasado', ultimaCotacao: Date|null}}
 * 'atrasado' = pregão aberto, mas a última cotação recebida é velha demais (ou não existe).
 */
export function estadoPregao({ now, feriados = [], ultimaCotacao = null }) {
  const d = brt(now);
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  const aberto = diaUtil(now, feriados) && min >= MIN(PREGAO.abre) && min < MIN(PREGAO.fecha);
  if (!aberto) {
    // fechado: o último preço é o do fechamento do último pregão, não a hora em que o app consultou
    const fecho = ultimoFechamento(now, feriados);
    return { state: 'fechado', ultimaCotacao: ultimaCotacao && fecho ? new Date(Math.min(ultimaCotacao, fecho)) : ultimaCotacao ?? fecho };
  }
  const velha = !ultimaCotacao || now - ultimaCotacao > ATRASO_MAX_MIN * 60_000;
  return { state: velha ? 'atrasado' : 'aberto', ultimaCotacao };
}

/** Instante do fechamento do último pregão que já terminou (até 10 dias para trás). */
export function ultimoFechamento(now, feriados = []) {
  const [h, m] = PREGAO.fecha.split(':').map(Number);
  for (let i = 0; i < 10; i++) {
    const d = new Date(brt(now).getTime() - i * 86_400_000);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h + 3, m));
    if (t <= now && diaUtil(t, feriados)) return t;
  }
  return null;
}

/** Texto do topo das telas. */
export function textoPregao({ state, ultimaCotacao }) {
  if (state === 'aberto') return 'Pregão aberto';
  const quando = ultimaCotacao ? ` · último preço de ${fmtQuando(ultimaCotacao)}` : '';
  return state === 'atrasado' ? `Pregão aberto · cotação atrasada${quando}` : `Pregão fechado${quando}`;
}

export function fmtQuando(date) {
  const d = brt(date), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} às ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
