<script lang="ts">
  import { goto } from '$app/navigation'
  import { createQuery } from '@tanstack/svelte-query'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import type { FaqCategory } from '$lib/types/faq'
  import { apiFetch } from '$lib/utils/api'

  let query = $state('')

  const faqQuery = createQuery<FaqCategory[]>(() => ({
    queryKey: ['faq-categories'],
    queryFn: () => apiFetch<FaqCategory[]>('/api/faq'),
    staleTime: 5 * 60_000
  }))

  const categories = $derived(faqQuery.data ?? [])

  const ICONS: Record<string, string> = {
    matricula: 'i-lucide-clipboard-list',
    'estrutura-curricular': 'i-lucide-book-open',
    'atividades-de-curso': 'i-lucide-flask-conical',
    'trajetoria-academica': 'i-lucide-route',
    'organizacoes-estudantis': 'i-lucide-users',
    coordenacao: 'i-lucide-phone',
    'leia-me': 'i-lucide-info'
  }

  function iconFor(slug: string) {
    return ICONS[slug] ?? 'i-lucide-help-circle'
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

  <div class="h-px bg-gray-300 mx-10"></div>

  <!-- Categories -->
  <div class="px-10 py-10">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-xl font-bold text-[#1a2e5a]">Perguntas frequentes por tema</h2>
      <button class="text-sm text-gray-500 hover:text-[#1a2e5a] transition-colors">Filtrar</button>
    </div>

    {#if faqQuery.isLoading}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each Array(6) as _, i (i)}
          <div class="h-20 animate-pulse rounded-2xl border border-gray-200 bg-white shadow-sm"></div>
        {/each}
      </div>
    {:else if faqQuery.isError}
      <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
        Não foi possível carregar o FAQ agora.
      </div>
    {:else}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each categories as cat (cat.slug)}
          <a href={`/faq/${cat.slug}`} class="group">
            <div class="bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-4 flex items-center gap-4 hover:shadow-md hover:border-[#1a2e5a] transition-all duration-200 cursor-pointer">
              <div class="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                <FiaqIcon name={iconFor(cat.slug)} class="w-6 h-6 text-[#1a2e5a]" />
              </div>
              <div>
                <p class="font-bold text-[#1a2e5a] text-sm">{cat.titulo}</p>
                <p class="text-xs text-gray-400 mt-0.5">
                  {cat.count} {cat.count === 1 ? 'pergunta' : 'perguntas'}
                </p>
              </div>
            </div>
          </a>
        {/each}
      </div>
    {/if}

  </div>

</div>
