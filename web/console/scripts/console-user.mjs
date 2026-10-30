#!/usr/bin/env node
// Console accounts for CONSOLE_USERS_FILE (src/lib/users.ts).
//
//   node scripts/console-user.mjs <user> <admin|analyst|viewer>
//       prints one account entry, to paste into the "users" list
//   node scripts/console-user.mjs --file <path> <user> <admin|analyst|viewer>
//       creates the account in the file (and the file), or replaces the
//       password and role of an existing one (its two-step sign-in stays,
//       a password change an administrator asked for is no longer due)
//   node scripts/console-user.mjs --file <path> --remove <user>
//   node scripts/console-user.mjs --file <path> --reset-mfa <user>
//       removes the account's two-step sign-in (a lost phone); with a
//       role that requires it, the next sign-in enrolls again
//   node scripts/console-user.mjs --file <path> --require-mfa <roles|none>
//       roles that must use two-step sign-in, e.g. admin,analyst
//   node scripts/console-user.mjs --file <path> --groups <user> <groups|none>
//       the engine host groups the account is limited to, e.g.
//       madrid,servidores (none: every machine; administrators always
//       see every machine)
//
// The password is read from the terminal (or from stdin when piped) and
// only its PBKDF2-SHA256 hash is stored. On a terminal the rules come
// first and a mistyped pair (or a too-short password) is asked again,
// up to three times, instead of failing the whole command; every
// question is a whole line of its own, because a prompt left mid-line
// can stay invisible until Enter under Windows PowerShell. Piped, one
// password is read, no repetition. The console re-reads the file
// on its own; changing a password, a role, the groups or the two-step
// sign-in, or removing an account, ends that account's open sessions. Account names
// compare without case, as in the console.

import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const ITERATIONS = 310_000
// the console's own minimum (lib/login.ts, lib/accounts.ts)
const MIN_PASSWORD = 12
// how many times a terminal attempt is repeated before giving up
const PASSWORD_TRIES = 3
const USER_RE = /^[\p{L}\p{N}._@-]{1,64}$/u
const ROLES = ['admin', 'analyst', 'viewer']
// the engine's group names (internal/hostgroup) and the console's cap
const GROUP_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MAX_GROUPS = 64
const USAGE = [
  'uso: node scripts/console-user.mjs <usuario> <admin|analyst|viewer>',
  '     node scripts/console-user.mjs --file <ruta> <usuario> <admin|analyst|viewer>',
  '     node scripts/console-user.mjs --file <ruta> --remove <usuario>',
  '     node scripts/console-user.mjs --file <ruta> --reset-mfa <usuario>',
  '     node scripts/console-user.mjs --file <ruta> --require-mfa <admin,analyst,viewer|none>',
  '     node scripts/console-user.mjs --file <ruta> --groups <usuario> <grupo,grupo|none>',
].join('\n')

function usage() {
  console.error(USAGE)
  process.exit(2)
}

const args = process.argv.slice(2)
let file = ''
if (args[0] === '--file') {
  file = args[1] ?? ''
  args.splice(0, 2)
  if (!file) usage()
}
const command = ['--remove', '--reset-mfa', '--require-mfa', '--groups'].includes(args[0]) ? args.shift() : 'set'
if (command !== 'set' && (!file || args.length !== (command === '--groups' ? 2 : 1))) usage()
const [user, role] = args
let groups = []
if (command === '--groups') {
  groups = role === 'none' ? [] : [...new Set(role.split(',').map((g) => g.trim().toLowerCase()))]
  if ((!groups.length && role !== 'none') || groups.length > MAX_GROUPS || !groups.every((g) => GROUP_RE.test(g))) {
    console.error('grupos no válidos: nombres en minúsculas, cifras, - y _ separados por comas (o none)')
    process.exit(2)
  }
}
let required = []
if (command === '--require-mfa') {
  required = user === 'none' ? [] : user.split(',').map((r) => r.trim())
  if (!required.length && user !== 'none') usage()
  if (!required.every((r) => ROLES.includes(r))) usage()
} else if (!user || !USER_RE.test(user) || (command === 'set' && !ROLES.includes(role))) usage()
const same = (u) => typeof u?.user === 'string' && u.user.trim().toLowerCase() === user.toLowerCase()

async function readPassword() {
  const tty = Boolean(process.stdin.isTTY)
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: tty })
  // on a terminal every readline drawing — the echo of what is typed,
  // the line redraws — is swallowed: what reaches the screen are only
  // the whole lines ask() writes, never a piece of the password
  if (tty) rl._writeToOutput = () => {}
  // input closed before an answer (Ctrl+Z / Ctrl+D, an empty pipe):
  // fail instead of waiting on a question nobody can answer
  let closed = false
  const pending = new Set()
  rl.on('close', () => {
    closed = true
    for (const reject of pending) reject(new Error('no se recibió ninguna contraseña'))
  })
  const ask = (prompt) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new Error('no se recibió ninguna contraseña'))
      pending.add(reject)
      // a whole line of its own, on screen before the blind typing: a
      // prompt without its newline can stay buffered until Enter under
      // Windows PowerShell, which wraps a native command's stderr line
      // by line — the operator typed without even seeing the question
      process.stderr.write(`${prompt}\n`)
      rl.question('', (answer) => {
        pending.delete(reject)
        // Windows PowerShell 5.1 starts a native command's stdin with a
        // UTF-8 byte-order mark when the console code page is 65001: kept,
        // it would become an invisible first character of the password.
        resolve(answer.replace(/^\uFEFF/, ''))
      })
    })
  try {
    // piped: one password, no repetition (a script knows what it sends)
    if (!tty) {
      const only = await ask(`Contraseña para ${user}:`)
      if (only.length < MIN_PASSWORD) throw new Error(`usa al menos ${MIN_PASSWORD} caracteres`)
      return only
    }
    // interactive: the rules up front, then up to PASSWORD_TRIES
    // attempts — a slip must not fail the whole command (sf-start's
    // first-account flow would re-ask the name otherwise)
    process.stderr.write(`mínimo ${MIN_PASSWORD} caracteres; no se ve mientras la escribes\n`)
    let problem = 'las contraseñas no coinciden'
    for (let attempt = 1; attempt <= PASSWORD_TRIES; attempt++) {
      const first = await ask(`Contraseña para ${user}:`)
      const second = await ask('Repite la contraseña:')
      if (first === second && first.length >= MIN_PASSWORD) return first
      problem = first !== second ? 'las contraseñas no coinciden' : `usa al menos ${MIN_PASSWORD} caracteres`
      if (attempt < PASSWORD_TRIES) {
        process.stderr.write(problem === 'las contraseñas no coinciden'
          ? 'no coinciden: escríbela de nuevo\n'
          : `demasiado corta (${first.length} de ${MIN_PASSWORD}): escríbela de nuevo\n`)
      }
    }
    throw new Error(problem)
  } finally {
    rl.close()
  }
}

function entryFor(password) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  const b64url = (b) => b.toString('base64url')
  return { user, role, password: `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}` }
}

// readDoc refuses a file it cannot parse rather than overwriting it: it
// may hold accounts the operator wants to keep. Every other field (the
// two-step secrets, mfa_required) is written back as it was.
function readDoc() {
  if (!existsSync(file)) return { users: [] }
  const doc = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  if (Array.isArray(doc)) return { users: doc }
  if (!doc || !Array.isArray(doc.users)) throw new Error(`${file} no tiene la forma {"users": [...]}; corrígelo a mano`)
  return doc
}

// writeDoc replaces the file in one rename, so the console never reads
// it half written (and a missing file never locks it).
function writeDoc(doc) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

try {
  if (!file) {
    console.log(JSON.stringify(entryFor(await readPassword())))
  } else if (command === '--remove') {
    const doc = readDoc()
    const gone = doc.users.find(same)
    if (!gone) throw new Error(`no hay ninguna cuenta ${user}`)
    const kept = doc.users.filter((u) => !same(u))
    // an empty file locks the console (users.ts): going back to a console
    // without accounts is deleting the file, a step of its own
    if (kept.length === 0) throw new Error(`${gone.user} es la última cuenta; para volver a la consola sin cuentas borra ${file} y reinicia la consola`)
    if (!kept.some((u) => u?.role === 'admin')) console.error('aviso: no queda ninguna cuenta admin (la respuesta activa y la auditoría solo las ve un admin)')
    writeDoc({ ...doc, users: kept })
    console.error(`cuenta ${gone.user} eliminada; sus sesiones abiertas terminan`)
  } else if (command === '--reset-mfa') {
    const doc = readDoc()
    const account = doc.users.find(same)
    if (!account) throw new Error(`no hay ninguna cuenta ${user}`)
    if (!account.totp) throw new Error(`${account.user} no tiene verificación en dos pasos`)
    delete account.totp
    delete account.recovery
    writeDoc(doc)
    const enrolls = (doc.mfa_required ?? []).includes(account.role)
    console.error(`verificación en dos pasos de ${account.user} quitada; sus sesiones abiertas terminan${enrolls ? ' y al entrar la configurará de nuevo' : ''}`)
  } else if (command === '--groups') {
    const doc = readDoc()
    const account = doc.users.find(same)
    if (!account) throw new Error(`no hay ninguna cuenta ${user}`)
    if (groups.length) account.groups = groups
    else delete account.groups
    writeDoc(doc)
    console.error(groups.length
      ? `${account.user} ve solo los equipos de: ${groups.join(', ')}${account.role === 'admin' ? ' (es admin: seguirá viéndolos todos mientras lo sea)' : ''}; sus sesiones abiertas terminan`
      : `${account.user} ve todos los equipos; sus sesiones abiertas terminan`)
  } else if (command === '--require-mfa') {
    const doc = readDoc()
    if (doc.users.length === 0) throw new Error(`${file} no tiene cuentas`)
    if (required.length) doc.mfa_required = [...new Set(required)]
    else delete doc.mfa_required
    writeDoc(doc)
    const pending = doc.users.filter((u) => required.includes(u?.role) && !u.totp).map((u) => u.user)
    console.error(required.length
      ? `verificación en dos pasos obligatoria para: ${required.join(', ')}${pending.length ? `; la configurarán al entrar: ${pending.join(', ')}` : ''}`
      : 'verificación en dos pasos opcional para todos los roles')
  } else {
    const doc = readDoc()
    const entry = entryFor(await readPassword())
    const at = doc.users.findIndex(same)
    // a new password keeps the account's two-step sign-in; whoever typed
    // it at the terminal chose it, so a pending change is no longer due
    if (at >= 0) {
      doc.users[at] = { ...doc.users[at], ...entry, user: doc.users[at].user }
      delete doc.users[at].must_change
    } else doc.users.push(entry)
    writeDoc(doc)
    console.error(at >= 0 ? `cuenta ${doc.users[at].user} actualizada (${role}); sus sesiones abiertas terminan` : `cuenta ${user} creada (${role})`)
  }
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(1)
}
