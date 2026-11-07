// Panel, probni režim (?mock=1): "Objavi" čeka upise u toku i ne objavljuje dok ima nesnimljenih izmjena.
//
// Pokretanje (Playwright mora biti dostupan, kao za tests/overflow.mjs):
//   node build/build.mjs --seed
//   node tests/panel-objavi.mjs
// Slučajevi:
//   1. upis padne (nema veze), Objavi, pa i ponovni pokušaj padne: piše "Prvo snimi izmjene", nema zapisa o objavi
//   2. "Pokušaj ponovo" kad veza radi: izmjena se snimi, PA se objava zapiše
//   3. odgođeno snimanje (dugme +) i odmah Objavi: količina je u bazi prije zapisa o objavi
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve } from "./overflow.mjs";

let playwright;
try { playwright = createRequire(import.meta.url)("playwright"); }
catch { console.error("Playwright nije dostupan (npr. globalno instaliran Playwright s Chromiumom)."); process.exit(2); }
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!fs.existsSync(path.join(dist, "panel", "index.html"))) { console.error("Nema dist/panel/. Prvo: node build/build.mjs --seed"); process.exit(2); }

let failed = 0;
const ok = (c, msg) => { console.log((c ? "PROŠLO " : "PALO ") + msg); if (!c) failed++; };

const server = await serve(dist);
const base = `http://localhost:${server.address().port}/panel/?mock=1`;
const browser = await playwright.chromium.launch();
const pg = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
pg.on("pageerror", (e) => errors.push(e.message));
await pg.goto(base, { waitUntil: "networkidle" });
await pg.waitForSelector("#nav:not([hidden])");

// indeksi zapisa: koji je upis bio prvi (izmjena sorte ili zapis o objavi)
const writes = () => pg.evaluate(() => window.panelMock.writes.map((w) => Object.keys(w)));
const firstIdx = (ws, re) => ws.findIndex((keys) => keys.some((k) => re.test(k)));

// ---- 1. upis padne, i ponovni pokušaj u Objavi padne
await pg.evaluate(() => { location.hash = "#/sorta/viktor"; });
await pg.waitForSelector("#f-desc", { state: "attached" });
await pg.evaluate(() => { document.querySelector("#f-desc").closest("details").open = true; window.panelMock.failNext = true; });
await pg.fill("#f-desc", "Probni opis za test objave.");
await pg.locator("#f-desc").blur();
await pg.waitForFunction(() => document.querySelector("#saveBar .bad"));
ok(true, "upis je pao i traka kaže \"Nije snimljeno\"");
await pg.evaluate(() => { location.hash = "#/objavi"; });
await pg.waitForSelector("#pubBtn");
await pg.evaluate(() => { window.panelMock.failNext = true; }); // i ponovni pokušaj u Objavi padne
await pg.click("#pubBtn");
await pg.waitForFunction(() => /Prvo snimi izmjene/.test((document.querySelector("#pubStatus") || {}).textContent || ""));
let ws = await writes();
ok(firstIdx(ws, /^publish\//) === -1, "objava NIJE pokrenuta (nema zapisa publish/…)");
ok(await pg.locator("#pubStatus [data-pub-retry]").isVisible(), "dugme \"Pokušaj ponovo\" je vidljivo");
const box = await pg.locator("#pubStatus [data-pub-retry]").boundingBox();
ok(box && box.height >= 44, `dugme je visoko najmanje 44 px (${box && Math.round(box.height)})`);
ok(!(await pg.locator("#pubBtn").isDisabled()), "dugme Objavi nije zaključano");

// ---- 2. Pokušaj ponovo, veza radi
await pg.click("#pubStatus [data-pub-retry]");
await pg.waitForFunction(() => /Objavljuje se/.test((document.querySelector("#pubStatus") || {}).textContent || ""));
await pg.waitForFunction((n) => window.panelMock.writes.slice(n).some((w) => Object.keys(w).some((k) => k.startsWith("publish/"))), 0);
ws = await writes();
const iDesc = firstIdx(ws, /^varieties\/viktor\/desc$/), iPub = firstIdx(ws, /^publish\//);
ok(iDesc >= 0 && iPub > iDesc, `izmjena snimljena (zapis ${iDesc}) prije objave (zapis ${iPub})`);
ok(await pg.evaluate(() => window.panelMock.data.varieties.viktor.desc === "Probni opis za test objave."), "opis je u bazi");
await pg.waitForFunction(() => /Objavljeno u/.test((document.querySelector("#pubStatus") || {}).textContent || ""), null, { timeout: 15000 });
ok(true, "probna izgradnja završena: \"Objavljeno u …\"");

// ---- 3. odgođeno snimanje (+) i odmah Objavi (prije 700 ms)
await pg.evaluate(() => { location.hash = "#/sorta/viktor"; });
await pg.waitForSelector('[data-step="1"]');
const before = await pg.evaluate(() => window.panelMock.writes.length);
const q0 = await pg.evaluate(() => { const s = window.panelMock.data.varieties.viktor.sapling || {}; return typeof s.qty === "number" ? s.qty : null; });
await pg.locator('[data-step="1"]').first().click();
await pg.evaluate(() => { location.hash = "#/objavi"; });
await pg.waitForSelector("#pubBtn");
// probna objava: pričekaj da prethodna završi i 30 s nije bitno u mocku
await pg.waitForFunction(() => !document.querySelector("#pubBtn").disabled);
await pg.click("#pubBtn");
await pg.waitForFunction(() => /Objavljuje se|Objavljeno u/.test((document.querySelector("#pubStatus") || {}).textContent || ""));
await pg.waitForFunction((n) => window.panelMock.writes.slice(n).some((w) => Object.keys(w).some((k) => k.startsWith("publish/"))), before);
ws = (await writes()).slice(before);
const iQty = firstIdx(ws, /^varieties\/viktor\/sapling\/qty$/), iPub2 = firstIdx(ws, /^publish\//);
ok(iQty >= 0 && iPub2 > iQty, `odgođena količina snimljena (zapis ${iQty}) prije objave (zapis ${iPub2})`);
const q1 = await pg.evaluate(() => window.panelMock.data.varieties.viktor.sapling.qty);
ok(q1 === (q0 == null ? 1 : q0 + 1), `količina u bazi ${q0} → ${q1}`);

ok(!errors.length, "bez JS grešaka" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(failed ? `\n${failed} palo` : "\nsve prošlo");
process.exit(failed ? 1 : 0);
