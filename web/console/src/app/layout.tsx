import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "bluetardigrade · Consola SOC",
  description:
    "Consola de operaciones de seguridad en tiempo real: telemetría del sensor, reglas YAML, triage de alertas MITRE ATT&CK y export JSONL/CSV.",
  keywords: ["EDR", "detección de amenazas", "SOC", "MITRE ATT&CK", "telemetría"],
};

// THEME boot: resolves the theme before the first paint so the console
// never flashes the wrong one. Stored choice wins; without one, the OS
// preference decides. Dark stays the server-rendered default (and the
// no-JS outcome); the same key is what ThemeToggle writes. Inline because
// it must run before any paint; the access proxy's per-request nonce
// (src/proxy.ts) is what makes that legal under the production CSP.
const themeBoot = `(function(){try{var s=localStorage.getItem('bt-theme');var t=s==='light'||s==='dark'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');}catch(e){}})()`;

// LANG boot (IDEA-10): resolves the document language before the first
// paint so assistive tech never announces the wrong one. Stored choice
// wins; without one, the browser preference decides; Spanish is the
// default. The same key is what the I18nProvider writes; the React text
// itself catches up right after hydration (the provider applies the
// stored choice on mount, same discipline as the theme toggle). Signed
// by the same per-request nonce as the theme boot.
const langBoot = `(function(){try{var s=localStorage.getItem('bt-lang');var l=(s==='es'||s==='en')?s:((navigator.language||'').toLowerCase().indexOf('en')===0?'en':'es');document.documentElement.lang=l;}catch(e){}})()`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Minted per request by the access proxy; the CSP nonce signs the
  // inline theme boot (the only hand-written script in the tree).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: langBoot }} />
        {children}
      </body>
    </html>
  );
}
