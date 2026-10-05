import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
// it must run before any paint (CSP allows it: script-src 'unsafe-inline').
const themeBoot = `(function(){try{var s=localStorage.getItem('bt-theme');var t=s==='light'||s==='dark'?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');}catch(e){}})()`;

// LANG boot (IDEA-10): resolves the document language before the first
// paint so assistive tech never announces the wrong one. Stored choice
// wins; without one, the browser preference decides; Spanish is the
// default. The same key is what the I18nProvider writes; the React text
// itself catches up right after hydration (the provider applies the
// stored choice on mount, same discipline as the theme toggle).
const langBoot = `(function(){try{var s=localStorage.getItem('bt-lang');var l=(s==='es'||s==='en')?s:((navigator.language||'').toLowerCase().indexOf('en')===0?'en':'es');document.documentElement.lang=l;}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
        <script dangerouslySetInnerHTML={{ __html: langBoot }} />
        {children}
      </body>
    </html>
  );
}
