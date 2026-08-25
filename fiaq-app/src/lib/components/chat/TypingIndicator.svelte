<script lang="ts">
  import ResearchActivity from '$lib/components/chat/ResearchActivity.svelte'
  import type { Message } from '$lib/stores/fiaq-chat'
  interface Props {
    message?: Message
  }
  let { message }: Props = $props()
</script>
<div class="flex justify-start gap-3" role="status" aria-live="polite">
  <div class="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <img
      src="/content.png"
      alt=""
      width="48"
      height="48"
      class="h-12 w-12 object-contain"
    />
  </div>
  <span class="sr-only">Saruê verificando fontes para preparar a resposta.</span>
  <ResearchActivity activities={message?.activity} />
</div>
