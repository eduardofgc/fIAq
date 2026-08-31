# fIAq self-hosted — runbook completo

Reconstrói o fIAq inteiro em uma VM (ex.: servidor do professor) com Supabase
auto-hospedado. Sem GPU: inferência e embeddings continuam no OpenRouter.

**Requisitos da VM:** 2 vCPU / 4 GB RAM / 20–30 GB disco, Docker + Docker
Compose. (Referência: o Supabase gerenciado atual roda em um `t4g.nano` com
0,5 GB de RAM e o banco tem 25 MB.)

**O que o fIAq usa do Supabase:** Postgres + pgvector ≥ 0.7 (halfvec/HNSW),
GoTrue (auth por e-mail/senha + convites de admin, exige SMTP) e Realtime
(painel admin). Storage, Edge Functions e PostgREST **não** são usados — todo
acesso a dados é SQL direto via `DATABASE_URL`.

---

## 1. Subir o stack Supabase oficial

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Edite o `.env` do stack (siga o guia oficial: https://supabase.com/docs/guides/self-hosting/docker):

1. **Gere segredos novos** — `POSTGRES_PASSWORD`, `JWT_SECRET` (40+ chars) e,
   a partir do JWT_SECRET, `ANON_KEY` e `SERVICE_ROLE_KEY` (o guia tem o
   gerador). Troque também `DASHBOARD_PASSWORD`.
2. **URLs** — `SITE_URL=http://SEU_HOST:3000`, `API_EXTERNAL_URL=http://SEU_HOST:8000`,
   e `ADDITIONAL_REDIRECT_URLS=http://SEU_HOST:3000/admin` (o fluxo de convite
   redireciona pra `/admin`).
3. **SMTP** (obrigatório pros convites de admin) — `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS`, `SMTP_SENDER_NAME`, `SMTP_ADMIN_EMAIL`.
   Gmail com senha de app resolve pra fins acadêmicos.
4. Opcional: desabilitar signup público (`ENABLE_EMAIL_SIGNUP=false`) — os
   admins entram só por convite; e comentar no `docker-compose.yml` os
   serviços que não usamos (`storage`, `imgproxy`, `functions`) pra economizar RAM.

```bash
docker compose up -d
docker compose ps   # tudo healthy? kong responde em :8000
```

O Postgres do stack já vem com pgvector instalado.

## 2. Aplicar o schema do fIAq

De dentro da VM, na raiz deste repositório, aplique os SQLs **nesta ordem**
(igual ao `db/SETUP.md` — a ordem difere da numeração):

```bash
for f in 01_faq_tabelas 02_perguntas_tabelas 04_rag_pgvector \
         05_supabase_rag_search_hardening 03_supabase_app_role \
         06_avaliacao_resposta 07_admin_rag_review 08_admin_curadoria_realtime; do
  docker compose -f /caminho/supabase/docker/docker-compose.yml \
    exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < db/$f.sql
done
```

## 3. Dar senha ao role do app

```bash
docker compose -f /caminho/supabase/docker/docker-compose.yml exec db \
  psql -U postgres -d postgres -c \
  "ALTER ROLE fiaq_app WITH LOGIN PASSWORD 'UMA_SENHA_FORTE';"
```

## 4. Subir o app

```bash
cd selfhost
cp .env.example .env   # preencha com as chaves geradas no passo 1
docker compose --env-file .env up -d --build
curl http://localhost:3000/api/health/db   # esperado: {"ok":true,...}
```

Notas:
- As `VITE_*` são embutidas no bundle do browser **no build** — se mudar,
  refaça o build (`--build`).
- Se o nome da rede do stack não for `supabase_default`, ajuste em
  `docker-compose.yml` (`docker network ls`).

## 5. Popular os dados (FAQ + RAG)

```bash
docker compose exec fiaq-app node scripts/seed-faq.mjs
docker compose exec fiaq-app node scripts/seed-knowledge.mjs
```

(Os PDFs já estão na imagem em `data/pdfs/`. A reindexação gera embeddings via
OpenRouter — precisa da `OPENROUTER_API_KEY` no `.env`.)

## 6. Admins

Os usuários do GoTrue gerenciado **não migram sozinhos**. Coloque os e-mails em
`ADMIN_BOOTSTRAP_EMAILS`, acesse `/admin` e use "esqueci a senha"/convite para
recriar as contas. Os convites chegam pelo SMTP configurado no passo 1.

## Diferenças vs. produção atual (Vercel + Supabase gerenciado)

| Item | Gerenciado | Self-hosted |
|---|---|---|
| Deploy do app | Vercel (adapter-vercel) | Container Node 22 (`DEPLOY_TARGET=node` → adapter-node) |
| `DATABASE_URL` | Pooler `:6543` (`fiaq_app.REF`) | Direto no serviço `db:5432` (`fiaq_app`) |
| Pausa por inatividade | Sim (free tier, ~7 dias) | Não |
| SMTP dos convites | Embutido no Supabase | Você configura (passo 1.3) |

O deploy na Vercel continua funcionando normalmente: sem `DEPLOY_TARGET=node`,
o `svelte.config.js` segue usando o adapter-vercel.
