// Eigener Gueltigkeitsbereich: Ohne Module teilen sich alle Skripte
// einen Namensraum, und gleich benannte Hilfsfunktionen in zwei
// Dateien ueberschreiben sich sonst gegenseitig.
(() => {

// Minimaler ZIP-Leser.
//
// Ein 3MF ist ein ZIP. JSZip liegt zwar schon im Paket, zieht aber jeden
// Eintrag komplett in den Speicher und bringt eigenen Inflate-Code mit.
// Chrome kann entpacken: DecompressionStream('deflate-raw'). Damit bleibt
// hier nur das Lesen des Inhaltsverzeichnisses - rund 80 Zeilen.
//
// Nicht unterstützt: Verschlüsselung - die kommt in 3MF-Dateien nicht vor.
//
// ZIP64 dagegen schon, und zwar nicht nur bei großen Dateien: Manche
// Programme schreiben die Felder grundsätzlich im ZIP64-Format, auch für
// ein paar hundert Kilobyte. Erkennbar daran, dass in den 32-Bit-Feldern
// lauter Einsen stehen; die echten Werte liegen dann in Zusatzblöcken.
const EOCD_KENNUNG = 0x06054b50;   // Ende des zentralen Verzeichnisses
const DATEI_KENNUNG = 0x02014b50;  // Eintrag im zentralen Verzeichnis
const ZIP64_ORT = 0x07064b50;      // Wegweiser zum ZIP64-Verzeichnisende
const ZIP64_ENDE = 0x06064b50;     // ZIP64-Verzeichnisende
const ALLE_EINSEN = 0xffffffff;    // "steht woanders"

function liesZip(puffer) {
  const sicht = new DataView(puffer);
  const bytes = new Uint8Array(puffer);

  // Das Verzeichnisende steht am Dateiende, dahinter darf nur noch ein
  // Kommentar stehen (höchstens 65535 Bytes). Von hinten suchen.
  let eocd = -1;
  for (let i = puffer.byteLength - 22; i >= Math.max(0, puffer.byteLength - 65557); i--) {
    if (sicht.getUint32(i, true) === EOCD_KENNUNG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Kein ZIP: Verzeichnisende nicht gefunden');

  let anzahl = sicht.getUint16(eocd + 10, true);
  let zeiger = sicht.getUint32(eocd + 16, true);

  // ZIP64: Direkt vor dem Verzeichnisende steht dann ein Wegweiser auf
  // einen zweiten, größeren Block mit denselben Angaben als 64-Bit-Zahlen.
  if (zeiger === ALLE_EINSEN || anzahl === 0xffff) {
    const ort = eocd - 20;
    if (ort >= 0 && sicht.getUint32(ort, true) === ZIP64_ORT) {
      const ende = Number(sicht.getBigUint64(ort + 8, true));
      if (ende >= 0 && ende + 56 <= puffer.byteLength
          && sicht.getUint32(ende, true) === ZIP64_ENDE) {
        anzahl = Number(sicht.getBigUint64(ende + 32, true));
        zeiger = Number(sicht.getBigUint64(ende + 48, true));
      }
    }
  }

  // Holt Werte, die im Verzeichnis durch lauter Einsen ersetzt wurden, aus
  // dem ZIP64-Zusatzblock im Extrafeld desselben Eintrags.
  function ausZusatz(ab, laenge, werte) {
    let i = ab;
    const bis = ab + laenge;
    while (i + 4 <= bis) {
      const kennung = sicht.getUint16(i, true);
      const stueck = sicht.getUint16(i + 2, true);
      if (kennung === 0x0001) {
        let f = i + 4;
        // Reihenfolge ist festgelegt, aber nur die ersetzten Felder stehen
        // wirklich drin - also der Reihe nach durchgehen.
        for (const name of ['roh', 'gepackt', 'kopfAb']) {
          if (werte[name] !== ALLE_EINSEN || f + 8 > bis) continue;
          werte[name] = Number(sicht.getBigUint64(f, true));
          f += 8;
        }
        return;
      }
      i += 4 + stueck;
    }
  }

  const eintraege = new Map();
  for (let n = 0; n < anzahl; n++) {
    if (zeiger + 46 > puffer.byteLength) break;
    if (sicht.getUint32(zeiger, true) !== DATEI_KENNUNG) break;
    const verfahren = sicht.getUint16(zeiger + 10, true);
    const nameLaenge  = sicht.getUint16(zeiger + 28, true);
    const extraLaenge = sicht.getUint16(zeiger + 30, true);
    const kommLaenge  = sicht.getUint16(zeiger + 32, true);
    const werte = {
      gepackt: sicht.getUint32(zeiger + 20, true),
      roh:     sicht.getUint32(zeiger + 24, true),
      kopfAb:  sicht.getUint32(zeiger + 42, true)
    };
    if (werte.gepackt === ALLE_EINSEN || werte.roh === ALLE_EINSEN
        || werte.kopfAb === ALLE_EINSEN) {
      ausZusatz(zeiger + 46 + nameLaenge, extraLaenge, werte);
    }
    const name = new TextDecoder().decode(bytes.subarray(zeiger + 46, zeiger + 46 + nameLaenge));
    eintraege.set(name, { verfahren, ...werte });
    zeiger += 46 + nameLaenge + extraLaenge + kommLaenge;
  }

  // Der lokale Kopf wiederholt Name und Extrafeld - und zwar in anderer
  // Länge als im Verzeichnis. Deshalb muss er für den Datenanfang gelesen
  // werden, statt die Werte von oben zu übernehmen.
  function datenbereich(e) {
    const nameLaenge  = sicht.getUint16(e.kopfAb + 26, true);
    const extraLaenge = sicht.getUint16(e.kopfAb + 28, true);
    const ab = e.kopfAb + 30 + nameLaenge + extraLaenge;
    return bytes.subarray(ab, ab + e.gepackt);
  }

  return {
    namen: () => [...eintraege.keys()],
    hat: (name) => eintraege.has(name),

    // Gibt den Inhalt als Strom zurück - so lässt sich ein 35-MB-XML lesen,
    // ohne es vorher am Stück im Speicher zu haben.
    strom(name) {
      const e = eintraege.get(name);
      if (!e) throw new Error('Nicht im Archiv: ' + name);
      const daten = datenbereich(e);
      const roh = new Blob([daten]).stream();
      return e.verfahren === 0 ? roh : roh.pipeThrough(new DecompressionStream('deflate-raw'));
    },

    async bytes(name) {
      return new Uint8Array(await new Response(this.strom(name)).arrayBuffer());
    },

    async text(name) {
      return await new Response(this.strom(name)).text();
    },

    groesse(name) {
      return eintraege.get(name)?.roh ?? 0;
    }
  };
}

globalThis.liesZip = liesZip;

})();
