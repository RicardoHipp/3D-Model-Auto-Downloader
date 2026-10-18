// Sobald das Skript geladen ist, dem Service-Worker signalisieren, dass wir bereit sind
chrome.runtime.sendMessage({ action: 'offscreenReady' });

const cyrillicMap = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z','и':'i',
  'й':'j','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t',
  'у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y',
  'ь':'','э':'e','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z','И':'I',
  'Й':'J','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T',
  'У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y',
  'Ь':'','Э':'E','Ю':'Yu','Я':'Ya'
};

function sanitizeName(name) {
  return name.split('').map(c => cyrillicMap[c] ?? c).join('').replace(/[<>:"/\\|?*]/g, '_');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'unzipAndDownload') {
    handleUnzipAndDownload(message.url, message.folderName, message.source);
  }
  // Empfängt Bestätigung, dass die URL gelöscht werden kann
  if (message.action === 'downloadInitiated') {
    URL.revokeObjectURL(message.url);
  }
});

// WICHTIG: Offscreen-Dokumente haben KEINEN Zugriff auf chrome.i18n – dort gibt
// es praktisch nur chrome.runtime. Übersetzt wird deshalb im Service Worker;
// von hier gehen nur der Textschlüssel und seine Platzhalter raus.
function localisedError(key, params) {
  const err = new Error(key);
  err.i18nKey = key;
  err.i18nParams = params || [];
  return err;
}

async function handleUnzipAndDownload(url, folderName, source) {
  try {
    // Wichtig: credentials: 'include' sorgt dafür, dass Cookies (Login) mitgesendet werden
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw localisedError('errorHttp', [String(response.status)]);
    }

    const arrayBuffer = await response.arrayBuffer();

    const zip = await JSZip.loadAsync(arrayBuffer);
    const files = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);

    if (files.length === 0) {
      throw localisedError('errorEmptyZip');
    }

    // Gehe durch alle Dateien im ZIP-Archiv
    for (const [relativePath, fileEntry] of files) {
      try {
        // Ordnerstruktur erhalten, nicht-ASCII-Zeichen bereinigen
        const cleanPath = relativePath.split('/').map(part => sanitizeName(part)).join('/');
        const targetPath = `STL_Downloads/${folderName}/${cleanPath}`;

        // MIME-Type anhand der Dateiendung erzwingen, um fälschliches Umbenennen in .txt durch Chrome zu verhindern
        let mimeType = 'application/octet-stream';
        const pathLower = cleanPath.toLowerCase();
        if (pathLower.endsWith('.stl')) mimeType = 'model/stl';
        else if (pathLower.endsWith('.3mf')) mimeType = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

        // Datei als ArrayBuffer laden und Blob mit passendem MIME-Type erstellen
        const fileData = await fileEntry.async('arraybuffer');
        const blob = new Blob([fileData], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);

        // Übergib den eigentlichen Download an den Service Worker und warte auf Bestätigung
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'startDownload', url: blobUrl, filename: targetPath },
            () => resolve()
          );
        });
      } catch (fileError) {
        console.error(`Datei übersprungen (${relativePath}):`, fileError);
      }
    }

    // Erfolg an Service Worker melden – der übersetzt und zeigt die Meldung
    chrome.runtime.sendMessage({
      action: 'successNotification',
      source,
      folderName
    });

  } catch (error) {
    console.error('Fehler beim Entpacken:', error);
    // Fehler an Service Worker melden. Nur unsere eigenen Fehler tragen einen
    // Schlüssel; alles andere (Netzwerk, JSZip) geht als Rohtext durch.
    chrome.runtime.sendMessage({
      action: 'errorNotification',
      i18nKey: error.i18nKey || null,
      i18nParams: error.i18nParams || [],
      message: error.message
    });
  } finally {
    // Dem Service-Worker mitteilen, dass dieser Download fertig ist
    chrome.runtime.sendMessage({ action: 'downloadFinished' });
  }
}
