import type { Metadata } from "next";
import AuditReport from "@/components/audit-report";
import { buildMarketProfile, normalizeDomain } from "@/lib/core/market";
import { dataforseoConfigured } from "@/lib/audit/providers";
import { buildAuditMaybeLive } from "@/lib/audit/live";

export const maxDuration = 60;

interface Props {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ live?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain } = await params;
  const p = buildMarketProfile(decodeURIComponent(domain));
  return { title: `${p.brand.name} — SEO & GEO Opportunity Audit` };
}

export default async function AuditDomainPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { live } = await searchParams;
  const normalized = normalizeDomain(decodeURIComponent(domain)) || "example.com";
  // Live by default when DataForSEO keys exist — this page is the prospect
  // moment. ?live=0 forces demo, ?live=1 forces live. Results cache 6h.
  const useLive = live === "0" ? false : live === "1" ? true : dataforseoConfigured();
  const audit = await buildAuditMaybeLive(normalized, useLive);
  return <AuditReport audit={audit} />;
}
