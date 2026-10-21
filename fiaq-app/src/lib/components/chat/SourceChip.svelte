<script lang="ts">
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import type { Source } from '$lib/stores/fiaq-chat'
  import { publicSourceUrl } from '$lib/utils/sourceUrl'

  interface Props {
    source: Source
  }

  let { source }: Props = $props()

  const safeUrl = $derived(publicSourceUrl(source.url))
  const hasUrl = $derived(Boolean(safeUrl))
  const cleanTitle = $derived.by(() => {
    const title = decodeEntities(source.titulo || 'Fonte oficial')
      .replace(/\s+/g, ' ')
      .trim()

    return title || 'Fonte oficial'
  })
  const sourceHost = $derived.by(() => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {
      return 'fonte oficial'
    }
  })

  function decodeEntities(text: string): string {
    return text
      .replace(/&#(\d+);/g, (entity: string, code: string) => decodeCodePoint(entity, Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (entity: string, code: string) => decodeCodePoint(entity, Number.parseInt(code, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  function decodeCodePoint(entity: string, codePoint: number): string {
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return entity
    }

    return String.fromCodePoint(codePoint)
  }
</script>

{#if hasUrl}
  <a
    href={safeUrl}
    target="_blank"
    rel="noopener noreferrer"
    title={`Abrir fonte oficial: ${cleanTitle}`}
    class="group flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[#1a2e5a] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors duration-200 hover:border-[#00a155] hover:bg-emerald-50/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
  >
    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-[#00a155] ring-1 ring-emerald-100">
      <FiaqIcon name={source.kind === 'web' ? 'i-lucide-globe-2' : source.kind === 'link' ? 'i-lucide-link' : 'i-lucide-book-open'} class="h-3.5 w-3.5" />
    </span>

    {#if source.kind === 'web'}
      <span class="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black uppercase text-emerald-700 ring-1 ring-emerald-100">
        web
      </span>
    {/if}

    <span class="min-w-0 flex-1 truncate text-sm font-semibold leading-5">
      {cleanTitle}
    </span>

    <span class="hidden min-w-0 shrink-0 items-center gap-1.5 text-xs font-medium text-slate-500 sm:flex">
      <span class="max-w-40 truncate">{sourceHost}</span>
      <FiaqIcon name="i-lucide-external-link" class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-[#1a2e5a]" />
    </span>
  </a>
{:else}
  <div class="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[#1a2e5a] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[#1a2e5a]">
      <FiaqIcon name="i-lucide-book-open" class="h-3.5 w-3.5" />
    </span>
    <span class="min-w-0 flex-1 truncate text-sm font-semibold leading-5">
      {cleanTitle}
    </span>
    <span class="hidden shrink-0 text-xs font-medium text-slate-400 sm:inline">fonte sem link</span>
  </div>
{/if}
