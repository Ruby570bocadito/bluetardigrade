// A minimal QR Code encoder (ISO/IEC 18004, model 2) for the one thing
// the console shows as a QR: the otpauth:// URI of a two-step sign-in
// enrollment. Byte mode, error correction level M, versions 1 to 20
// (up to 666 bytes), automatic mask. Output is an SVG string drawn on
// the server, so the sign-in pages stay script-free and no QR library
// joins the dependency graph.
//
// The structure follows the reference algorithm of the standard (and
// the widely used Nayuki implementation): data and Reed-Solomon
// codewords per block, interleaving, zigzag placement, the eight masks
// scored by the four penalty rules.

const MAX_VERSION = 20
// level M, indexed by version (index 0 unused)
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]
// format bits of level M
const ECL_M = 0

type Matrix = { size: number; dark: boolean[][]; fixed: boolean[][] }

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * NUM_BLOCKS[version]
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const size = version * 4 + 17
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

// ---- Reed-Solomon over GF(2^8), primitive polynomial 0x11D -------------

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor) })
  }
  return result
}

// ---- codewords ------------------------------------------------------------

function encodeData(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCodewords(version) * 8
  const bits: number[] = []
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))
  return out
}

function withEccInterleaved(data: number[], version: number): number[] {
  const blocks = NUM_BLOCKS[version]
  const eccLen = ECC_PER_BLOCK[version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - (rawCodewords % blocks)
  const shortLen = Math.floor(rawCodewords / blocks)
  const divisor = rsDivisor(eccLen)
  const all: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const dataLen = shortLen - eccLen + (i < shortBlocks ? 0 : 1)
    const block = data.slice(k, k + dataLen)
    k += dataLen
    const ecc = rsRemainder(block, divisor)
    // short blocks get a placeholder so every column lines up
    if (i < shortBlocks) block.push(-1)
    all.push(block.concat(ecc))
  }
  const out: number[] = []
  for (let i = 0; i < all[0].length; i++) {
    for (const block of all) if (block[i] !== -1) out.push(block[i])
  }
  return out
}

// ---- matrix -----------------------------------------------------------------

function emptyMatrix(version: number): Matrix {
  const size = version * 4 + 17
  const grid = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  return { size, dark: grid(), fixed: grid() }
}

function setFixed(m: Matrix, x: number, y: number, dark: boolean) {
  m.dark[y][x] = dark
  m.fixed[y][x] = true
}

function drawFunctionPatterns(m: Matrix, version: number) {
  const { size } = m
  for (let i = 0; i < size; i++) {
    setFixed(m, 6, i, i % 2 === 0)
    setFixed(m, i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        setFixed(m, x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  const pos = alignmentPositions(version)
  const last = pos.length - 1
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      // the three corners hold finder patterns
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFixed(m, pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  drawFormatBits(m, 0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFixed(m, a, b, bit)
      setFixed(m, b, a, bit)
    }
  }
}

function drawFormatBits(m: Matrix, mask: number) {
  const { size } = m
  const data = (ECL_M << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((data << 10) | rem) ^ 0x5412
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) setFixed(m, 8, i, bit(i))
  setFixed(m, 8, 7, bit(6))
  setFixed(m, 8, 8, bit(7))
  setFixed(m, 7, 8, bit(8))
  for (let i = 9; i < 15; i++) setFixed(m, 14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) setFixed(m, size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) setFixed(m, 8, size - 15 + i, bit(i))
  // the dark module
  setFixed(m, 8, size - 8, true)
}

function drawCodewords(m: Matrix, codewords: number[]) {
  const { size } = m
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!m.fixed[y][x] && i < codewords.length * 8) {
          m.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function applyMask(m: Matrix, mask: number) {
  const rule = MASKS[mask]
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) if (!m.fixed[y][x] && rule(x, y)) m.dark[y][x] = !m.dark[y][x]
  }
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
]

function penalty(m: Matrix): number {
  const { size, dark } = m
  let score = 0
  const lines: boolean[][] = []
  for (let i = 0; i < size; i++) {
    lines.push(dark[i])
    lines.push(dark.map((row) => row[i]))
  }
  for (const line of lines) {
    // rule 1: runs of five or more
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    // rule 3: finder-like patterns
    for (let i = 0; i + 11 <= size; i++) {
      for (const pattern of FINDER_LIKE) if (pattern.every((v, k) => line[i + k] === v)) score += 40
    }
  }
  // rule 2: 2x2 blocks of one color
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = dark[y][x]
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3
    }
  }
  // rule 4: balance of dark and light
  const total = size * size
  const darkCount = dark.reduce((acc, row) => acc + row.filter(Boolean).length, 0)
  score += Math.floor(Math.abs(darkCount * 100 / total - 50) / 5) * 10
  return score
}

// qrMatrix encodes text as UTF-8 at the smallest version that holds it.
// mask forces one (tests); null when the text does not fit version 20.
export function qrMatrix(text: string, mask?: number): boolean[][] | null {
  const bytes = new TextEncoder().encode(text)
  let version = 1
  while (version <= MAX_VERSION && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version++
  if (version > MAX_VERSION) return null
  const codewords = withEccInterleaved(encodeData(bytes, version), version)
  const base = emptyMatrix(version)
  drawFunctionPatterns(base, version)
  drawCodewords(base, codewords)
  let best: Matrix | null = null
  let bestScore = Infinity
  for (const candidate of mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [mask]) {
    const m: Matrix = { size: base.size, dark: base.dark.map((r) => r.slice()), fixed: base.fixed }
    applyMask(m, candidate)
    drawFormatBits(m, candidate)
    const score = mask === undefined ? penalty(m) : 0
    if (score < bestScore) {
      best = m
      bestScore = score
    }
  }
  return best ? best.dark : null
}

// qrSvg draws the matrix with the 4-module quiet zone the standard asks
// for, dark on white whatever the theme (scanners expect it).
export function qrSvg(text: string, opts: { title?: string; pixels?: number } = {}): string | null {
  const matrix = qrMatrix(text)
  if (!matrix) return null
  const quiet = 4
  const size = matrix.length + quiet * 2
  let path = ''
  matrix.forEach((row, y) => row.forEach((on, x) => { if (on) path += `M${x + quiet} ${y + quiet}h1v1h-1z` }))
  const px = opts.pixels ?? size * 5
  const title = opts.title ? `<title>${opts.title.replace(/[&<>"']/g, '')}</title>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img">${title}<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
