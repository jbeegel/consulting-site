"use client";

export function PrintButton() {
  return (
    <button
      className="no-print"
      onClick={() => window.print()}
      style={{
        background: "var(--accent)",
        color: "var(--accent-ink)",
        border: 0,
        borderRadius: 8,
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Print / Save PDF
    </button>
  );
}
