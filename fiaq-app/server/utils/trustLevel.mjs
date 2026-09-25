// Fonte única da classificação "oficial" x "institucional" usada tanto pelos
// scripts de ingestão (Node puro, sem TS) quanto pelo runtime do chat.
//
// "oficial": órgão/sistema com autoridade normativa sobre regras, prazos e
// procedimentos acadêmicos (secretarias, decanatos, sistemas oficiais,
// coordenação de curso, normas federais).
// "institucional": demais páginas *.unb.br ou externas (grupos estudantis,
// empresas júnior, eventos, sites de captação) — podem ser úteis como
// contexto, mas não substituem a fonte normativa numa dúvida de regra/prazo.
//
// FAQ curado e PDFs de editais entram em "oficial" por construção (foram
// selecionados manualmente ou são o próprio documento oficial).

export const OFICIAL_HOSTS = new Set([
  'unb.br',
  'www.unb.br',
  'saa.unb.br',
  'deg.unb.br',
  'dac.unb.br',
  'dds.dac.unb.br',
  'dpg.unb.br',
  'portalsig.unb.br',
  'ouvidoria.unb.br',
  'sdh.unb.br',
  'sti.unb.br',
  'cerimonial.unb.br',
  'bce.unb.br',
  'ru.unb.br',
  'dasu.unb.br',
  'proic.unb.br',
  'acessibilidade.unb.br',
  'www.cic.unb.br',
  'cic.unb.br',
  'exatas.unb.br',
  'www.exatas.unb.br',
  'gov.br',
  'www.gov.br'
])

export function hostFromUrl(url) {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function trustLevelForUrl(url) {
  const host = hostFromUrl(url)
  return host && OFICIAL_HOSTS.has(host) ? 'oficial' : 'institucional'
}

// kind: 'faq' | 'pdf' | 'crawl'
export function trustLevelForChunk(kind, url) {
  if (kind === 'faq' || kind === 'pdf') return 'oficial'
  return trustLevelForUrl(url)
}
