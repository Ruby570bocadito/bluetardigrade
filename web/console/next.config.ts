import type { NextConfig } from "next";

// Security headers for the operator console. The console renders
// attacker-controllable telemetry (command lines, file paths, registry
// values) fetched from monitored endpoints: React escapes text nodes,
// but defense in depth demands the browser itself refuse anything the
// app did not ask for.
//
// The Content-Security-Policy is NOT set here: it is minted per request
// by the access proxy (src/proxy.ts), which signs the bootstrap with a
// nonce in production ('strict-dynamic'). Two CSP headers intersect, so
// a static copy here would re-break every nonce it does not know about.
// The remaining headers below are static by nature.
//
// X-Frame-Options + frame-ancestors (in the proxy's policy and here):
// the console must never be framed (clickjacking on a kill-adjacent
// UI); nosniff and the referrer policy round out the baseline.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // No framework/version fingerprint on the wire (sesión 100agentes-2,
  // agente 12): the Go API sends no Server header either.
  poweredByHeader: false,
  // Browser source maps for the production chunks: when an operator's
  // browser logs a console error, the trace arrives symbolized instead
  // of minified (Lighthouse best-practices: valid-source-maps). Maps
  // are fetched only when DevTools opens — zero runtime cost, no
  // effect on the bundle baseline (they are not executed).
  productionBrowserSourceMaps: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
