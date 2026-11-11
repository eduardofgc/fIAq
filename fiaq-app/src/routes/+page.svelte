<script lang="ts">
  import { goto } from '$app/navigation'
  import { createQuery } from '@tanstack/svelte-query'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Button from '$lib/components/ui/button.svelte'
  import Input from '$lib/components/ui/input.svelte'
  import type { FaqCategory } from '$lib/types/faq'
  import { cn } from '$lib/utils'
  import { apiFetch } from '$lib/utils/api'
  import dadosProfessores from '../../data/professores.json'

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
  <title>fIAq — Assistente do CIC/UnB</title>
  <meta
    name="description"
    content="Pergunte ao assistente virtual do CIC/UnB sobre matrícula, TCC, estágio, extensão e mais."
  />
</svelte:head>

<div class="fiaq-main flex-1">
  <section class="fiaq-home-hero overflow-hidden bg-[#1a2e5a] px-6 py-12 text-center sm:px-10 lg:py-16">
    <div class="mx-auto grid max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(18rem,0.72fr)] lg:text-left">
      <div class="min-w-0">
        <h1 class="fiaq-home-title mx-auto max-w-3xl text-4xl font-black leading-[1.05] text-white sm:text-5xl lg:mx-0 lg:text-6xl">
          Como o
          <span class="inline-flex items-center gap-2 whitespace-nowrap text-green-300">
            <img src="/sarue-avatar.png" alt="" width="56" height="56" class="hidden h-[0.9em] w-[0.9em] shrink-0 object-contain sm:block" />
            Saruê
          </span>
          pode te ajudar?
        </h1>

        <p class="fiaq-home-subtitle mx-auto mt-5 max-w-2xl text-base font-medium leading-8 text-blue-100 sm:text-lg lg:mx-0">
          Pergunte sobre matrícula, TCC, estágio ou aquele PDF que ninguém lembra onde salvou.
          O Saruê caça a resposta em fontes oficiais do CIC/UnB e entrega o caminho sem enrolação.
        </p>

        <form class="fiaq-search-form mt-8 flex justify-center lg:justify-start" onsubmit={(event) => { event.preventDefault(); ask() }}>
          <div class="fiaq-search-box flex min-h-14 w-full max-w-2xl items-stretch overflow-hidden rounded-xl border border-[#00a155] bg-white shadow-[0_18px_42px_rgba(4,12,30,0.22)] ring-1 ring-[#00dc82]/35">
            <Input
              bind:value={query}
              type="text"
              name="home-question"
              autocomplete="off"
              placeholder="Digite sua pergunta..."
              aria-label="Campo de pergunta para o assistente"
              class="fiaq-search-input h-auto min-h-14 min-w-0 flex-1 rounded-none border-0 bg-white px-5 py-4 text-base text-[#1a2e5a] shadow-none outline-none placeholder:text-slate-500 focus-visible:ring-0"
            />
            <Button
              type="submit"
              aria-label="Perguntar ao assistente"
              class="fiaq-search-button flex h-auto min-h-14 shrink-0 self-stretch rounded-none border-l border-emerald-800/25 bg-[#00a155] px-4 py-0 text-base font-black text-[#0a2e1a] transition-colors hover:bg-[#17b86a] focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a2e5a] sm:px-6"
            >
              <FiaqIcon name="i-lucide-send" class="h-5 w-5 sm:h-4 sm:w-4" />
              <span class="hidden sm:inline">Perguntar</span>
            </Button>
          </div>
        </form>
      </div>

      <div class="relative mx-auto hidden w-full max-w-sm lg:block" aria-hidden="true">
        <img
          src="/sarueBot.png"
          alt=""
          width="626"
          height="432"
          class="w-full object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.25)]"
        />
      </div>
    </div>
  </section>

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
      <span class="font-medium text-slate-500">{dadosProfessores.professores.length} contatos</span>
    </a>
  </section>
</div>
