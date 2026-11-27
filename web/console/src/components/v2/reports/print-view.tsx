'use client'

// Informes · Vista de impresión: the report as a white A4 sheet (the same
// content, in ink on paper) beside the controls to print it or save it
// as PDF. Only the sheet reaches the printer: the console around it is
// hidden by the print styles.
import type { ReactNode } from 'react'
import { ArrowLeft, Printer } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { formatDateTime } from '@/lib/console-types'
import type { ReportEnvelope } from '@/lib/reports'
import { TardigradeMark } from '../logo'
import { SourceLine } from './parts'

export function PrintView({ title, subtitle, env, onBack, children }: { title: string; subtitle?: string; env?: ReportEnvelope; onBack: () => void; children: ReactNode }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.reportsView
  return (
    <div className="v2-print">
      <aside className="v2-print-controls">
        <button type="button" className="v2-link v2-back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t.prBack}
        </button>
        <h2>{t.prTitle}</h2>
        <button type="button" className="v2-btn v2-btn-primary" onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          {t.prPrint}
        </button>
        <p className="v2-small v2-dim">{t.prHint}</p>
      </aside>
      <div className="v2-print-stage">
        <article className="v2-sheet" aria-label={title}>
          <header className="v2-sheet-head">
            <span className="v2-sheet-brand">
              <TardigradeMark size={26} />
              bluetardigrade
            </span>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
            {env && <SourceLine env={env} />}
          </header>
          <div className="v2-sheet-body">{children}</div>
          <footer className="v2-sheet-foot">
            {t.prFooter} · {formatDateTime(new Date().toISOString(), lang)}
          </footer>
        </article>
      </div>
    </div>
  )
}
