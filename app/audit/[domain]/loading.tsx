// Instant feedback for the audit route. A first-run live audit pulls
// rankings, keyword ideas, AI volumes, SERP scans, and the analyst pass —
// 30-90s. Next streams this the moment navigation starts, so the click
// always visibly does something. CSS-only animation; no client JS.

export default function AuditLoading() {
  const steps = [
    "Pulling live rankings (top 300 keywords)…",
    "Mapping unclaimed category demand…",
    "Reading AI-assistant search volumes…",
    "Scanning SERPs + AI Overview citations…",
    "Sizing competitors…",
    "Pricing every gap in $/mo…",
    "Analyst pass — writing the narrative…",
  ];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "var(--page)" }}>
      <style>{`
        @keyframes auditPulse {
          0%, 100% { opacity: .25; }
          12% { opacity: 1; }
          24% { opacity: .25; }
        }
        @keyframes auditSpin { to { transform: rotate(360deg); } }
        .audit-step { animation: auditPulse 8.4s linear infinite; }
        .audit-ring { animation: auditSpin 1.1s linear infinite; }
      `}</style>
      <div
        className="audit-ring w-10 h-10 rounded-full mb-7"
        style={{ border: "3px solid var(--surface-3)", borderTopColor: "var(--accent)" }}
      />
      <div className="text-[11px] mono tracking-[0.2em] mb-2" style={{ color: "var(--accent)" }}>
        CAPTURE · LIVE AUDIT RUNNING
      </div>
      <h1 className="text-2xl font-bold text-center" style={{ color: "var(--ink)" }}>
        Building the opportunity audit
      </h1>
      <p className="text-[13px] mt-2 text-center max-w-md" style={{ color: "var(--muted)" }}>
        First run on a domain pulls live market data end to end — usually 30–90 seconds.
        After that it&rsquo;s cached and instant.
      </p>
      <div className="flex flex-col gap-2 mt-7 text-[13px] mono" style={{ color: "var(--ink-2)" }}>
        {steps.map((s, i) => (
          <div key={s} className="audit-step" style={{ animationDelay: `${i * 1.2}s` }}>
            ▸ {s}
          </div>
        ))}
      </div>
    </div>
  );
}
