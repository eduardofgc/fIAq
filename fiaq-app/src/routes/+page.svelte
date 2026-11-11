<script lang="ts">
  import { goto } from '$app/navigation'
  import { createQuery } from '@tanstack/svelte-query'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import type { FaqCategory } from '$lib/types/faq'
  import { cn } from '$lib/utils'
  import { apiFetch } from '$lib/utils/api'
  import dadosProfessores from '../../data/professores.json'

  const totalProfessores = dadosProfessores.professores.length

  let query = $state('')

  const faqQuery = createQuery<FaqCategory[]>(() => ({
    queryKey: ['faq-categories'],
    queryFn: () => apiFetch<FaqCategory[]>('/api/faq'),
    staleTime: 5 * 60_000
  }))

  const categories = $derived(faqQuery.data ?? [])
  const totalQuestions = $derived(categories.reduce((total, cat) => total + cat.count, 0))

  const ICONS: Record<string, string> = {
    matricula: 'i-lucide-clipboard-list',
    'estrutura-curricular': 'i-lucide-book-open',
    'atividades-de-curso': 'i-lucide-flask-conical',
    'trajetoria-academica': 'i-lucide-route',
    'organizacoes-estudantis': 'i-lucide-users',
    coordenacao: 'i-lucide-phone',
    'leia-me': 'i-lucide-info'
  }
  const CATEGORY_COPY: Record<string, string> = {
    matricula: 'Prazos, vagas em turma, rematrícula e aqueles passos que sempre aparecem no calendário.',
    'estrutura-curricular': 'Componentes, optativas, carga horária e caminhos para montar uma grade sem susto.',
    'atividades-de-curso': 'TCC, estágio, extensão, monitoria e atividades que contam para a sua formação.',
    'trajetoria-academica': 'Rendimento, trancamento, permanência e decisões importantes ao longo do curso.',
    'organizacoes-estudantis': 'Atléticas, centros acadêmicos, empresas juniores e equipes para viver o campus.',
    coordenacao: 'Canais certos para falar com a coordenação e resolver demandas acadêmicas.',
    'leia-me': 'Regras, documentos e dúvidas gerais que não cabem em uma gaveta só.'
  }
  const skeletonCards = [
    'faq-loading-1',
    'faq-loading-2',
    'faq-loading-3',
    'faq-loading-4',
    'faq-loading-5',
    'faq-loading-6',
    'faq-loading-7'
  ]

  function iconFor(slug: string) {
    return ICONS[slug] ?? 'i-lucide-help-circle'
  }

  function summaryFor(slug: string) {
    return CATEGORY_COPY[slug] ?? 'Respostas rápidas para encontrar o caminho certo dentro do FAQ.'
  }

  function categoryGridSpan(index: number) {
    return index < 3 ? 'lg:col-span-4' : 'lg:col-span-3'
  }

  function ask() {
    const q = query.trim()
    void goto(q ? `/chatbot?q=${encodeURIComponent(q)}` : '/chatbot')
  }
</script>

<svelte:head>
  <title>fIAq - Assistente do CIC/UnB</title>
  <meta
    name="description"
    content="Base de dúvidas frequentes do departamento de Ciência da Computação - UnB"
  />
</svelte:head>

<div class="min-h-screen bg-[#f4f4f4] font-sans">

  <!-- Hero -->
  <div class="bg-[#1a2e5a] px-10 pt-12 pb-16 text-center">
    <img src="/sarue-avatar.png" alt="" width="72" height="72" class="mx-auto mb-5 h-[72px] w-[72px] object-contain" />
    <h1 class="text-4xl font-extrabold text-white mb-3">Como podemos te ajudar?</h1>
    <p class="text-blue-200 text-base mb-8 max-w-2xl mx-auto">
      Pergunte em linguagem natural sobre matrícula, TCC, estágio, extensão e mais. O assistente responde com base no conteúdo oficial do CIC/UnB.
    </p>

    <form
      class="flex justify-center"
      onsubmit={(event) => { event.preventDefault(); ask() }}
    >
      <div class="flex w-full max-w-2xl rounded-xl overflow-hidden shadow-[0_18px_42px_rgba(4,12,30,0.22)]">
        <input
          bind:value={query}
          type="text"
          placeholder="Ex: Quais são as etapas da matrícula?"
          class="flex-1 bg-[#2b3f6e] text-white placeholder-blue-200/70 px-6 py-4 text-base outline-none"
        />
        <button
          type="submit"
          class="flex items-center gap-2 bg-[#00a155] text-[#0a2e1a] font-bold px-8 py-4 text-base hover:bg-[#17b86a] transition-colors"
        >
          <FiaqIcon name="i-lucide-send" class="w-5 h-5" />
          Perguntar
        </button>
      </div>
    </form>

    <a
      href="/chatbot"
      class="inline-flex items-center gap-1.5 text-blue-200 hover:text-green-400 text-sm font-medium mt-4 transition-colors"
    >
      <FiaqIcon name="i-lucide-message-circle" class="w-4 h-4" />
      Abrir o Assistente Virtual
    </a>
  </div>

  <section class="fiaq-faq-section mx-auto max-w-7xl px-6 py-10 sm:px-10 lg:py-12">
    <div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-xs font-black uppercase text-[#00a155]">Atalhos do FAQ</p>
        <h2 class="fiaq-section-title mt-1 text-2xl font-black text-[#1a2e5a]">
          Perguntas frequentes por tema
        </h2>
        <p class="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-500">
          Escolha um módulo e pule direto para as respostas mais procuradas, sem abrir dez abas ao mesmo tempo.
        </p>
      </div>

      {#if totalQuestions > 0}
        <span class="inline-flex w-fit items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-black text-[#1a2e5a] ring-1 ring-blue-100">
          <FiaqIcon name="i-lucide-list-checks" class="h-4 w-4 text-[#00a155]" />
          {totalQuestions} respostas mapeadas
        </span>
      {/if}
    </div>

    {#if faqQuery.isLoading}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        {#each skeletonCards as skeletonId, index (skeletonId)}
          <div class={cn('h-44 animate-pulse rounded-2xl border-2 border-slate-200 bg-white shadow-sm', categoryGridSpan(index))} aria-hidden="true"></div>
        {/each}
      </div>
    {:else if faqQuery.isError}
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        Não foi possível carregar o FAQ agora.
      </div>
    {:else}
      <div class="fiaq-faq-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
        {#each categories as cat, index (cat.slug)}
          <a href={`/faq/${cat.slug}`} class={cn('group block', categoryGridSpan(index))}>
            <div class="fiaq-faq-card flex h-full cursor-pointer flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[#1a2e5a]/50 hover:shadow-md sm:min-h-44 sm:gap-4 sm:px-5 sm:py-5">
              <div class="flex items-start justify-between gap-3">
                <div class="fiaq-faq-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1a2e5a] ring-1 ring-blue-100 transition-colors group-hover:bg-[#1a2e5a] group-hover:text-white">
                  <FiaqIcon name={iconFor(cat.slug)} class="h-6 w-6" />
                </div>
                <span class="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                  {cat.count} {cat.count === 1 ? 'pergunta' : 'perguntas'}
                </span>
              </div>

              <div class="min-w-0">
                <p class="fiaq-faq-title text-base font-black leading-snug text-[#1a2e5a]">{cat.titulo}</p>
                <p class="mt-2 text-sm font-semibold leading-6 text-slate-500">{summaryFor(cat.slug)}</p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

    <a href="/professores" class="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-bold text-[#1a2e5a] hover:text-[#00a155] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-600">
      <FiaqIcon name="i-lucide-graduation-cap" class="h-5 w-5" />
      Professores do CIC
      <span class="font-medium text-slate-500">{totalProfessores} contatos</span>
    </a>
  </section>
</div>
