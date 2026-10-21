<script lang="ts">
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Input from '$lib/components/ui/input.svelte'
  import dados from '../../../data/professores.json'

  interface Professor {
    nome: string
    slug: string
    email: string
    telefone: string
    foto: string
    perfil: string
  }

  const professores: Professor[] = dados.professores
  const coletadoEm = new Date(`${dados.coletadoEm}T12:00:00`).toLocaleDateString('pt-BR')

  let busca = $state('')

  const filtrados = $derived.by(() => {
    const termo = normalizar(busca.trim())
    if (!termo) return professores
    return professores.filter(p => normalizar(`${p.nome} ${p.email}`).includes(termo))
  })

  function normalizar(texto: string): string {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  }

  function telefoneHref(telefone: string): string {
    return `tel:${telefone.replace(/[^\d+]/g, '')}`
  }
</script>

<svelte:head>
  <title>Professores - fIAq</title>
  <meta
    name="description"
    content="Professores do Departamento de Ciência da Computação da UnB, com e-mail e telefone para contato."
  />
</svelte:head>

<div class="flex-1">
  <section class="bg-[#1a2e5a] px-6 pb-10 pt-8 sm:px-10">
    <a href="/" class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-200 transition-colors hover:text-green-400">
      <FiaqIcon name="i-lucide-arrow-left" class="h-4 w-4" />
      Voltar para o início
    </a>

    <div class="mx-auto max-w-3xl text-center">
      <h1 class="text-3xl font-extrabold text-white sm:text-4xl">Professores</h1>
      <p class="mt-2 text-sm text-blue-200">
        {professores.length} professores do Departamento de Ciência da Computação
      </p>

      <div class="relative mt-5">
        <FiaqIcon name="i-lucide-search" class="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#00a155]" />
        <Input
          bind:value={busca}
          type="search"
          name="professor-busca"
          autocomplete="off"
          aria-label="Buscar professor por nome ou e-mail"
          placeholder="Buscar professor..."
          class="w-full rounded-xl border border-[#00a155]/80 bg-white py-3 pl-10 pr-4 text-base text-[#1a2e5a] shadow-[0_16px_34px_rgba(4,12,30,0.18)] outline-none transition-colors placeholder:text-slate-500 focus:border-[#00a155] focus-visible:ring-2 focus-visible:ring-[#00a155]/30"
        />
      </div>
    </div>
  </section>

  <section class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
    {#if filtrados.length === 0}
      <div class="py-16 text-center">
        <p class="text-lg font-bold text-[#1a2e5a]">Nenhum professor encontrado.</p>
        <p class="mt-1 text-sm text-gray-500">Tente buscar por outro nome.</p>
      </div>
    {:else}
      <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each filtrados as professor (professor.slug)}
          <li class="flex items-center gap-4 rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 shadow-sm transition-[border-color,box-shadow] hover:border-[#1a2e5a]/45 hover:shadow-md">
            <img
              src={professor.foto}
              alt={`Foto de ${professor.nome}`}
              width="64"
              height="64"
              loading="lazy"
              class="h-16 w-16 shrink-0 rounded-xl bg-slate-100 object-cover ring-1 ring-slate-200"
            />
            <div class="min-w-0">
              <p class="text-sm font-black leading-snug text-[#1a2e5a]">{professor.nome}</p>
              <a
                href={`mailto:${professor.email}`}
                class="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[#00a155] hover:underline"
              >
                <FiaqIcon name="i-lucide-mail" class="h-3.5 w-3.5 shrink-0" />
                <span class="truncate">{professor.email}</span>
              </a>
              {#if professor.telefone}
                <a
                  href={telefoneHref(professor.telefone)}
                  class="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#1a2e5a]"
                >
                  <FiaqIcon name="i-lucide-phone" class="h-3.5 w-3.5 shrink-0" />
                  {professor.telefone}
                </a>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="mt-6 text-center text-xs text-gray-400">
      Fonte: <a href={dados.fonte} target="_blank" rel="noopener noreferrer" class="underline hover:text-[#1a2e5a]">página de professores do CIC</a>, atualizada em {coletadoEm}.
    </p>
  </section>
</div>
