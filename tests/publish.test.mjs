// Pokretanje: node tests/publish.test.mjs (bez mreže: Identity Toolkit i deploy hook su lažni)
// Test Cloudflare Pages funkcije functions/api/publish.js u Nodeu: lažni Identity Toolkit i lažni
// hook preko podmetnutog fetch-a; varijable stižu kroz context.env, kao na Cloudflareu.
import fs from "node:fs";
const HOOK = "https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/TAJNA123";
const calls = [], logs = [];
let hookStatus = 200, lookupMode = "ok";
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push(url.replace(/key=[^&]+/, "key=***"));
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:lookup")) {
    if (lookupMode === "down") throw new TypeError("fetch failed");
    const { idToken } = JSON.parse(opt.body);
    const users = { "token-admin": "aXWKivZS0ANh0T3CaXp9vvY5Nt42", "token-vlasnik": "heBoYKs5KBe5VUoqZhhVyMtXNNB3", "token-gost": "gost-uid" };
    if (!users[idToken]) return new Response(JSON.stringify({ error: { code: 400, message: "INVALID_ID_TOKEN" } }), { status: 400 });
    return new Response(JSON.stringify({ users: [{ localId: users[idToken] }] }), { status: 200 });
  }
  if (url === HOOK) { if (opt.method !== "POST") throw new Error("hook mora biti POST"); return new Response("", { status: hookStatus }); }
  throw new Error("neočekivan URL " + url);
};
const realError = console.error;
console.error = (...a) => { logs.push(a.map(String).join(" ")); };
const env = {
  FIREBASE_API_KEY: "AIza-test",
  ADMIN_UIDS: "aXWKivZS0ANh0T3CaXp9vvY5Nt42, heBoYKs5KBe5VUoqZhhVyMtXNNB3",
  DEPLOY_HOOK_URL: HOOK,
};
// svako učitavanje je nova instanca funkcije (brojač od 30 s kreće iz početka)
const SRC = fs.readFileSync(new URL("../functions/api/publish.js", import.meta.url), "utf8");
let n = 0;
const load = () => import("data:text/javascript;base64," + Buffer.from(SRC + "\n// " + n++).toString("base64"));
const call = async (mod, { method = "POST", token, auth, envOver } = {}) => {
  const headers = {}; if (auth !== undefined) headers.authorization = auth; else if (token) headers.authorization = "Bearer " + token;
  const request = new Request("https://x/api/publish", { method, headers });
  const fn = method === "GET" ? mod.onRequestGet : mod.onRequestPost;
  const res = await fn({ request, env: envOver || env, params: {}, data: {}, next: () => { throw new Error("next"); }, waitUntil() {} });
  const text = await res.text();
  return { status: res.status, body: text, leak: /TAJNA|deploy_hooks|AIza/.test(text) };
};
const ok = (c, m) => console.log((c ? "PROŠLO" : "PALO  ") + " " + m);
let mod = await load();
ok(typeof mod.onRequestPost === "function" && !("default" in mod), "export onRequestPost(context), bez default exporta");
let r = await call(mod, { method: "GET" }); ok(r.status === 405, `GET -> ${r.status}`);
r = await call(mod, {}); ok(r.status === 401, `nema tokena -> ${r.status} ${r.body}`);
r = await call(mod, { auth: "Basic abc" }); ok(r.status === 401, `pogrešan oblik zaglavlja -> ${r.status}`);
r = await call(mod, { token: "lose" }); ok(r.status === 401, `loš token -> ${r.status} ${r.body}`);
r = await call(mod, { token: "token-gost" }); ok(r.status === 403, `nije admin -> ${r.status} ${r.body}`);
const hookCallsBefore = calls.filter((c) => c === HOOK).length;
ok(hookCallsBefore === 0, `hook nije pozvan za 401/403 (poziva: ${hookCallsBefore})`);
r = await call(mod, { token: "token-admin" }); const b = JSON.parse(r.body);
ok(r.status === 200 && b.ok === true && typeof b.requestedAt === "number" && !r.leak, `admin -> ${r.status} ${r.body}`);
ok(calls.filter((c) => c === HOOK).length === 1, "hook pozvan tačno jednom (POST)");
r = await call(mod, { token: "token-vlasnik" }); ok(r.status === 429, `druga objava za manje od 30 s -> ${r.status} ${r.body}`);
ok(calls.filter((c) => c === HOOK).length === 1, "429: hook nije ponovo pozvan");
mod = await load(); hookStatus = 500;
r = await call(mod, { token: "token-vlasnik" }); ok(r.status === 502 && !r.leak, `hook vrati 500 -> ${r.status} ${r.body}`);
mod = await load(); hookStatus = 200; lookupMode = "down";
r = await call(mod, { token: "token-admin" }); ok(r.status === 502, `Identity Toolkit nedostupan -> ${r.status} ${r.body}`);
lookupMode = "ok"; mod = await load();
const noHook = { ...env }; delete noHook.DEPLOY_HOOK_URL;
r = await call(mod, { token: "token-admin", envOver: noHook }); ok(r.status === 500, `nema DEPLOY_HOOK_URL -> ${r.status} ${r.body}`);
r = await call(mod, { token: "token-admin", envOver: { ...env, ADMIN_UIDS: " , " } }); ok(r.status === 500, `prazan ADMIN_UIDS -> ${r.status} ${r.body}`);
ok(!calls.some((c) => c.includes("AIza-test")), "API ključ se ne pojavljuje u zapisima testa");
ok(logs.length > 0 && !logs.some((l) => /TAJNA|deploy_hooks|AIza/.test(l)), `zapisi funkcije (${logs.length}) ne sadrže hook ni ključ`);
console.error = realError;
