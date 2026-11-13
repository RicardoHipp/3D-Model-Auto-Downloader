// ALLERERSTE Zeile: Erscheint sie nicht, startet der Worker gar nicht erst.
// Erscheint sie, bricht der Code danach ab.
console.log('=== SW GESTARTET ===');

importScripts('target_dir.js');

// Fängt alles ab, was im Top-Level-Durchlauf unbehandelt hochkommt. Ohne das
// stirbt der Durchlauf still und es wird kein einziger Listener registriert.
self.addEventListener('error', (e) => {
  console.error('[SW] Unbehandelter Fehler:', e.message, e.filename, e.lineno);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] Unbehandelte Rejection:', e.reason);
});

let DEBUG = false;
let isPaused = false;

const supportedHosts = ['makerworld.com', 'printables.com', 'thingiverse.com'];

function isSupportedUrl(url) {
  try { return supportedHosts.some(h => new URL(url).hostname.includes(h)); } catch { return false; }
}

function updateIconForTab(tabId) {
  if (isPaused) return;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    setActionIcon(isSupportedUrl(tab.url) ? 'green' : 'blue');
  });
}

// Abgesichert: Wirft einer dieser Aufrufe, darf das den restlichen Durchlauf
// nicht abbrechen – sonst werden die Listener darunter nie registriert.
try {
  chrome.storage.local.get('debugMode', (r) => {
    if (chrome.runtime.lastError) { console.error('[Init] local.get:', chrome.runtime.lastError.message); return; }
    DEBUG = !!r.debugMode;
  });
  chrome.storage.session.get('isPaused', (r) => {
    if (chrome.runtime.lastError) { console.error('[Init] session.get:', chrome.runtime.lastError.message); return; }
    isPaused = !!r.isPaused;
    if (isPaused) {
      setActionIcon('yellow');
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) updateIconForTab(tabs[0].id);
        else setActionIcon('mint');
      });
    }
  });
} catch (err) {
  console.error('[Init] Speicherzugriff fehlgeschlagen:', err);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'debugMode' in changes) DEBUG = !!changes.debugMode.newValue;
  if (area === 'session' && 'isPaused' in changes) {
    isPaused = !!changes.isPaused.newValue;
    if (isPaused) {
      setActionIcon('yellow');
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) updateIconForTab(tabs[0].id);
        else setActionIcon('mint');
      });
    }
  }
});

// --- Keepalive -----------------------------------------------------------
// Liegt der Worker lange still, verliert Chrome die Service-Worker-Registrierung:
// auf chrome://serviceworker-internals steht die Registration dann ohne
// "Active worker" da, neue Versionen enden reihum als REDUNDANT und der Worker
// startet nie wieder – nicht mal bis zur ersten Zeile dieser Datei. Aus der
// Erweiterung heraus ist das nicht reparierbar, weil dann ja nichts von uns
// läuft; nur ein Browser-Neustart hilft. Also Prävention statt Reparatur.
// 0.5 = 30 s, das von Chrome erzwungene Minimum für installierte Erweiterungen.
function setupKeepaliveAlarm() {
  chrome.alarms.get('keepAlive', (alarm) => {
    if (chrome.runtime.lastError) return;
    if (!alarm) chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
  });
}

// Bei JEDEM Worker-Start ausführen – nicht nur bei onInstalled/onStartup,
// sonst fehlt der Alarm nach jedem Neustart, der ohne diese Events passiert.
setupKeepaliveAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') setupKeepaliveAlarm(); // erneuern falls verloren
});

chrome.runtime.onStartup.addListener(() => {
  setupKeepaliveAlarm();
  chrome.downloads.search({ state: 'interrupted', limit: 0 }, (downloads) => {
    const eigene = downloads.filter(dl => dl.byExtensionId === chrome.runtime.id);
    for (const dl of eigene) chrome.downloads.erase({ id: dl.id });
  });
});

// Version, deren Neuerungen die Infoseite beschreibt. Nur wer von etwas
// Aelterem kommt, bekommt sie zu sehen - ein reines Fehlerbehebungs-Update
// soll nicht jedes Mal ungefragt einen Tab aufreissen. Bei neuen Punkten auf
// der Seite hier mit hochziehen.
const INFO_VERSION = '1.0.7';

function versionKleiner(a, b) {
  const za = String(a).split('.').map(Number);
  const zb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(za.length, zb.length); i++) {
    const x = za[i] || 0, y = zb[i] || 0;
    if (x !== y) return x < y;
  }
  return false;
}

// Einmalig nach Installation oder Update: zeigen, was die Erweiterung kann
// bzw. was sich geaendert hat. Ein Chrome-Update ist kein Anlass dafuer.
function zeigeInfoseite({ reason, previousVersion }) {
  if (reason === 'install') {
    // Nichts weiter zu pruefen - hier ist alles neu.
  } else if (reason === 'update') {
    if (!previousVersion || !versionKleiner(previousVersion, INFO_VERSION)) return;
  } else {
    return;
  }

  const adresse = 'welcome.html?modus=' + reason
    + (previousVersion ? '&von=' + encodeURIComponent(previousVersion) : '');
  chrome.tabs.create({ url: chrome.runtime.getURL(adresse) });
}

chrome.runtime.onInstalled.addListener((details) => {
  setupKeepaliveAlarm();
  zeigeInfoseite(details);
});

chrome.tabs.onActivated.addListener((info) => updateIconForTab(info.tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Ohne "tabs"-Berechtigung liefert Chrome changeInfo.url nur für Hosts, die wir
  // sehen dürfen. Beim Verlassen einer unterstützten Seite fehlt es – daher status.
  if (!changeInfo.url && !changeInfo.status) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id === tabId) updateIconForTab(tabId);
  });
});

let downloadQueue = [];
let offscreenReady = false;
let creatingOffscreen = null;
let folderMap = {};
let activeExtractions = 0;
let notificationTimer = null;
let pendingNotifications = [];

// URLs die gerade von uns neu gestartet werden – verhindert Endlosschleife
const handledUrls = new Set();
let downloadedImageFolders = new Set();
const pendingImageFolders = new Set();

// --- Zustand über Service-Worker-Neustarts hinweg -------------------------
// Chrome beendet den Worker nach 30 s Untätigkeit; der Keepalive-Alarm weckt ihn
// zwar wieder, hält ihn aber nicht durchgehend am Leben. downloadQueue, folderMap
// und downloadedImageFolders müssen einen Neustart also überleben, sonst landen
// Dateien desselben Modells in verschiedenen Ordnern.
//
// WICHTIG: Der Ladevorgang bekommt einen harten Timeout. Ein Storage-Aufruf, der
// beim Worker-Start hängen bleibt, würde sonst jeden wartenden Aufrufer für immer
// blockieren – und damit die komplette Erweiterung, bis Chrome den Worker abräumt.
// Läuft der Timeout ab, wird mit Standardwerten weitergearbeitet.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('storage timeout')), ms))
  ]);
}

let statePromise = null;
function loadState() {
  if (!statePromise) {
    statePromise = withTimeout(
      chrome.storage.session.get(['folderMap', 'downloadQueue', 'downloadedImageFolders', 'isPaused']),
      1500
    ).then((s) => {
      folderMap = s.folderMap || {};
      downloadQueue = s.downloadQueue || [];
      downloadedImageFolders = new Set(s.downloadedImageFolders || []);
      isPaused = !!s.isPaused;
    }).catch((err) => {
      // Bewusst geschluckt: lieber mit leerem Zustand weiterlaufen als blockieren
      console.error('[State] Laden fehlgeschlagen, nutze Standardwerte:', err.message);
    });
  }
  return statePromise;
}

// Schreibvorgänge serialisieren, damit parallele Downloads sich nicht überschreiben
let saveChain = Promise.resolve();
function saveState() {
  saveChain = saveChain
    .then(() => chrome.storage.session.set({
      folderMap,
      downloadQueue,
      downloadedImageFolders: [...downloadedImageFolders]
    }))
    .catch((err) => console.error('[State] Speichern fehlgeschlagen:', err));
}

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

function sanitizePath(path) {
  return path.split('/').map(segment =>
    segment.split('').map(c => cyrillicMap[c] ?? c).join('').replace(/[<>:"/\\|?*]/g, '_')
  ).join('/');
}

// Icons liegen als fertige PNGs im Paket (icons/<name><groesse>.png).
// Frueher wurden sie zur Laufzeit per OffscreenCanvas gezeichnet: einmal bei
// JEDEM Worker-Start und dreimal bei JEDEM Icon-Wechsel. Das sind
// Grafikressourcen im Service Worker, und der Worker startet sehr oft – bei
// jedem Tab-Wechsel und jedem Seitenladen. Verdacht: genau diese Last hat
// Chrome den Renderer-Prozess zerlegt, bis die Service-Worker-Registrierung
// ohne "Active worker" dastand und der Worker gar nicht mehr startete.
function setActionIcon(name) {
  chrome.action.setIcon({
    path: {
      16: `icons/${name}16.png`,
      32: `icons/${name}32.png`,
      48: `icons/${name}48.png`
    }
  }, () => {
    // lastError abholen, sonst unbehandelte Rejection wenn das Ziel weg ist
    if (chrome.runtime.lastError) return;
  });
}

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: title,
      message: message,
      priority: 2
    }, () => {
      if (chrome.runtime.lastError) console.error('Notification-Fehler:', chrome.runtime.lastError.message);
    });
  } catch (err) {
    console.error('Notification konnte nicht erstellt werden:', err);
  }
}

function queueNotification(source, fileName) {
  pendingNotifications.push({ source, fileName });
  clearTimeout(notificationTimer);
  notificationTimer = setTimeout(flushNotifications, 1500);
}

function flushNotifications() {
  if (pendingNotifications.length === 0) return;
  if (pendingNotifications.length === 1) {
    const { source, fileName } = pendingNotifications[0];
    showNotification(source, chrome.i18n.getMessage('notifyOneFile', [fileName]));
  } else {
    const sources = [...new Set(pendingNotifications.map(n => n.source))];
    const title = sources.length === 1 ? sources[0] : chrome.i18n.getMessage('notifyMultiSourceTitle');
    showNotification(title, chrome.i18n.getMessage('notifyManyFiles', [String(pendingNotifications.length)]));
  }
  pendingNotifications = [];
}

function setFolderMap(key, value) {
  const keys = Object.keys(folderMap);
  if (keys.length >= 100) delete folderMap[keys[0]];
  folderMap[key] = value;
  saveState();
}

function buildFolderName(modelName, source) {
  const transliterated = modelName.split('').map(c => cyrillicMap[c] ?? c).join('');
  const clean = transliterated.replace(/[<>:"/\\|?*]/g, '_').trim();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  // ISO-Datum: in jeder Sprache gleich lesbar und sortiert im Dateiexplorer
  // chronologisch, weil nach Namen sortieren dann auch nach Datum sortiert.
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  // Sprachneutral: kein Bindewort, damit der Ordnername in jeder
  // Oberflaechensprache identisch ausfaellt.
  return `${clean}_${source}_${timestamp}`;
}

// Reicht Fortschrittsmeldungen an die Modellseite weiter, wo das Banner sie
// anzeigt. Schlaegt das fehl (Tab geschlossen, Seite gewechselt), ist das
// unkritisch - der Download laeuft davon unabhaengig weiter.
function meldeFortschritt(tabId, daten) {
  if (!tabId) return;
  try {
    // action bewusst NACH dem Spread setzen: Sonst ueberschreibt ein in den
    // Daten verbliebenes action-Feld sie wieder, und das Banner wartet ewig.
    chrome.tabs.sendMessage(tabId, { ...daten, action: 'downloadProgress' }, () => {
      void chrome.runtime.lastError;
    });
  } catch { /* Tab existiert nicht mehr */ }
}

// Zuletzt gemeldeter gestoppter Download. Ein Modell besteht aus mehreren
// Dateien - ohne diese Sperre gaebe es pro Datei eine Benachrichtigung und
// einen Sprung in die Einstellungen.
let gestopptGemeldet = 0;

// Ohne nutzbaren Zielordner laedt die Erweiterung bewusst nichts herunter -
// auch nicht ersatzweise in den Downloads-Ordner. Genau das Durcheinander
// dort ist der Grund, warum es sie gibt. Gibt true zurueck, wenn es
// weitergehen darf.
async function zielordnerBereit(tabId) {
  const { state } = await targetDirStatus();
  if (state === 'granted') return true;

  // 'prompt' heisst: Ordner ist gesetzt, nur die Berechtigung fehlt. Das
  // braucht eine andere Meldung als ein fehlender Ordner, sonst sucht der
  // Nutzer an der falschen Stelle.
  const istAbgelaufen = state === 'prompt';

  // Auf der Seite immer melden - dort hat der Nutzer gerade hingesehen, und
  // ein haengendes Fortschrittsband waere schlimmer als eine Meldung zu viel.
  meldeFortschritt(tabId, {
    state: 'fehler',
    file: chrome.i18n.getMessage(istAbgelaufen ? 'bannerPermExpired' : 'bannerNoTarget'),
    text: chrome.i18n.getMessage('bannerOpenOptions')
  });

  if (Date.now() - gestopptGemeldet > 15000) {
    gestopptGemeldet = Date.now();
    showNotification(
      chrome.i18n.getMessage(istAbgelaufen ? 'permExpiredTitle' : 'noTargetTitle'),
      chrome.i18n.getMessage(istAbgelaufen ? 'permExpiredMessage' : 'noTargetMessage')
    );
    // Grund hinterlegen, damit die Einstellungsseite erklaeren kann, warum sie
    // gerade von selbst aufgegangen ist - sonst steht der Nutzer ohne
    // Zusammenhang vor einer Seite, die er nicht aufgerufen hat. Ueber den
    // Speicher statt ueber die Adresse, weil openOptionsPage() keine Parameter
    // nimmt und so auch ein bereits offener Tab erreicht wird.
    await chrome.storage.session.set({
      downloadGestoppt: { grund: istAbgelaufen ? 'berechtigung' : 'kein-ordner' }
    });
    chrome.runtime.openOptionsPage();
  }
  return false;
}

// chrome.downloads meldet sich nicht von selbst zurueck: Der Rueckruf kommt,
// sobald der Download *beginnt*. Ohne das hier liefe das Fortschrittsband
// weiter, obwohl die Datei laengst auf der Platte liegt.
function begleiteDownload(downloadId, tabId, datei) {
  if (!tabId) return;
  if (!downloadId) {
    meldeFortschritt(tabId, { file: datei, state: 'fehler', text: chrome.i18n.getMessage('bannerFailed') });
    return;
  }
  const horcher = (delta) => {
    if (delta.id !== downloadId || !delta.state || delta.state.current === 'in_progress') return;
    chrome.downloads.onChanged.removeListener(horcher);
    meldeFortschritt(tabId, delta.state.current === 'complete'
      ? { file: datei, state: 'fertig' }
      : { file: datei, state: 'fehler', text: chrome.i18n.getMessage('bannerFailed') });
  };
  chrome.downloads.onChanged.addListener(horcher);
}

// Versucht, eine Datei direkt in den vom Nutzer gewaehlten Zielordner zu
// schreiben. Gibt false zurueck, wenn kein Ordner gesetzt ist, die Berechtigung
// fehlt oder der Abruf scheitert - dann uebernimmt chrome.downloads wie bisher.
// Dieser Fallback ist wichtig: Nicht jede CDN-URL laesst sich per fetch holen,
// etwa wenn sie auf einen Host umleitet, fuer den wir keine Berechtigung haben.
async function tryWriteToTarget(url, relativePath) {
  try {
    const { state } = await targetDirStatus();
    if (state !== 'granted') return false;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return false;
    return await writeToTargetDir(relativePath, await res.arrayBuffer());
  } catch (err) {
    if (DEBUG) console.log('[Ziel] Direktes Schreiben fehlgeschlagen:', err.message);
    return false;
  }
}

// --- Herkunftsvermerk ----------------------------------------------------
//
// Neben die Dateien kommt eine info.txt mit der Adresse der Modellseite.
// Aufbau wie ein Briefkopf: "Schluessel: Wert" je Zeile, dann eine
// Leerzeile, danach freier Text. So laesst sich spaeter die Beschreibung
// der Website anhaengen, ohne das Format zu aendern - und lesbar bleibt es
// auch mit dem Editor.
const INFO_DATEI = 'info.txt';

function infoInhalt({ titel, quelle, adresse }) {
  const jetzt = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const zeilen = [
    '# ' + chrome.i18n.getMessage('appName'),
    '# ' + chrome.i18n.getMessage('infoHeader'),
    '',
    'Titel: ' + (titel || ''),
    'Plattform: ' + (quelle || ''),
    'Adresse: ' + (adresse || ''),
    'Heruntergeladen: ' + [
      jetzt.getFullYear() + '-' + pad(jetzt.getMonth() + 1) + '-' + pad(jetzt.getDate()),
      pad(jetzt.getHours()) + ':' + pad(jetzt.getMinutes())
    ].join(' '),
    '',
    ''
  ];
  // CRLF: Die Datei wird in erster Linie unter Windows gelesen, und der
  // Editor bricht dort sonst nicht um.
  return zeilen.join('\r\n');
}

async function schreibeInfo(folderName, angaben) {
  try {
    const pfad = folderName + '/' + INFO_DATEI;
    // Niemals ueberschreiben: In der Datei kann inzwischen mehr stehen,
    // als wir hineingeschrieben haben.
    if (await targetFileExists(pfad)) return;
    await writeToTargetDir(pfad, new Blob([infoInhalt(angaben)], { type: 'text/plain' }));
  } catch (err) {
    if (DEBUG) console.log('[Info] info.txt nicht geschrieben:', err.message);
  }
}

// saveAs: false bei allen eigenen Downloads.
// Hat der Nutzer "Speicherort immer erfragen" aktiviert, wuerde Chrome sonst
// fuer JEDE Datei einen Dialog zeigen - bei einem entpackten ZIP also zwanzig
// hintereinander. Die Erweiterung wird ja gerade installiert, damit nicht mehr
// gefragt wird. Chromes Dialog fuer den urspruenglichen Download der Webseite
// bleibt davon unberuehrt, den koennen wir nicht unterdruecken.
async function downloadImage(imageUrl, folderName) {
  if (DEBUG) console.log('[IMG]', folderName.substring(0, 40), '| url:', !!imageUrl, '| bereitsGeladen:', downloadedImageFolders.has(folderName));
  if (!imageUrl || downloadedImageFolders.has(folderName)) return;
  downloadedImageFolders.add(folderName);
  saveState();
  handledUrls.add(imageUrl);
  let ext = 'jpg';
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    if (pathname.endsWith('.png')) ext = 'png';
    else if (pathname.endsWith('.webp')) ext = 'webp';
  } catch {}
  if (await tryWriteToTarget(imageUrl, `${folderName}/preview.${ext}`)) {
    handledUrls.delete(imageUrl);
    return;
  }
  chrome.downloads.download({
    url: imageUrl,
    filename: `STL_Downloads/${folderName}/preview.${ext}`,
    conflictAction: 'uniquify',
    saveAs: false
  }, () => {
    handledUrls.delete(imageUrl);
  });
}

async function setupOffscreenDocument() {
  if (offscreenReady) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  // Sofort sperren – BEVOR irgendein await, sonst Race Condition bei parallelen ZIP-Downloads
  creatingOffscreen = (async () => {
    try {
      if (await chrome.offscreen.hasDocument()) {
        await chrome.offscreen.closeDocument();
      }
    } catch {}
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Entpacken der Zip-Dateien im Browser-Speicher'
    });
  })();
  try {
    await creatingOffscreen;
  } catch (err) {
    console.error('[Offscreen] Erstellung fehlgeschlagen:', err);
  }
}

// Verarbeitet einen Download, den ein Content-Script abgefangen hat, bevor der
// Browser ihn starten konnte - fuer Thingiverse, Printables und MakerWorld.
async function handleInterceptedDownload(cdnUrl, imageUrl, tab, source) {
  await loadState();
  if (isPaused) return;
  // Gilt fuer alle drei Plattformen. Thingiverse lief hier frueher vorbei und
  // landete ueber den Fallback im Downloads-Ordner.
  if (!await zielordnerBereit(tab?.id)) return;
  let modelName = 'Model';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.innerText.trim() : document.title;
      }
    });
    if (results?.[0]?.result) modelName = results[0].result;
  } catch (err) {
    console.error('Thingiverse Tab-Script fehlgeschlagen:', err);
  }

  const folderKey = tab?.url;
  let finalFolderName;
  if (folderKey && folderMap[folderKey]) {
    finalFolderName = folderMap[folderKey];
  } else {
    finalFolderName = buildFolderName(modelName, source);
    if (folderKey) setFolderMap(folderKey, finalFolderName);
  }

  schreibeInfo(finalFolderName, { titel: modelName, quelle: source, adresse: folderKey });

  const urlWithoutQuery = cdnUrl.split('?')[0];
  const rawFileName = urlWithoutQuery.split('/').pop();
  const cleanFileName = (() => { try { return decodeURIComponent(rawFileName); } catch { return rawFileName; } })();
  const urlPath = urlWithoutQuery.toLowerCase();
  if (urlPath.endsWith('.zip')) {
    if (downloadQueue.some(item => item.url === cdnUrl)) { if (DEBUG) console.log('[DL] SKIP zip duplikat'); return; }
    downloadQueue.push({ url: cdnUrl, folderName: finalFolderName, imageUrl, source, tabId: tab?.id });
    saveState();
    await setupOffscreenDocument();
    if (offscreenReady && downloadQueue.length > 0) processQueue();
  } else {
    const safeFileName = sanitizePath(cleanFileName);
    if (DEBUG) console.log('[DL] download:', safeFileName, '→', finalFolderName, '| imageUrl:', !!imageUrl);
    // Beide URL-Varianten eintragen (Kyrillisch + percent-encoded), da Chrome beim Download normalisiert
    handledUrls.add(cdnUrl);
    try { handledUrls.add(new URL(cdnUrl).href); } catch {}
    meldeFortschritt(tab?.id, { file: safeFileName, state: 'laden' });
    const direkt = await tryWriteToTarget(cdnUrl, `${finalFolderName}/${safeFileName}`);
    meldeFortschritt(tab?.id, {
      file: safeFileName,
      state: direkt ? 'fertig' : 'laden',
      text: direkt ? undefined : ''
    });
    if (direkt) {
      handledUrls.delete(cdnUrl);
      try { handledUrls.delete(new URL(cdnUrl).href); } catch {}
    } else {
      chrome.downloads.download({
        url: cdnUrl,
        filename: `STL_Downloads/${finalFolderName}/${safeFileName}`,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        handledUrls.delete(cdnUrl);
        try { handledUrls.delete(new URL(cdnUrl).href); } catch {}
        begleiteDownload(downloadId, tab?.id, safeFileName);
      });
    }
    if (imageUrl) {
      downloadImage(imageUrl, finalFolderName);
    } else if (tab?.id && !downloadedImageFolders.has(finalFolderName) && !pendingImageFolders.has(finalFolderName)) {
      pendingImageFolders.add(finalFolderName);
      setTimeout(async () => {
        pendingImageFolders.delete(finalFolderName);
        if (downloadedImageFolders.has(finalFolderName)) return;
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.content || null
          });
          const img = results?.[0]?.result;
          if (img) downloadImage(img, finalFolderName);
        } catch {}
      }, 2000);
    }
    queueNotification(source, safeFileName);
  }
}

function processQueue() {
  if (downloadQueue.length === 0) return;
  const item = downloadQueue.shift();
  saveState();
  chrome.runtime.sendMessage({
    action: 'unzipAndDownload',
    url: item.url,
    folderName: item.folderName,
    source: item.source,
    tabId: item.tabId
  });
  if (item.imageUrl) {
    downloadImage(item.imageUrl, item.folderName);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'thingiverseIntercept') {
    if (DEBUG) console.log('[TV] intercept:', message.url.split('/').pop(), '| imageUrl:', !!message.imageUrl);
    handleInterceptedDownload(message.url, message.imageUrl || null, sender.tab, 'Thingiverse');
  }
  // Von content_dl_* abgefangener Download auf Printables oder MakerWorld.
  // Die Bestaetigung ist Teil der Absicherung: Bleibt sie aus, startet die
  // Seite den urspruenglichen Download doch, statt ihn zu verlieren.
  if (message.action === 'interceptedDownload') {
    const url = message.url || '';
    // Nicht der Seite vertrauen - nur bekannte Auslieferungshosts akzeptieren
    if (!/^https:\/\/(files\.printables\.com|[^/]*\.bblmw\.com)\//i.test(url)) {
      sendResponse({ ok: false });
      return true;
    }
    const quelle = /\.bblmw\.com\//i.test(url) ? 'MakerWorld' : 'Printables';
    if (DEBUG) console.log('[DL] abgefangen:', quelle, url.split('/').pop().split('?')[0]);

    (async () => {
      // Pausiert heisst: Haende weg. Ohne "ok: false" wuerde die Seite den
      // Download zwar selbst starten, die Erweiterung ihn aber trotzdem noch
      // wegen des fehlenden Zielordners stoppen - genau das, was Pause
      // abschalten soll.
      await loadState();
      if (isPaused) {
        sendResponse({ ok: false });
        return;
      }
      // Ohne Zielordner wird bewusst NICHT heruntergeladen: Der Nutzer soll
      // merken, dass noch etwas fehlt, statt dass Chrome ihn fuer jede Datei
      // nach dem Speicherort fragt. "ok: true" haelt den Klick blockiert, die
      // Seite startet den urspruenglichen Download also nicht ersatzweise.
      if (!await zielordnerBereit(sender.tab?.id)) {
        sendResponse({ ok: true });
        return;
      }
      handleInterceptedDownload(url, message.imageUrl || null, sender.tab, quelle);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.action === 'progressRelay') {
    const { tabId, action, ...rest } = message;
    meldeFortschritt(tabId, rest);
  }
  if (message.action === 'offscreenReady') {
    offscreenReady = true;
    creatingOffscreen = null;
    loadState().then(processQueue);
  }
  if (message.action === 'startDownload') {
    const safe = sanitizePath(message.filename);
    if (!safe.startsWith('STL_Downloads/')) {
      console.error('[Download] Ungültiger Pfad abgelehnt:', safe);
      sendResponse();
      return true;
    }
    activeExtractions++;
    handledUrls.add(message.url);
    chrome.downloads.download({
      url: message.url,
      filename: safe,
      conflictAction: 'uniquify',
      saveAs: false
    }, () => {
      activeExtractions = Math.max(0, activeExtractions - 1);
      handledUrls.delete(message.url);
      chrome.runtime.sendMessage({ action: 'downloadInitiated', url: message.url });
      sendResponse();
    });
    return true; // asynchrone sendResponse ankündigen
  }
  // Übersetzt wird hier, nicht im Offscreen-Dokument: dort gibt es kein chrome.i18n.
  if (message.action === 'successNotification') {
    showNotification(
      chrome.i18n.getMessage('notifySuccessTitle'),
      chrome.i18n.getMessage('notifyUnpacked', [message.source, message.folderName])
    );
  }
  if (message.action === 'errorNotification') {
    const text = message.i18nKey
      ? chrome.i18n.getMessage(message.i18nKey, message.i18nParams || [])
      : message.message;
    showNotification(chrome.i18n.getMessage('notifyErrorTitle'), text);
  }
  if (message.action === 'downloadFinished') {
    loadState().then(() => {
      if (downloadQueue.length === 0) return;
      setupOffscreenDocument().then(() => {
        if (offscreenReady) processQueue();
      });
    });
  }
});

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  await loadState();
  if (isPaused) return;
  const isBlobCE = downloadItem.url?.startsWith('blob:chrome-extension://');
  const isInHandled = handledUrls.has(downloadItem.url);
  // Chrome feuert beim SW-Start onCreated für alle kürzlich abgeschlossenen Downloads nach – ignorieren
  if (downloadItem.state === 'complete') return;
  // 1. Eigene Downloads ignorieren (Endlosschleifen-Schutz)
  if (isBlobCE) return;
  if (isInHandled) return;
  // Chrome resumed einen alten Download den wir initiiert haben – nicht nochmal verarbeiten
  if (downloadItem.byExtensionId === chrome.runtime.id) {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    return;
  }
  // Eigene resumed Downloads erkannt am Pfad (Fallback)
  if ((downloadItem.filename || '').includes('STL_Downloads')) return;
  // Thingiverse Blob-Downloads canceln – wir laden bereits von der CDN-URL
  if (downloadItem.url?.startsWith('blob:https://www.thingiverse.com/')) {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    return;
  }
  if (downloadItem.url?.startsWith('blob:')) return;

  // 2. Quelle erkennen – per Referrer ODER URL (synchron)
  const ref = downloadItem.referrer || '';
  const urlStr = downloadItem.url || '';

  const isMakerWorld = ref.includes('makerworld.com') || urlStr.includes('makerworld.com') || urlStr.includes('bblmw.com');
  const isPrintables = ref.includes('printables.com') || urlStr.includes('printables.com');

  // Tabs früh abfragen – für Thingiverse-Fallback und Startup-Schutz
  const tabs = await chrome.tabs.query({});
  const hasThingiTab = tabs.some(t => t.url?.includes('thingiverse.com'));

  // Thingiverse-Erkennung: URL/Referrer enthält thingiverse.com,
  // ODER Download kommt vom Thingiverse-CDN während ein Thingiverse-Tab offen ist
  const isThingiverse = ref.includes('thingiverse.com') || urlStr.includes('thingiverse.com')
    || (hasThingiTab && urlStr.includes('cdn.thingiverse.com'));

  if (!isMakerWorld && !isPrintables && !isThingiverse) return;

  const source = isMakerWorld ? 'MakerWorld' : isPrintables ? 'Printables' : 'Thingiverse';
  const sourceKeyword = isMakerWorld ? 'makerworld.com' : isPrintables ? 'printables.com' : 'thingiverse.com';

  const referrerOrigin = ref ? (() => { try { return new URL(ref).origin; } catch { return null; } })() : null;

  // 3. Startup-Schutz: passender Tab muss offen sein
  if (!isThingiverse) {
    const hasOpenTab = referrerOrigin
      ? tabs.some(t => { try { return new URL(t.url).origin === referrerOrigin; } catch { return false; } })
      : tabs.some(t => t.url?.includes(sourceKeyword));
    if (!hasOpenTab) return;
  } else {
    if (!hasThingiTab) return;
  }

  // 4. Dateityp prüfen
  const filenameLower = (downloadItem.filename || '').toLowerCase();
  const urlLower = urlStr.toLowerCase();
  const isZip  = filenameLower.endsWith('.zip')   || urlLower.includes('.zip')
    || downloadItem.mime === 'application/zip'
    || downloadItem.mime === 'application/x-zip-compressed'
    || downloadItem.mime === 'application/x-zip';
  const isStl  = filenameLower.endsWith('.stl')   || urlLower.includes('.stl');
  const is3mf  = filenameLower.endsWith('.3mf')   || urlLower.includes('.3mf');
  const isGcode = filenameLower.endsWith('.gcode') || urlLower.includes('.gcode');
  const isPdf  = filenameLower.endsWith('.pdf')   || urlLower.includes('.pdf');
  if (!isZip && !isStl && !is3mf && !isGcode && !isPdf) return;

  // Fehlt der Zielordner, wird der Download abgebrochen statt im
  // Downloads-Ordner abgelegt. Hier hat Chrome ihn schon begonnen - also
  // zuruecknehmen, sonst liegt die Datei doch wieder am falschen Platz.
  const zielTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!await zielordnerBereit(zielTab?.id)) {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    return;
  }

  // 5. Modellname aus offenem Tab lesen
  let modelName = 'Model';
  let imageUrl = null;
  const referrer = ref;
  let matchingTab = null;

  try {
    // Printables: Modell-ID aus CDN-URL extrahieren und direkt den richtigen Tab finden
    // (verhindert Fehler wenn Referrer die Such-Seite ist statt der Modell-Seite)
    if (isPrintables) {
      const modelIdMatch = urlStr.match(/\/prints\/(\d+)\//);
      if (modelIdMatch) {
        const modelId = modelIdMatch[1];
        matchingTab = tabs.find(t => t.url?.includes(`printables.com/model/${modelId}`));
      }
    }
    // Mit Referrer: exakt per URL matchen. Ohne Referrer (Thingiverse): per Domain-Keyword
    if (!matchingTab) {
      const referrerPath = referrer ? referrer.split('?')[0] : null;
      matchingTab = referrerPath
        ? (tabs.find(t => t.url?.startsWith(referrerPath)) ?? tabs.find(t => { try { return new URL(t.url).origin === referrerOrigin; } catch { return false; } }))
        : tabs.find(t => t.url?.includes(sourceKeyword));
    }
    if (matchingTab) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: matchingTab.id },
        func: () => {
          const h1 = document.querySelector('h1');
          const title = h1 ? h1.innerText.trim() : document.title;
          const ogImage = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
          return { title, imgUrl: ogImage?.content || null };
        }
      });
      if (results?.[0]?.result) {
        modelName = results[0].result.title;
        imageUrl = results[0].result.imgUrl;
      }
    }
  } catch (err) {
    console.error('Tab-Script fehlgeschlagen:', err);
  }

  if (modelName === 'Model' && downloadItem.filename) {
    const baseName = downloadItem.filename.split(/[\\/]/).pop() || 'Model';
    modelName = baseName.replace(/\.zip$/i, '').replace(/-3mf$/i, '').replace(/-stl$/i, '');
  }

  // 6. Ordnername generieren
  // Key = Tab-URL (spezifische Modellseite), nicht der Referrer (könnte für mehrere Modelle gleich sein)
  const folderKey = matchingTab?.url || referrer;
  let finalFolderName;
  if (folderKey && folderMap[folderKey]) {
    finalFolderName = folderMap[folderKey];
    imageUrl = null;
  } else {
    finalFolderName = buildFolderName(modelName, source);
    if (folderKey) setFolderMap(folderKey, finalFolderName);
  }

  schreibeInfo(finalFolderName, { titel: modelName, quelle: source, adresse: folderKey });

  // 7. Download abwickeln
  if (isZip) {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    if (downloadQueue.some(item => item.url === downloadItem.url)) return;
    downloadQueue.push({ url: downloadItem.url, folderName: finalFolderName, imageUrl, source, tabId: matchingTab?.id });
    saveState();
    await setupOffscreenDocument();
    if (offscreenReady && downloadQueue.length > 0) processQueue();
  } else {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    const nameFromFile = sanitizePath(downloadItem.filename.split(/[\\/]/).pop());
    const rawFromUrl   = (() => { try { return decodeURIComponent(downloadItem.url.split('/').pop().split('?')[0]); } catch { return downloadItem.url.split('/').pop().split('?')[0]; } })();
    const nameFromUrl  = sanitizePath(rawFromUrl);
    const ext = nameFromUrl.match(/\.[^.]+$/)?.[0] || '';
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameFromUrl.replace(/\.[^.]+$/, ''));
    const cleanFileName = nameFromFile
      || (isUuid && modelName !== 'Model' ? modelName.replace(/[<>:"/\\|?*]/g, '_').trim() + ext : nameFromUrl)
      || 'file.stl';
    handledUrls.add(downloadItem.url);
    if (await tryWriteToTarget(downloadItem.url, `${finalFolderName}/${cleanFileName}`)) {
      handledUrls.delete(downloadItem.url);
    } else {
      chrome.downloads.download({
        url: downloadItem.url,
        filename: `STL_Downloads/${finalFolderName}/${cleanFileName}`,
        conflictAction: 'uniquify',
        saveAs: false
      }, (downloadId) => {
        handledUrls.delete(downloadItem.url);
        begleiteDownload(downloadId, matchingTab?.id, cleanFileName);
      });
    }
    if (imageUrl) downloadImage(imageUrl, finalFolderName);
    queueNotification(source, cleanFileName);
  }
});
