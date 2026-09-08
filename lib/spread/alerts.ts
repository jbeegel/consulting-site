// Alerts: hot lots entering their final window. Webhook (Slack/Discord-compatible JSON) and/or email via Resend.
import { config } from "./config";
import type { Store } from "./store";
import type { Lot, Opportunity } from "./types";

const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

function line(o: Opportunity): string {
  const l = o.lot, s = o.score, v = o.valuation;
  const mins = s.seconds_left == null ? "?" : Math.max(1, Math.round(s.seconds_left / 60)) + "m";
  return `[${Math.round(s.score)}] ${l.title} — next bid ${money(s.next_bid)} → landed ${money(s.landed_cost)}, resale ${money(v?.low)}–${money(v?.high)} (net ${money(s.net_resale)}, ${s.ratio?.toFixed(1)}x, +${money(s.spread)}), ${l.bid_count} bids, closes in ${mins}. ${l.url}`;
}

export async function sendAlerts(store: Store, candidates: Opportunity[], now = Date.now() / 1000): Promise<number> {
  const due = candidates.filter((o) => {
    const l = o.lot as Lot;
    return o.score.valued && o.score.score >= config.alertMinScore && o.score.seconds_left !== null &&
      o.score.seconds_left > 0 && o.score.seconds_left <= config.alertWindowMin * 60 && !l.alerted_at;
  });
  if (!due.length) return 0;
  if (!config.alertWebhook && !(config.resendKey && config.alertEmail)) return 0;
  due.sort((a, b) => b.score.score - a.score.score);
  const title = `Spread Hunter: ${due.length} hot lot${due.length > 1 ? "s" : ""} closing within ${config.alertWindowMin} min`;
  const body = due.slice(0, 15).map(line).join("\n");
  const jobs: Promise<unknown>[] = [];
  if (config.alertWebhook) {
    jobs.push(fetch(config.alertWebhook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `*${title}*\n${body}`, content: `**${title}**\n${body}`.slice(0, 1900) }),
      signal: AbortSignal.timeout(10000),
    }).catch((e) => console.warn("alert webhook failed", e)));
  }
  if (config.resendKey && config.alertEmail) {
    jobs.push(fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.resendKey}` },
      body: JSON.stringify({ from: config.alertFrom, to: [config.alertEmail], subject: title, text: body }),
      signal: AbortSignal.timeout(10000),
    }).catch((e) => console.warn("alert email failed", e)));
  }
  await Promise.all(jobs);
  await store.markAlerted(due.map((o) => o.lot.id), now);
  return due.length;
}
