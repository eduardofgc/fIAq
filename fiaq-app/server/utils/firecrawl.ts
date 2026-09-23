import { loadServerEnv } from '../env'

loadServerEnv()

export interface FirecrawlSource {
  id: string
  titulo: string
  url: string
  description?: string
  markdown?: string
  kind: 'web'
}

interface FirecrawlWebResult {
  title?: string
  description?: string
  url?: string
  markdown?: string | null
  metadata?: {
    title?: string
    description?: string
    sourceURL?: string
    url?: string
  }
}

interface FirecrawlSearchResponse {
  success?: boolean
  data?: {
    web?: FirecrawlWebResult[]
  }
  web?: FirecrawlWebResult[]
  error?: string
}

interface SearchFirecrawlOptions {
  signal?: AbortSignal
}

const FIRECRAWL_DEFAULT_API_URL = 'https://api.firecrawl.dev'
const FIRECRAWL_SEARCH_LIMIT = readPositiveInt(process.env.FIRECRAWL_SEARCH_LIMIT, 6)
const FIRECRAWL_BROAD_SEARCH_LIMIT = readPositiveInt(process.env.FIRECRAWL_BROAD_SEARCH_LIMIT, 8)
const FIRECRAWL_TIMEOUT_MS = readPositiveInt(process.env.FIRECRAWL_TIMEOUT_MS, 30000)
const FIRECRAWL_MAX_AGE_MS = readPositiveInt(process.env.FIRECRAWL_MAX_AGE_MS, 604800000)
const FIRECRAWL_FRESH_MAX_AGE_MS = readPositiveInt(process.env.FIRECRAWL_FRESH_MAX_AGE_MS, 86400000)
const FIRECRAWL_RESULT_CHARS = readPositiveInt(process.env.FIRECRAWL_RESULT_CHARS, 1200)
const FIRECRAWL_TOTAL_CHARS = readPositiveInt(process.env.FIRECRAWL_TOTAL_CHARS, 4800)
const DEFAULT_INCLUDE_DOMAINS = [
  'cic.unb.br',
  'www.cic.unb.br',
  'unb.br',
  'www.unb.br',
  'saa.unb.br',
  'sigaa.unb.br'
]
const DEFAULT_TRUSTED_DISCOVERY_DOMAINS = [
  ...DEFAULT_INCLUDE_DOMAINS,
  'noticias.unb.br',
  'informa.unb.br',
  'adunb.org',
  'sintfub.org.br',
  'correiobraziliense.com.br',
  'metropoles.com',
  'brasildefato.com.br'
]
const FRESHNESS_TERMS = [
  '2026',
  'atual',
  'atualmente',
  'agora',
  'hoje',
  'recente',
  'noticia',
  'noticias',
  'greve',
  'paralisacao',
  'paralisar',
  'indicativo',
  'assembleia',
  'reitoria',
  'servidores',
  'docentes',
  'tecnicos'
]

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function parseDomains(value: string | undefined): string[] {
  const domains = value
    ?.split(',')
    .map(domain => domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    .filter(Boolean)

  return domains?.length ? [...new Set(domains)] : DEFAULT_INCLUDE_DOMAINS
}

function parseTrustedDomains(value: string | undefined): string[] {
  const configured = parseDomains(value)
  const domains = configured.length ? configured : DEFAULT_TRUSTED_DISCOVERY_DOMAINS
  return [...new Set([...domains, ...DEFAULT_TRUSTED_DISCOVERY_DOMAINS])]
}

function firecrawlBaseUrl(): string {
  return (process.env.FIRECRAWL_API_URL || FIRECRAWL_DEFAULT_API_URL).replace(/\/$/, '')
}

export function getFirecrawlIncludeDomains(): string[] {
  return parseDomains(process.env.FIRECRAWL_INCLUDE_DOMAINS)
}

export function getFirecrawlTrustedDomains(): string[] {
  return parseTrustedDomains(process.env.FIRECRAWL_TRUSTED_DOMAINS)
}

function firecrawlHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\(([^)]*)\)/g, '$1')
    .replace(/<Base64-Image-Removed>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSearchText(text: string): string {
  return normalizeWhitespace(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const cleanHost = host.toLowerCase()
  const cleanDomain = domain.toLowerCase().replace(/^www\./, '')
  return cleanHost === cleanDomain || cleanHost.endsWith(`.${cleanDomain}`)
}

function isTrustedSource(url: string): boolean {
  const host = sourceHost(url)
  return Boolean(host) && getFirecrawlTrustedDomains().some(domain => hostMatchesDomain(host, domain))
}

function isFreshnessSensitiveQuery(question: string): boolean {
  const normalized = normalizeSearchText(question)
  return FRESHNESS_TERMS.some(term => normalized.includes(normalizeSearchText(term)))
}

function isStrikeQuery(question: string): boolean {
  const normalized = normalizeSearchText(question)
  return normalized.includes('greve') || normalized.includes('paralisacao')
}

function requestedYears(question: string): string[] {
  return [...new Set(normalizeSearchText(question).match(/\b20\d{2}\b/g) || [])]
}

function sourceYearText(source: FirecrawlSource): string {
  return normalizeSearchText(`${source.titulo} ${source.url} ${source.description || ''}`)
}

function sourceHasRequestedYear(source: FirecrawlSource, years: string[]): boolean {
  if (!years.length) return true
  const text = sourceYearText(source)
  return years.some(year => text.includes(year))
}

function sourceHasConflictingYear(source: FirecrawlSource, years: string[]): boolean {
  if (!years.length) return false
  const text = sourceYearText(source)
  const sourceYears = text.match(/\b20\d{2}\b/g) || []
  return sourceYears.some(year => !years.includes(year))
}

function buildSearchQueries(question: string): string[] {
  const queries = [question]

  if (isFreshnessSensitiveQuery(question)) {
    queries.push(`${question} UnB 2026 reitoria noticias atual`)

    if (isStrikeQuery(question)) {
      queries.push('greve UnB 2026 adunb sintfub reitoria')
    }
  }

  return [...new Set(queries.map(query => query.trim()).filter(Boolean))].slice(0, 3)
}

function buildYearFocusedStrikeQueries(years: string[]): string[] {
  return years.flatMap(year => [
    `greve UnB ${year} professores site:correiobraziliense.com.br`,
    `indicativo greve UnB ${year} site:brasildefato.com.br`,
    `indicativo greve UnB ${year} site:metropoles.com`,
    `indicativo greve UnB ${year} site:adunb.org`
  ])
}

function compactText(text: string | undefined | null, maxChars: number): string {
  const normalized = normalizeWhitespace(String(text || ''))
  if (normalized.length <= maxChars) return normalized

  return `${normalized.slice(0, maxChars).replace(/\s+\S*$/, '').trim()}...`
}

function sourceId(url: string, index: number): string {
  try {
    return `web:${new URL(url).hostname}:${index + 1}`
  } catch {
    return `web:${index + 1}`
  }
}

function normalizeFirecrawlResult(result: FirecrawlWebResult, index: number): FirecrawlSource | null {
  const url = String(result.url || result.metadata?.sourceURL || result.metadata?.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return null

  const titulo = normalizeWhitespace(String(result.title || result.metadata?.title || url)) || 'Fonte web'
  const description = compactText(result.description || result.metadata?.description, 260)
  const markdown = compactText(result.markdown, FIRECRAWL_RESULT_CHARS)

  return {
    id: sourceId(url, index),
    titulo,
    url,
    description: description || undefined,
    markdown: markdown || undefined,
    kind: 'web'
  }
}

async function runFirecrawlSearch(
  query: string,
  options: {
    signal?: AbortSignal
    includeDomains?: string[]
    broad?: boolean
    fresh?: boolean
    scrape?: boolean
    limit?: number
    timeoutMs?: number
  }
): Promise<FirecrawlSource[]> {
  const abort = new AbortController()
  const abortFromCaller = () => abort.abort(options.signal?.reason)
  const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? FIRECRAWL_TIMEOUT_MS)

  if (options.signal?.aborted) {
    abortFromCaller()
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  }

  const body: Record<string, unknown> = {
    query,
    limit: options.limit ?? (options.broad ? FIRECRAWL_BROAD_SEARCH_LIMIT : FIRECRAWL_SEARCH_LIMIT),
    sources: [{ type: 'web' }],
    ignoreInvalidURLs: true
  }

  if (options.scrape !== false) {
    body.scrapeOptions = {
      formats: [{ type: 'markdown' }],
      onlyMainContent: true,
      maxAge: options.fresh ? FIRECRAWL_FRESH_MAX_AGE_MS : FIRECRAWL_MAX_AGE_MS
    }
  }

  if (options.includeDomains?.length) body.includeDomains = options.includeDomains

  try {
    const res = await fetch(`${firecrawlBaseUrl()}/v2/search`, {
      method: 'POST',
      headers: firecrawlHeaders(),
      signal: abort.signal,
      body: JSON.stringify(body)
    })

    const responseText = await res.text()
    let payload: FirecrawlSearchResponse

    try {
      payload = responseText ? JSON.parse(responseText) as FirecrawlSearchResponse : {}
    } catch {
      payload = { error: responseText }
    }

    if (!res.ok || payload.success === false) {
      throw new Error(`Firecrawl search error: ${res.status} ${payload.error || ''}`.trim())
    }

    const web = payload.data?.web ?? payload.web ?? []
    return web
      .map(normalizeFirecrawlResult)
      .filter((source): source is FirecrawlSource => Boolean(source))
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

function sourceScore(question: string, source: FirecrawlSource, index: number): number {
  const normalizedQuestion = normalizeSearchText(question)
  const normalizedTitle = normalizeSearchText(source.titulo)
  const normalizedUrl = normalizeSearchText(source.url)
  const normalizedSource = normalizeSearchText(`${source.titulo} ${source.url} ${source.description || ''} ${source.markdown || ''}`)
  const host = sourceHost(source.url)
  const years = requestedYears(question)
  let score = 100 - index

  for (const term of normalizedQuestion.split(/\s+/).filter(term => term.length > 3)) {
    if (normalizedSource.includes(term)) score += 4
  }

  for (const year of years) {
    if (normalizedSource.includes(year)) score += 18
    if (normalizedTitle.includes(year)) score += 18
    if (normalizedUrl.includes(year)) score += 30
  }

  if (sourceHasRequestedYear(source, years)) score += 24
  if (sourceHasConflictingYear(source, years) && !sourceHasRequestedYear(source, years)) score -= 60
  if (normalizedQuestion.includes('greve') && normalizedSource.includes('greve')) score += 14
  if (normalizedQuestion.includes('greve') && normalizedTitle.includes('greve')) score += 22
  if (normalizedQuestion.includes('paralisacao') && normalizedSource.includes('paralisacao')) score += 10
  if (normalizedQuestion.includes('paralisacao') && normalizedTitle.includes('paralisacao')) score += 16
  if (normalizedQuestion.includes('greve') && normalizedTitle.includes('edital')) score -= 24
  if (hostMatchesDomain(host, 'unb.br')) score += 14
  if (hostMatchesDomain(host, 'adunb.org') || hostMatchesDomain(host, 'sintfub.org.br')) score += 10

  return score
}

function mergeAndRankSources(question: string, sourceGroups: FirecrawlSource[][]): FirecrawlSource[] {
  const byUrl = new Map<string, { source: FirecrawlSource, index: number }>()

  for (const source of sourceGroups.flat()) {
    const key = source.url.replace(/#.*$/, '').replace(/\/$/, '')
    if (!byUrl.has(key)) byUrl.set(key, { source, index: byUrl.size })
  }

  const rankedSources = [...byUrl.values()]
    .sort((a, b) => sourceScore(question, b.source, b.index) - sourceScore(question, a.source, a.index))
    .map(item => item.source)
  const years = requestedYears(question)
  const exactYearSources = rankedSources.filter(source => sourceHasRequestedYear(source, years))

  if (years.length && exactYearSources.length >= 2) {
    return exactYearSources.slice(0, FIRECRAWL_SEARCH_LIMIT)
  }

  if (years.length && exactYearSources.length === 1) {
    const compatibleSources = rankedSources.filter(source =>
      !sourceHasRequestedYear(source, years) && !sourceHasConflictingYear(source, years)
    )
    return [...exactYearSources, ...compatibleSources].slice(0, FIRECRAWL_SEARCH_LIMIT)
  }

  return rankedSources.slice(0, FIRECRAWL_SEARCH_LIMIT)
}

export async function searchFirecrawl(question: string, options: SearchFirecrawlOptions = {}): Promise<FirecrawlSource[]> {
  const trimmed = question.trim().slice(0, 500)
  if (!trimmed) return []

  if (options.signal?.aborted) return []

  const fresh = isFreshnessSensitiveQuery(trimmed)
  const strike = isStrikeQuery(trimmed)
  const includeDomains = getFirecrawlIncludeDomains()
  const queries = buildSearchQueries(trimmed)
  const firstQuery = queries[0] ?? trimmed
  const restrictedQueries = fresh && strike ? [] : fresh ? [firstQuery] : queries
  const broadQueries = fresh
    ? strike
      ? [
          'greve UnB 2026 adunb sintfub reitoria',
          'indicativo de greve UnB 2026 professores ADUnB'
        ]
      : [queries[queries.length - 1] ?? firstQuery]
    : []
  const restrictedSearches = restrictedQueries.map(query =>
    runFirecrawlSearch(query, {
      signal: options.signal,
      includeDomains,
      fresh
    }).catch((error) => {
      console.warn('[firecrawl] Busca restrita falhou:', error)
      return []
    })
  )
  const broadSearches = fresh
    ? broadQueries.map(query =>
        runFirecrawlSearch(query, {
          signal: options.signal,
          broad: true,
          fresh,
          limit: strike ? Math.min(4, FIRECRAWL_BROAD_SEARCH_LIMIT) : undefined,
          timeoutMs: strike ? Math.min(18000, FIRECRAWL_TIMEOUT_MS) : undefined
        })
          .then(sources => sources.filter(source => isTrustedSource(source.url)))
          .catch((error) => {
            console.warn('[firecrawl] Busca ampla falhou:', error)
            return []
          })
      )
    : []

  const sourceGroups = await Promise.all([...restrictedSearches, ...broadSearches])
  let rankedSources = mergeAndRankSources(trimmed, sourceGroups)
  const years = requestedYears(trimmed)
  const hasEnoughYearSources = rankedSources.filter(source => sourceHasRequestedYear(source, years)).length >= 2

  if (fresh && strike && years.length && !hasEnoughYearSources) {
    const focusedSearches = buildYearFocusedStrikeQueries(years).map(query =>
      runFirecrawlSearch(query, {
        signal: options.signal,
        broad: true,
        fresh,
        limit: 3,
        timeoutMs: Math.min(15000, FIRECRAWL_TIMEOUT_MS)
      })
        .then(sources => sources.filter(source => isTrustedSource(source.url)))
        .catch((error) => {
          console.warn('[firecrawl] Busca por ano/domínio falhou:', error)
          return []
        })
    )
    const focusedSourceGroups = await Promise.all(focusedSearches)
    rankedSources = mergeAndRankSources(trimmed, [...sourceGroups, ...focusedSourceGroups])
  }

  // Mesmo fora do modo "fresh", uma busca restrita aos domínios oficiais que não
  // acha nada não deve desistir — cai pra busca ampla (ainda filtrada por
  // domínio confiável) abaixo em vez de devolver contexto vazio.
  if (rankedSources.length) return rankedSources

  const fallbackQuery = broadQueries[0] ?? queries[0] ?? trimmed
  const fallbackScrapeSources = await runFirecrawlSearch(fallbackQuery, {
    signal: options.signal,
    broad: true,
    fresh: false,
    limit: Math.min(4, FIRECRAWL_BROAD_SEARCH_LIMIT),
    timeoutMs: Math.min(18000, FIRECRAWL_TIMEOUT_MS)
  })
    .then(sources => sources.filter(source => isTrustedSource(source.url)))
    .catch((error) => {
      console.warn('[firecrawl] Busca ampla reduzida falhou:', error)
      return []
    })

  const fallbackRankedSources = mergeAndRankSources(trimmed, [fallbackScrapeSources])
  if (fallbackRankedSources.length) return fallbackRankedSources

  const fallbackSources = await runFirecrawlSearch(fallbackQuery, {
    signal: options.signal,
    broad: true,
    scrape: false,
    limit: Math.min(4, FIRECRAWL_BROAD_SEARCH_LIMIT),
    timeoutMs: Math.min(10000, FIRECRAWL_TIMEOUT_MS)
  })
    .then(sources => sources.filter(source => isTrustedSource(source.url)))
    .catch((error) => {
      console.warn('[firecrawl] Busca ampla sem scrape falhou:', error)
      return []
    })

  return mergeAndRankSources(trimmed, [fallbackSources])
}

export function buildFirecrawlContext(sources: FirecrawlSource[]): string {
  if (!sources.length) return 'Nenhuma fonte web confiável foi encontrada.'

  const parts: string[] = []
  let usedChars = 0

  for (const [index, source] of sources.entries()) {
    const body = source.markdown || source.description || ''
    const remaining = FIRECRAWL_TOTAL_CHARS - usedChars
    if (remaining < 240) break

    const snippet = compactText(body, Math.min(FIRECRAWL_RESULT_CHARS, remaining))
    const part = [
      `[${index + 1}] ${source.titulo}`,
      `URL: ${source.url}`,
      source.description ? `Resumo: ${source.description}` : '',
      snippet ? `Conteúdo: ${snippet}` : ''
    ].filter(Boolean).join('\n')

    parts.push(part)
    usedChars += part.length + 2
  }

  return parts.join('\n\n')
}
