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

  var DATA = { shop: {}, varieties: [] };
  try { DATA = JSON.parse($("#vp-data").textContent); } catch (e) {}
  var SHOP = DATA.shop;
  var byId = function (id) {
    for (var i = 0; i < DATA.varieties.length; i++) if (DATA.varieties[i].id === id) return DATA.varieties[i];
    return null;
  };
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

  /* ---------- korpa (localStorage) ---------- */
  var CART_KEY = "vp-cart-v1";
  var cart = [];
  try {
    cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]").filter(function (i) {
      var x = byId(i.id); return x && KIND[i.kind] && orderable(x[i.kind]) && i.qty > 0;
    });
  } catch (e) { cart = []; }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }
  function find(id, kind) {
    for (var i = 0; i < cart.length; i++) if (cart[i].id === id && cart[i].kind === kind) return cart[i];
    return null;
  }
  function addToCart(id, kind, qty) {
    var x = byId(id); if (!x) return;
    var o = x[kind]; if (!orderable(o)) return;
    var it = find(id, kind);
    if (!it) { it = { id: id, kind: kind, qty: 0 }; cart.push(it); }
    it.qty += qty;
    if (o.qty !== null) it.qty = Math.min(it.qty, o.qty);
    saveCart(); renderCart();
    toast(x.name + " (" + KIND[kind].toLowerCase() + ") je u korpi");
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
  function buildMessage() {
    var name = $("#cName").value.trim(), phone = $("#cPhone").value.trim(), note = $("#cNote").value.trim();
    var t = cartTotals();
    var m = "Zdravo, želim da pošaljem upit za narudžbu:\n\n";
    cart.forEach(function (i) {
      var x = byId(i.id), o = x[i.kind];
      m += "• " + x.name + " – " + KIND[i.kind].toLowerCase() + " × " + i.qty + (o.price != null ? " (" + KM(o.price * i.qty) + ")" : " (cijena na upit)") + "\n";
    });
    if (t.total > 0) m += "\nUkupno" + (t.unpriced ? " (bez stavki na upit)" : "") + ": " + KM(t.total) + "\n";
    if (note) m += "\nNapomena: " + note + "\n";
    m += "\nIme: " + name + "\nTelefon: " + phone;
    return m;
  }
  function renderCart() {
    $("#cartCount").textContent = cart.reduce(function (a, i) { return a + i.qty; }, 0);
    var box = $("#cartItems");
    if (!cart.length) {
      box.innerHTML = '<div class="empty">Korpa je prazna.<br><a href="/sorte/" class="btn outline">Pogledajte sorte</a></div>';
      $("#cartFoot").hidden = true; return;
    }
    $("#cartFoot").hidden = false;
    box.innerHTML = cart.map(function (i) {
      var x = byId(i.id), o = x[i.kind];
      var a = ' data-id="' + esc(x.id) + '" data-k="' + i.kind + '"';
      return '<div class="citem"><img src="' + esc(x.img) + '" alt="" width="64" height="80" loading="lazy"><div class="cinfo"><b><a href="' + esc(x.url) + '">' + esc(x.name) + '</a></b><small>' + KIND[i.kind] + " · " + (o.price != null ? KM(o.price * i.qty) : "cijena na upit") + "</small>" +
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
  function validateSend(e) {
    var ok = $("#cName").value.trim() && $("#cPhone").value.trim();
    $("#cartErr").textContent = ok ? "" : "Upišite ime i telefon da bismo vam se javili.";
    if (!ok) { e.preventDefault(); return false; }
    return true;
  }
  $("#sendWa").addEventListener("click", function (e) {
    if (!validateSend(e)) return;
    this.href = "https://wa.me/" + SHOP.phoneIntl + "?text=" + encodeURIComponent(buildMessage());
  });
  $("#sendMail").addEventListener("click", function (e) {
    if (!validateSend(e)) return;
    this.href = "mailto:" + SHOP.email + "?subject=" + encodeURIComponent("Upit za narudžbu – " + SHOP.name) + "&body=" + encodeURIComponent(buildMessage());
  });
  // korpa otvorena u drugoj kartici
  window.addEventListener("storage", function (e) {
    if (e.key !== CART_KEY) return;
    try { cart = JSON.parse(e.newValue || "[]").filter(function (i) { return byId(i.id) && KIND[i.kind]; }); } catch (x) { cart = []; }
    renderCart();
  });
  renderCart();

  /* ---------- stranica sorte: galerija i narudžba ---------- */
  var main = $("#mainImg");
  $$(".thumbs button").forEach(function (b) {
    b.addEventListener("click", function () {
      main.src = b.dataset.src; main.width = +b.dataset.w; main.height = +b.dataset.h; main.alt = b.dataset.alt;
      $$(".thumbs button").forEach(function (o) { o.classList.toggle("on", o === b); });
    });
  });
  var order = $(".order[data-id]");
  if (order) {
    var vid = order.dataset.id, qty = { sapling: 1, cutting: 1 };
    order.addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      var x = byId(vid); if (!x) return;
      if (t.dataset.d) {
        var st = t.closest(".stepper"), k = st.dataset.k, o = x[k];
        var q = Math.max(1, qty[k] + (+t.dataset.d));
        if (o.qty !== null) q = Math.min(q, o.qty);
        qty[k] = q; st.querySelector("span").textContent = q;
      } else if (t.dataset.add) {
        addToCart(vid, t.dataset.add, qty[t.dataset.add]);
      }
    });
  }

  /* ---------- katalog: filteri samo skrivaju kartice koje su već u HTML-u ---------- */
  var grid = $("#catalogGrid");
  if (grid) {
    var cards = $$("#catalogGrid .card");
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
    var filter = function () {
      var q = val("search").trim().toLowerCase(), c = val("fColor"), r = val("fRipen"), ty = val("fType");
      var a = $("#fAvail").checked, n = 0;
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
