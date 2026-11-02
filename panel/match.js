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
