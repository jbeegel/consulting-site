// Copies the Spread Hunter dashboard (single source of truth in tools/auction-arbitrage) into public/
// so Next serves it at /spread, pointing it at the Vercel API. Runs automatically before `next build`.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const src = "tools/auction-arbitrage/arb/static/index.html";
let html = readFileSync(src, "utf8");
html = html.replace("<title>Spread Hunter</title>", "<title>Spread Hunter</title>\n<script>window.__ARB_API__='/api/spread';</script>");
mkdirSync("public/spread", { recursive: true });
writeFileSync("public/spread/index.html", html);
console.log("synced", src, "-> public/spread/index.html");
