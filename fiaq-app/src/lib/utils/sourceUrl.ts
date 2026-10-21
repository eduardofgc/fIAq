// Endereço de fonte que pode ir para um link clicável: só http(s).
// O certificado de www.cic.unb.br não cobre esse nome (o navegador mostra erro),
// e o FAQ inteiro aponta para ele; cic.unb.br serve as mesmas páginas.
export function publicSourceUrl(raw: string | undefined): string {
  try {
    const url = new URL(raw ?? '')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.hostname === 'www.cic.unb.br') {
      url.protocol = 'https:'
      url.hostname = 'cic.unb.br'
    }
    return url.href
  } catch {
    return ''
  }
}
