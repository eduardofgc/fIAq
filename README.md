# fIAq: Assistente do CIC/UnB

Portal de **perguntas frequentes** e **assistente virtual com IA** do Departamento de
Ciência da Computação da Universidade de Brasília. As informações do CIC e da UnB
estão espalhadas por sites, PDFs e setores; o fIAq reúne tudo numa interface
acessível, com um FAQ navegável por tema e um chatbot que responde em linguagem
natural usando **RAG** (Retrieval-Augmented Generation) sobre conteúdo
institucional oficial.

**Produção:** <https://fiaq.porto.ooo>

Trabalho da disciplina de **Técnicas de Programação 2**, UnB, 2026.1.

## Funcionalidades

- **FAQ por categoria**: perguntas organizadas por tema (matrícula, estrutura
  curricular, atividades de curso, trajetória acadêmica, organizações
  estudantis, coordenação).
- **Assistente virtual com RAG**: responde com base no FAQ do CIC, em PDFs
  oficiais e em páginas de órgãos da UnB (SAA, DEG, DAC, STI, BCE, RU...),
  guardados no Postgres com `pgvector`.
- **Guias passo a passo**: os processos mais comuns da UnB (matrícula,
  trancamento, aproveitamento de estudos, assistência estudantil, estágio,
  diploma, pedidos pelo SEI...) têm guias escritos a partir de manuais e páginas
  oficiais, para que perguntas do tipo "como faço..." recebam o procedimento
  completo.
- **Nível de confiança das fontes**: páginas de órgãos com autoridade sobre
  regras e prazos são `oficial`; grupos estudantis e afins são `institucional`
  e nunca bastam sozinhos para responder.
- **Pesquisa web automática**: quando a base não tem contexto suficiente, a
  pergunta é sobre algo atual ou o aluno pede mais detalhes, o chat pesquisa em
  domínios oficiais (Firecrawl).
- **Transparência das fontes**: respostas montadas só com a base interna mostram
  "Consultado do banco de dados (título)"; respostas com pesquisa web mostram as
  fontes verificadas em chips clicáveis. URLs nunca aparecem soltas no texto.
- **Feedback e curadoria**: "Não me ajudou" aciona um complemento com pesquisa
  web; respostas web bem avaliadas entram numa fila no `/admin`, onde um
  administrador aprova (vira conhecimento permanente) ou rejeita.
- **Métricas anônimas**: perguntas são registradas de forma agregada, sem login
  e sem dados pessoais.
- **Exportação** da pergunta/resposta em PDF, Excel, Markdown, JSON ou TXT.
- **Responsivo e acessível**.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | [SvelteKit](https://svelte.dev/docs/kit) + [Vite](https://vite.dev) (Svelte 5) |
| UI | [shadcn-svelte](https://www.shadcn-svelte.com) + [Tailwind CSS 4](https://tailwindcss.com) + Lucide |
| IA (chat + embeddings) | [OpenRouter](https://openrouter.ai) (ou [Ollama](https://ollama.ai) local) |
| Banco / RAG | PostgreSQL + pgvector (Supabase self-hosted em produção) |
| Pesquisa web | Firecrawl, restrito a domínios oficiais |
| Auth do `/admin` | Supabase Auth |
| Deploy | Coolify (container com adapter-node); Vercel como alternativa |
| Linguagem / pacotes | TypeScript / pnpm |

> O provider de IA é configurável via `.env` (`CHAT_PROVIDER` / `EMBED_PROVIDER`):
> `openrouter` (nuvem) ou `ollama` (local). Veja `fiaq-app/.env.example`.

## Estrutura do repositório

O aplicativo fica em **`fiaq-app/`**, não na raiz:

```
trabalho-tp2-fiaq-2026.1/
├── fiaq-app/                 # app SvelteKit/Vite
│   ├── src/                  # rotas, componentes e stores Svelte
│   │   ├── routes/           # páginas e APIs (/api/chat, /api/faq, /api/admin...)
│   │   └── lib/              # shadcn-svelte, chat, auth, TanStack e utilitários
│   ├── server/               # repositórios RAG/FAQ, DB, providers e fallback JSON
│   ├── data/                 # conhecimento: faq/, pdfs/, crawl/, sources/
│   ├── scripts/              # seeds, crawlers e ferramentas da base de conhecimento
│   └── .env.example
├── db/                       # migrations SQL (01–09), README e SETUP
├── docs/                     # deploy, desenvolvimento, decisões e fontes do RAG
├── selfhost/                 # runbook para rodar em VM com docker compose
├── Dockerfile                # imagem de produção (adapter-node)
├── AGENTS.md                 # guia para agentes de código
└── README.md
```

## Como desenvolver localmente

> Requisitos: Node.js ≥ 20 e [pnpm](https://pnpm.io).

```bash
pnpm install
cp fiaq-app/.env.example fiaq-app/.env   # preencha as variáveis
pnpm dev
```

O servidor imprime a URL local, normalmente `http://127.0.0.1:3000/`. Para
validar a chave do OpenRouter isoladamente: `pnpm test:openrouter`.

Guia completo, incluindo como adicionar conhecimento:
[`docs/DESENVOLVIMENTO.md`](./docs/DESENVOLVIMENTO.md).

## Banco de dados

O app usa **PostgreSQL** para servir o FAQ, armazenar os trechos do RAG com
`pgvector` e registrar métricas anônimas. A busca do chat é DB-first: gera o
embedding da pergunta, busca em `rag_chunk` via `buscar_rag_chunks(...)` e só
usa `fiaq-app/server/assets/rag-index.json` se o banco estiver indisponível.

- Modelo de dados e RAG: [`db/README.md`](./db/README.md)
- Ordem das migrations e Postgres local com Docker: [`db/SETUP.md`](./db/SETUP.md)

## Deploy

A produção roda no **Coolify**: um serviço Supabase self-hosted e o app buildado
pelo `Dockerfile` da raiz. Passo a passo, variáveis, seed e problemas
conhecidos estão em [`docs/DEPLOY.md`](./docs/DEPLOY.md). O mesmo documento
descreve a alternativa com Vercel + Supabase gerenciado, que foi o deploy
original.

> O chat e os embeddings usam modelos gratuitos do OpenRouter, com limite
> diário por conta. Veja a seção de cota em `docs/DEPLOY.md` antes de
> demonstrações.

## Equipe

Projeto desenvolvido por alunos da disciplina de Técnicas de Programação 2, UnB 2026.1.

| Aluno | GitHub |
|---|---|
| Fernando Augusto | [@fernando-augustop](https://github.com/fernando-augustop) |
| Gustavo Nascimento | [@PavanelliGustavo](https://github.com/PavanelliGustavo) |
| Eduardo Rocha | [@eduardofgc](https://github.com/eduardofgc) |
| Samara Gomes | [@samaragomess](https://github.com/samaragomess) |
| Augusto Faller | [@tosgual](https://github.com/tosgual) |
| Lucas Centurion Netto | [@LucasCenturionNetto](https://github.com/LucasCenturionNetto) |

## Licença

Uso acadêmico, desenvolvido para a Universidade de Brasília.
