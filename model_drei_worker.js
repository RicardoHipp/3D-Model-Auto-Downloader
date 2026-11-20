// Weiche Normalen fuer die Ansicht "Rendern" - mit three.js, in einem eigenen
// Faden, damit die Seite bei grossen Modellen nicht einfriert.
//
// Nach Anleitung-Leora-Optik.md, Abschnitt 1: toCreasedNormals mittelt je
// Ecke ueber die angrenzenden Flaechen, aber nur ueber die, die weniger als
// den Grenzwinkel (35 Grad) abknicken - Kanten bleiben scharf. Gleiche
// Positionen fasst die Funktion selbst zusammen; ein vorheriges
// mergeVertices aendert am Ergebnis nichts und kostet nur Zeit.
//
// Das Ergebnis ist nicht mehr indiziert: drei Ecken je Dreieck, in derselben
// Reihenfolge wie die Dreiecke vorher. Die Farbabschnitte (nach Filament
// sortiert) gelten deshalb unveraendert weiter.
//
// Bekommt { nummer, ecken: Float32Array, indizes: Uint32Array | null, winkel },
// antwortet mit { nummer, lage, normalen } oder { nummer, fehler }.

importScripts('vendor/three.min.js');

onmessage = ({ data }) => {
  try {
    let geo = new DREI.BufferGeometry();
    geo.setAttribute('position', new DREI.BufferAttribute(data.ecken, 3));
    if (data.indizes) geo.setIndex(new DREI.BufferAttribute(data.indizes, 1));
    geo = DREI.toCreasedNormals(geo, data.winkel);
    const lage = geo.attributes.position.array;
    const normalen = geo.attributes.normal.array;
    postMessage({ nummer: data.nummer, lage, normalen }, [lage.buffer, normalen.buffer]);
  } catch (fehler) {
    postMessage({ nummer: data.nummer, fehler: String(fehler?.message || fehler) });
  }
};
