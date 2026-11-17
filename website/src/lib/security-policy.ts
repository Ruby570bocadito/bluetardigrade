// Security policy of the public landing page, in one place for both ways
// it is served: as HTTP headers by the standalone server (next.config) and,
// on GitHub Pages, where no headers can be set, as a <meta> in the page.
// The page is fully static (no data fetches beyond same-origin assets), so
// the CSP stays tight except for the two inline relaxations Next.js needs
// (bootstrap script, Tailwind/reactbits inline styles + keyframes).

export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
] as const;

export const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES.join("; ") },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** The CSP as a <meta>: frame-ancestors only works as a header, so it is left out. */
export const META_CSP = CSP_DIRECTIVES.filter((d) => !d.startsWith("frame-ancestors")).join("; ");
