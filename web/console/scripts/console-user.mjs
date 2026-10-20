#!/usr/bin/env node
// Console accounts for CONSOLE_USERS_FILE (src/lib/users.ts).
//
//   node scripts/console-user.mjs <user> <admin|analyst|viewer>
//       prints one account entry, to paste into the "users" list
//   node scripts/console-user.mjs --file <path> <user> <admin|analyst|viewer>
//       creates the account in the file (and the file), or replaces the
//       password and role of an existing one (its two-step sign-in stays)
//   node scripts/console-user.mjs --file <path> --remove <user>
//   node scripts/console-user.mjs --file <path> --reset-mfa <user>
//       removes the account's two-step sign-in (a lost phone); with a
//       role that requires it, the next sign-in enrolls again
//   node scripts/console-user.mjs --file <path> --require-mfa <roles|none>
//       roles that must use two-step sign-in, e.g. admin,analyst
//
// The password is read from the terminal (or from stdin when piped) and
// only its PBKDF2-SHA256 hash is stored. The console re-reads the file
// on its own; changing a password, a role or the two-step sign-in, or
// removing an account, ends that account's open sessions. Account names
// compare without case, as in the console.

import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const ITERATIONS = 310_000
const USER_RE = /^[\p{L}\p{N}._@-]{1,64}$/u
const ROLES = ['admin', 'analyst', 'viewer']
const USAGE = [
  'uso: node scripts/console-user.mjs <usuario> <admin|analyst|viewer>',
  '     node scripts/console-user.mjs --file <ruta> <usuario> <admin|analyst|viewer>',
  '     node scripts/console-user.mjs --file <ruta> --remove <usuario>',
  '     node scripts/console-user.mjs --file <ruta> --reset-mfa <usuario>',
  '     node scripts/console-user.mjs --file <ruta> --require-mfa <admin,analyst,viewer|none>',
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
const command = ['--remove', '--reset-mfa', '--require-mfa'].includes(args[0]) ? args.shift() : 'set'
if (command !== 'set' && (!file || args.length !== 1)) usage()
const [user, role] = args
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
  // on a terminal, prompts are written here and the typed characters
  // are not echoed
  let muted = false
  if (tty) rl._writeToOutput = (s) => { if (!muted) process.stderr.write(s) }
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
      process.stderr.write(prompt)
      muted = true
      rl.question('', (answer) => {
        pending.delete(reject)
        muted = false
        process.stderr.write('\n')
        resolve(answer)
      })
    })
  const first = await ask(`Contraseña para ${user}: `)
  const second = tty ? await ask('Repite la contraseña: ') : first
  rl.close()
  if (first !== second) throw new Error('las contraseñas no coinciden')
  if (first.length < 12) throw new Error('usa al menos 12 caracteres')
  return first
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
    // a new password keeps the account's two-step sign-in
    if (at >= 0) doc.users[at] = { ...doc.users[at], ...entry, user: doc.users[at].user }
    else doc.users.push(entry)
    writeDoc(doc)
    console.error(at >= 0 ? `cuenta ${doc.users[at].user} actualizada (${role}); sus sesiones abiertas terminan` : `cuenta ${user} creada (${role})`)
  }
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(1)
}
