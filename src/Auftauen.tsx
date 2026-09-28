import { useState, type ReactNode } from 'react';
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

  const zeile = (key: string, titel: string, meta: string, aktionen: ReactNode, klasse = '') => (
    <li key={key}>
      <div className={`zeile ${klasse}`}>
        <span className="icon-kachel"><Icon name="schneeflocke" groesse={18} /></span>
        <span className="zeile-haupt">
          <span className="zeile-titel">{titel}</span>
          <span className="zeile-meta">{meta}</span>
        </span>
        {aktionen}
      </div>
    </li>
  );

  return (
    <section className="abschnitt auftauen" aria-label="Auftauen">
      <div className="abschnitt-kopf"><h2>Auftauen</h2></div>
      <ul className="liste mit-icon">
        {gruppen.map((g) => {
          const k = `v-${g.plan_id}`;
          const erste = g.eintraege[0];
          return zeile(
            k,
            g.eintraege.map((v) => `${kurzMenge(v.menge, v.einheit)} ${v.name}`).join(' + '),
            `für „${erste.titel}“ · ${erste.datum === heute ? 'gleich herausnehmen' : erste.auftauen_am === heute ? 'heute herausnehmen' : `${tagName(heute, erste.auftauen_am)} herausnehmen`}`,
            <button
              type="button"
              className="knopf klein"
              disabled={laeuft === k}
              onClick={() => void aktion(k, async () => {
                for (const v of g.eintraege) await auftauenVormerken(v.block_typ_id, v.menge, v.auftauen_am, v.plan_id);
              }, `Zum Auftauen vorgemerkt: ${g.eintraege.map((v) => v.name).join(', ')}.`)}
            >
              Vormerken
            </button>,
          );
        })}
        {faellig.map((a) => {
          const k = `f-${a.id}`;
          return zeile(
            k,
            `Jetzt herausnehmen: ${menge(a)}`,
            fuer(a.plan_id),
            <>
              <button
                type="button"
                className="knopf klein akzent"
                disabled={laeuft === k}
                onClick={() => void aktion(k, () => auftauStatus(a.id, 'aufgetaut'), `${sorte(a.block_typ_id)?.name ?? 'Portion'} taut auf.`)}
              >
                Erledigt
              </button>
              <button
                type="button"
                className="icon-knopf klein"
                aria-label="Auftauen abbrechen"
                disabled={laeuft === k}
                onClick={() => void aktion(k, () => auftauStatus(a.id, 'abgebrochen'), 'Auftauen abgebrochen.')}
              >
                <Icon name="schliessen" groesse={14} />
              </button>
            </>,
          );
        })}
        {aufgetaut.map((a) => zeile(`a-${a.id}`, `${menge(a)} ist aufgetaut`, `bald verbrauchen · ${fuer(a.plan_id)}`, null))}
        {spaeter.map((a) => zeile(
          `s-${a.id}`,
          `${tagName(heute, a.auftauen_am)}: ${menge(a)}`,
          fuer(a.plan_id),
          <button
            type="button"
            className="icon-knopf klein"
            aria-label="Vormerkung entfernen"
            disabled={laeuft === `s-${a.id}`}
            onClick={() => void aktion(`s-${a.id}`, () => auftauStatus(a.id, 'abgebrochen'), 'Vormerkung entfernt.')}
          >
            <Icon name="schliessen" groesse={14} />
          </button>,
        ))}
      </ul>
      <p className="abschnitt-fuss">Vorgekochtes einen Tag vorher auftauen. Der Bestand ändert sich erst beim Kochen.</p>
    </section>
  );
}
