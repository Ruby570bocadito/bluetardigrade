#!/usr/bin/env node
// Console accounts for CONSOLE_USERS_FILE (src/lib/users.ts).
//
//   node scripts/console-user.mjs <user> <admin|analyst|viewer>
//       prints one account entry, to paste into the "users" list
//   node scripts/console-user.mjs --file <path> <user> <admin|analyst|viewer>
//       creates the account in the file (and the file), or replaces the
//       password and role of an existing one
//   node scripts/console-user.mjs --file <path> --remove <user>
//
// The password is read from the terminal (or from stdin when piped) and
// only its PBKDF2-SHA256 hash is stored. The console re-reads the file
// on its own; changing a password or a role, or removing an account,
// ends that account's open sessions.

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
const remove = args[0] === '--remove'
if (remove) args.shift()
const [user, role] = args
if (!user || !USER_RE.test(user) || (remove ? !file || role !== undefined : !ROLES.includes(role))) usage()

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

// readUsers refuses a file it cannot parse rather than overwriting it:
// it may hold accounts the operator wants to keep.
function readUsers() {
  if (!existsSync(file)) return []
  const doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  if (!doc || !Array.isArray(doc.users)) throw new Error(`${file} no tiene la forma {"users": [...]}; corrígelo a mano`)
  return doc.users
}

// writeUsers replaces the file in one rename, so the console never
// reads it half written (and a missing file never locks it).
function writeUsers(users) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
}

try {
  if (!file) {
    console.log(JSON.stringify(entryFor(await readPassword())))
  } else if (remove) {
    const users = readUsers()
    const kept = users.filter((u) => u?.user !== user)
    if (kept.length === users.length) throw new Error(`no hay ninguna cuenta ${user}`)
    // an empty file locks the console (users.ts): going back to a console
    // without accounts is deleting the file, a step of its own
    if (kept.length === 0) throw new Error(`${user} es la última cuenta; para volver a la consola sin cuentas borra ${file} y reinicia la consola`)
    if (!kept.some((u) => u?.role === 'admin')) console.error('aviso: no queda ninguna cuenta admin (la respuesta activa y la auditoría solo las ve un admin)')
    writeUsers(kept)
    console.error(`cuenta ${user} eliminada; sus sesiones abiertas terminan`)
  } else {
    const users = readUsers()
    const entry = entryFor(await readPassword())
    const at = users.findIndex((u) => u?.user === user)
    if (at >= 0) users[at] = entry
    else users.push(entry)
    writeUsers(users)
    console.error(at >= 0 ? `cuenta ${user} actualizada (${role}); sus sesiones abiertas terminan` : `cuenta ${user} creada (${role})`)
  }
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(1)
}
