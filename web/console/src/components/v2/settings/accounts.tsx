'use client'

// Ajustes · Cuentas y roles: the console accounts (an administrator's
// view of the users file) with their role, state, two-step sign-in and
// the host groups each is limited to; one row of actions each and a form
// for a new account, whose temporary password is shown once. The console
// service enforces the role and its safety rules (never your own account,
// never without an enabled administrator) and audits every action; this
// view only reflects its answers.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Copy } from '@phosphor-icons/react'
import { useI18n } from '@/components/console/i18n-provider'
import { useConsoleUser } from '@/components/console/user-session'
import { fetchAccounts, postAccountAction, type AccountActionName, type AccountRow } from '@/lib/console-accounts'
import { roleText, type ConsoleRole } from '@/lib/console-user'
import { fetchHostGroups, type HostGroupWithMembers } from '@/lib/host-groups'
import { Empty } from '../home/parts'
import { Group, Notice } from './parts'

const ROLES: ConsoleRole[] = ['admin', 'analyst', 'viewer']
type RowAction = Exclude<AccountActionName, 'crear' | 'rol' | 'grupos'>

export function Accounts({ onNotice }: { onNotice: (message: string) => void }) {
  const { dict, lang } = useI18n()
  const t = dict.v2.settingsView
  const c = dict.settings.cuentas
  const me = useConsoleUser()
  const [rows, setRows] = useState<AccountRow[] | null>(null)
  const [mfaRequired, setMfaRequired] = useState<ConsoleRole[]>([])
  const [groups, setGroups] = useState<HostGroupWithMembers[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<{ user: string; action: RowAction } | null>(null)
  const [editing, setEditing] = useState<{ user: string; groups: string[] } | null>(null)
  const [temp, setTemp] = useState<{ user: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<ConsoleRole>('analyst')
  const [newGroups, setNewGroups] = useState<string[]>([])
  const errorText = useCallback((code: string) => (c.errors as Record<string, string>)[code] ?? c.errors.red, [c])

  const load = useCallback(async () => {
    const res = await fetchAccounts()
    if (res.ok) {
      setRows(res.accounts)
      setMfaRequired(res.mfaRequired)
      setError('')
    } else setError(errorText(res.error))
  }, [errorText])

  useEffect(() => {
    if (me.pending || me.mode !== 'users' || me.role !== 'admin') return
    void load()
    void fetchHostGroups().then((r) => r.ok && setGroups(r.data.groups))
  }, [me.pending, me.mode, me.role, load])

  async function act(action: AccountActionName, user: string, nextRole?: ConsoleRole, nextGroups?: string[]) {
    setBusy(true)
    const res = await postAccountAction(action, user, nextRole, nextGroups)
    setBusy(false)
    setConfirming(null)
    if (!res.ok) {
      setError(errorText(res.error))
      if (res.error === 'no-existe') void load()
      return
    }
    setError('')
    if (res.password) {
      setTemp({ user: res.user, password: res.password })
      setCopied(false)
    }
    onNotice(c.done[action](res.user))
    void load()
  }

  if (me.pending) return <p className="v2-small v2-dim">{t.states.loading}</p>
  if (me.mode !== 'users')
    return (
      <Empty title={t.acNoUsers}>
        {me.mode === 'token' ? c.modeToken : c.modeOpen}. {c.manageProse}
      </Empty>
    )
  if (me.role !== 'admin') return <Empty title={c.nonAdminProse} />

  const groupNames = groups.map((g) => g.name)
  const groupLabel = (n: string) => groups.find((g) => g.name === n)?.label || n

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    void act('crear', name.trim(), role, role === 'admin' ? [] : newGroups)
    setName('')
    setNewGroups([])
  }

  return (
    <div className="v2-set-two v2-acc">
      <div className="v2-set-col">
        <Group id="v2-acc-list" title={c.listHeading} hint={mfaRequired.length > 0 ? c.mfaRequired(mfaRequired.map((r) => roleText(r, lang)).join(', ')) : undefined}>
          {error && <Notice tone="error">{error}</Notice>}
          {temp && (
            <div className="v2-acc-temp" role="status">
              <strong>{c.tempTitle(temp.user)}</strong>
              <span className="v2-small">{c.tempProse}</span>
              <div className="v2-acc-temp-row">
                <code className="v2-mono">{temp.password}</code>
                <button
                  type="button"
                  className="v2-btn"
                  onClick={() => void navigator.clipboard?.writeText(temp.password).then(() => setCopied(true))}
                >
                  <Copy aria-hidden="true" />
                  {copied ? c.copied : c.copy}
                </button>
                <button type="button" className="v2-btn" onClick={() => setTemp(null)}>
                  {c.dismiss}
                </button>
              </div>
            </div>
          )}
          {rows === null ? (
            <p className="v2-small v2-dim">{c.loading}</p>
          ) : (
            <ul className="v2-acc-list">
              {rows.map((r) => {
                const self = r.user === me.name
                return (
                  <li key={r.user} className="v2-acc-row" data-disabled={r.disabled}>
                    <div className="v2-acc-main">
                      <strong className="v2-mono">{r.user}</strong>
                      {self && <span className="v2-tag">{c.you}</span>}
                      <span className="v2-acc-chips">
                        <span className="v2-acc-chip" data-on={!r.disabled}>
                          {r.disabled ? c.stateDisabled : c.stateActive}
                        </span>
                        {r.must_change && <span className="v2-acc-chip">{c.stateTemp}</span>}
                        {r.mfa ? (
                          <span className="v2-acc-chip" data-on="true">
                            {c.stateMfa}
                          </span>
                        ) : (
                          r.mfa_required && (
                            <span className="v2-acc-chip" data-warn="true">
                              {c.stateMfaPending}
                            </span>
                          )
                        )}
                      </span>
                    </div>
                    <label className="v2-select">
                      <span className="v2-sr-only">{c.roleAria(r.user)}</span>
                      <select value={r.role} disabled={self || busy} onChange={(e) => void act('rol', r.user, e.target.value as ConsoleRole)}>
                        {ROLES.map((x) => (
                          <option key={x} value={x}>
                            {roleText(x, lang)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="v2-acc-groups v2-small">
                      {r.role === 'admin' ? (
                        <span className="v2-dim">{c.groupsAdmin}</span>
                      ) : (
                        <>
                          <span>{(r.groups ?? []).length ? (r.groups ?? []).map(groupLabel).join(', ') : c.groupsAll}</span>
                          {!self && (
                            <button type="button" className="v2-link" aria-label={c.groupsEditAria(r.user)} onClick={() => setEditing({ user: r.user, groups: r.groups ?? [] })}>
                              {c.groupsEdit}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {!self && (
                      <div className="v2-acc-actions">
                        {confirming?.user === r.user ? (
                          <>
                            <span className="v2-small">{c.confirm(c.actions[confirming.action], r.user)}</span>
                            <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void act(confirming.action, r.user)}>
                              {c.confirmYes}
                            </button>
                            <button type="button" className="v2-btn" onClick={() => setConfirming(null)}>
                              {c.confirmNo}
                            </button>
                          </>
                        ) : (
                          (
                            [
                              'restablecer',
                              r.disabled ? 'habilitar' : 'deshabilitar',
                              ...(r.mfa ? (['quitar-mfa'] as RowAction[]) : []),
                              'eliminar',
                            ] as RowAction[]
                          ).map((a) => (
                            <button key={a} type="button" className="v2-link v2-small" data-danger={a === 'eliminar'} onClick={() => setConfirming({ user: r.user, action: a })}>
                              {c.actions[a]}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    {editing?.user === r.user && (
                      <fieldset className="v2-acc-edit">
                        <legend className="v2-small">{c.groupsLegend(r.user)}</legend>
                        {groupNames.length === 0 ? (
                          <p className="v2-small v2-dim">{c.groupsNone}</p>
                        ) : (
                          groupNames.map((g) => (
                            <label key={g} className="v2-check">
                              <input
                                type="checkbox"
                                checked={editing.groups.includes(g)}
                                onChange={(e) => setEditing({ ...editing, groups: e.target.checked ? [...editing.groups, g] : editing.groups.filter((x) => x !== g) })}
                              />
                              {groupLabel(g)}
                            </label>
                          ))
                        )}
                        <p className="v2-small v2-dim">{c.groupsProse}</p>
                        <div className="v2-actions">
                          <button type="button" className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void act('grupos', r.user, undefined, editing.groups).then(() => setEditing(null))}>
                            {c.groupsSave}
                          </button>
                          <button type="button" className="v2-btn" onClick={() => setEditing(null)}>
                            {c.confirmNo}
                          </button>
                        </div>
                      </fieldset>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Group>
      </div>
      <div className="v2-set-col">
        <Group id="v2-acc-new" title={c.newHeading}>
          <form className="v2-set-form" onSubmit={submit}>
            <label className="v2-field">
              <span>{c.newName}</span>
              <input className="v2-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} pattern="[A-Za-z0-9._@\-]+" required autoComplete="off" />
              <small className="v2-dim">{c.newNameHint}</small>
            </label>
            <label className="v2-field">
              <span>{c.newRole}</span>
              <select className="v2-input" value={role} onChange={(e) => setRole(e.target.value as ConsoleRole)}>
                {ROLES.map((x) => (
                  <option key={x} value={x}>
                    {roleText(x, lang)}
                  </option>
                ))}
              </select>
            </label>
            {role !== 'admin' && groupNames.length > 0 && (
              <fieldset className="v2-acc-edit">
                <legend className="v2-small">{c.newGroups}</legend>
                {groupNames.map((g) => (
                  <label key={g} className="v2-check">
                    <input type="checkbox" checked={newGroups.includes(g)} onChange={(e) => setNewGroups(e.target.checked ? [...newGroups, g] : newGroups.filter((x) => x !== g))} />
                    {groupLabel(g)}
                  </label>
                ))}
                <p className="v2-small v2-dim">{c.newGroupsHint}</p>
              </fieldset>
            )}
            <button type="submit" className="v2-btn v2-btn-primary" disabled={busy || !name.trim()}>
              {c.create}
            </button>
          </form>
        </Group>
      </div>
    </div>
  )
}
