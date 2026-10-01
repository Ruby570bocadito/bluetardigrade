"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Menu,
  ArrowRight,
  Star,
  ShieldCheck,
  Github,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FAQS, NAV_LINKS, TECH_STRIP, REPO_URL, type View } from "@/lib/site-data";

/* ---------------- Navigation context ---------------- */

interface SiteNav {
  view: View;
  navigate: (view: View, anchor?: string) => void;
}

export const NavContext = createContext<SiteNav>({
  view: "home",
  navigate: () => {},
});

export const useSiteNav = () => useContext(NavContext);

/* ---------------- Logo ---------------- */

export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  // tardigrade mark: segmented capsule body, head with eyes and three
  // leg pairs per side (see public/logo.svg for the full-color variant)
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" fill="none" opacity="0.85">
        <path d="M22 30 C17 29 14 26 13 22" />
        <path d="M21 37 C15 37 11 35 9 32" />
        <path d="M22 44 C16 45 13 48 12 52" />
        <path d="M42 30 C47 29 50 26 51 22" />
        <path d="M43 37 C49 37 53 35 55 32" />
        <path d="M42 44 C48 45 51 48 52 52" />
      </g>
      <rect x="20" y="24" width="24" height="22" rx="11" fill="currentColor" />
      <rect x="26" y="25" width="12" height="20" rx="6" fill="none" stroke="#060a10" strokeWidth="1" opacity="0.35" />
      <circle cx="32" cy="25.5" r="7.5" fill="currentColor" />
      <circle cx="29" cy="24" r="1.7" fill="#060a10" />
      <circle cx="35" cy="24" r="1.7" fill="#060a10" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-foreground md:gap-2">
      <LogoMark className={`text-blu ${compact ? "h-5 w-5" : "h-6 w-6"}`} />
      <span
        className={`font-display leading-none tracking-tight ${
          compact ? "text-lg" : "text-[22px]"
        }`}
      >
        bluetardigrade
      </span>
    </span>
  );
}

/* ---------------- Section tag pill ---------------- */

export function SectionTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground/90">
      <span className="relative flex h-4 w-4 items-center justify-center rounded-full border border-blu/60">
        <span className="h-1.5 w-1.5 rounded-full bg-blu" />
      </span>
      {children}
    </span>
  );
}

/* ---------------- Buttons ---------------- */

export function GitHubButton({
  size = "lg",
  label = "View on GitHub",
}: {
  size?: "lg" | "sm";
  label?: string;
}) {
  return (
    <Button asChild>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-2 rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/85 ${
          size === "lg" ? "h-12 px-8" : "h-10 px-6"
        }`}
      >
        <Github className="h-4 w-4" />
        {label}
        <ArrowRight className="h-4 w-4" />
      </a>
    </Button>
  );
}

export function StarButton() {
  return (
    <Button
      variant="outline"
      asChild
      className="group h-12 rounded-full border-border bg-card/60 px-8 font-medium text-foreground hover:bg-card hover:text-foreground"
    >
      <a href={`${REPO_URL}/stargazers`} target="_blank" rel="noreferrer">
        <Star className="h-4 w-4 transition-colors group-hover:fill-blu group-hover:text-blu" />
        Star the project
      </a>
    </Button>
  );
}

/* ---------------- Scroll reveal ---------------- */

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // scroll-position based reveal — reliable even with instant jumps
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.94 && rect.bottom > 0) {
        setVisible(true);
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    return cleanup;
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------------- Animated counter ---------------- */

export function Counter({
  value,
  prefix = "",
  suffix = "",
  decimals,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (started.current) return;
      started.current = true;
      const duration = 1600;
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(eased * value);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      cleanup();
    };
    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) start();
    };
    const cleanup = () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();
    return cleanup;
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {decimals ?? Math.round(display).toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

/* ---------------- Tech marquee ---------------- */

export function TechStrip({ title }: { title: string }) {
  const items = [...TECH_STRIP, ...TECH_STRIP];
  return (
    <div className="w-full">
      <p className="mb-5 text-center text-sm text-muted-foreground">{title}</p>
      <div
        className="relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)",
        }}
      >
        <div className="marquee flex w-max items-center gap-14">
          {items.map((b, i) => (
            <span
              key={`${b}-${i}`}
              className="flex items-center gap-3 whitespace-nowrap font-display text-2xl text-foreground/35"
            >
              {b}
              <ShieldCheck className="h-4 w-4 text-blu/30" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- FAQ block ---------------- */

export function FaqBlock() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 md:py-28">
      <Reveal className="mb-12 text-center">
        <SectionTag>FAQ&apos;s</SectionTag>
        <h2 className="mt-5 font-display text-4xl leading-tight text-foreground md:text-5xl">
          Answers to what you&apos;re wondering about.
        </h2>
      </Reveal>
      <Reveal>
        <Accordion type="single" collapsible className="w-full">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`faq-${i}`} className="border-border">
              <AccordionTrigger className="text-left text-base text-foreground hover:no-underline hover:text-blu">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Reveal>
    </section>
  );
}

/* ---------------- Big CTA ---------------- */

export function BigCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-24">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center md:py-20">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 90% at 50% 115%, rgba(140,197,110,0.16), transparent 70%)",
            }}
          />
          <p className="text-sm uppercase tracking-widest text-muted-foreground">
            PRs welcome
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-4xl leading-tight text-foreground md:text-6xl">
            Run it against real telemetry.
          </h2>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <GitHubButton />
            <StarButton />
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Apache-2.0 · Go 1.22+ · Rust 1.85+ · Windows endpoints
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------- Header ---------------- */

export function SiteHeader() {
  const { navigate } = useSiteNav();
  const [open, setOpen] = useState(false);

  const go = (anchor?: string) => {
    setOpen(false);
    navigate("home", anchor);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5">
        {/* left nav (desktop) */}
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
          {NAV_LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => go(l.anchor)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </button>
          ))}
        </nav>

        {/* mobile burger */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild className="lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              className="text-foreground"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 border-border bg-card text-foreground"
          >
            <SheetHeader>
              <SheetTitle className="text-left">
                <Logo compact />
              </SheetTitle>
            </SheetHeader>
            <nav className="mt-4 flex flex-col gap-1 px-4" aria-label="Mobile">
              {NAV_LINKS.map((l) => (
                <button
                  key={l.label}
                  onClick={() => go(l.anchor)}
                  className="flex items-center justify-between rounded-lg px-3 py-3 text-left text-[15px] text-foreground/90 hover:bg-white/5"
                >
                  {l.label}
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-2 flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-[15px] text-foreground/90"
              >
                <Github className="h-4 w-4" />
                GitHub repository
              </a>
            </nav>
          </SheetContent>
        </Sheet>

        {/* centered logo */}
        <button
          onClick={() => go()}
          aria-label="bluetardigrade — top"
          className="absolute left-1/2 -translate-x-1/2"
        >
          <Logo compact />
        </button>

        {/* right CTA */}
        <div className="hidden lg:block">
          <GitHubButton size="sm" />
        </div>
        <div className="lg:hidden">
          <Button
            asChild
            className="h-8 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:bg-primary/85"
          >
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- Footer ---------------- */

export function SiteFooter() {
  const { navigate } = useSiteNav();

  const col = (
    title: string,
    items: { label: string; action: () => void; external?: boolean }[]
  ) => (
    <div>
      <h4 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li key={it.label}>
            <button
              onClick={it.action}
              className="text-[15px] text-foreground/85 transition-colors hover:text-blu"
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <footer className="mt-auto border-t border-border bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {col("Project", [
          { label: "Why", action: () => navigate("home", "why") },
          { label: "Architecture", action: () => navigate("home", "architecture") },
          { label: "Features", action: () => navigate("home", "features") },
          { label: "Quickstart", action: () => navigate("home", "quickstart") },
        ])}
        {col("Resources", [
          {
            label: "README",
            action: () => window.open(REPO_URL + "#readme", "_blank"),
          },
          {
            label: "OpenAPI spec",
            action: () =>
              window.open(
                REPO_URL + "/blob/main/docs/api/openapi.yaml",
                "_blank"
              ),
          },
          {
            label: "Rule format",
            action: () => window.open(REPO_URL + "/tree/main/rules", "_blank"),
          },
          {
            label: "Docs folder",
            action: () => window.open(REPO_URL + "/tree/main/docs", "_blank"),
          },
        ])}
        {col("Community", [
          { label: "Issues", action: () => window.open(REPO_URL + "/issues", "_blank") },
          {
            label: "Pull requests",
            action: () => window.open(REPO_URL + "/pulls", "_blank"),
          },
          {
            label: "Contributing",
            action: () =>
              window.open(REPO_URL + "#contributing", "_blank"),
          },
          {
            label: "Roadmap",
            action: () => navigate("home", "roadmap"),
          },
        ])}
        {col("Legal", [
          {
            label: "Apache-2.0 License",
            action: () => window.open(REPO_URL + "/blob/main/LICENSE", "_blank"),
          },
          {
            label: "Author",
            action: () =>
              window.open("https://github.com/Ruby570bocadito", "_blank"),
          },
        ])}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-5 py-6 text-center text-[13px] text-muted-foreground sm:flex-row sm:text-left">
          <p>© 2026 bluetardigrade · Apache-2.0</p>
          <p>
            Real-time threat detection for Windows endpoints — built in the
            open.
          </p>
        </div>
      </div>
    </footer>
  );
}
