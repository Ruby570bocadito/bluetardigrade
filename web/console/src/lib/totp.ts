// Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP), the
// codes of any authenticator app: HMAC-SHA1, 6 digits, 30-second steps.
// Server-only. The secret is 20 random bytes, shown to the operator in
// base32 (RFC 4648, no padding) and inside an otpauth:// URI.

const STEP_SECONDS = 30
const DIGITS = 6
// one step either side: a phone clock a little off, or a code typed
// just as it rolled over
const WINDOW = 1
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let out = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += B32[(buffer >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(buffer << (5 - bits)) & 31]
  return out
}

// base32Decode accepts what an operator might paste back: lower case,
// spaces and padding. null when anything else is in it.
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]/g, '').toUpperCase()
  if (!/^[A-Z2-7]*$/.test(clean)) return null
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const c of clean) {
    buffer = (buffer << 5) | B32.indexOf(c)
    bits += 5
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)))
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS)
}

export async function hotp(key: Uint8Array, counter: number): Promise<string> {
  const message = new Uint8Array(8)
  // counters stay far below 2^53: split into two 32-bit halves
  new DataView(message.buffer).setUint32(0, Math.floor(counter / 2 ** 32))
  new DataView(message.buffer).setUint32(4, counter >>> 0)
  const hmacKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message))
  const offset = mac[mac.length - 1] & 15
  const binary = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

// matchTotp returns the step a 6-digit code belongs to (within the
// window around now), or null. Every candidate is computed and compared
// whole, so the answer time does not depend on where a code matched.
export async function matchTotp(secret: string, code: string, now = Date.now()): Promise<number | null> {
  const key = base32Decode(secret)
  const typed = code.replace(/\s/g, '')
  if (!key || key.length < 10 || !/^\d{6}$/.test(typed)) return null
  const step = totpStep(now)
  let found: number | null = null
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const candidate = await hotp(key, step + delta)
    let diff = 0
    for (let i = 0; i < DIGITS; i++) diff |= candidate.charCodeAt(i) ^ typed.charCodeAt(i)
    if (diff === 0 && found === null) found = step + delta
  }
  return found
}

// otpauthUri is what the QR code carries: authenticator apps read the
// issuer and the account name from it.
export function otpauthUri(secret: string, account: string, issuer = 'bluetardigrade'): string {
  const label = encodeURIComponent(issuer) + ':' + encodeURIComponent(account)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
}

// groupSecret prints the secret in blocks of four for typing it by hand.
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}
