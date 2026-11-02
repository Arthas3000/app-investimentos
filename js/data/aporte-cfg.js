// Configuração do aporte e dos custos (textos como a pessoa digitou). Fica em prefs.aporte e numa cópia no
// localStorage: validarEstado (data/carteira.js) só relê ocultarValores e primeirosPassosDispensados ao recarregar.
// Módulo à parte para o registro de compra (ui/registrar.js) ler os custos sem importar a tela de aporte.
import { ler, definirPrefs } from './carteira.js';
import { TARIFAS_B3 } from '../core/custos.js';

export const CHAVE_CFG = 'aporte.cfg.v1';
// taxa = corretagem por ordem (R$); iss em %; tNeg/tLiq/tTta = tarifas da B3 em % (padrão: tabela oficial)
export const CFG0 = { valor: '', teto: '', intensidade: 50, taxa: '', lote: '1', evitar: true, iss: '', ...TARIFAS_B3 };

export function lerCfg() {
  const dentro = ler().prefs.aporte;
  if (dentro && typeof dentro === 'object') return { ...CFG0, ...dentro };
  try { return { ...CFG0, ...JSON.parse(localStorage.getItem(CHAVE_CFG) || '{}') }; } catch { return { ...CFG0 }; }
}

/** Grava por cima do que já existe (campos ausentes ficam como estavam). Devolve false sem armazenamento. */
export function gravarCfg(parcial) {
  const c = { ...lerCfg(), ...parcial };
  const r = definirPrefs({ aporte: c });
  try { localStorage.setItem(CHAVE_CFG, JSON.stringify(c)); } catch { return false; }
  return r?.semArmazenamento !== true;
}
