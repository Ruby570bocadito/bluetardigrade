// Web app manifest (F3): the console installs as an app on a phone or a
// desktop, opening on the phone view. Public by design (src/proxy.ts):
// the browser fetches it without the session cookie, and it says nothing
// the sign-in page does not. Installing needs HTTPS or localhost — the
// console reached through the company's VPN or a TLS front end
// (docs/OPERATIONS.md, "The console on a phone").

import type { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'bluetardigrade · Consola SOC',
    short_name: 'bluetardigrade',
    description: 'Alertas, incidentes y equipos del SOC desde el móvil.',
    id: '/movil',
    start_url: '/movil',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#070b12',
    theme_color: '#0b1220',
    lang: 'es',
    categories: ['security', 'business', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Alertas críticas', url: '/movil', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Consola completa', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
