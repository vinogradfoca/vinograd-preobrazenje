// Pokretanje: node tests/changes.test.mjs (poslije node build/build.mjs --seed, zbog dist/panel/)
// Snimak objavljenog stanja i poređenje za "Šta čeka objavu" (panel/changes.js).
import fs from "node:fs";
import { snapshot, varietySnapshot, changedVarietyFields, changedSectionFields, SECTIONS, whenText } from "../panel/changes.js";
import { toFirebaseShape } from "../build/firebase-shape.mjs";
const ok = (c, m) => { console.log((c ? "PROŠLO" : "PALO  ") + " " + m); if (!c) process.exitCode = 1; };
const clone = (x) => JSON.parse(JSON.stringify(x));

const seed = JSON.parse(fs.readFileSync(new URL("../data/seed.json", import.meta.url), "utf8")).vinograd;
const data = toFirebaseShape(seed);
const snap = snapshot(data);
ok(Object.keys(snap.varieties).length === Object.keys(data.varieties).length, `snimak ima sve sorte (${Object.keys(snap.varieties).length})`);
ok(SECTIONS.every((s) => snap.sections[s.id]), "snimak ima sve odjeljke: " + SECTIONS.map((s) => s.id).join(", "));

// isti podaci: nijedna razlika
const allSame = Object.entries(data.varieties).every(([k, v]) => changedVarietyFields(snap.varieties[k], v).length === 0)
  && SECTIONS.every((s) => changedSectionFields(snap.sections[s.id], data, s).length === 0);
ok(allSame, "isti podaci → nijedno promijenjeno polje");

// snimak iz builda (dist/panel/objavljeno.json) i mock podaci panela se slažu
const distSnap = new URL("../dist/panel/objavljeno.json", import.meta.url), distMock = new URL("../dist/panel/mock-data.json", import.meta.url);
if (fs.existsSync(distSnap) && fs.existsSync(distMock)) {
  const s2 = JSON.parse(fs.readFileSync(distSnap, "utf8")), mock = JSON.parse(fs.readFileSync(distMock, "utf8"));
  const diffs = Object.entries(mock.varieties).filter(([k, v]) => changedVarietyFields(s2.varieties[k], v).length).map(([k]) => k);
  ok(!diffs.length && SECTIONS.every((s) => !changedSectionFields(s2.sections[s.id], mock, s).length), "dist: objavljeno.json i mock-data.json bez lažnih razlika" + (diffs.length ? ": " + diffs.slice(0, 5) : ""));
  ok(typeof s2.builtAt === "string", "dist: objavljeno.json ima builtAt");
} else console.log("PRESKOČENO dist/panel nije izgrađen");

// promjene po polju
const v0 = data.varieties.viktor;
const ch = (mut) => { const v = clone(v0); mut(v); return changedVarietyFields(snap.varieties.viktor, v); };
ok(JSON.stringify(ch((v) => { v.sapling = { ...(v.sapling || {}), price: 12.5 }; })) === '["cijena sadnice"]', "cijena sadnice → " + ch((v) => { v.sapling = { ...(v.sapling || {}), price: 12.5 }; }));
ok(JSON.stringify(ch((v) => { v.cutting = { ...(v.cutting || {}), qty: 0 }; })) === '["količina reznica"]', "količina reznica");
ok(JSON.stringify(ch((v) => { v.desc = "Novi opis"; v.visible = false; })) === '["vidljivost na sajtu","opis"]', "opis + skrivanje → " + ch((v) => { v.desc = "Novi opis"; v.visible = false; }));
ok(JSON.stringify(ch((v) => { v.facts = { ...(v.facts || {}), frost: "−25 °C" }; })) === '["otpornost na mraz"]', "osobina (mraz)");
ok(JSON.stringify(ch((v) => { v.images = [...v.images].reverse(); })) === '["slike"]', "redoslijed slika");
ok(JSON.stringify(ch((v) => { v.sapling = { ...(v.sapling || {}), enabled: false }; })) === '["prodaja sadnica"]', "isključena prodaja sadnica");

// Firebase oblik: niz kao objekat, null i prazno nisu promjena
const fb = clone(v0); fb.images = Object.fromEntries(v0.images.map((x, i) => [String(i), x])); fb.flaws = ""; fb.seoTitle = null;
ok(changedVarietyFields(snap.varieties.viktor, fb).length === 0, "niz slika kao objekat {0:…}, prazno i null → bez promjene");
const noKinds = clone(data.varieties.viking); delete noKinds.sapling; delete noKinds.cutting;
const prevNoKinds = varietySnapshot({ ...clone(data.varieties.viking), sapling: { enabled: true }, cutting: { enabled: true } });
ok(changedVarietyFields(prevNoKinds, noKinds).length === 0, "sapling/cutting bez polja = uključeno, bez cijene i količine");
ok(changedVarietyFields(undefined, v0).length === 0, "bez snimka → prazan niz (piše se samo \"izmijenjena\")");

// odjeljci
const d2 = clone(data); d2.settings.phone = "065/111-222"; d2.settings.showWithoutImage = false;
const sSet = SECTIONS.find((s) => s.id === "settings");
ok(JSON.stringify(changedSectionFields(snap.sections.settings, d2, sSet)) === '["telefon","prikaz sorti bez slike"]', "podešavanja → " + changedSectionFields(snap.sections.settings, d2, sSet));
const d3 = clone(data); d3.pages.kako.steps[0].text = "Drugi tekst"; d3.pages.kako.updatedAt = 123;
ok(JSON.stringify(changedSectionFields(snap.sections.kako, d3, SECTIONS.find((s) => s.id === "kako"))) === '["koraci"]', "Kako naručiti: koraci (updatedAt se ne broji)");

// vrijeme
const now = new Date(2026, 10, 4, 18, 0).getTime();
ok(whenText(new Date(2026, 10, 4, 14, 32).getTime(), now) === "danas 14:32", "danas 14:32");
ok(whenText(new Date(2026, 10, 3, 9, 5).getTime(), now) === "jučer 9:05", "jučer 9:05");
ok(whenText(new Date(2026, 9, 28, 7, 0).getTime(), now) === "28. 10. u 7:00", "28. 10. u 7:00");
ok(whenText(new Date(2025, 11, 31, 23, 59).getTime(), now) === "31. 12. 2025. u 23:59", "31. 12. 2025. u 23:59");
ok(whenText(undefined, now) === "", "bez vremena → prazno");
