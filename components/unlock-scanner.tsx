"use client";

// The Unlock Scanner — the automation pillar's tripwire.
//
// The audit is the free instant-value tool for the search pillar; this is
// its twin for agent building. Tap-through, no typing until the gate:
// industry → the grinds → three numbers → the burn, instantly. The full
// unlock plan (which agents, in what order, the 90-day rollout) sits
// behind a name+email gate that writes to the leads table.
//
// Every number is the visitor's own inputs times a stated automation
// share — the math is printed, nothing is invented.

import { useMemo, useState } from "react";

const INDUSTRIES = [
  "Parts & distribution",
  "Agency",
  "E-commerce",
  "Home & field services",
  "Professional services",
  "Something else",
];

interface Grind {
  id: string;
  label: string;
  share: number; // fraction of this work an agent can carry
  agents: string; // what gets built
  play: string; // what the agent does, concretely
}

const GRINDS: Grind[] = [
  {
    id: "quoting",
    label: "Quoting & pricing research",
    share: 0.7,
    agents: "price-watch + quote-desk",
    play: "Competitor pricing swept continuously; quotes drafted from the request, market-priced, with your margin floors enforced — you approve, it sends.",
  },
  {
    id: "reporting",
    label: "Reporting & data assembly",
    share: 0.8,
    agents: "report-runner",
    play: "The recurring reports build themselves — pulled, charted, annotated with what changed and why — before anyone logs in.",
  },
  {
    id: "leads",
    label: "Lead follow-up & scheduling",
    share: 0.75,
    agents: "first-responder + follow-through",
    play: "Every inquiry answered in seconds, qualified, booked; every quote chased on schedule. The fastest responder wins the job — that becomes you, always.",
  },
  {
    id: "intake",
    label: "Onboarding & intake",
    share: 0.65,
    agents: "intake-desk",
    play: "Forms, document collection, reminders, file setup — run end to end, with humans only touching the judgment calls.",
  },
  {
    id: "research",
    label: "Monitoring markets, competitors & prices",
    share: 0.8,
    agents: "market-scout",
    play: "The watching becomes continuous: competitor moves, price changes, category shifts — surfaced to you as decisions, not homework.",
  },
  {
    id: "admin",
    label: "Invoicing, chasing & back-office admin",
    share: 0.7,
    agents: "back-office",
    play: "Invoices out, gentle chasing on a cadence, records reconciled — the paperwork layer runs itself with an audit trail.",
  },
  {
    id: "content",
    label: "Content, listings & catalog upkeep",
    share: 0.65,
    agents: "listing-smith",
    play: "Product pages, listings, and descriptions kept current, consistent, and structured so both Google and AI assistants can quote them.",
  },
  {
    id: "questions",
    label: "Answering the same questions over and over",
    share: 0.75,
    agents: "answer-desk",
    play: "The repeat questions — availability, compatibility, status, policy — answered instantly from your own data, escalating only the real ones.",
  },
];

const RATES = [
  { label: "$25/hr", value: 25 },
  { label: "$45/hr", value: 45 },
  { label: "$75/hr", value: 75 },
  { label: "$110/hr", value: 110 },
];

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="card p-5" style={done ? { borderColor: "var(--good)" } : undefined}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-[12px] mono w-6 h-6 rounded-full flex items-center justify-center shrink-0"
          style={{ border: `1px solid ${done ? "var(--good)" : "var(--accent)"}`, color: done ? "var(--good)" : "var(--accent)" }}>
          {done ? "✓" : n}
        </span>
        <span className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function UnlockScanner() {
  const [industry, setIndustry] = useState<string | null>(null);
  const [grinds, setGrinds] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState(2);
  const [hours, setHours] = useState(10);
  const [rate, setRate] = useState(45);

  const [gate, setGate] = useState({ name: "", email: "" });
  const [unlocked, setUnlocked] = useState(false);
  const [sending, setSending] = useState(false);

  const selected = GRINDS.filter((g) => grinds.has(g.id));
  const ready = industry !== null && selected.length > 0;

  const math = useMemo(() => {
    const annualHours = people * hours * 50;
    const annualCost = annualHours * rate;
    const share = selected.length
      ? selected.reduce((s, g) => s + g.share, 0) / selected.length
      : 0;
    const recoverableHours = annualHours * share;
    const recoverableLow = recoverableHours * 0.6 * rate; // conservative floor
    const recoverableFull = recoverableHours * rate;
    return { annualHours, annualCost, share, recoverableHours, recoverableLow, recoverableFull };
  }, [people, hours, rate, selected]);

  const toggleGrind = (id: string) => {
    const next = new Set(grinds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGrinds(next);
  };

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: gate.name,
          email: gate.email,
          interest: "agents",
          source: "unlock-scanner",
          message: `Unlock Scanner — industry: ${industry}; grinds: ${selected.map((g) => g.label).join(", ")}; people: ${people}; hrs/wk each: ${hours}; rate: $${rate}/hr; annual burn: ${fmt(math.annualCost)}; recoverable est: ${fmt(math.recoverableLow)}–${fmt(math.recoverableFull)}/yr`,
        }),
      });
    } catch {
      /* the plan still unlocks — the mailto path is always available */
    } finally {
      setUnlocked(true);
      setSending(false);
    }
  };

  const buildOrder = [...selected].sort((a, b) => b.share - a.share);

  return (
    <div className="min-h-screen px-6 py-14" style={{ background: "var(--page)" }}>
      <div className="max-w-3xl mx-auto">
        {/* masthead */}
        <div className="text-[11px] mono tracking-[0.2em] mb-4" style={{ color: "var(--series-4)" }}>
          THE UNLOCK SCANNER · 2 MINUTES · NO TYPING UNTIL YOU WANT THE PLAN
        </div>
        <h1 className="text-3xl md:text-5xl font-extrabold leading-[1.08]" style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}>
          What is manual work<br />actually costing you?
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed max-w-xl" style={{ color: "var(--muted)" }}>
          Tap through your industry, the grinds you recognize, and three numbers. The burn shows up
          instantly — your inputs, stated math, nothing invented. The full agent plan is one email away.
        </p>

        <div className="flex flex-col gap-4 mt-9">
          {/* step 1 — industry */}
          <Step n={1} title="What kind of business?" done={industry !== null}>
            <div className="flex flex-wrap gap-2">
              {INDUSTRIES.map((x) => (
                <button key={x} onClick={() => setIndustry(x)}
                  className="text-[13px] px-3.5 py-2 rounded-lg"
                  style={x === industry
                    ? { background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 600 }
                    : { border: "1px solid var(--border)", color: "var(--ink-2)", background: "var(--surface-1)" }}>
                  {x}
                </button>
              ))}
            </div>
          </Step>

          {/* step 2 — grinds */}
          <Step n={2} title="Which of these happen by hand? (pick all that apply)" done={selected.length > 0}>
            <div className="grid md:grid-cols-2 gap-2">
              {GRINDS.map((g) => {
                const on = grinds.has(g.id);
                return (
                  <button key={g.id} onClick={() => toggleGrind(g.id)}
                    className="text-left text-[13px] px-3.5 py-2.5 rounded-lg flex items-center gap-2.5"
                    style={on
                      ? { border: "1px solid var(--accent)", background: "var(--surface-2)", color: "var(--ink)" }
                      : { border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--ink-2)" }}>
                    <span className="mono text-[11px]" style={{ color: on ? "var(--accent)" : "var(--muted)" }}>
                      {on ? "◉" : "○"}
                    </span>
                    {g.label}
                  </button>
                );
              })}
            </div>
          </Step>

          {/* step 3 — the numbers */}
          <Step n={3} title="Three numbers — rough is fine" done={ready}>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <div className="text-[11px] mono mb-1.5" style={{ color: "var(--muted)" }}>PEOPLE DOING THIS WORK</div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setPeople(Math.max(1, people - 1))} className="w-9 h-9 rounded-lg text-lg"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)" }}>−</button>
                  <span className="text-[20px] font-bold w-8 text-center" style={{ color: "var(--ink)" }}>{people}</span>
                  <button onClick={() => setPeople(Math.min(50, people + 1))} className="w-9 h-9 rounded-lg text-lg"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)" }}>+</button>
                </div>
              </div>
              <div>
                <div className="text-[11px] mono mb-1.5" style={{ color: "var(--muted)" }}>
                  HOURS / WEEK, EACH: <span style={{ color: "var(--ink)" }}>{hours}h</span>
                </div>
                <input type="range" min={1} max={40} value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                  className="w-full accent-cyan-400" style={{ accentColor: "var(--accent)" }} />
              </div>
              <div>
                <div className="text-[11px] mono mb-1.5" style={{ color: "var(--muted)" }}>LOADED HOURLY COST</div>
                <div className="flex flex-wrap gap-1.5">
                  {RATES.map((r) => (
                    <button key={r.value} onClick={() => setRate(r.value)}
                      className="text-[12px] mono px-2.5 py-1.5 rounded-lg"
                      style={rate === r.value
                        ? { background: "var(--accent)", color: "var(--accent-ink)", fontWeight: 700 }
                        : { border: "1px solid var(--border)", color: "var(--ink-2)" }}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Step>
        </div>

        {/* the burn — instant, ungated */}
        {ready && (
          <div className="card p-6 mt-5" style={{ borderColor: "var(--warning)" }}>
            <div className="text-[11px] mono tracking-[0.16em] mb-4" style={{ color: "var(--warning)" }}>
              THE BURN — FROM YOUR NUMBERS
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>HOURS / YEAR</div>
                <div className="text-[24px] font-extrabold" style={{ color: "var(--ink)" }}>{math.annualHours.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>COST / YEAR</div>
                <div className="text-[24px] font-extrabold" style={{ color: "var(--warning)" }}>{fmt(math.annualCost)}</div>
              </div>
              <div>
                <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>AGENT-RECOVERABLE</div>
                <div className="text-[24px] font-extrabold" style={{ color: "var(--accent)" }}>
                  {fmt(math.recoverableLow)}–{fmt(math.recoverableFull)}
                </div>
                <div className="text-[10px]" style={{ color: "var(--muted)" }}>per year</div>
              </div>
              <div>
                <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>VS. A BUILD FROM</div>
                <div className="text-[24px] font-extrabold" style={{ color: "var(--good)" }}>$7,500</div>
                <div className="text-[10px]" style={{ color: "var(--muted)" }}>one-time, fixed scope</div>
              </div>
            </div>
            <div className="text-[11.5px] mt-4 leading-relaxed" style={{ color: "var(--muted)" }}>
              Math, printed: {people} {people === 1 ? "person" : "people"} × {hours}h/week × 50 weeks × ${rate}/hr ={" "}
              {fmt(math.annualCost)}/yr. Recoverable = that × {Math.round(math.share * 100)}% (the average automation
              share of your selected grinds), shown at 60–100%. Estimates from your own inputs — the scoping call is
              where real numbers happen.
            </div>
          </div>
        )}

        {/* the gate → the plan */}
        {ready && !unlocked && (
          <div className="card p-6 mt-4" style={{ borderColor: "var(--accent)" }}>
            <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>
              Get the full unlock plan — which agents, in what order, live in 90 days
            </div>
            <p className="text-[12.5px] mt-1.5" style={{ color: "var(--muted)" }}>
              The plan renders right here. No newsletter, no sequence — I reach out personally, once, if it looks like a fit.
            </p>
            <form onSubmit={unlock} className="flex flex-wrap gap-2.5 mt-4">
              <input required placeholder="Name" value={gate.name}
                onChange={(e) => setGate({ ...gate, name: e.target.value })}
                className="flex-1 min-w-[160px] bg-transparent outline-none text-sm rounded-lg px-3.5 py-3"
                style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
              <input required type="email" placeholder="Email" value={gate.email}
                onChange={(e) => setGate({ ...gate, email: e.target.value })}
                className="flex-1 min-w-[200px] bg-transparent outline-none text-sm rounded-lg px-3.5 py-3"
                style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
              <button type="submit" disabled={sending}
                className="px-5 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                {sending ? "Unlocking…" : "Show my plan →"}
              </button>
            </form>
          </div>
        )}

        {ready && unlocked && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="card p-6" style={{ borderColor: "var(--good)" }}>
              <div className="text-[11px] mono tracking-[0.16em] mb-3" style={{ color: "var(--good)" }}>
                YOUR UNLOCK PLAN · BUILD ORDER BY PAYBACK
              </div>
              <div className="flex flex-col gap-4">
                {buildOrder.map((g, i) => (
                  <div key={g.id} className="flex gap-4">
                    <span className="text-[15px] font-bold mono shrink-0 w-7" style={{ color: "var(--muted)" }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{g.label}</span>
                        <span className="text-[11px] mono px-2 py-0.5 rounded" style={{ color: "var(--accent)", border: "1px solid var(--accent)" }}>
                          {g.agents}
                        </span>
                        <span className="text-[11px] mono" style={{ color: "var(--muted)" }}>~{Math.round(g.share * 100)}% automatable</span>
                      </div>
                      <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "var(--ink-2)" }}>{g.play}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid md:grid-cols-3 gap-3 mt-6 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                {[
                  { t: "Days 0–14", d: "Scope the top grind together; wire the data sources; set guardrails and approval points." },
                  { t: "Days 15–45", d: "First agent live on real work, human-in-the-loop; measured against the burn numbers above." },
                  { t: "Days 45–90", d: "Second agent + tightened autonomy where it's earned; your team trained; handoff complete." },
                ].map((x) => (
                  <div key={x.t}>
                    <div className="text-[11px] mono" style={{ color: "var(--accent)" }}>{x.t}</div>
                    <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>{x.d}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="card p-5 flex flex-wrap items-center gap-3">
              <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                Want this scoped for real?
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                30 minutes, your actual process, a fixed-scope proposal — or the honest "don't automate this yet."
              </span>
              <a href="mailto:jbeegel@gmail.com?subject=Unlock%20scoping%20call"
                className="ml-auto px-5 py-3 rounded-lg text-sm font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                Book the scoping call →
              </a>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-4 mt-10 text-[12px] mono" style={{ color: "var(--muted)" }}>
          <a href="/" style={{ color: "var(--muted)" }}>← back to the main site</a>
          <a href="/audit" style={{ color: "var(--series-1)" }}>Also: the free search & AI-visibility audit →</a>
        </div>
      </div>
    </div>
  );
}
