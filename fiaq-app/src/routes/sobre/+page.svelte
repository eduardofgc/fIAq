<script lang="ts">
  import FiaqBrand from '$lib/components/FiaqBrand.svelte'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'

  const techStacks = [
    {
      title: 'Framework & UI',
      description: 'SvelteKit, shadcn-svelte, Tailwind CSS 4 e Lucide',
      items: [
        { label: 'SvelteKit', icon: 'i-lucide-zap' },
        { label: 'shadcn-svelte', icon: 'i-lucide-component' },
        { label: 'Tailwind CSS', icon: 'i-lucide-palette' }
      ]
    },
    {
      title: 'Estado & Dados',
      description: 'TanStack Query para cache client-side e Table Core para listagens',
      items: [
        { label: 'TanStack Query', icon: 'i-lucide-route' },
        { label: 'TanStack Table', icon: 'i-lucide-table' }
      ]
    },
    {
      title: 'IA e Conhecimento',
      description: 'OpenRouter, Supabase Postgres e pgvector',
      items: [
        { label: 'OpenRouter', icon: 'i-lucide-brain-circuit' },
        { label: 'PostgreSQL', icon: 'i-lucide-database' },
        { label: 'pgvector', icon: 'i-lucide-spline' }
      ]
    }
  ]

  const team = [
    { name: 'Fernando Augusto', github: 'fernando-augustop' },
    { name: 'Gustavo Nascimento', github: 'PavanelliGustavo' },
    { name: 'Eduardo Rocha', github: 'eduardofgc' },
    { name: 'Samara Gomes', github: 'samaragomess' },
    { name: 'Augusto Faller', github: 'tosgual' },
    { name: 'Lucas Centurion Netto', github: 'LucasCenturionNetto' }
  ]
</script>

<svelte:head>
  <title>Sobre o Projeto - fIAq</title>
  <meta
    name="description"
    content="Objetivo, tecnologias, funcionamento da IA e equipe do projeto fIAq, assistente virtual do CIC/UnB."
  />
</svelte:head>

<div class="flex-1">
  <section class="bg-[#1a2e5a] px-6 pb-14 pt-12 text-center sm:px-10">
    <div class="flex flex-col items-center gap-3">
      <FiaqBrand link={false} size="sm" />
      <h1 class="text-2xl font-extrabold text-white sm:text-3xl">Sobre o Projeto</h1>
    </div>
    <p class="mx-auto mt-3 max-w-2xl text-sm text-blue-200 sm:text-base">
      Portal de perguntas frequentes e assistente virtual com IA do Departamento de
      Ciência da Computação da Universidade de Brasília.
    </p>
  </section>

  <section class="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-12 sm:px-10">
    <section class="flex items-start gap-4 sm:gap-5">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1a2e5a] sm:h-14 sm:w-14">
        <FiaqIcon name="i-lucide-target" class="h-6 w-6 sm:h-7 sm:w-7" />
      </div>
      <div>
        <h2 class="mb-2 text-xl font-extrabold text-[#1a2e5a] sm:text-2xl">Objetivo do Sistema</h2>
        <p class="text-sm leading-relaxed text-gray-600 sm:text-base">
          As informações do CIC/UnB estão espalhadas por sites, PDFs e setores. O fIAq
          centraliza tudo numa interface acessível, com um FAQ navegável por tema e um
          assistente virtual que responde em linguagem natural usando uma <strong class="text-[#1a2e5a]">base de conhecimento</strong>
          com conteúdo institucional oficial, sempre citando as fontes consultadas.
        </p>
      </div>
    </section>

    <section>
      <h2 class="mb-6 text-center text-xl font-extrabold text-[#1a2e5a] sm:text-2xl">Tecnologias Utilizadas</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {#each techStacks as stack (stack.title)}
          <article class="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white px-6 py-6 text-center shadow-sm">
            <h3 class="text-sm font-bold text-[#1a2e5a] sm:text-base">{stack.title}</h3>
            <div class="flex items-center gap-3">
              {#each stack.items as item (item.label)}
                <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-[#1a2e5a]" title={item.label}>
                  <FiaqIcon name={item.icon} class="h-5 w-5" />
                </div>
              {/each}
            </div>
            <p class="text-xs leading-relaxed text-gray-500">{stack.description}</p>
          </article>
        {/each}
      </div>
    </section>

    <section class="flex items-start gap-4 sm:gap-5">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-700 sm:h-14 sm:w-14">
        <FiaqIcon name="i-lucide-brain-circuit" class="h-6 w-6 sm:h-7 sm:w-7" />
      </div>
      <div>
        <h2 class="mb-2 text-xl font-extrabold text-[#1a2e5a] sm:text-2xl">Como a IA Funciona</h2>
        <p class="text-sm leading-relaxed text-gray-600 sm:text-base">
          Quando você faz uma pergunta, o assistente gera um <em>embedding</em> do texto
          e busca os trechos mais relevantes do conteúdo oficial do CIC/UnB, indexados
          com <strong class="text-[#1a2e5a]">pgvector</strong> no PostgreSQL. Esses trechos
          são usados como contexto para o modelo de linguagem gerar uma resposta, com
          links reais exibidos como fontes abaixo do texto.
        </p>
      </div>
    </section>

    <section>
      <h2 class="mb-6 text-center text-xl font-extrabold text-[#1a2e5a] sm:text-2xl">Equipe</h2>
      <p class="-mt-3 mb-6 text-center text-xs text-gray-500 sm:text-sm">
        Projeto desenvolvido por alunos da disciplina de Técnicas de Programação 2, UnB 2026.1
      </p>
      <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {#each team as member, idx (member.github)}
          <a
            href={`https://github.com/${member.github}`}
            target="_blank"
            rel="noopener noreferrer"
            class={['flex items-center gap-3 px-5 py-3.5 text-sm transition-colors hover:bg-blue-50/50', idx < team.length - 1 ? 'border-b border-gray-100' : '']}
          >
            <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1a2e5a]">
              <FiaqIcon name="i-lucide-github" class="h-4 w-4" />
            </span>
            <span class="font-semibold text-[#1a2e5a]">{member.name}</span>
            <span class="text-xs text-gray-400 sm:text-sm">@{member.github}</span>
          </a>
        {/each}
      </div>
    </section>
  </section>
</div>
