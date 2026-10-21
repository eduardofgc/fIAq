# Deploy do fIAq

## Status atual

| Item | Valor |
|---|---|
| Produção | <https://fiaq.porto.ooo> |
| Hospedagem | Coolify (servidor `coolify-vm`), projeto **Fiaq-Back**, ambiente **production** |
| App | Recurso *Application*, build pelo `Dockerfile` da raiz do repositório (adapter-node) |
| Banco | Recurso *Service* `supabase-fiaq`: Supabase self-hosted (template do Coolify) com Postgres + pgvector |
| IA | OpenRouter (chat e embeddings) |
| Pesquisa web | Firecrawl, só em domínios oficiais |
| Healthcheck | `curl https://fiaq.porto.ooo/api/health/db` → `{"ok":true,"configured":true,...}` |

> O deploy antigo em <https://fiaq-app.vercel.app> (Vercel + Supabase
> gerenciado) **está fora do ar**: o banco gerenciado responde
> `Banco de dados indisponível` (o plano gratuito pausa por inatividade). O
> caminho continua documentado em [Alternativa: Vercel + Supabase
> gerenciado](#alternativa-vercel--supabase-gerenciado), mas a produção é o Coolify.

Segredos (`OPENROUTER_API_KEY`, senhas do banco, chaves do Supabase) ficam só
nas variáveis de ambiente do Coolify. Nunca commite esses valores.

## Arquitetura no Coolify

```mermaid
flowchart LR
  U[Navegador] -->|HTTPS| APP[Application: fiaq-app<br/>Dockerfile / adapter-node / :3000]
  APP -->|DATABASE_URL<br/>rede interna coolify| DB[(supabase-db<br/>Postgres + pgvector)]
  U -->|VITE_SUPABASE_URL| KONG[Kong do Supabase<br/>Auth do /admin]
  KONG --> DB
  APP -->|chat + embeddings| OR[OpenRouter]
  APP -->|fallback web| FC[Firecrawl]
```

Os dois recursos ficam no mesmo projeto do Coolify. O app só fala com o banco
pela rede Docker interna; a porta 5432 não é exposta para fora do servidor.

## 1. Banco: serviço Supabase no Coolify

1. No projeto, crie um recurso **Service** a partir do template **Supabase**.
2. Na aba **General** do serviço, em **Network attachment**, troque *Use the
   stack network only* pela opção que também conecta o serviço à rede
   compartilhada do Coolify. Sem isso o app não enxerga o banco.
3. Se o pull da imagem `quay.io/minio/mc` falhar com `401 Unauthorized` (a
   MinIO Inc. deixou de publicar imagens públicas em 2025), apague o serviço
   `minio-createbucket` em **Edit Compose File**. Ele só cria o bucket do
   Storage na primeira subida, e o fIAq não usa o Storage do Supabase.
4. Faça o **Deploy/Restart** e confira que o serviço fica *Running*.

### Nome do host do banco

Dentro do stack do Supabase o Postgres se chama `supabase-db`, mas **esse nome
não resolve a partir do app**. Na rede compartilhada do Coolify o container é
encontrado pelo nome completo, com o ID do serviço como sufixo:

```text
supabase-db-<id-do-servico>      # em produção: supabase-db-jvxz0jtkhtllxp32ftrbdbus
```

O ID aparece nos logs de deploy do serviço (`Container supabase-db-<id> Started`).
Para conferir de dentro do terminal do app:

```bash
getent hosts supabase-db-<id-do-servico>   # deve imprimir um IP
```

## 2. Aplicar o schema

Abra o **Terminal** do container `supabase-db` no Coolify e use o `psql`:

```bash
psql -U postgres -d postgres
```

Aplique os SQLs de `db/` **nesta ordem** (a ordem difere da numeração dos
arquivos, porque o `03_` concede permissões em tabelas criadas pelo `04_` e
pelo `06_`):

```text
01_faq_tabelas.sql
02_perguntas_tabelas.sql
04_rag_pgvector.sql
05_supabase_rag_search_hardening.sql
06_avaliacao_resposta.sql
03_supabase_app_role.sql
07_admin_rag_review.sql
08_admin_curadoria_realtime.sql   # só funciona em Supabase (auth.jwt, Realtime)
09_rag_nivel_confianca.sql
```

Os arquivos não existem dentro do container, então o conteúdo precisa ser
colado no terminal web. **O terminal do Coolify corrompe colagens grandes**
(duplica ou perde trechos). O que funcionou de forma confiável:

- colar blocos pequenos (até umas 30 linhas) de cada vez; ou
- usar comandos de uma linha: `psql -U postgres -d postgres -c "..."`.

Os SQLs usam `IF NOT EXISTS` e `DROP ... IF EXISTS`, então dá para reaplicar um
bloco que falhou no meio. A exceção: **depois que o `09_` rodou, reaplicar o
`04_` ou o `05_` falha** com `cannot change return type of existing function`,
porque eles tentam recriar a versão antiga de `buscar_rag_chunks`. O erro é
inofensivo (a versão do `09_` continua valendo); só não tente "consertá-lo"
apagando a função. Para conferir o resultado:

```bash
psql -U postgres -d postgres -c "\dt"
psql -U postgres -d postgres -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'public';"
psql -U postgres -d postgres -P pager=off -c "\df buscar_rag_chunks"
```

O container não tem `less`: comandos `\d...` precisam de `-P pager=off`.

## 3. App: Application no Coolify

| Campo | Valor |
|---|---|
| Build strategy | Dockerfile |
| Base directory | `/` |
| Dockerfile location | `/Dockerfile` |
| Ports exposes | `3000` |
| Branch | `main` |

O `Dockerfile` da raiz compila com `DEPLOY_TARGET=node` (adapter-node) e
copia para a imagem final `build/`, `scripts/`, `data/` e `server/assets/`.
Os três últimos existem para que os seeds possam rodar de dentro do container.

### Variáveis de ambiente

```env
DATABASE_URL=postgresql://<usuario>:<senha>@supabase-db-<id-do-servico>:5432/postgres
CHAT_PROVIDER=openrouter
EMBED_PROVIDER=openrouter
OPENROUTER_API_KEY=<secret>
OPENROUTER_CHAT_MODEL=google/gemma-4-31b-it:free
OPENROUTER_CHAT_FALLBACK_MODELS=nvidia/nemotron-3-ultra-550b-a55b:free,nvidia/nemotron-3-super-120b-a12b:free
OPENROUTER_EMBED_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free
FIRECRAWL_API_URL=<vazio usa https://api.firecrawl.dev>
FIRECRAWL_API_KEY=<secret; obrigatória com api.firecrawl.dev>
FIRECRAWL_INCLUDE_DOMAINS=cic.unb.br,www.cic.unb.br,unb.br,www.unb.br,saa.unb.br,sigaa.unb.br
VITE_SUPABASE_URL=<URL pública do Kong do serviço Supabase>   # marcar como Build Variable
VITE_SUPABASE_ANON_KEY=<anon key do serviço Supabase>        # marcar como Build Variable
SUPABASE_SERVICE_ROLE_KEY=<secret>
ADMIN_BOOTSTRAP_EMAILS=<e-mail do primeiro admin>
APP_URL=https://fiaq.porto.ooo
ADMIN_BASE_URL=https://fiaq.porto.ooo
```

- As `VITE_*` são embutidas no bundle do navegador **durante o build** (são
  `ARG` no `Dockerfile`). Mudou alguma? Faça um novo deploy, não só restart.
- O modelo de embedding precisa ser o mesmo usado no seed (ver passo 4).
- Sem `FIRECRAWL_API_KEY`, o app usa o acesso sem chave do Firecrawl, que
  tem limite muito baixo: quando estoura, toda pesquisa web volta vazia (o
  "Não me ajudou" falha e perguntas sobre assuntos atuais ficam sem fontes).
  Cada pergunta que vai para a web pode fazer mais de uma busca; acompanhe os
  créditos no painel do Firecrawl.
- Hoje a produção conecta com o usuário `postgres`. O recomendado é usar a role
  limitada `fiaq_app` criada pelo `03_` (`ALTER ROLE fiaq_app WITH LOGIN
  PASSWORD '...'`) e trocar a `DATABASE_URL`, já que o seed roda com o usuário
  administrativo de qualquer forma.

### Publicar uma nova versão

1. Faça merge na `main`.
2. No Coolify, abra a Application e clique em **Redeploy**.
3. Valide `https://fiaq.porto.ooo/api/health/db`.
4. Se a mudança alterou `fiaq-app/data/` ou `server/assets/rag-index.json`,
   rode o seed (passo 4).

## 4. Popular e atualizar o conhecimento (seed)

O seed roda **dentro do container do app** (Terminal da Application no
Coolify), porque só ele enxerga o banco e já tem `DATABASE_URL` e
`OPENROUTER_API_KEY`:

```bash
node scripts/seed-knowledge.mjs
```

Ele lê `data/faq/`, `data/pdfs/` e `data/crawl/`, grava em `faq_*`,
`rag_documento` e `rag_chunk` com upsert, e desativa documentos que saíram de
`data/`. Comportamentos importantes:

- **Reaproveita embeddings locais.** Antes de chamar a API, procura o vetor do
  trecho em `server/assets/rag-index.json`, que vai dentro da imagem. Trechos
  já embedados localmente não gastam cota. Por isso, ao adicionar conteúdo,
  embede localmente primeiro (ver [`DESENVOLVIMENTO.md`](./DESENVOLVIMENTO.md))
  e commite o `rag-index.json` junto.
- **Pula o que já está no banco** e não mudou (compara o checksum do documento,
  que inclui o título).
- **Retomável.** Gera no máximo `SEED_MAX_EMBEDDINGS` embeddings novos por
  execução (padrão 40) e, se a cota diária do OpenRouter acabar, grava o que
  conseguiu e para. Basta rodar de novo depois.

Ao final ele imprime quantos trechos foram reaproveitados, quantos foram
gerados e quantos ainda faltam.

## 5. Cota do OpenRouter

Os modelos `:free` do OpenRouter têm limite **por conta**, somando chat e
embeddings:

| Saldo de créditos já comprado na conta | Limite dos modelos gratuitos |
|---|---|
| menos de US$ 10 | 50 requisições por dia |
| US$ 10 ou mais (compra única) | 1000 requisições por dia |

Há também um limite de 20 requisições por minuto. Com 50 por dia, testes e
seeds esgotam a cota e o chat de produção passa a responder *"o gerador de
resposta ficou indisponível"* até o reset diário (21h no horário de Brasília).
Antes de apresentações, garanta a cota de 1000 por dia e evite rodar seed no
mesmo dia.

Os modelos `:free` registram prompts e respostas: servem para demonstração
acadêmica, não para dados sensíveis.

## 6. Administradores

O `/admin` usa o Auth (GoTrue) do Supabase. Para o primeiro acesso, coloque o
e-mail em `ADMIN_BOOTSTRAP_EMAILS`, crie o usuário no Studio do Supabase
(**Authentication → Users**) e entre no `/admin`. Depois disso, novos admins
são convidados pela própria interface: o servidor usa
`SUPABASE_SERVICE_ROLE_KEY` para chamar o convite do Auth e grava o e-mail em
`admin_usuario`. Convites dependem de SMTP configurado no serviço Supabase.

Os redirects dos convites usam `ADMIN_BASE_URL`, `APP_URL` ou `VERCEL_URL`,
nunca o `Host` da requisição.

## 7. Validar

```bash
curl https://fiaq.porto.ooo/api/health/db
curl -sS -o /dev/null -w '%{http_code}\n' https://fiaq.porto.ooo/api/faq
```

E no chat:

1. Uma pergunta coberta pela base (ex.: "como tranco uma disciplina?") deve
   mostrar **"Consultado do banco de dados (...)"** abaixo da resposta.
2. Uma pergunta sobre algo atual (ex.: "quais as últimas notícias da UnB?")
   deve mostrar **Fontes verificadas** com fontes web.

Para conferir a base no banco (terminal do `supabase-db`):

```bash
psql -U postgres -d postgres -c "SELECT origem, nivel_confianca, count(*) FROM rag_chunk WHERE ativo GROUP BY 1, 2;"
```

## Diagnóstico

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Seed falha com `getaddrinfo EAI_AGAIN supabase-db` | Nome curto do host não resolve na rede do Coolify | Use `supabase-db-<id-do-servico>` na `DATABASE_URL` (passo 1) |
| `getent hosts` não retorna nada nem com o nome completo | Serviço Supabase só na rede do próprio stack | Ajuste o *Network attachment* (passo 1) e reinicie o serviço |
| Restart do Supabase falha com `quay.io/minio/mc ... 401` | Imagem do MinIO não é mais pública | Remova `minio-createbucket` do compose (passo 1) |
| Chat responde "gerador de resposta ficou indisponível" | Cota diária do OpenRouter esgotada | Aguarde o reset ou adicione créditos (passo 5) |
| Pesquisa web sempre "sem nova fonte"; "Não me ajudou" mostra "Não consegui concluir a resposta" | Firecrawl sem chave (limite do acesso sem chave estourado) ou sem créditos | Configure `FIRECRAWL_API_KEY` (passo 3) e confira os créditos no painel do Firecrawl |
| Seed para com "Cota diária de embeddings esgotada" | Mesma cota | Rode de novo depois do reset; o progresso fica salvo |
| Seed falha com `Cannot find module ... server/utils/...` | Script importando algo fora de `scripts/` | Scripts que rodam no container só podem importar de `scripts/` (a imagem não tem `server/`, só `server/assets/`) |
| `\d` no psql falha com `less: not found` | Container sem pager | Use `psql -P pager=off` |

## Alternativa: Vercel + Supabase gerenciado

Este foi o deploy original. Está documentado para quem quiser reproduzir, mas o
projeto Supabase gerenciado (`dwjzjuqtsgrvbiwjvemu`) está fora do ar.

| Item | Valor |
|---|---|
| URL | <https://fiaq-app.vercel.app> |
| Projeto Vercel | `fernandos-projects-8b069a52/fiaq-app` |
| Root Directory | `fiaq-app` (obrigatório: o app não está na raiz) |
| Framework / Install / Build | SvelteKit / `pnpm install` / `pnpm build` |
| Adapter | adapter-vercel (padrão do `svelte.config.js` quando `DEPLOY_TARGET` não é `node`), `maxDuration` 60s |
| Previews | bloqueados em `fiaq-app/vercel.json`; só `main` gera deploy |

Passos:

1. Crie o projeto no Supabase e aplique os SQLs no SQL Editor, na mesma ordem
   do passo 2.
2. Rode o seed da sua máquina com uma connection string administrativa:

   ```bash
   DATABASE_URL="postgresql://postgres:..." \
   OPENROUTER_API_KEY="..." \
   EMBED_PROVIDER=openrouter \
   OPENROUTER_EMBED_MODEL=nvidia/llama-nemotron-embed-vl-1b-v2:free \
   pnpm seed:knowledge
   ```

3. No runtime, use a **Transaction Pooler URI** (porta `6543`), a role
   limitada `fiaq_app` e SSL:

   ```env
   DATABASE_URL=postgresql://fiaq_app.PROJECT_REF:SENHA@REGIAO.pooler.supabase.com:6543/postgres?sslmode=require
   ```

   O app usa `postgres.js` com `prepare: false`, necessário para o pooler.
4. Configure na Vercel as mesmas variáveis do passo 3, trocando a
   `DATABASE_URL` pela do pooler e as `VITE_SUPABASE_*` pelas do projeto
   gerenciado.
5. Faça push na `main`.

Limitações: o Supabase Free pausa após alguns dias sem uso (foi o que derrubou
este deploy), e o plano Hobby da Vercel limita a duração das funções de
streaming.

Para rodar o fIAq em uma VM própria com `docker compose` (sem Coolify), veja
[`selfhost/README.md`](../selfhost/README.md).
