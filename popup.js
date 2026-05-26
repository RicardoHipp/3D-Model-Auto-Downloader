const badge     = document.getElementById('statusBadge');
const pauseBtn  = document.getElementById('pauseBtn');
const pauseHint = document.getElementById('pauseHint');
const debugToggle = document.getElementById('debugToggle');
const debugHint   = document.getElementById('debugHint');

function applyPauseState(paused) {
  if (paused) {
    badge.textContent = 'Pausiert';
    badge.className = 'badge paused';
    pauseBtn.textContent = 'Wieder aktivieren';
    pauseBtn.className = 'pause-btn do-resume';
    pauseHint.style.display = 'block';
  } else {
    badge.textContent = 'Aktiv';
    badge.className = 'badge active';
    pauseBtn.textContent = 'Bis zum Neustart deaktivieren';
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
