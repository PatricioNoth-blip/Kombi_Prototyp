# Kombi – persönlicher Lebensmittel-Baukasten (Prototyp)

Kombi verwaltet, was ein kleiner Haushalt wirklich hat – vorgekochte Bausteine, Komplettgerichte,
Vorräte – und schlägt abends vor, was man daraus machen kann. Beide in der WG öffnen dieselbe
Adresse und sehen denselben Bestand – einen Login gibt es in v0.1 bewusst nicht.

**Stack:** Supabase (Postgres) · React + Vite (TypeScript) · GitHub Pages

## Was die App kann

- **Vorrat:** oben „Heute wichtig“ (abgelaufen, geöffnet, läuft bald ab, nachkochen), darunter Komplettgerichte, Komponenten und Zutaten mit Menge in ihrer Einheit (Portionen, Stück, g, ml) und einem **−**-Knopf für eine Portion.
- **Einbuchen** in 3 Taps: **＋** neben der Tab-Leiste → Sorte → Menge, optional mit Haltbarkeitsdatum (MHD).
- **Entnehmen:** zuerst aus geöffneten Chargen, dann aus der mit dem frühesten Ablauf, sonst aus der ältesten (FIFO). Chargen lassen sich als „geöffnet“ markieren.
- **Rückgängig:** Nach jeder Buchung erscheint 5 Sekunden lang „Rückgängig“. Das bucht eine Korrektur, ohne etwas zu löschen.
- **Sorten anlegen – schnell, nicht kompliziert:** Name, Art (Zutat / Komponente / Komplettgericht), Kategorie, Lagerort, Einheit mit Portionsgröße und Preis „X € für N“. Unter „Mehr Details“: selbstgemacht/gekauft, Zusammensetzung, Rezept/Notiz, Haltbarkeit, Mindestbestand. Bei Namen wie „Pizza“ oder „Suppe“ weist die App darauf hin, dass der Inhalt sonst „unbekannt“ bleibt.
- **Heute essen:** Die App schlägt einzeln Gerichte aus eurem echten Bestand vor. Ihr entscheidet mit Gefällt mir, Nicht meins, Ähnlich oder „Gerade etwas anderes“, und die Vorschläge passen sich innerhalb der Session an (Details unten).
- Dunkelmodus folgt der Systemeinstellung.

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

   Bereits ausgeführte Dateien einfach überspringen und mit der nächsten weitermachen. Jede Datei nur **einmal** ausführen.
   Ohne Datei 5 läuft die App wie bisher und zeigt oben einen Hinweis; die neuen Felder sind dann ausgeblendet.

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

1. Im GitHub-Repo unter **Settings → Pages → Source** „GitHub Actions“ wählen.
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
- **Gefällt mir** → Rezept speichern oder **Heute kochen**. Beim Kochen zeigt die App genau, was entnommen wird („2 Portionen TK-Pizza“ bzw. mehrere Zutaten in ihren Einheiten) und prüft das gegen den aktuellen Bestand. Gebucht wird erst nach „Entnehmen“, mit Rückgängig.
- **Nicht meins** → vorsichtiges Lernen. Eine einzelne Ablehnung zählt kaum. Bei Ablehnungen in Folge wird die Suche stufenweise geöffnet: anderes Gericht → anderer Gerichtstyp → andere Gewürzrichtung → komplett andere Richtung.
- **Ähnlich** → ein anderes Gericht mit erkennbarer Gemeinsamkeit (z. B. gleiche Hauptzutat, anderer Typ).
- **Gerade etwas anderes** → ist **keine** Ablehnung: Es wird nichts gelernt, Ähnliches kommt nur für den Moment weiter nach hinten.
- **Abwechslung:** über Gerichtstyp, Hauptzutat, Sattmacher, Richtung, Zubereitung, warm/kalt und Textur. Nach drei Wraps kommt kein vierter, solange es Alternativen gibt.
- **Was muss weg?** Spontan genannte Kühlschrank-Reste werden für diese Suche berücksichtigt, aber nicht gespeichert.
- **Immer vorhanden:** Wasser, Salz, Pfeffer, Öl. Alles andere muss im Bestand stehen.
- **Notfall:** Reicht der Vorrat nicht, schlägt Kombi **eine** Zutat vor. Die Software bewertet dafür, wie viele Gerichte sie ermöglicht, wie gut sie zum Vorhandenen passt, Haltbarkeit, Lagerung und – nur wenn bekannt – den Preis.
- **Idee für euren Baukasten:** Gelegentlich schlägt die KI einen neuen vorkochbaren Baustein vor (Art, Lagerort, Portionen; Kosten nur aus bekannten Preisen). Angelegt wird er erst nach „Baustein übernehmen“ im vorausgefüllten Formular.

### Wer macht was?

| Software (verlässlich, getestet) | KI (kreativ) |
|---|---|
| Bestand, Mengen, Einheiten, Portionen | Ideen und Kombinationen |
| Kosten und Preise (siehe unten) | Namen und Beschreibungen |
| Ablauf, geöffnet, Entnahme-Reihenfolge | Zubereitung und Varianten |
| Prüfung jedes Vorschlags, Rangfolge, Abwechslung | Interpretation des Vorhandenen |
| Datenbank, Feedback, harte Regeln | – |

Die KI kennt nur, was ihr die App schickt – gegliedert nach Komplettgerichten, Komponenten, Zutaten, Resten, mit „Zusammensetzung unbekannt“, wo nichts eingetragen ist. Jeder Vorschlag wird geprüft:

- Zutaten, die es nicht gibt, stehen nie unter „vorhanden“, sondern unter „fehlt“.
- **Kreativität ja, Halluzination nein:** Name und Beschreibung dürfen nur Zutaten nennen, die im Gericht wirklich stecken (verwendete Einträge, deren bekannte Zusammensetzung, „fehlt“). Aus einer „Pizza“ ohne bekannten Belag wird also keine „Salami-Pizza“ – so ein Vorschlag wird verworfen, erfundene Sätze werden entfernt. Braucht die Zubereitung etwas, das es im Haushalt nicht gibt, steht es ehrlich unter „fehlt“.
- Preisangaben der KI, „vegan/glutenfrei“ und „hausgemacht“ ohne Grundlage werden entfernt.

### Kosten

Eine zentrale, deterministische Funktion (`supabase/functions/_shared/kombi/kosten.ts`):

- Preis pro Einheit = gespeicherter Preis ÷ Menge, auf die er sich bezieht. **2,00 € für 4 Portionen → 0,50 € pro Portion; 2 Portionen verbraucht → 1,00 €.**
- Gramm, ml und Stück werden genauso proportional gerechnet (1,29 € für 500 g → 125 g = 0,32 €). Gerundet wird erst am Ende.
- Unbekannter Preis bleibt unbekannt: „Preis unbekannt“ bzw. „ab 0,40 € / Portion“, wenn nur ein Teil bekannt ist. „ca. 1,24 € / Portion“ erscheint nur, wenn alles berechnet werden konnte.

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

```bash
npm test            # alles
npm run test:ki     # nur „Was essen wir?“ – läuft überall, auch unter Windows
npm run test:db     # nur Datenbank
```

Die 124 Tests für „Heute essen“ laufen ohne KI und ohne Kosten, mit einem regelbasierten Anbieter und KI-Attrappen. Sie prüfen unter anderem:
- die Kostenfunktion (2,00 € für 4 Portionen, Gramm/ml/Stück, unbekannt, teilweise, Rundung am Ende)
- keine erfundenen Bestände, Zutaten, Inhalte oder Preise (z. B. keine „Salami-Pizza“ bei unbekanntem Belag) – und keine falschen Alarme bei guten Namen
- Komplettgericht / Komplettgericht mit Beilage / Rezept und „Heute kochen“ in Einheiten
- geöffnet, bald ablaufend, abgelaufen, Reste; Priorität mit Augenmaß
- Abwechslung (kein vierter Wrap), „gerade etwas anderes“ ≠ „Nicht meins“, Lieblingsrezepte
- Notfall-Einkauf mit Begründung aus Daten, Baustein-Ideen mit Kosten nur aus bekannten Preisen
- strukturiert gespeicherte Rezepte, alte Rezepte, „keine Datenbankänderung ohne Bestätigung“

Für `test:db` müssen die Postgres-Programme installiert sein (macOS: `brew install postgresql`, Ubuntu/WSL: `sudo apt install postgresql`). Das Skript startet eine Wegwerf-Datenbank und löscht sie danach wieder. Die echte Supabase-Datenbank wird nie angefasst.
Bei jedem Push laufen alle Tests, der App-Build und eine Deno-Prüfung der Edge Function automatisch in GitHub Actions (Workflow „CI“).

**Live-Check:** Der Workflow „Live-Check (echte Supabase)“ prüft bei jedem Push die echte Datenbank
aus der `.env` (Migrationen, Seed, Rechte, Buchungsfunktionen) und klickt die gebaute App im Browser durch.
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
| `bestand`   | View: Menge pro Sorte plus `nachkochen`, `bald_ablaufen`, nächster Ablauf, geöffnete und abgelaufene Menge |

**Regeln in der Datenbank** (nicht in der App):

- Bestände ändern sich nur über die Funktionen `einfrieren()`, `entnehmen()` und `rueckgaengig()`. Jede davon schreibt `charge` und `bewegung` in **einer** Transaktion. `setze_geoeffnet()` und `setze_ablauf()` ändern keine Mengen.
- `entnehmen()` nimmt zuerst aus geöffneten Chargen, dann aus der mit dem frühesten Ablauf (bekanntes Datum, sonst Einfrierdatum + Haltbarkeit), bei Gleichstand die älteste.
- Die App darf Chargen und Bewegungen nur **lesen**. Ein Wächter-Trigger prüft zusätzlich, dass der Bestand jeder Charge immer der Summe ihrer Bewegungen entspricht. Das gilt auch bei Änderungen von Hand im Supabase-Dashboard.
- `entnehmen()` sperrt die Sorte kurz. Drücken zwei Personen gleichzeitig „−1“, wird nacheinander gebucht, und nichts geht verloren.
- „Bald ablaufen“ bedeutet: Die älteste nicht leere Charge ist älter als (Haltbarkeit − 14) Tage oder ein bekanntes Ablaufdatum ist in höchstens 3 Tagen erreicht. Abgelaufenes wird nicht für Vorschläge eingeplant.
- Das Datum gilt nach deutscher Zeit (Europe/Berlin).

**Aktualität:** Die App lädt den Bestand nach jeder Buchung neu, außerdem jedes Mal, wenn sie wieder in den Vordergrund kommt. Oben rechts gibt es dafür auch einen Knopf.

## Projektstruktur

```
supabase/migrations/…_inventar.sql   Tabellen, View, Buchungsfunktionen, Rechte
supabase/migrations/…_ohne_login.sql Zugriff für die App ohne Login (v0.1)
supabase/migrations/…_was_essen.sql  Lagerort, Sessions, Vorschläge, Feedback, Rezepte
supabase/migrations/…_baukasten.sql  Art, Einheit, Preisbezug, Zusammensetzung, Ablauf, geöffnet
supabase/functions/was-essen/        Edge Function: KI-Aufruf mit Prüfung (API-Key nur hier)
supabase/functions/_shared/kombi/    Kombi-Engine: Snapshot, Prüfung, Kosten (kosten.ts), Mengen,
                                     Wahrheitsprüfung (wahrheit.ts), Abwechslung, Lernen, Einkauf, KI-Anbieter
tests/ki/                            Tests für „Was essen wir?“ (node --test)
supabase/seed.sql                    Beispieldaten
tests/inventar_test.sql              Tests der Akzeptanzkriterien
tests/supabase_rollen.sql            bildet die Supabase-Rollen für lokale Tests nach
tests/live-check.mjs                 Live-Check gegen die echte Supabase (ändert nichts)
scripts/test.sh                      startet Wegwerf-Postgres und führt die Tests aus
src/api.ts                           alle Supabase-Aufrufe
src/Inventar.tsx                     Rahmen: Titel, Tab-Leiste, Laden, Buchen, Rückgängig
src/Uebersicht.tsx                   Vorrat: Heute wichtig, Gruppen nach Art, −1 Portion
src/SorteBlatt.tsx                   Details einer Sorte: Menge, Portion, Preis, Chargen, geöffnet
src/Einfrieren.tsx                   Einbuchen-Dialog (Menge in der Einheit, optional MHD)
src/Sorten.tsx                       Sorten anlegen und bearbeiten (Schnellweg + Mehr Details)
src/Essen.tsx, src/essenApi.ts       „Heute essen“: Session, Karte, Entscheidungen, Demo-Modus
src/GerichtKarte.tsx, KochenBlatt.tsx Rezeptkarte und „Heute kochen“ mit Bestätigung
src/Blatt.tsx, src/Icon.tsx          Dialog von unten, Zahlenknöpfe, Linien-Icons
src/farben.ts, src/format.ts         Farbsystem, Begriffe, Mengen-, Datums- und Euro-Anzeige
```

## Noch nicht enthalten

Login, dauerhafte Vorlieben über Sessions hinweg (außer gespeicherten Rezepten), Wochenplanung, automatische Einkaufslisten, Rollen, Statistiken und Push-Benachrichtigungen gibt es noch nicht.
Das Datenmodell ist dafür vorbereitet: Preise mit Bezugsmenge, die vollständige Bewegungshistorie sowie Vorschläge und Feedback je Session sind schon vorhanden.
Ein Login lässt sich später ohne Umbau der Datenbank wieder einschalten, siehe Kommentar in der Migration „ohne_login“.
