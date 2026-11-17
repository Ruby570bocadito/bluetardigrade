'use client'

// v2 · Inicio: the command center's first screen. The world map with
// where the hosts connect to and the state of the SOC in one line, the
// five numbers, the ATT&CK matrix, live alerts beside the hosts at risk
// and the sensors, then the event
// log beside the telemetry line. All of it reads the same live state as
// the classic console; nothing here is sample data.
import { useMemo } from 'react'
import { useEngine, useStatsHistory } from '@/components/console/engine-provider'
import { useFleet } from '@/components/console/fleet-provider'
import { attackMatrix, homeKpis, homeStatus, latestAlerts, openAlerts, telemetrySeries, unreviewed } from '@/lib/v2/home-model'
import { countryMarks, destinations } from '@/lib/v2/geo-map'
import { useGeo } from '../use-geo'
import { StatusBand } from './status-band'
import { KpiTiles } from './kpi-tiles'
import { AttackMatrix } from './attack-matrix'
import { LiveAlerts } from './live-alerts'
import { HostHealth } from './host-health'
import { Sensors } from './sensors'
import { EventLog } from './event-log'
import { TelemetryChart } from './telemetry-chart'

export function HomeView() {
  const { status: engineStatus, alerts, events, rules, stats } = useEngine()
  const history = useStatsHistory()
  const { fleet } = useFleet()

  const status = useMemo(() => homeStatus(engineStatus, alerts, stats ? stats.events_total : null), [engineStatus, alerts, stats])
  const kpis = useMemo(() => homeKpis(stats, alerts, fleet, rules), [stats, alerts, fleet, rules])
  const latest = useMemo(() => {
    if (status.kind !== 'alert') return null
    return latestAlerts(openAlerts(alerts).filter((a) => a.severity === status.severity && unreviewed(a)), 1)[0] ?? null
  }, [status, alerts])
  const matrix = useMemo(() => attackMatrix(rules, alerts), [rules, alerts])
  const recent = useMemo(() => latestAlerts(alerts, 8), [alerts])
  const telemetry = useMemo(() => telemetrySeries(history), [history])
  const live = engineStatus !== 'down'
  // where the hosts connected to: public destinations of the recent
  // network events and of the alerts, placed by the console's own lookup
  const dests = useMemo(() => destinations(events, alerts), [events, alerts])
  const located = useGeo(useMemo(() => dests.map((d) => d.ip), [dests]))
  const placed = countryMarks(dests, located)
  const map = { marks: placed.marks, destinations: dests.length, pending: dests.some((d) => located[d.ip] === undefined) }

  return (
    <>
      <StatusBand status={status} kpis={kpis} latest={latest} map={map} />
      <KpiTiles kpis={kpis} />
      <AttackMatrix matrix={matrix} />
      <div className="v2-row">
        <LiveAlerts alerts={recent} />
        <div className="v2-stack">
          <HostHealth hosts={live ? (stats?.hot_hosts ?? []).slice(0, 4) : []} />
          <Sensors fleet={fleet} />
        </div>
      </div>
      <div className="v2-row">
        <EventLog events={events} />
        <TelemetryChart values={telemetry.values} minutes={telemetry.minutes} />
      </div>
    </>
  )
}
