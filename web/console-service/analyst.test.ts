// Unit tests for the analyst LLM client: env configuration with
// graceful degradation, request shape against a local OpenAI-compatible
// mock, and provider error mapping. No external network: the mock runs
// on Bun.serve in-process.

import { afterAll, describe, expect, test } from 'bun:test'
import {
  AnalystNotConfiguredError,
  analystConfigFromEnv,
  analystSystemPrompt,
  analystUserPrompt,
  chatCompletion,
  type AnalystConfig,
} from './analyst'
import type { SfAlert } from './types'

const testAlert: SfAlert = {
  id: 'a1',
  timestamp: '2026-09-30T10:00:00Z',
  rule_id: 'r-lsass',
  rule_name: 'lsass-access',
  severity: 'critical',
  host: 'LAB-WKS-01',
  user: 'ana',
  event_id: 'ev-1',
  event_type: 'process.access',
  summary: 'mimikatz sekurlsa::logonpasswords',
  matched_on: ['process.name', 'process.command_line'],
  tags: ['attack.t1003.001'],
}

type Captured = { auth: string | null; path: string; body: { model?: string; messages?: Array<{ role: string; content: string }> } }
let captured: Captured | null = null

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname !== '/v1/chat/completions') return new Response('not found', { status: 404 })
    const body = (await req.json()) as Captured['body']
    captured = { auth: req.headers.get('authorization'), path: url.pathname, body }
    if (captured.auth !== 'Bearer sk-test') {
      return Response.json({ error: { message: 'invalid api key' } }, { status: 401 })
    }
    if (captured.body.messages?.[0]?.content === 'force-empty') {
      return Response.json({ choices: [{ message: { content: '' } }] })
    }
    return Response.json({ choices: [{ message: { content: 'analisis de prueba' } }] })
  },
})

afterAll(() => server.stop(true))

function cfgFor(baseUrl?: string, extra?: Partial<AnalystConfig>): AnalystConfig {
  return { baseUrl: baseUrl ?? `${server.url.origin}/v1`, apiKey: 'sk-test', model: 'test-model', ...extra }
}

describe('analystConfigFromEnv', () => {
  test('reads and trims a complete configuration', () => {
    const cfg = analystConfigFromEnv({
      ANALYST_BASE_URL: '  https://api.openai.com/v1  ',
      ANALYST_API_KEY: ' sk-live ',
      ANALYST_MODEL: ' gpt-4o-mini ',
    })
    expect(cfg).toEqual({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-live', model: 'gpt-4o-mini' })
  })

  test('throws with every missing variable listed', () => {
    expect(() => analystConfigFromEnv({})).toThrow(AnalystNotConfiguredError)
    expect(() => analystConfigFromEnv({})).toThrow(/ANALYST_BASE_URL, ANALYST_API_KEY y ANALYST_MODEL/)
  })

  test('throws listing only the missing variables', () => {
    try {
      analystConfigFromEnv({ ANALYST_BASE_URL: 'https://api.openai.com/v1' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(AnalystNotConfiguredError)
      const msg = (err as Error).message
      expect(msg).toContain('faltan ANALYST_API_KEY, ANALYST_MODEL en el entorno')
    }
  })
})

describe('chatCompletion', () => {
  test('posts the OpenAI-compatible request and returns the content', async () => {
    const text = await chatCompletion(cfgFor(), [
      { role: 'system', content: analystSystemPrompt() },
      { role: 'user', content: 'analiza esto' },
    ])
    expect(text).toBe('analisis de prueba')
    expect(captured?.path).toBe('/v1/chat/completions')
    expect(captured?.auth).toBe('Bearer sk-test')
    expect(captured?.body.model).toBe('test-model')
    expect(captured?.body.messages?.[0]?.role).toBe('system')
    expect(captured?.body.messages?.[1]?.content).toBe('analiza esto')
  })

  test('maps 401 to an operator-ready credentials message', async () => {
    expect(chatCompletion(cfgFor(undefined, { apiKey: 'wrong' }), [{ role: 'user', content: 'x' }])).rejects.toThrow(/ANALYST_API_KEY/)
  })

  test('maps 404 to a base URL / model message', async () => {
    const wrongPath = cfgFor(`${server.url.origin}/nope`)
    expect(chatCompletion(wrongPath, [{ role: 'user', content: 'x' }])).rejects.toThrow(/ANALYST_BASE_URL/)
  })

  test('maps an unreachable provider to a contact error', async () => {
    const dead = cfgFor('http://127.0.0.1:9/v1')
    expect(chatCompletion(dead, [{ role: 'user', content: 'x' }])).rejects.toThrow(/no se pudo contactar/)
  })

  test('rejects an empty completion', async () => {
    expect(chatCompletion(cfgFor(), [{ role: 'user', content: 'force-empty' }])).rejects.toThrow(/respuesta vacia/)
  })
})

describe('prompts', () => {
  test('user prompt carries alert, rule context and the analyst question', () => {
    const prompt = analystUserPrompt(testAlert, { id: 'r-lsass', name: 'lsass-access', description: '', severity: 'critical', event_type: 'process.access', mitre: 'T1003.001', tactic: 'credential-access', tags: [], conditions: [] }, undefined, 'como contengo esto?')
    expect(prompt).toContain('ALERTA: lsass-access')
    expect(prompt).toContain('MITRE T1003.001')
    expect(prompt).toContain('host LAB-WKS-01')
    expect(prompt).toContain('PREGUNTA DEL ANALISTA: como contengo esto?')
  })

  test('system prompt fixes structure and language', () => {
    const prompt = analystSystemPrompt()
    expect(prompt).toContain('**Qué ha pasado**')
    expect(prompt).toContain('Responde SIEMPRE en español')
  })
})
