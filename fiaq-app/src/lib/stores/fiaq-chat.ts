import { get, writable } from 'svelte/store'

export type MessageRole = 'user' | 'assistant'

export interface Source {
  id: string
  titulo: string
  url: string
  kind?: 'rag' | 'web' | 'official'
  description?: string
}

export type SearchActivityStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error'
export type SearchActivityKind = 'rag' | 'web' | 'answer'

export interface SearchActivity {
  id: string
  kind: SearchActivityKind
  status: SearchActivityStatus
  label: string
  detail?: string
  sources?: Source[]
  domains?: string[]
}

export interface Message {
  id: number
  role: MessageRole
  content: string
  streaming?: boolean
  sources?: Source[]
  activity?: SearchActivity[]
  feedback?: 'helpful' | 'unhelpful'
  webEnhanced?: boolean
  webSearchReason?: 'fallback_automatico' | 'feedback_negativo'
}

export type MessageDraft = Omit<Message, 'id'> & { id?: number }

let msgId = 0
let initialized = false
let unsubscribePersistence: (() => void) | null = null
let activeAbortController: AbortController | null = null

const STORAGE_KEY = 'fiaq:temporary-conversation:v1'
const EMPTY_RESPONSE_MESSAGE = 'A resposta não foi concluída. Tente reenviar a pergunta em instantes.'
const ACTIVITY_STATUSES: SearchActivityStatus[] = ['pending', 'active', 'done', 'skipped', 'error']
const ACTIVITY_KINDS: SearchActivityKind[] = ['rag', 'web', 'answer']

export const messages = writable<Message[]>([])
export const loading = writable(false)

function normalizeSource(source: Partial<Source>): Source | null {
  // Títulos de páginas raspadas trazem travessão (às vezes como entidade HTML),
  // e a interface não usa travessão.
  const titulo = String(source.titulo || '')
    .replace(/&#821[12];|&[nm]dash;/g, '-')
    .replace(/\s*[–—]\s*/g, ' - ')
    .trim()
  const url = String(source.url || '').trim()
  if (!titulo && !url) return null

  const kind = source.kind === 'web' || source.kind === 'official' || source.kind === 'rag'
    ? source.kind
    : 'rag'

  return {
    id: String(source.id || url || titulo || 'fonte'),
    titulo: titulo || 'Fonte oficial',
    url,
    kind,
    description: String(source.description || '').trim() || undefined
  }
}

function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return []

  return value
    .map(source => normalizeSource(source as Partial<Source>))
    .filter((source): source is Source => Boolean(source))
}

function normalizeDomains(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const domains = value
    .map(domain => String(domain || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, ''))
    .filter(Boolean)

  return domains.length ? [...new Set(domains)] : undefined
}

function normalizeActivity(value: unknown): SearchActivity | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>
  const id = String(raw.id || raw.stage || '').trim()
  const label = String(raw.label || '').trim()
  if (!id || !label) return null

  const status = ACTIVITY_STATUSES.includes(raw.status as SearchActivityStatus)
    ? raw.status as SearchActivityStatus
    : 'active'
  const kind = ACTIVITY_KINDS.includes(raw.kind as SearchActivityKind)
    ? raw.kind as SearchActivityKind
    : 'answer'
  const sources = normalizeSources(raw.sources)
  const domains = normalizeDomains(raw.domains)

  return {
    id,
    kind,
    status,
    label,
    detail: String(raw.detail || '').trim() || undefined,
    sources: sources.length ? sources : undefined,
    domains
  }
}

function normalizeMessages(nextMessages: MessageDraft[]): Message[] {
  return nextMessages
    .map((message): Message | null => {
      const content = String(message.content ?? '').trim()
      if (!content) return null

      const sources = normalizeSources(message.sources)

      return {
        id: ++msgId,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content,
        streaming: false,
        sources: sources.length ? sources : undefined,
        feedback: message.feedback === 'helpful' || message.feedback === 'unhelpful' ? message.feedback : undefined,
        webEnhanced: Boolean(message.webEnhanced)
          || message.webSearchReason === 'fallback_automatico'
          || message.webSearchReason === 'feedback_negativo',
        webSearchReason: message.webSearchReason === 'fallback_automatico' || message.webSearchReason === 'feedback_negativo'
          ? message.webSearchReason
          : undefined
      }
    })
    .filter((message): message is Message => Boolean(message))
}

export function initChatStore() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const saved = sessionStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      const rawMessages = Array.isArray(parsed) ? parsed : parsed?.messages
      if (Array.isArray(rawMessages)) messages.set(normalizeMessages(rawMessages))
    } catch {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  }

  unsubscribePersistence = messages.subscribe((nextMessages) => {
    const stableMessages = nextMessages
      .filter(message => message.content.trim())
      .map(message => ({
        role: message.role,
        content: message.content,
        sources: message.sources,
        feedback: message.feedback,
        webEnhanced: message.webEnhanced,
        webSearchReason: message.webSearchReason
      }))

    if (!stableMessages.length) {
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      app: 'fiaq',
      kind: 'temporary-conversation',
      version: 1,
      messages: stableMessages
    }))
  })
}

export function destroyChatStore() {
  activeAbortController?.abort()
  activeAbortController = null
  loading.set(false)
  unsubscribePersistence?.()
  unsubscribePersistence = null
  initialized = false
}

function updateAssistantMessage(messageId: number, patch: Partial<Message>) {
  messages.update(current => current.map(message => (
    message.id === messageId && message.role === 'assistant'
      ? { ...message, ...patch }
      : message
  )))
}

function upsertActivity(messageId: number, activity: SearchActivity) {
  const current = get(messages).find(message => message.id === messageId && message.role === 'assistant')
  if (!current) return

  const activities = current.activity ?? []
  const idx = activities.findIndex(item => item.id === activity.id)
  const nextActivity = idx >= 0
    ? {
        ...activities[idx],
        ...activity,
        sources: activity.sources ?? activities[idx]?.sources,
        domains: activity.domains ?? activities[idx]?.domains
      }
    : activity

  const next = idx >= 0
    ? activities.map((item, itemIdx) => itemIdx === idx ? nextActivity : item)
    : [...activities, nextActivity]

  updateAssistantMessage(messageId, { activity: next })
}

function updateActivityStatus(
  messageId: number,
  id: string,
  status: SearchActivityStatus,
  label?: string,
  detail?: string
) {
  const current = get(messages).find(message => message.id === messageId && message.role === 'assistant')
  const activity = current?.activity?.find(item => item.id === id)
  if (!activity) return

  upsertActivity(messageId, {
    ...activity,
    status,
    label: label || activity.label,
    detail: detail || activity.detail
  })
}

function finalizeAssistantMessage(messageId: number, content: string) {
  updateAssistantMessage(messageId, {
    content: content.trim() ? content : EMPTY_RESPONSE_MESSAGE,
    streaming: false
  })
  loading.set(false)
}

async function streamAssistant(endpoint: string, payload: object, assistantId: number) {
  activeAbortController?.abort()
  const abort = new AbortController()
  activeAbortController = abort

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: abort.signal,
    body: JSON.stringify(payload)
  })

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulatedContent = ''
  let receivedTerminalEvent = false

  function processLine(line: string) {
    if (!line.startsWith('data: ')) return

    try {
      const event = JSON.parse(line.slice(6))

      if (event.type === 'activity') {
        const activity = normalizeActivity(event)
        if (activity) upsertActivity(assistantId, activity)
      }

      if (event.type === 'status') {
        if (event.stage === 'searching') {
          upsertActivity(assistantId, {
            id: 'rag',
            kind: 'rag',
            status: 'active',
            label: 'Verificando fontes do fIAq',
            detail: 'Buscando documentos e respostas oficiais disponíveis.'
          })
        }

        if (event.stage === 'web_search') {
          upsertActivity(assistantId, {
            id: 'web-search',
            kind: 'web',
            status: 'active',
            label: 'Pesquisando fontes web',
            detail: 'Consultando fontes oficiais e confiáveis.'
          })
        }
      }

      if (event.type === 'token') {
        if (!accumulatedContent) {
          upsertActivity(assistantId, {
            id: 'answer',
            kind: 'answer',
            status: 'active',
            label: 'Escrevendo resposta',
            detail: 'Organizando a resposta com base nas fontes selecionadas.'
          })
        }
        accumulatedContent += event.content
        updateAssistantMessage(assistantId, { content: accumulatedContent })
      }

      if (event.type === 'sources') {
        const sources = normalizeSources(event.items)
        const currentReason = get(messages).find(message => message.id === assistantId)?.webSearchReason
        const webSources = sources.filter(source => source.kind === 'web' || source.kind === 'official')
        const ragSources = sources.filter(source => source.kind === 'rag')

        if (ragSources.length) {
          upsertActivity(assistantId, {
            id: 'rag',
            kind: 'rag',
            status: 'done',
            label: 'Fontes encontradas',
            detail: `${ragSources.length} fonte(s) selecionada(s).`,
            sources: ragSources.slice(0, 4)
          })
        }

        if (webSources.length) {
          upsertActivity(assistantId, {
            id: 'web-search',
            kind: 'web',
            status: 'done',
            label: 'Fontes web selecionadas',
            detail: `${webSources.length} fonte(s) confiável(is) encontradas para responder.`,
            sources: webSources.slice(0, 4)
          })
        }

        updateAssistantMessage(assistantId, {
          sources,
          ...(webSources.length
            ? {
                webEnhanced: true,
                webSearchReason: currentReason === 'feedback_negativo'
                  ? 'feedback_negativo' as const
                  : 'fallback_automatico' as const
              }
            : {})
        })
      }

      if (event.type === 'mode' && event.webEnhanced) {
        updateAssistantMessage(assistantId, {
          webEnhanced: true,
          webSearchReason: event.reason === 'feedback_negativo' ? 'feedback_negativo' : 'fallback_automatico'
        })
      }

      if (event.type === 'done') {
        receivedTerminalEvent = true
        updateActivityStatus(assistantId, 'answer', 'done', 'Resposta pronta', 'As fontes usadas aparecem logo abaixo da resposta.')
        finalizeAssistantMessage(assistantId, accumulatedContent)
      }

      if (event.type === 'error') {
        receivedTerminalEvent = true
        const fallbackMessage = chatErrorMessage(event.message, accumulatedContent)
        updateActivityStatus(assistantId, 'answer', 'error', 'Não foi possível concluir', fallbackMessage)
        finalizeAssistantMessage(assistantId, accumulatedContent || fallbackMessage)
      }
    } catch {
      // Evento SSE parcial/malformado: aguarda a próxima linha.
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) processLine(line)
  }

  buffer += decoder.decode()
  for (const line of buffer.split('\n')) processLine(line)

  const current = get(messages).find(message => message.id === assistantId)
  if (!receivedTerminalEvent || !current?.content.trim()) {
    finalizeAssistantMessage(assistantId, accumulatedContent)
  }

  if (activeAbortController === abort) activeAbortController = null
}

export async function sendMessage(text: string) {
  const trimmed = text.trim()
  if (!trimmed || get(loading)) return

  const currentMessages = get(messages)
  const lastMessage = currentMessages[currentMessages.length - 1]
  const previousMessage = currentMessages[currentMessages.length - 2]
  if (
    lastMessage?.role === 'assistant'
    && lastMessage.streaming
    && previousMessage?.role === 'user'
    && previousMessage.content.trim() === trimmed
  ) {
    return
  }

  loading.set(true)
  messages.update(current => [...current, { id: ++msgId, role: 'user', content: trimmed }])

  const assistantId = ++msgId
  messages.update(current => [...current, { id: assistantId, role: 'assistant', content: '', streaming: true }])

  const history = get(messages)
    .slice(0, -1)
    .map(message => ({ role: message.role, content: message.content }))

  try {
    await streamAssistant('/api/chat', { messages: history }, assistantId)
  } catch {
    activeAbortController = null
    const current = get(messages).find(message => message.id === assistantId)
    updateAssistantMessage(assistantId, {
      content: current?.content.trim()
        ? current.content
        : 'Não consegui conectar com o servidor do fIAq agora. Verifique sua conexão e tente enviar novamente.',
      streaming: false
    })
  } finally {
    updateAssistantMessage(assistantId, { streaming: false })
    loading.set(false)
  }
}

function chatErrorMessage(code: unknown, partialContent: string) {
  if (partialContent.trim()) {
    return 'A resposta foi interrompida antes de terminar. Tente enviar a pergunta novamente em alguns segundos.'
  }

  if (code === 'LLM_UNAVAILABLE') {
    return 'Encontrei fontes verificadas, mas o gerador de resposta ficou indisponível agora. Tente enviar a pergunta novamente em alguns segundos.'
  }

  return 'Não consegui concluir a resposta agora. Tente enviar a pergunta novamente em alguns segundos.'
}

function findUserQuestionBefore(assistantId: number): Message | null {
  const currentMessages = get(messages)
  const assistantIndex = currentMessages.findIndex(message => message.id === assistantId)
  if (assistantIndex <= 0) return null

  for (let idx = assistantIndex - 1; idx >= 0; idx--) {
    const message = currentMessages[idx]
    if (message?.role === 'user') return message
  }

  return null
}

async function persistFeedback(
  question: Message,
  answer: Message,
  rating: 'helpful' | 'unhelpful',
  webSearchRequested: boolean
) {
  try {
    await fetch('/api/chat/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question.content,
        answer: answer.content,
        rating,
        sources: answer.sources ?? [],
        webSearchRequested,
        webSearchReason: answer.webSearchReason
      })
    })
  } catch {
    // Feedback é auxiliar: falha de persistência não deve travar a conversa.
  }
}

async function requestWebAnswer(question: Message, previousAnswer: Message) {
  if (get(loading)) return

  loading.set(true)
  const assistantId = ++msgId
  messages.update(current => [...current, {
    id: assistantId,
    role: 'assistant',
    content: '',
    streaming: true,
    webEnhanced: true,
    webSearchReason: 'feedback_negativo'
  }])

  const history = get(messages)
    .slice(0, -1)
    .map(message => ({ role: message.role, content: message.content }))

  try {
    await streamAssistant('/api/chat/web', {
      question: question.content,
      previousAnswer: previousAnswer.content,
      messages: history
    }, assistantId)
  } catch {
    activeAbortController = null
    const current = get(messages).find(message => message.id === assistantId)
    updateAssistantMessage(assistantId, {
      content: current?.content.trim()
        ? current.content
        : 'Não consegui buscar fontes adicionais agora. Tente novamente em alguns instantes.',
      streaming: false
    })
  } finally {
    updateAssistantMessage(assistantId, { streaming: false })
    loading.set(false)
  }
}

export async function rateMessage(messageId: number, rating: 'helpful' | 'unhelpful') {
  if (get(loading)) return

  const answer = get(messages).find(message => message.id === messageId && message.role === 'assistant')
  if (!answer || answer.streaming || !answer.content.trim()) return

  const question = findUserQuestionBefore(messageId)
  if (!question) return

  const shouldRequestWebAnswer = rating === 'unhelpful' && !answer.webEnhanced

  updateAssistantMessage(messageId, { feedback: rating })
  await persistFeedback(question, answer, rating, Boolean(answer.webEnhanced) || shouldRequestWebAnswer)

  if (shouldRequestWebAnswer) {
    await requestWebAnswer(question, answer)
  }
}

export function replaceMessages(nextMessages: MessageDraft[]) {
  messages.set(normalizeMessages(nextMessages))
}

export function clearMessages() {
  activeAbortController?.abort()
  activeAbortController = null
  loading.set(false)
  messages.set([])
  if (typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY)
}
