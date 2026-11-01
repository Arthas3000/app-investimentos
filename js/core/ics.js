// Lembrete recorrente em iCalendar (RFC 5545). Puro: sem DOM, sem rede, sem Date.now().
// Horário sem fuso (floating): o calendário do aparelho usa a hora local.

const enc = new TextEncoder();
const pad = (n, t = 2) => String(n).padStart(t, '0');

/** Escapa um valor TEXT da RFC 5545: barra invertida, vírgula, ponto e vírgula e quebra de linha. */
export function escaparTexto(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Dobra uma linha em 75 octetos (UTF-8); continuações começam com espaço e nunca quebram um caractere. */
export function dobrar(linha) {
  const partes = [];
  let atual = '', bytes = 0;
  for (const ch of linha) {
    const n = enc.encode(ch).length;
    const max = partes.length ? 74 : 75; // a continuação usa 1 octeto para o espaço inicial
    if (bytes + n > max) { partes.push(atual); atual = ''; bytes = 0; }
    atual += ch;
    bytes += n;
  }
  partes.push(atual);
  return partes.map((p, i) => (i ? ' ' + p : p)).join('\r\n');
}

/** Primeira ocorrência (AAAAMMDD) em ou depois de `inicio`, no dia efetivo do mês. */
function primeiraData(inicio, diaEfetivo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio);
  if (!m) throw new RangeError('inicio deve ser AAAA-MM-DD');
  let [, y, mo, d] = m.map(Number);
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) throw new RangeError('inicio inválido');
  if (d > diaEfetivo) { // passou do dia neste mês: começa no mês seguinte
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
  }
  return `${pad(y, 4)}${pad(mo)}${pad(diaEfetivo)}`;
}

/**
 * Gera o texto .ics de um lembrete mensal.
 * `dtstamp` vem de fora no formato AAAAMMDDTHHMMSSZ (ex.: 20261101T120000Z).
 */
export function gerarIcs({ dia, titulo, descricao = '', hora = '09:00', inicio, uid, dtstamp }) {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new RangeError('dia deve ser 1-31');
  const hm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!hm) throw new RangeError('hora deve ser HH:MM');
  if (!uid || !dtstamp) throw new RangeError('uid e dtstamp são obrigatórios');

  // ponytail: dia 29-31 vira 28 (RRULE sem BYSETPOS/último dia); some em fevereiro e em meses curtos. Add quando o usuário pedir fim de mês.
  const diaEfetivo = Math.min(dia, 28);
  const dtstart = `${primeiraData(inicio, diaEfetivo)}T${hm[1]}${hm[2]}00`;

  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//App Investimentos//Lembrete de aporte//PT-BR',
    'BEGIN:VEVENT',
    `UID:${escaparTexto(uid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `RRULE:FREQ=MONTHLY;BYMONTHDAY=${diaEfetivo}`,
    `SUMMARY:${escaparTexto(titulo)}`,
  ];
  if (descricao) linhas.push(`DESCRIPTION:${escaparTexto(descricao)}`);
  linhas.push(
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escaparTexto('Lembrete: ' + titulo)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}
