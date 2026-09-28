import { useState } from 'react';
import type { EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import { findeSorte, type PlanStand, type VorratSorte } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { bereiteProduktionVor, komponenteAlsSorte, type ProduktionsZeile } from '../supabase/functions/_shared/kombi/komponenten.ts';
import { GERICHT_EMOJI, GERICHT_NAME, ROLLEN } from '../supabase/functions/_shared/kombi/rollen.ts';
import { batchEmpfehlungen, type BatchSorte, type NutzungZeile } from '../supabase/functions/_shared/kombi/batch.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, ladeBestand, speichereSorte, type Sorte, type SorteDaten } from './api';
import { baueSnapshotAus, holeKomponenten, type Quelle } from './essenApi';
import {
  eintragHinzufuegen, entfernePlan, herstellen, kochenRueckgaengig, planeKomponente, produzieren, produzierenRueckgaengig, type Plan,
} from './haushalt';
import { Blatt } from './Blatt';
import { PostenListe } from './PostenListe';
import { Icon } from './Icon';
import { lagerort } from './farben';
import { artVon, einheitVon, euroKurz, heuteIso, kcalKurz, mengeText, portionMengeVon, portionenVon } from './format';
import { plusTageIso, zustand } from './dashboard';
import { Bild } from './Bild';
import { Box } from './Karten';

type Props = {
  bestand: Sorte[];
  sorten: VorratSorte[];
  planung: boolean;
  protokoll: boolean;
  plaene: Plan[];
  proPlan: Map<string, PlanStand[]>;
  nutzung: NutzungZeile[];
  reserviert: Map<number, number>;
  /** lokal nach Kombi-Regeln berechnete Ideen (null = wird berechnet) */
  ideen: KomponentenVorschlag[] | null;
  heute: string;
  onOeffnen: (s: Sorte) => void;
  /** zur Wochenplanung (Essen → Woche) */
  onWoche: () => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

const alsBatchSorte = (s: Sorte): BatchSorte => ({
  id: s.id, name: s.name, art: artVon(s), herkunft: s.herkunft ?? null, einheit: einheitVon(s), haltbar_tage: s.haltbar_tage, lagerort: s.lagerort ?? 'gefrierfach',
});

export function Sterne({ n }: { n: number }) {
  return (
    <span className="sterne" aria-label={`Nutzbarkeit ${n} von 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? 'an' : ''} aria-hidden="true">★</span>)}
    </span>
  );
}

const fehltNamen = (k: KomponentenVorschlag) => [...new Set(k.zutaten.filter((z) => z.quelle === 'einkauf').map((z) => z.name))];

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „Linsen-Bolognese läuft bald ab (noch 2 Tage)“ – der dringendste verwertete Vorrat, sonst was verwertet wird */
function dringendsterGrund(k: KomponentenVorschlag, bestand: Sorte[], heute: string): { text: string; klein: string | null } {
  for (const name of k.verwertet) {
    const s = bestand.find((b) => b.name === name);
    const z = s ? zustand(s, heute) : null;
    if (s && z && z.art !== 'niedrig') {
      return z.art === 'bald'
        ? { text: `Läuft bald ab: ${s.name}`, klein: `(${z.text})` }
        : { text: `${s.name}: ${z.titel.toLocaleLowerCase('de-DE')}`, klein: z.text };
    }
  }
  return { text: `Verwertet ${k.verwertet.slice(0, 2).join(' und ')}`, klein: null };
}

/** Was soll hergestellt werden – und wohin kommt es? */
type Auftrag = { k: KomponentenVorschlag; planId: string | null };

/**
 * Produktion: Komponenten vorkochen und einlagern. Oben steht nur, was JETZT sinnvoll ist –
 * Vorgemerktes mit allem da, sonst eine Idee, die Dringendes verwertet. Alles Weitere darunter.
 */
export function Produktion({ bestand, sorten, planung, protokoll, plaene, proPlan, nutzung, reserviert, ideen, heute, onOeffnen, onWoche, onMeldung, onGeaendert }: Props) {
  const [kiIdeen, setKiIdeen] = useState<KomponentenVorschlag[] | null>(null);
  const [quelle, setQuelle] = useState<{ art: Quelle; anbieter: string; hinweis: string | null } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<KomponentenVorschlag | null>(null);
  const [auftrag, setAuftrag] = useState<Auftrag | null>(null);

  if (!planung) {
    return (
      <div className="leer-zustand">
        <Icon name="topf" groesse={40} />
        <p>Für die Produktion fehlt in Supabase noch die Migration „planung_einkauf“ (siehe README).</p>
      </div>
    );
  }

  const vorgemerkt = plaene.filter((p) => p.art === 'komponente' && p.daten.komponente);
  const fehltImPlan = (p: Plan) => (proPlan.get(p.id) ?? []).filter((x) => x.fehlt === null || x.fehlt > 0);
  const bereit = vorgemerkt.find((p) => fehltImPlan(p).length === 0) ?? null;
  const vorschlaege = kiIdeen ?? ideen ?? [];
  const jetzt: Auftrag | null = bereit
    ? { k: bereit.daten.komponente!, planId: bereit.id }
    : (() => {
        const k = (ideen ?? []).find((x) => x.typ === 'verwerten' && x.verwertet.length > 0);
        return k ? { k, planId: null } : null;
      })();
  const empfohlen = vorschlaege.filter((k) => k.id !== jetzt?.k.id);
  const komponenten = bestand
    .filter((s) => artVon(s) === 'komponente')
    .sort((a, b) => Number(b.anzahl > 0) - Number(a.anzahl > 0) || a.name.localeCompare(b.name, 'de'));
  const batch = batchEmpfehlungen(bestand.map(alsBatchSorte), nutzung);

  async function mitKi() {
    setLaedt(true);
    setFehler(null);
    try {
      // nur der freie Vorrat: Geplantes wird nicht noch einmal verplant
      const snapshot = restSnapshot(baueSnapshotAus(await ladeBestand(), ''), reserviert);
      const a = await holeKomponenten({
        snapshot, optionen: { personen: 2, max_minuten: null, guenstig: true }, gesehen: [], feedback: [],
        modus: { art: 'normal' }, anzahl: 6, aufgabe: 'komponenten',
      });
      setKiIdeen(a.ergebnis.komponenten);
      setQuelle({ art: a.quelle, anbieter: a.ergebnis.anbieter, hinweis: a.hinweis ?? a.ergebnis.hinweis });
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaedt(false);
    }
  }

  const warnung = jetzt && !jetzt.planId ? dringendsterGrund(jetzt.k, bestand, heute) : null;
  const weitereVorgemerkt = vorgemerkt.filter((p) => p.id !== jetzt?.planId);
  const tage = Array.from({ length: 7 }, (_, i) => plusTageIso(heute, i));
  const flexibel = plaene.filter((p) => p.datum === null).length;

  const empfKarte = (k: KomponentenVorschlag) => {
    const fehlt = fehltNamen(k);
    return (
      <button key={k.id} type="button" className="empfohlen-karte" onClick={() => setOffen(k)}>
        <span className="empf-bild"><Bild name={k.name} farbe={k.rolle} art="flaeche" /></span>
        <span className="empf-text">
          <strong>{k.name} <Icon name="pfeil" groesse={16} /></strong>
          <span className="meta-icons">
            <span><Icon name="personen" groesse={15} /> {k.portionen} Portionen</span>
            <span><Icon name="uhr" groesse={15} /> {k.zeit_min} Min</span>
          </span>
          {fehlt.length
            ? <span className="marke warm"><Icon name="wagen" groesse={14} /> <span>{fehlt.length === 1 ? `fehlt: ${fehlt[0]}` : `${fehlt.length} fehlen`}</span></span>
            : <span className="marke"><Icon name="blatt" groesse={14} /> <span>Aus dem Vorrat</span></span>}
        </span>
      </button>
    );
  };

  return (
    <div className="produktion">
      {jetzt ? (
        <Box titel="Jetzt sinnvoll" icon="funken">
          <article className="foto-karte getoent">
            <div className="foto-karte-bild"><Bild name={jetzt.k.name} farbe={jetzt.k.rolle} art="flaeche" /></div>
            <div className="foto-karte-inhalt">
              <h3>{jetzt.k.name}</h3>
              <p className="meta-icons">
                <span><Icon name="personen" groesse={17} /> {jetzt.k.portionen} Portionen</span>
                <span><Icon name="uhr" groesse={17} /> {jetzt.k.zeit_min} Min</span>
              </p>
              {warnung ? (
                <p className="warnzeile"><span className="warn-punkt" aria-hidden="true">!</span><span>{warnung.text}{warnung.klein && <small>{warnung.klein}</small>}</span></p>
              ) : (
                <p className="verfuegbar status-ok"><span className="kreis-haken"><Icon name="haken" groesse={13} /></span> Vorgemerkt · alles da</p>
              )}
              <button type="button" className="knopf pillen-knopf" onClick={() => setAuftrag(jetzt)}>
                <Icon name="topf" groesse={20} /> Produktion starten <Icon name="weiter" groesse={18} />
              </button>
              <button type="button" className="link" onClick={() => setOffen(jetzt.k)}>Details</button>
            </div>
          </article>
        </Box>
      ) : (
        <p className="hinweisbox">Gerade muss nichts produziert werden. Unten gibt es Ideen, falls du trotzdem vorkochen möchtest.</p>
      )}

      <Box titel="Empfohlen" icon="birne" link={{ text: laedt ? 'Sucht …' : 'Neue Ideen', onClick: () => void mitKi() }}>
        {fehler && <p className="fehlerbox">{fehler}</p>}
        {ideen === null && !kiIdeen ? (
          <p className="leise">Kombi rechnet …</p>
        ) : empfohlen.length === 0 ? (
          <p className="leise">{quelle?.hinweis ?? 'Gerade keine weitere sinnvolle Komponente.'}</p>
        ) : (
          <div className="empfohlen">{empfohlen.map(empfKarte)}</div>
        )}
        <p className="abschnitt-fuss">
          {quelle?.art === 'ki'
            ? `Ideen von der KI (${quelle.anbieter}) – Mengen, Kosten und Nutzbarkeit rechnet Kombi selbst.`
            : 'Aus deinem Vorrat nach Kombi-Regeln. „Neue Ideen“ fragt die KI. Gespeichert wird nichts ohne Bestätigung.'}
        </p>
      </Box>

      {weitereVorgemerkt.length > 0 && (
        <Box titel="Vorgemerkt" icon="baustein">
          <ul className="liste mit-bild">
            {weitereVorgemerkt.map((p) => {
              const fehlt = fehltImPlan(p);
              return (
                <li key={p.id}>
                  <button type="button" className="zeile" onClick={() => setAuftrag({ k: p.daten.komponente!, planId: p.id })}>
                    <Bild name={p.titel} farbe={p.daten.komponente!.rolle} art="klein" />
                    <span className="zeile-haupt">
                      <span className="zeile-titel">{p.titel}</span>
                      <span className="zeile-meta">
                        {p.portionen} Portionen · {fehlt.length
                          ? <span className="status-achtung">fehlt: {fehlt.map((x) => x.name).slice(0, 2).join(', ')}</span>
                          : <span className="status-ok">alles da</span>}
                      </span>
                    </span>
                    <Icon name="pfeil" groesse={16} className="zeile-pfeil" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Box>
      )}

      <Box titel="Geplant" icon="kalender" link={{ text: 'Diese Woche', onClick: onWoche, grau: true }}>
        <div className="woche-streifen">
          {tage.map((t, i) => {
            const n = plaene.filter((p) => p.datum === t).length;
            return (
              <button key={t} type="button" className={`tag${i === 0 ? ' heute' : ''}`} onClick={onWoche} aria-label={`${i === 0 ? 'Heute' : t}: ${n} geplant`}>
                <strong>{i === 0 ? 'Heute' : WOCHENTAGE[new Date(`${t}T12:00:00Z`).getUTCDay()]}</strong>
                <small className={n ? 'voll' : ''}>{n}</small>
              </button>
            );
          })}
        </div>
        <p className="abschnitt-fuss">
          {plaene.filter((p) => p.datum !== null && p.datum >= tage[0] && p.datum <= tage[6]).length} geplant in den nächsten 7 Tagen{flexibel > 0 ? ` · ${flexibel} flexibel ohne Tag` : ''}
        </p>
      </Box>

      {komponenten.length > 0 && (
        <Box titel="Deine Komponenten" icon="vorrat">
          <ul className="liste mit-bild">
            {komponenten.map((s) => (
              <li key={s.id}>
                <button type="button" className={`zeile${s.anzahl === 0 ? ' leer' : ''}`} onClick={() => onOeffnen(s)}>
                  <Bild name={s.name} farbe={s.farbe} art="klein" />
                  <span className="zeile-haupt">
                    <span className="zeile-titel">{s.name}</span>
                    <span className="zeile-meta">{ROLLEN[s.farbe].name} · {lagerort(s.lagerort).name}</span>
                  </span>
                  <span className="zeile-wert"><strong>{portionenVon(s)}</strong> {portionenVon(s) === 1 ? 'Portion' : 'Port.'}</span>
                </button>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {batch.length > 0 && (
        <Box titel="Größer vorkochen" icon="aehnlich">
          <ul className="liste">
            {batch.map((b) => (
              <li key={b.block_typ_id}>
                <div className="zeile">
                  <span className="zeile-haupt">
                    <span className="zeile-titel">{b.name}</span>
                    <span className="zeile-meta">Nächstes Mal {mengeText(b.neu, b.einheit)} statt {mengeText(b.bisher, b.einheit)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Box>
      )}

      {offen && (
        <KomponenteBlatt
          k={offen}
          bestand={bestand}
          planung={planung}
          onStarten={() => {
            setAuftrag({ k: offen, planId: null });
            setOffen(null);
          }}
          onVormerken={async () => {
            try {
              const ziel = findeSorte({ name: offen.name, block_typ_id: null }, sorten)?.id ?? null;
              await planeKomponente(offen, ziel);
              const fehlt = fehltNamen(offen);
              onMeldung(fehlt.length ? `${offen.name} vorgemerkt – Fehlendes steht auf der Einkaufsliste.` : `${offen.name} vorgemerkt.`);
              setOffen(null);
              onGeaendert();
            } catch (e) {
              onMeldung(fehlerText(e));
            }
          }}
          onSchliessen={() => setOffen(null)}
        />
      )}

      {auftrag && (
        <ProduktionBlatt
          auftrag={auftrag}
          plan={plaene.find((p) => p.id === auftrag.planId) ?? null}
          bestand={bestand}
          sorten={sorten}
          protokoll={protokoll}
          onMeldung={onMeldung}
          onGeaendert={onGeaendert}
          onFertig={(text, rueck) => {
            setAuftrag(null);
            onMeldung(text, rueck);
            onGeaendert();
          }}
          onSchliessen={() => setAuftrag(null)}
        />
      )}
    </div>
  );
}

/** Eine Komponenten-Idee im Detail. Ändert nichts – erst „Produktion starten“ oder „Vormerken“. */
function KomponenteBlatt({ k, bestand, planung, onStarten, onVormerken, onSchliessen }: {
  k: KomponentenVorschlag; bestand: Sorte[]; planung: boolean;
  onStarten: () => void; onVormerken: () => Promise<void>; onSchliessen: () => void;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const zutaten = k.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const grund = k.zutaten.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name);
  const partner = k.partner.map((n) => bestand.find((s) => s.name === n)).filter((s): s is Sorte => !!s);
  const fehlt = fehltNamen(k);

  return (
    <Blatt titel={k.name} untertitel={`${ROLLEN[k.rolle].name} · ${k.portionen} Portionen · ${lagerort(k.lagerort).name}`} onSchliessen={onSchliessen}>
      {k.beschreibung && <p className="vorschlag-text">{k.beschreibung}</p>}
      <p className="meta abstand-oben">
        <span>{k.zeit_min} Min</span><span>{euroKurz(k.kosten)} / Portion</span><span>{kcalKurz(k.naehrwerte)} / Portion</span>
      </p>

      <section className="abschnitt">
        <div className="abschnitt-kopf"><h3>Zutaten</h3></div>
        <ul className="liste">
          {zutaten.map((z, i) => (
            <li key={`${z.name}-${i}`}>
              <div className="zeile">
                <span className="zeile-haupt">
                  <span className="zeile-titel">{z.name}</span>
                  <span className={`zeile-meta ${z.quelle === 'einkauf' ? 'status-achtung' : ''}`}>
                    {z.quelle === 'bestand' ? (z.dringend ? 'aus dem Vorrat · wird verwertet' : 'aus dem Vorrat') : z.quelle === 'kuehlschrank' ? 'Rest aus dem Kühlschrank' : 'fehlt'}
                  </span>
                </span>
                <span className="zeile-wert">{z.menge !== null && z.einheit ? mengeText(z.menge, z.einheit) : 'Menge offen'}</span>
              </div>
            </li>
          ))}
        </ul>
        {grund.length > 0 && <p className="abschnitt-fuss">Immer da: {grund.join(', ')}</p>}
      </section>

      <section className="abschnitt">
        <div className="abschnitt-kopf"><h3>Damit möglich</h3><Sterne n={k.nutzbarkeit.sterne} /></div>
        <p className="gerichte-liste">
          {k.gerichtstypen.map((t) => <span key={t}><span aria-hidden="true">{GERICHT_EMOJI[t]}</span> {GERICHT_NAME[t]}</span>)}
        </p>
        {partner.length > 0 && <p className="abschnitt-fuss">Passt zu: {partner.map((s) => s.name).join(', ')}</p>}
      </section>

      <div className="abschnitt">
        <button type="button" className="knopf haupt" onClick={onStarten}>
          <Icon name="topf" /> Produktion starten
        </button>
        {planung && (
          <button type="button" className="knopf breit abstand-oben" disabled={laeuft} onClick={() => {
            setLaeuft(true);
            void onVormerken().finally(() => setLaeuft(false));
          }}>
            {fehlt.length ? 'Vormerken · Fehlendes auf die Einkaufsliste' : 'Für später vormerken'}
          </button>
        )}
      </div>

      <details className="mehr-infos abstand-oben">
        <summary>Details</summary>
        {k.schritte.length > 0 && <ol className="schritte-kurz">{k.schritte.map((s, i) => <li key={i}>{s}</li>)}</ol>}
        <ul className="klein">{k.nutzbarkeit.gruende.map((g) => <li key={g}>{g}</li>)}</ul>
        <div className="info-zeilen">
          <div className="info-zeile"><span>Herstellung gesamt</span><span>{k.kosten.gesamt_cent === null ? 'unbekannt' : `${k.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(k.kosten.gesamt_cent)}`}</span></div>
          <div className="info-zeile"><span>Haltbar</span><span>ca. {k.haltbar_tage} Tage</span></div>
          {k.kosten.unbekannt.length > 0 && <div className="info-zeile"><span>Ohne Preis</span><span>{k.kosten.unbekannt.join(', ')}</span></div>}
        </div>
        <p className="meta-text">Nutzbarkeit, Mengen und Kosten rechnet Kombi – nicht die KI.</p>
      </details>
    </Blatt>
  );
}

const ZEILEN_TEXT: Record<ProduktionsZeile['status'], string> = {
  da: 'vorhanden', teilweise: 'nur teilweise da', fehlt: 'fehlt', nicht_erfasst: 'nicht im Vorrat erfasst', immer_da: 'immer da',
};

/**
 * Produktion in zwei Schritten: planen (Menge wählen, Zutaten skalieren, gegen den Vorrat prüfen)
 * und bestätigen (tatsächliche Menge, Haltbarkeit). Gebucht wird erst beim Bestätigen – in EINER
 * Transaktion: Zutaten raus, neue Charge mit den tatsächlichen Kosten rein.
 */
function ProduktionBlatt({ auftrag, plan, bestand, sorten, protokoll, onMeldung, onGeaendert, onFertig, onSchliessen }: {
  auftrag: Auftrag; plan: Plan | null; bestand: Sorte[]; sorten: VorratSorte[]; protokoll: boolean;
  onMeldung: (text: string) => void; onGeaendert: () => void;
  onFertig: (text: string, rueckgaengig: () => Promise<unknown>) => void; onSchliessen: () => void;
}) {
  const { k } = auftrag;
  const zielId = plan?.daten.block_typ_id ?? findeSorte({ name: k.name, block_typ_id: null }, sorten)?.id ?? null;
  const ziel = bestand.find((s) => s.id === zielId) ?? null;
  const [geplant, setGeplant] = useState(plan?.portionen ?? k.portionen);
  const [stufe, setStufe] = useState<'planen' | 'bestaetigen'>('planen');
  const vorbereitet = bereiteProduktionVor(k, geplant, sorten, zielId);
  const [posten, setPosten] = useState<EntnahmePosten[]>([]);
  const [tatsaechlich, setTatsaechlich] = useState(geplant);
  const [ablauf, setAblauf] = useState('');
  const [gemerkt, setGemerkt] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const zeilen = vorbereitet.zeilen.filter((z) => z.status !== 'immer_da');
  const immerDa = vorbereitet.zeilen.filter((z) => z.status === 'immer_da').map((z) => z.name);

  // Vorschau aus gespeicherten Preisen – gebucht werden die echten Kosten der entnommenen Chargen
  const vorschau = (() => {
    let cent = 0;
    let unbekannt = vorbereitet.nicht_erfasst.length;
    for (const p of posten.filter((x) => x.menge > 0)) {
      const s = sorten.find((x) => x.id === p.block_typ_id);
      if (!s || s.kosten_cent === null) unbekannt++;
      else cent += (p.menge * s.kosten_cent) / Math.max(1, s.kosten_menge);
    }
    return { cent: Math.round(cent), unbekannt };
  })();

  function weiter() {
    setPosten(vorbereitet.posten.map((p) => ({ ...p })));
    setTatsaechlich(geplant);
    setStufe('bestaetigen');
  }

  async function aufDieListe() {
    setLaeuft(true);
    try {
      for (const f of vorbereitet.fehlt) {
        const s = findeSorte({ name: f.name, block_typ_id: null }, sorten);
        await eintragHinzufuegen({
          name: f.name, menge: f.menge, einheit: f.einheit, kategorie: s?.farbe ?? 'sonstiges', quelle: 'komponente',
          grund: `für ${k.name}`, block_typ_id: s?.id ?? null,
        });
      }
      setGemerkt(true);
      onMeldung(`${vorbereitet.fehlt.length} ${vorbereitet.fehlt.length === 1 ? 'Zutat steht' : 'Zutaten stehen'} auf der Einkaufsliste.`);
      onGeaendert();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaeuft(false);
    }
  }

  async function buchen() {
    setLaeuft(true);
    setFehler(null);
    try {
      // Zielsorte anlegen, falls es sie noch nicht gibt (Bestand 0 – eingebucht wird gleich)
      let id = zielId;
      let pm = ziel ? portionMengeVon(ziel) : 1;
      let einheit = ziel ? einheitVon(ziel) : 'portion';
      if (id === null) {
        const daten: SorteDaten = { ...komponenteAlsSorte(k), mindestbestand: 0, portion_menge: 1, notiz: null };
        id = await speichereSorte(null, daten);
        pm = 1;
        einheit = 'portion';
      }
      const menge = einheit === 'portion' ? tatsaechlich : tatsaechlich * pm;
      const aktiv = posten.filter((p) => p.menge > 0).map((p) => ({ block_typ_id: p.block_typ_id, menge: p.menge }));
      const name = ziel?.name ?? k.name;
      if (protokoll) {
        const r = await produzieren(aktiv, id, menge, ablauf || null, plan?.id ?? null, vorbereitet.nicht_erfasst.length);
        const kosten = r.kosten_cent !== null
          ? ` · ${euroText(r.kosten_cent)} (${euroText(Math.round(r.kosten_cent / Math.max(1, tatsaechlich)))} / Portion)`
          : r.kosten_bekannt_cent ? ` · ab ${euroText(r.kosten_bekannt_cent)}, nicht alle Preise bekannt` : ' · Kosten unbekannt';
        onFertig(`${name}: +${mengeText(menge, einheit)} im Vorrat${kosten}`, () => produzierenRueckgaengig(r.herstellung_id));
      } else {
        const ids = await herstellen(aktiv, id, menge, ablauf || null, plan?.id ?? null);
        onFertig(`${name}: +${mengeText(menge, einheit)} im Vorrat.`, () => kochenRueckgaengig(ids, plan?.id ?? null));
      }
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  async function nichtMehrVormerken() {
    if (!plan) return;
    setLaeuft(true);
    try {
      await entfernePlan(plan.id);
      onMeldung(`${plan.titel} nicht mehr vorgemerkt.`);
      onGeaendert();
      onSchliessen();
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  const stepper = (wert: number, setzen: (n: number) => void, label: string) => (
    <div className="option-zeile">
      <span className="option-name">{label}</span>
      <div className="stepper">
        <button type="button" className="icon-knopf klein" aria-label={`${label}: weniger`} disabled={wert <= 1} onClick={() => setzen(wert - 1)}>
          <Icon name="minus" groesse={16} />
        </button>
        <strong aria-live="polite">{wert}</strong>
        <button type="button" className="icon-knopf klein" aria-label={`${label}: mehr`} disabled={wert >= 48} onClick={() => setzen(wert + 1)}>
          <Icon name="plus" groesse={16} />
        </button>
      </div>
    </div>
  );

  if (stufe === 'planen') {
    return (
      <Blatt titel={`${k.name} produzieren`} untertitel={ziel ? `kommt zu „${ziel.name}“ in den Vorrat` : 'wird beim Buchen als neue Sorte angelegt'} onSchliessen={onSchliessen}>
        <div className="flaeche">{stepper(geplant, setGeplant, 'Portionen')}</div>

        <section className="abschnitt">
          <div className="abschnitt-kopf"><h3>Zutaten für {geplant} Portionen</h3></div>
          <ul className="liste">
            {zeilen.map((z, i) => (
              <li key={`${z.name}-${i}`}>
                <div className="zeile">
                  <span className="zeile-haupt">
                    <span className="zeile-titel">{z.name}</span>
                    <span className={`zeile-meta ${z.status === 'da' ? 'status-ok' : z.status === 'nicht_erfasst' ? '' : 'status-achtung'}`}>
                      {z.status === 'teilweise' && z.vorhanden !== null && z.fehlt !== null && z.einheit
                        ? `${mengeText(z.vorhanden, z.einheit)} da · ${mengeText(z.fehlt, z.einheit)} fehlt`
                        : z.status === 'da' && z.vorhanden !== null && z.einheit
                          ? `vorhanden: ${mengeText(z.vorhanden, z.einheit)}`
                          : ZEILEN_TEXT[z.status]}
                    </span>
                  </span>
                  <span className="zeile-wert">{z.benoetigt !== null && z.einheit ? mengeText(z.benoetigt, z.einheit) : 'Menge offen'}</span>
                </div>
              </li>
            ))}
          </ul>
          {immerDa.length > 0 && <p className="abschnitt-fuss">Immer da: {immerDa.join(', ')}</p>}
        </section>

        {vorbereitet.fehlt.length > 0 && (
          <div className="abschnitt">
            <p className="verfuegbar status-achtung"><Icon name="wagen" groesse={16} /> Fehlt: {vorbereitet.fehlt.map((f) => (f.menge !== null && f.einheit ? `${mengeText(f.menge, f.einheit)} ${f.name}` : f.name)).join(', ')}</p>
            <button type="button" className="knopf breit abstand-oben" disabled={laeuft || gemerkt} onClick={() => void aufDieListe()}>
              {gemerkt ? 'Steht auf der Einkaufsliste' : 'Fehlendes auf die Einkaufsliste'}
            </button>
          </div>
        )}

        {fehler && <p className="fehlertext">{fehler}</p>}
        <div className="abschnitt">
          <button type="button" className="knopf haupt" onClick={weiter} disabled={vorbereitet.posten.length === 0 && vorbereitet.nicht_erfasst.length === 0}>
            {vorbereitet.fehlt.length ? 'Trotzdem weiter' : 'Weiter'}
          </button>
          {plan && <button type="button" className="link breit abstand-oben" disabled={laeuft} onClick={() => void nichtMehrVormerken()}>Nicht mehr vormerken</button>}
          <p className="abschnitt-fuss">Noch wird nichts gebucht.</p>
        </div>
      </Blatt>
    );
  }

  return (
    <Blatt titel="Produktion bestätigen" untertitel={k.name} onSchliessen={onSchliessen}>
      <section>
        <h3 className="unterkopf">Wird aus dem Vorrat entnommen</h3>
        {posten.length ? <PostenListe posten={posten} bestand={bestand} onAendern={setPosten} /> : <p className="leise">Nichts aus dem Vorrat.</p>}
        {vorbereitet.nicht_erfasst.length > 0 && (
          <p className="abschnitt-fuss">Nicht als Sorte erfasst, wird nicht gebucht: {vorbereitet.nicht_erfasst.join(', ')}.</p>
        )}
      </section>

      <section className="abschnitt">
        <div className="flaeche">
          {stepper(tatsaechlich, setTatsaechlich, 'Tatsächlich ergibt es')}
          <label className="feld feld-inline abstand-oben">
            <span>Haltbar bis <small>(optional)</small></span>
            <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
          </label>
        </div>
        <p className="abschnitt-fuss">
          {tatsaechlich !== geplant ? `Gezählt wird die echte Menge: ${tatsaechlich} statt ${geplant} Portionen. ` : ''}
          {vorschau.unbekannt === 0
            ? `Warenwert ≈ ${euroText(vorschau.cent)} · ≈ ${euroText(Math.round(vorschau.cent / Math.max(1, tatsaechlich)))} / Portion.`
            : vorschau.cent > 0
              ? `Warenwert ab ${euroText(vorschau.cent)} – ${vorschau.unbekannt} ohne Preis.`
              : 'Warenwert unbekannt – keine Preise hinterlegt.'}
        </p>
      </section>

      {fehler && <p className="fehlertext">{fehler}</p>}
      <div className="abschnitt">
        <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => void buchen()}>
          <Icon name="haken" /> {laeuft ? 'Bucht …' : `${tatsaechlich} Portionen einbuchen`}
        </button>
        <button type="button" className="link breit abstand-oben" disabled={laeuft} onClick={() => setStufe('planen')}>Zurück</button>
        <p className="abschnitt-fuss">Eine Buchung: Zutaten raus, neue Charge rein – mit den echten Kosten der entnommenen Zutaten. Das zählt nicht noch einmal als Einkauf.</p>
      </div>
    </Blatt>
  );
}
