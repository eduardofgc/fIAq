import dados from '../../data/professores.json'
import faqCoordenacao from '../../data/faq/faq-coordenacao.json'
import type { SearchResult } from '../repositorios/rag'
import { normalizeText, terms } from './chatRetrieval'

// Contato de professores no chat. Busca por nome na mesma lista da página
// /professores (data/professores.json, gerada por pnpm fetch:professores), sem
// embedding: nome próprio casa mal na busca vetorial, e aqui a resposta é exata.

interface Professor {
  nome: string
  email: string
  telefone: string
}

// Comissões da página https://cic.unb.br/administracao/comissoes. "texto" é o
// item como aparece lá ("Carla Denise Castanho (presidente)", "Chefia do CIC:
// Edna Dias Canedo"); e-mail e telefone vêm da lista de professores.
interface Membro {
  texto: string
  email: string
  telefone: string
}

interface Comissao {
  id: string
  nome: string
  membros: Membro[]
}

const PROFESSORES: Professor[] = dados.professores
const COMISSOES: Comissao[] = dados.comissoes
const GESTAO = COMISSOES.find(comissao => comissao.id === 'comissao-de-gestao')
const MAX_COMISSOES = 3
// "As informações sobre a coordenação estão disponíveis na [página do curso no
// SIGAA]": entra junto para quem não tem contato na lista e vira chip de link.
// O resultado 'gestao-cic' contém essa entrada do FAQ (o eval-rag conta assim).
export const FAQ_DENTRO_DA_GESTAO = 'quem-esta-atuando-como-coordenador-e-consigo-contato'
const CONTATO_DA_COORDENACAO = faqCoordenacao.find(entrada => entrada.id === FAQ_DENTRO_DA_GESTAO)?.conteudo ?? ''
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])
const MAX_HOMONIMOS = 6

// Sem uma dessas palavras, um sobrenome sozinho não basta: "Campos", "Rocha" e
// "Nascimento" também são palavras comuns.
const PISTA_DE_PROFESSOR = /\b(prof|profa|professor|professora|professores|professoras|docente|docentes|orientador|orientadora|email|e-mail|contato|telefone|ramal)\b/
const PEDIDO_DE_LISTA = /\b(lista|quais sao|quais os|quais as|quem sao|todos os|todas as|corpo docente)\b/
const PROFESSORES_NO_PLURAL = /\b(professores|professoras|docentes|corpo docente)\b/
// "quem é o coordenador?", "e-mail da chefia": cargo + intenção de saber quem é
// ou como falar. "O que faz o coordenador?" não entra (o FAQ responde).
const PEDIDO_DE_CARGO = /\b(coordenador|coordenadora|coordenadores|coordenacao|coordena|chefe|chefia|subchefe|subchefia|diretor|diretora)\b/
const QUER_SABER_QUEM = /\b(quem|email|e-mail|contato|contatos|telefone|falar|falo|nome)\b/
const PEDIDO_DE_COMISSAO = /\b(comissao|comissoes|nde|nucleo docente)\b/
// Só pergunta sobre as pessoas: "como funciona a comissão de estágio?" é com o FAQ.
const PEDE_PESSOAS = /\b(quem|membro|membros|integrante|integrantes|faz parte|fazem parte|compoe|compoem|presidente|preside|coordenador|coordenadora|coordena|email|e-mail|contato|contatos|telefone|nome|nomes)\b/
// Palavras que todo nome de comissão tem e não dizem qual é.
const PALAVRAS_DE_COMISSAO = new Set(['comissao', 'nucleo', 'docente', 'estruturante', 'nde', 'bacharelado', 'em'])
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

function linhaDeMembro({ texto, email, telefone }: Membro): string {
  if (!email) return `${texto} (contato fora da lista de professores do CIC).`
  return `${texto}: e-mail ${email}${telefone ? `, telefone ${telefone}` : ''}.`
}

function resultado(id: string, titulo: string, conteudo: string, url = dados.fonte): SearchResult {
  return { id, titulo, conteudo, url, nivelConfianca: 'oficial', score: 1 }
}

// "quem é o presidente da comissão de estágio?", "membros do NDE de engenharia":
// fica a comissão cujo nome tem mais palavras da pergunta.
function buscarComissoes(normalized: string): Comissao[] {
  const raizesDaPergunta = new Set(terms(normalized).map(termo => termo.slice(0, 5)))
  const pontuadas = COMISSOES.map(comissao => ({
    comissao,
    acertos: terms(comissao.nome)
      .filter(termo => !PALAVRAS_DE_COMISSAO.has(termo) && raizesDaPergunta.has(termo.slice(0, 5)))
      .length
  }))
  const melhor = Math.max(0, ...pontuadas.map(item => item.acertos))
  if (!melhor) return []
  return pontuadas
    .filter(item => item.acertos === melhor)
    .slice(0, MAX_COMISSOES)
    .map(item => item.comissao)
}

function descreverComissao(comissao: Comissao): string {
  const lideranca = comissao.membros.some(membro => /presidente|coordenador|coordenadora/i.test(membro.texto))
  return `${comissao.nome} do Departamento de Ciência da Computação (CIC). Membros: ${comissao.membros.map(linhaDeMembro).join(' ')}${lideranca ? '' : ' A página oficial não indica quem preside esta comissão.'}`
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

  if (PEDIDO_DE_COMISSAO.test(normalized) && PEDE_PESSOAS.test(normalized)) {
    const comissoes = buscarComissoes(normalized)
    if (comissoes.length) {
      return resultado(
        'comissoes-cic',
        comissoes.length === 1 ? `${comissoes[0]!.nome} do CIC` : 'Comissões do CIC',
        comissoes.map(descreverComissao).join('\n\n'),
        comissoes.length === 1 ? `${dados.comissoesFonte}#${comissoes[0]!.id}` : dados.comissoesFonte
      )
    }
  }

  if (GESTAO && PEDIDO_DE_CARGO.test(normalized) && QUER_SABER_QUEM.test(normalized)) {
    return resultado(
      'gestao-cic',
      'Chefia e coordenações do CIC',
      `O CIC é um departamento e não tem "coordenador": quem responde pelo departamento é a chefia (hoje, ${GESTAO.membros[0]?.texto.replace(/^[^:]+:\s*/, '')}). Coordenação é de cada curso, e quem pergunta pelo "coordenador do CIC" quer a chefia ou a coordenação do próprio curso. ${GESTAO.membros.map(linhaDeMembro).join(' ')} ${CONTATO_DA_COORDENACAO}`,
      `${dados.comissoesFonte}#${GESTAO.id}`
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

const MAX_CONTATOS_CITADOS = 6

// Trecho que cita professor pelo nome ("Coordenação da Ciência da Computação:
// Marcelo Mandelli") não traz o e-mail, e o aluno perguntou justamente o
// contato. Casa primeiro e último nome com até 4 palavras no meio, porque as
// páginas abreviam ou acrescentam sobrenomes ("Marcelo Mandelli" é "Marcelo
// Grandi Mandelli"). A página de comissões cita quase todo o departamento, então
// ficam os nomes mais perto das palavras da pergunta ("coordenador", "chefe",
// "estágio"), até MAX_CONTATOS_CITADOS.
export function contatosCitados(texto: string, pergunta: string): string {
  const normalized = normalizeText(texto)
  const posicoesDaPergunta = terms(pergunta)
    .map(termo => termo.slice(0, 4))
    .flatMap(raiz => [...normalized.matchAll(new RegExp(`\\b${raiz}`, 'g'))].map(match => match.index))

  const citados = PROFESSORES
    .map((professor) => {
      const nomes = normalizeText(professor.nome)
        .split(' ')
        .filter(nome => nome.length >= 2 && !PARTICULAS.has(nome))
      if (nomes.length < 2) return null
      const padrao = new RegExp(`\\b${nomes[0]}\\b(?:\\s+\\S+){0,4}?\\s+${nomes[nomes.length - 1]}\\b`)
      const posicao = normalized.search(padrao)
      if (posicao < 0) return null
      const distancia = posicoesDaPergunta.length
        ? Math.min(...posicoesDaPergunta.map(p => Math.abs(p - posicao)))
        : posicao
      return { professor, distancia }
    })
    .filter(item => item !== null)
    .sort((a, b) => a.distancia - b.distancia)
    .slice(0, MAX_CONTATOS_CITADOS)

  if (!citados.length) return ''
  return `Contatos dos professores citados acima (lista oficial do CIC): ${citados.map(({ professor }) => linhaDeContato(professor)).join(' ')}`
}
