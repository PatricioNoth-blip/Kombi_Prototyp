// Rahmen der App: fünf Bereiche (Start, Essen, Vorrat, Produktion, Einkauf), die beim Wechsel ihren
// Zustand behalten, plus die gemeinsamen Daten. Einkaufsliste, Reservierungen und Auftau-Hinweise
// werden hier EINMAL aus Vorrat und Plänen berechnet und an alle Bereiche weitergegeben –
// so rechnen alle mit denselben Zahlen. Adressen (#/vorrat/gefrierfach) und „Zurück“ funktionieren wie gewohnt.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import type { Gericht } from '../supabase/functions/_shared/kombi/typen.ts';
import { Start, useLokaleIdeen } from './Start';
import { Vorrat } from './Vorrat';
import { SorteBlatt } from './SorteBlatt';
import { Einfrieren } from './Einfrieren';
import { SorteFormular } from './Sorten';
import { Essen } from './Essen';
import { Produktion } from './Produktion';
import { Einkauf } from './Einkauf';
import { Auftauen } from './Auftauen';
import { KochAnsicht } from './KochAnsicht';
import { Blatt } from './Blatt';
import { Icon, type IconName } from './Icon';
import { buchungsVerb } from './farben';
import { heuteIso, mengeText } from './format';
import { alsVorratSorte, einkaufen, einkaufRueckgaengig, eintragHinzufuegen, ladeHaushalt, LEER, naehrwerteGericht, planBedarf, type Haushaltsdaten } from './haushalt';
import { berechneEinkaufsliste, kategorieFuer } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { auftauVorschlaege, heuteAuftauen, reserviertAusser } from '../supabase/functions/_shared/kombi/planung.ts';
import { gruss } from './startseite';
import {
  BEREICHE, hashVon, ladeNav, navigiere, neuerEintrag, routeAus, speichereNav, type Bereich, type NavAktion,
} from './navigation';

type Meldung = { text: string; fehler?: boolean; rueckgaengig?: () => Promise<unknown> };
const SPEICHER = 'kombi-ansicht';

function anfangsNavigation() {
  let gemerkt: string | null = null;
  try {
    gemerkt = localStorage.getItem(SPEICHER);
  } catch {
    // ohne Speicher: einfach beim Start beginnen
  }
  return ladeNav(gemerkt, typeof location === 'undefined' ? '' : location.hash);
}

const TITEL: Record<Bereich, string> = { start: '', essen: 'Essen', vorrat: 'Vorrat', produktion: 'Produktion', einkauf: 'Einkauf' };
const KOPF_ICON: Record<Bereich, IconName | null> = { start: null, essen: 'essen', vorrat: 'blatt', produktion: 'topf', einkauf: 'wagen' };

export function Inventar() {
  const [bestand, setBestand] = useState<Sorte[] | null>(null);
  const [baukasten, setBaukasten] = useState(true);
  const [haushalt, setHaushalt] = useState<Haushaltsdaten | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(navigiere, undefined, anfangsNavigation);
  const [bearbeiteSorteId, setBearbeiteSorteId] = useState<number | null>(null);
  const [neueSorte, setNeueSorte] = useState(false);
  const [plusMenue, setPlusMenue] = useState(false);
  // null = Dialog zu; sorteId null = Sorte muss noch gewählt werden
  const [einfrierenDialog, setEinfrierenDialog] = useState<{ sorteId: number | null } | null>(null);
  const [kochen, setKochen] = useState<{ g: Gericht; planId: string | null } | null>(null);
  const [laeuft, setLaeuft] = useState<Set<number>>(new Set());
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [gescrollt, setGescrollt] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const laden = useCallback(async () => {
    try {
      const [b, h] = await Promise.all([api.ladeBestand(), ladeHaushalt()]);
      setBestand(b);
      setHaushalt(h);
      setBaukasten(await api.hatBaukasten(b));
      setLadefehler(null);
    } catch (e) {
      setLadefehler(fehlerText(e));
    }
  }, []);

  // Beim Start und jedes Mal, wenn die App wieder in den Vordergrund kommt,
  // neu laden – so sehen alle immer den aktuellen Bestand.
  useEffect(() => {
    void laden();
    const beiRueckkehr = () => {
      if (document.visibilityState === 'visible') void laden();
    };
    document.addEventListener('visibilitychange', beiRueckkehr);
    window.addEventListener('online', beiRueckkehr);
    return () => {
      document.removeEventListener('visibilitychange', beiRueckkehr);
      window.removeEventListener('online', beiRueckkehr);
    };
  }, [laden]);

  useEffect(() => {
    const beiScroll = () => setGescrollt(window.scrollY > 8);
    window.addEventListener('scroll', beiScroll, { passive: true });
    return () => window.removeEventListener('scroll', beiScroll);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // ───────── Adresse und Verlauf ─────────
  // Jede Ansicht hat eine Adresse. Neuer Bereich, Lagerort oder geöffnete Sorte = neuer Verlaufseintrag
  // (Zurück führt dorthin zurück); Filter und Suche ersetzen nur die Adresse.
  const vorher = useRef(nav);
  const ersetzen = useRef(false);
  useEffect(() => {
    const alt = vorher.current;
    vorher.current = nav;
    const hash = hashVon(nav);
    const nurErsetzen = ersetzen.current;
    ersetzen.current = false;
    if (hash === window.location.hash) return;
    if (alt !== nav && !nurErsetzen && neuerEintrag(alt, nav)) window.history.pushState({ kombi: true }, '', hash);
    else window.history.replaceState(window.history.state, '', hash);
  }, [nav]);

  useEffect(() => {
    const beiZurueck = () => {
      ersetzen.current = true;
      dispatch({ typ: 'route', route: routeAus(window.location.hash) });
    };
    window.addEventListener('popstate', beiZurueck);
    return () => window.removeEventListener('popstate', beiZurueck);
  }, []);

  /** Eine Ebene zurück: über den Verlauf, wenn wir ihn selbst angelegt haben – sonst direkt. */
  function zurueck(ersatz: NavAktion) {
    if (window.history.state?.kombi) window.history.back();
    else {
      ersetzen.current = true;
      dispatch(ersatz);
    }
  }

  // Filter (Essen/Woche) bleiben für den nächsten Start gemerkt.
  useEffect(() => {
    try {
      localStorage.setItem(SPEICHER, speichereNav(nav));
    } catch {
      // nur Komfort
    }
  }, [nav]);

  // Jeder Bereich kommt an der Stelle zurück, an der man ihn verlassen hat.
  useEffect(() => {
    window.scrollTo({ top: nav.scroll[nav.bereich] });
  }, [nav.bereich, nav.scroll]);

  function wechsle(b: Bereich) {
    dispatch({ typ: 'wechsle', bereich: b, scroll: window.scrollY });
  }

  function zeige(m: Meldung) {
    window.clearTimeout(timer.current);
    setMeldung(m);
    timer.current = window.setTimeout(() => setMeldung(null), m.fehler ? 7000 : m.rueckgaengig ? 6000 : 4000);
  }
  const melde = (text: string, rueckgaengig?: () => Promise<unknown>) => zeige({ text, rueckgaengig });

  /** Bucht und bietet „Rückgängig“ an; aktion liefert die passende Rücknahme. */
  async function buchen(sorte: Sorte, aktion: () => Promise<() => Promise<unknown>>, text: string) {
    setLaeuft((l) => new Set(l).add(sorte.id));
    try {
      const rueck = await aktion();
      zeige({ text, rueckgaengig: rueck });
    } catch (e) {
      zeige({ text: fehlerText(e), fehler: true });
    } finally {
      setLaeuft((l) => {
        const neu = new Set(l);
        neu.delete(sorte.id);
        return neu;
      });
      await laden();
    }
  }

  async function rueckgaengigMachen(f: () => Promise<unknown>) {
    window.clearTimeout(timer.current);
    setMeldung(null);
    try {
      await f();
      zeige({ text: 'Rückgängig gemacht.' });
    } catch (e) {
      zeige({ text: fehlerText(e), fehler: true });
    } finally {
      await laden();
    }
  }

  const oeffneSorte = (s: Sorte) => dispatch({ typ: 'sorte', id: s.id });
  const schliesseSorte = () => zurueck({ typ: 'sorte', id: null });

  /** menge in der Einheit der Sorte (Portionen, Stück, g, ml) */
  function entnehmen(sorte: Sorte, menge: number) {
    if (nav.sorte === sorte.id) schliesseSorte();
    void buchen(sorte, async () => {
      const ids = await api.entnehmen(sorte.id, menge);
      return () => api.rueckgaengig(ids);
    }, `−${mengeText(menge, sorte.einheit ?? 'portion')} ${sorte.name}`);
  }

  function einfrieren(sorte: Sorte, menge: number, ablaufAm: string | null, preisCent: number | null) {
    setEinfrierenDialog(null);
    const text = `+${mengeText(menge, sorte.einheit ?? 'portion')} ${sorte.name} ${buchungsVerb(sorte.lagerort).partizip}`;
    void buchen(sorte, async () => {
      // mit Preis: zählt als Einkauf (Ausgaben) und gibt der Charge ihre echten Kosten
      if (preisCent !== null && h.protokoll) {
        const id = await einkaufen(sorte.id, menge, ablaufAm, preisCent);
        return () => einkaufRueckgaengig(id);
      }
      const ids = await api.einfrieren(sorte.id, menge, ablaufAm);
      return () => api.rueckgaengig(ids);
    }, text);
  }

  // ───────── Gemeinsame Berechnungen ─────────
  const heute = heuteIso();
  const h = haushalt ?? LEER;
  const sorten = useMemo(() => (bestand ?? []).map(alsVorratSorte), [bestand]);
  const planBedarfe = useMemo(() => h.plaene.map(planBedarf), [h.plaene]);
  const liste = useMemo(
    () => berechneEinkaufsliste({ sorten, plaene: planBedarfe, eintraege: h.eintraege, status: h.status }),
    [sorten, planBedarfe, h.eintraege, h.status],
  );
  const reserviertMitPlan = useMemo(() => reserviertAusser(liste.verteilung.pro_plan, h.plaene, null), [liste, h.plaene]);
  const auftauHinweise = useMemo(() => auftauVorschlaege(planBedarfe, sorten, h.auftauen, heute), [planBedarfe, sorten, h.auftauen, heute]);
  const ideen = useLokaleIdeen(bestand, liste.verteilung.reserviert);
  const offeneEinkaeufe = liste.zeilen.filter((z) => z.status === 'offen').length;
  const auftauFaellig = heuteAuftauen(h.auftauen, heute).length + auftauHinweise.filter((v) => v.auftauen_am <= heute).length;

  // Migration „bilder_zutaten“: die View liefert dann image_url und zutat
  const bilderMigration = !!bestand?.length && 'image_url' in bestand[0];
  const finde = (id: number | null) => bestand?.find((s) => s.id === id) ?? null;
  const offeneSorte = finde(nav.sorte);
  const bearbeiteSorte = finde(bearbeiteSorteId);

  const auftauenBereich = h.planung && bestand ? (
    <Auftauen bestand={bestand} plaene={h.plaene} vorschlaege={auftauHinweise} eintraege={h.auftauen} heute={heute}
      onMeldung={(t) => zeige({ text: t })} onGeaendert={() => void laden()} />
  ) : null;

  async function fehlendesMerken(g: Gericht) {
    for (const f of g.fehlt) {
      await eintragHinzufuegen({
        name: f.name, menge: f.menge, einheit: f.einheit, kategorie: kategorieFuer(f.name), quelle: 'rezept', grund: `für ${g.name}`,
      });
    }
    void laden();
  }

  // Migrationen, die in Supabase noch fehlen – ruhig auf dem Start erklärt, alles andere läuft weiter
  const fehlend = !bestand || !haushalt ? [] : [
    !baukasten && '„baukasten“ (Art, Einheit, Ablaufdatum, geöffnet)',
    !h.planung && '„planung_einkauf“ (Einkaufsliste, Woche, Auftauen, Produktion)',
    h.planung && !h.protokoll && '„kosten_naehrwerte“ (Ausgaben, Kosten je Mahlzeit, Kalorien)',
    h.planung && !h.ausgaben && '„ausgaben“ (sonstige Ausgaben)',
    h.ausgaben && !bilderMigration && '„bilder_zutaten“ (eigene Bilder, Bild-Cache, Zutaten)',
  ].filter((x): x is string => !!x);

  const datumText = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const titel = nav.bereich === 'start' ? gruss(new Date().getHours()) : TITEL[nav.bereich];
  const untertitel = !bestand
    ? ''
    : nav.bereich === 'start'
      ? `Dein Haushalt · ${datumText}`
      : nav.bereich === 'vorrat'
        ? 'Alles im Blick · Weniger verschwenden'
        : nav.bereich === 'essen'
          ? nav.essen.ansicht === 'woche' ? 'Flexibel planen – entnommen wird erst beim Kochen' : 'Was möchtest du jetzt essen?'
          : nav.bereich === 'produktion'
            ? 'Aus vorhandenen Zutaten etwas Neues herstellen.'
            : 'Was fehlt – verrechnet mit dem Vorrat';
  const kopfIcon = KOPF_ICON[nav.bereich];
  const abends = new Date().getHours() >= 18 || new Date().getHours() < 5;

  return (
    <div className={`app ansicht-${nav.bereich}`}>
      <header className={`kopf${gescrollt ? ' gescrollt' : ''}`}>
        <div className="kopf-zeile">
          {kopfIcon && <span className="kopf-icon" aria-hidden="true"><Icon name={kopfIcon} groesse={26} /></span>}
          <div className="kopf-text">
            <h1>{titel}{nav.bereich === 'start' && <Icon name={abends ? 'mond' : 'sonne'} groesse={30} />}</h1>
            {untertitel && <p className="kopf-unter">{untertitel}</p>}
          </div>
          {nav.bereich === 'vorrat' && bestand && (
            <button
              type="button"
              className="kopf-aktion"
              onClick={() => (bestand.length ? setPlusMenue(true) : setNeueSorte(true))}
              aria-label="Hinzufügen"
              title="Hinzufügen"
            >
              <Icon name="plus" groesse={24} />
            </button>
          )}
        </div>
      </header>

      <main className="inhalt">
        {ladefehler && (
          <p className="fehlerbox">
            {ladefehler}{' '}
            <button type="button" className="link inline" onClick={() => void laden()}>
              Nochmal versuchen
            </button>
          </p>
        )}
        {nav.bereich === 'start' && fehlend.length > 0 && (
          <details className="hinweisbox">
            <summary>Noch nicht alles eingerichtet</summary>
            <p className="klein abstand-oben">
              In Supabase fehlen noch Migrationen: {fehlend.join(', ')}. Bis dahin läuft der Rest wie gewohnt – siehe README.
            </p>
          </details>
        )}
        {bestand === null ? (
          !ladefehler && <p className="leise laden">Lade …</p>
        ) : (
          <>
            <div hidden={nav.bereich !== 'start'}>
              <Start
                bestand={bestand}
                heute={heute}
                h={h}
                liste={liste}
                proPlan={liste.verteilung.pro_plan}
                auftauen={nav.bereich === 'start' ? auftauenBereich : null}
                auftauFaellig={auftauFaellig}
                ideen={ideen}
                onKochen={(g, planId) => setKochen({ g, planId })}
                onBereich={wechsle}
                onMeldung={melde}
                onGeaendert={() => void laden()}
              />
            </div>
            <div hidden={nav.bereich !== 'vorrat'}>
              <Vorrat
                bestand={bestand}
                heute={heute}
                nav={nav.vorrat}
                onNav={(teil) => dispatch({ typ: 'vorrat', teil })}
                onZurueck={() => zurueck({ typ: 'vorrat', teil: { ort: null, suche: '' } })}
                laeuft={laeuft}
                reserviert={liste.verteilung.reserviert}
                auftauen={nav.bereich === 'vorrat' ? auftauenBereich : null}
                nutzung={h.nutzung}
                onOeffnen={oeffneSorte}
                onEntnehmen={entnehmen}
              />
            </div>
            <div hidden={nav.bereich !== 'produktion'}>
              <Produktion
                bestand={bestand}
                sorten={sorten}
                planung={h.planung}
                protokoll={h.protokoll}
                plaene={h.plaene}
                proPlan={liste.verteilung.pro_plan}
                nutzung={h.nutzung}
                reserviert={liste.verteilung.reserviert}
                ideen={ideen?.komponenten ?? null}
                heute={heute}
                onOeffnen={oeffneSorte}
                onWoche={() => dispatch({ typ: 'route', route: { bereich: 'essen', ort: null, art: null, ansicht: 'woche', sorte: null } })}
                onMeldung={melde}
                onGeaendert={() => void laden()}
              />
            </div>
            <div hidden={nav.bereich !== 'einkauf'}>
              <Einkauf
                liste={liste}
                sorten={sorten}
                bestand={bestand}
                baukasten={baukasten}
                planung={h.planung}
                onMeldung={melde}
                onGeaendert={() => void laden()}
              />
            </div>
          </>
        )}
        {/* bleibt beim Bereichswechsel erhalten, damit die Vorschlags-Session nicht verloren geht */}
        <div hidden={nav.bereich !== 'essen'}>
          <Essen
            bestand={bestand ?? []}
            baukasten={baukasten}
            planung={h.planung}
            heute={heute}
            plaene={h.plaene}
            proPlan={liste.verteilung.pro_plan}
            reserviert={liste.verteilung.reserviert}
            auftauEintraege={h.auftauen}
            auftauen={nav.bereich === 'essen' ? auftauenBereich : null}
            nav={nav.essen}
            onNav={(teil) => dispatch({ typ: 'essen', teil })}
            onKochen={(g, planId) => setKochen({ g, planId })}
            onMeldung={melde}
            onGeaendert={() => void laden()}
          />
        </div>
      </main>

      <div className="unten">
        <nav className="tabbar" aria-label="Bereiche">
          {BEREICHE.map((b) => (
            <button
              key={b.id}
              type="button"
              className={nav.bereich === b.id ? 'aktiv' : ''}
              aria-current={nav.bereich === b.id ? 'page' : undefined}
              onClick={() => wechsle(b.id)}
            >
              <span className="tab-icon">
                <Icon name={b.icon} groesse={24} />
                {b.id === 'einkauf' && offeneEinkaeufe > 0 && <span className="tab-zahl" aria-label={`${offeneEinkaeufe} offen`}>{offeneEinkaeufe}</span>}
              </span>
              <span>{b.name}</span>
            </button>
          ))}
        </nav>
      </div>

      {plusMenue && (
        <Blatt titel="Hinzufügen" onSchliessen={() => setPlusMenue(false)}>
          <ul className="liste mit-icon">
            <li>
              <button type="button" className="zeile" onClick={() => {
                setPlusMenue(false);
                setEinfrierenDialog({ sorteId: null });
              }}>
                <span className="icon-kachel"><Icon name="plus" groesse={18} /></span>
                <span className="zeile-haupt">
                  <span className="zeile-titel">Einbuchen</span>
                  <span className="zeile-meta">Gekauftes oder Vorgekochtes in den Vorrat</span>
                </span>
              </button>
            </li>
            <li>
              <button type="button" className="zeile" onClick={() => {
                setPlusMenue(false);
                setNeueSorte(true);
              }}>
                <span className="icon-kachel"><Icon name="sorten" groesse={18} /></span>
                <span className="zeile-haupt">
                  <span className="zeile-titel">Neue Sorte</span>
                  <span className="zeile-meta">Zutat, Komponente oder Komplettgericht anlegen</span>
                </span>
              </button>
            </li>
          </ul>
        </Blatt>
      )}

      {neueSorte && (
        <SorteFormular
          sorte={null}
          baukasten={baukasten}
          planung={h.planung}
          naehrwerte={h.protokoll}
          bilder={bilderMigration}
          onFertig={(text) => {
            setNeueSorte(false);
            zeige({ text });
            void laden();
          }}
          onSchliessen={() => setNeueSorte(false)}
        />
      )}

      {offeneSorte && (
        <SorteBlatt
          sorte={offeneSorte}
          bestand={bestand ?? []}
          baukasten={baukasten}
          planung={h.planung}
          heute={heute}
          laeuft={laeuft.has(offeneSorte.id)}
          reserviert={reserviertMitPlan.get(offeneSorte.id) ?? null}
          nutzung={h.nutzung.find((n) => n.block_typ_id === offeneSorte.id) ?? null}
          onEntnehmen={(n) => entnehmen(offeneSorte, n)}
          onEinfrieren={() => {
            schliesseSorte();
            setEinfrierenDialog({ sorteId: offeneSorte.id });
          }}
          onBearbeiten={() => {
            schliesseSorte();
            setBearbeiteSorteId(offeneSorte.id);
          }}
          onOeffnen={oeffneSorte}
          onGeaendert={(text) => {
            zeige({ text });
            void laden();
          }}
          onFehler={(text) => zeige({ text, fehler: true })}
          onSchliessen={schliesseSorte}
        />
      )}

      {bearbeiteSorte && (
        <SorteFormular
          sorte={bearbeiteSorte}
          baukasten={baukasten}
          planung={h.planung}
          naehrwerte={h.protokoll}
          bilder={bilderMigration}
          onFertig={(text) => {
            setBearbeiteSorteId(null);
            zeige({ text });
            void laden();
          }}
          onSchliessen={() => setBearbeiteSorteId(null)}
        />
      )}

      {einfrierenDialog && bestand && (
        <Einfrieren
          bestand={bestand}
          baukasten={baukasten}
          startSorte={finde(einfrierenDialog.sorteId)}
          mitPreis={h.protokoll}
          onEinfrieren={einfrieren}
          onNeueSorte={() => {
            setEinfrierenDialog(null);
            setNeueSorte(true);
          }}
          onSchliessen={() => setEinfrierenDialog(null)}
        />
      )}

      {kochen && bestand && (
        <KochAnsicht
          gericht={kochen.g}
          naehrwerte={naehrwerteGericht(kochen.g, bestand)}
          planId={kochen.planId}
          bestand={bestand}
          reserviert={reserviertAusser(liste.verteilung.pro_plan, h.plaene, kochen.planId)}
          planung={h.planung}
          protokoll={h.protokoll}
          onGekocht={() => void laden()}
          onMeldung={melde}
          onFehlendesMerken={h.planung ? () => fehlendesMerken(kochen.g) : undefined}
          onSchliessen={() => setKochen(null)}
        />
      )}

      <div className="meldung-bereich" aria-live="polite">
        {meldung && (
          <div className={`meldung${meldung.fehler ? ' fehler' : ''}`} role={meldung.fehler ? 'alert' : 'status'}>
            <span>{meldung.text}</span>
            {meldung.rueckgaengig && (
              <button type="button" onClick={() => void rueckgaengigMachen(meldung.rueckgaengig!)}>
                Rückgängig
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
