'use client'

// Respuesta · reputation before acting: the alert's public IPs and file
// hashes asked to the providers the engine has configured (VirusTotal,
// AbuseIPDB). A lookup is the operator's click — it spends the provider's
// quota — and the engine keeps the answer for a while (said as such).
import { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlert, SfEvent } from '@/lib/console-types'
import { lookupReputation, reputationProviders, type ReputationReport, type ReputationResult } from '@/lib/engine-writes'
import { reputationTargets } from '@/lib/v2/respond-model'
import { When } from './parts'

const PROVIDERS = ['virustotal', 'abuseipdb'] as const
let providersOnce: Promise<Record<string, boolean>> | null = null

function useProviders(): Record<string, boolean> | null {
  const [providers, setProviders] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    providersOnce ??= reputationProviders().then((r) => (r.ok ? r.data.providers : {}))
    let alive = true
    void providersOnce.then((p) => alive && setProviders(p))
    return () => {
      alive = false
    }
  }, [])
  return providers
}

type Slot = ReputationReport | 'loading' | { error: string }

export function ReputationPanel({ alert, event, now }: { alert: SfAlert; event?: SfEvent; now: number | null }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const providers = useProviders()
  const [reports, setReports] = useState<Record<string, Slot>>({})
  const enabled = providers ? PROVIDERS.filter((p) => providers[p]) : []
  const targets = providers ? reputationTargets(alert, event, providers) : []

  async function lookup(kind: 'ip' | 'hash', value: string) {
    setReports((r) => ({ ...r, [value]: 'loading' }))
    const res = await lookupReputation(kind, value)
    setReports((r) => ({ ...r, [value]: res.ok ? res.data : { error: res.error } }))
  }

  return (
    <section className="v2-rep" aria-labelledby="v2-rep-title">
      <h3 id="v2-rep-title">{t.repTitle}</h3>
      <p className="v2-small v2-dim">{t.repHint}</p>
      {providers === null ? null : enabled.length === 0 ? (
        <p className="v2-small v2-dim">{t.repOff}</p>
      ) : targets.length === 0 ? (
        <p className="v2-small v2-dim">{t.repNothing}</p>
      ) : (
        <>
          {targets.length > 1 && (
            <button type="button" className="v2-btn v2-rep-all" onClick={() => targets.forEach((x) => !reports[x.value] && void lookup(x.kind, x.value))}>
              <MagnifyingGlass aria-hidden="true" />
              {t.repLookupAll}
            </button>
          )}
          <ul className="v2-rep-list">
            {targets.map(({ kind, value }) => {
              const slot = reports[value]
              return (
                <li key={value}>
                  <div className="v2-rep-target">
                    <span className="v2-tag">{kind === 'ip' ? 'IP' : 'SHA-256'}</span>
                    <span className="v2-mono v2-rep-value" title={value}>
                      {value}
                    </span>
                    {!slot && (
                      <button type="button" className="v2-btn" onClick={() => void lookup(kind, value)}>
                        {t.repLookup}
                      </button>
                    )}
                    {slot === 'loading' && <span className="v2-small v2-dim">{t.repLooking}</span>}
                  </div>
                  {slot && slot !== 'loading' && 'error' in slot && <p className="v2-small v2-warn">{t.repError(slot.error)}</p>}
                  {slot && slot !== 'loading' && 'results' in slot && (
                    <>
                      <ul className="v2-rep-results">
                        {slot.results.map((r) => (
                          <ProviderLine key={r.provider} r={r} />
                        ))}
                      </ul>
                      <p className="v2-small v2-dim">
                        {slot.cached ? t.repCached : t.repFresh} · <When iso={slot.at} now={now} />
                      </p>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {providers !== null && (
        <ul className="v2-rep-providers">
          {PROVIDERS.filter((p) => !providers[p]).map((p) => (
            <li key={p} className="v2-small v2-dim">
              {p === 'virustotal' ? 'VirusTotal' : 'AbuseIPDB'} · {t.repNotConfigured}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ProviderLine({ r }: { r: ReputationResult }) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  const name = r.provider === 'abuseipdb' ? 'AbuseIPDB' : 'VirusTotal'
  if (r.status !== 'ok')
    return (
      <li>
        <strong>{name}</strong> <span className="v2-small v2-dim">· {t.repStatus[r.status] ?? r.detail ?? r.status}</span>
      </li>
    )
  if (r.provider === 'abuseipdb') {
    const score = r.score ?? 0
    return (
      <li>
        <strong>{name}</strong>
        <span className="v2-rep-meter" aria-hidden="true">
          <b style={{ ['--w' as string]: `${Math.min(100, score)}%` }} data-level={score >= 75 ? 'high' : score >= 25 ? 'mid' : 'low'} />
        </span>
        <span className="v2-small">
          {t.repAbuse(score, r.reports ?? 0)}
          {r.country ? ` · ${r.country}` : ''}
        </span>
      </li>
    )
  }
  const malicious = r.malicious ?? 0
  const total = malicious + (r.suspicious ?? 0) + (r.harmless ?? 0) + (r.undetected ?? 0)
  return (
    <li>
      <strong>{name}</strong>
      <span className="v2-rep-meter" aria-hidden="true">
        <b style={{ ['--w' as string]: `${total ? (malicious / total) * 100 : 0}%` }} data-level={malicious >= 5 ? 'high' : malicious > 0 ? 'mid' : 'low'} />
      </span>
      <span className="v2-small">
        {t.repVt(malicious, total)}
        {r.name ? ` · ${r.name}` : ''}
      </span>
    </li>
  )
}
