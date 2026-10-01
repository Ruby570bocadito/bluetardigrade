import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "bluetardigrade — Real-time threat detection for Windows endpoints",
  description:
    "A behavioral detection framework: Rust ETW sensor, Go behavioral engine, YAML rules mapped to MITRE ATT&CK, native Elasticsearch / Splunk SIEM sinks, opt-in audited active response, and a live operator console with AI triage. Measured p99 ingest→alert ≈ 0.4 ms.",
  keywords: [
    "threat detection",
    "EDR",
    "ETW",
    "Sysmon",
    "MITRE ATT&CK",
    "Sigma",
    "SIEM",
    "Elasticsearch",
    "Splunk",
    "Windows security",
    "Go",
    "Rust",
    "open source",
  ],
  openGraph: {
    title: "bluetardigrade — Real-time threat detection for Windows endpoints",
    description:
      "ETW sensor + behavioral engine + operator console. Behavior over signatures, measured performance, explicitly labeled demo data and no fabricated telemetry fallback.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
