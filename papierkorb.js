// Papierkorb: ganze Modelle und einzelne Dateien verschieben, zurueckholen.
//
// Gemeinsam fuer die Uebersicht (library.js) und die Modellseite (model.js).
// Der Papierkorb ist ein Ordner "_Trash_" im Zielordner.
//
//   Ganze Modelle:     _Trash_/<Ordnername>_deleted-<Datum>/
//   Einzelne Dateien:  _Trash_/_Dateien_/<Kennung>/
//                        eintrag.json   woher (Modell, Pfad) und wann
//                        vorschau.png   das kleine Bild aus der Dateiliste
//                        datei/<Name>   die Datei selbst
//
// Die beiden werden getrennt gefuehrt: Ein Modell ist eine Karte in der
// Uebersicht, eine einzelne Datei eine Zeile darunter - jede mit eigenem
// Bild, einzeln zurueckzuholen oder zu loeschen. Zurueck geht eine Datei in
// ihr Modell, in ihren alten Unterordner; gibt es das Modell nicht mehr,
// wird es unter dem alten Namen neu angelegt.

const PAPIERKORB_ORDNER = '_Trash_';
const DATEIEN_ORDNER = '_Dateien_';
const EINTRAG = 'eintrag.json';
const VORSCHAU = 'vorschau.png';
const DATEI_FACH = 'datei';

function heute() {
  const d = new Date();
  const zwei = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

async function gibtEs(ordner, name) {
  try { await ordner.getDirectoryHandle(name); return true; } catch { return false; }
}

async function freierName(ordner, wunsch) {
  let name = wunsch;
  for (let n = 2; await gibtEs(ordner, name); n++) name = `${wunsch}-${n}`;
  return name;
}

// Freier Dateiname: "Name.stl", sonst "Name (2).stl" ...
async function freieDatei(ordner, wunsch) {
  const punkt = wunsch.lastIndexOf('.');
  const basis = punkt > 0 ? wunsch.slice(0, punkt) : wunsch;
  const endung = punkt > 0 ? wunsch.slice(punkt) : '';
  for (let n = 1; ; n++) {
    const name = n === 1 ? wunsch : `${basis} (${n})${endung}`;
    try { await ordner.getFileHandle(name); } catch { return name; }
  }
}

async function schreibeInhalt(ordner, name, inhalt) {
  const strom = await (await ordner.getFileHandle(name, { create: true })).createWritable();
  await strom.write(inhalt);
  await strom.close();
}

// Eine Datei umhaengen; wo move() nicht geht, kopieren und loeschen.
async function verschiebeDatei(handle, vonOrdner, name, nachOrdner, neuerName) {
  if (typeof FileSystemFileHandle.prototype.move === 'function') {
    try { await handle.move(nachOrdner, neuerName); return; } catch { /* dann kopieren */ }
  }
  const strom = await (await nachOrdner.getFileHandle(neuerName, { create: true })).createWritable();
  await (await handle.getFile()).stream().pipeTo(strom);
  await vonOrdner.removeEntry(name);
}

// Ordner lassen sich nicht verschieben, einzelne Dateien schon: Jede Datei
// wird in den neuen Ordner umgehaengt (move), und wo das nicht geht, kopiert.
// Danach ist der alte Ordner leer und wird entfernt.
async function verschiebe(vonEltern, name, nachEltern, neuerName) {
  const quelle = await vonEltern.getDirectoryHandle(name);
  const ziel = await nachEltern.getDirectoryHandle(neuerName, { create: true });
  let umhaengen = typeof FileSystemFileHandle.prototype.move === 'function';

  const gehe = async (von, nach) => {
    for await (const [kind, eintrag] of von.entries()) {
      if (eintrag.kind === 'directory') {
        await gehe(eintrag, await nach.getDirectoryHandle(kind, { create: true }));
        continue;
      }
      if (umhaengen) {
        try { await eintrag.move(nach, kind); continue; }
        catch { umhaengen = false; }
      }
      const strom = await (await nach.getFileHandle(kind, { create: true })).createWritable();
      await (await eintrag.getFile()).stream().pipeTo(strom);
    }
  };

  await gehe(quelle, ziel);
  await vonEltern.removeEntry(name, { recursive: true });
}

// --- Ganze Modelle ------------------------------------------------------------

async function modellInPapierkorb(wurzel, name) {
  const korb = await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER, { create: true });
  await verschiebe(wurzel, name, korb, await freierName(korb, `${name}_deleted-${heute()}`));
}

// Unter dem alten Namen zurueck, ohne Loeschmarke (geloescht: deren Muster).
// Ist der Name vergeben, haengt freierName eine Nummer an.
async function modellAusPapierkorb(wurzel, name, geloescht) {
  const korb = await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER);
  const ziel = await freierName(wurzel, name.replace(geloescht, ''));
  await verschiebe(korb, name, wurzel, ziel);
  return ziel;
}

// --- Einzelne Dateien -----------------------------------------------------------

// modell: Ordnername des Modells; pfad: relativ dazu, mit "/"; handle und
// eltern: die Datei und der Ordner, in dem sie liegt; vorschau: Blob oder null.
async function dateiInPapierkorb(wurzel, modell, pfad, handle, eltern, vorschau) {
  const korb = await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER, { create: true });
  const ablage = await korb.getDirectoryHandle(DATEIEN_ORDNER, { create: true });
  const kennung = await freierName(ablage, Date.now().toString(36));
  const ordner = await ablage.getDirectoryHandle(kennung, { create: true });
  const name = pfad.split('/').pop();
  try {
    await schreibeInhalt(ordner, EINTRAG, JSON.stringify({ modell, pfad, geloescht: new Date().toISOString() }));
    if (vorschau) await schreibeInhalt(ordner, VORSCHAU, vorschau);
    const fach = await ordner.getDirectoryHandle(DATEI_FACH, { create: true });
    await verschiebeDatei(handle, eltern, name, fach, name);
  } catch (fehler) {
    // Halb angelegt nicht liegen lassen - die Datei ist dann noch am alten Ort.
    try { await ablage.removeEntry(kennung, { recursive: true }); } catch { /* egal */ }
    throw fehler;
  }
}

// Alle einzeln geloeschten Dateien, neueste zuerst:
// [{ kennung, modell, pfad, name, geloescht, groesse, vorschau: Blob|null }]
async function geloeschteDateien(wurzel) {
  let ablage;
  try {
    ablage = await (await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER)).getDirectoryHandle(DATEIEN_ORDNER);
  } catch {
    return [];
  }
  const raus = [];
  for await (const [kennung, ordner] of ablage.entries()) {
    if (ordner.kind !== 'directory') continue;
    try {
      const angaben = JSON.parse(await (await (await ordner.getFileHandle(EINTRAG)).getFile()).text());
      const name = angaben.pfad.split('/').pop();
      const datei = await (await (await ordner.getDirectoryHandle(DATEI_FACH)).getFileHandle(name)).getFile();
      let vorschau = null;
      try { vorschau = await (await ordner.getFileHandle(VORSCHAU)).getFile(); } catch { /* keine */ }
      raus.push({ kennung, ...angaben, name, groesse: datei.size, vorschau });
    } catch { /* unvollstaendiger Eintrag - auslassen */ }
  }
  return raus.sort((a, b) => b.geloescht.localeCompare(a.geloescht));
}

// Zurueck ins Modell, in den alten Unterordner. Ist der Name dort vergeben,
// mit Nummer. Gibt den Pfad zurueck, unter dem die Datei jetzt liegt.
async function dateiAusPapierkorb(wurzel, kennung) {
  const ablage = await (await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER)).getDirectoryHandle(DATEIEN_ORDNER);
  const ordner = await ablage.getDirectoryHandle(kennung);
  const { modell, pfad } = JSON.parse(await (await (await ordner.getFileHandle(EINTRAG)).getFile()).text());
  const teile = pfad.split('/');
  const name = teile.pop();
  let ziel = await wurzel.getDirectoryHandle(modell, { create: true });
  for (const t of teile) ziel = await ziel.getDirectoryHandle(t, { create: true });
  const fach = await ordner.getDirectoryHandle(DATEI_FACH);
  const neuerName = await freieDatei(ziel, name);
  await verschiebeDatei(await fach.getFileHandle(name), fach, name, ziel, neuerName);
  await ablage.removeEntry(kennung, { recursive: true });
  return [...teile, neuerName].join('/');
}

async function dateiEndgueltigLoeschen(wurzel, kennung) {
  const ablage = await (await wurzel.getDirectoryHandle(PAPIERKORB_ORDNER)).getDirectoryHandle(DATEIEN_ORDNER);
  await ablage.removeEntry(kennung, { recursive: true });
}
