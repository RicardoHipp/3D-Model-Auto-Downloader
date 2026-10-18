const t = (key, subs) => chrome.i18n.getMessage(key, subs);

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

const stateEl  = document.getElementById('state');
const chooseEl = document.getElementById('choose');
const renewEl  = document.getElementById('renew');
const resetEl  = document.getElementById('reset');

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

  renewEl.hidden = state !== 'prompt';
  resetEl.hidden = state === 'none';
  chooseEl.textContent = state === 'none' ? t('optionsChoose') : t('optionsChangeFolder');
}

chooseEl.addEventListener('click', async () => {
  try {
    const handle = await showDirectoryPicker({ mode: 'readwrite' });
    await saveTargetDir(handle);
    await render();
  } catch (err) {
    // AbortError = Nutzer hat das Auswahlfenster geschlossen, das ist kein Fehler
    if (err.name !== 'AbortError') {
      stateEl.className = 'state prompt';
      stateEl.textContent = t('optionsPickFailed', [err.message]);
    }
  }
});

// Nur hier möglich: requestPermission verlangt eine Nutzergeste, die es im
// Service Worker und im Offscreen-Dokument nicht gibt.
renewEl.addEventListener('click', async () => {
  const handle = await getTargetDir();
  if (!handle) return render();
  try {
    await handle.requestPermission({ mode: 'readwrite' });
  } catch { /* abgelehnt – render() zeigt den Zustand ohnehin an */ }
  await render();
});

resetEl.addEventListener('click', async () => {
  await clearTargetDir();
  await render();
});

render();
