// Pokretanje: node tests/match.test.mjs
// Testovi za panel/match.js sa stvarnim imenima fajlova i katalogom iz data/seed.json.
import fs from "node:fs";
import { matchFile, parseFileName, slugify, uniqueSlug, similarVarieties, levenshtein } from "../panel/match.js";

const seed = JSON.parse(fs.readFileSync(new URL("../data/seed.json", import.meta.url)));
const V = seed.vinograd.varieties;
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : fail++; console.log((c ? "PROŠLO " : "PALO   ") + msg); };
const name = (k) => (V[k] ? V[k].name : k);
const m = (f, vars = V) => matchFile(f, vars);
const show = (r) => `${r.status}${r.key ? " → " + name(r.key) : r.candidates.length ? " → " + r.candidates.map(name).join(" / ") : ""}${r.order != null ? " #" + r.order : ""}${r.web ? " (web)" : ""}`;
const expect = (f, status, key, extra = {}) => {
  const r = m(f);
  const good = r.status === status && (key === undefined || r.key === key) && Object.entries(extra).every(([k, v]) => r[k] === v);
  ok(good, `${f.padEnd(26)} ${show(r)}${good ? "" : `   (očekivano: ${status}${key ? " → " + name(key) : ""})`}`);
};

console.log("— stvarna imena fajlova");
expect("azalija-1.webp", "matched", "azalija", { order: 1 });
expect("bajkonur-2.webp", "matched", "bajkonur", { order: 2 });
expect("bijelo-otporno-1.webp", "matched", "bijelo-otporno", { order: 1 });
expect("black-grand-2.webp", "matched", "black-grand", { order: 2 });
expect("km-342-3.webp", "matched", "km-342", { order: 3 });
expect("podarok-ukrajine-2.webp", "matched", "podarok-ukrajine", { order: 2 });
expect("poslanik-signalni-1.webp", "suggest", "poslanik", { order: 1 });
expect("web-dikson.webp", "matched", "dikson", { web: true, order: null });
expect("web-nadezda-azos.webp", "matched", "nadezda-azos", { web: true });
expect("prima-parisa-1.webp", "matched", "prima-parisa");
expect("nizina-2.webp", "matched", "nizina", { order: 2 });
expect("gold-finger-3.webp", "matched", "gold-finger", { order: 3 });
expect("Ratatuj_1.JPG", "matched", "ratatuj", { order: 1 });
// rembo-1.webp: u katalogu postoji sorta "Rembo", pa je ovo tačno poklapanje (vidi opis PR-a)
expect("rembo-1.webp", "matched", "rembo", { order: 1 });
expect("korjanka-1.webp", "suggest", "kodrjanka");
expect("web_viking 2.png", "matched", "viking", { web: true, order: 2 });
expect("Šarada UA 3.jpeg", "matched", "sarada-ua", { order: 3 });
expect("v20.webp", "matched", "v20", { order: null });
expect("km-342.webp", "matched", "km-342", { order: null });
console.log("— izmišljena imena bez poklapanja");
expect("IMG_20250812_1432.jpg", "none");
expect("slika-sa-mora.webp", "none");
expect("zzzz-1.webp", "none");
expect("abc.png", "none");
console.log("— nejednoznačno (dvije sorte s istim normalizovanim imenom)");
const dup = { ...V, "viking-2": { name: "Viking", slug: "viking-2" } };
const r1 = m("viking-1.webp", dup);
ok(r1.status === "ambiguous" && r1.candidates.includes("viking") && r1.candidates.includes("viking-2") && !r1.key, `viking-1.webp (dva Vikinga) ${show(r1)}`);
const near = { a: { name: "Lora", slug: "lora" }, b: { name: "Dora", slug: "dora" } };
const r2 = m("kora-1.webp", near);
ok(r2.status === "ambiguous" && !r2.key, `kora-1.webp (Lora i Dora jednako blizu) ${show(r2)}`);
console.log("— parseFileName, slug, sličnost");
ok(JSON.stringify(parseFileName("web_Nadežda-Azos_12.WEBP")) === JSON.stringify({ base: "nadezdaazos", full: "nadezdaazos12", order: 12, web: true }), "parseFileName web_Nadežda-Azos_12.WEBP");
ok(slugify("Šarada Đ") === "sarada-dj", 'slugify("Šarada Đ") = sarada-dj');
ok(slugify("  Husein Kelin Barmak (Nevestini prsti) ") === "husein-kelin-barmak-nevestini-prsti", "slugify sa zagradama i razmacima");
ok(uniqueSlug("Viking", new Set(["viking", "viking-2"])) === "viking-3", "uniqueSlug daje viking-3");
ok(similarVarieties("Ratatui", V).map((x) => x.key).join(",") === "ratatuj,km-ratatui", "similarVarieties Ratatui → Ratatuj, KM Ratatui");
ok(levenshtein("korjanka", "kodrjanka") === 1, "levenshtein korjanka/kodrjanka = 1");
console.log(`\n${pass} prošlo, ${fail} palo`);
process.exit(fail ? 1 : 0);
