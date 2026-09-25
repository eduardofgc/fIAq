import { getSql, isDatabaseConfigured } from '../db/index'
import { keywordTopK, topKFiltered } from '../utils/vectorStore'
import type { NivelConfianca } from '../utils/embeddings'

const VECTOR_DIM = 2048

export interface SearchResult {
  id: string
  titulo: string
  conteudo: string
  url: string
  nivelConfianca: NivelConfianca
  score: number
}

interface RagSearchRow {
  id: string
  titulo: string
  conteudo: string
  url: string | null
  nivel_confianca: NivelConfianca
  score: number
}

interface RagTextRow {
  id: string
  titulo: string
  conteudo: string
  url: string | null
  origem: 'faq' | 'pdf' | 'crawl'
  nivel_confianca: NivelConfianca
}

const KIND_BOOST: Record<RagTextRow['origem'], number> = {
  faq: 0.06,
  pdf: 0.02,
  crawl: 0
}

// Domina o boost de tipo: um crawl oficial (SAA/DEG/sistema oficial) deve
// ficar acima de qualquer coisa institucional mesmo com score bruto parecido.
const CONFIANCA_BOOST: Record<NivelConfianca, number> = {
  oficial: 0.12,
  institucional: 0
}

// "edital" fica de fora de propósito: é genérico demais (PIBIC, monitoria,
// dupla graduação... todos têm "edital") e vira falso positivo em buscas por
// "último edital de X", fazendo o documento errado vencer só por essa palavra.
const LEXICAL_STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'como', 'com', 'da', 'das', 'de', 'do', 'dos', 'e',
  'edital', 'em', 'eu', 'fazer', 'isso', 'me', 'na', 'no', 'o', 'os', 'ou',
  'para', 'por', 'posso', 'quais', 'qual', 'quando', 'que', 'quero', 'sao',
  'se', 'sobre', 'um', 'uma', 'unb'
])

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lexicalTerms(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter(term => term.length >= 3 && !LEXICAL_STOPWORDS.has(term))
}

function toVectorLiteral(vector: number[]): string | null {
  if (vector.length !== VECTOR_DIM || !vector.every(Number.isFinite)) {
    return null
  }

  return `[${vector.join(',')}]`
}

function normalizeK(k: number): number {
  if (!Number.isFinite(k)) return 5
  return Math.min(Math.max(Math.trunc(k), 1), 20)
}

function normalizeMinScore(minScore: number): number {
  if (!Number.isFinite(minScore)) return 0.45
  return Math.min(Math.max(minScore, 0), 1)
}

export async function buscarRagNoBanco(
  queryVector: number[],
  modeloEmbedding: string,
  k = 5,
  minScore = 0.45
): Promise<SearchResult[] | null> {
  if (!isDatabaseConfigured()) return null
  const safeK = normalizeK(k)
  const safeMinScore = normalizeMinScore(minScore)

  const vectorLiteral = toVectorLiteral(queryVector)
  if (!vectorLiteral) {
    console.warn(
      `[RAG] Vetor de consulta tem ${queryVector.length} dimensões; `
      + `o banco espera ${VECTOR_DIM}. Usando fallback JSON.`
    )
    return null
  }

  const sql = getSql()
  const rows = await sql<RagSearchRow[]>`
    SELECT id, titulo, conteudo, url, nivel_confianca, score
    FROM buscar_rag_chunks(
      ${vectorLiteral}::extensions.vector(2048),
      ${modeloEmbedding},
      ${safeMinScore},
      ${safeK}
    )
  `

  return rows.map(row => ({
    id: row.id,
    titulo: row.titulo,
    conteudo: row.conteudo,
    url: row.url ?? '',
    nivelConfianca: row.nivel_confianca,
    score: Number(row.score)
  }))
}

export async function buscarRag(
  queryVector: number[],
  modeloEmbedding: string,
  k = 5,
  minScore = 0.45
): Promise<{ results: SearchResult[], source: 'database' | 'json' }> {
  const safeK = normalizeK(k)
  const safeMinScore = normalizeMinScore(minScore)

  try {
    const dbResults = await buscarRagNoBanco(queryVector, modeloEmbedding, safeK, safeMinScore)
    if (dbResults) {
      return { results: dbResults, source: 'database' }
    }
  } catch (error) {
    console.warn('[RAG] Falha na busca vetorial do banco; usando fallback JSON:', error)
  }

  return {
    results: topKFiltered(queryVector, safeK, safeMinScore),
    source: 'json'
  }
}

function rankTextRows(query: string, rows: RagTextRow[], k: number): SearchResult[] {
  const queryTerms = [...new Set(lexicalTerms(query))]
  if (!queryTerms.length) return []

  const queryPhrase = normalizeText(query)
  const safeK = normalizeK(k)

  return rows
    .map((row) => {
      const title = normalizeText(row.titulo)
      const content = normalizeText(row.conteudo)
      const titleTerms = new Set(lexicalTerms(row.titulo))
      const contentTerms = new Set(lexicalTerms(row.conteudo).slice(0, 180))
      let matched = 0
      let score = (KIND_BOOST[row.origem] ?? 0) + (CONFIANCA_BOOST[row.nivel_confianca] ?? 0)

      for (const term of queryTerms) {
        let termMatched = false

        if (titleTerms.has(term) || title.includes(term)) {
          score += 0.28
          termMatched = true
        }

        if (contentTerms.has(term)) {
          score += 0.09
          termMatched = true
        } else if (content.includes(term)) {
          score += 0.035
          termMatched = true
        }

        if (termMatched) matched++
      }

      if (title && (queryPhrase.includes(title) || title.includes(queryPhrase))) score += 0.36
      score += (matched / queryTerms.length) * 0.32

      return {
        id: row.id,
        titulo: row.titulo,
        conteudo: row.conteudo,
        url: row.url ?? '',
        nivelConfianca: row.nivel_confianca,
        score
      }
    })
    .filter(result => result.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeK)
}

export async function buscarRagPorTextoNoBanco(query: string, k = 5): Promise<SearchResult[] | null> {
  if (!isDatabaseConfigured()) return null

  try {
    const sql = getSql()
    const rows = await sql<RagTextRow[]>`
      SELECT
        rc.chunk_uid AS id,
        rc.titulo,
        rc.conteudo,
        COALESCE(rc.url_fonte, rd.url_fonte, '') AS url,
        rc.origem,
        rc.nivel_confianca
      FROM rag_chunk rc
      JOIN rag_documento rd ON rd.id = rc.id_documento
      WHERE rc.ativo = TRUE
        AND rd.ativo = TRUE
      ORDER BY
        CASE rc.origem
          WHEN 'faq' THEN 1
          WHEN 'pdf' THEN 2
          ELSE 3
        END,
        rc.dthr_atualizacao DESC
      LIMIT 800
    `

    return rankTextRows(query, rows, k)
  } catch (error) {
    console.warn('[RAG] Falha na busca textual do banco; usando fallback JSON:', error)
    return null
  }
}

export function buscarRagPorTexto(query: string, k = 5): SearchResult[] {
  return keywordTopK(query, normalizeK(k))
}
