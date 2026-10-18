// Eigener Zielordner über die File System Access API.
//
// Hintergrund: Hat der Nutzer in Chrome "Vor dem Download jeweils nachfragen"
// aktiviert, zeigt chrome.downloads.download für JEDE Datei einen Dialog – bei
// einem entpackten ZIP also zwanzig hintereinander. saveAs: false hilft nicht,
// die Browser-Einstellung hat Vorrang. Wählt der Nutzer hier dagegen einmal
// einen Ordner, schreiben wir direkt hinein und chrome.downloads wird für
// diesen Weg gar nicht mehr gebraucht.
//
// Gemessen (Spike 18.10.2026): Der Downloads-Ordner selbst ist von Chrome
// gesperrt, Unterordner darin sind erlaubt. Die Berechtigung überlebt einen
// Browser-Neustart, und der Service Worker darf ohne Nutzergeste schreiben.
//
// Wird von background.js (importScripts), offscreen.html und options.html
// gemeinsam genutzt.

const TARGET_DB = 'stl-downloader';
const TARGET_STORE = 'handles';
const TARGET_KEY = 'targetDir';

function targetOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TARGET_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TARGET_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function targetIdb(mode, fn) {
  return targetOpenDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(TARGET_STORE, mode);
    const req = fn(tx.objectStore(TARGET_STORE));
    tx.onerror = () => reject(tx.error);
    if (req) req.onsuccess = () => resolve(req.result);
    else tx.oncomplete = () => resolve();
  }));
}

// Verzeichnis-Handles sind strukturiert klonbar und gehören deshalb in
// IndexedDB – in chrome.storage würden sie zu einem leeren Objekt zerfallen.
async function saveTargetDir(handle) {
  await targetIdb('readwrite', store => store.put(handle, TARGET_KEY));
}

async function getTargetDir() {
  try {
    return (await targetIdb('readonly', store => store.get(TARGET_KEY))) || null;
  } catch {
    return null;
  }
}

async function clearTargetDir() {
  await targetIdb('readwrite', store => store.delete(TARGET_KEY));
}

/**
 * 'none'    – kein Ordner gewählt, es gilt der normale Weg über chrome.downloads
 * 'granted' – Ordner gewählt und beschreibbar
 * 'prompt'  – Ordner gewählt, Berechtigung muss per Klick erneuert werden
 */
async function targetDirStatus() {
  const handle = await getTargetDir();
  if (!handle) return { state: 'none', name: null };
  try {
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    return { state: perm === 'granted' ? 'granted' : 'prompt', name: handle.name };
  } catch {
    return { state: 'prompt', name: handle.name };
  }
}

/**
 * Schreibt Daten unter einem relativen Pfad in den Zielordner und legt fehlende
 * Unterordner an. Gibt true zurück, wenn geschrieben wurde – sonst false, damit
 * der Aufrufer auf chrome.downloads zurückfallen kann.
 */
async function writeToTargetDir(relativePath, data) {
  const handle = await getTargetDir();
  if (!handle) return false;

  // Ohne Nutzergeste lässt sich nichts nachfordern. Ist die Berechtigung weg,
  // sauber aussteigen statt einen unbeantwortbaren Prompt zu erzwingen.
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return false;

  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return false;

  let dir = handle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(data);
  await writable.close();
  return true;
}
