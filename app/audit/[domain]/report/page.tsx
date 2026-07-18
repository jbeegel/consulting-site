import type { Metadata } from "next";
import AuditDoc from "@/components/audit-doc";
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
  return { title: `${p.brand.name} — Opportunity Report` };
}

export default async function AuditReportDocPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { live } = await searchParams;
  const normalized = normalizeDomain(decodeURIComponent(domain)) || "example.com";
  const useLive = live === "0" ? false : live === "1" ? true : dataforseoConfigured();
  const audit = await buildAuditMaybeLive(normalized, useLive);
  return <AuditDoc audit={audit} />;
}
