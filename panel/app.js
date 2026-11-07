// Panel Vinograda Preobraženje (Koraci 3a, 3b, 4a, 4b, 4c i 5).
// Ekrani: prijava, Početna, Sorte, Uređivanje sorte (sa slikama), Cijene i količine,
// Slike (biblioteka, dodavanje, uvoz po imenu), Objavi, Dodaj sortu (čarobnjak),
// Podešavanja (kontakt, tekstovi stranica, promjena lozinke).
import { createDb } from "./db.js";
import { similarVarieties, uniqueSlug, matchFile, findOldSlot } from "./match.js";
import { convertImage, canMakeWebp, storagePaths, sha256Hex, ACCEPT, NO_WEBP_MSG, WIDTHS } from "./images.js";
import { SECTIONS as PUB_SECTIONS, changedVarietyFields, changedSectionFields, whenText } from "./changes.js";
import { EXTRA_PAGES, EXTRA_FIELDS, extraPage, hasContent } from "./stranice.js";

// ------------------------------------------------------------------ konstante
const COLORS = ["Bijela", "Crna", "Crvena", "Za provjeru"];
const RIPEN = ["Ultra rana", "Rana", "Srednje rana", "Kasna", "Za provjeru"];
const TYPES = ["Stona", "Besjemena", "Vinska"];
const CC = { Bijela: "w", Crna: "b", Crvena: "r", "Za provjeru": "x" };
const KINDS = [["sapling", "Sadnica"], ["cutting", "Reznica"]];
const FACTS = [
  ["origin", "Porijeklo"], ["author", "Autor"], ["maturity", "Dani do zrenja"],
  ["clusterWeight", "Težina grozda"], ["berryWeight", "Težina bobice"], ["berrySize", "Veličina bobice"],
  ["frost", "Otpornost na mraz"], ["disease", "Otpornost na bolesti"], ["taste", "Ukus"],
];
// Imena za "Zadnja izmjena". U bazi je samo UID (baza je javno čitljiva).
const NAMES = {
  aXWKivZS0ANh0T3CaXp9vvY5Nt42: "Žarko",
  heBoYKs5KBe5VUoqZhhVyMtXNNB3: "Vlasnik",
  "probni-korisnik": "Probni korisnik",
};
const MIN_PASSWORD = 8;

// ------------------------------------------------------------------ pomoćne
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const view = () => $("#view");
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : "");
const fmtPrice = (n) => (n == null ? "" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ","));
const fmtDate = (ts) => {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}. u ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function getIn(obj, path) { return path.split("/").reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setIn(obj, path, value) {
  const parts = path.split("/");
  let o = obj;
  for (const k of parts.slice(0, -1)) { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
  if (value === null) delete o[parts.at(-1)]; else o[parts.at(-1)] = value;
}
let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600);
}

// ------------------------------------------------------------------ stanje
const S = {
  db: null, user: null, mock: false, oldFiles: new Set(),
  data: { settings: {}, varieties: {} },
  manifest: { images: {}, published: [] },
  ui: { sorteFilter: "", sorteQ: "", cijeneFilter: "", cijeneQ: "" },
};
const V = (key) => S.data.varieties[key];
const keysSorted = () => Object.keys(S.data.varieties).sort((a, b) => {
  const va = V(a), vb = V(b);
  return (num(va.order) ?? 1e9) - (num(vb.order) ?? 1e9) || str(va.name).localeCompare(str(vb.name), "sr");
});
const kind = (v, k) => (v && v[k] && typeof v[k] === "object" ? v[k] : {});
// Slike sorte: niz u kojem je stavka ili imageId iz vinograd/images ili stari naziv fajla
// iz seeda (npr. "viktor-3.webp", prikazuje se iz /img/ preko manifest.json).
const imgList = (v) => {
  const a = !v ? [] : Array.isArray(v.images) ? v.images
    : Object.keys(v.images || {}).filter((k) => /^\d+$/.test(k)).sort((x, y) => x - y).map((k) => v.images[k]);
  return a.filter((x) => typeof x === "string" && x);
};
const isNewImg = (ref) => !!(S.data.images && S.data.images[ref]);
function imgSrc(ref, size = "400") {
  const im = S.data.images && S.data.images[ref];
  if (im) { const vv = (im.variants || {})[size] || (im.variants || {})["400"]; return vv && vv.path ? S.db.fileUrl(vv.path) : ""; }
  return S.oldFiles.has(ref) ? "/img/" + ref : "";
}
const thumbs = (key) => imgList(V(key)).map((r) => imgSrc(r)).filter(Boolean);
// Najviše 6 slika po sorti. Sorte koje već imaju više ostaju kakve jesu, samo im se ne dodaju nove.
const MAX_IMG = 6;
const MAX_IMG_MSG = "Sorta može imati najviše 6 slika. Ukloni neku da dodaš novu.";
// slike u toku slanja za sortu (još nisu u nizu, a zauzeće mjesto)
const pendingUploads = (key) => [...uploadJobs.entries()].filter(([id, j]) => j.key === key && !["err", "dup"].includes(($("#" + id) || { dataset: {} }).dataset.state)).length;
const imgRoom = (key) => (V(key) ? Math.max(0, MAX_IMG - imgList(V(key)).length - pendingUploads(key)) : 0);
const F = {
  noImg: (key) => !thumbs(key).length,
  noPrice: (key) => KINDS.every(([k]) => num(kind(V(key), k).price) == null),
  noQty: (key) => KINDS.every(([k]) => num(kind(V(key), k).qty) == null),
  hidden: (key) => V(key).visible === false,
  featured: (key) => V(key).featured === true,
  unavailable: (key) => {
    const on = KINDS.filter(([k]) => kind(V(key), k).enabled !== false);
    return on.length > 0 && on.every(([k]) => num(kind(V(key), k).qty) === 0);
  },
};

// ------------------------------------------------------------------ provjera unosa (kao .validate u pravilima baze)
const V8 = {
  name(raw) {
    const t = raw.trim();
    if (!t) return { error: "Naziv ne smije biti prazan." };
    if (t.length > 120) return { error: "Naziv može imati najviše 120 znakova." };
    return { value: t };
  },
  price(raw) {
    const t = raw.trim().replace(/\s/g, "").replace(",", ".");
    if (!t) return { value: null };
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Cijena mora biti broj, npr. 12 ili 12,50. Prazno znači \"na upit\"." };
    return { value: Number(t) };
  },
  qty(raw) {
    const t = raw.trim();
    if (!t) return { value: null };
    if (!/^\d+$/.test(t)) return { error: "Količina mora biti cijeli broj, npr. 0, 5 ili 30. Prazno znači \"na upit\"." };
    return { value: Number(t) };
  },
  text(raw) { const t = raw.replace(/\s+$/, "").replace(/^\s+/, ""); return { value: t || null }; },
  pick(list, label) { return (val) => (list.includes(val) ? { value: val } : { error: `${label}: izaberite jednu od ponuđenih vrijednosti.` }); },
};
V8.color = V8.pick(COLORS, "Boja");
V8.ripen = V8.pick(RIPEN, "Vrijeme zrenja");
V8.type = V8.pick(TYPES, "Vrsta");

// ------------------------------------------------------------------ snimanje
// Svako snimanje je multi-path update samo izmijenjenih polja + updatedAt i updatedBy.
const pending = new Map(); // putanja -> vrijednost (nije snimljeno, čeka "Pokušaj ponovo")
let inflight = 0;
const sending = new Set(); // obećanja upisa u toku (Objavi ih čeka)
function setStatus() {
  const bar = $("#saveBar");
  bar.hidden = false;
  if (pending.size && !inflight) {
    bar.innerHTML = `<div class="bad"><span>Nije snimljeno, nema veze. Pokušaj ponovo.</span><button type="button" id="retry">Pokušaj ponovo</button></div>`;
    $("#retry").onclick = retry;
  } else if (inflight) bar.innerHTML = `<div class="busy"><span>Snimam…</span></div>`;
  else bar.innerHTML = `<div class="ok"><span>✓ Snimljeno u nacrt</span><span class="small">Posjetioci vide tek poslije objave</span></div>`;
}
function send(paths) {
  const p = sendNow(paths);
  sending.add(p);
  p.finally(() => sending.delete(p));
  return p;
}
// čeka sve upise u toku, i one koji krenu dok se čeka
async function settled() {
  while (sending.size) await Promise.all([...sending]);
}
async function sendNow(paths) {
  inflight++; setStatus();
  try {
    await S.db.update(paths);
    for (const p of Object.keys(paths)) pending.delete(p);
  } catch (e) {
    for (const [p, v] of Object.entries(paths)) pending.set(p, v);
    console.warn("Snimanje nije uspjelo:", e && (e.code || e.message));
  } finally {
    inflight--; setStatus();
  }
}
function retry() { const paths = Object.fromEntries(pending); pending.clear(); send(paths); }
function save(key, fields) {
  const paths = {};
  for (const [f, v] of Object.entries(fields)) {
    paths[`varieties/${key}/${f}`] = v;
    setIn(V(key), f, v);
  }
  paths[`varieties/${key}/updatedAt`] = S.db.TIMESTAMP;
  paths[`varieties/${key}/updatedBy`] = S.user.uid;
  V(key).updatedAt = Date.now();
  V(key).updatedBy = S.user.uid;
  refreshMeta(key);
  return send(paths);
}
window.addEventListener("beforeunload", (e) => { if (inflight || pending.size || debounced.size) { e.preventDefault(); e.returnValue = ""; } });

// odgođeno snimanje za dugmad − i + (da deset dodira ne bude deset upisa)
const debounced = new Map();
function saveLater(key, field, value) {
  const id = key + "|" + field;
  clearTimeout(debounced.get(id)?.t);
  debounced.set(id, { t: setTimeout(() => { debounced.delete(id); save(key, { [field]: value }); }, 700), key, field, value });
}
function flushLater() {
  for (const [id, d] of debounced) { clearTimeout(d.t); debounced.delete(id); save(d.key, { [d.field]: d.value }); }
}

// ------------------------------------------------------------------ zajednički rukovaoci poljima
// Polja nose data-f (putanja ispod sorte) i data-v (vrsta provjere). Ključ sorte je u najbližem [data-key].
function fieldError(input, msg) {
  const box = input.closest(".field") || input.parentElement;
  box.classList.toggle("err", !!msg);
  let e = box.querySelector(".error");
  if (msg) { if (!e) { e = document.createElement("div"); e.className = "error"; e.setAttribute("role", "alert"); box.appendChild(e); } e.textContent = msg; }
  else if (e) e.remove();
}
function commitInput(input) {
  const key = input.closest("[data-key]")?.dataset.key;
  if (!key || !V(key)) return;
  const f = input.dataset.f, kindOf = input.dataset.v;
  const r = V8[kindOf](input.value);
  if (r.error) { fieldError(input, r.error); return; }
  fieldError(input, "");
  const cur = getIn(V(key), f) ?? null;
  if (cur === r.value || (cur === "" && r.value === null)) return;
  if (kindOf === "price") input.value = fmtPrice(r.value);
  if (kindOf === "name") $$(".js-name").forEach((n) => (n.textContent = r.value));
  save(key, { [f]: r.value });
  if (kindOf === "text") updateSummaries(key);
}
function onViewChange(e) {
  const el = e.target;
  if (location.hash.startsWith("#/uvoz") && impOnChange(el)) return;
  if (el.matches("[data-sp]")) return commitSP(el);
  if (el.id === "showNoImg") return commitShowNoImg(el);
  if (el.matches("[data-spstatus]")) return commitExtraStatus(el);
  if (el.matches("input[type=file][data-upload]")) return onFilesChosen(el);
  if (el.matches("input[data-imgalt]")) return commitAlt(el);
  if (el.id === "libSorta") { updateUploadButtons(); return; }
  if (el.matches("input[data-f][data-v], textarea[data-f][data-v]")) commitInput(el);
  else if (el.matches("input[type=checkbox][data-f]")) {
    const key = el.closest("[data-key]").dataset.key;
    save(key, { [el.dataset.f]: el.checked });
    if (el.dataset.f === "visible") { const hb = $("#hideBtn"); if (hb) hb.textContent = el.checked ? "Sakrij sortu" : "Prikaži sortu"; }
  }
}
function onViewInput(e) {
  const el = e.target;
  if (el.matches && el.matches("[data-impname]")) return impOnInput(el);
  if (el.id === "wName") { WIZ.name = el.value; WIZ.allowSimilar = false; const w = $("#wizSimilar"); if (w) w.innerHTML = ""; fieldError(el, ""); return; }
  const c = el.closest(".field")?.querySelector("[data-count]");
  if (c && (el.tagName === "TEXTAREA" || el.dataset.max || el.dataset.sp)) c.textContent = `${el.value.length} znakova` + (el.dataset.max ? ` (preporuka do ${el.dataset.max})` : "");
}
function onViewClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
  if (location.hash.startsWith("#/dodaj") && wizClick(b)) return;
  if (location.hash.startsWith("#/uvoz") && impOnClick(b)) return;
  if (b.dataset.seg) { // izbor iz liste (boja, zrenje, vrsta)
    const key = b.closest("[data-key]").dataset.key, f = b.dataset.seg;
    const r = V8[f](b.dataset.val);
    if (r.error) return toast(r.error);
    if (V(key)[f] === r.value) return;
    $$(`button[data-seg="${f}"]`, b.parentElement).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    save(key, { [f]: r.value });
  } else if (b.dataset.step) { // − i + za količinu
    const input = b.parentElement.querySelector("input");
    const key = b.closest("[data-key]").dataset.key;
    const cur = V8.qty(input.value).value ?? null;
    let next = cur == null ? (+b.dataset.step > 0 ? 1 : null) : Math.max(0, cur + +b.dataset.step);
    if (next === cur) return;
    input.value = next == null ? "" : String(next);
    fieldError(input, "");
    setIn(V(key), input.dataset.f, next);
    saveLater(key, input.dataset.f, next);
  } else if (b.dataset.share) shareVariety(b.dataset.share);
  else if (b.dataset.imgmove || b.dataset.imgdel) imgAction(b);
  else if (b.dataset.retry) retryUpload(b.dataset.retry);
  else if (b.dataset.attach) attachExisting(b);
  else if (b.hasAttribute("data-pub-retry")) { PUB.phase = ""; doPublish(); }
  else if (b.dataset.delimg) deleteImageDialog(b.dataset.delimg);
  else if (b.id === "backupBtn") downloadBackup(b);
}

// ------------------------------------------------------------------ dijeljenje
function shareInfo(key) {
  const v = V(key);
  const site = str(S.data.settings && S.data.settings.siteUrl).replace(/\/+$/, "");
  const url = `${site}/sorte/${v.slug || key}/`;
  const words = [v.ripen, v.color, v.type].filter((x) => x && x !== "Za provjeru").map((x) => x.toLowerCase());
  const text = `${v.name} – ${words.length ? words.join(" ") + " " : ""}sorta`;
  const live = v.visible !== false && S.manifest.published.includes(key) && !!site;
  return { url, text, live };
}
const canShare = () => typeof navigator.share === "function";
function shareButton(key, cls = "share") {
  const { live } = shareInfo(key);
  const label = canShare() ? "Podijeli" : "Kopiraj link";
  return `<button type="button" class="${cls}" data-share="${esc(key)}" aria-disabled="${!live}" aria-label="${label}: ${esc(V(key).name)}" title="${live ? label : "Ova sorta još nije na sajtu. Pritisni Objavi."}">${cls === "share" ? "↗" : "↗ " + label}</button>`;
}
async function shareVariety(key) {
  const { url, text, live } = shareInfo(key);
  if (!live) return toast("Ova sorta još nije na sajtu. Pritisni Objavi.");
  if (canShare()) {
    try { await navigator.share({ title: V(key).name, text, url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link je kopiran"); }
  catch { window.prompt("Kopiraj link:", url); }
}

// ------------------------------------------------------------------ prijava
function showAuth(html) {
  document.body.classList.add("nonav");
  $("#top").hidden = true; $("#nav").hidden = true; $("#saveBar").hidden = true;
  view().innerHTML = `<div class="auth">${html}</div>`;
}
const AUTH_MSG = {
  "auth/invalid-credential": "Mejl ili lozinka nisu tačni.",
  "auth/wrong-password": "Mejl ili lozinka nisu tačni.",
  "auth/user-not-found": "Mejl ili lozinka nisu tačni.",
  "auth/invalid-email": "Mejl nije ispravno upisan.",
  "auth/too-many-requests": "Previše pokušaja. Pričekaj malo pa pokušaj ponovo.",
  "auth/network-request-failed": "Nema veze s internetom. Pokušaj ponovo.",
  "auth/user-disabled": "Ovaj nalog je isključen.",
};
function showLogin() {
  showAuth(`
    <div class="card">
      <h1>Prijava</h1>
      <p class="lead">Panel Vinograda Preobraženje</p>
      <form id="login" novalidate>
        <div class="field"><label for="em">Mejl</label><input id="em" type="email" autocomplete="username" inputmode="email" required></div>
        <div class="field"><label for="pw">Lozinka</label><input id="pw" type="password" autocomplete="current-password" required></div>
        <button class="btn primary wide" style="margin-top:16px" type="submit">Prijavi se</button>
        <button class="btn ghost wide" style="margin-top:10px" type="button" id="forgot">Zaboravljena lozinka</button>
      </form>
      <div id="authMsg" role="alert"></div>
    </div>`);
  const msg = (t, ok) => ($("#authMsg").innerHTML = t ? `<div class="notice ${ok ? "ok" : "bad"}">${esc(t)}</div>` : "");
  $("#login").onsubmit = async (e) => {
    e.preventDefault();
    const em = $("#em").value.trim(), pw = $("#pw");
    if (!em || !pw.value) return msg("Upiši mejl i lozinku.");
    const btn = e.submitter || $("#login button[type=submit]");
    btn.disabled = true; btn.textContent = "Prijavljujem…"; msg("");
    try { await S.db.signIn(em, pw.value); }
    catch (err) { msg(AUTH_MSG[err && err.code] || "Prijava nije uspjela. Pokušaj ponovo."); btn.disabled = false; btn.textContent = "Prijavi se"; }
    finally { pw.value = ""; }
  };
  $("#forgot").onclick = async () => {
    const em = $("#em").value.trim();
    if (!em) return msg("Upiši mejl, pa pritisni Zaboravljena lozinka.");
    try { await S.db.resetPassword(em); } catch { /* ista poruka, da se ne otkrije postoji li nalog */ }
    msg("Ako nalog postoji, poslali smo mejl.", true);
  };
}
function showNoAccess(user) {
  showAuth(`
    <div class="card">
      <h1>Nemaš dozvolu</h1>
      <p class="lead">Nalog ${esc(user.email)} nije upisan kao admin panela.</p>
      <button class="btn primary wide" type="button" id="out2">Odjava</button>
    </div>`);
  $("#out2").onclick = () => S.db.signOut();
}

// ------------------------------------------------------------------ ekrani
function head(title, lead) { return `<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}`; }

function screenHome() {
  const keys = Object.keys(S.data.varieties), n = keys.length;
  const row = (f, label, cnt) => `
    <a href="#/sorte?f=${f}">
      <div class="row"><span>${label}</span><b>${cnt} od ${n}</b></div>
      <div class="bar" aria-hidden="true"><span style="width:${n ? Math.round(((n - cnt) / n) * 100) : 100}%"></span></div>
    </a>`;
  return `
    ${head("Šta želiš uraditi?")}
    <div class="big">
      <a href="#/dodaj"><i>＋</i><span>Dodaj sortu</span></a>
      <a href="#/cijene"><i>KM</i><span>Cijene i količine</span></a>
      <a href="#/slike"><i>▣</i><span>Dodaj slike</span></a>
      <a href="#/objavi"><i>↑</i><span>Objavi na sajt</span></a>
    </div>
    <div class="card fali">
      <h2>Šta još fali</h2>
      <p class="muted small">Dodir na red otvara te sorte.</p>
      ${row("bez-slike", "Sorte bez slike", keys.filter(F.noImg).length)}
      ${row("bez-cijene", "Sorte bez cijene", keys.filter(F.noPrice).length)}
      ${row("bez-kolicine", "Sorte bez količine", keys.filter(F.noQty).length)}
    </div>
    <p class="muted small">Sve što upišeš snima se u nacrt, a posjetioci to ne vide dok ne pritisneš Objavi.</p>`;
}

const SORTE_FILTERS = [["", "Sve", () => true], ["bez-slike", "Bez slike", F.noImg], ["bez-cijene", "Bez cijene", F.noPrice], ["bez-kolicine", "Bez količine", F.noQty], ["sakrivene", "Sakrivene", F.hidden], ["izdvojene", "Izdvojene", F.featured]];
function vThumb(key, cls = "thumb") {
  const t = thumbs(key)[0], v = V(key);
  return t ? `<img class="${cls}" src="${esc(t)}" alt="" loading="lazy" width="64" height="64">` : `<span class="${cls} ${CC[v.color] || "x"}" aria-hidden="true">${esc(str(v.name).slice(0, 1))}</span>`;
}
function badges(key) {
  const b = [];
  if (F.noImg(key)) b.push(`<span class="badge warn">nema slike</span>`);
  if (F.noPrice(key)) b.push(`<span class="badge warn">nema cijene</span>`);
  if (F.noQty(key)) b.push(`<span class="badge warn">nema količine</span>`);
  if (F.hidden(key)) b.push(`<span class="badge hid">sakrivena</span>`);
  if (F.unavailable(key)) b.push(`<span class="badge hid">nedostupna</span>`);
  if (F.featured(key)) b.push(`<span class="badge ft">izdvojena</span>`);
  return b.join("");
}
function sorteList() {
  const q = S.ui.sorteQ.trim().toLowerCase();
  const test = (SORTE_FILTERS.find((f) => f[0] === S.ui.sorteFilter) || SORTE_FILTERS[0])[2];
  const keys = keysSorted().filter((k) => test(k) && (!q || str(V(k).name).toLowerCase().includes(q)));
  $("#count").textContent = `${keys.length} od ${Object.keys(S.data.varieties).length} sorti`;
  $("#list").innerHTML = keys.length ? keys.map((k) => {
    const v = V(k);
    return `<div class="vcard">
      <a href="#/sorta/${encodeURIComponent(k)}">${vThumb(k)}<div><div class="vname">${esc(v.name)}</div>
        <div class="vmeta"><span class="dot ${CC[v.color] || "x"}"></span>${esc(v.color || "")}${v.ripen ? " · " + esc(v.ripen) : ""}</div>
        <div class="badges">${badges(k)}</div></div></a>
      ${shareButton(k)}
    </div>`;
  }).join("") : `<p class="empty">Nema sorti za ovaj izbor.</p>`;
}
function screenSorte(params) {
  if (params.has("f")) S.ui.sorteFilter = params.get("f");
  setTimeout(() => {
    if (!$("#q") || !$("#list")) return; // ekran je u međuvremenu zamijenjen
    sorteList();
    $("#q").addEventListener("input", (e) => { S.ui.sorteQ = e.target.value; sorteList(); });
    $$("#chips button").forEach((b) => (b.onclick = () => {
      S.ui.sorteFilter = b.dataset.f;
      $$("#chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      history.replaceState(null, "", "#/sorte" + (b.dataset.f ? "?f=" + b.dataset.f : ""));
      sorteList();
    }));
  });
  return `
    <div class="ehead"><h1>Sorte</h1><a class="btn primary" href="#/dodaj">＋ Dodaj sortu</a></div>
    <input id="q" class="search" style="margin-top:12px" type="search" placeholder="Pretraži po nazivu…" aria-label="Pretraži sorte" value="${esc(S.ui.sorteQ)}">
    <div class="chips" id="chips" role="group" aria-label="Filteri">
      ${SORTE_FILTERS.map(([f, l]) => `<button type="button" data-f="${f}" aria-pressed="${S.ui.sorteFilter === f}">${l}</button>`).join("")}
    </div>
    <p class="count" id="count"></p>
    <div class="vlist" id="list"></div>`;
}

// uređivanje sorte
function refreshMeta(key) {
  const el = $("#metaLine");
  if (el && el.closest("[data-key]")?.dataset.key === key) el.textContent = metaText(V(key));
}
function metaText(v) {
  if (!num(v.updatedAt)) return "Još nije mijenjana u panelu.";
  return `Zadnja izmjena: ${NAMES[v.updatedBy] || "nepoznat korisnik"}, ${fmtDate(v.updatedAt)}`;
}
function updateSummaries(key) {
  const v = V(key);
  const t = $("#sumText"); if (t) t.textContent = ["desc", "exp", "flaws"].some((f) => str(v[f]).trim()) ? "popunjeno" : "prazno";
  const f = $("#sumFacts"); if (f) f.textContent = `${FACTS.filter(([k]) => str(getIn(v, "facts/" + k)).trim()).length} od ${FACTS.length} popunjeno`;
}
const fieldText = (f, label, val, opts = {}) => `
  <div class="field">
    <label for="f-${f.replace("/", "-")}">${label}</label>
    ${opts.warn ? `<div class="warnbox">${opts.warn}</div>` : ""}
    ${opts.area
      ? `<textarea id="f-${f.replace("/", "-")}" data-f="${f}" data-v="text">${esc(val)}</textarea>`
      : `<input id="f-${f.replace("/", "-")}" type="text" data-f="${f}" data-v="${opts.v || "text"}" value="${esc(val)}"${opts.max ? ` data-max="${opts.max}"` : ""}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}>`}
    ${opts.area || opts.max ? `<div class="hint"><span>${opts.hint || ""}</span><span data-count>${String(val || "").length} znakova${opts.max ? ` (preporuka do ${opts.max})` : ""}</span></div>` : opts.hint ? `<div class="hint"><span>${opts.hint}</span></div>` : ""}
  </div>`;
const seg = (f, label, list, cur) => `
  <div class="field"><span class="lbl" id="lbl-${f}">${label}</span>
    <div class="seg" role="radiogroup" aria-labelledby="lbl-${f}">
      ${list.map((x) => `<button type="button" role="radio" data-seg="${f}" data-val="${esc(x)}" aria-checked="${cur === x}">${f === "color" ? `<span class="dot ${CC[x]}"></span>` : ""}${esc(x)}</button>`).join("")}
    </div></div>`;
const priceField = (k, v, compact, key) => `
  <div class="field"><label class="${compact ? "lbl" : ""}" for="p-${esc(key)}-${k}">Cijena</label>
    <div class="money"><input id="p-${esc(key)}-${k}" inputmode="decimal" data-f="${k}/price" data-v="price" value="${fmtPrice(num(kind(v, k).price))}" placeholder="na upit" autocomplete="off"><span>KM</span></div></div>`;
const qtyField = (k, v, compact, key) => `
  <div class="field"><label class="${compact ? "lbl" : ""}" for="q-${esc(key)}-${k}">Količina (komada)</label>
    <div class="stepper"><button type="button" data-step="-1" aria-label="Manje">−</button>
      <input id="q-${esc(key)}-${k}" inputmode="numeric" pattern="[0-9]*" data-f="${k}/qty" data-v="qty" value="${num(kind(v, k).qty) ?? ""}" placeholder="na upit" autocomplete="off">
      <button type="button" data-step="1" aria-label="Više">+</button></div></div>`;
function screenEdit(key) {
  const v = V(key);
  if (!v) return `${head("Sorta nije pronađena")}<p><a class="btn outline" href="#/sorte">Nazad na sorte</a></p>`;
  setTimeout(() => { updateSummaries(key); renderImgBox(key); });
  return `<div data-key="${esc(key)}">
    <a class="back" href="#/sorte">← Sorte</a>
    <div class="ehead"><div><h1 class="js-name">${esc(v.name)}</h1><p class="meta-line" id="metaLine">${esc(metaText(v))}</p></div>${shareButton(key, "btn outline")}</div>
    <div class="strip" id="strip">${stripHtml(key)}</div>

    <details class="sec" open><summary>Osnovno</summary><div class="secbody">
      ${fieldText("name", "Naziv", v.name, { v: "name" })}
      <p class="hint"><span>Adresa stranice: /sorte/${esc(v.slug || key)}/ (ne mijenja se kad se promijeni naziv)</span></p>
      ${seg("color", "Boja", COLORS, v.color)}
      ${seg("ripen", "Vrijeme zrenja", RIPEN, v.ripen)}
      ${seg("type", "Vrsta", TYPES, v.type)}
      <label class="switch">Vidljiva na sajtu<input type="checkbox" data-f="visible"${v.visible !== false ? " checked" : ""}></label>
      <label class="switch"><span>Izdvojena na početnoj<small>Prikazuje se u "Izdvajamo iz vinograda"</small></span><input type="checkbox" data-f="featured"${v.featured === true ? " checked" : ""}></label>
    </div></details>

    <details class="sec" open><summary>Cijena i stanje</summary><div class="secbody">
      <p class="hint"><span>Prazno polje znači "na upit". Količina 0 znači "nema na stanju".</span></p>
      <div class="kinds">${KINDS.map(([k, label]) => `<div class="kind"><h3>${label}</h3>${priceField(k, v, false, key)}${qtyField(k, v, false, key)}</div>`).join("")}</div>
    </div></details>

    <details class="sec"><summary>Tekstovi <small id="sumText"></small></summary><div class="secbody">
      ${fieldText("desc", "Opis", str(v.desc), { area: true })}
      ${fieldText("exp", "Lično iskustvo", str(v.exp), { area: true })}
      ${fieldText("flaws", "Nedostaci", str(v.flaws), { area: true, warn: "Unesite samo provjerene nedostatke sorte." })}
    </div></details>

    <details class="sec"><summary>Osobine <small id="sumFacts"></small></summary><div class="secbody">
      <p class="hint"><span>Prazno polje se na sajtu ne prikazuje.</span></p>
      ${FACTS.map(([k, label]) => fieldText("facts/" + k, label, str(getIn(v, "facts/" + k)))).join("")}
    </div></details>

    <details class="sec" id="secImg"><summary>Slike <small id="sumImg">${imgList(v).length}</small></summary><div class="secbody">
      <div id="imgBox"></div>
      ${uploaderHtml(key)}
    </div></details>

    <details class="sec"><summary>Napredno</summary><div class="secbody">
      <p class="hint"><span>Naslov i opis za Google. Prazno znači automatski (naziv i opis sorte).</span></p>
      ${fieldText("seoTitle", "Naslov za Google", str(v.seoTitle), { max: 60, placeholder: "automatski" })}
      ${fieldText("seoDescription", "Opis za Google", str(v.seoDescription), { max: 155, placeholder: "automatski" })}
    </div></details>

    <div class="endbtns">
      <button type="button" class="btn ghost" id="hideBtn">${v.visible !== false ? "Sakrij sortu" : "Prikaži sortu"}</button>
      <a class="btn green" href="#/sorte">Gotovo</a>
    </div>
    <button type="button" class="btn danger wide" id="delBtn">Obriši sortu</button>
  </div>`;
}
function bindEdit(key) {
  const hb = $("#hideBtn");
  if (!hb) return;
  const delb = $("#delBtn"); if (delb) delb.onclick = () => deleteVarietyDialog(key);
  hb.onclick = () => {
    const show = V(key).visible === false;
    if (!show && !confirm(`Sakriti sortu "${V(key).name}"? Neće se vidjeti na sajtu poslije sljedeće objave. Može se ponovo prikazati.`)) return;
    save(key, { visible: show });
    const sw = $('input[data-f="visible"]'); if (sw) sw.checked = show;
    hb.textContent = show ? "Sakrij sortu" : "Prikaži sortu";
  };
}

// cijene i količine
const CIJENE_FILTERS = [["", "Sve", () => true], ["bez-cijene", "Bez cijene", F.noPrice], ["bez-kolicine", "Bez količine", F.noQty], ["nedostupno", "Nedostupno", F.unavailable]];
function cijeneList() {
  const q = S.ui.cijeneQ.trim().toLowerCase();
  const test = (CIJENE_FILTERS.find((f) => f[0] === S.ui.cijeneFilter) || CIJENE_FILTERS[0])[2];
  const keys = keysSorted().filter((k) => test(k) && (!q || str(V(k).name).toLowerCase().includes(q)));
  $("#count").textContent = `${keys.length} od ${Object.keys(S.data.varieties).length} sorti`;
  $("#list").innerHTML = keys.length ? keys.map((k) => {
    const v = V(k);
    return `<div class="pcard" data-key="${esc(k)}">
      <h3><span class="dot ${CC[v.color] || "x"}"></span><a href="#/sorta/${encodeURIComponent(k)}">${esc(v.name)}</a></h3>
      <div class="pcols">${KINDS.map(([kk, label]) => `<div><div class="lbl" style="font-weight:800">${label}</div>${priceField(kk, v, true, k)}${qtyField(kk, v, true, k)}</div>`).join("")}</div>
    </div>`;
  }).join("") : `<p class="empty">Nema sorti za ovaj izbor.</p>`;
}
function screenCijene(params) {
  if (params.has("f")) S.ui.cijeneFilter = params.get("f");
  setTimeout(() => {
    if (!$("#q") || !$("#list")) return;
    cijeneList();
    $("#q").addEventListener("input", (e) => { S.ui.cijeneQ = e.target.value; cijeneList(); });
    $$("#chips button").forEach((b) => (b.onclick = () => {
      S.ui.cijeneFilter = b.dataset.f;
      $$("#chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      cijeneList();
    }));
  });
  return `
    ${head("Cijene i količine", "Prazno polje znači \"na upit\". Snima se čim napustiš polje.")}
    <input id="q" class="search" type="search" placeholder="Pretraži po nazivu…" aria-label="Pretraži sorte" value="${esc(S.ui.cijeneQ)}">
    <div class="chips" id="chips" role="group" aria-label="Filteri">
      ${CIJENE_FILTERS.map(([f, l]) => `<button type="button" data-f="${f}" aria-pressed="${S.ui.cijeneFilter === f}">${l}</button>`).join("")}
    </div>
    <p class="count" id="count"></p>
    <div id="list"></div>`;
}

// promijeni lozinku
function screenPostavke() {
  setTimeout(() => {
    $("#pwForm").onsubmit = async (e) => {
      e.preventDefault();
      const cur = $("#pwCur"), n1 = $("#pwNew"), n2 = $("#pwNew2");
      const msg = (t, ok) => ($("#pwMsg").innerHTML = `<div class="notice ${ok ? "ok" : "bad"}">${esc(t)}</div>`);
      const clear = () => { cur.value = ""; n1.value = ""; n2.value = ""; };
      if (!cur.value) return msg("Upiši trenutnu lozinku.");
      if (n1.value.length < MIN_PASSWORD) return msg(`Nova lozinka mora imati najmanje ${MIN_PASSWORD} znakova.`);
      if (n1.value !== n2.value) return msg("Nova lozinka i ponovljena lozinka nisu iste.");
      if (n1.value === cur.value) return msg("Nova lozinka mora biti drugačija od trenutne.");
      const btn = $("#pwForm button"); btn.disabled = true; btn.textContent = "Mijenjam…";
      try { await S.db.changePassword(cur.value, n1.value); clear(); msg("Lozinka je promijenjena.", true); }
      catch (err) {
        const c = err && err.code;
        msg(c === "auth/invalid-credential" || c === "auth/wrong-password" ? "Trenutna lozinka nije tačna."
          : c === "auth/weak-password" ? "Nova lozinka je preslaba. Izaberi dužu."
          : c === "auth/too-many-requests" ? "Previše pokušaja. Pričekaj malo pa pokušaj ponovo."
          : c === "auth/network-request-failed" ? "Nema veze s internetom. Pokušaj ponovo."
          : "Lozinka nije promijenjena. Pokušaj ponovo.");
        cur.value = "";
      } finally { btn.disabled = false; btn.textContent = "Promijeni lozinku"; }
    };
  });
  return `
    ${head("Podešavanja", "Kontakt i tekstovi stranica. Snima se čim napustiš polje, a posjetioci izmjene vide poslije objave.")}
    ${settingsSectionsHtml()}
    <div class="card" id="sec-prikaz"><h2>Prikaz na sajtu</h2>
      <label class="switch"><span>Prikaži na sajtu sorte bez slike<small>Kad je isključeno, sorte bez slike nisu u katalogu, na početnoj ni u cjenovniku. Stranica sorte i dalje postoji.</small></span><input type="checkbox" id="showNoImg"${getIn(S.data, "settings/showWithoutImage") !== false ? " checked" : ""}></label>
    </div>
    <div class="card">
      <h2>Promijeni lozinku</h2>
      ${S.mock ? `<p class="muted small">U probnom režimu promjena se samo glumi. "pogresna-lozinka" kao trenutna lozinka glumi grešku.</p>` : ""}
      <form id="pwForm" novalidate>
        <input type="email" autocomplete="username" value="${esc(S.user.email)}" hidden>
        <div class="field"><label for="pwCur">Trenutna lozinka</label><input id="pwCur" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pwNew">Nova lozinka</label><input id="pwNew" type="password" autocomplete="new-password"><div class="hint"><span>Najmanje ${MIN_PASSWORD} znakova.</span></div></div>
        <div class="field"><label for="pwNew2">Ponovi novu lozinku</label><input id="pwNew2" type="password" autocomplete="new-password"></div>
        <button class="btn primary wide" style="margin-top:16px" type="submit">Promijeni lozinku</button>
      </form>
      <div id="pwMsg" role="alert"></div>
    </div>
    <div class="card"><h2>Pomoć</h2><p class="muted small">Uputstvo za rad u panelu: dodavanje sorti, cijene, slike, objava i šta ako nešto ne radi.</p>
      <a class="btn outline wide" href="#/pomoc">Otvori pomoć</a></div>
    <div class="card"><h2>Kopija podataka</h2><p class="muted small">Sve sorte, tekstovi i podešavanja u jednom fajlu (JSON), za čuvanje na sigurnom mjestu.</p>
      <button type="button" class="btn outline wide" id="backupBtn">Preuzmi kopiju podataka</button></div>
    <div class="card"><h2>Prijavljen</h2><p class="muted">${esc(S.user.email)}</p><button type="button" class="btn ghost wide" id="out3">Odjava</button></div>`;
}


// ------------------------------------------------------------------ Pomoć
// Sadržaj je docs/uputstvo-za-panel.md, koji build pretvara u pomoc.html (bez baze).
let pomocHtml = null; // učitava se jednom po otvaranju panela
function screenPomoc() {
  return `${head("Pomoć", "Uputstvo za rad u panelu. Dodirni naslov da otvoriš odjeljak.")}
    <div id="pomoc" class="pomoc">${pomocHtml || `<p class="loading">Učitavanje…</p>`}</div>
    <p><a class="btn ghost wide" href="#/postavke">Nazad na podešavanja</a></p>`;
}
async function loadPomoc() {
  if (pomocHtml) return;
  const box = $("#pomoc");
  try {
    const r = await fetch("pomoc.html", { cache: "no-cache" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    pomocHtml = await r.text();
    if (location.hash.startsWith("#/pomoc") && $("#pomoc")) $("#pomoc").innerHTML = pomocHtml;
  } catch {
    if (!location.hash.startsWith("#/pomoc") || !$("#pomoc")) return;
    box.innerHTML = `<div class="notice bad">Pomoć se ne može učitati. Provjeri internet vezu.</div><button type="button" class="btn outline wide" id="pomocRetry">Pokušaj ponovo</button>`;
    $("#pomocRetry").onclick = () => { box.innerHTML = `<p class="loading">Učitavanje…</p>`; loadPomoc(); };
  }
}

// ------------------------------------------------------------------ slike (Korak 4a)
let uploading = 0; // dok traje upload, liste se ne iscrtavaju ponovo
const uploadJobs = new Map(); // id reda -> { file, key }
let jobSeq = 0;

function stripHtml(key) {
  const t = thumbs(key);
  return t.length ? t.map((src) => `<img src="${esc(src)}" alt="" loading="lazy">`).join("") : vThumb(key);
}
function refreshImages(key) {
  const st = $("#strip"); if (st) st.innerHTML = stripHtml(key);
  const sm = $("#sumImg"); if (sm) sm.textContent = imgList(V(key)).length;
  renderImgBox(key);
  updateUploadButtons();
}
function renderImgBox(key) {
  const box = $("#imgBox"); if (!box) return;
  const v = V(key), list = imgList(v);
  if (!list.length) { box.innerHTML = `<p class="muted">Sorta još nema slika.</p>`; return; }
  box.innerHTML = (list.length >= MAX_IMG ? `<p class="warnbox" id="manyImg">${MAX_IMG_MSG}</p>` : "") + `<p class="hint"><span>Prva slika je naslovna. Strelicama mijenjaš redoslijed. "Ukloni" sklanja sliku samo sa ove sorte, a slika ostaje u biblioteci.</span></p>` +
    list.map((ref, i) => {
      const src = imgSrc(ref), isNew = isNewImg(ref), im = isNew ? S.data.images[ref] : null;
      return `<div class="imrow">
        ${src ? `<img src="${esc(src)}" alt="" loading="lazy" class="imthumb">` : `<span class="imthumb thumb x" aria-hidden="true">?</span>`}
        <div class="iminfo">
          ${i === 0 ? `<span class="badge ft">naslovna</span>` : ""}
          ${isNew
            ? `<div class="field"><label for="alt-${esc(ref)}">Opis slike</label><input id="alt-${esc(ref)}" type="text" data-imgalt="${esc(ref)}" value="${esc(im.alt || "")}" maxlength="200"></div>
               <div class="hint"><span>${im.w}×${im.h} px${im.createdAt ? " · dodana " + esc(fmtDate(im.createdAt)) : ""}</span></div>`
            : `<div class="imname">${esc(ref)}</div><div class="hint"><span>${src ? "Starija slika sa sajta" : "Fajl još nije na sajtu"}</span></div>`}
        </div>
        <div class="imbtns">
          <button type="button" data-imgmove="-1" data-idx="${i}" aria-label="Pomjeri gore"${i === 0 ? " disabled" : ""}>↑</button>
          <button type="button" data-imgmove="1" data-idx="${i}" aria-label="Pomjeri dole"${i === list.length - 1 ? " disabled" : ""}>↓</button>
          <button type="button" class="rmimg" data-imgdel="1" data-idx="${i}" aria-label="Ukloni sliku sa sorte">Ukloni</button>
        </div>
      </div>`;
    }).join("");
}
function imgAction(b) {
  const key = b.closest("[data-key]").dataset.key;
  const list = imgList(V(key)), i = +b.dataset.idx;
  if (b.dataset.imgdel) {
    if (!confirm("Ukloniti sliku sa ove sorte? Slika ostaje u biblioteci i može se ponovo dodati.")) return;
    list.splice(i, 1);
  } else {
    const j = i + +b.dataset.imgmove;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  }
  save(key, { images: list.length ? list : null }); // cijeli niz u jednom upisu
  refreshImages(key);
}
function commitAlt(input) {
  const id = input.dataset.imgalt, t = input.value.trim();
  if (!t) return fieldError(input, "Opis slike ne smije biti prazan. Npr. \"Grozd sorte Viktor\".");
  if (t.length > 200) return fieldError(input, "Opis slike može imati najviše 200 znakova.");
  fieldError(input, "");
  if (S.data.images[id].alt === t) return;
  S.data.images[id].alt = t;
  send({ [`images/${id}/alt`]: t });
}

function uploaderHtml(key) {
  setTimeout(checkWebp);
  return `<div class="uploader">
    <div class="warnbox nowebp" hidden>${esc(NO_WEBP_MSG)}</div>
    <label class="btn primary wide upbtn"><input type="file" data-upload="${esc(key)}" accept="${ACCEPT}" multiple hidden>＋ Dodaj slike</label>
    <p class="hint"><span>Možeš izabrati više slika odjednom (najviše ${MAX_IMG} po sorti). Svaka se pretvara u 4 veličine i snima jedna po jedna.</span></p>
    <p class="warnbox imgfull" hidden>${MAX_IMG_MSG}</p>
    <div class="uplist" aria-live="polite"></div>
  </div>`;
}
async function checkWebp() {
  S.webp = await canMakeWebp();
  $$(".nowebp").forEach((w) => (w.hidden = S.webp));
  updateUploadButtons();
}
// "Dodaj slike": neaktivno bez WebP-a, bez izabrane sorte (biblioteka) i kad sorta već ima 6 slika
function updateUploadButtons() {
  $$("input[type=file][data-upload]").forEach((inp) => {
    if (inp.hasAttribute("data-import")) { inp.disabled = !S.webp; inp.closest("label").setAttribute("aria-disabled", String(inp.disabled)); return; }
    const lib = inp.id === "libFile";
    const key = lib ? ($("#libSorta") || {}).value : inp.dataset.upload;
    const full = !!key && !!V(key) && imgRoom(key) === 0;
    inp.disabled = !S.webp || (lib && !key) || full;
    inp.closest("label").setAttribute("aria-disabled", String(inp.disabled));
    const note = inp.closest(".uploader") && inp.closest(".uploader").querySelector(".imgfull");
    if (note) note.hidden = !full;
  });
}
function onFilesChosen(input) {
  const key = input.dataset.upload || ($("#libSorta") && $("#libSorta").value);
  const files = [...input.files];
  input.value = "";
  if (!files.length || !key || !V(key)) return;
  if (!S.webp) return toast(NO_WEBP_MSG);
  const room = imgRoom(key);
  if (files.length > room) {
    files.splice(room);
    toast(MAX_IMG_MSG);
    const note = input.closest(".uploader").querySelector(".imgfull");
    if (note) note.hidden = false;
    if (!files.length) { updateUploadButtons(); return; }
  }
  const list = input.closest(".uploader").querySelector(".uplist");
  const ids = files.map((file) => {
    const id = "up" + ++jobSeq;
    uploadJobs.set(id, { file, key });
    list.insertAdjacentHTML("beforeend", `<div class="uprow" id="${id}"><div class="upname">${esc(file.name)}</div><div class="bar"><span style="width:0%"></span></div><div class="upmsg muted small">Čeka…</div></div>`);
    return id;
  });
  updateUploadButtons();
  runUploads(ids, list);
}
async function runUploads(ids, list) {
  uploading++;
  let total = list.querySelector(".uptotal");
  if (!total) { list.insertAdjacentHTML("afterbegin", `<div class="uptotal"><div class="row"><b>Ukupno</b><span class="cnt"></span></div><div class="bar"><span></span></div></div>`); total = list.querySelector(".uptotal"); }
  const all = () => $$(".uprow", list);
  const done = () => all().filter((r) => r.dataset.state === "ok" || r.dataset.state === "dup").length;
  const upd = () => { const n = all().length, d = done(); total.querySelector(".cnt").textContent = `snimljeno ${d} od ${n}`; total.querySelector(".bar span").style.width = (n ? (d / n) * 100 : 0) + "%"; };
  upd();
  for (const id of ids) { await processUpload(id); upd(); }
  uploading--;
}
function retryUpload(id) {
  const row = $("#" + id); if (!row) return;
  const list = row.closest(".uplist");
  runUploads([id], list);
}
function setRow(id, pct, msg, state) {
  const row = $("#" + id); if (!row) return;
  if (pct != null) row.querySelector(".bar span").style.width = Math.round(pct * 100) + "%";
  if (state) row.dataset.state = state;
  row.querySelector(".upmsg").className = "upmsg small " + (state === "err" ? "error" : state === "dup" || state === "warn" ? "warntext" : state === "ok" ? "oktext" : "muted");
  row.querySelector(".upmsg").innerHTML = msg;
}
const STEP_TEXT = { "čitam": "Čitam sliku…", "pravim 400": "Pravim veličinu 400…", "pravim 800": "Pravim veličinu 800…", "pravim 1600": "Pravim veličinu 1600…", "pravim og": "Pravim sliku za pregled linka…" };
async function processUpload(id) {
  const job = uploadJobs.get(id); if (!job) return;
  const { file, key } = job;
  setRow(id, 0, "Pretvaram…", "busy");
  let conv;
  try { conv = await convertImage(file, (s) => setRow(id, 0.05, STEP_TEXT[s] || "Pretvaram…")); }
  catch (e) { setRow(id, 0, esc(e.message || "Slika se ne može pretvoriti."), "err"); return; }

  let dup;
  try { dup = await S.db.findImageByHash(conv.hash); }
  catch { setRow(id, 0, `Nema veze, slika nije snimljena. <button type="button" class="link" data-retry="${id}">Pokušaj ponovo</button>`, "err"); return; }
  if (dup) {
    if (imgList(V(key)).includes(dup)) setRow(id, 1, "Ova slika je već dodana ovoj sorti.", "dup");
    else setRow(id, 1, `Ova slika je već u biblioteci. Dodaj je ovoj sorti? <button type="button" class="btn outline attach" data-attach="${esc(dup)}" data-attach-key="${esc(key)}" data-row="${id}">Dodaj ovoj sorti</button>`, "dup");
    return;
  }

  try {
    const sum = await storeImage(conv, key, { onProgress: (f, msg) => setRow(id, 0.1 + 0.85 * f, msg) });
    uploadJobs.delete(id);
    const kb = (b) => Math.round(b / 1024) + " KB";
    setRow(id, 1, `✓ Snimljeno (${kb(file.size)} → ${kb(sum)} za sve 4 veličine)` + (conv.warnings.length ? `<br><span class="warntext">${esc(conv.warnings.join(" "))}</span>` : ""), "ok");
    refreshImages(key);
    refreshMeta(key);
    if (location.hash.startsWith("#/slike")) libList();
  } catch (e) {
    setRow(id, 0, `Slika nije snimljena: veza je prekinuta. <button type="button" class="link" data-retry="${id}">Pokušaj ponovo</button>`, "err");
  }
}

// Zajedničko jezgro (4a, uvoz po imenu): 4 fajla u Storage, pa zapis slike i niz sorte u
// jednom upisu. Pri grešci briše poslane fajlove i (ako je upis krenuo) zapis, pa baca grešku.
// Slika ide na kraj niza images sorte, osim kad je zadan replace (stari naziv fajla iz
// seeda u tom nizu): tada nova slika zauzima njegovo mjesto. Vraća ukupnu veličinu 4 fajla.
async function storeImage(conv, key, { source = "own", webApproved = false, replace = "", onProgress = () => {} } = {}) {
  const imageId = S.db.newImageId();
  const paths = storagePaths(imageId);
  const parts = [...WIDTHS.map(String), "og"];
  const sizes = parts.map((p) => conv.variants[p].blob.size), sum = sizes.reduce((a, b) => a + b, 0);
  const uploaded = [];
  let dbTried = false;
  const oldList = imgList(V(key));
  try {
    let before = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], vv = conv.variants[p];
      onProgress(before / sum, `Šaljem ${i + 1} od 4…`);
      await S.db.uploadFile(paths[p], vv.blob, vv.type, (f) => onProgress((before + f * sizes[i]) / sum));
      uploaded.push(paths[p]);
      before += sizes[i];
    }
    const v = V(key);
    const record = {
      alt: "Grozd sorte " + v.name, w: conv.w, h: conv.h,
      variants: Object.fromEntries(parts.map((p) => [p, { path: paths[p], w: conv.variants[p].w, h: conv.variants[p].h }])),
      hash: conv.hash, source, webApproved: source === "web" ? !!webApproved : false,
      createdAt: S.db.TIMESTAMP, createdBy: S.user.uid,
    };
    const list = [...imgList(v)];
    const at = replace ? list.indexOf(replace) : -1;
    if (at >= 0) list[at] = imageId; else list.push(imageId);
    dbTried = true;
    await S.db.update({
      [`images/${imageId}`]: record,
      [`varieties/${key}/images`]: list,
      [`varieties/${key}/updatedAt`]: S.db.TIMESTAMP,
      [`varieties/${key}/updatedBy`]: S.user.uid,
    });
    S.data.images[imageId] = { ...record, createdAt: Date.now() };
    V(key).images = list; V(key).updatedAt = Date.now(); V(key).updatedBy = S.user.uid;
    return sum;
  } catch (e) {
    console.warn("Upload nije uspio:", e && (e.code || e.message));
    for (const p of uploaded) { try { await S.db.deleteFile(p); } catch { /* ostaje za ručno čišćenje */ } }
    if (dbTried) S.db.update({ [`images/${imageId}`]: null, [`varieties/${key}/images`]: oldList.length ? oldList : null }).catch(() => {});
    throw e;
  }
}

// slika koja je već u biblioteci (isti hash) dodaje se sorti bez novog uploada
function attachExisting(b) {
  const imageId = b.dataset.attach, key = b.dataset.attachKey;
  if (!V(key)) return;
  const list = imgList(V(key));
  if (!list.includes(imageId) && list.length >= MAX_IMG) { setRow(b.dataset.row, 1, esc(MAX_IMG_MSG), "warn"); return; }
  if (!list.includes(imageId)) {
    list.push(imageId);
    save(key, { images: list }); // cijeli niz u jednom upisu
  }
  setRow(b.dataset.row, 1, "✓ Dodana ovoj sorti (bez novog uploada).", "ok");
  if (location.hash.startsWith("#/sorta/")) refreshImages(key);
  if (location.hash.startsWith("#/slike")) libList();
}

// ekran Slike: biblioteka svih slika, najnovije prve
function libList() {
  const box = $("#libList"); if (!box) return;
  const q = (S.ui.libQ || "").trim().toLowerCase();
  const use = {};
  for (const [k, v] of Object.entries(S.data.varieties)) for (const r of imgList(v)) (use[r] = use[r] || []).push(v.name || k);
  const ids = Object.keys(S.data.images || {})
    .filter((id) => !q || String(S.data.images[id].alt || "").toLowerCase().includes(q))
    .sort((a, b) => (num(S.data.images[b].createdAt) ?? 0) - (num(S.data.images[a].createdAt) ?? 0));
  $("#libCount").textContent = `${ids.length} ${ids.length === 1 ? "slika" : ids.length >= 2 && ids.length <= 4 ? "slike" : "slika"}`;
  box.innerHTML = ids.length ? ids.map((id) => {
    const im = S.data.images[id], u = use[id] || [];
    return `<div class="libcard">
      <img src="${esc(imgSrc(id))}" alt="" loading="lazy">
      <div><div class="libalt">${esc(im.alt || "(bez opisa)")}</div>
        <div class="hint"><span>${u.length ? `u ${u.length} ${u.length === 1 ? "sorti" : "sorte"}: ${esc(u.slice(0, 3).join(", "))}${u.length > 3 ? "…" : ""}` : "nije dodijeljena nijednoj sorti"}</span></div>
        <div class="hint"><span>${im.w}×${im.h} px${im.createdAt ? " · " + esc(fmtDate(im.createdAt)) : ""}</span></div>
        <button type="button" class="btn ghost sm delimgbtn" data-delimg="${esc(id)}">Obriši sliku trajno</button></div>
    </div>`;
  }).join("") : `<p class="empty">${q ? "Nema slika s tim opisom." : "Još nema slika dodanih kroz panel. Starije slike sa sajta vide se kod svake sorte."}</p>`;
}
function screenSlike() {
  setTimeout(() => {
    if (!$("#libQ")) return;
    libList();
    checkWebp();
    offerResume();
    $("#libQ").addEventListener("input", (e) => { S.ui.libQ = e.target.value; libList(); });
  });
  const opts = keysSorted().map((k) => `<option value="${esc(k)}">${esc(V(k).name)}</option>`).join("");
  return `
    ${head("Slike", "Biblioteka slika dodanih kroz panel, najnovije prve.")}
    <div class="card uploader">
      <h2>Dodaj slike</h2>
      <div class="warnbox nowebp" hidden>${esc(NO_WEBP_MSG)}</div>
      <div class="field"><label for="libSorta">Za koju sortu?</label>
        <select id="libSorta" class="search"><option value="">Izaberi sortu…</option>${opts}</select></div>
      <label class="btn primary wide upbtn" style="margin-top:12px" aria-disabled="true"><input type="file" id="libFile" data-upload="" accept="${ACCEPT}" multiple hidden disabled>＋ Dodaj slike</label>
      <p class="hint"><span>Za mnogo slika odjednom koristi uvoz po imenu fajla.</span></p>
      <p class="warnbox imgfull" hidden>${MAX_IMG_MSG}</p>
      <div class="uplist" aria-live="polite"></div>
    </div>
    <div class="card"><h2>Uvoz po imenu</h2><p class="muted small">Mnogo slika odjednom: sorta se nađe po imenu fajla (npr. viktor-2.jpg).</p>
      <a class="btn green wide" href="#/uvoz">Uvoz po imenu</a><div id="impResume" style="margin-top:8px"></div></div>
    <input id="libQ" class="search" type="search" placeholder="Pretraži po opisu slike…" aria-label="Pretraži slike" value="${esc(S.ui.libQ || "")}">
    <p class="count" id="libCount"></p>
    <div class="libgrid" id="libList"></div>`;
}

// ------------------------------------------------------------------ Objavi (Dio 1)
// Klik šalje Firebase ID token na /api/publish (Cloudflare Pages Function), koja provjeri admina i
// pozove deploy hook. Panel zatim upiše publish/last i publish/history i prati /build.json.
const PUB_TIMEOUT_MS = 6 * 60 * 1000; // poslije 6 minuta bez nove izgradnje: poruka o neuspjehu
const PUB_POLL_MS = 10 * 1000;
const PUB_MONTH_WARN = 300; // Cloudflare Pages besplatno: 500 izgradnji mjesečno (računaju se i pregledi grana i PR-ova)
const PUB = { phase: "", requestedAt: 0, builtAt: 0, error: "", timer: null, mockBuiltAt: 0 };

const hhmm = (ts) => { const d = new Date(ts), p = (x) => String(x).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
const izmjena = (n) => (n % 10 === 1 && n % 100 !== 11 ? "izmjena" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "izmjene" : "izmjena");
const objava = (n) => (n % 10 === 1 && n % 100 !== 11 ? "objava" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "objave" : "objava");

// Sorte, stranice i podešavanja čiji je updatedAt noviji od zadnje objave, i brisanja sorti.
// Ako objave iz panela još nema, broje se sve sorte i stranice. Broj u rečenici i spisak
// "Šta čeka objavu" dolaze iz istog niza stavki, pa se uvijek slažu.
function pendingChanges() {
  const last = num(getIn(S.data, "publish/last/requestedAt"));
  const newer = (t) => last == null || (t != null && t > last);
  const items = [];
  for (const [key, v] of Object.entries(S.data.varieties || {})) {
    if (!v) continue;
    const at = num(v.updatedAt);
    if (newer(at)) items.push({ type: "variety", key, at, by: v.updatedBy || "" });
  }
  for (const sec of PUB_SECTIONS) {
    const at = num(getIn(S.data, sec.root + "/updatedAt"));
    if (newer(at)) items.push({ type: "section", key: sec.id, sec, at, by: getIn(S.data, sec.root + "/updatedBy") || "" });
  }
  for (const [dk, d] of Object.entries(getIn(S.data, "publish/deletions") || {})) {
    if (d && num(d.at) && (last == null || d.at > last)) items.push({ type: "deleted", key: dk, ref: d.ref || "", at: d.at, by: d.by || "" });
  }
  return { last, n: items.length, items };
}
function pubHistory() {
  const h = getIn(S.data, "publish/history") || {};
  return Object.values(h).filter((x) => x && num(x.requestedAt)).sort((a, b) => b.requestedAt - a.requestedAt);
}
function monthCount() {
  const now = new Date();
  return pubHistory().filter((x) => { const d = new Date(x.requestedAt); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;
}
async function readBuiltAt() {
  if (S.mock && PUB.mockBuiltAt) return PUB.mockBuiltAt;
  try {
    const r = await fetch("/build.json?t=" + Date.now(), { cache: "no-store" });
    const j = await r.json();
    return Date.parse(j.builtAt) || 0;
  } catch { return 0; }
}
function stopPoll() { clearInterval(PUB.timer); PUB.timer = null; }
async function checkBuild() {
  PUB.builtAt = await readBuiltAt();
  if (PUB.phase === "building") {
    if (PUB.builtAt >= PUB.requestedAt) { PUB.phase = "done"; stopPoll(); loadPubSnap(true); }
    else if (Date.now() - PUB.requestedAt > PUB_TIMEOUT_MS) { PUB.phase = "failed"; stopPoll(); }
  }
  renderPubStatus();
}
function startPoll() { stopPoll(); PUB.timer = setInterval(checkBuild, PUB_POLL_MS); }

function renderPubStatus() {
  const box = $("#pubStatus"); if (!box) return;
  const btn = $("#pubBtn");
  let html = "";
  if (PUB.phase === "sending") html = `<div class="notice busy">Šaljem zahtjev za objavu…</div>`;
  else if (PUB.phase === "building") html = `<div class="notice busy"><b>Objavljuje se…</b><br><span class="small">Pokrenuto u ${hhmm(PUB.requestedAt)}. Obično traje 1 do 3 minute.</span></div>`;
  else if (PUB.phase === "done") html = `<div class="notice ok"><b>Objavljeno u ${hhmm(PUB.builtAt)}</b></div>`;
  else if (PUB.phase === "failed") html = `<div class="notice bad"><b>Izgradnja nije uspjela ili još traje. Sajt ostaje na prethodnoj verziji.</b><br><button type="button" class="btn primary" data-pub-retry style="margin-top:8px">Pokušaj ponovo</button></div>`;
  else if (PUB.phase === "unsaved") html = `<div class="notice bad"><b>Prvo snimi izmjene.</b><br><span class="small">Neka izmjena nije snimljena (nema veze), pa objava nije pokrenuta.</span><br><button type="button" class="btn primary" data-pub-retry style="margin-top:8px">Pokušaj ponovo</button></div>`;
  else if (PUB.phase === "error") html = `<div class="notice bad"><b>${esc(PUB.error)}</b><br><button type="button" class="btn primary" data-pub-retry style="margin-top:8px">Pokušaj ponovo</button></div>`;
  else if (PUB.builtAt) html = `<div class="notice ok">Zadnja objava: ${esc(fmtDate(PUB.builtAt))}</div>`;
  box.innerHTML = html;
  const q = $("#pubQty"); if (q) q.textContent = PUB.builtAt ? `Količine na sajtu su od ${fmtDate(PUB.builtAt)}.` : "";
  if (btn) { const busy = PUB.phase === "sending" || PUB.phase === "building"; btn.disabled = busy; btn.textContent = busy ? "Objavljuje se…" : "Objavi na sajt"; }
}

const PUB_ERR = {
  401: "Prijava je istekla. Odjavi se pa se prijavi ponovo.",
  403: "Nemaš dozvolu za objavu.",
  429: "Objava je upravo pokrenuta. Pričekaj pola minute pa pokušaj ponovo.",
  500: "Objava nije podešena na serveru (Cloudflare). Javi Žarku.",
  502: "Cloudflare ili Google trenutno ne odgovaraju. Pokušaj ponovo za minut.",
};
async function doPublish() {
  if (PUB.phase === "sending" || PUB.phase === "building") return;
  PUB.phase = "sending"; PUB.error = ""; renderPubStatus();
  // sve izmjene moraju biti u bazi prije izgradnje: odgođena snimanja odmah, pali upisi još jednom
  flushLater();
  if (pending.size) retry();
  await settled();
  if (pending.size) { PUB.phase = "unsaved"; renderPubStatus(); return; }
  let requestedAt;
  if (S.mock) {
    await new Promise((r) => setTimeout(r, 400));
    requestedAt = Date.now();
  } else {
    try {
      const token = await S.db.getIdToken();
      const res = await fetch("/api/publish", { method: "POST", headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(20000) });
      let body = {}; try { body = await res.json(); } catch { /* prazno */ }
      if (!res.ok || !body.ok) { PUB.phase = "error"; PUB.error = PUB_ERR[res.status] || "Objava nije pokrenuta. Pokušaj ponovo."; renderPubStatus(); return; }
      requestedAt = num(body.requestedAt) || Date.now();
    } catch (e) {
      PUB.phase = "error";
      PUB.error = e && (e.name === "TimeoutError" || e.name === "AbortError") ? "Sporo je i nismo dobili odgovor. Pokušaj ponovo." : "Nema veze s internetom. Pokušaj ponovo.";
      renderPubStatus(); return;
    }
  }
  // zapis o objavi (javni čvor, samo UID, bez imena i mejla)
  const rec = { requestedAt, requestedBy: S.user.uid };
  const hk = S.db.newKey("publish/history");
  setIn(S.data, "publish/last", rec);
  setIn(S.data, "publish/history/" + hk, rec);
  send({ "publish/last": rec, ["publish/history/" + hk]: rec });
  PUB.requestedAt = requestedAt; PUB.phase = "building";
  renderPubStatus(); renderPubInfo();
  if (S.mock) setTimeout(() => { PUB.mockBuiltAt = Date.now(); checkBuild(); }, 4000); // simulirana izgradnja
  startPoll();
}

// Snimak vrijednosti iz zadnje izgradnje sajta: undefined = još se učitava, null = nije dostupan
let pubSnap;
async function loadPubSnap(force) {
  if (pubSnap !== undefined && !force) return;
  try {
    const r = await fetch("objavljeno.json", { cache: "no-store" });
    pubSnap = r.ok ? await r.json() : null;
  } catch { pubSnap = null; }
  renderPubList();
}

const PUB_LIST_MAX = 20;
function pubItemHtml(it, last) {
  const who = NAMES[it.by] || (it.by ? "nepoznat korisnik" : "");
  const meta = [who, it.at ? whenText(it.at) : (last == null ? "čeka prvu objavu iz panela" : "")].filter(Boolean).join(" · ");
  let title, badge = "", what, note = "";
  if (it.type === "variety") {
    const v = V(it.key) || {};
    const prev = pubSnap && pubSnap.varieties ? pubSnap.varieties[it.key] : undefined;
    const fields = changedVarietyFields(prev, v);
    title = `<a class="pwlink" href="#/sorta/${encodeURIComponent(it.key)}">${esc(v.name || it.key)}</a>`;
    if (v.visible === false) {
      badge = `<span class="badge hid">skrivena</span>`;
      note = `<p class="pwnote">Skrivena je, pa se neće vidjeti na sajtu ni poslije objave.</p>`;
    }
    what = pubSnap && pubSnap.varieties && !prev ? "nova sorta" : fields.length ? fields.join(", ") : (it.at ? "izmijenjena" : "");
  } else if (it.type === "section") {
    const prev = pubSnap && pubSnap.sections ? pubSnap.sections[it.key] : undefined;
    const fields = changedSectionFields(prev, S.data, it.sec);
    const onlyView = it.key === "settings" && fields.length === 1 && fields[0] === it.sec.labels.showWithoutImage;
    title = `<a class="pwlink" href="#/postavke?sec=${onlyView ? "prikaz" : it.key}">${esc(it.sec.title)}</a>`;
    what = fields.length ? fields.join(", ") : (it.at ? "izmijenjeno" : "");
  } else {
    const name = pubSnap && pubSnap.varieties && pubSnap.varieties[it.ref] ? pubSnap.varieties[it.ref].name : "";
    title = `<span class="pwtitle">${name ? "Sorta " + esc(name) : "Obrisana sorta"}</span>`;
    badge = `<span class="badge hid">obrisano</span>`;
    what = name ? "" : (it.ref ? `oznaka: ${esc(it.ref)}` : "");
  }
  return `<li class="pwi"><div class="pwhead">${title}${badge}</div>${what ? `<p class="pwwhat">${esc(what)}</p>` : ""}${note}${meta ? `<p class="pwmeta">${esc(meta)}</p>` : ""}</li>`;
}
function renderPubList() {
  const box = $("#pubWhatBody"); if (!box) return;
  const p = pendingChanges();
  const sum = $("#pubWhatCount"); if (sum) sum.textContent = p.n ? String(p.n) : "";
  if (!p.n) { box.innerHTML = `<p class="pwempty">Sve je objavljeno.</p>`; return; }
  const items = p.items.slice().sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || String(a.key).localeCompare(String(b.key), "sr"));
  const cnt = (t) => items.filter((x) => x.type === t).length;
  const parts = [[cnt("variety"), "sorte"], [cnt("section"), "stranice i podešavanja"], [cnt("deleted"), "obrisano"]].filter(([n]) => n).map(([n, l]) => `${l}: ${n}`);
  box.innerHTML = `<p class="pwsum">${esc(parts.join(" · "))}</p>`
    + (p.last == null ? `<p class="pwnote">Još nema objave iz panela, pa su na spisku sve sorte i stranice.</p>` : "")
    + (pubSnap === null ? `<p class="pwnote">Spisak promijenjenih polja nije dostupan, pa piše samo "izmijenjena".</p>` : "")
    + `<ul class="pwlist">${items.slice(0, PUB_LIST_MAX).map((it) => pubItemHtml(it, p.last)).join("")}</ul>`
    + (items.length > PUB_LIST_MAX ? `<p class="pwmore">… i još ${items.length - PUB_LIST_MAX}</p>` : "");
}

function renderPubInfo() {
  const p = pendingChanges(), m = monthCount();
  renderPubList();
  const pi = $("#pubPending");
  if (pi) pi.innerHTML = p.n
    ? `<b>${p.n} ${izmjena(p.n)}</b> ${p.n % 10 >= 2 && p.n % 10 <= 4 && (p.n % 100 < 12 || p.n % 100 > 14) ? "čekaju" : "čeka"} objavu${p.last == null ? " (još nema objave iz panela, pa se broje sve sorte i stranice)" : ""}.`
    : `Nema izmjena od zadnje objave.`;
  const mi = $("#pubMonth");
  if (mi) mi.innerHTML = `Objava ovog mjeseca: <b>${m}</b>` + (m >= PUB_MONTH_WARN ? `<div class="warnbox" style="margin-top:8px">Cloudflare besplatni paket dozvoljava 500 izgradnji mjesečno. Skupi više izmjena pa objavi jednom.</div>` : "");
  const hl = $("#pubHist");
  if (hl) {
    const h = pubHistory().slice(0, 5);
    hl.innerHTML = h.length ? h.map((x) => `<li><span>${esc(fmtDate(x.requestedAt))}</span><b>${esc(NAMES[x.requestedBy] || "nepoznat korisnik")}</b></li>`).join("") : `<li class="muted">Još nema objava iz panela.</li>`;
  }
}
function screenObjavi() {
  setTimeout(async () => {
    renderPubInfo();
    loadPubSnap();
    const last = num(getIn(S.data, "publish/last/requestedAt"));
    PUB.builtAt = await readBuiltAt();
    if (!PUB.phase || PUB.phase === "done") {
      // vraćanje na ekran: ako zadnja objava još nije izgrađena, nastavi praćenje
      if (last && PUB.builtAt < last) { PUB.requestedAt = last; PUB.phase = Date.now() - last > PUB_TIMEOUT_MS ? "failed" : "building"; }
    }
    if (PUB.phase === "building") startPoll();
    renderPubStatus();
  });
  return `
    ${head("Objavi")}
    <div class="card">
      <p id="pubPending" class="pubpending"></p>
      <details class="sec pubwhat" id="pubWhat"><summary>Šta čeka objavu <small id="pubWhatCount"></small></summary><div class="secbody" id="pubWhatBody"></div></details>
      <button type="button" class="btn primary wide pubbtn" id="pubBtn">Objavi na sajt</button>
      <div id="pubStatus" role="status" aria-live="polite"></div>
      <p class="muted small" id="pubQty"></p>
      <p class="muted small">Sve što upišeš u panelu snima se u nacrt. Posjetioci to vide tek kad pritisneš Objavi i izgradnja se završi.</p>
    </div>
    <div class="card"><p id="pubMonth" style="margin:0"></p></div>
    <div class="card"><h2>Zadnje objave</h2><ul class="pubhist" id="pubHist"></ul></div>`;
}

// ------------------------------------------------------------------ Dodaj sortu (Dio 2)
// Pet koraka. Sorta se pravi u bazi čim se prođe korak 1 (skrivena, visible:false), a
// ostali koraci snimaju u istu sortu putanjama do polja (isto autosnimanje kao uređivanje).
const WIZ = { key: "", name: "", color: "", allowSimilar: false };
const WIZ_STEPS = ["Naziv i boja", "Slike", "Cijena i količina", "Opis i iskustvo", "Pregled"];

function wizHead(step) {
  return `<a class="back" href="#/sorte">← Sorte</a>
    <h1>Dodaj sortu</h1>
    <p class="lead">Korak ${step} od 5: ${WIZ_STEPS[step - 1]}</p>
    <div class="bar wizbar" aria-hidden="true"><span style="width:${step * 20}%"></span></div>`;
}
function wizNav(step, nextLabel = "Dalje") {
  return `<div class="endbtns wiznav">
    ${step > 1 ? `<button type="button" class="btn ghost" data-wiz-back="${step}">← Nazad</button>` : `<a class="btn ghost" href="#/sorte">Odustani</a>`}
    <button type="button" class="btn ${step === 5 ? "primary" : "green"}" data-wiz-next="${step}">${nextLabel}</button>
  </div>`;
}
function screenWizard(parts) {
  const key = decodeURIComponent(parts[1] || "");
  const step = Math.min(5, Math.max(1, +parts[2] || 1));
  if (key && !V(key)) return `${head("Sorta nije pronađena")}<p><a class="btn outline" href="#/dodaj">Dodaj novu sortu</a></p>`;
  if (!key) { // korak 1, sorta još ne postoji
    if (!parts[1] && !WIZ.key) { /* nova */ }
    const unfinished = WIZ.key && V(WIZ.key) ? `<div class="notice busy">Nedovršeno dodavanje: <b>${esc(V(WIZ.key).name)}</b>. <a href="#/dodaj/${encodeURIComponent(WIZ.key)}/2">Nastavi</a></div>` : "";
    return `${wizHead(1)}${unfinished}
      <div class="card" id="wiz1">
        <div class="field"><label for="wName">Naziv sorte</label><input id="wName" type="text" maxlength="120" value="${esc(WIZ.name)}" autocomplete="off"></div>
        <div class="field"><span class="lbl" id="lbl-wcolor">Boja</span>
          <div class="seg" role="radiogroup" aria-labelledby="lbl-wcolor">
            ${COLORS.map((c) => `<button type="button" role="radio" data-wcolor="${esc(c)}" aria-checked="${WIZ.color === c}"><span class="dot ${CC[c]}"></span>${esc(c)}</button>`).join("")}
          </div></div>
        <p class="hint"><span>Obavezni su samo naziv i boja. Sve ostalo možeš dodati poslije.</span></p>
        <div id="wizSimilar"></div>
      </div>${wizNav(1)}`;
  }
  const v = V(key);
  let body = "";
  if (step === 1) {
    body = `<div class="card" data-key="${esc(key)}">
      ${fieldText("name", "Naziv sorte", v.name, { v: "name" })}
      <p class="hint"><span>Adresa stranice: /sorte/${esc(v.slug || key)}/ (ne mijenja se kad se promijeni naziv)</span></p>
      ${seg("color", "Boja", COLORS, v.color)}</div>`;
  } else if (step === 2) {
    setTimeout(() => renderImgBox(key));
    body = `<div class="card" data-key="${esc(key)}"><p class="hint"><span>Neobavezno. Sliku možeš dodati i kasnije. Prva slika je naslovna.</span></p>
      <div id="imgBox"></div>${uploaderHtml(key)}</div>`;
  } else if (step === 3) {
    body = `<div class="card" data-key="${esc(key)}"><p class="hint"><span>Neobavezno. Prazno polje znači "na upit". Količina 0 znači "nema na stanju".</span></p>
      <div class="kinds">${KINDS.map(([k, label]) => `<div class="kind"><h3>${label}</h3>${priceField(k, v, false, key)}${qtyField(k, v, false, key)}</div>`).join("")}</div></div>`;
  } else if (step === 4) {
    body = `<div class="card" data-key="${esc(key)}"><p class="hint"><span>Neobavezno.</span></p>
      ${seg("ripen", "Vrijeme zrenja", RIPEN, v.ripen)}
      ${seg("type", "Vrsta", TYPES, v.type)}
      ${fieldText("desc", "Opis", str(v.desc), { area: true })}
      ${fieldText("exp", "Lično iskustvo", str(v.exp), { area: true })}
      ${fieldText("flaws", "Nedostaci", str(v.flaws), { area: true, warn: "Unesite samo provjerene nedostatke sorte." })}</div>`;
  } else {
    const imgs = imgList(v), k = (kk) => kind(v, kk);
    const pr = (kk) => { const o = k(kk); return `${num(o.price) != null ? fmtPrice(o.price) + " KM" : "cijena na upit"}, ${num(o.qty) != null ? o.qty + " kom." : "količina na upit"}`; };
    const row = (l, val) => `<tr><th scope="row">${l}</th><td>${val}</td></tr>`;
    body = `<div class="card" data-key="${esc(key)}">
      <div class="strip" id="strip" style="margin:0 0 12px">${stripHtml(key)}</div>
      <table class="props"><tbody>
        ${row("Naziv", esc(v.name))}${row("Boja", `<span class="dot ${CC[v.color] || "x"}"></span> ${esc(v.color || "")}`)}
        ${row("Vrijeme zrenja", esc(v.ripen || "nije upisano"))}${row("Vrsta", esc(v.type || "nije upisano"))}
        ${row("Slike", imgs.length ? String(imgs.length) : "nema")}
        ${row("Sadnica", pr("sapling"))}${row("Reznica", pr("cutting"))}
        ${row("Tekstovi", ["desc", "exp", "flaws"].filter((f) => str(v[f]).trim()).length + " od 3 popunjeno")}
        ${row("Adresa", `/sorte/${esc(v.slug || key)}/`)}
      </tbody></table>
      <label class="switch">Vidljiva na sajtu<input type="checkbox" data-f="visible"${v.visible === true ? " checked" : ""}></label>
      <p class="warnbox" style="margin-top:12px">Nova sorta se ne vidi na sajtu dok je ne uključiš i ne pritisneš Objavi.</p></div>`;
  }
  return `${wizHead(step)}<p class="muted small" style="margin-top:-6px">Sorta: <b class="js-name">${esc(v.name)}</b></p>${body}${wizNav(step, step === 5 ? "Spremi sortu" : "Dalje")}`;
}

function wizValidateStep1() {
  const nameEl = $("#wName");
  const r = V8.name(nameEl.value);
  if (r.error) { fieldError(nameEl, r.error); nameEl.focus(); return null; }
  fieldError(nameEl, "");
  if (!COLORS.includes(WIZ.color)) { toast("Izaberi boju sorte."); return null; }
  return r.value;
}
async function wizCreate() {
  const name = wizValidateStep1(); if (!name) return;
  WIZ.name = name;
  if (!WIZ.allowSimilar) {
    const sim = similarVarieties(name, S.data.varieties).slice(0, 3);
    if (sim.length) {
      $("#wizSimilar").innerHTML = `<div class="warnbox" role="alert"><b>Već postoji sorta sa sličnim nazivom:</b>
        ${sim.map((x) => `<div class="simrow"><span>${esc(x.name)}</span><a class="btn outline" href="#/sorta/${encodeURIComponent(x.key)}">Otvori postojeću</a></div>`).join("")}
        <button type="button" class="btn ghost wide" data-wiz-force style="margin-top:8px">Ipak dodaj novu</button></div>`;
      return;
    }
  }
  // prvi upis: sorta s obaveznim poljima, skrivena; slug je ključ i poslije se ne mijenja
  const taken = new Set([...Object.keys(S.data.varieties), ...Object.values(S.data.varieties).map((v) => v && v.slug).filter(Boolean)]);
  const slug = uniqueSlug(name, taken);
  const maxOrder = Math.max(0, ...Object.values(S.data.varieties).map((v) => num(v && v.order) ?? 0));
  const v = { name, slug, color: WIZ.color, visible: false, featured: false, order: maxOrder + 1, updatedAt: S.db.TIMESTAMP, updatedBy: S.user.uid };
  S.data.varieties[slug] = { ...v, updatedAt: Date.now() };
  send({ [`varieties/${slug}`]: v });
  WIZ.key = slug; WIZ.allowSimilar = false;
  location.hash = `#/dodaj/${encodeURIComponent(slug)}/2`;
}
function wizClick(b) {
  if (b.dataset.wcolor) {
    WIZ.color = b.dataset.wcolor;
    $$("button[data-wcolor]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    return true;
  }
  if (b.hasAttribute("data-wiz-force")) { WIZ.allowSimilar = true; wizCreate(); return true; }
  if (b.dataset.wizNext || b.dataset.wizBack) {
    const step = +(b.dataset.wizNext || b.dataset.wizBack);
    const key = decodeURIComponent((location.hash.split("/")[2] || "").split("?")[0]);
    document.activeElement && document.activeElement.blur && document.activeElement.blur(); // snimi polje koje je u fokusu
    flushLater();
    if (b.dataset.wizBack) { location.hash = step - 1 === 1 && !key ? "#/dodaj" : `#/dodaj/${encodeURIComponent(key)}/${step - 1}`; return true; }
    if (!key) { wizCreate(); return true; }
    if ($("#view .field.err")) { toast("Ispravi označeno polje."); return true; }
    if (step < 5) location.hash = `#/dodaj/${encodeURIComponent(key)}/${step + 1}`;
    else { toast(`Sorta "${V(key).name}" je spremljena.`); WIZ.key = ""; WIZ.name = ""; WIZ.color = ""; location.hash = `#/sorta/${encodeURIComponent(key)}`; }
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ Uvoz slika po imenu (Dio 3)
// Isti konvertor (images.js) i isti upload (storeImage) kao 4a. Ništa se ne snima dok se
// ne potvrdi pregled. Spisak preostalih slika čuva se u IndexedDB za nastavak poslije prekida.
const IMP = { items: [], phase: "pick", prep: 0, seq: 0, total: 0, done: 0, summary: null, resumed: false };
const THUMB = 160;

// IndexedDB: baza "vinograd-panel", spremište "uvoz" (jedan zapis po slici)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("vinograd-panel", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("uvoz", { keyPath: "id" });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("uvoz", mode), st = tx.objectStore("uvoz");
    const out = fn(st);
    tx.oncomplete = () => { db.close(); res(out && "result" in out ? out.result : undefined); };
    tx.onerror = () => { db.close(); rej(tx.error); }; tx.onabort = () => { db.close(); rej(tx.error); };
  });
}
const idbAll = () => idbDo("readonly", (st) => st.getAll()).catch(() => []);
const idbPut = (rec) => idbDo("readwrite", (st) => st.put(rec));
const idbDel = (id) => idbDo("readwrite", (st) => st.delete(id)).catch(() => {});
const idbClear = () => idbDo("readwrite", (st) => st.clear()).catch(() => {});

async function makeThumb(file) {
  try {
    const bm = await createImageBitmap(file, { resizeWidth: THUMB, resizeQuality: "medium", imageOrientation: "from-image" });
    const c = document.createElement("canvas"); c.width = bm.width; c.height = bm.height;
    c.getContext("2d").drawImage(bm, 0, 0); bm.close();
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.7));
    c.width = 0; c.height = 0;
    return b ? URL.createObjectURL(b) : "";
  } catch { return ""; }
}
function impMatch(it) {
  const r = matchFile(it.name, S.data.varieties);
  it.match = r; it.web = r.web; it.order = r.order;
  if (!it.manualKey) it.key = r.status === "matched" ? r.key : "";
  impOld(it);
}
// stara slika (naziv fajla iz seeda) koju ova slika zamjenjuje na istom mjestu u nizu sorte
function impOld(it) {
  const refs = it.key && V(it.key) ? imgList(V(it.key)) : [];
  const i = findOldSlot(it.name, refs);
  it.oldRef = i >= 0 ? refs[i] : "";
  // ista stara slika ne može biti zamijenjena dvaput u istom uvozu: zamjenjuje prva, ostale idu na kraj
  if (it.oldRef && IMP.items.some((o) => o !== it && o.oldRef === it.oldRef && o.key === it.key && impGroup(o) === "ok" && IMP.items.indexOf(o) < IMP.items.indexOf(it))) it.oldRef = "";
}
const impGroup = (it) => (it.dup || it.exclude || it.full ? "skip" : it.key ? "ok" : "none");
// Najviše 6 slika po sorti: slike koje bi prešle ograničenje idu u Preskočene. Slika koja
// zamjenjuje staru (isto mjesto u nizu) ne zauzima novo mjesto. Redoslijed kao pri snimanju.
function impCapacity() {
  IMP.items.forEach((it) => { it.full = ""; });
  const used = {};
  const want = IMP.items.filter((it) => !it.dup && !it.exclude && it.key && it.state !== "ok")
    .sort((a, b) => a.key.localeCompare(b.key) || (a.order ?? 1e9) - (b.order ?? 1e9) || String(a.fname).localeCompare(String(b.fname)));
  for (const it of want) {
    if (it.oldRef) continue;
    if (used[it.key] == null) used[it.key] = V(it.key) ? imgList(V(it.key)).length : 0;
    if (used[it.key] >= MAX_IMG) it.full = "Sorta već ima 6 slika";
    else used[it.key]++;
  }
}

// Dugme "Izaberi fajlove (čuva imena)" nema accept, da Android ponudi sistemski izbor datoteka
// (izbor iz galerije često vrati generička imena, npr. 1000062053.jpg). Zato se ovdje zadrže
// samo slike po ekstenziji, a ostalo se preskoči uz poruku.
const IMP_EXT = /\.(jpe?g|png|webp)$/i;
const notImageMsg = (n) => n % 10 === 1 && n % 100 !== 11 ? `${n} fajl nije slika i preskočen je.`
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} fajla nisu slike i preskočena su.`
  : `${n} fajlova nije slika i preskočeno je.`;
function pickImages(input) {
  const all = [...input.files]; input.value = "";
  if (input.dataset.import !== "fajlovi" && !input.hasAttribute("data-impre")) return { files: all, skipped: 0 };
  const files = all.filter((f) => IMP_EXT.test(f.name));
  return { files, skipped: all.length - files.length };
}
// Izgubljena imena: većina fajlova se zove samo brojem (npr. 1000062053.jpg)
const LOST_NAME = /^\d{5,}\.(jpe?g|png|webp|heic)$/i;
const namesLost = (items) => items.length > 0 && items.filter((it) => LOST_NAME.test(it.fname || "")).length * 2 > items.length;

async function impChoose(input) {
  const { files, skipped } = pickImages(input);
  if (skipped) toast(notImageMsg(skipped));
  if (!files.length) return;
  if (!S.webp) return toast(NO_WEBP_MSG);
  IMP.items.forEach((it) => it.thumb && URL.revokeObjectURL(it.thumb));
  IMP.items = []; IMP.phase = "prep"; IMP.summary = null; IMP.resumed = false; IMP.skipped = skipped;
  for (const file of files) IMP.items.push({ id: "imp" + ++IMP.seq, file, fname: file.name, name: file.name, approved: false, exclude: false, dup: "", manualKey: false });
  await impPrepare();
}
// hash, sličica, poklapanje i provjera duplikata, jedna po jedna slika
async function impPrepare() {
  renderImport();
  const seen = new Map();
  for (let i = 0; i < IMP.items.length; i++) {
    const it = IMP.items[i];
    IMP.prep = i + 1; const pr = $("#impPrep"); if (pr) pr.textContent = `Pripremam pregled: ${i + 1} od ${IMP.items.length}…`;
    if (!it.file) { it.dup = ""; continue; }
    if (!it.hash) it.hash = await sha256Hex(await it.file.arrayBuffer());
    if (!it.thumb) it.thumb = await makeThumb(it.file);
    if (!it.key || !it.manualKey) impMatch(it);
    if (seen.has(it.hash)) it.dup = "Isti fajl je izabran dva puta.";
    else {
      seen.set(it.hash, it.id);
      try { const d = await S.db.findImageByHash(it.hash); if (d) it.dup = "Već je u biblioteci."; } catch { /* bez veze: provjera se ponavlja pri snimanju */ }
    }
  }
  IMP.phase = "preview"; renderImport();
}

function impStatus(it) {
  const m = it.match || { status: "none", candidates: [] }, nm = (k) => esc((V(k) || {}).name || k);
  if (it.dup) return `<span class="warntext">${esc(it.dup)} Preskočena.</span>`;
  if (it.full) return `<span class="warntext">${esc(it.full)}. Preskočena.</span>`;
  if (it.key) return `<span class="oktext">✓ ${it.manualKey ? "Izabrano" : "Uparena"}: ${nm(it.key)}</span>` + (it.oldRef ? ` <span class="badge ft">zamjenjuje staru sliku ${esc(it.oldRef)}</span>` : "");
  if (m.status === "suggest") return `Mislili ste: <b>${nm(m.key)}</b>? <button type="button" class="btn outline sm" data-impyes="${it.id}">Da, ${nm(m.key)}</button>`;
  if (m.status === "ambiguous") return `<span class="warntext">Odgovara sortama ${m.candidates.map(nm).join(" i ")}. Izaberi iz liste.</span>`;
  return `<span class="warntext">Nije pronađena sorta. Ispravi ime ili izaberi iz liste.</span>`;
}
function impCard(it, opts) {
  const oldSrc = it.oldRef ? imgSrc(it.oldRef) : "";
  const pics = `<div class="imppics">${it.thumb ? `<img src="${esc(it.thumb)}" alt="Nova slika" width="${THUMB}" height="${THUMB}">` : `<span class="imthumb thumb x" aria-hidden="true">?</span>`}${it.oldRef
    ? `<figure class="impold">${oldSrc ? `<img src="${esc(oldSrc)}" alt="Stara slika ${esc(it.oldRef)}" loading="lazy">` : `<span class="imthumb thumb x" aria-hidden="true">?</span>`}<figcaption>stara${oldSrc ? "" : " (fajla nema)"}</figcaption></figure>` : ""}</div>`;
  return `<div class="impcard${it.oldRef ? " replaces" : ""}" data-imp="${it.id}">
    ${pics}
    <div class="impbody">
      <div class="field"><label for="in-${it.id}">Ime fajla</label><input id="in-${it.id}" type="text" data-impname="${it.id}" value="${esc(it.name)}" autocomplete="off"></div>
      <div class="field"><label for="ik-${it.id}">Sorta</label><select id="ik-${it.id}" class="search" data-impkey="${it.id}"><option value="">— izaberi sortu —</option>${opts.replace(`value="${esc(it.key)}"`, `value="${esc(it.key)}" selected`)}</select></div>
      <div class="impstat small" id="is-${it.id}">${impStatus(it)}</div>
      ${it.web ? `<div class="impweb"><span class="badge warn">sa interneta</span><label class="check"><input type="checkbox" data-impok="${it.id}"${it.approved ? " checked" : ""}> Provjereno da smijem koristiti</label>${it.approved ? "" : `<div class="hint"><span>Bez kvačice slika se snima, ali se ne objavljuje na sajtu.</span></div>`}</div>` : ""}
      ${it.dup ? "" : `<label class="check"><input type="checkbox" data-impskip="${it.id}"${it.exclude ? " checked" : ""}> Preskoči ovu sliku</label>`}
      ${it.state ? `<div class="bar"><span style="width:${Math.round((it.pct || 0) * 100)}%"></span></div><div class="upmsg small">${it.msg || ""}</div>` : ""}
    </div></div>`;
}
function renderImport() {
  const box = $("#impBox"); if (!box) return;
  if (IMP.phase === "pick") { box.innerHTML = ""; return; }
  if (IMP.phase === "prep") { box.innerHTML = `<p class="notice busy" id="impPrep">Pripremam pregled…</p>`; return; }
  const opts = keysSorted().map((k) => `<option value="${esc(k)}">${esc(V(k).name)}</option>`).join("");
  impCapacity();
  const g = { ok: [], none: [], skip: [] };
  for (const it of IMP.items) g[impGroup(it)].push(it);
  const needFile = IMP.items.filter((it) => !it.file);
  const sec = (title, list, open) => `<details class="sec" ${open ? "open" : ""}><summary>${title} <small>${list.length}</small></summary><div class="secbody impgrid">${list.map((it) => impCard(it, opts)).join("") || `<p class="muted">Nema.</p>`}</div></details>`;
  const n = g.ok.filter((it) => it.file && it.state !== "ok").length;
  box.innerHTML = `
    ${needFile.length ? `<div class="warnbox">Za ${needFile.length} slika sadržaj nije sačuvan. Izaberi ih ponovo (ista imena fajlova):
      <label class="btn outline wide upbtn" style="margin-top:8px"><input type="file" data-impre multiple hidden>Izaberi ponovo</label></div>` : ""}
    ${IMP.phase === "preview" && IMP.skipped ? `<p class="notice" id="impSkipped">${esc(notImageMsg(IMP.skipped))}</p>` : ""}
    ${IMP.phase === "preview" && namesLost(IMP.items) ? `<div class="warnbox" id="impLost">Imena fajlova su izgubljena pa se slike ne mogu uparivati po imenu. Pokušaj dugme 'Izaberi fajlove (čuva imena)' ili dodijeli sorte ručno ispod.</div>` : ""}
    ${IMP.summary ? `<div class="notice ok" id="impSum"><b>${esc(IMP.summary)}</b><br><a class="btn primary" href="#/objavi" style="margin-top:8px">Objavi</a></div>` : ""}
    ${IMP.phase === "saving" ? `<div class="uptotal"><div class="row"><b>Ukupno</b><span>snimljeno ${IMP.done} od ${IMP.total}</span></div><div class="bar"><span style="width:${IMP.total ? (IMP.done / IMP.total) * 100 : 0}%"></span></div><div class="small muted" id="impSizes">${esc(IMP.sizes || "")}</div></div>` : ""}
    ${sec("Uparene", g.ok, true)}${sec("Neuparene", g.none, true)}${sec("Preskočene", g.skip, false)}
    ${IMP.phase === "preview" ? `<div class="wiznav"><button type="button" class="btn primary wide" id="impSave"${n ? "" : " disabled"}>Snimi ${n} ${n % 10 === 1 && n % 100 !== 11 ? "sliku" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "slike" : "slika"}</button></div>` : ""}`;
  const sv = $("#impSave"); if (sv) sv.onclick = impSave;
}
function impItem(el, attr) { return IMP.items.find((x) => x.id === el.getAttribute(attr)); }
function impOnInput(el) { // ime se mijenja: ishod se odmah osvježi
  const it = impItem(el, "data-impname"); if (!it) return;
  it.name = el.value; it.manualKey = false; impMatch(it);
  const st = $("#is-" + it.id); if (st) st.innerHTML = impStatus(it);
  const sel = $("#ik-" + it.id); if (sel) sel.value = it.key || "";
}
function impOnChange(el) {
  if (el.matches("[data-impname]")) { renderImport(); return true; }
  if (el.matches("[data-impkey]")) { const it = impItem(el, "data-impkey"); it.key = el.value; it.manualKey = !!el.value; impOld(it); renderImport(); return true; }
  if (el.matches("[data-impok]")) { const it = impItem(el, "data-impok"); it.approved = el.checked; renderImport(); return true; }
  if (el.matches("[data-impskip]")) { const it = impItem(el, "data-impskip"); it.exclude = el.checked; renderImport(); return true; }
  if (el.matches("[data-impre]")) { impReselect(el); return true; }
  if (el.matches("[data-import]")) { impChoose(el); return true; }
  return false;
}
function impOnClick(b) {
  if (b.dataset.impyes) { const it = IMP.items.find((x) => x.id === b.dataset.impyes); it.key = it.match.key; it.manualKey = true; impOld(it); renderImport(); return true; }
  if (b.id === "impDiscard") { idbClear(); IMP.items = []; IMP.phase = "pick"; route(); return true; }
  return false;
}
function impReselect(input) {
  const { files, skipped } = pickImages(input);
  if (skipped) toast(notImageMsg(skipped));
  for (const f of files) { const it = IMP.items.find((x) => !x.file && x.fname === f.name); if (it) it.file = f; }
  impPrepare();
}

async function impSave() {
  const list = IMP.items.filter((it) => impGroup(it) === "ok" && it.file && it.state !== "ok" && !it.dup)
    .sort((a, b) => a.key.localeCompare(b.key) || (a.order ?? 1e9) - (b.order ?? 1e9) || a.fname.localeCompare(b.fname));
  if (!list.length) return;
  IMP.phase = "saving"; IMP.total = list.length; IMP.done = 0; IMP.summary = null; uploading++;
  // spisak preostalih u IndexedDB (sa sadržajem fajla; ako ne stane, samo ime)
  for (const it of list) {
    const rec = { id: it.id, fname: it.fname, name: it.name, key: it.key, web: !!it.web, approved: !!it.approved, order: it.order ?? null, hash: it.hash, oldRef: it.oldRef || "" };
    try { await idbPut({ ...rec, blob: it.file }); } catch { try { await idbPut(rec); } catch { /* bez nastavka */ } }
  }
  let before = 0, after = 0;
  const kb = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
  renderImport();
  for (const it of list) {
    const upd = () => { const c = $(`.impcard[data-imp="${it.id}"]`); if (c) { const bar = c.querySelector(".bar span"); if (bar) bar.style.width = Math.round((it.pct || 0) * 100) + "%"; const mm = c.querySelector(".upmsg"); if (mm) mm.innerHTML = it.msg || ""; } };
    it.state = "busy"; it.pct = 0.02; it.msg = "Pretvaram…"; renderImport();
    try {
      const conv = await convertImage(it.file);
      const dupNow = await S.db.findImageByHash(conv.hash);
      if (dupNow) { it.state = "ok"; it.dup = "Već je snimljena."; it.pct = 1; it.msg = "Već je u biblioteci, preskočena."; await idbDel(it.id); IMP.done++; renderImport(); continue; }
      const sum = await storeImage(conv, it.key, { source: it.web ? "web" : "own", webApproved: it.approved, replace: it.oldRef || "", onProgress: (f, msg) => { it.pct = 0.1 + 0.9 * f; if (msg) it.msg = msg; upd(); } });
      before += it.file.size; after += sum;
      it.state = "ok"; it.pct = 1; it.msg = `<span class="oktext">✓ Snimljeno (${kb(it.file.size)} → ${kb(sum)})${it.oldRef ? `, umjesto ${esc(it.oldRef)}` : ""}</span>`;
      await idbDel(it.id);
    } catch (e) {
      it.state = "err"; it.pct = 0; it.msg = `<span class="error">${esc(e && e.code === "no-webp" ? e.message : "Nije snimljeno: veza je prekinuta. Ostaje za nastavak.")}</span>`;
    }
    IMP.done++; IMP.sizes = `Veličina: ${kb(before)} prije, ${kb(after)} poslije (sve 4 veličine).`; renderImport();
  }
  uploading--;
  const saved = IMP.items.filter((it) => it.state === "ok" && !it.dup).length;
  const skipped = IMP.items.filter((it) => impGroup(it) === "skip").length;
  const unmatched = IMP.items.filter((it) => impGroup(it) === "none").length;
  const failed = IMP.items.filter((it) => it.state === "err").length;
  const f3 = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
  IMP.summary = `${saved} snimljeno, ${skipped} ${f3(skipped, "preskočena", "preskočena", "preskočeno")}, ${unmatched} ${f3(unmatched, "neuparena", "neuparene", "neuparenih")}` + (failed ? `, ${failed} nije snimljeno (pritisni Snimi za nastavak)` : "");
  IMP.phase = failed ? "preview" : "done";
  IMP.items.forEach((it) => { if (it.state === "err") it.state = "retry"; }); // poruka ostaje, slika se nudi ponovo
  renderImport();
}

async function screenUvozAfter(params) {
  await checkWebp();
  if (params.get("nastavi") === "1" && !IMP.items.length) {
    const recs = await idbAll();
    IMP.items = recs.map((r) => ({ id: r.id, file: r.blob || null, fname: r.fname, name: r.name, key: r.key, manualKey: true, web: r.web, approved: r.approved, order: r.order, hash: r.hash, oldRef: r.oldRef || "", exclude: false, dup: "" }));
    IMP.seq = Math.max(IMP.seq, ...IMP.items.map((x) => +String(x.id).replace(/\D/g, "") || 0));
    IMP.resumed = true;
    if (IMP.items.length) await impPrepare();
  }
  renderImport();
}
function screenUvoz(params) {
  setTimeout(() => screenUvozAfter(params));
  return `<a class="back" href="#/slike">← Slike</a>
    ${head("Uvoz slika po imenu", "Izaberi više slika odjednom. Panel po imenu fajla nađe sortu (npr. viktor-2.jpg ide sorti Viktor, kao druga slika). Ništa se ne snima dok ne pregledaš i potvrdiš.")}
    <div class="card uploader">
      <div class="warnbox nowebp" hidden>${esc(NO_WEBP_MSG)}</div>
      <label class="btn primary wide upbtn"><input type="file" id="impFiles" data-import="fajlovi" data-upload="" multiple hidden>Izaberi fajlove (čuva imena)</label>
      <label class="btn outline wide upbtn" style="margin-top:8px"><input type="file" id="impGallery" data-import="galerija" data-upload="" accept="${ACCEPT}" multiple hidden>Izaberi iz galerije</label>
      <p class="hint"><span>Iz galerije telefon često skrati imena fajlova pa se slike ne mogu uparivati po imenu.</span></p>
      <p class="hint"><span>Prefiks "web-" znači slika sa interneta. Broj na kraju imena određuje redoslijed.</span></p>
      ${IMP.resumed ? `<button type="button" class="btn ghost wide" id="impDiscard" style="margin-top:8px">Odbaci nedovršen uvoz</button>` : ""}
    </div>
    <div id="impBox"></div>`;
}
async function offerResume() {
  const box = $("#impResume"); if (!box) return;
  const recs = await idbAll();
  box.innerHTML = recs.length ? `<a class="btn outline wide" href="#/uvoz?nastavi=1">Nastavi uvoz (${recs.length} preostalo)</a>` : "";
}

// ------------------------------------------------------------------ Kontakt i tekstovi stranica (Dio 4)
// Samo polja koja već postoje u bazi (settings, pages/home, pages/kako, pages/kontakt).
// Snimanje kao i ostatak panela: po polju, uz updatedAt/updatedBy čvora (settings ili pages/<p>).
// "req": polje koje sajt mora imati (build bez njega pada), pa se ne smije isprazniti.
const SP_SECTIONS = () => {
  const steps = (getIn(S.data, "pages/kako/steps") || []);
  const stepList = Array.isArray(steps) ? steps : Object.keys(steps).sort((a, b) => a - b).map((k) => steps[k]);
  return [
    { id: "settings", title: "Kontakt", root: "settings", fields: [
      ["settings/phone", "Telefon", "req", "Kako se prikazuje na sajtu, npr. 065/592-120."],
      ["settings/phoneIntl", "WhatsApp broj", "phoneIntl", "Samo cifre, bez + i bez nule na početku, npr. 38765592120."],
      ["settings/email", "Mejl", "email"],
      ["settings/address", "Adresa", "req"],
      ["settings/mapUrl", "Link na mapu", "url", "Počinje sa https://. Prazno znači bez linka."],
      ["settings/siteUrl", "Adresa sajta", "readonly", "Samo za čitanje. Mijenja se u bazi."],
    ] },
    { id: "home", title: "Početna stranica", root: "pages/home", fields: [
      ["pages/home/eyebrow", "Natpis iznad naslova", "opt"],
      ["pages/home/title", "Naslov", "reqArea", "Novi red u naslovu je i novi red na sajtu."],
      ["pages/home/text", "Tekst ispod naslova", "reqArea"],
      ["pages/home/heroAlt", "Opis naslovne slike", "req", "Za čitače ekrana i Google."],
      ["pages/home/seoTitle", "Naslov za Google", "opt", "", 60],
      ["pages/home/seoDescription", "Opis za Google", "optArea", "", 155],
    ] },
    { id: "kako", title: "Kako naručiti", root: "pages/kako", fields: [
      ["pages/kako/title", "Naslov stranice", "req"],
      ["pages/kako/intro", "Uvodni tekst", "optArea", "Prazno znači bez uvoda."],
      ...stepList.flatMap((_, i) => [[`pages/kako/steps/${i}/title`, `Korak ${i + 1}: naslov`, "req"], [`pages/kako/steps/${i}/text`, `Korak ${i + 1}: tekst`, "reqArea"]]),
      ["pages/kako/seoTitle", "Naslov za Google", "opt", "Prazno znači automatski.", 60],
      ["pages/kako/seoDescription", "Opis za Google", "optArea", "Prazno znači automatski.", 155],
    ] },
    { id: "kontakt", title: "O nama i kontakt (stranica)", root: "pages/kontakt", fields: [
      ["pages/kontakt/title", "Naslov odjeljka", "req"],
      ["pages/kontakt/about", "Tekst o vinogradu", "reqArea"],
      ["pages/kontakt/seoTitle", "Naslov za Google", "opt", "Prazno znači automatski.", 60],
      ["pages/kontakt/seoDescription", "Opis za Google", "optArea", "Prazno znači automatski.", 155],
    ] },
    // Dodatne stranice (panel/stranice.js); status se mijenja prekidačem ispod polja
    ...EXTRA_PAGES.map((x) => ({ id: x.id, title: x.menu, root: "pages/" + x.id, group: "Dodatne stranice", status: true, fields: [
      [`pages/${x.id}/title`, "Naslov", "req"],
      [`pages/${x.id}/eyebrow`, "Uvodni naslov", "opt", "Mali natpis iznad naslova."],
      [`pages/${x.id}/subtitle`, "Podnaslov", "opt"],
      [`pages/${x.id}/intro`, "Tekst", "reqArea", "Prazan red = novi odlomak."],
      [`pages/${x.id}/note`, "Napomena", "optArea"],
      [`pages/${x.id}/label`, "Oznaka", "opt", "Npr. \"U pripremi\"."],
    ] })),
  ];
};
const SP_CHECK = {
  req: (t) => (t ? { value: t } : { error: "Ovo polje ne smije biti prazno, sajt ga prikazuje." }),
  reqArea: (t) => SP_CHECK.req(t),
  opt: (t) => ({ value: t || null }),
  optArea: (t) => ({ value: t || null }),
  phoneIntl: (t) => (!t ? { error: "WhatsApp broj ne smije biti prazan." } : !/^\d+$/.test(t) ? { error: "Upiši samo cifre, bez +, razmaka i crtica. Npr. 38765592120." }
    : t.startsWith("0") ? { error: "Bez nule na početku: počni pozivnim brojem države, npr. 387." } : t.length < 8 || t.length > 15 ? { error: "Broj mora imati od 8 do 15 cifara." } : { value: t }),
  email: (t) => (!t ? { error: "Mejl ne smije biti prazan." } : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? { error: "Mejl nije ispravan. Npr. ime@gmail.com." } : { value: t }),
  url: (t) => (!t ? { value: null } : !/^https:\/\/\S+$/.test(t) ? { error: "Link mora počinjati sa https:// (kopiraj ga iz Google mapa)." } : { value: t }),
};
function spSummary(sec) {
  const f = sec.fields.filter((x) => x[2] !== "readonly");
  const n = f.filter((x) => str(getIn(S.data, x[0])).trim()).length;
  return n === f.length ? "popunjeno" : n === 0 ? "prazno" : `popunjeno ${n} od ${f.length}`;
}
function spField([path, label, kind, hint = "", max = 0]) {
  const id = "sp-" + path.replace(/\//g, "-"), val = str(getIn(S.data, path));
  const area = /Area$/.test(kind);
  const input = kind === "readonly"
    ? `<input id="${id}" type="text" value="${esc(val)}" readonly aria-readonly="true" class="ro">`
    : area ? `<textarea id="${id}" data-sp="${path}" data-spk="${kind}"${max ? ` data-max="${max}"` : ""}>${esc(val)}</textarea>`
      : `<input id="${id}" type="${kind === "email" ? "email" : kind === "url" ? "url" : "text"}"${kind === "phoneIntl" ? ' inputmode="numeric"' : ""} data-sp="${path}" data-spk="${kind}" value="${esc(val)}"${max ? ` data-max="${max}"` : ""} autocomplete="off">`;
  return `<div class="field"><label for="${id}">${label}${/^req|phoneIntl|email/.test(kind) ? "" : kind === "readonly" ? "" : ' <span class="muted small">(neobavezno)</span>'}</label>${input}
    ${hint || max || area ? `<div class="hint"><span>${hint}</span>${max || area ? `<span data-count>${val.length} znakova${max ? ` (preporuka do ${max})` : ""}</span>` : ""}</div>` : ""}</div>`;
}
function commitSP(el) {
  const path = el.dataset.sp, kind = el.dataset.spk;
  const t = el.value.trim();
  const r = SP_CHECK[kind](t);
  if (r.error) { fieldError(el, r.error); return; }
  fieldError(el, "");
  const cur = getIn(S.data, path) ?? null;
  if ((cur === "" ? null : cur) === r.value) { if (el.value !== (r.value ?? "")) el.value = r.value ?? ""; return; }
  el.value = r.value ?? "";
  const root = path.startsWith("settings/") ? "settings" : path.split("/").slice(0, 2).join("/");
  spWrite(root, path, r.value);
  const sec = SP_SECTIONS().find((s) => s.root === root);
  const sm = $(`#sum-${sec.id}`); if (sm) sm.textContent = spSummary(sec);
}
// Upis polja + updatedAt i updatedBy. Dodatna stranica koje još nema u bazi: prvi upis zapiše
// i ostala polja (zadane vrijednosti), jer Firebase čuva samo ono što se upiše.
const EXTRA_SEED = new Set();
function spWrite(root, path, value) {
  setIn(S.data, path, value);
  setIn(S.data, root + "/updatedAt", Date.now()); setIn(S.data, root + "/updatedBy", S.user.uid);
  const paths = { [path]: value, [root + "/updatedAt"]: S.db.TIMESTAMP, [root + "/updatedBy"]: S.user.uid };
  if (EXTRA_SEED.has(root)) {
    for (const f of EXTRA_FIELDS) { const p = root + "/" + f, v = getIn(S.data, p); if (!(p in paths) && typeof v === "string" && v !== "") paths[p] = v; }
    EXTRA_SEED.delete(root);
  }
  send(paths);
}
function commitExtraStatus(el) {
  spWrite("pages/" + el.dataset.spstatus, `pages/${el.dataset.spstatus}/status`, el.checked ? "objavljeno" : "uskoro");
}
// settings/showWithoutImage: kad polja nema, build ga tretira kao uključeno (true)
function commitShowNoImg(el) {
  const v = el.checked;
  setIn(S.data, "settings/showWithoutImage", v);
  setIn(S.data, "settings/updatedAt", Date.now()); setIn(S.data, "settings/updatedBy", S.user.uid);
  send({ "settings/showWithoutImage": v, "settings/updatedAt": S.db.TIMESTAMP, "settings/updatedBy": S.user.uid });
}
// otvori i pokaži odjeljak Podešavanja (veza sa ekrana Objavi)
function openSettingsSection(id) {
  if (!id) return;
  const d = id === "prikaz" ? $("#sec-prikaz") : $(`details[data-spsec="${id}"]`);
  if (!d) return;
  if (d.tagName === "DETAILS") $$("details[data-spsec]").forEach((x) => (x.open = x === d));
  setTimeout(() => d.scrollIntoView({ block: "start" }), 0);
}
function spMeta(root) {
  const at = num(getIn(S.data, root + "/updatedAt")), by = getIn(S.data, root + "/updatedBy");
  return at ? `Zadnja izmjena: ${NAMES[by] || "nepoznat korisnik"}, ${fmtDate(at)}` : "";
}
function settingsSectionsHtml() {
  let group = "";
  return SP_SECTIONS().map((sec, i) => {
    const head = sec.group && sec.group !== group ? `<h2 class="spgroup">${esc(sec.group)}</h2>` : "";
    group = sec.group || "";
    const st = sec.status ? `<label class="switch"><span>Objavljeno (vidljivo Googleu)<small>Isključeno: stranica je na sajtu i u meniju, ali je Google ne prikazuje i nije u sitemapi.</small></span><input type="checkbox" data-spstatus="${sec.id}"${getIn(S.data, sec.root + "/status") === "objavljeno" ? " checked" : ""}></label>` : "";
    return head + `<details class="sec" data-spsec="${sec.id}"${i === 0 ? " open" : ""}><summary>${sec.title} <small id="sum-${sec.id}">${spSummary(sec)}</small></summary>
    <div class="secbody">${spMeta(sec.root) ? `<p class="hint"><span>${esc(spMeta(sec.root))}</span></p>` : ""}${sec.fields.map(spField).join("")}${st}</div></details>`;
  }).join("");
}

// ------------------------------------------------------------------ Brisanje (Dio 5)
// Prozor za potvrdu (isti izgled kao kartice panela). Esc i klik van prozora ga zatvaraju.
function openModal(html, onOpen) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.className = "modalwrap"; wrap.id = "modal";
  wrap.innerHTML = `<div class="modalbox card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">${html}</div>`;
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-modal-close]")) closeModal(); });
  document.body.appendChild(wrap); document.body.classList.add("modalopen");
  if (onOpen) onOpen(wrap);
  const f = wrap.querySelector("input,button:not([disabled])"); if (f) f.focus();
}
function closeModal() { const m = $("#modal"); if (m) m.remove(); document.body.classList.remove("modalopen"); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#modal")) closeModal(); });

// Brisanja koja čekaju objavu: svako brisanje sorte upiše publish/deletions/<ključ> = {at, by, ref}.
// Brojač na ekranu Objavi (pendingChanges) broji one novije od zadnje objave. (Brisanje slike iz
// biblioteke se ne bilježi ni ne broji: takva slika ne koristi nijedna sorta, pa ni sajt.)

function deleteVarietyDialog(key) {
  const v = V(key); if (!v) return;
  openModal(`<h2 id="modalTitle">Obriši sortu "${esc(v.name)}"</h2>
    <p class="warnbox" style="margin-top:10px">Ovo se ne može vratiti. Linkovi koje si već slao (/sorte/${esc(v.slug || key)}/) prestaju raditi poslije sljedeće objave. Ako nisi siguran, sakrij sortu.</p>
    <p class="muted small">Slike ove sorte ostaju u biblioteci.</p>
    <div class="field"><label for="delName">Upiši naziv sorte: <b>${esc(v.name)}</b></label><input id="delName" type="text" autocomplete="off"></div>
    <div class="endbtns"><button type="button" class="btn ghost" data-modal-close>Odustani</button><button type="button" class="btn primary" id="delGo" disabled>Obriši sortu</button></div>
    <div id="delMsg" role="alert"></div>`, (m) => {
    const inp = m.querySelector("#delName"), go = m.querySelector("#delGo");
    const same = () => inp.value.trim().toLowerCase() === String(v.name).trim().toLowerCase();
    inp.addEventListener("input", () => { go.disabled = !same(); });
    go.addEventListener("click", async () => {
      if (!same()) return;
      go.disabled = true; go.textContent = "Brišem…";
      const dk = S.db.newKey("publish/deletions");
      const rec = { at: S.db.TIMESTAMP, by: S.user.uid, ref: key };
      try {
        await S.db.update({ [`varieties/${key}`]: null, [`publish/deletions/${dk}`]: rec });
      } catch {
        m.querySelector("#delMsg").innerHTML = `<div class="notice bad">Nema veze, sorta nije obrisana. Pokušaj ponovo.</div>`;
        go.disabled = false; go.textContent = "Obriši sortu"; return;
      }
      delete S.data.varieties[key];
      setIn(S.data, `publish/deletions/${dk}`, { ...rec, at: Date.now() });
      if (WIZ.key === key) WIZ.key = "";
      closeModal();
      location.hash = "#/sorte";
      toast("Sorta je obrisana");
    });
  });
}

function imageUsers(id) {
  return Object.entries(S.data.varieties).filter(([, v]) => imgList(v).includes(id)).map(([k, v]) => ({ key: k, name: v.name || k }));
}
function deleteImageDialog(id) {
  const im = S.data.images[id]; if (!im) return;
  const users = imageUsers(id);
  openModal(`<h2 id="modalTitle">Obriši sliku trajno</h2>
    <div class="delimg"><img src="${esc(imgSrc(id))}" alt=""><div><div class="libalt">${esc(im.alt || "(bez opisa)")}</div><div class="hint"><span>${im.w}×${im.h} px</span></div></div></div>
    ${users.length
      ? `<p class="warnbox">Prvo je ukloni sa sorti: ${users.map((u) => `<a href="#/sorta/${encodeURIComponent(u.key)}" data-modal-close>${esc(u.name)}</a>`).join(", ")}</p>`
      : `<p class="warnbox">Ovo se ne može vratiti. Slika se briše iz biblioteke i sa servera (sve 4 veličine).</p>`}
    <div class="endbtns"><button type="button" class="btn ghost" data-modal-close>Odustani</button><button type="button" class="btn primary" id="delImgGo"${users.length ? " disabled" : ""}>Obriši sliku</button></div>
    <div id="delMsg" role="alert"></div>`, (m) => {
    const go = m.querySelector("#delImgGo");
    go.addEventListener("click", async () => {
      if (imageUsers(id).length) return;
      go.disabled = true; go.textContent = "Brišem…";
      const paths = Object.values(im.variants || {}).map((x) => x && x.path).filter(Boolean);
      try {
        for (const p of paths) await S.db.deleteFile(p); // nepostojeći fajl nije greška
        await S.db.update({ [`images/${id}`]: null }); // zapis tek kad su svi fajlovi obrisani
      } catch {
        m.querySelector("#delMsg").innerHTML = `<div class="notice bad">Nije obrisano do kraja, pokušaj ponovo.</div>`;
        go.disabled = false; go.textContent = "Pokušaj ponovo"; return;
      }
      delete S.data.images[id];
      closeModal(); libList(); toast("Slika je obrisana");
    });
  });
}

async function downloadBackup(btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = "Preuzimam…";
  try {
    const text = await S.db.exportData();
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    const name = `vinograd-kopija-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("Kopija je preuzeta: " + name);
  } catch {
    toast("Kopija nije preuzeta: nema veze. Pokušaj ponovo.");
  } finally { btn.disabled = false; btn.textContent = t; }
}

// ------------------------------------------------------------------ usmjeravanje
function route() {
  flushLater();
  if (!location.hash.startsWith("#/objavi")) stopPoll();
  const [path, query] = (location.hash.replace(/^#/, "") || "/").split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  let html, nav = "", after = null;
  switch (parts[0] || "") {
    case "": html = screenHome(); nav = "pocetna"; break;
    case "sorte": html = screenSorte(params); nav = "sorte"; break;
    case "sorta": { const key = decodeURIComponent(parts[1] || ""); html = screenEdit(key); nav = "sorte"; after = () => bindEdit(key); break; }
    case "cijene": html = screenCijene(params); nav = "cijene"; break;
    case "postavke": html = screenPostavke(); after = () => { $("#out3").onclick = () => S.db.signOut(); openSettingsSection(params.get("sec")); }; break;
    case "pomoc": html = screenPomoc(); after = loadPomoc; break;
    case "slike": html = screenSlike(); nav = "slike"; break;
    case "uvoz": html = screenUvoz(params); nav = "slike"; break;
    case "objavi": html = screenObjavi(); nav = "objavi"; after = () => ($("#pubBtn").onclick = doPublish); break;
    case "dodaj": html = screenWizard(parts); nav = "sorte"; break;
    default: html = `${head("Stranica ne postoji")}<p><a class="btn outline" href="#/">Na početnu</a></p>`;
  }
  view().innerHTML = html;
  $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  $$("#nav a").forEach((a) => (a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (after) after();
  window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ pokretanje
async function startApp(user) {
  S.user = user;
  document.body.classList.remove("nonav");
  view().innerHTML = `<p class="loading">Učitavanje podataka…</p>`;
  try {
    const [data, manifest] = await Promise.all([
      S.db.load(),
      fetch("manifest.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    S.data = { ...data, settings: data.settings || {}, varieties: data.varieties || {}, images: data.images || {} };
    S.data.pages = S.data.pages || {};
    for (const x of EXTRA_PAGES) if (!hasContent(S.data.pages[x.id])) { S.data.pages[x.id] = { ...extraPage(null, x.defaults), ...(S.data.pages[x.id] || {}) }; EXTRA_SEED.add("pages/" + x.id); }
    if (manifest) S.manifest = { images: manifest.images || {}, published: manifest.published || [] };
    S.oldFiles = new Set(Object.values(S.manifest.images).flat().map((p) => String(p).split("/").pop()));
  } catch (e) {
    view().innerHTML = `<div class="card"><h1>Podaci se ne mogu učitati</h1><p class="lead">Provjeri vezu s internetom i osvježi stranicu.</p><p class="muted small">${esc(e && (e.code || e.message))}</p></div>`;
    return;
  }
  $("#top").hidden = false; $("#nav").hidden = false;
  // izmjene drugog admina: osvježi podatke, a liste ponovo iscrtaj samo ako se ništa ne kuca
  S.db.watch("varieties", (val) => {
    if (!val) return;
    for (const [k, v] of Object.entries(val)) if (!S.data.varieties[k] || !debounced.size) S.data.varieties[k] = v;
    for (const k of Object.keys(S.data.varieties)) if (!(k in val) && !debounced.size) delete S.data.varieties[k]; // obrisao drugi admin
    const typing = document.activeElement && view().contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    const h = location.hash;
    if (!typing && !uploading && (h === "" || h === "#/" || h.startsWith("#/sorte"))) route();
  });
  S.db.watch("images", (val) => { S.data.images = val || {}; });
  S.db.watch("publish", (val) => { S.data.publish = val || {}; if (location.hash.startsWith("#/objavi")) renderPubInfo(); });
  route();
}

async function boot() {
  S.mock = new URLSearchParams(location.search).get("mock") === "1";
  if (S.mock) { $("#mockBar").hidden = false; document.body.classList.add("mock"); }
  try { S.db = await createDb({ mock: S.mock }); }
  catch (e) {
    showAuth(`<div class="card"><h1>Panel se ne može učitati</h1><p class="lead">Provjeri vezu s internetom i osvježi stranicu.</p><p class="muted small">${esc(e && e.message)}</p></div>`);
    return;
  }
  const v = view();
  v.addEventListener("change", onViewChange);
  v.addEventListener("input", onViewInput);
  v.addEventListener("click", onViewClick);
  window.addEventListener("hashchange", route);
  $("#logout").onclick = () => S.db.signOut();

  let started = false;
  S.db.onAuth(async (user) => {
    if (!user) { started = false; S.user = null; return showLogin(); }
    if (started) return;
    view().innerHTML = `<p class="loading">Provjeravam dozvolu…</p>`;
    if (!(await S.db.isAdmin(user.uid))) return showNoAccess(user);
    started = true;
    startApp(user);
  });
}
boot();
