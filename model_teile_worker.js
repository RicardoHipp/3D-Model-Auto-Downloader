// Einzelteile in einem STL suchen - in einem eigenen Faden.
//
// Ein STL kennt keine Objekte; was zusammengehoert, ergibt sich erst aus den
// gemeinsamen Ecken (zerlegeNetz in model_stl.js). Bei grossen Dateien dauert
// das Sekunden. Hier laeuft es gleich nach dem Oeffnen nebenher, und die
// Seite zeigt "In Einzelteile zerlegen" nur, wenn es wirklich mehrere gibt.
//
// Bekommt die Ecken (Float32Array), antwortet mit { netze } - leer, wenn es
// nur einen Koerper gibt.
importScripts('model_stl.js');

onmessage = ({ data: ecken }) => {
  try {
    const koerper = zerlegeNetz(ecken);
    if (koerper.length < 2) { postMessage({ netze: null }); return; }
    postMessage({ netze: koerper }, koerper.map((n) => n.ecken.buffer));
  } catch (fehler) {
    postMessage({ netze: null, fehler: String(fehler?.message || fehler) });
  }
};
