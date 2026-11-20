// Zwischenspeicher fuer die Vorschaubilder der Dateiliste (Modellseite).
//
// Ein Vorschaubild zu erzeugen kostet: Ein 3MF wird dafuer ganz gelesen
// (oft 50 MB und mehr), STL und STEP muessen eingelesen und gezeichnet
// werden. Die fertigen Bilder (128 Pixel, je etwa 10-30 KB) kommen deshalb
// in die IndexedDB der Erweiterung - sie liegt im Chrome-Profil und
// verschwindet mit der Erweiterung.
//
// Schluessel: Pfad, Groesse und Aenderungszeit der Datei (siehe model.js).
// Aendert sich die Datei, passt er nicht mehr, und das Bild entsteht neu;
// das alte faellt irgendwann ueber die Obergrenze hinaus.
//
// Obergrenze 500 MB. Wird sie ueberschritten, fliegen die am laengsten nicht
// mehr angesehenen Bilder hinaus, bis wieder ein Zehntel frei ist. Die Summe
// wird in derselben Transaktion gefuehrt wie die Bilder - so stimmt sie auch,
// wenn zwei Modellseiten gleichzeitig offen sind.
(() => {

const DB_NAME = 'vorschaubilder';
const BILDER = 'bilder';
const INFO = 'info';
const GRENZE = 500 * 1024 * 1024;
// Wie alt "zuletzt angesehen" sein darf, bevor es beim Lesen erneuert wird -
// sonst schriebe jedes Blaettern durch die Liste in die Datenbank.
const AUFFRISCHEN = 24 * 60 * 60 * 1000;

let offen = null;

function oeffne() {
  if (!offen) {
    offen = new Promise((fertig, fehler) => {
      const anfrage = indexedDB.open(DB_NAME, 1);
      anfrage.onupgradeneeded = () => {
        const db = anfrage.result;
        const bilder = db.createObjectStore(BILDER, { keyPath: 'schluessel' });
        bilder.createIndex('zuletzt', 'zuletzt');
        db.createObjectStore(INFO);
      };
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => fehler(anfrage.error);
    }).catch((e) => { offen = null; throw e; });
  }
  return offen;
}

const warte = (anfrage) => new Promise((fertig, fehler) => {
  anfrage.onsuccess = () => fertig(anfrage.result);
  anfrage.onerror = () => fehler(anfrage.error);
});

const ende = (tx) => new Promise((fertig, fehler) => {
  tx.oncomplete = () => fertig();
  tx.onerror = tx.onabort = () => fehler(tx.error);
});

// Blob oder null. Fehler (z. B. gesperrtes Profil) zaehlen als "nicht da".
async function bildAusSpeicher(schluessel) {
  try {
    const db = await oeffne();
    const eintrag = await warte(db.transaction(BILDER).objectStore(BILDER).get(schluessel));
    if (!eintrag) return null;
    if (Date.now() - eintrag.zuletzt > AUFFRISCHEN) {
      eintrag.zuletzt = Date.now();
      db.transaction(BILDER, 'readwrite').objectStore(BILDER).put(eintrag);
    }
    return eintrag.blob;
  } catch {
    return null;
  }
}

async function bildInSpeicher(schluessel, blob) {
  try {
    const db = await oeffne();
    const tx = db.transaction([BILDER, INFO], 'readwrite');
    const bilder = tx.objectStore(BILDER), info = tx.objectStore(INFO);
    const alt = await warte(bilder.get(schluessel));
    let summe = (await warte(info.get('summe'))) || 0;
    summe += blob.size - (alt ? alt.groesse : 0);
    bilder.put({ schluessel, blob, groesse: blob.size, zuletzt: Date.now() });

    if (summe > GRENZE) {
      // Aelteste zuerst, bis wieder ein Zehntel Luft ist.
      const ziel = GRENZE * 0.9;
      await new Promise((fertig, fehler) => {
        const zeiger = bilder.index('zuletzt').openCursor();
        zeiger.onsuccess = () => {
          const z = zeiger.result;
          if (!z || summe <= ziel) return fertig();
          if (z.value.schluessel !== schluessel) {
            summe -= z.value.groesse;
            z.delete();
          }
          z.continue();
        };
        zeiger.onerror = () => fehler(zeiger.error);
      });
    }
    info.put(Math.max(0, summe), 'summe');
    await ende(tx);
  } catch {
    // Nicht schlimm - dann wird das Bild beim naechsten Mal neu erzeugt.
  }
}

globalThis.bildAusSpeicher = bildAusSpeicher;
globalThis.bildInSpeicher = bildInSpeicher;

})();
