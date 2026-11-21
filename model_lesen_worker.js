// 3MF und STL einlesen - in einem eigenen Faden.
//
// Das Einlesen ist reine Rechenarbeit: entpacken, Hunderte Megabyte Text
// durchgehen, Netze aufbauen. Im Hauptfaden der Seite wuerde es Klicks,
// Scrollen und Zeichnen so lange aufhalten - die Seite wirkte traege. Hier
// laufen dieselben Leser wie sonst (model_zip.js, model_3mf.js,
// model_stl.js), nur nebenher.
//
// Bekommt { nummer, art: '3mf' | 'stl', puffer: ArrayBuffer }.
// Antwortet mit { nummer, netze, zusatz } oder { nummer, fehler }.
// netze: die Netze wie vom Leser; zusatz: was am Feld der Netze haengt
// (farbtafel, teile, eigenerExport, aus3mf) - das ginge beim Uebertragen
// verloren.
// Die grossen Zahlenfelder werden uebergeben, nicht kopiert.

importScripts('model_zip.js', 'model_3mf.js', 'model_stl.js');

// Die Malcodes fein bemalter Dreiecke sind viele kleine Felder - beim
// Bayern-Tragerl 173.000. Einzeln uebergeben kostet das Sekunden. Deshalb
// hintereinander in ein Feld, dazu die Anfaenge; die Seite schneidet sie
// wieder auf (entpackeCodes in model.js).
function packeCodes(netze) {
  for (const n of netze) {
    const codes = n.teilungCode;
    if (!codes?.length) continue;
    let laenge = 0;
    for (const c of codes) laenge += c.length;
    const alle = new Uint8Array(laenge);
    const anfang = new Uint32Array(codes.length + 1);
    let ab = 0;
    codes.forEach((c, i) => { anfang[i] = ab; alle.set(c, ab); ab += c.length; });
    anfang[codes.length] = ab;
    n.teilungCode = { alle, anfang };
  }
}

function puffer(netze) {
  const raus = new Set();
  const nimm = (v) => { if (ArrayBuffer.isView(v)) raus.add(v.buffer); };
  for (const n of netze) {
    for (const v of Object.values(n)) {
      nimm(v);
      if (Array.isArray(v)) v.forEach(nimm);
    }
    if (n.teilungCode) { nimm(n.teilungCode.alle); nimm(n.teilungCode.anfang); }
  }
  return [...raus];
}

onmessage = async ({ data }) => {
  try {
    let netze;
    if (data.art === '3mf') {
      netze = await lies3mf(liesZip(data.puffer));
    } else {
      const { ecken } = liesStl(data.puffer);
      netze = ecken.length ? [{ ecken, indizes: null }] : [];
    }
    const zusatz = { farbtafel: netze.farbtafel, teile: netze.teile, eigenerExport: netze.eigenerExport,
                     aus3mf: netze.aus3mf };
    packeCodes(netze);
    postMessage({ nummer: data.nummer, netze: [...netze], zusatz }, puffer(netze));
  } catch (fehler) {
    postMessage({ nummer: data.nummer, fehler: String(fehler?.message || fehler) });
  }
};
