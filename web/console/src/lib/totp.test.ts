import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { qrMatrix, qrSvg } from './qr'
import { base32Decode, base32Encode, groupSecret, hotp, matchTotp, newTotpSecret, otpauthUri, totpStep } from './totp'

// RFC 6238 appendix B: the SHA-1 seed is the ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'))
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
]

test('HOTP and TOTP match the RFC 4226 and RFC 6238 test vectors', async () => {
  const key = new TextEncoder().encode('12345678901234567890')
  // RFC 4226 appendix D, counters 0 to 9
  const hotpVectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  for (const [counter, code] of hotpVectors.entries()) expect(await hotp(key, counter)).toBe(code)
  // the RFC prints 8 digits; the 6-digit code is their last six
  for (const [seconds, code] of RFC_VECTORS) {
    expect(await hotp(key, totpStep(seconds * 1000))).toBe(code.slice(2))
    expect(await matchTotp(RFC_SECRET, code.slice(2), seconds * 1000)).toBe(totpStep(seconds * 1000))
  }
})

test('a code is accepted one step either side, and only there', async () => {
  const now = 1_111_111_111_000
  const step = totpStep(now)
  const key = base32Decode(RFC_SECRET)!
  for (const delta of [-1, 0, 1]) expect(await matchTotp(RFC_SECRET, await hotp(key, step + delta), now)).toBe(step + delta)
  for (const delta of [-3, -2, 2, 3]) expect(await matchTotp(RFC_SECRET, await hotp(key, step + delta), now)).toBeNull()
  for (const junk of ['', '12345', '1234567', 'abcdef', '12 34 5x']) expect(await matchTotp(RFC_SECRET, junk, now)).toBeNull()
  // spaces typed between the groups are fine
  const code = await hotp(key, step)
  expect(await matchTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step)
  expect(await matchTotp('not base32!', code, now)).toBeNull()
})

test('secrets are 160-bit base32 and survive the round trip a person makes', () => {
  const secret = newTotpSecret()
  expect(secret).toMatch(/^[A-Z2-7]{32}$/)
  expect(newTotpSecret()).not.toBe(secret)
  expect(base32Decode(groupSecret(secret).toLowerCase())).toEqual(base32Decode(secret))
  expect(base32Encode(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
  expect(otpauthUri('ABC', 'José García')).toBe('otpauth://totp/bluetardigrade:Jos%C3%A9%20Garc%C3%ADa?secret=ABC&issuer=bluetardigrade')
})

// SHA-256 of the module rows ("0"/"1", one line per row) produced by the
// segno reference encoder for the same text, byte mode, level M and
// forced mask.
// segno was patched to the standard's padding rule (it appends a zero
// byte when the stream already ends on a codeword boundary); with that,
// all eight masks of versions 1 to 20 matched module for module.
const REFERENCE: [string, number, number, string][] = [
  ['HELLO', 0, 1, 'b664c5ebcc2451fb6630e63f516abd72b3cdfbf16b9ceb0d92d226f6a6d0cde0'],
  ['x'.repeat(25), 1, 2, 'a030eadd417cf26b7dfcca765e24b2a4976c98ddf708aee4ed2784cb42de7d19'],
  ['otpauth://totp/bluetardigrade:ana?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=bluetardigrade', 2, 6, '5c463f281b493eef754a09e6c26d998309a115b3a4a84feb6e1145f7b7b5a003'],
  ['otpauth://totp/bluetardigrade:Jos%C3%A9.Garc%C3%ADa?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=bluetardigrade', 5, 7, 'ae7b351cfcb676757b116e603341abec11fbb674e7888ea5230eb6fc08465fc0'],
  ['Año ñandú 東京 ✓', 3, 2, '87612b2379c268599fbec87920569a137675348893fac9b189d5f277d7dab4a5'],
  ['y'.repeat(200), 4, 10, 'b99c2f219ac7d1634aba98d2d8613c234cee7896fe9a161dae6cae03ceb47770'],
  ['z'.repeat(380), 6, 15, 'c2c20f512d822eebce63dee751e46c69e820bc75b836e1fd820e4c0d07de8ae4'],
  ['w'.repeat(666), 7, 20, '467a781204b86fafc048804b45229b123f7060cdab34b862a42a79e25f4ef5d2'],
]

test('the QR encoder draws the same symbol as the reference encoder', () => {
  for (const [text, mask, version, digest] of REFERENCE) {
    const matrix = qrMatrix(text, mask)!
    expect(matrix.length).toBe(version * 4 + 17)
    const rows = matrix.map((row) => row.map((on) => (on ? '1' : '0')).join('')).join('\n')
    expect(createHash('sha256').update(rows).digest('hex')).toBe(digest)
  }
})

test('the QR svg is self-contained, keeps a quiet zone and refuses what does not fit', () => {
  const svg = qrSvg(otpauthUri(newTotpSecret(), 'ana'), { title: 'Código <QR>' })!
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  // version 6 (41 modules) + 4 quiet modules each side
  expect(svg).toContain('viewBox="0 0 49 49"')
  expect(svg).toContain('<title>Código QR</title>')
  expect(svg).not.toContain('<script')
  expect(qrSvg('w'.repeat(667))).toBeNull()
})
