// First-run assistant (IDEA-11): when to offer it and what each step
// looks like, derived only from what the engine actually reports. The
// console never assumes an installation state it cannot see: without
// loaded /api/enroll and /api/fleet answers there is no auto-open, and
// the steps the console cannot close today (per-user accounts, serving
// the certificate) are declared as information, never as done.

export const ONBOARDING_KEY = 'bluetardigrade.onboarding.v1'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>
type StorageRemover = Pick<Storage, 'removeItem'>

/**
 * Whether the operator asked to stop the automatic offer. Tolerant read:
 * anything corrupt, foreign or expired degrades to "not dismissed" and
 * the assistant may open again — the same failure mode as the saved
 * searches, where a corrupt entry is dropped instead of breaking.
 */
export function readDismissed(storage: StorageReader | undefined): boolean {
  if (!storage) return false
  let raw: string | null
  try {
    raw = storage.getItem(ONBOARDING_KEY)
  } catch {
    return false
  }
  if (raw === null) return false
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return typeof record.dismissed_at === 'string' && record.dismissed_at !== ''
  } catch {
    return false
  }
}

/** Record that the operator finished (or closed) the assistant for good. */
export function writeDismissed(storage: (StorageWriter & StorageReader) | undefined, at: Date): void {
  if (!storage) return
  try {
    storage.setItem(ONBOARDING_KEY, JSON.stringify({ dismissed_at: at.toISOString() }))
  } catch {
    /* private mode or full quota: the assistant still works, it just may offer again */
  }
}

/** Forget the dismissal (used when the operator wants the offer back). */
export function clearDismissed(storage: StorageRemover | undefined): void {
  if (!storage) return
  try {
    storage.removeItem(ONBOARDING_KEY)
  } catch {
    /* nothing to undo */
  }
}

/** Everything the decision needs, all of it observed, none of it guessed. */
export type OnboardingFacts = {
  /** The engine stream is live right now. */
  engineLive: boolean
  /** /api/fleet and /api/enroll answered at least once (loaded flag). */
  loaded: boolean
  /** Enrollment state, or null while the engine has not answered it. */
  enroll: { enabled: boolean; usableTokens: number; pendingHosts: number; activeHosts: number } | null
  /** Machines in the inventory, or null while /api/fleet has not answered. */
  inventoryHosts: number | null
}

/**
 * Auto-open only on a genuinely fresh install, seen from the engine:
 * everything loaded, no machine in the inventory, no enrolled host
 * active. A pending host still counts as fresh (the operator is
 * mid-install and the assistant is the fastest path to approval). When
 * any input is missing the answer is no: the console does not nag on
 * partial data, and the fixture/test environments without enrollment
 * answers never see the dialog.
 */
export function shouldAutoOpen(facts: OnboardingFacts, dismissed: boolean): boolean {
  if (dismissed) return false
  if (!facts.engineLive || !facts.loaded) return false
  if (!facts.enroll || facts.inventoryHosts === null) return false
  return facts.inventoryHosts === 0 && facts.enroll.activeHosts === 0
}

export type StepId = 'acceso' | 'certificado' | 'token' | 'sensor'

/** hecho: the engine confirms it. aviso: actionable now. info: declared, not measurable. pendiente: waiting on the operator. */
export type StepStatus = 'hecho' | 'aviso' | 'info' | 'pendiente'

/**
 * Step states from the same observed facts. «Acceso» stays informational:
 * there is no account API yet (TEAM-2), so there is nothing to mark done
 * without inventing it. The certificate step leans on the engine's own
 * enrollment signal: an engine serving the enrollment flow has its ingest
 * certificate sorted for the token path; one with it off reports its own
 * hint, which the dialog shows verbatim.
 */
export function stepStatuses(facts: OnboardingFacts): Record<StepId, StepStatus> {
  const enroll = facts.enroll
  return {
    acceso: 'info',
    certificado: enroll ? (enroll.enabled ? 'hecho' : 'aviso') : 'info',
    token: enroll && enroll.usableTokens > 0 ? 'hecho' : 'pendiente',
    sensor: !enroll ? 'pendiente' : enroll.activeHosts > 0 ? 'hecho' : enroll.pendingHosts > 0 ? 'aviso' : 'pendiente',
  }
}

/** The two steps the console can actually verify close the assistant. */
export function allGatesDone(statuses: Record<StepId, StepStatus>): boolean {
  return statuses.token === 'hecho' && statuses.sensor === 'hecho'
}
