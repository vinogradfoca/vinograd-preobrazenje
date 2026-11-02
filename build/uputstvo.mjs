// Uputstvo za panel (docs/uputstvo-za-panel.md) u HTML za ekran Pomoć u panelu.
// Podržano samo ono što fajl koristi: "# " naslov (preskače se), "## " odjeljci,
// pasusi, liste "1. " i "- ", **podebljano**, *kurziv* i `kod`. Sav tekst se escapuje.
import { escapeHtml } from "./template.mjs";

const inline = (s) => escapeHtml(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
  .replace(/\*([^*]+)\*/g, "<i>$1</i>");

// → { sections: [{ title, html }], html }  (html: <details> po odjeljku, prvi otvoren)
export function uputstvoHtml(md) {
  const sections = [];
  let cur = null, para = [], list = null;
  const flushPara = () => { if (para.length && cur) cur.parts.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const flushList = () => { if (list && cur) cur.parts.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of String(md).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^#\s/.test(line)) { flush(); continue; }
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { flush(); cur = { title: h[1].trim(), parts: [] }; sections.push(cur); continue; }
    if (!line) { flush(); continue; }
    const ol = /^\d+\.\s+(.+)$/.exec(line), ul = /^[-*]\s+(.+)$/.exec(line);
    if (ol || ul) {
      flushPara();
      const tag = ol ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((ol || ul)[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flush();
  const out = sections.map((s) => ({ title: s.title, html: s.parts.join("\n") }));
  const html = out.map((s, i) => `<details class="sec"${i === 0 ? " open" : ""}><summary>${inline(s.title)}</summary><div class="secbody">\n${s.html}\n</div></details>`).join("\n");
  return { sections: out, html };
}
