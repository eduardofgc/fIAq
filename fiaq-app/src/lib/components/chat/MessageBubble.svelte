<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Button from '$lib/components/ui/button.svelte'
  import ResearchActivity from '$lib/components/chat/ResearchActivity.svelte'
  import SourceChip from '$lib/components/chat/SourceChip.svelte'
  import type { Message } from '$lib/stores/fiaq-chat'
  import { cleanAssistantText } from '$lib/utils/assistantText'
  import { renderMarkdown } from '$lib/utils/markdown'
  import {
    exportConversation,
    type ConversationExportFormat
  } from '$lib/utils/conversationExport'

  interface Props {
    message: Message
    allMessages: Message[]
    feedbackDisabled?: boolean
    onFeedback?: (messageId: number, rating: 'helpful' | 'unhelpful') => void
  }

  let { message, allMessages, feedbackDisabled = false, onFeedback }: Props = $props()

  let copyStatus = $state<'idle' | 'copied' | 'error'>('idle')
  let actionStatus = $state('')
  let actionStatusKind = $state<'info' | 'error'>('info')
  let exportBusy = $state(false)
  let showSources = $state(false)
  let showExportMenu = $state(false)
  let showFeedbackMenu = $state(false)
  let actionsEl = $state<HTMLElement | null>(null)
  let copyResetTimeout: number | null = null

  const cleanContent = $derived(cleanAssistantText(message.content ?? ''))
  const hasRenderableContent = $derived(cleanContent.length > 0)
  const hasAssistantArtifacts = $derived(Boolean(message.sources?.length || message.activity?.length))
  const showBody = $derived(message.role === 'assistant' && (hasRenderableContent || hasAssistantArtifacts || message.streaming))
  const showActions = $derived(!message.streaming && (hasRenderableContent || hasAssistantArtifacts))
  const renderedContent = $derived(renderMarkdown(cleanContent))
  const hasWebSources = $derived(message.sources?.some(source => source.kind === 'web' || source.kind === 'official') ?? false)
  const sourceCount = $derived(message.sources?.length ?? 0)
  const sourceCountLabel = $derived(`${sourceCount} ${sourceCount === 1 ? 'fonte' : 'fontes'}`)

  const feedbackLabel = $derived.by(() => {
    if (message.feedback === 'helpful') return 'Ajudou'
    if (message.feedback === 'unhelpful') return 'Não ajudou'
    return 'Avaliar'
  })

  const feedbackIcon = $derived.by(() => {
    if (message.feedback === 'helpful') return 'i-lucide-thumbs-up'
    if (message.feedback === 'unhelpful') return 'i-lucide-thumbs-down'
    return 'i-lucide-star'
  })

  const feedbackButtonClass = $derived.by(() => {
    if (message.feedback === 'helpful') return 'border-emerald-200 text-emerald-700'
    if (message.feedback === 'unhelpful') return 'border-amber-200 text-amber-700'
    return 'border-slate-200 text-slate-600 hover:border-[#1a2e5a] hover:text-[#1a2e5a]'
  })

  const feedbackStatus = $derived.by(() => {
    if (message.feedback === 'helpful' && hasWebSources) return 'Obrigado. Resposta enviada para curadoria.'
    if (message.feedback === 'helpful') return 'Obrigado pelo feedback.'
    if (message.feedback === 'unhelpful') return 'Resposta complementar solicitada.'
    return ''
  })

  const copyTitle = $derived(copyStatus === 'copied' ? 'Copiado' : copyStatus === 'error' ? 'Não foi possível copiar' : 'Copiar mensagem')
  const copyIcon = $derived(copyStatus === 'copied' ? 'i-lucide-check' : copyStatus === 'error' ? 'i-lucide-circle-alert' : 'i-lucide-copy')
  const copyLabel = $derived(copyStatus === 'copied' ? 'Copiado' : copyStatus === 'error' ? 'Erro' : 'Copiar')

  const exportOptions: Array<{
    format: ConversationExportFormat
    label: string
    icon: string
  }> = [
    { format: 'pdf', label: 'PDF', icon: 'i-lucide-file-down' },
    { format: 'xls', label: 'Excel', icon: 'i-lucide-table' },
    { format: 'md', label: 'Markdown', icon: 'i-lucide-file-code' },
    { format: 'json', label: 'JSON', icon: 'i-lucide-file-json' },
    { format: 'txt', label: 'Texto', icon: 'i-lucide-file-text' }
  ]

  const plainCopy = $derived(cleanContent)
  const exportMessages = $derived.by<Message[]>(() => {
    const currentIndex = allMessages.findIndex(item => item.id === message.id)
    if (currentIndex < 0) return [message]

    const previousQuestion = allMessages
      .slice(0, currentIndex)
      .reverse()
      .find(item => item.role === 'user')

    return previousQuestion ? [previousQuestion, message] : [message]
  })

  $effect(() => {
    if (!showExportMenu && !showFeedbackMenu) return
    document.addEventListener('click', handleDocumentClick)
    return () => document.removeEventListener('click', handleDocumentClick)
  })

  function clearCopyResetTimeout() {
    if (copyResetTimeout === null) return
    window.clearTimeout(copyResetTimeout)
    copyResetTimeout = null
  }

  function scheduleCopyReset() {
    clearCopyResetTimeout()
    copyResetTimeout = window.setTimeout(() => {
      copyStatus = 'idle'
      actionStatus = ''
      copyResetTimeout = null
    }, 1600)
  }

  function fallbackCopy(text: string): boolean {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()

    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      textarea.remove()
    }
  }

  async function copyMessage() {
    const text = plainCopy
    if (!text) return

    clearCopyResetTimeout()

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else if (!fallbackCopy(text)) {
        throw new Error('COPY_FAILED')
      }
      copyStatus = 'copied'
      actionStatus = 'Copiado.'
      actionStatusKind = 'info'
      scheduleCopyReset()
    } catch {
      copyStatus = fallbackCopy(text) ? 'copied' : 'error'
      actionStatus = copyStatus === 'copied' ? 'Copiado.' : 'Não foi possível copiar.'
      actionStatusKind = copyStatus === 'copied' ? 'info' : 'error'
      scheduleCopyReset()
    }
  }

  async function handleExport(format: ConversationExportFormat) {
    if (exportBusy) return

    showExportMenu = false
    actionStatus = ''
    exportBusy = true

    try {
      await exportConversation(exportMessages, format)
      actionStatus = 'Baixado.'
      actionStatusKind = 'info'
    } catch {
      actionStatus = 'Não foi possível baixar.'
      actionStatusKind = 'error'
    } finally {
      exportBusy = false
    }
  }

  function handleFeedback(rating: 'helpful' | 'unhelpful') {
    if (feedbackDisabled || message.feedback === rating) {
      showFeedbackMenu = false
      return
    }

    actionStatus = ''
    showFeedbackMenu = false
    onFeedback?.(message.id, rating)
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Node) || actionsEl?.contains(target)) return
    showExportMenu = false
    showFeedbackMenu = false
  }

  function revealActionMenu(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return
    const wrapper = target.closest('[data-action-menu]')
    if (!(wrapper instanceof HTMLElement)) return

    tick().then(() => {
      wrapper.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  onDestroy(() => {
    if (typeof document === 'undefined') return
    document.removeEventListener('click', handleDocumentClick)
    clearCopyResetTimeout()
  })
</script>

{#if message.role === 'user'}
  <div class="flex justify-end">
    <div class="max-w-[92%] rounded-[1.05rem] rounded-br-sm bg-[#1a2e5a] px-4 py-3 text-[0.875rem] leading-[1.55] text-white shadow-[0_12px_28px_rgba(26,46,90,0.18)] sm:max-w-[72%] sm:rounded-[1.25rem] sm:rounded-br-md sm:px-5 sm:py-3.5 sm:text-base sm:leading-relaxed">
      {message.content}
    </div>
  </div>
{:else if showBody}
  <div class="flex justify-start sm:gap-3.5">
    <div class="mt-1 hidden h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:flex">
      <img src="/content.png" alt="Assistente" width="36" height="36" class="h-9 w-9 object-contain" />
    </div>

    <div class="flex w-full min-w-0 max-w-none flex-col gap-2.5 sm:max-w-[min(58rem,92vw)]">
      <div class="rounded-[1.05rem] rounded-bl-sm border border-slate-200/90 bg-white px-4 py-4 text-[0.9rem] leading-[1.56] text-[#142854] shadow-[0_10px_24px_rgba(15,23,42,0.08)] sm:rounded-[1.35rem] sm:rounded-bl-md sm:px-6 sm:py-5 sm:text-base sm:leading-8">
        <div class="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2 sm:hidden">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200">
            <img src="/content.png" alt="" width="28" height="28" class="h-7 w-7 object-contain" />
          </span>
          <span class="text-xs font-extrabold text-[#1a2e5a]">Saruê</span>
        </div>
        {#if message.streaming && message.activity?.length}
          <ResearchActivity activities={message.activity} compact />
        {/if}
        {#if hasRenderableContent}
          <div class="fiaq-prose">{@html renderedContent}</div>
        {/if}
        {#if message.streaming}
          <span class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[#1a2e5a] align-middle"></span>
        {/if}
      </div>

      {#if message.sources && message.sources.length > 0}
        <div class="px-1">
          <Button
            type="button"
            variant="outline"
            aria-expanded={showSources}
            aria-controls={`sources-${message.id}`}
            class="inline-flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-600 shadow-sm transition-colors hover:border-[#1a2e5a] hover:bg-blue-50/60 hover:text-[#1a2e5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 sm:w-auto sm:min-w-64"
            onclick={() => {
              showSources = !showSources
            }}
          >
            <span class="flex min-w-0 items-center gap-2">
              <FiaqIcon name="i-lucide-list-checks" class="h-4 w-4 shrink-0 text-[#00a155]" />
              <span>Fontes verificadas</span>
            </span>
            <span class="flex shrink-0 items-center gap-2 text-[11px] normal-case tracking-normal text-slate-500">
              {sourceCountLabel}
              <FiaqIcon name="i-lucide-chevron-down" class={`h-3.5 w-3.5 transition-transform ${showSources ? 'rotate-180' : ''}`} />
            </span>
          </Button>

          {#if showSources}
            <div id={`sources-${message.id}`} class="mt-2 grid gap-1.5 rounded-xl border border-slate-200 bg-white/80 p-2 shadow-sm">
              {#each message.sources as source (source.id)}
                <SourceChip {source} />
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if showActions}
        <div bind:this={actionsEl} class="px-1 pt-1.5" data-action-menu>
          <div class="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              title={copyTitle}
              class={`inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-2.5 text-xs font-semibold shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 sm:px-3 ${
                copyStatus === 'error'
                  ? 'border-red-200 text-red-600 hover:border-red-300'
                  : 'border-slate-200 text-slate-600 hover:border-[#1a2e5a] hover:text-[#1a2e5a]'
              }`}
              onclick={copyMessage}
            >
              <FiaqIcon name={copyIcon} class="h-4 w-4" />
              {copyLabel}
            </Button>

            <Button
              type="button"
              disabled={exportBusy}
              variant="outline"
              aria-expanded={showExportMenu}
              aria-haspopup="menu"
              title="Baixar conversa"
              class={`inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-2.5 text-xs font-semibold shadow-sm transition-colors hover:border-[#1a2e5a] hover:bg-blue-50/60 hover:text-[#1a2e5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${
                showExportMenu ? 'border-[#1a2e5a] text-[#1a2e5a]' : 'border-slate-200 text-slate-600'
              }`}
              onclick={(event) => {
                event.stopPropagation()
                showFeedbackMenu = false
                showExportMenu = !showExportMenu
                if (showExportMenu) revealActionMenu(event.currentTarget)
              }}
            >
              <FiaqIcon name="i-lucide-download" class="h-4 w-4" />
              Baixar
              <FiaqIcon name="i-lucide-chevron-down" class="h-3 w-3" />
            </Button>

            <Button
              type="button"
              disabled={feedbackDisabled}
              variant="outline"
              aria-expanded={showFeedbackMenu}
              aria-haspopup="menu"
              title="Avaliar resposta"
              class={`inline-flex h-9 items-center gap-1.5 rounded-xl border bg-white px-2.5 text-xs font-semibold shadow-sm transition-colors hover:bg-blue-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${showFeedbackMenu ? 'border-[#1a2e5a] text-[#1a2e5a]' : feedbackButtonClass}`}
              onclick={(event) => {
                event.stopPropagation()
                showExportMenu = false
                showFeedbackMenu = !showFeedbackMenu
                if (showFeedbackMenu) revealActionMenu(event.currentTarget)
              }}
            >
              <FiaqIcon name={feedbackIcon} class="h-4 w-4" />
              {feedbackLabel}
              <FiaqIcon name="i-lucide-chevron-down" class="h-3 w-3" />
            </Button>

            {#if actionStatus || feedbackStatus}
              <span
                role="status"
                aria-live="polite"
                class={[
                  'text-xs font-medium',
                  actionStatus && actionStatusKind === 'error' ? 'text-red-600' : 'text-slate-500'
                ]}
              >
                {actionStatus || feedbackStatus}
              </span>
            {/if}
          </div>

          {#if showExportMenu}
            <div role="menu" class="mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5">
              {#each exportOptions as option (option.format)}
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  class="flex h-auto w-full justify-start gap-2 rounded-lg bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-700 shadow-none transition-colors hover:bg-blue-50 hover:text-[#1a2e5a] focus:bg-blue-50 focus:outline-none"
                  onclick={() => void handleExport(option.format)}
                >
                  <FiaqIcon name={option.icon} class="h-4 w-4" />
                  {option.label}
                </Button>
              {/each}
            </div>
          {/if}

          {#if showFeedbackMenu}
            <div role="menu" class="mt-2 w-52 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-slate-900/5">
              <Button
                type="button"
                variant="ghost"
                role="menuitem"
                class="flex h-auto w-full justify-start gap-2 rounded-lg bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-700 shadow-none transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus:bg-emerald-50 focus:outline-none"
                onclick={() => handleFeedback('helpful')}
              >
                <FiaqIcon name="i-lucide-thumbs-up" class="h-4 w-4" />
                Essa resposta me ajudou
              </Button>
              <Button
                type="button"
                variant="ghost"
                role="menuitem"
                class="flex h-auto w-full justify-start gap-2 rounded-lg bg-white px-3 py-2.5 text-left text-xs font-semibold text-slate-700 shadow-none transition-colors hover:bg-amber-50 hover:text-amber-700 focus:bg-amber-50 focus:outline-none"
                onclick={() => handleFeedback('unhelpful')}
              >
                <FiaqIcon name="i-lucide-thumbs-down" class="h-4 w-4" />
                Não me ajudou
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .fiaq-prose {
    overflow-wrap: break-word;
    hyphens: none;
    word-break: normal;
  }
  .fiaq-prose :global(p) { margin: 0 0 0.6rem; }
  .fiaq-prose :global(p:last-child) { margin-bottom: 0; }
  .fiaq-prose :global(a) { color: #2563eb; text-decoration: underline; word-break: break-word; }
  .fiaq-prose :global(ul),
  .fiaq-prose :global(ol) { margin: 0.35rem 0 0.65rem; padding-left: 1.15rem; }
  .fiaq-prose :global(ul) { list-style: disc; }
  .fiaq-prose :global(ol) { list-style: decimal; }
  .fiaq-prose :global(li) { margin: 0.25rem 0; padding-left: 0.1rem; }
  .fiaq-prose :global(strong) { font-weight: 700; }
  .fiaq-prose :global(code) {
    background: #f1f5f9;
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.85em;
  }
  .fiaq-prose :global(blockquote) {
    border-left: 3px solid #cbd5e1;
    padding-left: 0.75rem;
    margin: 0.25rem 0;
    color: #475569;
  }
  .fiaq-prose :global(h1),
  .fiaq-prose :global(h2),
  .fiaq-prose :global(h3) {
    font-weight: 700;
    margin: 0.4rem 0 0.25rem;
  }

  @media (min-width: 640px) {
    .fiaq-prose :global(p) { margin-bottom: 0.5rem; }
    .fiaq-prose :global(ul),
    .fiaq-prose :global(ol) { margin: 0.25rem 0 0.5rem; padding-left: 1.25rem; }
    .fiaq-prose :global(li) { margin: 0.15rem 0; padding-left: 0; }
  }
</style>
