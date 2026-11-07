// Tastatura: meni i korpa (ladice) i cijeli ekran galerije.
//   - zatvorena ladica nije dostupna tasterom Tab
//   - otvaranje fokusira dugme Zatvori, Tab i Shift+Tab ostaju u ladici
//   - Escape, dugme Zatvori i dodir na pozadinu vraćaju fokus na dugme koje je otvorilo
//   - cijeli ekran galerije radi kao i prije (Tab u sloju, Escape vraća na dugme)
//
// Pokretanje (Playwright mora biti dostupan, kao za tests/overflow.mjs):
//   node build/build.mjs --seed
//   node tests/tastatura.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { serve } from "./overflow.mjs";

let playwright;
try { playwright = createRequire(import.meta.url)("playwright"); }
catch { console.error("Playwright nije dostupan (npr. globalno instaliran Playwright s Chromiumom)."); process.exit(2); }
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!fs.existsSync(path.join(dist, "index.html"))) { console.error("Nema dist/. Prvo: node build/build.mjs --seed"); process.exit(2); }

let failed = 0;
const ok = (c, msg) => { console.log((c ? "PROŠLO " : "PALO ") + msg); if (!c) failed++; };
const server = await serve(dist);
const base = `http://localhost:${server.address().port}`;
const browser = await playwright.chromium.launch();

// sorta s galerijom (najviše slika) iz kataloga
const html = await (await fetch(base + "/sorte/")).text();
const cards = [...new Set([...html.matchAll(/href="(\/sorte\/[^"]+\/)"/g)].map((m) => m[1]))];
let gallery = null, most = 0;
for (const p of cards) { const n = ((await (await fetch(base + p)).text()).match(/class="slide\b/g) || []).length; if (n > most) { most = n; gallery = p; } }

const active = (pg) => pg.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute("aria-label") || a.textContent.trim().slice(0, 20)) : ""; });
const inside = (pg, sel) => pg.evaluate((s) => !!document.activeElement.closest(s), sel);

for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const pg = await ctx.newPage(); const errors = [];
  pg.on("pageerror", (e) => errors.push(e.message));
  for (const p of ["/", gallery]) {
    const L = `@${width} ${p}`;
    await pg.goto(base + p, { waitUntil: "networkidle" });
    // 1. zatvorene ladice: Tab ih preskače
    let hit = "";
    for (let i = 0; i < 70 && !hit; i++) { await pg.keyboard.press("Tab"); if (await inside(pg, "#drawer,#cart")) hit = await active(pg); }
    ok(!hit, `${L}: Tab ne ulazi u zatvoren meni ni korpu${hit ? " (ušao: " + hit + ")" : ""}`);

    for (const [btn, box, close] of [["#menuBtn", "#drawer", "closeMenu"], ["#cartBtn", "#cart", "cartClose"]]) {
      const name = box === "#drawer" ? "meni" : "korpa";
      await pg.focus(btn); await pg.keyboard.press("Enter"); await pg.waitForTimeout(350);
      ok(await active(pg) === close, `${L} ${name}: otvaranje fokusira dugme Zatvori (${await active(pg)})`);
      let out = 0; for (let i = 0; i < 25; i++) { await pg.keyboard.press("Tab"); if (!(await inside(pg, box))) out++; }
      ok(out === 0, `${L} ${name}: 25 × Tab ostaje u ladici`);
      await pg.focus("#" + close); await pg.keyboard.press("Shift+Tab");
      ok(await inside(pg, box), `${L} ${name}: Shift+Tab s prvog ide na zadnji element ladice (${await active(pg)})`);
      await pg.keyboard.press("Escape"); await pg.waitForTimeout(350);
      ok(await active(pg) === btn.slice(1), `${L} ${name}: Escape vraća fokus na ${btn} (${await active(pg)})`);
      ok(await pg.evaluate((s) => getComputedStyle(document.querySelector(s)).visibility === "hidden", box), `${L} ${name}: poslije zatvaranja sakrivena (visibility: hidden)`);
      // dugme Zatvori i pozadina
      await pg.click(btn); await pg.waitForTimeout(350); await pg.click("#" + close); await pg.waitForTimeout(350);
      ok(await active(pg) === btn.slice(1), `${L} ${name}: dugme Zatvori vraća fokus na ${btn}`);
      await pg.click(btn); await pg.waitForTimeout(350);
      if (await pg.evaluate((s) => document.querySelector(s).getBoundingClientRect().width >= innerWidth - 1, box)) { console.log(`- ${L} ${name}: ladica pokriva cijeli ekran, nema pozadine za dodir`); await pg.keyboard.press("Escape"); await pg.waitForTimeout(350); continue; }
      await pg.mouse.click(box === "#drawer" ? width - 5 : 5, 400); await pg.waitForTimeout(350);
      ok(await active(pg) === btn.slice(1) && !(await pg.evaluate((s) => document.querySelector(s).classList.contains("open"), box)), `${L} ${name}: dodir na pozadinu zatvara i vraća fokus`);
    }
  }
  // traka pri dnu na stranici sorte: s punom korpom otvara korpu, zatvaranje vraća fokus na traku
  await pg.goto(base + gallery, { waitUntil: "networkidle" });
  await pg.evaluate((id) => localStorage.setItem("vp-cart-v1", JSON.stringify([{ id, kind: "sapling", qty: 1 }])), gallery.split("/")[2]);
  await pg.reload({ waitUntil: "networkidle" });
  if (await pg.isVisible("#barUpit")) {
    await pg.focus("#barUpit"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(350);
    ok(await active(pg) === "cartClose", `@${width} traka "Pošalji narudžbu": korpa otvorena, fokus na Zatvori`);
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(350);
    ok(await active(pg) === "barUpit", `@${width} traka: Escape vraća fokus na dugme u traci (${await active(pg)})`);
  } else console.log(`- @${width}: traka pri dnu nije vidljiva na ovoj širini, preskočeno`);
  await pg.evaluate(() => localStorage.clear());

  // cijeli ekran galerije: kao i prije
  await pg.goto(base + gallery, { waitUntil: "networkidle" });
  await pg.focus("#gFull"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(400);
  let out = 0; for (let i = 0; i < 6; i++) { await pg.keyboard.press("Tab"); if (!(await inside(pg, ".lb"))) out++; }
  ok(out === 0, `@${width} cijeli ekran: Tab ostaje u sloju`);
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(350);
  ok(await active(pg) === "gFull" && !(await pg.$(".lb")), `@${width} cijeli ekran: Escape zatvara i vraća fokus na dugme`);
  ok(!errors.length, `@${width}: bez JS grešaka` + (errors.length ? ": " + errors.join(" | ") : ""));
  await ctx.close();
}
await browser.close(); server.close();
console.log(failed ? `\n${failed} palo` : "\nsve prošlo");
process.exit(failed ? 1 : 0);
