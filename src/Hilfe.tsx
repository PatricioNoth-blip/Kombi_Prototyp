// „So funktioniert Kombi“ – die Begriffe der App in einfacher Sprache, für alle, die sie zum ersten Mal sehen.
import { Blatt } from './Blatt';
import { Icon, type IconName } from './Icon';

const BEGRIFFE: [string, string][] = [
  ['Vorrat', 'Alles, was bei dir zu Hause ist – im Kühlschrank, im Gefrierfach und im Schrank. Kombi kennt Mengen und Haltbarkeit.'],
  ['Einbuchen', 'Etwas in den Vorrat aufnehmen, z. B. nach dem Einkauf oder wenn du vorgekocht hast. Optional mit Haltbarkeit.'],
  ['Entnehmen', 'Etwas aus dem Vorrat nehmen. Beim Kochen fragt Kombi vorher, was abgezogen werden soll – Anschauen allein ändert nichts.'],
  ['Produktion', 'Vorkochen auf Vorrat: einmal eine große Menge kochen (z. B. Tomatensoße), portionieren und später mehrmals verwenden.'],
  ['Komponente', 'Ein vorgekochter Baustein wie Soße, gekochte Linsen oder Ofengemüse – daraus werden schnell ganze Gerichte.'],
  ['Komplettgericht', 'Wird als Ganzes gegessen, z. B. eine Pizza oder eine Portion Lasagne.'],
  ['Grundbausteine', 'Dein Grundvorrat in vier Farben: Rot = Basis & Soße (Tomaten, Kokosmilch, vorbereitete Basen), Braun = Protein (gekochte Hülsenfrüchte, Sojagranulat), Grün = Gemüse, Gelb = Sattmacher & Trockenvorrat (Nudeln, Reis, Kartoffeln, Linsen …). Zwiebeln, Möhren und Knoblauch gelten als immer da.'],
  ['Grundrezept', 'Eines von 25 festen Rezepten aus deinen Grundbausteinen. Kombi zeigt zuerst die, die du direkt kochen kannst, und sagt bei den anderen genau, was fehlt. Erst danach improvisiert die KI.'],
  ['Was hast du sonst noch da?', 'Zutaten, die nicht im Vorrat stehen. Kombi kocht damit, bucht sie aber nie ab. Steht „halbe …“ oder „Rest …“ dabei, kommen sie zuerst dran.'],
  ['Einplanen', 'Ein Gericht für einen Tag vormerken. Die Zutaten werden dafür reserviert, aber erst beim Kochen abgezogen.'],
  ['Läuft bald ab · geöffnet · aufgetaut', 'Sollte bald gegessen werden. Kombi schlägt solche Lebensmittel zuerst vor.'],
  ['Wird knapp', 'Es ist noch etwas da, aber weniger als die Menge, die du immer zu Hause haben möchtest (Mindestbestand).'],
  ['Aufgebraucht', 'Nichts mehr da. Zutaten kommen auf die Einkaufsliste, Selbstgemachtes zum Nachkochen in die Produktion.'],
  ['kcal unbekannt', 'Für diese Sorte sind keine Nährwerte hinterlegt. Kombi schätzt nie – „ab …“ heißt: mindestens so viel, für einiges fehlen Angaben. Nachtragen: Vorrat → Sorte → Bearbeiten.'],
];

/** Drei Schritte, die jeder versteht. */
export function SoGehts() {
  const schritte: [IconName, string, string][] = [
    ['vorrat', 'Vorrat eintragen', 'Was in Kühlschrank, Gefrierfach und Schrank liegt.'],
    ['pfanne', 'Kochen', 'Kombi schlägt Gerichte vor, die du damit kochen kannst – Schritt für Schritt.'],
    ['wagen', 'Einkaufen', 'Was fehlt oder knapp wird, landet auf der Einkaufsliste.'],
  ];
  return (
    <ol className="so-gehts">
      {schritte.map(([icon, titel, text], i) => (
        <li key={titel}>
          <span className="so-nr" aria-hidden="true"><Icon name={icon} groesse={18} /></span>
          <span><strong>{i + 1}. {titel}</strong><small>{text}</small></span>
        </li>
      ))}
    </ol>
  );
}

export function Hilfe({ onSchliessen }: { onSchliessen: () => void }) {
  return (
    <Blatt titel="So funktioniert Kombi" untertitel="Kombi kennt deinen Vorrat und schlägt vor, was du daraus kochen kannst." onSchliessen={onSchliessen}>
      <SoGehts />
      <h3 className="unterkopf">Begriffe</h3>
      <dl className="begriffe">
        {BEGRIFFE.map(([wort, text]) => (
          <div key={wort}>
            <dt>{wort}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <p className="abschnitt-fuss">Alle in eurem Haushalt sehen denselben Vorrat. Jede Buchung lässt sich ein paar Sekunden lang rückgängig machen.</p>
    </Blatt>
  );
}
