<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { page } from '$app/state'
  import ChatComposer from '$lib/components/chat/ChatComposer.svelte'
  import ChatConversationActions from '$lib/components/chat/ConversationActions.svelte'
  import ChatWindow from '$lib/components/chat/ChatWindow.svelte'
  import {
    clearMessages,
    destroyChatStore,
    initChatStore,
    loading,
    messages,
    rateMessage,
    replaceMessages,
    sendMessage
  } from '$lib/stores/fiaq-chat'

  let composerShellEl = $state<HTMLElement | null>(null)
  let composerHeight = $state(112)
  let composerFocused = $state(false)
  let composerObserver: ResizeObserver | null = null

  function syncComposerHeight() {
    if (typeof window === 'undefined' || !composerShellEl) return
    composerHeight = Math.ceil(composerShellEl.getBoundingClientRect().height)
  }

  onMount(() => {
    initChatStore()

    const q = page.url.searchParams.get('q')?.trim()
    if (q) {
      void sendMessage(q)
      const nextUrl = new URL(page.url)
      nextUrl.searchParams.delete('q')
      window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}`)
    }

    if (typeof window === 'undefined' || !composerShellEl) return
    syncComposerHeight()
    composerObserver = new ResizeObserver(syncComposerHeight)
    composerObserver.observe(composerShellEl)
  })

  onDestroy(() => {
    composerObserver?.disconnect()
    composerObserver = null
    destroyChatStore()
  })
</script>

<svelte:head>
  <title>Assistente Virtual — fIAq</title>
  <meta
    name="description"
    content="Converse com o assistente virtual do fIAq para tirar dúvidas acadêmicas do CIC/UnB."
  />
</svelte:head>

<div class="flex bg-slate-50" style={`min-height: calc(100dvh - var(--nav-height, 80px)); --chat-composer-height: ${composerHeight}px`}>
  <div class="flex min-h-full w-full flex-col">
    <section
      class="flex min-h-0 flex-1 flex-col bg-slate-50"
      data-composer-focus={composerFocused ? 'true' : undefined}
    >
      <div class={['border-b border-slate-200 bg-white/85 px-3 py-2 backdrop-blur sm:px-6 sm:py-3', composerFocused ? 'hidden sm:block' : '']}>
        <ChatConversationActions
          class="mx-auto w-full max-w-5xl"
          messages={$messages}
          disabled={$loading}
          onImport={replaceMessages}
          onClear={clearMessages}
        />
      </div>

      <ChatWindow
        class="flex-1"
        messages={$messages}
        loading={$loading}
        composerFocused={composerFocused}
        onSuggest={sendMessage}
        onFeedback={rateMessage}
      />

      <div
        bind:this={composerShellEl}
        class="sticky bottom-0 z-30 border-t border-slate-200 bg-gradient-to-t from-white via-white/95 to-white/75 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 backdrop-blur sm:px-6 sm:pb-4 sm:pt-3"
      >
        <div class="mx-auto w-full max-w-5xl">
          <ChatComposer
            disabled={$loading}
            keyboardMode={composerFocused}
            onFocus={() => (composerFocused = true)}
            onBlur={() => (composerFocused = false)}
            onSend={sendMessage}
          />
          <p class="mt-1.5 text-center text-[11px] leading-tight text-slate-400 sm:mt-2 sm:text-xs">
            Ferramenta em Beta: sempre confira informações importantes.
          </p>
        </div>
      </div>
    </section>
  </div>
</div>
