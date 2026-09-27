import { useState, type FormEvent } from 'react';
import {
  fehlerText, speichereSorte, type Art, type Einheit, type Herkunft, type Lagerort, type Sorte, type SorteDaten,
} from './api';
import { Blatt } from './Blatt';
import { ARTEN_INFO, EINHEITEN_INFO, FARBEN, LAGERORTE, lagerort as lagerInfo, type Farbe } from './farben';
import { Icon } from './Icon';
import { artVon, einheitVon, mengeText, portionMengeVon, portionspreisText, euroZuCent } from './format';

type Props = {
  bestand: Sorte[];
  baukasten: boolean;
  onGespeichert: (text: string) => void;
};

function details(s: Sorte): string {
  const teile: string[] = [lagerInfo(s.lagerort).name];
  const einheit = einheitVon(s);
  teile.push(einheit === 'portion' ? `Portion ${s.groesse_g} g` : `Portion ${mengeText(portionMengeVon(s), einheit)}`);
  teile.push(portionspreisText(s));
  return teile.join(' · ');
}

export function Sorten({ bestand, baukasten, onGespeichert }: Props) {
  // null = kein Formular offen (neue Sorten legt der Knopf in der unteren Leiste an)
  const [bearbeiten, setBearbeiten] = useState<Sorte | null>(null);

  return (
    <>
      {ARTEN_INFO.map((art) => {
        const sorten = bestand
          .filter((s) => artVon(s) === art.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return (
          <section key={art.id} className="gruppe">
            <h2 className="abschnitt-titel">{art.mehrzahl}</h2>
            {sorten.length === 0 ? (
              <p className="leise klein gruppe-leer">Noch keine – {art.erklaerung}.</p>
            ) : (
              <ul className="liste">
                {sorten.map((s) => (
                  <li key={s.id} className={`zeile f-${s.farbe}`}>
                    <span className="farbpunkt" aria-hidden="true" />
                    <button type="button" className="zeile-info" onClick={() => setBearbeiten(s)}>
                      <span className="zeile-name">{s.name}</span>
                      <span className="zeile-details">{details(s)}</span>
                    </button>
                    <span className="pfeil" aria-hidden="true">
                      <Icon name="pfeil" groesse={18} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {bearbeiten && (
        <SorteFormular
          sorte={bearbeiten}
          baukasten={baukasten}
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

/** Ganze Zahl ≥ min, sonst null */
function ganzeZahl(text: string, min: number): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) && n >= min ? n : null;
}

const centText = (c: number | null | undefined) => (c != null ? (c / 100).toFixed(2).replace('.', ',') : '');

/** Namen, die allein wenig über den Inhalt sagen */
const MEHRDEUTIG = /^(tk[- ]?)?(pizza|suppe|bolognese|sosse|soße|sauce|curry|eintopf|auflauf|lasagne|chili|gericht|reste?|essen|pasta|nudeln|gemüse|gemuese|fleisch|käse|kaese|brot|salat|bowl|füllung|fuellung)$/i;

/** Vorschläge für die Portionsgröße je Einheit */
const PORTION_VORSCHLAG: Record<Einheit, string> = { portion: '1', stueck: '1', g: '125', ml: '250' };

type FormularProps = {
  sorte: Sorte | null;
  baukasten: boolean;
  /** Vorbelegung für eine neue Sorte, z. B. aus einer Baustein-Idee */
  vorlage?: Partial<SorteDaten>;
  onFertig: (text: string) => void;
  onSchliessen: () => void;
};

export function SorteFormular({ sorte, baukasten, vorlage, onFertig, onSchliessen }: FormularProps) {
  const start = { ...vorlage, ...(sorte ?? {}) } as Partial<Sorte>;
  const [name, setName] = useState(start.name ?? '');
  const [art, setArt] = useState<Art>(sorte ? artVon(sorte) : vorlage?.art ?? 'komponente');
  const [farbe, setFarbe] = useState<Farbe | null>(start.farbe ?? null);
  const lagerortVorher: Lagerort = sorte?.lagerort ?? 'gefrierfach';
  const [lagerort, setLagerort] = useState<Lagerort>(start.lagerort ?? 'gefrierfach');
  const [einheit, setEinheit] = useState<Einheit>(start.einheit ?? 'portion');
  const [portionMenge, setPortionMenge] = useState(String(start.portion_menge ?? 1));
  const [groesse, setGroesse] = useState(String(start.groesse_g ?? 100));
  const [kosten, setKosten] = useState(centText(start.kosten_cent));
  const [kostenMenge, setKostenMenge] = useState(String(start.kosten_menge ?? 1));
  const [herkunft, setHerkunft] = useState<Herkunft | null>(start.herkunft ?? null);
  const [zusammensetzung, setZusammensetzung] = useState((start.zusammensetzung ?? []).join(', '));
  const [notiz, setNotiz] = useState(start.notiz ?? '');
  const [mindest, setMindest] = useState(String(start.mindestbestand ?? 0));
  const [haltbar, setHaltbar] = useState(String(start.haltbar_tage ?? 90));
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  const einheitName = EINHEITEN_INFO.find((e) => e.id === einheit)!;
  const teile = zusammensetzung.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
  const mehrdeutig = art !== 'zutat' && teile.length === 0 && MEHRDEUTIG.test(name.trim());

  // Live-Vorschau: was kostet eine Portion? (gleiche Rechnung wie überall)
  const vorschau = (() => {
    const c = euroZuCent(kosten);
    const km = ganzeZahl(kostenMenge, 1);
    const pm = einheit === 'portion' ? 1 : ganzeZahl(portionMenge, 1);
    if (c === null || Number.isNaN(c) || !km || !pm) return null;
    return portionspreisText({ kosten_cent: c, kosten_menge: km, einheit, portion_menge: pm });
  })();

  function waehleArt(a: Art) {
    setArt(a);
    if (a === 'komplettgericht' && !farbe) setFarbe('blau');
  }

  function waehleEinheit(e: Einheit) {
    setEinheit(e);
    setPortionMenge(PORTION_VORSCHLAG[e]);
  }

  function pruefen(): SorteDaten | string {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return 'Bitte einen Namen eingeben.';
    if (!farbe) return 'Bitte eine Kategorie (Farbe) wählen.';
    const groesse_g = ganzeZahl(groesse, 1);
    if (groesse_g === null) return 'Gewicht pro Portion: bitte ganze Gramm ab 1 eingeben.';
    const mindestbestand = ganzeZahl(mindest, 0);
    if (mindestbestand === null) return 'Mindestbestand: bitte ganze Zahl ab 0 eingeben.';
    const haltbar_tage = ganzeZahl(haltbar, 1);
    if (haltbar_tage === null) return 'Haltbarkeit: bitte ganze Tage ab 1 eingeben.';
    const kosten_cent = euroZuCent(kosten);
    if (Number.isNaN(kosten_cent)) return 'Preis: z. B. 2,00 eingeben – oder leer lassen, wenn unbekannt.';
    const daten: SorteDaten = { name: n, farbe, groesse_g, mindestbestand, haltbar_tage, kosten_cent };
    // Nur mitschicken, wenn geändert – so klappt das Speichern auch vor der Migration „was_essen“.
    if (lagerort !== lagerortVorher) daten.lagerort = lagerort;
    if (!baukasten) return daten;

    const portion_menge = einheit === 'portion' ? 1 : ganzeZahl(portionMenge, 1);
    if (portion_menge === null) return `Eine Portion: bitte ganze ${einheitName.name} ab 1 eingeben.`;
    const kosten_menge = ganzeZahl(kostenMenge, 1);
    if (kosten_menge === null) return 'Preis gilt für: bitte eine ganze Zahl ab 1 eingeben.';
    if (teile.length > 30) return 'Zusammensetzung: höchstens 30 Bestandteile.';
    if (notiz.length > 500) return 'Rezept/Notiz: höchstens 500 Zeichen.';
    return {
      ...daten,
      art,
      herkunft,
      einheit,
      portion_menge,
      kosten_menge,
      zusammensetzung: teile.length ? teile.map((t) => t.slice(0, 60)) : null,
      notiz: notiz.trim() || null,
    };
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

  const detailsOffen = !!sorte && (!!sorte.herkunft || !!sorte.zusammensetzung?.length || !!sorte.notiz);

  return (
    <Blatt titel={sorte ? 'Sorte bearbeiten' : 'Neue Sorte'} onSchliessen={onSchliessen}>
      <form className="formular" onSubmit={speichern} noValidate>
        <label className="feld">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Linsen-Bolognese"
            autoComplete="off"
          />
        </label>
        {mehrdeutig && (
          <p className="hinweis-klein">
            <Icon name="info" groesse={16} /> „{name.trim()}“ allein sagt wenig darüber, was drin ist. Unter „Mehr Details“ kannst du
            die Zusammensetzung ergänzen – sonst bleibt sie „unbekannt“, und Kombi erfindet nichts dazu.
          </p>
        )}

        {baukasten && (
          <fieldset className="feld">
            <legend>Was ist es?</legend>
            <div className="segment" role="radiogroup">
              {ARTEN_INFO.map((a) => (
                <button key={a.id} type="button" role="radio" aria-checked={art === a.id}
                  className={art === a.id ? 'gewaehlt' : ''} onClick={() => waehleArt(a.id)}>
                  {a.name}
                </button>
              ))}
            </div>
            <small>{ARTEN_INFO.find((a) => a.id === art)!.erklaerung}</small>
          </fieldset>
        )}

        <fieldset className="feld">
          <legend>Kategorie</legend>
          <div className="farbwahl">
            {FARBEN.map((f) => (
              <label key={f.id} className={`farb-option f-${f.id}${farbe === f.id ? ' gewaehlt' : ''}`}>
                <input type="radio" name="farbe" value={f.id} checked={farbe === f.id} onChange={() => setFarbe(f.id)} />
                <span className="farbpunkt" aria-hidden="true" />
                <span>{f.bedeutung}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="feld">
          <legend>Lagerort</legend>
          <div className="segment">
            {LAGERORTE.map((l) => (
              <button key={l.id} type="button" className={lagerort === l.id ? 'gewaehlt' : ''}
                aria-pressed={lagerort === l.id} onClick={() => setLagerort(l.id)}>
                <Icon name={l.icon} groesse={16} /> {l.name}
              </button>
            ))}
          </div>
        </fieldset>

        {baukasten && (
          <fieldset className="feld">
            <legend>Gezählt in</legend>
            <div className="segment">
              {EINHEITEN_INFO.map((e) => (
                <button key={e.id} type="button" className={einheit === e.id ? 'gewaehlt' : ''}
                  aria-pressed={einheit === e.id} onClick={() => waehleEinheit(e.id)}>
                  {e.name}
                </button>
              ))}
            </div>
            {einheit !== 'portion' && (
              <label className="feld-inline">
                <span>1 Portion =</span>
                <input type="number" inputMode="numeric" min={1} value={portionMenge}
                  onChange={(e) => setPortionMenge(e.target.value)} aria-label={`Eine Portion in ${einheitName.name}`} />
                <span>{einheitName.kurz}</span>
              </label>
            )}
          </fieldset>
        )}

        <fieldset className="feld">
          <legend>Preis</legend>
          <div className="feld-inline preis-zeile">
            <input type="text" inputMode="decimal" value={kosten} onChange={(e) => setKosten(e.target.value)}
              placeholder="z. B. 2,00" aria-label="Preis in Euro" />
            <span>€ für</span>
            {baukasten ? (
              <>
                <input type="number" inputMode="numeric" min={1} value={kostenMenge}
                  onChange={(e) => setKostenMenge(e.target.value)} aria-label={`Menge in ${einheitName.name}, für die der Preis gilt`} />
                <span>{einheitName.kurz}</span>
              </>
            ) : (
              <span>1 Portion</span>
            )}
          </div>
          <small>{vorschau ? `= ${vorschau}` : 'Leer lassen, wenn unbekannt – dann steht dort „Preis unbekannt“.'}</small>
        </fieldset>

        <details className="mehr" open={detailsOffen}>
          <summary>Mehr Details</summary>
          {baukasten && (
            <>
              <fieldset className="feld">
                <legend>Herkunft</legend>
                <div className="segment">
                  {([null, 'selbstgemacht', 'gekauft'] as const).map((h) => (
                    <button key={String(h)} type="button" className={herkunft === h ? 'gewaehlt' : ''}
                      aria-pressed={herkunft === h} onClick={() => setHerkunft(h)}>
                      {h === null ? 'unbekannt' : h}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="feld">
                <span>Zusammensetzung</span>
                <textarea rows={2} value={zusammensetzung} onChange={(e) => setZusammensetzung(e.target.value)}
                  placeholder="z. B. Tomatensoße, Mozzarella, Basilikum" />
                <small>Mit Komma trennen. Leer = unbekannt.</small>
              </label>
              <label className="feld">
                <span>Rezept / Notiz</span>
                <textarea rows={2} maxLength={500} value={notiz} onChange={(e) => setNotiz(e.target.value)}
                  placeholder="z. B. mit Karotten, mild, vom Sonntag" />
              </label>
            </>
          )}
          {(einheit === 'portion' || !baukasten) && (
            <label className="feld">
              <span>Gewicht pro Portion (g)</span>
              <input type="number" inputMode="numeric" min={1} value={groesse} onChange={(e) => setGroesse(e.target.value)} />
            </label>
          )}
          <div className="reihe">
            <label className="feld">
              <span>Haltbar (Tage)</span>
              <input type="number" inputMode="numeric" min={1} value={haltbar} onChange={(e) => setHaltbar(e.target.value)} />
            </label>
            <label className="feld">
              <span>Mindestbestand</span>
              <input type="number" inputMode="numeric" min={0} value={mindest} onChange={(e) => setMindest(e.target.value)} />
            </label>
          </div>
        </details>

        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="submit" className="knopf haupt" disabled={speichert}>
          {speichert ? 'Speichert …' : 'Speichern'}
        </button>
      </form>
    </Blatt>
  );
}
