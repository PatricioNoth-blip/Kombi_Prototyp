# Kombi – Gefrier-Inventar (Prototyp v0.1)

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
- **Sorten verwalten:** Name, Farbe, Größe, Mindestbestand, Haltbarkeit, Kosten.

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

   Wer die erste Datei schon ausgeführt hat, führt nur noch die zweite aus.

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

Zum Testen auf dem Handy im selben WLAN: `npm run dev -- --host` starten und die angezeigte `http://192.168…:5173`-Adresse öffnen.

### 3. Aufs Handy: GitHub Pages

1. Im GitHub-Repo unter **Settings → Pages → Source** „GitHub Actions“ wählen.
2. Auf den Branch `main` pushen. Du kannst den Workflow „Veröffentlichen (GitHub Pages)“ auch von Hand starten.
   Er nimmt die Werte aus der `.env`. Sind unter **Settings → Secrets and variables → Actions → Variables**
   `SUPABASE_URL` und `SUPABASE_KEY` gesetzt, haben diese Vorrang.
   Die App liegt dann unter `https://patricionoth-blip.github.io/Kombi_Prototyp/`.
3. Auf beiden Handys öffnen und **„Zum Home-Bildschirm“** hinzufügen.

> Hinweis: Kostenlose Supabase-Projekte pausieren nach etwa einer Woche ohne Nutzung. Im Supabase-Dashboard lassen sie sich mit einem Klick wieder starten.

## Tests

Die Tests prüfen die Akzeptanzkriterien direkt in der Datenbank:

- FIFO: Chargen [2, 5] minus 3 ergibt [0, 4].
- Eine zu große Entnahme ergibt eine Fehlermeldung, und nichts ändert sich.
- „Nachkochen“ und „Bald ablaufen“ erscheinen richtig.
- Jede Bestandsänderung steht in `bewegung`.
- Rückgängig funktioniert.
- Die Zugriffsrechte stimmen: Die App darf lesen, Sorten pflegen und buchen, aber Chargen und Bewegungen nicht direkt ändern.

```bash
npm test
```

Dafür müssen die Postgres-Programme installiert sein (macOS: `brew install postgresql`, Ubuntu/WSL: `sudo apt install postgresql`). Das Skript startet eine Wegwerf-Datenbank und löscht sie danach wieder. Die echte Supabase-Datenbank wird nie angefasst.
Bei jedem Push laufen die Tests und der App-Build außerdem automatisch in GitHub Actions (Workflow „CI“).

## Wie es funktioniert

**Datenmodell** (siehe Migration):

| Tabelle     | Inhalt |
|-------------|--------|
| `block_typ` | Sorten: Name, Farbe, Größe, Mindestbestand, Haltbarkeit, Kosten |
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
supabase/seed.sql                    Beispieldaten
tests/inventar_test.sql              Tests der Akzeptanzkriterien
tests/supabase_rollen.sql            bildet die Supabase-Rollen für lokale Tests nach
scripts/test.sh                      startet Wegwerf-Postgres und führt die Tests aus
src/api.ts                           alle Supabase-Aufrufe
src/Inventar.tsx                     Hauptansicht: Laden, Buchen, Rückgängig
src/Uebersicht.tsx                   Bestand nach Farben mit −1
src/SorteBlatt.tsx                   Details einer Sorte: Entnehmen, Chargen
src/Einfrieren.tsx                   Einfrieren-Dialog
src/Sorten.tsx                       Sorten anlegen und bearbeiten
src/Blatt.tsx                        Dialog von unten und Zahlenknöpfe
src/farben.ts, src/format.ts         Farbsystem, Datums- und Euro-Formatierung
```

## Bewusst nicht in v0.1

Login, Rezepte, Wochenplanung, Einkaufslisten, Rollen, Statistiken, KI und Push-Benachrichtigungen gibt es noch nicht.
Ein Login lässt sich später ohne Umbau der Datenbank wieder einschalten, siehe Kommentar in der Migration „ohne_login“.
Das Datenmodell lässt sie später zu: Kosten pro Block und die vollständige Bewegungshistorie sind schon vorhanden.
