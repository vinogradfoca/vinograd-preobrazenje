// Čiste funkcije za imena: normalizacija, sličnost (Levenshtein), slug.
// Bez DOM-a i bez baze, pa se mogu testirati u Nodeu (tests/match.test.mjs).

// Bez kvačica: š→s, č→c, ć→c, ž→z, đ→dj (i ostali dijakritici), mala slova.
export function deaccent(s) {
  return String(s ?? "")
    .replace(/[Đđ]/g, "dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Za poređenje naziva: bez kvačica, mala slova, bez razmaka, crtica i drugih znakova.
export const normName = (s) => deaccent(s).replace(/[^a-z0-9]+/g, "");

// Slug: bez kvačica, mala slova, razmaci i posebni znaci u crtice, bez dupliranih crtica.
export const slugify = (s) => deaccent(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Slobodan slug: ako je zauzet, dodaje -2, -3, …
export function uniqueSlug(name, taken) {
  const base = slugify(name) || "sorta";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// Levenshteinova udaljenost (broj izmjena slova); max: rano odustajanje kad je veće od max
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Sorte sa sličnim nazivom: normalizovano isto ili razlika najviše 2 slova (naziv ili slug).
// varieties: { key: { name, slug } } → [{ key, name, dist }] poredano po udaljenosti
export function similarVarieties(name, varieties, maxDist = 2) {
  const n = normName(name);
  if (!n) return [];
  const out = [];
  for (const [key, v] of Object.entries(varieties || {})) {
    if (!v) continue;
    const cands = [normName(v.name), normName(v.slug || key)].filter(Boolean);
    const d = Math.min(...cands.map((c) => levenshtein(n, c, maxDist)));
    if (d <= maxDist) out.push({ key, name: v.name || key, dist: d });
  }
  return out.sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name, "sr"));
}

// ------------------------------------------------------------------ uvoz slika po imenu fajla (Dio 3)
// Ime fajla → { base, order, web }:
//   bez nastavka, bez kvačica, mala slova; prefiks "web-"/"web_" se skida i označava web sliku;
//   broj na kraju ("-3", "_3", " 3", "3") se uklanja i čuva kao redoslijed;
//   crtice, razmaci i donje crte se zanemaruju.
// full: isto, ali bez uklanjanja broja (za sorte čiji naziv završava brojem, npr. "KM 342").
export function parseFileName(name) {
  let s = deaccent(String(name || "").trim()).replace(/\.[a-z0-9]{2,5}$/i, "");
  let web = false;
  const w = /^web[-_ ]+/.exec(s);
  if (w) { web = true; s = s.slice(w[0].length); }
  const full = s.replace(/[^a-z0-9]+/g, "");
  const m = /[-_ ]*(\d+)$/.exec(s);
  const order = m ? Number(m[1]) : null;
  const base = (m ? s.slice(0, m.index) : s).replace(/[^a-z0-9]+/g, "");
  return { base: base || full, full, order, web };
}

// varieties: { key: { name, slug } }
// → { status: "matched" | "suggest" | "ambiguous" | "none", key, candidates: [key], order, web }
//   matched:   tačno poklapanje s nazivom ili slugom tačno jedne sorte
//   suggest:   jedna najbliža sorta: do 2 slova razlike, ili ime fajla počinje nazivom sorte
//              (npr. "poslanik-signalni" → Poslanik); korisnik potvrđuje
//   ambiguous: više sorti odgovara isto dobro: ne pogađa se, traži se izbor
//   none:      nema sorte
export function matchFile(name, varieties) {
  const { base, full, order, web } = parseFileName(name);
  const res = (status, candidates, ord = order) => ({ status, key: candidates.length === 1 ? candidates[0] : "", candidates, order: ord, web });
  if (!base) return res("none", []);
  const index = Object.entries(varieties || {}).filter(([, v]) => v).map(([key, v]) => ({ key, names: [...new Set([normName(v.name), normName(v.slug || key)].filter(Boolean))] }));
  for (const probe of [...new Set([base, full])]) {
    const exact = index.filter((x) => x.names.includes(probe)).map((x) => x.key);
    const ord = probe === base ? order : null; // poklapanje s brojem: broj je dio naziva (npr. "V20", "KM 342")
    if (exact.length === 1) return res("matched", exact, ord);
    if (exact.length > 1) return res("ambiguous", exact, ord);
  }
  // najbliže po Levenshteinu (do 2)
  let best = 3, near = [];
  for (const x of index) {
    const d = Math.min(...x.names.map((n) => levenshtein(base, n, 2)));
    if (d < best) { best = d; near = [x.key]; } else if (d === best && d <= 2) near.push(x.key);
  }
  if (best <= 2) return res(near.length === 1 ? "suggest" : "ambiguous", near);
  // ime fajla počinje nazivom sorte (najmanje 4 slova); najduži naziv pobjeđuje
  let len = 0, pref = [];
  for (const x of index) for (const n of x.names) {
    if (n.length >= 4 && base.startsWith(n)) {
      if (n.length > len) { len = n.length; pref = [x.key]; } else if (n.length === len && !pref.includes(x.key)) pref.push(x.key);
    }
  }
  if (pref.length) return res(pref.length === 1 ? "suggest" : "ambiguous", pref);
  return res("none", []);
}

// ------------------------------------------------------------------ zamjena stare slike (dopuna Dijela 3)
// Ključ fajla za poređenje sa starim nazivom iz seeda: bez nastavka i kvačica, mala slova,
// bez crtica/razmaka/donjih crta, ALI sa brojem na kraju i sa prefiksom web- ("viktor-3", "web-dikson").
export const fileKey = (name) => deaccent(String(name || "").trim()).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^a-z0-9]+/g, "");

// Mjesto u nizu images sorte koje nova slika zamjenjuje: stavka koja je stari naziv fajla
// (".webp" iz seeda, ne imageId) s istim ključem. -1 ako takve nema (slika ide na kraj niza).
export function findOldSlot(name, refs) {
  const k = fileKey(name);
  if (!k) return -1;
  return (refs || []).findIndex((r) => typeof r === "string" && /\.webp$/i.test(r) && fileKey(r) === k);
}
