// Gera o fallback legado server/assets/rag-index.json sem precisar subir o app.
// O caminho principal do RAG usa Postgres/pgvector via pnpm seed:knowledge.
// Uso: pnpm index:rag
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractText } from 'unpdf'
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
const DATA_DIR = join(ROOT, 'data')
const INDEX_PATH = join(ROOT, 'server', 'assets', 'rag-index.json')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2:free'
const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || 'ollama').toLowerCase()
const APP_URL = process.env.APP_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

const embedInfo = {
  provider: EMBED_PROVIDER,
  model: EMBED_PROVIDER === 'openrouter' ? OPENROUTER_EMBED_MODEL : OLLAMA_EMBED_MODEL
}

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
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY nao definido no .env')
  }

  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'HTTP-Referer': APP_URL,
    'X-Title': 'fIAq'
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

async function embedChunk(chunk) {
  const vector = await embed(`${chunk.titulo}\n${chunk.conteudo}`)
  return { ...chunk, vector }
}

async function indexFaq() {
  const faqDir = join(DATA_DIR, 'faq')
  const files = (await readdir(faqDir)).filter(file => file.endsWith('.json'))
  const chunks = []

  for (const file of files) {
    const entries = JSON.parse(await readFile(join(faqDir, file), 'utf8'))
    for (const entry of entries) chunks.push({ ...entry, kind: 'faq' })
    console.log(`[RAG] FAQ: ${file} (${entries.length} entradas)`)
  }

  return chunks
}

async function extractPdfChunks(pdfPath, sourceLabel, sourceUrl) {
  const buffer = await readFile(pdfPath)
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })
  const rawText = (Array.isArray(text) ? text.join(' ') : text)
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()

  return splitIntoChunks(rawText).map((conteudo, index) => ({
    id: `pdf-${sourceLabel.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
    titulo: `${sourceLabel} (parte ${index + 1})`,
    conteudo,
    url: sourceUrl,
    kind: 'pdf'
  }))
}

async function indexPdfs() {
  const pdfDir = join(DATA_DIR, 'pdfs')
  const files = (await readdir(pdfDir)).filter(file => file.endsWith('.pdf'))
  const chunks = []

  for (const file of files) {
    const label = file
      .replace('.pdf', '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())

    const pdfChunks = await extractPdfChunks(join(pdfDir, file), label, '')
    chunks.push(...pdfChunks)
    console.log(`[RAG] PDF: ${file} (${pdfChunks.length} chunks)`)
  }

  return chunks
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

async function indexCrawl() {
  const crawlDir = join(DATA_DIR, 'crawl')
  const files = (await readdir(crawlDir)).filter(file => file.endsWith('.md'))
  const chunks = []

  for (const file of files) {
    const slug = file.replace(/\.md$/, '')
    const raw = await readFile(join(crawlDir, file), 'utf8')
    const { title, url, body } = parseCrawlFile(raw)
    const cleanBody = body.replace(/\s+/g, ' ').trim()
    const label = title || slug
    const pageChunks = splitIntoChunks(cleanBody).map((conteudo, index, arr) => ({
      id: `crawl-${slug}-${index + 1}`,
      titulo: arr.length > 1 ? `${label} (parte ${index + 1})` : label,
      conteudo,
      url,
      kind: 'crawl'
    }))

    chunks.push(...pageChunks)
  }

  console.log(`[RAG] Crawl: ${files.length} paginas (${chunks.length} chunks)`)
  return chunks
}

async function main() {
  console.log(`[RAG] Gerando indice com ${embedInfo.provider}/${embedInfo.model}`)

  const rawChunks = [
    ...(await indexFaq()),
    ...(await indexPdfs()),
    ...(await indexCrawl())
  ].map(chunk => ({ ...chunk, nivelConfianca: trustLevelForChunk(chunk.kind, chunk.url) }))

  const chunks = []
  for (let i = 0; i < rawChunks.length; i++) {
    chunks.push(await embedChunk(rawChunks[i]))
    if ((i + 1) % 10 === 0 || i + 1 === rawChunks.length) {
      console.log(`[RAG] Embeddings: ${i + 1}/${rawChunks.length}`)
    }
  }

  const payload = {
    meta: {
      provider: embedInfo.provider,
      model: embedInfo.model,
      dim: chunks[0]?.vector.length ?? 0,
      count: chunks.length,
      builtAt: new Date().toISOString()
    },
    chunks
  }

  await writeFile(INDEX_PATH, `${JSON.stringify(payload)}\n`, 'utf8')
  console.log(`[RAG] Indice gravado em ${INDEX_PATH} (${payload.meta.count} chunks, dim ${payload.meta.dim}).`)
}

main().catch((error) => {
  console.error('[RAG] Falha ao gerar indice:', error)
  process.exit(1)
})
