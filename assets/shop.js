/* Vinograd Preobraženje: meni, korpa, filteri kataloga, pretraga cjenovnika i galerija.
   Sadržaj stranica je već u HTML-u. Ovaj kod samo dodaje interakciju. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var KM = function (n) { return n.toFixed(2).replace(".", ",") + " KM"; };
  var KIND = { sapling: "Sadnica", cutting: "Reznica" };

  // Kontakt prodavnice je u stranici; naziv, cijena i stanje svih sorti su u jednom
  // keširanom JSON fajlu (data-cart), koji se učitava jednom po posjeti.
  var shopEl = $("#vp-shop");
  var SHOP = {};
  try { SHOP = JSON.parse(shopEl.textContent); } catch (e) {}
  var MAP = null, loading = null;
  function loadData() {
    if (!loading) {
      loading = fetch(shopEl.getAttribute("data-cart"))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (list) { MAP = {}; list.forEach(function (x) { MAP[x.id] = x; }); })
        .catch(function () { loading = null; MAP = MAP || null; throw new Error("korpa"); });
    }
    return loading;
  }
  var byId = function (id) { return MAP && Object.prototype.hasOwnProperty.call(MAP, id) ? MAP[id] : null; };
  var orderable = function (o) { return !!o && o.enabled && (o.qty === null || o.qty > 0); };

  /* ---------- meni, korpa, overlay ---------- */
  var drawer = $("#drawer"), cartEl = $("#cart"), overlay = $("#overlay");
  function closeAll() {
    drawer.classList.remove("open"); cartEl.classList.remove("open"); overlay.classList.remove("on");
    document.body.classList.remove("lock");
    $("#menuBtn").setAttribute("aria-expanded", "false"); $("#cartBtn").setAttribute("aria-expanded", "false");
  }
  function openPanel(el, btn) {
    el.classList.add("open"); overlay.classList.add("on"); document.body.classList.add("lock");
    btn.setAttribute("aria-expanded", "true");
  }
  $("#menuBtn").addEventListener("click", function () { openPanel(drawer, this); });
  $("#cartBtn").addEventListener("click", function () { openPanel(cartEl, this); });
  $("#closeMenu").addEventListener("click", closeAll);
  $("#cartClose").addEventListener("click", closeAll);
  overlay.addEventListener("click", closeAll);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });

  var tt;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(tt); tt = setTimeout(function () { t.classList.remove("on"); }, 2200);
  }

  /* ---------- traka pri dnu stranice sorte: Podijeli, WhatsApp i glavno dugme ---------- */
  // Prazna korpa: "Dodaj u korpu" vodi na odjeljak "Naručite" (fokus na prvu varijantu).
  // Korpa sa stavkama: "Pošalji narudžbu (N)" otvara ladicu korpe.
  var barUpit = $("#barUpit");
  if (barUpit) barUpit.addEventListener("click", function () {
    if (cart.length) { openPanel(cartEl, $("#cartBtn")); return; }
    var ord = $(".order"); if (!ord) return;
    ord.scrollIntoView({ block: "center" });
    var first = $(".order [data-add]");
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
  });
  function updateBar() {
    if (!barUpit) return;
    barUpit.textContent = cart.length ? "Pošalji narudžbu (" + cart.length + ")" : "Dodaj u korpu";
    if (cart.length) barUpit.setAttribute("aria-controls", "cart"); else barUpit.removeAttribute("aria-controls");
  }
  var barShare = $("#barShare");
  if (barShare) barShare.addEventListener("click", function () {
    var d = barShare.dataset, url = d.url || location.href;
    var copied = function () { toast("Link je kopiran"); };
    var copy = function () {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(copied, fallback);
      else fallback();
    };
    var fallback = function () { window.prompt("Kopirajte link:", url); };
    if (navigator.share) {
      navigator.share({ title: d.title || document.title, text: d.text || "", url: url }).catch(function (e) {
        if (!e || e.name !== "AbortError") copy();
      });
    } else copy();
  });

  /* ---------- korpa (localStorage) ---------- */
  var CART_KEY = "vp-cart-v1";
  var cart = [];
  try {
    cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]").filter(function (i) {
      return i && typeof i.id === "string" && KIND[i.kind] && i.qty > 0;
    });
  } catch (e) { cart = []; }
  // kad stignu podaci, izbaci stavke koje više ne postoje ili se ne mogu poručiti
  function cleanCart() {
    var before = cart.length;
    cart = cart.filter(function (i) { var x = byId(i.id); return x && orderable(x[i.kind]); });
    if (cart.length !== before) saveCart();
  }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }
  function find(id, kind) {
    for (var i = 0; i < cart.length; i++) if (cart[i].id === id && cart[i].kind === kind) return cart[i];
    return null;
  }
  function addToCart(id, kind, qty) {
    if (!MAP) {
      loadData().then(function () { addToCart(id, kind, qty); }, function () { toast("Korpa trenutno nije dostupna. Nazovite nas."); });
      return;
    }
    var x = byId(id); if (!x) return;
    var o = x[kind]; if (!orderable(o)) return;
    var it = find(id, kind);
    if (!it) { it = { id: id, kind: kind, qty: 0 }; cart.push(it); }
    it.qty += qty;
    if (o.qty !== null) it.qty = Math.min(it.qty, o.qty);
    saveCart(); renderCart();
    toast("Dodano u korpu: " + x.name + " (" + KIND[kind].toLowerCase() + ")");
  }
  function setQty(id, kind, q) {
    var it = find(id, kind); if (!it) return;
    var x = byId(id), o = x[kind];
    if (q <= 0) { cart = cart.filter(function (i) { return i !== it; }); toast(x.name + " (" + KIND[kind].toLowerCase() + ") uklonjena je iz korpe."); }
    else it.qty = o.qty !== null ? Math.min(q, o.qty) : q;
    saveCart(); renderCart();
  }
  function cartTotals() {
    var total = 0, unpriced = 0;
    cart.forEach(function (i) {
      var o = byId(i.id)[i.kind];
      if (o.price == null) unpriced++; else total += o.price * i.qty;
    });
    return { total: total, unpriced: unpriced };
  }
  // Narudžbenica kao običan tekst (WhatsApp i mejl). Sve vrijednosti dolaze iz upita i
  // iz settings (naziv, telefon, mejl, adresa); ništa se ne dodaje.
  function newRef(d) {
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = "";
    var rnd = new Uint32Array(4);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(rnd);
    else for (var k = 0; k < 4; k++) rnd[k] = Math.floor(Math.random() * 4294967296);
    for (var i = 0; i < 4; i++) r += abc.charAt(rnd[i] % abc.length);
    return "UP-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + r;
  }
  function buildMessage(ref, d) {
    var name = $("#cName").value.trim(), phone = $("#cPhone").value.trim();
    var email = $("#cEmail").value.trim(), note = $("#cNote").value.trim();
    var L = [];
    L.push("UPIT / NARUDŽBENICA");
    if (SHOP.name) L.push(SHOP.name);
    L.push("");
    L.push("Datum: " + d.getDate() + ". " + (d.getMonth() + 1) + ". " + d.getFullYear() + ".");
    L.push("Broj upita: " + ref);
    L.push("");
    L.push("KUPAC");
    L.push("Ime i prezime: " + name);
    L.push("Telefon: " + phone);
    if (email) L.push("E-mail: " + email);
    if (note) L.push("Napomena: " + note);
    L.push("");
    L.push("STAVKE");
    var total = 0, allPriced = true;
    cart.forEach(function (i, n) {
      var x = byId(i.id), o = x[i.kind];
      var line = (n + 1) + ". " + x.name + " – " + KIND[i.kind].toLowerCase() + " – " + i.qty + " kom";
      if (o.price != null) { line += " × " + KM(o.price) + " = " + KM(o.price * i.qty); total += o.price * i.qty; }
      else allPriced = false;
      L.push(line);
    });
    L.push("");
    L.push(allPriced ? "UKUPNO: " + KM(total) : "Cijenu potvrđujemo u odgovoru.");
    L.push("");
    L.push("KONTAKT");
    if (SHOP.name) L.push(SHOP.name);
    if (SHOP.phone) L.push("Telefon: " + SHOP.phone);
    if (SHOP.email) L.push("E-mail: " + SHOP.email);
    if (SHOP.address) L.push("Adresa: " + SHOP.address);
    return L.join("\n");
  }
  function renderCart() {
    $("#cartCount").textContent = cart.reduce(function (a, i) { return a + i.qty; }, 0);
    updateBar();
    var box = $("#cartItems");
    if (cart.length && !MAP) { $("#cartFoot").hidden = true; box.innerHTML = '<div class="empty">Učitavanje korpe…</div>'; return; }
    if (!cart.length) {
      box.innerHTML = '<div class="empty">Korpa je prazna.<br><a href="/sorte/" class="btn outline">Pogledajte sorte</a></div>';
      $("#cartFoot").hidden = true; return;
    }
    $("#cartFoot").hidden = false;
    box.innerHTML = cart.map(function (i) {
      var x = byId(i.id), o = x[i.kind];
      var a = ' data-id="' + esc(x.id) + '" data-k="' + i.kind + '"';
      var pic = x.img ? '<img src="' + esc(x.img) + '" alt="" width="64" height="80" loading="lazy">' : '<span class="cimg noimg ' + esc(x.c || "x") + '" aria-hidden="true"></span>';
      return '<div class="citem">' + pic + '<div class="cinfo"><b><a href="' + esc(x.url) + '">' + esc(x.name) + '</a></b><small>' + KIND[i.kind] + " · " + (o.price != null ? KM(o.price * i.qty) : "cijena na upit") + "</small>" +
        '<div class="stepper"><button type="button" data-q="-1"' + a + ' aria-label="Manje">−</button><span>' + i.qty + '</span><button type="button" data-q="1"' + a + ' aria-label="Više">+</button></div></div>' +
        '<button type="button" class="rm" data-q="0"' + a + ' aria-label="Ukloni">×</button></div>';
    }).join("");
    var t = cartTotals();
    $("#total").textContent = (t.total === 0 && t.unpriced) ? "Po upitu" : KM(t.total);
    $("#totalNote").textContent = t.unpriced ? "Za " + t.unpriced + " stavk" + (t.unpriced === 1 ? "u" : "e") + " cijenu potvrđujemo u odgovoru." : "";
  }
  $("#cartItems").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-q]");
    if (!b) return;
    var it = find(b.dataset.id, b.dataset.k); if (!it) return;
    var d = +b.dataset.q;
    setQty(it.id, it.kind, d === 0 ? 0 : it.qty + d);
  });
  // Ime i telefon su obavezni; telefon najmanje 6 cifara (blaga provjera), mejl nije obavezan.
  var ERR_EMPTY = "Upišite ime i telefon da bismo vam se javili.";
  var ERR_PHONE = "Provjerite broj telefona: potrebno je najmanje 6 cifara.";
  var phoneDigits = function (v) { return (v.match(/\d/g) || []).length; };
  function markField(el, bad) {
    el.classList.toggle("bad", bad);
    if (bad) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
  }
  function validateSend(e) {
    var n = $("#cName"), p = $("#cPhone");
    var nameBad = !n.value.trim(), phoneEmpty = !p.value.trim(), phoneBad = phoneEmpty || phoneDigits(p.value) < 6;
    markField(n, nameBad); markField(p, phoneBad);
    var msg = nameBad || phoneEmpty ? ERR_EMPTY : phoneBad ? ERR_PHONE : "";
    var box = $("#cartErr");
    box.textContent = "";
    if (!msg) return true;
    e.preventDefault();
    // ponovo upisan tekst da ga čitač ekrana pročita i kad je ista poruka
    setTimeout(function () { box.textContent = msg; }, 30);
    var first = nameBad ? n : p;
    first.scrollIntoView({ block: "start", behavior: "smooth" });
    try { first.focus({ preventScroll: true }); } catch (x) { first.focus(); }
    return false;
  }
  ["cName", "cPhone"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", function () {
      if (!this.classList.contains("bad")) return;
      var ok = id === "cName" ? !!this.value.trim() : phoneDigits(this.value) >= 6;
      if (ok) markField(this, false);
      if (!$("#cartFoot .bad")) $("#cartErr").textContent = "";
    });
  });
  $("#sendWa").addEventListener("click", function (e) {
    if (!validateSend(e)) return;
    var d = new Date();
    this.href = "https://wa.me/" + SHOP.phoneIntl + "?text=" + encodeURIComponent(buildMessage(newRef(d), d));
  });
  $("#sendMail").addEventListener("click", function (e) {
    if (!validateSend(e)) return;
    var d = new Date(), ref = newRef(d);
    this.href = "mailto:" + SHOP.email + "?subject=" + encodeURIComponent("Upit / narudžbenica " + ref + (SHOP.name ? " – " + SHOP.name : "")) + "&body=" + encodeURIComponent(buildMessage(ref, d).replace(/\n/g, "\r\n"));
  });
  // korpa otvorena u drugoj kartici
  window.addEventListener("storage", function (e) {
    if (e.key !== CART_KEY) return;
    try { cart = JSON.parse(e.newValue || "[]").filter(function (i) { return i && KIND[i.kind] && i.qty > 0; }); } catch (x) { cart = []; }
    if (MAP) cleanCart();
    renderCart();
  });
  renderCart();
  // podaci se učitavaju odmah samo ako korpa nije prazna; inače pri prvom otvaranju ili dodavanju
  function ensureData() {
    loadData().then(function () { cleanCart(); renderCart(); }, function () {
      if (cart.length) $("#cartItems").innerHTML = '<div class="empty">Korpa trenutno nije dostupna. Pokušajte ponovo ili nas nazovite.</div>';
    });
  }
  if (cart.length) ensureData();
  $("#cartBtn").addEventListener("click", function () { if (!MAP) ensureData(); });

  /* ---------- stranica sorte: galerija (scroll-snap) i cijeli ekran ---------- */
  var gTrack = $("#gTrack");
  if (gTrack) (function () {
    var slides = $$("#gTrack .slide"), n = slides.length, thumbBox = $("#gThumbs");
    var thumbs = thumbBox ? $$("#gThumbs button") : [], gNum = $("#gallery .gnum"), cur = 0;
    // cilj dok glatko pomjeranje traje: brzi uzastopni dodiri na strelicu idu dalje, ne na istu sliku
    var want = new WeakMap(), wantT = 0;
    var base = function (track, now) { var w = want.get(track); return w == null ? now : w; };
    var indexOf = function (track) { return track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0; };
    var goTo = function (track, i, smooth) {
      i = Math.max(0, Math.min(n - 1, i));
      if (smooth) { want.set(track, i); clearTimeout(wantT); wantT = setTimeout(function () { want.delete(track); }, 1200); }
      else want.delete(track);
      track.scrollTo({ left: i * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    };
    // aktivna sličica: oznaka i pomjeranje u vidljivi dio reda (samo vodoravno, stranica se ne pomjera)
    var mark = function (i) {
      cur = i;
      if (gNum) gNum.textContent = i + 1;
      thumbs.forEach(function (t, k) { t.classList.toggle("on", k === i); if (k === i) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current"); });
      var t = thumbs[i];
      if (t && thumbBox) thumbBox.scrollTo({ left: t.offsetLeft - thumbBox.offsetLeft - (thumbBox.clientWidth - t.offsetWidth) / 2, behavior: "smooth" });
    };
    var onScroll = function (track, cb) {
      var raf = 0;
      track.addEventListener("scroll", function () {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; var i = indexOf(track); if (want.get(track) === i && Math.abs(track.scrollLeft - i * track.clientWidth) < 2) want.delete(track); cb(i); });
      }, { passive: true });
    };
    onScroll(gTrack, function (i) { if (i !== cur) mark(i); });
    thumbs.forEach(function (t, k) { t.addEventListener("click", function () { goTo(gTrack, k, true); }); });
    var arrows = function (root, track, getCur) {
      var p = root.querySelector(".garrow.prev"), nx = root.querySelector(".garrow.next");
      if (p) p.addEventListener("click", function () { goTo(track, getCur() - 1, true); });
      if (nx) nx.addEventListener("click", function () { goTo(track, getCur() + 1, true); });
    };
    arrows($("#gallery .gview"), gTrack, function () { return base(gTrack, cur); });
    gTrack.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(gTrack, base(gTrack, cur) - 1, true); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(gTrack, base(gTrack, cur) + 1, true); }
    });

    // Cijeli ekran: sloj preko stranice (role="dialog"), ne Fullscreen API. Dugme "nazad" na
    // telefonu zatvara sloj: pri otvaranju se doda zapis u istoriju (pushState), a popstate zatvara.
    var fullBtn = $("#gFull"), lb = null, lbCur = 0;
    var closeLb = function (fromHistory) {
      if (!lb) return;
      if (!fromHistory && history.state && history.state.vpGallery) { history.back(); return; } // popstate zatvara
      var at = lbCur;
      lb.remove(); lb = null;
      document.body.classList.remove("lbopen");
      document.removeEventListener("keydown", lbKeys, true);
      goTo(gTrack, at, false); mark(at);
      if (fullBtn) fullBtn.focus();
    };
    var lbKeys = function (e) {
      if (!lb) return;
      var t = lb.querySelector(".lbtrack");
      if (e.key === "Escape") { e.preventDefault(); closeLb(false); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(t, base(t, lbCur) - 1, true); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goTo(t, base(t, lbCur) + 1, true); }
      else if (e.key === "Tab") { // fokus ostaje u sloju
        var f = $$(".lb button"); if (!f.length) return;
        var i = f.indexOf(document.activeElement);
        e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
      }
    };
    var openLb = function () {
      if (lb) return;
      var start = cur, name = $("#gallery").dataset.name || "";
      lb = document.createElement("div");
      lb.className = "lb"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Fotografije sorte " + name);
      lb.innerHTML = '<div class="lbtrack" tabindex="-1">' + slides.map(function (s, k) {
        var im = s.querySelector("img"), set = im.getAttribute("srcset");
        return '<figure class="slide"><img src="' + esc(s.dataset.big || im.getAttribute("src")) + '"' + (set ? ' srcset="' + esc(set) + '" sizes="100vw"' : "") +
          ' alt="' + esc(im.getAttribute("alt") || "") + '"' + (k === start ? "" : ' loading="lazy"') + "></figure>";
      }).join("") + "</div>" +
        (n > 1 ? '<button type="button" class="garrow prev" aria-label="Prethodna slika">‹</button><button type="button" class="garrow next" aria-label="Sljedeća slika">›</button>' : "") +
        '<span class="gcount" aria-live="polite"><span class="gnum">' + (start + 1) + "</span> / " + n + "</span>" +
        '<button type="button" class="lbclose" aria-label="Zatvori">×</button>';
      document.body.appendChild(lb);
      document.body.classList.add("lbopen");
      var t = lb.querySelector(".lbtrack"), num = lb.querySelector(".gnum");
      lbCur = start; goTo(t, start, false);
      onScroll(t, function (i) { lbCur = i; num.textContent = i + 1; });
      arrows(lb, t, function () { return base(t, lbCur); });
      lb.querySelector(".lbclose").addEventListener("click", function () { closeLb(false); });
      document.addEventListener("keydown", lbKeys, true);
      try { history.pushState({ vpGallery: 1 }, ""); } catch (e) { /* bez istorije: zatvara se dugmetom */ }
      lb.querySelector(".lbclose").focus();
    };
    if (fullBtn) fullBtn.addEventListener("click", openLb);
    window.addEventListener("popstate", function () { if (lb) closeLb(true); });
    // širina se promijenila (okretanje telefona): ostani na istoj slici
    window.addEventListener("resize", function () { goTo(gTrack, cur, false); if (lb) goTo(lb.querySelector(".lbtrack"), lbCur, false); });
  })();
  var order = $(".order[data-id]");
  if (order) {
    var vid = order.dataset.id, qty = { sapling: 1, cutting: 1 };
    order.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      if (t.dataset.add) { addToCart(vid, t.dataset.add, qty[t.dataset.add]); return; }
      if (t.dataset.d) {
        var st = t.closest(".stepper"), k = st.dataset.k, max = st.getAttribute("data-max");
        var q = Math.max(1, qty[k] + (+t.dataset.d));
        if (max) q = Math.min(q, +max);
        qty[k] = q; st.querySelector("span").textContent = q;
      }
    });
    loadData().catch(function () {}); // da "Dodaj u korpu" radi odmah
  }

  /* ---------- pretraga po nazivu: isto poređenje za katalog i cjenovnik ---------- */
  // Mala slova, bez kvačica (č ć → c, š → s, ž → z), đ → "dj" ili "d", a razmaci, crtice
  // i ostali znakovi se zanemaruju. Traži se samo po nazivu sorte.
  var fold = function (s) {
    s = String(s || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s;
  };
  var squash = function (s) { return s.replace(/[^a-z0-9]+/g, ""); };
  // dvije varijante naziva: đ kao "dj" i kao "d" (npr. Đurđevka: "djurdjevka" i "durdevka")
  var nameKeys = function (name) { var f = fold(name); return [squash(f.replace(/đ/g, "dj")), squash(f.replace(/đ/g, "d"))]; };
  var queryKey = function (q) { return squash(fold(q).replace(/đ/g, "dj")); };
  var nameMatches = function (keys, q) { return !q || keys[0].indexOf(q) !== -1 || keys[1].indexOf(q) !== -1; };
  var noResultsText = function (raw, withFilters) {
    return "Nema sorti za '" + raw + "'. Pokušajte drugi naziv" + (SHOP.phone ? " ili pozovite " + SHOP.phone : "") + "." +
      (withFilters ? " Provjerite i izabrane filtere." : "");
  };
  // telefon: dok polje za pretragu ima fokus, traka Pozovi/WhatsApp se skloni (CSS: body.searching)
  var phoneMQ = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };

  /* ---------- katalog: filteri samo skrivaju kartice koje su već u HTML-u ---------- */
  var grid = $("#catalogGrid");
  if (grid) {
    var cards = $$("#catalogGrid .card");
    var keys = cards.map(function (el) { return nameKeys(el.dataset.name); });
    var FKEY = "vp-katalog-v1", FIELDS = ["search", "fColor", "fRipen", "fType", "fAvail"];
    var field = function (id) { return document.getElementById(id); };
    var val = function (id) { var el = field(id); return el ? el.value : ""; };
    var noRes = $("#noResults"), noResDefault = noRes.textContent, clearBtn = $("#searchClear");
    var filtersEl = $("#filters"), fToggle = $("#fToggle"), fReset = $("#fReset");
    var searchEl = field("search"), quick = $("#quickList"), QUICK_MAX = 6;
    var phone = phoneMQ;
    var showGrid = false; // "Prikaži sve" ili Enter: mreža do sljedećeg fokusa na polju
    var filter = function () {
      var raw = val("search").trim(), q = queryKey(raw), c = val("fColor"), r = val("fRipen"), ty = val("fType");
      var fa = field("fAvail"), a = !!(fa && fa.checked), n = 0;
      cards.forEach(function (el, i) {
        var d = el.dataset;
        var ok = nameMatches(keys[i], q) && (!c || d.color === c) && (!r || d.ripen === r) && (!ty || d.type === ty) && (!a || d.avail === "1");
        el.hidden = !ok; if (ok) n++;
      });
      $("#resultCount").textContent = n + " od " + cards.length + " sorti";
      noRes.hidden = n > 0;
      noRes.textContent = raw ? noResultsText(raw, !!(c || r || ty || a)) : noResDefault;
      if (clearBtn) clearBtn.hidden = !val("search");
      // dugme "Filteri (N)" na telefonu: broj aktivnih filtera
      var active = (c ? 1 : 0) + (r ? 1 : 0) + (ty ? 1 : 0) + (a ? 1 : 0);
      if (fToggle) fToggle.textContent = active ? "Filteri (" + active + ")" : "Filteri";
      renderQuick(n, raw, q);
    };
    // Dio označen u nazivu: poklapanje se traži u obliku bez kvačica i razmaka, pa se vraća na slova naziva
    var highlight = function (name, q) {
      if (!q) return esc(name);
      for (var v = 0; v < 2; v++) {
        var map = [], flat = "";
        for (var i = 0; i < name.length; i++) {
          var f = fold(name.charAt(i));
          f = squash(v === 0 ? f.replace(/đ/g, "dj") : f.replace(/đ/g, "d"));
          for (var j = 0; j < f.length; j++) map.push(i);
          flat += f;
        }
        var at = flat.indexOf(q);
        if (at === -1) continue;
        var s = map[at], e = map[at + q.length - 1] + 1;
        return esc(name.slice(0, s)) + "<mark>" + esc(name.slice(s, e)) + "</mark>" + esc(name.slice(e));
      }
      return esc(name);
    };
    // telefon: dok polje ima fokus i tekst, rezultati su kompaktna lista (prvih 6) umjesto mreže
    var renderQuick = function (n, raw, q) {
      var on = phone.matches && !showGrid && raw && document.activeElement === searchEl;
      grid.hidden = !!on;
      if (!on) { quick.hidden = true; quick.innerHTML = ""; return; }
      var rows = [];
      for (var i = 0; i < cards.length && rows.length < QUICK_MAX; i++) {
        var el = cards[i]; if (el.hidden) continue;
        var img = el.querySelector(".ph img"), ph = el.querySelector(".noimg");
        var name = el.querySelector("h3").textContent, line = (el.querySelector(".cline") || {}).textContent || "";
        var pic = img
          ? '<img class="qimg" src="' + esc(img.getAttribute("src")) + '"' + (img.getAttribute("srcset") ? ' srcset="' + esc(img.getAttribute("srcset")) + '" sizes="56px"' : "") + ' width="56" height="56" alt="" loading="lazy">'
          : '<span class="qimg ' + esc(ph ? ph.className.replace("noimg", "").trim() : "") + '" aria-hidden="true">' + esc(name.charAt(0)) + "</span>";
        rows.push('<a class="qrow" href="' + esc(el.getAttribute("href")) + '">' + pic + '<span class="qtext"><b>' + highlight(name, q) + "</b>" + (line ? "<small>" + esc(line) + "</small>" : "") + "</span></a>");
      }
      quick.innerHTML = n
        ? rows.join("") + (n > QUICK_MAX ? '<button type="button" class="btn outline qmore" id="quickAll">Prikaži sve (' + n + ")</button>" : "")
        : '<p class="qempty" role="status">' + esc(noRes.textContent) + "</p>";
      quick.hidden = false;
    };
    // zatvori tastaturu i pokaži običnu mrežu s rezultatima
    var toGrid = function () {
      showGrid = true;
      searchEl.blur();
      document.body.classList.remove("searching");
      filter();
      var top = $("#resultCount").getBoundingClientRect().top + window.pageYOffset - (phone.matches ? 76 + searchBox.offsetHeight + 8 : 90);
      window.scrollTo(0, Math.max(0, top));
    };
    // telefon: polje odmah ispod zaglavlja, a lista rezultata odmah ispod polja
    var searchBox = $(".search-box"), fmeta = $(".fmeta");
    var toSearchTop = function () {
      if (!phone.matches || document.activeElement !== searchEl) return;
      var top = fmeta.getBoundingClientRect().top + window.pageYOffset - searchBox.offsetHeight - 8 - 76;
      window.scrollTo(0, Math.max(0, top));
    };
    // pretraga i filteri se pamte u ovoj kartici pregledača (povratak sa stranice sorte)
    var save = function () {
      var st = {};
      FIELDS.forEach(function (id) { var el = field(id); if (el) st[id] = el.type === "checkbox" ? el.checked : el.value; });
      try { sessionStorage.setItem(FKEY, JSON.stringify(st)); } catch (e) {}
    };
    var restore = function () {
      var st = null;
      try { st = JSON.parse(sessionStorage.getItem(FKEY) || "null"); } catch (e) {}
      if (!st) return;
      FIELDS.forEach(function (id) {
        var el = field(id); if (!el || !(id in st)) return;
        if (el.type === "checkbox") el.checked = !!st[id];
        else if (el.tagName !== "SELECT" || [].some.call(el.options, function (o) { return o.value === st[id]; })) el.value = st[id];
      });
    };
    $("#filters").hidden = false;
    FIELDS.forEach(function (id) {
      var el = field(id); if (el) el.addEventListener("input", function () { filter(); save(); });
    });
    if (clearBtn) clearBtn.addEventListener("click", function () {
      var s = field("search"); s.value = ""; filter(); save(); s.focus();
    });
    // telefon (do 720 px): filteri su u sklopivom odjeljku, zatvoreno zadano
    if (fToggle) fToggle.addEventListener("click", function () {
      var open = !filtersEl.classList.contains("fopen");
      filtersEl.classList.toggle("fopen", open);
      fToggle.setAttribute("aria-expanded", String(open));
    });
    if (fReset) fReset.addEventListener("click", function () {
      ["fColor", "fRipen", "fType"].forEach(function (id) { var el = field(id); if (el) el.value = ""; });
      var fa = field("fAvail"); if (fa) fa.checked = false;
      filter(); save();
    });
    if (quick) {
      quick.addEventListener("click", function (e) { if (e.target.closest("#quickAll")) toGrid(); });
      searchEl.addEventListener("focus", function () {
        showGrid = false;
        if (phone.matches) document.body.classList.add("searching");
        filter(); toSearchTop();
      });
      // kratko čekanje: dodir na red liste stigne do veze prije nego što se lista skloni
      searchEl.addEventListener("blur", function () {
        setTimeout(function () { if (document.activeElement !== searchEl) { document.body.classList.remove("searching"); filter(); } }, 250);
      });
      // Enter / "Traži" na tastaturi: zatvori tastaturu i pokaži rezultate
      searchEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); toGrid(); } });
      // tastatura mijenja visinu prozora: polje ostaje pri vrhu
      if (window.visualViewport) window.visualViewport.addEventListener("resize", toSearchTop);
      if (phone.addEventListener) phone.addEventListener("change", filter);
    }
    restore();
    filter();
    // pregledač može vratiti vrijednosti polja tek poslije učitavanja, ili stranicu iz keša
    window.addEventListener("pageshow", function () { restore(); filter(); });
  }

  /* ---------- cjenovnik: pretraga (isto poređenje kao katalog) ---------- */
  var ps = $("#priceSearch");
  if (ps) {
    var pBox = $("#priceSearchBox"), pClear = $("#priceClear"), pEmpty = $("#priceEmpty");
    var pRows = $$("#priceList .prow");
    var pKeys = pRows.map(function (r) { return nameKeys(r.dataset.name); });
    var pFilter = function () {
      var raw = ps.value.trim(), q = queryKey(raw), n = 0;
      pRows.forEach(function (r, i) { var ok = nameMatches(pKeys[i], q); r.hidden = !ok; if (ok) n++; });
      pEmpty.hidden = n > 0;
      pEmpty.textContent = n ? "" : noResultsText(raw, false);
      pClear.hidden = !ps.value;
    };
    pBox.hidden = false;
    ps.addEventListener("input", pFilter);
    pClear.addEventListener("click", function () { ps.value = ""; pFilter(); ps.focus(); });
    // Enter / "Traži" zatvara tastaturu
    ps.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); ps.blur(); } });
    // telefon: polje se postavi odmah ispod zaglavlja, da redovi ostanu iznad tastature
    var pToTop = function () {
      if (!phoneMQ.matches || document.activeElement !== ps) return;
      window.scrollTo(0, Math.max(0, pBox.getBoundingClientRect().top + window.pageYOffset - 76 - 8));
    };
    ps.addEventListener("focus", function () {
      if (phoneMQ.matches) document.body.classList.add("searching");
      pToTop();
    });
    // kratko čekanje: dodir na "Očisti" vraća fokus u polje, pa se traka ne pojavi ispod prsta
    ps.addEventListener("blur", function () {
      setTimeout(function () { if (document.activeElement !== ps) document.body.classList.remove("searching"); }, 250);
    });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", pToTop);
    pFilter();
    // pregledač može vratiti tekst u polju pri povratku na stranicu
    window.addEventListener("pageshow", pFilter);
  }
})();
