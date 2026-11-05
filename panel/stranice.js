// Dodatne stranice (Zaštita vinove loze, Vinjak Preobraženje): zadane vrijednosti i pravilo
// dopunjavanja. Koriste ih build (stranice na sajtu) i panel (Podešavanja → Dodatne stranice).
// Čiste funkcije bez DOM-a.
//
// Podaci: vinograd/pages/<id> = { eyebrow, title, subtitle, intro, note, label, status }
//   intro: odlomci razdvojeni praznim redom; status: "uskoro" (noindex, nije u sitemapi) ili "objavljeno".
// Ako stranice nema u bazi, koriste se zadane vrijednosti. Firebase ne čuva prazne vrijednosti, pa
// kad stranica postoji, prazno neobavezno polje znači "bez toga", a obavezna (naslov, tekst) se dopune.

export const EXTRA_FIELDS = ["eyebrow", "title", "subtitle", "intro", "note", "label", "status"];

export const EXTRA_PAGES = [
  {
    id: "zastita", route: "/zastita-vinove-loze/", menu: "Zaštita vinove loze",
    defaults: {
      eyebrow: "ISKUSTVA IZ VINOGRADA",
      title: "Zaštita vinove loze",
      subtitle: "Praktična zaštita kroz sezonu",
      intro: "U ovom dijelu objavljivaćemo lična iskustva o preventivnoj zaštiti, plamenjači, pepelnici, sivoj truleži, terminima tretiranja i zaštiti grozdova od ptica i osa.",
      note: "Savjete uvijek primjenjujte u skladu sa uputstvom proizvođača preparata i uslovima u svom vinogradu.",
      label: "",
      status: "uskoro",
    },
  },
  {
    id: "vinjak", route: "/vinjak/", menu: "Vinjak Preobraženje",
    defaults: {
      eyebrow: "",
      title: "Vinjak Preobraženje",
      subtitle: "",
      intro: "Od grožđa sa našeg terena nastaje proizvod koji nosi karakter planine, rijeke i vinograda.",
      note: "",
      label: "U pripremi",
      status: "uskoro",
    },
  },
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// Ima li čvor u bazi ijedno polje sadržaja (ne računaju se updatedAt i updatedBy)
export const hasContent = (raw) => isObj(raw) && EXTRA_FIELDS.some((k) => typeof raw[k] === "string" && raw[k].trim() !== "");

// Sirovi čvor iz baze (ili undefined) → potpun zapis stranice
export function extraPage(raw, defaults) {
  if (!hasContent(raw)) return { ...defaults };
  const t = (k) => (typeof raw[k] === "string" ? raw[k].trim() : "");
  return {
    eyebrow: t("eyebrow"), title: t("title") || defaults.title, subtitle: t("subtitle"),
    intro: t("intro") || defaults.intro, note: t("note"), label: t("label"),
    status: raw.status === "objavljeno" ? "objavljeno" : "uskoro",
  };
}

// Tekst → odlomci (prazan red = novi odlomak; jedan prelom reda ostaje razmak)
export const paragraphs = (text) => String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
