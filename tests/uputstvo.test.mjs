// Pokretanje: node tests/uputstvo.test.mjs
// Uputstvo (docs/uputstvo-za-panel.md) u HTML za ekran Pomoć + nazivi dugmadi iz uputstva postoje u panelu.
import fs from "node:fs";
import { uputstvoHtml } from "../build/uputstvo.mjs";
const ok = (c, m) => { console.log((c ? "PROŠLO" : "PALO  ") + " " + m); if (!c) process.exitCode = 1; };
const md = fs.readFileSync(new URL("../docs/uputstvo-za-panel.md", import.meta.url), "utf8");
const panel = ["../panel/app.js", "../panel/index.html"].map((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");

const { sections, html } = uputstvoHtml(md);
const titles = md.split("\n").filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
ok(sections.length === titles.length && sections.length >= 10, `odjeljaka: ${sections.length} (u fajlu "##": ${titles.length})`);
ok(sections.every((s, i) => s.title === titles[i]), "naslovi odjeljaka su isti kao u fajlu, istim redom");
ok((html.match(/<details/g) || []).length === sections.length && (html.match(/<details[^>]* open/g) || []).length === 1, "jedan <details> po odjeljku, prvi otvoren");
ok(!/\*\*|`/.test(html), "nema ostataka markdowna (** i `)");
ok(!html.includes("# Kako se koristi panel"), "naslov fajla (#) nije u sadržaju");
ok(/<ol><li>Na <b>Početnoj<\/b> dodirni <b>Dodaj sortu<\/b>\.<\/li>/.test(html), "numerisana lista i podebljanje");
ok(html.includes("<code>vinograd-preobrazenje.pages.dev/panel/</code>"), "`kod` postaje <code>");
ok(html.includes("<i>na upit</i>"), "*kurziv* postaje <i>");
const t = uputstvoHtml("## A <b>&\nTekst <script>x</script> **B**");
ok(t.html.includes("A &lt;b&gt;&amp;") && t.html.includes("&lt;script&gt;") && t.html.includes("<b>B</b>"), "HTML iz fajla se escapuje");
ok(sections.map((s) => s.html).join("").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").includes("Za pomoć javi Žarku."), "tekst na kraju fajla je sačuvan");

// nazivi dugmadi i natpisa koje uputstvo spominje, a postoje u panelu tačno ovako
const NAMES = ["Objavi", "Vidljiva na sajtu", "Zaboravljena lozinka", "Početna", "Sorte", "Cijene", "Slike", "Podešavanja", "Odjava",
  "Dodaj sortu", "Spremi sortu", "Snimljeno u nacrt", "Gotovo", "Nije snimljeno", "Pokušaj ponovo", "Dodaj slike", "Ukloni",
  "Uvoz po imenu", "Sakrij sortu", "Obriši sortu", "Obriši sliku trajno", "Preuzmi kopiju podataka", "Objavi na sajt",
  "Objavljuje se…", "Objava ovog mjeseca", "Kopiraj link", "Podijeli", "Promijeni lozinku", "Prikaži na sajtu sorte bez slike",
  "Kontakt", "Početna stranica", "Kako naručiti", "O nama i kontakt (stranica)"];
const missMd = NAMES.filter((n) => !md.includes(n)), missPanel = NAMES.filter((n) => !panel.includes(n));
ok(!missMd.length, "svi nazivi su u uputstvu" + (missMd.length ? ": nema " + missMd.join(", ") : ""));
ok(!missPanel.length, "svi nazivi postoje u panelu" + (missPanel.length ? ": nema " + missPanel.join(", ") : ""));
ok(/Snimi \$\{n\}/.test(panel) && md.includes("**Snimi N slika**"), "dugme uvoza: \"Snimi N slika\"");
ok(panel.includes('"↗ " + label') && md.includes("**↗ Podijeli**"), "dugme u uređivanju: \"↗ Podijeli\"");
ok(/WIZ_STEPS = \["Naziv i boja", "Slike", "Cijena i količina", "Opis i iskustvo", "Pregled"\]/.test(panel) && md.includes("**Korak 5 (pregled):**"), "pet koraka nove sorte kao u uputstvu");
