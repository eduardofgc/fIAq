# Relatório Executivo — Arquitetura e Deploy do fIAq

> **Documento histórico (junho de 2026).** Desde então a produção saiu da
> Vercel + Supabase gerenciado e foi para o Coolify com Supabase self-hosted
> (<https://fiaq.porto.ooo>), e o schema ganhou as migrations 06 a 09
> (feedback, curadoria administrativa, Realtime e nível de confiança). O estado
> atual está em [`DEPLOY.md`](./DEPLOY.md) e [`../db/README.md`](../db/README.md).

**Status em 24/06/2026:** a migração SvelteKit/Vite está validada no branch/PR; a produção pública continua em `https://fiaq-app.vercel.app` até o merge/deploy em `main`.

## Visão geral

O fIAq é um portal acadêmico do CIC/UnB com FAQ navegável e assistente virtual com IA. Este branch organiza a aplicação como um app **SvelteKit + Vite**, localizado em `fiaq-app/`, com rotas server para chat, FAQ, saúde do banco e perguntas em alta. Após merge e deploy em `main`, a entrega roda no caminho gratuito **Vercel Hobby + Supabase Free + OpenRouter**, mantendo frontend, APIs e streaming de resposta no mesmo deploy web.

## Deploy web

| Item | Configuração atual |
|---|---|
| URL pública | `https://fiaq-app.vercel.app` |
| Projeto Vercel | `fernandos-projects-8b069a52/fiaq-app` |
| Repositório | `fernando-augustop/trabalho-tp2-fiaq-2026.1` |
| Root Directory | `fiaq-app` |
| Framework | SvelteKit/Vite no branch de migração |
| Install | `pnpm install` |
| Build | `pnpm build` |
| Output | gerenciado pelo adapter SvelteKit |
| Funções | rotas server SvelteKit em Vercel Function com janela de 60s para streaming SSE |

As variáveis de ambiente esperadas estão documentadas para Vercel produção, preview e desenvolvimento. A chave do OpenRouter e a URL do banco ficam como segredos/encrypted envs, sem versionamento no repositório.

## IA, modelos e RAG

| Função | Provider | Modelo |
|---|---|---|
| Chat/geração de resposta | OpenRouter | `google/gemma-4-31b-it:free` |
| Embeddings/busca semântica | OpenRouter | `nvidia/llama-nemotron-embed-vl-1b-v2:free` |

O enriquecimento da IA é feito por **RAG em Postgres/pgvector**. As fontes institucionais ficam em `fiaq-app/data/`: FAQ curado, páginas crawleadas da UnB/CIC e PDFs oficiais. O seed `pnpm seed:knowledge` transforma esse conteúdo em documentos e chunks, gera embeddings com o modelo acima e grava tudo em `rag_documento`/`rag_chunk`. O fallback `fiaq-app/server/assets/rag-index.json` continua versionado apenas para desenvolvimento ou recuperação se o banco estiver indisponível.

No runtime, `/api/chat` recebe a pergunta, gera o embedding, busca os 5 chunks mais relevantes no banco por cosine distance via `buscar_rag_chunks`, monta o contexto, chama o modelo de chat via OpenRouter e transmite a resposta em SSE. A resposta é obrigada pelo prompt de sistema a usar somente o contexto recuperado; links não são inventados nem escritos no texto, pois as fontes oficiais são retornadas separadamente para a interface.

## Arquitetura Supabase

O Supabase hospeda o Postgres de produção no projeto `dwjzjuqtsgrvbiwjvemu`. A conexão da Vercel usa o Transaction Pooler em `aws-1-us-west-1.pooler.supabase.com:6543`, com a role limitada `fiaq_app`, `sslmode=require` e `postgres.js` configurado com `prepare: false`, `max: 1`, `idle_timeout: 20` e `connect_timeout: 10`, adequado ao ambiente serverless.

O schema público tem seis tabelas:

| Domínio | Tabelas | Papel |
|---|---|---|
| Conteúdo FAQ | `faq_categoria`, `faq_entrada` | Estrutura navegável do FAQ |
| Conhecimento RAG | `rag_documento`, `rag_chunk` | Chunks com embeddings pgvector para busca semântica |
| Métricas anônimas | `pergunta_registrada`, `ocorrencia_pergunta` | Agrupamento semântico, contagem e histórico de ocorrências |

Todas as tabelas estão com RLS habilitado. A role `fiaq_app` recebe apenas `SELECT` no FAQ/RAG, `EXECUTE` na função `buscar_rag_chunks`, `SELECT/INSERT/UPDATE` em `pergunta_registrada` e `SELECT/INSERT` em `ocorrencia_pergunta`. O app não possui login de usuário nem histórico identificado: o registro é anônimo e agregado. Perguntas semanticamente parecidas são comparadas por similaridade de cosseno entre embeddings do mesmo modelo; perguntas equivalentes incrementam `total_vezes`, e cada ocorrência guarda resposta e fontes usadas.

## Organização e evidências

O repositório separa app, banco e documentação: `fiaq-app/` contém frontend, APIs e RAG; `db/` contém SQL reaplicável e hardening Supabase; `docs/DEPLOY.md` documenta o caminho operacional; este relatório resume a arquitetura para entrega. A validação do branch confirmou `/api/health/db` OK, `/api/faq` com 7 categorias e 85 entradas e chat em preview local respondendo via OpenRouter sem erro SSE. A validação de produção deve ser repetida após o merge em `main`.
