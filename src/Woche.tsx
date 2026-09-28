import { useState, type ReactNode } from 'react';
import type { Gericht, GerichtKurz, Optionen } from '../supabase/functions/_shared/kombi/typen.ts';
import type { PlanStand } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { mussAuftauen, reserviertAusser, restSnapshot, type AuftauEintrag } from '../supabase/functions/_shared/kombi/planung.ts';
import { kurz } from '../supabase/functions/_shared/kombi/bewertung.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, ladeBestand, type Sorte } from './api';
import { baueSnapshotAus, holeVorschlaege, holeWoche, type Quelle } from './essenApi';
import { aenderePlan, alsVorratSorte, entfernePlan, naehrwerteGericht, planeGericht, type Plan } from './haushalt';
import { Blatt } from './Blatt';
import { GerichtKarte } from './GerichtKarte';
import { Icon } from './Icon';
import { kcalKurz } from './format';
import { freieTage, plusTageIso, tagName } from './dashboard';

type Props = {
  bestand: Sorte[];
  plaene: Plan[];
  proPlan: Map<string, PlanStand[]>;
  reserviert: Map<number, number>;
  auftauEintraege: AuftauEintrag[];
  auftauen: ReactNode;
  optionen: Optionen;
  favoriten: GerichtKurz[];
  planung: boolean;
  heute: string;
  onKochen: (g: Gericht, planId: string) => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

/** Tag wählen: heute, morgen, die nächsten Tage – oder flexibel ohne Tag. */
export function TagWahl({ heute, titel, untertitel, aktuell, onWahl, onSchliessen }: {
  heute: string; titel: string; untertitel?: string; aktuell?: string | null;
  onWahl: (datum: string | null) => void; onSchliessen: () => void;
}) {
  const tage = Array.from({ length: 7 }, (_, i) => plusTageIso(heute, i));
  return (
    <Blatt titel={titel} untertitel={untertitel} onSchliessen={onSchliessen}>
      <div className="tag-raster">
        {tage.map((t) => (
          <button key={t} type="button" className={`zahl${aktuell === t ? ' gewaehlt' : ''}`} onClick={() => onWahl(t)}>
            {tagName(heute, t)}
          </button>
        ))}
        <button type="button" className={`zahl${aktuell === null ? ' gewaehlt' : ''}`} onClick={() => onWahl(null)}>Flexibel</button>
      </div>
      <p className="abschnitt-fuss">Geplantes reserviert nur – entnommen wird erst beim Kochen.</p>
    </Blatt>
  );
}

const nachDatum = (a: Plan, b: Plan) =>
  (a.datum ?? '9999').localeCompare(b.datum ?? '9999') || a.erstellt_am.localeCompare(b.erstellt_am);

/** Flexible Wochenplanung: Mahlzeiten verteilen, tauschen, verschieben, entfernen. */
export function Woche({ bestand, plaene, proPlan, reserviert, auftauEintraege, auftauen, optionen, favoriten, planung, heute, onKochen, onMeldung, onGeaendert }: Props) {
  const [anzahl, setAnzahl] = useState(5);
  const [vorschau, setVorschau] = useState<{ gerichte: Gericht[]; tage: string[]; quelle: Quelle; hinweis: string | null } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [tagFuer, setTagFuer] = useState<Plan | null>(null);
  const [tausch, setTausch] = useState<{ plan: Plan; alternativen: Gericht[] | null; hinweis: string | null } | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  if (!planung) {
    return (
      <div className="leer-zustand">
        <Icon name="kalender" groesse={40} />
        <p>Für die Wochenplanung fehlt in Supabase noch die Migration „planung_einkauf“ (siehe README).</p>
      </div>
    );
  }

  const mahlzeiten = plaene.filter((p) => p.art === 'mahlzeit' && p.daten.gericht).sort(nachDatum);
  const gesehen = mahlzeiten.map((p) => kurz(p.daten.gericht!));

  async function freierSnapshot(ohnePlan: string | null) {
    const reservierung = ohnePlan
      ? new Map([...reserviertAusser(proPlan, plaene, ohnePlan)].map(([id, r]) => [id, r.menge]))
      : reserviert;
    return restSnapshot(baueSnapshotAus(await ladeBestand(), ''), reservierung);
  }

  async function planen() {
    setLaedt(true);
    setFehler(null);
    try {
      const a = await holeWoche({
        snapshot: await freierSnapshot(null), optionen, gesehen, favoriten, feedback: [], modus: { art: 'normal' }, anzahl, aufgabe: 'woche',
      });
      const tage = freieTage(heute, mahlzeiten.map((p) => p.datum), a.ergebnis.gerichte.length);
      setVorschau({ gerichte: a.ergebnis.gerichte, tage, quelle: a.quelle, hinweis: a.ergebnis.hinweis ?? a.hinweis });
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaedt(false);
    }
  }

  async function uebernehmen() {
    if (!vorschau) return;
    setLaedt(true);
    try {
      for (let i = 0; i < vorschau.gerichte.length; i++) await planeGericht(vorschau.gerichte[i], vorschau.tage[i] ?? null);
      const n = vorschau.gerichte.length;
      setVorschau(null);
      onMeldung(`${n} ${n === 1 ? 'Mahlzeit' : 'Mahlzeiten'} eingeplant. Fehlendes steht auf der Einkaufsliste.`);
      onGeaendert();
    } catch (e) {
      setFehler(fehlerText(e));
      onGeaendert();
    } finally {
      setLaedt(false);
    }
  }

  async function entfernen(p: Plan) {
    setLaeuft(p.id);
    try {
      await entfernePlan(p.id);
      const g = p.daten.gericht!;
      onMeldung(`${p.titel} entfernt – Reservierungen und Einkaufsliste sind neu berechnet.`, () => planeGericht(g, p.datum).then(onGeaendert));
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(null);
    }
  }

  async function tauschen(p: Plan) {
    setTausch({ plan: p, alternativen: null, hinweis: null });
    try {
      const a = await holeVorschlaege({
        snapshot: await freierSnapshot(p.id), optionen, gesehen, favoriten, feedback: [], modus: { art: 'normal' }, anzahl: 3,
      });
      setTausch({ plan: p, alternativen: a.ergebnis.gerichte, hinweis: a.quelle === 'demo' ? a.hinweis : null });
    } catch (e) {
      setTausch(null);
      onMeldung(fehlerText(e));
    }
  }

  async function nimm(p: Plan, g: Gericht) {
    try {
      await aenderePlan(p.id, { titel: g.name, portionen: g.portionen, daten: { gericht: g } });
      setTausch(null);
      onMeldung(`Getauscht: ${g.name} statt ${p.titel}.`);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    }
  }

  async function tagSetzen(p: Plan, datum: string | null) {
    setTagFuer(null);
    try {
      await aenderePlan(p.id, { datum });
      onMeldung(`${p.titel}: ${datum ? tagName(heute, datum) : 'flexibel'}.`);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    }
  }

  const fehltGesamt = vorschau ? [...new Set(vorschau.gerichte.flatMap((g) => g.fehlt.map((f) => f.name)))] : [];
  const kostenVorschau = vorschau
    ? vorschau.gerichte.reduce((s, g) => s + (g.kosten.gesamt_cent ?? 0), 0)
    : 0;

  return (
    <div className="woche">
      <section className="abschnitt" aria-label="Geplant">
        <div className="abschnitt-kopf"><h2>Geplant</h2></div>
        {mahlzeiten.length === 0 ? (
          <p className="leise">Noch nichts geplant. Unten ein paar Tage vorschlagen lassen – oder bei einem Vorschlag „Einplanen“ tippen.</p>
        ) : (
          <ul className="liste mit-icon">
            {mahlzeiten.map((p) => {
              const g = p.daten.gericht!;
              const stand = proPlan.get(p.id) ?? [];
              const fehlt = stand.filter((s) => s.fehlt === null || s.fehlt > 0);
              const tk = stand.filter((s) => {
                const b = bestand.find((x) => x.id === s.block_typ_id);
                return s.reserviert > 0 && !!b && mussAuftauen(alsVorratSorte(b));
              });
              const auftau = auftauEintraege.filter((a) => a.plan_id === p.id);
              const vorbei = p.datum !== null && p.datum < heute;
              return (
                <li key={p.id}>
                  <div className="zeile">
                    <span className="gericht-bild klein" aria-hidden="true">{g.emoji}</span>
                    <span className="zeile-haupt">
                      <span className={`zeile-meta${vorbei ? ' status-achtung' : ''}`}>{p.datum ? tagName(heute, p.datum) : 'Flexibel'}</span>
                      <span className="zeile-titel">{p.titel}</span>
                      <span className="zeile-meta">
                        {g.zeit_min} Min · {kcalKurz(naehrwerteGericht(g, bestand))} / Portion · {fehlt.length
                          ? <span className="status-achtung">fehlt: {fehlt.map((s) => s.name).join(', ')}</span>
                          : <span className="status-ok">alles da</span>}
                        {tk.length > 0 && ` · ${auftau.some((a) => a.status === 'aufgetaut') ? 'aufgetaut' : auftau.length ? 'Auftauen vorgemerkt' : 'vorher auftauen'}`}
                      </span>
                    </span>
                    <button type="button" className="knopf klein akzent" onClick={() => onKochen(g, p.id)}>Kochen</button>
                  </div>
                  <div className="knopf-reihe plan-aktionen">
                    <button type="button" className="link" onClick={() => setTagFuer(p)}>Tag ändern</button>
                    <button type="button" className="link" onClick={() => void tauschen(p)}>Tauschen</button>
                    <button type="button" className="link" disabled={laeuft === p.id} onClick={() => void entfernen(p)}>Entfernen</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {auftauen}

      {!vorschau ? (
        <section className="abschnitt" aria-label="Mehrere Tage planen">
          <div className="abschnitt-kopf"><h2>Mehrere Tage planen</h2></div>
          <div className="flaeche formular">
            <div className="segment" role="group" aria-label="Wie viele Mahlzeiten?">
              {[3, 5, 7].map((n) => (
                <button key={n} type="button" className={anzahl === n ? 'gewaehlt' : ''} aria-pressed={anzahl === n} onClick={() => setAnzahl(n)}>
                  {n} Mahlzeiten
                </button>
              ))}
            </div>
            <button type="button" className="knopf haupt" disabled={laedt} onClick={() => void planen()}>
              {laedt ? 'Kombi plant …' : 'Vorschlagen'}
            </button>
            {fehler && <p className="fehlertext">{fehler}</p>}
          </div>
          <p className="abschnitt-fuss">Verteilt den freien Vorrat ohne eine Portion doppelt zu verplanen. Entnommen wird erst beim Kochen.</p>
        </section>
      ) : (
        <section className="abschnitt" aria-label="Vorschlag">
          <div className="abschnitt-kopf">
            <h2>Vorschlag</h2>
            <button type="button" className="link" onClick={() => setVorschau(null)}>Verwerfen</button>
          </div>
          {vorschau.gerichte.length === 0 ? (
            <p className="leise">{vorschau.hinweis ?? 'Mit dem freien Vorrat passt gerade keine Mahlzeit.'}</p>
          ) : (
            <ul className="liste mit-icon">
              {vorschau.gerichte.map((g, i) => (
                <li key={g.id}>
                  <div className="zeile">
                    <span className="gericht-bild klein" aria-hidden="true">{g.emoji}</span>
                    <span className="zeile-haupt">
                      <span className="zeile-meta">{vorschau.tage[i] ? tagName(heute, vorschau.tage[i]) : 'Flexibel'}</span>
                      <span className="zeile-titel">{g.name}</span>
                      <span className="zeile-meta">
                        {g.fehlt.length ? <span className="status-achtung">fehlt: {g.fehlt.map((f) => f.name).join(', ')}</span> : 'alles da'} · {kcalKurz(naehrwerteGericht(g, bestand))}
                      </span>
                    </span>
                    <button type="button" className="icon-knopf klein" aria-label={`${g.name} aus dem Vorschlag nehmen`}
                      onClick={() => setVorschau({ ...vorschau, gerichte: vorschau.gerichte.filter((_, j) => j !== i), tage: vorschau.tage.filter((_, j) => j !== i) })}>
                      <Icon name="schliessen" groesse={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {vorschau.gerichte.length > 0 && (
            <p className="abschnitt-fuss">
              {fehltGesamt.length ? `Einkaufen: ${fehltGesamt.join(', ')}. ` : 'Kein Einkauf nötig. '}
              {kostenVorschau > 0 && `Aus dem Vorrat ≈ ${euroText(kostenVorschau)} (bekannte Preise). `}
              {vorschau.quelle === 'ki' ? 'Ideen von der KI, geprüft und verteilt von Kombi.' : 'Nach Kombi-Regeln.'}
              {vorschau.hinweis && ` ${vorschau.hinweis}`}
            </p>
          )}
          <button type="button" className="knopf haupt abstand-oben" disabled={laedt || vorschau.gerichte.length === 0} onClick={() => void uebernehmen()}>
            {vorschau.gerichte.length} einplanen
          </button>
        </section>
      )}

      {tagFuer && (
        <TagWahl heute={heute} titel={`${tagFuer.titel} – wann?`} aktuell={tagFuer.datum} onWahl={(d) => void tagSetzen(tagFuer, d)} onSchliessen={() => setTagFuer(null)} />
      )}

      {tausch && (
        <Blatt titel={`Statt ${tausch.plan.titel}`} untertitel="Aus dem freien Vorrat – die Reservierung wird neu berechnet." onSchliessen={() => setTausch(null)}>
          {tausch.alternativen === null ? (
            <p className="leise">Kombi sucht Alternativen …</p>
          ) : tausch.alternativen.length === 0 ? (
            <p className="leise">Gerade keine passende Alternative.</p>
          ) : (
            <div className="essen">
              {tausch.alternativen.map((g) => (
                <div key={g.id} className="essen">
                  <GerichtKarte g={g} naehrwerte={naehrwerteGericht(g, bestand)} kompakt />
                  <button type="button" className="knopf breit" onClick={() => void nimm(tausch.plan, g)}>
                    {g.name} nehmen
                  </button>
                </div>
              ))}
            </div>
          )}
          {tausch.hinweis && <p className="leise klein abstand-oben">{tausch.hinweis}</p>}
        </Blatt>
      )}
    </div>
  );
}
