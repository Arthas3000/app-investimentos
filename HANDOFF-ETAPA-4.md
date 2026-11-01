# App de carteira e aportes mensais na B3: passagem de bastão para a Etapa 4

Este arquivo é para quem abrir uma nova janela de contexto. Ele reúne o que o usuário pediu, o que já está pronto (Etapas 1 a 3), o plano detalhado da Etapa 4 e o que falta depois dela. Leia inteiro antes de escrever código.

Pasta do projeto: `/home/guibes/Área de trabalho/App Investimentos` (repositório git local, ainda sem commits). O usuário desenvolve localmente e sobe para o GitHub manualmente.

## 1. Regras de trabalho com o usuário

- Idioma: português do Brasil, em tudo (interface, comentários, testes, mensagens).
- O usuário confirmou que cada etapa só começa depois da confirmação dele. Entregue uma etapa, relate, espere o "pode seguir".
- O visual (sistema de design em `design.html`) já foi aprovado. Não mude tokens nem componentes sem pedir.
- Respostas curtas e diretas. Quando algo depende de uma decisão dele, pergunte antes de construir.
- O usuário não tem plano pago em nenhuma API. Tudo precisa funcionar com fontes gratuitas.
- Ele já colou um token gratuito da brapi no chat durante a Etapa 1. Ele não foi gravado em nenhum arquivo. Vale sugerir que ele o regenere no painel da brapi por higiene.

## 2. O que o app é (especificação resumida)

App web (PWA instalável) para o investidor pessoa física que aporta todo mês em ações e FIIs da B3. Ciclo: abrir e ver o saldo, informar o aporte do mês, receber proposta de cotas por ativo para manter a carteira balanceada (priorizando melhor preço e melhor nota), confirmar as compras feitas na corretora. Também mostra todos os ativos da bolsa e diz se cada um está barato e se vale a pena. É material educacional: nunca apresentar nada como recomendação de investimento, e isso fica visível nas telas de análise e de proposta.

Princípios que valem para tudo:

- Tudo atualiza sozinho a partir de APIs. Não existe botão "atualizar".
- Busca de dados e matemática rodam no navegador. Exceção aprovada pelo usuário: um workflow diário e automático do GitHub Actions pode baixar dados pesados (CVM e B3) e gravar JSON no repositório. O usuário envia o workflow uma vez ao GitHub e depois ele roda sozinho.
- Nada é editado fora do app (sem CSV, planilha ou arquivo de configuração para o usuário).
- Um modo só. Sem modo iniciante ou avançado.
- Dado ausente fica vazio e o cálculo se adapta. Nunca invente número. Todo número mostra fonte e horário do dado.
- JavaScript puro, sem framework e sem etapa de build. Hospedagem estática (GitHub Pages). Dados do usuário no `localStorage`, cache de mercado em IndexedDB, backup em JSON exportável e importável. O token da API vem do usuário, fica só no navegador e nunca entra no backup nem no repositório.
- Dinheiro em centavos inteiros. Núcleo de cálculo em funções puras (sem DOM, sem rede, sem `Date.now()`), testado com `node --test`.
- Acessibilidade WCAG 2.2 AA. Funciona em 360 px de largura sem rolagem lateral. A cor nunca é o único sinal.

Áreas do app: Home, Carteira, Mercado, Simulador e Histórico (barra inferior no celular, lateral no computador), mais Ajustes na engrenagem do topo. Cada tela tem endereço próprio (ex.: `#carteira/ativo/PETR4`).

## 3. O que já foi feito (Etapas 1 a 3)

### Etapa 1: verificação das fontes de dados (concluída)

Testado com chamadas reais, com `Origin` de outro domínio.

| Fonte | CORS no navegador | Token | Observação |
|---|---|---|---|
| brapi `/api/quote/list` | Sim | Não | 2.371 itens em 2 páginas (`limit=2000`): ações, FIIs, BDRs, ETFs. Traz preço, variação, volume, valor de mercado, setor (em inglês), subsetor e tipo. |
| brapi `/api/quote/{ticker}` | Sim | Sim, exceto PETR4, VALE3, MGLU3 e ITUB4 (sandbox, 20 req/min por IP) | Aceita o token no cabeçalho `Authorization: Bearer`. |
| BCB SGS (CDI série 12, IPCA série 433) | Sim | Não | JSON simples. |
| BrasilAPI feriados | Sim | Não | `/api/feriados/v1/{ano}`. |
| Yahoo Finance, Stooq, Fundamentus, Status Invest | Não (CORS ausente ou bloqueio) | | Descartadas. |
| CVM dados abertos (ITR, DFP, informe mensal de FII) e B3 COTAHIST | Não, mas respondem `200` no servidor | Não | Arquivos ZIP grandes (ITR 2026 tem cerca de 20 MB, COTAHIST anual cerca de 89 MB). Só servem via workflow. |
| bolsai | Sem CORS visível; histórico, dividendos e balanços só no plano Pro | Chave | Descartada. |
| Alpha Vantage | CORS livre | Chave grátis | Não testada com chave; cobertura de B3 e limite diário não confirmados. |

Plano gratuito da brapi, confirmado com o token do usuário: 15.000 requisições em janela móvel de 30 dias, 1 ativo por chamada, 1 requisição simultânea, histórico só `1d`, `5d`, `1mo` e `3mo`, atraso de cerca de 30 minutos, sem dividendos e sem módulos de fundamentos (só `summaryProfile`). O que a cotação traz de graça: preço, P/L, lucro por ação, valor de mercado, faixa de 52 semanas e setor/indústria.

Conclusão: sem fonte paga, o modelo de análise completo só é possível com o workflow diário (opção 4, aprovada pelo usuário).

### Etapa 2: design, camada de dados e Mercado (concluída e aprovada)

Arquivos:

- `css/tokens.css` e `css/components.css`: tokens (claro e escuro, múltiplos de 4 px, durações, cores de indicação) e componentes (botão, cartão de saldo, linha de ativo, selos de indicação, selo "Só consulta", marcador de pregão, campo, painel inferior, aviso com desfazer, estado vazio, esqueleto, gráfico). `css/app.css`: casca e navegação.
- `design.html`: página de amostra do sistema de design.
- `index.html`, `js/app.js`: casca do app, rotas por hash, faixa do pregão, navegação. Cada tela é um módulo com `montar(root, ctx)` que devolve uma função de limpeza, e opcionalmente `rota(partes)`.
- `js/views/mercado.js`: lista de todas as ações e FIIs (sem BDR, ETF nem códigos fracionários terminados em número + `F`), busca sem acento, filtros por tipo e setor (setores traduzidos), 5 ordenações, renderização sob demanda em lotes de 60, atualização automática a cada 60 s com pregão aberto e aba visível, e modal do ativo (`#mercado/ativo/PETR4`) com preço, variações, gráfico, faixa de 52 semanas, valor de mercado, P/L, lucro por ação e setor. O modal ainda tem um bloco "Nota de valor e indicação" como espaço reservado para a Etapa 4. Sem token, o modal pede o token com passo a passo.
- `js/ui/kit.js` (número animado, piscar de cotação, aviso com desfazer, painel arrastável, vibração), `js/ui/icons.js` (ícones SVG).
- `js/data/`: `brapi.js` (cliente com fila de uma requisição por vez, cache), `cache.js` (IndexedDB com TTL e devolução de dado velho se a busca falha), `bcb.js`, `feriados.js`, `store.js` (token e preferências no `localStorage`), `pregao.js` (estado do pregão: aberto, fechado ou atrasado, pelo horário de Brasília, feriados e idade da cotação).
- Pregão: 10:00 às 17:00 (confirmado pelo usuário), dias 24/12 e 31/12 sem pregão, cotação com mais de 45 minutos com o pregão aberto vira "atrasado". Com o pregão fechado a faixa mostra o fechamento do último pregão, não a hora da consulta.

### Etapa 3: núcleo de cálculo com testes (concluída, 32 testes passando)

Em `js/core/`, tudo puro e testado com valores conferidos à parte (Python):

- `money.js`: `arredonda` (meio para longe do zero, tolerante a erro binário), `centavos`, `mulDiv` (a×b÷c exato com BigInt).
- `datas.js`: `ehData`, `mesDe`, `addMeses`.
- `posicoes.js`: `validar`, `calcular(transacoes)` (posições com cotas e custo, caixa, erros), `precoMedio`, `resumo(posicoes, precos)` (saldo, custo, resultado, pesos; ativo sem preço fica de fora). Transação: `{ id, tipo, data, ativo?, qtd?, preco?, taxas?, valor?, excluido? }`, com `tipo` em `compra`, `venda`, `transferencia`, `deposito`, `retirada`, `provento`. Valores em centavos.
- `proventos.js`: `estimarProventos`, `porMes`, `soma12m`, `qtdNaData`.
- `metas.js`: `progresso`, `aporteMedio` (6 meses fechados; devolve `null` sem histórico), `estimarMeta` (só aportes), `metaRendaEmPatrimonio`.
- `risco.js`: `retornos`, `volatilidadeAnual` (mínimo 20 observações), `quedaMaxima` (aportes neutralizados), `beta`, `hhi` (faixas 1000/1800/2500).

Testes em `test/*.test.js`. Rodar: `npm test`.

### Como rodar e testar

- Servir: `python3 -m http.server 8765` na pasta do projeto, abrir `http://localhost:8765/`. Para testes em navegador automatizado, use um servidor com `Cache-Control: no-store` (o servidor simples do Python deixa o navegador reaproveitar módulos JS antigos).
- Armadilha: navegar para a mesma página mudando só o `#hash` não recarrega o JavaScript. Para ver código novo, mude a query (`?r=2`).
- Armadilha de shell: `pkill -f "http.server 8765"` mata o próprio comando; use `pkill -f "[h]ttp.server 8765"`.

## 4. Etapa 4: modelo de análise (a fazer agora)

Objetivo: calcular, no navegador, a nota de valor, a nota de estabilidade e a indicação automática de cada ativo, e mostrar tudo no modal do ativo. Para isso é preciso primeiro ter os dados: a brapi grátis não entrega fundamentos nem histórico longo.

### 4.1 Passo zero: desenhar e mostrar ao usuário o workflow de dados

O usuário pediu que o workflow seja mostrado antes de escrever o restante. Entregar primeiro um desenho curto (fontes, campos, formato dos JSON, agendamento) e esperar o "pode seguir". Depois construir.

**Agendamento.** Workflow `.github/workflows/dados-diarios.yml` com `schedule` (cron, uma vez por dia, depois do fechamento; sugestão 22:00 UTC, dias úteis) e também `workflow_dispatch` apenas como válvula de escape. O job baixa as fontes, gera JSON em `dados/` e faz commit se algo mudou. Como o commit diário mantém atividade no repositório, o GitHub não desativa o agendamento por inatividade (regra dos 60 dias em repositórios públicos). O Pages publica `dados/*.json` na mesma origem do app, então não há problema de CORS.

**Script.** `scripts/atualizar-dados.mjs` em Node 22 (sem dependências, se possível; para descompactar ZIP, usar o `unzip` do runner do GitHub). Testar localmente antes de subir.

**Fontes oficiais (todas respondem `200` hoje):**

- Demonstrações: `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{ano}.zip` e `.../DFP/DADOS/dfp_cia_aberta_{ano}.zip` (DRE, balanço ativo e passivo, DFC, versão consolidada `_con`). Trimestral e anual a partir de 2009.
- FIIs: `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_{ano}.zip` (geral, complemento, ativo/passivo).
- Preços históricos: `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_A{ano}.ZIP` (layout de largura fixa; ler 5 anos).
- Cadastro de empresas, com ticker: `fca_cia_aberta_valor_mobiliario` (formulário cadastral da CVM) liga CNPJ a código de negociação. Ainda é preciso confirmar o equivalente para FIIs (CNPJ do fundo ao ticker).

**Pontos em aberto que o workflow precisa resolver (investigar antes de prometer):**

1. Proventos (dividendos e JCP por cota, com data com e data de pagamento): a CVM não publica isso de forma simples. Investigar o endpoint de proventos da B3 (listadas) ou outra fonte gratuita oficial. Se não houver fonte confiável, o app deixa o dado vazio e o usuário lança proventos à mão no Histórico (o núcleo já suporta o tipo `provento`). Não invente.
2. Ibovespa para o beta e para a "queda relativa ao Ibovespa": o COTAHIST não traz o índice. Opções: usar BOVA11 como proxy (decisão a confirmar com o usuário) ou outra série pública. Deixar o campo vazio se nada servir.
3. Indicadores que a CVM não traz para bancos: CET1 e inadimplência não estão em ITR/DFP. Para bancos, essas partes da nota ficam sem dado e o peso é redistribuído dentro do pilar (a regra do prompt já prevê isso).
4. FFO, vacância, número de imóveis, qualidade de crédito e parcela do rendimento vinda de venda de imóveis dos FIIs: conferir quais campos o informe mensal da CVM realmente traz. O que não existir fica vazio.
5. EBITDA, ROIC e dívida líquida precisam ser derivados (EBIT mais depreciação e amortização da DFC, dívida bruta menos caixa etc.). Documentar cada fórmula derivada no README e marcar o que for aproximação.

**Saídas (formato a definir no desenho, mantendo os arquivos pequenos):**

- `dados/meta.json`: data da geração, fontes, versão do esquema.
- `dados/fundamentos.json`: por ticker, os indicadores brutos mais recentes (ROE 12 meses, ROE do último trimestre, lucros dos últimos períodos, DL/EBITDA ou DL/PL, liquidez corrente, ROIC, crescimento, payout, earnings yield, P/VP quando houver patrimônio) com a data-base de cada um.
- `dados/fiis.json`: por ticker de FII, P/VP, rendimento, FFO, vacância, alavancagem, liquidez e o que mais houver.
- `dados/precos/{TICKER}.json`: fechamentos diários dos últimos 5 anos (datas e preços em formato compacto), para volatilidade de 1 e 3 anos, queda máxima de 3 e 5 anos, beta, queda relativa e gráfico. Carregado sob demanda e em cache por dia.
- `dados/proventos.json`: só se a investigação (item 1) achar fonte.

Atenção ao tamanho: cerca de 700 ações e 280 FIIs por 1.260 pregões. Medir antes de subir. O Pages aceita, mas o app só pode baixar o que o ativo aberto pede.

### 4.2 Modelo de análise (calculado no navegador, funções puras com testes)

Criar `js/analise/` com `valor.js`, `estabilidade.js` e `indicacao.js`, cada um devolvendo `{ nota, pilares, cobertura, motivos }` e com testes em `test/`. Premissas numa constante única: Ke = 18%, g = 5%, CDI líquido = CDI × 0,85 (o CDI vem do BCB, já no cliente `js/data/bcb.js`).

`clip(x)` limita a [0, 1]. Nota parcial = pontos × clip((valor − pior) / (melhor − pior)). Dado ausente: o peso dele é redistribuído dentro do pilar. Cobertura = parcela dos 1000 pontos que tem dado: 90% ou mais é "nota completa", 75% ou mais é "nota parcial", abaixo de 75% fica sem nota. A nota de 0 a 10 é o score de 0 a 1000 dividido por 100.

**Ações**

- ROEₙ = média(ROE 12 meses, ROE do último trimestre × 4). Commodities usam só o ROE de 12 meses.
- P/VP justo = (ROEₙ − g) / (Ke − g). Margem de segurança MS = P/VP justo ÷ P/VP − 1. Preço justo = preço × P/VP justo ÷ P/VP.
- P1 Desconto (300): MS (150); queda recente relativa (60), que é a queda em relação à máxima de 12 meses e às variações de 1 e 3 meses, comparada à do setor e à do Ibovespa, multiplicada pela qualidade; tendência do ROE = ROE do trimestre × 4 ÷ ROE 12 meses (90).
- P2 Solidez e valuation (250): alavancagem DL/EBITDA (banco: CET1; incorporadora: DL/PL) (100), liquidez corrente (50), earnings yield comparado ao Ke (100).
- P3 Qualidade (250): ROEₙ/25% (100), ROIC (banco: inadimplência) (75), crescimento (50), lucros positivos nos últimos períodos (25). Estatais perdem 15 pontos.
- P4 Proventos (200): DY/10% (80), payout (cheio até 60%, zero acima de 100%) (80), sustentabilidade (40).

**FIIs:** desconto sobre o P/VP ponderado pela cobertura FFO/rendimento, queda relativa à mediana dos FIIs, alavancagem (passivo/ativo), liquidez diária, FFO yield comparado ao CDI líquido, vacância e número de imóveis (tijolo) ou qualidade do crédito (papel), DY e parcela do rendimento vinda de venda de imóveis. O prompt original não deu os pesos dos FIIs; propor uma distribuição de 1000 pontos em quatro pilares análogos aos das ações e mostrar ao usuário.

**Nota de estabilidade (0 a 10), por ativo e por setor**

- Por ativo: volatilidade anual de 1 e 3 anos (desvio padrão amostral diário × √252), queda máxima de 3 e 5 anos, beta contra o Ibovespa, estabilidade do lucro (variação do ROE trimestral e número de trimestres com prejuízo) e liquidez diária. Usar `js/core/risco.js`.
- Por setor, segmento e classe (ações por setor; FIIs por tijolo, papel e híbrido): mediana das notas dos ativos do grupo e dispersão. O setor vem da brapi (`sector` e `subsector` em inglês no `quote/list`; já existe tradução para os 20 setores em `js/views/mercado.js`); se faltar, usar uma tabela interna no código.
- O modal mostra as duas notas lado a lado ("este ativo" × "o setor dele"). A nota do setor precisa dos dados dos pares: decidir se o workflow já entrega um resumo por ticker (volatilidade, queda máxima, beta) para não baixar 700 arquivos de preço no navegador. Se mover esse cálculo para o workflow, registrar a exceção ao princípio "a matemática roda no navegador" e avisar o usuário.

**Indicação automática, sempre com os motivos** (limites iniciais numa constante):

- Candidata a compra (desconto): nota de valor ≥ 7, MS > 0 (FII: P/VP < 0,95) e fundamentos estáveis ou melhorando. Caso típico: empresa sólida que caiu mais que o setor e o Ibovespa sem piora nos números ("queda sem motivo aparente nos fundamentos").
- Compra com cautela: nota ≥ 6 e MS > 0, mas com um alerta (alavancagem alta, estatal, estabilidade baixa ou nota parcial).
- Boa, mas sem desconto: qualidade alta (P3 ≥ 70%) e MS ≤ 0.
- Atenção ao rendimento: payout > 100%, cobertura FFO < 0,9 ou rendimento sustentado por venda de imóveis.
- Evitar (armadilha): preço caiu e os fundamentos pioraram (tendência do ROE < 0,7, prejuízo no trimestre, ou ROE abaixo do Ke com alavancagem alta).
- Neutro: nenhum dos casos acima.

Cada indicação tem cor, ícone e rótulo fixos (já existem em `css/tokens.css` e no `design.html`: `ind-candidata`, `ind-cautela`, `ind-boa`, `ind-atencao`, `ind-evitar`, `ind-neutro`) e lista em frases curtas os números que a justificam. Nunca vermelho para "comprar". A tela explica que o app lê só números: notícias e fatos relevantes não entram.

### 4.3 Integração no app

- Novo `js/data/dados.js`: carrega `dados/*.json` da mesma origem, com cache diário em IndexedDB (`js/data/cache.js` já tem `comCache`), tratando offline e arquivo ausente (o app deve abrir normalmente sem os JSON; análise fica vazia com mensagem útil).
- Atualizar `abrirAtivo` em `js/views/mercado.js`: trocar o bloco reservado "Nota de valor e indicação" por indicação com motivos, nota de valor e os 4 pilares, preço justo e MS, nota de estabilidade do ativo e do setor, principais fundamentos e o aviso educacional. Botões "Acompanhar na carteira" e "Registrar compra" entram na Etapa 5.
- Estados obrigatórios do modal: vazio, carregando, erro, sem conexão e "sem nota" (cobertura abaixo de 75%).
- Com os dados históricos disponíveis, completar o modal com o gráfico de maior alcance e as variações de 12 meses (a brapi grátis só dá 3 meses).
- Opcional e barato: mostrar o selo da indicação na linha do Mercado quando a análise já estiver em cache.

### 4.4 Entregáveis e critérios de pronto da Etapa 4

1. Desenho do workflow mostrado e aprovado pelo usuário.
2. Workflow e script funcionando localmente (gerar `dados/` com dados reais) e arquivo do workflow pronto para o usuário subir ao GitHub.
3. Módulos `js/analise/*` puros, com testes cobrindo cada pilar, a redistribuição de pesos por dado ausente, as faixas de cobertura e cada regra de indicação (valores esperados conferidos à parte, como foi feito na Etapa 3).
4. Modal completo do ativo funcionando, com todos os estados.
5. README iniciado com a estrutura, as fórmulas, as fontes e as limitações (só ativos em reais da B3, dividendos brutos, sem imposto nem come-cotas, resultado passado não garante futuro).
6. `npm test` verde. Relatório final curto ao usuário, com as decisões tomadas e as perguntas pendentes.

## 5. O que falta depois da Etapa 4

### Etapa 5: Home, Carteira e Histórico

- Home: cartão de saldo (saldo total = Σ quantidade × preço atual, mais caixa se houver; valor investido; resultado em R$ e %; variação do dia), lista dos meus ativos (código, nome, quantidade, preço atual com marcador de pregão, valor, % da carteira, resultado %), botão de olho para esconder valores (••••, lembrado no aparelho), botão "+" flutuante (compra, venda, depósito, retirada, transferência de custódia).
- Primeiros passos na Home vazia (3 cartões que somem quando concluídos e podem ser dispensados): conectar a fonte de dados (com o passo a passo do token; o pedido de token do modal já existe e pode ser reaproveitado), acompanhar ou registrar o primeiro ativo, definir valor e dia do aporte.
- "Desde a sua última visita": ativos da carteira que mudaram de indicação, proventos com data com próxima, ativos acompanhados que viraram "Candidata a compra". Se não houver nada: "Tudo em dia. Seu próximo aporte é em 5/12."
- Carteira: tudo da Home com preço médio, custo, resultado por ativo, proventos recebidos, alvo % editável, distância do alvo, nota de valor, nota de estabilidade e indicação; renda passiva (estimada por mês e por ano, com gráfico); metas com progresso e estimativa (usa `js/core/metas.js`); concentração e risco da carteira (HHI, nº efetivo, volatilidade, queda máxima, peso por classe e setor); botão "+" para acompanhar ativo (selo "Só consulta", quantidade 0, aviso de que serve só para consulta até registrar uma compra; ativos com selo podem receber alvo % e entrar na proposta).
- Histórico: todas as movimentações em ordem de data (compras, vendas, depósitos, retiradas, transferências e proventos), filtros por tipo, ativo e período; corrigir e excluir sem perder o registro da correção (o núcleo ignora transações com `excluido: true`).
- Persistência: estado do usuário em `localStorage` (transações, ativos acompanhados, alvos, metas, preferências), com exportar e importar backup em JSON (sem o token).
- Registrar compra: "+" › ativo › quantidade e preço › confirmar, com preço atual e data de hoje já preenchidos, teclado numérico, máscara de R$, busca por código ou nome e validação no tom de ajuda (usar `validar` de `js/core/posicoes.js`).
- Toda tela com estados vazio, carregando, erro e sem conexão.

### Etapa 6: assistente de aporte mensal e ritual do aporte

- Entradas: valor do aporte, alvo % por ativo (atalhos: pesos iguais, por classe ou por setor), teto % opcional, intensidade da preferência por nota e preço (0 a 100%), taxas e lote (padrão 1). Opção "não propor ativos marcados como Evitar", ligada por padrão.
- Cálculo: T = valor atual da carteira + aporte; necessidade = max(0, alvo% × T − valor atual). Preferência: z = (nota − média) / maior desvio, fator = 1 + intensidade × z, com nota combinando a nota de valor e a MS. Distribuição por water-filling em centavos, respeitando alvo e teto, com desempate determinístico; depois ajuste para lotes inteiros, com "um lote a mais" para quem fica mais abaixo do alvo. Escrever como funções puras em `js/core/` com testes.
- Saída: quantas cotas por ativo, preço usado (com marcador de pregão), total, taxas, sobra, peso antes e depois e o motivo de cada linha. O app não envia ordens: a proposta só vira transação quando o usuário confirma, podendo ajustar preço e quantidade realmente pagos. Mostrar o aviso educacional.
- Fluxo do aporte em 3 passos: valor › revisar proposta (ajustar quantidades com +/−) › confirmar o que foi comprado na corretora. Animação curta de conclusão, frase "Aporte de <mês> registrado" com o novo peso da carteira e vibração leve onde houver suporte.
- Ritual: no dia do aporte escolhido, a Home mostra o cartão "Aporte de <mês>" com a proposta pronta; em Ajustes, lembrete na agenda do celular por arquivo `.ics` recorrente, gerado no navegador, sem servidor.

### Etapa 7: Simulador, Ajustes, "Seu mês", marcos, "Como usar", "?", PWA e revisão final

- Simulador: montar carteira › resultado, com aporte inicial e mensal, dividendos, custos e estratégia (pesos fixos ou rebalanceamento só com aportes), comparado com Ibovespa, CDI e IPCA (retorno nominal e real). Funções puras em `js/core/`: pregão a pregão; TWR = Π(valorₜ − aporteₜ) / valorₜ₋₁ − 1 (TWR anual só com 1 ano ou mais); XIRR por Newton-Raphson com bisseção de reserva; IPCA acumulado e retorno real; Ibovespa e CDI recebem os mesmos aportes nas mesmas datas; lista das premissas usadas. Depende do histórico de preços que o workflow da Etapa 4 entregar.
- Ajustes (engrenagem): cotações e API (token, frequência), valor e dia do aporte (com o lembrete `.ics`), custos e lotes, metas, backup, fontes de dados, tema e o tour "Como usar".
- "Seu mês": aportes feitos, proventos recebidos, evolução do patrimônio e do valor investido, e como a carteira ficou em relação aos alvos. Marcos discretos (primeiro aporte, primeiro provento, 6 e 12 meses seguidos de aporte, patrimônio de R$ 10 mil, R$ 50 mil e R$ 100 mil), mostrados uma vez em cartão simples, sem pontos, níveis, medalhas colecionáveis nem ranking.
- Botão "?" ao lado de termos técnicos (P/VP, MS, DY, ROE, payout, FFO, HHI, volatilidade, TWR, XIRR etc.) com explicação curta e exemplo.
- PWA: `manifest`, ícones, service worker com cache do app e dos últimos dados, instalável no celular. Hoje falta até o `favicon.ico` (único erro de console).
- README completo (estrutura, fórmulas, fontes, limitações) e revisão final com o checklist de experiência, mostrando o resultado de cada item:
  - registrar uma compra em até 4 toques a partir da Home
  - aporte do mês completo em menos de 1 minuto
  - nenhuma tela sem estado vazio, carregando e erro
  - funciona em 360 px de largura sem rolagem lateral
  - movimento reduzido respeitado
  - contraste e leitor de tela (WCAG 2.2 AA)
  - nenhum texto de urgência, nenhuma celebração de compra ou venda
  - avaliação pelas 10 heurísticas de Nielsen, com os problemas encontrados e corrigidos

### Regras de experiência que valem em todas as etapas

- Engajamento saudável: premiar constância e disciplina, não operar muito. Não fazer: celebração de compra ou venda, contagem que "quebra" e cobra a pessoa, alertas de queda de preço que incentivem vender no pânico, cores ou textos de urgência, feed infinito, notificações sem pedido explícito.
- Ações principais a no máximo 2 toques da Home. Voltar preserva o estado anterior (rolagem, filtros, campos). No celular, modais são painéis que sobem de baixo e fecham arrastando; no computador, janela central. Sem "puxar para atualizar".
- Toda ação responde em menos de 100 ms. Carregamento com esqueletos, não spinner de tela cheia. Excluir ou corrigir mostra aviso com "Desfazer" por 5 segundos; diálogo de confirmação só para o que não tem volta (apagar todos os dados).
- Saldo anima até o novo valor (300 a 600 ms); cotação que muda pisca de leve em verde ou vermelho. Movimento de 150 a 300 ms e `prefers-reduced-motion` respeitado (só opacidade).
- Verde e vermelho só para ganho e perda. A cor nunca é o único sinal. Texto em português simples, tom calmo, sem jargão sem o "?".
- Abrir em menos de 1 segundo a partir do cache, com os últimos valores e o horário deles.

## 6. Decisões já tomadas pelo usuário

- Plano gratuito em tudo; opção 4 (workflow diário no GitHub) para dados pesados, 100% automático depois de enviado uma vez.
- Desenvolvimento local; o usuário sobe o projeto ao GitHub manualmente.
- Horário do pregão: 10:00 às 17:00.
- Visual aprovado (Etapa 2).
- Cada etapa começa só depois da confirmação dele.

## 7. Pendências e riscos conhecidos

- Fonte de proventos ainda não definida (ver 4.1, item 1).
- Ibovespa para beta e queda relativa ainda sem fonte decidida (item 2).
- Bancos sem CET1 e inadimplência na CVM (item 3); a nota deles será parcial ou ausente nesses itens.
- Cache da lista de ativos com pregão fechado dura 12 horas (marcado com `ponytail:` em `js/views/mercado.js`); o fechamento exato pode ser refinado.
- Quarta-feira de cinzas (pregão abre às 13h) não é tratada em `js/data/pregao.js` (marcado com `ponytail:`).
- O plano gratuito da brapi limita os detalhes de cada ativo a 2 requisições por abertura do modal e 15.000 por mês; os dados do workflow aliviam isso quando existirem.
- O repositório precisa ser público para ter minutos gratuitos de Actions e Pages sem custo; confirmar com o usuário antes de orientar a subida.
- Nenhum commit foi feito ainda. Só commitar quando o usuário pedir.
