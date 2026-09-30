<script lang="ts">
  import { page } from '$app/state'
  import FiaqBrand from '$lib/components/FiaqBrand.svelte'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import { findDepartamento } from '$lib/data/departamentos'

  const slug = $derived(page.params.slug ?? '')
  const departamento = $derived(findDepartamento(slug))
</script>

<svelte:head>
  <title>Contatos - {departamento?.nome ?? 'Departamento não encontrado'} - fIAq</title>
  <meta name="description" content={departamento?.descricao ?? 'Departamento não encontrado.'} />
</svelte:head>

<div class="flex-1 bg-white">
  <section class="bg-[#1a2e5a] px-6 pb-12 pt-8 sm:px-10">
    <a href="/" class="inline-flex items-center gap-1.5 text-sm font-medium text-blue-200 transition-colors hover:text-green-400">
      <FiaqIcon name="i-lucide-arrow-left" class="h-4 w-4" />
      Voltar para o início
    </a>

    <div class="mx-auto mt-4 max-w-3xl text-center">
      {#if departamento}
        <FiaqBrand
          link={false}
          compact
          size="sm"
          class="mb-3 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 shadow-sm ring-1 ring-green-400/20"
        />
        <h1 class="text-3xl font-extrabold text-white sm:text-4xl">Contatos do {departamento.sigla}</h1>

        <p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-blue-200 sm:text-base">
          {departamento.descricao}
        </p>
      {:else}
        <h1 class="text-3xl font-extrabold text-white sm:text-4xl">Departamento não encontrado</h1>

        <p class="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-blue-200 sm:text-base">
          Verifique o endereço acessado ou volte para a página inicial.
        </p>
      {/if}
    </div>
  </section>

  <section class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    {#if !departamento}
      <div class="py-16 text-center">
        <p class="text-lg font-bold text-[#1a2e5a]">Departamento não encontrado.</p>
        <a href="/" class="mt-2 inline-block text-sm text-[#1a2e5a] hover:underline">Voltar para o início</a>
      </div>
    {:else}
      <div class="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex flex-col gap-4 bg-[#1a2e5a] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div class="flex items-start gap-3.5">
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-green-400/15 text-green-300 ring-1 ring-green-400/20">
              <FiaqIcon name="i-lucide-map-pin" class="h-5 w-5" />
            </span>
            <div>
              <p class="mb-1 text-sm font-black uppercase tracking-wide text-green-300">Endereço</p>
              <p class="text-base font-bold text-white">Prédio CIC/EST</p>
              <p class="mt-1 text-sm leading-relaxed text-blue-100">{departamento.endereco}</p>
            </div>
          </div>
          <a
            href={`https://maps.google.com/?q=${encodeURIComponent(departamento.endereco)}`}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-bold text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
          >
            <FiaqIcon name="i-lucide-map-pin" class="h-5 w-5" />
            Abrir rota
          </a>
        </div>

        {#if departamento.mapsUrl}
          <iframe
            src={departamento.mapsUrl}
            class="h-[22rem] w-full border-0 sm:h-[26rem] lg:h-[30rem]"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            title={`Mapa de ${departamento.nome}`}
          ></iframe>
        {/if}
      </div>

      <div class="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-black uppercase tracking-wide text-[#00a155]">Atendimento</p>
          <h2 class="text-xl font-black text-[#1a2e5a]">Contatos principais</h2>
        </div>
        <p class="text-sm font-medium text-slate-500">Canais e horários mais usados pela comunidade acadêmica.</p>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {#each departamento.cards as card (card.nome)}
          <article class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="flex min-h-28 items-center gap-3 bg-[#1a2e5a] px-5 py-4">
              <span class="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-green-400/40 bg-green-400/20 text-green-300">
                <FiaqIcon name={card.icon} class="h-[18px] w-[18px]" />
              </span>
              <div class="min-w-0">
                <p class="text-base font-black leading-snug text-white">{card.nome}</p>
                <p class="mt-0.5 text-xs text-blue-100">{card.local}</p>
              </div>
            </div>

            <div class="px-5 py-4 sm:min-h-72">
              {#each card.itens as item, idx (item.label)}
                <div class={['flex items-start gap-3 py-3 text-sm', idx < card.itens.length - 1 ? 'border-b border-slate-100' : '']}>
                  <span class="mt-px flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#1a2e5a]">
                    <FiaqIcon name={item.icon} class="h-[15px] w-[15px]" />
                  </span>
                  <div class="min-w-0">
                    <p class="text-xs font-bold leading-none text-slate-400">{item.label}</p>
                    {#if item.href}
                      <a
                        href={item.href}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noopener noreferrer' : undefined}
                        class="mt-1 block break-words text-sm font-semibold leading-relaxed text-blue-700 hover:underline"
                      >
                        {item.value}
                      </a>
                    {:else}
                      <span class="mt-1 block break-words text-sm font-semibold leading-relaxed text-slate-800">{item.value}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
