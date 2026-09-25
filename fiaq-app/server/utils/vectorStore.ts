import { type ChunkKind, type EmbeddedChunk, type NivelConfianca, cosineSimilarity } from './embeddings'

export interface SearchResult {
  id: string
  titulo: string
  conteudo: string
  url: string
  nivelConfianca: NivelConfianca
  score: number
}

// O FAQ curado tem prioridade sobre PDFs e páginas crawleadas: ganha um pequeno
// boost para não ser afogado pelo conteúdo (mais volumoso e ruidoso) do crawl.
const KIND_BOOST: Record<ChunkKind, number> = {
  faq: 0.06,
  pdf: 0.02,
  crawl: 0
}

// Domina o boost de tipo: um crawl oficial (SAA/DEG/sistema oficial) deve
// ficar acima de qualquer coisa institucional (grupo estudantil, empresa
// júnior...) mesmo com score bruto parecido.
const CONFIANCA_BOOST: Record<NivelConfianca, number> = {
  oficial: 0.12,
  institucional: 0
}

const store: EmbeddedChunk[] = []
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

export function addChunk(chunk: EmbeddedChunk): void {
  store.push(chunk)
}

// Carrega vários chunks de uma vez (fallback JSON quando pgvector não estiver disponível).
export function loadChunks(chunks: EmbeddedChunk[]): void {
  store.splice(0, store.length, ...chunks)
}

// Retorna todos os chunks indexados (usado para serializar o fallback JSON).
export function getAllChunks(): EmbeddedChunk[] {
  return store
}

export function getStoreSize(): number {
  return store.length
}

export function topK(queryVector: number[], k = 4): SearchResult[] {
  if (store.length === 0) return []

  return store
    .map(chunk => ({
      id: chunk.id,
      titulo: chunk.titulo,
      conteudo: chunk.conteudo,
      url: chunk.url,
      nivelConfianca: chunk.nivelConfianca,
      score: cosineSimilarity(queryVector, chunk.vector)
        + (KIND_BOOST[chunk.kind] ?? 0)
        + (CONFIANCA_BOOST[chunk.nivelConfianca] ?? 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export function topKFiltered(queryVector: number[], k = 4, minScore = 0.5): SearchResult[] {
  return topK(queryVector, k).filter(r => r.score >= minScore)
}

export function keywordTopK(query: string, k = 4): SearchResult[] {
  if (store.length === 0) return []

  const queryTerms = [...new Set(lexicalTerms(query))]
  if (!queryTerms.length) return []

  const queryPhrase = normalizeText(query)
  const safeK = Math.min(Math.max(Math.trunc(k) || 4, 1), 20)

  return store
    .map((chunk) => {
      const title = normalizeText(chunk.titulo)
      const content = normalizeText(chunk.conteudo)
      const titleTerms = new Set(lexicalTerms(chunk.titulo))
      const contentTerms = new Set(lexicalTerms(chunk.conteudo).slice(0, 180))
      let matched = 0
      let score = (KIND_BOOST[chunk.kind] ?? 0) + (CONFIANCA_BOOST[chunk.nivelConfianca] ?? 0)

      for (const term of queryTerms) {
        let termMatched = false

        if (titleTerms.has(term)) {
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
        id: chunk.id,
        titulo: chunk.titulo,
        conteudo: chunk.conteudo,
        url: chunk.url,
        nivelConfianca: chunk.nivelConfianca,
        score
      }
    })
    .filter(result => result.score > 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, safeK)
}
