chrome.storage.local.get('debugMode', (r) => {
  if (r.debugMode) window.__tvDebug = true;
});

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data?.__tvDownload || !event.data.url) return;
  const url = event.data.url;
  if (!url.startsWith('https://cdn.thingiverse.com/') && !url.includes('thingiverse.com/download:')) return;
  try {
    chrome.runtime.sendMessage({ action: 'thingiverseIntercept', url, imageUrl: event.data.imageUrl || null });
  } catch (e) {
    // Extension wurde neu geladen – Tab muss auch neu geladen werden
  }
});
