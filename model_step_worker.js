// STEP lesen - in einem eigenen Faden.
//
// STEP beschreibt Flächen mathematisch, nicht als Dreiecke. Zerlegt werden
// sie mit OpenCascade (occt-import-js, LGPL-2.1, siehe vendor/ und
// LIZENZEN-DRITTER.txt). Das Einlesen ist der teure Teil: eine 8-MB-Datei
// rund neun Sekunden. Deshalb hier statt auf der Seite - die bliebe sonst so
// lange stehen.
//
// Drei Aufträge:
//   laden     Datei einlesen, zerlegen und das Modell behalten
//   zerlegen  das behaltene Modell mit anderer Feinheit neu zerlegen - ohne
//             die Datei noch einmal einzulesen
//   bild      einlesen und zerlegen, aber nicht behalten; für Vorschaubilder,
//             damit sie das gerade angesehene Modell nicht verdrängen
//
// Behalten wird immer nur ein Modell, das zuletzt geladene. Kennung ist der
// Pfad der Datei, den die Seite mitschickt.
//
// Der Kern wird beim ersten Auftrag geladen und danach behalten; das Laden
// der WebAssembly soll nicht bei jeder Datei neu anfallen.
//
// Zwei Fassungen liegen bei: eine einfaedige und eine, die das Zerlegen in
// Dreiecke auf mehrere Kerne verteilt. Die zweite braucht gemeinsamen
// Speicher (SharedArrayBuffer), den Chrome nur isolierten Seiten gibt - das
// regeln cross_origin_opener_policy und cross_origin_embedder_policy im
// Manifest. Fehlt die Isolation, bleibt es bei einem Kern; STEP geht dann
// trotzdem, nur langsamer.
const MIT_THREADS = self.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
const BIBLIOTHEK = MIT_THREADS ? 'vendor/occt-import-js-mt.js' : 'vendor/occt-import-js.js';

// Wie viele Threads: alle des Rechners bis auf zwei - Chrome, die Seite und
// der Rest sollen weiterlaufen -, hoechstens 12, weil es darueber kaum noch
// schneller wird, jeder Thread aber Speicher und Anlaufzeit kostet.
const VERFUEGBAR = navigator.hardwareConcurrency || 4;
const GEWUENSCHT = MIT_THREADS ? Math.max(1, Math.min(12, VERFUEGBAR - 2)) : 1;

importScripts(BIBLIOTHEK);

let kern = null;
let genutzt = 1;
let gehalten = null;
let laufend = 0;
let zaehler = null;

// Die Bibliothek ruft das waehrend der Arbeit auf: abschnitt 1 Datei lesen,
// 2 in Formen umwandeln, 3 in Dreiecke zerlegen; anteil 0..1. Der Auftrag
// selbst laeuft am Stueck - die Nachricht erreicht die Seite trotzdem
// sofort, denn die laeuft in ihrem eigenen Faden.
self.occtFortschritt = (abschnitt, anteil) => {
  postMessage({ nummer: laufend, fortschritt: { abschnitt, anteil } });
};

function holeKern() {
  if (!kern) {
    kern = occtimportjs({
      // Die .wasm liegt neben der Bibliothek, nicht neben diesem Skript.
      locateFile: (name) => 'vendor/' + name,
      // Die Threads sind eigene Worker, die die Bibliothek selbst laden.
      // Ohne diese Angabe naehmen sie das Skript, das gerade laeuft - also
      // diesen Worker hier.
      mainScriptUrlOrBlob: new URL(BIBLIOTHEK, self.location.href).href,
      // So viele Worker legt Emscripten vorab an. OpenCascade bekommt einen
      // weniger, siehe SetupThreads: Einer, der erst waehrend der Arbeit
      // entstehen muesste, kaeme nie zustande.
      occtPool: GEWUENSCHT
    }).then((occt) => {
      genutzt = occt.SetupThreads(GEWUENSCHT);
      // Zaehler beim Zerlegen (Flaechen, Durchgang, Schritt - siehe
      // vendor/occt-import-js-quelle). In der Thread-Fassung liegen sie in
      // gemeinsamem Speicher: Die Seite bekommt die Ansicht einmal und liest
      // selbst mit, auch waehrend dieser Worker am Stueck rechnet.
      if (typeof occt.GetMeshStats === 'function') {
        zaehler = occt.GetMeshStats();
        if (zaehler.buffer instanceof SharedArrayBuffer) {
          postMessage({ zaehler: { puffer: zaehler.buffer, versatz: zaehler.byteOffset, laenge: zaehler.length } });
        }
      }
      return occt;
    });
  }
  return kern;
}

// Die Feinheit kommt von der Seite; ohne Angabe gilt die Voreinstellung der
// Bibliothek. Ausgabe immer in Millimetern, gleich welche Einheit die Datei
// nennt.
function parameter(feinheit) {
  return Object.assign({ linearUnit: 'millimeter' }, feinheit || {});
}

onmessage = async (ereignis) => {
  const { nummer, art, daten, feinheit, kennung } = ereignis.data;
  laufend = nummer;
  try {
    const occt = await holeKern();
    // Stand des Laufzaehlers bei Beginn: Erst wenn er danach steigt, gehoeren
    // die Zaehler zu diesem Auftrag und nicht mehr zum vorigen.
    if (zaehler) postMessage({ nummer, lauf: zaehler[0] });
    let ergebnis;

    if (art === 'zerlegen') {
      if (gehalten !== kennung) throw new Error('nicht geladen');
      ergebnis = occt.RetriangulateStepFile(parameter(feinheit));
    } else if (art === 'laden') {
      gehalten = null;
      ergebnis = occt.LoadStepFile(new Uint8Array(daten), parameter(feinheit));
      if (ergebnis.success) gehalten = kennung;
    } else {
      ergebnis = occt.ReadStepFile(new Uint8Array(daten), parameter(feinheit));
    }
    if (!ergebnis.success) throw new Error('STEP');

    // Die Felder kommen schon als Float32Array/Uint32Array, jedes eine
    // eigene Kopie - sie wandern ohne weiteres Kopieren zur Seite hinüber.
    const netze = ergebnis.meshes.map((m) => ({
      name: m.name || '',
      farbe: Array.isArray(m.color) ? m.color : null,
      ecken: m.attributes.position.array,
      indizes: m.index.array
    }));
    const weiter = [];
    for (const n of netze) weiter.push(n.ecken.buffer, n.indizes.buffer);
    // Fehler in der Datei: reparierte Kanten, Flaechen ohne Zerlegung (siehe
    // vendor/occt-import-js-quelle, Abschnitt 8). Die Seite weist dann darauf
    // hin, dass die Darstellung abweichen kann.
    const warnungen = typeof occt.GetImportWarnings === 'function' ? occt.GetImportWarnings() : null;
    postMessage({ nummer, netze, warnungen, threads: { genutzt, verfuegbar: VERFUEGBAR } }, weiter);
  } catch (fehler) {
    postMessage({ nummer, fehler: String(fehler?.message || fehler) });
  }
};
