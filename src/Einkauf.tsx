import { useState, type FormEvent } from 'react';
import type { Farbe } from '../supabase/functions/_shared/kombi/typen.ts';
import {
  findeSorte, kategorieFuer, leseEingabe, mangelVorschlaege,
  type Einkaufsliste, type Einkaufszeile, type Quelle, type VorratSorte,
} from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, type Sorte } from './api';
import { eintragAendern, eintragHinzufuegen, einkaufBuchen, einkaufRueckgaengig, zeilenStatus } from './haushalt';
import { Blatt } from './Blatt';
import { SorteFormular } from './Sorten';
import { Icon } from './Icon';
import { euroZuCent, heuteIso, mengeText } from './format';
import type { EinkaufFilter, NavZustand } from './navigation';

type Props = {
  liste: Einkaufsliste;
  sorten: VorratSorte[];
  bestand: Sorte[];
  baukasten: boolean;
  planung: boolean;
  nav: NavZustand['einkauf'];
  onNav: (teil: Partial<NavZustand['einkauf']>) => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

export const KATEGORIE_NAME: Record<Farbe | 'sonstiges', string> = {
  gruen: 'Gemüse & Obst', braun: 'Protein', gelb: 'Sattmacher', rot: 'Basis & Soße', schwarz: 'Crunch & Frisch',
  weiss: 'Gewürze & Booster', blau: 'Komplettgerichte', sonstiges: 'Sonstiges',
};

const FILTER: { id: EinkaufFilter; name: string; passt: (a: Quelle['art']) => boolean }[] = [
  { id: 'alle', name: 'Alle', passt: () => true },
  { id: 'geplant', name: 'Geplant', passt: (a) => a === 'mahlzeit' || a === 'rezept' },
  { id: 'komponente', name: 'Komponenten', passt: (a) => a === 'komponente' },
  { id: 'manuell', name: 'Von Hand', passt: (a) => a === 'manuell' },
  { id: 'mangel', name: 'Mangel', passt: (a) => a === 'mangel' || a === 'notfall' },
];

export function mengeZeile(z: Einkaufszeile): string {
  if (z.menge === null) return 'Menge offen';
  return `${mengeText(z.menge, z.einheit ?? 'stueck')}${z.menge_offen ? ' + ?' : ''}`;
}

function quelleText(q: Quelle): string {
  switch (q.art) {
    case 'mahlzeit': return `für ${q.titel}`;
    case 'komponente': return `für Komponente ${q.titel}`;
    case 'manuell': return 'von Hand';
    default: return q.titel;
  }
}

export function kostenText(k: Einkaufsliste['kosten']): string | null {
  if (k.status === 'leer') return null;
  if (k.bekannt_cent === null) return `Preise unbekannt (${k.unbekannt})`;
  return `≈ ${euroText(k.bekannt_cent)}${k.unbekannt ? ` + ${k.unbekannt} ohne Preis` : ''}`;
}

/** Die Einkaufsliste: aus Plänen berechnet, mit eigenen Einträgen zusammengeführt, gegen den Vorrat verrechnet. */
export function Einkauf({ liste, sorten, bestand, baukasten, planung, nav, onNav, onMeldung, onGeaendert }: Props) {
  const [eingabe, setEingabe] = useState('');
  const [offen, setOffen] = useState<Einkaufszeile | null>(null);
  const [uebernahme, setUebernahme] = useState<Einkaufszeile | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  if (!planung) {
    return (
      <div className="leer-zustand">
        <Icon name="wagen" groesse={40} />
        <p>Für die Einkaufsliste fehlt in Supabase noch die Migration „planung_einkauf“ (siehe README).</p>
      </div>
    );
  }

  const key = (z: Einkaufszeile) => `${z.schluessel}|${z.einheit_schluessel}`;
  const filter = FILTER.find((f) => f.id === nav.filter)!;
  const sichtbar = (z: Einkaufszeile) => z.quellen.some((q) => filter.passt(q.art));
  const sortiert = (zs: Einkaufszeile[]) => (nav.sortierung === 'name' ? [...zs].sort((a, b) => a.name.localeCompare(b.name, 'de')) : zs);
  const offenZ = sortiert(liste.zeilen.filter((z) => z.status === 'offen' && sichtbar(z)));
  const wagen = sortiert(liste.zeilen.filter((z) => z.status === 'gekauft' && sichtbar(z)));
  const spaeter = liste.zeilen.filter((z) => z.status === 'zurueckgestellt');
  const ignoriert = liste.zeilen.filter((z) => z.status === 'ignoriert');
  const mangel = mangelVorschlaege(sorten, liste.zeilen);
  const alleOffen = liste.zeilen.filter((z) => z.status === 'offen').length;

  async function tu(schluessel: string, f: () => Promise<unknown>, text?: string) {
    setLaeuft(schluessel);
    try {
      await f();
      if (text) onMeldung(text);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(null);
    }
  }

  function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    const t = leseEingabe(eingabe);
    if (!t.name) return;
    const sorte = findeSorte({ name: t.name, block_typ_id: null }, sorten);
    void tu('neu', async () => {
      await eintragHinzufuegen({
        name: t.name, menge: t.menge, einheit: t.einheit, kategorie: sorte?.farbe ?? kategorieFuer(t.name),
        quelle: 'manuell', block_typ_id: sorte?.id ?? null,
      });
      setEingabe('');
    });
  }

  const abhaken = (z: Einkaufszeile, gekauft: boolean) =>
    void tu(key(z), () => zeilenStatus(z.schluessel, z.einheit_schluessel, gekauft ? 'gekauft' : null));

  const zeile = (z: Einkaufszeile) => {
    const gekauft = z.status === 'gekauft';
    const gruende = [...new Set(z.quellen.map(quelleText))];
    return (
      <li key={key(z)} className={`einkauf-zeile f-${z.kategorie}${gekauft ? ' gekauft' : ''}`}>
        <button
          type="button"
          className="haken-knopf"
          role="checkbox"
          aria-checked={gekauft}
          aria-label={`${z.name} ${gekauft ? 'wieder offen' : 'abhaken'}`}
          disabled={laeuft === key(z)}
          onClick={() => abhaken(z, !gekauft)}
        >
          {gekauft && <Icon name="haken" groesse={16} />}
        </button>
        <button type="button" className="ez-info" onClick={() => setOffen(z)}>
          <span className="ez-kopf">
            <span className="ez-name">{z.name}</span>
            <strong className="ez-menge">{mengeZeile(z)}</strong>
          </span>
          <span className="ez-grund">{gruende.join(' · ')}</span>
          {z.vom_vorrat > 0 && z.bedarf_plaene !== null && z.einheit && (
            <span className="ez-netto">Bedarf {mengeText(z.bedarf_plaene, z.einheit)} · {mengeText(z.vom_vorrat, z.einheit)} aus dem Vorrat</span>
          )}
        </button>
        <span className="ez-preis">
          {z.preis ? <><strong>{euroText(z.preis.cent)}</strong><small>{z.preis.text}</small></> : <small>–</small>}
        </span>
        {gekauft && (
          <button type="button" className="knopf klein-knopf ez-vorrat" onClick={() => setUebernahme(z)}>
            In den Vorrat
          </button>
        )}
      </li>
    );
  };

  const gruppen = nav.sortierung === 'name'
    ? [{ kategorie: null as Farbe | 'sonstiges' | null, zeilen: offenZ }]
    : [...new Set(offenZ.map((z) => z.kategorie))].map((k) => ({ kategorie: k as Farbe | 'sonstiges' | null, zeilen: offenZ.filter((z) => z.kategorie === k) }));

  return (
    <div className="einkauf">
      <div className="einkauf-kopf">
        <div>
          <strong>{alleOffen === 0 ? 'Alles erledigt' : `${alleOffen} ${alleOffen === 1 ? 'Sache' : 'Sachen'} offen`}</strong>
          <span>{wagen.length > 0 ? `${wagen.length} im Wagen` : 'Abhaken bucht noch nichts ein'}</span>
        </div>
        <div className="einkauf-summe">
          <strong>{liste.kosten.bekannt_cent !== null ? `≈ ${euroText(liste.kosten.bekannt_cent)}` : liste.kosten.status === 'leer' ? '0,00 €' : '–'}</strong>
          <span>{liste.kosten.unbekannt > 0 ? `+ ${liste.kosten.unbekannt} ohne Preis` : 'aus euren Preisen'}</span>
        </div>
      </div>

      <form className="einkauf-eingabe" onSubmit={hinzufuegen}>
        <input type="text" value={eingabe} onChange={(e) => setEingabe(e.target.value)} placeholder="Hinzufügen, z. B. 500 g Zwiebeln"
          aria-label="Etwas zur Einkaufsliste hinzufügen" maxLength={90} />
        <button type="submit" className="icon-knopf" aria-label="Hinzufügen" disabled={!eingabe.trim() || laeuft === 'neu'}>
          <Icon name="plus" />
        </button>
      </form>

      <div className="einkauf-werkzeug">
        <div className="filter-chips" role="group" aria-label="Nach Grund filtern">
          {FILTER.map((f) => (
            <button key={f.id} type="button" className={nav.filter === f.id ? 'gewaehlt' : ''} aria-pressed={nav.filter === f.id} onClick={() => onNav({ filter: f.id })}>
              {f.name}
            </button>
          ))}
        </div>
        <button type="button" className="sortier-knopf" onClick={() => onNav({ sortierung: nav.sortierung === 'name' ? 'kategorie' : 'name' })}
          aria-label={nav.sortierung === 'name' ? 'Sortiert nach Name – nach Bereich sortieren' : 'Sortiert nach Bereich – nach Name sortieren'}>
          <Icon name="sorten" groesse={16} /> {nav.sortierung === 'name' ? 'A–Z' : 'Bereich'}
        </button>
      </div>

      {offenZ.length === 0 && wagen.length === 0 && (
        <div className="leer-zustand">
          <Icon name="wagen" groesse={40} />
          <p>{alleOffen === 0 ? 'Nichts einzukaufen. Geplante Mahlzeiten und Komponenten landen hier automatisch – verrechnet mit dem Vorrat.' : 'Nichts in diesem Filter.'}</p>
        </div>
      )}

      {gruppen.map((g) => (
        <section key={g.kategorie ?? 'alle'} className="gruppe">
          {g.kategorie && (
            <h2 className={`abschnitt-titel mit-punkt f-${g.kategorie}`}>
              <span className="farbpunkt" aria-hidden="true" /> {KATEGORIE_NAME[g.kategorie]}
            </h2>
          )}
          <ul className="einkauf-liste">{g.zeilen.map(zeile)}</ul>
        </section>
      ))}

      {wagen.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel"><Icon name="wagen" groesse={14} /> Im Wagen</h2>
          <ul className="einkauf-liste">{wagen.map(zeile)}</ul>
          <p className="leise klein abstand-oben">Erst „In den Vorrat“ bucht ein – mit der Menge, die wirklich gekauft wurde.</p>
        </section>
      )}

      {mangel.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">Unter Mindestbestand</h2>
          <ul className="liste">
            {mangel.map((m) => (
              <li key={m.sorte.id} className={`zeile f-${m.sorte.farbe}`}>
                <span className="farbpunkt" aria-hidden="true" />
                <span className="zeile-info">
                  <span className="zeile-name">{m.sorte.name}</span>
                  <span className="zeile-details">
                    {m.aktion === 'kaufen'
                      ? `${mengeText(m.menge, m.sorte.einheit)} fehlen bis zum Mindestbestand (${m.sorte.mindestbestand})`
                      : `${mengeText(m.sorte.anzahl, m.sorte.einheit)} da, mind. ${m.sorte.mindestbestand} – ${m.sorte.art === 'komplettgericht' ? 'nachkochen oder nachkaufen' : 'nachkochen statt einkaufen'}`}
                  </span>
                </span>
                {m.aktion === 'kaufen' && (
                  <button
                    type="button"
                    className="knopf klein-knopf"
                    disabled={laeuft === `m-${m.sorte.id}`}
                    onClick={() => void tu(`m-${m.sorte.id}`, () => eintragHinzufuegen({
                      name: m.sorte.name, menge: m.menge, einheit: m.sorte.einheit, kategorie: m.sorte.farbe,
                      quelle: 'mangel', grund: 'unter Mindestbestand', block_typ_id: m.sorte.id,
                    }))}
                  >
                    <Icon name="plus" groesse={16} /> Liste
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(spaeter.length > 0 || ignoriert.length > 0) && (
        <details className="mehr abstand-oben">
          <summary>Später & ausgeblendet ({spaeter.length + ignoriert.length})</summary>
          <ul className="liste">
            {[...spaeter, ...ignoriert].map((z) => (
              <li key={key(z)} className="zeile">
                <span className="zeile-info">
                  <span className="zeile-name">{z.name}</span>
                  <span className="zeile-details">{mengeZeile(z)} · {z.status === 'zurueckgestellt' ? 'zurückgestellt' : 'ausgeblendet'}</span>
                </span>
                <button type="button" className="link" disabled={laeuft === key(z)}
                  onClick={() => void tu(key(z), () => zeilenStatus(z.schluessel, z.einheit_schluessel, null), `${z.name} ist wieder auf der Liste.`)}>
                  Wieder aufnehmen
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {offen && (
        <ZeileBlatt
          z={liste.zeilen.find((x) => key(x) === key(offen)) ?? offen}
          frei={offen.sorte ? liste.verteilung.frei.get(offen.sorte.id) ?? 0 : null}
          onMeldung={onMeldung}
          onGeaendert={onGeaendert}
          onSchliessen={() => setOffen(null)}
        />
      )}
      {uebernahme && (
        <UebernahmeBlatt
          z={uebernahme}
          bestand={bestand}
          sorten={sorten}
          baukasten={baukasten}
          planung={planung}
          onGebucht={(text, rueck) => {
            setUebernahme(null);
            onMeldung(text, rueck);
            onGeaendert();
          }}
          onSorteAngelegt={onGeaendert}
          onSchliessen={() => setUebernahme(null)}
        />
      )}
    </div>
  );
}

/** Eine Zeile im Detail: wofür, wie verrechnet, was kostet es – ändern, zurückstellen, löschen. */
function ZeileBlatt({ z, frei, onMeldung, onGeaendert, onSchliessen }: {
  z: Einkaufszeile; frei: number | null;
  onMeldung: (text: string) => void; onGeaendert: () => void; onSchliessen: () => void;
}) {
  const [menge, setMenge] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const ausPlaenen = z.quellen.some((q) => q.art === 'mahlzeit' || q.art === 'komponente');
  const einEintrag = !ausPlaenen && z.eintrag_ids.length === 1;
  const einheit = z.einheit ?? 'stueck';

  async function tu(f: () => Promise<unknown>, text: string) {
    setLaeuft(true);
    try {
      await f();
      onMeldung(text);
      onGeaendert();
      onSchliessen();
    } catch (e) {
      onMeldung(fehlerText(e));
      setLaeuft(false);
    }
  }

  const zahl = Number(menge);
  const gueltig = Number.isInteger(zahl) && zahl >= 1;

  function mengeSpeichern(e: FormEvent) {
    e.preventDefault();
    if (!gueltig) return;
    if (einEintrag) {
      void tu(() => eintragAendern(z.eintrag_ids[0], { menge: zahl }), `${z.name}: ${mengeText(zahl, einheit)}.`);
    } else {
      // Bedarf aus Plänen ist berechnet – mehr kaufen = eigener Eintrag, der dazugerechnet wird
      void tu(() => eintragHinzufuegen({
        name: z.name, menge: zahl, einheit, kategorie: z.kategorie, quelle: 'manuell', grund: 'zusätzlich', block_typ_id: z.sorte?.id ?? null,
      }), `${z.name}: ${mengeText(zahl, einheit)} dazu.`);
    }
  }

  async function loeschen() {
    await tu(async () => {
      for (const id of z.eintrag_ids) await eintragAendern(id, { status: 'geloescht' });
      if (ausPlaenen) await zeilenStatus(z.schluessel, z.einheit_schluessel, 'ignoriert');
    }, ausPlaenen ? `${z.name} ausgeblendet.` : `${z.name} gelöscht.`);
  }

  return (
    <Blatt titel={z.name} untertitel={mengeZeile(z)} onSchliessen={onSchliessen}>
      <section className="abschnitt erstes">
        <h3>Wofür</h3>
        <ul className="liste">
          {z.quellen.map((q, i) => (
            <li key={i} className="zeile">
              <span className="zeile-info">
                <span className="zeile-name">{quelleText(q)}</span>
              </span>
              <strong className="klein">{q.menge === null ? 'Menge offen' : mengeText(q.menge, einheit)}</strong>
            </li>
          ))}
        </ul>
        {z.bedarf_plaene !== null && z.einheit && (
          <p className="leise klein abstand-oben">
            Geplant: {mengeText(z.bedarf_plaene, z.einheit)} · davon aus dem Vorrat: {mengeText(z.vom_vorrat, z.einheit)}
            {frei !== null && ` · danach frei: ${mengeText(frei, z.einheit)}`}. Jede Menge wird nur einmal verplant.
          </p>
        )}
      </section>

      <section className="abschnitt">
        <h3>Preis</h3>
        {z.preis ? (
          <p className="klein"><strong>{euroText(z.preis.cent)}</strong> für {z.preis.text} – ganze Packungen nach eurem gespeicherten Preis.</p>
        ) : (
          <p className="leise klein">Preis unbekannt{z.sorte ? ' – bei der Sorte eintragen oder beim Einbuchen angeben.' : '.'}</p>
        )}
      </section>

      <section className="abschnitt">
        <h3>{einEintrag ? 'Menge ändern' : 'Mehr kaufen'}</h3>
        <form className="eigene-anzahl" onSubmit={mengeSpeichern}>
          <input type="number" inputMode="numeric" min={1} step={1} value={menge} onChange={(e) => setMenge(e.target.value)}
            placeholder={einEintrag ? `neue Menge (${einheit === 'stueck' ? 'Stück' : einheit === 'portion' ? 'Portionen' : einheit})` : `zusätzlich (${einheit === 'stueck' ? 'Stück' : einheit})`}
            aria-label={einEintrag ? 'Neue Menge' : 'Zusätzliche Menge'} />
          <button type="submit" className="knopf" disabled={laeuft || !gueltig}>{einEintrag ? 'Ändern' : 'Dazu'}</button>
        </form>
      </section>

      <div className="knopf-reihe">
        {z.status === 'zurueckgestellt' ? (
          <button type="button" className="knopf" disabled={laeuft} onClick={() => void tu(() => zeilenStatus(z.schluessel, z.einheit_schluessel, null), `${z.name} ist wieder offen.`)}>
            Wieder aufnehmen
          </button>
        ) : (
          <button type="button" className="knopf" disabled={laeuft} onClick={() => void tu(() => zeilenStatus(z.schluessel, z.einheit_schluessel, 'zurueckgestellt'), `${z.name}: später.`)}>
            <Icon name="uhr" groesse={18} /> Später
          </button>
        )}
        <button type="button" className="knopf gefahr" disabled={laeuft} onClick={() => void loeschen()}>
          <Icon name="muell" groesse={18} /> {ausPlaenen ? 'Ausblenden' : 'Löschen'}
        </button>
      </div>
      {ausPlaenen && <p className="leise klein">Kommt aus einer Planung. Ausblenden ändert den Plan nicht – „Wieder aufnehmen“ geht jederzeit.</p>}
    </Blatt>
  );
}

/** Einkauf → Vorrat: die TATSÄCHLICH gekaufte Menge bestätigen. Bucht genau einmal. */
function UebernahmeBlatt({ z, bestand, sorten, baukasten, planung, onGebucht, onSorteAngelegt, onSchliessen }: {
  z: Einkaufszeile; bestand: Sorte[]; sorten: VorratSorte[]; baukasten: boolean; planung: boolean;
  onGebucht: (text: string, rueckgaengig: () => Promise<unknown>) => void; onSorteAngelegt: () => void; onSchliessen: () => void;
}) {
  const [sorteId, setSorteId] = useState<number | null>(z.sorte?.id ?? null);
  const sorte = sorten.find((s) => s.id === sorteId) ?? null;
  const [menge, setMenge] = useState(z.menge !== null && !z.menge_offen && z.sorte ? String(z.menge) : '');
  const [ablauf, setAblauf] = useState('');
  const [preis, setPreis] = useState('');
  const [neu, setNeu] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const zahl = Number(menge);
  const einheit = sorte?.einheit ?? 'stueck';
  const einheitKurz = einheit === 'stueck' ? 'Stück' : einheit === 'portion' ? 'Portionen' : einheit;
  const packung = sorte && sorte.kosten_menge > 1 ? sorte.kosten_menge : null;
  const vorschlaege = [...new Set([
    ...(z.menge !== null && z.sorte && sorte && z.sorte.id === sorte.id ? [z.menge] : []),
    ...(packung ? [packung, packung * 2] : []),
  ])].filter((n) => n > 0).sort((a, b) => a - b);

  async function buchen(e: FormEvent) {
    e.preventDefault();
    if (!sorte) return setFehler('Bitte wählen, in welche Sorte es kommt.');
    if (!Number.isInteger(zahl) || zahl < 1) return setFehler(`Bitte die gekaufte Menge in ${einheitKurz} eingeben.`);
    const cent = euroZuCent(preis);
    if (Number.isNaN(cent)) return setFehler('Preis: z. B. 1,29 eingeben – oder leer lassen.');
    setFehler(null);
    setLaeuft(true);
    try {
      const id = await einkaufBuchen({
        schluessel: z.schluessel, einheit: z.einheit_schluessel, block_typ_id: sorte.id, menge: zahl, ablauf_am: ablauf || null, preis_cent: cent,
      });
      onGebucht(`+${mengeText(zahl, einheit)} ${sorte.name} im Vorrat.`, () => einkaufRueckgaengig(id));
    } catch (err) {
      setFehler(fehlerText(err));
      setLaeuft(false);
    }
  }

  if (neu) {
    return (
      <SorteFormular
        sorte={null}
        baukasten={baukasten}
        planung={planung}
        titel="Neue Sorte für den Einkauf"
        vorlage={{ name: z.name, art: 'zutat', farbe: z.kategorie === 'sonstiges' ? undefined : z.kategorie, lagerort: 'vorrat', einheit: z.einheit ?? 'stueck', herkunft: 'gekauft' }}
        onFertig={(_, id) => {
          setSorteId(id);
          setNeu(false);
          onSorteAngelegt(); // neu laden, damit die Sorte in der Auswahl steht
        }}
        onSchliessen={() => setNeu(false)}
      />
    );
  }

  const auswahl = [...bestand].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <Blatt titel="In den Vorrat übernehmen" untertitel={`${z.name} · auf der Liste: ${mengeZeile(z)}`} onSchliessen={onSchliessen}>
      <form className="formular" onSubmit={buchen} noValidate>
        <label className="feld">
          <span>Sorte im Vorrat</span>
          <select value={sorteId ?? ''} onChange={(e) => setSorteId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">– bitte wählen –</option>
            {sorteId !== null && !sorte && <option value={sorteId}>neue Sorte wird geladen …</option>}
            {auswahl.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {sorteId === null && <button type="button" className="link inline links" onClick={() => setNeu(true)}>+ Neue Sorte „{z.name}“ anlegen</button>}
        </label>

        <fieldset className="feld">
          <legend>Tatsächlich gekauft</legend>
          {vorschlaege.length > 0 && (
            <div className="auswahl-chips">
              {vorschlaege.map((n) => (
                <button key={n} type="button" className={zahl === n ? 'gewaehlt' : ''} onClick={() => setMenge(String(n))}>
                  {mengeText(n, einheit)}{packung && n % packung === 0 ? ` (${n / packung} ${n / packung === 1 ? 'Packung' : 'Packungen'})` : ''}
                </button>
              ))}
            </div>
          )}
          <div className="feld-inline">
            <input type="number" inputMode="numeric" min={1} step={1} value={menge} onChange={(e) => setMenge(e.target.value)} aria-label="Gekaufte Menge" />
            <span>{einheitKurz}</span>
          </div>
          <small>Weniger oder mehr gekauft als geplant? Einfach die echte Menge eintragen – der Rest bleibt auf der Liste.</small>
        </fieldset>

        <div className="reihe">
          <label className="feld">
            <span>Haltbar bis (optional)</span>
            <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
          </label>
          <label className="feld">
            <span>Bezahlt (optional)</span>
            <input type="text" inputMode="decimal" value={preis} onChange={(e) => setPreis(e.target.value)} placeholder="z. B. 1,29" aria-label="Bezahlter Preis in Euro" />
          </label>
        </div>
        {preis.trim() && sorte && Number.isInteger(zahl) && zahl > 0 && (
          <small>Wird der neue Preis von {sorte.name}: {preis.trim()} € für {mengeText(zahl, einheit)}.</small>
        )}

        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="submit" className="knopf haupt" disabled={laeuft || (sorteId !== null && !sorte)}>
          <Icon name="plus" /> {laeuft ? 'Bucht …' : sorte && Number.isInteger(zahl) && zahl > 0 ? `${mengeText(zahl, einheit)} einbuchen` : 'Einbuchen'}
        </button>
      </form>
    </Blatt>
  );
}
