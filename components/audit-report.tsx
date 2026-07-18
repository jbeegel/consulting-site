// The Opportunity Audit surface — the pre-sale artifact that wows a
// prospect. Dark console aesthetic, but organized as four simple
// dashboards a founder can scan in ninety seconds:
//
//   1. The verdict — score, grade, and the money sentence
//   2. Top opportunities — SEO and GEO plays ranked together in $/mo
//   3. The reports — SEO (clusters, quick wins, SERP real estate) and
//      GEO (AI demand, citations, readiness), each self-contained
//   4. The plan — 90-day roadmap + honest methodology
//
// Server component; the only client children are the chart primitives.

import { Bars, LineChart } from "@/components/charts";
import { PrintButton } from "@/components/print";
import { BRAND } from "@/lib/brand";
import { fmtNum, fmtUsd } from "@/lib/audit/model";
import type {
  OpportunityAudit,
  OpportunityCluster,
  TopOpportunity,
} from "@/lib/audit/types";

const STAGE_META: Record<OpportunityCluster["stage"], { label: string; color: string }> = {
  capture: { label: "CAPTURE", color: "var(--series-1)" },
  grow: { label: "GROW", color: "var(--warning)" },
  defend: { label: "DEFEND", color: "var(--series-2)" },
};

const KIND_META: Record<TopOpportunity["kind"], { label: string; color: string }> = {
  seo: { label: "SEO", color: "var(--series-1)" },
  geo: { label: "GEO", color: "var(--series-4)" },
  both: { label: "SEO + GEO", color: "var(--accent)" },
};

function ScoreDial({ score, grade }: { score: number; grade: string }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c * 0.75; // 270° dial
  const color = score < 35 ? "var(--critical)" : score < 60 ? "var(--warning)" : "var(--good)";
  return (
    <div className="relative shrink-0" style={{ width: 168, height: 168 }}>
      <svg width={168} height={168} viewBox="0 0 168 168" className="-rotate-[135deg]">
        <circle cx={84} cy={84} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={11}
          strokeDasharray={`${c * 0.75} ${c}`} strokeLinecap="round" />
        <circle cx={84} cy={84} r={r} fill="none" stroke={color} strokeWidth={11}
          strokeDasharray={`${filled} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold" style={{ color: "var(--ink)" }}>{grade}</div>
        <div className="text-[11px] mono mt-1" style={{ color: "var(--muted)" }}>
          {score}/100 CAPTURED
        </div>
      </div>
    </div>
  );
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="mt-14 mb-5">
      <div className="text-[11px] mono tracking-[0.18em] mb-1.5" style={{ color: "var(--accent)" }}>
        {kicker}
      </div>
      <h2 className="text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>{title}</h2>
      {sub && <p className="text-[13.5px] mt-1.5 max-w-3xl leading-relaxed" style={{ color: "var(--muted)" }}>{sub}</p>}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] mono tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-[26px] font-bold mt-0.5 leading-tight" style={{ color: accent ?? "var(--ink)" }}>{value}</div>
      {sub && <div className="text-[11.5px] mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[10px] mono px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color, border: `1px solid ${color}`, opacity: 0.95 }}
    >
      {label}
    </span>
  );
}

const th = "text-left px-3 py-2 text-[10.5px] mono tracking-[0.08em] uppercase";
const td = "px-3 py-2.5 border-t text-[13px]";

export default function AuditDeep({ audit: a }: { audit: OpportunityAudit }) {
  const maxOpp = Math.max(...a.topOpportunities.map((o) => o.monthly), 1);
  const scanScale = (n: number) => `${Math.max(3, (n / maxOpp) * 100)}%`;

  return (
    <div className="audit-root min-h-screen pb-20" style={{ background: "var(--page)", color: "var(--ink-2)" }}>
      <style>{`
        @media print {
          .audit-root { --page:#fff; --surface-1:#fff; --surface-2:#f6f5f2; --surface-3:#eceae5;
            --ink:#141311; --ink-2:#3c3a35; --muted:#6d6a63; --border:#ddd9d1; --grid:#e8e5df; }
          .no-print { display: none !important; }
        }
        @page { margin: 14mm; }
      `}</style>

      <div className="max-w-5xl mx-auto px-5">
        {/* masthead */}
        <div className="flex items-center justify-between pt-8 pb-6 flex-wrap gap-3"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="text-[11px] mono tracking-[0.2em]" style={{ color: "var(--muted)" }}>
            {BRAND.product.toUpperCase()} · {BRAND.productTagline.toUpperCase()} · {a.meta.generatedAt.toUpperCase()}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[10px] mono px-2 py-1 rounded-md"
              style={{
                background: "var(--surface-2)", border: "1px solid var(--border)",
                color: a.meta.mode === "live" ? "var(--good)" : "var(--warning)",
              }}>
              {a.meta.mode === "live" ? "● LIVE DATA" : "● DEMO DATA"}
            </span>
            <a href={`/audit/${a.brand.domain}/report`}
              className="no-print text-[13px] font-semibold px-3.5 py-2 rounded-lg"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
              📄 Client report
            </a>
            <a href={`/api/audit/export?domain=${a.brand.domain}`}
              className="no-print text-[13px] font-semibold px-3.5 py-2 rounded-lg"
              style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>
              ⬇ Excel
            </a>
            <PrintButton />
          </div>
        </div>

        {/* ============ 1 · THE VERDICT ============ */}
        <div className="flex flex-wrap items-center gap-8 mt-10 fade-up">
          <ScoreDial score={a.score.overall} grade={a.score.grade} />
          <div className="flex-1 min-w-[280px]">
            <h1 className="text-4xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
              {a.brand.name}
            </h1>
            <div className="text-[13px] mt-1 mono" style={{ color: "var(--muted)" }}>
              {a.brand.domain} · {a.brand.category} · vs {a.headline.topCompetitor}
            </div>
            <div className="flex gap-5 mt-4">
              {[
                { l: "SEO CAPTURE", v: a.score.seo },
                { l: "GEO / AI CAPTURE", v: a.score.geo },
              ].map((s) => (
                <div key={s.l}>
                  <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>{s.l}</div>
                  <div className="text-xl font-bold"
                    style={{ color: s.v < 35 ? "var(--critical)" : s.v < 60 ? "var(--warning)" : "var(--good)" }}>
                    {s.v}%
                  </div>
                </div>
              ))}
              <div>
                <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>OPPORTUNITY (BASE)</div>
                <div className="text-xl font-bold" style={{ color: "var(--accent)" }}>
                  {fmtUsd(a.economics.opportunity.base)}/mo
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="text-[15px] leading-[1.75] mt-6 max-w-4xl" style={{ color: "var(--ink-2)" }}>
          {a.score.verdict}
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-7">
          <Stat label="GOOGLE DEMAND AUDITED" value={`${fmtNum(a.headline.totalVolume)}/mo`}
            sub={`${a.headline.keywordsAudited} keywords · ${a.headline.clustersFound} clusters`} />
          <Stat label="AI-ASSISTANT DEMAND" value={`${fmtNum(a.headline.totalAiVolume)}/mo`}
            sub={`${a.geo.aiVolumeShare}% of total demand`} accent="var(--series-4)" />
          <Stat label="TRAFFIC VALUE TODAY" value={fmtUsd(a.economics.trafficValueNow)}
            sub="what current clicks cost as ads" />
          <Stat label="INCREMENTAL AT TARGET" value={`${fmtUsd(a.economics.opportunity.base)}/mo`}
            sub={`${fmtUsd(a.economics.opportunity.conservative)}–${fmtUsd(a.economics.opportunity.aggressive)} range`}
            accent="var(--accent)" />
        </div>

        {/* business-model read — the citation side adjusts to how money is made */}
        <div className="card p-5 mt-6">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[11px] mono tracking-[0.14em]" style={{ color: "var(--accent)" }}>
              BUSINESS MODEL READ
            </span>
            <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{a.businessModel.model}</span>
            <span className="flex gap-1.5 flex-wrap ml-auto">
              {a.businessModel.keySurfaces.map((s) => (
                <span key={s} className="text-[10.5px] px-2 py-0.5 rounded-full"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--ink-2)" }}>
                  {s}
                </span>
              ))}
            </span>
          </div>
          <p className="text-[13px] mt-2.5 leading-relaxed" style={{ color: "var(--muted)" }}>
            {a.businessModel.revenueMotion}
          </p>
          <p className="text-[13.5px] mt-2 leading-relaxed" style={{ color: "var(--ink-2)" }}>
            <strong style={{ color: "var(--series-4)" }}>How citations get won for this model: </strong>
            {a.businessModel.citationStrategy}
          </p>
        </div>

        {/* analyst observations — present when the Claude analyst pass ran on live data */}
        {a.observations && a.observations.length > 0 && (
          <>
            <SectionHead kicker="ANALYST PASS" title="What a strategist would circle"
              sub="Written by the analyst layer from this audit's live data — anomalies, mismatches, and unclaimed openings the standard sections don't call out." />
            <div className="grid md:grid-cols-2 gap-3">
              {a.observations.map((o) => {
                const c =
                  o.kind === "geo" ? "var(--series-4)"
                  : o.kind === "competitive" ? "var(--series-3)"
                  : o.kind === "technical" ? "var(--series-2)"
                  : "var(--series-1)";
                return (
                  <div key={o.title} className="card p-4" style={{ borderLeft: `2px solid ${c}` }}>
                    <div className="flex items-center gap-2">
                      <Badge label={o.kind.toUpperCase()} color={c} />
                      <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{o.title}</span>
                    </div>
                    <p className="text-[13px] mt-2 leading-relaxed" style={{ color: "var(--ink-2)" }}>{o.detail}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ============ 2 · TOP OPPORTUNITIES ============ */}
        <SectionHead kicker="WHERE THE MONEY IS" title="Top opportunities — SEO and GEO, one ranking"
          sub="Every play priced in the same unit: incremental revenue per month at target, base scenario. This is the priority order." />
        <div className="flex flex-col gap-2.5">
          {a.topOpportunities.map((o, i) => (
            <div key={o.title} className="card p-4 fade-up">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-[15px] font-bold mono w-7 shrink-0" style={{ color: "var(--muted)" }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{o.title}</span>
                <Badge label={KIND_META[o.kind].label} color={KIND_META[o.kind].color} />
                <span className="ml-auto text-lg font-bold" style={{ color: "var(--accent)" }}>
                  +{fmtUsd(o.monthly)}/mo
                </span>
              </div>
              <div className="h-1.5 rounded-full mt-2.5 mb-2" style={{ background: "var(--surface-2)" }}>
                <div className="h-1.5 rounded-full" style={{ width: scanScale(o.monthly), background: KIND_META[o.kind].color, opacity: 0.85 }} />
              </div>
              <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>{o.detail}</div>
              <div className="text-[13px] mt-1.5" style={{ color: "var(--ink-2)" }}>
                <span style={{ color: "var(--series-2)" }}>→ </span>{o.action}
              </div>
            </div>
          ))}
        </div>

        {/* ============ 3a · SEO REPORT ============ */}
        <SectionHead kicker="SEO REPORT" title="Opportunity clusters"
          sub={`${a.headline.keywordsAudited} keywords grouped into the plays that win them. ${a.economics.assumptionsNote}`} />
        <div className="flex flex-col gap-4">
          {a.clusters.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge label={STAGE_META[c.stage].label} color={STAGE_META[c.stage].color} />
                <span className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>{c.name}</span>
                <span className="text-[12px] mono" style={{ color: "var(--muted)" }}>
                  {fmtNum(c.totalVolume)} Google + {fmtNum(c.totalAiVolume)} AI /mo · KD {c.avgDifficulty}
                </span>
                <span className="ml-auto text-[17px] font-bold" style={{ color: "var(--accent)" }}>
                  +{fmtUsd(c.monthlyRevenue.base)}/mo
                </span>
              </div>
              <div className="grid md:grid-cols-2 gap-4 mt-3">
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>{c.why}</p>
                <div>
                  <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                    <strong style={{ color: "var(--series-2)" }}>The play: </strong>{c.play}
                  </p>
                  <div className="flex gap-4 mt-2.5 text-[12px] mono flex-wrap" style={{ color: "var(--muted)" }}>
                    <span>now: {c.bestPosition ? `#${c.bestPosition}` : "unranked"} → target #{c.targetPosition}</span>
                    <span>{fmtNum(c.currentTraffic)} → {fmtNum(c.potentialTraffic)} visits/mo</span>
                    {c.competitorOwning && <span style={{ color: "var(--serious)" }}>held by {c.competitorOwning}</span>}
                  </div>
                  <div className="flex gap-3 mt-2 text-[12px] mono" style={{ color: "var(--muted)" }}>
                    <span>cons {fmtUsd(c.monthlyRevenue.conservative)}</span>
                    <span style={{ color: "var(--ink-2)" }}>base {fmtUsd(c.monthlyRevenue.base)}</span>
                    <span>aggr {fmtUsd(c.monthlyRevenue.aggressive)}</span>
                  </div>
                </div>
              </div>
              <details className="mt-3">
                <summary className="text-[12px] mono cursor-pointer select-none" style={{ color: "var(--series-1)" }}>
                  {c.keywords.length} keywords ▾
                </summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full border-collapse min-w-[640px]">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className={th}>Keyword</th>
                        <th className={th}>Intent</th>
                        <th className={th}>Google/mo</th>
                        <th className={th}>AI/mo</th>
                        <th className={th}>CPC</th>
                        <th className={th}>KD</th>
                        <th className={th}>Position</th>
                        <th className={th}>AI answer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.keywords.map((k) => (
                        <tr key={k.term}>
                          <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{k.term}</td>
                          <td className={`${td} mono text-[11px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{k.intent}</td>
                          <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{k.volume.toLocaleString()}</td>
                          <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--series-4)" }}>{k.aiVolume.toLocaleString()}</td>
                          <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>${k.cpc.toFixed(2)}</td>
                          <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{k.difficulty}</td>
                          <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: k.position && k.position <= 10 ? "var(--good)" : "var(--muted)" }}>
                            {k.position ? `#${k.position}` : "—"}
                          </td>
                          <td className={`${td} text-[11.5px]`} style={{ borderColor: "var(--border)", color: k.aiCited ? "var(--good)" : k.aiOverviewPresent ? "var(--serious)" : "var(--muted)" }}>
                            {k.aiCited ? "cited" : k.aiOverviewPresent ? "shown, not cited" : "no AI Overview"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ))}
        </div>

        {a.quickWins.length > 0 && (
          <>
            <SectionHead kicker="SEO REPORT" title="Quick wins — striking distance"
              sub="Positions 4–15, where one push changes the CTR class. Fastest payback in the entire plan." />
            <div className="card p-2 overflow-x-auto">
              <table className="w-full border-collapse min-w-[640px]">
                <thead>
                  <tr style={{ color: "var(--muted)" }}>
                    <th className={th}>Keyword</th>
                    <th className={th}>Now</th>
                    <th className={th}>Target</th>
                    <th className={th}>Google/mo</th>
                    <th className={th}>Upside</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {a.quickWins.map((w) => (
                    <tr key={w.term}>
                      <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{w.term}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--warning)" }}>#{w.position}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--good)" }}>#{w.targetPosition}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{w.volume.toLocaleString()}</td>
                      <td className={`${td} mono font-bold`} style={{ borderColor: "var(--border)", color: "var(--accent)" }}>+{fmtUsd(w.monthlyUpside)}/mo</td>
                      <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{w.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <SectionHead kicker="SEO REPORT" title="SERP real estate"
          sub="What the results pages for this demand actually look like — and how much of each surface the brand holds." />
        <div className="grid md:grid-cols-2 gap-3">
          {a.serpRealEstate.map((f) => (
            <div key={f.feature} className="card p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold" style={{ color: f.feature === "ai_overview" ? "var(--series-4)" : "var(--ink)" }}>
                  {f.label}
                </span>
                <span className="text-[12px] mono" style={{ color: "var(--muted)" }}>
                  on {f.presence}% of SERPs · you hold {f.owned}%
                </span>
              </div>
              <div className="h-2 rounded-full mt-2 relative overflow-hidden" style={{ background: "var(--surface-2)" }}>
                <div className="h-2 rounded-full absolute" style={{ width: `${f.presence}%`, background: "var(--surface-3)" }} />
                <div className="h-2 rounded-full absolute" style={{ width: `${(f.presence * f.owned) / 100}%`, background: f.feature === "ai_overview" ? "var(--series-4)" : "var(--series-1)" }} />
              </div>
              <p className="text-[12px] mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>{f.note}</p>
            </div>
          ))}
        </div>

        {/* ============ 3b · GEO REPORT ============ */}
        <SectionHead kicker="GEO REPORT" title="AI-assistant demand & citations"
          sub={a.geo.verdict} />
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-5">
            <LineChart
              points={a.geo.aiVolumeTrend}
              title={`AI-assistant searches/mo across the audited set — ${fmtNum(a.geo.totalAiVolume)} now (DataForSEO AI keyword dataset)`}
              color="var(--series-4)"
            />
          </div>
          <div className="card p-5">
            <Bars
              title="Citation rate by AI surface — % of tracked buying prompts naming the brand"
              unit="%"
              items={a.geo.surfaces.map((s) => ({ label: s.name, value: s.citationRate }))}
              color="var(--series-4)"
            />
          </div>
        </div>

        {a.geo.missedPrompts.length > 0 && (
          <div className="card p-5 mt-4" style={{ borderColor: "var(--critical)" }}>
            <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--critical)" }}>
              ANSWERS BEING LOST RIGHT NOW — BUYERS ASK, COMPETITORS GET NAMED
            </div>
            {a.geo.missedPrompts.map((m) => (
              <div key={m.prompt} className="py-2.5 flex flex-wrap gap-x-4 gap-y-1 items-baseline border-t first:border-t-0"
                style={{ borderColor: "var(--border)" }}>
                <span className="text-[13.5px]" style={{ color: "var(--ink)" }}>&ldquo;{m.prompt}&rdquo;</span>
                <span className="text-[11.5px] mono" style={{ color: "var(--muted)" }}>{m.surface}</span>
                <span className="text-[12.5px] ml-auto" style={{ color: "var(--serious)" }}>
                  → {m.citedInstead.slice(0, 3).join(", ") || "competitors"} cited instead
                </span>
              </div>
            ))}
          </div>
        )}

        <SectionHead kicker="GEO REPORT" title="AI-readiness checklist"
          sub="What AI assistants need to confidently cite a brand — checked against this site." />
        <div className="grid md:grid-cols-2 gap-3">
          {a.geo.readiness.map((r) => {
            const c = r.status === "pass" ? "var(--good)" : r.status === "partial" ? "var(--warning)" : "var(--critical)";
            return (
              <div key={r.check} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] mono px-1.5 py-0.5 rounded" style={{ color: c, border: `1px solid ${c}` }}>
                    {r.status.toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{r.check}</span>
                </div>
                <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>{r.detail}</p>
                <p className="text-[12.5px] mt-1.5" style={{ color: "var(--ink-2)" }}>
                  <span style={{ color: "var(--series-2)" }}>Fix: </span>{r.fix}
                </p>
              </div>
            );
          })}
        </div>

        {/* competitor gaps */}
        <SectionHead kicker="COMPETITIVE" title="Who's eating the demand"
          sub="The domains actually holding these SERPs and AI answers — and the size of their head start." />
        <div className="card p-2 overflow-x-auto">
          <table className="w-full border-collapse min-w-[680px]">
            <thead>
              <tr style={{ color: "var(--muted)" }}>
                <th className={th}>Competitor</th>
                <th className={th}>Shared keywords</th>
                <th className={th}>Their exclusive</th>
                <th className={th}>Traffic value</th>
                <th className={th}>AI citation</th>
                <th className={th}>Read</th>
              </tr>
            </thead>
            <tbody>
              {a.competitorGaps.map((c) => (
                <tr key={c.domain}>
                  <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>
                    {c.name}<span className="mono text-[11px] ml-1.5" style={{ color: "var(--muted)" }}>{c.domain}</span>
                  </td>
                  <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{c.sharedKeywords.toLocaleString()}</td>
                  <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--serious)" }}>{c.theirExclusive.toLocaleString()}</td>
                  <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{fmtUsd(c.estTrafficValue)}/mo</td>
                  <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--series-4)" }}>{c.aiCitationRate}%</td>
                  <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{c.threat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ============ 4 · THE PLAN ============ */}
        <SectionHead kicker="THE PLAN" title="First 90 days"
          sub="Sequenced for payback: quick wins fund the capture builds; citations compound on top." />
        <div className="grid md:grid-cols-3 gap-3">
          {a.roadmap.map((ph) => (
            <div key={ph.phase} className="card p-5 flex flex-col">
              <div className="text-[11px] mono tracking-[0.14em]" style={{ color: "var(--accent)" }}>{ph.phase.toUpperCase()}</div>
              <div className="text-[15px] font-bold mt-1" style={{ color: "var(--ink)" }}>{ph.focus}</div>
              <ul className="mt-3 flex flex-col gap-2 flex-1">
                {ph.moves.map((m) => (
                  <li key={m} className="text-[12.5px] leading-relaxed flex gap-2" style={{ color: "var(--ink-2)" }}>
                    <span style={{ color: "var(--series-2)" }}>→</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-3 text-[11.5px] mono flex justify-between gap-2 flex-wrap"
                style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
                <span>KPI: {ph.kpi}</span>
                <span style={{ color: "var(--accent)" }}>{ph.expectedLift}</span>
              </div>
            </div>
          ))}
        </div>

        {/* methodology */}
        <div className="card p-5 mt-14">
          <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--muted)" }}>
            METHODOLOGY — EVERY NUMBER'S MATH, STATED PLAINLY
          </div>
          <ul className="flex flex-col gap-1.5">
            {a.meta.methodology.map((m) => (
              <li key={m} className="text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>· {m}</li>
            ))}
          </ul>
          <div className="mt-4 pt-3 flex flex-col gap-1" style={{ borderTop: "1px solid var(--border)" }}>
            {a.meta.sources.map((s) => (
              <div key={s} className="text-[11px] mono" style={{ color: s.startsWith("LIVE") ? "var(--good)" : "var(--muted)" }}>{s}</div>
            ))}
          </div>
        </div>

        <div className="no-print text-center mt-10 flex flex-col items-center gap-3">
          <a href={BRAND.contact}
            className="px-6 py-3 rounded-lg text-sm font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            Walk through this audit with me →
          </a>
          <a href="/audit" className="text-[13px] mono" style={{ color: "var(--series-1)" }}>
            ↺ Run it on another domain
          </a>
          <div className="text-[11px] mono mt-2" style={{ color: "var(--muted)" }}>
            {BRAND.practice} · {BRAND.practiceFocus}
          </div>
        </div>
      </div>
    </div>
  );
}
