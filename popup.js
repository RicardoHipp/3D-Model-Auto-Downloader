const badge     = document.getElementById('statusBadge');
const pauseBtn  = document.getElementById('pauseBtn');
const pauseHint = document.getElementById('pauseHint');
const debugToggle = document.getElementById('debugToggle');
const debugHint   = document.getElementById('debugHint');

const t = (key) => chrome.i18n.getMessage(key);

// Statische Texte sofort uebersetzen - die im HTML stehenden deutschen Texte
// sind nur Fallback, falls getMessage nichts liefert.
for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

function applyPauseState(paused) {
  if (paused) {
    badge.textContent = t('statusPaused');
    badge.className = 'badge paused';
    pauseBtn.textContent = t('resumeButton');
    pauseBtn.className = 'pause-btn do-resume';
    pauseHint.style.display = 'block';
  } else {
    badge.textContent = t('statusActive');
    badge.className = 'badge active';
    pauseBtn.textContent = t('pauseButton');
    pauseBtn.className = 'pause-btn do-pause';
    pauseHint.style.display = 'none';
  }
}

// Initial state
chrome.storage.session.get('isPaused', (r) => applyPauseState(!!r.isPaused));
chrome.storage.local.get('debugMode', (r) => {
  debugToggle.checked = !!r.debugMode;
  debugHint.style.display = debugToggle.checked ? 'block' : 'none';
});

pauseBtn.addEventListener('click', () => {
  chrome.storage.session.get('isPaused', (r) => {
    chrome.storage.session.set({ isPaused: !r.isPaused });
  });
});

debugToggle.addEventListener('change', () => {
  chrome.storage.local.set({ debugMode: debugToggle.checked });
  debugHint.style.display = debugToggle.checked ? 'block' : 'none';
});

// Live-Update wenn sich der Status ändert (z.B. aus anderem Kontext)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && 'isPaused' in changes) applyPauseState(!!changes.isPaused.newValue);
});

const optionenBtn = document.getElementById('openOptions');

document.getElementById('openLibrary').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
});

optionenBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// Ohne Zielordner laedt die Erweiterung nichts herunter, bei abgelaufener
// Freigabe genauso - beides muss das Popup sagen, sonst sucht der Nutzer den
// Fehler woanders. Im ersten Fall sagt der Knopf gleich, was zu tun ist.
(async () => {
  try {
    const { state } = await targetDirStatus();
    if (state === 'granted') return;
    const warn = document.getElementById('targetWarn');
    if (state === 'none') {
      warn.textContent = t('popupNoTarget');
      document.getElementById('optionenText').textContent = t('libSetupButton');
    }
    warn.hidden = false;
  } catch { /* Status unbekannt - dann keine Warnung behaupten */ }
})();
