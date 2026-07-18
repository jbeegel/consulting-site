// One-click Excel export of an Opportunity Audit.
//
// Built for analysis, not display: every sheet is a real Excel Table
// (autofilter, frozen header, typed number formats) over flat rows —
// drop a pivot on the Keywords sheet and slice by cluster, stage, or
// intent immediately. Per-keyword economics are recomputed here with the
// same model the report uses, so the workbook's numbers reconcile with
// the page and the printed methodology.

import ExcelJS from "exceljs";
import { AI_CITED_CAPTURE, ctrAt } from "./model";
import type { OpportunityAudit } from "./types";

const INK = "FF141B2E";
const ACCENT = "FF00A3C4";

function addTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string) {
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { name: "Calibri", size: 16, bold: true, color: { argb: INK } };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF6B7280" } };
}

interface Col {
  header: string;
  width: number;
  numFmt?: string;
}

// One helper builds every sheet: title rows, an Excel Table with striped
// styling, per-column number formats, frozen header.
function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  subtitle: string,
  cols: Col[],
  rows: (string | number | null)[][]
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }] });
  addTitle(ws, name, subtitle);
  ws.addTable({
    name: name.replace(/[^A-Za-z0-9]/g, "") + "Table",
    ref: "A4",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.length ? rows : [cols.map(() => null)],
  });
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.numFmt) {
      for (let r = 5; r <= 4 + Math.max(rows.length, 1); r++) {
        ws.getCell(r, i + 1).numFmt = c.numFmt;
      }
    }
  });
  ws.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
  return ws;
}

export async function buildWorkbook(a: OpportunityAudit): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Capture — SEO & GEO Opportunity Audit";
  wb.created = new Date();

  const { aov, conversionRate } = a.economics;

  // ---- Overview ----
  const ov = wb.addWorksheet("Overview");
  ov.getColumn(1).width = 34;
  ov.getColumn(2).width = 90;
  addTitle(ov, `${a.brand.name} — SEO & GEO Opportunity Audit`, `${a.brand.domain} · ${a.brand.category} · ${a.meta.generatedAt} · ${a.meta.mode.toUpperCase()} data`);
  const kv: [string, string | number][] = [
    ["Capture score", `${a.score.overall}/100 (${a.score.grade})`],
    ["SEO capture", `${a.score.seo}%`],
    ["GEO / AI capture", `${a.score.geo}%`],
    ["Keywords audited", a.headline.keywordsAudited],
    ["Opportunity clusters", a.headline.clustersFound],
    ["Google demand audited (searches/mo)", a.headline.totalVolume],
    ["AI-assistant demand (searches/mo)", a.headline.totalAiVolume],
    ["Traffic value today ($/mo)", a.economics.trafficValueNow],
    ["Opportunity — conservative ($/mo)", a.economics.opportunity.conservative],
    ["Opportunity — base ($/mo)", a.economics.opportunity.base],
    ["Opportunity — aggressive ($/mo)", a.economics.opportunity.aggressive],
    ["Assumed AOV ($)", aov],
    ["Assumed conversion rate", conversionRate],
    ["Business model", a.businessModel.model],
    ["Top competitor", a.headline.topCompetitor],
    ["Verdict", a.score.verdict],
  ];
  kv.forEach(([k, v], i) => {
    const r = 4 + i;
    ov.getCell(r, 1).value = k;
    ov.getCell(r, 1).font = { bold: true, color: { argb: INK } };
    ov.getCell(r, 2).value = v;
    ov.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
    if (typeof v === "number" && k.includes("$")) ov.getCell(r, 2).numFmt = "$#,##0";
    if (k === "Assumed conversion rate") ov.getCell(r, 2).numFmt = "0.0%";
  });
  let mr = 4 + kv.length + 1;
  ov.getCell(mr, 1).value = "Methodology";
  ov.getCell(mr, 1).font = { bold: true, size: 12, color: { argb: ACCENT } };
  a.meta.methodology.forEach((m, i) => {
    ov.getCell(mr + 1 + i, 2).value = m;
    ov.getCell(mr + 1 + i, 2).alignment = { wrapText: true, vertical: "top" };
  });
  mr += a.meta.methodology.length + 2;
  ov.getCell(mr, 1).value = "Sources";
  ov.getCell(mr, 1).font = { bold: true, size: 12, color: { argb: ACCENT } };
  a.meta.sources.forEach((s, i) => {
    ov.getCell(mr + 1 + i, 2).value = s;
  });

  // ---- Keywords (the pivot base) ----
  addTableSheet(
    wb,
    "Keywords",
    "One row per audited keyword — pivot by Cluster, Stage, or Intent. Economics use the printed CTR/conversion model.",
    [
      { header: "Cluster", width: 30 },
      { header: "Stage", width: 10 },
      { header: "Keyword", width: 34 },
      { header: "Intent", width: 14 },
      { header: "Google vol/mo", width: 14, numFmt: "#,##0" },
      { header: "AI vol/mo", width: 12, numFmt: "#,##0" },
      { header: "CPC", width: 10, numFmt: "$#,##0.00" },
      { header: "Difficulty", width: 10 },
      { header: "Position", width: 10 },
      { header: "Target pos", width: 10 },
      { header: "AI Overview on SERP", width: 18 },
      { header: "Brand cited in AI", width: 16 },
      { header: "SERP features", width: 34 },
      { header: "Est. visits now/mo", width: 16, numFmt: "#,##0" },
      { header: "Est. visits at target/mo", width: 20, numFmt: "#,##0" },
      { header: "Est. upside $/mo", width: 16, numFmt: "$#,##0" },
    ],
    a.clusters.flatMap((c) =>
      c.keywords.map((k) => {
        const now = k.volume * ctrAt(k.position) + k.aiVolume * (k.aiCited ? AI_CITED_CAPTURE : 0);
        const at = k.volume * ctrAt(c.targetPosition) + k.aiVolume * (k.aiCited ? AI_CITED_CAPTURE : 0);
        return [
          c.name, c.stage, k.term, k.intent, k.volume, k.aiVolume, k.cpc, k.difficulty,
          k.position ?? null, c.targetPosition,
          k.aiOverviewPresent ? "yes" : "no", k.aiCited ? "yes" : "no",
          k.serpFeatures.join(", "),
          Math.round(now), Math.round(at),
          Math.max(0, Math.round((at - now) * conversionRate * aov)),
        ];
      })
    )
  );

  // ---- Clusters ----
  addTableSheet(
    wb,
    "Clusters",
    "Cluster rollups with the three revenue scenarios.",
    [
      { header: "Cluster", width: 30 },
      { header: "Stage", width: 10 },
      { header: "Keywords", width: 10 },
      { header: "Google vol/mo", width: 14, numFmt: "#,##0" },
      { header: "AI vol/mo", width: 12, numFmt: "#,##0" },
      { header: "Avg difficulty", width: 13 },
      { header: "Best pos", width: 10 },
      { header: "Target pos", width: 10 },
      { header: "Traffic now/mo", width: 14, numFmt: "#,##0" },
      { header: "Traffic at target/mo", width: 18, numFmt: "#,##0" },
      { header: "Conservative $/mo", width: 16, numFmt: "$#,##0" },
      { header: "Base $/mo", width: 12, numFmt: "$#,##0" },
      { header: "Aggressive $/mo", width: 15, numFmt: "$#,##0" },
      { header: "Held by", width: 22 },
      { header: "The play", width: 70 },
    ],
    a.clusters.map((c) => [
      c.name, c.stage, c.keywords.length, c.totalVolume, c.totalAiVolume, c.avgDifficulty,
      c.bestPosition ?? null, c.targetPosition, c.currentTraffic, c.potentialTraffic,
      c.monthlyRevenue.conservative, c.monthlyRevenue.base, c.monthlyRevenue.aggressive,
      c.competitorOwning ?? "—", c.play,
    ])
  );

  // ---- Top opportunities ----
  addTableSheet(
    wb,
    "Top Opportunities",
    "SEO and GEO plays ranked together in $/mo (base scenario).",
    [
      { header: "Rank", width: 7 },
      { header: "Opportunity", width: 38 },
      { header: "Type", width: 10 },
      { header: "Base $/mo", width: 12, numFmt: "$#,##0" },
      { header: "Detail", width: 60 },
      { header: "Action", width: 70 },
    ],
    a.topOpportunities.map((o, i) => [i + 1, o.title, o.kind.toUpperCase(), o.monthly, o.detail, o.action])
  );

  // ---- Quick wins ----
  addTableSheet(
    wb,
    "Quick Wins",
    "Striking-distance keywords (positions 4–15) — fastest payback in the plan.",
    [
      { header: "Keyword", width: 34 },
      { header: "Position", width: 10 },
      { header: "Target", width: 8 },
      { header: "Google vol/mo", width: 14, numFmt: "#,##0" },
      { header: "AI vol/mo", width: 12, numFmt: "#,##0" },
      { header: "Upside $/mo", width: 12, numFmt: "$#,##0" },
      { header: "Note", width: 60 },
    ],
    a.quickWins.map((w) => [w.term, w.position, w.targetPosition, w.volume, w.aiVolume, w.monthlyUpside, w.note])
  );

  // ---- Competitors ----
  addTableSheet(
    wb,
    "Competitors",
    "Who holds the demand today and the size of their head start.",
    [
      { header: "Competitor", width: 26 },
      { header: "Domain", width: 28 },
      { header: "Shared keywords", width: 15, numFmt: "#,##0" },
      { header: "Their exclusive", width: 14, numFmt: "#,##0" },
      { header: "Traffic value $/mo", width: 16, numFmt: "$#,##0" },
      { header: "AI citation rate", width: 15, numFmt: "0%" },
      { header: "Read", width: 70 },
    ],
    a.competitorGaps.map((c) => [
      c.name, c.domain, c.sharedKeywords, c.theirExclusive, c.estTrafficValue, c.aiCitationRate / 100, c.threat,
    ])
  );

  // ---- GEO & citations ----
  const geoRows: (string | number | null)[][] = [
    ...a.geo.surfaces.map((s) => ["Citation rate", s.name, s.citationRate / 100, `${s.promptsTracked} prompts tracked`]),
    ...a.geo.missedPrompts.map((m) => ["Missed prompt", m.prompt, null, `${m.surface} — cited instead: ${m.citedInstead.join(", ") || "competitors"}`]),
    ...a.geo.readiness.map((r) => ["Readiness", r.check, null, `${r.status.toUpperCase()} — ${r.fix}`]),
  ];
  addTableSheet(
    wb,
    "GEO & Citations",
    `AI-assistant demand: ${a.geo.totalAiVolume.toLocaleString()} searches/mo (${a.geo.aiVolumeShare}% of total). Blended citation rate ${a.geo.citationRate}%.`,
    [
      { header: "Kind", width: 14 },
      { header: "Item", width: 50 },
      { header: "Rate", width: 10, numFmt: "0%" },
      { header: "Detail", width: 70 },
    ],
    geoRows
  );

  // ---- Roadmap ----
  addTableSheet(
    wb,
    "Roadmap",
    "The 90-day sequence with KPIs and expected lift per phase.",
    [
      { header: "Phase", width: 12 },
      { header: "Focus", width: 34 },
      { header: "Move", width: 80 },
      { header: "KPI", width: 40 },
      { header: "Expected lift", width: 16 },
    ],
    a.roadmap.flatMap((p) => p.moves.map((m, i) => [p.phase, i === 0 ? p.focus : "", m, i === 0 ? p.kpi : "", i === 0 ? p.expectedLift : ""]))
  );

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
