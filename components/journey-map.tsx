"use client";

// The Journey Map panel — Capture's deep pass, rendered.
//
// Lives inside the audit page. Idle → a one-click build card; building →
// live phase line (polls the job every 4s); ready → the full map: content
// inventory, personas, the persona × stage grid, every keyword and prompt
// routed to a page, and the 12-month capture forecast with scenario band.

import { useCallback, useEffect, useRef, useState } from "react";
import { fmtNum, fmtUsd } from "@/lib/audit/model";
import {
  JOURNEY_STAGES,
  type JourneyCell,
  type JourneyJob,
  type JourneyMap,
  type PageAssignment,
} from "@/lib/audit/journey-types";

const PERSONA_COLORS = ["var(--series-1)", "var(--series-4)", "var(--series-2)", "var(--series-3)"];
const STATUS_META = {
  covered: { label: "COVERED", color: "var(--good)" },
  weak: { label: "WEAK", color: "var(--warning)" },
  missing: { label: "MISSING", color: "var(--critical)" },
} as const;
const ACTION_META = {
  create: { label: "CREATE", color: "var(--accent)", blurb: "No existing page can win these — build the proposed pages." },
  optimize: { label: "OPTIMIZE", color: "var(--series-2)", blurb: "The right page exists — sharpen it for the term." },
  consolidate: { label: "CONSOLIDATE", color: "var(--warning)", blurb: "Competing pages split the signal — merge them." },
} as const;

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] mono tracking-[0.18em] mb-1.5" style={{ color: "var(--accent)" }}>
      {children}
    </div>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-14 h-1.5 rounded-full" style={{ background: "var(--surface-2)" }}>
        <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, value)}%`, background: color }} />
      </div>
      <span className="text-[11px] mono" style={{ color: "var(--muted)" }}>{value}</span>
    </div>
  );
}

const th = "text-left px-3 py-2 text-[10.5px] mono tracking-[0.08em] uppercase";
const td = "px-3 py-2.5 border-t text-[13px]";

// ---------------------------------------------------------------------------
// Forecast chart — three scenario lines with the cons↔aggr band shaded
// ---------------------------------------------------------------------------

function ForecastChart({ map }: { map: JourneyMap }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = map.forecast.points;
  const w = 640;
  const h = 240;
  const pad = { l: 52, r: 84, t: 14, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const max = Math.max(...pts.map((p) => p.aggressive)) * 1.06 || 1;
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = (k: "conservative" | "base" | "aggressive") =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p[k])}`).join(" ");
  const band =
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.aggressive)}`).join(" ") +
    [...pts].reverse().map((p, i) => `L${x(pts.length - 1 - i)},${y(p.conservative)}`).join(" ") +
    "Z";
  const series: { k: "aggressive" | "base" | "conservative"; color: string; label: string }[] = [
    { k: "aggressive", color: "var(--series-4)", label: "Aggressive" },
    { k: "base", color: "var(--accent)", label: "Base" },
    { k: "conservative", color: "var(--muted)", label: "Conservative" },
  ];
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label="12-month capture forecast"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = Math.round(((px - pad.l) / iw) * (pts.length - 1));
          setHover(Math.max(0, Math.min(pts.length - 1, idx)));
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
              {fmtUsd(Math.round(max * f))}
            </text>
          </g>
        ))}
        <path d={band} fill="var(--accent)" opacity={0.07} />
        {series.map((s) => (
          <path key={s.k} d={line(s.k)} fill="none" stroke={s.color} strokeWidth={s.k === "base" ? 2.5 : 1.5}
            strokeLinecap="round" strokeLinejoin="round" opacity={s.k === "base" ? 1 : 0.8} />
        ))}
        {series.map((s) => (
          <text key={s.k} x={w - pad.r + 6} y={y(pts[pts.length - 1][s.k]) + 3.5} fontSize={10.5}
            fill={s.color} fontWeight={s.k === "base" ? 700 : 400}>
            {s.label}
          </text>
        ))}
        {pts.map((p, i) =>
          i % 2 === 1 ? (
            <text key={p.month} x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {p.month}
            </text>
          ) : null
        )}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.k} cx={x(hover)} cy={y(pts[hover][s.k])} r={3.5} fill={s.color} stroke="var(--surface-1)" strokeWidth={1.5} />
            ))}
            <g transform={`translate(${Math.min(x(hover) + 10, w - pad.r - 132)}, ${pad.t + 4})`}>
              <rect width={126} height={62} rx={6} fill="var(--surface-3)" stroke="var(--border)" />
              <text x={9} y={15} fontSize={10} fill="var(--muted)">{pts[hover].month} run-rate</text>
              <text x={9} y={30} fontSize={11} fill="var(--series-4)">aggr {fmtUsd(pts[hover].aggressive)}</text>
              <text x={9} y={43} fontSize={11.5} fill="var(--accent)" fontWeight={700}>base {fmtUsd(pts[hover].base)}</text>
              <text x={9} y={56} fontSize={11} fill="var(--muted)">cons {fmtUsd(pts[hover].conservative)}</text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready state — the map itself
// ---------------------------------------------------------------------------

function ReadyMap({ map, onRebuild, rebuilding }: { map: JourneyMap; onRebuild: () => void; rebuilding: boolean }) {
  const [cell, setCell] = useState<JourneyCell | null>(null);
  const personaColor = new Map(map.personas.map((p, i) => [p.id, PERSONA_COLORS[i % PERSONA_COLORS.length]]));
  const personaName = new Map(map.personas.map((p) => [p.id, p.name]));
  const byAction = (action: PageAssignment["action"]) => map.assignments.filter((a) => a.action === action);
  const maxType = Math.max(...map.inventory.byType.map((t) => t.count), 1);

  return (
    <>
      {/* the strategist's read */}
      <p className="text-[14.5px] leading-[1.75] max-w-4xl mt-1" style={{ color: "var(--ink-2)" }}>
        {map.summary}
      </p>

      {/* 1 · inventory */}
      <div className="mt-7">
        <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--series-1)" }}>
          01 · WHAT THE SITE ACTUALLY IS — {map.inventory.pagesCrawled} PAGES CRAWLED
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="card p-4 md:col-span-2">
            <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>{map.inventory.read}</p>
            <div className="flex flex-col gap-1.5 mt-3">
              {map.inventory.byType.map((t) => (
                <div key={t.type} className="flex items-center gap-2">
                  <span className="w-20 text-[11px] mono" style={{ color: "var(--ink-2)" }}>{t.type}</span>
                  <div className="flex-1 h-3 relative">
                    <div className="h-3 rounded-r-[3px]" style={{ width: `${(t.count / maxType) * 100}%`, background: "var(--series-1)", opacity: 0.75 }} />
                  </div>
                  <span className="w-6 text-[11px] mono text-right" style={{ color: "var(--muted)" }}>{t.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="card p-4">
              <div className="text-[11px] mono" style={{ color: "var(--muted)" }}>AVG QUALITY / ANSWERABILITY</div>
              <div className="text-[24px] font-bold mt-0.5" style={{ color: "var(--ink)" }}>
                {map.inventory.avgQuality}<span style={{ color: "var(--muted)" }}> / </span>
                <span style={{ color: "var(--series-4)" }}>{map.inventory.avgAnswerability}</span>
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>content craft vs. what an AI can quote</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] mono" style={{ color: "var(--good)" }}>STRONGEST {map.inventory.strongestPath}</div>
              <div className="text-[11px] mono mt-1.5" style={{ color: "var(--critical)" }}>WEAKEST {map.inventory.weakestPath}</div>
            </div>
          </div>
        </div>
        <details className="mt-3">
          <summary className="text-[12px] mono cursor-pointer select-none" style={{ color: "var(--series-1)" }}>
            page-by-page inventory ▾
          </summary>
          <div className="card p-2 overflow-x-auto mt-2">
            <table className="w-full border-collapse min-w-[680px]">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className={th}>Page</th><th className={th}>Type</th><th className={th}>Topic</th>
                  <th className={th}>Quality</th><th className={th}>Answerability</th><th className={th}>Read</th>
                </tr>
              </thead>
              <tbody>
                {map.pages.map((p) => (
                  <tr key={p.path}>
                    <td className={`${td} mono text-[11.5px]`} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>{p.path}</td>
                    <td className={`${td} mono text-[11px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{p.type}</td>
                    <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}>{p.topic}</td>
                    <td className={td} style={{ borderColor: "var(--border)" }}><MiniBar value={p.quality} color="var(--series-1)" /></td>
                    <td className={td} style={{ borderColor: "var(--border)" }}><MiniBar value={p.answerability} color="var(--series-4)" /></td>
                    <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: "var(--muted)" }}>{p.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* 2 · personas */}
      <div className="mt-9">
        <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--series-4)" }}>
          02 · WHO THE BUYERS ARE — {map.personas.length} PERSONAS, SHARE OF AUDITED DEMAND
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-2 gap-3">
          {map.personas.map((p, i) => {
            const c = PERSONA_COLORS[i % PERSONA_COLORS.length];
            return (
              <div key={p.id} className="card p-5" style={{ borderTop: `2px solid ${c}` }}>
                <div className="flex items-baseline gap-3">
                  <span className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{p.name}</span>
                  <span className="ml-auto text-[18px] font-bold mono" style={{ color: c }}>{p.share}%</span>
                </div>
                <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>{p.who}</p>
                <div className="grid gap-1.5 mt-3 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
                  <div><span style={{ color: "var(--good)" }}>Wants: </span>{p.wants}</div>
                  <div><span style={{ color: "var(--warning)" }}>Hesitates on: </span>{p.fears}</div>
                  <div><span style={{ color: c }}>Trigger: </span>{p.buyingTrigger}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3 · the grid */}
      <div className="mt-9">
        <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--accent)" }}>
          03 · THE JOURNEY GRID — EVERY PERSONA, EVERY STAGE, JUDGED AGAINST THE REAL SITE
        </div>
        <div className="card p-4 overflow-x-auto">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr>
                <th className="text-left px-2 py-2" />
                {JOURNEY_STAGES.map((s) => (
                  <th key={s.key} className="px-2 py-2 text-center">
                    <div className="text-[12px] font-bold" style={{ color: "var(--ink)" }}>{s.label}</div>
                    <div className="text-[10px] font-normal leading-tight mt-0.5" style={{ color: "var(--muted)" }}>{s.question}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.personas.map((p) => (
                <tr key={p.id}>
                  <td className="px-2 py-1.5 text-[12px] font-semibold whitespace-nowrap" style={{ color: personaColor.get(p.id) }}>
                    {p.name}
                  </td>
                  {JOURNEY_STAGES.map((s) => {
                    const c = map.grid.find((g) => g.personaId === p.id && g.stage === s.key);
                    if (!c) return <td key={s.key} />;
                    const m = STATUS_META[c.status];
                    const active = cell === c;
                    return (
                      <td key={s.key} className="px-1.5 py-1.5">
                        <button
                          onClick={() => setCell(active ? null : c)}
                          className="w-full rounded-lg px-2 py-2.5 text-center transition-transform active:scale-95"
                          style={{
                            background: "var(--surface-2)",
                            border: `1px solid ${active ? m.color : "var(--border)"}`,
                            boxShadow: active ? `inset 0 0 0 1px ${m.color}` : undefined,
                          }}
                          title={c.note}
                        >
                          <div className="text-[10px] mono font-bold" style={{ color: m.color }}>{m.label}</div>
                          <div className="text-[10.5px] mono mt-0.5" style={{ color: "var(--muted)" }}>
                            {c.terms.length} terms · {c.pagePaths.length} pages
                          </div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {cell && (
            <div className="mt-3 rounded-lg p-4" style={{ background: "var(--surface-2)", border: `1px solid ${STATUS_META[cell.status].color}` }}>
              <div className="text-[12px] font-semibold" style={{ color: "var(--ink)" }}>
                {personaName.get(cell.personaId)} · {JOURNEY_STAGES.find((s) => s.key === cell.stage)?.label} ·{" "}
                <span style={{ color: STATUS_META[cell.status].color }}>{STATUS_META[cell.status].label}</span>
              </div>
              <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "var(--ink-2)" }}>{cell.note}</p>
              {cell.pagePaths.length > 0 && (
                <div className="text-[11.5px] mono mt-2" style={{ color: "var(--muted)" }}>
                  pages: {cell.pagePaths.join(" · ")}
                </div>
              )}
              {cell.terms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {cell.terms.map((t) => (
                    <span key={t} className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: "var(--surface-1)", border: "1px solid var(--border)", color: "var(--ink-2)" }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4 · assignments */}
      <div className="mt-9">
        <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--series-2)" }}>
          04 · EVERY TERM ROUTED TO THE PAGE THAT SHOULD WIN IT — {map.assignments.length} ASSIGNMENTS
        </div>
        <div className="flex flex-col gap-3">
          {(["create", "optimize", "consolidate"] as const).map((action, idx) => {
            const rows = byAction(action);
            if (rows.length === 0) return null;
            const m = ACTION_META[action];
            return (
              <details key={action} className="card p-4" open={idx === 0}>
                <summary className="cursor-pointer select-none flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] mono px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: m.color, border: `1px solid ${m.color}` }}>
                    {m.label}
                  </span>
                  <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                    {rows.length} {rows.length === 1 ? "term" : "terms"}
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--muted)" }}>{m.blurb}</span>
                </summary>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full border-collapse min-w-[760px]">
                    <thead>
                      <tr style={{ color: "var(--muted)" }}>
                        <th className={th}>Term</th><th className={th}>Demand/mo</th><th className={th}>Persona · stage</th>
                        <th className={th}>Target page</th><th className={th}>What to do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) => (
                        <tr key={`${a.term}-${a.targetPath}`}>
                          <td className={td} style={{ borderColor: "var(--border)", color: "var(--ink)" }}>
                            {a.kind === "prompt" ? <>&ldquo;{a.term}&rdquo;</> : a.term}
                            {a.kind === "prompt" && (
                              <span className="text-[10px] mono ml-1.5" style={{ color: "var(--series-4)" }}>AI PROMPT</span>
                            )}
                          </td>
                          <td className={`${td} mono text-[12px]`} style={{ borderColor: "var(--border)" }}>
                            {a.volume > 0 && <span>{fmtNum(a.volume)}</span>}
                            {a.aiVolume > 0 && <span style={{ color: "var(--series-4)" }}>{a.volume > 0 ? " + " : ""}{fmtNum(a.aiVolume)} AI</span>}
                            {a.volume === 0 && a.aiVolume === 0 && <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                          <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: personaColor.get(a.personaId) }}>
                            {personaName.get(a.personaId) ?? a.personaId}
                            <span style={{ color: "var(--muted)" }}> · {a.stage}</span>
                          </td>
                          <td className={td} style={{ borderColor: "var(--border)" }}>
                            <span className="mono text-[11.5px]" style={{ color: "var(--ink)" }}>{a.targetPath}</span>
                            <div className="text-[11.5px] mt-0.5" style={{ color: "var(--muted)" }}>{a.targetTitle}</div>
                          </td>
                          <td className={`${td} text-[12px]`} style={{ borderColor: "var(--border)", color: "var(--ink-2)" }}>{a.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {/* 5 · forecast */}
      <div className="mt-9">
        <div className="text-[11px] mono tracking-[0.14em] mb-3" style={{ color: "var(--accent)" }}>
          05 · THE CAPTURE FORECAST — 12 MONTHS, THREE SCENARIOS, ENGINE-COMPUTED
        </div>
        <div className="card p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div>
              <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>STEADY STATE (BASE)</div>
              <div className="text-[20px] font-bold" style={{ color: "var(--accent)" }}>{fmtUsd(map.forecast.steadyState.base)}/mo</div>
            </div>
            <div>
              <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>MONTH 6 RUN-RATE (BASE)</div>
              <div className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>{fmtUsd(map.forecast.points[5]?.base ?? 0)}/mo</div>
            </div>
            <div>
              <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>YEAR-ONE CUMULATIVE (BASE)</div>
              <div className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>{fmtUsd(map.forecast.yearOneCumulative.base)}</div>
            </div>
            <div>
              <div className="text-[10px] mono" style={{ color: "var(--muted)" }}>YEAR-ONE RANGE</div>
              <div className="text-[20px] font-bold" style={{ color: "var(--muted)" }}>
                {fmtUsd(map.forecast.yearOneCumulative.conservative)}–{fmtUsd(map.forecast.yearOneCumulative.aggressive)}
              </div>
            </div>
          </div>
          <ForecastChart map={map} />
          {map.forecast.note && (
            <p className="text-[13px] mt-3 leading-relaxed max-w-4xl" style={{ color: "var(--ink-2)" }}>{map.forecast.note}</p>
          )}
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            {map.forecast.methodology.map((m) => (
              <div key={m} className="text-[11.5px] leading-relaxed" style={{ color: "var(--muted)" }}>· {m}</div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-5 flex-wrap">
        {map.meta.sources.map((s) => (
          <span key={s} className="text-[10.5px] mono" style={{ color: s.startsWith("LIVE") ? "var(--good)" : "var(--muted)" }}>{s}</span>
        ))}
        <button onClick={onRebuild} disabled={rebuilding}
          className="ml-auto text-[11px] mono px-2.5 py-1 rounded disabled:opacity-50"
          style={{ border: "1px solid var(--border)", color: "var(--muted)" }}>
          {rebuilding ? "rebuilding…" : "↺ rebuild map"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The panel — state machine around the job API
// ---------------------------------------------------------------------------

const BUILD_STEPS = ["Crawl the site", "Classify pages", "Draw personas", "Map journeys", "Forecast capture"];

export default function JourneyPanel({ domain, enabled }: { domain: string; enabled: boolean }) {
  const [job, setJob] = useState<JourneyJob | null>(null);
  const [checked, setChecked] = useState(false);
  const [starting, setStarting] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/journey?domain=${encodeURIComponent(domain)}`);
      const data = await res.json();
      if (alive.current) setJob(data.job ?? null);
    } catch {
      /* next poll retries */
    } finally {
      if (alive.current) setChecked(true);
    }
  }, [domain]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = job && (job.status === "queued" || job.status === "crawling" || job.status === "analyzing");

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const start = async (force: boolean) => {
    if (starting) return;
    setStarting(true);
    try {
      const res = await fetch("/api/journey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, force }),
      });
      const data = await res.json();
      if (alive.current && data.job) setJob(data.job);
    } catch {
      /* leave state as-is; the button stays available */
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  // Progress step index from the phase line — keeps the checklist honest.
  const phase = job?.phase ?? "";
  const stepIdx = /forecast/i.test(phase) ? 4 : /journey|assign/i.test(phase) ? 3 : /persona/i.test(phase) ? 2 : /classify/i.test(phase) ? 2 : /read|crawl/i.test(phase) ? 0 : 0;

  return (
    <section className="mt-14">
      <div className="text-[11px] mono tracking-[0.18em] mb-1.5" style={{ color: "var(--accent)" }}>
        THE DEEP PASS · JOURNEY MAP
      </div>
      <h2 className="text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
        Your site, your buyers, their journeys — and the page that wins each answer
      </h2>
      <p className="text-[13.5px] mt-1.5 max-w-3xl leading-relaxed" style={{ color: "var(--muted)" }}>
        The audit found the demand. The Journey Map reads the actual site page by page, draws the buyer
        personas behind the demand, judges every step of their journey against what exists — then routes
        every keyword and AI prompt to the page that should win it, with a month-by-month capture forecast.
      </p>

      <div className="mt-5">
        {job?.status === "ready" && job.payload ? (
          <ReadyMap map={job.payload} onRebuild={() => void start(true)} rebuilding={starting} />
        ) : active ? (
          <div className="card p-6" style={{ borderColor: "var(--accent)" }}>
            <div className="flex items-center gap-3">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
              <span className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{phase || "Working…"}</span>
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              {BUILD_STEPS.map((s, i) => (
                <span key={s} className="text-[11px] mono px-2.5 py-1 rounded-full"
                  style={{
                    border: "1px solid var(--border)",
                    color: i < stepIdx ? "var(--good)" : i === stepIdx ? "var(--accent)" : "var(--muted)",
                    background: i === stepIdx ? "var(--surface-2)" : "transparent",
                  }}>
                  {i < stepIdx ? "✓ " : ""}{s}
                </span>
              ))}
            </div>
            <p className="text-[12px] mt-4" style={{ color: "var(--muted)" }}>
              A real crawl plus two analyst passes — typically 2–4 minutes. This page updates itself; feel
              free to keep reading the audit above.
            </p>
          </div>
        ) : (
          <div className="card p-6" style={{ borderColor: "var(--accent)" }}>
            {job?.status === "error" && (
              <div className="text-[12.5px] mb-3 px-3 py-2 rounded-lg"
                style={{ background: "var(--surface-2)", border: "1px solid var(--critical)", color: "var(--critical)" }}>
                {job.error ?? "The last run failed."}
              </div>
            )}
            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => void start(job?.status === "error")}
                disabled={!enabled || starting || !checked}
                className="px-5 py-3 rounded-xl text-sm font-semibold transition-transform active:scale-95 disabled:opacity-50"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                {starting ? "Starting…" : job?.status === "error" ? "Rebuild the Journey Map →" : "Build the Journey Map →"}
              </button>
              <span className="text-[12px]" style={{ color: "var(--muted)" }}>
                {enabled
                  ? "Crawls the live site + runs two analyst passes · 2–4 minutes · included in the report & Excel once built"
                  : "Needs FIRECRAWL_API_KEY and ANTHROPIC_API_KEY configured on the server."}
              </span>
            </div>
            <div className="grid md:grid-cols-4 gap-2.5 mt-5">
              {[
                { t: "Site inventory", d: "Every page read, typed, and scored for quality and AI-quotability." },
                { t: "Personas & journeys", d: "Who buys, what they fear, and each step from aware to retained." },
                { t: "Gap grid & routing", d: "Every keyword and AI prompt assigned to the page that should win it." },
                { t: "Capture forecast", d: "Month-by-month revenue ramp, three scenarios, engine-computed." },
              ].map((x) => (
                <div key={x.t} className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <div className="text-[12.5px] font-semibold" style={{ color: "var(--ink)" }}>{x.t}</div>
                  <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>{x.d}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
