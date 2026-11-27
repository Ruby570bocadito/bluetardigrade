'use client'

// Directorio · Cobertura: the domain computers against the machines that
// report to the engine — the engine's finding of enabled computers
// without sensor telemetry, as a share of the directory and listed by
// container — and what the connector publishes about its syncs.
import { useI18n } from '@/components/console/i18n-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { coverageFrom, type ADFinding, type ADStatus } from '@/lib/directory'
import { groupByParent, leafName } from '@/lib/v2/directory-model'
import { Empty } from '../home/parts'
import { Figure } from '../reports/parts'
import { Group } from '../settings/parts'
import { useWhen } from './parts'

export function Coverage({ findings, status }: { findings: ADFinding[]; status: ADStatus }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.directoryView
  const d = dict.directory
  const c = d.connector
  const when = useWhen()
  const { fleet } = useFleet()
  const n = new Intl.NumberFormat(lang)
  const cov = coverageFrom(findings, status.objects, fleet?.enabled && Array.isArray(fleet.hosts) ? fleet.hosts.length : null)
  const share = cov && cov.inDirectory > 0 ? Math.min(100, (cov.withoutSensor / cov.inDirectory) * 100) : 0

  return (
    <div className="v2-set-two">
      <div className="v2-set-col">
        <div className="v2-set-head">
          <h2>{t.covTitle}</h2>
        </div>
        {!cov ? (
          <Empty title={t.covNone} />
        ) : (
          <>
            <div className="v2-rep-figs">
              <Figure label={d.coverage.inDirectory.replace(/:\s*$/, '')} value={n.format(cov.inDirectory)} />
              <Figure label={t.covWithout} value={n.format(cov.withoutSensor)} tone={cov.withoutSensor > 0 ? 'warn' : 'ok'} />
              <Figure label={d.coverage.withSensor.replace(/:\s*$/, '')} value={cov.withSensor === null ? '—' : n.format(cov.withSensor)} />
            </div>
            <div className="v2-dir-covbar" role="img" aria-label={t.covBarAria(n.format(cov.withoutSensor), n.format(cov.inDirectory))}>
              <i style={{ ['--w' as string]: `${share}%` }} />
            </div>
            {cov.objects.length > 0 && (
              <section aria-labelledby="v2-dir-cov-list">
                <h3 id="v2-dir-cov-list" className="v2-eyebrow">
                  {t.covByParent}
                </h3>
                <ul className="v2-dir-covgroups">
                  {groupByParent(cov.objects).map((g) => (
                    <li key={g.parent}>
                      <p className="v2-mono v2-small v2-dir-wrap">
                        {g.parent || '—'} <b>{g.objects.length}</b>
                      </p>
                      <ul className="v2-gr-hosts">
                        {g.objects.map((o) => (
                          <li key={o.dn} className="v2-mono" title={o.detail || o.dn}>
                            {o.name || leafName(o.dn)}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                {cov.truncated && <p className="v2-small v2-dim">{d.truncatedList}</p>}
              </section>
            )}
          </>
        )}
      </div>
      <aside className="v2-set-col">
        <Group id="v2-dir-sync" title={t.syncTitle} hint={t.syncHint}>
          <p className="v2-small">
            <strong>{status.connected ? t.connected : t.disconnected}</strong>
          </p>
          <dl className="v2-fields">
            <div>
              <dt>{c.lastAttempt}</dt>
              <dd>{when(status.last_sync_at, c.noneYet)}</dd>
            </div>
            <div>
              <dt>{c.lastSuccess}</dt>
              <dd>{when(status.last_success_at, c.noneYet)}</dd>
            </div>
            <div>
              <dt>{c.next}</dt>
              <dd>{status.next_sync_at ? when(status.next_sync_at, c.stopped) : c.stopped}</dd>
            </div>
            <div>
              <dt>{c.attempts}</dt>
              <dd className="v2-mono">{n.format(status.syncs)}</dd>
            </div>
          </dl>
          {status.last_error && (
            <p className="v2-small v2-warn">
              {c.lastError}
              <span className="v2-mono">{status.last_error}</span>
            </p>
          )}
          {status.warnings?.length > 0 && (
            <ul className="v2-plainlist">
              {status.warnings.map((w) => (
                <li key={w} className="v2-small v2-warn">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </Group>
      </aside>
    </div>
  )
}
