"use client";

// The audit as a workspace, not a memo.
//
// Six tight views behind tabs — Overview, Keywords, SERP, AI Answers,
// Journey, Plan — with toggle chips for cluster, funnel stage, and rank
// state, a search box, and sortable columns. Numbers lead; the analyst
// prose lives in the client-report document and a collapsed insights
// accordion here.

import { useMemo, useState } from "react";
import JourneyPanel from "@/components/journey-map";
import { Bars, LineChart } from "@/components/charts";
import { PrintButton } from "@/components/print";
import { BRAND } from "@/lib/brand";
import { fmtNum, fmtUsd } from "@/lib/audit/model";
import type { Intent, OpportunityAudit, OpportunityCluster } from "@/lib/audit/types";

type Tab = "overview" | "keywords" | "serp" | "ai" | "journey" | "plan";
type Funnel = "aware" | "consider" | "decide";
type RankFilter = "all" | "ranked" | "striking" | "unranked";
type SortKey = "volume" | "aiVolume" | "cpc" | "difficulty" | "position";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "keywords", label: "Keywords" },
  { key: "serp", label: "SERP" },
  { key: "ai", label: "AI Answers" },
  { key: "journey", label: "Journey" },
  { key: "plan", label: "Plan" },
];

const FUNNELS: { key: Funnel; label: string }[] = [
  { key: "aware", label: "Aware" },
  { key: "consider", label: "Consider" },
  { key: "decide", label: "Decide" },
];

// Funnel stage from search intent: someone learning is aware, someone
// comparing is considering, someone buying/going is deciding.
function funnelOf(intent: Intent): Funnel {
  if (intent === "informational") return "aware";
  if (intent === "commercial") return "consider";
  return "decide"; // transactional + local
}

const STAGE_COLOR: Record<OpportunityCluster["stage"], string> = {
  capture: "var(--series-1)",
  grow: "var(--warning)",
  defend: "var(--series-2)",
};

interface Row {
  term: string;
  intent: Intent;
  funnel: Funnel;
  volume: number;
  aiVolume: number;
  cpc: number;
  difficulty: number;
  position: number | null;
  aiOverviewPresent: boolean;
  aiCited: boolean;
  serpFeatures: string[];
  clusterId: string;
  clusterName: string;
  clusterStage: OpportunityCluster["stage"];
}

function Chip({ on, onClick, children, color = "var(--accent)" }: {
  on: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  return (
    <button onClick={onClick}
      className="text-[11.5px] mono px-2.5 py-1 rounded-full whitespace-nowrap"
      style={on
        ? { background: color, color: "var(--accent-ink)", fontWeight: 700 }
        : { border: "1px solid var(--border)", color: "var(--muted)", background: "var(--surface-1)" }}>
      {children}
    </button>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card px-3.5 py-3">
      <div className="text-[10px] mono tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-[21px] font-bold leading-tight" style={{ color: accent ?? "var(--ink)" }}>{value}</div>
      {sub && <div className="text-[10.5px] mt-0.5" style={{ color: "var(--muted)" }}>{sub}</div>}
    </div>
  );
}

function Dial({ score, grade }: { score: number; grade: string }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c * 0.75;
  const color = score < 35 ? "var(--critical)" : score < 60 ? "var(--warning)" : "var(--good)";
  return (
    <div className="relative shrink-0" style={{ width: 104, height: 104 }}>
      <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-[135deg]">
        <circle cx={52} cy={52} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={8}
          strokeDasharray={`${c * 0.75} ${c}`} strokeLinecap="round" />
        <circle cx={52} cy={52} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${filled} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[26px] font-bold" style={{ color: "var(--ink)" }}>{grade}</div>
        <div className="text-[9px] mono" style={{ color: "var(--muted)" }}>{score}/100</div>
      </div>
    </div>
  );
}

const th = "text-left px-2.5 py-1.5 text-[10px] mono tracking-[0.08em] uppercase whitespace-nowrap select-none";
const td = "px-2.5 py-1.5 border-t text-[12.5px]";

export default function AuditExplorer({ audit: a, journeyEnabled }: { audit: OpportunityAudit; journeyEnabled: boolean }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [cluster, setCluster] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [rank, setRank] = useState<RankFilter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "volume", dir: -1 });

  const rows: Row[] = useMemo(
    () =>
      a.clusters.flatMap((c) =>
        c.keywords.map((k) => ({
          ...k,
          funnel: funnelOf(k.intent),
          clusterId: c.id,
          clusterName: c.name,
          clusterStage: c.stage,
        }))
      ),
    [a]
  );

  const filtered = useMemo(() => {
    let r = rows;
    if (cluster) r = r.filter((x) => x.clusterId === cluster);
    if (funnel) r = r.filter((x) => x.funnel === funnel);
    if (rank === "ranked") r = r.filter((x) => x.position !== null);
    if (rank === "unranked") r = r.filter((x) => x.position === null);
    if (rank === "striking") r = r.filter((x) => x.position !== null && x.position >= 4 && x.position <= 15);
    if (q.trim()) r = r.filter((x) => x.term.toLowerCase().includes(q.trim().toLowerCase()));
    return [...r].sort((x, y) => {
      const av = x[sort.key] ?? (sort.key === "position" ? 999 : 0);
      const bv = y[sort.key] ?? (sort.key === "position" ? 999 : 0);
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [rows, cluster, funnel, rank, q, sort]);

  const openCluster = (id: string) => {
    setCluster(id);
    setTab("keywords");
  };
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "position" ? 1 : -1 }));

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className={`${th} cursor-pointer`} onClick={() => sortBy(k)}
      style={{ color: sort.key === k ? "var(--accent)" : "var(--muted)" }}>
      {children}{sort.key === k ? (sort.dir === -1 ? " ↓" : " ↑") : ""}
    </th>
  );

  const scanned = rows.filter((r) => r.serpFeatures.length > 0);
  const sumVol = (f: Funnel) => rows.filter((r) => r.funnel === f).reduce((s, r) => s + r.volume, 0);

  return (
    <div className="min-h-screen pb-16" style={{ background: "var(--page)", color: "var(--ink-2)" }}>
      <div className="max-w-6xl mx-auto px-4">
        {/* masthead */}
        <div className="flex items-center justify-between pt-5 pb-4 flex-wrap gap-2.5"
          style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>{a.brand.name}</span>
              <span className="text-[11px] mono" style={{ color: "var(--muted)" }}>
                {a.brand.domain} · {a.brand.category}
              </span>
              <span className="text-[9.5px] mono px-1.5 py-0.5 rounded"
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: a.meta.mode === "live" ? "var(--good)" : "var(--warning)" }}>
                {a.meta.mode === "live" ? "● LIVE" : "● DEMO"}
              </span>
            </div>
            <div className="text-[10px] mono mt-0.5" style={{ color: "var(--muted)" }}>
              {BRAND.product.toUpperCase()} · {a.meta.generatedAt.toUpperCase()}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap no-print">
            <a href={`/audit/${a.brand.domain}/report`} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>📄 Report</a>
            <a href={`/api/audit/export?domain=${a.brand.domain}`} className="text-[12px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>⬇ Excel</a>
            <PrintButton />
          </div>
        </div>

        {/* tabs */}
        <div className="sticky top-0 z-40 flex gap-1.5 py-2.5 overflow-x-auto"
          style={{ background: "var(--page)", borderBottom: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="text-[12.5px] px-3.5 py-1.5 rounded-lg whitespace-nowrap"
              style={tab === t.key
                ? { background: "var(--surface-2)", color: "var(--ink)", fontWeight: 700, border: "1px solid var(--accent)" }
                : { color: "var(--muted)", border: "1px solid transparent" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ================= OVERVIEW ================= */}
        {tab === "overview" && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex gap-4 items-center flex-wrap">
              <Dial score={a.score.overall} grade={a.score.grade} />
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 flex-1 min-w-[280px]">
                <Tile label="SEO CAPTURE" value={`${a.score.seo}%`} />
                <Tile label="GEO CAPTURE" value={`${a.score.geo}%`} accent="var(--series-4)" />
                <Tile label="GOOGLE VOL/MO" value={fmtNum(a.headline.totalVolume)} sub={`${a.headline.keywordsAudited} keywords`} />
                <Tile label="AI VOL/MO" value={fmtNum(a.headline.totalAiVolume)} sub={`${a.geo.aiVolumeShare}% of demand`} accent="var(--series-4)" />
                <Tile label="OPPORTUNITY" value={`${fmtUsd(a.economics.opportunity.base)}/mo`}
                  sub={`${fmtUsd(a.economics.opportunity.conservative)}–${fmtUsd(a.economics.opportunity.aggressive)}`} accent="var(--accent)" />
              </div>
            </div>

            <p className="text-[13px] leading-relaxed max-w-4xl" style={{ color: "var(--muted)" }}>{a.score.verdict}</p>

            {/* clusters — the volume areas; click through to keywords */}
            <div className="card p-2 overflow-x-auto">
              <table className="w-full border-collapse min-w-[700px]">
                <thead>
                  <tr style={{ color: "var(--muted)" }}>
                    <th className={th}>Cluster</th><th className={th}>Stage</th><th className={th}>Kws</th>
                    <th className={th}>Google/mo</th><th className={th}>AI/mo</th><th className={th}>Best pos</th>
                    <th className={th}>$/mo base</th><th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {a.clusters.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:opacity-80" onClick={() => openCluster(c.id)}>
                      <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)", fontWeight: 600 }}>{c.name}</td>
                      <td className={`${td} mono text-[10px]`} style={{ borderColor: "var(--border)", color: STAGE_COLOR[c.stage] }}>{c.stage.toUpperCase()}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{c.keywords.length}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{fmtNum(c.totalVolume)}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--series-4)" }}>{fmtNum(c.totalAiVolume)}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{c.bestPosition ? `#${c.bestPosition}` : "—"}</td>
                      <td className={`${td} mono font-bold`} style={{ borderColor: "var(--border)", color: "var(--accent)" }}>{fmtUsd(c.monthlyRevenue.base)}</td>
                      <td className={`${td} mono text-[11px]`} style={{ borderColor: "var(--border)", color: "var(--series-1)" }}>view →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* funnel volume split */}
            <div className="grid grid-cols-3 gap-2">
              {FUNNELS.map((f) => (
                <button key={f.key} className="card px-3.5 py-3 text-left hover:opacity-90"
                  onClick={() => { setFunnel(f.key); setTab("keywords"); }}>
                  <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>{f.label.toUpperCase()} · FUNNEL</div>
                  <div className="text-[18px] font-bold" style={{ color: "var(--ink)" }}>{fmtNum(sumVol(f.key))}/mo</div>
                  <div className="text-[10.5px] mono" style={{ color: "var(--series-1)" }}>view keywords →</div>
                </button>
              ))}
            </div>

            {/* top opportunities — tight */}
            <div className="card p-3">
              <div className="text-[10px] mono tracking-[0.14em] mb-2" style={{ color: "var(--accent)" }}>TOP OPPORTUNITIES · BASE $/MO</div>
              <div className="flex flex-col gap-1.5">
                {a.topOpportunities.map((o, i) => {
                  const max = Math.max(...a.topOpportunities.map((x) => x.monthly), 1);
                  return (
                    <div key={o.title} className="flex items-center gap-2.5">
                      <span className="text-[11px] mono w-5 shrink-0" style={{ color: "var(--muted)" }}>{i + 1}</span>
                      <span className="text-[12.5px] w-52 truncate shrink-0" style={{ color: "var(--ink)" }} title={o.title}>{o.title}</span>
                      <div className="flex-1 h-3 relative">
                        <div className="h-3 rounded-r-[3px]" style={{ width: `${Math.max(3, (o.monthly / max) * 100)}%`, background: o.kind === "geo" ? "var(--series-4)" : o.kind === "both" ? "var(--accent)" : "var(--series-1)", opacity: 0.8 }} />
                      </div>
                      <span className="text-[12px] mono font-bold w-24 text-right shrink-0" style={{ color: "var(--accent)" }}>+{fmtUsd(o.monthly)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* business model + insights, tucked away */}
            <details className="card p-3.5">
              <summary className="text-[12px] mono cursor-pointer select-none" style={{ color: "var(--series-4)" }}>
                Business model read · {a.businessModel.model} ▾
              </summary>
              <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>{a.businessModel.revenueMotion}</p>
              <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--series-4)" }}>Citations for this model: </strong>{a.businessModel.citationStrategy}
              </p>
            </details>
            {a.observations && a.observations.length > 0 && (
              <details className="card p-3.5">
                <summary className="text-[12px] mono cursor-pointer select-none" style={{ color: "var(--accent)" }}>
                  Analyst insights ({a.observations.length}) ▾
                </summary>
                <div className="flex flex-col gap-2.5 mt-2.5">
                  {a.observations.map((o) => (
                    <div key={o.title}>
                      <div className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>
                        <span className="text-[9.5px] mono mr-1.5" style={{ color: "var(--series-4)" }}>{o.kind.toUpperCase()}</span>{o.title}
                      </div>
                      <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: "var(--muted)" }}>{o.detail}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* ================= KEYWORDS ================= */}
        {tab === "keywords" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex gap-1.5 flex-wrap items-center">
              <Chip on={cluster === null} onClick={() => setCluster(null)}>all clusters</Chip>
              {a.clusters.map((c) => (
                <Chip key={c.id} on={cluster === c.id} onClick={() => setCluster(cluster === c.id ? null : c.id)}>{c.name}</Chip>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-[10px] mono" style={{ color: "var(--muted)" }}>FUNNEL</span>
              <Chip on={funnel === null} onClick={() => setFunnel(null)}>all</Chip>
              {FUNNELS.map((f) => (
                <Chip key={f.key} on={funnel === f.key} onClick={() => setFunnel(funnel === f.key ? null : f.key)} color="var(--series-4)">{f.label.toLowerCase()}</Chip>
              ))}
              <span className="text-[10px] mono ml-2" style={{ color: "var(--muted)" }}>RANK</span>
              {(["all", "ranked", "striking", "unranked"] as RankFilter[]).map((rf) => (
                <Chip key={rf} on={rank === rf} onClick={() => setRank(rf)} color="var(--series-2)">{rf === "striking" ? "striking 4–15" : rf}</Chip>
              ))}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search terms…"
                className="ml-auto bg-transparent outline-none text-[12px] rounded-lg px-2.5 py-1.5 min-w-[140px]"
                style={{ border: "1px solid var(--border)", color: "var(--ink)", background: "var(--surface-1)" }} />
            </div>
            <div className="text-[11px] mono" style={{ color: "var(--muted)" }}>
              {filtered.length} keywords · {fmtNum(filtered.reduce((s, r) => s + r.volume, 0))} Google/mo · {fmtNum(filtered.reduce((s, r) => s + r.aiVolume, 0))} AI/mo
            </div>
            <div className="card p-1.5 overflow-x-auto">
              <table className="w-full border-collapse min-w-[820px]">
                <thead>
                  <tr>
                    <th className={th} style={{ color: "var(--muted)" }}>Keyword</th>
                    <th className={th} style={{ color: "var(--muted)" }}>Cluster</th>
                    <th className={th} style={{ color: "var(--muted)" }}>Funnel</th>
                    <Th k="volume">Google/mo</Th>
                    <Th k="aiVolume">AI/mo</Th>
                    <Th k="cpc">CPC</Th>
                    <Th k="difficulty">KD</Th>
                    <Th k="position">Pos</Th>
                    <th className={th} style={{ color: "var(--muted)" }}>AI answer</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={`${r.clusterId}-${r.term}`}>
                      <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{r.term}</td>
                      <td className={`${td} text-[11px]`} style={{ borderColor: "var(--border)", color: STAGE_COLOR[r.clusterStage] }}>{r.clusterName}</td>
                      <td className={`${td} mono text-[10.5px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{r.funnel}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{r.volume.toLocaleString()}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--series-4)" }}>{r.aiVolume.toLocaleString()}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>${r.cpc.toFixed(2)}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{r.difficulty}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: r.position && r.position <= 10 ? "var(--good)" : r.position ? "var(--warning)" : "var(--muted)" }}>
                        {r.position ? `#${r.position}` : "—"}
                      </td>
                      <td className={`${td} text-[10.5px]`} style={{ borderColor: "var(--border)", color: r.aiCited ? "var(--good)" : r.aiOverviewPresent ? "var(--serious)" : "var(--muted)" }}>
                        {r.aiCited ? "cited" : r.aiOverviewPresent ? "shown · not cited" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= SERP ================= */}
        {tab === "serp" && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid md:grid-cols-2 gap-2">
              {a.serpRealEstate.map((f) => (
                <div key={f.feature} className="card px-3.5 py-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-semibold" style={{ color: f.feature === "ai_overview" ? "var(--series-4)" : "var(--ink)" }}>{f.label}</span>
                    <span className="text-[10.5px] mono" style={{ color: "var(--muted)" }}>on {f.presence}% · you hold {f.owned}%</span>
                  </div>
                  <div className="h-1.5 rounded-full mt-1.5 relative overflow-hidden" style={{ background: "var(--surface-2)" }}>
                    <div className="h-1.5 rounded-full absolute" style={{ width: `${f.presence}%`, background: "var(--surface-3)" }} />
                    <div className="h-1.5 rounded-full absolute" style={{ width: `${(f.presence * f.owned) / 100}%`, background: f.feature === "ai_overview" ? "var(--series-4)" : "var(--series-1)" }} />
                  </div>
                </div>
              ))}
            </div>

            {scanned.length > 0 && (
              <div className="card p-1.5 overflow-x-auto">
                <div className="text-[10px] mono tracking-[0.14em] px-2.5 pt-2 pb-1" style={{ color: "var(--accent)" }}>
                  SCANNED SERPS — WHAT&rsquo;S ACTUALLY ON THE PAGE
                </div>
                <table className="w-full border-collapse min-w-[700px]">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className={th}>Keyword</th><th className={th}>Vol/mo</th><th className={th}>Your pos</th>
                      <th className={th}>AI Overview</th><th className={th}>Features on SERP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanned.map((r) => (
                      <tr key={r.term}>
                        <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{r.term}</td>
                        <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{r.volume.toLocaleString()}</td>
                        <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: r.position && r.position <= 10 ? "var(--good)" : "var(--muted)" }}>{r.position ? `#${r.position}` : "—"}</td>
                        <td className={`${td} text-[11px]`} style={{ borderColor: "var(--border)", color: r.aiCited ? "var(--good)" : r.aiOverviewPresent ? "var(--serious)" : "var(--muted)" }}>
                          {r.aiCited ? "cited ✓" : r.aiOverviewPresent ? "present · not cited" : "none"}
                        </td>
                        <td className={`${td} mono text-[10.5px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{r.serpFeatures.join(" · ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="card p-1.5 overflow-x-auto">
              <div className="text-[10px] mono tracking-[0.14em] px-2.5 pt-2 pb-1" style={{ color: "var(--serious)" }}>
                WHO&rsquo;S WINNING — COMPETITOR HEAD START
              </div>
              <table className="w-full border-collapse min-w-[700px]">
                <thead>
                  <tr style={{ color: "var(--muted)" }}>
                    <th className={th}>Competitor</th><th className={th}>Shared kws</th><th className={th}>Their exclusive</th>
                    <th className={th}>Traffic value</th><th className={th}>AI citation</th>
                  </tr>
                </thead>
                <tbody>
                  {a.competitorGaps.map((c) => (
                    <tr key={c.domain}>
                      <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>
                        {c.name}<span className="mono text-[10px] ml-1.5" style={{ color: "var(--muted)" }}>{c.domain}</span>
                      </td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{c.sharedKeywords.toLocaleString()}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--serious)" }}>{c.theirExclusive.toLocaleString()}</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{fmtUsd(c.estTrafficValue)}/mo</td>
                      <td className={`${td} mono`} style={{ borderColor: "var(--border)", color: "var(--series-4)" }}>{c.aiCitationRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================= AI ANSWERS ================= */}
        {tab === "ai" && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tile label="AI SEARCHES/MO" value={fmtNum(a.geo.totalAiVolume)} accent="var(--series-4)" />
              <Tile label="SHARE OF DEMAND" value={`${a.geo.aiVolumeShare}%`} />
              <Tile label="CITATION RATE" value={`${a.geo.citationRate}%`} sub="tracked buying prompts" accent="var(--series-4)" />
              <Tile label="AIO PRESENT · UNCITED" value={String(rows.filter((r) => r.aiOverviewPresent && !r.aiCited).length)} sub="scanned keywords" accent="var(--warning)" />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="card p-4">
                <LineChart points={a.geo.aiVolumeTrend} title={`AI-assistant searches/mo — ${fmtNum(a.geo.totalAiVolume)} now`} color="var(--series-4)" />
              </div>
              <div className="card p-4">
                <Bars title="Citation rate by surface (%)" unit="%" color="var(--series-4)"
                  items={a.geo.surfaces.map((s) => ({ label: s.name, value: s.citationRate }))} />
              </div>
            </div>
            {a.geo.missedPrompts.length > 0 && (
              <div className="card p-1.5 overflow-x-auto">
                <div className="text-[10px] mono tracking-[0.14em] px-2.5 pt-2 pb-1" style={{ color: "var(--critical)" }}>
                  PROMPTS BEING LOST — BUYERS ASK, COMPETITORS GET NAMED
                </div>
                <table className="w-full border-collapse min-w-[640px]">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className={th}>Buying prompt</th><th className={th}>Surface</th><th className={th}>Cited instead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.geo.missedPrompts.map((m) => (
                      <tr key={m.prompt}>
                        <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>&ldquo;{m.prompt}&rdquo;</td>
                        <td className={`${td} mono text-[11px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{m.surface}</td>
                        <td className={`${td} text-[11.5px]`} style={{ borderColor: "var(--border)", color: "var(--serious)" }}>{m.citedInstead.join(", ") || "competitors"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-2">
              {a.geo.readiness.map((r) => {
                const c = r.status === "pass" ? "var(--good)" : r.status === "partial" ? "var(--warning)" : "var(--critical)";
                return (
                  <div key={r.check} className="card px-3.5 py-2.5 flex items-start gap-2.5">
                    <span className="text-[9px] mono px-1.5 py-0.5 rounded shrink-0 mt-0.5" style={{ color: c, border: `1px solid ${c}` }}>{r.status.toUpperCase()}</span>
                    <div>
                      <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>{r.check}</span>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>Fix: {r.fix}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= JOURNEY ================= */}
        {tab === "journey" && (
          <div className="-mt-8">
            <JourneyPanel domain={a.brand.domain} enabled={journeyEnabled} />
          </div>
        )}

        {/* ================= PLAN ================= */}
        {tab === "plan" && (
          <div className="mt-4 flex flex-col gap-4">
            {a.quickWins.length > 0 && (
              <div className="card p-1.5 overflow-x-auto">
                <div className="text-[10px] mono tracking-[0.14em] px-2.5 pt-2 pb-1" style={{ color: "var(--good)" }}>
                  QUICK WINS — STRIKING DISTANCE, FASTEST PAYBACK
                </div>
                <table className="w-full border-collapse min-w-[640px]">
                  <thead>
                    <tr style={{ color: "var(--muted)" }}>
                      <th className={th}>Keyword</th><th className={th}>Now → target</th><th className={th}>Vol/mo</th><th className={th}>Upside</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.quickWins.map((w) => (
                      <tr key={w.term}>
                        <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{w.term}</td>
                        <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>
                          <span style={{ color: "var(--warning)" }}>#{w.position}</span> → <span style={{ color: "var(--good)" }}>#{w.targetPosition}</span>
                        </td>
                        <td className={`${td} mono`} style={{ borderColor: "var(--border)" }}>{w.volume.toLocaleString()}</td>
                        <td className={`${td} mono font-bold`} style={{ borderColor: "var(--border)", color: "var(--accent)" }}>+{fmtUsd(w.monthlyUpside)}/mo</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="grid md:grid-cols-3 gap-2.5">
              {a.roadmap.map((ph) => (
                <div key={ph.phase} className="card p-4 flex flex-col">
                  <div className="text-[10px] mono tracking-[0.14em]" style={{ color: "var(--accent)" }}>{ph.phase.toUpperCase()}</div>
                  <div className="text-[13.5px] font-bold mt-0.5" style={{ color: "var(--ink)" }}>{ph.focus}</div>
                  <ul className="mt-2 flex flex-col gap-1.5 flex-1">
                    {ph.moves.map((m) => (
                      <li key={m} className="text-[11.5px] leading-relaxed flex gap-1.5" style={{ color: "var(--ink-2)" }}>
                        <span style={{ color: "var(--series-2)" }}>→</span><span>{m}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 pt-2 text-[10.5px] mono flex justify-between gap-2 flex-wrap"
                    style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}>
                    <span>{ph.kpi}</span><span style={{ color: "var(--accent)" }}>{ph.expectedLift}</span>
                  </div>
                </div>
              ))}
            </div>
            <details className="card p-3.5">
              <summary className="text-[11px] mono cursor-pointer select-none" style={{ color: "var(--muted)" }}>
                Methodology & sources — every modeled number&rsquo;s math ▾
              </summary>
              <ul className="flex flex-col gap-1 mt-2">
                {a.meta.methodology.map((m) => (
                  <li key={m} className="text-[11.5px] leading-relaxed" style={{ color: "var(--muted)" }}>· {m}</li>
                ))}
              </ul>
              <div className="mt-3 pt-2 flex flex-col gap-0.5" style={{ borderTop: "1px solid var(--border)" }}>
                {a.meta.sources.map((s) => (
                  <div key={s} className="text-[10.5px] mono" style={{ color: s.startsWith("LIVE") ? "var(--good)" : "var(--muted)" }}>{s}</div>
                ))}
              </div>
            </details>
            <div className="no-print flex items-center gap-3 flex-wrap">
              <a href={BRAND.contact} className="px-5 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                Walk through this audit with me →
              </a>
              <a href="/audit" className="text-[12px] mono" style={{ color: "var(--series-1)" }}>↺ run another domain</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
