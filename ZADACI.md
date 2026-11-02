# Zadaci za panel: završetak (četiri dijela, jedan PR)

Čitaj uz `PANEL.md` i `PLAN.md`. Sve što se tamo već dogovorilo vrijedi i ovdje.

## Kako radiš

- Nova grana `panel-zavrsetak` od najnovijeg `main`, **jedan PR** za sva četiri dijela.
- Radiš redom: **Dio 1, Dio 2, Dio 3, Dio 4**. Poslije svakog dijela: provjeri u mock režimu, **commit i push na istu granu** s jasnom porukom ("Dio 1: Objavi", ...), pa dodaj kratak komentar u PR (šta je gotovo, šta nisi mogao provjeriti). PR otvori odmah poslije prvog dijela.
- Ako neki dio ne uspiješ završiti, ostavi ga pošteno označenog u PR-u i nastavi na sljedeći. Nemoj ostaviti polovičan kod koji kvari ostale dijelove.
- **Pravila baze i Storagea ne diraj** u ovom PR-u, ako ne postoji razlog bez kojeg nešto ne može raditi (tada obrazloži u PR-u). Pravila ista kao do sada: vanilla, bez npm paketa, bez tajni u kodu ni u repou, ništa ne izmišljaj, ijekavica, isti izgled panela (bijele kartice, krem pozadina, zelena #193d2b i bordo #891f3d, Georgia naslovi), cilj za dodir najmanje 44 px, polja najmanje 16 px. Ne diraj `build/` osim ako dio to izričito traži.
- Firebase i Netlify nisu dostupni iz tvog okruženja. Sve provjeravaj u mock režimu (`/panel/?mock=1`) i lažnim serverima, a u opisu PR-a navedi šta je ostalo neprovjereno.
- Kad završiš sve, opis PR-a neka sadrži: listu dijelova, šta ja ručno radim (ništa, osim varijabli u Netlifyju za Dio 1; pravila baze i Storagea se ne mijenjaju), kako se svaki dio isprobava na preview adresi (`/panel/`, prijava, pa konkretni koraci).

---

## Dio 1: Objavi (Korak 5 iz PANEL.md)

Hosting je Netlify. Funkcija ide u `netlify/functions/publish.mjs` (moderna sintaksa: `export default async (req) => new Response(...)` i `export const config = { path: "/api/publish" }`; ako imaš pristup Netlify dokumentaciji, provjeri, ako ne, ovo je sintaksa za koju vjerujem da je tačna).

1. **Funkcija:** prima POST sa zaglavljem `Authorization: Bearer <Firebase ID token>`. Token provjerava preko `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=<FIREBASE_API_KEY>` (POST sa `{"idToken": token}`), uzme `localId` i poredi ga s listom `ADMIN_UIDS` iz `process.env` (odvojeno zarezom). Samo ako je na listi, pošalje POST na `process.env.DEPLOY_HOOK_URL`, pa vrati `{ok:true, requestedAt}` (vrijeme servera). Inače 401 (nema ili loš token) ili 403 (nije admin). Hook URL i tajne se nigdje ne vraćaju ni ne ispisuju.
2. **Ekran Objavi** (zamijeni "Uskoro"): jedno veliko dugme "Objavi na sajt". Iznad broj izmjena koje čekaju (sorte i stranice čiji je `updatedAt` noviji od zadnje objave `publish/last/requestedAt`; ako zadnje objave nema, broji sve). Status: "Objavljuje se…", "Objavljeno u HH:MM", ili "Izgradnja nije uspjela ili još traje. Sajt ostaje na prethodnoj verziji." (poslije 6 minuta bez promjene). Status čita sa `/build.json` (`builtAt`, uz cache-bust parametar) svakih 10 sekundi dok traje objava. Pri kliku: pošalji ID token na `/api/publish`, pa upiši `vinograd/publish/last = {requestedAt, requestedBy (UID)}` i `vinograd/publish/history/<push-ključ> = {requestedAt, requestedBy}`. Ispod prikaži zadnjih pet objava (vrijeme i ime po mapi UID → ime koja već postoji u panelu).
3. **Brojač za Netlify:** besplatni paket ima 300 kredita mjesečno, a svaka objava košta 15 kredita (plus promet), pa je granica oko 20 objava mjesečno (dijeli se s ostalim deployima). Prikaži "Objava ovog mjeseca: N" (iz `publish/history`) i upozorenje "Netlify besplatni paket dozvoljava oko 20 objava mjesečno. Skupi više izmjena pa objavi jednom." kad je N ≥ 12.
4. **Pravila baze se NE mijenjaju.** Pravilo `vinograd/.write` već dozvoljava adminima upis na svaku putanju ispod `vinograd` (uključujući `publish`), a `.read` je javan. Ne dodaji nove `.validate` za ovaj dio.
5. **Mock režim:** dugme radi bez poziva funkcije, uz simulirano "Objavljuje se…" pa "Objavljeno u HH:MM", i traku "PROBNI REŽIM".
6. **Greške** na bosanskom (nema veze, nema dozvole, sporo), s dugmetom "Pokušaj ponovo".

Provjera: test funkcije lokalno u Nodeu s lažnim Identity Toolkitom i lažnim hookom (nema tokena, loš token, nije admin, admin, hook vrati grešku). Panel u mocku (Playwright).

Ja u Netlifyju podešavam varijable `DEPLOY_HOOK_URL`, `ADMIN_UIDS` i `FIREBASE_API_KEY` (za Functions). Ti ih samo čitaš iz `process.env`.

---

## Dio 2: Dodaj sortu (Korak 4c iz PANEL.md 4.5)

Dugme "Dodaj sortu" na početnoj i na ekranu Sorte (zamijeni "Uskoro"). Čarobnjak, pet koraka, svaki ekran jedna misao:

1. **Naziv i boja.** Obavezni su samo naziv i boja (Bijela, Crna, Crvena, Za provjeru). Prije nastavka upozorenje ako postoji sorta sa sličnim nazivom: normalizovano poređenje (bez kvačica, malim slovima, bez razmaka i crtica) tačno isto ili razlika najviše 2 slova. Upozorenje nudi "Otvori postojeću" i "Ipak dodaj novu".
2. **Slike** (neobavezno): isti konvertor i upload kao u ekranu uređivanja sorte; ovdje samo izbor fajlova, bez novog konvertora.
3. **Cijena i količina** (neobavezno): sadnica i reznica, cijena (KM) i količina (cijeli broj), prazno znači "na upit".
4. **Opis i iskustvo** (neobavezno): opis, lično iskustvo, nedostaci (isto kao u uređivanju sorte, s upozorenjem za nedostatke), plus vrijeme zrenja i vrsta.
5. **Pregled:** sažetak, prekidač "Vidljiva na sajtu" (**zadano isključeno**), dugme "Spremi sortu". Tekst: "Nova sorta se ne vidi na sajtu dok je ne uključiš i ne pritisneš Objavi."

Pravila:
- **Slug** se pravi pri prvom snimanju: bez dijakritika (š→s, č→c, ć→c, ž→z, đ→dj), malim slovima, razmaci i posebni znaci u crtice, bez dupliranih crtica. Ključ sorte u bazi je slug (kao u uvezenim podacima). Ako slug već postoji, dodaj sufiks `-2`, `-3`... Slug se poslije ne mijenja.
- **Prvi upis** (kad se prođe korak 1) pravi sortu odmah sa `name`, `slug`, `color`, `visible: false`, `featured: false`, `updatedAt`, `updatedBy` (traže ih `.validate` pravila). Ostali koraci snimaju u istu sortu putanjama do polja. Ako korisnik odustane na pola, ostaje skrivena sorta koja se vidi u listi s oznakom "sakrivena", pa je može dovršiti ili sakriti.
- Dugme "Nazad" na svakom koraku bez gubitka unosa. Napredak "Korak 2 od 5".
- Prazna polja se ne upisuju (ne `""`, ne `0`).
- Nova sorta mora raditi i bez slika (build je već tretira kao sortu bez slike).

Provjera: Playwright u mocku, puni tok sa i bez slika, upozorenje o sličnom nazivu, slug sa kvačicama (npr. "Šarada Đ" → `sarada-dj`), sufiks za duplikat, prekid na koraku 3 pa nastavak.

---

## Dio 3: Uvoz slika po imenu (Korak 4b iz PANEL.md 5)

Koristi isti konvertor i upload iz Koraka 4a; ne piši drugi.

1. Dugme **"Uvoz po imenu"** na ekranu Slike. Izbor više fajlova odjednom (`input multiple`, bez ograničenja broja).
2. **Upoređivanje imena** (čista funkcija u `panel/match.js`, s testovima): normalizacija = bez nastavka, mala slova, bez kvačica (š→s, č→c, ć→c, ž→z, đ→dj), crtice, razmaci i donje crte se zanemaruju, broj na kraju (`-3`, `_3`, `3`) se uklanja i čuva kao redoslijed, a prefiks `web-` ili `web_` se skida i označava sliku `source: "web"`. Poredi se s normalizovanim nazivom i slugom sorte. Rezultat: uparena (tačno poklapanje), prijedlog (najbliže ime, najviše 2 slova razlike po Levenshteinu, uz uslov da je najbliža samo jedna sorta) ili neuparena. Ako ime odgovara dvjema sortama, ne pogađaj, traži izbor.
3. **Ekran pregleda PRIJE snimanja:** tri skupa (uparene, neuparene, preskočene), mreža sličica (blob URL, smanjene na 160 px), uz svaku sliku polje s imenom koje se može ispraviti (ishod se odmah osvježi), izbor sorte iz liste i oznaka "sa interneta" za web slike. Ništa se ne snima dok se ne potvrdi dugme "Snimi N slika". Preskočene su duplikati po hash-u i slike koje korisnik isključi.
4. Slike `source: "web"` nose kvačicu "Provjereno da smijem koristiti" (`webApproved`); dok nije uključena, slika se snima s `webApproved: false` (build je preskače).
5. **Snimanje** jedna po jedna slika, preko postojećeg konvertora i uploada. Traka po slici i ukupna ("snimljeno 37 od 149"), uz veličinu prije i poslije. Slika se dodaje na **kraj** niza `images` sorte, osim ako sorta nema nijednu sliku. Redoslijed među novim slikama iste sorte određuje broj iz imena.
6. **Nastavak poslije prekida:** spisak preostalih slika čuva se u IndexedDB (imena i sadržaj fajlova; ako je sadržaj prevelik, samo imena i traži ponovni izbor). Pri otvaranju ekrana Slike ponudi "Nastavi uvoz (N preostalo)". Već snimljene ne ponavljaj (hash).
7. **Rezime na kraju:** "149 snimljeno, 3 preskočena, 2 neuparene" i dugme Objavi.
8. **Opis slike** (`alt`) se sam popuni "Grozd sorte <naziv>" (po sorti, ne po imenu fajla).
9. Mock režim radi u memoriji kao u 4a.

Testovi za `match.js` sa stvarnim imenima: `azalija-1.webp`, `bajkonur-2.webp`, `bijelo-otporno-1.webp`, `black-grand-2.webp`, `km-342-3.webp`, `podarok-ukrajine-2.webp`, `poslanik-signalni-1.webp` (prijedlog Poslanik), `web-dikson.webp` (web slika, Dikson), `web-nadezda-azos.webp` (Nadežda Azos), `rembo-1.webp` (neuparena), `prima-parisa-1.webp`, `nizina-2.webp`, `gold-finger-3.webp`, `Ratatuj_1.JPG`, i izmišljena imena bez poklapanja. Provjeri i nejednoznačnost (ako u katalogu ima sorti s istim normalizovanim imenom), preskakanje duplikata, prekid pa nastavak.

---

## Dio 4: Tekstovi i kontakt (Korak 3b iz PANEL.md 4.8)

Zupčanik u zaglavlju vodi na **Podešavanja**. Već postoji Promijeni lozinku; dodaj:

1. **Kontakt** (`vinograd/settings`): telefon, WhatsApp broj (`phoneIntl`, samo cifre, bez + i nula na početku), mejl, adresa, link na mapu. `siteUrl` je samo za čitanje.
2. **Tekstovi stranica** (`vinograd/pages/...`): koristi **samo polja koja već postoje** u `data/seed.json` i u bazi (početna: naslov, tekst, opis slike; "Kako naručiti": koraci; kontakt: tekst o vinogradu; naslovi i opisi za Google). Ne izmišljaj nova polja. Prikaži ih po stranici, svaka kao sklopljen odjeljak sa sažetkom ("popunjeno", "prazno").
3. Ista pravila snimanja kao ostatak panela (autosnimanje po polju, `updatedAt`, `updatedBy`, "Snimljeno u nacrt").
4. **Provjera unosa:** telefon i mejl tekst bez razmaka na početku i kraju; `phoneIntl` samo cifre; mejl mora imati @ (blaga provjera); URL mape mora počinjati s `https://`. Greške na bosanskom.
5. **Pravila baze se NE mijenjaju.** Admini već smiju pisati ispod `vinograd`, pa `settings` i `pages` rade bez novih pravila. Provjeru unosa radi samo panel (korak 4).
6. **Brojač "Šta čeka objavu"** na ekranu Objavi mora uključiti i izmjene podešavanja i stranica.

Provjera: Playwright u mocku (izmjena svakog polja, provjera unosa, snimanje samo izmijenjenog polja).
