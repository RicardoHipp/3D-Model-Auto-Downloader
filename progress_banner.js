// Fortschrittsanzeige auf der Modellseite.
//
// Seit die Erweiterung direkt in den Zielordner schreibt, läuft der Download
// nicht mehr über Chrome – und damit fehlt auch dessen Fortschrittsanzeige.
// Bei einem großen Archiv sähe der Nutzer sonst minutenlang gar nichts.
//
// Das Banner lebt in einem Shadow DOM: So kann weder das CSS der Website
// hineinwirken noch unseres hinaus.
(function () {
  const HOST_ID = '__stl_dl_progress__';
  let host, shadow, titleEl, fileEl, barEl, pctEl, hideTimer;

  function build() {
    if (host && document.body.contains(host)) return;

    host = document.createElement('div');
    host.id = HOST_ID;
    // Nur das Nötigste am Host – der Rest lebt im Shadow DOM
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647';
    shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; }
        .box {
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          width: 268px;
          background: #1e1e2e;
          color: #cdd6f4;
          border: 1px solid #313244;
          border-radius: 10px;
          padding: 12px 14px;
          box-shadow: 0 8px 28px rgba(0,0,0,.45);
          opacity: 0;
          transform: translateY(8px);
          transition: opacity .18s ease, transform .18s ease;
        }
        .box.show { opacity: 1; transform: none; }
        .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .logo {
          font-weight: 900; font-size: 13px; color: #22c55e;
          text-shadow: 1px 1px 0 #0d4e26;
          flex-shrink: 0;
        }
        .name { font-size: 11px; color: #a6adc8; font-weight: 600; }
        .file {
          font-size: 12px; color: #cdd6f4; margin-bottom: 8px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        /* Meldungen sind laenger als Dateinamen und duerfen umbrechen */
        .file.lang { white-space: normal; overflow: visible; line-height: 1.45; }
        .track { height: 6px; background: #313244; border-radius: 3px; overflow: hidden; }
        .bar {
          height: 100%; width: 0%; background: #22c55e; border-radius: 3px;
          transition: width .2s ease;
        }
        .bar.unbekannt {
          width: 35%;
          animation: laufen 1.1s ease-in-out infinite alternate;
        }
        @keyframes laufen { from { margin-left: 0 } to { margin-left: 65% } }
        .bar.fertig { background: #a6e3a1; }
        .bar.fehler { background: #ef4444; }
        .pct { font-size: 11px; color: #a6adc8; margin-top: 6px; text-align: right; }
      </style>
      <div class="box">
        <div class="head">
          <span class="logo">3D</span>
          <span class="name">Model Downloader &amp; Organizer</span>
        </div>
        <div class="file"></div>
        <div class="track"><div class="bar"></div></div>
        <div class="pct"></div>
      </div>
    `;

    document.body.appendChild(host);
    const box = shadow.querySelector('.box');
    titleEl = box;
    fileEl = shadow.querySelector('.file');
    barEl = shadow.querySelector('.bar');
    pctEl = shadow.querySelector('.pct');
    requestAnimationFrame(() => box.classList.add('show'));
  }

  function hide(nachMs) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!host) return;
      shadow.querySelector('.box').classList.remove('show');
      setTimeout(() => { host?.remove(); host = null; }, 220);
    }, nachMs);
  }

  function update(p) {
    build();
    clearTimeout(hideTimer);

    fileEl.textContent = p.file || '';
    fileEl.className = p.state === 'fehler' ? 'file lang' : 'file';
    barEl.className = 'bar';

    if (p.state === 'fertig') {
      barEl.style.width = '100%';
      barEl.classList.add('fertig');
      pctEl.textContent = p.text || '';
      hide(2600);
      return;
    }
    if (p.state === 'fehler') {
      barEl.style.width = '100%';
      barEl.classList.add('fehler');
      pctEl.textContent = p.text || '';
      hide(4200);
      return;
    }
    // Ohne Content-Length kennt niemand die Gesamtgröße – dann zeigt der
    // Balken Bewegung statt einer erfundenen Prozentzahl.
    if (typeof p.percent === 'number') {
      barEl.style.width = Math.max(2, Math.min(100, p.percent)) + '%';
      pctEl.textContent = p.text || (Math.round(p.percent) + ' %');
    } else {
      barEl.classList.add('unbekannt');
      pctEl.textContent = p.text || '';
    }

    // Wachhund: Bleibt die Abschlussmeldung aus - abgestuerzter Service
    // Worker, geschlossener Offscreen-Tab -, verschwindet das Band trotzdem.
    // Ein ewig laufender Balken sieht aus wie ein haengender Download.
    hide(120000);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== 'downloadProgress') return;
    try { update(msg); } catch { /* Seite im Umbau – nächste Meldung versucht es erneut */ }
  });
})();
