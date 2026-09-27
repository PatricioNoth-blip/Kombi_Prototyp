import { useState, type ReactNode } from 'react';
import type { EntnahmePosten } from '../supabase/functions/_shared/kombi/aktionen.ts';
import type { Farbe, KomponentenVorschlag } from '../supabase/functions/_shared/kombi/typen.ts';
import { findeSorte, inSorteneinheit, verwendbar, type PlanStand, type VorratSorte } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { restSnapshot } from '../supabase/functions/_shared/kombi/planung.ts';
import { komponenteAlsSorte } from '../supabase/functions/_shared/kombi/komponenten.ts';
import { GERICHT_EMOJI, GERICHT_NAME, gerichtstypenVon, ROLLEN } from '../supabase/functions/_shared/kombi/rollen.ts';
import { batchEmpfehlungen, oftVerwendet, type BatchSorte, type NutzungZeile } from '../supabase/functions/_shared/kombi/batch.ts';
import { euroText } from '../supabase/functions/_shared/kombi/kosten.ts';
import { fehlerText, ladeBestand, type Sorte } from './api';
import { baueSnapshotAus, holeKomponenten, type Quelle } from './essenApi';
import { entfernePlan, herstellen, kochenRueckgaengig, planeKomponente, aenderePlan, type Plan } from './haushalt';
import { Blatt } from './Blatt';
import { SorteFormular } from './Sorten';
import { PostenListe } from './PostenListe';
import { Icon } from './Icon';
import { lagerort } from './farben';
import { artVon, einheitVon, heuteIso, mengeText, portionMengeVon, portionenVon } from './format';
import { fuellstand } from './dashboard';
import type { NavZustand } from './navigation';

type Props = {
  bestand: Sorte[];
  sorten: VorratSorte[];
  baukasten: boolean;
  planung: boolean;
  plaene: Plan[];
  proPlan: Map<string, PlanStand[]>;
  nutzung: NutzungZeile[];
  reserviert: Map<number, number>;
  nav: NavZustand['komponenten'];
  onNav: (teil: Partial<NavZustand['komponenten']>) => void;
  onOeffnen: (s: Sorte) => void;
  onMeldung: (text: string, rueckgaengig?: () => Promise<unknown>) => void;
  onGeaendert: () => void;
};

/** Die vier Funktionen, aus denen sich ein Gericht zusammensetzt */
const FUNKTIONEN: Farbe[] = ['rot', 'braun', 'gruen', 'gelb'];

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

function Emojis({ typen, max = 5 }: { typen: KomponentenVorschlag['gerichtstypen']; max?: number }) {
  return (
    <span className="emoji-reihe" aria-label={typen.map((t) => GERICHT_NAME[t]).join(', ')}>
      {typen.slice(0, max).map((t) => <span key={t} aria-hidden="true">{GERICHT_EMOJI[t]}</span>)}
      {typen.length > max && <small>+{typen.length - max}</small>}
    </span>
  );
}

const fehltText = (k: KomponentenVorschlag) =>
  k.zutaten.filter((z) => z.quelle === 'einkauf').map((z) => z.name);

/** Komponenten: was ist vorbereitet, was ist vorgemerkt, was wäre sinnvoll – und was lohnt sich größer zu kochen? */
export function Komponenten({ bestand, sorten, baukasten, planung, plaene, proPlan, nutzung, reserviert, nav, onNav, onOeffnen, onMeldung, onGeaendert }: Props) {
  const [ideen, setIdeen] = useState<KomponentenVorschlag[] | null>(null);
  const [quelle, setQuelle] = useState<{ art: Quelle; anbieter: string; hinweis: string | null } | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<KomponentenVorschlag | null>(null);
  const [formular, setFormular] = useState<{ k: KomponentenVorschlag; plan: Plan | null } | null>(null);
  const [uebernommen, setUebernommen] = useState<Map<string, number>>(new Map());
  const [herstellenPlan, setHerstellenPlan] = useState<Plan | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  const komponenten = bestand.filter((s) => artVon(s) === 'komponente');
  const gezeigt = komponenten
    .filter((s) => !nav.rolle || s.farbe === nav.rolle)
    .sort((a, b) => Number(b.anzahl > 0) - Number(a.anzahl > 0) || a.name.localeCompare(b.name, 'de'));
  const vorgemerkt = plaene.filter((p) => p.art === 'komponente');
  const batch = batchEmpfehlungen(bestand.map(alsBatchSorte), nutzung);
  const oft = oftVerwendet(bestand.map(alsBatchSorte), nutzung);
  const zielVon = (p: Plan) => {
    const k = p.daten.komponente!;
    const id = p.daten.block_typ_id ?? findeSorte({ name: k.name, block_typ_id: null }, sorten)?.id ?? null;
    return bestand.find((s) => s.id === id) ?? null;
  };

  async function entdecken() {
    setLaedt(true);
    setFehler(null);
    try {
      // nur der freie Vorrat: Geplantes wird nicht noch einmal verplant
      const snapshot = restSnapshot(baueSnapshotAus(await ladeBestand(), ''), reserviert);
      const a = await holeKomponenten({
        snapshot, optionen: { personen: 2, max_minuten: null, guenstig: true }, gesehen: [], feedback: [],
        modus: { art: 'normal' }, anzahl: 6, aufgabe: 'komponenten',
      });
      setIdeen(a.ergebnis.komponenten);
      setQuelle({ art: a.quelle, anbieter: a.ergebnis.anbieter, hinweis: a.hinweis ?? a.ergebnis.hinweis });
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setLaedt(false);
    }
  }

  async function vormerken(k: KomponentenVorschlag) {
    setLaeuft(`v-${k.id}`);
    try {
      const ziel = uebernommen.get(k.name) ?? findeSorte({ name: k.name, block_typ_id: null }, sorten)?.id ?? null;
      await planeKomponente(k, ziel);
      setOffen(null);
      const fehlt = fehltText(k);
      onMeldung(fehlt.length ? `${k.name} vorgemerkt – ${fehlt.length} fehlende ${fehlt.length === 1 ? 'Zutat steht' : 'Zutaten stehen'} auf der Einkaufsliste.` : `${k.name} vorgemerkt – alles da, jetzt herstellen.`);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(null);
    }
  }

  async function planEntfernen(p: Plan) {
    setLaeuft(p.id);
    try {
      await entfernePlan(p.id);
      onMeldung(`${p.titel} nicht mehr vorgemerkt – Einkaufsliste ist angepasst.`);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(null);
    }
  }

  const abschnitt = (titel: string, inhalt: ReactNode, extra?: ReactNode) => (
    <section className="gruppe">
      <div className="abschnitt-zeile">
        <h2 className="abschnitt-titel">{titel}</h2>
        {extra}
      </div>
      {inhalt}
    </section>
  );

  return (
    <div className="komponenten">
      <p className="bereich-einleitung">
        Komponenten sind vorbereitete Bausteine mit einer <strong>Funktion</strong>: Basis, Protein, Gemüse, Sattmacher. Kombi baut daraus Gerichte.
      </p>

      <div className="rollen-raster" role="group" aria-label="Nach Funktion filtern">
        {FUNKTIONEN.map((f) => {
          const da = komponenten.filter((s) => s.farbe === f && s.anzahl > 0);
          const portionen = Math.floor(da.reduce((n, s) => n + portionenVon(s), 0));
          return (
            <button key={f} type="button" className={`rollen-kachel f-${f}${nav.rolle === f ? ' gewaehlt' : ''}${da.length === 0 ? ' fehlt' : ''}`}
              aria-pressed={nav.rolle === f} onClick={() => onNav({ rolle: nav.rolle === f ? null : f })}>
              <span className="farbpunkt" aria-hidden="true" />
              <strong>{ROLLEN[f].name}</strong>
              <small>{da.length === 0 ? 'fehlt noch' : `${da.length} · ${portionen} ${portionen === 1 ? 'Portion' : 'Portionen'}`}</small>
            </button>
          );
        })}
      </div>

      {abschnitt(nav.rolle ? `Deine Komponenten · ${ROLLEN[nav.rolle].name}` : 'Deine Komponenten', gezeigt.length === 0 ? (
        <p className="leise klein gruppe-leer">{nav.rolle ? 'Für diese Funktion gibt es noch keine Komponente – unten Ideen holen.' : 'Noch keine Komponenten angelegt.'}</p>
      ) : (
        <ul className="karten-raster">
          {gezeigt.map((s) => {
            const fuell = fuellstand(s);
            const g = gerichtstypenVon(s);
            return (
              <li key={s.id} className={`vorrat-karte komp-karte f-${s.farbe}${s.anzahl === 0 ? ' leer' : ''}`}>
                <button type="button" className="vk-oeffnen" onClick={() => onOeffnen(s)}>
                  <span className="vk-rolle"><span className="farbpunkt" aria-hidden="true" />{ROLLEN[s.farbe].name}</span>
                  <span className="vk-name">{s.name}</span>
                  <span className="vk-menge"><strong>{portionenVon(s)}</strong> <small>{portionenVon(s) === 1 ? 'Portion' : 'Port.'}</small></span>
                  {fuell && <span className="vk-balken" aria-hidden="true"><span style={{ width: `${Math.round(fuell.anteil * 100)}%` }} /></span>}
                  <span className="vk-fuss">{g.typen.length > 0 ? <Emojis typen={g.typen} max={4} /> : <span className="vk-ort">{lagerort(s.lagerort).name}</span>}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ), nav.rolle && <button type="button" className="link" onClick={() => onNav({ rolle: null })}>Alle</button>)}

      {planung && vorgemerkt.length > 0 && abschnitt('Vorgemerkt', (
        <ul className="plan-liste">
          {vorgemerkt.map((p) => {
            const k = p.daten.komponente!;
            const stand = proPlan.get(p.id) ?? [];
            const fehlt = stand.filter((x) => x.fehlt === null || x.fehlt > 0);
            const ziel = zielVon(p);
            return (
              <li key={p.id} className={`plan-karte f-${k.rolle}`}>
                <div className="plan-kopf">
                  <span className="plan-emoji" aria-hidden="true">🧩</span>
                  <span className="plan-titel">
                    <strong>{k.name}</strong>
                    <small>{ROLLEN[k.rolle].name} · {k.portionen} Portionen · {lagerort(k.lagerort).name}</small>
                  </span>
                </div>
                <p className={`plan-status ${fehlt.length ? 'fehlt' : 'ok'}`}>
                  {fehlt.length
                    ? <><Icon name="wagen" groesse={15} /> Fehlt noch: {fehlt.map((x) => (x.fehlt ? `${mengeText(x.fehlt, x.einheit ?? 'stueck')} ${x.name}` : x.name)).join(', ')} – steht auf der Einkaufsliste</>
                    : <><Icon name="haken" groesse={15} /> Alles da</>}
                </p>
                <div className="plan-aktionen">
                  {ziel ? (
                    <button type="button" className="knopf klein-knopf haupt-klein" onClick={() => setHerstellenPlan(p)}>
                      <Icon name="pfanne" groesse={16} /> Herstellen
                    </button>
                  ) : (
                    <button type="button" className="knopf klein-knopf" onClick={() => setFormular({ k, plan: p })}>
                      Als Sorte übernehmen
                    </button>
                  )}
                  <button type="button" className="link" disabled={laeuft === p.id} onClick={() => void planEntfernen(p)}>Entfernen</button>
                </div>
              </li>
            );
          })}
        </ul>
      ))}

      {abschnitt('Komponenten entdecken', (
        <>
          {ideen === null && !laedt && (
            <div className="entdecken-start">
              <span className="entdecken-emoji" aria-hidden="true">🧩</span>
              <p>Welche Bausteine lohnen sich vorzubereiten? Kombi sucht Komponenten, die euren Vorrat <strong>verwerten</strong> – oder mit wenig Einkauf <strong>neu</strong> dazukommen.</p>
              <button type="button" className="knopf haupt" onClick={() => void entdecken()}>
                <Icon name="funken" /> Ideen holen
              </button>
              <small className="leise">Vorschläge werden nie automatisch gespeichert.</small>
            </div>
          )}
          {laedt && <p className="leise laden">Kombi schaut, was sich lohnt …</p>}
          {fehler && <p className="fehlerbox">{fehler}</p>}
          {ideen && !laedt && (
            <>
              {ideen.length === 0 ? (
                <p className="leise">{quelle?.hinweis ?? 'Gerade keine passende neue Komponente.'}</p>
              ) : (
                <ul className="ideen-liste">
                  {ideen.map((k) => {
                    const fehlt = fehltText(k);
                    return (
                      <li key={k.id}>
                        <button type="button" className={`idee-karte f-${k.rolle}`} onClick={() => setOffen(k)}>
                          <span className="idee-kopf">
                            <span className={`pille ${k.typ === 'verwerten' ? 'pille-verwerten' : 'pille-neu'}`}>
                              {k.typ === 'verwerten' ? '♻️ Verwertet Vorrat' : '🛒 Neu'}
                            </span>
                            <Sterne n={k.nutzbarkeit.sterne} />
                          </span>
                          <strong className="idee-name">{k.name}</strong>
                          <span className="idee-rolle"><span className="farbpunkt" aria-hidden="true" /> {ROLLEN[k.rolle].name} · {k.portionen} Portionen</span>
                          <span className="idee-nutzen">
                            <Emojis typen={k.gerichtstypen} />
                            <small>{k.gerichtstypen.length >= 6 ? `für ${k.gerichtstypen.length}+ Gerichte` : `für ${k.gerichtstypen.length} Gerichtsarten`}</small>
                          </span>
                          <span className={`idee-fehlt ${fehlt.length ? 'ja' : 'nein'}`}>
                            {fehlt.length ? `Dafür fehlen noch: ${fehlt.join(', ')}` : 'Alles da'}
                          </span>
                          {uebernommen.has(k.name) && <span className="idee-status"><Icon name="haken" groesse={14} /> übernommen</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {quelle && (
                <p className="leise klein abstand-oben">
                  {quelle.art === 'ki' ? `Ideen von der KI (${quelle.anbieter}) – Mengen, Kosten und Nutzbarkeit rechnet Kombi selbst.` : 'Demo ohne KI: klassische Kombi-Komponenten nach Regeln.'}
                  {quelle.hinweis && quelle.art !== 'ki' && ` ${quelle.hinweis}`}
                </p>
              )}
              <button type="button" className="link" onClick={() => void entdecken()}>Neue Ideen</button>
            </>
          )}
        </>
      ))}

      {planung && abschnitt('Größer vorkochen?', batch.length > 0 ? (
        <ul className="plan-liste">
          {batch.map((b) => (
            <li key={b.block_typ_id} className="plan-karte">
              <p><strong>{b.name}:</strong> nächstes Mal {mengeText(b.neu, b.einheit)} statt {mengeText(b.bisher, b.einheit)}</p>
              <ul className="gruende klein">{b.gruende.map((g) => <li key={g}>{g}</li>)}</ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="leise klein gruppe-leer">
          {oft.length > 0 && <>Oft verwendet: {oft.map((o) => `${o.name} (${mengeText(o.verbrauch_28, o.einheit)} in 4 Wochen)`).join(', ')}. </>}
          Kombi empfiehlt größere Mengen erst, wenn eine selbstgemachte Komponente mindestens 2× in 8 Wochen hergestellt und regelmäßig verbraucht wurde – geschätzt wird nichts.
        </p>
      ))}

      {offen && (
        <KomponenteBlatt
          k={offen}
          bestand={bestand}
          planung={planung}
          uebernommen={uebernommen.has(offen.name) || !!findeSorte({ name: offen.name, block_typ_id: null }, sorten)}
          laeuft={laeuft === `v-${offen.id}`}
          onUebernehmen={() => {
            setFormular({ k: offen, plan: null });
            setOffen(null);
          }}
          onVormerken={() => void vormerken(offen)}
          onSchliessen={() => setOffen(null)}
        />
      )}

      {formular && (
        <SorteFormular
          sorte={null}
          baukasten={baukasten}
          planung={planung}
          titel="Komponente übernehmen"
          vorlage={komponenteAlsSorte(formular.k)}
          onFertig={(text, id) => {
            const { k, plan } = formular;
            setFormular(null);
            setUebernommen((m) => new Map(m).set(k.name, id));
            if (plan) void aenderePlan(plan.id, { daten: { ...plan.daten, block_typ_id: id } }).then(onGeaendert, () => onGeaendert());
            else setOffen(k);
            onMeldung(`${text} Bestand 0 – nach dem Herstellen wird eingebucht.`);
            onGeaendert();
          }}
          onSchliessen={() => setFormular(null)}
        />
      )}

      {herstellenPlan && zielVon(herstellenPlan) && (
        <HerstellenBlatt
          plan={herstellenPlan}
          ziel={zielVon(herstellenPlan)!}
          bestand={bestand}
          sorten={sorten}
          onFertig={(text, rueck) => {
            setHerstellenPlan(null);
            onMeldung(text, rueck);
            onGeaendert();
          }}
          onSchliessen={() => setHerstellenPlan(null)}
        />
      )}
    </div>
  );
}

/** Ein Komponenten-Vorschlag im Detail. Erst „übernehmen“ legt etwas an – vorher ändert sich nichts. */
function KomponenteBlatt({ k, bestand, planung, uebernommen, laeuft, onUebernehmen, onVormerken, onSchliessen }: {
  k: KomponentenVorschlag; bestand: Sorte[]; planung: boolean; uebernommen: boolean; laeuft: boolean;
  onUebernehmen: () => void; onVormerken: () => void; onSchliessen: () => void;
}) {
  const fehlt = k.zutaten.filter((z) => z.quelle === 'einkauf');
  const grund = k.zutaten.filter((z) => z.quelle === 'grundausstattung').map((z) => z.name);
  const zutaten = k.zutaten.filter((z) => z.quelle !== 'grundausstattung');
  const partner = k.partner.map((n) => bestand.find((s) => s.name === n)).filter((s): s is Sorte => !!s);

  return (
    <Blatt titel={k.name} untertitel={k.typ === 'verwerten' ? 'Verwertet euren Vorrat' : 'Neue Komponente – mit Einkauf'} onSchliessen={onSchliessen}>
      <p className="pillen">
        <span className={`pille-rolle f-${k.rolle}`}><span className="farbpunkt" aria-hidden="true" />{ROLLEN[k.rolle].name}</span>
        <span className="pille-grau"><Icon name={lagerort(k.lagerort).icon} groesse={13} /> {lagerort(k.lagerort).name}</span>
        <span className="pille-grau">ca. {k.haltbar_tage} Tage haltbar</span>
        {k.richtung && <span className="pille-grau">{k.richtung}</span>}
      </p>
      {k.beschreibung && <p className="gericht-beschreibung">{k.beschreibung}</p>}

      <div className="nutzbarkeit-karte">
        <div>
          <small>Nutzbarkeit</small>
          <Sterne n={k.nutzbarkeit.sterne} />
        </div>
        <ul className="gruende klein">{k.nutzbarkeit.gruende.map((g) => <li key={g}>{g}</li>)}</ul>
        <p className="leise klein">Berechnet von Kombi aus Gerichtsarten, Partnern im Vorrat, Lagerung und Einkauf – nicht von der KI.</p>
      </div>

      <section className="abschnitt">
        <h3>Damit möglich</h3>
        <p className="gericht-chips">
          {k.gerichtstypen.map((t) => <span key={t}><span aria-hidden="true">{GERICHT_EMOJI[t]}</span> {GERICHT_NAME[t]}</span>)}
        </p>
        {k.verwendung.length > 0 && <p className="leise klein">z. B. {k.verwendung.join(', ')}</p>}
      </section>

      <section className="abschnitt">
        <h3>Zutaten für {k.portionen} Portionen{k.portion_g ? ` à ${k.portion_g} g` : ''}</h3>
        <ul className="liste">
          {zutaten.map((z, i) => (
            <li key={`${z.name}-${i}`} className={`zeile zutat-${z.quelle}`}>
              <span className={`zutat-zeichen ${z.quelle === 'einkauf' ? 'nein' : 'ja'}`} aria-label={z.quelle === 'einkauf' ? 'fehlt' : 'vorhanden'}>
                {z.quelle === 'einkauf' ? '✕' : <Icon name="haken" groesse={14} />}
              </span>
              <span className="zeile-info">
                <span className="zeile-name">{z.name}</span>
                <span className="zeile-details">
                  {z.quelle === 'bestand' ? `aus dem Vorrat${z.dringend ? ' · wird verwertet' : ''}` : z.quelle === 'kuehlschrank' ? 'Kühlschrank-Rest' : 'fehlt – einkaufen'}
                </span>
              </span>
              <strong className="klein">{z.menge !== null && z.einheit ? mengeText(z.menge, z.einheit) : 'Menge offen'}</strong>
            </li>
          ))}
        </ul>
        {grund.length > 0 && <p className="leise klein abstand-oben">Immer da: {grund.join(', ')}</p>}
        {fehlt.length > 0 && <p className="fehlt-hinweis"><Icon name="wagen" groesse={16} /> Dafür fehlen noch: {fehlt.map((z) => z.name).join(', ')}</p>}
      </section>

      <div className="kennzahlen abstand-oben">
        <div>
          <small>Herstellung</small>
          <strong>{k.kosten.gesamt_cent === null ? '–' : `${k.kosten.status === 'teilweise' ? 'ab ' : ''}${euroText(k.kosten.gesamt_cent)}`}</strong>
          <span>{k.kosten.pro_portion_cent === null ? 'Preis unbekannt' : `${euroText(k.kosten.pro_portion_cent)} / Portion`}</span>
        </div>
        <div>
          <small>Einkauf</small>
          <strong>{fehlt.length === 0 ? '0,00 €' : k.einkauf.gesamt_cent === null ? '–' : `≈ ${euroText(k.einkauf.gesamt_cent)}`}</strong>
          <span>{fehlt.length === 0 ? 'nichts nötig' : k.einkauf.unbekannt.length ? `${k.einkauf.unbekannt.length} ohne Preis` : 'ganze Packungen'}</span>
        </div>
        <div>
          <small>Zeit</small>
          <strong>{k.zeit_min} Min.</strong>
          <span>einmal vorbereiten</span>
        </div>
      </div>
      {k.kosten.unbekannt.length > 0 && <p className="leise klein abstand-oben">Ohne Preis: {k.kosten.unbekannt.join(', ')}</p>}

      {partner.length > 0 && (
        <section className="abschnitt">
          <h3>Passt zu eurem Vorrat</h3>
          <p className="chips">{partner.map((s) => <span key={s.id} className={`chip-statisch f-${s.farbe}`}><span className="farbpunkt inline-punkt" aria-hidden="true" /> {s.name}</span>)}</p>
        </section>
      )}
      <p className="vorteil"><Icon name="funken" groesse={16} /> {k.vorteil}</p>

      {k.schritte.length > 0 && (
        <details className="gericht-details">
          <summary>Zubereitung</summary>
          <ol className="schritte">{k.schritte.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </details>
      )}

      <div className="abschnitt">
        {!uebernommen ? (
          <button type="button" className="knopf haupt" onClick={onUebernehmen}>
            <Icon name="plus" /> Komponente übernehmen
          </button>
        ) : (
          <p className="erfolg-zeile"><Icon name="haken" groesse={18} /> Als Sorte angelegt</p>
        )}
        {planung && (
          <button type="button" className={`knopf breit abstand-oben${uebernommen ? ' haupt' : ''}`} onClick={onVormerken} disabled={laeuft}>
            <Icon name="kalender" groesse={18} /> {fehlt.length ? 'Vormerken & Fehlendes auf die Einkaufsliste' : 'Zum Herstellen vormerken'}
          </button>
        )}
        <p className="leise klein abstand-oben">Nichts wird automatisch gespeichert. In den Vorrat kommt die Komponente erst, wenn sie wirklich hergestellt ist.</p>
      </div>
    </Blatt>
  );
}

/** Herstellen: Zutaten entnehmen und die fertige Komponente einbuchen – in einem Schritt. */
function HerstellenBlatt({ plan, ziel, bestand, sorten, onFertig, onSchliessen }: {
  plan: Plan; ziel: Sorte; bestand: Sorte[]; sorten: VorratSorte[];
  onFertig: (text: string, rueckgaengig: () => Promise<unknown>) => void; onSchliessen: () => void;
}) {
  const k = plan.daten.komponente!;
  const start = (() => {
    const posten: EntnahmePosten[] = [];
    const ohne: string[] = [];
    for (const z of k.zutaten) {
      if (z.quelle === 'grundausstattung' || z.quelle === 'kuehlschrank') continue;
      const s = findeSorte({ name: z.name, block_typ_id: z.block_typ_id }, sorten);
      const m = s && z.menge !== null ? inSorteneinheit(z.menge, z.einheit, s) : null;
      if (!s || m === null || s.id === ziel.id) {
        ohne.push(z.name);
        continue;
      }
      const schon = posten.find((p) => p.block_typ_id === s.id);
      if (schon) schon.menge = Math.min(verwendbar(s), schon.menge + m);
      else posten.push({ block_typ_id: s.id, name: s.name, menge: Math.min(m, verwendbar(s)), einheit: s.einheit, art: s.art });
    }
    return { posten, ohne: [...new Set(ohne)] };
  })();
  const [posten, setPosten] = useState<EntnahmePosten[]>(start.posten);
  const pm = portionMengeVon(ziel);
  const [portionen, setPortionen] = useState(k.portionen);
  const [ablauf, setAblauf] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const einheit = einheitVon(ziel);
  const menge = einheit === 'portion' ? portionen : portionen * pm;

  async function los() {
    setLaeuft(true);
    setFehler(null);
    try {
      const aktiv = posten.filter((p) => p.menge > 0);
      const ids = await herstellen(aktiv, ziel.id, menge, ablauf || null, plan.id);
      onFertig(`${ziel.name}: +${mengeText(menge, einheit)} im Vorrat.`, () => kochenRueckgaengig(ids, plan.id));
    } catch (e) {
      setFehler(fehlerText(e));
      setLaeuft(false);
    }
  }

  return (
    <Blatt titel={`${k.name} herstellen`} untertitel={`kommt als „${ziel.name}“ in den Vorrat`} onSchliessen={onSchliessen}>
      <section className="abschnitt erstes">
        <h3>Wird aus dem Vorrat entnommen</h3>
        {posten.length ? <PostenListe posten={posten} bestand={bestand} onAendern={setPosten} /> : <p className="leise klein">Nichts aus dem Vorrat.</p>}
        {start.ohne.length > 0 && <p className="leise klein abstand-oben">Nicht als Sorte erfasst, wird nicht gebucht: {start.ohne.join(', ')}.</p>}
      </section>
      <section className="abschnitt">
        <h3>Ergibt</h3>
        <div className="auftau-wahl">
          <div className="stepper">
            <button type="button" className="icon-knopf klein" aria-label="Weniger Portionen" disabled={portionen <= 1} onClick={() => setPortionen((n) => n - 1)}>
              <Icon name="minus" groesse={16} />
            </button>
            <strong>{portionen}</strong>
            <button type="button" className="icon-knopf klein" aria-label="Mehr Portionen" disabled={portionen >= 48} onClick={() => setPortionen((n) => n + 1)}>
              <Icon name="plus" groesse={16} />
            </button>
          </div>
          <span className="leise klein">{portionen === 1 ? 'Portion' : 'Portionen'}{einheit !== 'portion' ? ` = ${mengeText(menge, einheit)}` : ''}</span>
        </div>
        <label className="feld feld-inline abstand-oben">
          <span>Haltbar bis <small>(optional)</small></span>
          <input type="date" value={ablauf} min={heuteIso()} onChange={(e) => setAblauf(e.target.value)} />
        </label>
      </section>
      {fehler && <p className="fehlertext">{fehler}</p>}
      <div className="abschnitt">
        <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => void los()}>
          <Icon name="pfanne" /> {laeuft ? 'Bucht …' : 'Hergestellt – einbuchen'}
        </button>
        <p className="leise klein abstand-oben">Eine Buchung: Zutaten raus, Komponente rein. Die Kosten der Zutaten werden nicht noch einmal als Einkauf gezählt.</p>
      </div>
    </Blatt>
  );
}
