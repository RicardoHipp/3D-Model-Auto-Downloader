// Ordner im Windows-Explorer öffnen.
//
// Hintergrund: Chrome darf aus Sicherheitsgründen keine Programme starten. Es
// gibt auch kein von Windows mitgeliefertes Protokoll dafür; `search-ms:` öffnet
// zwar den Explorer, nimmt den Ordnerpfad aber nicht an (geprüft 19.10.2026).
// Also braucht es auf dem Rechner einen Protokoll-Handler. Wir liefern dafür
// zwei kleine Dateien zum Selbsteinrichten aus, siehe explorer_setup.js.
//
// Wir rufen nur das Protokoll auf: keine eigenen Programme, keine zusätzliche
// Berechtigung im Manifest.
//
// Zwei Adressformen:
//   stldl:D:\Ordner\Unterordner   – Ordner öffnen, roh und nicht prozentkodiert
//   stldl:?einrichten|<Kennung>|… – Auftrag, siehe explorerZuordnen()
// Chrome kodiert beim Aufruf selbst, das Skript dekodiert zurück.
//
// Rückkanal: Ein Protokoll-Aufruf gibt keine Rückmeldung. Das Skript legt
// deshalb kleine Dateien in den freigegebenen Ordner, die wir über den
// Verzeichnis-Handle lesen können. Die Namen müssen zu denen im Skript passen –
// explorer_setup.js baut sie aus diesen Konstanten.

const EXP_SCHEMA = 'stldl';
const EXP_LEBENSZEICHEN = '.stldl-ok';
const EXP_FRAGE = '.stldl-frage';
const EXP_ANTWORT = '.stldl-pfad';

// Das Skript merkt sich den zugeordneten Zielordner in dieser Datei - nicht im
// Zielordner selbst, sondern neben sich in %LOCALAPPDATA%. Sie ist der Maßstab
// dafür, welchen Ordner es überhaupt öffnen darf.
const EXP_ZIELDATEI = 'ziel.txt';

// Diese Dateien sind Verständigung zwischen Skript und Erweiterung, kein
// Inhalt des Nutzers – sie gehören nicht in die Dateiliste von "Meine Modelle".
// Normalerweise werden sie sofort wieder entfernt; bricht etwas mittendrin ab,
// kann eine liegen bleiben.
const EXP_HILFSDATEIEN = [EXP_LEBENSZEICHEN, EXP_FRAGE, EXP_ANTWORT];

// Fassung von open-folder.vbs, die diese Erweiterung erwartet. Das Skript
// schreibt seine eigene Fassung in die erste Zeile seiner Antworten – so
// erkennen wir ein älteres Skript, statt den Nutzer rätseln zu lassen.
const EXP_SKRIPT_VERSION = 4;

const EXP_KEYS = { pfad: 'explorerPath' };

async function explorerEinstellungen() {
  const d = await chrome.storage.local.get([EXP_KEYS.pfad]);
  const pfad = (d[EXP_KEYS.pfad] || '').trim().replace(/[\\/]+$/, '');
  return { pfad, nutzbar: !!pfad };
}

async function explorerPfadSetzen(pfad) {
  await chrome.storage.local.set({ [EXP_KEYS.pfad]: (pfad || '').trim() });
}

// Baut stldl:<Basis>\<Unterordner> – Schrägstriche werden zu Backslashes,
// weil der Explorer nur die kennt.
function explorerUrl(basis, unterordner) {
  const teile = [basis.replace(/[\\/]+$/, '')];
  if (unterordner) teile.push(unterordner.replace(/\//g, '\\').replace(/^\\+/, ''));
  return EXP_SCHEMA + ':' + teile.join('\\');
}

// Ruft eine Protokoll-Adresse auf. Nicht über location.href: Chrome reicht
// externe Protokolle von Erweiterungsseiten aus so nicht zuverlässig weiter.
// Ein echter Klick auf einen Anker ist der Weg, den auch Webseiten nutzen.
function explorerOeffnen(url) {
  console.log('[3D Model Downloader & Organizer] Explorer-Aufruf:', url);
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

// --- Rückkanal über den freigegebenen Ordner -------------------------------

async function expSchreibe(ordnerHandle, name, text) {
  const datei = await ordnerHandle.getFileHandle(name, { create: true });
  const strom = await datei.createWritable();
  await strom.write(text);
  await strom.close();
}

// Das Skript legt seine Antwort als UTF-16 ab – als ANSI gingen Umlaute im
// Pfad verloren. Das Lebenszeichen ist dagegen reines ASCII. Beides lesen.
async function expLies(ordnerHandle, name) {
  const datei = await (await ordnerHandle.getFileHandle(name)).getFile();
  const roh = await datei.arrayBuffer();
  const b = new Uint8Array(roh);
  const utf16 = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe;
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(roh).trim();
}

async function expWegraeumen(ordnerHandle, namen) {
  for (const name of namen) {
    try { await ordnerHandle.removeEntry(name); } catch { /* war nicht da */ }
  }
}

// Erste Zeile einer Skript-Antwort ist die Fassungsnummer. Vor Fassung 2 stand
// dort ein Datum – deshalb nur reine Ziffern als Nummer akzeptieren.
function expVersion(zeile) {
  return /^\d+$/.test((zeile || '').trim()) ? parseInt(zeile, 10) : 1;
}

/**
 * Ruft den Explorer auf und prüft, ob das Skript tatsächlich gelaufen ist.
 *
 * ordnerHandle: Verzeichnis, in dem das Lebenszeichen erwartet wird.
 * Rückgabe: { ok, version } – ok=false heißt, das Skript hat nicht geantwortet.
 */
async function explorerOeffnenUndPruefen(url, ordnerHandle, maxWartenMs = 2500) {
  // Reste eines früheren Versuchs wegräumen, sonst meldet der alte Stand Erfolg
  await expWegraeumen(ordnerHandle, [EXP_LEBENSZEICHEN]);

  explorerOeffnen(url);

  const bis = Date.now() + maxWartenMs;
  while (Date.now() < bis) {
    await new Promise(r => setTimeout(r, 120));
    let inhalt;
    try {
      inhalt = await expLies(ordnerHandle, EXP_LEBENSZEICHEN);
    } catch { continue; /* noch nicht da, weiter warten */ }
    await expWegraeumen(ordnerHandle, [EXP_LEBENSZEICHEN]);
    return { ok: true, version: expVersion(inhalt.split(/\r?\n/)[0]) };
  }
  return { ok: false, version: 0 };
}

/**
 * Lässt sich den vollständigen Pfad des freigegebenen Ordners vom Skript geben.
 *
 * Chrome verrät den Pfad eines freigegebenen Ordners nicht – aus dem Handle
 * kommt nur der Ordnername. Das Skript auf dem Rechner kennt ihn dagegen.
 * Ablauf: Wir legen eine Kennung in den Ordner, das Skript öffnet den
 * Ordner-Auswahldialog, sucht die Kennung im gewählten Ordner und schreibt nur
 * dann seinen Pfad zurück. Das erspart dem Nutzer das Abtippen und beweist
 * zugleich, dass es derselbe Ordner ist – ein Namensvergleich könnte das nicht,
 * denn D:\alt\0000 und D:\neu\0000 heißen gleich.
 *
 * Nebenwirkung: Über diesen Weg lässt sich kein fremder Pfad erfragen, weil das
 * Skript ohne passende Kennung schweigt.
 *
 * signal: optionales AbortSignal, um das Warten abzubrechen.
 * Rückgabe: { ok, pfad, version }
 */
// Legt die Kennung in den Zielordner. Sie beweist dem Skript, dass es den
// richtigen Ordner vor sich hat - ohne sie antwortet es nicht, und damit
// laesst sich ueber diesen Weg kein fremder Pfad erfragen.
async function explorerMarkeSetzen(ordnerHandle) {
  const marke = [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  await expWegraeumen(ordnerHandle, [EXP_FRAGE, EXP_ANTWORT]);
  await expSchreibe(ordnerHandle, EXP_FRAGE, marke);
  return marke;
}

// Wartet darauf, dass das Skript seinen Pfad in den Ordner schreibt. Die
// Wartezeit ist beim Einrichten lang: Dort klickt der Nutzer zwischendurch
// durch mehrere Windows-Dialoge.
async function explorerAufAntwortWarten(ordnerHandle, signal = null, maxWartenMs = 90000) {
  let ergebnis = { ok: false, pfad: '', version: 0 };
  const bis = Date.now() + maxWartenMs;

  while (Date.now() < bis && !signal?.aborted) {
    await new Promise(r => setTimeout(r, 250));
    let inhalt;
    try { inhalt = await expLies(ordnerHandle, EXP_ANTWORT); } catch { continue; }
    const zeilen = inhalt.split(/\r?\n/);
    ergebnis = {
      ok: true,
      version: expVersion(zeilen[0]),
      pfad: zeilen.slice(1).join('').trim()
    };
    break;
  }

  await expWegraeumen(ordnerHandle, [EXP_FRAGE, EXP_ANTWORT]);
  return ergebnis;
}

// Der alte Weg ueber die stldl:-Adresse - fuer den Fall, dass die
// Einrichtung schon steht und nur der Ordner neu zugeordnet werden soll.
async function explorerZuordnen(ordnerHandle, signal = null, maxWartenMs = 90000) {
  const marke = await explorerMarkeSetzen(ordnerHandle);

  // Nur die Kennung geht mit. Die Dialogtexte stehen im Skript selbst: Kämen
  // sie aus der Adresse, könnte jede Website ein Windows-Fenster mit frei
  // gewähltem Text aufklappen lassen.
  explorerOeffnen(EXP_SCHEMA + ':?' + ['einrichten', marke].join('|'));

  return await explorerAufAntwortWarten(ordnerHandle, signal, maxWartenMs);
}
