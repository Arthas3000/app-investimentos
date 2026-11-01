import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCarteira, CHAVE } from '../js/data/carteira.js';

const memoria = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const agora = () => new Date(2026, 4, 20, 12); // 20/05/2026 local
const nova = () => { const st = memoria(); return { st, c: criarCarteira(st, agora) }; };
const compra = (o = {}) => ({ tipo: 'compra', data: '2026-01-10', ativo: 'petr4', qtd: 10, preco: 3000, ...o });
const ativas = (c) => c.ler().transacoes.filter((t) => !t.excluido);

test('estado vazio na primeira leitura', () => {
  const { c } = nova();
  const s = c.ler();
  assert.deepEqual([s.transacoes, s.acompanhados, s.alvos], [[], [], {}]);
  assert.equal(s.prefs.ocultarValores, false);
});

test('adicionar valida com posicoes.validar e normaliza o código', () => {
  const { c } = nova();
  const r = c.adicionarTransacao(compra());
  assert.equal(r.ok, true);
  assert.equal(c.ler().transacoes[0].ativo, 'PETR4');
  const ruim = c.adicionarTransacao(compra({ qtd: 0 }));
  assert.equal(ruim.ok, false);
  assert.match(ruim.erros[0], /quantidade/);
  const venda = c.adicionarTransacao({ tipo: 'venda', data: '2026-02-01', ativo: 'PETR4', qtd: 11, preco: 3100 });
  assert.equal(venda.ok, false);
  assert.match(venda.erros[0], /maior que as 10 cotas/);
  assert.equal(c.ler().transacoes.length, 1); // inválidas não entram
});

test('venda considera só as cotas até a data da venda', () => {
  const { c } = nova();
  c.adicionarTransacao(compra({ data: '2026-03-01' }));
  assert.equal(c.adicionarTransacao({ tipo: 'venda', data: '2026-02-01', ativo: 'PETR4', qtd: 1, preco: 3000 }).ok, false);
  assert.equal(c.adicionarTransacao({ tipo: 'venda', data: '2026-03-02', ativo: 'PETR4', qtd: 1, preco: 3000 }).ok, true);
});

test('excluir marca excluido (não apaga) e desfazer restaura', () => {
  const { c } = nova();
  const { id } = c.adicionarTransacao(compra());
  const r = c.excluir(id);
  assert.equal(r.ok, true);
  assert.equal(c.ler().transacoes.length, 1);
  assert.equal(c.ler().transacoes[0].excluido, true);
  assert.equal(r.desfazer(), true);
  assert.equal(c.ler().transacoes[0].excluido, undefined);
  assert.equal(c.excluir(999).ok, false);
});

test('corrigir marca a antiga, cria a nova com corrigeId; desfazer volta ao original', () => {
  const { c } = nova();
  const { id } = c.adicionarTransacao(compra());
  const r = c.corrigir(id, { qtd: 20 });
  assert.equal(r.ok, true);
  const ts = c.ler().transacoes;
  assert.equal(ts.length, 2);
  assert.equal(ts[0].excluido, true);
  assert.deepEqual([ts[1].qtd, ts[1].corrigeId, ts[1].excluido], [20, id, undefined]);
  assert.equal(r.desfazer(), true);
  const d = c.ler().transacoes;
  assert.equal(d.length, 2); // nada apagado
  assert.deepEqual(ativas(c).map((t) => t.qtd), [10]);
  // correção inválida não muda nada
  const ruim = c.corrigir(id, { preco: 0 });
  assert.equal(ruim.ok, false);
  assert.equal(c.ler().transacoes.length, 2);
});

test('corrigir uma compra que sustentava uma venda é aceito (a venda vira aviso em calcular().erros)', () => {
  const { c } = nova();
  const { id } = c.adicionarTransacao(compra());
  c.adicionarTransacao({ tipo: 'venda', data: '2026-02-01', ativo: 'PETR4', qtd: 8, preco: 3100 });
  assert.equal(c.corrigir(id, { qtd: 5 }).ok, true); // aceito; posicoes.calcular avisa em `erros`
});

test('acompanhar não duplica, desacompanhar remove', () => {
  const { c } = nova();
  c.acompanhar(' itub4 ');
  const r = c.acompanhar('ITUB4');
  assert.equal(r.jaAcompanhava, true);
  assert.deepEqual(c.ler().acompanhados, [{ ticker: 'ITUB4', desde: '2026-05-20' }]);
  assert.equal(c.acompanhar('').ok, false);
  assert.equal(c.desacompanhar('itub4').ok, true);
  assert.equal(c.desacompanhar('itub4').ok, false);
  assert.deepEqual(c.ler().acompanhados, []);
});

test('alvos: define, valida faixa e remove com null', () => {
  const { c } = nova();
  assert.equal(c.definirAlvo('petr4', 25.5).ok, true);
  assert.deepEqual(c.ler().alvos, { PETR4: 25.5 });
  assert.equal(c.definirAlvo('petr4', 101).ok, false);
  assert.equal(c.definirAlvo('petr4', -1).ok, false);
  assert.deepEqual(c.ler().alvos, { PETR4: 25.5 });
  c.definirAlvo('PETR4', null);
  assert.deepEqual(c.ler().alvos, {});
});

test('persiste no storage e outra instância lê o mesmo estado', () => {
  const { st, c } = nova();
  c.adicionarTransacao(compra());
  assert.ok(st.m.has(CHAVE));
  assert.equal(criarCarteira(st, agora).ler().transacoes.length, 1);
});

test('ouvir avisa a cada mudança e para depois de desligar', () => {
  const { c } = nova();
  let n = 0;
  const parar = c.ouvir(() => n++);
  c.acompanhar('A1'); c.definirAlvo('A1', 10);
  c.definirAlvo('A1', 500); // falhou: não avisa
  assert.equal(n, 2);
  parar(); c.acompanhar('B2');
  assert.equal(n, 2);
});

test('backup: ida e volta preserva tudo', () => {
  const a = nova().c;
  a.adicionarTransacao(compra());
  a.adicionarTransacao({ tipo: 'deposito', data: '2026-01-01', valor: 100000 });
  a.corrigir(1, { qtd: 12 });
  a.acompanhar('ITUB4'); a.definirAlvo('PETR4', 40);
  a.definirMetas({ patrimonio: 100000000 }); a.definirAporte({ valor: 50000, dia: 5 }); a.definirPrefs({ ocultarValores: true });
  const texto = a.exportarBackup();
  const b = nova().c;
  assert.deepEqual(b.importarBackup(texto), { ok: true });
  assert.deepEqual(b.ler(), a.ler());
});

test('backup nunca inclui o token da brapi', () => {
  const { st, c } = nova();
  st.setItem('brapi.token', 'SEGREDO-123');
  c.adicionarTransacao(compra());
  const texto = c.exportarBackup();
  assert.ok(!texto.includes('SEGREDO-123'));
  assert.ok(!/token/i.test(texto));
  // um backup adulterado com token também não o leva para o estado
  const obj = JSON.parse(texto); obj.dados.token = 'X-TOKEN'; obj.dados.prefs.token = 'X-TOKEN';
  c.importarBackup(JSON.stringify(obj));
  assert.ok(!c.exportarBackup().includes('X-TOKEN'));
});

test('importar rejeita lixo com mensagem de ajuda e não sobrescreve o estado', () => {
  const { c } = nova();
  c.adicionarTransacao(compra());
  const antes = JSON.stringify(c.ler());
  const casos = [
    'isso não é json',
    '[]',
    '"texto"',
    JSON.stringify({ dados: { transacoes: 'x' } }),
    JSON.stringify({ dados: { transacoes: [{ id: 1, tipo: 'compra', data: '2026-13-40', ativo: 'A', qtd: 1, preco: 1 }] } }),
    JSON.stringify({ dados: { transacoes: [{ id: 1, tipo: 'deposito', data: '2026-01-01', valor: 1 }, { id: 1, tipo: 'deposito', data: '2026-01-01', valor: 1 }] } }),
    JSON.stringify({ dados: { alvos: { PETR4: 500 } } }),
  ];
  for (const t of casos) {
    const r = c.importarBackup(t);
    assert.equal(r.ok, false, t);
    assert.match(r.mensagem, /Seus dados atuais não foram alterados|Seus dados atuais/, t);
    assert.equal(JSON.stringify(c.ler()), antes, t);
  }
});

test('storage corrompido não quebra: começa vazio', () => {
  const st = memoria(); st.setItem(CHAVE, '{quebrado');
  assert.deepEqual(criarCarteira(st, agora).ler().transacoes, []);
});

test('storage que falha ao gravar avisa sem lançar', () => {
  const c = criarCarteira({ getItem: () => null, setItem() { throw new Error('cheio'); } }, agora);
  assert.equal(c.acompanhar('A1').semArmazenamento, true);
});

test('duas abas no mesmo storage: gravar numa não apaga o que a outra gravou', () => {
  const st = memoria();
  const a = criarCarteira(st, agora), b = criarCarteira(st, agora);
  a.ler(); // aba A aberta, com o estado (vazio) em memória
  b.adicionarTransacao(compra()); // aba B registra uma compra
  assert.equal(a.ler().transacoes.length, 1); // A enxerga a compra sem recarregar
  const c = criarCarteira(st, agora), d = criarCarteira(st, agora);
  c.ler();
  d.adicionarTransacao(compra({ qtd: 5 }));
  c.marcarVisita(); // era isto que regravava o estado velho ao sair da Home
  c.definirAlvo('PETR4', 50);
  const salvo = JSON.parse(st.getItem(CHAVE));
  assert.equal(salvo.transacoes.length, 2);
  assert.equal(salvo.alvos.PETR4, 50);
  assert.ok(salvo.ultimaVisita);
});

test('atualizar() (evento storage de outra aba) avisa os ouvintes', () => {
  const { c } = nova();
  let n = 0; c.ouvir(() => n++);
  c.atualizar();
  assert.equal(n, 1);
});
