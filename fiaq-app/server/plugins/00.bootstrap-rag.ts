import { readFile, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { read } from '$app/server'
import { embedChunk } from '../utils/embeddings'
import type { EmbeddedChunk } from '../utils/embeddings'
import { addChunk, loadChunks, getAllChunks, getStoreSize } from '../utils/vectorStore'
import { embedInfo } from '../utils/llmProvider'
import { extractPdfChunks } from '../utils/pdfLoader'
import { extractCrawlChunks } from '../utils/crawlLoader'
import { listarFaq } from '../repositorios/faq'
import { trustLevelForChunk } from '../utils/trustLevel.mjs'
import ragIndexAsset from '../assets/rag-index.json?url'

interface RagIndexFile {
  meta: { provider?: string, model?: string, dim?: number, count?: number, builtAt?: string }
  chunks: EmbeddedChunk[]
}

// Caminho do índice em disco — usado apenas para REGRAVAR o cache em dev/regeneração.
const INDEX_PATH = join(process.cwd(), 'server', 'assets', 'rag-index.json')

async function loadCachedIndex(): Promise<RagIndexFile | null> {
  try {
    const response = read(ragIndexAsset)
    return await response.json() as RagIndexFile
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[RAG] Fallback JSON empacotado não foi carregado:', error instanceof Error ? error.message : error)
    }
  }

  try {
    const data = await readFile(INDEX_PATH, 'utf-8')
    return JSON.parse(data) as RagIndexFile
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[RAG] Fallback JSON não foi carregado do disco:', error instanceof Error ? error.message : error)
    }
    return null
  }
}

export async function bootstrapRag(): Promise<void> {
  const force = process.env.RAG_FORCE_REINDEX === '1'
  const cached = force ? null : await loadCachedIndex()

  // Compatibilidade: hidrata o índice JSON usado apenas se o pgvector não estiver disponível.
  if (cached?.chunks?.length) {
    if (cached.meta?.model && cached.meta.model !== embedInfo.model) {
      loadChunks([])
      throw new Error(
        `RAG_INDEX_MODEL_MISMATCH: fallback gerado com "${cached.meta.model}", `
        + `runtime usa "${embedInfo.model}". Regenere o índice antes de usar o fallback.`
      )
    }

    loadChunks(cached.chunks)
    console.log(`[RAG] Fallback JSON carregado: ${getStoreSize()} chunks (modelo: ${cached.meta?.model ?? '?'}).`)
    return
  }

  // Caminho de regeneração: indexa ao vivo (chama o provider de embeddings) e
  // grava o índice em disco para ser commitado e empacotado no deploy.
  console.log('[RAG] Regenerando índice (indexação ao vivo)...')
  await indexFaq()
  await indexPdfs()
  await indexCrawl()
  console.log(`[RAG] Indexação concluída: ${getStoreSize()} chunks.`)
  await writeIndex()
}

async function writeIndex(): Promise<void> {
  const chunks = getAllChunks()
  const payload: RagIndexFile = {
    meta: {
      provider: embedInfo.provider,
      model: embedInfo.model,
      dim: chunks[0]?.vector.length ?? 0,
      count: chunks.length,
      builtAt: new Date().toISOString()
    },
    chunks
  }
  try {
    await writeFile(INDEX_PATH, JSON.stringify(payload) + '\n', 'utf-8')
    console.log(`[RAG] Índice gravado em ${INDEX_PATH} (${chunks.length} chunks, dim ${payload.meta.dim}).`)
  } catch (e) {
    console.warn('[RAG] Não foi possível gravar o índice (FS somente-leitura?):', e)
  }
}

async function indexFaq() {
  try {
    const { categories, source } = await listarFaq()
    console.log(`[RAG] Indexando FAQ a partir de ${source}: ${categories.length} categoria(s).`)

    for (const category of categories) {
      for (const entry of category.items) {
        try {
          const embedded = await embedChunk({
            ...entry,
            url: entry.url ?? '',
            kind: 'faq',
            nivelConfianca: trustLevelForChunk('faq', entry.url ?? '')
          })
          addChunk(embedded)
        } catch (e) {
          console.error(`[RAG] Failed to embed FAQ entry ${entry.id}:`, e)
        }
      }
      console.log(`[RAG] Indexed ${category.items.length} entries from ${category.slug}`)
    }
  } catch (e) {
    console.warn('[RAG] No FAQ source available, skipping FAQ indexing:', e)
  }
}

async function indexPdfs() {
  const pdfDir = join(process.cwd(), 'data', 'pdfs')

  let files: string[]
  try {
    files = await readdir(pdfDir)
  } catch {
    console.warn('[RAG] No data/pdfs directory found, skipping PDF indexing.')
    return
  }

  const pdfFiles = files.filter(f => f.endsWith('.pdf'))
  console.log(`[RAG] Found ${pdfFiles.length} PDF file(s).`)

  for (const file of pdfFiles) {
    const pdfPath = join(pdfDir, file)
    // e.g. "edital-pibic-2026.pdf" -> "Edital Pibic 2026"
    const label = file
      .replace('.pdf', '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())

    try {
      const chunks = await extractPdfChunks(pdfPath, label, '')
      for (const chunk of chunks) {
        const embedded = await embedChunk({ ...chunk, kind: 'pdf', nivelConfianca: trustLevelForChunk('pdf', '') })
        addChunk(embedded)
      }
      console.log(`[RAG] Indexed ${chunks.length} chunks from ${file}`)
    } catch (e) {
      console.error(`[RAG] Failed to index PDF ${file}:`, e)
    }
  }
}

async function indexCrawl() {
  const crawlDir = join(process.cwd(), 'data', 'crawl')

  let files: string[]
  try {
    files = await readdir(crawlDir)
  } catch {
    console.warn('[RAG] No data/crawl directory found, skipping crawl indexing.')
    return
  }

  const mdFiles = files.filter(f => f.endsWith('.md'))
  console.log(`[RAG] Found ${mdFiles.length} crawled page(s).`)

  let total = 0
  for (const file of mdFiles) {
    const slug = file.replace(/\.md$/, '')
    try {
      const chunks = await extractCrawlChunks(join(crawlDir, file), slug)
      for (const chunk of chunks) {
        const embedded = await embedChunk({ ...chunk, kind: 'crawl', nivelConfianca: trustLevelForChunk('crawl', chunk.url) })
        addChunk(embedded)
      }
      total += chunks.length
    } catch (e) {
      console.error(`[RAG] Failed to index crawl ${file}:`, e)
    }
  }
  console.log(`[RAG] Indexed ${total} chunks from ${mdFiles.length} crawled pages.`)
}
