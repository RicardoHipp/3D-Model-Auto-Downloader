// Eigener Gueltigkeitsbereich: Ohne Module teilen sich alle Skripte
// einen Namensraum, und gleich benannte Hilfsfunktionen in zwei
// Dateien ueberschreiben sich sonst gegenseitig.
(() => {

// 3MF lesen.
//
// Ein 3MF ist ein ZIP mit XML darin. Der Einstieg ist /3D/3dmodel.model;
// dort stehen die Objekte und unter <build> die Bauteile, die tatsächlich
// auf dem Druckbett stehen - jeweils mit einer Transformationsmatrix.
//
// Bambu Studio (und damit fast jedes MakerWorld-Modell) nutzt die
// "production extension": Das eigentliche Netz liegt nicht im Hauptdokument,
// sondern in einer eigenen Datei, auf die <component p:path="..."> zeigt.
// Diese Dateien sind groß - in den Testdateien 35 MB XML für ein Modell.
//
// Deshalb wird nicht mit DOMParser gearbeitet: Ein DOM mit einer halben
// Million <vertex>-Knoten kostet ein Vielfaches an Speicher. Stattdessen
// läuft ein Scanner über den entpackten Strom und liest nur die Zahlen
// heraus, die er braucht.

// --- Zahlen direkt aus dem Text ----------------------------------------
//
// Eine halbe Million Ecken heisst zwei Millionen Zahlen. Mit indexOf +
// slice + Number waeren das ebenso viele kurze Zeichenketten, die der
// Speicherverwalter danach alle wieder einsammeln muss - in den Tests
// kostete das rund neun Sekunden. Deshalb wird hier auf Zeichenebene
// gelesen: kein Teilstring, keine Zwischenobjekte.

// Wo die zuletzt gelesene Zahl endet. Modulweite Variable statt Rueckgabe
// eines Paares - das waere wieder ein Objekt je Zahl.
let zeiger = 0;

function zahlAb(bytes, i) {
  let ch = bytes[i];
  let vorzeichen = 1;
  if (ch === 45) { vorzeichen = -1; i++; }        // -
  else if (ch === 43) { i++; }                    // +

  let wert = 0;
  while ((ch = bytes[i]) >= 48 && ch <= 57) { wert = wert * 10 + (ch - 48); i++; }

  if (ch === 46) {                                // .
    i++;
    let teiler = 1;
    while ((ch = bytes[i]) >= 48 && ch <= 57) {
      wert = wert * 10 + (ch - 48);
      teiler *= 10;
      i++;
    }
    wert /= teiler;
  }

  if (ch === 101 || ch === 69) {                  // e E
    i++;
    let hochVorzeichen = 1;
    ch = bytes[i];
    if (ch === 45) { hochVorzeichen = -1; i++; }
    else if (ch === 43) { i++; }
    let hoch = 0;
    while ((ch = bytes[i]) >= 48 && ch <= 57) { hoch = hoch * 10 + (ch - 48); i++; }
    wert *= Math.pow(10, hochVorzeichen * hoch);
  }

  zeiger = i;
  return vorzeichen * wert;
}

// --- Wachsende Puffer ---------------------------------------------------
// Wie viele Ecken kommen, weiß man vorher nicht. Verdoppeln statt bei jedem
// Eintrag neu anlegen.
class Liste {
  constructor(Typ, anfang = 1 << 16) {
    this.Typ = Typ;
    this.daten = new Typ(anfang);
    this.laenge = 0;
  }
  platz(n) {
    if (this.laenge + n <= this.daten.length) return;
    let gross = this.daten.length * 2;
    while (gross < this.laenge + n) gross *= 2;
    const neu = new this.Typ(gross);
    neu.set(this.daten.subarray(0, this.laenge));
    this.daten = neu;
  }
  drei(a, b, c) {
    this.platz(3);
    this.daten[this.laenge++] = a;
    this.daten[this.laenge++] = b;
    this.daten[this.laenge++] = c;
  }
  fertig() {
    return this.daten.subarray(0, this.laenge);
  }
}

// --- Ein Dokument lesen --------------------------------------------------
//
// Ein Durchlauf liefert beides: die Struktur (welches Objekt besteht aus
// welchen Komponenten) und die Netze. Wichtig ist die Objektgrenze - Bambu
// legt mehrere Objekte in dieselbe Datei, und jedes zaehlt seine Ecken ab
// null. Wer alles in einen Topf wirft, bekommt Dreiecke, die auf die Ecken
// des Nachbarobjekts zeigen.
function neuerStand() {
  return { objekte: new Map(), offen: null };
}

function beginneObjekt(stand, id, name) {
  schliesseObjekt(stand);
  stand.offen = {
    id, name: name || '',
    ecken: new Liste(Float32Array),
    dreiecke: new Liste(Uint32Array),
    // Bemalung je Dreieck; wird erst angelegt, wenn die erste vorkommt -
    // die allermeisten Dateien sind einfarbig.
    farben: null,
    // Dreiecke, die nur teilweise bemalt sind: Nummer und die Ziffernfolge,
    // die ihre Unterteilung beschreibt. Ausgewertet wird am Ende des
    // Objekts, wenn alle Ecken bekannt sind.
    geteiltNr: null,
    geteiltCode: null,
    teile: []
  };
}

// Traegt die Bemalung eines Dreiecks ein. Das Feld waechst mit; was nie
// beschrieben wird, bleibt 0 und heisst "unbemalt".
function merkeFarbe(objekt, nummer, zustand) {
  let f = objekt.farben;
  if (!f || nummer >= f.length) {
    const neu = new Uint8Array(Math.max(1 << 14, (nummer + 1) * 2));
    if (f) neu.set(f);
    objekt.farben = f = neu;
  }
  f[nummer] = zustand;
}

// --- Bemalung entschluesseln ----------------------------------------------
//
// Bambu Studio (wie PrusaSlicer) schreibt an bemalte Dreiecke eine Folge
// von Hex-Ziffern, die VON HINTEN gelesen wird. Jede Ziffer sind vier Bit:
// die unteren zwei sagen, ob das Dreieck weiter unterteilt ist (0 = nein,
// sonst Anzahl der geteilten Seiten, Kinder = Anzahl + 1), die oberen zwei
// bei einem ungeteilten Dreieck den Zustand - also die Nummer des
// Filaments. Steht dort 3, folgt die eigentliche Nummer minus 3 in der
// naechsten Ziffer. "4" ist damit Filament 1, "8" Filament 2, "0C"
// Filament 3, "1C" Filament 4.
//
// Unterteilte Dreiecke - teilweise bemalt - zeichnen wir nicht nach,
// sondern nehmen die Farbe, die unter den Teilstuecken am haeufigsten
// vorkommt. Kleine und grosse Teilstuecke zaehlen dabei gleich; fuer eine
// Vorschau reicht das.
const farbZaehler = new Uint32Array(32);
// Ob das zuletzt entschluesselte Dreieck unterteilt war. Modulweite
// Variable aus demselben Grund wie "zeiger": kein Objekt je Dreieck.
let malUnterteilt = false;

function hexWert(b) {
  return b <= 57 ? b - 48 : b <= 70 ? b - 55 : b - 87;
}

function malfarbe(bytes, ab, bis) {
  // Der haeufigste Fall zuerst: ein ganzes Dreieck, ein oder zwei Ziffern.
  malUnterteilt = false;
  const letzte = hexWert(bytes[bis - 1]);
  if ((letzte & 3) === 0) {
    const zustand = letzte >> 2;
    if (zustand < 3 && bis - ab === 1) return zustand;
    if (zustand === 3 && bis - ab === 2) return 3 + hexWert(bytes[ab]);
  }

  malUnterteilt = (letzte & 3) !== 0;
  farbZaehler.fill(0);
  let pos = bis - 1, offen = 1;
  while (offen > 0 && pos >= ab) {
    const ziffer = hexWert(bytes[pos--]);
    offen--;
    const geteilt = ziffer & 3;
    if (geteilt) { offen += geteilt + 1; continue; }
    let zustand = ziffer >> 2;
    if (zustand === 3) {
      let mehr = pos >= ab ? hexWert(bytes[pos--]) : 0;
      zustand += mehr;
      while (mehr === 15 && pos >= ab) { mehr = hexWert(bytes[pos--]); zustand += mehr; }
    }
    if (zustand < 32) farbZaehler[zustand]++;
  }
  let beste = 0;
  for (let k = 1; k < 32; k++) if (farbZaehler[k] > farbZaehler[beste]) beste = k;
  return beste;
}

function schliesseObjekt(stand) {
  const o = stand.offen;
  if (!o) return;
  stand.objekte.set(o.id, {
    id: o.id,
    name: o.name,
    // Reihenfolge beachten: Das Verfeinern haengt neue Ecken an, also erst
    // danach die Eckenliste abschliessen.
    ...verfeinere(o),
    ecken: o.ecken.fertig(),
    indizes: o.dreiecke.fertig(),
    farben: farbenFertig(o),
    teile: o.teile
  });
  stand.offen = null;
}

// --- Teilweise bemalte Dreiecke zerlegen -------------------------------
//
// Die Ziffernfolge beschreibt einen Baum, von hinten gelesen. Ein Knoten
// ist entweder ein fertiges Teilstueck mit seiner Farbe oder er teilt sich:
// Die unteren zwei Bit nennen die Zahl der halbierten Seiten (1 bis 3), die
// oberen zwei die Ecke, von der aus gezaehlt wird. Mit A als dieser Ecke
// und B, C als den folgenden entstehen:
//
//   eine Seite:   (A, B, Mbc)  (Mbc, C, A)                - BC halbiert
//   zwei Seiten:  (A, Mab, Mca)  (Mab, B, Mca)  (B, C, Mca)
//   drei Seiten:  (A, Mab, Mca)  (Mab, B, Mbc)  (Mbc, C, Mca)  (Mab, Mbc, Mca)
//
// In der Folge stehen die Kinder in umgekehrter Reihenfolge - das letzte
// zuerst. So macht es der Slicer beim Schreiben, also lesen wir es so.
//
// Die feine Zerlegung dient nur der Anzeige. Die urspruenglichen Dreiecke
// bleiben daneben erhalten: Beim Export als STL sollen keine zusaetzlichen
// Ecken mitten auf den Kanten entstehen.
function verfeinere(o) {
  if (!o.geteiltNr) return { feinIndizes: null, feinFarben: null };

  const ecken = o.ecken;
  const alt = o.dreiecke.fertig();
  const dreiecke = alt.length / 3;
  const fein = new Liste(Uint32Array, alt.length * 2);
  const farben = [];

  const geteilt = new Map();
  o.geteiltNr.forEach((nr, i) => geteilt.set(nr, o.geteiltCode[i]));

  let code = null, pos = 0;
  const ziffer = () => (pos >= 0 ? hexWert(code[pos--]) : 0);

  const mitte = (p, q) => {
    const d = ecken.daten;
    ecken.drei((d[p * 3] + d[q * 3]) / 2,
               (d[p * 3 + 1] + d[q * 3 + 1]) / 2,
               (d[p * 3 + 2] + d[q * 3 + 2]) / 2);
    return ecken.laenge / 3 - 1;
  };

  const knoten = (v0, v1, v2) => {
    const z = ziffer();
    const seiten = z & 3;
    if (!seiten) {
      let zustand = z >> 2;
      if (zustand === 3) {
        let mehr = ziffer();
        zustand += mehr;
        while (mehr === 15 && pos >= 0) { mehr = ziffer(); zustand += mehr; }
      }
      fein.drei(v0, v1, v2);
      farben.push(zustand < 256 ? zustand : 0);
      return;
    }

    // Von der genannten Ecke aus zaehlen.
    const start = z >> 2;
    const a = start === 0 ? v0 : start === 1 ? v1 : v2;
    const b = start === 0 ? v1 : start === 1 ? v2 : v0;
    const c = start === 0 ? v2 : start === 1 ? v0 : v1;

    if (seiten === 1) {
      const mbc = mitte(b, c);
      knoten(mbc, c, a);
      knoten(a, b, mbc);
    } else if (seiten === 2) {
      const mab = mitte(a, b), mca = mitte(c, a);
      knoten(b, c, mca);
      knoten(mab, b, mca);
      knoten(a, mab, mca);
    } else {
      const mab = mitte(a, b), mbc = mitte(b, c), mca = mitte(c, a);
      knoten(mab, mbc, mca);
      knoten(mbc, c, mca);
      knoten(mab, b, mbc);
      knoten(a, mab, mca);
    }
  };

  for (let d = 0; d < dreiecke; d++) {
    code = geteilt.get(d);
    if (!code) {
      fein.drei(alt[d * 3], alt[d * 3 + 1], alt[d * 3 + 2]);
      farben.push(o.farben && d < o.farben.length ? o.farben[d] : 0);
      continue;
    }
    pos = code.length - 1;
    knoten(alt[d * 3], alt[d * 3 + 1], alt[d * 3 + 2]);
  }

  return { feinIndizes: fein.fertig(), feinFarben: Uint8Array.from(farben) };
}

// Auf die Zahl der Dreiecke zuschneiden - das Feld ist auf Vorrat gewachsen
// oder, wenn nur vorn bemalt wurde, zu kurz.
function farbenFertig(o) {
  if (!o.farben) return null;
  const anzahl = o.dreiecke.laenge / 3;
  if (o.farben.length >= anzahl) return o.farben.subarray(0, anzahl);
  const voll = new Uint8Array(anzahl);
  voll.set(o.farben);
  return voll;
}

function objekteAusText(xml) {
  const stand = neuerStand();
  const bytes = new TextEncoder().encode(xml);
  scanne(bytes, bytes.length, stand);
  schliesseObjekt(stand);
  return stand.objekte;
}

// Der Strom kommt häppchenweise an, und ein Tag kann an einer Häppchengrenze
// zerrissen sein. Deshalb wird nur bis zum letzten vollständigen ">"
// ausgewertet und der Rest an das nächste Häppchen vorangestellt.
async function objekteAusStrom(strom, melde) {
  const stand = neuerStand();
  const leser = strom.getReader();

  let rest = new Uint8Array(0);
  let gelesen = 0;
  for (;;) {
    const { value, done } = await leser.read();
    if (done) break;
    gelesen += value.length;

    let bytes = value;
    if (rest.length) {
      bytes = new Uint8Array(rest.length + value.length);
      bytes.set(rest);
      bytes.set(value, rest.length);
    }
    // Nur bis zum letzten vollstaendigen Tag auswerten. Das ">" ist ASCII
    // und kann in UTF-8 nicht Teil eines anderen Zeichens sein, der Schnitt
    // zerreisst also auch keine Umlaute.
    const schnitt = bytes.lastIndexOf(62) + 1;
    scanne(bytes, schnitt, stand);
    rest = bytes.slice(schnitt);
    melde?.(gelesen);
  }
  if (rest.length) scanne(rest, rest.length, stand);
  schliesseObjekt(stand);

  return stand.objekte;
}

// Liest ein Attribut aus einem Tag-Anfang heraus. Nur fuer die seltenen
// Tags - <vertex> und <triangle> laufen ueber den schnellen Weg unten.
// Der Wert kommt als Text zurueck: Objektnamen koennen Umlaute oder
// chinesische Zeichen enthalten, die Zahlen davor aber nicht.
const dekoder = new TextDecoder();

function alsBytes(text) {
  const raus = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) raus[i] = text.charCodeAt(i);
  return raus;
}

function attribut(bytes, ab, bis, name) {
  const muster = alsBytes(name);
  for (let i = ab + 1; i < bis; i++) {
    if (bytes[i] !== muster[0]) continue;
    let k = 1;
    while (k < muster.length && bytes[i + k] === muster[k]) k++;
    if (k < muster.length || bytes[i + k] !== 61 || bytes[i + k + 1] !== 34) continue;
    // Davor muss ein Leerzeichen stehen, sonst traefe "id=" auch auf
    // "objectid=" oder "pid=" zu.
    const vor = bytes[i - 1];
    if (vor !== 32 && vor !== 9 && vor !== 10 && vor !== 13) continue;

    const anfang = i + k + 2;
    let ende = anfang;
    while (ende < bis && bytes[ende] !== 34) ende++;
    return dekoder.decode(bytes.subarray(anfang, ende));
  }
  return '';
}

// Liest <vertex x= y= z=> und <triangle v1= v2= v3=> heraus und laesst
// alles andere liegen. Die Attribute werden am Zeichen vor dem "="
// erkannt - Bambu haengt an Dreiecke manchmal noch paint_color oder pid,
// und die duerfen nicht als Ecke durchgehen.
// Die Namen der Tags als Bytes - verglichen wird Byte fuer Byte, das
// erspart das Herausschneiden von Teilzeichenketten.
const TAG_VERTEX    = alsBytes('vertex');
const TAG_TRIANGLE  = alsBytes('triangle');
const TAG_OBJECT    = alsBytes('object');
const TAG_COMPONENT = alsBytes('component');

function istTag(bytes, ab, tag) {
  for (let k = 0; k < tag.length; k++) {
    if (bytes[ab + k] !== tag[k]) return false;
  }
  return true;
}

function scanne(bytes, laenge, stand) {
  let i = 0;

  while (i < laenge) {
    const spitz = bytes.indexOf(60, i);           // <
    if (spitz < 0 || spitz >= laenge) break;

    let art = 0;
    if (istTag(bytes, spitz + 1, TAG_VERTEX)) art = 1;
    else if (istTag(bytes, spitz + 1, TAG_TRIANGLE)) art = 2;
    else if (istTag(bytes, spitz + 1, TAG_OBJECT)) art = 3;
    else if (istTag(bytes, spitz + 1, TAG_COMPONENT)) art = 4;
    if (!art) { i = spitz + 1; continue; }

    // Objekt- und Komponenten-Tags kommen selten vor; dort darf es der
    // bequeme Weg ueber Zeichenketten sein.
    if (art >= 3) {
      const zu = bytes.indexOf(62, spitz);        // >
      if (zu < 0 || zu >= laenge) break;
      if (art === 3) {
        beginneObjekt(stand, attribut(bytes, spitz, zu, 'id'),
                             attribut(bytes, spitz, zu, 'name'));
      } else if (stand.offen) {
        stand.offen.teile.push({
          pfad: attribut(bytes, spitz, zu, 'p:path') || null,
          objektId: attribut(bytes, spitz, zu, 'objectid'),
          matrix: alsMatrix(attribut(bytes, spitz, zu, 'transform'))
        });
      }
      i = zu + 1;
      continue;
    }

    // Auf den Tag-Namen muss ein Leerzeichen folgen, sonst ist es der
    // umschliessende Block: <triangles> faengt mit "triangle" an und waere
    // sonst ein Dreieck mit lauter Nullen. (<vertices> stolpert nicht
    // darueber - es unterscheidet sich von "vertex" schon im fuenften
    // Buchstaben.)
    const nach = bytes[spitz + (art === 1 ? 7 : 9)];
    if (nach !== 32 && nach !== 9 && nach !== 10 && nach !== 13) {
      i = spitz + 1;
      continue;
    }

    const ecken = stand.offen?.ecken;
    const dreiecke = stand.offen?.dreiecke;
    if (!ecken) { i = spitz + 1; continue; }

    let x = 0, y = 0, z = 0, farbe = 0, teilung = null;
    let j = spitz + (art === 1 ? 7 : 9);

    while (j < laenge) {
      const ch = bytes[j];
      if (ch === 62) break;                       // >
      if (ch !== 61) { j++; continue; }           // =

      const letzter = bytes[j - 1];
      const vorletzter = bytes[j - 2];

      // paint_color="...": keine Zahl, sondern Hex-Ziffern bis zum
      // schliessenden Anfuehrungszeichen. Erkannt am "or" vor dem "=".
      if (art === 2 && letzter === 114 && vorletzter === 111) {
        let ende = j + 2;
        while (ende < laenge && bytes[ende] !== 34) ende++;
        if (ende > j + 2) {
          farbe = malfarbe(bytes, j + 2, ende);
          // Kopieren, nicht verweisen: Der Puffer des Stroms wird gleich
          // wiederverwendet.
          if (malUnterteilt) teilung = bytes.slice(j + 2, ende);
        }
        j = ende + 1;
        continue;
      }

      const wert = zahlAb(bytes, j + 2);          // hinter ="
      j = zeiger;

      if (art === 1) {
        if (letzter === 120) x = wert;            // x
        else if (letzter === 121) y = wert;       // y
        else if (letzter === 122) z = wert;       // z
      } else if (vorletzter === 118) {            // v
        if (letzter === 49) x = wert;             // v1
        else if (letzter === 50) y = wert;        // v2
        else if (letzter === 51) z = wert;        // v3
      }
    }

    if (art === 1) ecken.drei(x, y, z);
    else {
      if (farbe) merkeFarbe(stand.offen, dreiecke.laenge / 3, farbe);
      if (teilung) {
        (stand.offen.geteiltNr ||= []).push(dreiecke.laenge / 3);
        (stand.offen.geteiltCode ||= []).push(teilung);
      }
      dreiecke.drei(x, y, z);
    }
    i = j + 1;
  }
}

// --- Matrizen -----------------------------------------------------------
//
// 3MF schreibt die Matrix zeilenweise als zwölf Zahlen und rechnet mit
// Zeilenvektoren: v' = v * M + t. Die letzten drei Zahlen sind also die
// Verschiebung.
const EINHEIT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function alsMatrix(text) {
  if (!text) return EINHEIT;
  const z = text.trim().split(/\s+/).map(Number);
  return z.length === 12 && z.every((n) => Number.isFinite(n)) ? z : EINHEIT;
}

function malMatrix(a, b) {
  const r = new Array(12);
  for (let zeile = 0; zeile < 3; zeile++) {
    for (let spalte = 0; spalte < 3; spalte++) {
      r[zeile * 3 + spalte] =
        a[zeile * 3] * b[spalte] +
        a[zeile * 3 + 1] * b[3 + spalte] +
        a[zeile * 3 + 2] * b[6 + spalte];
    }
  }
  for (let spalte = 0; spalte < 3; spalte++) {
    r[9 + spalte] =
      a[9] * b[spalte] + a[10] * b[3 + spalte] + a[11] * b[6 + spalte] + b[9 + spalte];
  }
  return r;
}

function wendeAn(ecken, m) {
  if (m === EINHEIT) return ecken;
  for (let i = 0; i < ecken.length; i += 3) {
    const x = ecken[i], y = ecken[i + 1], z = ecken[i + 2];
    ecken[i]     = x * m[0] + y * m[3] + z * m[6] + m[9];
    ecken[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    ecken[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
  return ecken;
}

function bauteile(xml) {
  const raus = [];
  const muster = /<item\b([^>]*)>/g;
  let treffer;
  while ((treffer = muster.exec(xml))) {
    raus.push({
      objektId: /objectid="([^"]+)"/.exec(treffer[1])?.[1],
      matrix: alsMatrix(/transform="([^"]+)"/.exec(treffer[1])?.[1])
    });
  }
  return raus;
}

// Bambu Studio legt die Namen nicht ins Modell, sondern in eine eigene
// Datei daneben. Dort steht je Objekt ein Name und darunter je Komponente
// noch einer - und erst der sagt, was das einzelne Netz ist: Aus einem
// Objekt "Skadis-Halter" werden so "…_Left" und "…_Right".
//
// Rueckgabe: Map(ObjektId -> { name, teile: Map(KomponentenId -> name) }).
// Fehlt die Datei - etwa bei 3MF aus anderen Programmen -, bleibt sie leer
// und wir benennen durch.
async function einstellungenLesen(zip) {
  const raus = new Map();
  if (!zip.hat('Metadata/model_settings.config')) return raus;
  try {
    const xml = await zip.text('Metadata/model_settings.config');
    const muster = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
    let treffer;
    while ((treffer = muster.exec(xml))) {
      const id = /id="([^"]+)"/.exec(treffer[1])?.[1];
      if (!id) continue;
      const inhalt = treffer[2];

      // Der erste Name gehoert zum Objekt, die weiteren stehen in <part>.
      const kopfEnde = inhalt.search(/<part\b/);
      const kopf = kopfEnde < 0 ? inhalt : inhalt.slice(0, kopfEnde);
      const eintrag = {
        name: /key="name"\s+value="([^"]*)"/.exec(kopf)?.[1] || '',
        extruder: Number(/key="extruder"\s+value="(\d+)"/.exec(kopf)?.[1]) || 0,
        teile: new Map(),
        teilExtruder: new Map()
      };

      const teilMuster = /<part\b([^>]*)>([\s\S]*?)<\/part>/g;
      let teil;
      while ((teil = teilMuster.exec(inhalt))) {
        const teilId = /id="([^"]+)"/.exec(teil[1])?.[1];
        const teilName = /key="name"\s+value="([^"]*)"/.exec(teil[2])?.[1];
        if (teilId && teilName) eintrag.teile.set(teilId, teilName);
        const teilExtruder = Number(/key="extruder"\s+value="(\d+)"/.exec(teil[2])?.[1]);
        if (teilId && teilExtruder) eintrag.teilExtruder.set(teilId, teilExtruder);
      }
      raus.set(id, eintrag);
    }
  } catch { /* ohne Namen geht es auch */ }
  return raus;
}

// Taugt der Name etwas? Bambu schreibt dort auch schon mal "1" oder nichts.
// Die Endung faellt weg - in der Liste steht ohnehin, dass es Netze sind.
function brauchbarerName(name) {
  const sauber = (name || '').trim().replace(/\.(stl|3mf|obj|step|stp)$/i, '');
  return sauber.length >= 2 && !/^\d+$/.test(sauber) ? sauber : '';
}

// Der Name fuer ein einzelnes Netz: erst der der Komponente, dann der des
// Objekts, zuletzt der aus dem Modell selbst.
function nameFuerNetz(einstellungen, herkunft, objekt) {
  const eintrag = einstellungen.get(herkunft.bauObjektId);
  return brauchbarerName(herkunft.komponentenId
          && eintrag?.teile.get(herkunft.komponentenId))
      || brauchbarerName(eintrag?.name)
      || brauchbarerName(objekt.name)
      || '';
}

// --- Einstieg -----------------------------------------------------------

// 3MF gibt die Einheit im <model>-Tag an; fehlt sie, gilt laut Norm
// Millimeter. Wir rechnen gleich beim Einlesen auf Millimeter um - dann
// stimmen Anzeige und Vergleich zwischen Dateien, ohne dass jede weitere
// Stelle die Einheit kennen muss. In der Praxis legen die Slicer
// Millimeter ab; die anderen Einheiten kommen aus CAD-Exporten.
const EINHEITEN = {
  micron: 0.001, millimeter: 1, centimeter: 10,
  inch: 25.4, foot: 304.8, meter: 1000
};

function einheitFaktor(xml) {
  const modellTag = /<model\b[^>]*>/i.exec(xml)?.[0] || '';
  // XML lässt beide Anführungszeichen zu; die Slicer nehmen doppelte,
  // CAD-Exporte gelegentlich einfache.
  const einheit = /\bunit\s*=\s*["']([^"']+)["']/i.exec(modellTag)?.[1]?.toLowerCase();
  return EINHEITEN[einheit] || 1;
}

async function lies3mf(zip, melde) {
  const haupt = await zip.text('3D/3dmodel.model');
  const dokumente = new Map([['/3D/3dmodel.model', objekteAusText(haupt)]]);

  // Jede Teildatei wird genau einmal gelesen und behalten. Bambu verweist
  // mehrfach auf dieselbe - viermal 3 MB zu entpacken waere Verschwendung.
  async function objekteVon(pfad) {
    if (!dokumente.has(pfad)) {
      dokumente.set(pfad,
        await objekteAusStrom(zip.strom(pfad.replace(/^\//, '')), melde));
    }
    return dokumente.get(pfad);
  }

  const netze = [];
  const einstellungen = await einstellungenLesen(zip);

  async function sammle(pfad, objektId, matrix, herkunft) {
    const objekte = await objekteVon(pfad);
    const objekt = objekte.get(objektId);
    if (!objekt) return;

    if (objekt.ecken.length) {
      // Dieselbe Vorlage kann mehrfach auf dem Druckbett stehen. Die Ecken
      // werden deshalb kopiert, bevor die Umformung sie verschiebt - sonst
      // zoege das zweite Exemplar das erste mit sich.
      const netz = {
        ecken: objekt.ecken.slice(),
        indizes: objekt.indizes,
        // Bemalung je Dreieck (0 = unbemalt) und das Filament, mit dem das
        // Teil sonst gedruckt wird: erst das der Komponente, dann das des
        // Objekts, sonst das erste.
        dreieckFarbe: objekt.farben,
        // Feinere Zerlegung fuer die Anzeige, wenn Dreiecke nur teilweise
        // bemalt sind - mit eigener Farbliste. Sonst null.
        feinIndizes: objekt.feinIndizes,
        feinFarbe: objekt.feinFarben,
        extruder: einstellungen.get(herkunft.bauObjektId)?.teilExtruder
                    .get(herkunft.komponentenId)
               || einstellungen.get(herkunft.bauObjektId)?.extruder
               || 1,
        // Woher es stammt - daraus entstehen weiter unten die Teile.
        bau: herkunft.bauObjektId,
        komponente: herkunft.komponentenId,
        name: nameFuerNetz(einstellungen, herkunft, objekt)
      };
      wendeAn(netz.ecken, matrix);
      netze.push(netz);
      return;
    }
    for (const teil of objekt.teile) {
      // Die Komponenten-Nummer wandert mit: Nur ueber sie findet sich der
      // Name des einzelnen Netzes in den Einstellungen wieder.
      await sammle(teil.pfad || pfad, teil.objektId,
                   malMatrix(teil.matrix, matrix),
                   { bauObjektId: herkunft.bauObjektId, komponentenId: teil.objektId });
    }
  }

  for (const item of bauteile(haupt)) {
    await sammle('/3D/3dmodel.model', item.objektId, item.matrix,
                 { bauObjektId: item.objektId, komponentenId: null });
  }

  // Erst ganz zum Schluss skalieren: Die Umformungen der Bauteile gelten in
  // der Einheit der Datei, eine gleichmäßige Streckung danach ändert daran
  // nichts.
  const faktor = einheitFaktor(haupt);
  if (faktor !== 1) {
    for (const { ecken } of netze) {
      for (let i = 0; i < ecken.length; i++) ecken[i] *= faktor;
    }
  }

  // Die Teileliste haengt am Feld, nicht als zweiter Rueckgabewert: Alle
  // Aufrufer erwarten eine Liste von Netzen, und jedes Netz kennt ueber
  // netz.teil ohnehin seine Nummer.
  netze.teile = bildeTeile(netze, einstellungen);
  // Farben der Filamente, Nummer 1 an Stelle 0. Leer, wenn die Datei
  // keine Projekteinstellungen mitbringt - dann gibt es nichts zu faerben.
  netze.farbtafel = await filamentFarben(zip);
  return netze;
}

// --- Vorschaubild -------------------------------------------------------
//
// Jedes 3MF traegt ein fertiges Bild im Paket - deshalb zeigt der
// Windows-Explorer Modelle an, ohne sie zu zeichnen. Welcher Eintrag
// gemeint ist, steht in den Beziehungen des Pakets.
async function bild3mf(zip) {
  const kandidaten = [];
  try {
    const rels = await zip.text('_rels/.rels');
    for (const treffer of rels.match(/<Relationship[^>]*>/g) || []) {
      const typ = /Type="([^"]+)"/.exec(treffer)?.[1] || '';
      const ziel = /Target="([^"]+)"/.exec(treffer)?.[1];
      if (!ziel) continue;
      // Das grosse Deckelbild zuerst, dann das genormte Vorschaubild.
      if (/cover-thumbnail-middle$/i.test(typ)) kandidaten.unshift(ziel);
      else if (/\/metadata\/thumbnail$/i.test(typ)) kandidaten.push(ziel);
    }
  } catch { /* ohne Beziehungen raten wir gleich */ }

  // Fallback fuer Pakete ohne passende Beziehung
  kandidaten.push('/Metadata/thumbnail.png', '/Metadata/plate_1.png');

  for (const ziel of kandidaten) {
    const name = ziel.replace(/^\//, '');
    if (!zip.hat(name)) continue;
    const art = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
    return { name, blob: new Blob([await zip.bytes(name)], { type: art }) };
  }
  return null;
}

// Bambu legt die Einstellungen des Projekts als JSON ab; darin stehen die
// Farben der eingelegten Filamente als "#RRGGBB" (manchmal mit Alpha).
async function filamentFarben(zip) {
  const name = 'Metadata/project_settings.config';
  if (!zip.hat(name)) return [];
  try {
    const farben = JSON.parse(await zip.text(name)).filament_colour;
    if (!Array.isArray(farben)) return [];
    return farben.map((f) => (/^#[0-9a-f]{6}/i.test(f) ? f.slice(0, 7) : null));
  } catch {
    return [];
  }
}

// Fasst die Netze zu Teilen zusammen und vergibt die Nummern.
//
// Ein Bauteil auf dem Druckbett kann aus mehreren Netzen bestehen, und die
// bedeuten zweierlei: Entweder sind es getrennte Koerper, die auch getrennt
// gedruckt werden (ein linker und ein rechter Halter) - oder es sind
// Einlagen in einem Koerper, etwa ein andersfarbiger Schriftzug. Nur die
// Geometrie verraet, was von beidem: Getrennte Koerper liegen nebeneinander,
// Einlagen stecken im Quader des Hauptkoerpers.
function huelle(ecken) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ecken.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (ecken[i + a] < min[a]) min[a] = ecken[i + a];
      if (ecken[i + a] > max[a]) max[a] = ecken[i + a];
    }
  }
  return { min, max };
}

function ueberschneidet(a, b) {
  // Beruehren zaehlt mit: Ein aufgelegter Schriftzug steckt nicht im
  // Koerper, er sitzt auf dessen Oberflaeche - die Quader ueberschneiden
  // sich dann nicht, sie stossen aneinander. Getrennte Teile auf dem
  // Druckbett haben dagegen Millimeter Abstand.
  const spiel = 0.05;
  for (let k = 0; k < 3; k++) {
    if (Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) < -spiel) return false;
  }
  return true;
}

function bildeTeile(netze, einstellungen) {
  const teile = [];
  const nachBau = new Map();
  for (const netz of netze) {
    if (!nachBau.has(netz.bau)) nachBau.set(netz.bau, []);
    nachBau.get(netz.bau).push(netz);
  }

  for (const [bau, gruppe] of nachBau) {
    const huellen = gruppe.map((n) => huelle(n.ecken));
    // Jedes Netz faengt fuer sich an und wird mit allen verschmolzen, die
    // es beruehrt - auch ueber Zwischenschritte.
    const haufen = gruppe.map((_, i) => i);
    const wurzel = (i) => (haufen[i] === i ? i : (haufen[i] = wurzel(haufen[i])));
    for (let i = 0; i < gruppe.length; i++) {
      for (let j = i + 1; j < gruppe.length; j++) {
        if (ueberschneidet(huellen[i], huellen[j])) haufen[wurzel(j)] = wurzel(i);
      }
    }

    const nummern = new Map();
    for (let i = 0; i < gruppe.length; i++) {
      const w = wurzel(i);
      if (!nummern.has(w)) {
        nummern.set(w, teile.length);
        teile.push({ nummer: teile.length, name: '', bau });
      }
      gruppe[i].teil = nummern.get(w);
    }

    // Ein Teil aus genau einem Netz traegt dessen Namen; bei mehreren waere
    // der Name einer Einlage irrefuehrend - dann gilt der des Objekts.
    for (const [w, nummer] of nummern) {
      const seine = gruppe.filter((_, i) => wurzel(i) === w);
      teile[nummer].name = seine.length === 1
        ? seine[0].name
        : brauchbarerName(einstellungen.get(bau)?.name) || seine[0].name;
    }
  }
  return teile;
}

globalThis.lies3mf = lies3mf;
globalThis.bild3mf = bild3mf;

})();
