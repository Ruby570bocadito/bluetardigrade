import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-policy";

// Two ways to ship the same landing page:
// - by default, the standalone server, which sends the security headers;
// - with PAGES_BASE_PATH set (the Pages workflow passes the repository
//   path, e.g. /bluetardigrade), a static export for GitHub Pages under
//   that path. Pages sends no custom headers, so the layout carries the
//   CSP as a <meta> there.
const pagesBasePath = process.env.PAGES_BASE_PATH;

const nextConfig: NextConfig =
  pagesBasePath !== undefined
    ? {
        output: "export",
        basePath: pagesBasePath,
        trailingSlash: true,
        reactStrictMode: true,
        env: { NEXT_PUBLIC_BASE_PATH: pagesBasePath },
      }
    : {
        output: "standalone",
        reactStrictMode: true,
        async headers() {
          return [{ source: "/:path*", headers: SECURITY_HEADERS }];
        },
      };

export default nextConfig;
