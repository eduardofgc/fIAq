import { loadServerEnv } from '../env'

loadServerEnv()

// ─── Configuração de providers ──────────────────────────────────────────────
// Por padrão tudo roda local via Ollama. Para usar o OpenRouter, defina no .env:
//   OPENROUTER_API_KEY=sk-or-...
//   CHAT_PROVIDER=openrouter
//   EMBED_PROVIDER=openrouter   (opcional — ver ressalva sobre embeddings)
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'qwen2.5:7b'
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_ROUTER_CHAT_MODEL = 'openrouter/free'
const OPENROUTER_DEFAULT_CHAT_MODEL = 'google/gemma-4-31b-it:free'
const OPENROUTER_DEFAULT_FALLBACK_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free'
]
const OPENROUTER_COMPATIBLE_EMBED_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free'
const OPENROUTER_CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || OPENROUTER_DEFAULT_CHAT_MODEL
const OPENROUTER_CHAT_MODELS = uniqueModels([
  OPENROUTER_CHAT_MODEL,
  ...parseModelList(process.env.OPENROUTER_CHAT_FALLBACK_MODELS, OPENROUTER_DEFAULT_FALLBACK_MODELS)
])
const RAW_OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || OPENROUTER_COMPATIBLE_EMBED_MODEL
const OPENROUTER_CHAT_TIMEOUT_MS = readPositiveInt(process.env.OPENROUTER_CHAT_TIMEOUT_MS, 22000)
const OPENROUTER_CHAT_ATTEMPTS = readPositiveInt(
  process.env.OPENROUTER_CHAT_ATTEMPTS,
  OPENROUTER_CHAT_MODEL === OPENROUTER_ROUTER_CHAT_MODEL ? 2 : 1
)
const OPENROUTER_CHAT_MAX_TOKENS = readPositiveInt(process.env.OPENROUTER_CHAT_MAX_TOKENS, 1200)
const OPENROUTER_CHAT_TEMPERATURE = readTemperature(process.env.OPENROUTER_CHAT_TEMPERATURE, 0.2)
// Keep this longer than known safety-classifier strings so invalid OpenRouter
// responses can be discarded before any token is shown to users.
const OPENROUTER_STREAM_PREFLIGHT_MIN_CHARS = 32
const OPENROUTER_STREAM_PREFLIGHT_CHARS = Math.max(
  readPositiveInt(process.env.OPENROUTER_STREAM_PREFLIGHT_CHARS, OPENROUTER_STREAM_PREFLIGHT_MIN_CHARS),
  OPENROUTER_STREAM_PREFLIGHT_MIN_CHARS
)

const CHAT_PROVIDER = (process.env.CHAT_PROVIDER || 'ollama').toLowerCase()
const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || 'ollama').toLowerCase()

// URL pública do app — usada no header HTTP-Referer do OpenRouter (atribuição).
// Na Vercel usa VERCEL_URL automaticamente; localmente cai no localhost.
const APP_URL = process.env.APP_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function readTemperature(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback
}

function parseModelList(value: string | undefined, fallback: string[]): string[] {
  const models = value
    ?.split(',')
    .map(model => model.trim())
    .filter(Boolean)

  return models?.length ? models : fallback
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map(model => model.trim()).filter(Boolean))]
}

function openRouterEmbedModel(): string {
  const model = RAW_OPENROUTER_EMBED_MODEL.trim() || OPENROUTER_COMPATIBLE_EMBED_MODEL

  if (model === OPENROUTER_ROUTER_CHAT_MODEL || OPENROUTER_CHAT_MODELS.includes(model)) {
    console.warn(
      `[OpenRouter] ${model} é um modelo de chat, não de embeddings. `
      + `Usando ${OPENROUTER_COMPATIBLE_EMBED_MODEL} para manter o RAG/pgvector compatível.`
    )
    return OPENROUTER_COMPATIBLE_EMBED_MODEL
  }

  return model
}

const OPENROUTER_EMBED_MODEL = openRouterEmbedModel()

// Identifica o modelo de embedding ativo — usado para gravar/consultar o RAG
// no banco e validar o fallback JSON (modelos diferentes são incompatíveis).
export const embedInfo = {
  provider: EMBED_PROVIDER,
  model: EMBED_PROVIDER === 'openrouter' ? OPENROUTER_EMBED_MODEL : EMBED_MODEL
}

// Cabeçalhos exigidos pelo OpenRouter (Referer/Title são opcionais mas recomendados).
function openRouterHeaders(): Record<string, string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY não definido no .env')
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': APP_URL,
    'X-Title': 'fIAq'
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ─── Chat (não-streaming) ─────────────────────────────────────────────────────
export async function chat(messages: ChatMessage[]): Promise<string> {
  if (CHAT_PROVIDER === 'openrouter') {
    return openRouterChatText(messages, false)
  }

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: false })
  })

  if (!res.ok) throw new Error(`Ollama chat error: ${res.status}`)

  const data = await res.json()
  return data?.message?.content ?? ''
}

// ─── Chat (streaming) ─────────────────────────────────────────────────────────
export async function chatStream(messages: ChatMessage[]): Promise<ReadableStream<string>> {
  if (CHAT_PROVIDER === 'openrouter') {
    return openRouterChatStream(messages)
  }

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // keep_alive mantém o modelo carregado na GPU entre mensagens (evita recarregar).
    body: JSON.stringify({ model: CHAT_MODEL, messages, stream: true, keep_alive: '30m' })
  })

  if (!res.ok) throw new Error(`Ollama stream error: ${res.status}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<string>({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        buffer = lines.pop() ?? ''
        let enqueued = false

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const json = JSON.parse(trimmed)

            if (json.done === false && json.message?.content) {
              controller.enqueue(json.message.content)
              enqueued = true
            }
          } catch {
            // linha parcial/incompleta no buffer — ignora e aguarda a próxima
          }
        }

        if (enqueued) return
      }
    }
  })
}

// Streaming no formato OpenAI/SSE usado pelo OpenRouter:
//   data: {"choices":[{"delta":{"content":"..."}}]}\n\n
//   data: [DONE]
async function openRouterChatStream(messages: ChatMessage[]): Promise<ReadableStream<string>> {
  return new ReadableStream<string>({
    async start(controller) {
      let lastErr: unknown

      for (const model of OPENROUTER_CHAT_MODELS) {
        for (let attempt = 1; attempt <= OPENROUTER_CHAT_ATTEMPTS; attempt++) {
          let emitted = false

          try {
            const result = await openRouterStreamOnce(model, messages, (chunk) => {
              controller.enqueue(chunk)
              emitted = true
            })

            if (!result.unusable) {
              controller.close()
              return
            }

            lastErr = new Error('OpenRouter retornou conteúdo inválido para resposta final')
            warnInvalidOpenRouterText(model, attempt, result.text)

            if (emitted) {
              controller.error(lastErr)
              return
            }
          } catch (e) {
            lastErr = e
            console.warn(`[OpenRouter] Falha em ${model} no streaming attempt ${attempt}:`, e)

            if (emitted) {
              controller.error(e)
              return
            }
          }

          if (attempt < OPENROUTER_CHAT_ATTEMPTS) {
            await sleep(600 * attempt)
          }
        }
      }

      controller.error(lastErr)
    }
  })
}

async function openRouterRawChatStream(model: string, messages: ChatMessage[]): Promise<ReadableStream<string>> {
  const abort = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const clearStreamTimeout = () => {
    if (timeout) clearTimeout(timeout)
    timeout = undefined
  }
  const resetStreamTimeout = () => {
    clearStreamTimeout()
    timeout = setTimeout(() => abort.abort(), OPENROUTER_CHAT_TIMEOUT_MS)
  }
  resetStreamTimeout()

  let res: Response
  try {
    res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: 'POST',
      headers: openRouterHeaders(),
      signal: abort.signal,
      body: JSON.stringify(openRouterChatBody(model, messages, true))
    })
  } catch (e) {
    clearStreamTimeout()
    throw e
  }

  if (!res.ok) {
    const body = await res.text()
    clearStreamTimeout()
    throw new Error(`OpenRouter stream error: ${res.status} ${body}`)
  }
  if (!res.body) {
    clearStreamTimeout()
    throw new Error('No response body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<string>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) {
            clearStreamTimeout()
            controller.close()
            return
          }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')

          buffer = lines.pop() ?? ''
          let enqueued = false

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue
            resetStreamTimeout()

            const payload = trimmed.slice(5).trim()
            if (payload === '[DONE]') {
              clearStreamTimeout()
              controller.close()
              return
            }

            try {
              const json = JSON.parse(payload)
              const content = json.choices?.[0]?.delta?.content

              if (content) {
                controller.enqueue(content)
                enqueued = true
              }
            } catch {
              // chunk SSE parcial — ignora e aguarda completar no próximo read
            }
          }

          if (enqueued) return
        }
      } catch (e) {
        clearStreamTimeout()
        controller.error(e)
      }
    },
    cancel() {
      clearStreamTimeout()
      abort.abort()
    }
  })
}

async function openRouterChatText(messages: ChatMessage[], stream: boolean): Promise<string> {
  let lastErr: unknown

  for (const model of OPENROUTER_CHAT_MODELS) {
    for (let attempt = 1; attempt <= OPENROUTER_CHAT_ATTEMPTS; attempt++) {
      try {
        const text = stream
          ? await openRouterStreamTextOnce(model, messages)
          : await openRouterChatTextOnce(model, messages)

        if (!isUnusableOpenRouterText(text)) {
          return text
        }

        lastErr = new Error('OpenRouter retornou conteúdo inválido para resposta final')
        warnInvalidOpenRouterText(model, attempt, text)
      } catch (e) {
        lastErr = e
        console.warn(`[OpenRouter] Falha em ${model} no attempt ${attempt}:`, e)
      }

      if (attempt < OPENROUTER_CHAT_ATTEMPTS) {
        await sleep(600 * attempt)
      }
    }
  }

  throw lastErr
}

function openRouterChatBody(model: string, messages: ChatMessage[], stream: boolean): object {
  return {
    model,
    messages,
    stream,
    max_tokens: OPENROUTER_CHAT_MAX_TOKENS,
    temperature: OPENROUTER_CHAT_TEMPERATURE,
    // Os fallbacks nemotron são modelos de raciocínio: "exclude" ainda gasta o
    // orçamento de max_tokens pensando e devolve conteúdo vazio. "enabled: false"
    // desliga o raciocínio de vez, sem consumir tokens da resposta.
    reasoning: { enabled: false }
  }
}

async function openRouterChatTextOnce(model: string, messages: ChatMessage[]): Promise<string> {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), OPENROUTER_CHAT_TIMEOUT_MS)

  try {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: 'POST',
      headers: openRouterHeaders(),
      signal: abort.signal,
      body: JSON.stringify(openRouterChatBody(model, messages, false))
    })

    if (!res.ok) throw new Error(`OpenRouter chat error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timeout)
  }
}

async function openRouterStreamTextOnce(model: string, messages: ChatMessage[]): Promise<string> {
  const stream = await openRouterRawChatStream(model, messages)
  const reader = stream.getReader()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += value
  }

  return text
}

async function openRouterStreamOnce(
  model: string,
  messages: ChatMessage[],
  enqueue: (chunk: string) => void
): Promise<{ text: string, emitted: boolean, unusable: boolean }> {
  const stream = await openRouterRawChatStream(model, messages)
  const reader = stream.getReader()
  let text = ''
  let emitted = false

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      const unusable = isUnusableOpenRouterText(text)
      if (!unusable && !emitted && text) {
        enqueue(text)
        emitted = true
      }
      return { text, emitted, unusable }
    }

    text += value

    if (hasCjkText(value)) {
      await reader.cancel().catch(() => {})
      return { text, emitted, unusable: true }
    }

    if (!emitted && text.trim().length < OPENROUTER_STREAM_PREFLIGHT_CHARS) continue

    enqueue(emitted ? value : text)
    emitted = true
  }
}

function isUnusableOpenRouterText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (hasCjkText(trimmed)) return true

  return isSafetyClassifierText(trimmed)
    || /^(?:safe|unsafe)$/i.test(trimmed)
}

function hasCjkText(text: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text)
}

function isSafetyClassifierText(text: string): boolean {
  return /^(?:user|assistant)\s+safety\s*:\s*(?:safe|unsafe)$/i.test(text)
}

function warnInvalidOpenRouterText(model: string, attempt: number, text: string): void {
  const trimmed = text.trim()
  console.warn(
    `[OpenRouter] Resposta de ${model} descartada no attempt ${attempt}: `
    + `length=${trimmed.length}, hasCjk=${hasCjkText(trimmed)}, `
    + `isSafetyClassifier=${isSafetyClassifierText(trimmed) || /^(?:safe|unsafe)$/i.test(trimmed)}`
  )
}

// ─── Embeddings ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// O tier free do OpenRouter às vezes devolve respostas transitórias sem o vetor
// (ou 429). Tentamos algumas vezes com backoff antes de desistir.
export async function embed(text: string): Promise<number[]> {
  const attempts = EMBED_PROVIDER === 'openrouter' ? 4 : 1
  let lastErr: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await embedOnce(text)
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) await sleep(800 * (i + 1))
    }
  }
  throw lastErr
}

async function embedOnce(text: string): Promise<number[]> {
  if (EMBED_PROVIDER === 'openrouter') {
    const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: text })
    })
    if (!res.ok) throw new Error(`OpenRouter embed error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    const vector = data.data?.[0]?.embedding
    if (!Array.isArray(vector)) throw new Error('OpenRouter embed: resposta sem embedding')
    return vector
  }

  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text })
  })

  if (!res.ok) throw new Error(`Ollama embed error: ${res.status}`)

  const data = await res.json()
  return data.embedding
}
