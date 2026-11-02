// Sloj za podatke panela. Isto sučelje u dvije izvedbe:
//   - firebase: prava baza i prijava (Firebase JS SDK 13.1.0 sa gstatic.com)
//   - mock:     /panel/?mock=1, podaci u memoriji iz mock-data.json, bez prijave
//
// Sučelje:
//   mode                       "firebase" | "mock"
//   onAuth(cb)                 cb(user | null), user = { uid, email }
//   signIn(email, password)
//   resetPassword(email)
//   changePassword(current, next)
//   signOut()
//   isAdmin(uid)               true ako je admins/<uid> === true
//   load()                     cijeli čvor vinograd (jednom)
//   watch(path, cb)            prati čvor vinograd/<path>, vraća funkciju za prekid
//   update(paths)              multi-path update; ključevi su putanje ispod vinograd/
//                              (npr. "varieties/viktor/sapling/price"), null briše polje
//   TIMESTAMP                  vrijednost za "vrijeme na serveru" (updatedAt)
//   newImageId()               novi push-ključ iz vinograd/images
//   newKey(path)               novi push-ključ ispod vinograd/<path> (npr. publish/history)
//   getIdToken()               Firebase ID token prijavljenog korisnika (za /api/publish)
//   findImageByHash(hash)      imageId slike s istim SHA-256 ili null
//   uploadFile(path, blob, contentType, onProgress)   upload u Storage (onProgress(0..1))
//   deleteFile(path)           brisanje iz Storagea (nepostojeći fajl nije greška)
//   fileUrl(path)              javna adresa fajla iz Storagea
//   exportData()               cijeli čvor vinograd kao JSON tekst (GET <databaseURL>/vinograd.json)
//
// Snimanje uvijek ide putanjama do polja, nikad cijeli objekat sorte.

const SDK = "https://www.gstatic.com/firebasejs/13.1.0/";
const SAVE_TIMEOUT = 12000; // ms; bez odgovora servera snimanje se smatra neuspjelim

export async function createDb({ mock }) {
  return mock ? createMock() : createFirebase();
}

// ------------------------------------------------------------------ Firebase
async function createFirebase() {
  const [appMod, authMod, dbMod, stMod] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-database.js"),
    import(SDK + "firebase-storage.js"),
  ]);
  const cfg = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  // prijava traje dok je kartica otvorena; lozinka se nikad ne čuva
  await authMod.setPersistence(auth, authMod.browserSessionPersistence);
  const db = dbMod.getDatabase(app);
  const { ref, get, update, onValue, serverTimestamp, push, query, orderByChild, equalTo } = dbMod;
  const storage = stMod.getStorage(app);
  const bucket = cfg.storageBucket;

  const withTimeout = (p) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), SAVE_TIMEOUT)),
  ]);

  return {
    mode: "firebase",
    TIMESTAMP: serverTimestamp(),
    onAuth(cb) {
      return authMod.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email || "" } : null));
    },
    signIn: (email, password) => authMod.signInWithEmailAndPassword(auth, email, password),
    resetPassword: (email) => authMod.sendPasswordResetEmail(auth, email),
    async changePassword(current, next) {
      const u = auth.currentUser;
      if (!u) throw Object.assign(new Error("not signed in"), { code: "auth/no-current-user" });
      const cred = authMod.EmailAuthProvider.credential(u.email, current);
      await authMod.reauthenticateWithCredential(u, cred);
      await authMod.updatePassword(u, next);
    },
    signOut: () => authMod.signOut(auth),
    async isAdmin(uid) {
      try { return (await get(ref(db, "admins/" + uid))).val() === true; } catch { return false; }
    },
    async load() {
      return (await get(ref(db, "vinograd"))).val() || {};
    },
    watch(path, cb) {
      return onValue(ref(db, "vinograd/" + path), (snap) => cb(snap.val()));
    },
    update: (paths) => withTimeout(update(ref(db, "vinograd"), paths)),
    newImageId: () => push(ref(db, "vinograd/images")).key,
    newKey: (path) => push(ref(db, "vinograd/" + path)).key,
    getIdToken: () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.reject(Object.assign(new Error("odjavljen"), { code: "auth/no-current-user" }))),
    async findImageByHash(hash) {
      const snap = await get(query(ref(db, "vinograd/images"), orderByChild("hash"), equalTo(hash)));
      const v = snap.val();
      return v ? Object.keys(v)[0] : null;
    },
    uploadFile(path, blob, contentType, onProgress = () => {}) {
      return new Promise((resolve, reject) => {
        const task = stMod.uploadBytesResumable(stMod.ref(storage, path), blob, {
          contentType,
          cacheControl: "public,max-age=31536000,immutable", // imageId je jedinstven, fajl se nikad ne mijenja
        });
        task.on("state_changed", (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve());
      });
    },
    async deleteFile(path) {
      try { await stMod.deleteObject(stMod.ref(storage, path)); }
      catch (e) { if (e && e.code !== "storage/object-not-found") throw e; }
    },
    fileUrl: (path) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`,
    async exportData() {
      const r = await fetch(cfg.databaseURL.replace(/\/+$/, "") + "/vinograd.json", { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { code: "http-" + r.status });
      return await r.text();
    },
  };
}

// ------------------------------------------------------------------ mock
async function createMock() {
  const res = await fetch("mock-data.json", { cache: "no-store" });
  if (!res.ok) throw new Error("mock-data.json se ne može učitati (" + res.status + ")");
  const data = await res.json();
  const user = { uid: "probni-korisnik", email: "probni@primjer.ba" };
  const TIMESTAMP = { ".sv": "timestamp" };
  // window.panelMock.failNext = true: sljedeće snimanje padne (za provjeru poruke "Nije snimljeno")
  // failUploadAfter = n: poslije n uspješnih uploada sljedeći padne (provjera prekida na pola)
  const ctl = (window.panelMock = { failNext: false, failUploadAfter: null, writes: [], data, files: new Map(), uploads: 0 });
  let idCounter = 0;
  const listeners = [];

  const setPath = (path, value) => {
    const parts = path.split("/").filter(Boolean);
    let o = data;
    for (const k of parts.slice(0, -1)) {
      if (o[k] == null || typeof o[k] !== "object") { if (value === null) return; o[k] = {}; }
      o = o[k];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete o[last];
    else o[last] = JSON.parse(JSON.stringify(value));
  };
  const getPath = (path) => path.split("/").filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    mode: "mock",
    TIMESTAMP,
    onAuth(cb) { setTimeout(() => cb(user), 0); return () => {}; },
    signIn: async () => user,
    resetPassword: async () => {},
    async changePassword(current) {
      await wait(300);
      // simulacija: "pogresna-lozinka" glumi pogrešnu trenutnu lozinku, sve ostalo prolazi
      if (current === "pogresna-lozinka") throw Object.assign(new Error("wrong"), { code: "auth/invalid-credential" });
    },
    signOut: async () => { location.href = "./?mock=1"; },
    isAdmin: async () => true,
    load: async () => JSON.parse(JSON.stringify(data)),
    watch(path, cb) { listeners.push({ path, cb }); return () => {}; },
    // Storage u memoriji: blob URL-ovi, ništa ne ide na server
    newImageId: () => "-probna" + Date.now().toString(36) + (idCounter++).toString(36),
    newKey: () => "-probni" + Date.now().toString(36) + (idCounter++).toString(36),
    getIdToken: async () => "probni-token",
    async findImageByHash(hash) {
      const imgs = data.images || {};
      return Object.keys(imgs).find((k) => imgs[k] && imgs[k].hash === hash) || null;
    },
    async uploadFile(path, blob, contentType, onProgress = () => {}) {
      for (const f of [0.3, 0.7]) { await wait(40); onProgress(f); }
      if (ctl.failUploadAfter !== null && ctl.uploads >= ctl.failUploadAfter) {
        ctl.failUploadAfter = null;
        throw Object.assign(new Error("mock: veza prekinuta"), { code: "storage/retry-limit-exceeded" });
      }
      ctl.uploads++;
      const old = ctl.files.get(path);
      if (old) URL.revokeObjectURL(old.url);
      ctl.files.set(path, { url: URL.createObjectURL(blob), type: contentType, size: blob.size, cacheControl: "public,max-age=31536000,immutable" });
      onProgress(1);
    },
    async deleteFile(path) {
      // failDelete = "og.jpg": brisanje tog fajla padne (provjera "Nije obrisano do kraja")
      if (ctl.failDelete && path.endsWith("/" + ctl.failDelete)) { ctl.failDelete = null; throw Object.assign(new Error("mock: brisanje palo"), { code: "storage/unknown" }); }
      const f = ctl.files.get(path);
      if (f) { URL.revokeObjectURL(f.url); ctl.files.delete(path); }
    },
    fileUrl: (path) => (ctl.files.get(path) || {}).url || "",
    exportData: async () => JSON.stringify(data),
    async update(paths) {
      await wait(150);
      if (ctl.failNext) { ctl.failNext = false; throw Object.assign(new Error("mock: nema veze"), { code: "timeout" }); }
      const now = Date.now();
      const resolve = (v) => (v && typeof v === "object"
        ? (v[".sv"] === "timestamp" ? now : Array.isArray(v) ? v.map(resolve) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)])))
        : v);
      for (const [p, v] of Object.entries(paths)) setPath(p, resolve(v));
      ctl.writes.push(paths);
      for (const l of listeners) l.cb(JSON.parse(JSON.stringify(getPath(l.path) ?? null)));
    },
  };
}
