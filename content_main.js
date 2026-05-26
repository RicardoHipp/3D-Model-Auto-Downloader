(function () {
  if (window.__tvDebug) console.log('[TV] content_main.js geladen');
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  function getOgImage() {
    try {
      return document.querySelector('meta[property="og:image"], meta[name="og:image"]')?.content || null;
    } catch { return null; }
  }

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tvUrl = typeof url === 'string' ? url : (url ? String(url) : '');

    // Für /download: URLs: Nach dem 302-Redirect die echte CDN-URL abgreifen
    if (this.__tvUrl.includes('thingiverse.com/download:')) {
      const xhr = this;
      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 2) { // HEADERS_RECEIVED – Redirect bereits gefolgt
          const cdnUrl = xhr.responseURL;
          if (cdnUrl && cdnUrl.includes('cdn.thingiverse.com')) {
            window.postMessage({ __tvDownload: true, url: cdnUrl, imageUrl: getOgImage() }, '*');
            // Kein abort() – sonst zeigt Thingiverse einen Fehler an
          }
        }
      });
    }

    return origOpen.apply(this, arguments);
  };

  const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|mp4|webm|mov)$/i;

  function tryInterceptCdnUrl(url) {
    if (!url || !url.includes('cdn.thingiverse.com')) return;
    const filename = url.split('/').pop().split('?')[0];
    if (!filename || mediaExtensions.test(filename)) return;
    if (window.__tvDebug) console.log('[TV] intercept:', filename);
    window.postMessage({ __tvDownload: true, url, imageUrl: getOgImage() }, '*');
  }

  XMLHttpRequest.prototype.send = function () {
    tryInterceptCdnUrl(this.__tvUrl || '');
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function(...args) {
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
      tryInterceptCdnUrl(url);
    } catch {}
    return origFetch.apply(this, args);
  };
})();
