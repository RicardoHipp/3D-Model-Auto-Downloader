// Infoseite nach Installation und nach einem Update.
//
// Der Service Worker öffnet sie einmalig (siehe zeigeInfoseite in
// background.js) und sagt über die Adresse, welcher Fall vorliegt:
//   welcome.html?modus=install
//   welcome.html?modus=update&von=1.0.6

const t = (key, subs) => chrome.i18n.getMessage(key, subs);

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

const parameter = new URLSearchParams(location.search);
const istNeu = parameter.get('modus') !== 'update';
const vorher = parameter.get('von') || '';
const version = chrome.runtime.getManifest().version;

document.getElementById('version').textContent = t('welcomeVersion', [version]);
document.getElementById('titel').textContent =
  istNeu ? t('welcomeTitleInstall') : t('welcomeTitleUpdate', [version]);
document.getElementById('lead').textContent =
  istNeu ? t('welcomeIntroInstall')
         : (vorher ? t('welcomeIntroUpdateFrom', [vorher]) : t('welcomeIntroUpdate'));
document.getElementById('listeTitel').textContent =
  istNeu ? t('welcomeFeaturesInstall') : t('welcomeFeaturesUpdate');
document.getElementById('fussText').textContent =
  istNeu ? t('welcomeFooterInstall') : t('welcomeFooter');

// Diese Karte beschreibt im Update-Fall eine Änderung ("jetzt", "vorher") -
// für jemanden, der gerade erst installiert hat, war nie etwas anders.
document.getElementById('f2Titel').textContent =
  istNeu ? t('welcomeF2TitelInstall') : t('welcomeF2Titel');
document.getElementById('f2Text').textContent =
  istNeu ? t('welcomeF2TextInstall') : t('welcomeF2Text');

// Bei einer Neuinstallation ist noch nichts "neu" - da sind es einfach die
// Funktionen. Und der Hinweis auf den Pflichtordner erklärt nur eine
// Änderung, die es für Erstnutzer nie gab.
if (istNeu) {
  for (const el of document.querySelectorAll('.neu')) el.remove();
  document.getElementById('pflichtKarte').hidden = true;
}

// Den Einrichtungs-Kasten nur zeigen, solange er gebraucht wird. Gerade beim
// Update von 1.0.6 ist das wichtig: Dort war der Zielordner noch freiwillig.
(async () => {
  try {
    const { state } = await targetDirStatus();
    document.getElementById('einrichten').hidden = state === 'granted';
  } catch {
    document.getElementById('einrichten').hidden = false;
  }
})();

const zuOptionen = () => chrome.runtime.openOptionsPage();
document.getElementById('zuEinstellungen').addEventListener('click', zuOptionen);
document.getElementById('zuEinstellungen2').addEventListener('click', zuOptionen);
document.getElementById('zuModellen').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html') });
});
