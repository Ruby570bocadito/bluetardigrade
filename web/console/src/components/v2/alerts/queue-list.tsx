'use client'

// The queue on a phone: one card per alert. With triage rights a card can
// be swiped: to the right to acknowledge it (amber), to the left to close
// it (green). Past the threshold the card leaves to that side and the
// decision goes to the engine; short of it, the card springs back. A tap
// opens the alert, where the same actions are buttons.
import { useRef, useState, type PointerEvent } from 'react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { alertKey } from '@/lib/engine-client'
import { formatTime, type SfAlert, type SfAlertStatus } from '@/lib/console-types'
import { statusOf, techniqueIds } from '@/lib/v2/alerts-model'
import { SEV_COLOR } from '../home/parts'
import { StatusChip } from './status-chip'
import { useFreshKeys } from './queue-table'

const THRESHOLD = 96

function SwipeCard({ alert, fresh, onOpen, onSwipe }: { alert: SfAlert; fresh: boolean; onOpen: () => void; onSwipe?: (to: SfAlertStatus) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.alertsView
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0)
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null)
  const moved = useRef(false)
  const status = statusOf(alert)
  const canRight = !!onSwipe && status === 'new'
  const canLeft = !!onSwipe && status !== 'closed'
  const technique = techniqueIds(alert.tags)[0]

  function down(e: PointerEvent<HTMLDivElement>) {
    if (!onSwipe || e.pointerType === 'mouse') return
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null }
    moved.current = false
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const x = e.clientX - s.x
    const y = e.clientY - s.y
    if (s.horizontal === null && Math.abs(x) + Math.abs(y) > 8) {
      s.horizontal = Math.abs(x) > Math.abs(y)
      if (s.horizontal) e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (!s.horizontal) return
    moved.current = true
    setDragging(true)
    setDx(Math.max(canLeft ? -160 : 0, Math.min(canRight ? 160 : 0, x)))
  }
  function up() {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s?.horizontal) return
    const commit: SfAlertStatus | null = dx >= THRESHOLD && canRight ? 'acknowledged' : dx <= -THRESHOLD && canLeft ? 'closed' : null
    if (!commit) {
      setDx(0)
      return
    }
    // the card leaves to its side, the decision goes to the engine and the
    // card comes back with its new state
    setLeaving(commit === 'acknowledged' ? 1 : -1)
    window.setTimeout(() => {
      onSwipe!(commit)
      setLeaving(0)
      setDx(0)
    }, 220)
  }

  return (
    <li className="v2-swipe" data-dir={dx > 0 ? 'right' : dx < 0 ? 'left' : undefined} data-fresh={fresh}>
      <div className="v2-swipe-bg" aria-hidden="true">
        <span data-side="right">{t.swipe.acknowledge}</span>
        <span data-side="left">{t.swipe.close}</span>
      </div>
      <div
        className="v2-swipe-card"
        data-dragging={dragging || undefined}
        style={{ transform: leaving ? `translateX(${leaving * 110}%)` : dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <button
          type="button"
          className="v2-swipe-open"
          onClick={() => {
            if (!moved.current) onOpen()
          }}
          aria-label={t.rowAria(dict.v2.sev[alert.severity], alert.rule_name, alert.host, formatTime(alert.timestamp, lang))}
        >
          <span className="v2-swipe-top">
            <span className="v2-sev" style={{ ['--c' as string]: SEV_COLOR[alert.severity] }}>
              {dict.v2.sev[alert.severity]}
            </span>
            <span className="v2-mono v2-dim">{formatTime(alert.timestamp, lang)}</span>
          </span>
          <strong>{alert.rule_name}</strong>
          <span className="v2-q-sub">
            <span className="v2-mono">{alert.host}</span>
            {alert.user && <span> · {alert.user}</span>}
            {technique && <span className="v2-mono"> · {technique}</span>}
          </span>
          <span className="v2-swipe-state">
            <StatusChip status={status} />
            <span className="v2-q-owner">{alert.assignee ?? t.unassigned}</span>
          </span>
        </button>
      </div>
    </li>
  )
}

export function QueueList({ alerts, onSelect, onSwipe }: { alerts: SfAlert[]; onSelect: (key: string) => void; onSwipe: (alert: SfAlert, to: SfAlertStatus) => void }) {
  const { dict } = useI18n()
  const me = useConsoleUser()
  const keys = alerts.map(alertKey)
  const fresh = useFreshKeys(keys)
  const canSwipe = !me.pending && me.can_triage

  return (
    <>
      {canSwipe && <p className="v2-dim v2-small v2-swipe-hint">{dict.v2.alertsView.swipe.hint}</p>}
      <ul className="v2-swipe-list">
        {alerts.map((a, i) => (
          <SwipeCard
            key={keys[i]}
            alert={a}
            fresh={fresh.has(keys[i])}
            onOpen={() => onSelect(keys[i])}
            onSwipe={canSwipe && a.id ? (to) => onSwipe(a, to) : undefined}
          />
        ))}
      </ul>
    </>
  )
}
