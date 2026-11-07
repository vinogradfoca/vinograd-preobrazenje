// Pokretanje: node tests/template.test.mjs
// build/template.mjs: {{text …}} (tekst iz baze) escapira HTML i umotava brojeve telefona u <span class="nowrap">.
import { createEngine, wrapPhones, escapeHtml } from "../build/template.mjs";

const ok = (c, m) => { console.log((c ? "PROŠLO" : "PALO  ") + " " + m); if (!c) process.exitCode = 1; };
const S = (x) => `<span class="nowrap">${x}</span>`;
const cases = [
  ["Nazovite 065/592-120 i pomoći ćemo.", `Nazovite ${S("065/592-120")} i pomoći ćemo.`],
  ["065 592 120", S("065 592 120")],
  ["065/592 120 ili 065 592-120", `${S("065/592 120")} ili ${S("065 592-120")}`],
  ["Iz inostranstva: +387 65 592 120.", `Iz inostranstva: ${S("+387 65 592 120")}.`],
  ["+387 65 592-120, +387/65/592-120", `${S("+387 65 592-120")}, ${S("+387/65/592-120")}`],
  ["(065/592-120)", `(${S("065/592-120")})`],
  ["fiksni 058/211-1234", `fiksni ${S("058/211-1234")}`],
  ["1065/592-120 i 065/592-1200 0", "1065/592-120 i " + S("065/592-1200") + " 0"],
  ["datum 2026/123-456", "datum 2026/123-456"],
  ["100–110 dana, 700–1000 g", "100–110 dana, 700–1000 g"],
  ["38765592120", "38765592120"],
];
for (const [inp, want] of cases) { const got = wrapPhones(escapeHtml(inp)); ok(got === want, `${JSON.stringify(inp)} → ${got}`); }

const eng = createEngine((n) => ({
  t: "<p>{{text a}}</p><p>{{a}}</p><i title=\"{{a}}\"></i>{{#each l}}<b>{{text this}}</b>{{/each}}<u>{{text}}</u>",
}[n]));
const out = eng.render("t", { a: "Pozovite <b>065/592-120</b> & \"mi\"", l: ["065 592 120"], text: "obična promjenljiva" });
ok(out.startsWith(`<p>Pozovite &lt;b&gt;${S("065/592-120")}&lt;/b&gt; &amp; &quot;mi&quot;</p>`), "{{text}}: prvo escapira HTML iz baze, pa umota telefon");
ok(out.includes(`<p>Pozovite &lt;b&gt;065/592-120&lt;/b&gt;`), "{{a}}: bez umotavanja (kao i prije)");
ok(out.includes(`title="Pozovite &lt;b&gt;065/592-120&lt;/b&gt; &amp; &quot;mi&quot;"`), "atribut: bez <span>");
ok(out.includes(`<b>${S("065 592 120")}</b>`), "{{text this}} u {{#each}}");
ok(out.includes("<u>obična promjenljiva</u>"), "{{text}} bez argumenta je obična promjenljiva \"text\"");
let err = ""; try { createEngine(() => "{{text nema}}").render("x", {}); } catch (e) { err = e.message; }
ok(/nepoznata vrijednost "nema"/.test(err), "{{text nepoznato}} je greška, kao {{nepoznato}}");
