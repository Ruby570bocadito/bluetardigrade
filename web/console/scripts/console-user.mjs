#!/usr/bin/env node
// Prints one account entry for CONSOLE_USERS_FILE (src/lib/users.ts):
//
//   bun scripts/console-user.mjs <user> <admin|analyst|viewer>
//
// The password is read from the terminal (or from stdin when piped) and
// only its PBKDF2-SHA256 hash is printed. Paste the entry into the
// "users" list of the file; the console re-reads it on its own.

import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

const ITERATIONS = 310_000
const [user, role] = process.argv.slice(2)
if (!user || !/^[\p{L}\p{N}._@-]{1,64}$/u.test(user) || !['admin', 'analyst', 'viewer'].includes(role)) {
  console.error('uso: bun scripts/console-user.mjs <usuario> <admin|analyst|viewer>')
  process.exit(2)
}

async function readPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY })
  if (process.stdin.isTTY) {
    // hide what is typed
    rl._writeToOutput = (s) => { if (s.includes('Contraseña')) process.stderr.write(s) }
  }
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve))
  const first = await ask('Contraseña: ')
  const second = process.stdin.isTTY ? await ask('\nRepite la contraseña: ') : first
  rl.close()
  if (process.stdin.isTTY) process.stderr.write('\n')
  if (first !== second) throw new Error('las contraseñas no coinciden')
  if (first.length < 12) throw new Error('usa al menos 12 caracteres')
  return first
}

try {
  const password = await readPassword()
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  const b64url = (b) => b.toString('base64url')
  console.log(JSON.stringify({ user, role, password: `pbkdf2-sha256$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}` }))
} catch (err) {
  console.error(String(err?.message ?? err))
  process.exit(1)
}
