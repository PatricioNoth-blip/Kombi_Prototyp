import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { fehlerText, type Sorte } from './api';
import { Uebersicht } from './Uebersicht';
import { SorteBlatt } from './SorteBlatt';
import { Einfrieren } from './Einfrieren';
import { Sorten, SorteFormular } from './Sorten';
import { Essen } from './Essen';
import { BestandAktualisieren } from './BestandAktualisieren';
import { BonImport } from './BonImport';
import { Produktion } from './Produktion';
import { ProduktionBlatt, type ProduktionsVorlage } from './ProduktionBlatt';
import { produktionRueckgaengig } from './produktionApi';
import type { ImportQuelle } from '../supabase/functions/_shared/kombi/bon/typen.ts';
import { Icon, type IconName } from './Icon';
import { buchungsVerb } from './farben';
import { mengeText } from './format';

type Meldung = {
  text: string;
  fehler?: boolean;
  rueckgaengig?: number[];
  /** eigenes Rückgängig (z. B. ganze Produktion statt einzelner Bewegungen) */
  aktion?: { text: string; los: () => Promise<void> };
};
type Ansicht = 'bestand' | 'produktion' | 'essen' | 'sorten';

const REITER: { id: Ansicht; name: string; titel: string; icon: IconName }[] = [
  { id: 'bestand', name: 'Vorrat', titel: 'Vorrat', icon: 'vorrat' },
  { id: 'produktion', name: 'Produktion', titel: 'Produktion', icon: 'topf' },
  { id: 'essen', name: 'Essen', titel: 'Heute essen', icon: 'essen' },
  { id: 'sorten', name: 'Sorten', titel: 'Sorten', icon: 'sorten' },
];
const SPEICHER = 'kombi-ansicht';

function letzteAnsicht(): Ansicht {
  try {
    const a = localStorage.getItem(SPEICHER);
    return a === 'essen' || a === 'sorten' || a === 'produktion' ? a : 'bestand';
  } catch {
    return 'bestand';
  }
}

export function Inventar() {
  const [bestand, setBestand] = useState<Sorte[] | null>(null);
  const [baukasten, setBaukasten] = useState(true);
  const [ladefehler, setLadefehler] = useState<string | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>(letzteAnsicht);
  const [offeneSorteId, setOffeneSorteId] = useState<number | null>(null);
  const [bearbeiteSorteId, setBearbeiteSorteId] = useState<number | null>(null);
  const [neueSorte, setNeueSorte] = useState(false);
  // null = Dialog zu; sorteId null = Sorte muss noch gewählt werden
  const [einfrierenDialog, setEinfrierenDialog] = useState<{ sorteId: number | null } | null>(null);
  const [laeuft, setLaeuft] = useState<Set<number>>(new Set());
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [gescrollt, setGescrollt] = useState(false);
  // Bestand aktualisieren: Auswahl (Bon, E-Bon, Text, manuell) und der Bon-Import selbst
  const [aktualisieren, setAktualisieren] = useState(false);
  const [bonQuelle, setBonQuelle] = useState<ImportQuelle | null>(null);
  const [produktionVorlage, setProduktionVorlage] = useState<ProduktionsVorlage | null>(null);
  const [version, setVersion] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const laden = useCallback(async () => {
    try {
      const b = await api.ladeBestand();
      setBestand(b);
      setBaukasten(await api.hatBaukasten(b));
      setVersion((v) => v + 1);
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

  function wechsle(a: Ansicht) {
    setAnsicht(a);
    window.scrollTo({ top: 0 });
    try {
      localStorage.setItem(SPEICHER, a);
    } catch {
      // nur Komfort
    }
  }

  function zeige(m: Meldung) {
    window.clearTimeout(timer.current);
    setMeldung(m);
    timer.current = window.setTimeout(() => setMeldung(null), m.fehler ? 7000 : 5000);
  }

  async function buchen(sorte: Sorte, aktion: () => Promise<number[]>, text: string) {
    setLaeuft((l) => new Set(l).add(sorte.id));
    try {
      const ids = await aktion();
      zeige({ text, rueckgaengig: ids });
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

  async function rueckgaengigMachen(ids: number[]) {
    window.clearTimeout(timer.current);
    setMeldung(null);
    try {
      await api.rueckgaengig(ids);
      zeige({ text: 'Rückgängig gemacht.' });
    } catch (e) {
      zeige({ text: fehlerText(e), fehler: true });
    } finally {
      await laden();
    }
  }

  async function aktionAusfuehren(a: NonNullable<Meldung['aktion']>) {
    window.clearTimeout(timer.current);
    setMeldung(null);
    try {
      await a.los();
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

  const finde = (id: number | null) => bestand?.find((s) => s.id === id) ?? null;
  const offeneSorte = finde(offeneSorteId);
  const bearbeiteSorte = finde(bearbeiteSorteId);
  const reiter = REITER.find((r) => r.id === ansicht)!;

  const untertitel =
    bestand && ansicht === 'bestand'
      ? `${bestand.filter((s) => s.anzahl > 0).length} von ${bestand.length} Sorten da`
      : ansicht === 'produktion'
        ? 'Vorkochen, nachkochen, einfrieren'
      : ansicht === 'essen'
        ? 'Was machen wir aus dem, was da ist?'
        : bestand
          ? `${bestand.length} Sorten im Baukasten`
          : '';

  return (
    <div className={`app ansicht-${ansicht}`}>
      <header className={`kopf${gescrollt ? ' gescrollt' : ''}`}>
        <div className="kopf-zeile">
          <div>
            <h1>{reiter.titel}</h1>
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
        {!baukasten && ansicht !== 'essen' && bestand && (
          <p className="hinweisbox">
            Neu: Art, Einheit, Zusammensetzung, Ablaufdatum und „geöffnet“. Dafür in Supabase die Migration „baukasten“
            einspielen (siehe README). Bis dahin läuft alles wie bisher.
          </p>
        )}
        {bestand === null ? (
          !ladefehler && <p className="leise laden">Lade Vorrat …</p>
        ) : ansicht === 'bestand' ? (
          <>
          <button type="button" className="bestand-aktualisieren" onClick={() => setAktualisieren(true)}>
            <Icon name="bon" groesse={26} />
            <span>
              <strong>+ Bestand aktualisieren</strong>
              <small>Kassenbon scannen, E-Bon importieren oder manuell</small>
            </span>
          </button>
          <Uebersicht
            bestand={bestand}
            laeuft={laeuft}
            onEntnehmen={entnehmen}
            onOeffnen={(s) => setOffeneSorteId(s.id)}
          />
          </>
        ) : ansicht === 'produktion' ? (
          <Produktion
            bestand={bestand}
            version={version}
            onStarten={setProduktionVorlage}
            onMeldung={(text, fehler) => zeige({ text, fehler })}
            onBestandGeaendert={() => void laden()}
          />
        ) : ansicht === 'sorten' ? (
          <Sorten
            bestand={bestand}
            baukasten={baukasten}
            onGespeichert={(text) => {
              zeige({ text });
              void laden();
            }}
          />
        ) : null}
        {/* bleibt beim Reiterwechsel erhalten, damit die Session nicht verloren geht */}
        <div hidden={ansicht !== 'essen'}>
          <Essen
            bestand={bestand ?? []}
            baukasten={baukasten}
            onMeldung={(text, ids) => zeige({ text, rueckgaengig: ids && ids.length ? ids : undefined })}
            onBestandGeaendert={() => void laden()}
          />
        </div>
      </main>

      <div className="unten">
        <nav className="tabbar" aria-label="Bereiche">
          {REITER.map((r) => (
            <button
              key={r.id}
              type="button"
              className={ansicht === r.id ? 'aktiv' : ''}
              aria-current={ansicht === r.id ? 'page' : undefined}
              onClick={() => wechsle(r.id)}
            >
              <Icon name={r.icon} groesse={24} />
              <span>{r.name}</span>
            </button>
          ))}
        </nav>
        {ansicht === 'bestand' && bestand && bestand.length > 0 && (
          <button type="button" className="aktion-knopf" onClick={() => setEinfrierenDialog({ sorteId: null })} aria-label="Einbuchen" title="Einbuchen">
            <Icon name="plus" groesse={28} />
          </button>
        )}
        {ansicht === 'produktion' && bestand && (
          <button type="button" className="aktion-knopf" onClick={() => setProduktionVorlage({ block_typ_id: null, eingaenge: [], menge: null })} aria-label="Produktion starten" title="Produktion starten">
            <Icon name="plus" groesse={28} />
          </button>
        )}
        {ansicht === 'sorten' && bestand && (
          <button type="button" className="aktion-knopf" onClick={() => setNeueSorte(true)} aria-label="Neue Sorte" title="Neue Sorte">
            <Icon name="plus" groesse={28} />
          </button>
        )}
      </div>

      {neueSorte && (
        <SorteFormular
          sorte={null}
          baukasten={baukasten}
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
          baukasten={baukasten}
          laeuft={laeuft.has(offeneSorte.id)}
          onEntnehmen={(n) => entnehmen(offeneSorte, n)}
          onEinfrieren={() => {
            setOffeneSorteId(null);
            setEinfrierenDialog({ sorteId: offeneSorte.id });
          }}
          onBearbeiten={() => {
            setOffeneSorteId(null);
            setBearbeiteSorteId(offeneSorte.id);
          }}
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
          onFertig={(text) => {
            setBearbeiteSorteId(null);
            zeige({ text });
            void laden();
          }}
          onSchliessen={() => setBearbeiteSorteId(null)}
        />
      )}

      {aktualisieren && (
        <BestandAktualisieren
          onBon={(q) => {
            setAktualisieren(false);
            setBonQuelle(q);
          }}
          onManuell={() => {
            setAktualisieren(false);
            setEinfrierenDialog({ sorteId: null });
          }}
          onRueckgaengig={(text, fehler) => {
            zeige({ text, fehler });
            void laden();
          }}
          onSchliessen={() => setAktualisieren(false)}
        />
      )}

      {bonQuelle && bestand && (
        <BonImport
          quelle={bonQuelle}
          bestand={bestand}
          onGebucht={() => void laden()}
          onMeldung={(text, fehler) => zeige({ text, fehler })}
          onProduktion={(e) => {
            setBonQuelle(null);
            setProduktionVorlage({ block_typ_id: e.block_typ_id, eingaenge: e.eingaenge, menge: e.menge });
          }}
          onSchliessen={() => setBonQuelle(null)}
        />
      )}

      {produktionVorlage && bestand && (
        <ProduktionBlatt
          bestand={bestand}
          vorlage={produktionVorlage}
          onProduziert={(text, id) => {
            setProduktionVorlage(null);
            zeige({
              text,
              aktion: {
                text: 'Rückgängig',
                los: async () => {
                  await produktionRueckgaengig(id);
                  zeige({ text: 'Produktion rückgängig gemacht – Zutaten sind zurück im Bestand.' });
                },
              },
            });
            void laden();
          }}
          onGeplant={(text) => {
            setProduktionVorlage(null);
            zeige({ text });
            void laden();
          }}
          onMeldung={(text, fehler) => zeige({ text, fehler })}
          onSchliessen={() => setProduktionVorlage(null)}
        />
      )}

      {einfrierenDialog && bestand && (
        <Einfrieren
          bestand={bestand}
          baukasten={baukasten}
          startSorte={finde(einfrierenDialog.sorteId)}
          onEinfrieren={einfrieren}
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
            {meldung.aktion && (
              <button type="button" onClick={() => void aktionAusfuehren(meldung.aktion!)}>
                {meldung.aktion.text}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
