# Fontes UnB para o RAG

O caminho recomendado continua sendo DB-first: pesquisar fontes oficiais, transformar paginas confiaveis em documentos versionados, gerar chunks/embeddings e consultar tudo pelo Postgres/pgvector em producao.

## Fluxo atual

1. Pesquisar fontes com navegador, quando fizer sentido:

   ```bash
   cd fiaq-app
   pnpm research:unb:browser
   ```

   Esse passo usa `browser-use` e salva sugestoes em `data/sources/unb-official/browser-use-findings.json`. Ele e opcional porque depende de `browser-use`, Playwright e uma chave de LLM compativel.

2. Descobrir e pontuar fontes oficiais:

   ```bash
   pnpm discover:unb
   ```

   O script parte de `data/sources/unb-official/seeds.json`, aceita sugestoes do browser-use quando existirem, segue apenas dominios `*.unb.br` e grava o inventario em `data/sources/unb-official/discovered-sources.json`.

3. Materializar paginas para o RAG:

   ```bash
   pnpm fetch:unb
   ```

   Isso grava as melhores paginas em `data/crawl/*.md`, com frontmatter de origem, score e URL. Esses arquivos entram no mesmo seed do FAQ, PDFs e crawls ja existentes.

4. Atualizar o banco:

   ```bash
   pnpm seed:knowledge
   ```

   O seed recria documentos/chunks ativos no Supabase/Postgres usando o modelo de embedding configurado. O chat continua consultando `buscar_rag_chunks(...)` no banco.

Paginas crawleadas automaticamente costumam ser menus ou textos institucionais, sem o "como fazer". Para os processos mais perguntados existem tambem **guias passo a passo escritos a mao** (`data/crawl/*-guia-*.md`), feitos a partir de manuais e paginas oficiais. O fluxo para adicionar um, e as regras de escrita, estao em [`DESENVOLVIMENTO.md`](./DESENVOLVIMENTO.md#adicionar-ou-atualizar-conhecimento).

## Por que nao pesquisar a web em toda pergunta?

Pesquisa em tempo real aumenta latencia, custo e risco de resposta com fontes ruidosas ou temporarias. Para o fIAq, a divisao e:

- ingestao: pesquisa/crawler/browser-use encontram fontes; guias manuais cobrem os procedimentos;
- curadoria: filtros por dominio, score, conteudo minimo e `nivel_confianca` (`oficial` x `institucional`);
- recuperacao: Postgres/pgvector responde rapido e com fontes conhecidas;
- pesquisa web (Firecrawl, ja implementada): so quando o contexto local nao e suficiente, quando a pergunta e sobre algo atual ("ultimas noticias", "greve", "2026") ou quando o aluno pede mais detalhes numa continuacao.

## Como a busca funciona hoje

A busca ja e hibrida, mas a parte textual roda no app, nao no banco:

1. busca vetorial (`buscar_rag_chunks`, cosine distance com `pgvector`, com boost por origem e por nivel de confianca) e busca textual (termos da pergunta contra titulo e conteudo) rodam em paralelo;
2. os resultados sao reordenados em `server/utils/chatRetrieval.ts` (`rankContextResults`) por cobertura dos termos da pergunta, titulo, confianca e, em perguntas de "como faco", prioridade a guias passo a passo;
3. `hasEnoughLocalContext` decide se os 3 melhores trechos bastam ou se a pergunta vai para a pesquisa web.

## Avaliacao

`pnpm eval:rag` roda esse mesmo codigo sobre o `rag-index.json` com as perguntas de `fiaq-app/scripts/eval-rag-casos.json` e informa, para cada uma, se o documento esperado ficou entre os 3 trechos usados e se a decisao de pesquisa web foi a esperada. Ao adicionar um guia ou mexer no ranking, rode antes e depois; ao cobrir um assunto novo, adicione um caso.

## Proximos passos possiveis

- mover a busca textual para o banco com indice full-text em portugues (`tsvector` + `ts_rank`), que tambem resolveria variacoes de verbo ("tranco"/"trancar") hoje tratadas por heuristica;
- avaliar tambem as respostas do modelo (nao so a busca), por exemplo checando se os passos do guia aparecem na resposta;
- usar checksum/freshness para recrawlear apenas paginas alteradas e agendar o crawl.
