# Kombi – persönlicher Lebensmittel-Baukasten (Prototyp)

Kombi verwaltet, was ein kleiner Haushalt wirklich hat – vorgekochte Bausteine, Komplettgerichte,
Vorräte – und schlägt abends vor, was man daraus machen kann. Beide in der WG öffnen dieselbe
Adresse und sehen denselben Bestand – einen Login gibt es in v0.1 bewusst nicht.

**Stack:** Supabase (Postgres) · React + Vite (TypeScript) · GitHub Pages

## Was die App kann

Fünf Bereiche: **Start · Essen · Vorrat · Produktion · Einkauf** – gestaltet nach den Entwürfen: warmer, cremefarbener
Grund, weiße Karten, Fotos vom Essen, getönte Kacheln für den Zustand (rot = läuft ab, gelb = geöffnet, blau = aufgetaut,
grün = gut) und orangefarbene Pillen-Knöpfe; hell und dunkel. Wichtiges steht oben, Möglichkeiten darunter, Details erst beim Öffnen. Was man in einem Bereich geöffnet
oder gefiltert hat, bleibt beim Wechsel erhalten; jede Ansicht hat eine Adresse (z. B. `#/vorrat/gefrierfach`),
„Zurück“ funktioniert wie gewohnt.

- **🏠 Start (kompakt, iPhone-first):** kleiner Gruß, **Heute** („🍽️ 1.840 kcal · 2 Mahlzeiten · pro Person“, heutige
  Essenskosten, Frühstück/Mittag/Abendessen, optional „1.840 / 2.200 kcal“ mit eigenem Tagesziel), höchstens **eine** dezente
  Zeile wie „2 Lebensmittel bald verbrauchen“, **Was essen wir?** als kleine wischbare Karte (Bild, Name, Zeit · Kosten · kcal,
  verfügbar, **KOCHEN**), **der Monat in einer Zeile** (Einkäufe · Sonstiges · Ø / Mahlzeit; Produktion nur als Warenwert, nie
  addiert) und zwei Kacheln **Produktion** („2 geplant“) und **Einkauf** („5 offen“). „Heute wichtig“ steht nicht mehr als
  Kachel-Liste auf dem Start – Ablauf und Reste steuern im Hintergrund die Vorschläge und stehen im Vorrat.
- **🍽️ Essen:** „Heute“ – Vorschläge (KI oder Kombi-Regeln), „Reste zuerst verwerten“, Gefällt mir / Nicht meins /
  Ähnlich / Anderes, gespeicherte Rezepte; „Woche“ – flexibel planen, tauschen, verschieben, entfernen.
- **🍳 Kochen:** großer Name, Zeit, kcal und Kosten je Portion, deine Zutaten mit Mengen, was fehlt, Zubereitung.
  **Anzeigen ändert nichts** – entnommen wird erst nach „Kochen starten“ und Bestätigung.
- **📦 Vorrat:** Suche, Übersicht „Dein Vorrat · 26 Artikel“ (Frischware, Tiefkühl, Vorrat, Komponenten), Heute wichtig,
  Lagerorte als Fotokarten, „Wichtigste Vorräte“ mit Zustand (noch 2 Tage, geöffnet, aufgetaut, gut), alle Sorten. Ein Lagerort zeigt die Sorten gruppiert nach Art mit Menge, Status und **−**.
  Eine Sorte im Detail: Menge und Zustand, Entnehmen (Komplettgerichte als ganze Portionen), Damit möglich,
  Passt dazu, Auftauen – und unter „Details“ Preis, Haltbarkeit, Nährwerte, Zusammensetzung, Nutzung, Chargen.
- **Einbuchen:** **＋** oben im Vorrat → Sorte → Menge, optional MHD und bezahlter Betrag (zählt dann als Einkauf).
- **Entnehmen:** zuerst aus geöffneten Chargen, dann aus der mit dem frühesten Ablauf, sonst aus der ältesten (FIFO).
- **Rückgängig:** Nach jeder Buchung erscheint einige Sekunden lang „Rückgängig“. Das bucht eine Korrektur, ohne etwas zu löschen.
- **🍲 Produktion:** „Jetzt sinnvoll“ mit Foto und Grund („Läuft bald ab: Gehackte Tomaten“), „Geplant“ als Wochenstreifen,
  Vorgemerkt, Empfohlen (Kombi-Regeln, „Neue Ideen“ fragt die KI), deine Komponenten, größer vorkochen, **Verlauf**
  (die letzten Herstellungen mit Menge und Warenwert).
- **🛒 Einkauf:** „Zum Einkaufen“, „Für geplante Gerichte“, „Im Wagen“ – verrechnet mit dem Vorrat, Kosten nur aus bekannten Preisen.
- Hell- und Dunkelmodus (eigene, warme Farben für beide) folgen der Systemeinstellung.

> **Ohne Login:** Wer die App-Adresse kennt, kann den Bestand ansehen und ändern. Die Adresse also
> nur in der WG teilen. Löschen lässt sich trotzdem nichts: Jede Buchung bleibt in `bewegung`
> nachvollziehbar, Sorten können nicht gelöscht werden.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Supabase-Datenbank

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen. Als Region „Central EU (Frankfurt)“ wählen.
2. Links **SQL Editor** öffnen und nacheinander diese Dateien einfügen und mit **Run** ausführen:
   1. [`supabase/migrations/20260927120000_inventar.sql`](supabase/migrations/20260927120000_inventar.sql): Tabellen, Buchungsfunktionen, Rechte
   2. [`supabase/migrations/20260927180000_ohne_login.sql`](supabase/migrations/20260927180000_ohne_login.sql): gibt der App ohne Login Zugriff
   3. [`supabase/seed.sql`](supabase/seed.sql): Beispieldaten, 17 Sorten vom Kochtag 27.09.2026
   4. [`supabase/migrations/20260928090000_was_essen.sql`](supabase/migrations/20260928090000_was_essen.sql): Lagerort und Tabellen für „Was essen wir?“
   5. [`supabase/migrations/20260929090000_baukasten.sql`](supabase/migrations/20260929090000_baukasten.sql): Art, Einheit, Preisbezug, Zusammensetzung, Ablaufdatum, „geöffnet“, strukturierte Rezepte
   6. [`supabase/migrations/20260930090000_planung_einkauf.sql`](supabase/migrations/20260930090000_planung_einkauf.sql): Wochenplan, Einkaufsliste, Auftauen, Kochen/Herstellen in einem Schritt, Funktion der Komponenten, Nutzung
   7. [`supabase/migrations/20261001090000_kosten_naehrwerte.sql`](supabase/migrations/20261001090000_kosten_naehrwerte.sql): echte Kosten je Charge, Protokoll von Mahlzeiten und Produktion (Geld im Monat), Einkauf mit Preis, Nährwerte
   8. [`supabase/migrations/20261002090000_ausgaben.sql`](supabase/migrations/20261002090000_ausgaben.sql): sonstige Ausgaben (Kantine, Bäcker …) – eintragen und entfernen, nie löschen
   9. [`supabase/migrations/20261003090000_bilder_zutaten.sql`](supabase/migrations/20261003090000_bilder_zutaten.sql): eigene Bilder je Sorte (`image_*`), semantische Zutat je Sorte, Bild-Cache (`bild`), Speicher-Bucket „bilder“

   Bereits ausgeführte Dateien einfach überspringen und mit der nächsten weitermachen. Jede Datei nur **einmal** ausführen.
   Ohne Datei 5, 6, 7, 8 bzw. 9 läuft die App wie bisher und zeigt auf dem Start einen ruhigen Hinweis; die neuen Teile sind dann ausgeblendet.
   **Stand der echten Datenbank (Live-Check 28.09.2026):** nur Dateien 1–4 sind eingespielt – Planung, Einkauf, Kosten/Kalorien-Protokoll, Ausgaben und Bilder-Cache fehlen dort noch.
   Nach Datei 6 die Edge Function neu deployen (siehe „KI einrichten“), damit „Komponenten entdecken“, Woche und Reste die KI nutzen – sonst rechnet die App diese Teile lokal nach Kombi-Regeln.

   **Nicht `supabase db push` verwenden:** Die Dateien werden im SQL-Editor eingespielt, deshalb kennt die Migrations-Historie der CLI sie nicht – `db push` würde Datei 1 erneut ausführen und mit `relation "block_typ" already exists` abbrechen.
   **Vor dem Einspielen sichern:** [`scripts/daten-export.sql`](scripts/daten-export.sql) im SQL-Editor ausführen (nur lesend) und das JSON-Ergebnis als Datei speichern – Sorten, Chargen, Bewegungen und „Was essen wir?“-Daten.
   **Welche Dateien fehlen?** [`scripts/schema-stand.sql`](scripts/schema-stand.sql) im SQL-Editor ausführen (nur lesend): je Migrationsdatei „vollständig / teilweise / fehlt“ mit Liste des Fehlenden – Tabellen, Spalten, Funktionen, Trigger, Fremdschlüssel, RLS, Policies, Rechte, Bucket. Der Live-Check zeigt einen Teil davon bei jedem Lauf.

### 2. App lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
npm run dev              # → http://localhost:5173
```

Die Supabase-Werte stehen in der [`.env`](.env) im Repo:

- `VITE_SUPABASE_URL`: die Project URL
- `VITE_SUPABASE_KEY`: der **Publishable key** (bei älteren Projekten heißt er „anon public“)

Beides steht in Supabase unter **Project Settings → API Keys** bzw. über den Knopf **Connect**.
Der Publishable key ist öffentlich und steckt ohnehin in der fertigen App. **Niemals** den
Secret key bzw. `service_role`-Key in die `.env` schreiben – das Repo ist öffentlich.

**Am PC im Handy-Format ansehen:** In Chrome oder Edge mit `F12` die Entwicklertools öffnen und mit
`Strg+Umschalt+M` die Gerätesymbolleiste einschalten. Oben ein Handy wählen, z. B. „iPhone 12 Pro“ (390 × 844).
In Firefox öffnet `Strg+Umschalt+M` direkt die Handy-Ansicht.

Zum Testen auf dem Handy im selben WLAN: `npm run dev -- --host` starten und die angezeigte `http://192.168…:5173`-Adresse öffnen.

### 3. Aufs Handy: GitHub Pages

1. Im GitHub-Repo unter **Settings → Pages → Source** „GitHub Actions“ wählen. Außerdem unter **Settings → Environments → github-pages → Deployment branches and tags** den Branch `main` erlauben – sonst bricht der Schritt „veroeffentlichen“ mit *„Branch "main" is not allowed to deploy to github-pages due to environment protection rules“* ab (GitHub erlaubt dort anfangs nur den Default-Branch).
2. Auf den Branch `main` pushen. Du kannst den Workflow „Veröffentlichen (GitHub Pages)“ auch von Hand starten.
   Er nimmt die Werte aus der `.env`. Sind unter **Settings → Secrets and variables → Actions → Variables**
   `SUPABASE_URL` und `SUPABASE_KEY` gesetzt, haben diese Vorrang.
   Die App liegt dann unter `https://patricionoth-blip.github.io/Kombi_Prototyp/`.
3. Auf beiden Handys öffnen und **„Zum Home-Bildschirm“** hinzufügen.

> Hinweis: Kostenlose Supabase-Projekte pausieren nach etwa einer Woche ohne Nutzung. Im Supabase-Dashboard lassen sie sich mit einem Klick wieder starten.

## 🍽️ Heute essen (KI-Vorschläge)

Kombi fragt nicht „Welches Rezept möchtest du kochen?“, sondern „Was machen wir aus dem, was da ist?“.

- **Eine Karte nach der anderen.** Oben: Name, ein appetitlicher Satz, Bild, Zeit, Portionen, echte Kosten, verwendeter Vorrat, was fehlt und höchstens zwei Hinweise („Rettet Lebensmittel“, „Komplettgericht“, „Alles da“). Unter „Details & Zubereitung“: Schritte, warum jetzt, Kosten je Zutat, Unbekanntes.
- **Komplettgerichte** haben eine eigene Rolle: „heute einfach die Pizza“, Pizza mit Beilage oder ein Rezept aus Komponenten.
- **Gefällt mir** → Rezept speichern, **Einplanen** (für einen Tag) oder **Heute kochen**.
- **Heute kochen** ist eine eigene, große Ansicht: Name, Bild, Zeit, Portionen, echte Kosten, „Du brauchst“ mit Farbpunkt und den echten Vorratsobjekten („2× Tomaten-Basis“, „da: 4 · danach 2“), was fehlt, Hinweise („läuft in 2 Tagen ab“, „2 davon sind für „Lasagne“ eingeplant“) und die Schritte. **Kochen starten** zeigt genau, was entnommen wird – beim Komplettgericht „2 Portionen TK-Pizza entnehmen“, beim Rezept „2× Tomaten-Basis + 2× Linsen + 250 g Pasta“ – änderbar. Erst „Entnehmen & loslegen“ bucht, und zwar alles in **einer** Transaktion (klappt ein Posten nicht, wird nichts gebucht). Danach: Kochmodus mit abhakbaren Schritten (Display bleibt an, wo der Browser es kann), „Im Vorrat bleibt“ und Rückgängig.
- **Reste zuerst verwerten:** nur Gerichte, die wirklich etwas Dringendes aufbrauchen (geöffnet, aufgetaut, läuft bald ab, Kühlschrank-Rest) – kulinarisch sinnvoll, nichts wird zwanghaft kombiniert. Muss nichts weg oder passt nichts zusammen, sagt Kombi das offen.
- **Woche:** Kombi verteilt den **freien** Vorrat auf 3, 5 oder 7 Mahlzeiten – abwechslungsreich, ohne eine Portion doppelt zu verplanen. Jede geplante Mahlzeit lässt sich kochen, auf einen anderen Tag legen, tauschen oder entfernen. Geplantes **reserviert** nur (vorhanden / reserviert / einzukaufen / verbraucht); entnommen wird erst beim Kochen. Entfernen berechnet Reservierungen und Einkaufsliste neu.
- **Nicht meins** → vorsichtiges Lernen. Eine einzelne Ablehnung zählt kaum. Bei Ablehnungen in Folge wird die Suche stufenweise geöffnet: anderes Gericht → anderer Gerichtstyp → andere Gewürzrichtung → komplett andere Richtung.
- **Ähnlich** → ein anderes Gericht mit erkennbarer Gemeinsamkeit (z. B. gleiche Hauptzutat, anderer Typ).
- **Gerade etwas anderes** → ist **keine** Ablehnung: Es wird nichts gelernt, Ähnliches kommt nur für den Moment weiter nach hinten.
- **Abwechslung:** über Gerichtstyp, Hauptzutat, Sattmacher, Richtung, Zubereitung, warm/kalt und Textur. Nach drei Wraps kommt kein vierter, solange es Alternativen gibt.
- **Was muss weg?** Spontan genannte Kühlschrank-Reste werden für diese Suche berücksichtigt, aber nicht gespeichert.
- **Immer vorhanden:** Wasser, Salz, Pfeffer, Öl. Alles andere muss im Bestand stehen.
- **Notfall:** Reicht der Vorrat nicht, schlägt Kombi **eine** Zutat vor. Die Software bewertet dafür, wie viele Gerichte sie ermöglicht, wie gut sie zum Vorhandenen passt, Haltbarkeit, Lagerung und – nur wenn bekannt – den Preis.
- **Idee für euren Baukasten:** Gelegentlich schlägt die KI einen neuen vorkochbaren Baustein vor (Art, Lagerort, Portionen; Kosten nur aus bekannten Preisen). Angelegt wird er erst nach „Baustein übernehmen“ im vorausgefüllten Formular.

## 🍲 Produktion & Komponenten

Kombi ist ein Baukasten: **Zutaten** (einzelne Lebensmittel), **Komponenten** (vorbereitete Bausteine mit Zusammensetzung), darunter **Protein-Komponenten**, und **Komplettgerichte** (werden als Ganzes gegessen). Jede Komponente hat eine **Funktion**, abgeleitet aus der Kombi-Farbe: Basis & Soße (rot), Protein (braun), Gemüse (grün), Sattmacher (gelb), Gewürz & Booster (weiß), Crunch & Frisch (schwarz). Optional lassen sich „Passt in“ (Pasta, Wrap, Curry …) und eine Geschmacksrichtung hinterlegen – sonst gelten die typischen Gerichtsarten der Funktion.

Komponenten haben keinen eigenen Reiter mehr, sondern erscheinen dort, wo sie gebraucht werden: „Aus deinen Komponenten“ beim Essen, „Komponenten im Bestand“ im Vorrat, Herstellen und Entdecken in der Produktion.

- **Empfohlen:** Kombi rechnet Ideen aus dem Vorrat nach Regeln; „Neue Ideen“ fragt die KI – **A) verwerten**, was da ist, oder **B) neu**, mit „fehlt: …“. Die Software prüft jede Idee (nur echte Zutaten, Name passend zum Inhalt), rechnet Mengen, Kosten und Kalorien aus hinterlegten Daten und bewertet die **Nutzbarkeit** (1–5 ★) selbst.
- **Produktion in zwei Schritten:** Portionen wählen → Zutaten werden **skaliert** und gegen den Vorrat geprüft (vorhanden / nur teilweise / fehlt / nicht im Vorrat erfasst) → optional „Fehlendes auf die Einkaufsliste“ → bestätigen mit der **tatsächlichen** Menge („3 statt 4 Portionen“ zählt) und optional MHD. Erst dann wird gebucht – **eine** Transaktion: Zutaten raus, neue Charge rein, mit den echten Kosten der entnommenen Zutaten. Gibt es die Komponente noch nicht als Sorte, wird sie dabei angelegt.
- **Nichts wird automatisch gespeichert.** Vormerken legt nur einen Plan an (Fehlendes landet auf der Einkaufsliste).
- **Nährwerte aus der Produktion:** Hat die Komponente noch keine Nährwerte, rechnet Kombi sie nach dem Herstellen aus den **tatsächlich entnommenen** Zutaten (÷ hergestellte Portionen) und hinterlegt sie – aber nur, wenn für **jede** Zutat Menge und Nährwerte bekannt sind (kein „Öl nach Gefühl“, keine nicht erfasste Zutat). Sonst bleibt „unbekannt“. Von Hand eingetragene Werte werden nie überschrieben. Eine gegessene Portion zählt danach mit ihren eigenen kcal – die Zutaten darin nicht noch einmal.
- **Größer vorkochen?** Nur aus echten Buchungen: Wird eine selbstgemachte Komponente mindestens 2× in 8 Wochen hergestellt und regelmäßig verbraucht, schlägt Kombi eine Menge vor, die etwa 2 Wochen reicht – begrenzt durch die Haltbarkeit. Zu wenig Daten → keine Empfehlung.

## 🛒 Einkaufsliste

Die Liste verbindet alles: Einkauf → Vorrat → Komponente → Essen → Verbrauch → Einkauf.

- **Quellen:** geplante Mahlzeiten, vorgemerkte Komponenten, fehlende Zutaten eines Rezepts, von Hand („500 g Zwiebeln“, „2 Paprika“, „Basilikum“), Mindestbestand.
- **Verrechnet:** Gleiche Produkte werden zusammengeführt (150 g + 200 g + 300 g Zwiebeln, 200 g im Vorrat → **eine** Zeile „450 g“). Geplantes wird gegen den verwendbaren Vorrat gerechnet (Abgelaufenes zählt nicht, Geöffnetes schon), jede Menge nur einmal – der spätere Plan bekommt nur den Rest.
- **Bedienen:** „Zum Einkaufen“ und „Für geplante Gerichte“, abhaken, Menge ändern oder etwas dazukaufen, später, löschen/ausblenden, zurückholen.
- **Abhaken bucht nichts.** Erst „Einbuchen“ im Wagen bucht – mit der **tatsächlich** gekauften Menge (300 statt 500 g), optional MHD und bezahltem Preis (wird der neue Preis der Sorte). Jede Zeile lässt sich nur einmal einbuchen; Rückgängig geht.
- **Kosten nur aus echten Preisen:** Summe der bekannten + „N ohne Preis“. Gerechnet wird in ganzen Packungen: 450 g gebraucht, gespeichert „0,99 € für 1 kg“ → eine Packung, 0,99 €.

## 🧊 Auftauen

Für heute oder morgen geplante Mahlzeiten zeigt „Für heute auftauen“, was aus dem Gefrierfach sollte – z. B. „Morgen eingeplant: 2 Portionen Lasagne → heute zum Auftauen vormerken“. Regel: Vorgekochtes (Komplettgerichte, Basis/Soße, Protein, Gemüse als Komponente) einen Tag vorher; TK-Zutaten, Brot und Gekauftes nach Packung. Status: eingefroren → Auftauen geplant → aufgetaut → verbraucht. **Vormerken und „herausgenommen“ ändern den Bestand nicht** – entnommen wird beim Kochen. Kombi erinnert in der App; Push-Benachrichtigungen gibt es nicht.

### Wer macht was?

| Software (verlässlich, getestet) | KI (kreativ) |
|---|---|
| Bestand, Mengen, Einheiten, Portionen | Ideen und Kombinationen |
| Kosten und Preise (siehe unten) | Namen und Beschreibungen |
| Ablauf, geöffnet, Entnahme-Reihenfolge | Zubereitung und Varianten |
| Prüfung jedes Vorschlags, Rangfolge, Abwechslung | Interpretation des Vorhandenen |
| Nutzbarkeit, Reservierungen, Einkaufsliste, Auftau- und Batch-Regeln | Komponenten-Ideen und wofür sie taugen |
| Datenbank, Feedback, harte Regeln | – |

Die KI kennt nur, was ihr die App schickt – als strukturiertes JSON (siehe „Was die KI bekommt und liefert“), geordnet nach Komplettgerichten, Komponenten, Zutaten, dazu Reste, je mit Rolle, Menge, Lagerort, Ablauf, „passt in“, Richtung, semantischer Zutat und `zusammensetzung: null` (= unbekannt), wo nichts eingetragen ist. Ihr Auftrag lautet: **„Kombi ist KEINE normale Rezept-App … Finde sinnvolle Kombinationen dieser Bausteine.“** Bei einer TK-Pizza ohne bekannte Zusammensetzung darf sie also nicht annehmen, dass Tomaten, Käse oder Weizen darin sind. Jeder Vorschlag wird geprüft:

- Zutaten, die es nicht gibt, stehen nie unter „vorhanden“, sondern unter „fehlt“.
- **Kreativität ja, Halluzination nein:** Name und Beschreibung dürfen nur Zutaten nennen, die im Gericht wirklich stecken (verwendete Einträge, deren bekannte Zusammensetzung, „fehlt“). Aus einer „Pizza“ ohne bekannten Belag wird also keine „Salami-Pizza“ – so ein Vorschlag wird verworfen, erfundene Sätze werden entfernt. Braucht die Zubereitung etwas, das es im Haushalt nicht gibt, steht es ehrlich unter „fehlt“.
- Preisangaben der KI, „vegan/glutenfrei“ und „hausgemacht“ ohne Grundlage werden entfernt.

## 🖼️ Bilder

Rezepte, Komponenten, Zutaten und Lagerorte bekommen Bilder – aber **nie eine erfundene Bildquelle**. Priorität:

**eigenes Bild → echt gefundenes Foto → generiertes Bild → lokales Fallback → kein Bild**

- **Bildanforderung:** Für jedes Gericht und jede Komponente baut die Software aus den strukturierten Daten (verwendete Sorten, bekannte Zusammensetzung, Gerichtstyp, semantische Zutaten) einen Suchbegriff und eine Bildbeschreibung. Den Vorschlag der KI („tomato cucumber yogurt bowl“) übernimmt sie nur, wenn er keine Zutat nennt, die nicht im Gericht steckt („steak with fries“ bei einer Gurken-Bowl wird verworfen) und keine URL enthält.
- **Bildsuche (Wikimedia Commons, ohne Key):** nur Fotos (jpeg/png/webp) mit **freier Lizenz** (CC0, CC BY, CC BY-SA, gemeinfrei), deren Titel/Beschreibung das Gesuchte nennt (bei zusammengesetzten Gerichten mindestens zwei Begriffe), **keine fremden Zutaten** zeigt (kein „Falafel mit Hähnchen“) und kein Logo/keine Pflanze/Grafik ist. Die URL wird vor dem Speichern abgerufen (erreichbar, wirklich ein Bild). Gespeichert werden URL, Quelle, Suchbegriff, Zeitpunkt, Lizenz und Urheber; die Kochansicht zeigt den Nachweis („Foto: … · CC BY-SA 4.0 · Wikimedia Commons“). Live-Check 28.09.2026: Falafel (CC BY-SA 3.0) und Tomaten (CC0) gefunden und erreichbar.
- **Bildgenerierung (optional):** Nur wenn kein passendes Foto gefunden wurde **und** eingerichtet: `BILD_API_KEY` (Standard-Anbieter `openai`, Modell `gpt-image-1`; `BILD_ANBIETER=together` oder `eigen` mit `BILD_BASIS_URL`, `BILD_MODELL`). Die Beschreibung entsteht nur aus dem geprüften Motiv (Katalog-Zutaten, Gerichtstyp; unbekannter Inhalt wird als „nicht angegeben“ beschrieben – aus einer Pizza ohne bekannten Belag wird keine Salami-Pizza). Das Bild wird im öffentlichen Supabase-Bucket „bilder“ dauerhaft abgelegt (kein Hotlink auf temporäre Anbieter-URLs). Die Edge Function baut die Beschreibung selbst neu – ein mitgeschickter Freitext wird nie verwendet. Einrichten: `npx.cmd supabase secrets set BILD_API_KEY=… --project-ref …`; Kosten beim Bild-Anbieter mit einem Budget-Limit begrenzen, da die Function öffentlich erreichbar ist.
- **Nie Pflicht:** Ist nichts eingerichtet, nicht erreichbar oder unpassend, zeigt die App ein lokales Foto (`src/bilder/`) oder eine warme Kachel mit passendem Symbol (nach Name, sonst nach Zutat-Kategorie oder Rolle). Lädt ein Bild nicht, springt die Anzeige sofort auf das Fallback – kein kaputtes Bild-Symbol; der Cache-Eintrag wird als „fehler“ markiert (nichts wird gelöscht).
- **Cache & Performance:** Tabelle `bild` (Migration 9) – gleicher Inhalt (z. B. `gericht:bowl:gurke+joghurt+tomate`, unabhängig vom kreativen Namen) wird nie erneut gesucht oder generiert. Gesucht wird nur für sichtbare Hauptkarten (Start, Essen, Kochansicht, Produktion „Jetzt sinnvoll“, Sorten-Details), höchstens zwei Anfragen gleichzeitig, einmal je Sitzung. Listen bekommen kleinere Varianten (Commons 160–320 px), Bilder laden lazy.
- **Eigene Bilder:** Sorte bearbeiten → Mehr Details → „Eigenes Bild“ (https-Adresse). Lagerorte haben lokale Fotos.
- Gefundene und generierte Bilder dürfen nur von `upload.wikimedia.org` bzw. dem eigenen Supabase-Speicher kommen (App **und** Datenbank prüfen das).

## 🥕 Zutaten: Produkt → Zutat → Verwendung

Die Sorte bleibt das gekaufte Produkt („REWE Strauchtomaten 500 g“, mit Preis, Menge, Lagerort). Was es als Lebensmittel **ist**, steht getrennt im Katalog `supabase/functions/_shared/kombi/zutaten.ts`: „Tomate“ – Gemüse, frisch, roh/gekocht, passt in Soße, Salat, Pasta, Bowl, Curry. Rund 80 normale Lebensmittel (Tomate, Gurke, Joghurt, Zwiebel, Knoblauch, Paprika, Kartoffeln, Karotten, Spinat, Brokkoli, Reis, Pasta, Brot, Wraps, Haferflocken, Linsen, Kichererbsen, Bohnen, Käse, Tofu, Seitan …).

- Erkannt wird deterministisch aus dem Produktnamen (Marke, Größe, Beiwörter werden ignoriert); Spezielles vor Allgemeinem („Tomatensoße“ ist keine rohe Tomate, „Gehackte Tomaten (Dose)“ sind Dosentomaten). **Unbekanntes bleibt unbekannt** – es wird nichts geraten. Optional überschreibt die Spalte `block_typ.zutat` die Erkennung.
- Genutzt für: das JSON an die KI (Kategorie, Verwendung), Bildsuche/-beschreibung (englische Begriffe), die Prüfung gefundener Fotos und die Regel-Vorschläge ohne KI.
- **Ohne KI (Demo/Regeln):** Neben dem Baukasten (Basis + Protein + Sattmacher + Gemüse) gibt es eine Stufe „frische Küche“ für normale Zutaten: Salat, Bowl, Toast, Auflauf, Frühstück – z. B. „Sommer-Crunch mit Joghurt“ aus Tomate, Gurke, Joghurt oder „Überbackene Brokkoli-Pasta“. Belag wird nie über den Bestand hinaus eingeplant.

### Kosten

Eine zentrale, deterministische Funktion (`supabase/functions/_shared/kombi/kosten.ts`):

- Preis pro Einheit = gespeicherter Preis ÷ Menge, auf die er sich bezieht. **2,00 € für 4 Portionen → 0,50 € pro Portion; 2 Portionen verbraucht → 1,00 €.**
- Gramm, ml und Stück werden genauso proportional gerechnet (1,29 € für 500 g → 125 g = 0,32 €). Gerundet wird erst am Ende.
- Unbekannter Preis bleibt unbekannt: „Preis unbekannt“ bzw. „ab 0,40 € / Portion“, wenn nur ein Teil bekannt ist. „ca. 1,24 € / Portion“ erscheint nur, wenn alles berechnet werden konnte.
- **Einkauf ≠ Verbrauch ≠ Herstellung:** Einkaufskosten in ganzen Packungen; Herstellungskosten einer Komponente aus ihren Zutaten; wird die fertige Komponente verwendet, zählt ihr Portionspreis – sie wird nicht noch einmal als Einkauf berechnet.
- **Echte Kosten je Charge** (Migration 7): Jede Einbuchung mit Preis und jede Produktion merkt sich, was sie gekostet hat. Beim Kochen zählt der Wert der tatsächlich entnommenen Chargen – eine spätere Preisänderung der Sorte ändert daran nichts. Beispiel: Tomaten-Basis kostet 1,44 € für 6 Portionen → 2 Portionen verbraucht = 0,48 €.

### Geld im Monat (Start)

- **Für Einkäufe ausgegeben:** nur, was wirklich bezahlt wurde – Einkäufe aus der Liste und Einbuchungen mit „Bezahlt“. Einkäufe ohne Preisangabe werden gezählt, aber nicht geschätzt.
- **Gekocht** und **Produktion:** Wert der verbrauchten Zutaten (Warenwert) – das ist kein zusätzliches Geld und wird **nie** zu den Ausgaben addiert. „Ø pro Mahlzeit“ erscheint nur, wenn für jede Mahlzeit alle Preise bekannt sind; sonst steht dort „ab …“ oder „unbekannt“.
- **Sonstiges** (Migration 8): von Hand eingetragene Ausgaben ohne Bezug zum Vorrat, z. B. Kantine oder Bäcker. Die große Zahl ist **Einkäufe + Sonstiges** – nur echtes Geld; die Produktion steht daneben als Warenwert und wird nicht addiert.
- **Vergleich zum Vormonat:** fair bis zum gleichen Tag (am 28. also 1.–28. des Vormonats). Gab es im Vormonat keine Ausgaben, wird nichts verglichen.

### Kalorien

- **Heute auf dem Start:** kcal **pro Person** = kcal der tatsächlich entnommenen Mengen ÷ Portionen, summiert über die heute gekochten Mahlzeiten; dazu die heutigen Essenskosten (Warenwert der gekochten Mahlzeiten + sonstige Ausgaben von heute, z. B. Kantine) und Frühstück/Mittag/Abendessen nach Uhrzeit. „ab …“, wenn für manche Sorten Nährwerte fehlen, „kcal unbekannt“, wenn keine bekannt sind. Ein **persönliches Tagesziel** (500–8.000 kcal) lässt sich über einen Tipp auf „Heute“ setzen – es bleibt nur auf diesem Gerät; der Balken erscheint nur bei vollständig bekannten Werten.
- **Komponenten** haben eigene Nährwerte (z. B. Tomaten-Basis 45 kcal / Portion). Wird eine Portion gegessen, zählen diese 45 kcal – die Tomaten darin nicht noch einmal.
- Nur aus hinterlegten Nährwerten (von der Packung): kcal, Eiweiß, Kohlenhydrate, Fett – **je 100 g/ml** oder je Portion/Stück. Leer = **unbekannt, nicht 0**.
- Gerichte rechnen aus den echten Mengen: „620 kcal / Portion“, „ab 450 kcal“, wenn nur ein Teil bekannt ist, sonst „kcal unbekannt“. Wasser, Salz und Pfeffer zählen als 0 kcal, Öl ohne Menge bleibt unbekannt.
- Die KI liefert keine Kalorien; Angaben von ihr werden ignoriert. „Heute gekocht … kcal“ erscheint nur für wirklich gekochte Mahlzeiten mit vollständig bekannten Werten.

### KI einrichten (kostenlos)

Ohne Einrichtung läuft „Was essen wir?“ im **Demo-Modus**: Vorschläge nach Kombi-Regeln, ohne KI. Für kreative KI-Vorschläge:

1. **Kostenlosen API-Key holen**, z. B. bei [Groq](https://console.groq.com/keys): mit Google/GitHub anmelden, „Create API Key“. Keine Kreditkarte nötig.
2. **Edge Function deployen** (im Projektordner, Windows-PowerShell, deshalb `npx.cmd`):
   ```
   npx.cmd supabase login
   npx.cmd supabase functions deploy was-essen --project-ref yjjgfdvpqmclocgejrhz --no-verify-jwt
   npx.cmd supabase secrets set KI_API_KEY=DEIN_GROQ_KEY --project-ref yjjgfdvpqmclocgejrhz
   ```
   `--no-verify-jwt` ist nötig, weil der Publishable key kein JWT ist. Die Function hat ohnehin keinen Datenbankzugriff.
   Falls eine Meldung zu Docker kommt: an den deploy-Befehl `--use-api` anhängen.
3. Fertig. Unter der Karte steht dann „Ideen von der KI (…)“ statt „Demo ohne KI“.

**Nach einem Update der Kombi-Engine** (z. B. diesem) die Edge Function neu deployen, sonst läuft auf Supabase noch die alte Prüflogik:
```
npx.cmd supabase functions deploy was-essen --project-ref yjjgfdvpqmclocgejrhz --no-verify-jwt
```
Deployt wird der Code im **gerade ausgecheckten** Ordner – vorher den aktuellen Stand holen (`git switch main` und `git pull`). Bricht `git switch` wegen lokaler Änderungen ab (z. B. `package.json` nach `npm install supabase`), diese erst mit `git stash` beiseitelegen – sonst wird weiter der alte Code deployt.
Kontrolle: `GET …/functions/v1/was-essen` muss JSON mit `version` liefern. `{"fehler":"Nur POST."}` (HTTP 405) heißt: Es läuft noch Code ohne Health-Check.

**Anbieter wechseln** – nur Secrets ändern, kein Code:

| `KI_ANBIETER` | Kostenlos? | Standard-Modell (`KI_MODELL` überschreibt) |
|---|---|---|
| `groq` (Standard) | Gratis-Kontingent, sehr schnell | `openai/gpt-oss-120b` |
| `gemini` | Gratis-Stufe von Google AI Studio | `gemini-2.5-flash` |
| `openrouter` | Gratis-Modelle mit Tageslimit | `meta-llama/llama-3.3-70b-instruct:free` |
| `ollama` | lokal auf dem eigenen PC, kein Key | `llama3.1` (+ `KI_BASIS_URL`) |
| `eigen` | jeder OpenAI-kompatible Dienst | `KI_MODELL` und `KI_BASIS_URL` setzen |

Beispiel: `npx.cmd supabase secrets set KI_ANBIETER=gemini KI_API_KEY=… --project-ref …`.
Modelle ändern sich bei den Anbietern gelegentlich. Meldet die App „Modell nicht verfügbar“, ein aktuelles Modell als `KI_MODELL` setzen.

### KI-Verbindung prüfen (Health-Check)

Die Kette ist nachvollziehbar: **App → Edge Function `was-essen` → KI-Anbieter → Modell → JSON → Kombi-Prüfung → Rezeptkarte.**

- `GET …/functions/v1/was-essen` liefert **ohne Keys**: Engine-Version, ob die KI eingerichtet ist, Anbieter, Modell, Host und die Bild-Einrichtung.
- `GET …/functions/v1/was-essen?probe=1` macht zusätzlich **einen echten, kleinen Aufruf** mit einem festen Beispiel-Haushalt (keine echten Daten, nichts wird gespeichert) und meldet Antwortzeit, JSON gültig, Format gültig, wie viele Vorschläge die Prüfung bestanden, was verworfen wurde und ob die Bildanforderungen passten.
- In der App: **Essen → Ändern → KI** zeigt dasselbe; „Testen“ startet den Probelauf. Ist keine KI eingerichtet, steht dort ehrlich „Nicht eingerichtet – Vorschläge nach Kombi-Regeln“.
- App und Function tragen dieselbe Engine-Version (`ENGINE_VERSION` in `gesundheit.ts`). Weicht sie ab, bittet die App um ein neues Deployment.
- Der **Live-Check** (GitHub Actions, bei jedem Push) ruft den Health-Check auf, bei eingerichteter KI den Probelauf – bei einer älteren Function einen kleinen POST-Probelauf. Fehler externer Dienste (Kontingent, Wikimedia) erscheinen als ⚠, nicht als Code-Fehler.
- **Live-Stand 28.09.2026, 17:28 UTC:** Function aus `main` deployt – `GET` → 200, `x-kombi-version: 2026-09-28.2`, KI eingerichtet (groq · openai/gpt-oss-120b). Probelauf: 4,7 s, JSON und Format gültig, 2 von 2 Vorschlägen bestanden, 2/2 Bildanforderungen passend. In der App: „Testen“ → „Live getestet: 5,2 s“. Die Bildpipeline der Function findet Commons-Fotos (Generierung nicht eingerichtet).

### Was die KI bekommt und liefert

- **Strukturiertes JSON statt Stichworten:** `{"inventar":[{"id":"b31","name":"Strauchtomaten","typ":"zutat","rolle":"Gemüse","menge":500,"einheit":"g","portionen":5,"lagerort":"kuehlschrank","ablauf_in_tagen":null,"geoeffnet":false,…,"zutat":{"id":"tomate","kategorie":"gemuese","verwendung":["sosse","salat","pasta","bowl","curry"]},"preisklasse":"€€"}],"kuehlschrank_reste":[{"id":"k1","name":"halbe Paprika","menge":null}],"immer_da":[…]}` – `menge: null` heißt **unbekannt** (nie eine Zahl behaupten), `zusammensetzung: null` heißt **unbekannt** (nichts über den Inhalt behaupten).
- Die KI liefert Gerichte mit Namen, Beschreibung, Zubereitung, Eigenschaften und höchstens eine **Bildanforderung** `{"image_request":{"needed":true,"query":"tomato cucumber yogurt bowl","style":"appetizing food photography","aspect_ratio":"4:3"}}` – **nie eine URL**.
- **Kreative Namen erwünscht** („Rote Samt-Pasta“, „Sommer-Crunch mit Zitronenjoghurt“), langweilige Standardnamen („Tomaten-Pasta“, „Gemüse-Reis“) nicht – aber jedes Zutat-Wort im Namen muss im Gericht stecken.
- Die Software entfernt aus KI-Texten: Preise, **Kalorien-/Nährwertbehauptungen** („nur 450 kcal“, „proteinreich“), **Bestandsmengen** („Du hast noch 3 Tomaten“), **Links und Bild-URLs**, Diät-Behauptungen und „hausgemacht“ ohne Grundlage. Mengen, Kosten und kcal rechnet ausschließlich die Software.
- Die KI verändert nichts: keine Entnahme, keine Buchung, nichts wird gespeichert – Vorschläge werden erst nach Bestätigung zu Plänen, Sorten oder Buchungen.

### KI-Benchmark

`npm run benchmark` misst 30 reproduzierbare Szenarien (`scripts/benchmark/szenarien.ts`: frische Zutaten, Komponenten, Komplettgerichte, unbekannte Zusammensetzung, Ablauf, Kühlschrank-Reste, Notfall, leerer Haushalt, Feedback, Abwechslung, Reste, Komponenten-Ideen, Woche, 4 Personen, Abgelaufenes …). Je Anbieter/Modell und Szenario: Antwortzeit, JSON gültig, Format gültig, bestanden/verworfen, **Halluzinationen aus der Rohantwort** (erfundene Zutaten, Mengen über dem Bestand, Preise, kcal, Bestandsmengen, Bild-URLs), Anteil aus dem Vorrat, Komponenten, Dringendes genutzt, Kreativität, generische Namen, Vielfalt, Bildanforderung vorhanden/plausibel.

- **Fair:** Punkte gibt es nur für geprüfte Vorschläge; jede erfundene Tatsache kostet 5 Punkte. Wo „nichts“ richtig ist (leerer Haushalt, Reste ohne Dringendes), wird Zurückhaltung belohnt.
- Ohne Keys laufen nur die Kombi-Regeln (und mit `--attrappe` eine absichtlich halluzinierende Attrappe, die zeigt, dass Erfundenes bestraft wird). Mit Keys: `GROQ_API_KEY=… GEMINI_API_KEY=… BENCH_ANBIETER=groq,gemini npm run benchmark` (Modelle über `BENCH_MODELL_GROQ` usw.) – oder in GitHub: **Actions → KI-Benchmark → Run workflow** (Keys als Repository-Secrets `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`).
- Stand 28.09.2026, lokal gemessen (ohne KI-Keys): Kombi-Regeln Ø 71 Punkte, 66/78 Vorschläge bestanden, **0 Halluzinationen**; Attrappe Ø 5 Punkte, 378 gezählte erfundene Fakten. **Echte KI-Modelle wurden noch nicht verglichen** – dafür fehlen hier die Keys.

> **Datenschutz:** An die KI gehen nur Sortennamen, Mengen, Preisklassen (keine Beträge), bekannte Zusammensetzungen, Notizen, Namen gespeicherter Rezepte und euer Kühlschrank-Text. Gratis-Stufen dürfen Eingaben laut ihren Bedingungen teils zur Verbesserung ihrer Modelle nutzen.

### So ist es gebaut

```
App: Bestand laden → Snapshot (+ Kühlschrank, + Grundausstattung) → Session-Kontext (gesehen, Feedback)
  → Edge Function „was-essen“ (API-Key nur hier) → KI-Anbieter (austauschbar) → JSON
  → Prüfung durch die Kombi-Engine: nur echte Bausteine, Mengen/Kosten selbst gerechnet,
    erfundene Zutaten und Behauptungen raus, Duplikate und abgelehnte Richtungen raus,
    Rangfolge, Auswahl mit Abwechslung
  → Karte → Nutzer entscheidet → erst dann Datenbankänderung (entnehmen(), Rezept, Sorte)
```

- **Kombi-Engine** (`supabase/functions/_shared/kombi/`): reines TypeScript ohne Abhängigkeiten. Läuft in der Edge Function (Deno), im Browser (Demo-Modus) und in den Node-Tests. Sie hat keinen Datenbankzugriff und kann den Bestand deshalb gar nicht ändern.
- **Rangfolge:** vorhandene Zutaten statt Einkauf, Dringlichkeit (geöffnet > bald ablaufend > kleine Reste > Komplettgerichte > Komponenten > Vorräte), sehr günstig (Stufen, nicht linear), einfach, sättigend, Abwechslung, Session-Vorlieben und gespeicherte Lieblingsrezepte, natürlicher Name. Alles ist ein Faktor unter mehreren, nichts „blind“. Die Gewichte stehen gebündelt in `bewertung.ts`.
- **Tabellen:** `koch_session`, `vorschlag` (was gezeigt wurde), `vorschlag_feedback` (like, dislike, similar, skip, save, cook), `rezept` (mit Gerichtstyp, Zutaten und Mengen, Portionen, Schritten, Bestandsarten, Tags, berechneten Kosten und Feedback). Die App darf dort nur lesen und anlegen.

## Tests

Die Tests prüfen die Akzeptanzkriterien direkt in der Datenbank:

- FIFO: Chargen [2, 5] minus 3 ergibt [0, 4].
- Eine zu große Entnahme ergibt eine Fehlermeldung, und nichts ändert sich.
- „Nachkochen“ und „Bald ablaufen“ erscheinen richtig.
- Jede Bestandsänderung steht in `bewegung`.
- Rückgängig funktioniert.
- Die Zugriffsrechte stimmen: Die App darf lesen, Sorten pflegen und buchen, aber Chargen und Bewegungen nicht direkt ändern.
- Baukasten: Einordnung vorhandener Sorten, Einheiten in g/ml, Ablaufdatum, Entnahme-Reihenfolge geöffnet → frühester Ablauf → FIFO, strukturierte Rezepte.
- Planung & Einkauf: `kochen()` alles oder nichts (Plan erledigt, nicht doppelt, Rückgängig), `herstellen()` in einem Schritt, Auftauen ändert keinen Bestand, Einkauf → Vorrat mit tatsächlicher Menge und ohne Doppelbuchung, Nutzung ohne Rückgängig-Buchungen, Rechte ohne Login.
- Sonstige Ausgaben: eintragen, als entfernt markieren und zurückholen, nicht löschbar, Betrag nachträglich nicht änderbar, unplausible Beträge und Daten abgelehnt.
- Kosten & Nährwerte: Einkauf 1000 g für 3,00 € → Produktion → 6 Portionen für 1,44 € → 2 Portionen gegessen = 0,48 € (nicht doppelt gezählt, spätere Preisänderung ohne Wirkung), tatsächliche Menge (7 statt 8), unvollständige Preise lernen keinen Preis, Rückgängig nur für unberührte Chargen, kcal aus Nährwerten, Protokolle ohne direkten Schreibzugriff.
- Bilder & Zutaten: eigenes Bild nur https, keine zufälligen Hotlinks im Cache, gefundenes Bild nur mit Lizenz und Quelle, generiert = `image_generated`, Status beim Anlegen nicht setzbar, kaputt markieren statt löschen (Zeitstempel aktualisiert), URL nachträglich nicht änderbar, Zutat nur als Katalog-id.

```bash
npm test            # alles
npm run test:ki     # nur „Was essen wir?“ – läuft überall, auch unter Windows
npm run test:db     # nur Datenbank
```

Die 276 Tests in `tests/ki/` laufen ohne KI und ohne Kosten, mit einem regelbasierten Anbieter und KI-Attrappen. Sie prüfen unter anderem:
- Bilder: nur sichere https-URLs, keine Hotlinks, Priorität eigen → gefunden → generiert → lokal → keins, kaputte Quelle (Status „fehler“) und fehlendes Bild → Fallback, Bildanforderung der KI (übernommen / „steak“ verworfen / URL verworfen / fehlt), Beschreibung nur aus Rezeptdaten, unbekannte Pizza bleibt Pizza, Commons-Auswertung (Lizenz, Motiv, fremde Zutaten, Pflanze statt Lebensmittel), Pipeline gefunden/generiert/nichts/offline, Keys nie im Ergebnis, jede App-Anfrage besteht die Prüfung der Function
- Semantische Zutaten: „REWE Strauchtomaten 500 g“ → Tomate, Spezielles vor Allgemeinem, Unbekanntes bleibt unbekannt
- KI-Verbindung: Health-Check ohne Keys, Probelauf (JSON gültig/ungültig, nur Halluzinationen → nicht ok), Edge Function GET/POST/Bild
- Wahrheit: keine Bestandsmengen, kcal-/Nährwertbehauptungen, Links in KI-Texten; Prompt als strukturiertes JSON
- Startseite „Heute“: kcal pro Person, teilweise/unbekannt ≠ 0, Kosten inkl. Sonstiges, Ziel, Komponente ohne Doppelzählung; ein Hinweis statt Kacheln; Produktionsgründe aus Daten
- Benchmark: 30 Szenarien, Halluzinationen werden gezählt, die Attrappe verliert deutlich, Regeln ohne erfundene Fakten, normale Zutaten ergeben Gerichte
- die Kostenfunktion (2,00 € für 4 Portionen, Gramm/ml/Stück, unbekannt, teilweise, Rundung am Ende)
- keine erfundenen Bestände, Zutaten, Inhalte oder Preise (z. B. keine „Salami-Pizza“ bei unbekanntem Belag) – und keine falschen Alarme bei guten Namen
- Komplettgericht / Komplettgericht mit Beilage / Rezept und „Heute kochen“ in Einheiten
- geöffnet, bald ablaufend, abgelaufen, Reste; Priorität mit Augenmaß
- Abwechslung (kein vierter Wrap), „gerade etwas anderes“ ≠ „Nicht meins“, Lieblingsrezepte
- Notfall-Einkauf mit Begründung aus Daten, Baustein-Ideen mit Kosten nur aus bekannten Preisen
- strukturiert gespeicherte Rezepte, alte Rezepte, „keine Datenbankänderung ohne Bestätigung“
- Kochansicht und Entnahmetext (Komplettgericht / Rezept), Reservierungen anderer Pläne
- Komponenten: Rolle, Zusammensetzung, unbekannter Inhalt, keine erfundenen Inhalte, Nutzbarkeit, Kosten, fehlende Zutaten, gespeichert erst nach Bestätigung
- Einkaufsliste: Zusammenführen, Verrechnen mit dem Vorrat, reservierte Mengen, tatsächlich gekaufte Menge, unbekannte Preise, Packungsgrößen, Mangel
- Woche ohne Doppelreservierung, geplante Mahlzeit entfernen, Resteverwertung (auch „nichts Sinnvolles möglich“), Auftau-Regeln, Batch-Cooking nur aus echten Daten
- Kalorien: Summe aus echten Mengen, je Portion, unbekannt ≠ 0, teilweise („ab …“), Makros nur wenn vollständig, KI-Angaben ignoriert; Produktion skalieren (vorhanden / benötigt / fehlt)
- Oberfläche ohne Browser: fünf Bereiche, Zustand beim Wechsel, Adressen und Zurück, Start immer zuerst; Startseite: Ausgaben ohne Doppelzählung, Monatskosten, Ø pro Mahlzeit, heute gekocht, Reihenfolge, Dringendes; „Heute wichtig“, Lagerorte, Füllstand, Vorratswert, Suche

Für `test:db` müssen die Postgres-Programme installiert sein (macOS: `brew install postgresql`, Ubuntu/WSL: `sudo apt install postgresql`). Das Skript startet eine Wegwerf-Datenbank und löscht sie danach wieder. Die echte Supabase-Datenbank wird nie angefasst. Zum Schluss prüft es, dass `scripts/schema-stand.sql` nach allen Migrationen „vollständig“ meldet – so bleibt die Diagnose für die echte Datenbank aktuell.
Bei jedem Push laufen alle Tests, der App-Build und eine Deno-Prüfung der Edge Function automatisch in GitHub Actions (Workflow „CI“).

**Live-Check:** Der Workflow „Live-Check (echte Supabase)“ prüft bei jedem Push die echte Datenbank
aus der `.env` (Migrationen, Seed, Rechte, Buchungsfunktionen), die KI-Verbindung (Health-Check, Probelauf), die Bildsuche
(Wikimedia Commons) und klickt die gebaute App im Browser durch – auf 390 px und 375 px Breite (kein horizontaler Überlauf,
Reiter vollständig, keine kaputten Bilder), im Dunkelmodus und mit Höhenangaben der kompakten Startseite. Außerdem prüft er die Lesbarkeit hell und dunkel (Kontrast nach WCAG AA, keine per „…“ abgeschnittenen Texte).
Er zeigt den **Schema-Stand je Migrationsdatei** (Tabellen, Spalten, Funktionen – nur lesend), **welcher Function-Code deployt ist**
(GET-Status, `x-kombi-version`) und prüft in der App **Essen → Ändern → KI**: Ist die Function aktuell, muss „Testen“ einen echten
Probelauf mit „Live getestet …“ liefern; bei einer alten Function darf es kein „Testen“ geben.
Er **ändert keine Daten**: Buchungen werden nur mit Werten aufgerufen, die garantiert abgelehnt werden.
Über **Actions → Live-Check → Run workflow** lässt er sich auch von Hand starten, z. B. wenn die App
plötzlich nichts mehr anzeigt.

## Wie es funktioniert

**Datenmodell** (siehe Migration):

| Tabelle     | Inhalt |
|-------------|--------|
| `block_typ` | Sorten. Physisch: Einheit (`portion`, `stueck`, `g`, `ml`), Portionsgröße, Preis mit Bezugsmenge (`kosten_cent` für `kosten_menge` Einheiten), Lagerort, Haltbarkeit, Mindestbestand. Bedeutung (optional): Art (`zutat`, `komponente`, `komplettgericht`), Farbe/Kategorie, Herkunft, Zusammensetzung (leer = unbekannt), Notiz |
| `charge`    | eine Einbuchung: Sorte, Start-Menge, aktuelle Menge, Datum, optional Ablaufdatum und „geöffnet seit“ |
| `bewegung`  | jede Bestandsänderung: `kochtag` (+), `verbrauch` (−), `korrektur` (Rückgängig) |
| `bestand`   | View: Menge pro Sorte plus `nachkochen`, `bald_ablaufen`, nächster Ablauf, geöffnete und abgelaufene Menge, Startmenge, aufgetaute Menge |
| `plan`      | geplante Mahlzeiten und vorgemerkte Komponenten (mit Tag oder flexibel); reservieren nur, entnehmen nichts |
| `einkauf_eintrag`, `einkauf_status`, `einkauf_buchung` | eigene Einträge, Zustand je Zeile (gekauft, später, ausgeblendet), Verlauf „Einkauf → Vorrat“ |
| `auftauen`  | geplant → aufgetaut → verbraucht (oder abgebrochen) |
| `nutzung`   | View: Verbrauch und Herstellungen der letzten Wochen (ohne Rückgängig-Buchungen) |
| `mahlzeit`, `herstellung` | Protokoll: was gekocht bzw. produziert wurde, mit Wert der entnommenen Zutaten und kcal (Migration 7) |
| `ausgabe`   | sonstige Ausgaben: Datum, Betrag, Notiz; nur „entfernt“ lässt sich ändern (Migration 8) |

Ab Migration 7 hat jede `charge` ihre echten Kosten (`kosten_cent`), jede Sorte optional Nährwerte (`kcal`, `protein_g`, `kohlenhydrate_g`, `fett_g` für `naehrwert_menge` Einheiten; leer = unbekannt).

**Regeln in der Datenbank** (nicht in der App):

- Bestände ändern sich nur über die Funktionen `einfrieren()`, `entnehmen()`, `rueckgaengig()` sowie `kochen()`, `herstellen()`, `einkauf_buchen()`, `essen()`, `produzieren()`, `einkaufen()` und deren Rückgängig – die bauen auf den ersten dreien auf. Jede davon schreibt `charge` und `bewegung` in **einer** Transaktion. `setze_geoeffnet()` und `setze_ablauf()` ändern keine Mengen.
- `entnehmen()` nimmt zuerst aus geöffneten Chargen, dann aus der mit dem frühesten Ablauf (bekanntes Datum, sonst Einfrierdatum + Haltbarkeit), bei Gleichstand die älteste.
- Die App darf Chargen und Bewegungen nur **lesen**. Ein Wächter-Trigger prüft zusätzlich, dass der Bestand jeder Charge immer der Summe ihrer Bewegungen entspricht. Das gilt auch bei Änderungen von Hand im Supabase-Dashboard.
- `entnehmen()` sperrt die Sorte kurz. Drücken zwei Personen gleichzeitig „−1“, wird nacheinander gebucht, und nichts geht verloren.
- „Bald ablaufen“ bedeutet: Die älteste nicht leere Charge ist älter als (Haltbarkeit − 14) Tage oder ein bekanntes Ablaufdatum ist in höchstens 3 Tagen erreicht. Abgelaufenes wird nicht für Vorschläge eingeplant.
- Das Datum gilt nach deutscher Zeit (Europe/Berlin).

**Aktualität:** Die App lädt den Bestand nach jeder Buchung neu, außerdem jedes Mal, wenn sie wieder in den Vordergrund kommt.

## Projektstruktur

```
supabase/migrations/…_inventar.sql   Tabellen, View, Buchungsfunktionen, Rechte
supabase/migrations/…_ohne_login.sql Zugriff für die App ohne Login (v0.1)
supabase/migrations/…_was_essen.sql  Lagerort, Sessions, Vorschläge, Feedback, Rezepte
supabase/migrations/…_baukasten.sql  Art, Einheit, Preisbezug, Zusammensetzung, Ablauf, geöffnet
supabase/migrations/…_planung_einkauf.sql  Plan, Einkauf, Auftauen, Nutzung, kochen()/herstellen()/einkauf_buchen()
supabase/migrations/…_kosten_naehrwerte.sql  Kosten je Charge, Mahlzeit/Herstellung, essen()/produzieren()/einkaufen(), Nährwerte
supabase/migrations/…_ausgaben.sql   sonstige Ausgaben
supabase/migrations/…_bilder_zutaten.sql  Bilder je Sorte, semantische Zutat, Bild-Cache, Speicher-Bucket
supabase/functions/was-essen/        Edge Function: KI-Aufruf mit Prüfung (API-Key nur hier)
supabase/functions/_shared/kombi/    Kombi-Engine: Snapshot, Prüfung, Kosten (kosten.ts), Mengen,
                                     Wahrheitsprüfung (wahrheit.ts), Abwechslung, Lernen, Einkauf, KI-Anbieter,
                                     Rollen (rollen.ts), Einkaufsliste, Planung/Auftauen, Komponenten, Batch,
                                     Nährwerte (naehrwerte.ts)
tests/ki/                            Tests für „Was essen wir?“ (node --test)
supabase/seed.sql                    Beispieldaten
tests/inventar_test.sql              Tests der Akzeptanzkriterien
tests/supabase_rollen.sql            bildet die Supabase-Rollen für lokale Tests nach
tests/live-check.mjs                 Live-Check gegen die echte Supabase (ändert nichts)
tests/schema-stand.mjs               Schema-Stand je Migration über die App-Rolle (für den Live-Check)
scripts/test.sh                      startet Wegwerf-Postgres und führt die Tests aus
scripts/schema-stand.sql             Schema-Stand je Migration für den SQL-Editor (nur lesend)
scripts/daten-export.sql             Datensicherung als JSON für den SQL-Editor (nur lesend)
src/api.ts                           alle Supabase-Aufrufe
src/haushalt.ts                      Pläne, Einkauf, Auftauen, kochen/essen/produzieren – Supabase-Aufrufe
src/Inventar.tsx                     Rahmen: fünf Bereiche, Adressen/Zurück, gemeinsame Berechnung, Kochansicht
src/navigation.ts, src/dashboard.ts  Bereiche, Adressen, Zustand; Heute wichtig, Lagerorte, Füllstand (getestet)
src/Start.tsx, src/startseite.ts     Startseite; Geld im Monat, Reihenfolge, Dringendes (getestet)
src/Vorrat.tsx                       Vorrat: Übersicht und Lagerort-Ansicht
src/SorteBlatt.tsx                   Details einer Sorte in drei Ebenen
src/Produktion.tsx                   Jetzt sinnvoll, Vorgemerkt, Empfohlen, Produktion in zwei Schritten, Batch
src/Einkauf.tsx                      Einkaufsliste und „Einbuchen“
src/Woche.tsx, src/Auftauen.tsx      Wochenplan und „Für heute auftauen“
src/KochAnsicht.tsx, PostenListe.tsx „Heute kochen“ mit Bestätigung und Kochmodus
src/Einfrieren.tsx                   Einbuchen-Dialog (Menge in der Einheit, optional MHD und bezahlter Betrag)
src/Sorten.tsx                       Sorten anlegen und bearbeiten (Schnellweg + Mehr Details, Nährwerte)
src/Essen.tsx, src/essenApi.ts       „Heute essen“: Session, Karte, Entscheidungen, Demo-Modus
src/GerichtKarte.tsx                 Rezeptkarte
src/Blatt.tsx, src/Icon.tsx          Dialog von unten, Zahlenknöpfe, Linien-Icons
src/Karten.tsx                       Abschnitts-Karte, „Heute wichtig“-Kacheln, Angaben mit Icons, Zustands-Pillen
src/Bild.tsx, src/bilder/            Bild mit Fallback-Kette: eigenes/gefundenes/generiertes Bild → lokales Foto
                                     (src/bilder/) → warme Kachel mit Lebensmittel-Symbol; kaputte Bilder springen weiter
src/bildApi.ts                       Bild-Cache (Tabelle „bild“), einmalige Suche je Inhalt, useBild(), sortenBild()
src/KiStatus.tsx                     KI-Status und „Verbindung testen“ (Essen → Ändern)
supabase/functions/_shared/kombi/bilder.ts      Bildmodell, sichere URLs, Bildanforderung, Commons-Auswertung
supabase/functions/_shared/kombi/bild_dienst.ts Bildsuche, optionale Generierung, Ablage im Speicher (Edge Function)
supabase/functions/_shared/kombi/zutaten.ts     semantische Zutaten: Produkt → Zutat → Verwendung
supabase/functions/_shared/kombi/gesundheit.ts  Health-Check, Probelauf, ENGINE_VERSION
scripts/benchmark.ts, scripts/benchmark/        KI-Benchmark (30 Szenarien, Messung, Punkte)
src/farben.ts, src/format.ts         Farbsystem, Begriffe, Mengen-, Datums- und Euro-Anzeige
```

## Noch nicht enthalten

Login, dauerhafte Vorlieben über Sessions hinweg (außer gespeicherten Rezepten), Push-Benachrichtigungen und Platz im Gefrierfach gibt es noch nicht. Eigene Fotos lassen sich als https-Adresse hinterlegen, aber noch nicht hochladen.
**Kassenbon-Import** ist als Idee vorgesehen (Foto → erkannte Positionen → Zuordnung zu Sorten → Mengen, Preise, MHD prüfen → erst nach Bestätigung einbuchen), aber noch nicht gebaut – er braucht eine Texterkennung.
Lokale Fotos gibt es für die Lebensmittel aus den Design-Entwürfen (Tomaten, Tomatensoße, Pasta, Curry, Falafel, Ofengemüse, Pizza, Spinat, Käse, Haferflocken); weitere kommen über die Bildsuche (nach Migration 9 und neuem Deployment der Function) oder als Symbol.
Ein Login lässt sich später ohne Umbau der Datenbank wieder einschalten, siehe Kommentar in der Migration „ohne_login“.
