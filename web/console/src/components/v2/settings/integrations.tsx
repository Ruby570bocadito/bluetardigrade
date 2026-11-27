'use client'

// Ajustes · Integraciones: what the engine delivers out — the webhook, the
// SIEM sinks (Elastic, Splunk) and every notification channel — with the
// engine's own counters and their health. The sinks are declared when the
// engine starts (read-only here); the channels are edited in «Avisos».
import { useI18n } from '@/components/console/i18n-provider'
import { useEngine } from '@/components/console/engine-provider'
import { outputRows } from '@/lib/v2/settings-model'
import type { SettingsTab } from '@/lib/v2/settings-model'

export function Integrations({ onOpen }: { onOpen: (tab: SettingsTab) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const { stats } = useEngine()
  const n = new Intl.NumberFormat(lang)
  if (!stats) return <p className="v2-small v2-dim">{t.states.loading}</p>
  const rows = outputRows(stats)

  return (
    <div className="v2-set-stack">
      <div className="v2-set-head">
        <h2>{t.intTitle}</h2>
        <p className="v2-small v2-dim">{dict.settings.integraciones.prose}</p>
      </div>
      <div className="v2-rep-tablewrap">
        <table className="v2-rep-table v2-int-table">
          <thead>
            <tr>
              <th>{t.intCols.output}</th>
              <th>{t.intCols.health}</th>
              <th className="v2-num">{t.intCols.sent}</th>
              <th className="v2-num">{t.intCols.failed}</th>
              <th className="v2-num">{t.intCols.dropped}</th>
              <th className="v2-num">{t.intCols.filtered}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-health={r.health}>
                <td>
                  <strong>{r.label}</strong>
                  <span className="v2-small v2-dim v2-int-note">
                    {r.kind === 'sink' ? (
                      t.intSink
                    ) : (
                      <button type="button" className="v2-link" onClick={() => onOpen('avisos')}>
                        {t.intChannel}
                      </button>
                    )}
                  </span>
                </td>
                <td>
                  <span className="v2-int-health" data-health={r.health}>
                    <i aria-hidden="true" />
                    {t.intHealth[r.health]}
                  </span>
                </td>
                <td className="v2-num v2-mono" data-label={t.intCols.sent}>
                  {n.format(r.sent)}
                </td>
                <td className="v2-num v2-mono" data-label={t.intCols.failed} data-bad={r.failed > 0}>
                  {n.format(r.failed)}
                </td>
                <td className="v2-num v2-mono" data-label={t.intCols.dropped} data-bad={r.dropped > 0}>
                  {n.format(r.dropped)}
                </td>
                <td className="v2-num v2-mono" data-label={t.intCols.filtered}>
                  {r.filtered === undefined ? '—' : n.format(r.filtered)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="v2-small v2-dim">{dict.settings.integraciones.quiet}</p>
    </div>
  )
}
