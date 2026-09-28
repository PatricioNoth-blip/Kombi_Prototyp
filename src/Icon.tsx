// Schlichte Linien-Icons (24 × 24, 1.8 px Strich) – ruhiger als Emojis in der Bedienung.
// Emojis bleiben dort, wo sie das Essen zeigen (Gerichtskarte).

const PFADE = {
  vorrat: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z M4 7.5 12 12l8-4.5 M12 12v9',
  essen: 'M7 3v8a2 2 0 0 0 2 2v8 M5 3v5 M9 3v5 M17 21V3c-2.2 1.2-3 3.6-3 6.5V13h3',
  sorten: 'M4 6h16 M4 12h16 M4 18h10',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  neu: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  schliessen: 'M6 6l12 12 M18 6 6 18',
  herz: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  nein: 'M7 14V4 M7 14l3.5 6c1 0 2-.8 2-2v-3.5h4.8a2 2 0 0 0 2-2.3l-1.2-6.7A2 2 0 0 0 16.1 4H7 M3 4h4v10H3z',
  aehnlich: 'M4 9a8 8 0 0 1 14-3l2 2 M20 4v4h-4 M20 15a8 8 0 0 1-14 3l-2-2 M4 20v-4h4',
  weiter: 'M5 12h14 M13 6l6 6-6 6',
  uhr: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  personen: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M21 19v-1a4 4 0 0 0-3-3.9 M15.5 4.1a3 3 0 0 1 0 5.8',
  preis: 'M17 6.5A6.5 6.5 0 1 0 17 17.5 M4 10h8 M4 14h8',
  stern: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  pfanne: 'M3 11h13a0 0 0 0 1 0 0 6 6 0 0 1-6 6H9a6 6 0 0 1-6-6Z M16 12h5 M8 7c0-1 1-1.5 1-2.5 M12 7c0-1 1-1.5 1-2.5',
  blatt: 'M5 19c8 0 14-5 14-14-9 0-14 6-14 14Z M5 19l7-7',
  schneeflocke: 'M12 2v20 M4.9 6l14.2 12 M19.1 6 4.9 18 M9 3.5l3 2 3-2 M9 20.5l3-2 3 2',
  kuehlschrank: 'M6 3h12v18H6z M6 10h12 M9 6v2 M9 13v3',
  glas: 'M7 3h10 M8 3v3c-1.3.7-2 2-2 3.5V21h12V9.5c0-1.5-.7-2.8-2-3.5V3',
  pfeil: 'M9 6l6 6-6 6',
  info: 'M12 11v6 M12 7.5v.5 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  korb: 'M3 9h18l-2 11H5L3 9Z M8 9l4-6 4 6',
  funken: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
  offen: 'M5 10h14v10H5z M8 10V7a4 4 0 0 1 7.5-2',
  baustein: 'M4 8h3.5a2 2 0 1 1 4 0H15v3.5a2 2 0 1 1 0 4V19h-3.5a2 2 0 1 0-4 0H4v-3.5a2 2 0 1 0 0-4V8Z',
  wagen: 'M3 4h2l2.3 10.5h10.4L20 7.5H6.1 M9 19.5h.01 M17 19.5h.01',
  kalender: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  haken: 'M5 12.5l4.5 4.5L19 7.5',
  suche: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4.2-4.2',
  zurueck: 'M15 6l-6 6 6 6',
  muell: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  tauschen: 'M7 4 3 8l4 4 M3 8h14 M17 20l4-4-4-4 M21 16H7',
  haus: 'M4 10.5 12 4l8 6.5V20h-5v-5.5h-6V20H4z',
  topf: 'M4 10h16v5.5A4.5 4.5 0 0 1 15.5 20h-7A4.5 4.5 0 0 1 4 15.5V10Z M2 10h20 M9 6.5c0-1 1-1.4 1-2.5 M14 6.5c0-1 1-1.4 1-2.5',
  sonne: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2.5v2 M12 19.5v2 M4.6 4.6 6 6 M18 18l1.4 1.4 M2.5 12h2 M19.5 12h2 M4.6 19.4 6 18 M18 6l1.4-1.4',
  mond: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  birne: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z',
  flamme: 'M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.6 3.9-7.6.3 1.9 1.3 3 2.3 3.4-.3-2.7.6-5.5 2.8-7.6.3 3 2.1 4.8 3.3 6.6.9 1.4 1.7 2.9 1.7 5.2 0 3.6-2.6 6.2-7.5 6.2Z',
  warnung: 'M12 8.5v4.5 M12 16.5v.5 M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  sonstiges: 'M4 7h16v10H4z M8 12h.01 M16 12h.01 M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
} as const;

export type IconName = keyof typeof PFADE;

export function Icon({ name, groesse = 22, className }: { name: IconName; groesse?: number; className?: string }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PFADE[name]} />
    </svg>
  );
}
