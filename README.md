# Kombi – Gefrier-Inventar (Prototyp)

Minimales Inventar für das Kombi-Kochsystem: An Kochtagen werden Portionsblöcke eingefroren,
abends entnommen. Die App zeigt den Bestand nach Farben und warnt bei **Nachkochen** und
**Bald ablaufen**. Beide in der WG öffnen dieselbe Adresse und sehen denselben Bestand –
einen Login gibt es in v0.1 bewusst nicht.

**Stack:** Supabase (Postgres) · React + Vite (TypeScript) · GitHub Pages

## Was die App kann

- **Übersicht** nach Farben, mit Warnungen oben. An jeder Sorte ein großer **−1**-Knopf.
- **Einfrieren** in 3 Taps: „❄ Einfrieren“ → Sorte → Anzahl. Es entsteht eine neue Charge mit heutigem Datum.
- **Entnehmen** mit „−1“ oder, nach Tippen auf die Sorte, mit einer beliebigen Anzahl. Entnommen wird immer aus der ältesten Charge zuerst (FIFO).
- **Rückgängig:** Nach jeder Buchung erscheint 5 Sekunden lang „Rückgängig“. Das bucht eine Korrektur, ohne etwas zu löschen.
- **Sorten verwalten:** Name, Farbe, Größe, Mindestbestand, Haltbarkeit, Kosten und Lagerort (Gefrierfach, Kühlschrank, Vorrat).
- **🍽️ Was essen wir?** Tinder für Abendessen: Die App schlägt einzeln Gerichte aus eurem echten Bestand vor. Ihr entscheidet mit ❤️ 👎 🔄 ➡️, und die Vorschläge passen sich innerhalb der Session an (Details unten).

> **Ohne Login:** Wer die App-Adresse kennt, kann den Bestand ansehen und ändern. Die Adresse also
> nur in der WG teilen. Löschen lässt sich trotzdem nichts: Jede Buchung bleibt in `bewegung`
> nachvollziehbar, Sorten können nicht gelöscht werden.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Supabase-Datenbank

1. Auf [supabase.com](https://supabase.com) ein kostenloses Projekt anlegen. Als Region „Central EU (Frankfurt)“ wählen.
2. Links **SQL Editor** öffnen und nacheinander diese drei Dateien einfügen und mit **Run** ausführen:
   1. [`supabase/migrations/20260927120000_inventar.sql`](supabase/migrations/20260927120000_inventar.sql): Tabellen, Buchungsfunktionen, Rechte
   2. [`supabase/migrations/20260927180000_ohne_login.sql`](supabase/migrations/20260927180000_ohne_login.sql): gibt der App ohne Login Zugriff
   3. [`supabase/seed.sql`](supabase/seed.sql): Beispieldaten, 17 Sorten vom Kochtag 27.09.2026
   4. [`supabase/migrations/20260928090000_was_essen.sql`](supabase/migrations/20260928090000_was_essen.sql): Lagerort und Tabellen für „Was essen wir?“

   Bereits ausgeführte Dateien einfach überspringen und mit der nächsten weitermachen.

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

## 🍽️ Was essen wir? (KI-Vorschläge)

Kombi fragt nicht „Welches Rezept möchtest du kochen?“, sondern „Was können wir aus dem machen, was wir haben?“.

- **Eine Karte nach der anderen:** Name, Bausteine nach Farben, Zeit, Kosten pro Portion, warum das Gericht gerade passt, was fehlt.
- **❤️ Gefällt mir** → Rezept speichern oder **Heute kochen**. Beim Kochen zeigt die App, welche Blöcke ausgetragen werden. Gebucht wird erst nach „Austragen“, mit Rückgängig.
- **👎 Nicht meins** → vorsichtiges Lernen. Eine einzelne Ablehnung zählt kaum. Bei Ablehnungen in Folge wird die Suche stufenweise geöffnet: anderes Gericht → anderer Gerichtstyp → andere Gewürzrichtung → komplett andere Richtung.
- **🔄 Ähnlich** → ein anderes Gericht mit erkennbarer Gemeinsamkeit (z. B. gleiche Hauptzutat, anderer Typ).
- **➡️ Weiter** → neutral überspringen.
- **Kühlschrank-Feld:** spontan genannte Reste werden für diese Suche berücksichtigt, aber nicht gespeichert.
- **Immer vorhanden:** Wasser, Salz, Pfeffer, Öl. Alles andere muss im Bestand stehen. Pasta, Reis, Dosen usw. legt ihr als Sorte mit Lagerort **Vorrat** und Preis pro Portion an.
- **Notfall:** Reicht der Vorrat nicht, schlägt Kombi **eine** vielseitige Zutat vor, die viele weitere Gerichte ermöglicht. Preise gibt es nur aus euren Daten, sonst steht dort „Preis unbekannt“.
- **💡 Neue Kombi-Idee:** Gelegentlich schlägt die KI einen neuen vorkochbaren Baustein vor. Angelegt wird er erst nach „Baustein übernehmen“.

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
3. Fertig. In der App steht dann „✨ KI-Vorschläge“ statt „🎲 Ohne KI“.

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

> **Datenschutz:** An die KI gehen nur Sortennamen, Mengen, Preise und euer Kühlschrank-Text. Gratis-Stufen dürfen Eingaben laut ihren Bedingungen teils zur Verbesserung ihrer Modelle nutzen.

### So ist es gebaut

```
App: Bestand laden → Snapshot (+ Kühlschrank, + Grundausstattung) → Session-Kontext (gesehen, Feedback)
  → Edge Function „was-essen“ (API-Key nur hier) → KI-Anbieter (austauschbar) → JSON
  → Prüfung durch die Kombi-Engine: nur echte Bausteine, Kosten/Portionen selbst gerechnet,
    Duplikate und gerade abgelehnte Richtungen raus, Rangfolge
  → Karte → Nutzer entscheidet → erst dann Datenbankänderung (entnehmen(), Rezept, Sorte)
```

- **Kombi-Engine** (`supabase/functions/_shared/kombi/`): reines TypeScript ohne Abhängigkeiten. Läuft in der Edge Function (Deno), im Browser (Demo-Modus) und in den Node-Tests. Sie hat keinen Datenbankzugriff und kann den Bestand deshalb gar nicht ändern.
- **Rangfolge:** vorhandene Zutaten > bald Ablaufendes > sehr günstig (Stufen, nicht linear) > einfach > sättigend > Bausteine nutzen > Abwechslung. Die Gewichte stehen gebündelt in `bewertung.ts`.
- **Neue Tabellen:** `koch_session`, `vorschlag` (was gezeigt wurde), `vorschlag_feedback` (like, dislike, similar, skip, save, cook), `rezept`. Die App darf dort nur lesen und anlegen. Das ist die Grundlage für spätere dauerhafte Vorlieben, Wochenplanung und Einkaufslisten.

## Tests

Die Tests prüfen die Akzeptanzkriterien direkt in der Datenbank:

- FIFO: Chargen [2, 5] minus 3 ergibt [0, 4].
- Eine zu große Entnahme ergibt eine Fehlermeldung, und nichts ändert sich.
- „Nachkochen“ und „Bald ablaufen“ erscheinen richtig.
- Jede Bestandsänderung steht in `bewegung`.
- Rückgängig funktioniert.
- Die Zugriffsrechte stimmen: Die App darf lesen, Sorten pflegen und buchen, aber Chargen und Bewegungen nicht direkt ändern.

```bash
npm test            # alles
npm run test:ki     # nur „Was essen wir?“ – läuft überall, auch unter Windows
npm run test:db     # nur Datenbank
```

Die 62 Tests für „Was essen wir?“ laufen ohne KI und ohne Kosten, mit einem regelbasierten Anbieter und KI-Attrappen. Sie prüfen unter anderem:
- keine erfundenen Bestände
- fehlende Zutaten und korrekte Kosten und Portionen
- die Wirkung von Gefällt mir, Nicht meins und Ähnlich
- keine Duplikate und das schrittweise Entfernen nach Ablehnungen
- Kühlschrank-Angaben, Notfall-Einkauf und Multi-Use-Zutaten
- Rezept speichern und „keine Datenbankänderung ohne Bestätigung“

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
| `block_typ` | Sorten: Name, Farbe, Größe, Mindestbestand, Haltbarkeit, Kosten, Lagerort |
| `charge`    | eine Einfrier-Aktion: Sorte, Start-Menge, aktuelle Menge, Datum |
| `bewegung`  | jede Bestandsänderung: `kochtag` (+), `verbrauch` (−), `korrektur` (Rückgängig) |
| `bestand`   | View: Anzahl pro Sorte plus `nachkochen` und `bald_ablaufen` |

**Regeln in der Datenbank** (nicht in der App):

- Bestände ändern sich nur über die Funktionen `einfrieren()`, `entnehmen()` und `rueckgaengig()`. Jede davon schreibt `charge` und `bewegung` in **einer** Transaktion.
- Die App darf Chargen und Bewegungen nur **lesen**. Ein Wächter-Trigger prüft zusätzlich, dass der Bestand jeder Charge immer der Summe ihrer Bewegungen entspricht. Das gilt auch bei Änderungen von Hand im Supabase-Dashboard.
- `entnehmen()` sperrt die Sorte kurz. Drücken zwei Personen gleichzeitig „−1“, wird nacheinander gebucht, und nichts geht verloren.
- „Bald ablaufen“ bedeutet: Die älteste nicht leere Charge ist älter als (Haltbarkeit − 14) Tage.
- Das Datum gilt nach deutscher Zeit (Europe/Berlin).

**Aktualität:** Die App lädt den Bestand nach jeder Buchung neu, außerdem jedes Mal, wenn sie wieder in den Vordergrund kommt. Oben gibt es dafür auch den Knopf ↻.

## Projektstruktur

```
supabase/migrations/…_inventar.sql   Tabellen, View, Buchungsfunktionen, Rechte
supabase/migrations/…_ohne_login.sql Zugriff für die App ohne Login (v0.1)
supabase/migrations/…_was_essen.sql  Lagerort, Sessions, Vorschläge, Feedback, Rezepte
supabase/functions/was-essen/        Edge Function: KI-Aufruf mit Prüfung (API-Key nur hier)
supabase/functions/_shared/kombi/    Kombi-Engine: Snapshot, Prüfung, Kosten, Lernen, Einkauf, KI-Anbieter
tests/ki/                            Tests für „Was essen wir?“ (node --test)
supabase/seed.sql                    Beispieldaten
tests/inventar_test.sql              Tests der Akzeptanzkriterien
tests/supabase_rollen.sql            bildet die Supabase-Rollen für lokale Tests nach
tests/live-check.mjs                 Live-Check gegen die echte Supabase (ändert nichts)
scripts/test.sh                      startet Wegwerf-Postgres und führt die Tests aus
src/api.ts                           alle Supabase-Aufrufe
src/Inventar.tsx                     Hauptansicht: Laden, Buchen, Rückgängig
src/Uebersicht.tsx                   Bestand nach Farben mit −1
src/SorteBlatt.tsx                   Details einer Sorte: Entnehmen, Chargen
src/Einfrieren.tsx                   Einfrieren-Dialog
src/Sorten.tsx                       Sorten anlegen und bearbeiten
src/Essen.tsx, src/essenApi.ts       „Was essen wir?“: Session, Karte, Entscheidungen, Demo-Modus
src/GerichtKarte.tsx, KochenBlatt.tsx Rezeptkarte und „Heute kochen“ mit Bestätigung
src/Blatt.tsx                        Dialog von unten und Zahlenknöpfe
src/farben.ts, src/format.ts         Farbsystem, Datums- und Euro-Formatierung
```

## Noch nicht enthalten

Login, dauerhafte Vorlieben über Sessions hinweg, Wochenplanung, automatische Einkaufslisten, Rollen, Statistiken und Push-Benachrichtigungen gibt es noch nicht.
Das Datenmodell ist dafür vorbereitet: Kosten pro Block, die vollständige Bewegungshistorie sowie Vorschläge und Feedback je Session sind schon vorhanden.
Ein Login lässt sich später ohne Umbau der Datenbank wieder einschalten, siehe Kommentar in der Migration „ohne_login“.
