<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { createQuery } from '@tanstack/svelte-query'
  import { createColumnHelper, createTable, getCoreRowModel } from '@tanstack/table-core'
  import FiaqIcon from '$lib/components/FiaqIcon.svelte'
  import Button from '$lib/components/ui/button.svelte'
  import Input from '$lib/components/ui/input.svelte'
  import Textarea from '$lib/components/ui/textarea.svelte'
  import { getPublicConfig } from '$lib/config/public'
  import {
    clearAdminSession,
    loadAdminSession,
    readInviteSessionFromHash,
    refreshAdminSession,
    saveAdminSession,
    signInAdmin,
    signOutAdmin,
    updateAdminPassword,
    type AdminSession
  } from '$lib/utils/supabaseAuth'
  import {
    subscribeAdminCurationRealtime,
    type AdminCurationRealtimePayload,
    type AdminCurationRealtimeRecord,
    type AdminCurationRealtimeStatus,
    type AdminCurationRealtimeSubscription
  } from '$lib/utils/supabaseRealtime'
  import { apiFetch } from '$lib/utils/api'

  type CandidateStatus = 'pendente' | 'aprovada' | 'rejeitada'
  type CandidateFilter = CandidateStatus | 'todas'
  type ReviewAction = 'approve' | 'reject'

  interface Candidate {
    id: number
    pergunta: string
    resposta: string
    fontes_usadas: unknown[]
    motivo_busca_web: 'fallback_automatico' | 'feedback_negativo'
    status: CandidateStatus
    dthr_criacao?: string
    dthr_atualizacao?: string
  }

  interface CandidateResponse {
    items: Candidate[]
    totals: Record<CandidateStatus, number>
  }

  interface AdminFetchOptions {
    method?: 'GET' | 'POST' | 'PATCH'
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }

  const publicConfig = getPublicConfig()
  const authConfigured = Boolean(publicConfig.supabaseUrl && publicConfig.supabaseAnonKey)
  const columnHelper = createColumnHelper<Candidate>()
  const columns = [
    columnHelper.accessor('id', { header: 'ID' }),
    columnHelper.accessor('pergunta', { header: 'Pergunta' }),
    columnHelper.accessor('status', { header: 'Status' })
  ]

  let session = $state<AdminSession | null>(null)
  let inviteSession = $state<AdminSession | null>(null)
  let authorized = $state(false)
  let busy = $state(false)
  let notice = $state('')
  let email = $state('')
  let password = $state('')
  let newPassword = $state('')
  let showPassword = $state(false)
  let showNewPassword = $state(false)
  let inviteEmail = $state('')
  let status = $state<CandidateFilter>('pendente')
  let reviewNotes = $state<Record<number, string>>({})
  let realtimeStatus = $state<AdminCurationRealtimeStatus | 'disabled'>('disabled')
  let realtimeLastSync = $state('')
  let realtimeError = $state('')
  let realtimeSubscription: AdminCurationRealtimeSubscription | null = null
  let realtimeRefreshTimeout: number | null = null

  const tabs: Array<{ label: string, status: CandidateFilter, countKey: CandidateStatus }> = [
    { label: 'Pendentes', status: 'pendente', countKey: 'pendente' },
    { label: 'Aprovadas', status: 'aprovada', countKey: 'aprovada' },
    { label: 'Rejeitadas', status: 'rejeitada', countKey: 'rejeitada' }
  ]

  const candidatesQuery = createQuery<CandidateResponse>(() => ({
    queryKey: ['admin-candidates', status],
    enabled: Boolean(session && authorized),
    queryFn: () => session
      ? adminFetch<CandidateResponse>(`/api/admin/candidates?status=${status}`)
      : Promise.resolve(emptyCandidateResponse())
  }))

  const candidates = $derived(candidatesQuery.data?.items ?? [])
  const totals = $derived(candidatesQuery.data?.totals ?? { pendente: 0, aprovada: 0, rejeitada: 0 })
  const loadingCandidates = $derived(candidatesQuery.isLoading || candidatesQuery.isFetching)
  const candidateTable = $derived(createTable<Candidate>({
    data: candidates,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {},
    onStateChange: () => {},
    renderFallbackValue: null
  }))
  const candidateRows = $derived(candidateTable.getRowModel().rows)

  const realtimeStatusLabel = $derived.by(() => {
    if (realtimeStatus === 'connected') return 'Tempo real ativo'
    if (realtimeStatus === 'connecting') return 'Conectando tempo real'
    if (realtimeStatus === 'timed_out') return 'Tempo real lento'
    if (realtimeStatus === 'error') return realtimeError || 'Tempo real indisponível'
    if (realtimeStatus === 'closed') return 'Tempo real pausado'
    return 'Tempo real desligado'
  })

  const realtimeStatusClass = $derived.by(() => {
    if (realtimeStatus === 'connected') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
    if (realtimeStatus === 'connecting') return 'border-sky-200 bg-sky-50 text-sky-800'
    if (realtimeStatus === 'timed_out') return 'border-amber-200 bg-amber-50 text-amber-800'
    if (realtimeStatus === 'error') return 'border-red-200 bg-red-50 text-red-700'
    return 'border-slate-200 bg-white text-slate-500'
  })

  const realtimeDotClass = $derived.by(() => {
    if (realtimeStatus === 'connected') return 'bg-emerald-500'
    if (realtimeStatus === 'connecting') return 'bg-sky-500 motion-safe:animate-pulse'
    if (realtimeStatus === 'timed_out') return 'bg-amber-500'
    if (realtimeStatus === 'error') return 'bg-red-500'
    return 'bg-slate-300'
  })

  onMount(async () => {
    if (!authConfigured) return

    const invited = readInviteSessionFromHash()
    if (invited) {
      inviteSession = invited
      return
    }

    const stored = loadAdminSession()
    if (stored) {
      session = stored
      await validateSession()
    }
  })

  onDestroy(() => {
    clearRealtimeRefresh()
    void stopCurationRealtime()
  })

  function emptyCandidateResponse(): CandidateResponse {
    return { items: [], totals: { pendente: 0, aprovada: 0, rejeitada: 0 } }
  }

  async function adminFetch<T>(url: string, options: AdminFetchOptions = {}): Promise<T> {
    if (!session) throw new Error('AUTH_REQUIRED')

    const nextSession = await refreshAdminSession(session)
    session = nextSession
    saveAdminSession(nextSession)
    await realtimeSubscription?.refreshAuth().catch(() => {})

    return await apiFetch<T>(url, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${nextSession.accessToken}`
      }
    }) as T
  }

  async function validateSession() {
    if (!session) return

    try {
      await adminFetch('/api/admin/me')
      authorized = true
      await candidatesQuery.refetch()
      await startCurationRealtime()
    } catch (error) {
      authorized = false
      await stopCurationRealtime()
      notice = error instanceof Error ? error.message : 'Acesso não autorizado.'
    }
  }

  async function login() {
    busy = true
    notice = ''

    try {
      session = await signInAdmin(email, password)
      await validateSession()
    } catch (error) {
      clearAdminSession()
      session = null
      notice = error instanceof Error ? error.message : 'Falha no login.'
    } finally {
      busy = false
    }
  }

  async function completeInvite() {
    if (!inviteSession) return
    busy = true
    notice = ''

    try {
      await updateAdminPassword(inviteSession, newPassword)
      saveAdminSession(inviteSession)
      session = inviteSession
      inviteSession = null
      await validateSession()
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Não foi possível definir a senha.'
    } finally {
      busy = false
    }
  }

  async function logout() {
    try {
      await signOutAdmin(session)
    } finally {
      await stopCurationRealtime()
      clearAdminSession()
      session = null
      inviteSession = null
      authorized = false
    }
  }

  async function setStatus(nextStatus: CandidateFilter) {
    status = nextStatus
    await candidatesQuery.refetch()
  }

  async function review(id: number, action: ReviewAction) {
    busy = true
    notice = ''

    try {
      await adminFetch(`/api/admin/candidates/${id}`, {
        method: 'PATCH',
        body: {
          action,
          observation: reviewNotes[id] || undefined
        }
      })
      notice = action === 'approve'
        ? 'Resposta aprovada e adicionada à base de conhecimento.'
        : 'Resposta rejeitada.'
      await candidatesQuery.refetch()
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Não foi possível revisar.'
    } finally {
      busy = false
    }
  }

  async function sendInvite() {
    busy = true
    notice = ''

    try {
      await adminFetch('/api/admin/invites', {
        method: 'POST',
        body: { email: inviteEmail }
      })
      notice = 'Convite enviado.'
      inviteEmail = ''
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Não foi possível enviar o convite.'
    } finally {
      busy = false
    }
  }

  async function startCurationRealtime() {
    if (typeof window === 'undefined' || !authConfigured || !session || !authorized) return

    await stopCurationRealtime()
    realtimeSubscription = subscribeAdminCurationRealtime({
      url: String(publicConfig.supabaseUrl || ''),
      anonKey: String(publicConfig.supabaseAnonKey || ''),
      getSession: () => session,
      onChange: handleCurationRealtimeChange,
      onStatus: handleCurationRealtimeStatus
    })
  }

  async function stopCurationRealtime() {
    clearRealtimeRefresh()
    const subscription = realtimeSubscription
    realtimeSubscription = null
    if (subscription) await subscription.unsubscribe()
    realtimeStatus = authConfigured ? 'closed' : 'disabled'
  }

  function handleCurationRealtimeStatus(nextStatus: AdminCurationRealtimeStatus, error?: Error) {
    realtimeStatus = nextStatus
    realtimeError = error?.message ? `Tempo real: ${error.message}` : ''
  }

  function handleCurationRealtimeChange(payload: AdminCurationRealtimePayload) {
    realtimeLastSync = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date())

    if (payload.eventType === 'DELETE') {
      scheduleRealtimeRefresh()
      return
    }

    const candidate = normalizeRealtimeCandidate(payload.new)
    if (!candidate) return
    scheduleRealtimeRefresh()
  }

  function scheduleRealtimeRefresh() {
    if (typeof window === 'undefined' || !authorized || !session) return

    clearRealtimeRefresh()
    realtimeRefreshTimeout = window.setTimeout(() => {
      realtimeRefreshTimeout = null
      void candidatesQuery.refetch()
    }, 250)
  }

  function clearRealtimeRefresh() {
    if (realtimeRefreshTimeout === null) return
    clearTimeout(realtimeRefreshTimeout)
    realtimeRefreshTimeout = null
  }

  function normalizeRealtimeCandidate(record: AdminCurationRealtimeRecord): Candidate | null {
    const id = Number(record.id)
    const status = normalizeCandidateStatus(record.status)
    const motivo = normalizeMotivoBuscaWeb(record.motivo_busca_web)

    if (!Number.isInteger(id) || !status || !motivo) return null

    return {
      id,
      pergunta: String(record.pergunta || ''),
      resposta: String(record.resposta || ''),
      fontes_usadas: Array.isArray(record.fontes_usadas) ? record.fontes_usadas : [],
      motivo_busca_web: motivo,
      status,
      dthr_criacao: typeof record.dthr_criacao === 'string' ? record.dthr_criacao : undefined,
      dthr_atualizacao: typeof record.dthr_atualizacao === 'string' ? record.dthr_atualizacao : undefined
    }
  }

  function normalizeCandidateStatus(value: unknown): CandidateStatus | null {
    return value === 'pendente' || value === 'aprovada' || value === 'rejeitada'
      ? value
      : null
  }

  function normalizeMotivoBuscaWeb(value: unknown): Candidate['motivo_busca_web'] | null {
    return value === 'fallback_automatico' || value === 'feedback_negativo'
      ? value
      : null
  }

  function sourceTitle(source: unknown): string {
    if (!source || typeof source !== 'object') return 'Fonte web'
    const item = source as Record<string, unknown>
    return String(item.titulo || item.title || item.url || 'Fonte web')
  }

  function sourceUrl(source: unknown): string {
    if (!source || typeof source !== 'object') return '#'
    const raw = String((source as Record<string, unknown>).url || '').trim()
    if (!raw) return '#'

    try {
      const parsed = new URL(raw)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '#'
    } catch {
      return '#'
    }
  }

  function sourceKey(source: unknown): string {
    return `${sourceTitle(source)}:${sourceUrl(source)}`
  }
</script>

<svelte:head>
  <title>Admin - fIAq</title>
  <meta name="description" content="Curadoria administrativa do conhecimento do fIAq." />
</svelte:head>

<section class="min-h-[calc(100vh_-_var(--nav-height))] bg-slate-50 px-4 py-8 text-[#1a2e5a] sm:px-6 lg:px-8">
  <section class="mx-auto flex max-w-7xl flex-col gap-6">
    <header class="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          <FiaqIcon name="i-lucide-shield-check" class="h-4 w-4" />
          Administração
        </p>
        <h1 class="text-2xl font-black tracking-normal sm:text-3xl">Curadoria do conhecimento</h1>
      </div>

      {#if session}
        <div class="flex flex-wrap items-center gap-2">
          <span class={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-black shadow-sm ${realtimeStatusClass}`} aria-live="polite">
            <span class={`h-2 w-2 rounded-full ${realtimeDotClass}`}></span>
            {realtimeStatusLabel}
            {#if realtimeLastSync}
              <span class="font-semibold opacity-75">{realtimeLastSync}</span>
            {/if}
          </span>

          <Button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 shadow-sm transition-colors hover:border-[#1a2e5a] hover:text-[#1a2e5a]"
            onclick={() => void logout()}
          >
            <FiaqIcon name="i-lucide-log-out" class="h-4 w-4" />
            Sair
          </Button>
        </div>
      {/if}
    </header>

    {#if !authConfigured}
      <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
        Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` para ativar o login.
      </div>
    {:else if inviteSession}
      <section class="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="mb-4 text-lg font-black">Definir senha</h2>
        <form class="flex flex-col gap-3" onsubmit={(event) => { event.preventDefault(); void completeInvite() }}>
          <div class="relative">
            <label for="admin-new-password" class="sr-only">Nova senha</label>
            <Input
              id="admin-new-password"
              bind:value={newPassword}
              type={showNewPassword ? 'text' : 'password'}
              name="new-password"
              autocomplete="new-password"
              minlength={8}
              required
              placeholder="Nova senha..."
              class="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 pr-12 text-base outline-none transition-[border-color,box-shadow] focus-visible:border-[#00a155] focus-visible:ring-2 focus-visible:ring-emerald-100"
            />
            <Button
              type="button"
              aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
              class="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-[#1a2e5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              onclick={() => (showNewPassword = !showNewPassword)}
            >
              <FiaqIcon name={showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'} class="h-4 w-4" />
            </Button>
          </div>
          <Button type="submit" disabled={busy} class="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#00a155] px-5 text-sm font-black text-[#082315] transition hover:bg-[#17b86a] disabled:cursor-not-allowed disabled:opacity-60">
            <FiaqIcon name="i-lucide-key-round" class="h-4 w-4" />
            Salvar senha
          </Button>
        </form>
      </section>
    {:else if !session}
      <section class="mx-auto w-full max-w-md">
        <form class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" onsubmit={(event) => { event.preventDefault(); void login() }}>
          <h2 class="mb-4 text-lg font-black">Entrar</h2>
          <div class="flex flex-col gap-3">
            <label for="admin-email" class="sr-only">E-mail administrativo</label>
            <Input
              id="admin-email"
              bind:value={email}
              type="email"
              name="email"
              required
              autocomplete="email"
              spellcheck="false"
              placeholder="email@unb.br..."
              class="h-12 rounded-lg border border-slate-200 bg-white px-4 text-base outline-none transition-[border-color,box-shadow] focus-visible:border-[#00a155] focus-visible:ring-2 focus-visible:ring-emerald-100"
            />
            <div class="relative">
              <label for="admin-password" class="sr-only">Senha</label>
              <Input
                id="admin-password"
                bind:value={password}
                type={showPassword ? 'text' : 'password'}
                name="password"
                required
                autocomplete="current-password"
                placeholder="Senha..."
                class="h-12 w-full rounded-lg border border-slate-200 bg-white px-4 pr-12 text-base outline-none transition-[border-color,box-shadow] focus-visible:border-[#00a155] focus-visible:ring-2 focus-visible:ring-emerald-100"
              />
              <Button
                type="button"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                class="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-[#1a2e5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                onclick={() => (showPassword = !showPassword)}
              >
                <FiaqIcon name={showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'} class="h-4 w-4" />
              </Button>
            </div>
            <Button type="submit" disabled={busy} class="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#00a155] px-5 text-sm font-black text-[#082315] transition hover:bg-[#17b86a] disabled:cursor-not-allowed disabled:opacity-60">
              <FiaqIcon name="i-lucide-log-in" class="h-4 w-4" />
              Acessar
            </Button>
          </div>
        </form>
      </section>
    {:else if authorized}
      <section class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="flex flex-col gap-4">
          <div class="grid gap-3 sm:grid-cols-3">
            {#each tabs as tab (tab.status)}
              <Button
                type="button"
                class={`flex items-center justify-between rounded-lg border px-4 py-3 text-left shadow-sm transition-colors ${
                  status === tab.status
                    ? 'border-[#00a155] bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200'
                }`}
                onclick={() => void setStatus(tab.status)}
              >
                <span class="text-sm font-black">{tab.label}</span>
                <span class="rounded-full bg-white px-2.5 py-1 text-xs font-black shadow-sm">{totals[tab.countKey] ?? 0}</span>
              </Button>
            {/each}
          </div>

          {#if loadingCandidates}
            <div class="rounded-lg border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">Carregando fila...</div>
          {:else if candidateRows.length === 0}
            <div class="rounded-lg border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">Nenhum item nesta fila.</div>
          {/if}

          {#each candidateRows as row (row.original.id)}
            {@const candidate = row.original}
            <article class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">#{candidate.id}</span>
                <span class={`rounded-full px-2.5 py-1 text-xs font-black ${
                  candidate.motivo_busca_web === 'feedback_negativo'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-sky-50 text-sky-700'
                }`}>
                  {candidate.motivo_busca_web === 'feedback_negativo' ? 'Complemento solicitado' : 'Busca automática'}
                </span>
              </div>

              <h2 class="mb-3 text-lg font-black leading-snug">{candidate.pergunta}</h2>
              <p class="whitespace-pre-wrap text-sm leading-7 text-slate-700">{candidate.resposta}</p>

              {#if candidate.fontes_usadas.length}
                <div class="mt-4 grid gap-2">
                  {#each candidate.fontes_usadas as source, sourceIndex (`${sourceIndex}:${sourceKey(source)}`)}
                    <a
                      href={sourceUrl(source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"
                    >
                      <FiaqIcon name="i-lucide-link" class="h-4 w-4" />
                      <span class="min-w-0 truncate">{sourceTitle(source)}</span>
                    </a>
                  {/each}
                </div>
              {/if}

              {#if candidate.status === 'pendente'}
                <div class="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4">
                  <Textarea
                    id={`review-note-${candidate.id}`}
                    bind:value={reviewNotes[candidate.id]}
                    name={`review-note-${candidate.id}`}
                    aria-label={`Observação opcional para a candidata ${candidate.id}`}
                    rows={2}
                    placeholder="Observação opcional..."
                    class="resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-[#00a155] focus-visible:ring-2 focus-visible:ring-emerald-100"
                  />
                  <div class="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      class="inline-flex h-10 items-center gap-2 rounded-lg bg-[#00a155] px-4 text-sm font-black text-[#082315] transition hover:bg-[#17b86a] disabled:cursor-not-allowed disabled:opacity-60"
                      onclick={() => void review(candidate.id, 'approve')}
                    >
                      <FiaqIcon name="i-lucide-check" class="h-4 w-4" />
                      Aprovar
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      class="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      onclick={() => void review(candidate.id, 'reject')}
                    >
                      <FiaqIcon name="i-lucide-x" class="h-4 w-4" />
                      Rejeitar
                    </Button>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>

        <aside class="flex flex-col gap-4">
          <div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 class="mb-3 text-base font-black">Administradores</h2>
            <p class="mb-4 text-sm font-semibold text-slate-500">{session.user.email}</p>
            <form class="flex flex-col gap-3" onsubmit={(event) => { event.preventDefault(); void sendInvite() }}>
              <label for="admin-invite-email" class="sr-only">E-mail do novo administrador</label>
              <Input
                id="admin-invite-email"
                bind:value={inviteEmail}
                type="email"
                name="invite-email"
                required
                autocomplete="email"
                spellcheck="false"
                placeholder="novo-admin@unb.br..."
                class="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-[#00a155] focus-visible:ring-2 focus-visible:ring-emerald-100"
              />
              <Button type="submit" disabled={busy} class="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-800 transition hover:border-[#00a155] disabled:cursor-not-allowed disabled:opacity-60">
                <FiaqIcon name="i-lucide-mail-plus" class="h-4 w-4" />
                Enviar convite
              </Button>
            </form>
          </div>
        </aside>
      </section>
    {:else}
      <div class="rounded-lg border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
        Seu usuário entrou no Supabase Auth, mas não está autorizado em `admin_usuario`.
      </div>
    {/if}

    {#if notice}
      <p role="status" aria-live="polite" class="rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-600 shadow-sm">
        {notice}
      </p>
    {/if}
  </section>
</section>
