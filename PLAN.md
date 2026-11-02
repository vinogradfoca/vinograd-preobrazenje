# Vinograd Preobraženje: plan sajta

Dokument za Claude Code. Sadrži odluke, strukturu stranica, model podataka i redoslijed rada.
Pravila rada: grane i PR-ovi (nikad direktno u `main`), vanilla HTML/CSS/JS, tekstovi na sajtu su ijekavica, ništa se ne izmišlja (cijene, sorte i činjenice dolaze od vlasnika). Code s bazom radi samo GET.

---

## 1. Otvorene odluke (preporuke, provjereno 30.10.2026)

### 1.1 Hosting: Cloudflare Pages, besplatni plan (odlučeno)
Hosting je bio planiran na Vercelu, pa je radio na Netlifyju. Od Dijela 7 sajt i panel su na Cloudflare Pages, a Netlify se više ne koristi.

- **Projekat:** `vinograd-preobrazenje`, povezan s GitHub repoom i gradi granu `main`. Adresa je `vinograd-preobrazenje.pages.dev` dok nema vlastitog domena.
- **Build:** komanda `node build/build.mjs --db`, izlazni folder `dist`, `NODE_VERSION=20`. U korijenu repoa je i `.node-version` sa `20`.
- **Zaglavlja:** fajl `_headers` u korijenu repoa. Build ga kopira u `dist/_headers`, jer Cloudflare čita zaglavlja iz izlaznog foldera.
- **Objava:** dugme "Objavi" ide na Pages Function `functions/api/publish.js` (putanja `/api/publish`), koja pozove deploy hook (vidi 4.5).
- **Deploy hook:** URL koji na POST pokreće izgradnju grane `main`. Nema autorizacije, pa je URL lozinka. Živi samo u tajnoj varijabli projekta (`DEPLOY_HOOK_URL`), nikad u repou ni u pregledaču.
- **Besplatni plan:**
  - 500 izgradnji mjesečno, a broje se i pregledi grana i PR-ova;
  - statika nema limit prometa;
  - komercijalna upotreba je dozvoljena (uslovi pročitani 30.10.2026.).
- **Adresa sajta** je samo u `settings/siteUrl` i mijenja se na jednom mjestu. Vlastiti domen je preporuka čim bude moguće.

### 1.1a Mjere (obavezne)
1. Mejl Cloudflare naloga je adresa koju neko stvarno čita.
2. Besplatan uptime monitor na adresi sajta, koji šalje poruku kad sajt padne.
3. Repo je potpuna kopija sajta. Build ne zavisi od hostinga: jedino što je vezano za Cloudflare su `_headers` i `functions/api/publish.js`. Selidba na drugi statički hosting znači:
   - povezati repo;
   - isti build command i izlaz;
   - prepisati funkciju "Objavi";
   - promijeniti `DEPLOY_HOOK_URL`.
4. Periodičan izvoz Firebase baze (panel: Podešavanja → Kopija podataka), da sadržaj nije samo na jednom mjestu.
5. Ne praviti nepotrebne izgradnje: svaki "Objavi" je jedna, a svaki push na granu ili PR je još jedna. Panel upozorava od 300 objava mjesečno.

### 1.2 Firebase: Blaze plan je obavezan zbog Storagea
- Od 3.2.2026. Cloud Storage za Firebase traži Blaze plan (vezana kartica) čak i bez potrošnje. Bez kartice nema bucketa.
- Besplatna kvota ostaje: 5 GB pohrane i 100 GB prenosa mjesečno. Za ovaj sajt trošak je praktično nula.
- **Blaze nema tvrdi limit potrošnje.** Obavezno postaviti budget alert (npr. 5 €) u Google Cloud Billing. Pitanje čija je kartica na Blaze planu odlučuje se prije otvaranja projekta (vidi 7).
- Slike posjetioci ne vuku iz Storagea: build ih kopira u `dist/img/`, pa saobraćaj ide preko Cloudflare Pages.
- Standardna Firebase prijava (mejl i lozinka) je besplatna.
- Cloud Functions traže Blaze i nisu potrebne: funkcija "Objavi" ide kao Cloudflare Pages Function (vidi 4.5).
- Fallback ako ne bude kartice: slike kao base64 u bazi ili u repou. Lošije, bira se samo ako Blaze otpadne.

### 1.3 Baza: Realtime Database
- Isti obrazac kao focaflyspin, a build čita običnim GET-om preko REST-a. Region `europe-west1`.

---

## 2. Struktura stranica (statički, višestranični)

| Adresa | Sadržaj |
|---|---|
| `/` | Početna: hero, tri prednosti, izdvojene sorte, "Kako naručiti" u tri koraka |
| `/sorte/` | Katalog svih vidljivih sorti. Filter (boja, zrenje, vrsta, samo dostupno) samo skriva i prikazuje kartice koje su već u HTML-u |
| `/sorte/<slug>/` | Stranica sorte: galerija, opis, iskustvo, nedostaci, sadnica i reznica (cijena, stanje), dugme "U korpu" |
| `/cjenovnik/` | Tabela sorta, sadnica, reznica. Stranica se ne generiše ako nijedna cijena nije unesena |
| `/kako-naruciti/` | Koraci narudžbe |
| `/kontakt/` | O vinogradu i kontakt: telefon, WhatsApp, mejl, adresa, mapa |
| `/404.html` | Greška |
| `/panel/` | Admin panel. `noindex`, nije u sitemapi, nije generisan iz baze |
| `sitemap.xml`, `robots.txt`, `build.json` | Generišu se pri izgradnji |

Korpa ostaje kao u nacrtu: sadržaj korpe je u `localStorage`, a upit se šalje porukom na WhatsApp ili mejl. Korpa je interakcija, a ne sadržaj stranice. Nema narudžbi na serveru.

Šabloni (`templates/`) izlaze iz postojećeg nacrta `index.html`: ista paleta (zelena `#193d2b`, bordo `#891f3d`), Georgia za naslove, sistemski font za tekst. Nema web fontova, pa nema skakanja teksta. Ako se kasnije doda font: isti domen, `font-display: swap`, podešen rezervni font.

---

## 3. Model podataka (Realtime Database)

Sve je pod korijenom `vinograd/`.

```
vinograd/
  settings/
    name, phone, phoneIntl, email, address, mapUrl, siteUrl
  pages/
    home/    { eyebrow, title, text, heroImage: <imageId>, seoTitle, seoDescription }
    kako/    { title, intro, steps: [ {title, text} ], seoTitle, seoDescription }
    kontakt/ { title, about, seoTitle, seoDescription }
  varieties/<id>/
    name, slug, color ("Bijela"|"Crna"|"Crvena"), ripen, type,
    order, featured, visible,
    desc, exp, flaws,
    facts: { origin, author, maturity, clusterWeight, berryWeight, berrySize, frost, disease, taste }  // tekst; samo popunjena polja
    images: [ <imageId>, ... ]        // prva je naslovna
    sapling: { enabled, price, qty }  // price i qty: broj ili null
    cutting: { enabled, price, qty }
    seoTitle, seoDescription, updatedAt
  images/<imageId>/
    alt, w, h,                         // dimenzije originala
    variants: {
      "400":  { path, w, h },
      "800":  { path, w, h },
      "1600": { path, w, h },
      "og":   { path, w: 1200, h: 630 }   // izrezano na 1200×630
    },
    createdAt, createdBy
  publish/
    last: { requestedAt, requestedBy }
```

Pravila značenja:
- `price: null` znači "Cijena na upit". Ništa se ne izmišlja.
- `qty: null` znači "Na upit", `qty: 0` znači "Nema na stanju", a broj znači dostupno.
- `slug` se pravi pri prvom snimanju (bez dijakritika, malim slovima) i poslije se ne mijenja kad se promijeni naziv. Panel provjerava da nema duplikata.
- `alt` je obavezan pri uploadu slike.
- `og` varijantu pravi panel u pregledaču (izrezana slika). Build bez biblioteka ne može mijenjati dimenzije slika.

### Pravila baze
Puna verzija je u `database.rules.json` u korijenu repoa. Suština:
```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "vinograd": {
      ".read": true,
      ".write": "auth != null && root.child('admins').child(auth.uid).val() === true",
      "varieties": { "$id": { ".validate": "naziv, slug, boja, visible, featured, cijene i količine" } }
    },
    "admins": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    }
  }
}
```
Admini su u čvoru `admins/<uid>: true`, a ne u pravilima. Dodaju se samo kroz Firebase konzolu, pa se novi admin (npr. vlasnik) dodaje bez promjene pravila.
Napomena: baza se čita javno, pa je i neobjavljeni nacrt tehnički čitljiv onome ko zna adresu baze. Za katalog sadnica to je prihvatljivo. Sorte sa `visible: false` build izostavlja.

### Pravila Storagea
- Čitanje javno za `vinograd/img/**`.
- Upis samo ta dva uid-a, samo `image/webp`, najviše 5 MB po fajlu.

UID-ovi nisu tajne i mogu biti u pravilima. Hook, API ključevi i sve ostalo tajno idu samo u varijable (tajne) Cloudflare Pages projekta.

---

## 4. Arhitektura izgradnje i objave

### 4.1 Tok
1. Admin uređuje sadržaj u panelu, koji piše u bazu.
2. Dugme "Objavi" šalje zahtjev na `/api/publish`.
3. Funkcija provjeri prijavu i uid, pa pozove deploy hook.
4. Cloudflare Pages pokreće `node build/build.mjs --db` (izlazni folder `dist`, `NODE_VERSION=20`).
5. Skripta čita bazu, pravi stranice i slike u `dist/`.
6. Ako izgradnja padne (izlaz različit od 0), Cloudflare ne mijenja produkciju i prethodna verzija ostaje.

Ručno se nova verzija pravi u Cloudflare Pages projektu ponovnim pokretanjem zadnje izgradnje (retry deployment) ili pushom na `main`.

### 4.2 Skripta za izgradnju (`build/build.mjs`)
- Čist Node, bez vanjskih biblioteka. Čita `vinograd.json` GET-om, bez prijave.
- Mali vlastiti šablonski mehanizam (`{{var}}`, petlje, HTML escaping svega).
- Prije pisanja provjerava podatke: obavezna polja, slike koje postoje, jedinstveni slug-ovi. Pri grešci prekida izgradnju s jasnom porukom.
- Preuzima varijante slika iz Storagea u `dist/img/` (posjetioci ne diraju Firebase).
- Piše `build.json` (`{ builtAt }`) i kopira `_headers` iz korijena repoa u `dist/_headers`: duga keširanost (`immutable`) za `/img/*` i `/assets/*`, `no-cache` za `/build.json`, `X-Robots-Tag: noindex` za `/panel/*`. Stranice su u folderima s `index.html`, pa čisti URL-ovi ne trebaju posebna podešavanja.
- Opcija `--seed` čita lokalni `data/seed.json` umjesto baze, za razvoj bez mreže.

### 4.3 Šta mora biti u HTML-u (bez prepisivanja JavaScriptom)
- Tekstovi, sorte, galerija i kontakt su u HTML-u.
- Slike: `srcset` (400w, 800w, 1600w) i `sizes`, `width` i `height` na svakoj (CLS 0), `loading="lazy"` i `decoding="async"` osim naslovne slike (`fetchpriority="high"`, preload).
- Svaka stranica: `title`, `meta description`, `canonical`, `og:title`, `og:description`, `og:image` (1200×630, apsolutna adresa).
- Schema: `LocalBusiness` na početnoj i kontaktu, `Product` na stranici sorte. `offers` se ispisuje samo ako je cijena unesena. Nema izmišljenih ocjena ni dostupnosti.
- JavaScript je samo za korpu, filtere i galeriju.

### 4.4 Status objave
Build ne piše u bazu. Panel dobija stanje preko `build.json` na samom sajtu:
- Pri kliku panel zapamti `requestedAt` i piše `vinograd/publish/last`.
- Panel svakih nekoliko sekundi učitava `/build.json` (s cache-bust parametrom).
- `builtAt >= requestedAt` znači "Objavljeno u HH:MM".
- Do tada piše "Objavljuje se…".
- Ako za ~5 minuta nema promjene: "Izgradnja nije uspjela ili još traje. Sajt ostaje na prethodnoj verziji."

### 4.5 Funkcija "Objavi" (`functions/api/publish.js`, Cloudflare Pages Function)
- `export async function onRequestPost(context)`: zahtjev je `context.request`, a varijable su u `context.env` (`DEPLOY_HOOK_URL`, `ADMIN_UIDS`, `FIREBASE_API_KEY`).
- Prima ID token iz zaglavlja.
- Token provjerava preko Google Identity Toolkit (`accounts:lookup`) i ne piše vlastitu kriptografiju.
- Poredi `localId` sa listom `ADMIN_UIDS` iz varijable okruženja.
- Samo ako je uid na listi, šalje POST na `DEPLOY_HOOK_URL`. Inače vraća 401 ili 403.
- Ne vraća hook URL ni tajne i ne ispisuje ih. Odbija zahtjeve češće od jednog na 30 sekundi (u okviru jedne instance funkcije).
- Testovi: `node tests/publish.test.mjs` (lažni Identity Toolkit i lažni hook).

---

## 5. Konvertor slika u panelu

- Ulaz: JPG, PNG, WEBP, HEIC ako ga pregledač čita.
- Izlaz: WebP u širinama 400, 800, 1600 (nikad šire od originala) i `og` 1200×630 izrezano na sredinu.
- Prije svega panel detektuje mogućnost: napravi probni canvas i provjeri da `toBlob("image/webp")` stvarno vraća `image/webp`.
- Ako ne vraća (npr. Safari): upozorenje "Ovaj pregledač ne pravi WebP. Otvorite panel u Chromeu, Edgeu, Samsung Internetu ili Firefoxu." i **upload se blokira**. Ništa se tiho ne snima kao veliki PNG.
- Kvalitet oko 0,8, prikaz veličine fajla prije i poslije, obavezan `alt`.
- Upis: fajlovi u Storage (`vinograd/img/<imageId>/<širina>.webp`), zapis u `images/<imageId>`.
- AVIF je moguća dorada kasnije, pri izgradnji, ali traži biblioteku pa je odluka za poslije.

---

## 6. Redoslijed rada za Code

Svaki korak je jedna grana i jedan PR. Ja pregledam preview i spajam.

**Korak 0: priprema (ja, ručno, bez Codea)**
- Novi Gmail, pa GitHub nalog s tim mejlom, pa Cloudflare (Pages povezan s tim GitHub-om), pa Firebase (isti Google nalog).
- Firebase: Blaze plan i budget alert, Auth (mejl i lozinka) i dva korisnika, RTDB u `europe-west1`, Storage bucket.
- Novi GitHub repo (privatan). Cloudflare Pages projekat povezan s repoom, deploy hook za granu `main`, varijable `DEPLOY_HOOK_URL` (tajna), `ADMIN_UIDS`, `FIREBASE_API_KEY`.
- Code dobija javne vrijednosti (Firebase config, adresa baze). Tajne nikad.

**Korak 1: skelet i šabloni** (`skelet`)
- Struktura repoa, `build.mjs --seed`, šabloni iz nacrta, `data/seed.json` s 26 sorti (naziv, boja, slike, sve ostalo prazno).
- Cilj: prvi preview na `pages.dev` s pravim izgledom, bez Firebasea. Rana vizuelna potvrda.

**Korak 2: baza i pravila** (`baza`)
- `database.rules.json`, `storage.rules`.
- Build čita bazu GET-om (seed ostaje kao opcija).
- Početne podatke ubacujem ja kroz Firebase konzolu (Import JSON).

**Korak 3: panel, tekstovi i sorte** (`panel-osnova`)
- Prijava, lista sorti s redoslijedom, uređivanje sorte (tekst, boja, zrenje, vrsta, cijene, količine, `visible`, `featured`), podešavanja i tekstovi stranica.
- `/panel/` je `noindex`.

**Korak 4: slike** (`panel-slike`)
- Konvertor (sekcija 5), upload, biblioteka slika, dodjela slika sortama i redoslijed.

**Korak 5: objava** (`objavi`)
- Pages Function, dugme "Objavi", prikaz stanja (4.4), test sa dva naloga.

**Korak 6: SEO i brzina** (`seo-brzina`)
- Schema, canonical, og, sitemap, robots, `_headers` zaglavlja, Lighthouse prolaz na telefonu, CLS 0.

**Korak 7: sadržaj** (ja i vlasnik)
- Fotografije kroz panel, cijene, količine, opisi. Zamijeniti `web-dikson` i `web-nadezda-azos` (tuđi potpis na slikama) vlastitim fotografijama prije puštanja u rad.
- Provjeriti boje sorti (određene su po fotografijama).

**Kasnije:** AVIF pri izgradnji, vlastiti domen, ostala dorada.

---

## 7. Potrebno od vlasnika i od mene
- Novi Gmail (predloženo `vinogradpreobrazenjefoca@gmail.com`, provjeriti da nije greška `.co`) kao nalog za GitHub, Cloudflare i Firebase. Dva korisnika u Firebase Auth: moj i vlasnikov mejl.
- Odluka čija je kartica na Firebase Blaze planu.
- Cijene, količine, zrenje, opisi i iskustva po sortama. Do tada sajt piše "Cijena na upit".
- Potvrda da WhatsApp radi na broju 065/592-120.
- Logo (`logo.png`), ako postoji.
