# Setup do Banco de Dados

> Este documento cobre o setup do banco de dados. Antes de prosseguir, garanta
> que o setup geral do app foi concluído conforme o [README raiz](../README.md)
> (`pnpm install`).

## Arquivos

| Arquivo | Conteúdo | Ordem |
|---|---|---|
| `01_faq_tabelas.sql` | Tabelas do FAQ (faq_categoria, faq_entrada) | 1º |
| `02_perguntas_tabelas.sql` | Tabelas de análise (pergunta_registrada, ocorrencia_pergunta) | 2º |
| `04_rag_pgvector.sql` | Extensão pgvector, tabelas RAG e função de busca | 3º |
| `05_supabase_rag_search_hardening.sql` | Hardening idempotente da função RAG | 4º |
| `06_avaliacao_resposta.sql` | Feedback anônimo das respostas (avaliacao_resposta) | 5º |
| `03_supabase_app_role.sql` | Role limitada `fiaq_app`, grants e RLS | 6º |
| `07_admin_rag_review.sql` | Admin, fila de curadoria e aprovação para RAG | 7º |
| `08_admin_curadoria_realtime.sql` | Publicação Realtime segura da fila de curadoria (**só Supabase**) | 8º |
| `09_rag_nivel_confianca.sql` | Coluna `nivel_confianca` (oficial/institucional) e nova `buscar_rag_chunks` | 9º |

A ordem difere da numeração dos arquivos: `02_` e `04_` dependem de
`faq_entrada`; o `03_` concede permissões em tabelas do `04_` e do `06_`, então
precisa rodar depois deles; `07_` e `09_` vêm depois da role existir. O `08_`
usa `auth.jwt()`, as roles `anon`/`authenticated` e a publicação
`supabase_realtime`, que só existem no Supabase: **pule o `08_` no Postgres
local**.

Os scripts podem ser reaplicados, com uma exceção: depois que o `09_` rodou,
reaplicar o `04_` ou o `05_` falha com `cannot change return type of existing
function` (eles recriam a versão antiga de `buscar_rag_chunks`). É esperado e
inofensivo: a versão do `09_` continua valendo.

Essa sequência foi validada aplicando tudo num `pgvector/pgvector:pg16` vazio.

## Variáveis de ambiente

O arquivo `.env.example` em `fiaq-app/` documenta todas as variáveis necessárias,
incluindo os dois formatos de `DATABASE_URL` (local e banco gerenciado).

---

## Subindo o Postgres localmente com Docker

> **Linux — permissão Docker**
> Se ao rodar `docker run` você receber `permission denied`, adicione seu usuário
> ao grupo Docker e reabra o terminal:
> ```bash
> sudo usermod -aG docker $USER
> newgrp docker   # aplica sem precisar fazer logout
> ```

### Passo 1 — Criar e iniciar o container

#### Linux/Mac (bash ou zsh)

```bash
docker run -d \
  --name fiaq-postgres \
  -e POSTGRES_USER=fiaq \
  -e POSTGRES_PASSWORD=fiaq123 \
  -e POSTGRES_DB=fiaq \
  -p 5432:5432 \
  pgvector/pgvector:pg16
```

#### Windows (PowerShell)

```powershell
docker run -d `
  --name fiaq-postgres `
  -e POSTGRES_USER=fiaq `
  -e POSTGRES_PASSWORD=fiaq123 `
  -e POSTGRES_DB=fiaq `
  -p 5432:5432 `
  pgvector/pgvector:pg16
```

Aguarde ~5 segundos e verifique se subiu (igual nos dois sistemas):

```bash
docker logs fiaq-postgres
```

Procure `database system is ready to accept connections` no final da saída.

---

### Passo 2 — Criar o .env com DATABASE_URL

Agora que você tem as credenciais do container criado no passo anterior,
crie o arquivo `.env` em `fiaq-app/` e preencha o banco:

```bash
cd fiaq-app
cp .env.example .env
```

Abra o `.env` e edite a linha `DATABASE_URL` com as credenciais que você
usou no `docker run` (os valores de exemplo abaixo correspondem ao Passo 1):

```
DATABASE_URL=postgresql://fiaq:fiaq123@localhost:5432/fiaq
```

Se você tiver alterado `POSTGRES_USER`, `POSTGRES_PASSWORD` ou `POSTGRES_DB`
no Passo 1, use os seus valores aqui.

---

### Passo 3 — Aplicar os SQLs

Execute os comandos abaixo a partir da pasta `db/` do repositório,
**nesta ordem**.

#### Linux/Mac

```bash
for f in 01_faq_tabelas 02_perguntas_tabelas 04_rag_pgvector \
         05_supabase_rag_search_hardening 06_avaliacao_resposta \
         03_supabase_app_role 07_admin_rag_review 09_rag_nivel_confianca; do
  docker exec -i fiaq-postgres psql -U fiaq -d fiaq -v ON_ERROR_STOP=1 < $f.sql
done
```

O `08_admin_curadoria_realtime.sql` fica de fora: ele depende do Supabase.

#### Windows (PowerShell)

O operador `<` no PowerShell pode causar problemas de encoding (UTF-16).
Use `Get-Content` como alternativa segura:

```powershell
foreach ($f in '01_faq_tabelas','02_perguntas_tabelas','04_rag_pgvector',
               '05_supabase_rag_search_hardening','06_avaliacao_resposta',
               '03_supabase_app_role','07_admin_rag_review','09_rag_nivel_confianca') {
  Get-Content "$f.sql" | docker exec -i fiaq-postgres psql -U fiaq -d fiaq -v ON_ERROR_STOP=1
}
```

---

### Passo 4 — Verificar as tabelas criadas

Igual nos dois sistemas:

```bash
docker exec -it fiaq-postgres psql -U fiaq -d fiaq -c "\dt"
```

Saída esperada, com 9 tabelas:

```
                List of relations
 Schema |          Name          | Type  | Owner
--------+------------------------+-------+-------
 public | admin_usuario          | table | fiaq
 public | avaliacao_resposta     | table | fiaq
 public | faq_categoria          | table | fiaq
 public | faq_entrada            | table | fiaq
 public | ocorrencia_pergunta    | table | fiaq
 public | pergunta_registrada    | table | fiaq
 public | rag_chunk              | table | fiaq
 public | rag_documento          | table | fiaq
 public | web_resposta_candidata | table | fiaq
```

Para popular FAQ e RAG localmente:

```bash
cd ..
DATABASE_URL=postgresql://fiaq:fiaq123@localhost:5432/fiaq \
OPENROUTER_API_KEY=... \
CHAT_PROVIDER=openrouter \
EMBED_PROVIDER=openrouter \
pnpm seed:knowledge
```

---

### Passo 5 — Testar a conexão do app

Em outro terminal (deixe o anterior aberto):

```bash
cd fiaq-app && pnpm dev
```

Aguarde aparecer `http://localhost:3000/` no log. Então acesse o endpoint
de healthcheck no navegador ou com curl:

```bash
curl http://localhost:3000/api/health/db
```

Resposta esperada:

```json
{ "ok": true, "latency_ms": 3 }
```

Se aparecer erro `DATABASE_URL não definida`, confirme que o arquivo
`fiaq-app/.env` existe e que a linha `DATABASE_URL` está preenchida (Passo 2).

---

### Rotina diária

Quando voltar ao projeto em outra sessão:

```bash
docker start fiaq-postgres   # retoma o banco com os dados preservados
```

Em outro terminal:

```bash
cd fiaq-app && pnpm dev
```

Para encerrar ao fim da sessão:

```bash
docker stop fiaq-postgres    # para o container; os dados ficam intactos
```

---

### Limpar tudo (apaga os dados)

```bash
docker stop fiaq-postgres
docker rm fiaq-postgres
```

Use apenas quando quiser recomeçar do zero.

---

## Aplicando os SQLs em outros ambientes

> Esta seção é para **conexões diretas com bancos gerenciados** (Supabase,
> Neon, Railway etc.), quando o `psql` da sua máquina alcança o banco. Para o
> Supabase self-hosted no Coolify (produção atual), o banco não fica exposto:
> aplique pelo terminal do container, como descrito em
> [`docs/DEPLOY.md`](../docs/DEPLOY.md#2-aplicar-o-schema).

Requer o cliente `psql` instalado na máquina. Execute a partir da pasta `db/`:

```bash
for f in 01_faq_tabelas 02_perguntas_tabelas 04_rag_pgvector \
         05_supabase_rag_search_hardening 06_avaliacao_resposta \
         03_supabase_app_role 07_admin_rag_review \
         08_admin_curadoria_realtime 09_rag_nivel_confianca; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f $f.sql
done
```

Fora do Supabase, remova o `08_admin_curadoria_realtime` da lista.
