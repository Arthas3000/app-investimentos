// Dinheiro em centavos inteiros. Nada aqui usa float para somar ou multiplicar valores.

/** Arredonda "meio para longe do zero", tolerando o erro binário (1.005*100 = 100.49999999999999 -> 101). */
export function arredonda(x) {
  if (!Number.isFinite(x)) throw new RangeError('número inválido');
  const a = Number(Math.abs(x).toPrecision(15)); // corta o ruído binário antes de decidir o meio
  return Math.sign(x) * Math.round(a) || 0; // Math.round em positivo já é "meio para cima" = longe do zero; || 0 evita -0
}

/** Reais (float vindo da API ou do campo) para centavos inteiros. */
export const centavos = (reais) => arredonda(reais * 100);

/** a*b÷c exato (BigInt), arredondado meio para longe do zero. Só aceita inteiros. */
export function mulDiv(a, b, c) {
  for (const n of [a, b, c]) if (!Number.isInteger(n)) throw new RangeError('mulDiv exige inteiros');
  if (c === 0) throw new RangeError('divisão por zero');
  const n = BigInt(a) * BigInt(b), d = BigInt(c);
  let q = n / d; // BigInt trunca em direção ao zero
  const r = n % d;
  const abs = (x) => (x < 0n ? -x : x);
  if (2n * abs(r) >= abs(d)) q += (n < 0n) !== (d < 0n) ? -1n : 1n;
  const out = Number(q);
  if (!Number.isSafeInteger(out)) throw new RangeError('resultado grande demais');
  return out;
}
