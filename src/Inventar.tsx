// Rahmen der App: vier Bereiche (Essen, Vorrat, Komponenten, Einkauf), die beim Wechsel ihren
// Zustand behalten, plus die gemeinsamen Daten. Einkaufsliste, Reservierungen und Auftau-Hinweise
// werden hier EINMAL aus Vorrat und Plänen berechnet und an alle Bereiche weitergegeben –
// so rechnen alle mit denselben Zahlen.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import { Vorrat } from './Vorrat';
import { SorteBlatt } from './SorteBlatt';
import { Einfrieren } from './Einfrieren';
import { SorteFormular } from './Sorten';
import { Essen } from './Essen';
import { Komponenten } from './Komponenten';
import { Einkauf, kostenText as einkaufKosten } from './Einkauf';
import { Auftauen } from './Auftauen';
import { Icon } from './Icon';
import { buchungsVerb } from './farben';
import { artVon, heuteIso, mengeText } from './format';
import { alsVorratSorte, ladeHaushalt, LEER, planBedarf, type Haushaltsdaten } from './haushalt';
import { berechneEinkaufsliste } from '../supabase/functions/_shared/kombi/einkaufsliste.ts';
import { auftauVorschlaege, reserviertAusser } from '../supabase/functions/_shared/kombi/planung.ts';
import { BEREICHE, ladeNav, navigiere, speichereNav, type Bereich } from './navigation';

type Meldung = { text: string; fehler?: boolean; rueckgaengig?: () => Promise<unknown> };
const SPEICHER = 'kombi-ansicht';

function gemerkteNavigation() {
  try {
    return ladeNav(localStorage.getItem(SPEICHER));
  } catch {
    return ladeNav(null);
  }
}

export function Inventar() {
  const [bestand, setBestand] = useState<Sorte[] | null>(null);
  const [baukasten, setBaukasten] = useState(true);
  const [haushalt, setHaushalt] = useState<Haushaltsdaten | null>(null);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [nav, dispatch] = useReducer(navigiere, undefined, gemerkteNavigation);
  const [offeneSorteId, setOffeneSorteId] = useState<number | null>(null);
  const [bearbeiteSorteId, setBearbeiteSorteId] = useState<number | null>(null);
  const [neueSorte, setNeueSorte] = useState(false);
  // null = Dialog zu; sorteId null = Sorte muss noch gewählt werden
  const [einfrierenDialog, setEinfrierenDialog] = useState<{ sorteId: number | null } | null>(null);
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

  // Bereich, Filter und geöffneter Lagerort bleiben für den nächsten Start gemerkt.
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

  async function buchen(sorte: Sorte, aktion: () => Promise<number[]>, text: string) {
    setLaeuft((l) => new Set(l).add(sorte.id));
    try {
      const ids = await aktion();
      zeige({ text, rueckgaengig: () => api.rueckgaengig(ids) });
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

  /** menge in der Einheit der Sorte (Portionen, Stück, g, ml) */
  function entnehmen(sorte: Sorte, menge: number) {
    setOffeneSorteId(null);
    void buchen(sorte, () => api.entnehmen(sorte.id, menge), `−${mengeText(menge, sorte.einheit ?? 'portion')} ${sorte.name}`);
  }

  function einfrieren(sorte: Sorte, menge: number, ablaufAm: string | null) {
    setEinfrierenDialog(null);
    void buchen(
      sorte,
      () => api.einfrieren(sorte.id, menge, ablaufAm),
      `+${mengeText(menge, sorte.einheit ?? 'portion')} ${sorte.name} ${buchungsVerb(sorte.lagerort).partizip}`,
    );
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
  const offeneEinkaeufe = liste.zeilen.filter((z) => z.status === 'offen').length;

  const finde = (id: number | null) => bestand?.find((s) => s.id === id) ?? null;
  const offeneSorte = finde(offeneSorteId);
  const bearbeiteSorte = finde(bearbeiteSorteId);
  const bereich = BEREICHE.find((b) => b.id === nav.bereich)!;

  const auftauenBereich = h.planung && bestand ? (
    <Auftauen bestand={bestand} plaene={h.plaene} vorschlaege={auftauHinweise} eintraege={h.auftauen} heute={heute}
      onMeldung={(t) => zeige({ text: t })} onGeaendert={() => void laden()} />
  ) : null;

  const untertitel = !bestand
    ? ''
    : nav.bereich === 'vorrat'
      ? `${bestand.filter((s) => s.anzahl > 0).length} von ${bestand.length} Sorten da`
      : nav.bereich === 'essen'
        ? nav.essen.ansicht === 'woche' ? 'Flexibel planen – entnommen wird erst beim Kochen' : 'Was machen wir aus dem, was da ist?'
        : nav.bereich === 'komponenten'
          ? `${bestand.filter((s) => artVon(s) === 'komponente').length} Komponenten im Baukasten`
          : h.planung ? `${offeneEinkaeufe} offen · verrechnet mit dem Vorrat` : '';

  return (
    <div className={`app ansicht-${nav.bereich}`}>
      <header className={`kopf${gescrollt ? ' gescrollt' : ''}`}>
        <div className="kopf-zeile">
          <div>
            <h1>{bereich.titel}</h1>
            {untertitel && <p className="kopf-unter">{untertitel}</p>}
          </div>
          <button type="button" className="icon-knopf" onClick={() => void laden()} aria-label="Neu laden">
            <Icon name="neu" />
          </button>
        </div>
      </header>

      <main className="inhalt">
        {ladefehler && (
          <p className="fehlerbox">
            {ladefehler}{' '}
            <button type="button" className="link" onClick={() => void laden()}>
              Nochmal versuchen
            </button>
          </p>
        )}
        {!baukasten && bestand && nav.bereich !== 'essen' && (
          <p className="hinweisbox">
            Neu: Art, Einheit, Zusammensetzung, Ablaufdatum und „geöffnet“. Dafür in Supabase die Migration „baukasten“
            einspielen (siehe README). Bis dahin läuft alles wie bisher.
          </p>
        )}
        {baukasten && haushalt && !haushalt.planung && bestand && (nav.bereich === 'vorrat' || nav.bereich === 'komponenten') && (
          <p className="hinweisbox">
            Neu: Einkaufsliste, Wochenplanung, Auftauen und Herstellen. Dafür in Supabase die Migration „planung_einkauf“
            einspielen (siehe README). Alles andere läuft schon.
          </p>
        )}
        {bestand === null ? (
          !ladefehler && <p className="leise laden">Lade Vorrat …</p>
        ) : (
          <>
            <div hidden={nav.bereich !== 'vorrat'}>
              <Vorrat
                bestand={bestand}
                heute={heute}
                nav={nav.vorrat}
                onNav={(teil) => dispatch({ typ: 'vorrat', teil })}
                laeuft={laeuft}
                reserviert={liste.verteilung.reserviert}
                einkauf={h.planung ? { offen: offeneEinkaeufe, kosten: einkaufKosten(liste.kosten) } : null}
                auftauen={auftauenBereich}
                onOeffnen={(s) => setOffeneSorteId(s.id)}
                onEntnehmen={entnehmen}
                onZumEinkauf={() => wechsle('einkauf')}
              />
            </div>
            <div hidden={nav.bereich !== 'komponenten'}>
              <Komponenten
                bestand={bestand}
                sorten={sorten}
                baukasten={baukasten}
                planung={h.planung}
                plaene={h.plaene}
                proPlan={liste.verteilung.pro_plan}
                nutzung={h.nutzung}
                reserviert={liste.verteilung.reserviert}
                nav={nav.komponenten}
                onNav={(teil) => dispatch({ typ: 'komponenten', teil })}
                onOeffnen={(s) => setOffeneSorteId(s.id)}
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
                nav={nav.einkauf}
                onNav={(teil) => dispatch({ typ: 'einkauf', teil })}
                onMeldung={melde}
                onGeaendert={() => void laden()}
              />
            </div>
          </>
        )}
        {/* bleibt beim Reiterwechsel erhalten, damit die Session nicht verloren geht */}
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
            auftauen={auftauenBereich}
            nav={nav.essen}
            onNav={(teil) => dispatch({ typ: 'essen', teil })}
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
        {nav.bereich === 'vorrat' && bestand && (
          <button
            type="button"
            className="aktion-knopf"
            onClick={() => (bestand.length ? setEinfrierenDialog({ sorteId: null }) : setNeueSorte(true))}
            aria-label={bestand.length ? 'Einbuchen' : 'Neue Sorte'}
            title={bestand.length ? 'Einbuchen' : 'Neue Sorte'}
          >
            <Icon name="plus" groesse={28} />
          </button>
        )}
      </div>

      {neueSorte && (
        <SorteFormular
          sorte={null}
          baukasten={baukasten}
          planung={h.planung}
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
            setOffeneSorteId(null);
            setEinfrierenDialog({ sorteId: offeneSorte.id });
          }}
          onBearbeiten={() => {
            setOffeneSorteId(null);
            setBearbeiteSorteId(offeneSorte.id);
          }}
          onOeffnen={(s) => setOffeneSorteId(s.id)}
          onGeaendert={(text) => {
            zeige({ text });
            void laden();
          }}
          onFehler={(text) => zeige({ text, fehler: true })}
          onSchliessen={() => setOffeneSorteId(null)}
        />
      )}

      {bearbeiteSorte && (
        <SorteFormular
          sorte={bearbeiteSorte}
          baukasten={baukasten}
          planung={h.planung}
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
          onEinfrieren={einfrieren}
          onNeueSorte={() => {
            setEinfrierenDialog(null);
            setNeueSorte(true);
          }}
          onSchliessen={() => setEinfrierenDialog(null)}
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
