import { useState, type FormEvent } from 'react';
import { fehlerText, speichereSorte, type Sorte, type SorteDaten } from './api';
import { Blatt } from './Blatt';
import { FARBEN, type Farbe } from './farben';
import { euro, euroZuCent } from './format';

type Props = {
  bestand: Sorte[];
  onGespeichert: (text: string) => void;
  onAbmelden: () => void;
};

export function Sorten({ bestand, onGespeichert, onAbmelden }: Props) {
  // null = kein Formular offen, 'neu' = neue Sorte anlegen
  const [bearbeiten, setBearbeiten] = useState<Sorte | 'neu' | null>(null);

  return (
    <>
      {FARBEN.map((farbe) => {
        const sorten = bestand
          .filter((s) => s.farbe === farbe.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return (
          <section key={farbe.id} className={`gruppe f-${farbe.id}`}>
            <h2 className="gruppe-kopf">
              <span className="punkt" aria-hidden="true" />
              {farbe.name}
              <span className="gruppe-bedeutung">{farbe.bedeutung}</span>
            </h2>
            {sorten.length === 0 ? (
              <p className="leise klein">Noch keine Sorte.</p>
            ) : (
              <ul className="liste">
                {sorten.map((s) => (
                  <li key={s.id} className="zeile">
                    <button type="button" className="zeile-info" onClick={() => setBearbeiten(s)}>
                      <span className="zeile-name">{s.name}</span>
                      <span className="zeile-details">
                        {s.groesse_g} g · min. {s.mindestbestand} · {s.haltbar_tage} Tage
                        {s.kosten_cent !== null && <> · {euro(s.kosten_cent)}</>}
                      </span>
                    </button>
                    <span className="pfeil" aria-hidden="true">
                      ›
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <p className="abmelden">
        <button type="button" className="link" onClick={onAbmelden}>
          Abmelden
        </button>
      </p>

      <div className="unten-leiste">
        <button type="button" className="knopf haupt" onClick={() => setBearbeiten('neu')}>
          ＋ Neue Sorte
        </button>
      </div>

      {bearbeiten && (
        <SorteFormular
          sorte={bearbeiten === 'neu' ? null : bearbeiten}
          onFertig={(text) => {
            setBearbeiten(null);
            onGespeichert(text);
          }}
          onSchliessen={() => setBearbeiten(null)}
        />
      )}
    </>
  );
}

const GROESSEN = [
  { name: 'Mini', gramm: 30 },
  { name: 'Standard', gramm: 100 },
  { name: 'Groß', gramm: 250 },
];

/** Ganze Zahl ≥ min, sonst null */
function ganzeZahl(text: string, min: number): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n >= min ? n : null;
}

type FormularProps = {
  sorte: Sorte | null;
  onFertig: (text: string) => void;
  onSchliessen: () => void;
};

function SorteFormular({ sorte, onFertig, onSchliessen }: FormularProps) {
  const [name, setName] = useState(sorte?.name ?? '');
  const [farbe, setFarbe] = useState<Farbe | null>(sorte?.farbe ?? null);
  const [groesse, setGroesse] = useState(String(sorte?.groesse_g ?? 100));
  const [mindest, setMindest] = useState(String(sorte?.mindestbestand ?? 0));
  const [haltbar, setHaltbar] = useState(String(sorte?.haltbar_tage ?? 90));
  const [kosten, setKosten] = useState(
    sorte?.kosten_cent != null ? (sorte.kosten_cent / 100).toFixed(2).replace('.', ',') : '',
  );
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  function pruefen(): SorteDaten | string {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return 'Bitte einen Namen eingeben.';
    if (!farbe) return 'Bitte eine Farbe wählen.';
    const groesse_g = ganzeZahl(groesse, 1);
    if (groesse_g === null) return 'Größe: bitte ganze Gramm ab 1 eingeben.';
    const mindestbestand = ganzeZahl(mindest, 0);
    if (mindestbestand === null) return 'Mindestbestand: bitte ganze Zahl ab 0 eingeben.';
    const haltbar_tage = ganzeZahl(haltbar, 1);
    if (haltbar_tage === null) return 'Haltbarkeit: bitte ganze Tage ab 1 eingeben.';
    const kosten_cent = euroZuCent(kosten);
    if (Number.isNaN(kosten_cent)) return 'Kosten: z. B. 0,17 eingeben – oder leer lassen.';
    return { name: n, farbe, groesse_g, mindestbestand, haltbar_tage, kosten_cent };
  }

  async function speichern(e: FormEvent) {
    e.preventDefault();
    const daten = pruefen();
    if (typeof daten === 'string') {
      setFehler(daten);
      return;
    }
    setFehler(null);
    setSpeichert(true);
    try {
      await speichereSorte(sorte?.id ?? null, daten);
      onFertig(sorte ? `${daten.name} gespeichert.` : `${daten.name} angelegt.`);
    } catch (err) {
      setFehler(fehlerText(err));
      setSpeichert(false);
    }
  }

  return (
    <Blatt titel={sorte ? 'Sorte bearbeiten' : 'Neue Sorte'} onSchliessen={onSchliessen}>
      <form className="formular" onSubmit={speichern} noValidate>
        <label className="feld">
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Tomatensoße"
            autoComplete="off"
          />
        </label>

        <fieldset className="feld">
          <legend>Farbe</legend>
          <div className="farbwahl">
            {FARBEN.map((f) => (
              <label key={f.id} className={`farb-option f-${f.id}${farbe === f.id ? ' gewaehlt' : ''}`}>
                <input
                  type="radio"
                  name="farbe"
                  value={f.id}
                  checked={farbe === f.id}
                  onChange={() => setFarbe(f.id)}
                />
                <span className="punkt" aria-hidden="true" />
                <span>
                  {f.name}
                  <small>{f.bedeutung}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="feld">
          <label htmlFor="groesse">Größe pro Block (g)</label>
          <div className="groessen">
            {GROESSEN.map((g) => (
              <button
                key={g.gramm}
                type="button"
                className={`chip${groesse === String(g.gramm) ? ' gewaehlt' : ''}`}
                onClick={() => setGroesse(String(g.gramm))}
              >
                {g.name} {g.gramm} g
              </button>
            ))}
          </div>
          <input
            id="groesse"
            type="number"
            inputMode="numeric"
            min={1}
            value={groesse}
            onChange={(e) => setGroesse(e.target.value)}
          />
          <small>Komplettgerichte: Gewicht einer Portion.</small>
        </div>

        <div className="reihe">
          <label className="feld">
            Mindestbestand
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={mindest}
              onChange={(e) => setMindest(e.target.value)}
            />
          </label>
          <label className="feld">
            Haltbar (Tage)
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={haltbar}
              onChange={(e) => setHaltbar(e.target.value)}
            />
          </label>
        </div>

        <label className="feld">
          Kosten pro Block (€)
          <input
            type="text"
            inputMode="decimal"
            value={kosten}
            onChange={(e) => setKosten(e.target.value)}
            placeholder="z. B. 0,17"
          />
        </label>

        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="submit" className="knopf haupt" disabled={speichert}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </button>
      </form>
    </Blatt>
  );
}
