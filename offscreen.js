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
    handleUnzipAndDownload(message.url, message.folderName, message.source, message.tabId);
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

// Meldet den Fortschritt an den Service Worker, der ihn an die Modellseite
// weiterreicht. Ohne diese Kette saehe der Nutzer bei einem grossen Archiv
// minutenlang nichts - Chromes eigene Anzeige entfaellt ja, weil wir nicht
// mehr ueber chrome.downloads laden.
function melde(tabId, daten) {
  if (!tabId) return;
  try { chrome.runtime.sendMessage({ action: 'progressRelay', tabId, ...daten }); } catch {}
}

async function handleUnzipAndDownload(url, folderName, source, tabId) {
  try {
    // Wichtig: credentials: 'include' sorgt dafür, dass Cookies (Login) mitgesendet werden
    const dateiname = decodeURIComponent((url.split('?')[0].split('/').pop() || folderName));
    melde(tabId, { file: dateiname, state: 'laden' });

    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw localisedError('errorHttp', [String(response.status)]);
    }

    // Stueckweise lesen, um den Fortschritt zu kennen. Fehlt Content-Length,
    // zeigt das Banner einen laufenden Balken statt einer erfundenen Zahl.
    const gesamt = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const teile = [];
    let geladen = 0, zuletzt = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      teile.push(value);
      geladen += value.length;
      const jetzt = Date.now();
      if (jetzt - zuletzt > 150) {          // nicht bei jedem Haeppchen melden
        zuletzt = jetzt;
        melde(tabId, {
          file: dateiname,
          state: 'laden',
          percent: gesamt ? (geladen / gesamt) * 100 : undefined,
          text: gesamt ? undefined : (geladen / 1048576).toFixed(1) + ' MB'
        });
      }
    }
    const arrayBuffer = await new Blob(teile).arrayBuffer();

    const zip = await JSZip.loadAsync(arrayBuffer);
    const files = Object.entries(zip.files).filter(([_, entry]) => !entry.dir);

    if (files.length === 0) {
      throw localisedError('errorEmptyZip');
    }

    // Liegen alle Dateien im selben Unterordner, faellt der weg. Cults packt
    // zum Beispiel "Ersteller/Modell/datei.stl" - im Modellordner stuende
    // sonst noch einmal derselbe Name zwei Ebenen tief.
    const gemeinsam = (() => {
      const ordner = files.map(([pfad]) => pfad.split('/').slice(0, -1));
      let tiefe = 0;
      while (ordner.every(o => o.length > tiefe && o[tiefe] === ordner[0][tiefe])) tiefe++;
      return tiefe ? ordner[0].slice(0, tiefe).join('/') + '/' : '';
    })();

    // Zielordner und Berechtigung einmal fuer alle Dateien (siehe
    // zielordnerSchreiber). Null heisst: kein Ordner nutzbar, dann geht jede
    // Datei wie frueher ueber chrome.downloads.
    let schreibe = null;
    try { schreibe = await zielordnerSchreiber(); } catch (e) {
      console.error('Zielordner nicht nutzbar, nutze Downloads:', e);
    }

    // Mehrere Dateien gleichzeitig: Jedes Schreiben wartet vor allem auf
    // Chrome (beim Umhaengen gemessen: 16 gleichzeitig gut zehnmal so schnell
    // wie nacheinander). Begrenzt nach Anzahl UND nach Groesse: Jede Datei
    // liegt waehrenddessen ganz entpackt im Speicher, und eine STL kann
    // einzeln mehrere hundert MB gross sein - zu viel auf einmal, und Chrome
    // beendet diese Seite. Viele kleine Dateien laufen so voll parallel,
    // grosse nur zu zweit oder allein. Eine Datei ueber der Grenze laeuft,
    // sobald sonst nichts mehr laeuft.
    const GRENZE_ANZAHL = 12;
    const GRENZE_BYTES = 512 * 1024 * 1024;
    // Entpackte Groesse steht im Verzeichnis der Zip; fehlt sie, vorsichtig
    // schaetzen.
    const groesseVon = (eintrag) => eintrag._data?.uncompressedSize || 50 * 1024 * 1024;
    let fertig = 0;
    const eineDatei = async (relativePath, fileEntry) => {
      try {
        melde(tabId, {
          file: relativePath.split('/').pop(),
          state: 'entpacken',
          percent: (fertig / files.length) * 100,
          text: `${Math.min(fertig + 1, files.length)} / ${files.length}`
        });
        // Ordnerstruktur erhalten, nicht-ASCII-Zeichen bereinigen
        const cleanPath = relativePath.slice(gemeinsam.length)
          .split('/').map(part => sanitizeName(part)).join('/');
        const targetPath = `STL_Downloads/${folderName}/${cleanPath}`;

        // MIME-Type anhand der Dateiendung erzwingen, um fälschliches Umbenennen in .txt durch Chrome zu verhindern
        let mimeType = 'application/octet-stream';
        const pathLower = cleanPath.toLowerCase();
        if (pathLower.endsWith('.stl')) mimeType = 'model/stl';
        else if (pathLower.endsWith('.3mf')) mimeType = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

        const fileData = await fileEntry.async('arraybuffer');

        // Eigener Zielordner: direkt schreiben. Spart den Umweg ueber Blob-URL
        // und chrome.downloads - und damit die Speicherort-Dialoge, die sonst
        // bei JEDER Datei des Archivs erscheinen. Das "STL_Downloads/"-Praefix
        // entfaellt dabei, der Nutzer hat seinen Ordner ja schon gewaehlt.
        let written = false;
        if (schreibe) {
          try {
            written = await schreibe(`${folderName}/${cleanPath}`, fileData);
          } catch (targetError) {
            console.error('Zielordner-Schreiben fehlgeschlagen, nutze Downloads:', targetError);
          }
        }
        if (written) { fertig++; return; }

        // Normaler Weg: MIME-Type erzwingen, damit Chrome nicht in .txt umbenennt
        const blob = new Blob([fileData], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);

        // Übergib den eigentlichen Download an den Service Worker und warte auf Bestätigung
        await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'startDownload', url: blobUrl, filename: targetPath },
            () => resolve()
          );
        });
        fertig++;
      } catch (fileError) {
        console.error(`Datei übersprungen (${relativePath}):`, fileError);
      }
    };
    // Der Reihe nach starten, solange Anzahl und Groesse es zulassen.
    // eineDatei faengt ihre Fehler selbst ab und scheitert nie.
    await new Promise((alleFertig) => {
      let naechste = 0, laufend = 0, belegt = 0;
      const starte = () => {
        while (naechste < files.length && laufend < GRENZE_ANZAHL) {
          const [relativePath, fileEntry] = files[naechste];
          const groesse = groesseVon(fileEntry);
          if (laufend > 0 && belegt + groesse > GRENZE_BYTES) break;
          naechste++;
          laufend++;
          belegt += groesse;
          eineDatei(relativePath, fileEntry).finally(() => {
            laufend--;
            belegt -= groesse;
            if (naechste >= files.length && laufend === 0) alleFertig();
            else starte();
          });
        }
      };
      starte();
    });

    // Erfolg an Service Worker melden – der übersetzt und zeigt die Meldung
    melde(tabId, { file: folderName, state: 'fertig', text: `${files.length} Dateien` });
    chrome.runtime.sendMessage({
      action: 'successNotification',
      source,
      folderName
    });

  } catch (error) {
    console.error('Fehler beim Entpacken:', error);
    melde(tabId, { file: folderName, state: 'fehler', text: error.message });
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
