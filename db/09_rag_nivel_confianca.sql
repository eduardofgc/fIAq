-- Executar APOS 05_supabase_rag_search_hardening.sql.
--
-- Adiciona um nivel de confianca ao RAG, separado de `origem` (que descreve
-- como o conteudo entrou no sistema: faq/pdf/crawl, nao o quanto ele e
-- autoritativo). Antes desta migration, uma pagina crawleada de um grupo
-- estudantil (ex.: empresa junior, laboratorio de extensao) competia de
-- igual pra igual com uma pagina da SAA/DEG na busca — e podia vencer so por
-- bater palavra, mesmo sendo assunto totalmente diferente da pergunta.
--
-- 'oficial'      -> FAQ curado, PDFs de editais, e paginas crawleadas de
--                   orgaos com autoridade normativa sobre regras/prazos/
--                   procedimentos academicos (secretarias, decanatos,
--                   sistemas oficiais, coordenacao de curso, normas gov.br).
-- 'institucional' -> demais paginas *.unb.br ou externas (grupos estudantis,
--                    empresas junior, eventos, sites de captacao) — uteis
--                    como contexto, mas nunca sozinhas como fonte normativa.
--
-- A lista de hosts "oficial" precisa ficar em sincronia com
-- fiaq-app/server/utils/trustLevel.mjs (fonte usada pelos scripts de
-- ingestao). Se um novo host oficial for crawleado no futuro, atualize os
-- dois lugares.

ALTER TABLE rag_documento
  ADD COLUMN IF NOT EXISTS nivel_confianca VARCHAR(20) NOT NULL DEFAULT 'institucional'
    CHECK (nivel_confianca IN ('oficial', 'institucional'));

ALTER TABLE rag_chunk
  ADD COLUMN IF NOT EXISTS nivel_confianca VARCHAR(20) NOT NULL DEFAULT 'institucional'
    CHECK (nivel_confianca IN ('oficial', 'institucional'));

-- FAQ curado e PDFs de editais sao oficiais por construcao.
UPDATE rag_documento
SET nivel_confianca = 'oficial'
WHERE origem IN ('faq', 'pdf')
  AND nivel_confianca <> 'oficial';

-- Paginas crawleadas de hosts com autoridade normativa.
WITH host_extract AS (
  SELECT id, lower(regexp_replace(url_fonte, '^https?://([^/]+).*$', '\1')) AS host
  FROM rag_documento
  WHERE origem = 'crawl'
    AND url_fonte IS NOT NULL
    AND url_fonte <> ''
)
UPDATE rag_documento rd
SET nivel_confianca = 'oficial'
FROM host_extract he
WHERE rd.id = he.id
  AND rd.nivel_confianca <> 'oficial'
  AND he.host = ANY (ARRAY[
    'unb.br', 'www.unb.br', 'saa.unb.br', 'deg.unb.br', 'dac.unb.br',
    'dds.dac.unb.br', 'dpg.unb.br', 'portalsig.unb.br', 'ouvidoria.unb.br',
    'sdh.unb.br', 'sti.unb.br', 'cerimonial.unb.br', 'bce.unb.br', 'ru.unb.br',
    'dasu.unb.br', 'proic.unb.br', 'acessibilidade.unb.br', 'www.cic.unb.br',
    'cic.unb.br', 'exatas.unb.br', 'www.exatas.unb.br', 'gov.br', 'www.gov.br'
  ]);

-- Chunk espelha o nivel_confianca do documento pai (mesmo padrao ja usado
-- para `origem`).
UPDATE rag_chunk rc
SET nivel_confianca = rd.nivel_confianca
FROM rag_documento rd
WHERE rc.id_documento = rd.id
  AND rc.nivel_confianca <> rd.nivel_confianca;

CREATE INDEX IF NOT EXISTS idx_rag_documento_nivel_confianca
  ON rag_documento(nivel_confianca);

CREATE INDEX IF NOT EXISTS idx_rag_chunk_nivel_confianca
  ON rag_chunk(nivel_confianca);

-- A assinatura de saida muda (nova coluna nivel_confianca), entao a funcao
-- precisa ser recriada, nao so substituida.
DROP FUNCTION IF EXISTS public.buscar_rag_chunks(extensions.vector(2048), TEXT, DOUBLE PRECISION, INT);

CREATE FUNCTION public.buscar_rag_chunks (
  p_query_embedding extensions.vector(2048),
  p_modelo_embedding TEXT,
  p_match_threshold DOUBLE PRECISION DEFAULT 0.45,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE (
  id TEXT,
  titulo TEXT,
  conteudo TEXT,
  url TEXT,
  origem TEXT,
  nivel_confianca TEXT,
  similaridade DOUBLE PRECISION,
  score DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH candidatos AS (
    SELECT
      rc.chunk_uid,
      rc.titulo,
      rc.conteudo,
      COALESCE(rc.url_fonte, rd.url_fonte, '') AS url,
      rc.origem,
      rc.nivel_confianca,
      (rc.embedding OPERATOR(extensions.<=>) p_query_embedding) AS distancia_exata,
      (CASE rc.origem
        WHEN 'faq' THEN 0.06
        WHEN 'pdf' THEN 0.02
        ELSE 0
      END
      -- Boost de confianca domina o boost de tipo: um crawl oficial deve
      -- ficar acima de qualquer coisa institucional, mesmo com score bruto
      -- parecido.
      + CASE rc.nivel_confianca WHEN 'oficial' THEN 0.12 ELSE 0 END) AS boost
    FROM public.rag_chunk rc
    JOIN public.rag_documento rd ON rd.id = rc.id_documento
    WHERE rc.ativo = TRUE
      AND rd.ativo = TRUE
      AND rc.modelo_embedding = p_modelo_embedding
    ORDER BY rc.embedding_half OPERATOR(extensions.<=>) (p_query_embedding::extensions.halfvec(2048)) ASC
    LIMIT LEAST(GREATEST(p_match_count * 8, 20), 100)
  )
  SELECT
    chunk_uid::TEXT AS id,
    titulo::TEXT,
    conteudo::TEXT,
    url::TEXT,
    origem::TEXT,
    nivel_confianca::TEXT,
    (1 - distancia_exata)::DOUBLE PRECISION AS similaridade,
    (1 - distancia_exata + boost)::DOUBLE PRECISION AS score
  FROM candidatos
  WHERE (1 - distancia_exata + boost) >= p_match_threshold
  ORDER BY score DESC, similaridade DESC
  LIMIT LEAST(p_match_count, 20);
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fiaq_app') THEN
    GRANT EXECUTE
      ON FUNCTION public.buscar_rag_chunks(extensions.vector(2048), TEXT, DOUBLE PRECISION, INT)
      TO fiaq_app;
  END IF;
END
$$;
