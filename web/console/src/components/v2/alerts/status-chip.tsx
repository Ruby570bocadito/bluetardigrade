// The triage state of an alert as a quiet chip: new (still to look at),
// acknowledged (someone is on it) or closed.
import { useI18n } from '@/components/console/i18n-provider'
import type { SfAlertStatus } from '@/lib/console-types'

export function StatusChip({ status }: { status: SfAlertStatus }) {
  const { dict } = useI18n()
  return (
    <span className="v2-status" data-status={status}>
      {dict.v2.alertsView.status[status]}
    </span>
  )
}
