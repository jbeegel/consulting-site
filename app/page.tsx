"use client";

// The Answer Engineer storefront. One thesis, told with escalating stakes:
// search engines became answer engines — an AI now answers your customer
// directly and names two or three businesses. Either you're engineered into
// the answer, or you're being summarized out of your own market. The Capture
// audit is the wedge: every hero CTA drops a domain straight into it.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

const SERVICES = [
  {
    k: "01",
    t: "Get into the answers — AEO, GEO & SEO",
    d: "When a customer asks ChatGPT what to buy, or Google answers above the links, two or three businesses get named. I find every question your buyers ask, price what each answer is worth in dollars, and run the plan that makes you the one that gets cited — in AI answers and on page one, because the same evidence wins both.",
    tags: ["Answer engine optimization", "Opportunity audits", "AI citation strategy", "Rankings & schema"],
  },
  {
    k: "02",
    t: "Engineer the outcome — custom AI agents",
    d: "Being the answer creates demand; engineering absorbs it. I build the agents that do the work bigger companies hire for: lead follow-up, quoting, reporting, research, back-office flow. Scoped to one high-ROI process, delivered running, your team trained on it.",
    tags: ["Process discovery", "Custom agent builds", "Workflow automation", "Team enablement"],
  },
  {
    k: "03",
    t: "Stay ahead — advisory",
    d: "The answer landscape re-ranks itself constantly; someone has to be accountable for your position in it. A standing seat at your table for search and AI decisions — what to adopt, what to skip, what to build — and a monthly review of the numbers that matter.",
    tags: ["Fractional advisor", "Monthly reviews", "Build vs. buy calls", "Roadmaps"],
  },
];

// Price anchors are starting points — edit freely; they render only here.
const PACKAGES = [
  {
    name: "Opportunity Audit",
    price: "Free",
    unit: "",
    d: "Drop your domain in. Live keyword + AI-answer data, a crawl-powered journey map of your site, every opportunity priced in $/mo, a board-ready report, and the Excel behind it.",
    cta: "Run your audit",
    href: "/audit",
    featured: true,
  },
  {
    name: "Answer Sprint",
    price: "$2,500",
    unit: "/mo · 90 days",
    d: "The audit's roadmap, executed: quick wins first, then the money clusters, then AI citations. Re-measured monthly against the baseline — progress in the same dollars we started with.",
    cta: "Start with the audit",
    href: "/audit",
  },
  {
    name: "Custom Agent Build",
    price: "from $7,500",
    unit: "/project",
    d: "One high-ROI process, scoped and automated end to end — discovery, build, deployment, and a trained team. Fixed scope, working software, no research project.",
    cta: "Book a scoping call",
    href: "#contact",
  },
  {
    name: "Engineer on Call",
    price: "$1,500",
    unit: "/mo",
    d: "Ongoing counsel for search + AI: monthly numbers review, decision support, and first call when the landscape moves. Cancel anytime.",
    cta: "Book an intro",
    href: "#contact",
  },
];

export default function Home() {
  const [domain, setDomain] = useState("");
  const router = useRouter();

  // lead form state
  const [form, setForm] = useState({ name: "", email: "", website: "", interest: "not-sure", message: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const runAudit = () => {
    if (domain.trim()) router.push(`/audit/${encodeURIComponent(domain.trim())}`);
    else router.push("/audit");
  };

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, source: "homepage" }),
      });
    } catch {
      /* success state either way — mailto fallback is displayed */
    } finally {
      setSent(true);
      setSending(false);
    }
  };

  return (
    <div style={{ background: "var(--page)" }}>
      {/* nav */}
      <nav className="sticky top-0 z-50 flex items-center gap-6 px-6 py-3.5 flex-wrap"
        style={{ background: "rgba(4,6,9,.92)", borderBottom: "1px solid var(--border)", backdropFilter: "blur(14px)" }}>
        <a href="/" className="font-bold text-[15px]" style={{ color: "var(--ink)", fontFamily: "Epilogue, sans-serif" }}>
          {BRAND.siteName}
        </a>
        <div className="hidden md:flex gap-5 text-[13px]" style={{ color: "var(--muted)" }}>
          <a href="#services" className="hover:opacity-80">What I do</a>
          <a href="#tool" className="hover:opacity-80">The Audit</a>
          <a href="#packages" className="hover:opacity-80">Packages</a>
        </div>
        <a href="#contact" className="ml-auto text-[13px] font-semibold px-4 py-2 rounded-lg"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          Start a conversation
        </a>
      </nav>

      {/* hero */}
      <header className="max-w-5xl mx-auto px-6 pt-20 pb-14">
        <div className="text-[11px] mono tracking-[0.2em] mb-5" style={{ color: "var(--series-4)" }}>
          FOR SMALL &amp; MID-SIZED BUSINESSES · {BRAND.siteDomain.toUpperCase()}
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold leading-[1.05] max-w-3xl" style={{ color: "var(--ink)", letterSpacing: "-0.02em" }}>
          Search engines stopped giving links.<br />
          They give answers.<br />
          <span style={{ color: "var(--accent)" }}>Be the answer.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-[16px] leading-relaxed" style={{ color: "var(--muted)" }}>
          ChatGPT, Perplexity, and Google&rsquo;s AI Overviews now answer your customers directly —
          naming two or three businesses and ignoring the rest. I&rsquo;m an answer engineer: I get
          owner-led businesses into those answers, onto page one, and then build the AI agents that
          turn being found into being bought.
        </p>
        <div className="mt-9 flex w-full max-w-xl gap-2 flex-wrap">
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAudit()}
            placeholder="yourbusiness.com"
            className="flex-1 min-w-[220px] bg-transparent outline-none text-sm rounded-xl px-4 py-3.5"
            style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }}
          />
          <button onClick={runAudit}
            className="px-5 py-3.5 rounded-xl text-sm font-semibold transition-transform active:scale-95"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            See if you&rsquo;re the answer →
          </button>
        </div>
        <div className="mt-3 text-[12.5px]" style={{ color: "var(--muted)" }}>
          Free. Live data. Every opportunity priced in $/mo. Board-ready report + Excel included. No email required.
        </div>
      </header>

      {/* the blunt version */}
      <section className="max-w-5xl mx-auto px-6 pb-6">
        <div className="card p-6 md:p-7" style={{ borderColor: "var(--series-4)" }}>
          <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--series-4)" }}>THE BLUNT VERSION</div>
          <p className="text-[15px] md:text-[16.5px] leading-relaxed max-w-4xl" style={{ color: "var(--ink)" }}>
            AI didn&rsquo;t add a marketing channel — it replaced the doorway. Every month you&rsquo;re not in
            the answers, an AI is telling your customers, by name, to buy from someone else. The businesses
            leaning in now are compounding citations, rankings, and agent leverage that get harder to catch
            every quarter. The rest are being summarized out of their own market.
            <span style={{ color: "var(--accent)" }}> Lean in aggressively, or be left behind.</span>
          </p>
        </div>
      </section>

      {/* the shift */}
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { t: "The doorway moved", d: "Google still decides who gets found — but a fast-growing share of buying questions are answered inside ChatGPT, AI Overviews, and Perplexity, where most SMBs are invisible and don't know it." },
            { t: "Answers are winner-take-most", d: "An answer engine names two or three businesses per question, not ten blue links. Being quotable — structured data, proof, presence in what the AI reads — is the new page one." },
            { t: "Engineering got cheap", d: "The agent leverage that used to need an enterprise budget now costs less than a part-time hire. The owners adopting it first are compounding while everyone else reads about it." },
          ].map((x) => (
            <div key={x.t} className="card p-5">
              <div className="text-sm font-semibold mb-1.5" style={{ color: "var(--accent)" }}>{x.t}</div>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* services */}
      <section id="services" className="max-w-5xl mx-auto px-6 pb-16">
        <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--accent)" }}>WHAT AN ANSWER ENGINEER DOES</div>
        <h2 className="text-3xl font-bold mb-2" style={{ color: "var(--ink)" }}>Engineer the answer. Then engineer the outcome.</h2>
        <p className="text-[13.5px] mb-8 max-w-2xl" style={{ color: "var(--muted)" }}>
          Answer engines decide who gets discovered; engineering decides who can scale what follows. I do both — that&rsquo;s the point.
        </p>
        <div className="flex flex-col gap-4">
          {SERVICES.map((s) => (
            <div key={s.k} className="card p-6 md:flex gap-6">
              <div className="text-[13px] mono shrink-0 w-8" style={{ color: "var(--series-4)" }}>{s.k}</div>
              <div>
                <div className="text-lg font-bold" style={{ color: "var(--ink)" }}>{s.t}</div>
                <p className="text-[13.5px] mt-2 leading-relaxed max-w-3xl" style={{ color: "var(--muted)" }}>{s.d}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {s.tags.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink-2)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* tool showcase */}
      <section id="tool" className="max-w-5xl mx-auto px-6 pb-16">
        <div className="card p-8" style={{ borderColor: "var(--accent)" }}>
          <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--accent)" }}>
            THE TOOL · {BRAND.product.toUpperCase()}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold max-w-2xl" style={{ color: "var(--ink)" }}>
            Every engagement starts with evidence, not a pitch
          </h2>
          <p className="text-[14px] mt-3 max-w-3xl leading-relaxed" style={{ color: "var(--muted)" }}>
            {BRAND.product} is my audit engine. It pulls your live rankings, real search volumes, AI-assistant
            demand from a 200M+ query dataset, and the citations answer engines give your competitors — then
            prices every gap in revenue per month. Its Journey Map goes deeper still: it crawls your site,
            maps your buyer personas and their journeys, assigns every keyword and AI prompt to the page that
            should win it, and forecasts the capture month by month. You get the interactive audit, a
            client-ready report, and the Excel behind it. Run it yourself, free, right now.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            <a href="/audit" className="px-5 py-3 rounded-xl text-sm font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              Open {BRAND.product} →
            </a>
            <span className="text-[12px] self-center" style={{ color: "var(--muted)" }}>
              ~30 seconds · no signup
            </span>
          </div>
        </div>
      </section>

      {/* packages */}
      <section id="packages" className="max-w-5xl mx-auto px-6 pb-16">
        <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--accent)" }}>PACKAGES</div>
        <h2 className="text-3xl font-bold mb-2" style={{ color: "var(--ink)" }}>Start free. Scale when the numbers say so.</h2>
        <p className="text-[13.5px] mb-8 max-w-2xl" style={{ color: "var(--muted)" }}>
          Everything downstream of the audit is measured against the audit — same model, same dollars, no vanity metrics.
        </p>
        <div className="grid md:grid-cols-4 gap-3">
          {PACKAGES.map((p) => (
            <div key={p.name} className="card p-5 flex flex-col"
              style={p.featured ? { borderColor: "var(--accent)" } : undefined}>
              <div className="text-sm font-bold" style={{ color: "var(--ink)" }}>{p.name}</div>
              <div className="mt-2">
                <span className="text-2xl font-extrabold" style={{ color: p.featured ? "var(--accent)" : "var(--ink)" }}>{p.price}</span>
                <span className="text-[11.5px] ml-1" style={{ color: "var(--muted)" }}>{p.unit}</span>
              </div>
              <p className="text-[12.5px] mt-3 leading-relaxed flex-1" style={{ color: "var(--muted)" }}>{p.d}</p>
              <a href={p.href} className="mt-4 text-center text-[13px] font-semibold px-3 py-2.5 rounded-lg"
                style={p.featured
                  ? { background: "var(--accent)", color: "var(--accent-ink)" }
                  : { border: "1px solid var(--border)", color: "var(--ink-2)" }}>
                {p.cta}
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* how it goes */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid md:grid-cols-3 gap-3">
          {[
            { n: "1", t: "Audit", d: "Free, live-data, priced in dollars — including the crawl-powered Journey Map. We walk it together for 30 minutes." },
            { n: "2", t: "Engineer the plan", d: "A 90-day sequence ordered by payback — quick wins fund the bigger builds, citations compound on top." },
            { n: "3", t: "Compound", d: "Sprints, agents, or advisory — re-measured monthly against the audit baseline, in the same dollars." },
          ].map((x) => (
            <div key={x.n} className="card p-5">
              <div className="text-[22px] font-extrabold mono" style={{ color: "var(--series-4)" }}>{x.n}</div>
              <div className="text-sm font-bold mt-1" style={{ color: "var(--ink)" }}>{x.t}</div>
              <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* lead capture */}
      <section id="contact" className="max-w-5xl mx-auto px-6 pb-20">
        <div className="card p-8 md:flex gap-10">
          <div className="md:w-2/5 mb-6 md:mb-0">
            <div className="text-[11px] mono tracking-[0.18em] mb-2" style={{ color: "var(--accent)" }}>CONTACT</div>
            <h2 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>Tell me what needs an answer</h2>
            <p className="text-[13.5px] mt-3 leading-relaxed" style={{ color: "var(--muted)" }}>
              Two sentences is plenty. I read everything and reply personally — usually within a business day.
              Prefer email? <a href={BRAND.contact} style={{ color: "var(--accent)" }}>Write me directly</a>.
            </p>
          </div>
          <div className="md:flex-1">
            {sent ? (
              <div className="rounded-xl p-6" style={{ background: "var(--surface-2)", border: "1px solid var(--series-2)" }}>
                <div className="text-lg font-bold" style={{ color: "var(--series-2)" }}>Got it — talk soon.</div>
                <p className="text-[13px] mt-2" style={{ color: "var(--muted)" }}>
                  While you wait: <a href="/audit" style={{ color: "var(--accent)" }}>run the free audit</a> on your domain
                  so we have real numbers for the conversation.
                </p>
              </div>
            ) : (
              <form onSubmit={submitLead} className="grid gap-2.5">
                <div className="grid md:grid-cols-2 gap-2.5">
                  <input required placeholder="Name" value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="bg-transparent outline-none text-sm rounded-lg px-3.5 py-3"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
                  <input required type="email" placeholder="Email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="bg-transparent outline-none text-sm rounded-lg px-3.5 py-3"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
                </div>
                <div className="grid md:grid-cols-2 gap-2.5">
                  <input placeholder="Company website (optional)" value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                    className="bg-transparent outline-none text-sm rounded-lg px-3.5 py-3"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
                  <select value={form.interest}
                    onChange={(e) => setForm({ ...form, interest: e.target.value })}
                    className="outline-none text-sm rounded-lg px-3 py-3"
                    style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }}>
                    <option value="not-sure">Not sure yet — let&rsquo;s talk</option>
                    <option value="audit">Opportunity audit walkthrough</option>
                    <option value="seo-geo">Getting into AI answers / SEO</option>
                    <option value="agents">AI agents & automation</option>
                    <option value="advisory">Ongoing advisory</option>
                  </select>
                </div>
                <textarea placeholder="What are you trying to grow, fix, or automate?" rows={4} value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="bg-transparent outline-none text-sm rounded-lg px-3.5 py-3 resize-y"
                  style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
                <button type="submit" disabled={sending}
                  className="px-5 py-3.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                  style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                  {sending ? "Sending…" : "Send it"}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="px-6 py-8" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="max-w-5xl mx-auto flex flex-wrap gap-4 items-center text-[12px]" style={{ color: "var(--muted)" }}>
          <span className="font-semibold" style={{ color: "var(--ink-2)" }}>{BRAND.siteName}</span>
          <span>{BRAND.practiceFocus}</span>
          <span className="ml-auto flex gap-4">
            <a href="/audit" style={{ color: "var(--muted)" }}>{BRAND.product}</a>
            <a href={BRAND.contact} style={{ color: "var(--muted)" }}>Email</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
