import type { NextConfig } from "next";

// Security headers for the operator console. The console renders
// attacker-controllable telemetry (command lines, file paths, registry
// values) fetched from monitored endpoints: React escapes text nodes,
// but defense in depth demands the browser itself refuse anything the
// app did not ask for. CSP notes:
//   - script-src 'unsafe-inline': Next.js ships its bootstrap/flight
//     scripts inline; a nonce pipeline would be the strict upgrade
//     (tracked in the roadmap). The directive still blocks every
//     EXTERNAL script origin.
//   - style-src 'unsafe-inline': Tailwind + component-level inline
//     styles and the reactbits animation keyframes.
// The engine stays same-origin; the local analyst hub has its own port.
// Keep HTTP polling and WebSocket origins aligned with the client URL.
//   - img-src data:: inline chart markers and data URIs.
// X-Frame-Options + frame-ancestors: the console must never be framed
// (clickjacking on a kill-adjacent UI); nosniff and the referrer policy
// round out the baseline.
const hubUrl = new URL(process.env.NEXT_PUBLIC_CONSOLE_URL || 'http://localhost:3003', 'http://localhost:3000')
if (!['http:', 'https:'].includes(hubUrl.protocol)) throw new Error('NEXT_PUBLIC_CONSOLE_URL must use HTTP(S)')
const hubOrigin = hubUrl.origin
const hubSocketOrigin = hubOrigin.replace(/^http/, 'ws')
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      `connect-src 'self' ${hubOrigin} ${hubSocketOrigin}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
