"use client";

import { useCallback } from "react";
import {
  NavContext,
  SiteHeader,
  SiteFooter,
} from "@/components/site/chrome";
import { HomeView } from "@/components/site/home-view";
import type { View } from "@/lib/site-data";

function scrollToTarget(anchor?: string) {
  if (anchor) {
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

export default function Page() {
  const view: View = "home";

  const navigate = useCallback((_next: View, anchor?: string) => {
    // single-page presentation — smooth scroll to the section anchor
    window.setTimeout(() => scrollToTarget(anchor), 30);
  }, []);

  return (
    <NavContext.Provider value={{ view, navigate }}>
      <div className="grain flex min-h-screen flex-col bg-background text-foreground">
        <SiteHeader />
        <main className="flex-1">
          <HomeView />
        </main>
        <SiteFooter />
      </div>
    </NavContext.Provider>
  );
}
