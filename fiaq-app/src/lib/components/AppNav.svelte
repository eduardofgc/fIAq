<script lang="ts">
  import { page } from '$app/state'
  import Button from '$lib/components/ui/button.svelte'
  import FiaqBrand from '$lib/components/FiaqBrand.svelte'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import { openDepartmentsSidebar } from '$lib/stores/departments-sidebar'
  import { cn } from '$lib/utils'
  const pathname = $derived(page.url.pathname as string)
  const homeActive = $derived(pathname === '/')
  const assistantActive = $derived(pathname === '/chatbot' || pathname.startsWith('/chatbot/'))
  const contactsActive = $derived(pathname === '/contatos' || pathname.startsWith('/contatos/'))
  const aboutActive = $derived(pathname === '/sobre' || pathname.startsWith('/sobre/'))
  function navItemClass(active: boolean) {
    return cn(
      'inline-flex h-8 min-h-8 w-8 items-center justify-center gap-1 rounded-xl border p-0 text-xs font-black leading-none shadow-none transition-[background-color,border-color,color,box-shadow,transform] focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300 sm:h-auto sm:min-h-10 sm:w-auto sm:gap-1.5 sm:px-4 sm:py-1.5 sm:text-sm',
      active
        ? 'border-white bg-white text-[#1a2e5a] shadow-sm shadow-slate-950/20 hover:bg-white hover:text-[#1a2e5a]'
        : 'border-white/20 bg-white/10 text-white/90 hover:-translate-y-0.5 hover:border-[#00e08a]/70 hover:bg-white/20 hover:text-white hover:shadow-sm hover:shadow-slate-950/20'
    )
  }
  function navIconClass(active: boolean) {
    return cn('h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]', active ? 'text-[#00a155]' : 'text-[#7fffc8]')
  }
</script>
<nav class="fiaq-nav sticky top-0 z-50 flex shrink-0 items-center justify-between gap-1 bg-[#1a2e5a] px-2 py-2.5 sm:gap-3 sm:px-10 sm:py-4">
  <div class="sm:hidden">
    <FiaqBrand compact class="shrink-0" />
  </div>
  <div class="hidden sm:block">
    <FiaqBrand class="shrink-0" />
  </div>
  <div class="fiaq-nav-links flex shrink-0 items-center gap-1 text-white sm:gap-2.5">
    <a
      href="/"
      class={navItemClass(homeActive)}
      aria-label="Início"
      aria-current={homeActive ? 'page' : undefined}
    >
      <FiaqIcon name="i-lucide-home" class={navIconClass(homeActive)} />
      <span class="hidden lg:inline">Início</span>
    </a>
    <a
      href="/chatbot"
      class={navItemClass(assistantActive)}
      aria-label="Assistente"
      aria-current={assistantActive ? 'page' : undefined}
    >
      <FiaqIcon name="i-lucide-message-circle" class={navIconClass(assistantActive) + ' sm:hidden'} />
      <img src="/sarue-avatar.png" alt="" width="20" height="20" class="hidden h-4 w-4 shrink-0 object-contain sm:block sm:h-5 sm:w-5" />
      <span class="hidden lg:inline">Assistente</span>
    </a>
    <Button
      variant="ghost"
      class={cn('m-0 cursor-pointer', navItemClass(contactsActive))}
      aria-label="Contatos"
      aria-current={contactsActive ? 'page' : undefined}
      onclick={openDepartmentsSidebar}
    >
      <FiaqIcon name="i-lucide-phone" class={navIconClass(contactsActive)} />
      <span class="hidden lg:inline">Contatos</span>
    </Button>
    <a
      href="/sobre"
      class={navItemClass(aboutActive)}
      aria-label="Sobre"
      aria-current={aboutActive ? 'page' : undefined}
    >
      <FiaqIcon name="i-lucide-info" class={navIconClass(aboutActive)} />
      <span class="hidden lg:inline">Sobre</span>
    </a>
  </div>
</nav>
