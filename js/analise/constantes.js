// Premissas e limites do modelo de análise. Uma única fonte; mude aqui, não nos módulos.
export const KE = 0.18;          // custo do capital próprio
export const G = 0.05;           // crescimento perpétuo
export const FATOR_CDI_LIQ = 0.85; // CDI líquido = CDI × 0,85
export const COBERTURA = { completa: 0.9, parcial: 0.75, parcialFii: 0.5 }; // abaixo de parcial (parcialFii nos FIIs): sem nota
export const LIMITES = {
  candidata: { nota: 7 },
  cautela: { nota: 6 },
  boa: { p3: 0.7 },
  atencao: { payout: 1, coberturaFfo: 0.9 },
  evitar: { tendenciaRoe: 0.7 },
  fiiPvpDesconto: 0.95,
};
// Faixa barato/normal/caro (preco.js): percentil do preço entre os fechamentos de 5 anos e limites de MS / P/VP.
export const FAIXA_PRECO = {
  percentil: { barato: 25, caro: 75 }, // ≤ barato, ≥ caro (em %)
  minPontos: 60,                       // menos fechamentos que isso: sem sinal de percentil
  ms: 0.15,                            // ação: MS ≥ +15% barato, ≤ −15% caro
  pvp: { barato: 0.95, caro: 1.05 },   // FII: P/VP ≤ 0,95 barato, ≥ 1,05 caro
};
