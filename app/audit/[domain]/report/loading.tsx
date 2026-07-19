// Instant feedback while the client report renders (first run can pull the
// full live pipeline if the audit isn't cached yet).

export default function ReportLoading() {
  return (
    <div style={{ background: "#ffffff", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "IBM Plex Sans, system-ui, sans-serif" }}>
      <style>{`@keyframes repSpin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#0e7490", animation: "repSpin 1.1s linear infinite", marginBottom: 20 }} />
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 11, letterSpacing: "0.16em", color: "#0e7490" }}>
        PREPARING THE CLIENT REPORT
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
        Assembling exhibits from the audit — a moment, please.
      </div>
    </div>
  );
}
