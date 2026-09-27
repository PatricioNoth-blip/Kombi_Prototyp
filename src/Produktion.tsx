// Tab „Produktion“: Vorkochen, Nachkochen, Einfrieren – Komponenten und Komplettgerichte.
//
//   🔥 Jetzt sinnvoll   Empfehlungen nur aus echten Daten (letzte Produktion, Zusammensetzung, Bestand)
//   📅 Geplant          geplante Produktionen – ändern nichts am Bestand
//   🧩 Komponenten / 🔵 Fertiggerichte   alles, was sich produzieren lässt
//   🕘 Zuletzt produziert   mit Kostenherkunft und Rückgängig
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fehlerText, type Sorte } from './api';
import { ladeAktiveChargen } from './bonApi';
import {
  ladeEingaenge, ladeProduktionen, produktionRueckgaengig, produktSorte, verwerfePlanung, type Produktion as ProduktionT,
} from './produktionApi';
import type { ProduktionsVorlage } from './ProduktionBlatt';
import { Blatt } from './Blatt';
import { Icon } from './Icon';
import { lagerort as lagerInfo } from './farben';
import { artVon, datum, einheitVon, euro, heuteIso, mengeText } from './format';
import type { ChargeInfo } from '../supabase/functions/_shared/kombi/chargen.ts';
import {
  kostenHerkunft, letztesRezept, produktionsEmpfehlungen, pruefeProduktion, type ProduktionsEmpfehlung,
} from '../supabase/functions/_shared/kombi/produktion.ts';
import './bestand-aktualisieren.css';

type Props = {
  bestand: Sorte[];
  /** ändert sich nach jeder Buchung → neu laden */
  version: number;
  onStarten: (v: ProduktionsVorlage) => void;
  onMeldung: (text: string, fehler?: boolean) => void;
  onBestandGeaendert: () => void;
};

const tagText = (iso: string | null): string => {
  if (!iso) return 'Flexibel';
  const heute = heuteIso();
  const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (iso < heute) return `Überfällig (${datum(iso)})`;
  if (iso === heute) return 'Heute';
  if (iso === morgen) return 'Morgen';
  return datum(iso);
};

function statusText(e: ProduktionsEmpfehlung): string {
  if (e.status === 'alles_da') return 'Alle Zutaten vorhanden';
  if (e.status === 'fehlt_etwas') return e.pruefung?.fehlend.length === 1 ? '1 Zutat fehlt' : `${e.pruefung?.fehlend.length ?? 0} Zutaten fehlen`;
  const da = e.bestandteile.filter((b) => b.vorhanden).length;
  return `${da} von ${e.bestandteile.length} Zutaten da · Mengen offen`;
}

export function Produktion({ bestand, version, onStarten, onMeldung, onBestandGeaendert }: Props) {
  const [produktionen, setProduktionen] = useState<ProduktionT[] | null | 'fehlt'>(null);
  const [chargen, setChargen] = useState<ChargeInfo[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [details, setDetails] = useState<ProduktionT | null>(null);

  const laden = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([ladeProduktionen(), ladeAktiveChargen()]);
      setProduktionen(p ?? 'fehlt');
      setChargen(c);
      setFehler(null);
    } catch (e) {
      setFehler(fehlerText(e));
    }
  }, []);

  useEffect(() => {
    void laden();
  }, [laden, version]);

  const sorten = useMemo(() => bestand.map(produktSorte), [bestand]);
  const liste = Array.isArray(produktionen) ? produktionen : [];
  const empfehlungen = useMemo(
    () => produktionsEmpfehlungen({ sorten, chargen, produktionen: liste }).filter((e) => e.quelle !== 'geplant').slice(0, 4),
    [sorten, chargen, liste],
  );
  const geplant = liste
    .filter((p) => p.status === 'geplant')
    .sort((a, b) => (a.geplant_fuer ?? '9999').localeCompare(b.geplant_fuer ?? '9999') || a.erstellt_am.localeCompare(b.erstellt_am));
  const zuletzt = liste.filter((p) => p.status === 'abgeschlossen').slice(0, 6);
  const name = (id: number) => bestand.find((s) => s.id === id)?.name ?? 'Unbekannt';

  function starteFuer(s: Sorte) {
    const r = letztesRezept(s.id, liste);
    onStarten({ block_typ_id: s.id, eingaenge: r?.eingaenge ?? [], menge: r?.menge ?? null });
  }

  async function verwerfen(p: ProduktionT) {
    try {
      await verwerfePlanung(p.id);
      onMeldung(`Planung „${name(p.block_typ_id)}“ entfernt.`);
      void laden();
    } catch (e) {
      onMeldung(fehlerText(e), true);
    }
  }

  if (produktionen === 'fehlt') {
    return (
      <p className="hinweisbox">
        Für die Produktion fehlt noch die Migration „bon_produktion“ in Supabase (siehe README). Bis dahin kannst du Komponenten wie bisher über „Einbuchen“ erfassen.
      </p>
    );
  }

  const gruppe = (art: 'komponente' | 'komplettgericht') =>
    bestand.filter((s) => artVon(s) === art).sort((a, b) => Number(a.anzahl >= a.mindestbestand) - Number(b.anzahl >= b.mindestbestand) || a.name.localeCompare(b.name, 'de'));

  return (
    <>
      {fehler && (
        <p className="fehlerbox">
          {fehler} <button type="button" className="link" onClick={() => void laden()}>Nochmal versuchen</button>
        </p>
      )}

      <button type="button" className="bestand-aktualisieren" onClick={() => onStarten({ block_typ_id: null, eingaenge: [], menge: null })}>
        <Icon name="topf" groesse={26} />
        <span>
          <strong>+ Produktion starten</strong>
          <small>Einmal mehr kochen – Kombi weiß, was daraus entstanden ist</small>
        </span>
      </button>

      <section className="gruppe">
        <h2 className="abschnitt-titel">🔥 Jetzt sinnvoll</h2>
        {produktionen === null && <p className="leise klein gruppe-leer">Lade …</p>}
        {produktionen !== null && empfehlungen.length === 0 && (
          <p className="leise klein gruppe-leer">
            Noch keine Empfehlungen. Sobald du etwas produziert hast oder bei einer Komponente die Zusammensetzung hinterlegst, schlägt Kombi hier vor, was sich lohnt.
          </p>
        )}
        {empfehlungen.map((e) => (
          <article key={e.block_typ_id} className="empfehlung">
            <p className="empfehlung-name">{e.art === 'komplettgericht' ? '🔵' : '🧩'} {e.name}</p>
            <p className="leise klein">{e.menge !== null ? mengeText(e.menge, e.einheit) : 'Menge offen'} · {statusText(e)}</p>
            <ul className="gruende">{e.gruende.filter((g) => !/^Alle Zutaten|Zutaten fehlen|Es fehlt|Mengen noch offen/.test(g)).map((g) => <li key={g}>{g}</li>)}</ul>
            <div className="knopf-reihe">
              <button type="button" className="knopf" onClick={() => onStarten({ block_typ_id: e.block_typ_id, eingaenge: e.eingaenge, menge: e.menge })}>
                Produktion starten
              </button>
            </div>
          </article>
        ))}
      </section>

      {geplant.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">📅 Geplant</h2>
          <ul className="liste">
            {geplant.map((p) => {
              const s = bestand.find((x) => x.id === p.block_typ_id);
              const pr = p.zutaten.length ? pruefeProduktion(p.zutaten, p.geplante_menge ?? 1, sorten, chargen) : null;
              return (
                <li key={p.id} className="zeile">
                  <button type="button" className="zeile-info" onClick={() => onStarten({ block_typ_id: p.block_typ_id, eingaenge: p.zutaten, menge: p.geplante_menge, produktion: p })}>
                    <span className="zeile-name">{p.art === 'komplettgericht' ? '🔵' : '🧩'} {name(p.block_typ_id)}</span>
                    <span className="zeile-details">
                      {tagText(p.geplant_fuer)} · {p.geplante_menge && s ? mengeText(p.geplante_menge, einheitVon(s)) : 'Menge offen'}
                      {pr ? (pr.alles_da ? ' · Zutaten da ✅' : ` · fehlt: ${pr.fehlend.map((f) => f.name).join(', ')}`) : ''}
                    </span>
                  </button>
                  <button type="button" className="icon-knopf klein" onClick={() => void verwerfen(p)} aria-label="Planung entfernen">
                    <Icon name="schliessen" groesse={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(['komponente', 'komplettgericht'] as const).map((art) => {
        const sortenListe = gruppe(art);
        return (
          <section key={art} className="gruppe">
            <h2 className="abschnitt-titel">{art === 'komponente' ? '🧩 Komponenten' : '🔵 Fertiggerichte'}</h2>
            {sortenListe.length === 0 ? (
              <p className="leise klein gruppe-leer">
                {art === 'komponente' ? 'Noch keine – z. B. Tomaten-Basis, Curry-Basis, Falafel-Masse, Ofengemüse.' : 'Noch keine – z. B. TK-Pizza, Linsensuppe, Lasagne, Chili.'} Anlegen unter „Sorten“.
              </p>
            ) : (
              <ul className="liste">
                {sortenListe.map((s) => {
                  const letzte = liste.find((p) => p.block_typ_id === s.id && p.status === 'abgeschlossen');
                  const knapp = s.anzahl < s.mindestbestand;
                  return (
                    <li key={s.id} className={`zeile f-${s.farbe}`}>
                      <span className="farbpunkt" aria-hidden="true" />
                      <button type="button" className="zeile-info" onClick={() => starteFuer(s)}>
                        <span className="zeile-name">{s.name}</span>
                        <span className="zeile-details">
                          {mengeText(s.anzahl, einheitVon(s))} da{knapp ? ` · nachkochen (min. ${s.mindestbestand})` : ''}
                          {letzte ? ` · zuletzt ${datum((letzte.abgeschlossen_am ?? letzte.erstellt_am).slice(0, 10))}` : ''}
                        </span>
                      </button>
                      <span className="pfeil" aria-hidden="true"><Icon name="topf" groesse={18} /></span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {zuletzt.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">🕘 Zuletzt produziert</h2>
          <ul className="liste">
            {zuletzt.map((p) => {
              const s = bestand.find((x) => x.id === p.block_typ_id);
              const einheit = s ? einheitVon(s) : 'portion';
              const pro = p.kosten_cent !== null && p.menge ? p.kosten_cent / p.menge : null;
              return (
                <li key={p.id} className="zeile">
                  <button type="button" className="zeile-info" onClick={() => setDetails(p)}>
                    <span className="zeile-name">{name(p.block_typ_id)}</span>
                    <span className="zeile-details">
                      {datum((p.abgeschlossen_am ?? p.erstellt_am).slice(0, 10))} · {mengeText(p.menge ?? 0, einheit)}
                      {p.geplante_menge && p.geplante_menge !== p.menge ? ` (geplant ${p.geplante_menge})` : ''}
                      {' · '}{pro === null ? 'Kosten unbekannt' : `${p.kosten_status === 'teilweise' ? 'ab ' : ''}${euro(Math.round(pro))} / ${einheit === 'portion' ? 'Portion' : 'Einheit'}`}
                      {p.lagerort ? ` · ${lagerInfo(p.lagerort).name}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {details && (
        <ProduktionDetails
          p={details}
          bestand={bestand}
          onRueckgaengig={async () => {
            try {
              await produktionRueckgaengig(details.id);
              onMeldung(`${name(details.block_typ_id)}: Produktion rückgängig gemacht – Zutaten sind zurück im Bestand.`);
              setDetails(null);
              onBestandGeaendert();
              void laden();
            } catch (e) {
              onMeldung(fehlerText(e), true);
            }
          }}
          onSchliessen={() => setDetails(null)}
        />
      )}
    </>
  );
}

/** Kostenherkunft: Woher kommen die Kosten dieser Charge? */
function ProduktionDetails({ p, bestand, onRueckgaengig, onSchliessen }: {
  p: ProduktionT; bestand: Sorte[]; onRueckgaengig: () => void; onSchliessen: () => void;
}) {
  const [zeilen, setZeilen] = useState<Awaited<ReturnType<typeof ladeEingaenge>> | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  useEffect(() => {
    ladeEingaenge(p.id).then(setZeilen).catch((e) => setFehler(fehlerText(e)));
  }, [p.id]);
  const s = bestand.find((x) => x.id === p.block_typ_id);
  const einheit = s ? einheitVon(s) : 'portion';
  const h = zeilen ? kostenHerkunft(zeilen, p.menge ?? 1, bestand.map((x) => ({ id: x.id, name: x.name, einheit: einheitVon(x) }))) : null;
  const titel = `${s?.name ?? 'Produktion'} – ${h?.pro_einheit_cent != null ? `${h.gesamt.status === 'teilweise' ? 'ab ' : ''}${euro(Math.round(h.pro_einheit_cent))} / ${einheit === 'portion' ? 'Portion' : 'Einheit'}` : 'Kosten unbekannt'}`;
  return (
    <Blatt titel={titel} untertitel={`${mengeText(p.menge ?? 0, einheit)} am ${datum((p.abgeschlossen_am ?? p.erstellt_am).slice(0, 10))}${p.lagerort ? ` · ${lagerInfo(p.lagerort).name}` : ''}`} onSchliessen={onSchliessen}>
      {fehler && <p className="fehlertext">{fehler}</p>}
      {!zeilen && !fehler && <p className="leise">Lade …</p>}
      {h && (
        <section className="abschnitt">
          <h3>Woher kommen die Kosten?</h3>
          {h.posten.length === 0 ? (
            <p className="leise klein">Keine Zutaten aus dem Bestand – Kosten unbekannt.</p>
          ) : (
            <ul className="chargen">
              {h.posten.map((x) => (
                <li key={x.name}>
                  <span className="charge-links">
                    <span>{x.name}</span>
                    <small>{mengeText(x.menge, x.einheit)} aus den verwendeten Chargen</small>
                  </span>
                  <strong>{x.cent === null ? 'unbekannt' : euro(Math.round(x.cent))}</strong>
                </li>
              ))}
              <li>
                <span className="charge-links"><strong>Gesamt</strong><small>{h.gesamt.status === 'teilweise' ? 'nur bekannte Preise' : h.gesamt.status === 'unbekannt' ? '' : 'alle Preise bekannt'}</small></span>
                <strong>{h.gesamt.cent === null ? 'unbekannt' : euro(Math.round(h.gesamt.cent))}</strong>
              </li>
            </ul>
          )}
          <p className="leise klein">Verwendete Komponenten zählen mit dem Wert ihrer eigenen Charge – ihre Zutaten werden nicht noch einmal gerechnet.</p>
        </section>
      )}
      <div className="knopf-reihe">
        <button type="button" className="knopf" onClick={onRueckgaengig}>Produktion rückgängig</button>
      </div>
      <p className="leise klein">Rückgängig geht nur, solange von dieser Charge noch nichts entnommen wurde.</p>
    </Blatt>
  );
}
