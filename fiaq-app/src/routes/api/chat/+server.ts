import type { RequestHandler } from './$types'
import { apiError, readJson } from '$lib/server/http'
import { eventStream, type SseWriter } from '$lib/server/sse'
import { embedQuery } from '../../../../server/utils/embeddings'
import { chatStream, embedInfo, type ChatMessage as LlmChatMessage } from '../../../../server/utils/llmProvider'
import { registrarPergunta } from '../../../../server/repositorios/pergunta'
import { buscarRag, buscarRagPorTexto, buscarRagPorTextoNoBanco, type SearchResult } from '../../../../server/repositorios/rag'
import { buildFirecrawlContext, getFirecrawlIncludeDomains, searchFirecrawl } from '../../../../server/utils/firecrawl'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface RequestBody {
  messages?: unknown
}

interface ResponseSource {
  id: string
  titulo: string
  url: string
  kind: 'rag' | 'web'
  description?: string
}

type WaitUntilPlatform = {
  context?: {
    waitUntil?: (work: Promise<unknown>) => void
  }
  waitUntil?: (work: Promise<unknown>) => void
}

const RAG_RESULT_LIMIT = 3
const RAG_CANDIDATE_LIMIT = 8
const MAX_CONTEXT_CHARS_PER_RESULT = 700
const MAX_CONTEXT_CHARS_TOTAL = 2200
const LOCAL_CONTEXT_MIN_SCORE = 0.52
const CONTEXTUAL_SEARCH_MAX_CHARS = 700
const MAX_HISTORY_MESSAGES = 12
const MAX_CLIENT_MESSAGE_CHARS = 2_000

const SYSTEM_PROMPT = `Você é o assistente virtual do fIAq, portal acadêmico do CIC/UnB.

Regras:
* Responda sempre em português brasileiro, de forma direta, clara e acolhedora.
* Use o <contexto> como fonte principal. Combine trechos relacionados antes de responder.
* Não invente URLs, e-mails, prazos, documentos, regras ou procedimentos.
* Quando o contexto vier de sindicato ou veículo jornalístico, trate como indício/contexto externo e recomende confirmar decisões acadêmicas em canais institucionais da UnB.
* Não escreva URLs no corpo; os links clicáveis aparecem abaixo da resposta.
* Não crie seções "Links úteis", "Fontes", "Referências" ou listas de links no corpo da resposta.
* Não use marcadores de fonte no corpo, como [1], [2] ou [3]; as fontes aparecem automaticamente abaixo da resposta.
* Use Markdown simples, sem blocos de código e sem emojis.
* Em perguntas de escopo UnB, nunca use frases como "não sei", "não tenho informação" ou "não encontrei informação". Se a informação não estiver confirmada, dê a melhor orientação possível, indique o setor, sistema ou documento provável e deixe claro o próximo passo sem inventar fatos.
* Para dúvidas amplas de matrícula, explique o processo geral primeiro. Você pode dizer que calouros e veteranos podem ter orientações específicas, mas não peça esclarecimento como resposta principal.
* Não afirme que matrícula de calouros é automática, nem descreva regra de calouros, se isso não estiver explicitamente confirmado no contexto.
* Em assédio, discriminação, violência ou saúde mental, oriente a procurar a Ouvidoria e o CAEP.
* NUNCA mostre seu raciocínio interno, rascunhos ou análise do contexto na resposta. Vá direto à resposta final.
* Não use prefixos como "The user wants...", "Context says...", "I need to...". Responda apenas em português brasileiro.`

function buildPrompt(context: string, question: string): string {
  return `<contexto>
${context}
</contexto>

Pergunta do aluno: ${question}`
}

function stripLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}

function compactText(text: string, maxChars: number): string {
  const normalized = stripLinks(text).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized

  const sliced = normalized.slice(0, maxChars).replace(/\s+\S*$/, '').trim()
  return `${sliced}...`
}

function normalizeClientMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []

  return value
    .map((message): ChatMessage | null => {
      if (!message || typeof message !== 'object') return null
      const raw = message as Record<string, unknown>
      const role = raw.role === 'user' || raw.role === 'assistant' ? raw.role : null
      const content = String(raw.content || '').trim()

      if (!role || !content) return null

      return {
        role,
        content: content.slice(0, MAX_CLIENT_MESSAGE_CHARS)
      }
    })
    .filter((message): message is ChatMessage => Boolean(message))
    .slice(-MAX_HISTORY_MESSAGES)
}

function buildCompactContext(results: SearchResult[]): string {
  const parts: string[] = []
  let usedChars = 0

  for (const [index, result] of results.entries()) {
    const heading = `[${index + 1}] ${result.titulo}\n${result.url ? `URL: ${result.url}\n` : ''}`
    const remaining = MAX_CONTEXT_CHARS_TOTAL - usedChars - heading.length
    const budget = Math.min(MAX_CONTEXT_CHARS_PER_RESULT, remaining)

    if (budget < 160) break

    const content = compactText(result.conteudo, budget)
    parts.push(`${heading}${content}`)
    usedChars += heading.length + content.length + 2
  }

  return parts.length
    ? parts.join('\n\n')
    : 'Nenhuma informação relevante encontrada na base de dados.'
}

const STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'como', 'com', 'da', 'das', 'de', 'do', 'dos', 'e',
  'em', 'eu', 'fazer', 'isso', 'me', 'na', 'no', 'o', 'os', 'ou', 'para',
  'posso', 'que', 'quero', 'sao', 'se', 'um', 'uma', 'unb'
])

const GENERIC_CONTEXT_TERMS = new Set([
  'aluno',
  'atendimento',
  'documento',
  'funciona',
  'horario',
  'informacao',
  'instituto',
  'orientacao',
  'pedir',
  'pedido',
  'processo',
  'requerer',
  'requerimento',
  'secretaria',
  'setor',
  'solicitacao',
  'solicitar',
  'sofri'
])

const UNB_SCOPE_TERMS = [
  'unb',
  'universidade de brasilia',
  'cic',
  'ciencia da computacao',
  'computacao',
  'matricula',
  'disciplina',
  'estagio',
  'tcc',
  'projeto final',
  'extensao',
  'monitoria',
  'bolsa',
  'sigaa',
  'saa',
  'sei',
  'secretaria',
  'coordenacao',
  'graduacao',
  'curriculo',
  'grade',
  'trancamento',
  'aproveitamento',
  'equivalencia',
  'aproveitamento de estudos',
  'formatura',
  'calendario academico',
  'aula',
  'aulas',
  'professor',
  'professores',
  'docente',
  'docentes',
  'servidor',
  'servidores',
  'tecnico',
  'tecnicos',
  'ouvidoria',
  'assedio',
  'discriminacao',
  'caep'
]

const FRESHNESS_SENSITIVE_TERMS = [
  '2026',
  'atual',
  'atualmente',
  'agora',
  'hoje',
  'recente',
  'novidade',
  'noticia',
  'noticias',
  'novo',
  'nova',
  'novos',
  'novas',
  'ultima',
  'ultimo',
  'ultimas',
  'ultimos',
  'atualizado',
  'atualizada',
  'greve',
  'paralisacao',
  'paralisar',
  'indicativo',
  'assembleia',
  'reitoria',
  'orçamento',
  'orcamento'
]

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function terms(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter(term => term.length >= 3 && !STOPWORDS.has(term))
}

function isUnbScopedQuestion(question: string): boolean {
  const normalized = normalizeText(question)
  return UNB_SCOPE_TERMS.some(term => normalized.includes(term))
}

function isFreshnessSensitiveQuestion(question: string): boolean {
  const normalized = normalizeText(question)
  return FRESHNESS_SENSITIVE_TERMS.some(term => normalized.includes(normalizeText(term)))
}

function isLikelyFollowUp(question: string): boolean {
  const normalized = normalizeText(question)
  if (!normalized) return false

  return /^(e|mas|agora|hoje|entao|entao e|nesse caso|nesse contexto|sobre isso|quanto a|quanto ao|quanto aos)\b/.test(normalized)
    || /\b(isso|essa|esse|essas|esses|dessa|desse|dessas|desses|ainda|tambem|tambem|normal|novo|nova|ultim[ao]s?)\b/.test(normalized)
}

function buildSearchQuestion(messages: ChatMessage[], currentQuestion: string): string {
  const previousUserQuestions = messages
    .slice(0, -1)
    .filter(message => message.role === 'user')
    .slice(-2)
    .map(message => compactText(message.content, 260))
    .filter(Boolean)

  if (!previousUserQuestions.length || !isLikelyFollowUp(currentQuestion)) {
    return currentQuestion
  }

  return [...previousUserQuestions, currentQuestion]
    .join('\n')
    .slice(0, CONTEXTUAL_SEARCH_MAX_CHARS)
}

function hasEnoughLocalContext(question: string, results: SearchResult[]): boolean {
  const top = results[0]
  if (!top) return false

  const distinctiveTerms = terms(question).filter(term => !GENERIC_CONTEXT_TERMS.has(term))
  const queryTerms = new Set(distinctiveTerms.length ? distinctiveTerms : terms(question))
  if (!queryTerms.size) return true

  const titleTerms = new Set(terms(top.titulo))
  const topTextTerms = new Set(terms(`${top.titulo} ${top.conteudo}`).slice(0, 180))
  const overlap = [...queryTerms].filter(term => topTextTerms.has(term)).length
  const titleOverlap = [...queryTerms].filter(term => titleTerms.has(term)).length
  const coverage = overlap / queryTerms.size

  if (top.score >= 0.9 && coverage >= 0.5) return true
  if (top.score >= LOCAL_CONTEXT_MIN_SCORE && coverage >= 0.5) return true
  if (top.score >= 0.45 && titleOverlap > 0 && coverage >= 0.4) return true

  return top.score >= 0.38 && coverage >= 0.67
}

function shouldUseWebFallback(question: string, results: SearchResult[]): boolean {
  return isUnbScopedQuestion(question)
    && (isFreshnessSensitiveQuestion(question) || !hasEnoughLocalContext(question, results))
}

function mergeSearchResults(groups: Array<SearchResult[] | null | undefined>): SearchResult[] {
  const byId = new Map<string, SearchResult>()

  for (const result of groups.flatMap(group => group ?? [])) {
    const existing = byId.get(result.id)
    if (!existing || result.score > existing.score) byId.set(result.id, result)
  }

  return [...byId.values()]
}

function rankContextResults(question: string, results: SearchResult[]): SearchResult[] {
  const distinctiveTerms = terms(question).filter(term => !GENERIC_CONTEXT_TERMS.has(term))
  const queryTerms = new Set(distinctiveTerms.length ? distinctiveTerms : terms(question))
  if (!queryTerms.size) return results

  return [...results]
    .map((result, index) => {
      const title = normalizeText(result.titulo)
      const content = normalizeText(result.conteudo)
      const titleTerms = terms(result.titulo)
      const contentTerms = new Set(terms(result.conteudo).slice(0, 120))
      const titleOverlap = titleTerms.filter(term => queryTerms.has(term)).length
      const contentOverlap = [...queryTerms]
        .filter(term => contentTerms.has(term) || content.includes(term))
        .length
      const missingTitleTerms = titleTerms.filter(term => !queryTerms.has(term)).length
      const totalOverlap = [...queryTerms]
        .filter(term => titleTerms.includes(term) || contentTerms.has(term) || content.includes(term))
        .length
      const coverage = totalOverlap / queryTerms.size
      const titleCoverage = titleOverlap / queryTerms.size
      const exactShortTitle = titleTerms.length > 0
        && titleTerms.length <= 3
        && titleTerms.every(term => queryTerms.has(term))
      const exactQuestionTitle = title.length > 0
        && (normalizeText(question).includes(title) || title.includes(normalizeText(question)))

      const rank = Math.min(result.score, 1) * 0.32
        + coverage * 1.15
        + titleCoverage * 0.35
        + contentOverlap * 0.025
        + (exactShortTitle ? 0.18 : 0)
        + (exactQuestionTitle ? 0.3 : 0)
        - Math.min(missingTitleTerms, 4) * 0.035
        - index * 0.001

      return { result, rank }
    })
    .sort((a, b) => b.rank - a.rank)
    .map(item => item.result)
}

async function sendEvent(sse: SseWriter, data: object): Promise<void> {
  sse.send(data)
}

async function sendActivity(
  sse: SseWriter,
  data: {
    id: string
    kind: 'rag' | 'web' | 'answer'
    status: 'pending' | 'active' | 'done' | 'skipped' | 'error'
    label: string
    detail?: string
    sources?: ResponseSource[]
    domains?: string[]
  }
): Promise<void> {
  await sendEvent(sse, { type: 'activity', ...data })
}

function activitySources(sources: ResponseSource[], limit = 4): ResponseSource[] {
  return sources
    .slice(0, limit)
    .map(source => ({
      id: source.id,
      titulo: source.titulo,
      url: source.url,
      kind: source.kind,
      description: source.description
    }))
}

function runAfterResponse(event: Parameters<RequestHandler>[0], promise: Promise<unknown>): void {
  const platform = event.platform as WaitUntilPlatform | undefined
  const waitUntil = platform?.context?.waitUntil || platform?.waitUntil

  if (typeof waitUntil === 'function') {
    waitUntil.call(platform?.context ?? platform, promise)
    return
  }

  void promise
}

export const POST: RequestHandler = async (event) => {
  const body = await readJson<RequestBody>(event.request)
  const clientMessages = normalizeClientMessages(body?.messages)

  if (clientMessages.length === 0) {
    return apiError(400, 'INVALID_PAYLOAD')
  }

  const lastUserMessage = clientMessages[clientMessages.length - 1]

  if (!lastUserMessage || lastUserMessage.role !== 'user') {
    return apiError(400, 'INVALID_PAYLOAD')
  }

  const question = lastUserMessage.content
  const searchQuestion = buildSearchQuestion(clientMessages, question)

  return eventStream(async (sse) => {
    let reader: ReadableStreamDefaultReader<string> | null = null

    try {
    await sendEvent(sse, { type: 'status', stage: 'searching' })
    await sendActivity(sse, {
      id: 'rag',
      kind: 'rag',
      status: 'active',
      label: 'Verificando fontes do fIAq',
      detail: 'Buscando documentos e respostas oficiais disponíveis.'
    })

    let vectorResults: SearchResult[] | null = null
    let textResults: SearchResult[] | null = null
    let searchVector: number[] | null = null
    const contextSources: string[] = []

    try {
      searchVector = await embedQuery(searchQuestion)
      const ragSearch = await buscarRag(searchVector, embedInfo.model, RAG_CANDIDATE_LIMIT)
      vectorResults = ragSearch.results
      contextSources.push(ragSearch.source === 'database' ? 'banco vetorial' : 'índice local vetorial')
    } catch (error) {
      console.warn('[chat.post] Busca vetorial falhou antes do fallback textual:', error)
    }

    try {
      textResults = await buscarRagPorTextoNoBanco(searchQuestion, RAG_CANDIDATE_LIMIT)
      if (textResults?.length) contextSources.push('banco textual')
    } catch (error) {
      console.warn('[chat.post] Busca textual no banco falhou antes do fallback local:', error)
    }

    if (!textResults?.length) {
      textResults = buscarRagPorTexto(searchQuestion, RAG_CANDIDATE_LIMIT)
      if (textResults.length) contextSources.push('índice local textual')
    }

    const rawResults = mergeSearchResults([vectorResults, textResults])
    const results = rankContextResults(searchQuestion, rawResults).slice(0, RAG_RESULT_LIMIT)
    const localContextEnough = hasEnoughLocalContext(searchQuestion, results)
    const scopedToUnb = isUnbScopedQuestion(searchQuestion)
    const freshnessSensitive = isFreshnessSensitiveQuestion(searchQuestion)

    let context = buildCompactContext(results)
    let answerSources: ResponseSource[] = results.map(r => ({
      id: r.id,
      titulo: r.titulo,
      url: r.url,
      kind: 'rag'
    }))
    const webDomains = getFirecrawlIncludeDomains()
    const needsWebFallback = shouldUseWebFallback(searchQuestion, results)

    console.log(JSON.stringify({
      level: 'info',
      msg: 'chat_research_decision',
      route: '/api/chat',
      requestId: event.request.headers.get('x-vercel-id'),
      contextualSearch: searchQuestion !== question,
      sources: contextSources,
      localResults: results.length,
      localContextEnough,
      scopedToUnb,
      freshnessSensitive,
      needsWebFallback,
      topResult: results[0]
        ? { id: results[0].id, score: Number(results[0].score.toFixed(3)) }
        : null
    }))

    await sendActivity(sse, {
      id: 'rag',
      kind: 'rag',
      status: answerSources.length && !needsWebFallback ? 'done' : 'skipped',
      label: answerSources.length && !needsWebFallback ? 'Fontes encontradas' : 'Base sem contexto suficiente',
      detail: answerSources.length && !needsWebFallback
        ? `${answerSources.length} fonte(s) selecionada(s).`
        : 'A pergunta segue para pesquisa web quando está no escopo da UnB ou precisa de informação atual.',
      sources: answerSources.length && !needsWebFallback ? activitySources(answerSources) : undefined
    })

    await sendActivity(sse, {
      id: 'web-plan',
      kind: 'web',
      status: needsWebFallback ? 'active' : 'skipped',
      label: needsWebFallback ? 'Preparando pesquisa web oficial' : 'Pesquisa web disponível',
      detail: needsWebFallback
        ? 'Vou checar fontes oficiais e confiáveis na internet.'
        : 'As fontes disponíveis trouxeram contexto suficiente agora; se você avaliar negativamente, a web pode complementar.',
      domains: webDomains
    })

    if (needsWebFallback) {
      await sendEvent(sse, { type: 'status', stage: 'web_search' })
      await sendActivity(sse, {
        id: 'web-search',
        kind: 'web',
        status: 'active',
        label: 'Pesquisando fontes web',
        detail: 'Consultando fontes oficiais e confiáveis.',
        domains: webDomains
      })
      console.log('[chat.post] Pergunta UnB requer pesquisa web; consultando Firecrawl.')

      try {
        const webSources = await searchFirecrawl(searchQuestion, { signal: sse.signal })

        if (webSources.length) {
          context = buildFirecrawlContext(webSources)
          answerSources = webSources.map(source => ({
            id: source.id,
            titulo: source.titulo,
            url: source.url,
            kind: source.kind,
            description: source.description
          }))
          await sendActivity(sse, {
            id: 'web-search',
            kind: 'web',
            status: 'done',
            label: 'Fontes web selecionadas',
            detail: `${answerSources.length} fonte(s) confiável(is) encontradas para responder.`,
            sources: activitySources(answerSources),
            domains: webDomains
          })
          await sendEvent(sse, {
            type: 'mode',
            webEnhanced: true,
            reason: 'fallback_automatico'
          })
        } else {
          await sendActivity(sse, {
            id: 'web-search',
            kind: 'web',
            status: 'skipped',
            label: 'Pesquisa web sem nova fonte',
            detail: 'Nenhuma fonte nova foi selecionada; vou responder com a orientação mais segura.',
            domains: webDomains
          })
        }
      } catch (error) {
        console.warn('[chat.post] Falha na pesquisa Firecrawl; usando contexto local disponível:', error)
        await sendActivity(sse, {
          id: 'web-search',
          kind: 'web',
          status: 'error',
          label: 'Pesquisa web indisponível',
          detail: 'Vou seguir com o contexto local disponível agora.',
          domains: webDomains
        })
      }
    }

    const history = clientMessages
      .slice(0, -1)
      .map(m => ({ role: m.role, content: m.content }))

    const messages: LlmChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: buildPrompt(context, question) }
    ]

    if (answerSources.length > 0) {
      await sendEvent(sse, {
        type: 'sources',
        items: answerSources
      })
    }

    await sendActivity(sse, {
      id: 'answer',
      kind: 'answer',
      status: 'active',
      label: 'Escrevendo resposta',
      detail: 'Organizando a resposta com base nas fontes selecionadas.'
    })

    const stream = await chatStream(messages)
    reader = stream.getReader()
    const cancelReaderOnAbort = () => {
      void reader?.cancel().catch(() => {})
    }
    sse.signal.addEventListener('abort', cancelReaderOnAbort, { once: true })
    let respostaCompleta = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (sse.signal.aborted) {
          await reader.cancel().catch(() => {})
          return
        }
        respostaCompleta += value
        await sendEvent(sse, { type: 'token', content: value })
      }
    } finally {
      sse.signal.removeEventListener('abort', cancelReaderOnAbort)
    }

    await sendActivity(sse, {
      id: 'answer',
      kind: 'answer',
      status: 'done',
      label: 'Resposta pronta',
      detail: 'As fontes usadas aparecem logo abaixo da resposta.'
    })
    await sendEvent(sse, { type: 'done' })

    const questionVectorPromise = searchVector && searchQuestion === question
      ? Promise.resolve(searchVector)
      : embedQuery(question)

    runAfterResponse(event, questionVectorPromise
      .then(queryVector => registrarPergunta(
        question,
        queryVector,
        embedInfo.model,
        respostaCompleta,
        answerSources.map(source => ({ id: source.id, titulo: source.titulo, url: source.url }))
      ))
      .catch((e) => {
        console.error('[chat.post] Falha ao registrar pergunta:', e)
      }))
    } catch (e) {
      await reader?.cancel().catch(() => {})
      if (sse.signal.aborted) return
      console.error('[chat.post] Error:', e)
      await sendActivity(sse, {
        id: 'answer',
        kind: 'answer',
        status: 'error',
        label: 'Não foi possível concluir',
        detail: 'A geração falhou antes de finalizar a resposta.'
      })
      await sendEvent(sse, { type: 'error', message: 'LLM_UNAVAILABLE' })
    }
  })
}
