// Cloudflare Pages Function: POST /api/publish (putanju daje sam fajl: functions/api/publish.js)
// Pokreće novu izgradnju sajta (Cloudflare Pages deploy hook), ali samo za prijavljenog admina.
//
// Zahtjev:  POST, zaglavlje Authorization: Bearer <Firebase ID token>
// Odgovor:  200 { ok: true, requestedAt }   (vrijeme servera, ms)
//           401 nema tokena ili token nije ispravan
//           403 prijavljen, ali nije admin (ili je nalog isključen u Firebaseu)
//           405 GET (ostale metode Cloudflare ne prosljeđuje ovoj funkciji)
//           429 objava je pokrenuta prije manje od 30 s
//           500 funkcija nije podešena (nedostaje varijabla okruženja)
//           502 Identity Toolkit ili deploy hook nije odgovorio kako treba
//
// Varijable (Cloudflare Pages projekat → Settings → varijable i tajne, za Production):
//   FIREBASE_API_KEY   javni web API ključ Firebase projekta
//   ADMIN_UIDS         UID-ovi admina odvojeni zarezom
//   DEPLOY_HOOK_URL    deploy hook (tajna: nikad se ne vraća ni ne ispisuje)
//
// Token se provjerava preko Google Identity Toolkita (accounts:lookup), bez vlastite kriptografije.

const LOOKUP = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
const MIN_GAP_MS = 30 * 1000; // najviše jedna objava na 30 s (u okviru jedne instance funkcije)
let lastPublishAt = 0;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

export function onRequestGet() {
  return json(405, { ok: false, error: "method" });
}

export async function onRequestPost(context) {
  const req = context.request, env = context.env || {};
  const apiKey = env.FIREBASE_API_KEY;
  const hook = env.DEPLOY_HOOK_URL;
  const admins = String(env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKey || !hook || !admins.length) {
    console.error("publish: nedostaje FIREBASE_API_KEY, DEPLOY_HOOK_URL ili ADMIN_UIDS");
    return json(500, { ok: false, error: "config" });
  }

  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) return json(401, { ok: false, error: "no-token" });

  // 1) ko je to: Identity Toolkit vraća korisnika samo za važeći, neistekao token
  let uid, disabled = false;
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
    const u = data && Array.isArray(data.users) && data.users[0];
    uid = u && u.localId;
    disabled = !!(u && u.disabled === true);
  } catch (e) {
    console.error("publish: Identity Toolkit nedostupan:", e && e.name);
    return json(502, { ok: false, error: "auth-service" });
  }
  if (!uid) return json(401, { ok: false, error: "bad-token" });

  // 2) da li je admin
  if (!admins.includes(uid)) return json(403, { ok: false, error: "not-admin" });
  if (disabled) return json(403, { ok: false, error: "disabled" });

  // 3) ne češće od jednom na 30 s. Vrijeme se upisuje PRIJE poziva hooka, da dva istovremena
  //    zahtjeva ne prođu oba; ako hook padne, vraća se staro vrijeme (može se odmah pokušati ponovo).
  const now = Date.now();
  if (now - lastPublishAt < MIN_GAP_MS) {
    return json(429, { ok: false, error: "too-soon", retryAfter: Math.ceil((MIN_GAP_MS - (now - lastPublishAt)) / 1000) });
  }
  const prevPublishAt = lastPublishAt;
  lastPublishAt = now;

  // 4) deploy hook (adresa se nigdje ne vraća ni ne ispisuje)
  try {
    const h = await fetch(hook, { method: "POST", signal: AbortSignal.timeout(15000) });
    if (!h.ok) { if (lastPublishAt === now) lastPublishAt = prevPublishAt; console.error("publish: deploy hook HTTP", h.status); return json(502, { ok: false, error: "hook" }); }
  } catch (e) {
    if (lastPublishAt === now) lastPublishAt = prevPublishAt;
    console.error("publish: deploy hook nedostupan:", e && e.name);
    return json(502, { ok: false, error: "hook" });
  }
  return json(200, { ok: true, requestedAt: now });
}
