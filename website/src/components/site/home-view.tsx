"use client";

import {
  Cpu,
  Workflow,
  MonitorPlay,
  Share2,
  Radio,
  ScanSearch,
  ArrowLeftRight,
  Link2,
  Gauge,
  Radar,
  ShieldCheck,
  Database,
  Check,
  X,
} from "lucide-react";
import ParticleWave from "./particle-wave";
import {
  SectionTag,
  GitHubButton,
  Reveal,
  Counter,
  TechStrip,
  FaqBlock,
  BigCta,
} from "./chrome";
import {
  STATS,
  WHY_CARDS,
  GOLDEN_RULE,
  PIPELINE,
  FEATURES,
  QUICKSTART,
  COMPARISON,
  ROADMAP,
} from "@/lib/site-data";

/* ================= HERO ================= */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-16">
      <div className="relative z-10 mx-auto flex min-h-[88vh] w-full max-w-6xl flex-col items-center justify-center px-5 pb-44 pt-24 text-center">
        <Reveal>
          <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sentira" />
            v0.1 — tracer bullet + console preview
          </span>
        </Reveal>
        <Reveal delay={120}>
          <h1 className="max-w-5xl font-display text-[clamp(2.6rem,8.5vw,6.5rem)] leading-[1.02] tracking-tight text-foreground">
            security-framework
          </h1>
        </Reveal>
        <Reveal delay={240}>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-foreground/75 md:text-xl">
            Real-time threat detection for Windows endpoints — an ETW sensor, a
            behavioral engine, and an operator console that shows only the
            truth.
          </p>
        </Reveal>
        <Reveal delay={360} className="mt-9 w-full">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <GitHubButton />
            <a
              href="#quickstart"
              className="group inline-flex h-12 items-center rounded-full border border-border bg-card/60 px-8 text-sm font-medium text-foreground transition-colors hover:bg-card"
            >
              Quickstart
              <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </a>
          </div>
        </Reveal>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%]">
        <ParticleWave className="h-full w-full" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
      </div>
    </section>
  );
}

/* ================= STATS ================= */

function Stats() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-10 pt-6">
      <Reveal>
        <TechStrip title="Built with:" />
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 90}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-6">
              <Counter
                value={s.value}
                prefix={s.prefix}
                suffix={s.suffix}
                decimals={s.decimals}
                className="font-display text-5xl text-foreground"
              />
              <p className="mt-4 text-sm font-medium text-foreground">
                {s.label}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                {s.desc}
              </p>
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
    <section id="why" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-20 md:py-28">
      <Reveal>
        <SectionTag>Why security-framework</SectionTag>
      </Reveal>
      <Reveal delay={100}>
        <h2 className="mt-6 max-w-3xl font-display text-4xl leading-[1.08] text-foreground md:text-6xl">
          Three bets, one engineering rule.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {WHY_CARDS.map((c, i) => (
          <Reveal key={c.num} delay={i * 100}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-7">
              <span className="font-display text-4xl text-sentira/80">
                {c.num}
              </span>
              <h3 className="mt-6 text-lg font-medium text-foreground">
                {c.title}
              </h3>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                {c.desc}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={150}>
        <div className="mt-5 rounded-2xl border border-sentira/30 bg-sentira/[0.05] p-7 md:p-8">
          <p className="text-sm font-medium uppercase tracking-wider text-sentira">
            The golden rule
          </p>
          <p className="mt-3 font-display text-xl leading-relaxed text-foreground md:text-2xl">
            {GOLDEN_RULE}
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ================= ARCHITECTURE ================= */

const PIPE_ICONS = {
  cpu: Cpu,
  engine: Workflow,
  monitor: MonitorPlay,
  output: Share2,
} as const;

function Architecture() {
  return (
    <section id="architecture" className="scroll-mt-24 bg-[#0c0c0c] py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-5">
        <Reveal className="text-center">
          <SectionTag>Architecture</SectionTag>
          <h2 className="mx-auto mt-5 max-w-3xl font-display text-4xl leading-tight text-foreground md:text-6xl">
            Kernel to console, one pipeline.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            The unified event schema is the master contract: sensors emit it,
            the engine validates and enriches it, rules index it, interfaces
            consume it.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PIPELINE.map((p, i) => {
            const Icon = PIPE_ICONS[p.icon as keyof typeof PIPE_ICONS];
            return (
              <Reveal key={p.num} delay={i * 90}>
                <div className="relative flex h-full flex-col rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-sentira/40 text-sentira">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.num}
                    </span>
                  </div>
                  <h3 className="mt-6 font-display text-2xl text-foreground">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-sentira">
                    {p.stack}
                  </p>
                  <p className="mt-4 flex-1 text-[14px] leading-relaxed text-muted-foreground">
                    {p.desc}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {p.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[11px] text-foreground/75"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={120}>
          <figure className="mt-12 overflow-hidden rounded-2xl border border-border bg-card">
            { }
            <img
              src="/diagram_arquitectura.png"
              alt="Architecture diagram: Windows endpoints stream ETW and Sysmon telemetry into the Rust sensor, which feeds the Go detection engine; alerts flow to the console, webhooks and storage"
              className="w-full object-contain"
              loading="lazy"
            />
            <figcaption className="border-t border-border px-6 py-4 text-center text-[13px] text-muted-foreground">
              End-to-end architecture — sensor, detection engine and operator
              console.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= FEATURES ================= */

const FEATURE_ICONS = {
  radio: Radio,
  scan: ScanSearch,
  import: ArrowLeftRight,
  link: Link2,
  gauge: Gauge,
  radar: Radar,
  shield: ShieldCheck,
  database: Database,
} as const;

function Features() {
  return (
    <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-20 md:py-28">
      <Reveal className="text-center">
        <SectionTag>Features</SectionTag>
        <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-6xl">
          Everything in one binary.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => {
          const Icon = FEATURE_ICONS[f.icon as keyof typeof FEATURE_ICONS];
          return (
            <Reveal key={f.title} delay={(i % 4) * 80}>
              <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-sentira/35">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-sentira/40 text-sentira">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <h3 className="mt-5 text-[15px] font-medium text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
                  {f.desc}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ================= CONSOLE ================= */

function ConsoleSection() {
  return (
    <section className="scroll-mt-24 bg-[#0c0c0c] py-20 md:py-28">
      <div className="mx-auto w-full max-w-6xl px-5">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.4fr]">
          <Reveal>
            <SectionTag>Console preview</SectionTag>
            <h2 className="mt-6 font-display text-4xl leading-[1.08] text-foreground md:text-5xl">
              An operator console that shows only the truth.
            </h2>
            <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
              Live event feed, KPI dashboard, severity triage with free-text
              search, rule browser, kill-chain chains view and operator
              suppressions — every pixel fed by the real pipeline, never
              invented. Bring your own OpenAI-compatible endpoint and an AI
              analyst joins the triage.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {["Live feed", "KPIs", "Triage", "Rule browser", "Kill-chain", "AI analyst"].map(
                (t) => (
                  <span
                    key={t}
                    className="rounded-md border border-border bg-secondary px-3 py-1 text-xs text-foreground/75"
                  >
                    {t}
                  </span>
                )
              )}
            </div>
          </Reveal>
          <Reveal delay={140}>
            <figure className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/50">
              { }
              <img
                src="/console-panel.png"
                alt="Console operations dashboard with KPIs, sensor activity chart, kill-chain alerts and recent telemetry"
                className="w-full object-cover"
                loading="lazy"
              />
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ================= QUICKSTART ================= */

function Terminal({
  title,
  lines,
}: {
  title: string;
  lines: { text: string; dim?: boolean; cmd?: boolean; ok?: boolean; warn?: boolean; crit?: boolean }[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#0b0b0a]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]/80" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]/80" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]/80" />
        <span className="ml-3 font-mono text-xs text-muted-foreground">
          {title}
        </span>
      </div>
      <div className="space-y-1.5 p-5 font-mono text-[12.5px] leading-relaxed">
        {lines.map((l, i) => (
          <p
            key={i}
            className={
              l.cmd
                ? "text-sentira"
                : l.ok
                  ? "text-emerald-300/90"
                  : l.crit
                    ? "text-red-400/90"
                    : l.warn
                      ? "text-amber-300/90"
                      : l.dim
                        ? "text-muted-foreground/70"
                        : "text-foreground/85"
            }
          >
            {l.text || "\u00A0"}
          </p>
        ))}
      </div>
    </div>
  );
}

function Quickstart() {
  return (
    <section id="quickstart" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-20 md:py-28">
      <Reveal className="text-center">
        <SectionTag>Quickstart</SectionTag>
        <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-6xl">
          Two commands to first alert.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {QUICKSTART.note}
        </p>
      </Reveal>
      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        {QUICKSTART.terminals.map((t, i) => (
          <Reveal key={t.title} delay={i * 120}>
            <Terminal title={t.title} lines={t.lines} />
          </Reveal>
        ))}
      </div>
      <Reveal delay={150} className="mt-8 text-center">
        <GitHubButton label="Full guide in the README" />
      </Reveal>
    </section>
  );
}

/* ================= COMPARISON ================= */

function Comparison() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
      <Reveal className="text-center">
        <SectionTag>How it compares</SectionTag>
        <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-5xl">
          Honest about what it is.
        </h2>
      </Reveal>
      <Reveal delay={120} className="mt-14">
        <div className="grid overflow-hidden rounded-2xl border border-border md:grid-cols-2">
          <div className="bg-sentira/[0.06] p-8 md:p-10">
            <p className="text-sm font-medium uppercase tracking-wider text-sentira">
              What it is
            </p>
            <ul className="mt-6 space-y-4">
              {COMPARISON.is.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sentira/15 text-sentira">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-[15px] text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-border bg-card/40 p-8 md:border-l md:border-t-0 md:p-10">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              What it is not
            </p>
            <ul className="mt-6 space-y-4">
              {COMPARISON.isNot.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <X className="h-3 w-3" />
                  </span>
                  <span className="text-[15px] text-muted-foreground">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ================= ROADMAP ================= */

function Roadmap() {
  return (
    <section id="roadmap" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-20 md:py-28">
      <Reveal className="text-center">
        <SectionTag>Roadmap</SectionTag>
        <h2 className="mx-auto mt-5 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-5xl">
          Where it&apos;s heading.
        </h2>
      </Reveal>
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {ROADMAP.map((r, i) => (
          <Reveal key={r.phase} delay={i * 90}>
            <div
              className={`flex h-full flex-col rounded-2xl border p-6 ${
                r.done
                  ? "border-sentira/40 bg-sentira/[0.06]"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded-full border px-3 py-1 text-xs ${
                    r.done
                      ? "border-sentira/50 text-sentira"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {r.phase}
                </span>
                {r.done && (
                  <span className="flex items-center gap-1 text-xs text-sentira">
                    <Check className="h-3.5 w-3.5" /> shipped
                  </span>
                )}
              </div>
              <p className="mt-5 text-xs text-muted-foreground">{r.window}</p>
              <h3 className="mt-2 font-display text-2xl text-foreground">
                {r.title}
              </h3>
              <p className="mt-3 flex-1 text-[14px] leading-relaxed text-muted-foreground">
                {r.desc}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ================= HOME VIEW ================= */

export default function HomeView() {
  return (
    <>
      <Hero />
      <Stats />
      <Why />
      <Architecture />
      <Features />
      <ConsoleSection />
      <Quickstart />
      <Comparison />
      <Roadmap />
      <FaqBlock />
      <BigCta />
    </>
  );
}
