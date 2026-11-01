// Datas como texto 'AAAA-MM-DD' (sem fuso, sem relógio). Quem chama passa o "hoje".
const p2 = (n) => String(n).padStart(2, '0');

export function ehData(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // recusa 2026-02-30
}

export const mesDe = (iso) => iso.slice(0, 7);

/** Soma n meses; se o dia não existe no mês de destino, cai no último dia (31/01 + 1 mês = 28/02). */
export function addMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = t % 12;
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${p2(nm + 1)}-${p2(Math.min(d, ultimo))}`;
}
