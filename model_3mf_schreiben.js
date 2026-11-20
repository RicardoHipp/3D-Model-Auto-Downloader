// 3MF schreiben - mit Farben, fuer alle gaengigen Slicer.
//
// STL kennt keine Farben. Ein 3MF dagegen kann sie auf mehreren Wegen
// tragen, und jeder Slicer liest einen anderen. Geschrieben werden deshalb
// alle, die etwas bringen:
//
//   - Nach 3MF-Norm: eine Farbpalette (<basematerials>), jedes Objekt mit
//     seiner Grundfarbe (pid/pindex), abweichende Dreiecke mit eigener (p1).
//     Das lesen alle normtreuen Programme.
//   - Bambu Studio und OrcaSlicer: paint_color an bemalten Dreiecken, dazu
//     in Metadata/model_settings.config das Filament jedes Objekts. Die
//     Filamentfarben selbst lassen sich dort nicht mitgeben: Sie stehen in
//     Metadata/project_settings.config, und eine unvollstaendige Fassung
//     davon bringt OrcaSlicer zum Absturz (ausprobiert mit 2.3.1). Die
//     Farben stellt man im Slicer ein; welches Teil welches Filament nimmt,
//     kommt mit.
//   - PrusaSlicer: dieselbe Bemalung als slic3rpe:mmu_segmentation und die
//     Farben in Metadata/Slic3r_PE.config.
//
// Bemalung: Die Slicer unterteilen teilweise bemalte Dreiecke und schreiben
// die Unterteilung als Hex-Ziffern an das Dreieck (siehe model_3mf.js,
// malfarbe). Die Originaldaten dafuer haben wir beim Lesen behalten; sie
// gehen unveraendert wieder hinaus. So bleibt die Bemalung im Slicer genau
// wie im Original, und das Netz selbst bekommt keine zusaetzlichen Ecken -
// es bleibt geschlossen.
//
// Lage wie beim STL: in X/Y gemittelt und auf Z=0 gestellt, alle Teile
// gemeinsam, damit sie zueinander stehen bleiben.
//
// netze: wie vom Leser (ecken, indizes, teil, extruder, dreieckFarbe,
//        teilungNr/teilungCode), farbtafel: ["#rrggbb", ...] (Filament 1..n)
// teile: [{ nummer, name }] oder leer
// Ergebnis: Promise<Blob>
(() => {

const KOPF = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NORM = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA = 'http://schemas.slic3r.org/3mf/2017/06';
const ANWENDUNG = '3D Model Downloader & Organizer';

// --- Bemalung verschluesseln ----------------------------------------------
// Ein ungeteiltes Dreieck in Filament n: Von hinten gelesen tragen die
// oberen zwei Bit der letzten Ziffer die Nummer, ab 3 folgt der Rest davor.
// "4" = Filament 1, "8" = 2, "0C" = 3, "1C" = 4 ...
const HEX = '0123456789ABCDEF';
function malCode(n) {
  if (n < 3) return HEX[n << 2];
  let rest = n - 3, code = 'C';
  while (rest >= 15) { code = 'F' + code; rest -= 15; }
  return HEX[rest] + code;
}

const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Zahlen kurz und ohne Rundungsreste: auf 0,01 Mikrometer.
const dekodierer = new TextDecoder();
const zahl = (v) => String(Math.round(v * 1e5) / 1e5);

function mittelpunkt(netze) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { ecken } of netze) {
    for (let i = 0; i < ecken.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const w = ecken[i + k];
        if (w < min[k]) min[k] = w;
        if (w > max[k]) max[k] = w;
      }
    }
  }
  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
}

// Ecken je Netz auf die tatsaechlich benutzten verkleinern. Ein STL hat gar
// keine gemeinsamen Ecken - dort werden gleiche Positionen zusammengelegt,
// sonst saehe der Slicer lauter lose Dreiecke.
function eckenUndDreiecke(netz) {
  const { ecken, indizes } = netz;
  const anzahl = ecken.length / 3;
  const neu = new Int32Array(anzahl).fill(-1);
  const liste = [];
  let nummer = 0;
  if (indizes?.length) {
    const dreiecke = new Uint32Array(indizes.length);
    for (let c = 0; c < indizes.length; c++) {
      const e = indizes[c];
      if (neu[e] < 0) { neu[e] = nummer++; liste.push(e); }
      dreiecke[c] = neu[e];
    }
    return { auswahl: liste, dreiecke };
  }
  const bits = new Uint32Array(ecken.buffer, ecken.byteOffset, ecken.length);
  const tafel = new Map();
  const dreiecke = new Uint32Array(anzahl);
  for (let e = 0; e < anzahl; e++) {
    const schluessel = bits[e * 3] + ',' + bits[e * 3 + 1] + ',' + bits[e * 3 + 2];
    let nr = tafel.get(schluessel);
    if (nr === undefined) { nr = nummer++; tafel.set(schluessel, nr); liste.push(e); }
    dreiecke[e] = nr;
  }
  return { auswahl: liste, dreiecke };
}

// --- Das Modell als Folge von Textstuecken ---------------------------------
// Grosse Modelle ergeben Hunderte Megabyte Text - mehr, als in eine
// Zeichenkette passt. Deshalb in Stuecken, die gleich gepackt werden.
function* modellText(objekte, farbtafel, bunt) {
  yield KOPF + `<model unit="millimeter" xml:lang="en-US" xmlns="${NORM}" xmlns:slic3rpe="${PRUSA}">\n`
    + ` <metadata name="Application">${xmlText(ANWENDUNG)}</metadata>\n <resources>\n`;
  if (bunt) {
    yield '  <basematerials id="1">\n' + farbtafel.map((hex, i) =>
      `   <base name="${xmlText('Filament ' + (i + 1))}" displaycolor="${hex.toUpperCase()}FF"/>\n`).join('')
      + '  </basematerials>\n';
  }
  let stueck = '';
  for (const o of objekte) {
    const farbe = bunt ? ` pid="1" pindex="${o.extruder - 1}"` : '';
    stueck += `  <object id="${o.id}" name="${xmlText(o.name)}" type="model"${farbe}>\n   <mesh>\n    <vertices>\n`;
    for (const t of o.teile) {
      const { ecken, versatz } = t;
      for (const e of t.auswahl) {
        stueck += `     <vertex x="${zahl(ecken[e * 3] - versatz[0])}" y="${zahl(ecken[e * 3 + 1] - versatz[1])}" z="${zahl(ecken[e * 3 + 2] - versatz[2])}"/>\n`;
        if (stueck.length > 1 << 20) { yield stueck; stueck = ''; }
      }
    }
    stueck += '    </vertices>\n    <triangles>\n';
    for (const t of o.teile) {
      const { dreiecke, basis, farbeVon, codeVon } = t;
      for (let d = 0; d < dreiecke.length / 3; d++) {
        stueck += `     <triangle v1="${dreiecke[d * 3] + basis}" v2="${dreiecke[d * 3 + 1] + basis}" v3="${dreiecke[d * 3 + 2] + basis}"`;
        if (bunt) {
          const f = farbeVon(d);
          if (f !== o.extruder) stueck += ` pid="1" p1="${f - 1}"`;
          const code = codeVon(d);
          if (code) stueck += ` paint_color="${code}" slic3rpe:mmu_segmentation="${code}"`;
        }
        stueck += '/>\n';
        if (stueck.length > 1 << 20) { yield stueck; stueck = ''; }
      }
    }
    stueck += '    </triangles>\n   </mesh>\n  </object>\n';
  }
  yield stueck + ' </resources>\n <build>\n'
    + objekte.map((o) => `  <item objectid="${o.id}" printable="1"/>\n`).join('')
    + ' </build>\n</model>\n';
}

// Teile zu Objekten: alle Netze eines Teils in eines.
function baueObjekte(netze, teile, farbtafel, versatz) {
  const gruppen = new Map();
  for (const n of netze) {
    const schluessel = n.teil ?? 0;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(n);
  }
  const zahlFilamente = Math.max(1, farbtafel.length);
  const gueltig = (f) => (f >= 1 && f <= zahlFilamente ? f : 1);
  const objekte = [];
  for (const [nummer, liste] of gruppen) {
    const teil = teile.find((t) => t.nummer === nummer);
    const name = teil?.name || (gruppen.size > 1 ? 'Teil ' + (Number(nummer) + 1) : 'Modell');
    // Grundfarbe: das Filament, mit dem das erste Netz gedruckt wird.
    const extruder = gueltig(liste[0].extruder || 1);
    let basis = 0;
    const stuecke = liste.map((n) => {
      const { auswahl, dreiecke } = eckenUndDreiecke(n);
      const eigen = gueltig(n.extruder || 1);
      const bemalt = n.dreieckFarbe;
      const geteilt = new Map();
      (n.teilungNr || []).forEach((nr, i) => geteilt.set(nr, n.teilungCode[i]));
      const stueck = {
        ecken: n.ecken, versatz, auswahl, dreiecke, basis,
        farbeVon: (d) => gueltig((bemalt && bemalt[d]) || eigen),
        // Originale Unterteilung, sonst die Farbe des ganzen Dreiecks,
        // wenn sie von der Grundfarbe des Objekts abweicht.
        codeVon: (d) => {
          const roh = geteilt.get(d);
          if (roh) return dekodierer.decode(roh);
          const f = gueltig((bemalt && bemalt[d]) || eigen);
          return f !== extruder ? malCode(f) : '';
        }
      };
      basis += auswahl.length;
      return stueck;
    });
    objekte.push({ id: objekte.length + 1, name, extruder, teile: stuecke });
  }
  return objekte;
}

// --- Begleitdateien ----------------------------------------------------------

const INHALTSARTEN = KOPF
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
  + ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
  + ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
  + ' <Default Extension="config" ContentType="text/xml"/>\n'
  + '</Types>\n';

const BEZIEHUNGEN = KOPF
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
  + ' <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
  + '</Relationships>\n';

function bambuObjekte(objekte) {
  return KOPF + '<config>\n' + objekte.map((o) =>
    `  <object id="${o.id}">\n    <metadata key="name" value="${xmlText(o.name)}"/>\n`
    + `    <metadata key="extruder" value="${o.extruder}"/>\n  </object>\n`).join('') + '</config>\n';
}

function prusaObjekte(objekte) {
  return KOPF + '<config>\n' + objekte.map((o) =>
    `  <object id="${o.id}" instances_count="1">\n`
    + `    <metadata type="object" key="name" value="${xmlText(o.name)}"/>\n`
    + `    <metadata type="object" key="extruder" value="${o.extruder}"/>\n  </object>\n`).join('') + '</config>\n';
}

// --- ZIP ------------------------------------------------------------------------
// Gepackt mit dem, was der Browser mitbringt (CompressionStream). Die
// gepackten Stuecke bleiben einzeln liegen und werden erst im Blob
// zusammengesetzt - kein riesiger zusammenhaengender Puffer.

const CRC_TAFEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcWeiter(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TAFEL[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function packe(stuecke) {
  const kodierer = new TextEncoder();
  const strom = new CompressionStream('deflate-raw');
  const schreiber = strom.writable.getWriter();
  const raus = [];
  const lesen = (async () => {
    const leser = strom.readable.getReader();
    let groesse = 0;
    for (;;) {
      const { done, value } = await leser.read();
      if (done) return groesse;
      raus.push(value);
      groesse += value.length;
    }
  })();
  let crc = 0, roh = 0;
  for (const text of stuecke) {
    const bytes = kodierer.encode(text);
    crc = crcWeiter(crc, bytes);
    roh += bytes.length;
    await schreiber.write(bytes);
  }
  await schreiber.close();
  const gepackt = await lesen;
  return { daten: raus, crc, roh, gepackt };
}

async function zipBlob(dateien) {
  const teile = [], verzeichnis = [];
  let ort = 0;
  const kodierer = new TextEncoder();
  for (const { name, stuecke } of dateien) {
    const { daten, crc, roh, gepackt } = await packe(stuecke);
    if (roh > 0xfffffffe || ort > 0xfffffffe) throw new Error('Modell zu gross fuer 3MF');
    const n = kodierer.encode(name);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true);
    kopf.setUint16(4, 20, true);
    kopf.setUint16(6, 0x0800, true);          // Namen in UTF-8
    kopf.setUint16(8, 8, true);               // deflate
    kopf.setUint32(14, crc, true);
    kopf.setUint32(18, gepackt, true);
    kopf.setUint32(22, roh, true);
    kopf.setUint16(26, n.length, true);
    teile.push(kopf, n, ...daten);

    const eintrag = new DataView(new ArrayBuffer(46));
    eintrag.setUint32(0, 0x02014b50, true);
    eintrag.setUint16(4, 20, true);
    eintrag.setUint16(6, 20, true);
    eintrag.setUint16(8, 0x0800, true);
    eintrag.setUint16(10, 8, true);
    eintrag.setUint32(16, crc, true);
    eintrag.setUint32(20, gepackt, true);
    eintrag.setUint32(24, roh, true);
    eintrag.setUint16(28, n.length, true);
    eintrag.setUint32(42, ort, true);
    verzeichnis.push(eintrag, n);
    ort += 30 + n.length + gepackt;
  }
  const groesse = verzeichnis.reduce((s, v) => s + v.byteLength, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, groesse, true);
  ende.setUint32(16, ort, true);
  return new Blob([...teile, ...verzeichnis, ende], { type: 'model/3mf' });
}

// --- Zusammen ---------------------------------------------------------------------

async function schreibe3mf(netze, farbtafel = [], teile = []) {
  // Farben nur, wenn die Datei wirklich welche hat - ein einfarbiges Modell
  // bekommt keine Palette, der Slicer nimmt dann sein eigenes Filament.
  const bunt = farbtafel.length > 0;
  const versatz = mittelpunkt(netze);
  const objekte = baueObjekte(netze, teile, farbtafel, versatz);
  const dateien = [
    { name: '[Content_Types].xml', stuecke: [INHALTSARTEN] },
    { name: '_rels/.rels', stuecke: [BEZIEHUNGEN] },
    { name: '3D/3dmodel.model', stuecke: modellText(objekte, farbtafel, bunt) }
  ];
  if (bunt) {
    dateien.push(
      { name: 'Metadata/model_settings.config', stuecke: [bambuObjekte(objekte)] },
      { name: 'Metadata/Slic3r_PE_model.config', stuecke: [prusaObjekte(objekte)] },
      { name: 'Metadata/Slic3r_PE.config',
        stuecke: [`; extruder_colour = ${farbtafel.map((h) => h.toUpperCase()).join(';')}\n`
                  + `; filament_colour = ${farbtafel.map((h) => h.toUpperCase()).join(';')}\n`] }
    );
  }
  return zipBlob(dateien);
}

globalThis.schreibe3mf = schreibe3mf;

})();
