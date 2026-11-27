// The bluetardigrade mark: a water bear in profile drawn with one line
// (body and legs in a single stroke, two eyes and a smile). Shared by the
// console (components/v2/logo.tsx) and the server-rendered sign-in pages
// (lib/login.ts), so both draw exactly the same figure.
export const LOGO_VIEWBOX = '0 0 64 52'

export const LOGO_BODY =
  'M9 34C9.5 18 21 6.5 36 6.5C50 6.5 60 14 60.5 24C60.8 30 59.5 34 57 36.5L60.5 41.5C61 42.6 60.2 43.5 59 43.2' +
  'L53.5 41Q51 40.2 48 41.6C48 48.4 44 48.4 44 41.9Q40.6 40.3 37.5 42C37.5 48.6 33.5 48.6 33.5 42.2' +
  'Q30 40.6 27 42.3C27 48.8 23 48.8 23 42.5Q19.6 40.8 16.5 42.5C16.5 48.6 12.5 48.6 12.5 42.7' +
  'C8.5 43.6 4 42.4 4.2 39.4C4.4 36.6 7.6 35.8 9 34Z'

export const LOGO_SMILE = 'M48 23Q51 26 54 22.5'

export const LOGO_EYES: readonly (readonly [number, number])[] = [
  [44, 19],
  [54.5, 15.5],
]

/** The mark's amber, the accent of the dark console. */
export const LOGO_COLOR = '#f5a524'

/** The mark as an inline SVG string (server-rendered pages), in `color`. */
export function logoSvg(width: number, color = LOGO_COLOR): string {
  const height = Math.round((width * 52) / 64)
  const eyes = LOGO_EYES.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.9" fill="${color}"/>`).join('')
  return (
    `<svg viewBox="${LOGO_VIEWBOX}" width="${width}" height="${height}" fill="none" stroke="${color}" stroke-width="3.2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="${LOGO_BODY}"/><path d="${LOGO_SMILE}" stroke-width="2.6"/>${eyes}</svg>`
  )
}
