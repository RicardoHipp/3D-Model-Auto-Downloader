const t = (key, subs) => chrome.i18n.getMessage(key, subs);

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}
for (const el of document.querySelectorAll('[data-i18nPh], [data-i18n-ph]')) {
  const msg = t(el.dataset.i18nPh);
  if (msg) el.placeholder = msg;
}

const rasterEl  = document.getElementById('raster');
const hinweisEl = document.getElementById('hinweis');
const sucheEl   = document.getElementById('suche');
const quelleEl  = document.getElementById('quelle');
const sortEl    = document.getElementById('sortierung');
const korbEl    = document.getElementById('papierkorb');
const leerenEl  = document.getElementById('korbLeeren');

let modelle = [];
// Zeigt die Uebersicht gerade den Papierkorb statt der Modelle?
let imPapierkorb = false;
// Objekt-URLs der Vorschaubilder, damit sie beim Neuaufbau freigegeben werden
// können – sonst wächst der Speicherverbrauch mit jedem Filterwechsel.
let bildUrls = [];

const BILD_NAMEN = ['preview.jpg', 'preview.png', 'preview.webp', 'preview.jpeg'];

// Geloeschte Modelle wandern hierhin, statt von der Platte zu verschwinden.
// Der Name ist fest und nicht uebersetzt: Er steht auf der Platte und duerfte
// sonst beim Umstellen der Browsersprache nicht mehr gefunden werden - dieselbe
// Ueberlegung wie bei den Modellordnern, die ohne "von"/"from" auskommen.
// Der Unterstrich vorn sortiert ihn im Explorer vor alle Modelle.
const PAPIERKORB = '_Trash_';

// Angehaengt beim Verschieben, damit zweimal geloeschte Modelle sich nicht
// gegenseitig ueberschreiben - und man im Explorer sieht, wann es war.
const GELOESCHT = /_deleted-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/;

// Ordnernamen folgen dem Schema "Modellname_Plattform_2026-10-19".
// Von hinten aufdröseln, weil der Modellname selbst Unterstriche enthalten darf.
function zerlegeOrdnername(name) {
  const m = name.match(/^(.*)_([^_]+)_(\d{4}-\d{2}-\d{2})$/);
  if (m) return { titel: m[1].replace(/_/g, ' '), quelle: m[2], datum: m[3] };
  // Älteres Schema "Name_von_Plattform_18.10.2026" aus Versionen vor 1.0.5
  const alt = name.match(/^(.*)_von_([^_]+)_(\d{2})\.(\d{2})\.(\d{4})$/);
  if (alt) return { titel: alt[1].replace(/_/g, ' '), quelle: alt[2], datum: `${alt[5]}-${alt[4]}-${alt[3]}` };
  return { titel: name.replace(/_/g, ' '), quelle: '', datum: '' };
}

function formatGroesse(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function formatDatum(iso) {
  if (!iso) return '';
  const [j, m, tg] = iso.split('-');
  return `${tg}.${m}.${j}`;
}

// Eigene Rueckfrage statt confirm(). Chromes Fenster schreibt "The extension
// ... says" darueber, laesst sich nicht gestalten und sieht aus wie eine
// Systemwarnung - bei einer Frage, die wir selbst stellen, ist das verkehrt.
// Gibt true zurueck, wenn der Nutzer zustimmt.
const frageEl = document.getElementById('frage');

function frage({ titel, text, ja, gefahr = false }) {
  document.getElementById('frageTitel').textContent = titel;
  document.getElementById('frageText').textContent = text;
  const jaEl = document.getElementById('frageJa');
  const neinEl = document.getElementById('frageNein');
  jaEl.textContent = ja;
  jaEl.className = gefahr ? 'gefahr' : 'wichtig';

  return new Promise((fertig) => {
    // Erst antworten, dann schliessen: close() loest das close-Ereignis aus,
    // das sonst mit "abgelehnt" dazwischenfunken koennte.
    const ende = (antwort) => { fertig(antwort); frageEl.close(); };
    jaEl.onclick = () => ende(true);
    neinEl.onclick = () => ende(false);
    // Deckt Esc ab - dann wurde kein Knopf gedrueckt.
    frageEl.addEventListener('close', () => fertig(false), { once: true });
    frageEl.showModal();
    // Der Abbrechen-Knopf bekommt den Fokus, nicht der zum Loeschen.
    neinEl.focus();
  });
}

// Die Einstellungen haben zwei Bereiche. Welcher gemeint ist, haengt davon
// ab, woran es gerade hakt - sonst landet der Nutzer zwar auf der richtigen
// Seite, aber an der falschen Stelle. openOptionsPage() nimmt keine
// Parameter, deshalb der Umweg ueber den Sitzungsspeicher.
async function oeffneEinstellungen(bereich) {
  try {
    await chrome.storage.session.set({ optionenBereich: bereich });
  } catch { /* dann eben der zuletzt geoeffnete Bereich */ }
  chrome.runtime.openOptionsPage();
}

// Ohne Zielordner ist diese Seite leer - dann nicht nur erklären, was fehlt,
// sondern gleich dorthin führen, wo es sich beheben lässt.
function zeigeEinrichtung(state) {
  const fehltGanz = state === 'none';
  hinweisEl.textContent = '';
  hinweisEl.hidden = false;

  const text = document.createElement('p');
  text.textContent = fehltGanz ? t('libNoFolder') : t('libNoPermission');

  const knopf = document.createElement('button');
  knopf.className = 'wichtig';
  knopf.textContent = fehltGanz ? t('libSetupButton') : t('libExpOpenSettings');
  knopf.addEventListener('click', () => oeffneEinstellungen('zielordner'));

  hinweisEl.append(text, knopf);
}

async function ladeModelle() {
  const { state } = await targetDirStatus();
  if (state !== 'granted') {
    zeigeEinrichtung(state);
    return;
  }

  const ordner = imPapierkorb ? await korbHandle(false) : await getTargetDir();
  modelle = ordner ? await modelleAus(ordner) : [];

  // Plattform-Filter aus dem tatsächlichen Bestand aufbauen. Erst leeren:
  // Beim Wechsel in den Papierkorb und zurück wird die Liste neu gelesen.
  while (quelleEl.options.length > 1) quelleEl.remove(1);
  const quellen = [...new Set(modelle.map(m => m.quelle).filter(Boolean))].sort();
  for (const q of quellen) {
    const opt = document.createElement('option');
    opt.value = q; opt.textContent = q;
    quelleEl.appendChild(opt);
  }

  hinweisEl.hidden = modelle.length > 0;
  if (!modelle.length) {
    hinweisEl.textContent = t(imPapierkorb ? 'libTrashNothing' : 'libEmpty');
  }
  zeichne();
}

// Liest die Modellordner eines Verzeichnisses. Im Papierkorb steckt das
// Löschdatum im Namen - für die Anzeige wird es wieder abgetrennt, sonst
// stünde auf der Kachel ein Titel mit angehängtem Datum.
async function modelleAus(ordner) {
  const raus = [];
  for await (const [name, handle] of ordner.entries()) {
    if (handle.kind !== 'directory') continue;
    if (!imPapierkorb && name === PAPIERKORB) continue;
    const treffer = name.match(GELOESCHT);
    const ohneMarke = treffer ? name.slice(0, treffer.index) : name;
    raus.push({
      name, handle,
      geloescht: treffer ? treffer[1] : '',
      ...zerlegeOrdnername(ohneMarke)
    });
  }
  return raus;
}

// Gibt den Papierkorb-Ordner zurück, mit anlegen nur auf Wunsch: Beim bloßen
// Hineinschauen soll er nicht nebenbei entstehen.
async function korbHandle(anlegen) {
  const wurzel = await getTargetDir();
  try {
    return await wurzel.getDirectoryHandle(PAPIERKORB, { create: anlegen });
  } catch {
    return null;
  }
}

// Ein Klick öffnet die Modellseite. Übergeben wird nur der Ordnername:
// Handles lassen sich nicht zwischen Seiten reichen, der Zielordner liegt
// aber ohnehin in der IndexedDB und wird dort wieder aufgemacht.
function zeigeModell(m) {
  const adresse = 'model.html?ordner=' + encodeURIComponent(m.name)
    + (imPapierkorb ? '&korb=1' : '');
  location.href = chrome.runtime.getURL(adresse);
}

function gefiltert() {
  const suchbegriff = sucheEl.value.trim().toLowerCase();
  const quelle = quelleEl.value;
  let liste = modelle.filter(m =>
    (!quelle || m.quelle === quelle) &&
    (!suchbegriff || m.titel.toLowerCase().includes(suchbegriff))
  );
  const sortierung = sortEl.value;
  liste.sort((a, b) =>
    sortierung === 'name-auf' ? a.titel.localeCompare(b.titel, 'de')
    : sortierung === 'datum-auf' ? (a.datum || '').localeCompare(b.datum || '')
    : (b.datum || '').localeCompare(a.datum || '')
  );
  return liste;
}

function zeichne() {
  for (const u of bildUrls) URL.revokeObjectURL(u);
  bildUrls = [];
  rasterEl.textContent = '';

  const liste = gefiltert();
  document.getElementById('zaehler').textContent =
    liste.length === modelle.length
      ? t('libCount', [String(modelle.length)])
      : t('libCountFiltered', [String(liste.length), String(modelle.length)]);

  for (const m of liste) {
    const karte = document.createElement('div');
    karte.className = 'karte';
    karte.innerHTML = `
      <div class="bild"><span class="leer">3D</span></div>
      <div class="text">
        <div class="name"></div>
        <div class="meta">
          <span class="quelle"></span>
          <span class="datum"></span>
        </div>
      </div>`;
    karte.querySelector('.name').textContent = m.titel;
    const q = karte.querySelector('.quelle');
    q.textContent = m.quelle || '–';
    q.classList.add(m.quelle);
    karte.querySelector('.datum').textContent = imPapierkorb && m.geloescht
      ? t('libDeletedOn', [formatDatum(m.geloescht)])
      : formatDatum(m.datum);
    karte.addEventListener('click', () => zeigeModell(m));
    rasterEl.appendChild(karte);

    // Vorschaubilder erst laden, wenn die Kachel in Sicht kommt – bei vielen
    // Modellen würde sonst jeder Filterwechsel alle Bilder von der Platte holen.
    beobachter.observe(karte);
    karte.__modell = m;
  }
}

const beobachter = new IntersectionObserver((eintraege) => {
  for (const e of eintraege) {
    if (!e.isIntersecting) continue;
    beobachter.unobserve(e.target);
    ladeVorschau(e.target, e.target.__modell);
  }
}, { rootMargin: '200px' });

async function ladeVorschau(karte, m) {
  for (const dateiname of BILD_NAMEN) {
    try {
      const fh = await m.handle.getFileHandle(dateiname);
      const url = URL.createObjectURL(await fh.getFile());
      bildUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      karte.querySelector('.bild').replaceChildren(img);
      return;
    } catch { /* nächster Name */ }
  }
}

// Der Papierkorb ist dieselbe Ansicht mit einem anderen Ordner dahinter -
// Suche, Filter und Sortierung gelten dort genauso.
async function zeigeAnsicht(korb) {
  imPapierkorb = korb;
  korbEl.setAttribute('aria-pressed', String(korb));
  korbEl.textContent = t(korb ? 'libTrashBack' : 'libTrashButton');
  leerenEl.hidden = !korb;
  document.getElementById('korbNote').hidden = !korb;
  document.getElementById('libTitel').textContent = t(korb ? 'libTrashButton' : 'libHeading');
  hinweisEl.textContent = t('libLoading');
  hinweisEl.hidden = false;
  rasterEl.textContent = '';
  await ladeModelle();
}

korbEl.addEventListener('click', () => zeigeAnsicht(!imPapierkorb));

leerenEl.addEventListener('click', async () => {
  if (!modelle.length) return;
  if (!await frage({
    titel: t('libTrashEmptyButton'),
    text: t('libTrashEmptyConfirm', [String(modelle.length)]),
    ja: t('libTrashEmptyButton'),
    gefahr: true
  })) return;
  const wurzel = await getTargetDir();
  // Den Ordner ganz entfernen statt Eintrag für Eintrag - er entsteht beim
  // nächsten Löschen von selbst wieder.
  await wurzel.removeEntry(PAPIERKORB, { recursive: true });
  modelle = [];
  hinweisEl.textContent = t('libTrashNothing');
  hinweisEl.hidden = false;
  zeichne();
});

for (const el of [sucheEl, quelleEl, sortEl]) el.addEventListener('input', zeichne);

// Kommt der Nutzer von der Modellseite zurück, soll er dort landen, wo er
// war - also im Papierkorb, wenn er von dort kam.
if (new URLSearchParams(location.search).get('korb') === '1') {
  zeigeAnsicht(true).catch(() => {});
} else {
  ladeModelle().catch(err => {
    hinweisEl.hidden = false;
    hinweisEl.textContent = t('libError', [err.message]);
  });
}
