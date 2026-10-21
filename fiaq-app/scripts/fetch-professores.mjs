// Coleta a lista de professores da página oficial do CIC e grava
// data/professores.json + fotos em public/professores/. Também guarda as
// comissões do departamento (incluindo a de Gestão, com chefia e coordenações),
// que o chat usa para "qual o e-mail do coordenador?" e "quem está na comissão X?".
// Uso (em fiaq-app/): pnpm fetch:professores
//
// Usa cic.unb.br (sem www): o certificado de www.cic.unb.br não cobre esse nome.
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { join, extname } from 'node:path'

const BASE = 'https://cic.unb.br'
const LIST_URL = `${BASE}/professores?limit=0`
const COMISSOES_URL = `${BASE}/administracao/comissoes`
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

function nameTokens(name) {
  return slugify(name).split('-').filter(token => token.length >= 2 && !['de', 'da', 'do', 'das', 'dos', 'e'].includes(token))
}

// A página de comissões abrevia ou acrescenta sobrenomes ("Marcelo Mandelli" é
// "Marcelo Grandi Mandelli"): basta primeiro e último nome baterem.
function findProfessor(name, professors) {
  const tokens = nameTokens(name)
  return professors.find((professor) => {
    const own = nameTokens(professor.nome)
    return own[0] === tokens[0] && tokens.includes(own[own.length - 1])
  })
}

// Cada comissão é um painel com <h2> e uma lista. Item vem como "Nome (papel)",
// "Cargo: Nome" ou dois cargos na mesma linha separados por "·".
function parseComissoes(html, professors) {
  const panels = [...html.matchAll(/<div class="accordion-body[^>]*id="([^"]+)">([\s\S]*?)<\/div><\/div><\/div>/g)]

  return panels.map(([, id, body]) => {
    const nome = decodeEntities(body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '').replace(/\s+/g, ' ').trim()
    const membros = [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      // Item com link é documento ("Relatório de Processos Avaliados"), não pessoa.
      .filter(match => !/<a\s/i.test(match[1]))
      .flatMap(match => decodeEntities(match[1].replace(/<[^>]+>/g, '')).split('·'))
      // A interface não usa travessão: "– 2º mandato" vira ", 2º mandato".
      .map(item => item.replace(/\s+/g, ' ').replace(/\s*[–—]\s*/g, ', ').trim())
      .filter(Boolean)
      .map((texto) => {
        const pessoa = (texto.match(/^[^:]+:\s*(.+)$/)?.[1] ?? texto).replace(/\s*[(,].*$/, '').trim()
        const professor = findProfessor(pessoa, professors)
        return { texto, email: professor?.email ?? '', telefone: professor?.telefone ?? '' }
      })
    return { id, nome, membros }
  }).filter(comissao => comissao.nome && comissao.membros.length)
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

  const comissoesRes = await fetch(COMISSOES_URL)
  if (!comissoesRes.ok) throw new Error(`Falha ao buscar ${COMISSOES_URL}: HTTP ${comissoesRes.status}`)
  const comissoes = parseComissoes(await comissoesRes.text(), result)
  if (!comissoes.some(comissao => comissao.id === 'comissao-de-gestao')) {
    console.warn('Comissão de Gestão não encontrada: o HTML da página de comissões mudou?')
  }

  await writeFile(DATA_PATH, `${JSON.stringify({
    fonte: `${BASE}/professores`,
    coletadoEm: new Date().toISOString().slice(0, 10),
    professores: result,
    comissoesFonte: COMISSOES_URL,
    comissoes
  }, null, 2)}\n`)

  const semEmail = result.filter(p => !p.email).length
  const semFoto = result.filter(p => !p.foto).length
  console.log(`${result.length} professores gravados em data/professores.json (sem e-mail: ${semEmail}, sem foto: ${semFoto}).`)
  const membros = comissoes.flatMap(comissao => comissao.membros)
  console.log(`${comissoes.length} comissões, ${membros.length} membros (${membros.filter(membro => !membro.email).length} sem contato na lista de professores).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
