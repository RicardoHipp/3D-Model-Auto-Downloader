// Gegenstück zu content_dl_main.js: nimmt die abgefangene Download-URL aus der
// MAIN world entgegen und reicht sie an den Service Worker weiter.
//
// Die Bestätigung zurück an die Seite ist Teil der Absicherung: Bleibt sie aus,
// führt content_dl_main.js den ursprünglichen Klick doch aus, statt den
// Download zu verlieren.
const DL_HOSTS = /^https:\/\/(files\.printables\.com|[^/]*\.bblmw\.com)\//i;

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data?.__dlIntercept || !event.data.url) return;

  const { id, url, imageUrl } = event.data;
  // Erneut prüfen: Die Nachricht stammt aus der Seite und ist damit nicht
  // vertrauenswürdig – ohne diese Prüfung könnte eine Seite die Erweiterung
  // beliebige URLs laden lassen.
  if (!DL_HOSTS.test(url)) return;

  try {
    chrome.runtime.sendMessage(
      { action: 'interceptedDownload', url, imageUrl: imageUrl || null },
      (res) => {
        // Ohne Bestätigung greift der Fallback in der Seite.
        if (chrome.runtime.lastError || !res?.ok) return;
        window.postMessage({ __dlAck: id }, '*');
      }
    );
  } catch (e) {
    // Erweiterung wurde neu geladen – der Fallback startet den normalen Download
  }
});
