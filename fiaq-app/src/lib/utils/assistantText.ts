const REFERENCE_SECTION_HEADINGS = new Set([
  'links',
  'links uteis',
  'fontes',
  'fontes uteis',
  'referencias'
])

function normalizeHeading(line: string): string {
  return line
    .replace(/[*_`>#]/g, '')
    .replace(/:$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function isReferenceOnlyLine(line: string): boolean {
  const normalized = line
    .replace(/[*_`]/g, '')
    .replace(/^[-*]\s+/, '')
    .trim()

  return /^(?:\[[0-9]+\]\s*)+$/.test(normalized)
}

function stripNumericCitations(text: string): string {
  return text
    // Remove grupos de citações do tipo [1], [1][3] ou [1, 2].
    .replace(/(?:\s*\[(?:\d+(?:\s*,\s*\d+)*)\])+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}

export function stripInlineLinks(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, '')
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}

export function stripReferenceOnlySections(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index++) {
    const heading = normalizeHeading(lines[index] || '')
    if (!REFERENCE_SECTION_HEADINGS.has(heading)) continue

    let cursor = index + 1
    let hasReferenceLine = false

    while (cursor < lines.length) {
      const line = lines[cursor] || ''
      if (isReferenceOnlyLine(line)) {
        hasReferenceLine = true
        cursor++
        continue
      }

      if (!line.trim()) {
        cursor++
        continue
      }

      break
    }

    if (hasReferenceLine) {
      return [...lines.slice(0, index), ...lines.slice(cursor)].join('\n').trimEnd()
    }
  }

  let end = lines.length
  while (end > 0 && !lines[end - 1]?.trim()) end--

  let referenceStart = end
  while (referenceStart > 0 && isReferenceOnlyLine(lines[referenceStart - 1] || '')) {
    referenceStart--
  }

  return referenceStart < end
    ? lines.slice(0, referenceStart).join('\n').trimEnd()
    : text
}

// A interface não usa travessão, e o prompt sozinho não garante: o modelo
// troca "—" por "–" e segue usando. Par de travessões (aparte) vira vírgulas;
// separador isolado com espaços vira dois-pontos.
function stripDashes(text: string): string {
  return text
    .replace(/[ \t]+[—–][ \t]+([^—–\n]{1,80}?)[ \t]+[—–][ \t]+/g, ', $1, ')
    .replace(/[ \t]+[—–][ \t]+/g, ': ')
    .replace(/[—–]/g, '-')
}

export function cleanAssistantText(text: string): string {
  return stripDashes(stripNumericCitations(stripReferenceOnlySections(stripInlineLinks(text))))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
