import dados from '../../data/professores.json'
import type { SearchResult } from '../repositorios/rag'
import { normalizeText } from './chatRetrieval'

// Contato de professores no chat. Busca por nome na mesma lista da página
// /professores (data/professores.json, gerada por pnpm fetch:professores), sem
// embedding: nome próprio casa mal na busca vetorial, e aqui a resposta é exata.

interface Professor {
  nome: string
  email: string
  telefone: string
}

const PROFESSORES: Professor[] = dados.professores
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
const MAX_HOMONIMOS = 6

// Sem uma dessas palavras, um sobrenome sozinho não basta: "Campos", "Rocha" e
// "Nascimento" também são palavras comuns.
const PISTA_DE_PROFESSOR = /\b(prof|profa|professor|professora|professores|professoras|docente|docentes|orientador|orientadora|email|e-mail|contato|telefone|ramal)\b/
const PEDIDO_DE_LISTA = /\b(lista|quais sao|quais os|quais as|quem sao|todos os|todas as|corpo docente)\b/
const PROFESSORES_NO_PLURAL = /\b(professores|professoras|docentes|corpo docente)\b/
// "e o telefone dele?": o nome ficou numa pergunta anterior da conversa.
const REFERENCIA_A_PESSOA = /\b(dele|dela|deles|delas|ele|ela|eles|elas|desse professor|dessa professora)\b/

// Calculado no primeiro uso: chatRetrieval importa este módulo e vice-versa.
let tokens: string[][] | null = null

function tokensDosNomes(): string[][] {
  tokens ??= PROFESSORES.map(professor => normalizeText(professor.nome)
    .split(' ')
    .filter(token => token.length >= 3 && !PARTICULAS.has(token)))
  return tokens
}

function linhaDeContato(professor: Professor): string {
  const telefone = professor.telefone ? `, telefone ${professor.telefone}` : ''
  return `${professor.nome}: e-mail ${professor.email}${telefone}.`
}

function resultado(id: string, titulo: string, conteudo: string): SearchResult {
  return { id, titulo, conteudo, url: dados.fonte, nivelConfianca: 'oficial', score: 1 }
}

// question: a mensagem atual; searchQuestion: ela somada às anteriores numa
// continuação. O histórico só entra quando a mensagem atual aponta para uma
// pessoa, senão "e como faço matrícula?" depois de pedir um contato traria o
// mesmo professor de novo.
export function buscarProfessores(question: string, searchQuestion = question): SearchResult | null {
  const direto = buscarNoTexto(question)
  if (direto || searchQuestion === question) return direto
  return REFERENCIA_A_PESSOA.test(normalizeText(question)) ? buscarNoTexto(searchQuestion) : null
}

function buscarNoTexto(texto: string): SearchResult | null {
  const normalized = normalizeText(texto)
  const palavras = new Set(normalized.split(' '))
  const temPista = PISTA_DE_PROFESSOR.test(normalized)

  const nomes = tokensDosNomes()
  const encontrados = PROFESSORES
    .map((professor, index) => ({
      professor,
      acertos: nomes[index]!.filter(token => palavras.has(token)).length
    }))
    .filter(({ acertos }) => acertos >= 2 || (acertos === 1 && temPista))

  if (encontrados.length) {
    // "professor Marcelo Ladeira" acerta 2 nomes; os outros Marcelos, 1.
    const melhor = Math.max(...encontrados.map(item => item.acertos))
    const professores = encontrados
      .filter(item => item.acertos === melhor)
      .slice(0, MAX_HOMONIMOS)
      .map(item => item.professor)

    if (professores.length === 1) {
      const [professor] = professores
      return resultado(
        'professores-cic',
        `Contato: ${professor!.nome}`,
        `Docente do Departamento de Ciência da Computação (CIC) da UnB. ${linhaDeContato(professor!)}`
      )
    }

    return resultado(
      'professores-cic',
      'Contato de professores do CIC',
      `O Departamento de Ciência da Computação (CIC) da UnB tem ${professores.length} docentes com esse nome. ${professores.map(linhaDeContato).join(' ')} Para saber qual é o certo, basta conferir o nome completo do professor.`
    )
  }

  if (PROFESSORES_NO_PLURAL.test(normalized) && PEDIDO_DE_LISTA.test(normalized)) {
    return resultado(
      'professores-cic',
      'Professores do CIC',
      `O Departamento de Ciência da Computação (CIC) da UnB tem ${PROFESSORES.length} docentes. Os nomes e e-mails, com foto e telefone, estão na página Professores do fIAq: ${PROFESSORES.map(p => `${p.nome} (${p.email})`).join('; ')}.`
    )
  }

  return null
}
