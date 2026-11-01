#!/usr/bin/env node
// Pravi data/firebase-import.json iz data/seed.json, za uvoz u Firebase
// Realtime Database (konzola: ⋮ → Import JSON, na korijenu baze).
//
//   node build/export-firebase.mjs
//
// Oblik:
//   { "vinograd": { settings, pages, varieties: { "<slug>": {...} }, images: {} },
//     "admins":   { "<uid>": true } }
//
// - Ključ sorte je njen slug.
// - Slike sorte su nazivi fajlova (npr. "viktor-3.webp"); čvor images je prazan
//   do Koraka 4. Naslovna slika je takođe naziv fajla, a njen opis (alt) je u
//   pages/home/heroAlt, jer images čvor još ne postoji.
// - Polja s null se izostavljaju (Firebase ih ne čuva), kao i prazni objekti i nizovi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFirebaseShape } from "./firebase-shape.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "data", "seed.json");
const OUT = path.join(ROOT, "data", "firebase-import.json");

// Admini (UID nije tajna). Novi admin se dodaje u konzoli: admins/<uid> = true.
const ADMIN_UIDS = [
  "aXWKivZS0ANh0T3CaXp9vvY5Nt42", // Žarko
  "heBoYKs5KBe5VUoqZhhVyMtXNNB3", // vlasnik (vinogradfoca@gmail.com)
];

function fail(msg) {
  console.error("IZVOZ NIJE USPIO: " + msg);
  process.exit(1);
}

let seed;
try { seed = JSON.parse(fs.readFileSync(SEED, "utf8")); } catch (e) { fail(`data/seed.json: ${e.message}`); }
let vinograd;
try { vinograd = toFirebaseShape(seed && seed.vinograd); } catch (e) { fail(e.message); }

const out = {
  vinograd,
  admins: Object.fromEntries(ADMIN_UIDS.map((uid) => [uid, true])),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

const n = Object.keys(out.vinograd.varieties).length;
console.log(`Izvezeno u data/firebase-import.json: ${n} sorti, ${ADMIN_UIDS.length} ${ADMIN_UIDS.length === 1 ? "admin" : "admina"}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log("Uvoz: Firebase konzola → Realtime Database → ⋮ → Import JSON (na korijenu baze). Uvoz zamjenjuje sve što je u bazi.");
