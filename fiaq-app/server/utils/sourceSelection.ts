// Escolha das fontes que aparecem abaixo da resposta do chat. A busca traz até
// 3 trechos da base, até 6 páginas web e todos os links que os trechos citam;
// mostrar tudo enterrava o link certo (ex.: o modelo LaTeX do TCC no meio de 4
// regulamentos). O modelo recebe a lista numerada (F1, F2...) e termina a
// resposta com "[[fontes: F1, F3]]"; a rota esconde essa linha do aluno e
// mostra só o que ele indicou.

export interface SelectableSource {
  id: string
  titulo: string
  url: string
  kind: 'rag' | 'web' | 'link'
  description?: string
  // Só para link: trecho que o cita, e se aparece quando o modelo não escolhe.
  origem?: string
  principal?: boolean
}

// Separados: "consulte o regulamento do seu curso" precisa dos 4 links de curso.
export const MAX_SELECTED_CONTENT = 3
export const MAX_SELECTED_LINKS = 5
// Sem escolha do modelo: os links do 1º trecho, como antes.
const MAX_FALLBACK_LINKS = 5
const MARKER_START = '[['

export function sourceCode(index: number): string {
  return `F${index + 1}`
}

export function buildSourceCatalog(sources: SelectableSource[]): string {
  if (!sources.length) return ''

  const lines = sources.map((source, index) => {
    const label = source.kind === 'link'
      ? `link "${source.titulo}", citado em "${source.origem ?? ''}"`
      : `${source.titulo} (${source.kind === 'web' ? 'página web' : 'base do fIAq'})`
    return `${sourceCode(index)}. ${label}`
  })

  return `Fontes e links que podem aparecer abaixo da resposta:\n${lines.join('\n')}`
}

// "[[fontes: F2, F5]]" (ou variações como "[[F2,F5]]"). null = o modelo não
// escreveu a linha, e aí vale o comportamento antigo.
export function parseSourceMarker(text: string): number[] | null {
  // A partir do primeiro "[[", igual ao filtro do streaming.
  const start = text.indexOf(MARKER_START)
  if (start < 0) return null

  const marker = text.slice(start)
  return [...new Set([...marker.matchAll(/F(\d+)/gi)].map(match => Number(match[1]) - 1))]
}

// Texto da resposta sem a linha de fontes.
export function stripSourceMarker(text: string): string {
  const start = text.indexOf(MARKER_START)
  return start < 0 ? text : text.slice(0, start).trimEnd()
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Link que a resposta cita pelo nome ("o modelo LaTeX"), vindo de um trecho
// que ela usou, aparece mesmo que o modelo esqueça o código dele na linha de
// fontes; o modelo gratuito acerta a linha na maioria das vezes, não em todas.
function linksNamedInAnswer(sources: SelectableSource[], used: SelectableSource[], answer: string): SelectableSource[] {
  const usedTitles = new Set(used.filter(source => source.kind !== 'link').map(source => source.titulo))
  const text = normalize(answer)
  return sources.filter(source => source.kind === 'link'
    && usedTitles.has(source.origem ?? '')
    && source.titulo.length >= 4
    && text.includes(normalize(source.titulo)))
}

export function selectSources(sources: SelectableSource[], chosen: number[] | null, answer = ''): SelectableSource[] {
  const contentSources = sources.filter(source => source.kind !== 'link')

  if (chosen === null) {
    return [
      ...contentSources,
      ...sources.filter(source => source.kind === 'link' && source.principal).slice(0, MAX_FALLBACK_LINKS)
    ]
  }

  const valid = chosen
    .filter(index => index >= 0 && index < sources.length)
    .sort((a, b) => a - b)
    .map(index => sources[index]!)
  const content = valid.filter(source => source.kind !== 'link').slice(0, MAX_SELECTED_CONTENT)
  if (!content.length && contentSources[0]) content.push(contentSources[0])
  const links = [...new Set([
    ...valid.filter(source => source.kind === 'link'),
    ...linksNamedInAnswer(sources, content, answer)
  ])]
    .sort((a, b) => sources.indexOf(a) - sources.indexOf(b))
    .slice(0, MAX_SELECTED_LINKS)

  return [...content, ...links]
}

// Esconde a linha de fontes enquanto a resposta chega aos pedaços. Tudo a partir
// de "[[" fica retido; um "[" solto no fim de um pedaço espera o próximo, porque
// pode ser o começo da marca.
export function createMarkerFilter() {
  let held = ''
  let hidden = false

  return {
    push(chunk: string): string {
      if (hidden) return ''
      held += chunk

      const start = held.indexOf(MARKER_START)
      if (start >= 0) {
        hidden = true
        const visible = held.slice(0, start)
        held = ''
        return visible
      }

      if (held.endsWith('[')) {
        const visible = held.slice(0, -1)
        held = '['
        return visible
      }

      const visible = held
      held = ''
      return visible
    },
    flush(): string {
      const visible = hidden ? '' : held
      held = ''
      return visible
    }
  }
}
