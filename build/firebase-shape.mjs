// Pretvara data/seed.json (vinograd) u oblik koji se čuva u Firebase bazi:
// ključ sorte = slug, slike = nazivi fajlova, bez null i praznih objekata/nizova,
// čvor images prazan (do Koraka 4), opis naslovne slike u pages/home/heroAlt.
// Koriste ga build/export-firebase.mjs (uvoz u bazu) i build (panel/mock-data.json).

// Izbacuje null i prazne objekte/nizove (Firebase ih ne čuva).
export function clean(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c !== undefined) o[k] = c;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

// db = seed.vinograd. Baca Error s jasnom porukom kad podaci nisu potpuni.
export function toFirebaseShape(db) {
  if (!db || !db.settings || !db.pages || !db.varieties) throw new Error("data/seed.json mora imati vinograd.settings, pages i varieties");
  const images = db.images || {};
  const fileOf = (id, where) => {
    const im = images[id];
    if (!im || !im.file) throw new Error(`${where}: slika "${id}" nema fajl u images/`);
    return im.file;
  };

  const pages = JSON.parse(JSON.stringify(db.pages));
  if (pages.home && pages.home.heroImage) {
    const id = pages.home.heroImage;
    pages.home.heroImage = fileOf(id, "pages/home.heroImage");
    pages.home.heroAlt = images[id].alt || "";
  }

  const varieties = {};
  for (const [key, v] of Object.entries(db.varieties)) {
    if (!v || !v.slug) throw new Error(`varieties/${key}: nema slug`);
    if (varieties[v.slug]) throw new Error(`slug "${v.slug}" se ponavlja`);
    varieties[v.slug] = { ...v, images: (v.images || []).map((id) => fileOf(id, `varieties/${key}.images`)) };
  }

  return { ...clean({ settings: db.settings, pages, varieties }), images: {} };
}
