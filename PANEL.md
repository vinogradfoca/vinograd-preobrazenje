# Panel: specifikacija

Dopuna `PLAN.md`. Ovdje je sve što Code treba za panel (`/panel/`). Model podataka, pravila baze i tok objave ostaju kako piše u `PLAN.md` (sekcije 3, 4 i 5). Panel mijenja redoslijed Koraka 3 do 5 (vidi sekciju 9).

Pravila rada su ista: grane i PR-ovi, vanilla HTML/CSS/JS, ijekavica, ništa se ne izmišlja. Code s bazom radi samo GET.

---

## 1. Ko koristi panel i šta mu je najvažnije

- **Uglavnom vlasnik vinograda, sa telefona.** Nije programer. Ekrani moraju biti jasni bez objašnjenja.
- Najčešći poslovi, svi podjednako važni: dodavanje novih sorti, opisi i iskustva, slike, cijene i količine.
- **Količina je tačan broj komada** (sadnica i reznica posebno). Sajt je statički, pa se količine na njemu osvježavaju tek kad se pritisne Objavi. Zato sajt treba da piše da je dostupnost okvirna i da se potvrđuje u odgovoru na upit, a panel pokazuje "Količine na sajtu su od HH:MM".

## 2. Opšta pravila

- **Telefon prvo.** Najmanja ciljna površina za dodir je 44 px. Tekst u poljima najmanje 16 px (sprječava zumiranje u iOS-u). Jedna kolona, donja navigacija.
- **Jezik:** bosanski, ijekavica, jednostavne riječi. Greške na običnom jeziku ("Nema veze, izmjena nije snimljena. Pokušaj ponovo.").
- **Automatsko snimanje u nacrt.** Svako polje se snima kad se napusti, putanjom ka tom polju (`update` na konkretne putanje, nikad cijeli objekat), da dva admina ne pregaze jedan drugog. Na ekranu uvijek piše "Snimljeno u nacrt" ili "Nije snimljeno" s dugmetom Pokušaj ponovo. Izmjena se nikad ne gubi tiho.
- **Posjetioci ništa ne vide dok se ne pritisne Objavi.** To piše na početnoj i na ekranu Objavi.
- **Brisanje samo sakriva** (`visible: false`). Trajno brisanje traži potvrdu upisom naziva sorte. Slike u Storageu se ne brišu automatski.
- **Prazna cijena ili količina znači "na upit".** `null`, ne 0.
- Svaka sorta pamti `updatedAt` i `updatedByName`. Pri uređivanju piše "Zadnja izmjena: ime, datum".
- **Panel nije u pretrazi:** `noindex`, `X-Robots-Tag: noindex`, nije u sitemapu.
- **Prijava:** Firebase Auth, mejl i lozinka, uz "Zaboravljena lozinka" (Firebase šalje mejl). Nikakve lozinke u kodu. Dva naloga: moj i vlasnikov.
- **Mock režim** (`/panel/?mock=1`): isti panel s podacima u memoriji, bez Firebasea. Služi da Code može provjeriti ekrane bez pisanja u pravu bazu.

## 3. Navigacija

Donja traka s pet dugmadi: **Početna, Sorte, Cijene, Slike, Objavi**. Zupčanik u zaglavlju vodi na **Podešavanja i tekstovi stranica**.

## 4. Ekrani

Mockup tri ekrana postoji kao vizuelni model (početna, uređivanje sorte, cijene i količine, uz ekran tekstova i osobina). Ovdje su opisani da ih Code ne mora gledati.

### 4.1 Početna ("Šta želiš uraditi?")
Četiri velika dugmeta: **Dodaj sortu**, **Cijene i količine**, **Dodaj slike**, **Objavi na sajt**. Ispod njih kartica **"Šta još fali"** s tri reda i trakom napretka: sorte bez slike, bez cijene, bez količine (npr. "125 od 150"). Dodir na red otvara listu već filtriranu na to. Brojevi se računaju iz baze, ne upisuju ručno. Na dnu: "Sve što upišeš snima se u nacrt, a posjetioci to ne vide dok ne pritisneš Objavi."

### 4.2 Sorte (lista)
Kartice sa sličicom, nazivom, bojom i bedževima ("nema slike", "nema cijene", "nema količine", "sakrivena", "nedostupna"). Pretraga po nazivu. Filteri: bez slike, bez cijene, bez količine, sakrivene, izdvojene. Dodir otvara uređivanje.

### Dijeljenje linka (važno za vlasnika)
Vlasnik će sorte uglavnom slati ljudima kao link (WhatsApp, Viber). Zato:
- Na ekranu **Sorte** (kartica) i na ekranu **Uređivanje sorte** postoji dugme **Podijeli**. Koristi Web Share API (`navigator.share`) s porukom "Viktor – rana crvena stona sorta" i adresom stranice sorte (`siteUrl` + `/sorte/<slug>/`). Ako uređaj ne podržava dijeljenje: dugme **Kopiraj link**.
- Dugme je isključeno za sorte koje nisu vidljive ili još nisu objavljene, uz poruku "Ova sorta još nije na sajtu. Pritisni Objavi."
- Na svakoj stranici sorte na sajtu postoji isto dugme **Podijeli**.
- Pregled linka (naslov, kratki opis i slika) dolazi iz `og` oznaka. Svaka stranica sorte ima svoj `og:title`, `og:description` i `og:image` (sorta bez slike koristi sliku sa početne). Piše i podsjetnik: pregledi se keširaju kod primaoca, pa se promjena slike ili teksta vidi sa zakašnjenjem.

### 4.3 Uređivanje sorte
Naslov s nazivom i oznakom "Snimljeno u nacrt". Traka slika (prva je naslovna, dugme Dodaj). Pa odjeljci:
- **Osnovno** (otvoreno): naziv, boja (tri dugmeta: Bijela, Crna, Crvena, plus "Za provjeru" ako se koristi), vrijeme zrenja (Ultra rana, Rana, Srednje rana, Kasna, Za provjeru), vrsta (Stona, Besjemena, Vinska), prekidači "Vidljiva na sajtu" i "Izdvojena na početnoj".
- **Cijena i stanje** (otvoreno): sadnica i reznica, svaka s cijenom (KM) i količinom (broj s dugmadi − i +). Prazno polje se prikazuje kao "na upit".
- **Tekstovi** (sklopljen, piše "popunjeno" ili "prazno"): opis, lično iskustvo, nedostaci. Svako polje ima brojač znakova. Nedostaci imaju upozorenje "Unesite samo provjerene nedostatke sorte".
- **Osobine** (sklopljen): porijeklo, autor, dani do zrenja, težina grozda, težina bobice, veličina bobice, otpornost na mraz, otpornost na bolesti, ukus. Prazno polje se na sajtu ne prikazuje. Ovo su polja iz `facts` u modelu.
- **Slike** (sklopljen): redoslijed strelicama, naslovna slika, opis slike, brisanje.
- **Napredno** (sklopljen): naslov i opis za Google. Automatski, a mogu se ručno promijeniti.
- Dno: **Sakrij sortu** i **Gotovo**.

Šta je zaključano: `slug` (adresa stranice) ostaje isti i kad se promijeni naziv, a interni broj i `updatedAt`/`updatedByName` vodi panel.

### 4.4 Cijene i količine
Brzi unos za sve sorte. Pretraga i filteri (Sve, Bez cijene, Bez količine, Nedostupno). Kartica po sorti: naziv s tačkom boje, pa dvije kolone, **Sadnica** i **Reznica**, svaka s poljem za cijenu i brojačem količine. Prazno piše "na upit". Snima se kad se polje napusti.

### 4.5 Nova sorta (korak po korak)
Koraci: 1) naziv i boja, 2) slike, 3) cijena i količina, 4) opis i iskustvo, 5) pregled. Obavezni su samo naziv i boja. **Nova sorta je skrivena (`visible: false`)** dok vlasnik sam ne označi da je spremna. Prije snimanja upozorenje ako postoji sorta sa sličnim nazivom. `slug` se pravi pri prvom snimanju (bez dijakritika, malim slovima), uz provjeru duplikata.

### 4.6 Slike
Biblioteka slika po sorti, plus **uvoz po imenu fajla** (sekcija 5).

### 4.7 Objavi
Jedno veliko dugme. Stanje: "Objavljuje se…" ili "Objavljeno u HH:MM", prema `PLAN.md` 4.4 (`build.json`). Iznad dugmeta broj izmjena koje čekaju objavu (sorte, stranice i podešavanja čiji je `updatedAt` noviji od zadnje objave). Ispod: zadnjih pet objava (vrijeme i ko). Piše i "Količine na sajtu su od HH:MM".

### 4.8 Podešavanja i tekstovi stranica (zupčanik)
**Promijeni lozinku** (traži trenutnu lozinku, pa novu dva puta; Firebase `reauthenticateWithCredential` i `updatePassword`; najmanje 8 znakova, ništa se ne prikazuje u logu). Na ekranu prijave dugme **Zaboravljena lozinka** (Firebase `sendPasswordResetEmail`; poruka "Ako nalog postoji, poslali smo mejl" bez otkrivanja da li adresa postoji). Odjava na svim ekranima iz zaglavlja.

Kontakt (telefon, WhatsApp broj, mejl, adresa, link na mapu), tekstovi početne ("Kako naručiti" koraci), kontakt i "O vinogradu", naslovi i opisi za Google. Polje `siteUrl` je samo za čitanje u panelu, mijenja se u bazi.

## 5. Uvoz slika po imenu fajla

Cilj: dodati mnogo slika odjednom (npr. 149) bez rada sliku po sliku.

1. **Izbor fajlova.** Više fajlova odjednom. Obrađuju se **jedan po jedan**, da browser na telefonu ne ostane bez memorije.
2. **Upoređivanje imena.** Ime fajla se normalizuje: bez nastavka (`.webp`), velika i mala slova se zanemaruju, bez kvačica (š→s, č→c, ć→c, ž→z, đ→dj), crtice i razmaci se zanemaruju, broj na kraju (`-3`) se uklanja i čuva kao redoslijed, a prefiks `web-` se skida i označava sliku kao "sa interneta". Rezultat se poredi s normalizovanim nazivom i `slug`-om sorte.
3. **Rezultat po slici:** uparena (naziv sorte), prijedlog ("Mislili ste: Poslanik?", najbliže ime, razlika do 2 slova) ili neuparena. Ako ime odgovara dvjema sortama, panel ne pogađa i traži izbor.
4. **Ime se može ispraviti.** Svaka slika ima polje s imenom koje se može mijenjati, a ishod se odmah osvježi. Može se i samo izabrati sorta iz liste (ime fajla se ne mijenja). Dugme "Ukloni prefiks za sve" je opcionalno.
5. **Pregled prije snimanja.** Mreža sličica u tri skupa: uparene, neuparene, preskočene. Ništa se ne snima dok se ne potvrdi.
6. **Slike sa interneta (`web-`)** nose oznaku i kvačicu "Provjereno da smijem koristiti". Dok kvačica nije uključena, slika se ne objavljuje na sajtu. Razlog: ranije su nađene slike s tuđim potpisom.
7. **Isti sadržaj se preskače.** Za svaku sliku se računa SHA-256 originalnih bajtova (`crypto.subtle`) i čuva uz sliku. Duplikat se ne snima ponovo.
8. **Napredak.** Traka po fajlu i ukupna ("snimljeno 37 od 149"), uz veličinu prije i poslije pretvaranja.
9. **Nastavak poslije prekida.** Spisak preostalih slika čuva se u IndexedDB. Ako veza padne ili se ekran ugasi, već snimljene ostaju, a ostale se nude ponovo.
10. **Opis slike** (`alt`) se sam popuni ("Grozd sorte Viktor") i kasnije se može urediti. Nije obavezno upisivati ga prije snimanja.
11. **Kraj:** rezime ("149 snimljeno, 3 preskočena") i dugme Objavi. Brojač "bez slike" na početnoj odmah pada.

### Konvertor
- Izlaz: WebP u širinama 400, 800 i 1600 (nikad šire od originala) i **`og` kao JPEG** 1200×630, izrezano na sredinu, kvalitet oko 0,8. Razlog: `og` služi za pregled linka kad se sorta pošalje preko WhatsAppa ili Facebooka. WhatsApp prikazuje sliku samo ako je manja od oko 300 KB, a JPEG je format koji sigurno prihvataju svi, pa i Safari može da ga napravi. Ako JPEG pređe 250 KB, panel smanji kvalitet dok ne stane. (`og` iz `PLAN.md` modela ima u tom slučaju nastavak `.jpg`.)
- Prije svega detekcija mogućnosti: probni canvas i provjera da `toBlob("image/webp")` stvarno vraća `image/webp`. Ne po nazivu pregledača.
- Ako ne radi (npr. Safari): upozorenje "Ovaj pregledač ne pravi WebP. Otvori panel u Chromeu, Edgeu, Samsung Internetu ili Firefoxu." i **upload se blokira**. Ništa se ne snima tiho kao veliki PNG.
- Kvalitet oko 0,8. Upis: Storage `vinograd/img/<imageId>/<širina>.webp`, zapis u `images/<imageId>` (`alt`, `w`, `h`, `variants`, `hash`, `source` (`own` ili `web`), `webApproved`, `createdAt`, `createdBy`).
- Ograničenja:
  - najviše **6 slika po sorti** (granica je u panelu, `MAX_IMG` u `panel/app.js`). Kad sorta ima 6 slika, dugme Dodaj slike je neaktivno, a u uvozu po imenu slika koja bi prešla granicu ide u Preskočene ("Sorta već ima 6 slika"). Sorte koje već imaju više od 6 slika ostaju kakve jesu;
  - ulazna fotografija najviše **40 MP i 25 MB**. Veća se odbija prije dekodiranja, s porukom "Slika je prevelika (najviše 40 MP i 25 MB). Smanji je pa pokušaj ponovo." U uvozu ide u Preskočene;
  - Storage pravila: najviše 5 MB po fajlu, samo `image/webp` (400, 800, 1600) i `image/jpeg` (`og.jpg`).

## 6. Šta panel upisuje (dopuna modela iz `PLAN.md` sekcija 3)

- Sorta: sva polja iz modela, uz `facts` (`origin`, `author`, `maturity`, `clusterWeight`, `berryWeight`, `berrySize`, `frost`, `disease`, `taste`), `updatedAt`, `updatedByName`.
- Slike: kako piše u sekciji 5.
- `publish/last`: `{ requestedAt, requestedBy }`, piše panel pri kliku na Objavi.
- Build izostavlja sorte sa `visible: false` i slike sa `source: "web"` bez `webApproved: true`.

## 7. Šta nije u prvoj verziji

- Poništavanje pojedinačne izmjene ("vrati na objavljeno").
- Slobodan unos novih vrijednosti za zrenje, vrstu i boju (liste su fiksne, kao u starom sajtu).
- Živa količina na sajtu (čitanje iz baze u pregledniku). Odstupa od pravila da je sadržaj u HTML-u.
- Čuvanje narudžbi. Upiti idu na WhatsApp ili mejl.
- Automatsko brisanje slika iz Storagea.

## 8. Sigurnost

Pravila baze i Storagea kako piše u `PLAN.md` sekcija 3. Upis samo za dva uid-a. Panel ne sadrži nikakve tajne. Firebase config i adresa baze su javne vrijednosti i smiju biti u kodu. Hook, `ADMIN_UIDS` i ostalo su samo u varijablama Cloudflare Pages projekta.

## 9. Redoslijed rada za Code (zamjenjuje Korake 3 do 5)

Svaki korak je jedna grana i jedan PR. Prije svega treba Korak 2 iz `PLAN.md` (pravila baze, uvoz početnih podataka).

- **3a:** prijava, osnova panela (navigacija, mock režim, sloj za podatke), lista sorti i uređivanje sorte (Osnovno, Cijena i stanje, Tekstovi, Osobine), ekran Cijene i količine, početna s brojačima.
- **3b:** podešavanja i tekstovi stranica.
- **4a:** konvertor slika, upload i biblioteka slika po sorti.
- **4b:** uvoz slika po imenu (sekcija 5).
- **4c:** nova sorta korak po korak.
- **5:** Objavi (Cloudflare Pages Function, dugme, status preko `build.json`).
- **6 i dalje:** SEO i brzina, sadržaj, kako piše u `PLAN.md`.

Napomena o objavi: hosting je Cloudflare Pages, pa je funkcija iz `PLAN.md` 4.5 Pages Function (`functions/api/publish.js`, putanja `/api/publish`). Funkcija provjerava ID token preko Google Identity Toolkita, poredi `localId` sa listom `ADMIN_UIDS` i tek tada poziva deploy hook.
