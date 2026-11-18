"use client";
// Art Pull — the shop-floor screen. Big type, one job at a time: scan → traveler → art → press queue.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArtFile, ResolveResult, StageResult, Traveler } from "@/lib/artpull/types";
import { DEFAULT_MACHINES, MACHINES } from "@/lib/artpull/parse";

type Status = { reader: boolean; dropbox: { connected: boolean; account: string | null; team: boolean; error: string | null; probe?: { path: string; found: boolean } | null }; gated: boolean };
type Settings = { token: string; key: string; queueRoot: string; machineMap: Record<string, string> };
type Job = { at: string; wo: string; file: string; machine: string; dest: string; mode: string };

const LS = "artpull.settings.v1";
const CACHE = "artpull.travelers.v1";

function loadSettings(): Settings {
  const d: Settings = { token: "", key: "", queueRoot: "/TFG Team Folder/PRINT QUEUE", machineMap: { ...DEFAULT_MACHINES } };
  try { const raw = localStorage.getItem(LS); if (raw) return { ...d, ...JSON.parse(raw) }; } catch {}
  return d;
}
function loadCache(): Record<string, Traveler> { try { return JSON.parse(localStorage.getItem(CACHE) || "{}"); } catch { return {}; } }
function saveCache(c: Record<string, Traveler>) { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch {} }

async function fileToJpeg(file: File, maxSide = 2200): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not decode that image. Take the photo again as JPEG.")); i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.9);
    return { data: dataUrl.split(",")[1], mediaType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

function fmtSize(n: number | null) { if (n == null) return ""; if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`; if (n > 1e3) return `${Math.round(n / 1e3)} KB`; return `${n} B`; }
function fmtDate(s: string | null) { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString(); }

export default function ArtPull() {
  const [settings, setSettings] = useState<Settings>(() => ({ token: "", key: "", queueRoot: "/TFG Team Folder/PRINT QUEUE", machineMap: { ...DEFAULT_MACHINES } }));
  const [status, setStatus] = useState<Status | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reading" | "finding" | "ready" | "staging" | "staged">("idle");
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [traveler, setTraveler] = useState<Traveler | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [chosen, setChosen] = useState<ArtFile | null>(null);
  const [machine, setMachine] = useState<string>(MACHINES[0]);
  const [staged, setStaged] = useState<StageResult | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [barcode, setBarcode] = useState("");
  const [timing, setTiming] = useState<{ read?: number; find?: number } | null>(null);
  const [connMsg, setConnMsg] = useState<string | null>(null);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSettings(loadSettings()); }, []);
  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.token) h["x-dropbox-token"] = settings.token;
    if (settings.key) h["x-artpull-key"] = settings.key;
    return h;
  }, [settings.token, settings.key]);

  const refreshStatus = useCallback(async () => {
    try { const r = await fetch("/api/artpull/status", { headers, cache: "no-store" }); setStatus(r.ok ? await r.json() : null); } catch { setStatus(null); }
  }, [headers]);
  async function testConnections() {
    setConnMsg("Testing…");
    try {
      // Probe the top-level folder of the queue path (e.g. "/TFG Team Folder") so team-space access is proven, not assumed.
      const top = "/" + (settings.queueRoot.split("/").filter(Boolean)[0] ?? "");
      const r = await fetch(`/api/artpull/status?probe=${encodeURIComponent(top)}`, { headers, cache: "no-store" });
      const j = (await r.json()) as Status;
      setStatus(j);
      if (!j.dropbox.connected) { setConnMsg(`Dropbox not connected${j.dropbox.error ? `: ${j.dropbox.error}` : " (no token)"}. Reader ${j.reader ? "on" : "off"}.`); return; }
      const probe = j.dropbox.probe;
      const seen = probe ? (probe.found ? `Can see ${probe.path}.` : `Cannot see ${probe.path} from this token (it will be created on first send, or fix the queue folder).`) : "";
      setConnMsg(`Connected to Dropbox as ${j.dropbox.account}${j.dropbox.team ? " (team space)" : " (personal)"}. ${seen} Reader ${j.reader ? "on" : "off"}.`);
    } catch (e) { setConnMsg(e instanceof Error ? e.message : String(e)); }
  }
  async function seedTestFiles() {
    setSeeding(true); setSeedMsg(null);
    try {
      const r = await fetch("/api/artpull/seed", { method: "POST", headers, body: JSON.stringify({}) });
      const j = await r.json();
      if (!r.ok) { setSeedMsg(j.error || "Could not create test files"); return; }
      setSeedMsg(`Created ${j.created.length} files in ${j.account}'s Dropbox: ${j.created.filter((p: string) => p.endsWith(".eps")).join(" · ")}`);
    } catch (e) { setSeedMsg(e instanceof Error ? e.message : String(e)); }
    finally { setSeeding(false); }
  }
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  function persist(next: Settings) { setSettings(next); try { localStorage.setItem(LS, JSON.stringify(next)); } catch {} }

  const find = useCallback(async (t: Traveler) => {
    setPhase("finding"); setError(null); setResult(null); setChosen(null); setStaged(null);
    const t0 = performance.now();
    const r = await fetch("/api/artpull/resolve", { method: "POST", headers, body: JSON.stringify({ traveler: t, machineMap: settings.machineMap }) });
    const j = await r.json();
    if (!r.ok) { setError(j.error || "Lookup failed"); setPhase("idle"); return; }
    const res = j as ResolveResult;
    setResult(res); setChosen(res.primary); setMachine(res.machine);
    setTiming((x) => ({ ...(x ?? {}), find: Math.round(performance.now() - t0) }));
    setPhase("ready");
  }, [headers, settings.machineMap]);

  const readImage = useCallback(async (file: File) => {
    setError(null); setTraveler(null); setResult(null); setStaged(null); setPhase("reading"); setTiming(null);
    try {
      const { data, mediaType } = await fileToJpeg(file);
      setPhoto(`data:${mediaType};base64,${data}`);
      const t0 = performance.now();
      const r = await fetch("/api/artpull/extract", { method: "POST", headers, body: JSON.stringify({ image: data, mediaType }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error || "Could not read the traveler"); setPhase("idle"); return; }
      const t = j.traveler as Traveler;
      setTiming({ read: Math.round(performance.now() - t0) });
      setTraveler(t);
      if (t.work_order_number) { const c = loadCache(); c[t.work_order_number] = t; saveCache(c); }
      await find(t);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPhase("idle"); }
  }, [headers, find]);

  const loadSample = useCallback(async () => {
    setError(null); setPhoto(null); setPhase("reading"); setTiming(null);
    const r = await fetch("/api/artpull/extract", { method: "POST", headers, body: JSON.stringify({ sample: true }) });
    const j = await r.json();
    const t = j.traveler as Traveler;
    setTraveler(t);
    const c = loadCache(); if (t.work_order_number) { c[t.work_order_number] = t; saveCache(c); }
    await find(t);
  }, [headers, find]);

  function onBarcode(e: React.FormEvent) {
    e.preventDefault();
    const wo = barcode.trim().replace(/\D/g, "");
    setBarcode("");
    if (!wo) return;
    const c = loadCache();
    if (c[wo]) { setPhoto(null); setTraveler(c[wo]); find(c[wo]); setError(null); }
    else setError(`Work order ${wo} hasn't been photographed on this device yet. With NetSuite access this lookup is instant; for now, photograph the traveler once.`);
  }

  async function stage() {
    if (!chosen || !traveler) return;
    setPhase("staging"); setError(null);
    const r = await fetch("/api/artpull/stage", { method: "POST", headers, body: JSON.stringify({ artPath: chosen.path, machine, traveler, queueRoot: settings.queueRoot }) });
    const j = await r.json();
    if (!r.ok) { setError(j.error || "Could not stage the file"); setPhase("ready"); return; }
    const s = j as StageResult;
    setStaged(s); setPhase("staged");
    setJobs((list) => [{ at: s.at, wo: traveler.work_order_number ?? "?", file: chosen.name, machine, dest: s.destination, mode: s.mode }, ...list].slice(0, 25));
  }

  function reset() { setPhase("idle"); setPhoto(null); setTraveler(null); setResult(null); setChosen(null); setStaged(null); setError(null); setTiming(null); setTimeout(() => barcodeRef.current?.focus(), 0); }

  const live = status?.dropbox.connected;
  const busy = phase === "reading" || phase === "finding" || phase === "staging";

  return (
    <main className="ap">
      <style>{CSS}</style>
      <header className="ap-head">
        <div>
          <div className="ap-eyebrow">The Fanatic Group · Edison NJ</div>
          <h1>Art Pull</h1>
          <p className="ap-sub">Scan the traveler. The art finds itself and lands on the press.</p>
        </div>
        <div className="ap-status">
          <span className={`pill ${status?.reader ? "ok" : "off"}`}>{status?.reader ? "Reader on" : "Reader off"}</span>
          <span className={`pill ${live ? "ok" : "warn"}`}>{live ? `Dropbox: ${status?.dropbox.account}${status?.dropbox.team ? " (team)" : ""}` : "Dropbox: demo library"}</span>
          <button className="ghost" onClick={() => setShowSettings((v) => !v)}>{showSettings ? "Close settings" : "Settings"}</button>
        </div>
      </header>

      {showSettings && (
        <section className="card settings">
          <h2>Connections</h2>
          <label>Dropbox access token
            <input id="ap-token" type="password" value={settings.token} onChange={(e) => persist({ ...settings, token: e.target.value })} placeholder="Paste a token from the Dropbox App Console" />
            <small>Dropbox App Console → your app → Settings → Generate access token. Scopes needed: files.metadata.read, files.content.read, files.content.write. Tokens last about 4 hours. Stored only in this browser.</small>
          </label>
          <label>Access code (only if the site owner set one)
            <input id="ap-key" type="password" value={settings.key} onChange={(e) => persist({ ...settings, key: e.target.value })} />
          </label>
          <label>Press queue folder in Dropbox
            <input id="ap-queue" value={settings.queueRoot} onChange={(e) => persist({ ...settings, queueRoot: e.target.value })} />
            <small>Staged files go to this folder / today&apos;s date / machine. The press PC sees them through Dropbox desktop sync.</small>
          </label>
          <h2>Which press runs which item</h2>
          <div className="mapgrid">
            {Object.entries(settings.machineMap).map(([code, m]) => (
              <label key={code} className="maprow"><span className="mono">{code}</span>
                <select value={m} onChange={(e) => persist({ ...settings, machineMap: { ...settings.machineMap, [code]: e.target.value } })}>
                  {MACHINES.map((x) => <option key={x}>{x}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="row"><button onClick={testConnections}>Test connections</button>{connMsg && <span className={status?.dropbox.connected ? "okline" : "err"}>{connMsg}</span>}</div>
          <h2 style={{ marginTop: 18 }}>Rehearsal</h2>
          <p className="small dim" style={{ margin: "0 0 10px" }}>Puts placeholder art for the three sample travelers (Kent State, Arizona, Xavier) into the connected Dropbox, in the same folder chain the real travelers print, so a photographed traveler resolves to a real file. Safe to run more than once.</p>
          <div className="row"><button onClick={seedTestFiles} disabled={seeding || !status?.dropbox.connected}>{seeding ? "Creating…" : "Create test files in my Dropbox"}</button>{seedMsg && <span className={seedMsg.startsWith("Created") ? "okline" : "err"}>{seedMsg}</span>}</div>
        </section>
      )}

      <section className="grid-top">
        <div className="card capture">
          <h2>1 · Scan the traveler</h2>
          <form onSubmit={onBarcode} className="barcode">
            <input ref={barcodeRef} id="ap-barcode" autoFocus inputMode="numeric" placeholder="Scan the barcode (work order #) and press Enter" value={barcode} onChange={(e) => setBarcode(e.target.value)} disabled={busy} />
          </form>
          <div className="or">or photograph the paper</div>
          <label className={`drop ${busy ? "busy" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readImage(f); }}>
            <input id="ap-photo" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readImage(f); e.currentTarget.value = ""; }} disabled={busy} />
            {photo ? <img src={photo} alt="Traveler" /> : <span><strong>Tap to use the camera</strong><br />or drop a photo / scan here</span>}
          </label>
          <div className="row small">
            <button className="ghost" onClick={loadSample} disabled={busy}>Load a sample traveler</button>
            {phase !== "idle" && <button className="ghost" onClick={reset}>Start over</button>}
          </div>
          {phase === "reading" && <div className="progress">Reading the traveler…</div>}
          {phase === "finding" && <div className="progress">Searching Dropbox…</div>}
          {error && <div className="err">{error}</div>}
        </div>

        <div className="card">
          <h2>2 · What the traveler says</h2>
          {!traveler ? <p className="muted">Nothing read yet.</p> : (
            <div className="facts">
              <div className="wo"><span>Work order</span><b>{traveler.work_order_number ?? "?"}</b></div>
              <Fact k="Assembly" v={traveler.assembly} mono />
              <Fact k="Description" v={traveler.description} />
              <Fact k="Qty" v={traveler.qty_required != null ? String(traveler.qty_required) : null} big />
              <Fact k="Customer" v={traveler.customer} />
              <Fact k="Sales order" v={traveler.sales_order} mono />
              <Fact k="Needs by" v={traveler.needs_by} />
              <Fact k="Do not ship til" v={traveler.do_not_ship_til} />
              <Fact k="Royalty" v={[traveler.royalty_code, traveler.royalty_agency].filter(Boolean).join(" · ") || null} />
              <Fact k="Frontside file" v={traveler.frontside_file_path} mono wrap />
              {traveler.backside_file_path && <Fact k="Backside file" v={traveler.backside_file_path} mono wrap />}
              {traveler.components?.length > 0 && <Fact k="Components" v={traveler.components.map((c) => `${c.qty ?? ""} × ${c.item}`).join(", ")} mono />}
              <div className="conf">Path read confidence {Math.round((traveler.path_confidence ?? 0) * 100)}%{timing?.read ? ` · read in ${(timing.read / 1000).toFixed(1)}s` : ""}</div>
              {traveler.notes?.length > 0 && <ul className="notes">{traveler.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </div>
          )}
        </div>
      </section>

      <section className="card art">
        <h2>3 · The art</h2>
        {!result ? <p className="muted">Scan a traveler to find its art.</p> : (
          <div className="artgrid">
            <div className="preview">
              {result.preview.kind === "image" && result.preview.url ? <img src={result.preview.url} alt="Art preview" /> :
                result.preview.kind === "pdf" && result.preview.url ? <a className="pdf" href={result.preview.url} target="_blank" rel="noreferrer">Open PDF preview ({result.preview.from})</a> :
                <div className="noprev"><div className="ext">{chosen?.ext?.toUpperCase() || "?"}</div><div>{chosen ? "Vector master (no rendered preview in this folder)" : "No file"}</div></div>}
            </div>
            <div className="pick">
              {chosen ? (
                <>
                  <div className="chosen">
                    <div className="name">{chosen.name}</div>
                    <div className="path mono">{chosen.path}</div>
                    <div className="meta">{fmtSize(chosen.size)}{chosen.modified ? ` · modified ${fmtDate(chosen.modified)}` : ""}{chosen.exact ? " · exact path from traveler" : ""}</div>
                    <div className="reasons">{chosen.reasons.map((r) => <span key={r} className="tag">{r}</span>)}</div>
                  </div>
                  {result.candidates.length > 1 && (
                    <details className="cands">
                      <summary>{result.candidates.length - 1} other file{result.candidates.length > 2 ? "s" : ""} with this name or code</summary>
                      <ul>{result.candidates.filter((c) => c.path !== chosen.path).map((c) => (
                        <li key={c.path}><button className="link" onClick={() => setChosen(c)}>{c.name}</button> <span className="mono dim">{c.path}</span> <span className="dim">{fmtSize(c.size)}</span></li>
                      ))}</ul>
                    </details>
                  )}
                  {result.siblings.length > 1 && <div className="dim small">Same design also saved as: {result.siblings.filter((s) => s.path !== chosen.path).map((s) => s.ext.toUpperCase()).join(", ")}</div>}
                </>
              ) : <p className="muted">No match. Check the file path above or search Dropbox by hand.</p>}
              {result.warnings.map((w) => <div key={w} className="warn-line">{w}</div>)}
              <div className="send">
                <label>Press
                  <select id="ap-machine" value={machine} onChange={(e) => setMachine(e.target.value)}>{MACHINES.map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <button className="primary" disabled={!chosen || busy || phase === "staged"} onClick={stage}>
                  {phase === "staging" ? "Sending…" : phase === "staged" ? "Sent" : "Send to press queue"}
                </button>
              </div>
              {staged && (
                <div className="done">
                  <b>{staged.mode === "dropbox" ? "On its way to the press." : "Demo: this is where it would go."}</b>
                  <div className="mono wrap">{staged.destination}</div>
                  {staged.sidecar && <div className="dim small">Job sheet: <span className="mono">{staged.sidecar.split("/").pop()}</span> (qty, customer, needs-by) saved beside it.</div>}
                  {staged.mode === "dropbox" && <div className="dim small">Dropbox desktop on the press PC syncs this folder within seconds. Open it in ColorPRINT from there.</div>}
                  {timing?.find != null && <div className="dim small">Lookup took {(timing.find / 1000).toFixed(1)}s.</div>}
                  <button className="ghost" onClick={reset}>Next traveler</button>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {jobs.length > 0 && (
        <section className="card">
          <h2>Sent this session</h2>
          <table><thead><tr><th>Time</th><th>WO</th><th>File</th><th>Press</th><th>Destination</th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.at + j.wo}><td>{new Date(j.at).toLocaleTimeString()}</td><td className="mono">{j.wo}</td><td className="mono">{j.file}</td><td>{j.machine}</td><td className="mono dim">{j.dest}{j.mode === "demo" ? " (demo)" : ""}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <footer className="ap-foot">Prototype. Reads the paper with vision; with NetSuite access the barcode alone fetches the work order and the camera is only needed for handwritten notes.</footer>
    </main>
  );
}

function Fact({ k, v, mono, big, wrap }: { k: string; v: string | null | undefined; mono?: boolean; big?: boolean; wrap?: boolean }) {
  return <div className={`fact ${big ? "big" : ""}`}><span>{k}</span><b className={`${mono ? "mono" : ""} ${wrap ? "wrap" : ""}`}>{v ?? <i className="dim">not read</i>}</b></div>;
}

const CSS = `
.ap{max-width:1180px;margin:0 auto;padding-block:28px 40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--ink-2)}
.ap h1{font-family:Epilogue,system-ui,sans-serif;font-size:44px;line-height:1;margin:4px 0 6px;color:var(--ink)}
.ap h2{font-family:Epilogue,system-ui,sans-serif;font-size:18px;margin:0 0 14px;color:var(--ink)}
.ap-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.ap-sub{margin:0;color:var(--muted);font-size:16px}
.ap-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px}
.ap-status{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pill{font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface-2)}
.pill.ok{border-color:rgba(23,201,122,.5);color:var(--good)} .pill.warn{border-color:rgba(245,166,35,.5);color:var(--warning)} .pill.off{color:var(--muted)}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:18px;min-width:0}
.grid-top{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;margin-bottom:16px}
@media (max-width:820px){.grid-top{grid-template-columns:1fr}.ap h1{font-size:34px}}
.ap button{font:inherit;font-weight:600;border-radius:10px;border:1px solid var(--border);background:var(--surface-3);color:var(--ink);padding:10px 14px;cursor:pointer}
.ap button.primary{background:var(--accent);color:var(--accent-ink);border-color:transparent;font-size:18px;padding:14px 20px}
.ap button:disabled{opacity:.45;cursor:default}
.ap button.ghost{background:transparent} .ap button.link{background:none;border:0;padding:0;color:var(--accent);text-decoration:underline;font-weight:500}
.ap input,.ap select{font:inherit;width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink)}
.ap input:focus,.ap select:focus,.ap button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.barcode input{font-size:18px}
.or{text-align:center;color:var(--muted);font-size:13px;margin:12px 0}
.drop{display:flex;align-items:center;justify-content:center;text-align:center;min-height:200px;border:2px dashed rgba(0,200,232,.45);border-radius:14px;cursor:pointer;padding:12px;background:var(--surface-2);overflow:hidden}
.drop.busy{opacity:.6;cursor:progress} .drop img{max-height:360px;max-width:100%;border-radius:8px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px} .row.small button{font-size:13px;padding:8px 10px}
.progress{margin-top:12px;color:var(--accent);font-weight:600;animation:pulse 1.2s infinite} @keyframes pulse{50%{opacity:.5}} @media (prefers-reduced-motion:reduce){.progress{animation:none}}
.err{margin-top:12px;color:var(--critical);font-size:14px} .okline{color:var(--good);font-size:13px} .warn-line{color:var(--warning);font-size:13px;margin-top:8px}
.muted{color:var(--muted)} .dim{color:var(--muted)} .small{font-size:13px} .mono{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.92em} .wrap{overflow-wrap:anywhere}
.facts{display:grid;gap:8px} .fact{display:grid;grid-template-columns:130px minmax(0,1fr);gap:10px;align-items:baseline;font-size:15px} .fact span{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em} .fact b{font-weight:500;color:var(--ink);min-width:0}
.fact.big b{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.wo{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:4px} .wo span{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:12px} .wo b{font-size:36px;font-family:"IBM Plex Mono",monospace;color:var(--accent);font-variant-numeric:tabular-nums}
.conf{margin-top:8px;font-size:12px;color:var(--muted)} .notes{margin:6px 0 0;padding-left:18px;color:var(--warning);font-size:13px}
.art{margin-bottom:16px} .artgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:18px} @media (max-width:820px){.artgrid{grid-template-columns:1fr}}
.preview{background:#fff;border-radius:12px;min-height:260px;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden} .preview img{max-width:100%;max-height:420px} .pdf{color:#0b1020;font-weight:600}
.noprev{text-align:center;color:#334} .noprev .ext{font-family:"IBM Plex Mono",monospace;font-size:56px;font-weight:700;color:#0b1020}
.chosen .name{font-size:22px;font-weight:700;color:var(--ink);overflow-wrap:anywhere} .chosen .path{color:var(--muted);font-size:13px;overflow-wrap:anywhere;margin-top:4px} .chosen .meta{font-size:13px;color:var(--muted);margin-top:4px}
.reasons{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px} .tag{font-size:12px;padding:3px 8px;border-radius:999px;background:var(--surface-3);border:1px solid var(--border)}
.cands{margin-top:12px;font-size:14px} .cands summary{cursor:pointer;color:var(--accent)} .cands ul{margin:8px 0 0;padding-left:18px} .cands li{margin:4px 0;overflow-wrap:anywhere}
.send{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;margin-top:18px} @media (max-width:520px){.send{grid-template-columns:1fr}} .send label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;display:grid;gap:6px}
.done{margin-top:14px;padding:14px;border-radius:12px;background:rgba(23,201,122,.08);border:1px solid rgba(23,201,122,.35);display:grid;gap:6px} .done b{color:var(--good);font-size:16px} .done button{justify-self:start;margin-top:4px}
.settings label{display:grid;gap:6px;margin-bottom:14px;font-size:14px;color:var(--ink-2)} .settings small{color:var(--muted);font-size:12px}
.mapgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px} .maprow{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:8px;margin:0}
.ap table{width:100%;border-collapse:collapse;font-size:13px} .ap th{text-align:left;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--border)} .ap td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
.ap-foot{margin-top:20px;font-size:12px;color:var(--muted)}
`;
