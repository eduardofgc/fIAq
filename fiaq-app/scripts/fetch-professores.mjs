// Coleta a lista de professores da página oficial do CIC e grava
// data/professores.json + fotos em public/professores/.
// Uso (em fiaq-app/): pnpm fetch:professores
//
// Usa cic.unb.br (sem www): o certificado de www.cic.unb.br não cobre esse nome.
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { join, extname } from 'node:path'

const BASE = 'https://cic.unb.br'
const LIST_URL = `${BASE}/professores?limit=0`
const ROOT = process.cwd()
const DATA_PATH = join(ROOT, 'data', 'professores.json')
const PHOTO_DIR = join(ROOT, 'public', 'professores')

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&nbsp;/g, ' ')
}

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// O Joomla esconde o e-mail em pedaços: var addy_text<id> = 'a&#108;' + '&#64;' + ...
function decodeCloakedEmail(block) {
  // Sequência de trechos entre aspas unidos por "+" (as entidades &#97; têm ";").
  const match = block.match(/var addy_text\w+\s*=\s*((?:'[^']*'\s*\+?\s*)+);/)
  if (!match) return ''
  const pieces = [...match[1].matchAll(/'([^']*)'/g)].map(m => m[1])
  return decodeEntities(pieces.join('')).trim().toLowerCase()
}

function parseProfessors(html) {
  const items = html.split(/<li class="row-fluid cat-list-row\d"\s*>/).slice(1)

  return items.map((block) => {
    const end = block.indexOf('</li>')
    const item = end >= 0 ? block.slice(0, end) : block
    const nameMatch = item.match(/<div class="list-title[^"]*">\s*<a href="([^"]+)">\s*([^<]+?)\s*<\/a>/)
    if (!nameMatch) return null

    const photo = item.match(/<img src="([^"]+)"[^>]*class="contact-thumbnail/)?.[1] ?? ''
    const phone = item.match(/Telefone:\s*([^<]+)</)?.[1]?.trim() ?? ''

    return {
      nome: decodeEntities(nameMatch[2]).replace(/\s+/g, ' ').trim(),
      email: decodeCloakedEmail(item),
      telefone: decodeEntities(phone),
      perfil: new URL(nameMatch[1], BASE).href,
      fotoOrigem: photo ? new URL(photo, BASE).href : ''
    }
  }).filter(Boolean)
}

async function downloadPhoto(url, slug) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ext = (extname(new URL(url).pathname) || '.jpg').toLowerCase()
  const file = `${slug}${ext}`
  await writeFile(join(PHOTO_DIR, file), Buffer.from(await res.arrayBuffer()))
  return `/professores/${file}`
}

async function main() {
  const res = await fetch(LIST_URL)
  if (!res.ok) throw new Error(`Falha ao buscar ${LIST_URL}: HTTP ${res.status}`)
  const professors = parseProfessors(await res.text())
  if (!professors.length) throw new Error('Nenhum professor encontrado: o HTML da página mudou?')

  await mkdir(PHOTO_DIR, { recursive: true })
  for (const file of await readdir(PHOTO_DIR)) await rm(join(PHOTO_DIR, file))

  const result = []
  for (const professor of professors) {
    const slug = slugify(professor.nome)
    let foto = ''
    if (professor.fotoOrigem) {
      try {
        foto = await downloadPhoto(professor.fotoOrigem, slug)
      } catch (error) {
        console.warn(`Foto de ${professor.nome} não baixada: ${error.message}`)
      }
    }
    result.push({ nome: professor.nome, slug, email: professor.email, telefone: professor.telefone, foto, perfil: professor.perfil })
  }

  result.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  await writeFile(DATA_PATH, `${JSON.stringify({
    fonte: `${BASE}/professores`,
    coletadoEm: new Date().toISOString().slice(0, 10),
    professores: result
  }, null, 2)}\n`)

  const semEmail = result.filter(p => !p.email).length
  const semFoto = result.filter(p => !p.foto).length
  console.log(`${result.length} professores gravados em data/professores.json (sem e-mail: ${semEmail}, sem foto: ${semFoto}).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
