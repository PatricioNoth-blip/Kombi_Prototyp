// E-Bon als PDF: Textebene direkt auslesen – ohne KI, ohne Bibliothek.
//
// Viele E-Bons (z. B. als PDF per Mail oder aus der Händler-App) enthalten echten Text. Dieses
// Modul liest ihn aus einfachen PDFs: Inhaltsströme (unkomprimiert oder FlateDecode) und die
// Textbefehle Tj, TJ, ' und ". Zeilenwechsel folgen der y-Position.
// Grenzen – ehrlich: eingebettete Schriften mit eigener Kodierung (CID/Identity-H) oder reine
// Bild-PDFs liefern hier keinen lesbaren Text. Dann bleibt das Foto (KI) oder Text einfügen.

const WIN_ANSI_80: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x84: '„', 0x85: '…', 0x8a: 'Š', 0x8c: 'Œ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”',
  0x95: '•', 0x96: '–', 0x97: '—', 0x9a: 'š', 0x9c: 'œ', 0x9f: 'Ÿ',
};

function zeichen(bytes: number[]): string {
  return bytes.map((b) => WIN_ANSI_80[b] ?? String.fromCharCode(b)).join('');
}

function latin1(daten: Uint8Array, von = 0, bis = daten.length): string {
  let s = '';
  for (let i = von; i < bis; i += 8192) s += String.fromCharCode(...daten.subarray(i, Math.min(bis, i + 8192)));
  return s;
}

async function entpacke(daten: Uint8Array): Promise<Uint8Array | null> {
  try {
    const strom = new Blob([daten as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(strom).arrayBuffer());
  } catch {
    return null;
  }
}

/** Alle Datenströme mit ihrem Wörterbuch. */
function stroeme(daten: Uint8Array): { dict: string; von: number; bis: number }[] {
  const text = latin1(daten);
  const liste: { dict: string; von: number; bis: number }[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (text.slice(Math.max(0, m.index - 3), m.index) === 'end') continue; // „endstream“
    const objStart = text.lastIndexOf(' obj', m.index);
    const dict = objStart >= 0 ? text.slice(objStart, m.index) : '';
    const von = m.index + m[0].length;
    const ende = text.indexOf('endstream', von);
    if (ende < 0) break;
    const laenge = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let bis = laenge ? von + Number(laenge[1]) : ende;
    if (bis > ende || bis <= von) bis = ende;
    while (bis > von && (daten[bis - 1] === 0x0a || daten[bis - 1] === 0x0d) && !laenge) bis--;
    liste.push({ dict, von, bis });
    re.lastIndex = ende + 9;
  }
  return liste;
}

type Token = { art: 'zahl'; wert: number } | { art: 'text'; wert: string } | { art: 'op'; wert: string } | { art: 'feld'; wert: Token[] };

/** Zerlegt einen Inhaltsstrom in Zahlen, Texte, Felder und Operatoren. */
function tokens(s: string): Token[] {
  const stapel: Token[][] = [[]];
  const aktuell = () => stapel[stapel.length - 1];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      const bytes: number[] = [];
      let tiefe = 1;
      i++;
      while (i < s.length && tiefe > 0) {
        const z = s[i];
        if (z === '\\') {
          const n = s[i + 1];
          const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
          if (n in esc) {
            bytes.push(esc[n]);
            i += 2;
          } else if (/[0-7]/.test(n)) {
            const okt = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0];
            bytes.push(parseInt(okt, 8) & 0xff);
            i += 1 + okt.length;
          } else {
            i += n === '\n' || n === '\r' ? 2 : 1; // Zeilenfortsetzung
          }
          continue;
        }
        if (z === '(') tiefe++;
        if (z === ')') tiefe--;
        if (tiefe > 0) bytes.push(z.charCodeAt(0) & 0xff);
        i++;
      }
      aktuell().push({ art: 'text', wert: zeichen(bytes) });
    } else if (c === '<' && s[i + 1] !== '<') {
      const ende = s.indexOf('>', i);
      const hex = s.slice(i + 1, ende < 0 ? s.length : ende).replace(/\s+/g, '');
      const bytes: number[] = [];
      for (let j = 0; j < hex.length; j += 2) bytes.push(parseInt((hex.slice(j, j + 2) + '0').slice(0, 2), 16));
      aktuell().push({ art: 'text', wert: zeichen(bytes) });
      i = ende < 0 ? s.length : ende + 1;
    } else if (c === '[') {
      stapel.push([]);
      i++;
    } else if (c === ']') {
      const feld = stapel.length > 1 ? stapel.pop()! : [];
      aktuell().push({ art: 'feld', wert: feld });
      i++;
    } else if (c === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    } else if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
      if (m) {
        aktuell().push({ art: 'zahl', wert: Number(m[0]) });
        i += m[0].length;
      } else i++;
    } else if (c === '/') {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 128))!;
      i += m[0].length; // Namen (Schrift, Ressourcen) werden nicht gebraucht
    } else if (/[A-Za-z'"*]/.test(c)) {
      const m = /^[A-Za-z'"*]+\d?/.exec(s.slice(i, i + 16))!;
      aktuell().push({ art: 'op', wert: m[0] });
      i += m[0].length;
    } else {
      i++;
    }
  }
  return stapel[0];
}

/** Text eines Inhaltsstroms in Zeilen (nach y-Position). */
export function textAusInhalt(inhalt: string): string[] {
  const zeilen: string[] = [];
  let zeile = '';
  let y = 0;
  let zeilenY: number | null = null;
  let operanden: Token[] = [];

  const neueZeile = () => {
    if (zeile.trim()) zeilen.push(zeile.replace(/\s+/g, ' ').trim());
    zeile = '';
  };
  const setzeY = (neu: number) => {
    if (zeilenY !== null && Math.abs(neu - zeilenY) > 0.5) neueZeile();
    y = neu;
    zeilenY = neu;
  };
  const zahl = (t: Token | undefined) => (t && t.art === 'zahl' ? t.wert : 0);

  for (const t of tokens(inhalt)) {
    if (t.art !== 'op') {
      operanden.push(t);
      continue;
    }
    const n = operanden.length;
    switch (t.wert) {
      case 'BT':
        y = 0;
        break;
      case 'Td':
      case 'TD':
        setzeY(y + zahl(operanden[n - 1]));
        if (zahl(operanden[n - 1]) === 0 && zeile && !zeile.endsWith(' ')) zeile += ' ';
        break;
      case 'Tm':
        setzeY(zahl(operanden[n - 1]));
        if (zeile && !zeile.endsWith(' ')) zeile += ' ';
        break;
      case 'T*':
        neueZeile();
        break;
      case 'Tj':
        if (operanden[n - 1]?.art === 'text') zeile += operanden[n - 1].wert as string;
        break;
      case "'":
      case '"':
        neueZeile();
        if (operanden[n - 1]?.art === 'text') zeile += operanden[n - 1].wert as string;
        break;
      case 'TJ': {
        const feld = operanden[n - 1];
        if (feld?.art === 'feld') {
          for (const x of feld.wert) {
            if (x.art === 'text') zeile += x.wert;
            else if (x.art === 'zahl' && x.wert < -180) zeile += ' ';
          }
        }
        break;
      }
      case 'ET':
        break;
    }
    operanden = [];
  }
  neueZeile();
  return zeilen;
}

const BETRAG = /-?\d{1,4}[.,]\d{2}\b/;

/**
 * Liest die Textzeilen eines PDF-E-Bons. Leere Liste, wenn das PDF keinen lesbaren Text enthält
 * (z. B. nur ein eingescanntes Bild) – dann nichts raten.
 */
export async function pdfText(daten: Uint8Array): Promise<string[]> {
  if (latin1(daten, 0, Math.min(daten.length, 1024)).indexOf('%PDF') < 0) return [];
  const zeilen: string[] = [];
  for (const s of stroeme(daten)) {
    if (/\/Subtype\s*\/Image|\/Type\s*\/(XRef|Metadata|ObjStm|EmbeddedFile)|\/Length1|\/FontFile/.test(s.dict)) continue;
    if (/\/Filter/.test(s.dict) && !/\/FlateDecode/.test(s.dict)) continue;
    const roh = daten.subarray(s.von, s.bis);
    const inhalt = /\/FlateDecode/.test(s.dict) ? await entpacke(roh) : roh;
    if (!inhalt) continue;
    const text = latin1(inhalt);
    if (!/BT[\s\S]*?(Tj|TJ|'|")[\s\S]*?ET/.test(text)) continue;
    zeilen.push(...textAusInhalt(text));
  }
  // Plausibel? Mindestens zwei Zeilen mit einem Betrag und kein Zeichensalat
  const mitBetrag = zeilen.filter((z) => BETRAG.test(z)).length;
  const lesbar = zeilen.join('').replace(/[\s\w.,:;%€*\-+/()ÄÖÜäöüß&'"#]/g, '').length <= zeilen.join('').length * 0.1;
  return mitBetrag >= 2 && lesbar ? zeilen : [];
}
