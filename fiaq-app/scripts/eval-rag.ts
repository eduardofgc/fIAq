// Avaliação da busca e do ranking do chat, com o mesmo código da rota /api/chat
// (server/utils/chatRetrieval.ts), sobre o índice local server/assets/rag-index.json.
// Não chama o modelo de chat. Embeddings das perguntas ficam em cache, então
// só pergunta nova gasta cota do OpenRouter.
//
// Uso (em fiaq-app/):  pnpm eval:rag            resumo + falhas
//                      pnpm eval:rag --verbose  top 3 de todos os casos
//                      pnpm eval:rag --faq      cada pergunta do FAQ tem que
//                                               achar a própria resposta
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Caso {
  pergunta: string
  historico?: string[]
  // Documentos que respondem à pergunta. Basta um deles entre os 3 trechos
  // usados pelo chat. Vazio = não importa o documento (ex.: só a decisão web).
  esperado: string[]
  // Se definido, a decisão de ir para a pesquisa web tem que bater.
  web?: boolean
}

interface Cache {
  model: string
  vectors: Record<string, number[]>
}

const ROOT = process.cwd()
const CASOS_PATH = join(ROOT, 'scripts', 'eval-rag-casos.json')
const CACHE_PATH = join(ROOT, 'scripts', 'eval-rag-cache.json')
const INDEX_PATH = join(ROOT, 'server', 'assets', 'rag-index.json')
// Abaixo do limite de 20 requisições/minuto dos modelos gratuitos.
const EMBED_INTERVAL_MS = 3500
const verbose = process.argv.includes('--verbose')
const modoFaq = process.argv.includes('--faq')

// Sempre o índice local: resultado reprodutível, sem depender do banco.
process.env.DATABASE_URL = ''

const { loadChunks } = await import('../server/utils/vectorStore')
const { embedQuery } = await import('../server/utils/embeddings')
const { embedInfo } = await import('../server/utils/llmProvider')
const { buildSearchQuestion, searchRag, selectLocalContext } = await import('../server/utils/chatRetrieval')
const { FAQ_DENTRO_DA_GESTAO } = await import('../server/utils/professores')

// O .env.local pode ter sobrescrito ao carregar o provider.
process.env.DATABASE_URL = ''

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
if (index.meta?.model !== embedInfo.model) {
  console.error(`rag-index.json foi gerado com "${index.meta?.model}", mas o .env usa "${embedInfo.model}".`)
  process.exit(1)
}
loadChunks(index.chunks)

function casosDoFaq(): Caso[] {
  const dir = join(ROOT, 'data', 'faq')
  return readdirSync(dir)
    .filter(file => file.startsWith('faq-') && file.endsWith('.json'))
    .flatMap(file => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Array<{ id: string, titulo: string }>)
    .map(entrada => ({ pergunta: entrada.titulo, esperado: [entrada.id] }))
}

const casos: Caso[] = modoFaq ? casosDoFaq() : JSON.parse(readFileSync(CASOS_PATH, 'utf8'))

let cache: Cache = { model: embedInfo.model, vectors: {} }
if (existsSync(CACHE_PATH)) {
  const saved = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Cache
  if (saved.model === embedInfo.model) cache = saved
}

let novos = 0
async function embedComCache(text: string): Promise<number[]> {
  const cached = cache.vectors[text]
  if (cached) return cached

  if (novos > 0) await new Promise(resolve => setTimeout(resolve, EMBED_INTERVAL_MS))
  const vector = await embedQuery(text)
  novos++
  cache.vectors[text] = vector
  // Grava a cada embedding: se a cota acabar no meio, o progresso fica.
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache)}\n`)
  return vector
}

function corresponde(id: string, esperado: string): boolean {
  // A resposta de chefia e coordenações traz o texto dessa entrada do FAQ.
  if (id === 'gestao-cic' && esperado === FAQ_DENTRO_DA_GESTAO) return true
  // Chunks de crawl/pdf têm sufixo "-1", "-2"...; FAQ usa o id direto.
  return id === esperado || (id.startsWith(`${esperado}-`) && /^\d+$/.test(id.slice(esperado.length + 1)))
}

let docAvaliados = 0
let docTop3 = 0
let docTop1 = 0
let webAvaliados = 0
let webCertos = 0
const falhas: string[] = []

for (const caso of casos) {
  const mensagens = [
    ...(caso.historico ?? []).map(content => ({ role: 'user', content })),
    { role: 'user', content: caso.pergunta }
  ]
  const searchQuestion = buildSearchQuestion(mensagens, caso.pergunta)

  let selecao
  try {
    const { rawResults } = await searchRag(searchQuestion, embedComCache)
    selecao = selectLocalContext(caso.pergunta, searchQuestion, rawResults)
  } catch (error) {
    console.error(`Erro em "${caso.pergunta}":`, error instanceof Error ? error.message : error)
    process.exit(2)
  }

  const ids = selecao.results.map(r => r.id)
  const posicao = caso.esperado.length
    ? ids.findIndex(id => caso.esperado.some(e => corresponde(id, e)))
    : -1

  const problemas: string[] = []
  if (caso.esperado.length) {
    docAvaliados++
    if (posicao >= 0) docTop3++
    if (posicao === 0) docTop1++
    if (posicao < 0) problemas.push(`documento esperado fora do top 3 (esperado: ${caso.esperado.join(' ou ')})`)
  }
  if (caso.web !== undefined) {
    webAvaliados++
    if (caso.web === selecao.needsWebFallback) webCertos++
    else problemas.push(`decisão web errada (esperado: ${caso.web ? 'pesquisar' : 'não pesquisar'})`)
  }

  const rotulo = caso.historico?.length ? `${caso.historico.join(' → ')} → ${caso.pergunta}` : caso.pergunta
  const pos = caso.esperado.length ? (posicao >= 0 ? `${posicao + 1}º` : '--') : '  '
  const web = selecao.needsWebFallback ? 'web' : '   '
  console.log(`${problemas.length ? 'FALHA' : 'ok   '} ${pos} ${web}  ${rotulo}`)

  if (problemas.length || verbose) {
    for (const p of problemas) console.log(`        ${p}`)
    ids.forEach((id, i) => console.log(`        ${i + 1}. ${id}`))
    if (problemas.length) falhas.push(rotulo)
  }
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '-')
console.log('')
console.log(`Documento certo entre os 3 trechos: ${docTop3}/${docAvaliados} (${pct(docTop3, docAvaliados)})`)
console.log(`Documento certo em 1º lugar:        ${docTop1}/${docAvaliados} (${pct(docTop1, docAvaliados)})`)
console.log(`Decisão de pesquisa web correta:    ${webCertos}/${webAvaliados} (${pct(webCertos, webAvaliados)})`)
console.log(`Embeddings novos gerados: ${novos} (o resto veio do cache)`)
console.log('Avaliação sobre o índice local (rag-index.json); em produção o banco usa o mesmo ranking, mas a busca vetorial é aproximada.')

process.exit(falhas.length ? 1 : 0)
