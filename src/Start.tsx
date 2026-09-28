import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Gericht, KomponentenVorschlag, Optionen } from '../supabase/functions/_shared/kombi/typen.ts';
import type { Einkaufsliste, PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { erzeugeKomponenten, erzeugeVorschlaege } from '../supabase/functions/_shared/kombi/engine.ts';
import { regelbasiert } from '../supabase/functions/_shared/kombi/anbieter/regelbasiert.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, type Sorte } from './api';
import { baueSnapshotAus } from './essenApi';
import { ausgabeEintragen, ausgabeEntfernen, naehrwerteGericht, type Haushaltsdaten } from './haushalt';
import { Bild, DEKO } from './Bild';
import { Box, MetaIcons, Verfuegbar, WarnIcon, WichtigKacheln } from './Karten';
import { Blatt } from './Blatt';
import { Icon } from './Icon';
import { euro, euroZuCent } from './format';
import { heuteWichtig, zustand } from './dashboard';
import {
  heuteGekocht, monatsbilanz, sinnvolleProduktion, startReihenfolge,
  type Monatsbilanz, type ProduktionsTipp, type StartAbschnitt,
} from './startseite';
import type { Bereich } from './navigation';

type Props = {
  bestand: Sorte[];
  heute: string;
  h: Haushaltsdaten;
  liste: Einkaufsliste;
  proPlan: Map<string, PlanStand[]>;
  /** „Auftauen“ (fertig gerendert, kann leer sein) und ob heute etwas fällig ist */
  auftauen: ReactNode;
  auftauFaellig: number;
  /** lokal nach Kombi-Regeln berechnet (null = wird berechnet) */
  ideen: LokaleIdeen | null;
  onKochen: (g: Gericht, planId: string | null) => void;
  onOeffnen: (s: Sorte) => void;
  onBereich: (b: Bereich) => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

const START_OPTIONEN: Optionen = { personen: 2, max_minuten: 15, guenstig: true };

/** Dieselben Vorlieben wie unter „Essen“ (Personen, Zeit, günstig) */
function optionenAusEssen(): Optionen {
  try {
    const d = JSON.parse(localStorage.getItem('kombi-essen') ?? '{}');
    return { ...START_OPTIONEN, ...(d.optionen ?? {}) };
  } catch {
    return START_OPTIONEN;
  }
}

/**
 * Ein Vorschlag aus dem freien Vorrat – lokal nach Kombi-Regeln, ohne KI-Aufruf: schnell,
 * nachvollziehbar und ohne erfundene Werte. Weitere Ideen (auch von der KI) gibt es unter „Essen“.
 */
export type LokaleIdeen = { gerichte: Gericht[]; komponenten: KomponentenVorschlag[] };

export function useLokaleIdeen(bestand: Sorte[] | null, reserviert: Map<number, number>) {
  const [ideen, setIdeen] = useState<LokaleIdeen | null>(null);
  useEffect(() => {
    if (!bestand) return;
    let aktiv = true;
    const snapshot = restSnapshot(baueSnapshotAus(bestand, ''), reserviert);
    const basis = { snapshot, optionen: optionenAusEssen(), gesehen: [], favoriten: [], feedback: [], modus: { art: 'normal' as const } };
    Promise.all([
      erzeugeVorschlaege(regelbasiert(), { ...basis, anzahl: 3 }),
      erzeugeKomponenten(regelbasiert(), { ...basis, anzahl: 6, aufgabe: 'komponenten' }),
    ]).then(([g, k]) => {
      if (aktiv) setIdeen({ gerichte: g.gerichte, komponenten: k.komponenten });
    }).catch(() => {
      if (aktiv) setIdeen({ gerichte: [], komponenten: [] });
    });
    return () => {
      aktiv = false;
    };
  }, [bestand, reserviert]);
  return ideen;
}

/** Die Startseite: Geld, was heute wichtig ist, was es zu essen gibt, Produktion und Einkauf. */
export function Start({ bestand, heute, h, liste, proPlan, auftauen, auftauFaellig, ideen, onKochen, onOeffnen, onBereich, onMeldung, onGeaendert }: Props) {
  const [geldOffen, setGeldOffen] = useState(false);

  const wichtig = heuteWichtig(bestand, heute);
  const bilanz = monatsbilanz(h, heute);
  const gekocht = heuteGekocht(h.mahlzeiten, heute);

  // Vorschläge: Geplantes für heute zuerst, dann Ideen aus dem freien Vorrat (ohne heute schon Gekochtes)
  const geplant = h.plaene
    .filter((p) => p.art === 'mahlzeit' && p.daten.gericht && p.datum !== null && p.datum <= heute)
    .sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? ''))
    .map((p) => ({ g: p.daten.gericht!, planId: p.id as string | null }));
  const vorschlaege = [
    ...geplant,
    ...(ideen?.gerichte ?? []).filter((g) => !gekocht.titel.includes(g.name)).map((g) => ({ g, planId: null })),
  ].slice(0, 4);

  const vorgemerkt = h.plaene.filter((p) => p.art === 'komponente').map((p) => {
    const stand = proPlan.get(p.id) ?? [];
    return { plan_id: p.id, titel: p.titel, portionen: p.portionen, alles_da: stand.every((x) => x.fehlt === 0) };
  });
  const tipp: ProduktionsTipp | null = sinnvolleProduktion(vorgemerkt, ideen?.komponenten ?? []);
  const offen = liste.zeilen.filter((z) => z.status === 'offen');

  const folge = startReihenfolge({
    wichtig: wichtig.length + auftauFaellig,
    produktion: tipp !== null,
    einkauf: h.planung && offen.length > 0,
    // ohne Protokoll (Migration „kosten_naehrwerte“) gibt es Ausgaben nur aus der Einkaufsliste
    geld: h.planung && (h.protokoll || bilanz.ausgegeben.anzahl > 0),
  });

  if (bestand.length === 0) {
    return (
      <div className="leer-zustand">
        <Icon name="haus" groesse={40} />
        <p>Willkommen bei Kombi. Leg unter <strong>Vorrat</strong> die erste Sorte an – dann gibt es hier Vorschläge, Hinweise und Kosten.</p>
        <button type="button" className="knopf" onClick={() => onBereich('vorrat')}>Zum Vorrat</button>
      </div>
    );
  }

  const produktionBox = tipp && (
    <Box titel="Produktion" icon="topf">
      <div className="mini-tipp">
        <Bild name={tipp.art === 'vorgemerkt' ? tipp.titel : tipp.komponente.name} farbe={tipp.art === 'idee' ? tipp.komponente.rolle : null} art="kachel" />
        <div>
          <strong>{tipp.art === 'vorgemerkt' ? tipp.titel : tipp.komponente.name}</strong>
          <small>Heute sinnvoll · {tipp.art === 'vorgemerkt' ? tipp.portionen : tipp.komponente.portionen} Portionen</small>
          <small className="status-kritisch">{tipp.art === 'vorgemerkt' ? 'Vorgemerkt · alles da' : produktionsGrund(tipp, bestand, heute)}</small>
        </div>
      </div>
      <button type="button" className="knopf weich gross-schrift" onClick={() => onBereich('produktion')}>
        Ansehen <Icon name="pfeil" groesse={16} />
      </button>
    </Box>
  );

  const einkaufBox = h.planung && offen.length > 0 && (
    <Box titel="Einkauf" icon="wagen">
      <div className="einkauf-kurz">
        <strong>{offen.length} {offen.length === 1 ? 'Ding fehlt' : 'Dinge fehlen'}</strong>
        <span>{einkaufKosten(liste.kosten).split(' · ')[0]}</span>
        {liste.kosten.status === 'teilweise' && <small>Preis teilweise bekannt</small>}
      </div>
      <div className="bilder-reihe">
        {offen.slice(0, 4).map((z) => <Bild key={z.schluessel + z.einheit_schluessel} name={z.name} farbe={z.kategorie === 'sonstiges' ? null : z.kategorie} art="klein" />)}
      </div>
      <button type="button" className="knopf weich-gruen gross-schrift" onClick={() => onBereich('einkauf')}>
        Einkaufen <Icon name="pfeil" groesse={16} />
      </button>
    </Box>
  );

  const teile: Record<StartAbschnitt, () => ReactNode> = {
    geld: () => <GeldKarte key="geld" b={bilanz} h={h} onOeffnen={() => setGeldOffen(true)} />,
    wichtig: () => (
      <div key="wichtig">
        {wichtig.length > 0 && (
          <Box titel="Heute wichtig" kopfIcon={<WarnIcon />} link={{ text: 'Alle anzeigen', onClick: () => onBereich('vorrat'), grau: true }}>
            <WichtigKacheln wichtig={wichtig.slice(0, 8)} onOeffnen={onOeffnen} />
          </Box>
        )}
        {auftauen}
      </div>
    ),
    essen: () => (
      <div key="essen" className="abschnitt">
        {vorschlaege.length > 0 ? (
          <Karussell>
            {vorschlaege.map((v) => (
              <GerichtFotoKarte key={v.g.id} g={v.g} geplant={v.planId !== null} bestand={bestand}
                onKochen={() => onKochen(v.g, v.planId)} onMehr={() => onBereich('essen')} />
            ))}
          </Karussell>
        ) : (
          <Box titel="Was möchtest du essen?" icon="essen">
            <p className="leise">{ideen === null ? 'Kombi schaut in den Vorrat …' : 'Aus dem freien Vorrat lässt sich gerade kein ganzes Gericht kochen.'}</p>
            {ideen !== null && <button type="button" className="knopf breit abstand-oben" onClick={() => onBereich('essen')}>Ideen mit Einkauf ansehen</button>}
          </Box>
        )}
        <div className="karussell-fuss">
          <p className="heute-gekocht">
            {gekocht.titel.length > 0 && <>Heute gekocht: {gekocht.titel.join(', ')}{gekocht.kcal !== null && ` · ${gekocht.kcal.toLocaleString('de-DE')} kcal`}</>}
          </p>
          {vorschlaege.length > 0 && <button type="button" className="mehr-link" onClick={() => onBereich('essen')}>Andere Vorschläge <Icon name="pfeil" groesse={16} /></button>}
        </div>
      </div>
    ),
    // Produktion und Einkauf stehen nebeneinander – gerendert beim Einkauf (oder allein, wenn es keinen gibt)
    produktion: () => (folge.includes('einkauf') ? null : <div key="produktion" className="zwei">{produktionBox}</div>),
    einkauf: () => <div key="einkauf" className="zwei">{folge.includes('produktion') && produktionBox}{einkaufBox}</div>,
  };

  return (
    <>
      {folge.map((a) => teile[a]())}
      {geldOffen && <GeldBlatt b={bilanz} h={h} heute={heute} onMeldung={onMeldung} onGeaendert={onGeaendert} onSchliessen={() => setGeldOffen(false)} />}
    </>
  );
}

/** „Tomaten laufen bald ab“ – der dringendste Grund aus dem Vorrat, sonst was verwertet wird */
function produktionsGrund(t: Extract<ProduktionsTipp, { art: 'idee' }>, bestand: Sorte[], heute: string): string {
  for (const name of t.komponente.verwertet) {
    const s = bestand.find((b) => b.name === name);
    const z = s ? zustand(s, heute) : null;
    if (s && z && z.art !== 'niedrig') return `${s.name}: ${z.art === 'bald' ? z.text : z.titel.toLocaleLowerCase('de-DE')}`;
  }
  return t.grund;
}

/** Wischbare Vorschläge mit Punkten darunter */
function Karussell({ children }: { children: ReactNode[] }) {
  const [aktiv, setAktiv] = useState(0);
  return (
    <>
      <div className="karussell" onScroll={(e) => {
        const el = e.currentTarget;
        setAktiv(Math.round(el.scrollLeft / Math.max(1, el.clientWidth - 28)));
      }}>
        {children}
      </div>
      {children.length > 1 && (
        <div className="punkte" aria-hidden="true">{children.map((_, i) => <span key={i} className={i === aktiv ? 'an' : ''} />)}</div>
      )}
    </>
  );
}

function GerichtFotoKarte({ g, geplant, bestand, onKochen, onMehr }: {
  g: Gericht; geplant: boolean; bestand: Sorte[]; onKochen: () => void; onMehr: () => void;
}) {
  const farbe = g.zutaten.find((z) => z.quelle !== 'grundausstattung' && z.farbe)?.farbe ?? null;
  return (
    <article className="foto-karte">
      <div className="foto-karte-bild"><Bild name={g.name} emoji={g.emoji} farbe={farbe} art="flaeche" /></div>
      <div className="foto-karte-inhalt">
        <p className="ueber">{geplant ? 'Heute geplant' : 'Was möchtest du essen?'}</p>
        <h3>{g.name}</h3>
        <MetaIcons g={g} n={naehrwerteGericht(g, bestand)} />
        <Verfuegbar g={g} />
        <button type="button" className="knopf pillen-knopf gross-schrift" onClick={onKochen}>
          Kochen <Icon name="pfeil" groesse={16} />
        </button>
        <button type="button" className="vor-knopf icon-knopf klein" onClick={onMehr} aria-label="Andere Vorschläge"><Icon name="pfeil" groesse={16} /></button>
      </div>
    </article>
  );
}

/** Geld diesen Monat – wie im Entwurf, aber ehrlich: die Summe ist nur echtes Geld (Einkäufe + Sonstiges). */
function GeldKarte({ b, h, onOeffnen }: { b: Monatsbilanz; h: Haushaltsdaten; onOeffnen: () => void }) {
  const bezug = Math.max(b.gesamt_cent, b.vormonat?.cent ?? 0, 1);
  const anteil = (c: number) => `${Math.max(0, (c / bezug) * 100)}%`;
  return (
    <button type="button" className="geld-held" onClick={onOeffnen} aria-label={`Diesen Monat ${euro(b.gesamt_cent)} ausgegeben – Details`}>
      <img src={DEKO.heldTomaten} alt="" aria-hidden="true" />
      <p className="geld-titel">Diesen Monat</p>
      <div className="geld-summe">
        <span className="geld-zahl">{euro(b.gesamt_cent)}</span>
        {b.vormonat && (
          <span className="trend">
            <span className={`trend-chip ${b.vormonat.aenderung_prozent <= 0 ? 'runter' : 'hoch'}`}>
              {b.vormonat.aenderung_prozent <= 0 ? '↓' : '↑'} {Math.abs(b.vormonat.aenderung_prozent)} %
            </span>
            <small>im Vergleich zum Vormonat</small>
          </span>
        )}
      </div>
      <div className="geld-mitte">
        <div className="teilbalken" aria-hidden="true">
          {b.ausgegeben.cent > 0 && <span style={{ width: anteil(b.ausgegeben.cent), background: 'var(--ok)' }} />}
          {b.sonstiges.cent > 0 && <span style={{ width: anteil(b.sonstiges.cent), background: 'var(--gelb)' }} />}
          {b.gesamt_cent < bezug && <span className="leer" />}
        </div>
        {b.gekocht.pro_mahlzeit_cent !== null && (
          <span className="geld-schnitt">
            <Icon name="essen" groesse={22} />
            <span><strong>Ø {euro(b.gekocht.pro_mahlzeit_cent)}</strong><small>pro Mahlzeit</small></span>
          </span>
        )}
      </div>
      <div className="geld-spalten">
        <span className="geld-spalte">
          <span><Icon name="wagen" groesse={16} className="status-ok" /> Einkäufe</span>
          <strong>{euro(b.ausgegeben.cent)}</strong>
        </span>
        <span className="geld-spalte">
          <span><Icon name="topf" groesse={16} className="status-achtung" /> Produktion</span>
          <strong>{b.produktion.anzahl ? `${b.produktion.vollstaendig ? '' : 'ab '}${euro(b.produktion.cent)}` : '–'}</strong>
          <small>Warenwert</small>
        </span>
        <span className="geld-spalte">
          <span><Icon name="sonstiges" groesse={16} /> Sonstiges</span>
          <strong>{h.ausgaben ? euro(b.sonstiges.cent) : '–'}</strong>
        </span>
      </div>
      {b.leer && <p className="geld-leer">Noch nichts erfasst. Beim Einbuchen den bezahlten Betrag angeben – dann steht er hier.</p>}
    </button>
  );
}

/** Geld im Detail: was zählt, was nicht – und sonstige Ausgaben eintragen oder entfernen. */
function GeldBlatt({ b, h, heute, onMeldung, onGeaendert, onSchliessen }: {
  b: Monatsbilanz; h: Haushaltsdaten; heute: string;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void; onGeaendert: () => void; onSchliessen: () => void;
}) {
  const [betrag, setBetrag] = useState('');
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const diesen = h.sonstige.filter((a) => !a.entfernt && a.datum.slice(0, 7) === heute.slice(0, 7));

  async function hinzufuegen(e: FormEvent) {
    e.preventDefault();
    const cent = euroZuCent(betrag);
    if (cent === null || Number.isNaN(cent) || cent <= 0) return setFehler('Bitte einen Betrag wie 6,20 eingeben.');
    setFehler(null);
    setLaeuft(true);
    try {
      await ausgabeEintragen(cent, notiz || null);
      setBetrag('');
      setNotiz('');
      onMeldung(`${euroText(cent)} unter „Sonstiges“ eingetragen.`);
      onGeaendert();
    } catch (err) {
      setFehler(fehlerText(err));
    } finally {
      setLaeuft(false);
    }
  }

  async function entfernen(id: number, text: string) {
    try {
      await ausgabeEntfernen(id, true);
      onMeldung(`${text} entfernt.`, () => ausgabeEntfernen(id, false));
      onGeaendert();
    } catch (err) {
      onMeldung(fehlerText(err));
    }
  }

  const zeile = (titel: string, meta: string | null, wert: string) => (
    <li><div className="zeile"><span className="zeile-haupt"><span className="zeile-titel">{titel}</span>{meta && <span className="zeile-meta">{meta}</span>}</span><span className="zeile-wert"><strong>{wert}</strong></span></div></li>
  );

  return (
    <Blatt titel={`Geld im ${b.monat}`} untertitel="Nur echte Beträge – Kombi schätzt nichts." onSchliessen={onSchliessen}>
      <h3 className="unterkopf">Ausgegeben</h3>
      <ul className="liste">
        {zeile('Einkäufe', `${b.ausgegeben.anzahl} ${b.ausgegeben.anzahl === 1 ? 'Einkauf' : 'Einkäufe'}${b.ausgegeben.ohne_preis ? ` · ${b.ausgegeben.ohne_preis} ohne Preis` : ''}`, euro(b.ausgegeben.cent))}
        {zeile('Sonstiges', h.ausgaben ? `${b.sonstiges.anzahl} ${b.sonstiges.anzahl === 1 ? 'Eintrag' : 'Einträge'}` : 'Migration „ausgaben“ fehlt noch', h.ausgaben ? euro(b.sonstiges.cent) : '–')}
        {zeile('Zusammen', b.vormonat ? `Vormonat bis zum ${b.vormonat.bis_tag}.: ${euro(b.vormonat.cent)}` : null, euro(b.gesamt_cent))}
      </ul>

      <h3 className="unterkopf">Warenwert – schon in den Einkäufen enthalten</h3>
      <ul className="liste">
        {zeile('Gekocht', `${b.gekocht.anzahl} ${b.gekocht.anzahl === 1 ? 'Mahlzeit' : 'Mahlzeiten'}`, b.gekocht.anzahl ? `${b.gekocht.vollstaendig ? '' : 'ab '}${euro(b.gekocht.cent)}` : '–')}
        {b.gekocht.pro_mahlzeit_cent !== null && zeile('Ø pro Mahlzeit', null, euro(b.gekocht.pro_mahlzeit_cent))}
        {zeile('Produktion', `${b.produktion.anzahl}× hergestellt`, b.produktion.anzahl ? `${b.produktion.vollstaendig ? '' : 'ab '}${euro(b.produktion.cent)}` : '–')}
      </ul>
      <p className="abschnitt-fuss">Gekocht und Produktion zeigen, was die verbrauchten Zutaten wert waren. Das Geld dafür ist schon bei den Einkäufen gezählt – es wird nie doppelt addiert.</p>

      {h.ausgaben && (
        <>
          <h3 className="unterkopf">Sonstiges im {b.monat}</h3>
          {diesen.length > 0 && (
            <ul className="liste">
              {diesen.map((a) => (
                <li key={a.id}>
                  <div className="zeile">
                    <span className="zeile-haupt">
                      <span className="zeile-titel">{a.notiz || 'Sonstiges'}</span>
                      <span className="zeile-meta">{new Date(`${a.datum}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}</span>
                    </span>
                    <span className="zeile-wert"><strong>{euro(a.betrag_cent)}</strong></span>
                    <button type="button" className="icon-knopf klein" aria-label={`${a.notiz || 'Ausgabe'} entfernen`} onClick={() => void entfernen(a.id!, a.notiz || 'Ausgabe')}>
                      <Icon name="muell" groesse={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form className="ausgabe-form abstand-oben" onSubmit={hinzufuegen}>
            <input type="text" inputMode="decimal" placeholder="0,00 €" value={betrag} onChange={(e) => setBetrag(e.target.value)} aria-label="Betrag in Euro" />
            <input type="text" placeholder="Wofür? z. B. Kantine" maxLength={80} value={notiz} onChange={(e) => setNotiz(e.target.value)} aria-label="Wofür" />
            <button type="submit" className="knopf pillen-knopf" disabled={laeuft || !betrag.trim()} aria-label="Ausgabe hinzufügen"><Icon name="plus" groesse={18} /></button>
          </form>
          {fehler && <p className="fehlertext">{fehler}</p>}
          <p className="abschnitt-fuss">Für Ausgaben ohne Bezug zum Vorrat – z. B. Kantine, Bäcker, bestellt. Entfernen lässt sich rückgängig machen.</p>
        </>
      )}
    </Blatt>
  );
}

/** „≈ 12,40 €“ nur aus bekannten Preisen, sonst ehrlich „Preis teilweise bekannt“ */
export function einkaufKosten(k: Einkaufsliste['kosten']): string {
  if (k.status === 'leer' || k.status === 'unbekannt' || k.bekannt_cent === null) return 'Preis unbekannt';
  if (k.status === 'teilweise') return `ab ${euroText(k.bekannt_cent)} · Preis teilweise bekannt`;
  return `ca. ${euroText(k.bekannt_cent)}`;
}
