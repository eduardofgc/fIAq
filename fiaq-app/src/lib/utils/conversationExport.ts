import type { Message, MessageDraft, Source } from '$lib/stores/fiaq-chat'
import { cleanAssistantText } from '$lib/utils/assistantText'
import { publicSourceUrl } from '$lib/utils/sourceUrl'

export type ConversationExportFormat = 'json' | 'txt' | 'md' | 'pdf' | 'xls'

interface PortableConversation {
  app: 'fiaq'
  kind: 'temporary-conversation'
  version: 1
  exportedAt: string
  title: string
  messages: Array<{
    role: Message['role']
    content: string
    sources?: Source[]
    feedback?: Message['feedback']
    webEnhanced?: boolean
  }>
}

interface SourceRecord {
  index: number
  source: Source
}

interface SourceRegistry {
  records: SourceRecord[]
  byMessageId: Map<number, number[]>
}

type SourceInput = Partial<Source>
type PdfBlock = { type: 'paragraph' | 'heading' | 'code', text: string }

const BRAND_NAVY = '#1a2e5a'
const BRAND_GREEN = '#16a34a'
const SURFACE_SLATE = '#f9fafb'

function exportableMessages(messages: Message[]): Message[] {
  return messages
    .filter(message => message.content?.trim())
    .map(message => ({
      id: message.id,
      role: message.role,
      content: (message.role === 'assistant' ? cleanAssistantText(message.content) : message.content).trim(),
      sources: message.sources?.filter(source => source.titulo || source.url),
      streaming: false,
      feedback: message.feedback,
      webEnhanced: message.webEnhanced
    }))
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (entity: string, code: string) => decodeCodePoint(entity, Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (entity: string, code: string) => decodeCodePoint(entity, Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function decodeCodePoint(entity: string, codePoint: number): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity
  }

  return String.fromCodePoint(codePoint)
}

function plainText(text: string): string {
  return decodeEntities(text)
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    // Só o marcador de citação no início da linha; ">" no meio é separador de
    // menu ("Ensino > Trancar").
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlCell(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>')
}

function pdfSafeText(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'')
    .replace(/[–—]/g, '-')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    // Caminho de menu ("Portal do Discente › Ensino"): a fonte do PDF não tem
    // esses glifos e o separador sumia.
    .replace(/[›»]/g, '>')
    .replace(/[‹«]/g, '<')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/⁂/g, '')
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
}

function sourceKey(source: Source): string {
  return source.url || `${source.id}:${source.titulo}`
}

function hasSourceIdentity(source: unknown): source is SourceInput {
  if (!source || typeof source !== 'object') return false
  const candidate = source as SourceInput
  return Boolean(String(candidate.titulo || '').trim() || String(candidate.url || '').trim())
}

function safeSourceUrl(value: unknown): string {
  return publicSourceUrl(String(value || '').trim())
}

function cleanSource(source: SourceInput): Source {
  const url = safeSourceUrl(source.url)

  return {
    id: String(source.id || url || source.titulo || 'fonte'),
    titulo: decodeEntities(String(source.titulo || 'Fonte oficial')).replace(/\s+/g, ' ').trim() || 'Fonte oficial',
    url,
    kind: source.kind === 'web' || source.kind === 'official' ? source.kind : 'rag',
    description: String(source.description || '').trim() || undefined
  }
}

function createSourceRegistry(messages: Message[]): SourceRegistry {
  const byKey = new Map<string, SourceRecord>()
  const byMessageId = new Map<number, number[]>()

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.sources?.length) continue

    const refs: number[] = []
    for (const rawSource of message.sources) {
      const source = cleanSource(rawSource)
      const key = sourceKey(source)
      let record = byKey.get(key)

      if (!record) {
        record = { index: byKey.size + 1, source }
        byKey.set(key, record)
      }

      refs.push(record.index)
    }

    if (refs.length) byMessageId.set(message.id, [...new Set(refs)])
  }

  return {
    records: [...byKey.values()].sort((a, b) => a.index - b.index),
    byMessageId
  }
}

function conversationTitle(messages: Message[]): string {
  const firstQuestion = messages.find(message => message.role === 'user')?.content
  if (!firstQuestion) return 'Conversa fIAq'

  const normalized = plainText(firstQuestion).replace(/\s+/g, ' ')
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
}

function safeFilename(title: string, extension: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug = normalized.slice(0, 52).replace(/^-+|-+$/g, '') || 'conversa-fiaq'

  return `${slug}-${fileStamp()}.${extension}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function toPortableConversation(messages: Message[]): PortableConversation {
  const cleanMessages = exportableMessages(messages)

  return {
    app: 'fiaq',
    kind: 'temporary-conversation',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: conversationTitle(cleanMessages),
    messages: cleanMessages.map(message => ({
      role: message.role,
      content: message.content,
      sources: message.sources?.map(cleanSource),
      feedback: message.feedback,
      webEnhanced: message.webEnhanced
    }))
  }
}

function buildTxt(messages: Message[]): string {
  const registry = createSourceRegistry(messages)
  const lines = [
    'fIAq - Conversa exportada',
    `Exportado em ${new Date().toLocaleString('pt-BR')}`,
    ''
  ]

  let question = 0
  let answer = 0

  for (const message of messages) {
    if (message.role === 'user') {
      question++
      lines.push(`Pergunta ${question}`, plainText(message.content), '')
      continue
    }

    answer++
    const refs = registry.byMessageId.get(message.id) ?? []
    const suffix = refs.length ? `\n\nFontes: ${refs.map(ref => `[${ref}]`).join(' ')}` : ''
    lines.push(`${message.webEnhanced ? 'Resposta com pesquisa web' : 'Resposta'} ${answer}`, `${plainText(message.content)}${suffix}`, '')
  }

  if (registry.records.length) {
    lines.push('Fontes oficiais')
    for (const record of registry.records) {
      lines.push(`[${record.index}] ${record.source.titulo}${record.source.url ? ` - ${record.source.url}` : ''}`)
    }
  }

  return `${lines.join('\n')}\n`
}

function buildMarkdown(messages: Message[]): string {
  const registry = createSourceRegistry(messages)
  const lines = [
    '# fIAq - Conversa exportada',
    '',
    `Exportado em ${new Date().toLocaleString('pt-BR')}`,
    ''
  ]

  let question = 0
  let answer = 0

  for (const message of messages) {
    if (message.role === 'user') {
      question++
      lines.push(`## Pergunta ${question}`, '', message.content.trim(), '')
      continue
    }

    answer++
    const refs = registry.byMessageId.get(message.id) ?? []
    const suffix = refs.length ? `\n\nFontes: ${refs.map(ref => `[${ref}][fonte-${ref}]`).join(' ')}` : ''
    lines.push(`## ${message.webEnhanced ? 'Resposta com pesquisa web' : 'Resposta'} ${answer}`, '', `${message.content.trim()}${suffix}`, '')
  }

  if (registry.records.length) {
    lines.push('## Fontes oficiais', '')
    for (const record of registry.records) {
      const source = record.source
      lines.push(`[${record.index}] ${source.url ? `[${source.titulo}](${source.url})` : source.titulo}`)
    }
    lines.push('')
    for (const record of registry.records) {
      if (record.source.url) lines.push(`[fonte-${record.index}]: ${record.source.url} "${record.source.titulo.replace(/"/g, '\'')}"`)
    }
  }

  return `${lines.join('\n')}\n`
}

function buildExcelHtml(messages: Message[]): string {
  const registry = createSourceRegistry(messages)
  const sourcesByIndex = new Map(registry.records.map(record => [record.index, record.source]))
  const rows = [
    '<tr><th>Ordem</th><th>Tipo</th><th>Conteúdo</th><th>Fontes</th></tr>'
  ]

  messages.forEach((message, index) => {
    const refs = registry.byMessageId.get(message.id) ?? []
    const sources = refs
      .map((ref) => {
        const source = sourcesByIndex.get(ref)
        if (!source) return ''
        return `[${ref}] ${source.titulo}${source.url ? ` - ${source.url}` : ''}`
      })
      .filter(Boolean)
      .join('\n')

    rows.push(
      '<tr>'
      + `<td>${index + 1}</td>`
      + `<td>${message.role === 'user' ? 'Pergunta' : message.webEnhanced ? 'Resposta web' : 'Resposta'}</td>`
      + `<td>${htmlCell(plainText(message.content))}</td>`
      + `<td>${htmlCell(sources)}</td>`
      + '</tr>'
    )
  })

  if (registry.records.length) {
    rows.push('<tr><td></td><td>Fontes oficiais</td><td></td><td></td></tr>')
    for (const record of registry.records) {
      rows.push(
        '<tr>'
        + `<td>${record.index}</td>`
        + '<td>Fonte</td>'
        + `<td>${htmlCell(record.source.titulo)}</td>`
        + `<td>${htmlCell(record.source.url)}</td>`
        + '</tr>'
      )
    }
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    th { background: #1a2e5a; color: #ffffff; text-align: left; }
    th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; mso-number-format: "\\@"; }
    td:nth-child(1) { width: 48px; }
    td:nth-child(2) { width: 96px; font-weight: 700; }
    td:nth-child(3) { width: 560px; }
    td:nth-child(4) { width: 360px; color: #334155; }
  </style>
</head>
<body>
  <table>
    ${rows.join('\n    ')}
  </table>
</body>
</html>`
}

function ensurePdfSpace(
  doc: InstanceType<typeof import('jspdf').jsPDF>,
  y: number,
  needed = 28
): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed <= pageHeight - 64) return y

  doc.addPage()
  return 72
}

function sourceHost(source: Source): string {
  try {
    return new URL(source.url).hostname.replace(/^www\./, '')
  } catch {
    return 'fonte oficial'
  }
}

function drawPdfLogo(doc: InstanceType<typeof import('jspdf').jsPDF>, x: number, y: number) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(BRAND_NAVY)
  doc.text('fIAq', x, y)

  doc.setTextColor(BRAND_GREEN)
  doc.text('IA', x + doc.getTextWidth('f') - 0.5, y)
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    // ">" fica: no meio do texto é separador de menu ("Ensino > Trancar"). O
    // marcador de citação no início da linha sai em markdownBlocks.
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function markdownBlocks(text: string): PdfBlock[] {
  const blocks: PdfBlock[] = []
  const paragraph: string[] = []
  const code: string[] = []
  let inCode = false

  function flushParagraph() {
    const value = stripInlineMarkdown(paragraph.join(' '))
    paragraph.splice(0)
    if (value) blocks.push({ type: 'paragraph', text: value })
  }

  function flushCode() {
    const value = code.join('\n').trimEnd()
    code.splice(0)
    if (value) blocks.push({ type: 'code', text: pdfSafeText(value) })
  }

  for (const rawLine of decodeEntities(text).replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (trimmed.startsWith('```')) {
      if (inCode) flushCode()
      else flushParagraph()
      inCode = !inCode
      continue
    }

    if (inCode) {
      code.push(line)
      continue
    }

    const content = trimmed.replace(/^>+\s*/, '')

    if (!content) {
      flushParagraph()
      continue
    }

    const heading = content.match(/^#{1,4}\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'heading', text: stripInlineMarkdown(heading[1] ?? '') })
      continue
    }

    if (/^[-*]\s+/.test(content)) {
      flushParagraph()
      blocks.push({ type: 'paragraph', text: `- ${stripInlineMarkdown(content.replace(/^[-*]\s+/, ''))}` })
      continue
    }

    if (/^\d+\.\s+/.test(content)) {
      flushParagraph()
      blocks.push({ type: 'paragraph', text: stripInlineMarkdown(content) })
      continue
    }

    paragraph.push(content)
  }

  if (inCode) flushCode()
  flushParagraph()

  return blocks
}

function drawWrappedPdfText(
  doc: InstanceType<typeof import('jspdf').jsPDF>,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const lines = doc.splitTextToSize(pdfSafeText(text), maxWidth) as string[]
  let cursorY = y

  for (const line of lines) {
    cursorY = ensurePdfSpace(doc, cursorY, lineHeight)
    doc.text(line, x, cursorY)
    cursorY += lineHeight
  }

  return cursorY
}

function drawPdfBlocks(
  doc: InstanceType<typeof import('jspdf').jsPDF>,
  blocks: PdfBlock[],
  x: number,
  y: number,
  maxWidth: number
): number {
  let cursorY = y

  for (const block of blocks) {
    if (block.type === 'heading') {
      cursorY = ensurePdfSpace(doc, cursorY, 28)
      doc.setFont('times', 'bold')
      doc.setFontSize(15)
      doc.setTextColor('#111111')
      cursorY = drawWrappedPdfText(doc, block.text, x, cursorY, maxWidth, 18) + 6
      continue
    }

    if (block.type === 'code') {
      doc.setFont('courier', 'normal')
      doc.setFontSize(10.5)
      const lines = block.text
        .split('\n')
        .flatMap(line => doc.splitTextToSize(line || ' ', maxWidth - 28) as string[])
      const boxHeight = Math.max(48, lines.length * 15 + 24)
      cursorY = ensurePdfSpace(doc, cursorY, boxHeight + 18)
      doc.setFillColor(SURFACE_SLATE)
      doc.roundedRect(x, cursorY - 14, maxWidth, boxHeight, 5, 5, 'F')
      doc.setTextColor('#111111')
      let codeY = cursorY + 10
      for (const line of lines) {
        doc.text(line, x + 14, codeY)
        codeY += 15
      }
      cursorY += boxHeight + 18
      continue
    }

    doc.setFont('times', 'normal')
    doc.setFontSize(12.5)
    doc.setTextColor('#111111')
    cursorY = drawWrappedPdfText(doc, block.text, x, cursorY, maxWidth, 18) + 11
  }

  return cursorY
}

function drawPdfSourceRefs(
  doc: InstanceType<typeof import('jspdf').jsPDF>,
  refs: number[],
  sourcesByIndex: Map<number, Source>,
  x: number,
  y: number,
  maxWidth: number
): number {
  if (!refs.length) return y

  let cursorY = ensurePdfSpace(doc, y, 26)
  let cursorX = x

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor('#475569')

  const label = 'Fontes:'
  doc.text(label, cursorX, cursorY)
  cursorX += doc.getTextWidth(`${label} `) + 2

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(37, 99, 235)

  for (const ref of refs) {
    const source = sourcesByIndex.get(ref)
    const marker = `[${ref}]`
    const markerWidth = doc.getTextWidth(marker)

    if (cursorX + markerWidth > x + maxWidth) {
      cursorY = ensurePdfSpace(doc, cursorY + 14, 18)
      cursorX = x
    }

    doc.text(marker, cursorX, cursorY)
    if (source?.url) {
      doc.link(cursorX, cursorY - 9, markerWidth, 12, { url: source.url })
    }

    cursorX += markerWidth + 8
  }

  return cursorY + 24
}

function drawPdfReferences(
  doc: InstanceType<typeof import('jspdf').jsPDF>,
  records: SourceRecord[],
  x: number,
  y: number,
  maxWidth: number
): number {
  if (!records.length) return y

  const pageWidth = doc.internal.pageSize.getWidth()
  let cursorY = ensurePdfSpace(doc, y + 8, 90)

  doc.setFont('times', 'bold')
  doc.setFontSize(16)
  doc.setTextColor('#111111')
  doc.text('***', pageWidth / 2, cursorY, { align: 'center' })
  cursorY += 34

  doc.setFont('times', 'bold')
  doc.setFontSize(15)
  doc.text('Fontes', x, cursorY)
  cursorY += 24

  for (const record of records) {
    const source = record.source
    const title = pdfSafeText(source.titulo)
    const url = pdfSafeText(source.url)
    const host = source.url ? sourceHost(source) : 'fonte oficial'
    cursorY = ensurePdfSpace(doc, cursorY, 54)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor('#111111')
    const label = `[${record.index}] ${title}`
    const labelY = cursorY
    cursorY = drawWrappedPdfText(doc, label, x, cursorY, maxWidth, 12)
    if (source.url) {
      doc.link(x, labelY - 10, Math.min(doc.getTextWidth(`[${record.index}]`), maxWidth), 14, { url: source.url })
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(37, 99, 235)
    const linkText = url || host
    const linkY = cursorY
    cursorY = drawWrappedPdfText(doc, linkText, x + 16, cursorY, maxWidth - 16, 12) + 8
    if (source.url) {
      doc.link(x + 16, linkY - 10, Math.min(doc.getTextWidth(linkText), maxWidth - 16), 14, { url: source.url })
    }
  }

  return cursorY
}

async function exportPdf(messages: Message[], filename: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true })
  const registry = createSourceRegistry(messages)
  const sourcesByIndex = new Map(registry.records.map(record => [record.index, record.source]))
  const width = doc.internal.pageSize.getWidth()
  const marginX = 72
  const contentWidth = width - marginX * 2
  const title = conversationTitle(messages)
  let y = 94

  doc.setProperties({
    title,
    subject: 'Conversa exportada pelo fIAq',
    author: 'fIAq'
  })

  drawPdfLogo(doc, marginX, y)
  y += 58

  doc.setFont('times', 'bold')
  doc.setFontSize(24)
  doc.setTextColor('#111111')
  y = drawWrappedPdfText(doc, title, marginX, y, contentWidth, 27) + 18

  for (const message of messages) {
    y = ensurePdfSpace(doc, y + 4, 64)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(BRAND_NAVY)
    doc.text(message.role === 'user' ? 'Pergunta' : message.webEnhanced ? 'Resposta com pesquisa web' : 'Resposta', marginX, y)
    y += 18

    if (message.role === 'user') {
      y = drawPdfBlocks(doc, markdownBlocks(message.content), marginX, y, contentWidth) + 10
      continue
    }

    y = drawPdfBlocks(doc, markdownBlocks(message.content), marginX, y, contentWidth)
    y = drawPdfSourceRefs(doc, registry.byMessageId.get(message.id) ?? [], sourcesByIndex, marginX, y, contentWidth)
  }

  drawPdfReferences(doc, registry.records, marginX, y, contentWidth)

  doc.setProperties({
    title,
    subject: 'Resposta exportada pelo fIAq',
    author: 'fIAq'
  })

  downloadBlob(doc.output('blob'), filename)
}

export async function exportConversation(messages: Message[], format: ConversationExportFormat) {
  const cleanMessages = exportableMessages(messages)
  if (!cleanMessages.length) throw new Error('EMPTY_CONVERSATION')

  const title = conversationTitle(cleanMessages)

  if (format === 'json') {
    const content = JSON.stringify(toPortableConversation(cleanMessages), null, 2)
    downloadBlob(new Blob([`${content}\n`], { type: 'application/json;charset=utf-8' }), safeFilename(title, 'json'))
    return
  }

  if (format === 'txt') {
    downloadBlob(new Blob([buildTxt(cleanMessages)], { type: 'text/plain;charset=utf-8' }), safeFilename(title, 'txt'))
    return
  }

  if (format === 'md') {
    downloadBlob(new Blob([buildMarkdown(cleanMessages)], { type: 'text/markdown;charset=utf-8' }), safeFilename(title, 'md'))
    return
  }

  if (format === 'xls') {
    downloadBlob(
      new Blob([buildExcelHtml(cleanMessages)], { type: 'application/vnd.ms-excel;charset=utf-8' }),
      safeFilename(title, 'xls')
    )
    return
  }

  await exportPdf(cleanMessages, safeFilename(title, 'pdf'))
}

export async function readConversationFile(file: File): Promise<MessageDraft[]> {
  const text = await file.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('INVALID_CONVERSATION')
  }
  const rawMessages = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && 'messages' in payload
      ? (payload as { messages?: unknown }).messages
      : undefined
  if (!Array.isArray(rawMessages)) throw new Error('INVALID_CONVERSATION')

  const messages = rawMessages
    .map((message): MessageDraft | null => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : null
      const content = typeof message?.content === 'string' ? message.content.trim() : ''
      if (!role || !content) return null

      const sources = Array.isArray(message.sources)
        ? (message.sources as unknown[])
            .filter(hasSourceIdentity)
            .map(cleanSource)
        : undefined

      return {
        role,
        content,
        streaming: false,
        sources: sources?.length ? sources : undefined,
        feedback: message.feedback === 'helpful' || message.feedback === 'unhelpful' ? message.feedback : undefined,
        webEnhanced: Boolean(message.webEnhanced)
      }
    })
    .filter((message): message is MessageDraft => Boolean(message))

  if (!messages.length) throw new Error('EMPTY_CONVERSATION')
  return messages
}
