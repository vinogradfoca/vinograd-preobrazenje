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
//
// Snimanje uvijek ide putanjama do polja, nikad cijeli objekat sorte.

const SDK = "https://www.gstatic.com/firebasejs/13.1.0/";
const SAVE_TIMEOUT = 12000; // ms; bez odgovora servera snimanje se smatra neuspjelim

export async function createDb({ mock }) {
  return mock ? createMock() : createFirebase();
}

// ------------------------------------------------------------------ Firebase
async function createFirebase() {
  const [appMod, authMod, dbMod] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-database.js"),
  ]);
  const cfg = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
  const app = appMod.initializeApp(cfg);
  const auth = authMod.getAuth(app);
  // prijava traje dok je kartica otvorena; lozinka se nikad ne čuva
  await authMod.setPersistence(auth, authMod.browserSessionPersistence);
  const db = dbMod.getDatabase(app);
  const { ref, get, update, onValue, serverTimestamp } = dbMod;

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
  const ctl = (window.panelMock = { failNext: false, writes: [], data });
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
    async update(paths) {
      await wait(150);
      if (ctl.failNext) { ctl.failNext = false; throw Object.assign(new Error("mock: nema veze"), { code: "timeout" }); }
      for (const [p, v] of Object.entries(paths)) setPath(p, v && v[".sv"] === "timestamp" ? Date.now() : v);
      ctl.writes.push(paths);
      for (const l of listeners) l.cb(JSON.parse(JSON.stringify(getPath(l.path) ?? null)));
    },
  };
}
