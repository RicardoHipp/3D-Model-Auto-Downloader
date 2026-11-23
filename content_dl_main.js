// Fängt Downloads auf Printables und MakerWorld ab, BEVOR der Browser sie
// startet. Beide Seiten lösen sie gleich aus: Sie erzeugen einen Anchor mit der
// fertigen Datei-URL und rufen darauf .click() auf. Wird dieser Aufruf
// abgefangen, erfährt Chrome von dem Download gar nichts erst – und fragt
// folglich auch nicht nach dem Speicherort.
//
// Der Patch hängt an HTMLAnchorElement.prototype.click, also an einer
// Browser-API und nicht an CSS-Klassen oder Beschriftungen. Ein Redesign der
// Seiten bricht ihn deshalb nicht.
//
// Läuft in der MAIN world, weil nur dort das Prototype der Seite erreichbar
// ist. Die Weitergabe an die Erweiterung übernimmt content_dl_isolated.js.
(function () {
  const DOWNLOAD_HOSTS = /^https:\/\/(files\.printables\.com|[^/]*\.bblmw\.com)\//i;

  // Nach dieser Frist ohne Rückmeldung der Erweiterung wird der ursprüngliche
  // Klick doch ausgeführt. Ohne diese Absicherung wäre ein Download verloren
  // statt nur umgeleitet – etwa wenn die Erweiterung gerade neu geladen wurde.
  // Grosszuegig: Vor der Antwort prueft die Erweiterung den Zielordner, und
  // das darf bis zu 0,8 s dauern (ORDNER_FRIST_MS in target_dir.js), dazu
  // kommt das Aufwachen des Service Workers.
  const ACK_TIMEOUT_MS = 3000;
  const LOG = '[3D Model Downloader & Organizer]';

  const origClick = HTMLAnchorElement.prototype.click;

  function getOgImage() {
    try {
      return document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.content || null;
    } catch { return null; }
  }

  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || '';
    if (!DOWNLOAD_HOSTS.test(href)) return origClick.apply(this, arguments);

    const anchor = this;
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    let entschieden = false;

    const fallback = setTimeout(() => {
      if (entschieden) return;
      entschieden = true;
      window.removeEventListener('message', onAck);
      console.warn(`${LOG} Keine Rückmeldung der Erweiterung nach ${ACK_TIMEOUT_MS} ms – `
                 + `der Download läuft normal über den Browser.`, href);
      origClick.call(anchor);
    }, ACK_TIMEOUT_MS);

    function onAck(ev) {
      if (ev.source !== window || !ev.data || ev.data.__dlAck !== id) return;
      if (entschieden) return;
      entschieden = true;
      clearTimeout(fallback);
      window.removeEventListener('message', onAck);
      console.log(`${LOG} Download übernommen, wird sortiert abgelegt:`, href);
    }

    window.addEventListener('message', onAck);
    window.postMessage({ __dlIntercept: true, id, url: href, imageUrl: getOgImage() }, '*');

    // Den ursprünglichen Klick bewusst NICHT ausführen – genau das verhindert
    // den Browser-Download und damit den Speicherort-Dialog.
  };
})();
