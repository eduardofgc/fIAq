// Adiciona/atualiza o campo nivelConfianca nos chunks do fallback local
// server/assets/rag-index.json a partir da classificação de host em
// server/utils/trustLevel.mjs — sem precisar gerar embeddings de novo.
// Uso: node scripts/tag-trust-level.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { trustLevelForChunk } from '../server/utils/trustLevel.mjs'

const INDEX_PATH = join(process.cwd(), 'server', 'assets', 'rag-index.json')

async function main() {
  const raw = await readFile(INDEX_PATH, 'utf8')
  const payload = JSON.parse(raw)

  const counts = { oficial: 0, institucional: 0 }
  for (const chunk of payload.chunks) {
    chunk.nivelConfianca = trustLevelForChunk(chunk.kind, chunk.url)
    counts[chunk.nivelConfianca]++
  }

  await writeFile(INDEX_PATH, `${JSON.stringify(payload)}\n`, 'utf8')
  console.log(`[RAG] nivelConfianca marcado em ${payload.chunks.length} chunks:`, counts)
}

main().catch((error) => {
  console.error('[RAG] Falha ao marcar nivelConfianca:', error)
  process.exit(1)
})
