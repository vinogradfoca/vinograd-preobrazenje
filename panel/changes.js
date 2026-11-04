// Šta je promijenjeno od zadnje izgradnje sajta (ekran Objavi, "Šta čeka objavu").
// Baza čuva samo updatedAt i updatedBy, ne i koje polje je promijenjeno. Zato build pri svakoj
// izgradnji zapiše "snimak" objavljenih vrijednosti (dist/panel/objavljeno.json), a panel poredi
// trenutne podatke s tim snimkom. Ista funkcija pravi snimak u buildu i u panelu, iz sirovog
// oblika baze (kao što ga vraća Firebase), pa se poređenje ne zavara razlikom u obliku.
// Čiste funkcije bez DOM-a: testovi su u tests/changes.test.mjs.

// Firebase ne čuva null ni prazne nizove/objekte, a niz može vratiti kao objekat s ključevima "0", "1", …
const isObj = (v) => v !== null && typeof v === "object";
const asList = (v) => {
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (isObj(v)) return Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => v[k]).filter((x) => x != null);
  return [];
};
const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const numOrEmpty = (v) => (typeof v === "number" ? String(v) : "");
// stabilan zapis (ključevi poredani, prazno izbačeno)
function canon(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return JSON.stringify(v.map(canon).filter((x) => x !== ""));
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length && keys.every((k) => /^\d+$/.test(k))) return canon(asList(v));
    const o = {};
    for (const k of keys.sort()) { const c = canon(v[k]); if (c !== "" && c !== "[]" && c !== "{}") o[k] = c; }
    return Object.keys(o).length ? JSON.stringify(o) : "";
  }
  return String(v);
}

const FACTS = [
  ["origin", "porijeklo"], ["author", "autor"], ["maturity", "dani do zrenja"],
  ["clusterWeight", "težina grozda"], ["berryWeight", "težina bobice"], ["berrySize", "veličina bobice"],
  ["frost", "otpornost na mraz"], ["disease", "otpornost na bolesti"], ["taste", "ukus"],
];
const kindOf = (v, k) => (isObj(v[k]) ? v[k] : {});
// [oznaka, naziv za korisnika, vrijednost iz sirove sorte]
export const VARIETY_FIELDS = [
  ["name", "naziv", (v) => str(v.name)],
  ["slug", "adresa stranice", (v) => str(v.slug)],
  ["color", "boja", (v) => str(v.color)],
  ["ripen", "zrenje", (v) => str(v.ripen)],
  ["type", "vrsta", (v) => str(v.type)],
  ["visible", "vidljivost na sajtu", (v) => (v.visible === false ? "ne" : "da")],
  ["featured", "izdvajanje na početnoj", (v) => (v.featured === true ? "da" : "ne")],
  ["order", "redoslijed", (v) => numOrEmpty(v.order)],
  ["sapling.enabled", "prodaja sadnica", (v) => (kindOf(v, "sapling").enabled === false ? "ne" : "da")],
  ["sapling.price", "cijena sadnice", (v) => numOrEmpty(kindOf(v, "sapling").price)],
  ["sapling.qty", "količina sadnica", (v) => numOrEmpty(kindOf(v, "sapling").qty)],
  ["cutting.enabled", "prodaja reznica", (v) => (kindOf(v, "cutting").enabled === false ? "ne" : "da")],
  ["cutting.price", "cijena reznice", (v) => numOrEmpty(kindOf(v, "cutting").price)],
  ["cutting.qty", "količina reznica", (v) => numOrEmpty(kindOf(v, "cutting").qty)],
  ["desc", "opis", (v) => str(v.desc)],
  ["exp", "lično iskustvo", (v) => str(v.exp)],
  ["flaws", "nedostaci", (v) => str(v.flaws)],
  ...FACTS.map(([k, label]) => ["facts." + k, label, (v) => str(isObj(v.facts) ? v.facts[k] : "")]),
  ["images", "slike", (v) => canon(asList(v.images))],
  ["seoTitle", "naslov za Google", (v) => str(v.seoTitle)],
  ["seoDescription", "opis za Google", (v) => str(v.seoDescription)],
];

// Odjeljci podešavanja: ključ u brojaču → naslov, putanja u bazi, oznake polja
export const SECTIONS = [
  { id: "settings", title: "Kontakt i podešavanja", root: "settings", labels: {
    phone: "telefon", phoneIntl: "WhatsApp broj", email: "mejl", address: "adresa", mapUrl: "link na mapu",
    siteUrl: "adresa sajta", name: "naziv", showWithoutImage: "prikaz sorti bez slike" } },
  { id: "home", title: "Početna stranica", root: "pages/home", labels: {
    eyebrow: "natpis iznad naslova", title: "naslov", text: "tekst ispod naslova", heroImage: "naslovna slika",
    heroAlt: "opis naslovne slike", seoTitle: "naslov za Google", seoDescription: "opis za Google" } },
  { id: "kako", title: "Kako naručiti", root: "pages/kako", labels: {
    title: "naslov", intro: "uvod", steps: "koraci", seoTitle: "naslov za Google", seoDescription: "opis za Google" } },
  { id: "kontakt", title: "O nama i kontakt (stranica)", root: "pages/kontakt", labels: {
    title: "naslov", about: "tekst o nama", seoTitle: "naslov za Google", seoDescription: "opis za Google" } },
];
const SKIP = new Set(["updatedAt", "updatedBy"]);
const getPath = (o, p) => p.split("/").reduce((x, k) => (x == null ? undefined : x[k]), o);

export function varietySnapshot(v) {
  const out = {};
  for (const [id, , get] of VARIETY_FIELDS) out[id] = get(isObj(v) ? v : {});
  return out;
}
export function sectionSnapshot(data, sec) {
  const node = getPath(data, sec.root);
  const out = {};
  if (isObj(node)) for (const k of Object.keys(node).sort()) if (!SKIP.has(k)) { const c = canon(node[k]); if (c !== "") out[k] = c; }
  return out;
}
// Cijeli snimak iz sirovih podataka čvora vinograd (+ naziv sorte, da se zna i poslije brisanja)
export function snapshot(data) {
  const varieties = {};
  for (const [key, v] of Object.entries(isObj(data && data.varieties) ? data.varieties : {})) if (isObj(v)) varieties[key] = varietySnapshot(v);
  const sections = {};
  for (const sec of SECTIONS) sections[sec.id] = sectionSnapshot(data || {}, sec);
  return { varieties, sections };
}

// Nazivi promijenjenih polja (prazan niz: ništa se ne razlikuje ili nema snimka)
export function changedVarietyFields(prev, v) {
  if (!prev) return [];
  const cur = varietySnapshot(v);
  return VARIETY_FIELDS.filter(([id]) => (prev[id] ?? "") !== cur[id]).map(([, label]) => label);
}
export function changedSectionFields(prev, data, sec) {
  if (!prev) return [];
  const cur = sectionSnapshot(data, sec);
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(cur)])];
  return keys.filter((k) => (prev[k] ?? "") !== (cur[k] ?? "")).map((k) => sec.labels[k] || k);
}

// "danas 14:32", "jučer 9:05", "3. 11. u 14:32" (iste godine) ili "3. 11. 2025. u 14:32"
export function whenText(ts, now = Date.now()) {
  if (typeof ts !== "number") return "";
  const d = new Date(ts), n = new Date(now), p = (x) => String(x).padStart(2, "0");
  const hm = `${d.getHours()}:${p(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5);
  if (diff === 0) return "danas " + hm;
  if (diff === 1) return "jučer " + hm;
  return `${d.getDate()}. ${d.getMonth() + 1}.${d.getFullYear() === n.getFullYear() ? "" : " " + d.getFullYear() + "."} u ${hm}`;
}
