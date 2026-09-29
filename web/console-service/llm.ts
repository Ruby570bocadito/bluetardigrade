// Minimal chat-completion client for the alert-triage analyst.
// Speaks the OpenAI-compatible chat completions contract against any
// provider configured through environment variables — no vendor SDK,
// no private packages, no lock-in. The hub stays installable with a
// plain `bun install` from the public registry.
//
//   ANALYST_BASE_URL  provider base URL, e.g. https://api.openai.com/v1
//                     or a self-hosted gateway (localhost LLM servers work)
//   ANALYST_API_KEY   bearer token sent as `Authorization: Bearer ...`
//                     (optional: local gateways may not need it)
//   ANALYST_MODEL     model id, e.g. gpt-4o-mini, llama3.1, qwen2.5
//
// Graceful degradation is part of the contract: when the variables are
// absent the call fails fast with an actionable message and the rest of
// the console keeps working — the analyst panel is the only piece that
// reports the error.

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatCompletionOptions = {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export type ChatCompletionResult = {
  content: string
  model: string
}

export type AnalystLlmConfig = {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export function analystLlmConfig(): AnalystLlmConfig | null {
  const baseUrl = process.env.ANALYST_BASE_URL?.trim().replace(/\/+$/, '')
  const model = process.env.ANALYST_MODEL?.trim() ?? ''
  if (!baseUrl || !model) return null
  return { baseUrl, model, hasApiKey: Boolean(process.env.ANALYST_API_KEY?.trim()) }
}

export async function createChatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const config = analystLlmConfig()
  if (!config) {
    throw new Error(
      'triage IA sin configurar: define ANALYST_BASE_URL y ANALYST_MODEL (endpoint compatible con API OpenAI) en el entorno del hub; sin ellas el resto de la consola funciona con normalidad',
    )
  }

  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 60_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.hasApiKey ? { Authorization: `Bearer ${process.env.ANALYST_API_KEY!.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: opts.messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = (await res.text()).slice(0, 300)
      throw new Error(`el proveedor LLM respondio ${res.status}: ${body || '(sin cuerpo)'}`)
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      model?: string
    }
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content || !content.trim()) throw new Error('respuesta vacia del proveedor LLM')
    return { content: content.trim(), model: data?.model ?? config.model }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timeout del proveedor LLM (${Math.round(timeoutMs / 1000)} s)`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
