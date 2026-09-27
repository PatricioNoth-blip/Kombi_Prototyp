// „Bestand aktualisieren“ über Kassenbon, E-Bon oder Bon-Text.
//
//   Erfassen → Lesen → (nur nötige) Rückfragen → Bestandsänderungen prüfen → „Bestand aktualisieren“ → Fertig
//
// Bis zum letzten Knopf ist alles nur ein Vorschlag in der App. Die Datenbank sieht den Bon erst mit
// bon_buchen() – deshalb verändert ein Abbruch nie etwas. Danach: Rückgängig für den ganzen Import und
// Vorschläge, was sich mit dem neuen Einkauf jetzt produzieren ließe.
import { useEffect, useState } from 'react';
import { fehlerText, type Sorte } from './api';
import * as bonApi from './bonApi';
import { aufEinkaufsliste, ladeProduktionen, produktSorte } from './produktionApi';
import { Blatt } from './Blatt';
import { Icon, type IconName } from './Icon';
import { Vollbild } from './Vollbild';
import { ARTEN_INFO, EINHEITEN_INFO, FARBEN, LAGERORTE, lagerort as lagerInfo } from './farben';
import { datum, euro, mengeText } from './format';
import { zerlegeBon } from '../supabase/functions/_shared/kombi/bon/parser.ts';
import { namenFuerPositionen } from '../supabase/functions/_shared/kombi/bon/ki.ts';
import { lesbarerName } from '../supabase/functions/_shared/kombi/bon/abgleich.ts';
import {
  alleFragen, alsNeu, bestandMenge, buchungsDaten, einheitVonZiel, endpreis, erstelleEntwurf, GRUENDE, grundText,
  kostenGebucht, nameVonZiel, nichtUebernehmen, setzeAnzahl, setzeBestandMenge, setzeGrund, setzeLagerung,
  setzeMengeProEinheit, setzeTyp, vorgeschlageneAnzahl, vorschau, vorschlaegeAnnehmen, waehleSorte, type Kontext,
} from '../supabase/functions/_shared/kombi/bon/vorschlag.ts';
import type {
  BonDaten, Grund, ImportEntwurf, ImportQuelle, NeueSorte, PositionEntwurf, Rueckfrage, SorteInfo,
} from '../supabase/functions/_shared/kombi/bon/typen.ts';
import type { Einheit, Lagerort } from '../supabase/functions/_shared/kombi/typen.ts';
import {
  empfehlungenNachEinkauf, fehlendeAufEinkaufsliste, type ProduktionsEmpfehlung,
} from '../supabase/functions/_shared/kombi/produktion.ts';
import './bestand-aktualisieren.css';

type Schritt = 'erfassen' | 'lesen' | 'klaeren' | 'pruefen' | 'fertig';
type Fertig = { ergebnis: bonApi.BonErgebnis; zusammenfassung: string; wert: string; neuGekauft: number[] };
type Gemerkt = { entwurf: ImportEntwurf; namen: Record<string, string> };

export const QUELLEN: { id: ImportQuelle; name: string; titel: string; icon: IconName }[] = [
  { id: 'kassenbon', name: 'Foto', titel: 'Kassenbon scannen', icon: 'kamera' },
  { id: 'e_bon', name: 'E-Bon', titel: 'E-Bon importieren', icon: 'datei' },
  { id: 'text', name: 'Text', titel: 'Bon-Text einfügen', icon: 'text' },
];

const BEISPIEL = `REWE Markt GmbH
Musterstraße 1, 50667 Köln
                          EUR
NATUR JOGHURT 500G           2,37 B
  3 Stk x   0,79
TOMATEN 1KG                  1,49 B
KIDNEYBOHNEN 400G            1,78 B
  2 Stk x   0,89
Preisvorteil                -0,30 B
VOLLKORN BROT                1,49 B
ZWIEBELN 1KG NETZ            0,99 B
MINERALWASSER 6X1,5L         1,74 A
PFAND 0,25 EURO              1,50 A *
WASCHMITTEL COLOR            4,99 A
HAFERDRINK BARISTA 1L        1,89 A
--------------------------------------
SUMME                 EUR   17,94
Datum: 28.09.2026  Uhrzeit: 17:45`;

const einheitKurz = (e: Einheit) => (e === 'stueck' ? 'Stück' : e === 'portion' ? 'Portionen' : e);
const zahl = (text: string) => Number(text.replace(',', '.'));

type Props = {
  quelle: ImportQuelle;
  bestand: Sorte[];
  /** Bestand neu laden (nach dem Buchen oder Rückgängig) */
  onGebucht: () => void;
  onMeldung: (text: string, fehler?: boolean) => void;
  /** Produktion aus einer Empfehlung heraus planen */
  onProduktion: (e: ProduktionsEmpfehlung) => void;
  onSchliessen: () => void;
};

export function BonImport({ quelle: startQuelle, bestand, onGebucht, onMeldung, onProduktion, onSchliessen }: Props) {
  const [quelle, setQuelle] = useState<ImportQuelle>(startQuelle);
  const [schritt, setSchritt] = useState<Schritt>('erfassen');
  const [fotos, setFotos] = useState<{ datei: File; url: string }[]>([]);
  const [datei, setDatei] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [kiFehlt, setKiFehlt] = useState(false);
  const [entwurf, setEntwurf] = useState<ImportEntwurf | null>(null);
  const [kontext, setKontext] = useState<Kontext | null>(null);
  const [bearbeite, setBearbeite] = useState<number | null>(null);
  const [doppelt, setDoppelt] = useState<string | null>(null);
  const [bucht, setBucht] = useState(false);
  const [fertig, setFertig] = useState<Fertig | null>(null);
  const [gemerkt, setGemerkt] = useState(() => bonApi.gemerkterEntwurf<Gemerkt>());

  // Unbestätigten Entwurf auf diesem Gerät merken (nur Komfort – die Datenbank sieht davon nichts)
  useEffect(() => {
    if (entwurf && schritt !== 'fertig') bonApi.merkeEntwurf({ entwurf, namen: kontext?.namen ?? {} } satisfies Gemerkt);
  }, [entwurf, kontext, schritt]);

  function aendere(neu: ImportEntwurf) {
    setEntwurf(neu);
    if (schritt === 'klaeren' && kontext && alleFragen(neu, kontext).length === 0) setSchritt('pruefen');
  }

  function abbrechen() {
    if (schritt === 'fertig') return onSchliessen();
    bonApi.merkeEntwurf(null);
    onMeldung('Abgebrochen – noch nichts wurde am Bestand verändert.');
    onSchliessen();
  }

  function fotosDazu(liste: FileList | null) {
    if (!liste) return;
    const neu = Array.from(liste).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
    setFotos((alt) => [...alt, ...neu.map((d) => ({ datei: d, url: URL.createObjectURL(d) }))].slice(0, 6));
    setFehler(null);
  }

  function fotoWeg(i: number) {
    setFotos((alt) => {
      URL.revokeObjectURL(alt[i].url);
      return alt.filter((_, j) => j !== i);
    });
  }

  function fotoVerschieben(i: number, richtung: -1 | 1) {
    setFotos((alt) => {
      const j = i + richtung;
      if (j < 0 || j >= alt.length) return alt;
      const neu = [...alt];
      [neu[i], neu[j]] = [neu[j], neu[i]];
      return neu;
    });
  }

  async function starte(bon: BonDaten, erkennung: string, namen: Record<string, string>, ref: string | null) {
    if (bon.positionen.length === 0) {
      throw new Error('Auf dem Bon wurden keine Artikel mit Preis gefunden. Bitte schärfer fotografieren oder den Text prüfen.');
    }
    const k: Kontext = {
      sorten: bonApi.sortenInfo(bestand),
      gewohnheiten: await bonApi.ladeGewohnheiten(),
      namen: namenFuerPositionen(namen, bon.positionen.map((p) => p.text)),
    };
    const e = erstelleEntwurf(bon, k, { quelle, quelle_ref: ref, erkennung });
    setKontext(k);
    setEntwurf(e);
    setSchritt(alleFragen(e, k).length ? 'klaeren' : 'pruefen');
  }

  async function lesen() {
    setFehler(null);
    setKiFehlt(false);
    setSchritt('lesen');
    try {
      if (quelle === 'text') {
        await starte(zerlegeBon(text), 'text', {}, null);
      } else if (quelle === 'e_bon') {
        if (!datei) throw new Error('Bitte zuerst eine Datei wählen.');
        const d = await bonApi.leseDatei(datei);
        if (d.art === 'text') {
          await starte(zerlegeBon(d.text), d.erkennung, {}, datei.name);
        } else {
          const { lesung, anbieter } = await bonApi.leseFotos([datei]);
          await starte(zerlegeBon(lesung.seiten), `ki:${anbieter}`, lesung.namen, datei.name);
        }
      } else {
        if (fotos.length === 0) throw new Error('Bitte zuerst den Bon fotografieren.');
        const { lesung, anbieter } = await bonApi.leseFotos(fotos.map((f) => f.datei));
        await starte(zerlegeBon(lesung.seiten), `ki:${anbieter}`, lesung.namen, fotos.map((f) => f.datei.name).join(', ').slice(0, 300));
      }
    } catch (e) {
      setKiFehlt(e instanceof bonApi.KiNichtDa);
      setFehler(fehlerText(e));
      setSchritt('erfassen');
    }
  }

  async function fortsetzen() {
    if (!gemerkt) return;
    const k: Kontext = { sorten: bonApi.sortenInfo(bestand), gewohnheiten: await bonApi.ladeGewohnheiten(), namen: gemerkt.wert.namen };
    // Sorten können sich seitdem geändert haben: Zuordnungen zu gelöschten Sorten neu klären
    const e: ImportEntwurf = {
      ...gemerkt.wert.entwurf,
      positionen: gemerkt.wert.entwurf.positionen.map((p) =>
        p.ziel.art === 'sorte' && !k.sorten.some((s) => s.id === (p.ziel as { sorte_id: number }).sorte_id)
          ? { ...p, ziel: { art: 'keine' as const }, anzahl_uebernehmen: 0 }
          : p,
      ),
    };
    setQuelle(e.quelle);
    setKontext(k);
    setEntwurf(e);
    setGemerkt(null);
    setSchritt(alleFragen(e, k).length ? 'klaeren' : 'pruefen');
  }

  async function buchen(trotzDoppelt = false) {
    if (!entwurf || !kontext) return;
    const v = vorschau(entwurf, kontext);
    if (!v.kann_buchen) return;
    setBucht(true);
    setFehler(null);
    setDoppelt(null);
    try {
      const ergebnis = await bonApi.bucheBon(buchungsDaten(entwurf), trotzDoppelt);
      bonApi.merkeEntwurf(null);
      setFertig({
        ergebnis,
        zusammenfassung: v.zusammenfassung,
        wert: v.wert_unbekannt ? `${euro(v.wert_cent)} + ${v.wert_unbekannt} ohne Preis` : euro(v.wert_cent),
        neuGekauft: entwurf.positionen
          .filter((p) => bestandMenge(p) > 0 && p.ziel.art === 'sorte')
          .map((p) => (p.ziel as { sorte_id: number }).sorte_id),
      });
      setSchritt('fertig');
      onGebucht();
    } catch (e) {
      if (e instanceof bonApi.DoppeltFehler) setDoppelt(e.message);
      else setFehler(fehlerText(e));
    } finally {
      setBucht(false);
    }
  }

  async function allesRueckgaengig() {
    if (!fertig) return;
    try {
      await bonApi.bonRueckgaengig(fertig.ergebnis.import_id);
      onMeldung('Import rückgängig gemacht – der Bestand ist wieder wie vorher.');
      onGebucht();
      onSchliessen();
    } catch (e) {
      onMeldung(fehlerText(e), true);
    }
  }

  const titel =
    schritt === 'lesen' ? 'Bon wird gelesen …'
    : schritt === 'klaeren' ? 'Kurz nachgefragt'
    : schritt === 'pruefen' ? 'Bestandsänderungen prüfen'
    : schritt === 'fertig' ? 'Bestand aktualisiert'
    : QUELLEN.find((q) => q.id === quelle)!.titel;
  const v = entwurf && kontext ? vorschau(entwurf, kontext) : null;
  const position = entwurf?.positionen.find((p) => p.nr === bearbeite) ?? null;

  const kannLesen = quelle === 'text' ? text.trim().length > 0 : quelle === 'e_bon' ? !!datei : fotos.length > 0;
  const fuss =
    schritt === 'erfassen' ? (
      <button type="button" className="knopf haupt" disabled={!kannLesen} onClick={() => void lesen()}>
        <Icon name="bon" /> {quelle === 'kassenbon' && fotos.length > 1 ? `Bon lesen (${fotos.length} Fotos)` : 'Bon lesen'}
      </button>
    ) : schritt === 'pruefen' && v ? (
      <>
        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="button" className="knopf haupt" disabled={!v.kann_buchen || bucht} onClick={() => void buchen()}>
          <Icon name="haken" /> {bucht ? 'Aktualisiere …' : 'Bestand aktualisieren'}
        </button>
        <p className="fuss-hinweis">Erst nach deiner Bestätigung werden die Änderungen gespeichert.</p>
      </>
    ) : schritt === 'fertig' ? (
      <button type="button" className="knopf haupt" onClick={onSchliessen}>Fertig</button>
    ) : undefined;

  return (
    <Vollbild titel={titel} onSchliessen={abbrechen} schliessenText={schritt === 'fertig' ? 'Schließen' : 'Abbrechen'} fuss={fuss}>
      {schritt === 'erfassen' && (
        <>
          {gemerkt && (
            <div className="hinweisbox gemerkt">
              <span>Du hast einen noch nicht bestätigten Bon{gemerkt.wert.entwurf.bon.haendler ? ` von ${gemerkt.wert.entwurf.bon.haendler}` : ''}.</span>
              <span className="knopf-reihe">
                <button type="button" className="knopf" onClick={() => void fortsetzen()}>Fortsetzen</button>
                <button type="button" className="knopf" onClick={() => { bonApi.merkeEntwurf(null); setGemerkt(null); }}>Verwerfen</button>
              </span>
            </div>
          )}
          <div className="segment quellen-wahl" role="tablist" aria-label="Woher kommt der Bon?">
            {QUELLEN.map((q) => (
              <button key={q.id} type="button" role="tab" aria-selected={quelle === q.id} className={quelle === q.id ? 'gewaehlt' : ''}
                onClick={() => { setQuelle(q.id); setFehler(null); setKiFehlt(false); }}>
                <Icon name={q.icon} groesse={16} /> {q.name}
              </button>
            ))}
          </div>

          {fehler && (
            <div className="fehlerbox">
              {fehler}
              {kiFehlt && quelle !== 'text' && (
                <button type="button" className="link" onClick={() => { setQuelle('text'); setFehler(null); }}>Bon-Text einfügen</button>
              )}
            </div>
          )}

          {quelle === 'kassenbon' && (
            <>
              <label className="aufnahme">
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { fotosDazu(e.target.files); e.target.value = ''; }} />
                <Icon name="kamera" groesse={34} />
                <strong>{fotos.length ? 'Weiteres Foto aufnehmen' : 'Kassenbon fotografieren'}</strong>
                <small>Langer Bon? Mehrere Fotos von oben nach unten – Überlappungen erkennt Kombi.</small>
              </label>
              <label className="link galerie">
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { fotosDazu(e.target.files); e.target.value = ''; }} />
                Aus der Galerie wählen
              </label>
              {fotos.length > 0 && (
                <ol className="foto-liste">
                  {fotos.map((f, i) => (
                    <li key={f.url}>
                      <img src={f.url} alt={`Foto ${i + 1}`} />
                      <span className="foto-nr">{i + 1}</span>
                      <span className="foto-knoepfe">
                        <button type="button" className="icon-knopf klein" onClick={() => fotoVerschieben(i, -1)} disabled={i === 0} aria-label="Nach vorne">
                          <Icon name="hoch" groesse={16} />
                        </button>
                        <button type="button" className="icon-knopf klein" onClick={() => fotoVerschieben(i, 1)} disabled={i === fotos.length - 1} aria-label="Nach hinten">
                          <Icon name="runter" groesse={16} />
                        </button>
                        <button type="button" className="icon-knopf klein" onClick={() => fotoWeg(i)} aria-label="Foto entfernen">
                          <Icon name="schliessen" groesse={16} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="leise klein erklaerung">
                Die KI schreibt die Fotos nur ab. Mengen, Preise und Zuordnung rechnet Kombi selbst – und gebucht wird erst nach deiner Bestätigung.
              </p>
            </>
          )}

          {quelle === 'e_bon' && (
            <>
              <label className="aufnahme">
                <input type="file" accept="application/pdf,.pdf,image/*,text/plain,.txt" hidden onChange={(e) => { setDatei(e.target.files?.[0] ?? null); setFehler(null); e.target.value = ''; }} />
                <Icon name="datei" groesse={34} />
                <strong>{datei ? datei.name : 'E-Bon wählen'}</strong>
                <small>PDF, Bild oder Text. PDFs mit Textebene liest Kombi direkt – ganz ohne KI.</small>
              </label>
              <p className="leise klein erklaerung">
                Eine direkte Anbindung an Händler-Apps gibt es noch nicht. Den E-Bon aus App oder Mail als PDF speichern und hier wählen.
              </p>
            </>
          )}

          {quelle === 'text' && (
            <>
              <textarea rows={12} value={text} onChange={(e) => { setText(e.target.value); setFehler(null); }}
                placeholder="Bon-Text hier einfügen (aus Mail, App oder abgetippt) …" aria-label="Bon-Text" />
              <button type="button" className="link" onClick={() => setText(BEISPIEL)}>Beispiel-Bon einsetzen</button>
            </>
          )}
        </>
      )}

      {schritt === 'lesen' && (
        <div className="leer-zustand">
          <Icon name="bon" groesse={40} />
          <p>{quelle === 'kassenbon' ? 'Die Fotos werden abgeschrieben und geprüft …' : 'Der Bon wird gelesen …'}</p>
        </div>
      )}

      {schritt === 'klaeren' && entwurf && kontext && (
        <Klaeren entwurf={entwurf} kontext={kontext} onAendern={aendere} onWeiter={() => setSchritt('pruefen')} />
      )}

      {schritt === 'pruefen' && entwurf && kontext && v && (
        <Pruefen entwurf={entwurf} kontext={kontext} onBearbeiten={setBearbeite} onKlaeren={() => setSchritt('klaeren')} />
      )}

      {schritt === 'fertig' && fertig && (
        <FertigAnsicht fertig={fertig} bestand={bestand} onRueckgaengig={() => void allesRueckgaengig()} onProduktion={onProduktion} onMeldung={onMeldung} />
      )}

      {position && entwurf && kontext && (
        <PositionBlatt p={position} entwurf={entwurf} kontext={kontext} onAendern={setEntwurf} onSchliessen={() => setBearbeite(null)} />
      )}

      {doppelt && (
        <Blatt titel="Diesen Bon gibt es schon" onSchliessen={() => setDoppelt(null)}>
          <p>{doppelt.replace(' Es wurde nichts gebucht.', '')}</p>
          <p className="leise klein">Wenn du wirklich zweimal genau dasselbe gekauft hast, kannst du ihn trotzdem buchen.</p>
          <div className="knopf-reihe">
            <button type="button" className="knopf" onClick={() => setDoppelt(null)}>Nicht buchen</button>
            <button type="button" className="knopf" onClick={() => void buchen(true)}>Trotzdem buchen</button>
          </div>
        </Blatt>
      )}
    </Vollbild>
  );
}

// ───────── Rückfragen ─────────

function preisText(p: PositionEntwurf): string {
  const preis = endpreis(p.bon);
  const menge = p.bon.gewicht_g !== null ? mengeText(p.bon.gewicht_g, 'g') : p.bon.anzahl > 1 ? `${p.bon.anzahl} ×` : '';
  return [menge, preis === null ? 'Preis nicht lesbar' : euro(preis)].filter(Boolean).join(' · ');
}

function Klaeren({ entwurf, kontext, onAendern, onWeiter }: { entwurf: ImportEntwurf; kontext: Kontext; onAendern: (e: ImportEntwurf) => void; onWeiter: () => void }) {
  const fragen = alleFragen(entwurf, kontext);
  if (fragen.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="haken" groesse={40} />
        <p>Alles geklärt.</p>
        <button type="button" className="knopf" onClick={onWeiter}>Zur Übersicht</button>
      </div>
    );
  }
  const frage = fragen[0];
  const p = entwurf.positionen.find((x) => x.nr === frage.nr)!;
  const weich = fragen.filter((f) => !f.pflicht).length;
  return (
    <>
      <p className="leise klein frage-zaehler">
        {fragen.length === 1 ? 'Eine Frage' : `Noch ${fragen.length} Fragen`} – nur, wo es für einen korrekten Bestand wichtig ist.
      </p>
      <FrageKarte key={`${frage.nr}-${frage.art}`} frage={frage} p={p} entwurf={entwurf} kontext={kontext} onAendern={onAendern} />
      <div className="knopf-reihe">
        {weich > 0 && (
          <button type="button" className="knopf" onClick={() => onAendern(vorschlaegeAnnehmen(entwurf))}>
            Rest wie vorgeschlagen
          </button>
        )}
        <button type="button" className="knopf" onClick={onWeiter}>Zur Übersicht</button>
      </div>
    </>
  );
}

function GrundWahl({ wert, onWahl }: { wert: Grund | null; onWahl: (g: Grund | null) => void }) {
  return (
    <div className="abschnitt">
      <h3>Warum nicht? <small>(optional)</small></h3>
      <div className="chips">
        {GRUENDE.map((g) => (
          <button key={g.id} type="button" className={`chip${wert === g.id ? ' gewaehlt' : ''}`} onClick={() => onWahl(wert === g.id ? null : g.id)}>
            {g.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function SorteWahl({ sorten, aktuell, onWahl, text = 'Andere Sorte wählen …' }: { sorten: SorteInfo[]; aktuell: number | null; onWahl: (id: number) => void; text?: string }) {
  return (
    <select className="sorte-wahl" value="" onChange={(e) => e.target.value && onWahl(Number(e.target.value))} aria-label={text}>
      <option value="">{text}</option>
      {ARTEN_INFO.map((a) => (
        <optgroup key={a.id} label={a.mehrzahl}>
          {sorten
            .filter((s) => s.art === a.id && s.id !== aktuell)
            .sort((x, y) => x.name.localeCompare(y.name, 'de'))
            .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

function NeuesProdukt({ daten, onChange }: { daten: NeueSorte; onChange: (d: NeueSorte) => void }) {
  const setze = (teil: Partial<NeueSorte>) => onChange({ ...daten, ...teil });
  return (
    <div className="formular neues-produkt">
      <label className="feld">
        <span>Name</span>
        <input type="text" value={daten.name} maxLength={60} onChange={(e) => setze({ name: e.target.value })} />
      </label>
      <fieldset className="feld">
        <legend>Art</legend>
        <div className="segment klein">
          {ARTEN_INFO.map((a) => (
            <button key={a.id} type="button" className={daten.art === a.id ? 'gewaehlt' : ''} onClick={() => setze({ art: a.id })}>{a.name}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="feld">
        <legend>Einheit im Bestand</legend>
        <div className="segment klein">
          {EINHEITEN_INFO.map((e) => (
            <button key={e.id} type="button" className={daten.einheit === e.id ? 'gewaehlt' : ''}
              onClick={() => setze({ einheit: e.id, portion_menge: e.id === 'g' ? 100 : e.id === 'ml' ? 200 : 1 })}>{e.name}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="feld">
        <legend>Lagerort</legend>
        <div className="segment klein">
          {LAGERORTE.map((l) => (
            <button key={l.id} type="button" className={daten.lagerort === l.id ? 'gewaehlt' : ''} onClick={() => setze({ lagerort: l.id })}>{l.name}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="feld">
        <legend>Kategorie</legend>
        <div className="chips">
          {FARBEN.map((f) => (
            <button key={f.id} type="button" className={`chip f-${f.id}${daten.farbe === f.id ? ' gewaehlt' : ''}`} onClick={() => setze({ farbe: f.id })}>
              <span className="farbpunkt" aria-hidden="true" /> {f.bedeutung}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function FrageKarte({ frage, p, entwurf, kontext, onAendern }: {
  frage: Rueckfrage; p: PositionEntwurf; entwurf: ImportEntwurf; kontext: Kontext; onAendern: (e: ImportEntwurf) => void;
}) {
  const [wahl, setWahl] = useState(() => vorgeschlageneAnzahl(p, kontext));
  const [grund, setGrund] = useState<Grund | null>(null);
  const [nein, setNein] = useState(false);
  const [umrechnung, setUmrechnung] = useState('');
  const [neu, setNeu] = useState<NeueSorte | null>(p.ziel.art === 'neu' ? p.ziel.daten : null);
  const einheit = einheitVonZiel(p.ziel, kontext.sorten);
  const aktuell = p.ziel.art === 'sorte' ? p.ziel.sorte_id : null;
  const nicht = () => onAendern(nichtUebernehmen(entwurf, p.nr, grund));

  return (
    <article className="frage-karte">
      <p className="bon-rohtext">
        <span>{p.bon.text}</span>
        <span>{preisText(p)}</span>
      </p>
      <h3 className="frage-titel">{frage.art === 'neu' ? <>🆕 {frage.frage}</> : frage.frage}</h3>
      {frage.hinweis && <p className="hinweis-klein"><Icon name="info" groesse={16} /> {frage.hinweis}</p>}

      {frage.art === 'neu' && neu && (
        <>
          <NeuesProdukt daten={neu} onChange={setNeu} />
          <button type="button" className="knopf haupt" disabled={!neu.name.trim()} onClick={() => onAendern(alsNeu(entwurf, p.nr, kontext, neu))}>
            Als neues Produkt übernehmen
          </button>
          {p.zuordnung.kandidaten.map((k) => (
            <button key={k.sorte_id} type="button" className="knopf breit kandidat" onClick={() => onAendern(waehleSorte(entwurf, p.nr, k.sorte_id, kontext))}>
              Doch „{k.name}“
            </button>
          ))}
          <SorteWahl sorten={kontext.sorten} aktuell={null} text="Vorhandene Sorte wählen …" onWahl={(id) => onAendern(waehleSorte(entwurf, p.nr, id, kontext))} />
          <button type="button" className="knopf breit" onClick={nicht}>Nicht übernehmen</button>
        </>
      )}

      {frage.art === 'zuordnung' && (
        <>
          <div className="kandidaten">
            {p.zuordnung.kandidaten.map((k) => (
              <button key={k.sorte_id} type="button" className="knopf breit kandidat" onClick={() => onAendern(waehleSorte(entwurf, p.nr, k.sorte_id, kontext))}>
                <span>{k.name}</span>
                <small>{k.grund === 'gelernt' ? 'wie beim letzten Mal' : `Übereinstimmung ${Math.round(k.sicherheit * 100)} %`}</small>
              </button>
            ))}
          </div>
          <SorteWahl sorten={kontext.sorten} aktuell={aktuell} onWahl={(id) => onAendern(waehleSorte(entwurf, p.nr, id, kontext))} />
          <div className="knopf-reihe">
            <button type="button" className="knopf" onClick={() => onAendern(alsNeu(entwurf, p.nr, kontext))}>Neues Produkt</button>
            <button type="button" className="knopf" onClick={nicht}>Nicht übernehmen</button>
          </div>
        </>
      )}

      {frage.art === 'umrechnung' && einheit && (
        <>
          <form className="eigene-anzahl" onSubmit={(e) => { e.preventDefault(); if (zahl(umrechnung) > 0) onAendern(setzeMengeProEinheit(entwurf, p.nr, zahl(umrechnung))); }}>
            <input type="number" inputMode="decimal" min={0} step="any" value={umrechnung} onChange={(e) => setUmrechnung(e.target.value)}
              placeholder={`1 × = ? ${einheitKurz(einheit)}`} aria-label={`Menge in ${einheitKurz(einheit)}`} />
            <button type="submit" className="knopf" disabled={!(zahl(umrechnung) > 0)}>Übernehmen</button>
          </form>
          {(einheit === 'portion' || einheit === 'stueck') && (
            <div className="chips">
              {[1, 2, 3, 4, 6].map((n) => (
                <button key={n} type="button" className="chip" onClick={() => onAendern(setzeMengeProEinheit(entwurf, p.nr, n))}>
                  1 × = {mengeText(n, einheit)}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="knopf breit" onClick={nicht}>Nicht übernehmen</button>
        </>
      )}

      {frage.art === 'menge' && (
        <>
          {p.bon.anzahl <= 12 && Number.isInteger(p.bon.anzahl) ? (
            <div className="zahlen">
              {Array.from({ length: p.bon.anzahl + 1 }, (_, i) => p.bon.anzahl - i).map((n) => (
                <button key={n} type="button" className={`zahl${wahl === n ? ' gewaehlt' : ''}`} onClick={() => setWahl(n)}>{n}</button>
              ))}
            </div>
          ) : (
            <input type="number" min={0} max={p.bon.anzahl} value={wahl} onChange={(e) => setWahl(zahl(e.target.value))} aria-label="Anzahl" />
          )}
          {wahl < p.bon.anzahl && <GrundWahl wert={grund} onWahl={setGrund} />}
          <button type="button" className="knopf haupt" onClick={() => {
            let e = setzeAnzahl(entwurf, p.nr, wahl);
            if (wahl < p.bon.anzahl) e = setzeGrund(e, p.nr, grund);
            onAendern(e);
          }}>
            {wahl === 0 ? 'Nichts übernehmen' : `${wahl} übernehmen`}
          </button>
        </>
      )}

      {frage.art === 'uebernehmen' && (
        nein ? (
          <>
            <GrundWahl wert={grund} onWahl={setGrund} />
            <button type="button" className="knopf haupt" onClick={nicht}>Nicht übernehmen</button>
          </>
        ) : (
          <div className="knopf-reihe">
            <button type="button" className="knopf" onClick={() => onAendern(setzeAnzahl(entwurf, p.nr, p.bon.anzahl))}>Ja</button>
            <button type="button" className="knopf" onClick={() => setNein(true)}>Nein</button>
          </div>
        )
      )}
    </article>
  );
}

// ───────── Bestandsänderungen prüfen ─────────

function Pruefen({ entwurf, kontext, onBearbeiten, onKlaeren }: {
  entwurf: ImportEntwurf; kontext: Kontext; onBearbeiten: (nr: number) => void; onKlaeren: () => void;
}) {
  const v = vorschau(entwurf, kontext);
  const bon = entwurf.bon;
  const pflicht = v.fragen.filter((f) => f.pflicht).length;
  return (
    <>
      <p className="bon-kopfzeile">
        <span>{bon.haendler ?? 'Händler unbekannt'}</span>
        <span>{bon.datum ? datum(bon.datum) : 'Datum unbekannt'}</span>
        {bon.summe_cent !== null && <span>Summe {euro(bon.summe_cent)}</span>}
        {bon.summe_geprueft === 'passt' && <span className="status status-ok">✓ Summe passt</span>}
      </p>

      {v.warnungen.length > 0 && (
        <div className="hinweisbox">
          {v.warnungen.map((w) => <p key={w}>⚠️ {w}</p>)}
        </div>
      )}
      {v.fehler.map((f) => <p key={f} className="fehlerbox">{f}</p>)}
      {pflicht > 0 && (
        <button type="button" className="offene-fragen" onClick={onKlaeren}>
          <strong>{pflicht === 1 ? 'Noch 1 Frage offen' : `Noch ${pflicht} Fragen offen`}</strong>
          <span>Ohne Antwort kann Kombi diese Artikel nicht richtig buchen. Jetzt klären →</span>
        </button>
      )}

      <section className="gruppe">
        <h2 className="abschnitt-titel">🟢 Wird hinzugefügt</h2>
        {v.hinzufuegen.length === 0 ? (
          <p className="leise klein gruppe-leer">Nichts – alle Artikel sind „nicht übernehmen“.</p>
        ) : (
          <ul className="liste">
            {v.hinzufuegen.map((z) => (
              <li key={z.nrn.join('-')} className="zeile aenderung-zeile">
                <button type="button" className="zeile-info" onClick={() => onBearbeiten(z.nrn[0])}>
                  <span className="zeile-name">{z.name} {z.neu && <span className="marke">neu</span>}</span>
                  <span className="zeile-details">
                    Vorher {mengeText(z.vorher, z.einheit)} → nachher {mengeText(z.nachher, z.einheit)}
                  </span>
                  <span className="zeile-details">
                    {z.kosten_text}{z.lagerort ? ` · ${lagerInfo(z.lagerort).name}` : ''}
                  </span>
                </button>
                <strong className="aenderung">+{mengeText(z.aenderung, z.einheit)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      {v.nicht_uebernommen.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">⚪ Nicht übernommen</h2>
          <ul className="liste">
            {v.nicht_uebernommen.map((n) => (
              <li key={`n${n.nr}`} className="zeile">
                <button type="button" className="zeile-info" onClick={() => onBearbeiten(n.nr)}>
                  <span className="zeile-name">{n.name}</span>
                  <span className="zeile-details">{n.menge} · {n.grund}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.kein_lebensmittel.length > 0 && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">🧴 Kein Lebensmittel – nicht im Bestand</h2>
          <ul className="liste">
            {v.kein_lebensmittel.map((n) => (
              <li key={`k${n.nr}`} className="zeile">
                <button type="button" className="zeile-info" onClick={() => onBearbeiten(n.nr)}>
                  <span className="zeile-name">{lesbarerName(n.text)}</span>
                  <span className="zeile-details">{n.cent !== null ? euro(n.cent) : 'Preis nicht lesbar'} · antippen, falls doch ein Lebensmittel</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(v.pfand.length > 0 || v.offene_rabatte.length > 0) && (
        <section className="gruppe">
          <h2 className="abschnitt-titel">💶 Geld, kein Bestand</h2>
          <ul className="liste">
            {v.pfand.length > 0 && (
              <li className="zeile">
                <span className="zeile-info">
                  <span className="zeile-name">Pfand {euro(v.pfand_cent)}</span>
                  <span className="zeile-details">Eigene Geldposition – keine Lebensmittelkosten</span>
                </span>
              </li>
            )}
            {v.offene_rabatte.map((r) => (
              <li key={`r${r.nr}`} className="zeile">
                <button type="button" className="zeile-info" onClick={() => onBearbeiten(r.nr)}>
                  <span className="zeile-name">{r.text} {euro(r.cent)}</span>
                  <span className="zeile-details status-bald">Rabatt konnte nicht eindeutig zugeordnet werden – wird nicht verteilt</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.hinzufuegen.length > 0 && (
        <p className="leise klein erklaerung">
          Wert der neuen Chargen: {v.wert_unbekannt ? `${euro(v.wert_cent)} + ${v.wert_unbekannt} ohne Preis` : euro(v.wert_cent)}.
          Jede Zeile wird eine eigene Einkaufscharge mit dem bezahlten Preis – ältere Chargen bleiben unverändert und werden zuerst verbraucht.
        </p>
      )}

      <details className="mehr alle-zeilen">
        <summary>Alle Bon-Zeilen ({entwurf.positionen.length})</summary>
        <ul className="liste">
          {entwurf.positionen.map((p) => {
            const m = bestandMenge(p);
            const einheit = einheitVonZiel(p.ziel, kontext.sorten);
            return (
              <li key={`a${p.nr}`} className="zeile">
                <button type="button" className="zeile-info" onClick={() => onBearbeiten(p.nr)}>
                  <span className="zeile-name bon-rohtext-klein">{p.bon.text}</span>
                  <span className="zeile-details">
                    {preisText(p)} · {m > 0 && einheit ? `→ ${mengeText(m, einheit)} ${nameVonZiel(p.ziel, kontext.sorten, '')}` : p.typ === 'lebensmittel' ? 'nicht übernommen' : p.typ === 'pfand' ? 'Pfand' : p.typ === 'rabatt' ? 'Rabatt' : 'kein Lebensmittel'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    </>
  );
}

// ───────── Eine Position bearbeiten ─────────

function PositionBlatt({ p, entwurf, kontext, onAendern, onSchliessen }: {
  p: PositionEntwurf; entwurf: ImportEntwurf; kontext: Kontext; onAendern: (e: ImportEntwurf) => void; onSchliessen: () => void;
}) {
  const einheit = einheitVonZiel(p.ziel, kontext.sorten);
  const lebensmittel = p.typ === 'lebensmittel' || p.typ === 'unbekannt';
  const menge = bestandMenge(p);
  const kosten = kostenGebucht(p);
  const voll = p.menge_pro_einheit !== null ? Math.round(p.bon.anzahl * p.menge_pro_einheit) : null;
  const sicherheit = p.zuordnung.kandidaten.find((k) => p.ziel.art === 'sorte' && k.sorte_id === p.ziel.sorte_id);
  const gewogen = p.bon.gewicht_g !== null || !Number.isInteger(p.bon.anzahl) || p.bon.anzahl > 12;
  const [mengeText_, setMengeText] = useState(String(menge));

  return (
    <Blatt titel={p.bon.text} untertitel={preisText(p)} onSchliessen={onSchliessen}>
      <pre className="bon-roh">{p.bon.zeilen.join('\n')}</pre>
      {p.hinweise.map((h) => <p key={h} className="hinweis-klein"><Icon name="info" groesse={16} /> {h}</p>)}
      {p.bon.rabatt_cent > 0 && (
        <p className="leise klein">Betrag {euro(p.bon.gesamtpreis_cent ?? 0)} − Rabatt {euro(p.bon.rabatt_cent)} = bezahlt {euro(endpreis(p.bon) ?? 0)}</p>
      )}

      {p.typ === 'pfand' && <p>Pfand ist eine eigene Geldposition und keine Lebensmittelkosten. Es kommt nichts in den Bestand.</p>}
      {p.typ === 'rabatt' && <p>Dieser Rabatt ließ sich keinem Artikel eindeutig zuordnen. Kombi verteilt ihn nicht – die Artikel behalten ihren gedruckten Preis.</p>}
      {p.typ === 'nicht_lebensmittel' && (
        <>
          <p>Kein Lebensmittel – kommt nicht in den Lebensmittelbestand.</p>
          <button type="button" className="knopf breit" onClick={() => onAendern(setzeTyp(entwurf, p.nr, 'lebensmittel', kontext))}>Doch ein Lebensmittel</button>
        </>
      )}

      {lebensmittel && (
        <>
          <section className="abschnitt">
            <h3>Produkt</h3>
            <p className="ziel-name">
              <strong>{p.ziel.art === 'keine' ? 'Nicht zugeordnet' : nameVonZiel(p.ziel, kontext.sorten, '')}</strong>
              {p.ziel.art === 'neu' && <span className="marke">neu</span>}
              {sicherheit && <small className="leise"> · {sicherheit.grund === 'gelernt' ? 'wie beim letzten Mal' : `Übereinstimmung ${Math.round(sicherheit.sicherheit * 100)} %`}</small>}
            </p>
            <SorteWahl sorten={kontext.sorten} aktuell={p.ziel.art === 'sorte' ? p.ziel.sorte_id : null} onWahl={(id) => onAendern(waehleSorte(entwurf, p.nr, id, kontext))} />
            {p.ziel.art === 'neu' ? (
              <NeuesProdukt daten={p.ziel.daten} onChange={(d) => onAendern(alsNeu(entwurf, p.nr, kontext, d))} />
            ) : (
              <button type="button" className="link" onClick={() => onAendern(alsNeu(entwurf, p.nr, kontext))}>Als neues Produkt anlegen</button>
            )}
            <button type="button" className="link" onClick={() => onAendern(setzeTyp(entwurf, p.nr, 'nicht_lebensmittel', kontext))}>Ist kein Lebensmittel</button>
          </section>

          {einheit && (
            <section className="abschnitt">
              <h3>In den Bestand</h3>
              <label className="feld feld-inline">
                <span>1 × laut Bon =</span>
                <input type="number" inputMode="decimal" min={0} step="any" value={p.menge_pro_einheit ?? ''}
                  onChange={(e) => onAendern(setzeMengeProEinheit(entwurf, p.nr, zahl(e.target.value)))} aria-label="Menge pro Stück laut Bon" />
                <span>{einheitKurz(einheit)}</span>
              </label>
              {gewogen || einheit === 'g' || einheit === 'ml' ? (
                <label className="feld feld-inline">
                  <span>In den Bestand:</span>
                  <input type="number" inputMode="numeric" min={0} value={mengeText_} disabled={p.menge_pro_einheit === null}
                    onChange={(e) => { setMengeText(e.target.value); onAendern(setzeBestandMenge(entwurf, p.nr, zahl(e.target.value))); }} aria-label="Menge im Bestand" />
                  <span>{einheitKurz(einheit)}{voll !== null ? ` von ${mengeText(voll, einheit)}` : ''}</span>
                </label>
              ) : null}
              {!gewogen && (
                <div className="chips">
                  {Array.from({ length: p.bon.anzahl + 1 }, (_, i) => i).map((n) => (
                    <button key={n} type="button" className={`chip${Math.abs(p.anzahl_uebernehmen - n) < 1e-9 ? ' gewaehlt' : ''}`}
                      onClick={() => { const e = setzeAnzahl(entwurf, p.nr, n); onAendern(e); setMengeText(String(bestandMenge(e.positionen.find((x) => x.nr === p.nr)!))); }}>
                      {n} von {p.bon.anzahl}
                    </button>
                  ))}
                </div>
              )}
              <p className="leise klein">
                In den Bestand: {mengeText(menge, einheit)} · Kosten: {kosten === null ? 'Preis unbekannt' : euro(Math.round(kosten))}
              </p>
              {voll !== null && menge < voll && (
                <GrundWahl wert={p.grund} onWahl={(g) => onAendern(setzeGrund(entwurf, p.nr, g))} />
              )}
              {voll !== null && menge < voll && p.grund && <p className="leise klein">{grundText(p.grund, p.grund_text)}</p>}
            </section>
          )}

          {menge > 0 && (
            <section className="abschnitt">
              <h3>Lagerung</h3>
              <div className="segment klein">
                <button type="button" className={p.lagerort === null ? 'gewaehlt' : ''} onClick={() => onAendern(setzeLagerung(entwurf, p.nr, null, p.ablauf_am))}>Wie die Sorte</button>
                {LAGERORTE.map((l) => (
                  <button key={l.id} type="button" className={p.lagerort === l.id ? 'gewaehlt' : ''}
                    onClick={() => onAendern(setzeLagerung(entwurf, p.nr, l.id as Lagerort, p.ablauf_am))}>{l.name}</button>
                ))}
              </div>
              <label className="feld feld-inline">
                <span>Haltbar bis <small>(optional, MHD)</small></span>
                <input type="date" value={p.ablauf_am ?? ''} onChange={(e) => onAendern(setzeLagerung(entwurf, p.nr, p.lagerort, e.target.value || null))} />
              </label>
            </section>
          )}
        </>
      )}

      <div className="abschnitt">
        <button type="button" className="knopf breit" onClick={onSchliessen}>Fertig</button>
      </div>
    </Blatt>
  );
}

// ───────── Fertig: Rückgängig und was sich jetzt produzieren ließe ─────────

function FertigAnsicht({ fertig, bestand, onRueckgaengig, onProduktion, onMeldung }: {
  fertig: Fertig; bestand: Sorte[]; onRueckgaengig: () => void; onProduktion: (e: ProduktionsEmpfehlung) => void; onMeldung: (text: string, fehler?: boolean) => void;
}) {
  const [empfehlungen, setEmpfehlungen] = useState<ProduktionsEmpfehlung[] | null>(null);
  const [erledigt, setErledigt] = useState<Set<number>>(new Set());

  useEffect(() => {
    let aktiv = true;
    void (async () => {
      try {
        const [produktionen, chargen] = await Promise.all([ladeProduktionen(), bonApi.ladeAktiveChargen()]);
        if (!aktiv) return;
        setEmpfehlungen(empfehlungenNachEinkauf({ sorten: bestand.map(produktSorte), chargen, produktionen: produktionen ?? [], neuGekauft: fertig.neuGekauft }));
      } catch {
        if (aktiv) setEmpfehlungen([]);
      }
    })();
    return () => {
      aktiv = false;
    };
  }, [bestand, fertig]);

  async function einkaufen(e: ProduktionsEmpfehlung) {
    if (!e.pruefung) return;
    try {
      const n = await aufEinkaufsliste(fehlendeAufEinkaufsliste(e.pruefung, e.name, bestand.map(produktSorte)));
      setErledigt((alt) => new Set(alt).add(e.block_typ_id));
      onMeldung(n === 1 ? '1 Zutat auf die Einkaufsliste gesetzt.' : `${n} Zutaten auf die Einkaufsliste gesetzt.`);
    } catch (err) {
      onMeldung(fehlerText(err), true);
    }
  }

  return (
    <>
      <div className="fertig-kopf">
        <span className="fertig-haken" aria-hidden="true"><Icon name="haken" groesse={34} /></span>
        <p className="fertig-titel">✅ Bestand aktualisiert</p>
        <p>{fertig.zusammenfassung}</p>
        <p className="leise klein">Wert der neuen Chargen: {fertig.wert}</p>
        <button type="button" className="link" onClick={onRueckgaengig}>Ganzen Import rückgängig machen</button>
      </div>

      <section className="gruppe">
        <h2 className="abschnitt-titel">🔥 Was könntest du jetzt produzieren?</h2>
        {empfehlungen === null && <p className="leise klein gruppe-leer">Schaue nach …</p>}
        {empfehlungen?.length === 0 && (
          <p className="leise klein gruppe-leer">Mit den neuen Einkäufen gerade nichts Bekanntes. Im Tab „Produktion“ findest du alle Ideen.</p>
        )}
        {empfehlungen?.map((e) => (
          <article key={e.block_typ_id} className="empfehlung">
            <p className="empfehlung-name">{e.art === 'komplettgericht' ? '🔵' : '🧩'} {e.name}</p>
            <p className="leise klein">
              {e.menge !== null ? mengeText(e.menge, e.einheit) : 'Menge offen'} ·{' '}
              {e.status === 'alles_da' ? 'Alle Zutaten vorhanden' : e.status === 'fehlt_etwas' ? `${e.pruefung?.fehlend.length ?? 0} Zutat(en) fehlen` : 'Mengen noch offen'}
            </p>
            <ul className="gruende">{e.gruende.map((g) => <li key={g}>{g}</li>)}</ul>
            <div className="knopf-reihe">
              <button type="button" className="knopf" onClick={() => onProduktion(e)}>Produktion planen</button>
              {e.status === 'fehlt_etwas' && !erledigt.has(e.block_typ_id) && (
                <button type="button" className="knopf" onClick={() => void einkaufen(e)}>Fehlendes auf die Einkaufsliste</button>
              )}
            </div>
          </article>
        ))}
        <p className="leise klein erklaerung">Nur Vorschläge – produziert wird erst, wenn du es bestätigst.</p>
      </section>
    </>
  );
}
