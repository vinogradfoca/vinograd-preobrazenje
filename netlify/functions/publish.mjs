// Netlify Function: POST /api/publish
// Pokreće novu izgradnju sajta (Netlify build hook), ali samo za prijavljenog admina.
//
// Zahtjev:  POST, zaglavlje Authorization: Bearer <Firebase ID token>
// Odgovor:  200 { ok: true, requestedAt }   (vrijeme servera, ms)
//           401 nema tokena ili token nije ispravan
//           403 prijavljen, ali nije admin
//           405 nije POST
//           429 objava je pokrenuta prije manje od 30 s
//           500 funkcija nije podešena (nedostaje varijabla okruženja)
//           502 Identity Toolkit ili build hook nije odgovorio kako treba
//
// Varijable okruženja (Netlify → Site configuration → Environment variables, scope Functions):
//   FIREBASE_API_KEY   javni web API ključ Firebase projekta
//   ADMIN_UIDS         UID-ovi admina odvojeni zarezom
//   DEPLOY_HOOK_URL    build hook (tajna: nikad se ne vraća ni ne ispisuje)
//
// Token se provjerava preko Google Identity Toolkita (accounts:lookup), bez vlastite kriptografije.

const LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const MIN_GAP_MS = 30 * 1000; // Netlify hook: najviše jedna objava na 30 s (u okviru jedne instance funkcije)
let lastPublishAt = 0;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export default async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });

  const apiKey = process.env.FIREBASE_API_KEY;
  const hook = process.env.DEPLOY_HOOK_URL;
  const admins = String(process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !hook || !admins.length) {
    console.error("publish: nedostaje FIREBASE_API_KEY, DEPLOY_HOOK_URL ili ADMIN_UIDS");
    return json(500, { ok: false, error: "config" });
  }

  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return json(401, { ok: false, error: "no-token" });

  // 1) ko je to: Identity Toolkit vraća korisnika samo za važeći, neistekao token
  let uid;
  try {
    const r = await fetch(`${LOOKUP}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: m[1] }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.status === 400 || r.status === 401) return json(401, { ok: false, error: "bad-token" });
    if (!r.ok) { console.error("publish: Identity Toolkit HTTP", r.status); return json(502, { ok: false, error: "auth-service" }); }
    const data = await r.json();
    uid = data && Array.isArray(data.users) && data.users[0] && data.users[0].localId;
  } catch (e) {
    console.error("publish: Identity Toolkit nedostupan:", e && e.name);
    return json(502, { ok: false, error: "auth-service" });
  }
  if (!uid) return json(401, { ok: false, error: "bad-token" });

  // 2) da li je admin
  if (!admins.includes(uid)) return json(403, { ok: false, error: "not-admin" });

  // 3) ne češće od jednom na 30 s
  const now = Date.now();
  if (now - lastPublishAt < MIN_GAP_MS) {
    return json(429, { ok: false, error: "too-soon", retryAfter: Math.ceil((MIN_GAP_MS - (now - lastPublishAt)) / 1000) });
  }

  // 4) build hook (adresa se nigdje ne vraća ni ne ispisuje)
  try {
    const h = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(15000) });
    if (!h.ok) { console.error("publish: build hook HTTP", h.status); return json(502, { ok: false, error: "hook" }); }
  } catch (e) {
    console.error("publish: build hook nedostupan:", e && e.name);
    return json(502, { ok: false, error: "hook" });
  }
  lastPublishAt = now;
  return json(200, { ok: true, requestedAt: now });
};

export const config = { path: "/api/publish" };
