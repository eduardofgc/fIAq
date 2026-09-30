<script lang="ts">
  import { tick } from 'svelte'
  import { page } from '$app/state'
  import { createQuery } from '@tanstack/svelte-query'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Button from '$lib/components/ui/button.svelte'
  import Input from '$lib/components/ui/input.svelte'
  import SourceChip from '$lib/components/chat/SourceChip.svelte'
  import type { FaqCategory, FaqItem } from '$lib/types/faq'
  import { apiFetch } from '$lib/utils/api'
  import { renderMarkdown } from '$lib/utils/markdown'

  const skeletonQuestions = ['faq-question-loading-1', 'faq-question-loading-2', 'faq-question-loading-3', 'faq-question-loading-4']

  let searchQuery = $state('')
  let selectedItemId = $state<string | null>(null)
  let dialogEl = $state<HTMLElement | null>(null)
  let restoreFocusEl: HTMLElement | null = null

  const slug = $derived(page.params.slug ?? '')
  const faqQuery = createQuery<FaqCategory[]>(() => ({
    queryKey: ['faq-categories'],
    queryFn: () => apiFetch<FaqCategory[]>('/api/faq'),
    staleTime: 5 * 60_000
  }))

  const categories = $derived<FaqCategory[]>(faqQuery.data ?? [])
  const category = $derived(categories.find((c: FaqCategory) => c.slug === slug) ?? null)
  const selectedItem = $derived((category?.items ?? []).find((item: FaqItem) => item.id === selectedItemId) ?? null)
  const filteredItems = $derived.by<FaqItem[]>(() => {
    const items = category?.items ?? []
    const query = normalizeSearchText(searchQuery.trim())
    if (!query) return items

    return items.filter((item: FaqItem) => {
      const searchable = normalizeSearchText(`${item.titulo} ${item.conteudo}`)
      return searchable.includes(query)
    })
  })

  function normalizeSearchText(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  }

  function openItem(id: string, event?: MouseEvent) {
    restoreFocusEl = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null
    selectedItemId = id
  }

  function closeItem() {
    selectedItemId = null
    tick().then(() => {
      restoreFocusEl?.focus()
      restoreFocusEl = null
    })
  }

  function previewText(text: string): string {
    const clean = text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[#*_>~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (clean.length <= 128) return clean
    return `${clean.slice(0, 125).trim()}...`
  }

  function sourceHost(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return 'fonte oficial'
    }
  }

  function getDialogFocusable(): HTMLElement[] {
    if (!dialogEl) return []

    const selector = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',')

    return Array.from(dialogEl.querySelectorAll<HTMLElement>(selector))
      .filter((element) => element.getClientRects().length > 0)
  }

  function handleDialogKeydown(event: KeyboardEvent) {
    if (!selectedItem) return

    if (event.key === 'Escape') {
      closeItem()
      return
    }

    if (event.key !== 'Tab' || !dialogEl) return

    const focusable = getDialogFocusable()
    if (focusable.length === 0) {
      event.preventDefault()
      dialogEl?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    const activeIsFocusable = active instanceof HTMLElement && focusable.includes(active)

    if (!dialogEl.contains(active) || active === dialogEl || !activeIsFocusable) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return
    if (!selectedItem) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleDialogKeydown)

    tick().then(() => {
      if (!selectedItem) return
      const firstFocusable = getDialogFocusable()[0]
      const focusTarget = firstFocusable ?? dialogEl
      focusTarget?.focus()
    })

    return () => {
      document.removeEventListener('keydown', handleDialogKeydown)
      document.body.style.overflow = previousOverflow
    }
  })
</script>

<svelte:head>
  <title>{category?.titulo ?? 'FAQ'} - fIAq</title>
  <meta
    name="description"
    content={`Perguntas frequentes sobre ${category?.titulo ?? 'o curso'} no CIC/UnB.`}
  />
</svelte:head>

<div class="flex-1">
  <section class="bg-[#1a2e5a] px-6 pb-10 pt-8 sm:px-10">
    <a href="/" class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-200 transition-colors hover:text-green-400">
      <FiaqIcon name="i-lucide-arrow-left" class="h-4 w-4" />
      Voltar para o início
    </a>

    <div class="mx-auto max-w-3xl text-center">
      <h1 class="text-3xl font-extrabold text-white sm:text-4xl">
        {category?.titulo ?? 'Categoria'}
      </h1>
      {#if category}
        <p class="mt-2 text-sm text-blue-200">
          {category.count} {category.count === 1 ? 'pergunta' : 'perguntas'} frequentes
        </p>

        <div class="relative mt-5">
          <FiaqIcon name="i-lucide-search" class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#00a155]" />
          <Input
            bind:value={searchQuery}
            type="search"
            name="faq-search"
            autocomplete="off"
            aria-label="Buscar pergunta nesta categoria"
            placeholder="Buscar pergunta..."
            class="w-full rounded-xl border border-[#00a155]/80 bg-white py-3 pl-10 pr-4 text-base text-[#1a2e5a] shadow-[0_16px_34px_rgba(4,12,30,0.18)] outline-none transition-colors placeholder:text-slate-500 focus:border-[#00a155] focus-visible:ring-2 focus-visible:ring-[#00a155]/30"
          />
        </div>
      {/if}
    </div>
  </section>

  <section class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
    {#if faqQuery.error}
      <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        Não foi possível carregar o FAQ agora. Tente atualizar a página em alguns instantes.
      </div>
    {:else if !faqQuery.isLoading && !category}
      <div class="py-16 text-center">
        <p class="text-lg font-bold text-[#1a2e5a]">Categoria não encontrada.</p>
        <a href="/" class="mt-2 inline-block text-sm text-green-700 hover:underline">Ver todas as categorias</a>
      </div>
    {:else if category && filteredItems.length === 0}
      <div class="py-16 text-center">
        <p class="text-lg font-bold text-[#1a2e5a]">Nenhuma pergunta encontrada.</p>
        <p class="mt-1 text-sm text-gray-500">Tente buscar por outro termo.</p>
      </div>
    {:else}
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        {#if faqQuery.isLoading}
          {#each skeletonQuestions as skeletonId (skeletonId)}
            <div class="h-32 animate-pulse rounded-2xl border-2 border-gray-200 bg-white shadow-sm" aria-hidden="true"></div>
          {/each}
        {/if}

        {#each filteredItems as item (item.id)}
          <article class="group overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#1a2e5a]/45 hover:shadow-md">
            <Button
              variant="ghost"
              class="grid h-auto w-full grid-cols-[2.5rem_1fr] items-start gap-x-3 gap-y-2 whitespace-normal bg-white px-4 py-3.5 text-left shadow-none transition-colors hover:bg-blue-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
              aria-haspopup="dialog"
              aria-label={`Abrir resposta: ${item.titulo}`}
              onclick={(event) => openItem(item.id, event)}
            >
              <span class="row-span-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1a2e5a] ring-1 ring-blue-100 transition-colors group-hover:bg-[#1a2e5a] group-hover:text-white">
                <FiaqIcon name="i-lucide-book-open" class="h-5 w-5" />
              </span>

              <span class="min-w-0">
                <span class="block break-words text-sm font-black leading-snug text-[#1a2e5a]">{item.titulo}</span>
                {#if item.url}
                  <span class="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                    <FiaqIcon name="i-lucide-link" class="h-3 w-3 shrink-0 text-[#00a155]" />
                    <span class="truncate">{sourceHost(item.url)}</span>
                  </span>
                {/if}
              </span>

              <span class="faq-preview text-xs font-semibold leading-relaxed text-slate-500">
                {previewText(item.conteudo)}
              </span>
            </Button>
          </article>
        {/each}
      </div>
    {/if}

    <div class="mt-8 text-center">
      <p class="mb-3 text-sm text-gray-500">Não encontrou o que procurava?</p>
      <a href="/chatbot" class="inline-flex min-h-14 items-center gap-3 rounded-2xl bg-[#1a2e5a] py-2 pl-2 pr-5 text-sm font-bold text-white shadow-md transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-[#243d75] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
        <span class="flex h-12 w-14 shrink-0 items-center justify-center overflow-visible">
          <img src="/sarueBot.png" alt="" width="70" height="48" class="h-12 w-16 object-contain" />
        </span>
        <span>Perguntar ao Assistente Virtual</span>
      </a>
    </div>
  </section>

  {#if selectedItem}
    <button
      type="button"
      class="fixed inset-0 z-[90] cursor-default border-0 bg-slate-950/50 p-0 backdrop-blur-sm"
      aria-label="Fechar resposta"
      tabindex="-1"
      onclick={closeItem}
    ></button>

    <div
      bind:this={dialogEl}
      class="fixed inset-x-0 bottom-0 z-[100] max-h-[88dvh] overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-2xl outline-none sm:inset-x-1/2 sm:bottom-auto sm:top-1/2 sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`faq-dialog-title-${selectedItem.id}`}
      tabindex="-1"
    >
      <header class="border-b border-slate-200 bg-[#f8fbff] px-5 py-4 sm:px-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex min-w-0 items-start gap-3">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1a2e5a] ring-1 ring-blue-100">
              <FiaqIcon name="i-lucide-book-open" class="h-5 w-5" />
            </span>
            <div class="min-w-0">
              <p class="text-xs font-black uppercase tracking-wide text-[#00a155]">{category?.titulo ?? 'FAQ'}</p>
              <h2 id={`faq-dialog-title-${selectedItem.id}`} class="mt-1 break-words text-lg font-black leading-snug text-[#1a2e5a]">
                {selectedItem.titulo}
              </h2>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            aria-label="Fechar resposta"
            title="Fechar resposta"
            class="h-10 w-10 shrink-0 rounded-xl border-slate-200 bg-white p-0 text-[#1a2e5a] shadow-sm hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            onclick={closeItem}
          >
            <FiaqIcon name="i-lucide-x" class="h-5 w-5" />
          </Button>
        </div>
      </header>

      <div class="max-h-[calc(88dvh-6rem)] overflow-y-auto px-5 py-5 sm:px-6">
        <div class="rounded-xl border-2 border-slate-200 bg-white p-4">
          <div class="fiaq-prose text-sm leading-relaxed text-gray-700 sm:text-base">{@html renderMarkdown(selectedItem.conteudo)}</div>
        </div>

        {#if selectedItem.url}
          <div class="mt-4">
            <SourceChip source={{ id: selectedItem.id, titulo: 'Fonte oficial', url: selectedItem.url, kind: 'rag' }} />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .fiaq-prose :global(p) { margin: 0 0 0.6rem; }
  .fiaq-prose :global(p:last-child) { margin-bottom: 0; }
  .fiaq-prose :global(a) { color: #2563eb; text-decoration: underline; word-break: break-word; }
  .fiaq-prose :global(ul),
  .fiaq-prose :global(ol) { margin: 0.35rem 0 0.6rem; padding-left: 1.25rem; }
  .fiaq-prose :global(ul) { list-style: disc; }
  .fiaq-prose :global(ol) { list-style: decimal; }
  .fiaq-prose :global(li) { margin: 0.2rem 0; }
  .fiaq-prose :global(strong) { font-weight: 700; }
  .faq-preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .fiaq-prose :global(h1),
  .fiaq-prose :global(h2),
  .fiaq-prose :global(h3) {
    font-weight: 700;
    margin: 0.6rem 0 0.3rem;
    color: #1a2e5a;
  }
</style>
