import type { RequestHandler } from './$types'
import { apiError, readJson } from '$lib/server/http'
import { eventStream, type SseWriter } from '$lib/server/sse'
import { embedQuery } from '../../../../server/utils/embeddings'
import { chatStream, embedInfo, type ChatMessage as LlmChatMessage } from '../../../../server/utils/llmProvider'
import { registrarPergunta } from '../../../../server/repositorios/pergunta'
import {
  buildCompactContext,
  buildSearchQuestion,
  searchRag,
  selectLocalContext
} from '../../../../server/utils/chatRetrieval'
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

const MAX_HISTORY_MESSAGES = 12
const MAX_CLIENT_MESSAGE_CHARS = 2_000
const NO_RELIABLE_CONTEXT_MESSAGE = 'Nenhuma informação relevante e confiável foi encontrada na base de dados nem na web para esta pergunta específica.'

const SYSTEM_PROMPT = `Você é o assistente virtual do fIAq, portal acadêmico do CIC/UnB.

Regras:
* Responda sempre em português brasileiro, de forma direta, clara e acolhedora.
* Use o <contexto> como fonte principal. Combine trechos relacionados antes de responder.
* Não invente URLs, e-mails, prazos, documentos, regras ou procedimentos.
* Não invente nomes de setores, comissões, conselhos ou siglas de órgãos da UnB que não estejam explicitamente no <contexto>. Se precisar indicar a quem procurar e o órgão certo não estiver claro no contexto, diga algo genérico como "a secretaria ou coordenação do seu curso", sem inventar um nome específico.
* Quando o contexto vier de sindicato ou veículo jornalístico, trate como indício/contexto externo e recomende confirmar decisões acadêmicas em canais institucionais da UnB.
* Não escreva URLs no corpo; os links clicáveis aparecem abaixo da resposta.
* Não crie seções "Links úteis", "Fontes", "Referências" ou listas de links no corpo da resposta.
* Não use marcadores de fonte no corpo, como [1], [2] ou [3]; as fontes aparecem automaticamente abaixo da resposta.
* Use Markdown simples, sem blocos de código e sem emojis.
* Em perguntas de escopo UnB, nunca use frases como "não sei", "não tenho informação" ou "não encontrei informação". Se a informação não estiver confirmada, dê a melhor orientação possível, indique o setor, sistema ou documento provável e deixe claro o próximo passo sem inventar fatos.
* Quando o aluno perguntar como fazer algo e o <contexto> trouxer os passos, liste esses passos em lista numerada, com os detalhes concretos que aparecem lá (sistema, tipo de pedido, o que preencher, documentos). Não troque esses detalhes por "consulte a página X". Nunca crie passos, etapas, sistemas ou documentos que não estejam no contexto: se o contexto só disser onde fazer o pedido, diga isso de forma concreta (qual sistema ou página e qual tipo de pedido), sem inventar etapas.
* Para dúvidas amplas de matrícula, explique o processo geral primeiro. Você pode dizer que calouros e veteranos podem ter orientações específicas, mas não peça esclarecimento como resposta principal.
* Não afirme que matrícula de calouros é automática, nem descreva regra de calouros, se isso não estiver explicitamente confirmado no contexto.
* Em assédio, discriminação, violência ou saúde mental, oriente a procurar a Ouvidoria e o CAEP.
* NUNCA mostre seu raciocínio interno, rascunhos ou análise do contexto na resposta. Vá direto à resposta final.
* Não use prefixos como "The user wants...", "Context says...", "I need to...". Responda apenas em português brasileiro.
* Não use travessão (—) em nenhuma parte da resposta. Use vírgula, ponto, dois-pontos ou parênteses no lugar.`

function buildPrompt(context: string, question: string): string {
  return `<contexto>
${context}
</contexto>

Pergunta do aluno: ${question}`
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

    const { rawResults, contextSources, vector: searchVector } = await searchRag(searchQuestion, embedQuery)
    const {
      results,
      localContextEnough,
      scopedToUnb,
      freshnessSensitive,
      detailFollowUp,
      needsWebFallback
    } = selectLocalContext(question, searchQuestion, rawResults)

    let context = buildCompactContext(results)
    let answerSources: ResponseSource[] = results.map(r => ({
      id: r.id,
      titulo: r.titulo,
      url: r.url,
      kind: 'rag'
    }))
    const webDomains = getFirecrawlIncludeDomains()

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
      detailFollowUp,
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
          const webAnswerSources: ResponseSource[] = webSources.map(source => ({
            id: source.id,
            titulo: source.titulo,
            url: source.url,
            kind: source.kind,
            description: source.description
          }))
          // Base local boa + web acionada só por pedido de detalhe ou por ser
          // assunto atual: soma as duas, senão os passos que já vieram do banco
          // somem da resposta.
          if (localContextEnough) {
            context = `${context}\n\n${buildFirecrawlContext(webSources)}`
            answerSources = [...answerSources, ...webAnswerSources]
          } else {
            context = buildFirecrawlContext(webSources)
            answerSources = webAnswerSources
          }
          await sendActivity(sse, {
            id: 'web-search',
            kind: 'web',
            status: 'done',
            label: 'Fontes web selecionadas',
            detail: `${webAnswerSources.length} fonte(s) confiável(is) encontradas para responder.`,
            sources: activitySources(webAnswerSources),
            domains: webDomains
          })
          await sendEvent(sse, {
            type: 'mode',
            webEnhanced: true,
            reason: 'fallback_automatico'
          })
        } else {
          // Contexto local já era fraco (por isso caímos aqui) e a web não achou
          // nada pra complementar — não entrega o melhor resultado local como se
          // fosse confiável, senão o modelo detalha um documento de outro assunto
          // com confiança (ex.: responder sobre dupla graduação citando um edital
          // de bolsa PIBIC só porque ambos têm "edital" no texto).
          if (!localContextEnough) {
            context = NO_RELIABLE_CONTEXT_MESSAGE
            answerSources = []
          }
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
        if (!localContextEnough) {
          context = NO_RELIABLE_CONTEXT_MESSAGE
          answerSources = []
        }
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
