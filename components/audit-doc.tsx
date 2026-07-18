// The client-facing consulting report — the document you put in front of a
// board. Light, print-first, consulting-house conventions: an executive
// summary that stands alone, numbered exhibits with action titles (the
// takeaway IS the title), a "so what" under every exhibit, and an honest
// methodology appendix. One click to print/PDF; the same data as the
// dashboard, cached, so it's instant after the audit runs.

import { PrintButton } from "@/components/print";
import { BRAND } from "@/lib/brand";
import { fmtNum, fmtUsd } from "@/lib/audit/model";
import type { OpportunityAudit } from "@/lib/audit/types";

const C = {
  ink: "#16202e",
  ink2: "#3d4a5c",
  muted: "#77808d",
  rule: "#d9dde3",
  accent: "#0e7490",
  bad: "#b42318",
  good: "#067647",
  wash: "#f4f6f8",
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10.5, letterSpacing: "0.16em", color: C.accent, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Exhibit({ n, title, children, soWhat }: { n: number; title: string; children: React.ReactNode; soWhat?: string }) {
  return (
    <section style={{ marginTop: 40, breakInside: "avoid" }}>
      <Kicker>EXHIBIT {n}</Kicker>
      <h2 style={{ fontFamily: "Epilogue, sans-serif", fontSize: 19, fontWeight: 700, color: C.ink, margin: "0 0 14px", lineHeight: 1.3 }}>
        {title}
      </h2>
      {children}
      {soWhat && (
        <p style={{ fontSize: 12.5, color: C.ink2, marginTop: 10, paddingLeft: 10, borderLeft: `3px solid ${C.accent}` }}>
          <strong style={{ color: C.accent }}>So what: </strong>{soWhat}
        </p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "7px 9px", fontFamily: "IBM Plex Mono, monospace",
  fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: C.muted,
  borderBottom: `2px solid ${C.ink}`, whiteSpace: "nowrap",
};
const td: React.CSSProperties = { padding: "7px 9px", borderBottom: `1px solid ${C.rule}`, fontSize: 12, color: C.ink2, verticalAlign: "top" };
const tdNum: React.CSSProperties = { ...td, fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap" };
const tdStrong: React.CSSProperties = { ...td, color: C.ink, fontWeight: 600 };

function HBar({ value, max, color = C.accent }: { value: number; max: number; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 10, background: C.wash }}>
        <div style={{ width: `${Math.max(2, (value / Math.max(max, 1)) * 100)}%`, height: 10, background: color }} />
      </div>
      <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11.5, color: C.ink, minWidth: 74, textAlign: "right" }}>
        +{fmtUsd(value)}/mo
      </span>
    </div>
  );
}

export default function AuditDoc({ audit: a }: { audit: OpportunityAudit }) {
  const top = a.clusters[0];
  const maxOpp = Math.max(...a.topOpportunities.map((o) => o.monthly), 1);
  const quickWinTotal = a.quickWins.reduce((s, w) => s + w.monthlyUpside, 0);

  return (
    <div style={{ background: "#ffffff", minHeight: "100vh", color: C.ink2, fontFamily: "IBM Plex Sans, system-ui, sans-serif" }}>
      <style>{`
        @media print { .no-print { display: none !important; } .page-break { break-before: page; } }
        @page { margin: 16mm; }
      `}</style>

      {/* toolbar — screen only */}
      <div className="no-print" style={{ background: C.ink, padding: "10px 24px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{BRAND.product} · client report</span>
        <span style={{ flex: 1 }} />
        <a href={`/api/audit/export?domain=${a.brand.domain}`}
          style={{ background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.4)", borderRadius: 8, padding: "8px 14px", fontSize: 13, textDecoration: "none" }}>
          ⬇ Excel workbook
        </a>
        <a href={`/audit/${a.brand.domain}`}
          style={{ color: "rgba(255,255,255,.7)", fontSize: 13, textDecoration: "none" }}>
          ← interactive audit
        </a>
        <PrintButton />
      </div>

      <div style={{ maxWidth: 780, margin: "0 auto", padding: "44px 28px 80px" }}>
        {/* cover */}
        <div style={{ borderBottom: `3px solid ${C.ink}`, paddingBottom: 22 }}>
          <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, letterSpacing: "0.18em", color: C.muted, marginBottom: 18 }}>
            PRIVATE &amp; CONFIDENTIAL · PREPARED FOR {a.brand.name.toUpperCase()} · {a.meta.generatedAt.toUpperCase()}
          </div>
          <h1 style={{ fontFamily: "Epilogue, sans-serif", fontSize: 33, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.15, letterSpacing: "-0.02em" }}>
            Search &amp; AI-answer revenue:<br />the uncaptured opportunity
          </h1>
          <div style={{ marginTop: 14, fontSize: 13, color: C.ink2 }}>
            {a.brand.domain} · {a.brand.category} · {a.meta.mode === "live" ? "Live market data (DataForSEO)" : "Demonstration data"}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: C.muted }}>
            {BRAND.productTagline} · {BRAND.practiceFocus}
          </div>
        </div>

        {/* executive summary */}
        <section style={{ marginTop: 34 }}>
          <Kicker>EXECUTIVE SUMMARY</Kicker>
          <h2 style={{ fontFamily: "Epilogue, sans-serif", fontSize: 21, fontWeight: 700, color: C.ink, margin: "0 0 14px" }}>
            {a.brand.name} captures {a.score.overall}% of its addressable search demand — {fmtUsd(a.economics.opportunity.base)}/mo is on the table
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, margin: "18px 0" }}>
            {[
              { l: "Capture score", v: `${a.score.overall}/100`, s: `grade ${a.score.grade}` },
              { l: "Demand audited", v: `${fmtNum(a.headline.totalVolume + a.headline.totalAiVolume)}/mo`, s: `${a.geo.aiVolumeShare}% via AI assistants` },
              { l: "Traffic value today", v: fmtUsd(a.economics.trafficValueNow), s: "current clicks priced as ads" },
              { l: "Incremental at target", v: `${fmtUsd(a.economics.opportunity.base)}/mo`, s: `${fmtUsd(a.economics.opportunity.conservative)}–${fmtUsd(a.economics.opportunity.aggressive)} range` },
            ].map((x) => (
              <div key={x.l} style={{ background: C.wash, padding: "12px 12px 10px", borderTop: `3px solid ${C.accent}` }}>
                <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase" }}>{x.l}</div>
                <div style={{ fontFamily: "Epilogue, sans-serif", fontSize: 21, fontWeight: 800, color: C.ink, marginTop: 3 }}>{x.v}</div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{x.s}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.ink2 }}>{a.score.verdict}</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.ink2 }}>
            <strong style={{ color: C.ink }}>Business model read — {a.businessModel.model}. </strong>
            {a.businessModel.citationStrategy}
          </p>
          {a.observations && a.observations.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, marginBottom: 8 }}>Key findings from the data:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {a.observations.map((o) => (
                  <li key={o.title} style={{ fontSize: 12.5, lineHeight: 1.65, color: C.ink2, marginBottom: 6 }}>
                    <strong style={{ color: C.ink }}>{o.title}. </strong>{o.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Exhibit 1 — opportunity ranking */}
        <div className="page-break" />
        <Exhibit n={1}
          title={`"${top.name}" is the largest single prize — ${fmtUsd(top.monthlyRevenue.base)}/mo at target positions`}
          soWhat={`SEO and AI-citation plays are ranked in one list, priced in the same unit. The top three account for ${fmtUsd(a.topOpportunities.slice(0, 3).reduce((s, o) => s + o.monthly, 0))}/mo — the 90-day plan (Exhibit 7) sequences them by payback.`}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>#</th><th style={th}>Opportunity</th><th style={th}>Type</th><th style={{ ...th, width: "42%" }}>Incremental revenue (base)</th></tr></thead>
            <tbody>
              {a.topOpportunities.map((o, i) => (
                <tr key={o.title}>
                  <td style={tdNum}>{i + 1}</td>
                  <td style={tdStrong}>{o.title}<div style={{ fontWeight: 400, fontSize: 11, color: C.muted, marginTop: 2 }}>{o.detail}</div></td>
                  <td style={tdNum}>{o.kind.toUpperCase()}</td>
                  <td style={td}><HBar value={o.monthly} max={maxOpp} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Exhibit>

        {/* Exhibit 2 — cluster economics */}
        <Exhibit n={2}
          title="Five demand clusters, three revenue scenarios each — every dollar traces to the stated model"
          soWhat={a.economics.assumptionsNote + " Scenario definitions are in the appendix."}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Cluster</th><th style={th}>Stage</th><th style={th}>Demand/mo</th>
              <th style={th}>Position</th><th style={th}>Cons.</th><th style={th}>Base</th><th style={th}>Aggr.</th>
            </tr></thead>
            <tbody>
              {a.clusters.map((c) => (
                <tr key={c.id}>
                  <td style={tdStrong}>{c.name}{c.competitorOwning && <div style={{ fontWeight: 400, fontSize: 11, color: C.bad, marginTop: 2 }}>held by {c.competitorOwning}</div>}</td>
                  <td style={tdNum}>{c.stage}</td>
                  <td style={tdNum}>{fmtNum(c.totalVolume)} + {fmtNum(c.totalAiVolume)} AI</td>
                  <td style={tdNum}>{c.bestPosition ? `#${c.bestPosition}` : "—"} → #{c.targetPosition}</td>
                  <td style={tdNum}>{fmtUsd(c.monthlyRevenue.conservative)}</td>
                  <td style={{ ...tdNum, color: C.ink, fontWeight: 700 }}>{fmtUsd(c.monthlyRevenue.base)}</td>
                  <td style={tdNum}>{fmtUsd(c.monthlyRevenue.aggressive)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...tdStrong, borderTop: `2px solid ${C.ink}` }}>Total</td>
                <td style={{ ...td, borderTop: `2px solid ${C.ink}` }} colSpan={3}></td>
                <td style={{ ...tdNum, borderTop: `2px solid ${C.ink}` }}>{fmtUsd(a.economics.opportunity.conservative)}</td>
                <td style={{ ...tdNum, borderTop: `2px solid ${C.ink}`, color: C.ink, fontWeight: 700 }}>{fmtUsd(a.economics.opportunity.base)}</td>
                <td style={{ ...tdNum, borderTop: `2px solid ${C.ink}` }}>{fmtUsd(a.economics.opportunity.aggressive)}</td>
              </tr>
            </tbody>
          </table>
        </Exhibit>

        {/* Exhibit 3 — quick wins */}
        {a.quickWins.length > 0 && (
          <Exhibit n={3}
            title={`${a.quickWins.length} keywords sit one push from a different CTR class — ${fmtUsd(quickWinTotal)}/mo of fast payback`}
            soWhat="These fund the program: on-page refreshes and internal links, not new builds. They are the first 30 days of the plan.">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Keyword</th><th style={th}>Now → target</th><th style={th}>Searches/mo</th><th style={th}>Upside</th><th style={th}>Note</th></tr></thead>
              <tbody>
                {a.quickWins.map((w) => (
                  <tr key={w.term}>
                    <td style={tdStrong}>{w.term}</td>
                    <td style={tdNum}>#{w.position} → #{w.targetPosition}</td>
                    <td style={tdNum}>{w.volume.toLocaleString()}</td>
                    <td style={{ ...tdNum, color: C.good, fontWeight: 700 }}>+{fmtUsd(w.monthlyUpside)}/mo</td>
                    <td style={{ ...td, fontSize: 11 }}>{w.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Exhibit>
        )}

        {/* Exhibit 4 — GEO */}
        <div className="page-break" />
        <Exhibit n={4}
          title={`${fmtNum(a.geo.totalAiVolume)} searches/mo now happen inside AI assistants — ${a.brand.name} is cited in ${a.geo.citationRate}% of tracked buying answers`}
          soWhat={a.geo.missedPrompts.length > 0
            ? `${a.geo.missedPrompts.length} tracked buying prompts name competitors and skip ${a.brand.name} entirely. The readiness fixes below are low-cost and compound: schema, crawler access, and quotable proof are the prerequisites for every citation win.`
            : "Citation coverage is strong; the job is defense — keep the proof fresh and the schema intact."}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
            <thead><tr><th style={th}>AI surface</th><th style={th}>Citation rate</th><th style={th}>Prompts tracked</th></tr></thead>
            <tbody>
              {a.geo.surfaces.map((s) => (
                <tr key={s.name}>
                  <td style={tdStrong}>{s.name}</td>
                  <td style={td}><HBarPct value={s.citationRate} /></td>
                  <td style={tdNum}>{s.promptsTracked}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.geo.missedPrompts.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 14 }}>
              <thead><tr><th style={th}>Buying prompt being lost</th><th style={th}>Surface</th><th style={th}>Cited instead</th></tr></thead>
              <tbody>
                {a.geo.missedPrompts.map((m) => (
                  <tr key={m.prompt}>
                    <td style={td}>&ldquo;{m.prompt}&rdquo;</td>
                    <td style={tdNum}>{m.surface}</td>
                    <td style={{ ...td, color: C.bad }}>{m.citedInstead.slice(0, 3).join(", ") || "competitors"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>AI-readiness check</th><th style={th}>Status</th><th style={th}>Fix</th></tr></thead>
            <tbody>
              {a.geo.readiness.map((r) => (
                <tr key={r.check}>
                  <td style={tdStrong}>{r.check}</td>
                  <td style={{ ...tdNum, color: r.status === "pass" ? C.good : r.status === "partial" ? "#996a00" : C.bad, fontWeight: 700 }}>{r.status.toUpperCase()}</td>
                  <td style={{ ...td, fontSize: 11 }}>{r.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Exhibit>

        {/* Exhibit 5 — SERP real estate */}
        <Exhibit n={5}
          title="The results pages for this demand are feature-heavy — owning the features matters as much as ranking"
          soWhat="Presence = share of audited SERPs showing the feature; owned = share of those where the brand holds it. The gap between the bars is claimable real estate.">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>SERP feature</th><th style={th}>On SERPs</th><th style={th}>Brand holds</th><th style={th}>Read</th></tr></thead>
            <tbody>
              {a.serpRealEstate.map((f) => (
                <tr key={f.feature}>
                  <td style={tdStrong}>{f.label}</td>
                  <td style={tdNum}>{f.presence}%</td>
                  <td style={{ ...tdNum, color: f.owned < 20 ? C.bad : C.ink }}>{f.owned}%</td>
                  <td style={{ ...td, fontSize: 11 }}>{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Exhibit>

        {/* Exhibit 6 — competitors */}
        <Exhibit n={6}
          title={`${a.headline.topCompetitor} holds the head start — but the exclusives are addressable, not structural`}
          soWhat="Their exclusive keywords are the map of content they built and the brand hasn't. The cluster plays in Exhibit 2 target exactly these gaps.">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Competitor</th><th style={th}>Shared kws</th><th style={th}>Their exclusive</th><th style={th}>Traffic value</th><th style={th}>AI citation</th></tr></thead>
            <tbody>
              {a.competitorGaps.map((c) => (
                <tr key={c.domain}>
                  <td style={tdStrong}>{c.name}<div style={{ fontWeight: 400, fontSize: 10.5, color: C.muted }}>{c.domain}</div></td>
                  <td style={tdNum}>{c.sharedKeywords.toLocaleString()}</td>
                  <td style={{ ...tdNum, color: C.bad }}>{c.theirExclusive.toLocaleString()}</td>
                  <td style={tdNum}>{fmtUsd(c.estTrafficValue)}/mo</td>
                  <td style={tdNum}>{c.aiCitationRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Exhibit>

        {/* Exhibit 7 — roadmap */}
        <div className="page-break" />
        <Exhibit n={7}
          title="A 90-day sequence, ordered by payback: quick wins fund the builds, citations compound on top"
          soWhat={`Expected lift is cumulative run-rate at the end of each phase, reaching ${fmtUsd(a.economics.opportunity.base)}/mo — the base case from Exhibit 2.`}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Phase</th><th style={th}>Focus</th><th style={th}>Moves</th><th style={th}>KPI</th><th style={th}>Lift</th></tr></thead>
            <tbody>
              {a.roadmap.map((p) => (
                <tr key={p.phase}>
                  <td style={{ ...tdNum, fontWeight: 700, color: C.accent }}>{p.phase}</td>
                  <td style={tdStrong}>{p.focus}</td>
                  <td style={td}><ul style={{ margin: 0, paddingLeft: 14 }}>{p.moves.map((m) => <li key={m} style={{ marginBottom: 4, fontSize: 11.5 }}>{m}</li>)}</ul></td>
                  <td style={{ ...td, fontSize: 11 }}>{p.kpi}</td>
                  <td style={{ ...tdNum, color: C.good, fontWeight: 700 }}>{p.expectedLift}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Exhibit>

        {/* the ask */}
        <section style={{ marginTop: 40, background: C.wash, borderTop: `3px solid ${C.ink}`, padding: "18px 20px" }}>
          <Kicker>RECOMMENDATION</Kicker>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: C.ink2, margin: 0 }}>
            Commit to the 90-day sequence in Exhibit 7. Phase one is self-funding — {a.quickWins.length > 0 ? `${fmtUsd(quickWinTotal)}/mo of striking-distance upside` : "the foundational fixes"} against days of work, not months — and every later phase compounds on it.
            The AI-answer share is the asymmetric bet: citations are still cheap to claim, and this audit shows exactly which answers are being lost and to whom.
          </p>
          <a className="no-print" href={BRAND.contact}
            style={{ display: "inline-block", marginTop: 12, background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            Walk through this report with me →
          </a>
        </section>

        {/* appendix */}
        <section style={{ marginTop: 36 }}>
          <Kicker>APPENDIX — METHODOLOGY &amp; SOURCES</Kicker>
          <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
            {a.meta.methodology.map((m) => (
              <li key={m} style={{ fontSize: 11, lineHeight: 1.6, color: C.muted, marginBottom: 4 }}>{m}</li>
            ))}
          </ul>
          <div style={{ marginTop: 10 }}>
            {a.meta.sources.map((s) => (
              <div key={s} style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: s.startsWith("LIVE") ? C.good : C.muted, marginBottom: 2 }}>{s}</div>
            ))}
          </div>
          <div style={{ marginTop: 24, paddingTop: 12, borderTop: `1px solid ${C.rule}`, display: "flex", justifyContent: "space-between", fontFamily: "IBM Plex Mono, monospace", fontSize: 10, color: C.muted }}>
            <span>{BRAND.product} · {BRAND.productTagline}</span>
            <span>{BRAND.practice} · {BRAND.practiceFocus}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function HBarPct({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 10, background: C.wash }}>
        <div style={{ width: `${Math.max(2, value)}%`, height: 10, background: C.accent }} />
      </div>
      <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11.5, color: C.ink, minWidth: 38, textAlign: "right" }}>{value}%</span>
    </div>
  );
}
