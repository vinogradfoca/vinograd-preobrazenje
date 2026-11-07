// Pokretanje: node tests/headers.test.mjs   (provjerava i dist/_headers ako postoji: prvo node build/build.mjs --seed)
// _headers za Cloudflare Pages: sigurnosna zaglavlja za sve stranice i za panel, keš za assets i slike.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ok = (c, m) => { console.log((c ? "PROŠLO" : "PALO  ") + " " + m); if (!c) process.exitCode = 1; };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Cloudflare oblik: red s putanjom, pa uvučeni redovi "Ime: vrijednost"; # je komentar
function parse(text) {
  const rules = [], errors = [];
  let cur = null;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    if (!/^\s/.test(line)) { cur = { path: line.trim(), h: {} }; rules.push(cur); return; }
    const m = /^\s+([A-Za-z0-9-]+):\s*(.+)$/.exec(line);
    if (!m || !cur) { errors.push(`red ${i + 1}: "${line.trim()}"`); return; }
    cur.h[m[1].toLowerCase()] = m[2].trim();
  });
  return { rules, errors };
}
// zaglavlja za adresu: sva pravila koja je pogađaju (Cloudflare ih spaja)
const match = (rules, url) => Object.assign({}, ...rules.filter((r) => new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(url)).map((r) => r.h));

function check(label, text) {
  const { rules, errors } = parse(text);
  ok(!errors.length, `${label}: ispravan oblik${errors.length ? " (" + errors.join("; ") + ")" : ""}`);
  for (const url of ["/", "/sorte/viktor/", "/panel/", "/assets/styles.abc.css"]) {
    const h = match(rules, url);
    ok(h["x-content-type-options"] === "nosniff", `${label} ${url}: X-Content-Type-Options: nosniff`);
    ok(h["referrer-policy"] === "strict-origin-when-cross-origin", `${label} ${url}: Referrer-Policy`);
  }
  const site = match(rules, "/sorte/viktor/");
  ok(!site["x-frame-options"] && !site["content-security-policy"] && !site["content-security-policy-report-only"], `${label}: javni sajt nema X-Frame-Options ni CSP (nije mijenjan)`);
  const p = match(rules, "/panel/");
  ok(p["x-robots-tag"] === "noindex", `${label} /panel/: X-Robots-Tag: noindex`);
  ok(p["x-frame-options"] === "DENY", `${label} /panel/: X-Frame-Options: DENY`);
  ok(!p["content-security-policy"], `${label} /panel/: nema blokirajućeg CSP-a (samo Report-Only)`);
  const csp = Object.fromEntries((p["content-security-policy-report-only"] || "").split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
  const want = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "https://www.gstatic.com"],
    "connect-src": ["'self'", "https://*.firebaseio.com", "wss://*.firebaseio.com", "https://*.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com"],
    "img-src": ["'self'", "blob:", "data:", "https://firebasestorage.googleapis.com"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "frame-ancestors": ["'none'"],
  };
  ok(JSON.stringify(csp) === JSON.stringify(want), `${label} /panel/: Content-Security-Policy-Report-Only kao što je dogovoreno`);
  ok(match(rules, "/panel/app.js")["x-frame-options"] === "DENY", `${label} /panel/app.js: ista zaglavlja panela`);
  ok(/immutable/.test(match(rules, "/assets/shop.abc.js")["cache-control"] || ""), `${label} /assets/*: immutable`);
  ok(/immutable/.test(match(rules, "/img/viktor-1.webp")["cache-control"] || ""), `${label} /img/*: immutable`);
  ok(match(rules, "/build.json")["cache-control"] === "no-cache", `${label} /build.json: no-cache`);
}

const src = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
check("_headers", src);
const dist = path.join(ROOT, "dist", "_headers");
if (fs.existsSync(dist)) ok(fs.readFileSync(dist, "utf8") === src, "dist/_headers je ista kopija kao _headers (build je kopira)");
else console.log("PRESKOČENO dist/_headers ne postoji (prvo node build/build.mjs --seed)");
