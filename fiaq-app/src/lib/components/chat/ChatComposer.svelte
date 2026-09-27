<script lang="ts">
  import { tick } from 'svelte'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Button from '$lib/components/ui/button.svelte'
  import Textarea from '$lib/components/ui/textarea.svelte'

  interface Props {
    disabled: boolean
    keyboardMode?: boolean
    onSend?: (text: string) => void
    onFocus?: () => void
    onBlur?: () => void
  }

  let { disabled, keyboardMode = false, onSend, onFocus, onBlur }: Props = $props()
  let text = $state('')
  let textareaEl: HTMLTextAreaElement | null = null

  function resize(el = textareaEl) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend?.(trimmed)
    text = ''
    await tick()
    resize()
  }

  function handleInput(event: Event) {
    textareaEl = event.currentTarget as HTMLTextAreaElement
    resize(textareaEl)
  }

  function handleFocus(event: FocusEvent) {
    textareaEl = event.currentTarget as HTMLTextAreaElement
    onFocus?.()
    requestAnimationFrame(() => {
      textareaEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    void handleSend()
  }
</script>

<div class="shrink-0">
  <div
    class={[
      'group flex w-full items-end gap-2 rounded-[1.1rem] border bg-white/95 p-2 ring-1 ring-white/70 transition-[background-color,border-color,box-shadow] focus-within:border-[#00a155] focus-within:ring-4 focus-within:ring-[#00a155]/15 sm:rounded-[1.3rem] sm:p-2',
      keyboardMode
        ? 'border-[#00a155] shadow-[0_8px_28px_rgba(15,23,42,0.16)]'
        : 'border-slate-200 shadow-[0_14px_34px_rgba(15,23,42,0.12)] sm:shadow-[0_16px_44px_rgba(15,23,42,0.12)]'
    ]}
  >
    <span class="mb-2 hidden h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-[#1a2e5a] transition-colors group-focus-within:bg-emerald-50 group-focus-within:text-[#00a155] sm:flex">
      <FiaqIcon name="i-lucide-message-circle" class="h-4.5 w-4.5" />
    </span>
    <Textarea
      bind:value={text}
      rows={1}
      name="chat-question"
      aria-label="Digite sua pergunta para o assistente"
      inputmode="text"
      placeholder="Digite sua pergunta..."
      disabled={disabled}
      enterkeyhint="send"
      autocomplete="off"
      autocapitalize="sentences"
      class="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-base leading-6 text-[#142854] shadow-none outline-none placeholder:text-slate-400 focus-visible:ring-0 disabled:opacity-50 sm:max-h-40 sm:min-h-12 sm:py-2.5 sm:text-base sm:leading-6"
      oninput={handleInput}
      onfocus={handleFocus}
      onblur={onBlur}
      onkeydown={handleKeydown}
    />
    <Button
      type="button"
      disabled={disabled || !text.trim()}
      aria-label="Enviar pergunta"
      title="Enviar pergunta"
      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00a155] text-white shadow-sm transition-[background-color,box-shadow,color,transform] hover:-translate-y-0.5 hover:bg-[#079052] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none sm:h-12 sm:w-12 sm:rounded-2xl"
      onclick={() => void handleSend()}
    >
      <FiaqIcon name="i-lucide-send" class="h-4.5 w-4.5" />
    </Button>
  </div>
</div>
