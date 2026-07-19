"use client";

// The Unlocks — the agent-building narrative, shown instead of told.
//
// Five industries, each anchored in a real kind of manual grind, each with
// a live "agent console" that replays what an agent run actually looks
// like — ending on the contrast line (what this used to cost a human).
// Pure CSS/JS animation, deterministic, respects prefers-reduced-motion.

import { useEffect, useRef, useState } from "react";

interface Unlock {
  id: string;
  tab: string; // short tab label
  persona: string; // who this is, in their own words
  grind: string; // the manual reality, first person
  agents: { name: string; does: string }[];
  console: string[]; // the replayed run; last line is the contrast
  outcome: string; // the thing the persona actually cares about
}

const UNLOCKS: Unlock[] = [
  {
    id: "distribution",
    tab: "Parts & distribution",
    persona: "The distributor with 137,000 SKUs",
    grind:
      "A quote request comes in, and someone on my team googles our own products — one at a time — to see what everyone else is charging, so we can figure out what to quote. Every quote. Every day.",
    agents: [
      { name: "price-watch", does: "sweeps competitor pricing across the whole catalog, every day, and remembers it" },
      { name: "quote-desk", does: "drafts the quote from the RFQ — priced against today's market, margin floors enforced" },
      { name: "catalog-mind", does: "answers 'what fits / what replaces / what's the alternative' instantly, from your own data" },
    ],
    console: [
      "▶ price-watch · daily sweep",
      "scanning catalog … 137,412 SKUs",
      "4 competitors checked · 2,184 price changes detected",
      "312 open quotes flagged at risk · margin floor 22% held",
      "→ quote-desk · RFQ #4471 drafted — 14 line items, market-priced",
      "run complete in 6m 12s",
      "before: a person, a search bar, a lost afternoon — per quote",
    ],
    outcome:
      "Quotes go out in minutes instead of afternoons, priced against today's market instead of last month's memory — and nobody's job is googling anymore.",
  },
  {
    id: "agencies",
    tab: "Agencies",
    persona: "The agency owner whose margin is buried in delivery",
    grind:
      "Every new client adds the same manual load: research, reporting, audits, first drafts. My best people spend their week assembling deliverables instead of thinking. Growth means hiring, and hiring eats the margin.",
    agents: [
      { name: "hub-core", does: "one agent hub, every client account — the repeatable 80% of delivery runs itself" },
      { name: "report-runner", does: "monthly client reporting drafted, charted, and annotated before anyone logs in" },
      { name: "pitch-scout", does: "audits prospects before the first call — you walk in with the answer" },
    ],
    console: [
      "▶ hub-core · monday 06:00 sweep",
      "18 client accounts · pulling analytics, rankings, spend",
      "→ report-runner · 18 monthly reports drafted + annotated",
      "→ pitch-scout · 3 prospects audited overnight · decks ready",
      "flagged: 2 accounts trending down — human review requested",
      "run complete in 41m 07s",
      "before: two senior people, the whole first week of the month",
    ],
    outcome:
      "You take on more clients without new hires, deliverables ship before the coffee's ready, and your senior people go back to the work clients actually pay for.",
  },
  {
    id: "ecommerce",
    tab: "E-commerce",
    persona: "The brand owner competing on 40 fronts at once",
    grind:
      "Competitor prices move daily, listings drift out of date, reviews pile up unread, and every marketplace wants different content. I find out about problems when revenue dips — weeks late.",
    agents: [
      { name: "shelf-watch", does: "tracks competitor prices, stock-outs, and new entrants across your category — daily" },
      { name: "listing-smith", does: "keeps every product page enriched, consistent, and AI-answer-ready" },
      { name: "review-mine", does: "reads every review and support thread; surfaces the product truth you're sitting on" },
    ],
    console: [
      "▶ shelf-watch · category sweep",
      "214 competitor listings tracked · 37 price moves overnight",
      "2 rivals out of stock on hero SKUs — window open",
      "→ listing-smith · 12 PDPs refreshed · schema + FAQs rebuilt",
      "→ review-mine · 340 reviews read · 3 recurring objections surfaced",
      "run complete in 12m 44s",
      "before: a spreadsheet, three browser windows, and finding out late",
    ],
    outcome:
      "You see the market move the morning it moves, your listings stay quotable everywhere buyers ask, and the roadmap runs on what customers actually say.",
  },
  {
    id: "field",
    tab: "Home & field services",
    persona: "The operator losing jobs to whoever answers first",
    grind:
      "Leads come in while we're on ladders. By the time someone calls back, the homeowner has booked whoever replied first. Nights are for writing estimates; weekends are for chasing invoices.",
    agents: [
      { name: "first-responder", does: "answers every lead in seconds — qualifies, quotes ranges, books the slot" },
      { name: "estimate-drafter", does: "turns photos and job notes into a priced estimate for your sign-off" },
      { name: "follow-through", does: "runs the follow-ups, reviews, and invoice chasing you never get to" },
    ],
    console: [
      "▶ first-responder · live",
      "lead in · 7:42pm · water heater replacement, zip 08054",
      "qualified in 40s · range quoted · visit booked thu 9:00",
      "→ estimate-drafter · 3 job photos in → estimate out for approval",
      "→ follow-through · 6 quotes chased · 2 reviews requested",
      "day closed 9:15pm · every lead answered · zero after-hours typing",
      "before: voicemail, callbacks, and the fastest competitor winning",
    ],
    outcome:
      "You become the company that always answers first — the jobs stop leaking, and the evenings come back.",
  },
  {
    id: "services",
    tab: "Professional services",
    persona: "The practice drowning in intake and paperwork",
    grind:
      "Every engagement starts with the same forms, the same document requests, the same first-draft grind. Billable hours go to work a template should do, and clients wait days for things that take minutes of actual judgment.",
    agents: [
      { name: "intake-desk", does: "runs onboarding end to end — forms, document collection, conflict checks, reminders" },
      { name: "draft-first", does: "produces the first draft — engagement letters, memos, standard filings — for your review" },
      { name: "deadline-keeper", does: "watches every matter's dates and dependencies; nothing slips quietly" },
    ],
    console: [
      "▶ intake-desk · new engagement",
      "client portal sent · 11 documents requested · 9 received",
      "conflict check clear · file opened · billing set",
      "→ draft-first · engagement letter + kickoff memo drafted",
      "→ deadline-keeper · 4 dates docketed · 2 reminders armed",
      "ready for review in 18m — judgment is all that's left to add",
      "before: a paralegal-week per client, and the clock unbilled",
    ],
    outcome:
      "Clients get same-day motion instead of same-week paperwork, and the hours you sell are judgment — not data entry.",
  },
];

export default function Unlocks() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(1); // console lines revealed
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) setVisible(99);
  }, []);

  // Replay the console: one line at a time, hold on the contrast line, loop.
  useEffect(() => {
    if (reduced.current) return;
    setVisible(1);
    const lines = UNLOCKS[active].console.length;
    const t = setInterval(() => {
      setVisible((v) => (v >= lines + 5 ? 1 : v + 1)); // +5 ticks ≈ hold before loop
    }, 850);
    return () => clearInterval(t);
  }, [active]);

  const u = UNLOCKS[active];
  const shown = Math.min(visible, u.console.length);

  return (
    <section id="unlocks" className="max-w-5xl mx-auto px-6 pb-16">
      <style>{`
        .console-shell {
          background:
            linear-gradient(rgba(0,200,232,.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,232,.035) 1px, transparent 1px),
            linear-gradient(180deg, #05070d 0%, #070b16 100%);
          background-size: 22px 22px, 22px 22px, 100% 100%;
          border: 1px solid rgba(0,200,232,.3);
          box-shadow: 0 0 60px rgba(0,200,232,.07), inset 0 0 40px rgba(0,200,232,.03);
        }
        .console-cursor { animation: blink 1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .console-line { animation: lineIn .3s ease-out; }
        @keyframes lineIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .console-line { animation: none; }
          .console-cursor { animation: none; }
        }
      `}</style>

      <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--series-4)" }}>
        THE UNLOCKS · WHAT AN AGENT BUILD ACTUALLY CHANGES
      </div>
      <h2 className="text-3xl font-bold mb-2" style={{ color: "var(--ink)" }}>
        Somewhere in your business, someone is doing this by hand
      </h2>
      <p className="text-[13.5px] mb-7 max-w-3xl leading-relaxed" style={{ color: "var(--muted)" }}>
        Every industry has its version of the same story: a smart person spending their day on work a
        purpose-built agent could run continuously. Pick yours — the console replays what a real agent
        run looks like.
      </p>

      {/* industry tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {UNLOCKS.map((x, i) => (
          <button key={x.id} onClick={() => setActive(i)}
            className="text-[12.5px] mono px-3.5 py-2 rounded-lg transition-colors"
            style={i === active
              ? { background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 700 }
              : { border: "1px solid var(--border)", color: "var(--muted)", background: "var(--surface-1)" }}>
            {x.tab}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* the human story */}
        <div className="flex flex-col gap-3">
          <div className="card p-5" style={{ borderLeft: "2px solid var(--warning)" }}>
            <div className="text-[11px] mono tracking-[0.14em] mb-1.5" style={{ color: "var(--warning)" }}>
              THE MANUAL GRIND · {u.persona.toUpperCase()}
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>
              &ldquo;{u.grind}&rdquo;
            </p>
          </div>
          <div className="card p-5">
            <div className="text-[11px] mono tracking-[0.14em] mb-2.5" style={{ color: "var(--accent)" }}>
              THE BUILD · AGENTS SCOPED TO THIS EXACT PROBLEM
            </div>
            <div className="flex flex-col gap-2.5">
              {u.agents.map((a) => (
                <div key={a.name} className="flex gap-3 items-baseline">
                  <span className="text-[12px] mono shrink-0 px-2 py-0.5 rounded"
                    style={{ color: "var(--accent)", border: "1px solid var(--accent)", opacity: 0.95 }}>
                    {a.name}
                  </span>
                  <span className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{a.does}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-5" style={{ borderLeft: "2px solid var(--good)" }}>
            <div className="text-[11px] mono tracking-[0.14em] mb-1.5" style={{ color: "var(--good)" }}>
              THE OUTCOME
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>{u.outcome}</p>
          </div>
        </div>

        {/* the agent console */}
        <div className="console-shell rounded-xl p-5 flex flex-col min-h-[320px]">
          <div className="flex items-center gap-2 pb-3 mb-3" style={{ borderBottom: "1px solid rgba(0,200,232,.18)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--good)" }} />
            <span className="text-[11px] mono tracking-[0.14em]" style={{ color: "var(--muted)" }}>
              AGENT RUN · REPLAY · {u.id.toUpperCase()}
            </span>
            <span className="ml-auto text-[10px] mono" style={{ color: "rgba(0,200,232,.6)" }}>LIVE-STYLE</span>
          </div>
          <div className="flex-1 flex flex-col gap-2 text-[13px] mono leading-relaxed">
            {u.console.slice(0, shown).map((line, i) => {
              const isLast = i === u.console.length - 1;
              const color = isLast
                ? "var(--warning)"
                : line.startsWith("▶")
                  ? "var(--accent)"
                  : line.startsWith("→")
                    ? "var(--series-2)"
                    : "var(--ink-2)";
              return (
                <div key={`${u.id}-${i}`} className="console-line" style={{ color, fontStyle: isLast ? "italic" : undefined }}>
                  {line}
                  {i === shown - 1 && !isLast && <span className="console-cursor" style={{ color: "var(--accent)" }}>▌</span>}
                </div>
              );
            })}
          </div>
          <div className="pt-3 mt-3 text-[11px] mono" style={{ borderTop: "1px solid rgba(0,200,232,.18)", color: "var(--muted)" }}>
            Illustrative replay — every build is scoped to your process, your data, your guardrails.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-6">
        <a href="/unlock" className="px-5 py-3 rounded-xl text-sm font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          Run the 2-minute Unlock Scanner →
        </a>
        <a href="#contact" className="px-5 py-3 rounded-xl text-sm font-semibold"
          style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>
          Tell me your version of the grind
        </a>
        <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
          Don&rsquo;t see your industry? The pattern is the same — if it&rsquo;s manual and repeatable, it&rsquo;s buildable.
        </span>
      </div>
    </section>
  );
}
