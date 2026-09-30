export interface ContatoItem {
  icon: string
  label: string
  value: string
  href?: string
  external?: boolean
}

export interface ContatoCard {
  icon: string
  nome: string
  local: string
  itens: ContatoItem[]
}

export interface Departamento {
  slug: string
  sigla: string
  nome: string
  icon: string
  badge: string
  descricao: string
  endereco: string
  mapsUrl?: string
  cards: ContatoCard[]
}

export const departamentos: Departamento[] = [
  {
    slug: 'cic',
    sigla: 'CIC',
    nome: 'Departamento de Ciência da Computação',
    icon: 'i-lucide-cpu',
    badge: 'Departamento CIC/UnB',
    descricao: 'Informações de contato do Departamento de Ciência da Computação da Universidade de Brasília.',
    endereco: 'Prédio CIC/EST, Campus Darcy Ribeiro, Brasília, DF, CEP 70910-900',
    mapsUrl: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4814.823601540712!2d-47.87162942391438!3d-15.75857962207623!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x935a3bb88f71361f%3A0x3933d293e644ad55!2zUHLDqWRpbyBkZSBDacOqbmNpYSBkYSBDb21wdXRhw6fDo28gZSBFc3RhdMOtc3RpY2EgLSBDSUMvRVNU!5e1!3m2!1spt-BR!2sbr!4v1782043857591!5m2!1spt-BR!2sbr',
    cards: [
      {
        icon: 'i-lucide-graduation-cap',
        nome: 'Secretaria de Graduação',
        local: 'Prédio CIC/EST',
        itens: [
          { icon: 'i-lucide-clock', label: 'Horário', value: 'Seg-Sex, 8h às 20h' },
          { icon: 'i-lucide-phone', label: 'Telefone', value: '+55 (61) 3107-3661' },
          { icon: 'i-lucide-mail', label: 'E-mail', value: 'cic@unb.br', href: 'mailto:cic@unb.br' },
          { icon: 'i-lucide-globe', label: 'Site', value: 'cic.unb.br', href: 'https://cic.unb.br', external: true }
        ]
      },
      {
        icon: 'i-lucide-microscope',
        nome: 'Secretaria de Pós-Graduação',
        local: 'Prédio CIC/EST',
        itens: [
          { icon: 'i-lucide-clock', label: 'Horário', value: 'Seg-Sex, 8h às 20h' },
          { icon: 'i-lucide-phone', label: 'Telefone', value: '+55 (61) 3107-3661' },
          { icon: 'i-lucide-mail', label: 'E-mail', value: 'cic@unb.br', href: 'mailto:cic@unb.br' },
          { icon: 'i-lucide-globe', label: 'Site', value: 'ppgi.unb.br', href: 'https://ppgi.unb.br', external: true }
        ]
      },
      {
        icon: 'i-lucide-monitor',
        nome: 'LINF - Lab. de Informática',
        local: 'Módulo 19, ICC Norte',
        itens: [
          { icon: 'i-lucide-clock', label: 'Horário', value: 'Seg-Sex 7h-21h · Sáb 8h-16h · Dom acesso restrito' },
          { icon: 'i-lucide-phone', label: 'Telefone', value: '+55 (61) 3107-6369 | 3107-6372' },
          { icon: 'i-lucide-mail', label: 'E-mail', value: 'linf@unb.br', href: 'mailto:linf@unb.br' },
          { icon: 'i-lucide-info', label: 'Acesso', value: 'Mediante comprovante de matrícula' }
        ]
      }
    ]
  }
]

export function findDepartamento(slug: string) {
  return departamentos.find(departamento => departamento.slug === slug) ?? null
}
