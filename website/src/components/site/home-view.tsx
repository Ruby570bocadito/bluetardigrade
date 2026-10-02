"use client";

import { useState } from "react";
import {
  Cpu,
  Workflow,
  MonitorPlay,
  Share2,
  Radio,
  ScanSearch,
  Link2,
  Gauge,
  Radar,
  Layers,
  Server,
  ShieldCheck,
  Database,
  Check,
  X,
  Copy,
  ArrowRight,
  Terminal,
} from "lucide-react";
import {
  SectionTag,
  GitHubButton,
  Reveal,
  Counter,
  TechStrip,
  FaqBlock,
  BigCta,
} from "./chrome";
import { DotGridLayer } from "@/components/reactbits/dot-grid";
import { DecryptedText } from "@/components/reactbits/decrypted-text";
import { ShinyText } from "@/components/reactbits/shiny-text";
import { GradientText } from "@/components/reactbits/gradient-text";
import { StarBorder } from "@/components/reactbits/star-border";
import { SpotlightCard } from "@/components/reactbits/spotlight-card";
import { BlurText } from "@/components/reactbits/blur-text";
import {
  REPO_URL,
  PROJECT_NAME,
  TAGLINE,
  STATS,
  LIVE_DEMO,
  WHY_CARDS,
  GOLDEN_RULE,
  PIPELINE,
  FEATURES,
  QUICKSTART,
  COMPARISON,
  ROADMAP,
  WIN_INSTALL_CMD,
} from "@/lib/site-data";

/* ================= HERO ================= */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* animated canvas backdrop */}
      <div className="pointer-events-none absolute inset-0 opacity-90">
        <DotGridLayer gap={20} radius={190} />
      </div>
      {/* soft color washes over the grid */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-blu/12 blur-[130px]" />
      <div className="pointer-events-none absolute bottom-0 right-[-140px] h-[380px] w-[380px] rounded-full bg-[#2f6fed]/10 blur-[110px]" />

      <div className="relative z-10 mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col items-center justify-center px-5 pb-20 pt-28 text-center">
        <Reveal>
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-blu/30 bg-card/70 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blu" />
            v0.2.0 · open source · Apache-2.0
          </span>
        </Reveal>

        <Reveal delay={100}>
          <h1 className="max-w-5xl font-display text-[clamp(2.8rem,9vw,7rem)] leading-[0.98] tracking-tight text-foreground">
            <DecryptedText
              text={PROJECT_NAME}
              speed={45}
              step={2}
              className="font-display text-blu"
            />
          </h1>
        </Reveal>

        <Reveal delay={260}>
          <div className="mt-5 max-w-3xl text-balance text-lg text-muted-foreground md:text-2xl">
            <ShinyText speed={5} className="font-display italic">
              {TAGLINE}
            </ShinyText>
          </div>
        </Reveal>

        <Reveal delay={380}>
          <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground">
            A Rust ETW sensor, a single Go binary engine with four behavioral
            detectors mapped to MITRE ATT&CK, YAML rules you can read in an
            afternoon — and a live SOC console. Named after the most resilient
            animal on Earth.
          </p>
        </Reveal>

        <Reveal delay={480}>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="#quickstart" className="no-underline">
              <StarBorder
                active
                color="rgba(77, 195, 255, 0.6)"
                speed={5}
                className="rounded-xl"
              >
                <span className="flex items-center gap-2 px-6 py-3 text-sm font-semibold text-foreground">
                  Start on Windows in one command
                  <ArrowRight className="h-4 w-4 text-blu" />
                </span>
              </StarBorder>
            </a>
            <GitHubButton />
          </div>
        </Reveal>

        {/* live console capture — the hero visual */}
        <Reveal delay={600} className="mt-16 w-full">
          <SpotlightCard color="rgba(77, 195, 255, 0.22)" className="rounded-2xl border border-border bg-card/60 p-2 backdrop-blur">
            <div className="overflow-hidden rounded-xl border border-border/70 bg-[#060a10]">
              <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-xs text-muted-foreground">
                  consola SOC · captura archivada de pruebas
                </span>
                <span className="ml-auto flex items-center gap-1.5 rounded-full border border-blu/30 bg-blu/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blu">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blu" />
                  archivo
                </span>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={LIVE_DEMO.gif}
                alt="Archived SOC console capture with generated test inputs"
                className="block w-full"
                width={960}
              />
            </div>
          </SpotlightCard>
          <p className="mx-auto mt-4 max-w-xl text-balance text-xs leading-relaxed text-muted-foreground/70">
            {LIVE_DEMO.caption}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= STATS ================= */

function StatsRow() {
  return (
    <section className="border-y border-border/70 bg-card/30">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-px md:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 90} className="h-full">
            <div className="flex h-full flex-col gap-1 px-6 py-8">
              <span className="font-display text-4xl tracking-tight text-foreground md:text-[2.6rem]">
                <Counter value={s.value} prefix={s.prefix} decimals={s.decimals} suffix={s.suffix} />
              </span>
              <span className="text-sm font-medium text-foreground/85">{s.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground/70">{s.desc}</span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ================= WHY ================= */

function Why() {
  return (
    <section id="why" className="relative scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-5 py-24 md:py-32">
        <Reveal>
          <SectionTag>why it exists</SectionTag>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            <BlurText text="Small enough to audit." stagger={0.03} />
            <br />
            <GradientText colors={["#4dc3ff", "#a7c8ff", "#4dc3ff"]} speed={6}>
              Sharp enough to matter.
            </GradientText>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {WHY_CARDS.map((c, i) => (
            <Reveal key={c.num} delay={i * 120} className="h-full">
              <SpotlightCard color="rgba(77, 195, 255, 0.18)" className="h-full rounded-2xl border border-border bg-card/50 p-6">
                <span className="font-mono text-xs text-blu/80">{c.num}</span>
                <h3 className="mt-3 font-display text-xl text-foreground">{c.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.desc}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <blockquote className="mt-14 rounded-2xl border border-blu/25 bg-blu/[0.05] p-6 md:p-8">
            <p className="font-display text-lg italic leading-relaxed text-foreground/90 md:text-xl">
              “{GOLDEN_RULE}”
            </p>
            <footer className="mt-4 font-mono text-xs text-blu/80">— the golden rule</footer>
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= PIPELINE / ARCHITECTURE ================= */

const PIPELINE_ICONS: Record<string, typeof Cpu> = {
  cpu: Cpu,
  engine: Workflow,
  monitor: MonitorPlay,
  output: Share2,
};

function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-24 border-y border-border/70 bg-card/25">
      <div className="mx-auto w-full max-w-6xl px-5 py-24 md:py-32">
        <Reveal>
          <SectionTag>architecture</SectionTag>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            <BlurText text="Four moving parts," stagger={0.03} />{" "}
            <GradientText colors={["#4dc3ff", "#7ea6ff", "#4dc3ff"]} speed={5}>
              zero black boxes.
            </GradientText>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {PIPELINE.map((p, i) => {
            const Icon = PIPELINE_ICONS[p.icon] ?? Cpu;
            return (
              <Reveal key={p.num} delay={i * 110} className="h-full">
                <SpotlightCard color="rgba(77, 195, 255, 0.16)" className="h-full rounded-2xl border border-border bg-card/50 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blu/30 bg-blu/10">
                      <Icon className="h-5 w-5 text-blu" />
                    </div>
                    <span className="font-mono text-xs text-muted-foreground/60">{p.num}</span>
                  </div>
                  <h3 className="mt-4 font-display text-xl text-foreground">
                    {p.name}
                    <span className="ml-2 font-mono text-[11px] uppercase tracking-wider text-blu/70">{p.stack}</span>
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {p.tags.map((t) => (
                      <span key={t} className="rounded-md border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ================= FEATURES ================= */

const FEATURE_ICONS: Record<string, typeof Radio> = {
  radio: Radio,
  scan: ScanSearch,
  link: Link2,
  gauge: Gauge,
  radar: Radar,
  layers: Layers,
  server: Server,
  shield: ShieldCheck,
  database: Database,
};

function Features() {
  return (
    <section id="features" className="scroll-mt-24">
      <div className="mx-auto w-full max-w-6xl px-5 py-24 md:py-32">
        <Reveal>
          <SectionTag>features</SectionTag>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            <BlurText text="Detection depth," stagger={0.03} />{" "}
            <GradientText colors={["#4dc3ff", "#a7c8ff", "#4dc3ff"]} speed={6}>
              end to end.
            </GradientText>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = FEATURE_ICONS[f.icon] ?? Radio;
            return (
              <Reveal key={f.title} delay={(i % 3) * 90} className="h-full">
                <SpotlightCard color="rgba(77, 195, 255, 0.15)" className="h-full rounded-2xl border border-border bg-card/50 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blu/25 bg-blu/10">
                    <Icon className="h-4.5 w-4.5 text-blu" />
                  </div>
                  <h3 className="mt-4 font-display text-lg leading-snug text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ================= QUICKSTART ================= */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-blu/40 hover:text-blu"
      aria-label="Copy command"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-blu" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "copied" : "copy"}
    </button>
  );
}

function WinInstall() {
  return (
    <Reveal className="mt-10">
      <div className="relative overflow-hidden rounded-2xl border border-blu/30 bg-[#04070c] shadow-[0_0_60px_-20px_rgba(77,195,255,0.35)]">
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <Terminal className="h-3.5 w-3.5 text-blu" />
          <span className="font-mono text-xs text-muted-foreground">PowerShell · Windows 10/11</span>
          <span className="ml-auto rounded-full border border-blu/30 bg-blu/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-blu">
            no admin
          </span>
        </div>
        <div className="relative">
          <CopyButton text={WIN_INSTALL_CMD} />
          <div className="space-y-1.5 px-5 py-6 font-mono text-[13px] leading-relaxed">
            {QUICKSTART.windows.lines.map((l, i) =>
              l.text === "" ? (
                <div key={i} className="h-2" />
              ) : (
                <div
                  key={i}
                  className={
                    l.dim
                      ? "text-muted-foreground/50"
                      : l.ok
                        ? "text-[#7ee2a8]"
                        : "whitespace-pre-wrap break-all text-[#cfe6ff]"
                  }
                >
                  {l.text}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground/70">
        The installer verifies sha256 checksums of every downloaded toolchain, installs at user
        level (LOCALAPPDATA) and registers an optional autostart. Real telemetry needs Sysmon:{" "}
        <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] text-blu">sf-sensor -SetupSysmon</code>.
      </p>
    </Reveal>
  );
}

function Terminals() {
  return (
    <div className="mt-6 grid gap-5 md:grid-cols-2">
      {QUICKSTART.terminals.map((t, i) => (
        <Reveal key={t.title} delay={i * 120} className="h-full">
          <div className="h-full overflow-hidden rounded-2xl border border-border bg-[#04070c]">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/70" />
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">{t.title}</span>
            </div>
            <div className="space-y-1 px-5 py-4 font-mono text-[12.5px] leading-relaxed">
              {t.lines.map((l, j) =>
                l.text === "" ? (
                  <div key={j} className="h-1.5" />
                ) : (
                  <div
                    key={j}
                    className={
                      l.dim
                        ? "text-muted-foreground/50"
                        : l.ok
                          ? "text-[#7ee2a8]"
                          : l.warn
                            ? "text-[#ffd479]"
                            : l.crit
                              ? "text-[#ff8f8f]"
                              : "text-[#cfe6ff]"
                    }
                  >
                    {l.text}
                  </div>
                ),
              )}
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function Quickstart() {
  return (
    <section id="quickstart" className="scroll-mt-24 border-y border-border/70 bg-card/25">
      <div className="mx-auto w-full max-w-6xl px-5 py-24 md:py-32">
        <Reveal>
          <SectionTag>quickstart</SectionTag>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            <BlurText text="From zero to" stagger={0.03} />{" "}
            <GradientText colors={["#4dc3ff", "#a7c8ff", "#4dc3ff"]} speed={5}>
              first detection
            </GradientText>{" "}
            in one line.
          </h2>
        </Reveal>
        <WinInstall />
        <Terminals />
        <Reveal delay={150}>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground/70">{QUICKSTART.note}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= COMPARISON ================= */

function Comparison() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-24 md:py-28">
      <Reveal>
        <SectionTag>positioning</SectionTag>
      </Reveal>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Reveal className="h-full">
          <div className="h-full rounded-2xl border border-blu/25 bg-blu/[0.04] p-6">
            <h3 className="flex items-center gap-2 font-display text-xl text-foreground">
              <Check className="h-5 w-5 text-blu" /> What it is
            </h3>
            <ul className="mt-4 space-y-2.5">
              {COMPARISON.is.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-blu/70" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={120} className="h-full">
          <div className="h-full rounded-2xl border border-border bg-card/40 p-6">
            <h3 className="flex items-center gap-2 font-display text-xl text-foreground">
              <X className="h-5 w-5 text-muted-foreground/60" /> What it is not
            </h3>
            <ul className="mt-4 space-y-2.5">
              {COMPARISON.isNot.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= ROADMAP ================= */

function Roadmap() {
  return (
    <section id="roadmap" className="scroll-mt-24 border-t border-border/70">
      <div className="mx-auto w-full max-w-6xl px-5 py-24 md:py-28">
        <Reveal>
          <SectionTag>roadmap</SectionTag>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="mt-6 font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
            <BlurText text="Where it is going." stagger={0.04} />
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {ROADMAP.map((r, i) => (
            <Reveal key={r.phase} delay={i * 100} className="h-full">
              <SpotlightCard
                color={r.done ? "rgba(77, 195, 255, 0.18)" : "rgba(148, 189, 233, 0.10)"}
                className={`h-full rounded-2xl border p-6 ${
                  r.done ? "border-blu/30 bg-blu/[0.04]" : "border-border bg-card/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-wider text-blu/80">{r.phase}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      r.done ? "bg-blu/15 text-blu" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {r.done ? "shipped" : r.window}
                  </span>
                </div>
                <h3 className="mt-3 font-display text-xl text-foreground">{r.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.desc}</p>
              </SpotlightCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ================= VIEW ================= */

export function HomeView() {
  return (
    <>
      <Hero />
      <StatsRow />
      <Why />
      <Architecture />
      <Features />
      <Quickstart />
      <Comparison />
      <TechStrip title="built with" />
      <Roadmap />
      <FaqBlock />
      <BigCta />
    </>
  );
}
