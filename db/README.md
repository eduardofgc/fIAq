# Estrutura do Banco de Dados

## Tabelas

O banco possui tabelas organizadas em três domínios principais:

**FAQ (conteúdo)**
| Tabela | Descrição |
|---|---|
| `faq_categoria` | Categorias do FAQ (ex: Matrícula, Estrutura Curricular) |
| `faq_entrada` | Perguntas e respostas do FAQ, vinculadas a uma categoria |

**RAG (base de conhecimento)**
| Tabela | Descrição |
|---|---|
| `rag_documento` | Fonte de conhecimento: FAQ, PDF ou página crawleada |
| `rag_chunk` | Trechos indexados com embedding `pgvector` para busca semântica |

**Análise de uso (anônima e agregada)**
| Tabela | Descrição |
|---|---|
| `pergunta_registrada` | Agrega perguntas semanticamente similares — uma linha por "pergunta única" |
| `ocorrencia_pergunta` | Registra cada vez que uma pergunta é feita — permite análise temporal |
| `avaliacao_resposta` | Registra feedback anônimo sobre respostas do chatbot |
| `web_resposta_candidata` | Fila de respostas web marcadas como úteis e aguardando curadoria |
| `admin_usuario` | Allowlist de administradores autorizados a acessar `/admin` |

---

## Realtime da curadoria

A fila `web_resposta_candidata` é publicada em `supabase_realtime` para que o
painel `/admin` receba inserts/updates/deletes enquanto está aberto. O script
`08_admin_curadoria_realtime.sql` mantém `anon` sem acesso, concede apenas
`SELECT` para `authenticated` e usa RLS para liberar eventos somente a usuários
cujo e-mail esteja ativo em `admin_usuario`.

O app ainda usa as rotas `/api/admin` como fonte autoritativa para carregar a
lista completa e revisar itens. O Realtime funciona como gatilho de atualização
instantânea e evita que a tela fique presa em uma aba ou contador antigo.

---

## Arquitetura RAG no banco

O chatbot usa uma arquitetura **DB-first**:

1. `/api/chat` gera o embedding da pergunta com o modelo configurado.
2. O backend chama `buscar_rag_chunks(...)` no Postgres.
3. A função busca candidatos em `rag_chunk` usando cosine distance (`<=>`) com
   `pgvector`, aplica threshold e retorna os melhores trechos.
4. O modelo de chat (`google/gemma-4-31b-it:free`) recebe os trechos como contexto.
5. A pergunta e as fontes usadas são registradas nas tabelas de análise.
6. Se uma resposta com pesquisa web receber avaliação positiva, ela entra em
   `web_resposta_candidata`. Um administrador pode aprovar a resposta no `/admin`
   para transformá-la em novo chunk RAG.

### Nível de confiança (`nivel_confianca`)

Desde a migration `09_rag_nivel_confianca.sql`, `rag_documento`/`rag_chunk` têm
uma coluna `nivel_confianca` (`'oficial'` | `'institucional'`), separada de
`origem` (que descreve só como o conteúdo entrou no sistema). `origem`
responde "isso é FAQ, PDF ou crawl?"; `nivel_confianca` responde "isso tem
autoridade normativa sobre regras/prazos/procedimentos, ou é só contexto
institucional (grupo estudantil, empresa júnior, site de captação...)?".

FAQ curado e PDFs de editais são sempre `'oficial'`. Páginas crawleadas são
classificadas por host contra uma lista curada em
`fiaq-app/server/utils/trustLevel.mjs` (SAA, DEG, SIGAA, decanatos, sistemas
oficiais, gov.br/MEC, coordenação do CIC...) — qualquer host fora dessa lista
cai em `'institucional'` por padrão. **A lista precisa ficar sincronizada**
entre `trustLevel.mjs` e o `ARRAY[...]` de backfill da migration; se um novo
host oficial for crawleado, atualize os dois.

Isso afeta o ranking (`buscar_rag_chunks` dá um boost maior a `'oficial'` do
que o boost de `origem`) e, mais importante, o **gate de "contexto local
suficiente"** em `/api/chat`: um resultado só `'institucional'` nunca conta
como suficiente sozinho, mesmo com score alto — sempre libera o fallback pra
pesquisa web. Isso corrigiu um caso real em que uma pergunta sobre troca de
curso batia palavra com a página de uma empresa júnior de Engenharia da
Computação (`struct.unb.br`, score >1.9 no ranking léxico) e o bot respondia
com aquele conteúdo sem relação nenhuma com a pergunta.

O modelo de chat e o modelo de embedding são papéis diferentes.
`google/gemma-4-31b-it:free` escreve a resposta; o embedding model
transforma perguntas e chunks em vetores. O deploy usa
`nvidia/llama-nemotron-embed-vl-1b-v2:free`, com 2048 dimensões, por isso
`rag_chunk.embedding` é `extensions.vector(2048)`.

Para manter a busca eficiente com 2048 dimensões, `rag_chunk` também possui
`embedding_half extensions.halfvec(2048)` gerado automaticamente. A função
`buscar_rag_chunks(...)` usa o índice HNSW em `embedding_half` para selecionar
candidatos e reordena pelo vetor completo dentro dessa amostra.

O arquivo `fiaq-app/server/assets/rag-index.json` continua no repo apenas como
fallback de compatibilidade caso o banco esteja indisponível durante desenvolvimento
ou recuperação.

---

## Por que duas tabelas para análise?

**`pergunta_registrada`** é a tabela agregada: mantém um contador (`total_vezes`) e
uma amostra do texto da pergunta. Quando o chatbot recebe uma nova pergunta, o sistema
calcula a similaridade entre o novo embedding e os já armazenados. Se a pergunta for
semanticamente similar a uma existente (similaridade ≥ threshold), apenas o contador é
incrementado — sem criar nova linha. Isso agrupa paráfrases como
*"como faço matrícula"* e *"como me matriculo"* como a mesma pergunta.

**`ocorrencia_pergunta`** é o log individual: registra cada ocorrência com a resposta
gerada e as fontes usadas pelo RAG. Isso permite perguntas como *"quais perguntas mais
cresceram nos últimos 7 dias?"* além do ranking geral por `total_vezes`.

---

## Agrupamento por embedding (similaridade de cosseno)

### Como funciona

A pergunta não é agrupada por texto idêntico, mas por **proximidade semântica dos
vetores de embedding**. O embedding de cada pergunta nova é comparado com os vetores
armazenados usando similaridade de cosseno. Se o maior score ≥ `THRESHOLD_MESMA_PERGUNTA`,
a pergunta é considerada a mesma e o contador é incrementado.

### Threshold de calibração

O valor inicial é **0.92** (ver `fiaq-app/server/utils-perguntas/similaridade.ts`).
É um parâmetro de tuning a ajustar com dados reais:

- **Perguntas diferentes sendo agrupadas juntas** → subir o threshold (0.93, 0.95…)
- **Paráfrases da mesma pergunta ficando separadas** → descer o threshold (0.90, 0.88…)

### Dependência do modelo

O campo `modelo_embedding` é obrigatório porque **vetores de modelos diferentes não
são comparáveis entre si** — um vetor do `nomic-embed-text` e um do `llama-nemotron`
para o mesmo texto produzem números completamente diferentes. A comparação de
similaridade só ocorre entre perguntas do mesmo modelo.

### pgvector no RAG e JSONB nas métricas

O RAG usa `pgvector` porque a busca semântica precisa ser rápida e ordenável no
banco. Já `pergunta_registrada.embedding` continua como `JSONB` porque o volume de
métricas é pequeno e a agregação de perguntas equivalentes ainda roda em TypeScript.
Se a tabela de métricas crescer muito, ela pode seguir a mesma estratégia do RAG.

---

## Diagrama Entidade-Relacionamento

```mermaid
erDiagram
    FAQ_CATEGORIA ||--o{ FAQ_ENTRADA : "contém"
    FAQ_ENTRADA |o--o{ RAG_CHUNK : "origina"
    RAG_DOCUMENTO ||--o{ RAG_CHUNK : "contém"
    FAQ_ENTRADA |o--o{ PERGUNTA_REGISTRADA : "associada a"
    PERGUNTA_REGISTRADA ||--o{ OCORRENCIA_PERGUNTA : "gera"

    FAQ_CATEGORIA {
        int id PK
        varchar slug
        varchar titulo
        text descricao
        int ordem
        timestamp dthr_criacao
    }

    FAQ_ENTRADA {
        int id PK
        int id_categoria FK
        varchar slug
        varchar titulo
        text conteudo
        text url_fonte
        timestamp dthr_atualizacao
    }

    RAG_DOCUMENTO {
        int id PK
        varchar origem
        varchar nivel_confianca
        varchar slug
        varchar titulo
        text url_fonte
        text caminho_origem
        text checksum
        jsonb metadados
        boolean ativo
    }

    RAG_CHUNK {
        int id PK
        int id_documento FK
        int id_faq_entrada FK
        varchar origem
        varchar nivel_confianca
        varchar chunk_uid
        int ordem
        varchar titulo
        text conteudo
        vector embedding
        halfvec embedding_half
        text modelo_embedding
        boolean ativo
    }

    PERGUNTA_REGISTRADA {
        int id PK
        text texto_original
        text texto_normalizado
        jsonb embedding
        text modelo_embedding
        int total_vezes
        int id_faq_entrada FK
        timestamp dthr_primeira
        timestamp dthr_ultima
    }

    OCORRENCIA_PERGUNTA {
        int id PK
        int id_pergunta_registrada FK
        text resposta_gerada
        jsonb fontes_usadas
        timestamp dthr_ocorrencia
    }
```

---

## Histórico de decisões

| Data | Decisão | Motivo |
|---|---|---|
| 2026-06 | Autenticação e histórico individual removidos do escopo | Por orientação do professor, o sistema não cadastra nem identifica usuários. Evita burocracia de LGPD e mantém o foco no produto (FAQ + chatbot). |
| 2026-06 | Auth substituído por agregação anônima de perguntas | Permite detectar perguntas em alta e controlar qualidade das respostas mais frequentes sem armazenar dados pessoais. |
| 2026-06 | RAG migrado para `pgvector` | Organiza todo o conhecimento no banco, permite seed idempotente e deixa o JSON apenas como fallback. |
| 2026-06 | Métricas mantêm `embedding JSONB` | A agregação anônima ainda tem baixo volume; evita complexidade extra fora do caminho crítico do RAG. |
| 2026-09 | `nivel_confianca` adicionado ao RAG | `origem` (faq/pdf/crawl) não distinguia autoridade normativa — uma página de empresa júnior competia de igual pra igual com a SAA/DEG na busca. Separa "como entrou no sistema" de "quanto é confiável". |

> **Autores/Decisões originais:** Gustavo Pavanelli e Lucas Centurion
>
> **Revisão 2026-06:** Gustavo Pavanelli — mudança de escopo por orientação do professor:
> remoção de auth e histórico individual; adição de análise anônima e agregada de perguntas.
