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

  /* ---------- traka pri dnu: Pošalji upit i Podijeli (stranica sorte) ---------- */
  var barUpit = $("#barUpit");
  if (barUpit) barUpit.addEventListener("click", function () { openPanel(cartEl, $("#cartBtn")); });
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
      loadData().then(function () { addToCart(id, kind, qty); }, function () { toast("Upit trenutno nije dostupan. Nazovite nas."); });
      return;
    }
    var x = byId(id); if (!x) return;
    var o = x[kind]; if (!orderable(o)) return;
    var it = find(id, kind);
    if (!it) { it = { id: id, kind: kind, qty: 0 }; cart.push(it); }
    it.qty += qty;
    if (o.qty !== null) it.qty = Math.min(it.qty, o.qty);
    saveCart(); renderCart();
    toast(x.name + " (" + KIND[kind].toLowerCase() + ") je dodan u upit");
  }
  function setQty(id, kind, q) {
    var it = find(id, kind); if (!it) return;
    var o = byId(id)[kind];
    if (q <= 0) cart = cart.filter(function (i) { return i !== it; });
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
    var box = $("#cartItems");
    if (cart.length && !MAP) { $("#cartFoot").hidden = true; box.innerHTML = '<div class="empty">Učitavanje upita…</div>'; return; }
    if (!cart.length) {
      box.innerHTML = '<div class="empty">Upit je prazan.<br><a href="/sorte/" class="btn outline">Pogledajte sorte</a></div>';
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
      if (cart.length) $("#cartItems").innerHTML = '<div class="empty">Upit trenutno nije dostupan. Pokušajte ponovo ili nas nazovite.</div>';
    });
  }
  if (cart.length) ensureData();
  $("#cartBtn").addEventListener("click", function () { if (!MAP) ensureData(); });

  /* ---------- stranica sorte: galerija i narudžba ---------- */
  var main = $("#mainImg");
  $$(".thumbs button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.srcset) main.srcset = b.dataset.srcset; else main.removeAttribute("srcset");
      main.src = b.dataset.src; main.width = +b.dataset.w; main.height = +b.dataset.h; main.alt = b.dataset.alt;
      $$(".thumbs button").forEach(function (o) { o.classList.toggle("on", o === b); });
    });
  });
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
    loadData().catch(function () {}); // da "Dodaj u upit" radi odmah
  }

  /* ---------- katalog: filteri samo skrivaju kartice koje su već u HTML-u ---------- */
  var grid = $("#catalogGrid");
  if (grid) {
    var cards = $$("#catalogGrid .card");
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
    var filter = function () {
      var q = val("search").trim().toLowerCase(), c = val("fColor"), r = val("fRipen"), ty = val("fType");
      var fa = document.getElementById("fAvail"), a = !!(fa && fa.checked), n = 0;
      cards.forEach(function (el) {
        var d = el.dataset;
        var ok = (!q || d.name.indexOf(q) !== -1) && (!c || d.color === c) && (!r || d.ripen === r) && (!ty || d.type === ty) && (!a || d.avail === "1");
        el.hidden = !ok; if (ok) n++;
      });
      $("#resultCount").textContent = n + " od " + cards.length + " sorti";
      $("#noResults").hidden = n > 0;
    };
    $("#filters").hidden = false;
    ["search", "fColor", "fRipen", "fType", "fAvail"].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.addEventListener("input", filter);
    });
    filter();
  }

  /* ---------- cjenovnik: pretraga ---------- */
  var ps = $("#priceSearch");
  if (ps) {
    ps.hidden = false;
    ps.addEventListener("input", function () {
      var q = ps.value.trim().toLowerCase();
      $$("#priceList .prow").forEach(function (r) { r.hidden = !!q && r.dataset.name.indexOf(q) === -1; });
    });
  }
})();
