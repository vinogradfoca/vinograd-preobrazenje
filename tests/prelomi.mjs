// Neprelomljive cjeline, kartice koraka "Kako naručiti" i podnožje u redovima.
//
// Test pravi privremenu kopiju sajta s test-podacima (broj telefona u tekstu koraka "Kako naručiti",
// u lokalnom i međunarodnom obliku), izgradi je (--seed) i provjeri na 320, 360, 390, 412 i 1280 px:
//   (a) nijedan vidljiv .nowrap element nije u više redova (getClientRects().length === 1 i jedan red teksta)
//   (b) nijedan element van ekrana i bez vodoravnog skrola (ista provjera kao tests/overflow.mjs)
//   (c) kartice koraka: 3 kruga s brojevima 1, 2, 3 iz CSS brojača
//   (d) podnožje: naziv, adresa, red telefon + mejl, red dodatnih stranica; linkovi najmanje 44 px;
//       traka Pozovi/WhatsApp ne prekriva podnožje
//   (e) telefon iz teksta u bazi je u <span class="nowrap"> i u jednom redu
//   (f) bez JS grešaka; dugmad i linkovi (osim linkova u rečenici) najmanje 44 px
// Podaci u repou (data/seed.json) se ne mijenjaju.
//
// Pokretanje (Playwright mora biti dostupan, kao za tests/overflow.mjs):
//   node tests/prelomi.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve, findOverflow } from "./overflow.mjs";

let playwright;
try { playwright = createRequire(import.meta.url)("playwright"); }
catch { console.error("Playwright nije dostupan (npr. globalno instaliran Playwright s Chromiumom)."); process.exit(2); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PHONE = "065/592-120", INTL = "+387 65 592 120";
let failed = 0, passed = 0;
const ok = (c, msg) => { if (c) passed++; else { failed++; console.log("PALO " + msg); } };

// ---- privremena kopija s test-podacima
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vp-prelomi-"));
for (const d of ["assets", "build", "data", "docs", "panel", "templates"]) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
for (const f of ["_headers", "firebase-config.json"]) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
const seedPath = path.join(tmp, "data", "seed.json");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
const steps = seed.vinograd.pages.kako.steps;
steps[1].text += ` Ako zapne, pozovite ${PHONE}.`;
steps[2].text += ` Iz inostranstva: ${INTL}.`;
fs.writeFileSync(seedPath, JSON.stringify(seed));
execFileSync(process.execPath, ["build/build.mjs", "--seed"], { cwd: tmp, stdio: "ignore" });
const dist = path.join(tmp, "dist");

// sve vrste stranica: osnovne, dodatne, sorta s galerijom, sorta bez slike, 404
const server = await serve(dist);
const base = `http://localhost:${server.address().port}`;
const cat = await (await fetch(base + "/sorte/")).text();
const varieties = [...new Set([...cat.matchAll(/href="(\/sorte\/[^"]+\/)"/g)].map((m) => m[1]))];
let withImg = null, noImg = null;
for (const p of varieties) {
  const h = await (await fetch(base + p)).text();
  if (!withImg && /class="slide\b/.test(h)) withImg = p;
  if (!noImg && /class="noimg big/.test(h)) noImg = p;
  if (withImg && noImg) break;
}
const PAGES = ["/", "/sorte/", "/cjenovnik/", "/kako-naruciti/", "/kontakt/", "/zastita-vinove-loze/", "/vinjak/", withImg, noImg, "/404.html"].filter(Boolean);

const browser = await playwright.chromium.launch();
for (const width of [320, 360, 390, 412, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 721, hasTouch: width < 721 });
  for (const p of PAGES) {
    const L = `@${width} ${p}`;
    const pg = await ctx.newPage(); const errors = [];
    pg.on("pageerror", (e) => errors.push(e.message));
    pg.on("console", (m) => { if (m.type() === "error" && !/404 \(Not Found\)/.test(m.text())) errors.push(m.text()); });
    await pg.goto(base + p, { waitUntil: "networkidle" });
    await pg.evaluate(() => { document.documentElement.style.scrollBehavior = "auto"; });

    // (a) .nowrap u jednom redu; i u otvorenom meniju i korpi
    for (const state of ["zatvoreno", "meni", "korpa"]) {
      if (state !== "zatvoreno") { await pg.click(state === "meni" ? "#menuBtn" : "#cartBtn"); await pg.waitForTimeout(350); }
      const multi = await pg.evaluate(() => [...document.querySelectorAll(".nowrap")].filter((e) => {
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || !e.getClientRects().length || e.closest("[hidden]")) return false;
        const r = document.createRange(); r.selectNodeContents(e);
        const lines = new Set([...r.getClientRects()].filter((x) => x.width > 0.5).map((x) => Math.round(x.top + x.height / 2))).size;
        return e.getClientRects().length !== 1 || lines > 1;
      }).map((e) => `${e.tagName.toLowerCase()} "${e.textContent.trim()}"`));
      ok(!multi.length, `${L} (${state}): .nowrap u više redova: ${multi.join(", ")}`);
      // (b) van ekrana
      const out = await pg.evaluate(findOverflow);
      const sx = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      ok(!out.length && !sx, `${L} (${state}): van ekrana ${JSON.stringify(out.slice(0, 3))}${sx ? ", vodoravni skrol" : ""}`);
      if (state !== "zatvoreno") { await pg.keyboard.press("Escape"); await pg.waitForTimeout(350); }
    }

    // (d) podnožje
    const f = await pg.evaluate(() => {
      const ft = document.querySelector("footer");
      const kids = [...ft.children].map((c) => c.className);
      const links = [...ft.querySelectorAll("a")].map((a) => ({ t: a.textContent.trim(), h: Math.round(a.getBoundingClientRect().height), href: a.getAttribute("href"), nowrap: a.classList.contains("nowrap"), u: getComputedStyle(a).textDecorationLine, c: getComputedStyle(a).color }));
      const fc = ft.getBoundingClientRect(), mid = fc.left + fc.width / 2;
      const rows = [...ft.children].map((c) => { const r = c.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(c); const rs = [...rg.getClientRects()].filter((x) => x.width > 0.5); const l = Math.min(...rs.map((x) => x.left)), rr = Math.max(...rs.map((x) => x.right)); return Math.abs((l + rr) / 2 - mid); });
      const nm = ft.querySelector(".fname"), ncs = getComputedStyle(nm);
      window.scrollTo(0, document.documentElement.scrollHeight);
      const cbar = document.querySelector("#cbar"), cb = cbar && getComputedStyle(cbar).display !== "none" ? cbar.getBoundingClientRect().top : innerHeight;
      return { kids, links, offCenter: Math.max(...rows), name: { font: ncs.fontFamily, size: ncs.fontSize, color: ncs.color, ws: ncs.whiteSpace }, covered: ft.getBoundingClientRect().bottom - cb };
    });
    ok(f.kids.join("|") === "fname nowrap|faddr nowrap|frow fcontact|frow fnav", `${L} podnožje: redovi ${f.kids.join("|")}`);
    // ispod 360 px .nowrap ima rezervu (white-space: normal, prelom samo kad ne stane); jedan red provjerava (a)
    ok(/^Georgia/.test(f.name.font) && f.name.size === "17px" && f.name.color === "rgb(255, 255, 255)" && (f.name.ws === "nowrap" || width < 360), `${L} podnožje: naziv ${JSON.stringify(f.name)}`);
    ok(f.links.length === 4 && /^tel:/.test(f.links[0].href) && /^mailto:/.test(f.links[1].href), `${L} podnožje: telefon, mejl, pa dvije dodatne stranice (${f.links.map((l) => l.t).join(", ")})`);
    ok(f.links.every((l) => l.h >= 44 && l.nowrap && l.u === "underline" && l.c === "rgb(255, 255, 255)"), `${L} podnožje: linkovi 44 px, nowrap, podvučeni, bijeli ${JSON.stringify(f.links)}`);
    ok(f.offCenter <= 2, `${L} podnožje: redovi centrirani (odstupanje ${f.offCenter.toFixed(1)} px)`);
    ok(f.covered <= 0.5, `${L} podnožje: traka pri dnu prekriva ${f.covered.toFixed(0)} px`);

    // (f) dugmad i linkovi najmanje 44 px (linkovi u rečenici su izuzetak), JS greške
    const small = await pg.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,summary,textarea")].filter((el) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || cs.visibility === "hidden" || el.closest("#drawer:not(.open),#cart:not(.open),[hidden]")) return false;
      if (el.tagName === "A" && /^inline(-block)?$/.test(cs.display) && el.closest("p,li")) return false; // link u rečenici
      return r.height < 44 - 0.5 || r.width < 44 - 0.5;
    }).map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 25)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`));
    ok(!small.length, `${L}: manje od 44 px: ${small.join(", ")}`);
    ok(!errors.length, `${L}: JS greške: ${errors.join(" | ")}`);

    if (p === "/kako-naruciti/") {
      // (c) kartice koraka i brojevi iz CSS brojača (čitač pristupačnosti vidi tekst ::before)
      const c = await pg.evaluate(() => {
        const ol = document.querySelector("ol.how"), lis = [...ol.querySelectorAll(":scope > li")];
        return {
          n: lis.length, reset: getComputedStyle(ol).counterReset,
          inc: lis.map((li) => getComputedStyle(li).counterIncrement),
          before: lis.map((li) => { const b = getComputedStyle(li, "::before"); return [b.content, b.width, b.height, b.backgroundColor, b.color, b.fontWeight, b.fontSize, b.borderRadius].join(" "); }),
          card: lis.map((li) => { const s = getComputedStyle(li); return [s.borderTopWidth, s.borderTopColor, s.borderRadius, s.backgroundColor, s.paddingTop].join(" "); }),
          gap: lis.length > 1 ? Math.round(lis[1].getBoundingClientRect().top - lis[0].getBoundingClientRect().bottom) : 0,
          text: lis.map((li) => li.textContent).join(" "),
          title: lis.map((li) => { const t = getComputedStyle(li.querySelector(".how-t")); return t.fontSize + " " + t.fontWeight; }),
          desc: lis.map((li) => { const t = getComputedStyle(li.querySelector("p")); return t.fontSize + " " + t.lineHeight; }),
          maxW: Math.round(ol.getBoundingClientRect().width),
        };
      });
      ok(c.n === 3 && /korak 0/.test(c.reset) && c.inc.every((x) => x === "korak 1"), `${L} (c) ol s brojačem: ${c.n} koraka, ${c.reset}, ${c.inc.join(", ")}`);
      ok(c.before.every((b) => b === "counter(korak) 34px 34px rgb(232, 200, 142) rgb(25, 61, 43) 500 15px 50%"), `${L} (c) krugovi: ${c.before[0]}`);
      ok(c.card.every((x) => x === "1px rgb(214, 220, 214) 14px rgb(255, 255, 255) 14px") && c.gap === 10, `${L} (c) kartice: ${c.card[0]}, razmak ${c.gap} px`);
      ok(c.title.every((x) => x === "15px 500") && c.desc.every((x) => x === "14px 21px"), `${L} (c) naslov ${c.title[0]}, opis ${c.desc[0]}`);
      ok(!/\b[123]\s*Izaberite/.test(c.text), `${L} (c) broj nije ručno upisan u tekst`);
      ok(c.maxW <= 640, `${L} (c) kolona najviše 640 px (${c.maxW})`);
      // brojevi 1, 2, 3 kako ih vidi stablo pristupačnosti (tekst iz ::before)
      const cdp = await ctx.newCDPSession(pg);
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const byId = new Map(nodes.map((n) => [n.nodeId, n]));
      const howSteps = (await pg.evaluate(() => [...document.querySelectorAll("ol.how .how-t")].map((x) => x.textContent.trim())));
      const items = nodes.filter((n) => n.role && n.role.value === "listitem");
      // stavke liste čiji prvi tekst je broj, a odmah poslije dolazi naslov koraka
      const nums = [];
      for (const it of items) {
        const texts = []; const walk = (n) => { if (n.role && /StaticText/.test(n.role.value) && n.name && String(n.name.value).trim()) texts.push(String(n.name.value).trim()); for (const k of n.childIds || []) { const c = byId.get(k); if (c) walk(c); } };
        walk(it);
        if (howSteps.includes(texts[1])) nums.push(texts[0]);
      }
      ok(nums.join(",") === "1,2,3", `${L} (c) brojevi iz CSS brojača: ${nums.join(",") || "(nema)"}`);
      // (e) telefon iz teksta u bazi
      const e = await pg.evaluate(([a, b]) => [...document.querySelectorAll(".how p .nowrap")].map((s) => { const r = document.createRange(); r.selectNodeContents(s); return [s.textContent, s.getClientRects().length, new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size].join(" "); }), [PHONE, INTL]);
      ok(e.join("|") === `${PHONE} 1 1|${INTL} 1 1`, `${L} (e) telefon iz baze u jednom redu: ${e.join("|")}`);
    }
    await pg.close();
  }
  await ctx.close();
}
await browser.close(); server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} palo, ${passed} prošlo` : `\nsve prošlo (${passed} provjera, ${PAGES.length} stranica × 5 širina)`);
process.exit(failed ? 1 : 0);
