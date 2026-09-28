import { useState } from 'react';
import type { AuftauEintrag, AuftauVorschlag } from '../supabase/functions/_shared/kombi/planung.ts';
import { heuteAuftauen } from '../supabase/functions/_shared/kombi/planung.ts';
import { kurzMenge } from '../supabase/functions/_shared/kombi/aktionen.ts';
import { fehlerText, type Sorte } from './api';
import { auftauenVormerken, auftauStatus, type Plan } from './haushalt';
import { Icon } from './Icon';
import { einheitVon, mengeText } from './format';
import { tagName } from './dashboard';

type Props = {
  bestand: Sorte[];
  plaene: Plan[];
  vorschlaege: AuftauVorschlag[];
  eintraege: AuftauEintrag[];
  heute: string;
  onMeldung: (text: string) => void;
  onGeaendert: () => void;
};

/**
 * „Für heute auftauen“: was heute aus dem Gefrierfach sollte, damit geplante Mahlzeiten klappen.
 * Vormerken und „herausgenommen“ ändern KEINEN Bestand – entnommen wird erst beim Kochen.
 */
export function Auftauen({ bestand, plaene, vorschlaege, eintraege, heute, onMeldung, onGeaendert }: Props) {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const faellig = heuteAuftauen(eintraege, heute);
  const spaeter = eintraege.filter((a) => a.status === 'geplant' && a.auftauen_am > heute);
  const aufgetaut = eintraege.filter((a) => a.status === 'aufgetaut');
  if (faellig.length + spaeter.length + aufgetaut.length + vorschlaege.length === 0) return null;
  // ein Eintrag je geplanter Mahlzeit
  const gruppen = [...new Set(vorschlaege.map((v) => v.plan_id))].map((id) => ({ plan_id: id, eintraege: vorschlaege.filter((v) => v.plan_id === id) }));

  const sorte = (id: number) => bestand.find((s) => s.id === id);
  const menge = (a: { block_typ_id: number; menge: number }) => {
    const s = sorte(a.block_typ_id);
    return `${mengeText(a.menge, s ? einheitVon(s) : 'portion')} ${s?.name ?? 'unbekannt'}`;
  };
  const fuer = (planId: string | null) => {
    const p = plaene.find((x) => x.id === planId);
    return p ? `für „${p.titel}“${p.datum ? ` · ${tagName(heute, p.datum)}` : ''}` : 'ohne Plan';
  };

  async function aktion(schluessel: string, f: () => Promise<void>, text: string) {
    setLaeuft(schluessel);
    try {
      await f();
      onMeldung(text);
      onGeaendert();
    } catch (e) {
      onMeldung(fehlerText(e));
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <section className="auftauen" aria-label="Für heute auftauen">
      <h2 className="abschnitt-titel"><Icon name="schneeflocke" groesse={14} /> Für heute auftauen</h2>
      <ul className="auftau-liste">
        {gruppen.map((g) => {
          const k = `v-${g.plan_id}`;
          const erste = g.eintraege[0];
          return (
            <li key={k} className="auftau-vorschlag">
              <span className="auftau-text">
                <strong>{tagName(heute, erste.datum)}: {g.eintraege.map((v) => `${kurzMenge(v.menge, v.einheit)} ${v.name}`).join(' + ')}</strong>
                <small>
                  für „{erste.titel}“ → {erste.datum === heute ? 'gleich herausnehmen' : erste.auftauen_am === heute ? 'heute zum Auftauen vormerken' : `${tagName(heute, erste.auftauen_am)} auftauen`}
                </small>
              </span>
              <button
                type="button"
                className="knopf klein-knopf"
                disabled={laeuft === k}
                onClick={() => void aktion(k, async () => {
                  for (const v of g.eintraege) await auftauenVormerken(v.block_typ_id, v.menge, v.auftauen_am, v.plan_id);
                }, `Zum Auftauen vorgemerkt: ${g.eintraege.map((v) => v.name).join(', ')}.`)}
              >
                Vormerken
              </button>
            </li>
          );
        })}
        {faellig.map((a) => {
          const k = `f-${a.id}`;
          return (
            <li key={k} className="auftau-faellig">
              <span className="auftau-text">
                <strong>Jetzt herausnehmen: {menge(a)}</strong>
                <small>{fuer(a.plan_id)}</small>
              </span>
              <button
                type="button"
                className="knopf klein-knopf"
                disabled={laeuft === k}
                onClick={() => void aktion(k, () => auftauStatus(a.id, 'aufgetaut'), `${sorte(a.block_typ_id)?.name ?? 'Portion'} taut auf.`)}
              >
                <Icon name="haken" groesse={16} /> Herausgenommen
              </button>
              <button
                type="button"
                className="mini-knopf"
                aria-label="Auftauen abbrechen"
                disabled={laeuft === k}
                onClick={() => void aktion(k, () => auftauStatus(a.id, 'abgebrochen'), 'Auftauen abgebrochen.')}
              >
                <Icon name="schliessen" groesse={14} />
              </button>
            </li>
          );
        })}
        {aufgetaut.map((a) => (
          <li key={`a-${a.id}`} className="auftau-aufgetaut">
            <span className="auftau-text">
              <strong>{menge(a)} ist aufgetaut</strong>
              <small>bald verbrauchen · {fuer(a.plan_id)}</small>
            </span>
          </li>
        ))}
        {spaeter.map((a) => (
          <li key={`s-${a.id}`}>
            <span className="auftau-text">
              <strong>{tagName(heute, a.auftauen_am)}: {menge(a)} herausnehmen</strong>
              <small>{fuer(a.plan_id)}</small>
            </span>
            <button
              type="button"
              className="mini-knopf"
              aria-label="Vormerkung entfernen"
              disabled={laeuft === `s-${a.id}`}
              onClick={() => void aktion(`s-${a.id}`, () => auftauStatus(a.id, 'abgebrochen'), 'Vormerkung entfernt.')}
            >
              <Icon name="schliessen" groesse={14} />
            </button>
          </li>
        ))}
      </ul>
      <p className="leise klein auftau-fuss">Vorgekochtes einen Tag vorher auftauen. Erinnerung nur hier in der App, ohne Push-Nachrichten.</p>
    </section>
  );
}
