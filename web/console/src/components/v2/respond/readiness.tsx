'use client'

// Respuesta · Estado: whether this engine accepts a request to terminate a
// process, checked layer by layer as the engine checks it (the surface,
// the operator list, the protected processes, the log that must accept
// the line before the signal), plus the last executed and denied attempts.
import type { ReactNode } from 'react'
import { Check, Warning } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import type { SfRespondRecord, SfRespondState } from '@/lib/console-types'
import { latest } from '@/lib/v2/respond-model'
import { Empty } from '../home/parts'
import { AttemptLine, formatBytes } from './parts'

export function Readiness({
  state,
  synced,
  records,
  canReadAudit,
  isAdmin,
  now,
}: {
  state: SfRespondState | null
  synced: boolean
  records: SfRespondRecord[]
  canReadAudit: boolean
  isAdmin: boolean
  now: number | null
}) {
  const { dict } = useI18n()
  const t = dict.v2.respondView
  if (!synced) return <p className="v2-small v2-dim">{t.checking}</p>
  if (!state || !state.armed)
    return (
      <div className="v2-ready">
        <Empty title={t.disarmedTitle}>{t.disarmedHint}</Empty>
        <p className="v2-small v2-dim">{t.scopeNote}</p>
      </div>
    )

  const used = state.audit_ceiling > 0 ? state.audit_size / state.audit_ceiling : 0
  const checks: { key: keyof typeof t.checks; ok: boolean; text: string; extra?: ReactNode }[] = [
    { key: 'engine', ok: true, text: t.engineArmed },
    { key: 'operators', ok: state.operators_count > 0, text: state.operators_count > 0 ? t.operatorsN(state.operators_count) : t.operatorsNone },
    { key: 'protected', ok: true, text: t.protectedN(state.protected_count) },
    {
      key: 'audit',
      ok: used < 1,
      text: t.auditUse(formatBytes(state.audit_size), formatBytes(state.audit_ceiling)),
      extra: (
        <>
          <i className="v2-ready-meter" aria-hidden="true">
            <b style={{ ['--w' as string]: `${Math.min(100, used * 100)}%` }} data-level={used >= 1 ? 'full' : used >= 0.8 ? 'near' : 'ok'} />
          </i>
          {used >= 1 ? <span className="v2-small v2-warn">{t.auditFull}</span> : used >= 0.8 ? <span className="v2-small v2-warn">{t.auditNear}</span> : null}
        </>
      ),
    },
  ]
  const lastOk = latest(records, 'executed')
  const lastNo = latest(records, 'denied')

  return (
    <div className="v2-ready">
      <section className="v2-ready-main" aria-labelledby="v2-ready-title">
        <header>
          <span className="v2-armed" data-armed="true">
            <i aria-hidden="true" />
            {t.armed}
          </span>
          <h2 id="v2-ready-title">{t.stateTitle}</h2>
        </header>
        <ol className="v2-ready-checks">
          {checks.map((c, i) => (
            <li key={c.key} data-ok={c.ok} style={{ ['--i' as string]: i }}>
              <span className="v2-ready-icon" aria-hidden="true">
                {c.ok ? <Check weight="bold" /> : <Warning weight="bold" />}
              </span>
              <span className="v2-ready-text">
                <strong>{t.checks[c.key]}</strong>
                <span className="v2-small">{c.text}</span>
                {c.extra}
              </span>
            </li>
          ))}
        </ol>
        <dl className="v2-fields">
          <div>
            <dt>{t.signal}</dt>
            <dd>
              <span className="v2-mono">{state.signal || 'SIGKILL'}</span> <span className="v2-dim">· {t.signalNote}</span>
            </dd>
          </div>
          <div>
            <dt>{t.files}</dt>
            <dd className="v2-mono v2-ready-paths">
              {[state.operators_path, state.protected_path, state.audit_path].filter(Boolean).map((p) => (
                <span key={p}>{p}</span>
              ))}
            </dd>
          </div>
        </dl>
        <p className="v2-small v2-dim">{t.scopeNote}</p>
        {!isAdmin && <p className="v2-small v2-warn">{t.notAdmin}</p>}
      </section>

      <section className="v2-ready-last" aria-label={`${t.lastExecuted} · ${t.lastDenied}`}>
        {!canReadAudit ? (
          <p className="v2-small v2-dim">{t.auditHidden}</p>
        ) : (
          <>
            <div>
              <h3 className="v2-eyebrow">{t.lastExecuted}</h3>
              {lastOk ? <AttemptLine r={lastOk} now={now} /> : <p className="v2-small v2-dim">{t.noneYet}</p>}
            </div>
            <div>
              <h3 className="v2-eyebrow">{t.lastDenied}</h3>
              {lastNo ? <AttemptLine r={lastNo} now={now} /> : <p className="v2-small v2-dim">{t.noneYet}</p>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
