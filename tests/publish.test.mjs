// Pokretanje: node tests/publish.test.mjs (bez mreže: Identity Toolkit i build hook su lažni)
// Test funkcije u Nodeu: lažni Identity Toolkit i lažni hook preko podmetnutog fetch-a.
const HOOK = "https://api.netlify.com/build_hooks/TAJNA123";
const calls = [];
let hookStatus = 200, lookupMode = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push(url.replace(/key=[^&]+/, "key=***"));
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
    if (lookupMode === "down") throw new TypeError("fetch failed");
    const { idToken } = JSON.parse(opt.body);
    const users = { "token-admin": "aXWKivZS0ANh0T3CaXp9vvY5Nt42", "token-vlasnik": "heBoYKs5KBe5VUoqZhhVyMtXNNB3", "token-gost": "gost-uid" };
    if (!users[idToken]) return new Response(JSON.stringify({ error: { code: 400, message: "INVALID_ID_TOKEN" } }), { status: 400 });
    return new Response(JSON.stringify({ users: [{ localId: users[idToken] }] }), { status: 200 });
  }
  if (url === HOOK) return new Response("", { status: hookStatus });
  throw new Error("neočekivan URL " + url);
};
process.env.FIREBASE_API_KEY = "AIza-test";
process.env.ADMIN_UIDS = "aXWKivZS0ANh0T3CaXp9vvY5Nt42, heBoYKs5KBe5VUoqZhhVyMtXNNB3";
process.env.DEPLOY_HOOK_URL = HOOK;
let n = 0;
const load = async () => (await import(new URL("../netlify/functions/publish.mjs?v=" + n++, import.meta.url).href));
const call = async (fn, { method = "POST", token, auth } = {}) => {
  const headers = {}; if (auth !== undefined) headers.authorization = auth; else if (token) headers.authorization = "Bearer " + token;
  const res = await fn(new Request("https://x/api/publish", { method, headers }));
  const text = await res.text();
  return { status: res.status, body: text, leak: text.includes("TAJNA") || text.includes("build_hooks") || text.includes("AIza") };
};
const ok = (c, m) => console.log((c ? "PROŠLO" : "PALO  ") + " " + m);
let mod = await load();
ok(mod.config && mod.config.path === "/api/publish", "config.path = /api/publish");
let r = await call(mod.default, { method: "GET" }); ok(r.status === 405, `GET -> ${r.status}`);
r = await call(mod.default, {}); ok(r.status === 401, `nema tokena -> ${r.status} ${r.body}`);
r = await call(mod.default, { auth: "Basic abc" }); ok(r.status === 401, `pogrešan oblik zaglavlja -> ${r.status}`);
r = await call(mod.default, { token: "lose" }); ok(r.status === 401, `loš token -> ${r.status} ${r.body}`);
r = await call(mod.default, { token: "token-gost" }); ok(r.status === 403, `nije admin -> ${r.status} ${r.body}`);
const hookCallsBefore = calls.filter((c) => c === HOOK).length;
ok(hookCallsBefore === 0, `hook nije pozvan za 401/403 (poziva: ${hookCallsBefore})`);
r = await call(mod.default, { token: "token-admin" }); const b = JSON.parse(r.body);
ok(r.status === 200 && b.ok === true && typeof b.requestedAt === "number", `admin -> ${r.status} ${r.body}`);
ok(calls.filter((c) => c === HOOK).length === 1, "hook pozvan tačno jednom (POST)");
r = await call(mod.default, { token: "token-vlasnik" }); ok(r.status === 429, `druga objava za manje od 30 s -> ${r.status} ${r.body}`);
mod = await load(); hookStatus = 500;
r = await call(mod.default, { token: "token-vlasnik" }); ok(r.status === 502 && !r.leak, `hook vrati 500 -> ${r.status} ${r.body}`);
mod = await load(); hookStatus = 200; lookupMode = "down";
r = await call(mod.default, { token: "token-admin" }); ok(r.status === 502, `Identity Toolkit nedostupan -> ${r.status} ${r.body}`);
lookupMode = "ok"; mod = await load(); const saved = process.env.DEPLOY_HOOK_URL; delete process.env.DEPLOY_HOOK_URL;
r = await call(mod.default, { token: "token-admin" }); ok(r.status === 500, `nema DEPLOY_HOOK_URL -> ${r.status} ${r.body}`);
process.env.DEPLOY_HOOK_URL = saved;
ok(!calls.some((c) => c.includes("AIza-test")), "API ključ se ne pojavljuje u zapisima testa");
