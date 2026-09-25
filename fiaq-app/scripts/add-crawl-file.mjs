// Embeda e mescla UM arquivo novo/editado de data/crawl no fallback local
// server/assets/rag-index.json, sem re-embedar os chunks já existentes.
// Uso: node scripts/add-crawl-file.mjs <slug-sem-.md> [<slug2> ...]
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { trustLevelForChunk } from '../server/utils/trustLevel.mjs'

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const m = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
      if (!m) continue
      const value = m[2].replace(/^['"]|['"]$/g, '')
      process.env[m[1]] ??= value
    }
  } catch {
    // .env ausente: usa variaveis ja exportadas no shell.
  }
}
loadEnv()

const ROOT = process.cwd()
const INDEX_PATH = join(ROOT, 'server', 'assets', 'rag-index.json')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2:free'
const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || 'ollama').toLowerCase()
const APP_URL = process.env.APP_URL || 'http://localhost:3000'

function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks = []
  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(' ')
    if (chunk.trim()) chunks.push(chunk)
  }
  return chunks
}

function openRouterHeaders() {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY nao definido no .env')
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': APP_URL,
    'X-Title': 'fIAq'
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function embedOnce(text) {
  if (EMBED_PROVIDER === 'openrouter') {
    const res = await fetch(`${OPENROUTER_URL}/embeddings`, {
      method: 'POST',
      headers: openRouterHeaders(),
      body: JSON.stringify({ model: OPENROUTER_EMBED_MODEL, input: text })
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`OpenRouter embed error: ${res.status} ${body}`)
    const data = JSON.parse(body)
    const vector = data.data?.[0]?.embedding
    if (!Array.isArray(vector)) throw new Error('OpenRouter embed: resposta sem embedding')
    return vector
  }

  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text })
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${body}`)
  const data = JSON.parse(body)
  if (!Array.isArray(data.embedding)) throw new Error('Ollama embed: resposta sem embedding')
  return data.embedding
}

async function embed(text) {
  const attempts = EMBED_PROVIDER === 'openrouter' ? 4 : 1
  let lastErr
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

function parseCrawlFile(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return { title: '', url: '', body: raw }
  const meta = m[1] ?? ''
  const body = (m[2] ?? '').trim()
  const get = (key) => {
    const line = meta.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return line?.[1]?.trim() ?? ''
  }
  return { title: get('title'), url: get('url'), body }
}

async function buildChunksForSlug(slug) {
  const raw = await readFile(join(ROOT, 'data', 'crawl', `${slug}.md`), 'utf8')
  const { title, url, body } = parseCrawlFile(raw)
  const cleanBody = body.replace(/\s+/g, ' ').trim()
  const label = title || slug
  return splitIntoChunks(cleanBody).map((conteudo, index, arr) => ({
    id: `crawl-${slug}-${index + 1}`,
    titulo: arr.length > 1 ? `${label} (parte ${index + 1})` : label,
    conteudo,
    url,
    kind: 'crawl',
    nivelConfianca: trustLevelForChunk('crawl', url)
  }))
}

async function main() {
  const slugs = process.argv.slice(2)
  if (!slugs.length) {
    console.error('Uso: node scripts/add-crawl-file.mjs <slug-sem-.md> [<slug2> ...]')
    process.exit(1)
  }

  const payload = JSON.parse(await readFile(INDEX_PATH, 'utf8'))
  const byId = new Map(payload.chunks.map(chunk => [chunk.id, chunk]))

  for (const slug of slugs) {
    const rawChunks = await buildChunksForSlug(slug)
    console.log(`[RAG] ${slug}: ${rawChunks.length} chunk(s)`)

    for (const chunk of rawChunks) {
      const vector = await embed(`${chunk.titulo}\n${chunk.conteudo}`)
      byId.set(chunk.id, { ...chunk, vector })
      console.log(`[RAG]   embedado: ${chunk.id} (${chunk.nivelConfianca})`)
    }
  }

  payload.chunks = [...byId.values()]
  payload.meta.count = payload.chunks.length
  payload.meta.builtAt = new Date().toISOString()

  await writeFile(INDEX_PATH, `${JSON.stringify(payload)}\n`, 'utf8')
  console.log(`[RAG] Índice atualizado: ${payload.meta.count} chunks totais.`)
}

main().catch((error) => {
  console.error('[RAG] Falha ao adicionar chunks:', error)
  process.exit(1)
})
