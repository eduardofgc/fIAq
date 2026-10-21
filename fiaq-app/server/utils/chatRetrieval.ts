import { embedInfo } from './llmProvider'
import { buscarRag, buscarRagPorTexto, buscarRagPorTextoNoBanco, type SearchResult } from '../repositorios/rag'

// Busca e seleção de contexto do chat (/api/chat). Fica fora da rota para que
// o script de avaliação (scripts/eval-rag.ts) rode exatamente o mesmo código.

interface HistoryMessage {
  role: string
  content: string
}

export const RAG_RESULT_LIMIT = 3
export const RAG_CANDIDATE_LIMIT = 8
// Guias passo a passo passam de 3 mil caracteres; com um corte menor o modelo
// só via a introdução e respondia "consulte a página" sem os passos. O teto
// total é que limita: FAQs curtos à frente deixam espaço pro guia inteiro.
export const MAX_CONTEXT_CHARS_PER_RESULT = 3800
export const MAX_CONTEXT_CHARS_TOTAL = 7000
export const LOCAL_CONTEXT_MIN_SCORE = 0.52
export const CONTEXTUAL_SEARCH_MAX_CHARS = 700

export function stripLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    // Domínio solto sai, mas e-mail fica inteiro: sem o lookaround, "saa@unb.br"
    // virava "saa@" e o modelo respondia com o contato cortado.
    .replace(/(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?(?![\w@-])/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}

export function compactText(text: string, maxChars: number): string {
  const normalized = stripLinks(text).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized

  const sliced = normalized.slice(0, maxChars).replace(/\s+\S*$/, '').trim()
  return `${sliced}...`
}

export function buildCompactContext(results: SearchResult[]): string {
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

export const STOPWORDS = new Set([
  'a', 'ao', 'aos', 'as', 'como', 'com', 'da', 'das', 'de', 'do', 'dos', 'e',
  'em', 'essa', 'essas', 'esse', 'esses', 'esta', 'estas', 'este', 'estes',
  'eu', 'faco', 'fazer', 'ha', 'isso', 'ja', 'la', 'lo', 'me', 'na', 'no', 'o',
  'os', 'ou', 'para', 'por', 'posso', 'pra', 'pro', 'quais', 'qual', 'quando',
  'que', 'quero', 'sao', 'se', 'sobre', 'tu', 'um', 'uma', 'unb'
])

// Palavras que não dizem o assunto. As de "pedido de detalhe" vêm de
// continuações ("quais são essas orientações detalhadas?") e, se contassem,
// derrubavam a cobertura de um trecho que é exatamente sobre o assunto.
export const GENERIC_CONTEXT_TERMS = new Set([
  'aluno',
  'atendimento',
  'detalhada',
  'detalhadas',
  'detalhado',
  'detalhados',
  'detalhes',
  'documento',
  'edital',
  'etapas',
  'informacoes',
  'orientacoes',
  'passo',
  'passos',
  'procedimento',
  'procedimentos',
  'prosseguimento',
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

export const UNB_SCOPE_TERMS = [
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
  'curricular',
  'grade',
  'trancamento',
  'trancar',
  'tranco',
  'aproveitamento',
  'auxilio',
  'assistencia estudantil',
  'declaracao',
  'desligad',
  'diploma',
  'colacao',
  'historico',
  'mencao',
  'reintegra',
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

export const FRESHNESS_SENSITIVE_TERMS = [
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

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function terms(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter(term => term.length >= 2 && !STOPWORDS.has(term))
}

// Variações da mesma palavra ("tranco"/"trancar"/"trancamento",
// "migrar"/"migracao"): sem isso, "como tranco uma disciplina?" só casava
// "disciplina" e o guia de trancamento empatava com qualquer outro guia.
const STEM_LENGTH = 5

function stem(term: string): string {
  return term.length >= STEM_LENGTH ? term.slice(0, STEM_LENGTH) : term
}

function stems(words: Iterable<string>): Set<string> {
  return new Set([...words].map(stem))
}

function matchesTerm(term: string, words: Set<string>, wordStems: Set<string>): boolean {
  return words.has(term) || (term.length >= STEM_LENGTH && wordStems.has(stem(term)))
}

export function isUnbScopedQuestion(question: string): boolean {
  const normalized = normalizeText(question)
  return UNB_SCOPE_TERMS.some(term => normalized.includes(term))
}

export function isFreshnessSensitiveQuestion(question: string): boolean {
  const normalized = normalizeText(question)
  return FRESHNESS_SENSITIVE_TERMS.some(term => normalized.includes(normalizeText(term)))
}

export function isLikelyFollowUp(question: string): boolean {
  const normalized = normalizeText(question)
  if (!normalized) return false

  return /^(e|mas|agora|hoje|entao|entao e|nesse caso|nesse contexto|sobre isso|quanto a|quanto ao|quanto aos)\b/.test(normalized)
    || /\b(isso|essa|esse|essas|esses|dessa|desse|dessas|desses|ainda|tambem|tambem|normal|novo|nova|ultim[ao]s?)\b/.test(normalized)
}

export function buildSearchQuestion(messages: HistoryMessage[], currentQuestion: string): string {
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

export function hasEnoughLocalContext(question: string, results: SearchResult[]): boolean {
  const top = results[0]
  if (!top) return false

  // Conteúdo só "institucional" (grupo estudantil, empresa júnior, site de
  // captação...) nunca conta como suficiente sozinho — sempre libera o
  // fallback web, mesmo com score/cobertura altos, porque não é fonte
  // normativa pra regra/prazo/procedimento.
  if (top.nivelConfianca !== 'oficial') return false

  const distinctiveTerms = terms(question).filter(term => !GENERIC_CONTEXT_TERMS.has(term))
  const queryTerms = new Set(distinctiveTerms.length ? distinctiveTerms : terms(question))
  if (!queryTerms.size) return true

  const titleTerms = new Set(terms(top.titulo))
  const topTextTerms = new Set(terms(`${top.titulo} ${top.conteudo}`).slice(0, 180))
  const topTextStems = stems(topTextTerms)
  const titleStems = stems(titleTerms)
  const overlap = [...queryTerms].filter(term => matchesTerm(term, topTextTerms, topTextStems)).length
  const titleOverlap = [...queryTerms].filter(term => matchesTerm(term, titleTerms, titleStems)).length
  const coverage = overlap / queryTerms.size

  if (top.score >= 0.9 && coverage >= 0.5) return true
  if (top.score >= LOCAL_CONTEXT_MIN_SCORE && coverage >= 0.5) return true
  // Pergunta de "como faço" com um guia passo a passo oficial em 1º lugar:
  // a cobertura cai com verbo coloquial ("fui desligado, como volto?") que
  // não aparece no guia, mas o guia é exatamente o que responde.
  if (PROCEDURAL_QUESTION.test(normalizeText(question))
    && PROCEDURAL_TITLE.test(normalizeText(top.titulo))
    && coverage >= 0.33) return true
  if (top.score >= 0.45 && titleOverlap > 0 && coverage >= 0.4) return true

  return top.score >= 0.38 && coverage >= 0.67
}

// Pedido de continuação que cobra mais detalhe ("e como eu dou prosseguimento?",
// "quais são essas orientações detalhadas?") indica que a resposta anterior,
// montada com a base local, não bastou. Repetir os mesmos trechos não ajuda.
export function isDetailFollowUp(question: string): boolean {
  if (!isLikelyFollowUp(question)) return false

  return /\b(detalh\w*|passo a passo|passos|etapas|orientac\w*|procedimento\w*|prossegu\w*|como (eu )?(faco|fazer|solicito|solicitar|peco|pedir|dou|procedo|proceder))\b/
    .test(normalizeText(question))
}

export function shouldUseWebFallback(question: string, results: SearchResult[], detailFollowUp = false): boolean {
  return isUnbScopedQuestion(question)
    && (detailFollowUp || isFreshnessSensitiveQuestion(question) || !hasEnoughLocalContext(question, results))
}

export function mergeSearchResults(groups: Array<SearchResult[] | null | undefined>): SearchResult[] {
  const byId = new Map<string, SearchResult>()

  for (const result of groups.flatMap(group => group ?? [])) {
    const existing = byId.get(result.id)
    if (!existing || result.score > existing.score) byId.set(result.id, result)
  }

  return [...byId.values()]
}

// "como" + verbo na 1ª pessoa ou no infinitivo ("como tranco", "como migrar",
// "como volto"), fora formas que não pedem procedimento ("como são", "como isso").
export const PROCEDURAL_QUESTION = /\b(como (eu )?(?!sao\b|isso\b|no\b|do\b)\w+(o|ar|er|ir)|passo a passo|procedimento|o que (eu )?preciso fazer)\b/
export const PROCEDURAL_TITLE = /\b(passo a passo|como solicitar|como fazer|como acessar|como usar|guia)\b/

export function rankContextResults(question: string, results: SearchResult[]): SearchResult[] {
  const distinctiveTerms = terms(question).filter(term => !GENERIC_CONTEXT_TERMS.has(term))
  const queryTerms = new Set(distinctiveTerms.length ? distinctiveTerms : terms(question))
  if (!queryTerms.size) return results

  const normalizedQuestion = normalizeText(question)
  const proceduralQuestion = PROCEDURAL_QUESTION.test(normalizedQuestion)

  return [...results]
    .map((result, index) => {
      const title = normalizeText(result.titulo)
      const content = normalizeText(result.conteudo)
      const titleTerms = terms(result.titulo)
      const titleTermSet = new Set(titleTerms)
      const titleStems = stems(titleTerms)
      const contentTerms = new Set(terms(result.conteudo).slice(0, 120))
      const contentStems = stems(contentTerms)
      const inTitle = (term: string) => matchesTerm(term, titleTermSet, titleStems)
      const titleOverlap = [...queryTerms].filter(inTitle).length
      // Substring só pra termo longo: "ru" ou "ti" aparecem dentro de
      // "estrutura", "grupo", "partida"... e casariam com quase tudo.
      const inContent = (term: string) => matchesTerm(term, contentTerms, contentStems)
        || (term.length >= 4 && content.includes(term))
      const contentOverlap = [...queryTerms].filter(inContent).length
      const missingTitleTerms = titleTerms.filter(term => !queryTerms.has(term)).length
      const totalOverlap = [...queryTerms]
        .filter(term => inTitle(term) || inContent(term))
        .length
      const coverage = totalOverlap / queryTerms.size
      const titleCoverage = titleOverlap / queryTerms.size
      const exactShortTitle = titleTerms.length > 0
        && titleTerms.length <= 3
        && titleTerms.every(term => queryTerms.has(term))
      // Título genérico de 1 ou 2 palavras ("RU", "Estrutura Curricular") quase
      // sempre aparece dentro da pergunta, sem que o trecho responda a ela.
      // E a pergunta curta dentro de um título longo sobre outra coisa ("como
      // faço matrícula" em "como faço matrícula em estágio obrigatório") também não.
      const exactQuestionTitle = title.length > 0
        && missingTitleTerms <= 1
        && (title.includes(normalizedQuestion)
          || (titleTerms.length >= 3 && normalizedQuestion.includes(title)))
      const proceduralMatch = proceduralQuestion && PROCEDURAL_TITLE.test(title)

      const rank = Math.min(result.score, 1) * 0.32
        + coverage * 1.15
        + titleCoverage * 0.35
        + contentOverlap * 0.025
        + (exactShortTitle ? 0.18 : 0)
        + (exactQuestionTitle ? 0.3 : 0)
        + (proceduralMatch ? 0.35 : 0)
        // Termo explícito de confiança: sem isso, o clip em Math.min(score, 1)
        // engole o boost de nivelConfianca já embutido no score bruto sempre
        // que um resultado institucional já vem com score alto por keyword
        // match puro (ex.: página de grupo estudantil "vencendo" por bater
        // palavra, mesmo sendo assunto diferente da pergunta).
        + (result.nivelConfianca === 'oficial' ? 0.25 : 0)
        - Math.min(missingTitleTerms, 4) * 0.035
        - index * 0.001

      return { result, rank }
    })
    .sort((a, b) => b.rank - a.rank)
    .map(item => item.result)
}

export interface RagSearchOutcome {
  rawResults: SearchResult[]
  contextSources: string[]
  vector: number[] | null
}

export async function searchRag(
  searchQuestion: string,
  embed: (text: string) => Promise<number[]>
): Promise<RagSearchOutcome> {
  let searchVector: number[] | null = null
  const contextSources: string[] = []

  // Busca vetorial e textual são independentes — rodam em paralelo pra não
  // somar duas idas de rede/banco em série no caminho crítico da resposta.
  const [vectorOutcome, textOutcome] = await Promise.all([
    (async () => {
      try {
        const vector = await embed(searchQuestion)
        searchVector = vector
        const ragSearch = await buscarRag(vector, embedInfo.model, RAG_CANDIDATE_LIMIT)
        return { results: ragSearch.results, source: ragSearch.source === 'database' ? 'banco vetorial' : 'índice local vetorial' }
      } catch (error) {
        console.warn('[chat.post] Busca vetorial falhou antes do fallback textual:', error)
        return null
      }
    })(),
    (async () => {
      try {
        const dbResults = await buscarRagPorTextoNoBanco(searchQuestion, RAG_CANDIDATE_LIMIT)
        if (dbResults?.length) return { results: dbResults, source: 'banco textual' }
      } catch (error) {
        console.warn('[chat.post] Busca textual no banco falhou antes do fallback local:', error)
      }

      const localResults = buscarRagPorTexto(searchQuestion, RAG_CANDIDATE_LIMIT)
      return localResults.length ? { results: localResults, source: 'índice local textual' } : null
    })()
  ])

  if (vectorOutcome) contextSources.push(vectorOutcome.source)
  if (textOutcome) contextSources.push(textOutcome.source)

  return {
    rawResults: mergeSearchResults([vectorOutcome?.results, textOutcome?.results]),
    contextSources,
    vector: searchVector
  }
}

export interface LocalContextSelection {
  results: SearchResult[]
  localContextEnough: boolean
  scopedToUnb: boolean
  freshnessSensitive: boolean
  detailFollowUp: boolean
  needsWebFallback: boolean
}

// question: a mensagem atual do aluno; searchQuestion: a usada na busca (pode
// juntar perguntas anteriores numa continuação).
export function selectLocalContext(
  question: string,
  searchQuestion: string,
  rawResults: SearchResult[]
): LocalContextSelection {
  const results = rankContextResults(searchQuestion, rawResults).slice(0, RAG_RESULT_LIMIT)
  const detailFollowUp = isDetailFollowUp(question)

  return {
    results,
    localContextEnough: hasEnoughLocalContext(searchQuestion, results),
    scopedToUnb: isUnbScopedQuestion(searchQuestion),
    freshnessSensitive: isFreshnessSensitiveQuestion(searchQuestion),
    detailFollowUp,
    needsWebFallback: shouldUseWebFallback(searchQuestion, results, detailFollowUp)
  }
}
