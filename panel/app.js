// Panel Vinograda Preobraženje (Koraci 3a i 4a).
// Ekrani: prijava, Početna, Sorte, Uređivanje sorte (sa slikama), Cijene i količine,
// Slike (biblioteka i dodavanje), Promijeni lozinku. Objavi i Dodaj sortu su "Uskoro".
import { createDb } from "./db.js";
import { convertImage, canMakeWebp, storagePaths, ACCEPT, NO_WEBP_MSG, WIDTHS } from "./images.js";

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
function setStatus() {
  const bar = $("#saveBar");
  bar.hidden = false;
  if (pending.size && !inflight) {
    bar.innerHTML = `<div class="bad"><span>Nije snimljeno, nema veze. Pokušaj ponovo.</span><button type="button" id="retry">Pokušaj ponovo</button></div>`;
    $("#retry").onclick = retry;
  } else if (inflight) bar.innerHTML = `<div class="busy"><span>Snimam…</span></div>`;
  else bar.innerHTML = `<div class="ok"><span>✓ Snimljeno u nacrt</span><span class="small">Posjetioci vide tek poslije objave</span></div>`;
}
async function send(paths) {
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
  if (el.matches("input[type=file][data-upload]")) return onFilesChosen(el);
  if (el.matches("input[data-imgalt]")) return commitAlt(el);
  if (el.id === "libSorta") { const f = $("#libFile"); f.disabled = !el.value || !S.webp; f.closest("label").setAttribute("aria-disabled", String(f.disabled)); return; }
  if (el.matches("input[data-f][data-v], textarea[data-f][data-v]")) commitInput(el);
  else if (el.matches("input[type=checkbox][data-f]")) {
    const key = el.closest("[data-key]").dataset.key;
    save(key, { [el.dataset.f]: el.checked });
    if (el.dataset.f === "visible") { const hb = $("#hideBtn"); if (hb) hb.textContent = el.checked ? "Sakrij sortu" : "Prikaži sortu"; }
  }
}
function onViewInput(e) {
  const el = e.target;
  const c = el.closest(".field")?.querySelector("[data-count]");
  if (c && (el.tagName === "TEXTAREA" || el.dataset.max)) c.textContent = `${el.value.length} znakova` + (el.dataset.max ? ` (preporuka do ${el.dataset.max})` : "");
}
function onViewClick(e) {
  const b = e.target.closest("button");
  if (!b) return;
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
      <a href="#/dodaj"><i>＋</i><span>Dodaj sortu <small><span class="soon">Uskoro</span></small></span></a>
      <a href="#/cijene"><i>KM</i><span>Cijene i količine</span></a>
      <a href="#/slike"><i>▣</i><span>Dodaj slike</span></a>
      <a href="#/objavi"><i>↑</i><span>Objavi na sajt <small><span class="soon">Uskoro</span></small></span></a>
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
    ${head("Sorte")}
    <input id="q" class="search" type="search" placeholder="Pretraži po nazivu…" aria-label="Pretraži sorte" value="${esc(S.ui.sorteQ)}">
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
  </div>`;
}
function bindEdit(key) {
  const hb = $("#hideBtn");
  if (!hb) return;
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
    ${head("Podešavanja")}
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
    <div class="card"><h2>Prijavljen</h2><p class="muted">${esc(S.user.email)}</p><button type="button" class="btn ghost wide" id="out3">Odjava</button></div>
    <div class="card"><h2>Kontakt i tekstovi stranica</h2><p class="muted">Uređivanje kontakta i tekstova stranica dolazi uskoro.</p></div>`;
}

function screenSoon(title, text) {
  return `${head(title)}<div class="card"><p><span class="soon">Uskoro</span></p><p>${text}</p></div><p><a class="btn outline" href="#/">Nazad na početnu</a></p>`;
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
}
function renderImgBox(key) {
  const box = $("#imgBox"); if (!box) return;
  const v = V(key), list = imgList(v);
  if (!list.length) { box.innerHTML = `<p class="muted">Sorta još nema slika.</p>`; return; }
  box.innerHTML = `<p class="hint"><span>Prva slika je naslovna. Strelicama mijenjaš redoslijed. "Ukloni" sklanja sliku samo sa ove sorte, a slika ostaje u biblioteci.</span></p>` +
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
    <p class="hint"><span>Možeš izabrati više slika odjednom. Svaka se pretvara u 4 veličine i snima jedna po jedna.</span></p>
    <div class="uplist" aria-live="polite"></div>
  </div>`;
}
async function checkWebp() {
  S.webp = await canMakeWebp();
  $$(".nowebp").forEach((w) => (w.hidden = S.webp));
  $$("input[type=file][data-upload]").forEach((inp) => {
    const lib = inp.id === "libFile";
    inp.disabled = !S.webp || (lib && !$("#libSorta").value);
    inp.closest("label").setAttribute("aria-disabled", String(inp.disabled));
  });
}
function onFilesChosen(input) {
  const key = input.dataset.upload || ($("#libSorta") && $("#libSorta").value);
  const files = [...input.files];
  input.value = "";
  if (!files.length || !key || !V(key)) return;
  if (!S.webp) return toast(NO_WEBP_MSG);
  const list = input.closest(".uploader").querySelector(".uplist");
  const ids = files.map((file) => {
    const id = "up" + ++jobSeq;
    uploadJobs.set(id, { file, key });
    list.insertAdjacentHTML("beforeend", `<div class="uprow" id="${id}"><div class="upname">${esc(file.name)}</div><div class="bar"><span style="width:0%"></span></div><div class="upmsg muted small">Čeka…</div></div>`);
    return id;
  });
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
      setRow(id, 0.1 + 0.85 * (before / sum), `Šaljem ${i + 1} od 4…`);
      await S.db.uploadFile(paths[p], vv.blob, vv.type, (f) => setRow(id, 0.1 + 0.85 * ((before + f * sizes[i]) / sum)));
      uploaded.push(paths[p]);
      before += sizes[i];
    }
    // tek kad su sva četiri fajla gore: zapis slike i niz slika sorte u jednom upisu
    const v = V(key);
    const record = {
      alt: "Grozd sorte " + v.name, w: conv.w, h: conv.h,
      variants: Object.fromEntries(parts.map((p) => [p, { path: paths[p], w: conv.variants[p].w, h: conv.variants[p].h }])),
      hash: conv.hash, source: "own", webApproved: false,
      createdAt: S.db.TIMESTAMP, createdBy: S.user.uid,
    };
    const list = [...imgList(v), imageId];
    dbTried = true;
    await S.db.update({
      [`images/${imageId}`]: record,
      [`varieties/${key}/images`]: list,
      [`varieties/${key}/updatedAt`]: S.db.TIMESTAMP,
      [`varieties/${key}/updatedBy`]: S.user.uid,
    });
    S.data.images[imageId] = { ...record, createdAt: Date.now() };
    V(key).images = list; V(key).updatedAt = Date.now(); V(key).updatedBy = S.user.uid;
    uploadJobs.delete(id);
    const kb = (b) => Math.round(b / 1024) + " KB";
    setRow(id, 1, `✓ Snimljeno (${kb(file.size)} → ${kb(sum)} za sve 4 veličine)` + (conv.warnings.length ? `<br><span class="warntext">${esc(conv.warnings.join(" "))}</span>` : ""), conv.warnings.length ? "ok" : "ok");
    refreshImages(key);
    refreshMeta(key);
    if (location.hash.startsWith("#/slike")) libList();
  } catch (e) {
    console.warn("Upload nije uspio:", e && (e.code || e.message));
    // ništa ne smije ostati na pola: obriši poslane fajlove i (ako je upis krenuo) zapis u bazi
    for (const p of uploaded) { try { await S.db.deleteFile(p); } catch { /* ostaje za ručno čišćenje */ } }
    if (dbTried) S.db.update({ [`images/${imageId}`]: null, [`varieties/${key}/images`]: oldList.length ? oldList : null }).catch(() => {});
    setRow(id, 0, `Slika nije snimljena: veza je prekinuta. <button type="button" class="link" data-retry="${id}">Pokušaj ponovo</button>`, "err");
  }
}

// slika koja je već u biblioteci (isti hash) dodaje se sorti bez novog uploada
function attachExisting(b) {
  const imageId = b.dataset.attach, key = b.dataset.attachKey;
  if (!V(key)) return;
  const list = imgList(V(key));
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
        <div class="hint"><span>${im.w}×${im.h} px${im.createdAt ? " · " + esc(fmtDate(im.createdAt)) : ""}</span></div></div>
    </div>`;
  }).join("") : `<p class="empty">${q ? "Nema slika s tim opisom." : "Još nema slika dodanih kroz panel. Starije slike sa sajta vide se kod svake sorte."}</p>`;
}
function screenSlike() {
  setTimeout(() => {
    libList();
    checkWebp();
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
      <p class="hint"><span>Uvoz mnogo slika odjednom po imenu fajla dolazi uskoro.</span></p>
      <div class="uplist" aria-live="polite"></div>
    </div>
    <input id="libQ" class="search" type="search" placeholder="Pretraži po opisu slike…" aria-label="Pretraži slike" value="${esc(S.ui.libQ || "")}">
    <p class="count" id="libCount"></p>
    <div class="libgrid" id="libList"></div>`;
}

// ------------------------------------------------------------------ usmjeravanje
function route() {
  flushLater();
  const [path, query] = (location.hash.replace(/^#/, "") || "/").split("?");
  const params = new URLSearchParams(query || "");
  const parts = path.split("/").filter(Boolean);
  let html, nav = "", after = null;
  switch (parts[0] || "") {
    case "": html = screenHome(); nav = "pocetna"; break;
    case "sorte": html = screenSorte(params); nav = "sorte"; break;
    case "sorta": { const key = decodeURIComponent(parts[1] || ""); html = screenEdit(key); nav = "sorte"; after = () => bindEdit(key); break; }
    case "cijene": html = screenCijene(params); nav = "cijene"; break;
    case "postavke": html = screenPostavke(); after = () => ($("#out3").onclick = () => S.db.signOut()); break;
    case "slike": html = screenSlike(); nav = "slike"; break;
    case "objavi": html = screenSoon("Objavi", "Dugme Objavi dolazi uskoro. Do tada novu verziju sajta pokreće Žarko ručno u Netlifyju (Deploys, Trigger deploy, Deploy site). Sve izmjene iz panela su snimljene u nacrt i ulaze u sljedeću objavu."); nav = "objavi"; break;
    case "dodaj": html = screenSoon("Dodaj sortu", "Dodavanje nove sorte korak po korak dolazi uskoro."); nav = "pocetna"; break;
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
    const typing = document.activeElement && view().contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    const h = location.hash;
    if (!typing && !uploading && (h === "" || h === "#/" || h.startsWith("#/sorte"))) route();
  });
  S.db.watch("images", (val) => { S.data.images = val || {}; });
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
