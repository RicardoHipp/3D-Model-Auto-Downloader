const t = (key, subs) => chrome.i18n.getMessage(key, subs);

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

// --- Menü links -----------------------------------------------------------
const navKnoepfe = [...document.querySelectorAll('nav button')];

function zeigeBereich(ziel) {
  for (const b of navKnoepfe) b.setAttribute('aria-current', String(b.dataset.ziel === ziel));
  document.getElementById('sec-zielordner').hidden = ziel !== 'zielordner';
  document.getElementById('sec-explorer').hidden   = ziel !== 'explorer';
}

for (const b of navKnoepfe) {
  b.addEventListener('click', () => zeigeBereich(b.dataset.ziel));
}

// Andere Erweiterungsseiten koennen vorgeben, welcher Bereich offen sein
// soll - openOptionsPage() nimmt keine Parameter, und war die Seite schon
// offen, wird sie nur nach vorn geholt, nicht neu geladen. Der Umweg ueber
// den Sitzungsspeicher erreicht deshalb beide Faelle.
async function uebernimmGewuenschtenBereich() {
  const { optionenBereich } = await chrome.storage.session.get('optionenBereich');
  if (!optionenBereich) return;
  await chrome.storage.session.remove('optionenBereich');
  zeigeBereich(optionenBereich);
}

// --- Warum diese Seite aufging --------------------------------------------
// Der Service Worker öffnet die Einstellungen von sich aus, wenn ein Download
// mangels Zielordner abgebrochen ist. Ohne Erklärung steht der Nutzer dann vor
// einer Seite, die er nicht aufgerufen hat, und sieht den Zusammenhang nicht.
const gestopptEl = document.getElementById('gestoppt');

async function zeigeAbbruchhinweis(state) {
  const { downloadGestoppt } = await chrome.storage.session.get('downloadGestoppt');

  // Erledigt, sobald der Ordner wieder nutzbar ist - der Hinweis soll nicht
  // stehen bleiben, nachdem das Problem behoben wurde.
  if (!downloadGestoppt || state === 'granted') {
    if (downloadGestoppt) await chrome.storage.session.remove('downloadGestoppt');
    gestopptEl.hidden = true;
    return;
  }

  const abgelaufen = downloadGestoppt.grund === 'berechtigung';
  document.getElementById('gestopptTitel').textContent = t('stoppedTitle');
  document.getElementById('gestopptText').textContent =
    t(abgelaufen ? 'stoppedPermText' : 'stoppedNoneText');
  gestopptEl.hidden = false;
}

// Greift, wenn die Seite schon offen war: openOptionsPage() holt dann nur den
// vorhandenen Tab nach vorn, ohne ihn neu zu laden.
chrome.storage.session.onChanged.addListener(async (aenderungen) => {
  if (aenderungen.optionenBereich?.newValue) await uebernimmGewuenschtenBereich();
  if (!aenderungen.downloadGestoppt?.newValue) return;
  zeigeBereich('zielordner');
  await render();
});

// --- Zielordner -----------------------------------------------------------
const stateEl  = document.getElementById('state');
const chooseEl = document.getElementById('choose');
const renewEl  = document.getElementById('renew');
const forgetEl = document.getElementById('forget');
const noteEl   = document.getElementById('firstRunNote');

async function render() {
  const { state, name } = await targetDirStatus();
  stateEl.className = 'state ' + state;

  if (state === 'granted') {
    stateEl.textContent = t('optionsStateGranted', [name]);
  } else if (state === 'prompt') {
    stateEl.textContent = t('optionsStatePrompt', [name]);
  } else {
    stateEl.textContent = t('optionsStateNone');
  }

  await zeigeAbbruchhinweis(state);

  renewEl.hidden  = state !== 'prompt';
  renewEl.classList.toggle('pulst', state === 'prompt');
  forgetEl.hidden = state === 'none';
  // Chrome bietet "Bei jedem Besuch zulassen" erst beim zweiten Mal an -
  // ohne Erklaerung wirkt die erneute Nachfrage wie ein Fehler.
  noteEl.hidden   = state === 'none';
  chooseEl.textContent = state === 'none' ? t('optionsChoose') : t('optionsChangeFolder');
}

chooseEl.addEventListener('click', async () => {
  try {
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
    await saveTargetDir(handle);
    // Die Explorer-Zuordnung zeigt auf den bisherigen Ordner und würde nach
    // einem Wechsel stillschweigend den falschen öffnen. Lieber verwerfen und
    // einmal neu zuordnen lassen - das Skript öffnet ohnehin nur noch den
    // Ordner, den es zuletzt zugeordnet bekommen hat.
    await explorerPfadSetzen('');
    // Hinweis: Chromes "Bei jedem Besuch zulassen" laesst sich hier NICHT
    // vorziehen. Ein sofortiges requestPermission auf dem gerade gespeicherten
    // Handle wurde geprueft (19.10.2026) - Chrome zeigt keinen zweiten Dialog.
    // Die Option erscheint erst in einer neuen Browser-Sitzung.
    await render();
    await expZeichne();
  } catch (err) {
    // AbortError = Nutzer hat das Auswahlfenster geschlossen, das ist kein Fehler
    if (err.name !== 'AbortError') {
      stateEl.className = 'state prompt';
      stateEl.textContent = t('optionsPickFailed', [err.message]);
    }
  }
});

// Nur hier moeglich: requestPermission verlangt eine Nutzergeste, die es im
// Service Worker und im Offscreen-Dokument nicht gibt.
renewEl.addEventListener('click', async () => {
  const handle = await getTargetDir();
  if (!handle) return render();
  try {
    await handle.requestPermission({ mode: 'readwrite' });
  } catch { /* abgelehnt - render() zeigt den Zustand ohnehin an */ }
  await render();
});

// Loest nur unsere Zuordnung. Chromes Freigabe fuer den Ordner bleibt bestehen
// und wird ueber den Knopf daneben zurueckgenommen.
forgetEl.addEventListener('click', async () => {
  await clearTargetDir();
  await render();
});

// chrome://-Seiten lassen sich nicht per <a href> verlinken - Chrome blockiert
// solche Navigationen von Erweiterungsseiten. Ueber tabs.create geht es.
document.getElementById('revoke').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/content/filesystem' });
});

// --- Explorer -------------------------------------------------------------
const expPath     = document.getElementById('expPath');
// "Schon einmal eingerichtet?": klappt den Abschnitt zum Eintragen auf und
// setzt den Cursor ins Feld - Skript und Registrierung sind ja noch da.
document.getElementById('expSchonEingerichtet').addEventListener('click', () => {
  const fach = document.getElementById('expHandFach');
  fach.open = true;
  fach.scrollIntoView({ behavior: 'smooth', block: 'center' });
  expPath.focus({ preventScroll: true });
});
const expState    = document.getElementById('expState');
const expInfo     = document.getElementById('expZuordnenInfo');
const expZuKnopf  = document.getElementById('expZuordnen');
const expAbKnopf  = document.getElementById('expAbbrechen');

function zeigeZeile(el, text, zustand) {
  el.hidden = false;
  el.className = 'state ' + zustand;
  el.textContent = text;
}

async function expZeichne() {
  const { pfad, nutzbar } = await explorerEinstellungen();
  // Beim Tippen nicht dazwischenfunken, sonst springt der Cursor
  if (document.activeElement !== expPath) expPath.value = pfad;

  const ziel = await targetDirStatus();
  let zustand = 'none', text;

  if (ziel.state === 'none') {
    text = t('expNoTargetYet');
  } else if (!nutzbar) {
    text = t('expNeedsPath');
  } else if (!pfad.replace(/[\\/]+$/, '').toLowerCase().endsWith(ziel.name.toLowerCase())) {
    // Der eingetippte Pfad muss auf denselben Ordner zeigen, der unter
    // "Zielordner" ausgewaehlt wurde - sonst oeffnet der Knopf ein fremdes
    // Verzeichnis.
    text = t('expPathMismatch', [ziel.name]);
    zustand = 'prompt';
  } else {
    text = t('expPathOk', [pfad]);
    zustand = 'granted';
  }

  expState.className = 'state ' + zustand;
  expState.textContent = text;
}

expPath.addEventListener('input', async () => {
  await explorerPfadSetzen(expPath.value);
  await expZeichne();
});

// Zuordnen: laesst sich den Pfad vom Skript selbst nennen, statt ihn abtippen
// zu lassen. Nebeneffekt - gelingt es, ist bewiesen, dass das Skript laeuft
// und dass es derselbe Ordner ist wie der freigegebene.
let expAbbruch = null;

expZuKnopf.addEventListener('click', async () => {
  const ziel = await getTargetDir();
  if (!ziel) return zeigeZeile(expInfo, t('expNoTargetYet'), 'prompt');

  // Ohne Schreibrecht koennen wir die Kennung nicht ablegen - dann hat das
  // Skript nichts, woran es den richtigen Ordner erkennt.
  if (await ordnerRecht(ziel, 'readwrite') !== 'granted') {
    try { await ziel.requestPermission({ mode: 'readwrite' }); } catch { /* abgelehnt */ }
    if (await ordnerRecht(ziel, 'readwrite') !== 'granted') {
      return zeigeZeile(expInfo, t('expNeedsPermission'), 'prompt');
    }
  }

  expAbbruch = new AbortController();
  expZuKnopf.disabled = true;
  expZuKnopf.textContent = t('expAssignRunning');
  expAbKnopf.hidden = false;
  zeigeZeile(expInfo, t('expAssignWaiting'), 'none');

  let erg;
  try {
    erg = await explorerZuordnen(ziel, expAbbruch.signal);
  } finally {
    expZuKnopf.disabled = false;
    expZuKnopf.textContent = t('expAssignButton');
    expAbKnopf.hidden = true;
  }

  if (expAbbruch.signal.aborted) {
    zeigeZeile(expInfo, t('expAssignCancelled'), 'none');
  } else if (!erg.ok) {
    zeigeZeile(expInfo, t('expAssignFailed'), 'prompt');
  } else if (erg.version < EXP_SKRIPT_VERSION) {
    zeigeZeile(expInfo, t('expScriptOld', [String(erg.version), String(EXP_SKRIPT_VERSION)]), 'prompt');
  } else {
    await explorerPfadSetzen(erg.pfad);
    zeigeZeile(expInfo, t('expAssignOk', [erg.pfad]), 'granted');
  }

  expAbbruch = null;
  await expZeichne();
});

// Das Skript meldet sich bei abgebrochener Ordnerauswahl nicht - ohne diesen
// Knopf haenge die Seite bis zum Zeitablauf in "warte".
expAbKnopf.addEventListener('click', () => expAbbruch?.abort());

// Testknopf: ruft denselben Weg auf wie der Knopf in der Uebersicht - und
// wartet auf das Lebenszeichen des Skripts. So sagt der Test wirklich, ob
// alles eingerichtet ist, statt nur etwas abzuschicken.
const testKnopf = document.getElementById('expTest');
const testInfo  = document.getElementById('expTestUrl');

testKnopf.addEventListener('click', async () => {
  const { pfad, nutzbar } = await explorerEinstellungen();
  testInfo.hidden = false;
  testInfo.className = 'note';

  if (!nutzbar) {
    testInfo.textContent = t('expNeedsPath');
    return;
  }
  const ziel = await getTargetDir();
  if (!ziel) {
    testInfo.textContent = t('expNoTargetYet');
    return;
  }

  const url = explorerUrl(pfad, '');
  testKnopf.disabled = true;
  testKnopf.textContent = t('expTestRunning');
  testInfo.textContent = t('expTestWaiting');

  const erg = await explorerOeffnenUndPruefen(url, ziel);

  testKnopf.disabled = false;
  testKnopf.textContent = t('expTestButton');

  if (!erg.ok) {
    zeigeZeile(testInfo, t('expTestFailed', [url]), 'prompt');
  } else if (erg.version < EXP_SKRIPT_VERSION) {
    // Oeffnen geht, aber Zuordnen kann diese Fassung noch nicht
    zeigeZeile(testInfo, t('expScriptOld', [String(erg.version), String(EXP_SKRIPT_VERSION)]), 'prompt');
  } else {
    zeigeZeile(testInfo, t('expTestOk'), 'granted');
  }
});

// --- Einrichtung mit einem Knopf ------------------------------------------
//
// Beide Dateien gehen ueber chrome.downloads in den Download-Ordner - nicht
// ueber einen <a download>-Klick. Zwei Downloads kurz hintereinander loesen
// dort sonst Chromes Frage "Mehrere automatische Downloads zulassen?" aus.
// Ausserdem laesst sich so der Download-Ordner mit markierter Datei oeffnen.
const holKnopf = document.getElementById('expHolen');
// Schritt 1 meldet nur, dass die Dateien da sind. Alles, was danach kommt,
// haengt am Doppelklick und steht deshalb bei Schritt 2.
const holInfo = document.getElementById('expHolInfo');

// Der Wartezustand bekommt eine eigene Darstellung mit Kreisel: Eine graue
// Textzeile sieht aus wie eine Randnotiz, dabei haengt gerade alles daran,
// dass der Nutzer die Datei ausfuehrt.
function zeigeWarten(el, text) {
  el.textContent = '';
  el.className = 'wartet';
  const kreisel = document.createElement('span');
  kreisel.className = 'kreisel';
  kreisel.setAttribute('aria-hidden', 'true');
  const wort = document.createElement('span');
  wort.textContent = text;
  el.append(kreisel, wort);
  el.hidden = false;
}

async function ladeHerunter(name, inhalt) {
  // UTF-16 mit Kennzeichen am Anfang: VBScript und der Registrierungs-Editor
  // lesen .vbs und .reg sonst als ANSI, und Umlaute kaemen verstuemmelt an.
  const blob = new Blob([alsUtf16(inhalt)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((fertig, fehler) => {
      // overwrite statt des voreingestellten uniquify: Sonst heisst die Datei
      // beim zweiten Versuch "stldl-protokoll (1).reg" - und das Skript
      // sucht neben sich nach dem Namen ohne Zusatz.
      chrome.downloads.download(
        { url, filename: name, saveAs: false, conflictAction: 'overwrite' }, (id) => (
        chrome.runtime.lastError
          ? fehler(new Error(chrome.runtime.lastError.message))
          : fertig(id)
        ));
    });
  } finally {
    // Nicht sofort freigeben - der Download liest die Daten erst noch.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

// Wartet, bis ein Download abgeschlossen ist. Gibt false zurueck, wenn er
// abgebrochen wurde oder zu lange braucht - dann oeffnen wir wenigstens den
// Ordner, ohne die Datei zu markieren.
function warteAufDownload(id, maxMs = 20000) {
  return new Promise((fertig) => {
    let erledigt = false;
    const fertigMit = (wert) => {
      if (erledigt) return;
      erledigt = true;
      chrome.downloads.onChanged.removeListener(horcher);
      fertig(wert);
    };
    function horcher(aenderung) {
      if (aenderung.id !== id || !aenderung.state) return;
      fertigMit(aenderung.state.current === 'complete');
    }
    chrome.downloads.onChanged.addListener(horcher);
    // Kleine Dateien sind oft schon durch, bevor wir zuhoeren.
    chrome.downloads.search({ id }, (treffer) => {
      const zustand = treffer?.[0]?.state;
      if (zustand === 'complete') fertigMit(true);
      else if (zustand === 'interrupted') fertigMit(false);
    });
    setTimeout(() => fertigMit(false), maxMs);
  });
}

holKnopf.addEventListener('click', async () => {
  const ziel = await getTargetDir();
  if (!ziel) return zeigeZeile(expInfo, t('expNoTargetYet'), 'prompt');

  // Schreibrecht wird gebraucht: Die Kennung muss in den Zielordner, damit
  // das Skript spaeter beweisen kann, dass es den richtigen vor sich hat.
  if (await ordnerRecht(ziel, 'readwrite') !== 'granted') {
    try { await ziel.requestPermission({ mode: 'readwrite' }); } catch { /* abgelehnt */ }
    if (await ordnerRecht(ziel, 'readwrite') !== 'granted') {
      return zeigeZeile(expInfo, t('expNeedsPermission'), 'prompt');
    }
  }

  holKnopf.disabled = true;
  expAbbruch = new AbortController();
  expAbKnopf.hidden = false;

  try {
    await explorerMarkeSetzen(ziel);
    const skriptId = await ladeHerunter(STLDL_SKRIPT, VBS_INHALT);
    const regId = await ladeHerunter('stldl-protokoll.reg', regInhalt());

    // Erst wenn die Dateien wirklich auf der Platte liegen, laesst sich der
    // Ordner mit markierter Datei oeffnen - auf einen laufenden Download
    // reagiert show() nicht.
    await warteAufDownload(regId);
    if (await warteAufDownload(skriptId)) {
      chrome.downloads.show(skriptId);
    } else {
      chrome.downloads.showDefaultFolder();
    }
    zeigeZeile(holInfo, t('expSetupDownloaded'), 'none');
  } catch (err) {
    holKnopf.disabled = false;
    expAbKnopf.hidden = true;
    expAbbruch = null;
    return zeigeZeile(holInfo, t('libError', [err.message]), 'prompt');
  }

  zeigeWarten(expInfo, t('expSetupWaiting'));
  holKnopf.textContent = t('expSetupRunning');

  // Lange Wartezeit: Dazwischen klickt der Nutzer durch mehrere Dialoge.
  const erg = await explorerAufAntwortWarten(ziel, expAbbruch.signal, 5 * 60 * 1000);

  holKnopf.disabled = false;
  holKnopf.textContent = t('expSetupButton');
  expAbKnopf.hidden = true;

  if (expAbbruch?.signal.aborted) {
    zeigeZeile(expInfo, t('expAssignCancelled'), 'none');
  } else if (!erg.ok) {
    zeigeZeile(expInfo, t('expSetupTimeout'), 'prompt');
  } else if (erg.version < EXP_SKRIPT_VERSION) {
    zeigeZeile(expInfo, t('expScriptOld', [String(erg.version), String(EXP_SKRIPT_VERSION)]), 'prompt');
  } else {
    await explorerPfadSetzen(erg.pfad);
    zeigeZeile(expInfo, t('expSetupOk', [erg.pfad]), 'granted');
  }

  expAbbruch = null;
  await expZeichne();
});

// --- Dateien der eigenen Loesung ------------------------------------------
document.getElementById('codeVbs').textContent = VBS_INHALT;
document.getElementById('codeReg').textContent = regInhalt();
document.getElementById('codeRegAus').textContent = regEntfernenInhalt();
document.getElementById('dlRegAus').addEventListener('click',
  () => dateiHerunterladen('stldl-protokoll-entfernen.reg', regEntfernenInhalt()));

// --- Start ----------------------------------------------------------------
(async () => {
  await uebernimmGewuenschtenBereich();
  await render();
  await expZeichne();
})();
