import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propor, fatores, waterFilling, necessidades } from '../js/core/aporte.js';

const at = (ticker, o = {}) => ({ ticker, valor: 0, alvoPct: 50, preco: 1000, nota: null, ms: null, evitar: false, ...o });
const cotas = (r) => Object.fromEntries(r.linhas.map((l) => [l.ticker, l.cotas]));
const fecha = (r, aporte) => assert.equal(r.total + r.taxas + r.sobra, aporte);

// Valores esperados conferidos à mão / em Python (fractions, divmod), citados em cada teste.

test('3 ativos, pesos iguais, sem preferência', () => {
  // T = 6000+3000 = R$ 9000; alvo 1/3 = 300000; necessidades 200000, 100000, 0 -> 200 e 100 cotas de R$ 10
  const r = propor({ aporte: 300000, ativos: [at('A', { valor: 100000, alvoPct: 100 / 3 }), at('B', { valor: 200000, alvoPct: 100 / 3 }), at('C', { valor: 300000, alvoPct: 100 / 3 })] });
  assert.deepEqual(cotas(r), { A: 200, B: 100, C: 0 });
  assert.equal(r.sobra, 0);
  assert.equal(r.linhas[2].motivo, 'já no alvo');
  assert.match(r.linhas[0].motivo, /^16,7 pontos abaixo do alvo$/); // 33,33 − 16,67
  assert.ok(Math.abs(r.linhas[0].pesoDepois - 100 / 3) < 1e-9);
});

test('intensidade 0 vs 1', () => {
  // C (alvo 0) vale 100000; T = 150000; necessidades A = B = 75000 > aporte 50000.
  const ativos = [at('A', { nota: 8, preco: 100 }), at('B', { nota: 4, preco: 100 }), at('C', { valor: 100000, alvoPct: 0 })];
  // intensidade 0: 25000 cada -> 250 cotas de R$ 1
  assert.deepEqual(cotas(propor({ aporte: 50000, intensidade: 0, ativos })), { A: 250, B: 250, C: 0 });
  // intensidade 1: z = +1/−1, fatores 2 e 0,1. Python: divmod(50000*150000e6, 157500e6) -> 47619 r.. ; 2380 r.. ;
  // 1 centavo de resto vai para B (resto maior) -> 2381. Lotes: 476 (47600) e 23 (2300), troco 100 -> lote extra para B (falta 72700).
  const r = propor({ aporte: 50000, intensidade: 1, ativos });
  assert.deepEqual(cotas(r), { A: 476, B: 24, C: 0 });
  assert.equal(r.sobra, 0);
  assert.equal(r.linhas[0].motivo, '50,0 pontos abaixo do alvo; nota de valor 8,0');
  assert.equal(r.linhas[2].motivo, 'alvo 0%');
});

test('teto limita e o resto vira sobra', () => {
  // T = 100000, teto 30% = 30000 por ativo; 30 cotas cada; lote extra barrado pelo teto
  const r = propor({ aporte: 100000, teto: 30, ativos: [at('A'), at('B')] });
  assert.deepEqual(cotas(r), { A: 30, B: 30 });
  assert.equal(r.sobra, 40000);
});

test('ativo evitar', () => {
  const ativos = [at('A', { evitar: true }), at('B')];
  const r = propor({ aporte: 100000, ativos });
  assert.deepEqual(cotas(r), { A: 0, B: 50 });
  assert.equal(r.sobra, 50000);
  assert.deepEqual(r.avisos, ['A: com sinais de alerta, ficou de fora']);
  assert.deepEqual(cotas(propor({ aporte: 100000, ativos }, { ignorarEvitar: false })), { A: 50, B: 50 });
});

test('ativo sem preço', () => {
  const r = propor({ aporte: 100000, ativos: [at('A', { preco: null }), at('B')] });
  assert.deepEqual(cotas(r), { A: 0, B: 50 });
  assert.deepEqual(r.avisos, ['A: sem preço, ficou de fora']);
  assert.equal(r.linhas[0].preco, null);
});

test('lote 100', () => {
  // 300000 para cada; lote de 100 × R$ 25 = 250000 -> 1 lote cada; troco 100000 não cobre outro lote
  const r = propor({ aporte: 600000, lote: 100, ativos: [at('A', { preco: 2500 }), at('B', { preco: 2500 })] });
  assert.deepEqual(cotas(r), { A: 100, B: 100 });
  assert.equal(r.sobra, 100000);
  // lote por ativo sobrepõe o global: B com lote 1 -> 120 cotas (300000/2500)
  assert.deepEqual(cotas(propor({ aporte: 600000, lote: 100, ativos: [at('A', { preco: 2500 }), at('B', { preco: 2500, lote: 1 })] })), { A: 100, B: 120 });
});

test('taxa por ordem', () => {
  // 50000 cada; piso((50000−500)/1000) = 49; gasto 2×(49000+500) = 99000, troco 1000;
  // lote extra: faltas iguais (1000), necessidades iguais -> ticker A; sem taxa nova (já tem ordem)
  const r = propor({ aporte: 100000, taxaPorOrdem: 500, ativos: [at('A'), at('B')] });
  assert.deepEqual(cotas(r), { A: 50, B: 49 });
  assert.equal(r.taxas, 1000);
  assert.equal(r.sobra, 0);
});

test('aporte maior que as necessidades (alvos somam 80%)', () => {
  const r = propor({ aporte: 100000, ativos: [at('A', { alvoPct: 50 }), at('B', { alvoPct: 30 })] });
  assert.deepEqual(cotas(r), { A: 50, B: 30 });
  assert.equal(r.sobra, 20000);
});

test('carteira vazia, 3 ativos de 1/3', () => {
  // T = 100000; alvo 33333 cada (soma 99999); 33 cotas cada, troco 1000; lote extra para A (empate -> ticker)
  const r = propor({ aporte: 100000, ativos: ['A', 'B', 'C'].map((t) => at(t, { alvoPct: 100 / 3 })) });
  assert.deepEqual(cotas(r), { A: 34, B: 33, C: 33 });
  assert.equal(r.sobra, 0);
  assert.equal(r.linhas[0].pesoAntes, 0);
  assert.equal(r.linhas[0].pesoDepois, 34);
});

test('alvos somando menos de 100 com carteira existente', () => {
  // T = 100000; alvos 40/40: necessidades 30000 e 0 -> A 30 cotas, sobra 10000
  const r = propor({ aporte: 40000, ativos: [at('A', { valor: 10000, alvoPct: 40 }), at('B', { valor: 50000, alvoPct: 40 })] });
  assert.deepEqual(cotas(r), { A: 30, B: 0 });
  assert.equal(r.sobra, 10000);
});

test('peças: necessidades, fatores, waterFilling', () => {
  assert.deepEqual(necessidades([{ alvoPct: 50, valor: 70000 }, { alvoPct: 50, valor: 10000 }], 100000), [0, 40000]);
  assert.deepEqual(fatores([{ nota: 5, ms: null }, { nota: 5, ms: null }], 1), [1, 1]);
  // nota nula = média dos demais -> z 0
  const f = fatores([{ nota: 8, ms: 0.2 }, { nota: 4, ms: null }, { nota: null, ms: 0.5 }], 0.5);
  assert.ok(Math.abs(f[2] - 1) < 1e-12 && f[0] > 1 && f[1] < 1);
  // pesos 1:1:2, caps 10, 100, 100; 100 centavos -> A enche (10), resto 90 em 1:2 -> 30, 60
  const it = [{ ticker: 'A', nec: 10, cap: 10, peso: 1n }, { ticker: 'B', nec: 100, cap: 100, peso: 1n }, { ticker: 'C', nec: 100, cap: 100, peso: 2n }];
  assert.deepEqual(waterFilling(it, 100), [10, 30, 60]);
});

// ---- propriedades (gerador fixo, mulberry32) ----
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('propriedades em 500 casos aleatórios', () => {
  const r = rng(42);
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  for (let k = 0; k < 500; k++) {
    const n = int(1, 6);
    let livre = 100;
    const ativos = Array.from({ length: n }, (_, i) => {
      const alvoPct = i === n - 1 && r() < 0.7 ? livre : int(0, livre);
      livre -= alvoPct;
      return {
        ticker: `T${int(0, 9)}${i}`,
        valor: r() < 0.3 ? 0 : int(0, 5_000_000),
        alvoPct,
        preco: r() < 0.1 ? null : int(1, 20000),
        nota: r() < 0.2 ? null : int(0, 100) / 10,
        ms: r() < 0.3 ? null : (r() - 0.5) * 2,
        evitar: r() < 0.15,
        ...(r() < 0.2 ? { lote: 100 } : {}),
      };
    });
    const entrada = {
      aporte: int(0, 2_000_000), taxaPorOrdem: r() < 0.5 ? 0 : int(0, 1000), lote: r() < 0.2 ? 100 : 1,
      intensidade: r(), teto: r() < 0.4 ? int(5, 60) : null, ativos,
    };
    const opc = { ignorarEvitar: r() < 0.8 };
    const res = propor(entrada, opc);
    fecha(res, entrada.aporte);
    assert.ok(res.sobra >= 0);
    const T = ativos.reduce((t, a) => t + a.valor, 0) + entrada.aporte;
    for (const l of res.linhas) {
      const a = ativos.find((x) => x.ticker === l.ticker);
      assert.ok(Number.isInteger(l.cotas) && l.cotas >= 0);
      assert.equal(l.cotas % (a.lote ?? entrada.lote), 0);
      if (entrada.teto != null && l.cotas) assert.ok(a.valor + l.custo <= (entrada.teto * T) / 100 + 1e-6, `teto ${l.ticker}`);
      if (l.cotas) assert.ok(a.preco && !(a.evitar && opc.ignorarEvitar) && a.alvoPct > 0);
    }
    assert.deepEqual(propor(entrada, opc), res); // determinístico
    const embaralhado = { ...entrada, ativos: [...ativos].sort(() => r() - 0.5) };
    assert.deepEqual(propor(embaralhado, opc), res); // ordem de entrada não importa
  }
});
