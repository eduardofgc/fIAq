import assert from 'node:assert/strict'
import test from 'node:test'

test('descarta uma resposta incompleta sem exibi-la e usa o modelo de fallback', async () => {
  process.env.CHAT_PROVIDER = 'openrouter'
  process.env.EMBED_PROVIDER = 'openrouter'
  process.env.OPENROUTER_API_KEY = 'local-test-key'
  process.env.OPENROUTER_CHAT_MODEL = 'test/primary'
  process.env.OPENROUTER_CHAT_FALLBACK_MODELS = 'test/fallback'

  const originalFetch = globalThis.fetch
  const expected = 'Para trancar uma disciplina, abra o SIGAA e consulte o calendário acadêmico.'
  let calls = 0

  globalThis.fetch = async () => {
    calls += 1
    const content = calls === 1 ? 'ws' : expected
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }

  try {
    const { chatStream } = await import('../server/utils/llmProvider')
    const stream = await chatStream([{ role: 'user', content: 'Como faço para trancar uma disciplina?' }])
    let answer = ''
    for await (const token of stream) answer += token
    assert.equal(answer, expected)
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
