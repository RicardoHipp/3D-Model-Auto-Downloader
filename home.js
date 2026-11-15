// Links oben auf jeder Seite der Erweiterung: Haus, gruenes "3D" und der
// Name des Programms - frei stehend wie ein Logo-Schriftzug, erst beim
// Darueberfahren mit Hintergrund. Logo und Home-Knopf zugleich; das Haus
// zeigt, dass man hier zurueckkommt. Dahinter ein " › " zum Seitentitel, so
// liest es sich als "Programm › Meine Modelle". Fuehrt zur Startseite, der
// Uebersicht "Meine Modelle", und ersetzt die Zurueck-Knoepfe, die auf jeder
// Seite woanders sassen.
//
// Die Seiten setzen nur <a class="home">3D</a> in ihren Kopf; Ziel, Inhalt,
// Tooltip und Aussehen kommen von hier.
(() => {
  const stil = document.createElement('style');
  stil.textContent = `
    a.home {
      flex-shrink: 0; align-self: center; box-sizing: border-box;
      display: inline-flex; align-items: center; gap: 7px;
      height: 34px; padding: 0 10px; margin-left: -10px; border-radius: 999px;
      background: transparent; border: 1px solid transparent;
      color: #f5f5f7; text-decoration: none; white-space: nowrap;
      font: 600 13px/1 "Segoe UI Variable Text", "Segoe UI Variable", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif;
      transition: background .2s ease, border-color .2s ease, transform .2s cubic-bezier(.34, 1.3, .64, 1);
    }
    a.home:hover { background: rgba(255, 255, 255, .08); border-color: rgba(255, 255, 255, .1); }
    a.home:active { transform: scale(.97); }
    a.home:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(10, 132, 255, .55); }
    a.home svg { display: block; flex-shrink: 0; color: #a6adc8; }
    a.home .drei {
      font-weight: 900; font-size: 14px; letter-spacing: -.02em;
      color: #22c55e; text-shadow: 1px 1px 0 #0d4e26;
    }
    .homeTrenner { align-self: center; color: #585b70; font-size: 18px; line-height: 1; margin: 0 -2px; }`;
  document.head.appendChild(stil);

  const name = chrome.i18n.getMessage('appName');
  const text = name + ' – ' + chrome.i18n.getMessage('navHome');
  // Feste Zeichnung, kein fremder Inhalt.
  const HAUS = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>';
  // "3D" als gruenes Logo, der Rest des Namens als Text dahinter.
  const rest = name.replace(/^3D\s*/, '');
  for (const knopf of document.querySelectorAll('a.home')) {
    knopf.innerHTML = HAUS;
    const drei = document.createElement('span');
    drei.className = 'drei';
    drei.textContent = '3D';
    const titel = document.createElement('span');
    titel.textContent = rest;
    knopf.append(drei, titel);
    knopf.href = chrome.runtime.getURL('library.html');
    knopf.title = text;
    knopf.setAttribute('aria-label', text);
    // Trenner zum Seitentitel - ausser die Seite hat schon einen eigenen
    // (Willkommen: Name · Version).
    if (!knopf.nextElementSibling?.classList.contains('trenner')) {
      const trenner = document.createElement('span');
      trenner.className = 'homeTrenner';
      trenner.setAttribute('aria-hidden', 'true');
      trenner.textContent = '›';
      knopf.after(trenner);
    }
  }
})();
