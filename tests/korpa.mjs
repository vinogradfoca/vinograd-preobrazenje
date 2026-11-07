// Korpa (assets/shop.js): oštećen localStorage i stanje manje od količine u korpi.
//
// Pokretanje (Playwright mora biti dostupan, kao za tests/overflow.mjs):
//   node build/build.mjs --seed
//   node tests/korpa.mjs
// Podaci za korpu se u testu podmetnu: sorta viktor (sadnica) ima stanje 3.
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
const KEY = "vp-cart-v1";

const server = await serve(dist);
const base = `http://localhost:${server.address().port}`;
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
// podaci za korpu: viktor sadnica stanje 3, reznica isključena
await ctx.route(/\/assets\/korpa\.[0-9a-f]+\.json$/, async (route) => {
  const res = await route.fetch(); const list = await res.json();
  for (const x of list) if (x.id === "viktor") { x.sapling = { ...x.sapling, enabled: true, qty: 3 }; x.cutting = { ...x.cutting, enabled: false }; }
  await route.fulfill({ response: res, json: list });
});
const pg = await ctx.newPage();
pg.on("pageerror", (e) => errors.push(e.message));
await pg.goto(base + "/", { waitUntil: "networkidle" });

const bad = [
  { id: "viktor", kind: "sapling", qty: 10 },   // ispravna, ali više od stanja (3)
  { id: "viking", kind: "sapling", qty: "5" },  // količina kao tekst
  { id: "viking", kind: "cutting", qty: 2.5 },  // nije cijeli broj
  { id: "nizina", kind: "sapling", qty: 1e9 },  // prevelika
  { id: 42, kind: "sapling", qty: 1 },          // id nije tekst
  { id: "viking", kind: "toString", qty: 1 },   // nepoznata vrsta
  { id: "viktor", kind: "cutting", qty: 1 },    // vrsta se ne može naručiti
  null,
  { id: "nizina", kind: "sapling", qty: 2 },    // ispravna, stanje "na upit"
];
await pg.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY, bad]);
await pg.reload({ waitUntil: "networkidle" });
await pg.waitForTimeout(300);
let saved = await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
ok(JSON.stringify(saved) === JSON.stringify([{ id: "viktor", kind: "sapling", qty: 3 }, { id: "nizina", kind: "sapling", qty: 2 }]),
  "oštećene stavke izbačene, viktor smanjen na stanje 3: " + JSON.stringify(saved));
ok(await pg.textContent("#cartCount") === "5", `brojač u zaglavlju: ${await pg.textContent("#cartCount")}`);

// + ne prelazi stanje
await pg.click("#cartBtn"); await pg.waitForTimeout(350);
await pg.click('#cartItems [data-id="viktor"][data-q="1"]');
saved = await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
ok(saved[0].qty === 3, `dugme + ne prelazi stanje (${saved[0].qty})`);

// storage događaj iz druge kartice: ista provjera
await pg.evaluate((k) => {
  const v = JSON.stringify([{ id: "viktor", kind: "sapling", qty: 7 }, { id: "nizina", kind: "sapling", qty: "3" }, { id: 5, kind: "sapling", qty: 1 }, { id: "nizina", kind: "cutting", qty: 10000 }]);
  localStorage.setItem(k, v);
  window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v }));
}, KEY);
await pg.waitForTimeout(200);
saved = await pg.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
ok(JSON.stringify(saved) === JSON.stringify([{ id: "viktor", kind: "sapling", qty: 3 }]), "storage događaj: loše stavke izbačene, viktor 7 → 3: " + JSON.stringify(saved));
ok(await pg.textContent("#cartCount") === "3", `brojač poslije storage događaja: ${await pg.textContent("#cartCount")}`);

// nije niz / nije JSON
for (const raw of ['{"id":"viktor"}', "nije json"]) {
  await pg.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, raw]);
  await pg.reload({ waitUntil: "networkidle" });
  ok(await pg.textContent("#cartCount") === "0", `localStorage ${JSON.stringify(raw)} → prazna korpa`);
}

ok(!errors.length, "bez JS grešaka" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close(); server.close();
console.log(failed ? `\n${failed} palo` : "\nsve prošlo");
process.exit(failed ? 1 : 0);
