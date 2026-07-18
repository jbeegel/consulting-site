"use client";

// The audit front door — drop a domain, get the deep dive. This is the
// page you send a prospect before the first call.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

const EXAMPLES = [
  { domain: "goldenkernelpopcorn.com", label: "Popcorn — gifting & events" },
  { domain: "allbirds.com", label: "Allbirds — DTC" },
  { domain: "notion.so", label: "Notion — SaaS" },
  { domain: "sweetgreen.com", label: "Sweetgreen — Multi-location" },
];

export default function AuditLanding() {
  const [domain, setDomain] = useState("");
  const router = useRouter();
  const go = (d: string) => router.push(`/audit/${encodeURIComponent(d)}`);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-16" style={{ background: "var(--page)" }}>
      <div className="text-[11px] mono tracking-[0.2em] mb-4" style={{ color: "var(--accent)" }}>
        {BRAND.product.toUpperCase()} · {BRAND.productTagline.toUpperCase()}
      </div>
      <h1 className="text-4xl md:text-5xl font-bold text-center max-w-3xl leading-tight" style={{ color: "var(--ink)" }}>
        Where&rsquo;s the revenue you&rsquo;re
        <br />
        <span style={{ color: "var(--accent)" }}>not capturing?</span>
      </h1>
      <p className="text-center max-w-xl mt-4 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        A deep SEO <em style={{ color: "var(--ink-2)" }}>and</em> GEO opportunity analysis: keyword clusters priced in
        revenue, AI-assistant demand from a 200M+ query dataset, the citations competitors are winning, SERP real
        estate, and a sequenced 90-day plan. One domain in — the whole map out.
      </p>

      <form
        className="mt-8 flex w-full max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) go(domain.trim());
        }}
      >
        <input
          autoFocus
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="yourbrand.com"
          className="flex-1 bg-transparent outline-none text-sm rounded-xl px-4 py-3.5"
          style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }}
        />
        <button
          type="submit"
          className="px-5 py-3.5 rounded-xl text-sm font-semibold transition-transform active:scale-95"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          Run the audit →
        </button>
      </form>

      <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-xl">
        {EXAMPLES.map((d) => (
          <button key={d.domain} className="chip" onClick={() => go(d.domain)}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-3 mt-12 max-w-4xl w-full">
        {[
          { t: "Priced, not scored", d: "Every opportunity converts to $/mo through a stated CTR → conversion → AOV chain. The math is printed at the bottom of the audit." },
          { t: "SEO + GEO in one ranking", d: "Classic search clusters and AI-citation plays compete in the same priority list — because the buyer doesn't care which surface answered them." },
          { t: "Reads your business model", d: "A gifting brand, a SaaS, and a restaurant win AI answers differently. The citation strategy section adapts to how the money actually moves." },
        ].map((f) => (
          <div key={f.t} className="card p-5">
            <div className="text-sm font-semibold mb-1.5" style={{ color: "var(--accent)" }}>{f.t}</div>
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>{f.d}</p>
          </div>
        ))}
      </div>

      <div className="text-[11px] mono mt-10" style={{ color: "var(--muted)" }}>
        {BRAND.practice} · {BRAND.practiceFocus}
      </div>
      <a href={BRAND.homeUrl} className="mt-2 text-[12px] mono" style={{ color: "var(--muted)" }}>
        ← back to the main site
      </a>
    </div>
  );
}
