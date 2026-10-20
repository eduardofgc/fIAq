# Desenvolvimento local

Este guia descreve o caminho recomendado para rodar o fIAq localmente com a
mesma suite usada no deploy: app SvelteKit/Vite, APIs server do SvelteKit, Supabase Postgres com
pgvector e OpenRouter para chat/embeddings.

## Fluxo recomendado

Rode tudo a partir da raiz do repositório:

```bash
pnpm install
pnpm dev
```

O script da raiz chama `pnpm --dir fiaq-app dev`, então não é preciso entrar em
`fiaq-app/` manualmente. O servidor local tenta abrir `http://127.0.0.1:3000/`.
Se a porta estiver ocupada, rode com `pnpm --dir fiaq-app dev --port 3001`. Use
sempre a URL impressa no terminal.

Esse comando sobe:

- app SvelteKit/Vite com Svelte 5;
- APIs server do SvelteKit em `/api/*`;
- conexão com Supabase via `DATABASE_URL`;
- OpenRouter para chat e embeddings quando `CHAT_PROVIDER=openrouter` e
  `EMBED_PROVIDER=openrouter`.

## Variáveis locais

As variáveis ficam em `fiaq-app/.env`. Esse arquivo não deve ser versionado.
Para criar um novo ambiente local:

```bash
cp fiaq-app/.env.example fiaq-app/.env
```

Para chegar perto da produção, use providers OpenRouter e um banco com o schema
aplicado. O banco de produção (Coolify) não é acessível de fora do servidor,
então localmente use o Postgres com Docker de [`db/SETUP.md`](../db/SETUP.md) ou
um Supabase próprio. Exemplo com Supabase gerenciado (Transaction Pooler):

```env
CHAT_PROVIDER=openrouter
EMBED_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_CHAT_MODEL=google/gemma-4-31b-it:free
OPENROUTER_CHAT_FALLBACK_MODELS=nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free
OPENROUTER_STREAM_PREFLIGHT_CHARS=32
OPENROUTER_EMBED_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free
DATABASE_URL=postgresql://fiaq_app.PROJECT_REF:SENHA@REGIAO.pooler.supabase.com:6543/postgres?sslmode=require
FIRECRAWL_API_URL=https://seu-firecrawl.example
FIRECRAWL_API_KEY=
FIRECRAWL_INCLUDE_DOMAINS=cic.unb.br,www.cic.unb.br,unb.br,www.unb.br,saa.unb.br,sigaa.unb.br
FIRECRAWL_SEARCH_LIMIT=4
```

Notas importantes:

- Sem `DATABASE_URL`, o app funciona com o fallback
  `server/assets/rag-index.json` (sem FAQ do banco, métricas nem admin). É o
  jeito mais rápido de testar mudanças no chat e no ranking.
- A `DATABASE_URL` do runtime deve usar a role limitada `fiaq_app`.
- Com o pooler do Supabase, use porta `6543` e `sslmode=require`; o app usa
  `postgres.js` com `prepare: false`, compatível com o pooler.
- Prefira modelo gratuito fixo em `OPENROUTER_CHAT_MODEL`; `openrouter/free`
  roteia aleatoriamente e pode escolher um modelo menos adequado para português.
- `OPENROUTER_STREAM_PREFLIGHT_CHARS` controla quantos caracteres o backend
  acumula antes de liberar o streaming da resposta; o padrão é `32`.
- Embeddings precisam continuar no mesmo modelo usado no seed do RAG.
- Nunca commite `OPENROUTER_API_KEY`, senha do banco ou connection string real.
- A busca Firecrawl é acionada quando o usuário marca "Não me ajudou" e também
  automaticamente quando uma pergunta de escopo UnB não tem contexto local forte
  no RAG.
- `FIRECRAWL_SEARCH_LIMIT` limita quantos resultados web entram no contexto; o
  padrão é `4`.

## Validar a suite completa

Depois que o `pnpm dev` imprimir a URL local, defina a porta usada:

```bash
PORT=3000
```

Se você subiu em outra porta, ajuste:

```bash
PORT=3001
```

Valide o banco:

```bash
curl "http://localhost:${PORT}/api/health/db"
```

Resposta esperada:

```json
{
  "ok": true,
  "configured": true
}
```

Valide o FAQ vindo do backend:

```bash
curl -sS -o /tmp/fiaq-faq.json \
  -w '%{http_code} %{content_type} %{size_download}\n' \
  "http://localhost:${PORT}/api/faq"
```

Resposta esperada: `200 application/json ...`. No terminal do servidor, o log
deve indicar que o FAQ foi carregado de `database`.

Valide chat, embeddings, RAG e streaming SSE:

```bash
timeout 90s curl -sS -N \
  -X POST "http://localhost:${PORT}/api/chat" \
  -H 'Content-Type: application/json' \
  --data '{"messages":[{"role":"user","content":"Como faço matrícula em disciplina?"}]}'
```

Resposta esperada:

- eventos `token`;
- um evento `sources`;
- um evento final `done`;
- log no servidor com `Contexto RAG carregado de database`.

Valide o registro anônimo agregado de perguntas:

```bash
curl "http://localhost:${PORT}/api/perguntas/em-alta?dias=7&limite=5"
```

Esse endpoint confirma que a pergunta passou pelo fluxo de gravação no
Supabase.

Valide o reforço web sob demanda:

1. Envie uma pergunta no chatbot.
2. Espere a primeira resposta terminar.
3. Abra **Avaliar** na resposta e clique em **Não me ajudou**.
4. A resposta seguinte deve exibir o selo "Pesquisa web" e fontes clicáveis
   vindas do Firecrawl.

## Fluxo atual de RAG, pesquisa e curadoria

O fluxo implementado segue o desenho de curadoria da entrega: o chatbot tenta
responder com RAG primeiro, pesquisa fontes oficiais quando o contexto local não
é forte o suficiente ou quando o usuário pede complemento, e só transforma uma
resposta pesquisada em conhecimento permanente depois de feedback positivo e
aprovação administrativa.

```mermaid
flowchart LR
  A[Pergunta] --> B[/api/chat]
  B --> C[Saruê]
  C <--> D[(Supabase Postgres)]
  D <--> E[RAG pgvector]
  C --> F{Contexto RAG suficiente?}
  F -- Sim --> G[Responde com fontes RAG]
  F -- Não --> H[Pesquisa Firecrawl em fontes oficiais]
  H --> I[Responde com fontes web]
  G --> J{Avaliação do usuário}
  I --> J
  J -- Negativa --> H
  J -- Positiva + resposta RAG --> K[Obrigado pelo feedback]
  J -- Positiva + resposta web --> L[web_resposta_candidata]
  L --> M[/admin: curadoria por mantenedores]
  M -- Aprovar --> N[rag_documento + rag_chunk]
  M -- Rejeitar --> O[Resposta rejeitada]
  N --> D
```

Diferenças intencionais em relação ao fluxograma manual:

- A decisão "Resposta satisfatória?" não é uma etapa automática antes da
  resposta. No app, ela acontece depois da resposta, pela avaliação do usuário.
- A decisão "Resposta veio do RAG?" não aparece como tela separada. O backend
  marca as fontes como `rag` ou `web`; só respostas com fonte `web` podem virar
  candidatas de curadoria.
- O caminho de pesquisa pode acontecer em dois momentos: automaticamente na
  primeira pergunta, quando o RAG local é fraco para uma pergunta de escopo UnB,
  ou depois de feedback negativo.
- O `/admin` não escreve direto no RAG sem revisão: ele lista candidatas,
  registra aprovação/rejeição e, apenas na aprovação, cria o documento e o chunk
  permanentes.

## Simular o deploy localmente

Para validar o bundle de produção, rode:

```bash
pnpm build
pnpm preview
```

Use os mesmos endpoints da seção anterior contra a porta impressa pelo
`pnpm preview`. O `pnpm dev` continua sendo o comando diário mais rápido; o
`build` + `preview` serve para validar o bundle SvelteKit/Vite e as rotas server de preview.

## Adicionar ou atualizar conhecimento

O conhecimento vive em `fiaq-app/data/`:

| Pasta | Conteúdo | Nível de confiança |
|---|---|---|
| `faq/*.json` | FAQ do CIC, gerado por `pnpm build:faq` a partir de `data/sources/` | sempre `oficial` |
| `pdfs/*.pdf` | Editais, resoluções e manuais | sempre `oficial` |
| `crawl/*.md` | Páginas de sites da UnB e guias escritos à mão | depende do domínio da `url` |

O nível de um arquivo de `crawl/` vem do domínio no campo `url`: domínios em
`OFICIAL_HOSTS` (`fiaq-app/scripts/trustLevel.mjs`) são `oficial`; o resto é
`institucional` e nunca é considerado contexto suficiente sozinho.

### Fluxo para adicionar um arquivo

Rode da pasta `fiaq-app/` (precisa de `OPENROUTER_API_KEY` e
`EMBED_PROVIDER=openrouter` no `.env`):

```bash
# 1. crie ou edite data/crawl/<slug>.md (formato abaixo)
# 2. gere o embedding só desse arquivo e grave no índice local
node scripts/add-crawl-file.mjs <slug>          # aceita vários slugs
# 3. se mudou a lista OFICIAL_HOSTS, reclassifique o índice (sem re-embedar)
node scripts/tag-trust-level.mjs
# 4. adicione um caso em scripts/eval-rag-casos.json e confira o ranking
pnpm eval:rag
# 5. commite data/crawl/<slug>.md junto com server/assets/rag-index.json
```

Depois do deploy, rode o seed em produção (ver
[`DEPLOY.md`](./DEPLOY.md#4-popular-e-atualizar-o-conhecimento-seed)). Como o
seed reaproveita os vetores do `rag-index.json`, o que foi embedado localmente
não gasta cota de novo. O `pnpm index:rag` regenera o índice inteiro e gasta
uma chamada por trecho: evite com a cota gratuita.

### Formato de um arquivo de `crawl/`

```markdown
---
title: Como pedir revisão de menção (nota final de disciplina): passo a passo
url: https://saa.unb.br/graduacao/formularios
contexto: secretaria-academica
source: manual-research
discovered_at: 2026-10-06T00:00:00.000Z
---
Corpo em texto corrido ou com listas.
```

Arquivos com mais de 500 palavras são divididos em trechos ("parte 1", "parte
2"). Cada trecho vai para o modelo com até 3.800 caracteres.

### Regras para guias "como fazer"

Os guias passo a passo (`*-guia-*.md`) existem para que perguntas do tipo "como
faço..." recebam o procedimento completo. Ao escrever um:

- **Use só fonte oficial**: página ou manual do órgão responsável, lido na hora.
  Se as fontes oficiais se contradizem, diga isso no texto em vez de escolher
  uma. Se não há fonte oficial, não escreva o guia.
- **Título com "passo a passo"** ou começando com "Como...": o ranking dá
  prioridade a esses títulos em perguntas de procedimento.
- **Passos primeiro**, em lista numerada, com caminhos exatos de menu
  (`Portal do Discente > Ensino > ...`) e nomes exatos de tipos de processo do
  SEI. Regras, exceções e contatos vêm depois.
- **Siglas por extenso** na primeira menção (Decanato de Ensino de Graduação,
  DEG), senão o modelo pode inventar o significado.
- **Sem travessão**: a interface não usa travessão, e o título aparece no aviso
  "Consultado do banco de dados (...)".
- E-mails de contato podem ficar no texto; URLs e domínios soltos são removidos
  do contexto antes de ir para o modelo.

### Avaliar a busca e o ranking

```bash
pnpm eval:rag             # resumo e falhas
pnpm eval:rag --verbose   # top 3 de todos os casos
```

O script roda a mesma busca e o mesmo ranking do `/api/chat`
(`server/utils/chatRetrieval.ts`) sobre o `rag-index.json`, sem banco e sem
chamar o modelo de chat. Cada caso de `scripts/eval-rag-casos.json` tem:

```json
{ "pergunta": "como tranco uma disciplina?",
  "esperado": ["crawl-saa-unb-br-guia-trancamento-sigaa"],
  "web": false }
```

- `esperado`: ids de documento (sem o sufixo `-1`, `-2` dos trechos) que
  respondem à pergunta; basta um deles entre os 3 trechos usados pelo chat.
- `web` (opcional): se o chat deve ou não ir para a pesquisa web.
- `historico` (opcional): perguntas anteriores, para testar continuações.

A saída mostra a posição do documento esperado e a decisão web de cada caso, e
o comando termina com erro se algum caso falhar. Os embeddings das perguntas
ficam em `scripts/eval-rag-cache.json` (commitado); só perguntas novas gastam
cota. O `esperado` diz qual documento **deveria** responder: se um caso falhar,
corrija o conteúdo ou o ranking, não o caso.

### Seed completo

O seed lê tudo de `data/` e grava no banco. Use uma connection string com
permissão de escrita (a role administrativa, não a `fiaq_app`):

```bash
DATABASE_URL="postgresql://postgres:..." \
OPENROUTER_API_KEY="..." \
EMBED_PROVIDER=openrouter \
OPENROUTER_EMBED_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free \
pnpm seed:knowledge
```

O modelo de embedding usado no seed precisa ser o mesmo configurado no runtime;
caso contrário, a busca em `rag_chunk.embedding` fica inconsistente. O seed é
retomável: gera no máximo `SEED_MAX_EMBEDDINGS` embeddings novos por execução
(padrão 40) e, se a cota acabar, grava o que conseguiu.

## Alternativa com Postgres local

Para desenvolver sem Supabase remoto, siga [`db/SETUP.md`](../db/SETUP.md).
Esse caminho usa Docker + `pgvector/pgvector:pg16` e troca a `DATABASE_URL` para
um Postgres local. Ele é útil quando o Supabase estiver indisponível, mas o
caminho mais fiel ao deploy continua sendo `pnpm dev` com a URI do Supabase.

## Diagnóstico rápido

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Porta `3000` ocupada | Outro processo já usa a porta | Rode `pnpm --dir fiaq-app dev --port 3001` |
| `/api/health/db` retorna `configured: false` | `DATABASE_URL` ausente | Confira `fiaq-app/.env` |
| `/api/health/db` retorna `ok: false` | Banco indisponível ou URI inválida | Verifique senha, pooler `:6543` e `sslmode=require` |
| Chat retorna `LLM_UNAVAILABLE` | OpenRouter indisponível, chave inválida ou cota diária esgotada | Confira `OPENROUTER_API_KEY`; erro `429 free-models-per-day` é cota (ver `DEPLOY.md`) |
| Embedding falha com `429 free-models-per-min` | Mais de 20 requisições por minuto | O seed espera e tenta de novo sozinho; com o `add-crawl-file.mjs`, espere um minuto e rode de novo |
| RAG carrega fallback JSON | Banco/RAG indisponível ou sem seed | Rode o healthcheck e revise `pnpm seed:knowledge` |
| Pergunta coberta pela base cai na pesquisa web | Trecho certo não ficou em 1º ou cobertura de termos baixa | Adicione a pergunta em `scripts/eval-rag-casos.json` e rode `pnpm eval:rag --verbose`; no servidor, veja o log `chat_research_decision` |
| `pnpm lint` quebra com `eslint-typegen ... .nuxt/eslint.config.mjs` | Pasta `.nuxt/` da versão Nuxt sendo lida | Confira se `.nuxt/**` está em `ignores` no `eslint.config.mjs` |
