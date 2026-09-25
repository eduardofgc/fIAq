import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { extractText } from 'unpdf'
import { trustLevelForChunk } from '../server/utils/trustLevel.mjs'

const VECTOR_DIM = 2048
const FAQ_ORDER = [
  'matricula',
  'estrutura-curricular',
  'atividades-de-curso',
  'trajetoria-academica',
  'organizacoes-estudantis',
  'coordenacao',
  'leia-me'
]

const TITULOS = {
  'matricula': 'Matrícula',
  'estrutura-curricular': 'Estrutura Curricular',
  'atividades-de-curso': 'Atividades de Curso',
  'trajetoria-academica': 'Trajetória Acadêmica',
  'organizacoes-estudantis': 'Organizações Estudantis',
  'coordenacao': 'Coordenação',
  'leia-me': 'Informações Gerais'
}

function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    try {
      const raw = readFileSync(join(process.cwd(), file), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
        if (!match) continue

        process.env[match[1]] ??= match[2].replace(/^['"]|['"]$/g, '')
      }
    } catch {
      // Arquivo ausente: usa variaveis ja exportadas no shell/Vercel.
    }
  }
}

loadEnv()

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_EMBED_MODEL = process.env.OPENROUTER_EMBED_MODEL || 'nvidia/llama-nemotron-embed-vl-1b-v2:free'
const EMBED_PROVIDER = (process.env.EMBED_PROVIDER || 'openrouter').toLowerCase()
const APP_URL = process.env.APP_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

const embedInfo = {
  provider: EMBED_PROVIDER,
  model: EMBED_PROVIDER === 'openrouter' ? OPENROUTER_EMBED_MODEL : OLLAMA_EMBED_MODEL
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function checksum(value) {
  return createHash('sha256').update(value).digest('hex')
}

function splitIntoChunks(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks = []

  let i = 0
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ')
    if (chunk.trim()) chunks.push(chunk)
    i += chunkSize - overlap
  }

  return chunks
}

function prettyTitle(slug) {
  return TITULOS[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function normalizeCategorySlug(file) {
  return file.replace(/^faq-/, '').replace(/\.json$/, '')
}

function parseCrawlFile(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { title: '', url: '', body: raw }

  const meta = match[1] ?? ''
  const body = (match[2] ?? '').trim()
  const get = (key) => {
    const line = meta.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'))
    return line?.[1]?.trim() ?? ''
  }

  return { title: get('title'), url: get('url'), body }
}

function openRouterHeaders() {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY não definido para gerar embeddings via OpenRouter.')
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
  let lastError

  for (let i = 0; i < attempts; i++) {
    try {
      return await embedOnce(text)
    } catch (error) {
      lastError = error
      if (i < attempts - 1) await sleep(800 * (i + 1))
    }
  }

  throw lastError
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

function toVectorLiteral(vector) {
  if (vector.length !== VECTOR_DIM) {
    throw new Error(
      `Embedding com ${vector.length} dimensões; o schema pgvector espera ${VECTOR_DIM}. `
      + 'Use o mesmo modelo de embedding configurado em produção ou ajuste db/04_rag_pgvector.sql.'
    )
  }

  if (!vector.every(Number.isFinite)) {
    throw new Error('Embedding contém valor não numérico.')
  }

  return `[${vector.join(',')}]`
}

async function loadFaqCategories() {
  const faqDir = join(process.cwd(), 'data', 'faq')
  const files = (await readdir(faqDir))
    .filter(file => file.startsWith('faq-') && file.endsWith('.json'))

  const categories = []

  for (const file of files) {
    const slug = normalizeCategorySlug(file)
    const entries = JSON.parse(await readFile(join(faqDir, file), 'utf-8'))
    categories.push({
      slug,
      titulo: prettyTitle(slug),
      descricao: `Perguntas sobre ${prettyTitle(slug).toLowerCase()}`,
      ordem: FAQ_ORDER.includes(slug) ? FAQ_ORDER.indexOf(slug) + 1 : 999,
      entries
    })
  }

  return categories.sort((a, b) => a.ordem - b.ordem)
}

async function buildKnowledgeSources() {
  const categories = await loadFaqCategories()
  const documents = []

  for (const category of categories) {
    for (const entry of category.entries) {
      const content = `${entry.titulo}\n${entry.conteudo}`
      documents.push({
        origem: 'faq',
        nivel_confianca: trustLevelForChunk('faq', entry.url ?? ''),
        slug: `faq-${entry.id}`,
        titulo: entry.titulo,
        url_fonte: entry.url ?? '',
        caminho_origem: `data/faq/faq-${category.slug}.json`,
        checksum: checksum(content),
        metadados: { categoria: category.slug, faqEntradaSlug: entry.id },
        chunks: [{
          chunk_uid: `faq-${entry.id}`,
          ordem: 1,
          titulo: entry.titulo,
          conteudo: entry.conteudo,
          url_fonte: entry.url ?? '',
          id_faq_entrada_slug: entry.id,
          metadados: { categoria: category.slug }
        }]
      })
    }
  }

  const pdfDir = join(process.cwd(), 'data', 'pdfs')
  for (const file of (await readdir(pdfDir)).filter(file => file.endsWith('.pdf'))) {
    const pdfPath = join(pdfDir, file)
    const buffer = await readFile(pdfPath)
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })
    const rawText = (Array.isArray(text) ? text.join(' ') : text)
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()

    const slug = `pdf-${slugify(file.replace(/\.pdf$/, ''))}`
    const label = file
      .replace(/\.pdf$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
    const chunks = splitIntoChunks(rawText).map((conteudo, index, arr) => ({
      chunk_uid: `${slug}-${index + 1}`,
      ordem: index + 1,
      titulo: arr.length > 1 ? `${label} (parte ${index + 1})` : label,
      conteudo,
      url_fonte: '',
      id_faq_entrada_slug: null,
      metadados: { arquivo: file }
    }))

    documents.push({
      origem: 'pdf',
      nivel_confianca: trustLevelForChunk('pdf', ''),
      slug,
      titulo: label,
      url_fonte: '',
      caminho_origem: `data/pdfs/${file}`,
      checksum: checksum(rawText),
      metadados: { arquivo: file },
      chunks
    })
  }

  const crawlDir = join(process.cwd(), 'data', 'crawl')
  for (const file of (await readdir(crawlDir)).filter(file => file.endsWith('.md'))) {
    const raw = await readFile(join(crawlDir, file), 'utf-8')
    const { title, url, body } = parseCrawlFile(raw)
    const cleanBody = body.replace(/\s+/g, ' ').trim()
    const slug = `crawl-${file.replace(/\.md$/, '')}`
    const label = title || slug
    const chunks = splitIntoChunks(cleanBody).map((conteudo, index, arr) => ({
      chunk_uid: `${slug}-${index + 1}`,
      ordem: index + 1,
      titulo: arr.length > 1 ? `${label} (parte ${index + 1})` : label,
      conteudo,
      url_fonte: url,
      id_faq_entrada_slug: null,
      metadados: { arquivo: file }
    }))

    documents.push({
      origem: 'crawl',
      nivel_confianca: trustLevelForChunk('crawl', url),
      slug,
      titulo: label,
      url_fonte: url,
      caminho_origem: `data/crawl/${file}`,
      checksum: checksum(cleanBody),
      metadados: { arquivo: file },
      chunks
    })
  }

  return { categories, documents }
}

async function embedDocuments(documents) {
  const chunks = documents.flatMap(document =>
    document.chunks.map(chunk => ({ document, chunk }))
  )

  console.log(`[RAG] Gerando ${chunks.length} embeddings com ${embedInfo.provider}/${embedInfo.model}`)

  for (let i = 0; i < chunks.length; i++) {
    const item = chunks[i]
    const vector = await embed(`${item.chunk.titulo}\n${item.chunk.conteudo}`)
    item.chunk.embedding = toVectorLiteral(vector)

    if ((i + 1) % 10 === 0 || i + 1 === chunks.length) {
      console.log(`[RAG] Embeddings: ${i + 1}/${chunks.length}`)
    }
  }
}

async function seedFaq(tx, categories) {
  const entryIdsBySlug = new Map()
  const activeCategorySlugs = []
  const activeEntrySlugs = []

  for (const category of categories) {
    activeCategorySlugs.push(category.slug)

    const rows = await tx`
      INSERT INTO faq_categoria (slug, titulo, descricao, ordem)
      VALUES (${category.slug}, ${category.titulo}, ${category.descricao}, ${category.ordem})
      ON CONFLICT (slug) DO UPDATE SET
        titulo = EXCLUDED.titulo,
        descricao = EXCLUDED.descricao,
        ordem = EXCLUDED.ordem
      RETURNING id
    `
    const categoryId = rows[0].id

    for (const entry of category.entries) {
      activeEntrySlugs.push(entry.id)
      const entryRows = await tx`
        INSERT INTO faq_entrada (id_categoria, slug, titulo, conteudo, url_fonte, dthr_atualizacao)
        VALUES (${categoryId}, ${entry.id}, ${entry.titulo}, ${entry.conteudo}, ${entry.url ?? null}, CURRENT_TIMESTAMP)
        ON CONFLICT (slug) DO UPDATE SET
          id_categoria = EXCLUDED.id_categoria,
          titulo = EXCLUDED.titulo,
          conteudo = EXCLUDED.conteudo,
          url_fonte = EXCLUDED.url_fonte,
          dthr_atualizacao = CURRENT_TIMESTAMP
        RETURNING id
      `
      entryIdsBySlug.set(entry.id, entryRows[0].id)
    }
  }

  if (activeEntrySlugs.length > 0) {
    await tx`
      DELETE FROM faq_entrada
      WHERE slug NOT IN ${tx(activeEntrySlugs)}
    `
  }

  if (activeCategorySlugs.length > 0) {
    await tx`
      DELETE FROM faq_categoria
      WHERE slug NOT IN ${tx(activeCategorySlugs)}
        AND NOT EXISTS (
          SELECT 1
          FROM faq_entrada e
          WHERE e.id_categoria = faq_categoria.id
        )
    `
  }

  return entryIdsBySlug
}

async function seedRag(tx, documents, entryIdsBySlug) {
  const activeDocumentSlugs = []
  const activeChunkUids = []

  for (const document of documents) {
    activeDocumentSlugs.push(document.slug)

    const documentRows = await tx`
      INSERT INTO rag_documento
        (origem, nivel_confianca, slug, titulo, url_fonte, caminho_origem, checksum, metadados, ativo, dthr_atualizacao)
      VALUES (
        ${document.origem},
        ${document.nivel_confianca},
        ${document.slug},
        ${document.titulo},
        ${document.url_fonte || null},
        ${document.caminho_origem},
        ${document.checksum},
        ${tx.json(document.metadados)},
        TRUE,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (slug) DO UPDATE SET
        origem = EXCLUDED.origem,
        nivel_confianca = EXCLUDED.nivel_confianca,
        titulo = EXCLUDED.titulo,
        url_fonte = EXCLUDED.url_fonte,
        caminho_origem = EXCLUDED.caminho_origem,
        checksum = EXCLUDED.checksum,
        metadados = EXCLUDED.metadados,
        ativo = TRUE,
        dthr_atualizacao = CURRENT_TIMESTAMP
      RETURNING id
    `
    const documentId = documentRows[0].id

    for (const chunk of document.chunks) {
      activeChunkUids.push(chunk.chunk_uid)
      await tx`
        INSERT INTO rag_chunk
          (
            id_documento,
            id_faq_entrada,
            origem,
            nivel_confianca,
            chunk_uid,
            ordem,
            titulo,
            conteudo,
            url_fonte,
            metadados,
            provedor_embedding,
            modelo_embedding,
            embedding,
            ativo,
            dthr_atualizacao
          )
        VALUES (
          ${documentId},
          ${chunk.id_faq_entrada_slug ? entryIdsBySlug.get(chunk.id_faq_entrada_slug) ?? null : null},
          ${document.origem},
          ${document.nivel_confianca},
          ${chunk.chunk_uid},
          ${chunk.ordem},
          ${chunk.titulo},
          ${chunk.conteudo},
          ${chunk.url_fonte || null},
          ${tx.json(chunk.metadados)},
          ${embedInfo.provider},
          ${embedInfo.model},
          ${chunk.embedding}::extensions.vector(2048),
          TRUE,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (chunk_uid) DO UPDATE SET
          id_documento = EXCLUDED.id_documento,
          id_faq_entrada = EXCLUDED.id_faq_entrada,
          origem = EXCLUDED.origem,
          nivel_confianca = EXCLUDED.nivel_confianca,
          ordem = EXCLUDED.ordem,
          titulo = EXCLUDED.titulo,
          conteudo = EXCLUDED.conteudo,
          url_fonte = EXCLUDED.url_fonte,
          metadados = EXCLUDED.metadados,
          provedor_embedding = EXCLUDED.provedor_embedding,
          modelo_embedding = EXCLUDED.modelo_embedding,
          embedding = EXCLUDED.embedding,
          ativo = TRUE,
          dthr_atualizacao = CURRENT_TIMESTAMP
      `
    }
  }

  if (activeChunkUids.length > 0) {
    await tx`
      UPDATE rag_chunk
      SET ativo = FALSE,
          dthr_atualizacao = CURRENT_TIMESTAMP
      WHERE chunk_uid NOT IN ${tx(activeChunkUids)}
        AND COALESCE(metadados->>'tipo', '') <> 'admin_web_validado'
    `
  }

  if (activeDocumentSlugs.length > 0) {
    await tx`
      UPDATE rag_documento
      SET ativo = FALSE,
          dthr_atualizacao = CURRENT_TIMESTAMP
      WHERE slug NOT IN ${tx(activeDocumentSlugs)}
        AND COALESCE(metadados->>'tipo', '') <> 'admin_web_validado'
    `
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL não configurada. Use uma connection string com permissão de escrita para o seed.')
  }

  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  })

  const { categories, documents } = await buildKnowledgeSources()
  await embedDocuments(documents)

  try {
    await sql.begin(async (tx) => {
      const entryIdsBySlug = await seedFaq(tx, categories)
      await seedRag(tx, documents, entryIdsBySlug)
    })

    const totalChunks = documents.reduce((sum, document) => sum + document.chunks.length, 0)
    console.log(
      `Seed de conhecimento concluído: ${categories.length} categorias, `
      + `${documents.length} documentos, ${totalChunks} chunks.`
    )
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('Falha no seed de conhecimento:', error)
  process.exit(1)
})
