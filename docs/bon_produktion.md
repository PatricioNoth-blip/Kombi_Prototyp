# Bon-Import & Produktion – Architektur

Kreislauf: 🧾 Einkauf → 📦 Bestand → 🏭 Produktion → 🧊 Lagerung → 🍽️ Essen → 📦 Bestand.
Jede Mengen- und Kostenänderung bleibt nachvollziehbar, und ohne ausdrückliche Bestätigung
ändert sich nichts am Bestand.

## Schritt 1 – Bestehende Architektur (Stand vor dieser Erweiterung)

| # | Frage | Antwort |
|---|---|---|
| 1 | Wie werden Bestandspositionen gespeichert? | `block_typ` = Sorte (Name, Art, Einheit `portion/stueck/g/ml`, Portionsgröße, Lagerort, Preis). `charge` = eine Einbuchung mit `menge_start`, `menge_aktuell`, `eingefroren_am`, `ablauf_am`, `geoeffnet_am`. Die View `bestand` summiert je Sorte. |
| 2 | Wie funktioniert `entnehmen()`? | Sperrt die Sorte, prüft den Gesamtbestand (sonst Fehler, nichts wird entnommen) und bucht je Charge eine `bewegung` (`verbrauch`, negativ). Mehrere Posten in einem Schritt: `kochen()` / `entnehme_posten()`. |
| 3 | FIFO? | Reihenfolge in `entnehmen()`: geöffnete Charge → frühester Ablauf (bekanntes MHD, sonst `eingefroren_am + haltbar_tage`) → älteste → zuerst angelegte. Ohne MHD und ohne geöffnete Chargen ist das reines FIFO. |
| 4 | Einkaufspreise? | Nur je Sorte: `kosten_cent` für `kosten_menge` Einheiten („2,00 € für 4 Portionen“). `einkauf_buchen()` überschreibt diesen Preis mit dem zuletzt bezahlten. Chargen hatten **keinen** eigenen Preis. |
| 5 | Gibt es Chargen? | Ja (`charge`), aber ohne Kosten, Lagerort oder Herkunft. |
| 6 | Komponenten? | Sorten mit `art = 'komponente'` (optional `zusammensetzung` als Namensliste, `gerichtstypen`, `richtung`). `herstellen()` entnimmt Zutaten und bucht die Komponente ein – ohne Kostenweitergabe. |
| 7 | Komplettgerichte? | Sorten mit `art = 'komplettgericht'`, meist in Portionen. Verbrauch über „Heute kochen“ → `kochen()` → `entnehmen()` der Komplettgericht-Charge. |
| 8 | Bewegungen? | `bewegung` (`kochtag` +, `verbrauch` −, `korrektur` für Rückgängig, `storno_von`). Ein Wächter-Trigger erzwingt `menge_aktuell = Σ Bewegungen`. Die App darf Chargen/Bewegungen nur lesen. |
| 9 | Undo? | `rueckgaengig(bewegung_ids)` bucht Gegenbewegungen, jede nur einmal, und scheitert, wenn aus der Charge schon entnommen wurde. `kochen_rueckgaengig()` / `einkauf_rueckgaengig()` bauen darauf auf. |
| 10 | Haushalte/User? | Keine. v0.1 läuft ohne Login (Rolle `anon`), alle teilen einen Bestand. Ein `household_id` wäre heute ohne Wirkung – das Datenmodell bleibt dafür offen (siehe Migration „ohne_login“). |
| 11 | Produktion heute? | `herstellen(posten, sorte, menge)`: Zutaten entnehmen + Komponente einbuchen in einer Transaktion. Keine Kosten, keine tatsächliche Menge ≠ geplante, kein Lagerort je Charge, keine Verknüpfung Eingang → Ausgang. |
| 12 | Wiederverwendbar? | `block_typ`, `charge`, `bewegung`, `entnehmen()`, `einfrieren()`, `entnehme_posten()` (inkl. Auftau-Status), `rueckgaengig()`, `kochen_rueckgaengig()`, `plan`, `einkauf_eintrag`. |
| 13 | Was ist neu nötig? | Kosten, Lagerort und Quelle **an der Charge**; Bon-Import als Transaktion (`bon_import`, `bon_position`); Produktion als Transaktion (`produktion`, `produktion_eingang`). Kein zweites Bestandssystem. |
| 14 | Verknüpfung Produktions- ↔ Eingangs-Chargen? | `produktion_eingang` hält je entnommener Bewegung die Eingangs-Charge, Menge und den daraus berechneten Wert; `produktion.charge_id` ist die neue Ausgangs-Charge. |

## Schritt 2 – Datenmodell

### Kosten an der Charge (`charge`)

| Spalte | Bedeutung |
|---|---|
| `kosten_cent numeric` | Wert von `kosten_menge` Einheiten dieser Charge (exakt, gerundet wird erst in der Anzeige); `null` = unbekannt |
| `kosten_menge integer` | Bezugsmenge (Bon: gebuchte Menge, Produktion: tatsächliche Ausbeute) |
| `kosten_status` | `berechnet` · `teilweise` (nur ein Teil der Eingänge hatte Preise) · `unbekannt` |
| `kosten_quelle` | `bon` · `produktion` · `sortenpreis` (vorhandener Sortenpreis, z. B. beim manuellen Einbuchen) |
| `quelle` | `bon` · `e_bon` · `produktion` · `null` (manuell / Kochtag) |
| `lagerort` | Lagerort dieser Charge, `null` = Lagerort der Sorte (frische Suppe im Kühlschrank, Rest im Gefrierfach) |

- Neue Chargen ohne eigenen Preis übernehmen beim Anlegen den Sortenpreis (Trigger). Bestehende Chargen werden einmalig so vorbelegt.
- Wert einer Bewegung = |Menge| × `kosten_cent / kosten_menge` der Charge → View `bewegung_kosten`.
  Da `entnehmen()` FIFO bucht, sind damit auch die **Verbrauchskosten FIFO-genau** – ohne dass
  `entnehmen()` geändert werden musste.

### Bon-Import

`bon_import` (eine bestätigte Transaktion: Quelle, Händler, Filiale, Kaufdatum, Summe, Fingerabdruck,
Status `gebucht`/`rueckgaengig`, alte Sortenpreise für Rückgängig) und `bon_position` (Bon-Text,
Schlüssel, Typ, Anzahl, Packung, Preise, Rabatt, Sorte, Sicherheit, Entscheidung, Grund,
gebuchte Menge und Kosten, Bewegungen, Charge).

Entwürfe liegen nur in der App (und im Browser-Speicher als Komfort). Die Datenbank sieht einen
Bon erst mit `bon_buchen()` – deshalb kann ein Abbruch nie etwas verändern.
`bon_buchen()` legt in **einer** Transaktion neue Sorten an, bucht jede Position über
`einfrieren()` ein, setzt die Chargenkosten und protokolliert alles. `bon_rueckgaengig()` hebt den
ganzen Import auf (auch die Sortenpreise), solange aus keiner seiner Chargen entnommen wurde.
Doppelimport: gleicher Fingerabdruck → Rückfrage, „trotzdem buchen“ ist möglich.
Lernen: View `bon_gewohnheit` aus bestätigten Positionen (übernommen / nicht / letzte Sorte / Grund).

### Produktion

`produktion` (Art `komponente`/`komplettgericht`, Ziel-Sorte, Status `geplant` → `abgeschlossen`
→ ggf. `rueckgaengig`, geplante und tatsächliche Menge, Lagerort, Haltbarkeit, Kosten, Ausgangs-Charge,
Bewegungen) und `produktion_eingang` (je Eingangs-Bewegung: Charge, Menge, Wert).

`produzieren()` entnimmt die Eingänge über `entnehme_posten()` (FIFO, Auftau-Status), berechnet die
Kosten aus genau diesen Bewegungen, bucht die tatsächliche Menge über `einfrieren()` als neue Charge
und schreibt Kosten, Lagerort und Herkunft an die Charge. `produktion_rueckgaengig()` nutzt
`kochen_rueckgaengig()`.

**Keine Doppelzählung:** Eine Komponente trägt ihre Kosten in ihrer Charge. Wird sie in einem
Komplettgericht verwendet, zählt nur der Wert der entnommenen Komponenten-Bewegung – die Tomaten
dahinter sind längst verbraucht und werden nicht noch einmal angefasst. Wird eine Portion des
Komplettgerichts gegessen, reduziert das nur die Komplettgericht-Charge.

## Wer macht was?

| Software (deterministisch, getestet) | KI (optional) |
|---|---|
| Bon-Zeilen zerlegen: Menge, Preise, Rabatt, Pfand, Summe | Foto/PDF abschreiben (OCR) |
| Produktzuordnung mit Sicherheitswert, Rückfragen | verständlicher Produktname als Hinweis |
| Mengen, Preise, Kosten, FIFO, Buchung | – |
| Produktionsprüfung, Kosten, Empfehlungen aus echten Daten | – |

Die KI liefert nur Text. Preise, Mengen und Zuordnungen, die nicht aus dem Bon oder den eigenen Daten
stammen, gibt es nicht. Ohne KI funktioniert alles mit eingefügtem Bon-Text oder E-Bon-PDF (Textebene).
