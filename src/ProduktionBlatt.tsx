// Eine Produktion planen oder abschließen – Komponente oder Komplettgericht.
//
//   Was entsteht? → Zutaten (aus dem Bestand) → geplante Menge → Bestand prüfen, Kosten vorausrechnen
//   → „Planen“ (ändert nichts am Bestand) oder „Produktion abschließen“ mit der TATSÄCHLICHEN Menge,
//     Lagerort und Haltbarkeit. Erst dann entnimmt produzieren() die Zutaten (FIFO) und bucht die neue Charge.
import { useEffect, useMemo, useState } from 'react';
import { fehlerText, type Lagerort, type Sorte } from './api';
import { ladeAktiveChargen } from './bonApi';
import { aenderePlanung, aufEinkaufsliste, planeProduktion, produktSorte, produziere, type Produktion } from './produktionApi';
import { Icon } from './Icon';
import { Vollbild } from './Vollbild';
import { ARTEN_INFO, LAGERORTE } from './farben';
import { artVon, datum, einheitVon, euro, heuteIso, mengeText, portionMengeVon } from './format';
import type { ChargeInfo } from '../supabase/functions/_shared/kombi/chargen.ts';
import {
  fehlendeAufEinkaufsliste, pruefeProduktion, skaliere, type Eingang,
} from '../supabase/functions/_shared/kombi/produktion.ts';
import './bestand-aktualisieren.css';

export type ProduktionsVorlage = {
  block_typ_id: number | null;
  eingaenge: Eingang[];
  menge: number | null;
  /** bestehende Planung, die hier abgeschlossen oder geändert wird */
  produktion?: Produktion | null;
};

type Props = {
  bestand: Sorte[];
  vorlage: ProduktionsVorlage;
  /** nach dem Abschließen: Text für die Meldung und die Produktion (für Rückgängig) */
  onProduziert: (text: string, produktionId: string) => void;
  onGeplant: (text: string) => void;
  onMeldung: (text: string, fehler?: boolean) => void;
  onSchliessen: () => void;
};

const schrittweite = (s: Sorte | undefined) => {
  const e = s ? einheitVon(s) : 'portion';
  return e === 'g' || e === 'ml' ? Math.max(10, Math.min(100, portionMengeVon(s!))) : 1;
};

export function ProduktionBlatt({ bestand, vorlage, onProduziert, onGeplant, onMeldung, onSchliessen }: Props) {
  const geplant = vorlage.produktion ?? null;
  const [sorteId, setSorteId] = useState<number | null>(vorlage.block_typ_id);
  const [eingaenge, setEingaenge] = useState<Eingang[]>(vorlage.eingaenge);
  const [menge, setMenge] = useState<number>(vorlage.menge ?? geplant?.geplante_menge ?? 4);
  const [tatsaechlich, setTatsaechlich] = useState<number>(vorlage.menge ?? geplant?.geplante_menge ?? 4);
  const [tatsaechlichGeaendert, setTatsaechlichGeaendert] = useState(false);
  const [lagerort, setLagerort] = useState<Lagerort | null>(geplant?.lagerort ?? null);
  const [ablauf, setAblauf] = useState(geplant?.ablauf_am ?? '');
  const [fuer, setFuer] = useState(geplant?.geplant_fuer ?? '');
  const [chargen, setChargen] = useState<ChargeInfo[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    ladeAktiveChargen().then(setChargen).catch(() => setChargen([]));
  }, []);

  const sorte = bestand.find((s) => s.id === sorteId);
  const produkte = bestand.filter((s) => artVon(s) !== 'zutat');
  const sorten = useMemo(() => bestand.map(produktSorte), [bestand]);
  const pruefung = useMemo(() => pruefeProduktion(eingaenge, tatsaechlich, sorten, chargen), [eingaenge, tatsaechlich, sorten, chargen]);
  const einheit = sorte ? einheitVon(sorte) : 'portion';
  const lagerSorte = sorte?.lagerort ?? 'gefrierfach';

  function setzeMenge(n: number) {
    const neu = Math.max(1, Math.round(n));
    setMenge(neu);
    if (!tatsaechlichGeaendert) setTatsaechlich(neu);
  }

  function aendereEingang(i: number, m: number) {
    setEingaenge((alt) => alt.map((e, j) => (j === i ? { ...e, menge: Math.max(0, Math.round(m)) } : e)));
  }

  async function einkaufen() {
    try {
      const n = await aufEinkaufsliste(fehlendeAufEinkaufsliste(pruefung, sorte?.name ?? 'Produktion', sorten));
      onMeldung(n === 1 ? '1 Zutat auf die Einkaufsliste gesetzt.' : `${n} Zutaten auf die Einkaufsliste gesetzt.`);
    } catch (e) {
      onMeldung(fehlerText(e), true);
    }
  }

  async function planen() {
    if (!sorte) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const daten = {
        geplant_fuer: fuer || null,
        geplante_menge: menge,
        zutaten: eingaenge.filter((e) => e.menge > 0),
        lagerort,
        ablauf_am: ablauf || null,
        notiz: null,
      };
      if (geplant) await aenderePlanung(geplant.id, daten);
      else await planeProduktion({ block_typ_id: sorte.id, ...daten });
      onGeplant(`${sorte.name} geplant${fuer ? ` für ${datum(fuer)}` : ''} – am Bestand hat sich nichts geändert.`);
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  async function abschliessen() {
    if (!sorte) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const e = await produziere({
        block_typ_id: sorte.id,
        eingaenge: eingaenge.filter((x) => x.menge > 0),
        menge: tatsaechlich,
        lagerort,
        ablauf_am: ablauf || null,
        produktion_id: geplant?.id ?? null,
        plan_id: geplant?.plan_id ?? null,
        geplante_menge: menge,
        notiz: null,
      });
      const kosten = e.kosten_cent === null
        ? 'Kosten unbekannt'
        : `${e.kosten_status === 'teilweise' ? 'ab ' : ''}${euro(Math.round(e.kosten_cent / tatsaechlich))} ${einheit === 'portion' ? '/ Portion' : `/ ${einheit === 'stueck' ? 'Stück' : einheit}`}`;
      onProduziert(`+${mengeText(tatsaechlich, einheit)} ${sorte.name} produziert · ${kosten}`, e.produktion_id);
    } catch (err) {
      setFehler(fehlerText(err));
      setLaeuft(false);
    }
  }

  const kosten = pruefung.kosten;
  const kostenText = kosten.cent === null
    ? 'Kosten noch unbekannt'
    : `${kosten.status === 'teilweise' ? 'ab ' : 'ca. '}${euro(Math.round(kosten.cent))}${kosten.pro_einheit_cent !== null ? ` · ${euro(Math.round(kosten.pro_einheit_cent))} / ${einheit === 'portion' ? 'Portion' : einheit === 'stueck' ? 'Stück' : `1 ${einheit}`}` : ''}`;
  const kannAbschliessen = !!sorte && tatsaechlich >= 1 && eingaenge.every((e) => e.menge >= 0) && (eingaenge.length === 0 || pruefung.alles_da);
  const hinzufuegbar = bestand.filter((s) => s.id !== sorteId && !eingaenge.some((e) => e.block_typ_id === s.id));

  return (
    <Vollbild
      titel={sorte ? `${sorte.name} produzieren` : 'Produktion'}
      untertitel={sorte ? `${ARTEN_INFO.find((a) => a.id === artVon(sorte))!.name}${geplant ? ' · geplant' : ''}` : 'Komponente oder Komplettgericht vorkochen'}
      onSchliessen={onSchliessen}
      fuss={
        sorte && (
          <>
            {fehler && <p className="fehlertext">{fehler}</p>}
            <div className="knopf-reihe fuss-knoepfe">
              <button type="button" className="knopf" disabled={laeuft} onClick={() => void planen()}>
                {geplant ? 'Planung speichern' : 'Planen'}
              </button>
              <button type="button" className="knopf haupt" disabled={laeuft || !kannAbschliessen} onClick={() => void abschliessen()}>
                <Icon name="haken" /> {laeuft ? 'Buche …' : 'Produktion abschließen'}
              </button>
            </div>
            <p className="fuss-hinweis">
              {kannAbschliessen
                ? `Erst jetzt werden die Zutaten entnommen und ${mengeText(tatsaechlich, einheit)} eingebucht.`
                : eingaenge.length && !pruefung.alles_da
                  ? 'Abschließen geht, sobald alle Zutaten im Bestand sind. Planen geht immer.'
                  : 'Planen ändert nichts am Bestand.'}
            </p>
          </>
        )
      }
    >
      {!sorte ? (
        <section className="abschnitt">
          <h3>Was möchtest du produzieren?</h3>
          {produkte.length === 0 ? (
            <p className="leise">Lege zuerst unter „Sorten“ eine Komponente (z. B. Tomaten-Basis) oder ein Komplettgericht (z. B. TK-Pizza) an.</p>
          ) : (
            ARTEN_INFO.filter((a) => a.id !== 'zutat').map((a) => (
              <div key={a.id} className="abschnitt">
                <h3>{a.id === 'komponente' ? '🧩' : '🔵'} {a.mehrzahl}</h3>
                <div className="sorten-raster">
                  {produkte.filter((s) => artVon(s) === a.id).sort((x, y) => x.name.localeCompare(y.name, 'de')).map((s) => (
                    <button key={s.id} type="button" className={`sorte-knopf f-${s.farbe}`} onClick={() => setSorteId(s.id)}>
                      <span className="farbpunkt" aria-hidden="true" />
                      <span className="sorte-knopf-name">{s.name}</span>
                      <small>{mengeText(s.anzahl, einheitVon(s))} da</small>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      ) : (
        <>
          <section className="abschnitt">
            <h3>Geplante Menge</h3>
            <div className="mengen-zeile">
              <button type="button" className="icon-knopf" onClick={() => setzeMenge(menge - 1)} aria-label="Weniger" disabled={menge <= 1}><Icon name="minus" /></button>
              <strong>{mengeText(menge, einheit)}</strong>
              <button type="button" className="icon-knopf" onClick={() => setzeMenge(menge + 1)} aria-label="Mehr"><Icon name="plus" /></button>
              {vorlage.menge !== null && vorlage.eingaenge.length > 0 && menge !== vorlage.menge && (
                <button type="button" className="link" onClick={() => setEingaenge(skaliere(vorlage.eingaenge, vorlage.menge!, menge, sorten))}>
                  Zutaten auf {mengeText(menge, einheit)} umrechnen
                </button>
              )}
            </div>
          </section>

          <section className="abschnitt">
            <h3>Zutaten aus dem Bestand</h3>
            {eingaenge.length === 0 && <p className="leise klein">Noch keine Zutaten. Füge hinzu, was du aus dem Bestand verwendest – dann rechnet Kombi Menge und Kosten.</p>}
            <ul className="liste eingaenge">
              {eingaenge.map((e, i) => {
                const s = bestand.find((x) => x.id === e.block_typ_id);
                const p = pruefung.eingaenge.find((x) => x.block_typ_id === e.block_typ_id);
                const eh = s ? einheitVon(s) : 'portion';
                const schritt = schrittweite(s);
                return (
                  <li key={e.block_typ_id} className="zeile">
                    <span className="zeile-info">
                      <span className="zeile-name">{s?.name ?? 'Unbekannte Sorte'}</span>
                      <span className="zeile-meta">
                        {p?.status === 'ok' && <span className="status status-ok">✓ da ({mengeText(p.verfuegbar, eh)})</span>}
                        {p && p.status !== 'ok' && <span className="status status-warn">fehlt {mengeText(p.fehlt, eh)}</span>}
                        {p?.wert_cent != null && <span>· {euro(Math.round(p.wert_cent))}</span>}
                      </span>
                    </span>
                    <button type="button" className="icon-knopf klein" onClick={() => aendereEingang(i, e.menge - schritt)} aria-label="Weniger"><Icon name="minus" groesse={16} /></button>
                    <input className="eingang-menge" type="number" inputMode="numeric" min={0} value={e.menge}
                      onChange={(ev) => aendereEingang(i, Number(ev.target.value))} aria-label={`Menge ${s?.name ?? ''}`} />
                    <span className="eingang-einheit">{eh === 'stueck' ? 'St.' : eh === 'portion' ? 'Port.' : eh}</span>
                    <button type="button" className="icon-knopf klein" onClick={() => aendereEingang(i, e.menge + schritt)} aria-label="Mehr"><Icon name="plus" groesse={16} /></button>
                    <button type="button" className="icon-knopf klein" onClick={() => setEingaenge((alt) => alt.filter((_, j) => j !== i))} aria-label="Entfernen"><Icon name="schliessen" groesse={16} /></button>
                  </li>
                );
              })}
            </ul>
            <select className="sorte-wahl" value="" aria-label="Zutat hinzufügen"
              onChange={(ev) => {
                const id = Number(ev.target.value);
                const s = bestand.find((x) => x.id === id);
                if (s) setEingaenge((alt) => [...alt, { block_typ_id: id, menge: portionMengeVon(s) }]);
              }}>
              <option value="">+ Zutat aus dem Bestand hinzufügen …</option>
              {ARTEN_INFO.map((a) => (
                <optgroup key={a.id} label={a.mehrzahl}>
                  {hinzufuegbar.filter((s) => artVon(s) === a.id).sort((x, y) => x.name.localeCompare(y.name, 'de')).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({mengeText(s.anzahl, einheitVon(s))})</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {eingaenge.length > 0 && (
              pruefung.alles_da ? (
                <p className="pruef-ergebnis ok">Zutaten vorhanden ✅</p>
              ) : (
                <div className="pruef-ergebnis fehlt">
                  <p>Fehlend: {pruefung.fehlend.map((f) => `${mengeText(f.menge, f.einheit)} ${f.name}`).join(', ')}</p>
                  <button type="button" className="knopf" onClick={() => void einkaufen()}>Fehlendes auf die Einkaufsliste</button>
                </div>
              )
            )}
          </section>

          <section className="abschnitt">
            <h3>Kosten</h3>
            <p className="kosten-vorschau"><strong>{kostenText}</strong></p>
            {kosten.herkunft.length > 0 && (
              <ul className="gruende">
                {kosten.herkunft.map((h) => <li key={h.name}>{h.name}: {h.cent === null ? 'Preis unbekannt' : euro(Math.round(h.cent))}</li>)}
              </ul>
            )}
            <p className="leise klein">Aus den Chargen, die zuerst verbraucht werden. Endgültig rechnet Kombi mit den tatsächlich entnommenen Chargen.</p>
          </section>

          <section className="abschnitt">
            <h3>Tatsächlich geworden</h3>
            <div className="mengen-zeile">
              <button type="button" className="icon-knopf" onClick={() => { setTatsaechlich(Math.max(1, tatsaechlich - 1)); setTatsaechlichGeaendert(true); }} aria-label="Weniger" disabled={tatsaechlich <= 1}><Icon name="minus" /></button>
              <strong>{mengeText(tatsaechlich, einheit)}</strong>
              <button type="button" className="icon-knopf" onClick={() => { setTatsaechlich(tatsaechlich + 1); setTatsaechlichGeaendert(true); }} aria-label="Mehr"><Icon name="plus" /></button>
            </div>
            <p className="leise klein">
              {tatsaechlich === menge ? 'Wie geplant. ' : `Geplant waren ${mengeText(menge, einheit)}. `}
              Die tatsächliche Menge bestimmt die neue Charge und die Kosten pro {einheit === 'portion' ? 'Portion' : 'Einheit'}.
            </p>
          </section>

          <section className="abschnitt">
            <h3>Lagerung</h3>
            <div className="segment">
              {LAGERORTE.map((l) => (
                <button key={l.id} type="button" className={(lagerort ?? lagerSorte) === l.id ? 'gewaehlt' : ''} onClick={() => setLagerort(l.id)}>
                  <Icon name={l.icon} groesse={16} /> {l.name}
                </button>
              ))}
            </div>
            <label className="feld feld-inline">
              <span>Haltbar bis</span>
              <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
            </label>
            {!ablauf && <p className="leise klein">Haltbarkeit nicht festgelegt – Kombi erfindet keine.</p>}
          </section>

          <section className="abschnitt">
            <h3>Planen für</h3>
            <label className="feld feld-inline">
              <span>Tag <small>(optional)</small></span>
              <input type="date" value={fuer} min={heuteIso()} onChange={(e) => setFuer(e.target.value)} />
            </label>
          </section>

          {!vorlage.block_typ_id && (
            <button type="button" className="link" onClick={() => { setSorteId(null); setEingaenge([]); }}>← Etwas anderes produzieren</button>
          )}
        </>
      )}
    </Vollbild>
  );
}
