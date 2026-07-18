"use client";

// SVG chart primitives following the dataviz method: thin marks, rounded
// data-ends, recessive grid, direct labels, hover tooltips, single axis.

import { useState } from "react";

const INK2 = "var(--ink-2)";
const MUTED = "var(--muted)";
const GRID = "var(--grid)";

export function Sparkline({ data, color = "var(--series-1)" }: { data: number[]; color?: string }) {
  const w = 96;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`)
    .join(" ");
  return (
    <svg width={w} height={h} aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LineChart({
  points,
  title,
  color = "var(--series-1)",
}: {
  points: { label: string; value: number }[];
  title: string;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 560;
  const h = 190;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals) * 0.92;
  const max = Math.max(...vals) * 1.05;
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * iw;
  const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z`;
  const ticks = [min + span * 0.1, min + span * 0.5, min + span * 0.9];

  return (
    <figure className="w-full">
      <figcaption className="text-xs mb-2" style={{ color: MUTED }}>{title}</figcaption>
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full"
          role="img"
          aria-label={title}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * w;
            const idx = Math.round(((px - pad.l) / iw) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, idx)));
          }}
        >
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={MUTED}>
                {Math.round(t)}
              </text>
            </g>
          ))}
          <path d={area} fill={color} opacity={0.08} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) =>
            i % 2 === 0 || i === points.length - 1 ? (
              <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
                {p.label}
              </text>
            ) : null
          )}
          <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].value)} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke={MUTED} strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(points[hover].value)} r={4.5} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
              <g transform={`translate(${Math.min(x(hover) + 8, w - 110)}, ${pad.t + 2})`}>
                <rect width={100} height={34} rx={6} fill="var(--surface-3)" stroke="var(--border)" />
                <text x={8} y={14} fontSize={10} fill={MUTED}>{points[hover].label}</text>
                <text x={8} y={27} fontSize={12} fill={INK2} fontWeight={600}>
                  {points[hover].value.toLocaleString()}
                </text>
              </g>
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}

export function Bars({
  items,
  title,
  unit = "",
  highlightColor = "var(--accent-deep)",
  color = "var(--series-1)",
}: {
  items: { label: string; value: number; highlight?: boolean }[];
  title: string;
  unit?: string;
  highlightColor?: string;
  color?: string;
}) {
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return (
    <figure className="w-full">
      <figcaption className="text-xs mb-2" style={{ color: MUTED }}>{title}</figcaption>
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2 group">
            <div
              className="w-40 shrink-0 truncate text-xs text-right"
              style={{ color: it.highlight ? "var(--ink)" : INK2 }}
              title={it.label}
            >
              {it.label}
            </div>
            <div className="flex-1 h-4 relative">
              <div
                className="h-4 rounded-r-[4px] transition-all group-hover:opacity-90"
                style={{
                  width: `${Math.max(2, (it.value / max) * 100)}%`,
                  background: it.highlight ? highlightColor : color,
                  opacity: it.highlight ? 1 : 0.75,
                }}
              />
            </div>
            <div className="w-14 shrink-0 text-xs mono" style={{ color: it.highlight ? "var(--ink)" : MUTED }}>
              {it.value.toLocaleString()}
              {unit}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
