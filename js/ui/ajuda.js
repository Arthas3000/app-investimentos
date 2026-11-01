// Glossário e botão "?". Texto educacional: explica o número, nunca diz o que fazer.
// Fórmulas conferidas com o README.md e js/analise/constantes.js.
const G = (termo, curto, exemplo, comoLer) => ({ termo, curto, exemplo, comoLer });

export const GLOSSARIO = {
  pvp: G('P/VP', 'Compara o preço da ação ou da cota com o valor patrimonial por ação (VPA), que é o patrimônio líquido dividido pelo número de ações.',
    'Preço de R$ 20 e VPA de R$ 25 dão P/VP de 0,80.',
    'Abaixo de 1, o mercado paga menos do que o patrimônio contábil; acima de 1, paga mais. Sozinho não diz se é bom ou ruim: depende da lucratividade da empresa.'),
  margemSeguranca: G('Margem de segurança', 'Distância entre o preço atual e o preço justo calculado pelo app: P/VP justo dividido pelo P/VP atual, menos 1.',
    'P/VP justo de 1,20 e P/VP atual de 1,00 dão margem de +20%.',
    'Positiva: o preço está abaixo do justo do modelo. Negativa: está acima. O justo depende das premissas do app (Ke 18%, g 5%) e pode estar errado.'),
  dy: G('Dividend yield (DY)', 'Quanto a ação ou o fundo pagou de proventos nos últimos 12 meses, em relação ao preço atual.',
    'R$ 1,20 pagos em 12 meses, com preço de R$ 20, dão DY de 6%.',
    'Mostra o passado, não uma promessa. Um DY muito alto pode vir de um preço que caiu ou de um pagamento que não vai se repetir.'),
  roe: G('ROE', 'Retorno sobre o patrimônio: lucro dos últimos 12 meses dividido pela média do patrimônio líquido da controladora.',
    'Lucro de R$ 150 milhões sobre patrimônio médio de R$ 1 bilhão dão ROE de 15%.',
    'Mede quanto a empresa ganha para cada real de patrimônio. Compare com empresas do mesmo setor e olhe se se mantém ao longo dos anos.'),
  roen: G('ROE normalizado (ROEn)', 'Média entre o ROE de 12 meses e o ROE do último trimestre multiplicado por 4. Suaviza um trimestre fora do comum.',
    'ROE de 12 meses de 14% e ROE do trimestre de 3% (x4 = 12%) dão ROEn de 13%.',
    'É a base do P/VP justo do app. Para commodities, usa só o ROE de 12 meses.'),
  payout: G('Payout', 'Parte do lucro que a empresa distribuiu como proventos.',
    'Lucro de R$ 100 milhões e R$ 60 milhões distribuídos dão payout de 60%.',
    'Acima de 100%, a empresa pagou mais do que lucrou, o que dificilmente se sustenta por muito tempo. Abaixo, guardou parte do lucro.'),
  ffo: G('FFO', 'Fluxo de caixa de um fundo imobiliário: resultado do fundo sem os efeitos contábeis que não saem do caixa.',
    'FFO de R$ 1,10 por cota e rendimento de R$ 1,00 por cota: o caixa cobriu o pagamento.',
    'Comparado com o rendimento pago, mostra se o fundo gerou caixa para sustentar a distribuição. A CVM não publica o FFO no informe mensal; por isso muitas vezes aparece vazio.'),
  hhi: G('HHI', 'Índice de concentração da carteira: soma do quadrado do peso de cada ativo, com os pesos em pontos percentuais.',
    'Dois ativos com 50% cada: 50² + 50² = 5.000. Dez ativos com 10% cada: 1.000.',
    'Vai de perto de 0 (muito espalhada) a 10.000 (um ativo só). Quanto maior, mais a carteira depende de poucos ativos.'),
  nEfetivo: G('Nº efetivo de ativos', 'Quantos ativos de pesos iguais teriam a mesma concentração da sua carteira: 10.000 dividido pelo HHI.',
    'HHI de 2.500 dá 4 ativos efetivos, mesmo que você tenha 8 na carteira.',
    'Se for bem menor que o número real de ativos, poucos ativos pesam quase tudo.'),
  volatilidade: G('Volatilidade', 'Quanto o preço oscila: desvio padrão dos retornos diários, convertido em base anual (multiplicado por raiz de 252).',
    'Volatilidade de 30% ao ano indica oscilações típicas de uns 30% para cima ou para baixo em um ano.',
    'Maior volatilidade significa preço mais instável, não necessariamente pior. Olhe junto da queda máxima.'),
  quedaMaxima: G('Queda máxima', 'A maior queda do preço, do topo até o fundo seguinte, dentro do período analisado.',
    'Preço foi de R$ 40 a R$ 24 antes de se recuperar: queda máxima de 40%.',
    'Mostra o pior tombo que já houve no período. Não é um limite: pode ser pior no futuro.'),
  beta: G('Beta', 'Sensibilidade do ativo ao mercado: covariância com o Ibovespa dividida pela variância do Ibovespa. O app aproxima o Ibovespa por BOVA11.',
    'Beta de 1,3: quando o mercado varia 10%, o ativo costuma variar cerca de 13%.',
    'Perto de 1, acompanha o mercado. Acima, oscila mais; abaixo, menos. Descreve o passado.'),
  twr: G('Retorno ponderado pelo tempo (TWR)', 'Rentabilidade da carteira que não depende de quando você aportou ou sacou dinheiro; mede só o desempenho dos ativos.',
    'Carteira que subiu 10% e depois 5% tem TWR de 1,10 x 1,05 - 1 = 15,5%.',
    'Serve para comparar com um índice. Não mostra quanto o seu dinheiro rendeu, pois ignora o momento dos aportes.'),
  xirr: G('Retorno do seu dinheiro (XIRR)', 'Taxa anual que considera as datas e os valores de cada aporte e saque, mais o valor final da carteira.',
    'Aportou R$ 1.000 e hoje, um ano depois, vale R$ 1.100: XIRR de 10% ao ano.',
    'Responde quanto o seu dinheiro rendeu, dado quando você o colocou. Em períodos curtos, a taxa anualizada pode parecer exagerada.'),
  nominalReal: G('Nominal e real', 'Nominal é o retorno em reais, sem tirar a inflação. Real desconta o IPCA do mesmo período: (1 + nominal) dividido por (1 + IPCA), menos 1.',
    'Retorno nominal de 10% num período em que o IPCA foi de 4% dá retorno real de 1,10 / 1,04 - 1 = 5,8%.',
    'O real mostra quanto o poder de compra mudou. Se o IPCA do período não estiver disponível, o app mostra só o nominal.'),
  precoJusto: G('Preço justo', 'Preço que a ação teria se negociasse no P/VP justo do modelo: preço atual x P/VP justo dividido pelo P/VP atual.',
    'Preço de R$ 20, P/VP atual de 1,0 e P/VP justo de 1,2 dão preço justo de R$ 24.',
    'É uma estimativa baseada em premissas (Ke 18%, g 5%), não uma previsão. Mude as premissas e o valor muda.'),
  notaValor: G('Nota de valor', 'Nota de 0 a 10 que soma quatro grupos: desconto, solidez, qualidade e proventos. Itens sem dado têm o peso redistribuído no grupo.',
    'Pontos somam 650 de 1.000: nota 6,5.',
    'Resume quanto os números atuais são favoráveis. Veja a cobertura de dados e os motivos listados antes de confiar na nota.'),
  notaEstabilidade: G('Nota de estabilidade', 'Nota de 0 a 10 que reúne volatilidade, queda máxima, beta, estabilidade do lucro e liquidez diária.',
    'Nota 8 indica preço e lucro relativamente estáveis em relação às faixas usadas pelo app.',
    'Nota alta significa menos sobressaltos no passado. Não protege contra perdas futuras.'),
  faixaPreco: G('Faixa de preço (barato, normal, caro)', 'Compara o preço atual com a história do próprio ativo: posição entre os últimos 5 anos, mais margem de segurança (ações) ou P/VP (fundos).',
    'Preço no 20º percentil e margem de +20% resultam em faixa "barato".',
    'Descreve onde o preço está hoje em relação ao passado dele. Não prevê a direção do preço nem diz o que fazer.'),
  cobertura: G('Cobertura de dados', 'Fração dos itens da nota que têm dado disponível. Com 90% ou mais a nota é completa; de 75% a 90%, parcial; abaixo, fica sem nota.',
    'Nove de dez itens com dado: cobertura de 90%, nota completa.',
    'Quanto menor, mais a nota depende do que faltou. Nos fundos imobiliários, a nota parcial vale a partir de 50%.'),
  earningsYield: G('Earnings yield', 'Lucro por ação dos últimos 12 meses dividido pelo preço. É o inverso do P/L.',
    'Lucro de R$ 2 por ação e preço de R$ 20 dão earnings yield de 10%.',
    'O app compara com o custo do capital próprio (Ke, 18%). Quanto mais alto, mais lucro para cada real pago.'),
  dlEbitda: G('Dívida líquida / EBITDA', 'Quantos anos de EBITDA seriam necessários para quitar a dívida líquida. Valores aproximados a partir das demonstrações.',
    'Dívida líquida de R$ 300 milhões e EBITDA de R$ 100 milhões dão 3,0.',
    'Quanto menor, mais folga. Negativo quer dizer caixa maior que a dívida. Setores diferentes toleram níveis diferentes.'),
  liquidezCorrente: G('Liquidez corrente', 'Ativo circulante dividido pelo passivo circulante: o que a empresa tem a receber em até 12 meses contra o que tem a pagar no mesmo prazo.',
    'R$ 150 de ativo circulante e R$ 100 de passivo circulante dão 1,5.',
    'Acima de 1, os recursos de curto prazo cobrem as contas de curto prazo.'),
  roic: G('ROIC', 'Retorno sobre o capital investido: EBIT dos 12 meses x (1 - 34%) dividido por (patrimônio líquido + dívida líquida). Aproximação.',
    'EBIT de R$ 100, depois de 34% de imposto fica R$ 66; capital de R$ 400 dá ROIC de 16,5%.',
    'Mostra o retorno do negócio como um todo, com dinheiro de sócios e de credores. Compare com o custo desse dinheiro.'),
  percentil5a: G('Percentil de 5 anos', 'Posição do preço atual entre os fechamentos dos últimos 5 anos: que fatia deles ficou abaixo do preço de hoje.',
    'Percentil 80 significa que em 80% dos dias dos últimos 5 anos o preço fechou abaixo do atual.',
    'Perto de 0, o preço está entre os mais baixos do período; perto de 100, entre os mais altos. Preços sem ajuste por desdobramentos podem distorcer.'),
  alvoPct: G('Alvo (%)', 'Percentual da carteira que você quer ter em um ativo. É uma escolha sua.',
    'Alvo de 20% numa carteira de R$ 10.000 equivale a R$ 2.000 nesse ativo.',
    'O aporte sugerido prioriza ativos abaixo do alvo. A soma dos alvos deve ser 100%.'),
  teto: G('Teto por ativo', 'Percentual máximo da carteira que um único ativo pode ocupar na divisão do aporte.',
    'Teto de 25% numa carteira de R$ 10.000: o aporte não leva um ativo além de R$ 2.500.',
    'Evita concentrar demais por conta própria. Vazio significa sem teto.'),
  intensidade: G('Intensidade', 'Quanto as notas dos ativos influenciam a divisão do aporte, além da distância até o alvo. De 0 (só o alvo) a valores maiores (notas pesam mais).',
    'Com 0, o aporte segue só a distância até o alvo. Com 1, ativos de nota maior recebem um pouco mais.',
    'É um ajuste de preferência sua, não uma medida do mercado. As notas são educacionais.'),
  lote: G('Lote', 'Quantidade mínima negociável. Ações costumam ser em lotes de 100; no fracionário, de 1.',
    'Lote de 100 e preço de R$ 10: o lote custa R$ 1.000.',
    'O aporte é convertido em cotas inteiras do lote; o que não couber vira troco.'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** HTML de um botão "?" (alvo de toque de 44 px; o círculo visível é menor). Chave desconhecida: texto vazio. */
export function botaoAjuda(chave) {
  const e = GLOSSARIO[chave];
  if (!e) return '';
  return `<button type="button" class="ajuda-btn" data-ajuda="${esc(chave)}" aria-label="O que é ${esc(e.termo)}?"><span aria-hidden="true">?</span></button>`;
}

const corpo = (e) => `<p>${esc(e.curto)}</p><p class="ajuda__ex"><strong>Exemplo.</strong> ${esc(e.exemplo)}</p><p class="ajuda__ler"><strong>Como ler.</strong> ${esc(e.comoLer)}</p><p class="ajuda__aviso">Material educacional, não é recomendação.</p>`;

/** Delega cliques em [data-ajuda]. Fora de um dialog usa ctx.sheet; dentro de um, mostra o painel dentro dele. Devolve a limpeza. */
export function ligarAjuda(root, ctx) {
  const clique = (ev) => {
    const btn = ev.target.closest?.('[data-ajuda]');
    const e = btn && GLOSSARIO[btn.dataset.ajuda];
    if (!e) return;
    ev.preventDefault(); ev.stopPropagation();
    const dono = btn.closest('dialog');
    dono ? abrirDentro(dono, btn, e) : abrirSheet(ctx.sheet, btn, e);
  };
  root.addEventListener('click', clique);
  return () => root.removeEventListener('click', clique);
}

function abrirSheet(sheet, btn, e) {
  sheet.querySelector('#sheetTitulo').textContent = e.termo;
  sheet.querySelector('#sheetBody').innerHTML = `<div class="ajuda">${corpo(e)}</div>`;
  sheet.addEventListener('close', () => btn.isConnected && btn.focus(), { once: true });
  if (!sheet.open) sheet.showModal();
}

// Dentro de um dialog já aberto (ex.: modal do ativo): cobre o próprio dialog, sem um segundo showModal.
function abrirDentro(dlg, btn, e) {
  dlg.querySelector('.ajuda-cobertura')?.remove();
  const irmaos = [...dlg.children];
  const card = document.createElement('div');
  card.className = 'ajuda-cobertura';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'ajudaTitulo');
  card.innerHTML = `<div class="sheet__head"><h2 id="ajudaTitulo">${esc(e.termo)}</h2><button type="button" class="icon-btn" aria-label="Voltar">&times;</button></div><div class="ajuda">${corpo(e)}</div>`;
  const fechar = () => {
    card.remove(); irmaos.forEach((c) => { c.inert = false; });
    dlg.removeEventListener('close', fechar);
    if (btn.isConnected) btn.focus();
  };
  card.querySelector('button').onclick = fechar;
  card.addEventListener('keydown', (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); fechar(); } });
  irmaos.forEach((c) => { c.inert = true; });
  dlg.append(card);
  dlg.addEventListener('close', fechar);
  card.querySelector('button').focus();
}
