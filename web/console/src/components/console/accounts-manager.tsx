'use client'

// Account management for administrators (TEAM-2), inside Ajustes →
// Cuentas: the accounts of the users file with their role and state,
// one row of actions each, and a form for a new account. The server
// (app/api/console/accounts) enforces the role and the two safety rules
// (never your own account, never without an enabled administrator) and
// audits every action; this component only reflects its answers. A new
// account or a reset password comes back with a temporary password,
// shown here once. The "Equipos" column limits an account to engine host
// groups (picked from GET /api/groups); administrators see every machine.

import { useCallback, useEffect, useId, useState } from 'react'
import { ShieldCheck, ShieldWarning, UserPlus } from '@phosphor-icons/react'
import { CopyBox } from './enroll-parts'
import { useI18n } from './i18n-provider'
import { fetchAccounts, postAccountAction, type AccountActionName, type AccountRow } from '@/lib/console-accounts'
import type { ConsoleRole } from '@/lib/console-user'
import { fetchHostGroups, type HostGroup } from '@/lib/host-groups'

const ROLE_ORDER: ConsoleRole[] = ['viewer', 'analyst', 'admin']
const QUIET = 'rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-zinc-100 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
// red, not rose: the light theme remaps the red text steps (globals.css)
const DANGER = 'rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const FIELD = 'h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const BADGE = 'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium'

type RowAction = Exclude<AccountActionName, 'crear' | 'rol' | 'grupos'>

// GroupPicker: one checkbox per engine group, plus the ones the account
// still names but the engine no longer has (so saving can drop them).
function GroupPicker({ legend, available, selected, onChange }: {
  legend: string
  available: HostGroup[] | null
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const { dict } = useI18n()
  const t = dict.settings.cuentas
  const known = new Set((available ?? []).map((g) => g.name))
  const options = [
    ...(available ?? []).map((g) => ({ name: g.name, label: g.label || g.name, missing: false })),
    ...selected.filter((n) => !known.has(n)).map((n) => ({ name: n, label: n, missing: true })),
  ]
  const toggle = (name: string, on: boolean) => onChange(on ? [...selected, name] : selected.filter((n) => n !== name))
  return (
    <fieldset className="min-w-0">
      <legend className="text-[11px] text-zinc-400">{legend}</legend>
      {available === null && <p className="mt-1 text-[11px] text-amber-300">{t.groupsUnavailable}</p>}
      {available !== null && options.length === 0 && <p className="mt-1 text-[11px] text-zinc-500">{t.groupsNone}</p>}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o.name} className="inline-flex items-center gap-1.5 text-xs text-zinc-200">
            <input type="checkbox" checked={selected.includes(o.name)} onChange={(e) => toggle(o.name, e.target.checked)} className="h-3.5 w-3.5 accent-zinc-200" />
            {o.label}
            {o.missing && <span className="text-[10px] text-amber-300">({t.groupsMissing})</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function AccountsManager({ me }: { me: string }) {
  const { dict } = useI18n()
  const t = dict.settings.cuentas
  const [rows, setRows] = useState<AccountRow[] | null>(null)
  const [mfaRequired, setMfaRequired] = useState<ConsoleRole[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [temp, setTemp] = useState<{ user: string; password: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<{ user: string; action: RowAction } | null>(null)
  const [name, setName] = useState('')
  const [role, setRole] = useState<ConsoleRole>('analyst')
  const [newGroups, setNewGroups] = useState<string[]>([])
  // the engine's groups (null: unreadable), and the account whose groups
  // are being edited with its draft
  const [engineGroups, setEngineGroups] = useState<HostGroup[] | null>([])
  const [editingGroups, setEditingGroups] = useState<{ user: string; groups: string[] } | null>(null)
  const nameId = useId()
  const roleId = useId()
  const hintId = useId()

  const errorText = useCallback((code: string) => (t.errors as Record<string, string>)[code] ?? t.errors.red, [t])

  const load = useCallback(async () => {
    const res = await fetchAccounts()
    if (res.ok) {
      setRows(res.accounts)
      setMfaRequired(res.mfaRequired)
    } else {
      setError(errorText(res.error))
    }
  }, [errorText])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void fetchHostGroups().then((res) => setEngineGroups(res.ok ? res.data.groups : null))
  }, [])

  async function run(action: AccountActionName, user: string, newRole?: ConsoleRole, groups?: string[]) {
    setBusy(true)
    setError('')
    setNotice('')
    setConfirming(null)
    const res = await postAccountAction(action, user, newRole, groups)
    setBusy(false)
    if (!res.ok) {
      setError(errorText(res.error))
      if (res.error === 'no-existe') void load()
      return
    }
    // a new password speaks for itself in its own box, kept until
    // dismissed; any other action reports below it
    if (res.password) setTemp({ user: res.user, password: res.password })
    else setNotice(t.done[action](res.user))
    if (action === 'crear') {
      setName('')
      setNewGroups([])
    }
    if (action === 'grupos') setEditingGroups(null)
    void load()
  }

  const roleLabel = (r: ConsoleRole) => t.roles[r]
  const groupLabel = (n: string) => engineGroups?.find((g) => g.name === n)?.label || n
  const isMe = (row: AccountRow) => row.user.toLowerCase() === me.toLowerCase()

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <h4 className="text-xs font-medium text-zinc-100">{t.listHeading}</h4>
      {mfaRequired.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">{t.mfaRequired(mfaRequired.map(roleLabel).join(', '))}</p>}

      {temp && (
        <div role="status" className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5">
          <p className="text-xs font-medium text-amber-100">{t.tempTitle(temp.user)}</p>
          <p className="mt-0.5 text-[11px] text-amber-200/80">{t.tempProse}</p>
          <CopyBox text={temp.password} label={t.copy} />
          <button type="button" onClick={() => setTemp(null)} className={`${QUIET} mt-2`}>{t.dismiss}</button>
        </div>
      )}
      {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-amber-300">{error}</p>}

      {rows === null && !error && <p className="mt-3 text-xs text-zinc-500">{t.loading}</p>}
      {rows && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-white/[0.06]">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-zinc-900/60 text-[11px] text-zinc-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{t.colAccount}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.colRole}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.colGroups}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.colState}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const self = isMe(row)
                const asking = confirming?.user === row.user ? confirming.action : null
                return (
                  <tr key={row.user} className="border-t border-white/[0.04] align-top text-zinc-300">
                    <td className="px-3 py-2 font-medium text-zinc-100">
                      {row.user}
                      {self && <span className="ml-1 font-normal text-zinc-500">({t.you})</span>}
                    </td>
                    <td className="px-3 py-2">
                      {self ? (
                        roleLabel(row.role)
                      ) : (
                        <select
                          aria-label={t.roleAria(row.user)}
                          value={row.role}
                          disabled={busy}
                          onChange={(e) => void run('rol', row.user, e.target.value as ConsoleRole)}
                          className={FIELD}
                        >
                          {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.role === 'admin' ? (
                        <span className="text-zinc-400">{t.groupsAdmin}</span>
                      ) : editingGroups?.user === row.user ? (
                        <form
                          className="space-y-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            void run('grupos', row.user, undefined, editingGroups.groups)
                          }}
                        >
                          <GroupPicker legend={t.groupsLegend(row.user)} available={engineGroups} selected={editingGroups.groups} onChange={(groups) => setEditingGroups({ user: row.user, groups })} />
                          <p className="max-w-[18rem] text-[10px] leading-relaxed text-zinc-500">{t.groupsProse}</p>
                          <div className="flex gap-1.5">
                            <button type="submit" disabled={busy} className={QUIET}>{t.groupsSave}</button>
                            <button type="button" onClick={() => setEditingGroups(null)} className={QUIET}>{t.confirmNo}</button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={row.groups?.length ? 'text-zinc-200' : 'text-zinc-400'}>
                            {row.groups?.length ? row.groups.map(groupLabel).join(', ') : t.groupsAll}
                          </span>
                          {!self && (
                            <button type="button" disabled={busy} aria-label={t.groupsEditAria(row.user)} onClick={() => setEditingGroups({ user: row.user, groups: row.groups ?? [] })} className={QUIET}>
                              {t.groupsEdit}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.disabled
                          ? <span className={`${BADGE} border-zinc-600 text-zinc-400`}>{t.stateDisabled}</span>
                          : <span className={`${BADGE} border-emerald-400/30 text-emerald-200`}>{t.stateActive}</span>}
                        {row.must_change && <span className={`${BADGE} border-amber-400/30 text-amber-200`}>{t.stateTemp}</span>}
                        {row.mfa && <span className={`${BADGE} border-emerald-400/30 text-emerald-200`}><ShieldCheck size={10} aria-hidden />{t.stateMfa}</span>}
                        {!row.mfa && row.mfa_required && <span className={`${BADGE} border-amber-400/30 text-amber-200`}><ShieldWarning size={10} aria-hidden />{t.stateMfaPending}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {self ? (
                        <span className="text-[11px] text-zinc-600">—</span>
                      ) : asking ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-zinc-300">{t.confirm(t.actions[asking], row.user)}</span>
                          <button type="button" disabled={busy} onClick={() => void run(asking, row.user)} className={DANGER}>{t.confirmYes}</button>
                          <button type="button" onClick={() => setConfirming(null)} className={QUIET}>{t.confirmNo}</button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" disabled={busy} onClick={() => setConfirming({ user: row.user, action: 'restablecer' })} className={QUIET}>{t.actions.restablecer}</button>
                          {row.disabled
                            ? <button type="button" disabled={busy} onClick={() => void run('habilitar', row.user)} className={QUIET}>{t.actions.habilitar}</button>
                            : <button type="button" disabled={busy} onClick={() => setConfirming({ user: row.user, action: 'deshabilitar' })} className={QUIET}>{t.actions.deshabilitar}</button>}
                          {row.mfa && <button type="button" disabled={busy} onClick={() => setConfirming({ user: row.user, action: 'quitar-mfa' })} className={QUIET}>{t.actions['quitar-mfa']}</button>}
                          <button type="button" disabled={busy} onClick={() => setConfirming({ user: row.user, action: 'eliminar' })} className={DANGER}>{t.actions.eliminar}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) void run('crear', name.trim(), role, role === 'admin' ? [] : newGroups)
        }}
      >
        <div>
          <label htmlFor={nameId} className="block text-[11px] text-zinc-400">{t.newName}</label>
          <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" spellCheck={false} aria-describedby={hintId} className={`${FIELD} mt-1 w-48`} />
        </div>
        <div>
          <label htmlFor={roleId} className="block text-[11px] text-zinc-400">{t.newRole}</label>
          <select id={roleId} value={role} onChange={(e) => setRole(e.target.value as ConsoleRole)} className={`${FIELD} mt-1`}>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <p id={hintId} className="w-full text-[10px] text-zinc-500">{t.newNameHint}</p>
        {role !== 'admin' && (
          <div className="w-full">
            <GroupPicker legend={t.newGroups} available={engineGroups} selected={newGroups} onChange={setNewGroups} />
            <p className="mt-1 text-[10px] text-zinc-500">{t.newGroupsHint}</p>
          </div>
        )}
        <button type="submit" disabled={busy || !name.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-100 px-3 text-xs font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <UserPlus size={14} aria-hidden /> {t.create}
        </button>
      </form>
    </div>
  )
}
