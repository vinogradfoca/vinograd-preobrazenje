# Vinograd Preobraženje

Statički sajt rasadnika vinove loze i panel za uređivanje.

- **Sajt:** HTML koji pravi `build/build.mjs` iz Firebase baze. Hosting je Cloudflare Pages.
- **Panel:** `/panel/`, za prijavljene admine. Uređuje se Firebase Realtime Database i Storage.
- **Objava:** dugme Objavi u panelu pokreće novu izgradnju sajta.

Sve je čist Node (20 ili noviji) i JavaScript u pregledniku, **bez npm paketa**.

Više detalja:
- `PLAN.md`: arhitektura, model podataka, pravila i hosting;
- `PANEL.md`: kako panel radi;
- `docs/uputstvo-za-panel.md`: uputstvo za korisnike panela, isto kao ekran Pomoć.

## Izgradnja

```sh
node build/build.mjs --seed   # iz data/seed.json (lokalno, bez interneta)
node build/build.mjs --db     # iz Firebase baze (ovo pokreće Cloudflare Pages)
```

**Kako build radi:**
- Izlaz je u `dist/`. Build piše u `dist.tmp/` i tek na kraju ga zamijeni s `dist/`.
- Ako nešto ne valja, build stane s greškom, a stari `dist/` ostaje.
- Upozorenja ne zaustavljaju build. Primjeri su slike koje nedostaju u `data/seed-img/` i sorte bez slike.

**Pregled lokalno:** posluži `dist/` bilo kojim statičkim serverom. Testovi s pregledačem (dolje) sami pokreću svoj server.

## Testovi

**Bez pregledača** (samo Node):

```sh
for f in tests/*.test.mjs; do node "$f" || echo "PALO: $f"; done
```

| Test | Šta provjerava |
|---|---|
| `publish.test.mjs` | funkciju za objavu, s lažnim Identity Toolkitom i lažnim hookom |
| `match.test.mjs` | uparivanje imena fajlova sa sortama |
| `changes.test.mjs` | „Šta čeka objavu” |
| `uputstvo.test.mjs` | da uputstvo odgovara panelu |
| `images.test.mjs` | dimenzije slika i granicu od 40 MP i 25 MB |
| `headers.test.mjs` | `_headers` |

Isti testovi i `node build/build.mjs --seed` rade automatski na GitHubu (`.github/workflows/test.yml`) za svaki push i PR.

**S pregledačem:**
- Traže Playwright s Chromiumom, instaliran globalno. To nije npm zavisnost ovog repoa.
- Prvo pokreni `node build/build.mjs --seed`.
- Svaki test sam služi `dist/` na slobodnom portu.

```sh
node tests/overflow.mjs        # nijedan element van ekrana (320, 360, 390, 412 px; --url=, --paths=, --widths=)
node tests/tastatura.mjs       # meni, korpa i cijeli ekran galerije tastaturom (390 i 1280 px)
node tests/korpa.mjs           # korpa: oštećen localStorage, količina veća od stanja
node tests/panel-objavi.mjs    # panel ?mock=1: Objavi čeka upise i ne objavljuje nesnimljeno
```

Ako je Playwright instaliran globalno, a Node ga ne nalazi, pokreni sa `NODE_PATH="$(npm root -g)" node tests/…`.

## Panel u probnom režimu

`/panel/?mock=1` otvara panel bez prijave, s cijelim katalogom iz `data/seed.json`:
- ništa ne ide u bazu ni u Storage;
- objava se samo glumi.

Lokalno: `node build/build.mjs --seed`, pa posluži `dist/` i otvori `/panel/?mock=1`.

U konzoli pregledača `window.panelMock` glumi greške:
- `failNext = true`: sljedeće snimanje padne;
- `failUploadAfter = n`: upload padne poslije n uspješnih.

## Objava

1. Admin u panelu snima izmjene. Prije objave panel sačeka sve upise; ako neki nije snimljen, objava se ne pokreće.
2. Admin pritisne **Objavi**. Panel pošalje Firebase ID token na `/api/publish`, tj. Cloudflare Pages Function `functions/api/publish.js`.
3. Funkcija:
   - provjeri token preko Google Identity Toolkita;
   - provjeri da je korisnik na listi `ADMIN_UIDS` i da nalog nije isključen;
   - pusti najviše jednu objavu na 30 s;
   - pozove deploy hook (`DEPLOY_HOOK_URL`).
4. Cloudflare Pages pokrene `node build/build.mjs --db`. Panel prati `/build.json` dok ne piše „Objavljeno”.

**Varijable Cloudflare Pages projekta** (Settings → Variables and Secrets, Production):
- `FIREBASE_API_KEY`;
- `ADMIN_UIDS`: UID-ovi odvojeni zarezom;
- `DEPLOY_HOOK_URL`: tajna, nikad u repou.

Zaglavlja (keš, sigurnost) su u `_headers`, a build ga kopira u `dist/`.

## Dodavanje (ili uklanjanje) admina: tri mjesta

Admin mora biti na **sva tri** mjesta. Inače može npr. mijenjati tekst, ali ne i slati slike ili objavljivati.

1. **Firebase konzola → Authentication:** napravi korisnika (mejl i lozinka) i kopiraj njegov **UID**.
2. **Realtime Database:** čvor `admins/<UID>` s vrijednošću `true`. Upisuje se samo kroz konzolu, jer pravila zabranjuju upis iz panela.
   - Daje pravo upisa u bazu.
3. **Storage pravila:** dodaj UID u listu u funkciji `isAdmin()` u `storage.rules`, pa ista pravila objavi u Firebase konzoli (Storage → Rules).
   - Daje pravo slanja slika.
4. **Cloudflare Pages:** dodaj UID u varijablu `ADMIN_UIDS`, pa ponovo pokreni zadnju izgradnju (deployment) da varijabla počne važiti.
   - Daje pravo objave.

Pri uklanjanju admina obriši ga na sva tri mjesta. Najbrže je isključiti (Disable) korisnika u Authentication:
- nova prijava odmah prestaje raditi;
- objava se odmah odbija, i za token koji još važi;
- upis u bazu i Storage može raditi dok već izdat token ne istekne (najviše oko sat vremena), osim ako je UID već uklonjen iz `admins/` i `storage.rules`.
