export type NivelConfianca = 'oficial' | 'institucional'

export const OFICIAL_HOSTS: Set<string>
export function hostFromUrl(url: string): string
export function trustLevelForUrl(url: string): NivelConfianca
export function trustLevelForChunk(kind: 'faq' | 'pdf' | 'crawl', url: string): NivelConfianca
