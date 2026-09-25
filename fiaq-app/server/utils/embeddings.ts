import { embed } from './llmProvider'

export type ChunkKind = 'faq' | 'pdf' | 'crawl'
export type NivelConfianca = 'oficial' | 'institucional'

export interface EmbeddedChunk {
  id: string
  titulo: string
  conteudo: string
  url: string
  kind: ChunkKind
  nivelConfianca: NivelConfianca
  vector: number[]
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    magA += ai * ai
    magB += bi * bi
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB)
  if (magnitude === 0) return 0
  return dot / magnitude
}

export async function embedChunk(chunk: Omit<EmbeddedChunk, 'vector'>): Promise<EmbeddedChunk> {
  const text = `${chunk.titulo}\n${chunk.conteudo}`
  const vector = await embed(text)
  return { ...chunk, vector }
}

export async function embedQuery(query: string): Promise<number[]> {
  return embed(query)
}
