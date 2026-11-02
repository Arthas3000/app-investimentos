# App Investimentos

App web (JavaScript puro, sem build) para quem aporta todo mês em ações e FIIs da B3. Material educacional: nada aqui é recomendação de investimento. O app lê só números; notícias e fatos relevantes não entram.

## Estrutura

- `index.html`, `js/app.js`, `css/`: casca, rotas por hash e sistema de design (`design.html` é a amostra).
- `js/core/`: cálculo puro (dinheiro em centavos, posições, proventos, metas, risco).
- `js/analise/`: modelo de análise puro (`valor.js`, `estabilidade.js`, `indicacao.js`, `analisar.js`, premissas em `constantes.js`).
- `js/data/`: acesso a dados (brapi, BCB, feriados, cache em IndexedDB, `dados.js` para os JSON do workflow).
- `js/views/`: telas.
- `scripts/`: geração dos dados (Node 22, sem dependências, `unzip` do sistema).
- `dados/`: JSON gerados pelo workflow diário. O app abre normalmente sem eles; a análise fica vazia com mensagem.
- `.github/workflows/dados-diarios.yml`: roda em dias úteis às 22h UTC e commita `dados/` só se algo mudou.

Rodar: `python3 -m http.server 8765` e abrir `http://localhost:8765/`. Testes: `npm test`. Atualizar dados à mão: `node scripts/atualizar-dados.mjs` (cerca de 1 min 10 s).

## Fontes

| Dado | Fonte |
|---|---|
| Cotações ao vivo, lista de ativos, setor | brapi (plano gratuito, token do usuário só no navegador) |
| CDI, IPCA | BCB SGS (séries 12 e 433) |
| Feriados | BrasilAPI |
| Demonstrações das ações, número de ações, cadastro | CVM: ITR, DFP, composição de capital e FCA (`dados.cvm.gov.br`) |
| FIIs | CVM: informe mensal e informe trimestral (imóveis e resultado); ticker ligado pelo ISIN do COTAHIST |
| Proventos (dividendos, JCP, rendimentos), desdobramentos, grupamentos e bonificações, número de ações e cotas | B3, páginas de empresas listadas e de fundos (`sistemaswebb3-listados.b3.com.br`); ISIN ligado ao ticker pelo COTAHIST mensal |
| Preços de 5 anos | B3 COTAHIST, ajustados pelos eventos em ações da B3 |
| Conferência do IPCA | IBGE, SIDRA (tabela 1737, variável 63) |

Os dados da CVM são publicados sob a Licença Aberta para Bases de Dados (ODbL); os arquivos derivados em `dados/` seguem a mesma licença, com a CVM citada como fonte (também em Ajustes > Fontes). O endpoint de empresas listadas da B3 é o que o próprio site da B3 usa, sem documentação oficial: o workflow faz uma consulta por emissor por dia, em sequência.

### Conferência entre fontes (`scripts/conferir-fontes.mjs`)

A fonte primária vale; a conferência só avisa. Rendimento mensal de FII: CVM (DY × VPA) contra a B3, últimos 6 meses, aceitando data com no mês ou no seguinte, tolerância de 5%; o fundo fica marcado quando mais da metade diverge. Número de ações: CVM (em circulação) contra B3 (total, com tesouraria), tolerância de 5%. IPCA: Banco Central contra IBGE, 12 meses. O resultado vai para `dados/conferencia.json` e aparece no modal do ativo.

Ibovespa é aproximado por BOVA11.

## Arquivos de `dados/`

`meta.json`, `fundamentos.json` (ações), `fiis.json`, `proventos.json` (por ticker: `p` = [data com, pagamento, valor, tipo], `soma12m` e `ev` = eventos em ações [data com, fator, rótulo]; mais `quantidades` por emissor), `conferencia.json`, `risco.json` (volatilidade, queda máxima, beta, variações, liquidez, `saltos` e os preços de corte da faixa `limBarato`/`limCaro`, em centavos) e `precos/{TICKER}.json` (`d` em AAAAMMDD, `p` em centavos). Dado ausente é `null`; nunca se inventa número.

A volatilidade, a queda máxima e o beta são calculados no workflow, com o mesmo `js/core/risco.js`. É uma exceção ao princípio "a matemática roda no navegador", aprovada para que a nota de estabilidade do setor não exija baixar centenas de arquivos de preço.

## Fórmulas

### Fundamentos (ações, `scripts/atualizar-fundamentos.mjs`)

Demonstrações consolidadas, versão mais recente. Razões em fração.

- Trimestre isolado = acumulado do período menos o acumulado anterior; 4º tri = DFP menos 9 meses. LTM = soma dos 4 últimos trimestres.
- ROE 12m = lucro LTM ÷ média do PL da controladora (agora e 12 meses antes). ROE do tri = lucro do tri ÷ média do PL (agora e 3 meses antes); o modelo multiplica por 4.
- EBITDA (aproximação) = EBIT LTM + depreciação e amortização da DFC (método indireto). Sem D&A, fica `null`.
- Dívida líquida (aproximação) = empréstimos, financiamentos e debêntures (circulante e longo prazo) menos caixa e aplicações de curto prazo.
- DL/EBITDA, DL/PL, liquidez corrente = ativo circulante ÷ passivo circulante.
- ROIC (aproximação) = EBIT LTM × (1 − 34%) ÷ (PL + dívida líquida).
- VPA = PL da controladora ÷ ações em circulação (sem separar classes; units usam as ações por unit do FCA). LPA 12m = lucro LTM ÷ as mesmas ações.
- Bancos: só ROE, lucros, crescimento, VPA e LPA. Tipo `incorporadora` e `commodity` são heurísticas do cadastro da CVM.

### FIIs (`scripts/atualizar-fiis.mjs`)

VPA e cotas do informe do último mês. Alavancagem = passivo ÷ ativo. Rendimento por cota do mês = DY do mês × VPA do mês anterior; `rend12m` só existe com 12 meses completos. Segmento: tijolo se ao menos 60% do investido está em imóveis e fundos imobiliários, papel se em CRI, LCI e similares, senão híbrido.

Informe trimestral: FFO 12m por cota (aproximação) = soma dos 4 últimos trimestres de `Resultado_Trimestral_Liquido_Financeiro` menos `Receita_Venda_Investimento_Financeiro`, ÷ cotas; venda de imóveis = essa receita ÷ o resultado. Vacância e inadimplência = média dos imóveis para renda acabados do último trimestre, ponderada pela parcela da receita do fundo (sem ela, pela área); nº de imóveis = quantos são. Colunas acumuladas no semestre (`Rendimentos_Declarados`, `Resultado_Financeiro_Liquido_Acumulado`) não são somadas.

### Proventos das ações

`prov12m` = soma dos proventos (dividendo, JCP) com data com nos últimos 365 dias, por ação (B3). Payout = `prov12m` ÷ `lpa12m` da mesma classe. DY = `prov12m` ÷ preço de agora, calculado no navegador.

### Premissas (`js/analise/constantes.js`)

Ke = 18%, g = 5%, CDI líquido = CDI × 0,85. Cobertura de dados: 90% ou mais é nota completa, 75% ou mais é parcial, abaixo disso fica sem nota. Nos FIIs a nota parcial vale a partir de 50% e é rotulada com o que falta (qualidade de crédito dos CRIs não existe em fonte aberta).

### Nota de valor (ações, 1000 pontos; nota = pontos ÷ 100)

- ROEn = média(ROE 12m, ROE do tri × 4); commodities usam só o ROE 12m.
- P/VP justo = (ROEn − g) ÷ (Ke − g). Margem de segurança = P/VP justo ÷ P/VP − 1. Preço justo = preço × P/VP justo ÷ P/VP.
- P1 Desconto 300: margem de segurança 150, queda relativa 60, tendência do ROE 90.
- P2 Solidez 250: alavancagem 100, liquidez corrente 50, earnings yield contra Ke 100.
- P3 Qualidade 250: ROEn 100, ROIC 75, crescimento 50, lucros positivos 25; estatais perdem 15.
- P4 Proventos 200: DY 80, payout 80, sustentabilidade 40.
- Item sem dado: o peso é redistribuído dentro do pilar.

### FIIs (proposta de pesos, a validar)

P1 Desconto 300, P2 Solidez 250, P3 Qualidade 250, P4 Rendimento 200 (itens no código de `valor.js`).

### Nota de estabilidade (0 a 10)

Volatilidade de 1 e 3 anos, queda máxima de 3 e 5 anos, beta, estabilidade do lucro e liquidez diária. As faixas pior e melhor ficam em `FAIXAS` de `estabilidade.js` e ainda precisam de calibração. A nota do setor é a mediana dos ativos do grupo.

### Indicação

Precedência: Evitar > Atenção ao rendimento > Preço atrativo pelos números > Atrativo, com ressalvas > Boa, mas sem desconto > Neutro. Limites em `constantes.js` e `LIMITES_LOCAIS` de `indicacao.js`. Cada indicação lista os números que a justificam.

## Telas

- **Home** (`#home`): saldo, ativos, "Desde a sua última visita", primeiros passos, cartão do aporte e entrada para o Seu mês. Botão "+" registra compra, venda, depósito, retirada, transferência ou provento.
- **Carteira**: preço médio, resultado, alvo % editável, notas e selos, faixa de preço explicada para quem tem o ativo (barato, "chegou ao preço normal", "preço alto pelos números", com preço pago e a faixa de 5 anos), renda passiva (só proventos lançados), metas, concentração (HHI) e risco, e ativos acompanhados ("Só consulta").
- **Mercado**: todas as ações e FIIs, com modal de análise por ativo.
- **Simulador**: monta uma carteira e compara com Ibovespa (BOVA11), CDI e IPCA.
- **Histórico**: movimentações com filtros, corrigir e excluir (nunca apaga; tem Desfazer), provento manual, backup.
- **Aporte** (`#aporte`, 3 passos): valor e alvos, proposta, confirmação do que foi comprado.
- **Seu mês** (`#seumes`): aportes, proventos, patrimônio e marcos.
- **Descobrir** (`#descobrir`, atalho no topo da Home): ações e FIIs na faixa barato, com busca, filtro, ordenação (nota, desconto, posição no histórico) e opção de ocultar "Evitar". Cada ativo abre a análise (`#descobrir/ativo/PETR4`) ou atalhos de pesquisa externa (Google Notícias, Status Invest, Investidor10).
- Telas fora da barra (Aporte, Seu mês, Descobrir, Ajustes) têm botão Voltar no topo.
- **Ajustes** (engrenagem): token, frequência de cotação, aporte e lembrete, custos e lotes, backup, fontes, tema, tour e apagar dados.

O estado do usuário fica no `localStorage` (`carteira.v1`, mais `aporte.cfg.v1`, `simulador.cfg.v1` e `marcos.v1`). O backup em JSON não leva o token.

## Aporte mensal (`js/core/aporte.js`)

T = valor atual da carteira + aporte. Necessidade do ativo = max(0, alvo% × T − valor atual). A preferência por nota e preço usa z = (score − média) ÷ maior desvio e fator = 1 + intensidade × z (mínimo 0,1); o score combina a nota de valor e a margem de segurança. O aporte é repartido em centavos por water-filling, respeitando alvo e teto, com desempate por maior resto e depois ticker. Depois vem o ajuste para lotes inteiros, com "um lote a mais" para quem fica mais abaixo do alvo. A taxa por ordem sai do valor alocado ao ativo. Vale sempre: custos + taxas + sobra = aporte. O app não envia ordens: a proposta só vira transações quando você confirma o que comprou.

## Faixa barato, normal ou caro (`js/analise/preco.js`)

Dois sinais votam −1 (barato), 0 ou +1 (caro): o percentil do preço (arredondado para centavos) nos últimos 5 anos do próprio ativo (até 25% barato, a partir de 75% caro) e, nas ações, a margem de segurança (≥ +15% barato, ≤ −15% caro) ou, nos FIIs, o P/VP (≤ 0,95 barato, ≥ 1,05 caro). Soma ≤ −1 é barato, ≥ +1 é caro, 0 é normal. Com um sinal só, vale ele e a tela avisa. A faixa compara o ativo com ele mesmo, não com outros ativos. Sem a série de 5 anos, o voto do percentil usa `limBarato` (maior preço com percentil ≤ 25) e `limCaro` (menor com percentil ≥ 75), calculados no workflow com a mesma função (`limitesFaixa`); o resultado é idêntico (teste com 500 casos).

## Simulador (`js/core/simulador.js`)

Pregão a pregão no calendário do BOVA11. Aportes no primeiro pregão em ou depois do dia escolhido, a partir do mês seguinte ao do início; cotas inteiras, sobra de caixa mantida. Estratégias: pesos fixos (rebalanceia nos aportes, vendendo o excesso) ou rebalanceamento só com aportes. Ibovespa e CDI recebem os mesmos aportes nas mesmas datas; o IPCA corrige os aportes pelo IPCA acumulado.

- TWR = Π((valorₜ − aporteₜ) ÷ valorₜ₋₁) − 1. A versão anualizada só aparece com 1 ano ou mais.
- XIRR por Newton-Raphson, com bisseção de reserva.
- Retorno real = (1 + TWR) ÷ (1 + IPCA acumulado) − 1.
- Queda máxima com aportes neutralizados.
- Sem proventos, sem imposto. Preços do COTAHIST ajustados por desdobramento, grupamento e bonificação (eventos da B3), mas não por dividendos. Tudo isso aparece na tela como premissas e avisos.

## PWA

`manifest.webmanifest`, ícones em `icons/` (gerados por `scripts/gerar-icones.py`) e `sw.js`. O service worker guarda o app e serve os dados em segundo plano. **A cada mudança em qualquer arquivo do app, suba `VERSAO` no topo de `sw.js`**; arquivo novo em `css/` ou `js/` precisa entrar em `PRECACHE` (o `npm test` falha se a lista e o disco divergirem). APIs externas (brapi, BCB) passam direto; o app tem cache próprio em IndexedDB. Arquivos de preço só existem offline depois de abertos uma vez.

## Limitações

- Só ativos em reais da B3. Dividendos brutos, sem imposto nem come-cotas. Resultado passado não garante futuro.
- Preços ajustados só pelos eventos em ações que a B3 informa (6 anos); sem o arquivo de proventos, ficam brutos. Ativos que ainda tenham `saltos > 0` mostram aviso de risco possivelmente distorcido.
- A B3 informa só cerca de 12 meses de proventos: o histórico mais longo se forma com o tempo, porque cada execução diária guarda o anterior. Proventos de units nem sempre vêm na B3; aí DY e payout ficam vazios.
- Bancos não têm CET1 nem inadimplência na CVM.
- FFO de FII é aproximado pelo resultado em caixa do informe trimestral, menos a receita de venda de imóveis; qualidade de crédito dos CRIs não existe em fonte aberta, então a nota de FII de papel continua parcial.
- Ações de empresas com ITR ou DFP mais antigo que 15 meses não entram.
- A API do BCB aceita no máximo 20 valores por chamada de `ultimos`; séries longas usam `desde`.
- Lembrete `.ics`: dias 29 a 31 caem no dia 28.
- Brapi gratuita: 15.000 requisições em 30 dias, cotação com cerca de 30 minutos de atraso.
