// Provjera izlaska iz ekrana: nijedan vidljiv element ne smije izaći van širine ekrana
// (left >= -1 i right <= innerWidth + 1). Izuzeci su samo namjerno skrolabilni kontejneri
// (overflow-x: auto ili scroll, npr. galerija, red sličica, široke tabele): sam kontejner se
// provjerava, a njegov sadržaj ne. Zatvoreni meni i zatvorena ladica korpe su van ekrana
// namjerno (pomjereni transformacijom), pa se preskaču; otvoreni se provjeravaju.
//
// Ovo hvata i odsječene elemente (overflow: hidden na roditelju), koje mjerenje vodoravnog
// skrola stranice ne vidi.
//
// Pokretanje (Playwright mora biti dostupan, npr. globalno instaliran; nije npm zavisnost repoa):
//   node build/build.mjs --seed
//   node tests/overflow.mjs                      služi dist/ na slobodnom portu i provjerava
//   node tests/overflow.mjs --url=http://localhost:8080   provjerava već pokrenut sajt
//   dodatno: --paths=/,/sorte/   --widths=360,390,412
// Izlaz: spisak elemenata van ekrana po stranici, širini i stanju ladice; kod 1 ako ih ima.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Ova funkcija se izvršava u pregledaču (page.evaluate); vraća elemente van ekrana.
export function findOverflow() {
  const W = window.innerWidth, out = [];
  const scrollable = (el) => { const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowX); };
  const skipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (scrollable(p)) return true;
    const off = el.closest("#drawer:not(.open), #cart:not(.open)");
    return !!off;
  };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    const t = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return t ? `${s} "${t}"` : s;
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("[hidden]") || ["SCRIPT", "STYLE", "TEMPLATE", "BR"].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (skipped(el)) continue;
    if (r.left < -1 || r.right > W + 1) out.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right), width: W });
  }
  // samo najviši element u lancu (dijete van ekrana zbog roditelja se ne ponavlja)
  return out;
}

export const DEFAULT_PATHS = ["/", "/sorte/", "/cjenovnik/", "/kako-naruciti/", "/kontakt/", "/zastita-vinove-loze/", "/vinjak/"];

// Provjera jedne stranice na jednoj širini, ladica korpe zatvorena i otvorena.
export async function checkPage(browser, url, width, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 721, hasTouch: width < 721 });
  const pg = await ctx.newPage(); const errors = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  const res = await pg.goto(url, { waitUntil: "networkidle" });
  const results = [];
  if (!res || res.status() >= 400) { await ctx.close(); return { missing: true, results, errors }; }
  if (opts.cartItem) {
    await pg.evaluate((it) => localStorage.setItem("vp-cart-v1", JSON.stringify([it])), opts.cartItem);
    await pg.reload({ waitUntil: "networkidle" });
  }
  await pg.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });
  results.push({ state: "ladica zatvorena", bad: await pg.evaluate(findOverflow) });
  const btn = await pg.$("#cartBtn");
  if (btn) {
    await btn.click(); await pg.waitForTimeout(450);
    results.push({ state: "ladica otvorena", bad: await pg.evaluate(findOverflow) });
  }
  await ctx.close();
  return { missing: false, results, errors };
}

// ---------------------------------------------------------------- pokretanje iz komandne linije
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");
  let playwright;
  try { playwright = createRequire(import.meta.url)("playwright"); }
  catch { console.error("Playwright nije dostupan (npr. globalno instaliran Playwright s Chromiumom)."); process.exit(2); }

  let base = arg("url"), server = null;
  if (!base) {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) { console.error("Nema dist/. Prvo: node build/build.mjs --seed"); process.exit(2); }
    server = await serve(dist); base = `http://localhost:${server.address().port}`;
  }
  base = base.replace(/\/+$/, "");
  const widths = (arg("widths") || "360,390,412").split(",").map(Number);
  let paths = arg("paths") ? arg("paths").split(",") : null;
  if (!paths) {
    // sve vrste stranica: osnovne + sorta s najviše slika i sorta s jednom slikom (iz kataloga)
    const html = await (await fetch(base + "/sorte/")).text();
    const cards = [...html.matchAll(/href="(\/sorte\/[^"]+\/)"/g)].map((m) => m[1]);
    paths = [...DEFAULT_PATHS];
    const counts = await Promise.all([...new Set(cards)].map(async (p) => [p, ((await (await fetch(base + p)).text()).match(/class="slide\b|data-src=/g) || []).length]));
    counts.sort((a, b) => b[1] - a[1]);
    if (counts.length) paths.push(counts[0][0]);
    const one = counts.find((c) => c[1] <= 1); if (one) paths.push(one[0]);
  }
  const browser = await playwright.chromium.launch();
  let bad = 0, checked = 0;
  for (const p of paths) for (const w of widths) {
    const r = await checkPage(browser, base + p, w, { cartItem: { id: "viktor", kind: "sapling", qty: 1 } });
    if (r.missing) { console.log(`- ${p} @${w}: stranica ne postoji, preskočena`); continue; }
    for (const x of r.results) {
      checked++;
      if (x.bad.length) { bad += x.bad.length; console.log(`✗ ${p} @${w} (${x.state}): ${x.bad.length} van ekrana`); x.bad.slice(0, 12).forEach((b) => console.log(`    ${b.el}  [${b.left}…${b.right} / ${b.width}]`)); }
      else console.log(`✓ ${p} @${w} (${x.state})`);
    }
    if (r.errors.length) { bad++; console.log(`✗ ${p} @${w}: JS greške: ${r.errors.join(" | ")}`); }
  }
  await browser.close(); if (server) server.close();
  console.log(bad ? `\nPALO: ${bad} elemenata van ekrana (provjereno ${checked} stanja)` : `\nPROŠLO: nijedan element van ekrana (provjereno ${checked} stanja)`);
  process.exit(bad ? 1 : 0);
}

// mali statički server za dist/ (čisti URL-ovi: /putanja/ → /putanja/index.html)
export function serve(dir) {
  const T = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname), f = path.join(dir, p);
      if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
      if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": T[".html"] }); return fs.createReadStream(path.join(dir, "404.html")).pipe(res); }
      res.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    }).listen(0, () => resolve(s));
  });
}
