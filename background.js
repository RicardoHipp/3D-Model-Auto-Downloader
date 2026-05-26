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
    setActionIcon(isSupportedUrl(tab.url) ? '#22c55e' : '#3b82f6');
  });
}

chrome.storage.local.get('debugMode', (r) => { DEBUG = !!r.debugMode; });
chrome.storage.session.get('isPaused', (r) => {
  isPaused = !!r.isPaused;
  if (isPaused) {
    setActionIcon('#eab308');
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) updateIconForTab(tabs[0].id);
      else setActionIcon('#86efac');
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'debugMode' in changes) DEBUG = !!changes.debugMode.newValue;
  if (area === 'session' && 'isPaused' in changes) {
    isPaused = !!changes.isPaused.newValue;
    if (isPaused) {
      setActionIcon('#eab308');
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) updateIconForTab(tabs[0].id);
        else setActionIcon('#86efac');
      });
    }
  }
});
console.log('=== SW GESTARTET ===');

function setupKeepaliveAlarm() {
  chrome.alarms.get('keepAlive', (alarm) => {
    if (!alarm) chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
  });
}

// Bei jedem SW-Start ausführen – nicht nur bei onInstalled/onStartup
setupKeepaliveAlarm();

chrome.runtime.onStartup.addListener(() => {
  chrome.downloads.search({ state: 'interrupted', limit: 0 }, (downloads) => {
    const eigene = downloads.filter(dl => dl.byExtensionId === chrome.runtime.id);
    for (const dl of eigene) chrome.downloads.erase({ id: dl.id });
  });
  setupKeepaliveAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  setupKeepaliveAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    setupKeepaliveAlarm(); // Alarm erneuern falls er verloren ging
  }
});

chrome.tabs.onActivated.addListener((info) => updateIconForTab(info.tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id === tabId) updateIconForTab(tabId);
  });
});

let downloadQueue = [];
let offscreenReady = false;
let creatingOffscreen = null;
let folderMap = {};
// 1x1 transparentes PNG als Sofort-Fallback, wird beim Start durch das echte Icon ersetzt
let iconDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
let activeExtractions = 0;
let notificationTimer = null;
let pendingNotifications = [];

// URLs die gerade von uns neu gestartet werden – verhindert Endlosschleife
const handledUrls = new Set();
const downloadedImageFolders = new Set();
const pendingImageFolders = new Set();

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

function drawIcon(ctx, size, color) {
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  const shade = (f) => `rgb(${Math.round(r*f)},${Math.round(g*f)},${Math.round(b*f)})`;
  const fontSize = Math.round(size * 0.70);
  const depth = Math.max(1, Math.round(size * 0.08));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fontSize}px Arial, sans-serif`;
  for (let i = depth; i >= 1; i--) {
    ctx.fillStyle = shade(0.4);
    ctx.fillText('3D', size/2 + i, size/2 + i);
  }
  ctx.fillStyle = color;
  ctx.fillText('3D', size/2, size/2);
}

function setActionIcon(color) {
  try {
    const imageData = {};
    for (const s of [16, 32, 48]) {
      const canvas = new OffscreenCanvas(s, s);
      const ctx = canvas.getContext('2d');
      drawIcon(ctx, s, color);
      imageData[s] = ctx.getImageData(0, 0, s, s);
    }
    chrome.action.setIcon({ imageData });
  } catch {}
}

(async () => {
  try {
    const canvas = new OffscreenCanvas(48, 48);
    const ctx = canvas.getContext('2d');
    drawIcon(ctx, 48, '#22c55e');
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    iconDataUrl = 'data:image/png;base64,' + btoa(binary);
  } catch (err) {
    console.error('Icon konnte nicht generiert werden:', err);
  }
})();

function showNotification(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconDataUrl,
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
    showNotification(source, `"${fileName}" wurde heruntergeladen.`);
  } else {
    const sources = [...new Set(pendingNotifications.map(n => n.source))];
    const title = sources.length === 1 ? sources[0] : '3D Downloads';
    showNotification(title, `${pendingNotifications.length} Dateien wurden heruntergeladen.`);
  }
  pendingNotifications = [];
}

function setFolderMap(key, value) {
  const keys = Object.keys(folderMap);
  if (keys.length >= 100) delete folderMap[keys[0]];
  folderMap[key] = value;
}

function buildFolderName(modelName, source) {
  const transliterated = modelName.split('').map(c => cyrillicMap[c] ?? c).join('');
  const clean = transliterated.replace(/[<>:"/\\|?*]/g, '_').trim();
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${pad(now.getDate())}.${pad(now.getMonth()+1)}.${now.getFullYear()}`;
  return `${clean}_von_${source}_${timestamp}`;
}

function downloadImage(imageUrl, folderName) {
  if (DEBUG) console.log('[IMG]', folderName.substring(0, 40), '| url:', !!imageUrl, '| bereitsGeladen:', downloadedImageFolders.has(folderName));
  if (!imageUrl || downloadedImageFolders.has(folderName)) return;
  downloadedImageFolders.add(folderName);
  handledUrls.add(imageUrl);
  let ext = 'jpg';
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    if (pathname.endsWith('.png')) ext = 'png';
    else if (pathname.endsWith('.webp')) ext = 'webp';
  } catch {}
  chrome.downloads.download({
    url: imageUrl,
    filename: `STL_Downloads/${folderName}/preview.${ext}`,
    conflictAction: 'uniquify'
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

async function handleThingiverseDownload(cdnUrl, imageUrl, tab) {
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
    finalFolderName = buildFolderName(modelName, 'Thingiverse');
    if (folderKey) setFolderMap(folderKey, finalFolderName);
  }

  const urlWithoutQuery = cdnUrl.split('?')[0];
  const rawFileName = urlWithoutQuery.split('/').pop();
  const cleanFileName = (() => { try { return decodeURIComponent(rawFileName); } catch { return rawFileName; } })();
  const urlPath = urlWithoutQuery.toLowerCase();
  if (urlPath.endsWith('.zip')) {
    if (downloadQueue.some(item => item.url === cdnUrl)) { if (DEBUG) console.log('[TV] SKIP zip duplikat'); return; }
    downloadQueue.push({ url: cdnUrl, folderName: finalFolderName, imageUrl, source: 'Thingiverse' });
    await setupOffscreenDocument();
    if (offscreenReady && downloadQueue.length > 0) processQueue();
  } else {
    const safeFileName = sanitizePath(cleanFileName);
    if (DEBUG) console.log('[TV] download:', safeFileName, '→', finalFolderName, '| imageUrl:', !!imageUrl);
    // Beide URL-Varianten eintragen (Kyrillisch + percent-encoded), da Chrome beim Download normalisiert
    handledUrls.add(cdnUrl);
    try { handledUrls.add(new URL(cdnUrl).href); } catch {}
    chrome.downloads.download({
      url: cdnUrl,
      filename: `STL_Downloads/${finalFolderName}/${safeFileName}`,
      conflictAction: 'uniquify'
    }, () => {
      handledUrls.delete(cdnUrl);
      try { handledUrls.delete(new URL(cdnUrl).href); } catch {}
    });
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
    queueNotification('Thingiverse', safeFileName);
  }
}

function processQueue() {
  if (downloadQueue.length === 0) return;
  const item = downloadQueue.shift();
  chrome.runtime.sendMessage({
    action: 'unzipAndDownload',
    url: item.url,
    folderName: item.folderName,
    source: item.source
  });
  if (item.imageUrl) {
    downloadImage(item.imageUrl, item.folderName);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'thingiverseIntercept') {
    if (isPaused) return;
    if (DEBUG) console.log('[TV] intercept:', message.url.split('/').pop(), '| imageUrl:', !!message.imageUrl);
    handleThingiverseDownload(message.url, message.imageUrl || null, sender.tab);
  }
  if (message.action === 'offscreenReady') {
    offscreenReady = true;
    creatingOffscreen = null;
    processQueue();
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
      conflictAction: 'uniquify'
    }, () => {
      activeExtractions = Math.max(0, activeExtractions - 1);
      handledUrls.delete(message.url);
      chrome.runtime.sendMessage({ action: 'downloadInitiated', url: message.url });
      sendResponse();
    });
    return true; // asynchrone sendResponse ankündigen
  }
  if (message.action === 'successNotification') {
    showNotification('Erfolg', message.message);
  }
  if (message.action === 'errorNotification') {
    showNotification('Fehler', message.message);
  }
  if (message.action === 'downloadFinished') {
    if (downloadQueue.length > 0) {
      setupOffscreenDocument().then(() => {
        if (offscreenReady) processQueue();
      });
    }
  }
});

chrome.downloads.onCreated.addListener(async (downloadItem) => {
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

  // 7. Download abwickeln
  if (isZip) {
    chrome.downloads.cancel(downloadItem.id);
    chrome.downloads.erase({ id: downloadItem.id });
    if (downloadQueue.some(item => item.url === downloadItem.url)) return;
    downloadQueue.push({ url: downloadItem.url, folderName: finalFolderName, imageUrl, source });
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
    chrome.downloads.download({
      url: downloadItem.url,
      filename: `STL_Downloads/${finalFolderName}/${cleanFileName}`,
      conflictAction: 'uniquify'
    }, () => handledUrls.delete(downloadItem.url));
    if (imageUrl) downloadImage(imageUrl, finalFolderName);
    queueNotification(source, cleanFileName);
  }
});
