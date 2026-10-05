// VIZ-6 — export any chart. The pure half (CSV building, file-name
// slugging, SVG style inlining over a structural tree) is unit-tested
// without a DOM; the DOM half (serialization, PNG rasterization and the
// download click) is thin wiring kept for tsc and the browser, and
// degrades with an honest Spanish error when the platform cannot do it.

// ---------- CSV (RFC 4180: quote what needs quoting, CRLF rows) ----------

export function csvCell(value: string | number): string {
  const text = String(value)
  if (/[",\r\n]/.test(text)) return '"' + text.replaceAll('"', '""') + '"'
  return text
}

export function tableToCsv(columns: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return lines.join('\r\n') + '\r\n'
}

// ---------- file names ----------

/** Chart title → safe file base: accents folded, rest dashed, lowercase. */
export function slugFileName(title: string): string {
  const folded = title.normalize('NFD').replaceAll(/[\u0300-\u036f]/g, '')
  return folded
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 60) || 'grafica'
}

// ---------- SVG style inlining (pure, structural) ----------

/** Minimal node contract satisfied by DOM Element and by test doubles. */
export type InlineNode = {
  children: InlineNode[]
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

export type StyleReader = (element: Element) => CSSStyleDeclaration

/** Presentation properties that var() tokens hide from serialization. */
const INLINE_PROPS = ['fill', 'stroke', 'stop-color', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'text-anchor'] as const

function resolvable(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '' && value !== 'none' && !value.includes('var(')
}

/**
 * Walk the original and the clone in lockstep and pin computed
 * presentation values onto the clone, so a serialized <svg> keeps its
 * colors without the page's stylesheet. Unresolvable values (empty,
 * 'none', still var()) are skipped — the DOM wrapper may fall back to
 * literal token values it knows.
 */
export function inlineSvgStyles(original: InlineNode, clone: InlineNode, styleOf: (element: Element) => CSSStyleDeclaration): void {
  const style = styleOf(original as unknown as Element)
  for (const prop of INLINE_PROPS) {
    const value = style.getPropertyValue(prop)
    if (resolvable(value)) clone.setAttribute(prop, value)
  }
  const originals = original.children
  const clones = clone.children
  const shared = Math.min(originals.length, clones.length)
  for (let i = 0; i < shared; i++) inlineSvgStyles(originals[i], clones[i], styleOf)
}

/** Local timestamp for exported files: yyyymmdd-hhmm. */
export function fileStamp(now = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

// ---------- download helpers (DOM wiring) ----------

export function downloadText(text: string, filename: string, mime: string): void {
  if (typeof document === 'undefined') throw new Error('La exportación solo está disponible en el navegador.')
  const link = document.createElement('a')
  link.href = 'data:' + mime + ';charset=utf-8,' + encodeURIComponent(text)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// ---------- serialization and PNG (DOM wiring) ----------

/** Adapter from a live DOM element onto the structural contract. */
function toInlineNode(element: Element): InlineNode {
  return {
    children: Array.from(element.children, toInlineNode),
    getAttribute: (name) => element.getAttribute(name),
    setAttribute: (name, value) => element.setAttribute(name, value),
  }
}

export function serializeChartSvg(svg: SVGSVGElement, styleOf: StyleReader, background: string | null): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const rect = svg.getBoundingClientRect()
  const viewBox = svg.getAttribute('viewBox')
  if (!clone.getAttribute('width') && (rect.width || viewBox)) {
    clone.setAttribute('width', String(rect.width || Number(viewBox?.split(/\s+/)[2]) || 640))
  }
  if (!clone.getAttribute('height') && (rect.height || viewBox)) {
    clone.setAttribute('height', String(rect.height || Number(viewBox?.split(/\s+/)[3]) || 360))
  }
  clone.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet')
  inlineSvgStyles(toInlineNode(svg), toInlineNode(clone), styleOf)
  // Literal fallbacks for the sequential/series ramp when computed styles
  // are unavailable (e.g. pre-render serialization).
  if (!clone.getAttribute('fill')) clone.setAttribute('fill', 'none')
  if (background) clone.setAttribute('style', (clone.getAttribute('style') ? clone.getAttribute('style') + ';' : '') + 'background:' + background)
  return new XMLSerializer().serializeToString(clone)
}

export async function chartToPngDataUrl(
  svg: SVGSVGElement,
  styleOf: StyleReader,
  background: string,
): Promise<string> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('La exportación a PNG solo está disponible en el navegador.')
  }
  const serialized = serializeChartSvg(svg, styleOf, background)
  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || Number(svg.getAttribute('width')) || 640))
  const height = Math.max(1, Math.round(rect.height || Number(svg.getAttribute('height')) || 360))
  const scale = 2
  const source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized)
  const image = new Image()
  image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('La gráfica no se pudo rasterizar.'))
    image.src = source
  })
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Tu navegador no permite exportar PNG de la gráfica.')
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') throw new Error('La exportación solo está disponible en el navegador.')
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}
