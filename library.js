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
const tagLeisteEl = document.getElementById('tagLeiste');
const syncEl    = document.getElementById('sync');
const markBalkenEl = document.getElementById('markiert');

// Im Filter gewaehlte Tags (klein geschrieben). Mehrere: Ein Modell muss alle
// haben.
const gewaehlteTags = new Set();
// Mit Strg+Klick markierte Modelle (Ordnernamen) - fuer Tags an mehreren auf
// einmal.
const markiert = new Set();
// Kachel je Ordnername, fuer stilles Nachziehen nach dem Abgleich.
let karteVon = new Map();
// Ist die aktuelle Ansicht schon einmal gezeichnet worden? Nur beim ersten
// Mal blenden die Kacheln nacheinander ein.
let schonGezeichnet = false;

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

  markiert.clear();
  schonGezeichnet = false;
  // Ein noch laufender Abgleich gehoert zur vorigen Ansicht.
  abgleichNummer++;
  syncEl.hidden = true;
  if (imPapierkorb) {
    // Der Papierkorb wird selten angesehen und nicht zwischengespeichert.
    const ordner = await korbHandle(false);
    modelle = ordner ? await modelleAus(ordner) : [];
    nachLaden();
    return;
  }

  // Erst der gemerkte Stand - sofort da, auch bei vielen Modellen oder einem
  // langsamen Netzlaufwerk. Danach im Hintergrund mit den Ordnern abgleichen.
  modelle = await bibAlle();
  if (modelle.length) nachLaden();
  await abgleichen(await getTargetDir());
  // Erster Start ohne Zwischenspeicher: erst jetzt etwas zu zeigen.
  if (!rasterEl.childElementCount) nachLaden();
}

// Filter aufbauen und zeichnen - nach dem Laden und nach dem Abgleich.
function nachLaden() {
  // Plattform-Filter aus dem tatsächlichen Bestand aufbauen. Erst leeren:
  // Beim Wechsel in den Papierkorb und zurück wird die Liste neu gelesen.
  const vorher = quelleEl.value;
  while (quelleEl.options.length > 1) quelleEl.remove(1);
  const quellen = [...new Set(modelle.map(m => m.quelle).filter(Boolean))].sort();
  for (const q of quellen) {
    const opt = document.createElement('option');
    opt.value = q; opt.textContent = q;
    quelleEl.appendChild(opt);
  }
  if (quellen.includes(vorher)) quelleEl.value = vorher;

  hinweisEl.hidden = modelle.length > 0;
  if (!modelle.length) {
    hinweisEl.textContent = t(imPapierkorb ? 'libTrashNothing' : 'libEmpty');
  }
  zeichneTagLeiste();
  zeichne();
}

// --- Abgleich mit den Ordnern ------------------------------------------------
//
// Laeuft nach dem Anzeigen. Neue Ordner werden eingelesen, verschwundene
// fallen raus. In bekannten Ordnern genuegt ein Blick auf die Aenderungszeit
// von info.txt und Vorschaubild: Nur was sich geaendert hat - etwa Tags, die
// jemand mit dem Editor eingetragen hat -, wird neu gelesen.
//
// Geaenderte Kacheln werden an Ort und Stelle nachgezogen, statt die Liste
// neu aufzubauen: Sonst springen sie unter dem Mauszeiger. Neu gezeichnet
// wird nur, wenn Modelle dazukommen oder wegfallen, oder wenn ein Filter
// gerade andere Treffer ergaebe.
let abgleichNummer = 0;

async function abgleichen(wurzel) {
  if (!wurzel) return;
  const nummer = ++abgleichNummer;
  syncEl.hidden = false;
  try {
    const bekannt = new Map(modelle.map((m) => [m.name, m]));
    const ordner = [];
    for await (const [name, handle] of wurzel.entries()) {
      if (handle.kind === 'directory' && name !== PAPIERKORB) ordner.push([name, handle]);
    }
    if (nummer !== abgleichNummer) return;

    const neu = [], merken = [], nachziehen = [];
    let tagsGeaendert = false;
    // Hoechstens acht Ordner gleichzeitig - ein Netzlaufwerk soll nicht
    // mit Hunderten Anfragen auf einmal zugeschuettet werden.
    let naechster = 0;
    const arbeiter = async () => {
      while (naechster < ordner.length) {
        const [name, handle] = ordner[naechster++];
        const m = bekannt.get(name);
        if (!m) { neu.push(await liesModell(name, handle)); continue; }
        // Der gemerkte Handle gilt weiter; frisch ist er trotzdem sicherer.
        if (!m.handle) merken.push(m);
        m.handle = handle;
        const was = await pruefeModell(m);
        if (was.tags) tagsGeaendert = true;
        if (was.merken && !merken.includes(m)) merken.push(m);
        if (was.tags || was.bild) nachziehen.push(m);
      }
    };
    await Promise.all(Array.from({ length: 8 }, arbeiter));
    if (nummer !== abgleichNummer) return;

    const vorhanden = new Set(ordner.map(([name]) => name));
    const weg = modelle.filter((m) => !vorhanden.has(m.name)).map((m) => m.name);
    await bibSchreibe([...neu, ...merken].map(eintrag), weg);
    if (nummer !== abgleichNummer) return;

    if (neu.length || weg.length) {
      modelle = modelle.filter((m) => vorhanden.has(m.name)).concat(neu);
      for (const n of weg) markiert.delete(n);
      nachLaden();
    } else {
      for (const m of nachziehen) aktualisiereKarte(m);
      if (tagsGeaendert) {
        zeichneTagLeiste();
        if (gewaehlteTags.size || sucheEl.value.trim()) zeichne();
      }
    }
  } finally {
    if (nummer === abgleichNummer) syncEl.hidden = true;
  }
}

// Was im Zwischenspeicher steht - ohne das, was nur die Seite braucht.
function eintrag(m) {
  return {
    name: m.name, titel: m.titel, quelle: m.quelle, datum: m.datum,
    zeit: m.zeit || 0, tags: m.tags || [], infoZeit: m.infoZeit || 0,
    bild: m.bild || null, bildName: m.bildName || '', bildZeit: m.bildZeit || 0,
    handle: m.handle || null
  };
}

async function infoDatei(ordner) {
  try { return await (await ordner.getFileHandle('info.txt')).getFile(); } catch { return null; }
}

async function liesModell(name, handle) {
  const info = await infoDatei(handle);
  return {
    name, handle, geloescht: '',
    ...zerlegeOrdnername(name),
    zeit: await zeitVon(handle),
    tags: info ? tagsAusInfo(await info.text()) : [],
    infoZeit: info ? info.lastModified : 0,
    bild: null, bildName: '', bildZeit: 0
  };
}

// Hat sich an einem bekannten Modell etwas geaendert? Liest nur die Angaben
// der Dateien, den Inhalt der info.txt nur, wenn ihre Zeit nicht mehr stimmt.
//   tags    andere Tags als gemerkt
//   bild    Vorschaubild ausgetauscht oder entfernt
//   merken  Zwischenspeicher neu schreiben (auch bei neuer Zeit ohne andere
//           Tags - sonst wird die Datei bei jedem Oeffnen wieder gelesen)
async function pruefeModell(m) {
  const was = { tags: false, bild: false, merken: false };
  const info = await infoDatei(m.handle);
  const zeit = info ? info.lastModified : 0;
  if (zeit !== m.infoZeit) {
    const tags = info ? tagsAusInfo(await info.text()) : [];
    m.infoZeit = zeit;
    was.merken = true;
    if (tags.join('\n') !== (m.tags || []).join('\n')) { m.tags = tags; was.tags = true; }
  }
  if (m.bildName) {
    let bildZeit = 0;
    try { bildZeit = (await (await m.handle.getFileHandle(m.bildName)).getFile()).lastModified; } catch {}
    if (bildZeit !== m.bildZeit) {
      m.bild = null; m.bildName = ''; m.bildZeit = 0;
      was.bild = was.merken = true;
    }
  }
  return was;
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
  // Der Ordnername kennt nur den Tag. Fuer die Reihenfolge innerhalb eines
  // Tages braucht es die Uhrzeit - die steht an den Dateien darin.
  await Promise.all(raus.map(async (m) => { m.zeit = await zeitVon(m.handle); }));
  return raus;
}

// Wann das Modell heruntergeladen wurde: die aelteste Datei im Ordner.
// Die juengste taugt nicht - die aendert sich, sobald man etwas dazulegt.
// Nur die oberste Ebene, Unterordner wie "Einzelteile" entstehen spaeter.
// getFile() liest dabei nur die Angaben, nicht den Inhalt.
async function zeitVon(ordner) {
  let aelteste = Infinity;
  let gezaehlt = 0;
  try {
    for await (const [, eintrag] of ordner.entries()) {
      if (eintrag.kind !== 'file') continue;
      const zeit = (await eintrag.getFile()).lastModified;
      if (zeit < aelteste) aelteste = zeit;
      // Fuer die Reihenfolge genuegen ein paar Dateien.
      if (++gezaehlt >= 12) break;
    }
  } catch { /* Ordner nicht lesbar - dann ohne Uhrzeit */ }
  return Number.isFinite(aelteste) ? aelteste : 0;
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
    (!suchbegriff || m.titel.toLowerCase().includes(suchbegriff)
      || (m.tags || []).some((tag) => tagSchluessel(tag).includes(suchbegriff))) &&
    [...gewaehlteTags].every((g) => (m.tags || []).some((tag) => tagSchluessel(tag) === g))
  );
  const sortierung = sortEl.value;
  // Erst nach dem Tag im Ordnernamen - der steht auf der Karte und soll
  // zur Reihenfolge passen -, innerhalb des Tages nach der Uhrzeit.
  const nachDatum = (a, b) =>
    (a.datum || '').localeCompare(b.datum || '') || (a.zeit || 0) - (b.zeit || 0);
  liste.sort((a, b) =>
    sortierung === 'name-auf' ? a.titel.localeCompare(b.titel, 'de')
    : sortierung === 'datum-auf' ? nachDatum(a, b)
    : nachDatum(b, a)
  );
  return liste;
}

function zeichne() {
  for (const u of bildUrls) URL.revokeObjectURL(u);
  bildUrls = [];
  rasterEl.textContent = '';
  karteVon = new Map();
  const einblenden = !schonGezeichnet;
  schonGezeichnet = true;

  const liste = gefiltert();
  document.getElementById('zaehler').textContent =
    liste.length === modelle.length
      ? t('libCount', [String(modelle.length)])
      : t('libCountFiltered', [String(liste.length), String(modelle.length)]);

  for (const m of liste) {
    const karte = document.createElement('div');
    karte.className = 'karte';
    karte.innerHTML = `
      <div class="bild"><span class="leer">3D</span>
        <span class="quelle"></span>
        <span class="datum"></span>
      </div>
      <div class="text">
        <div class="name"></div>
        <div class="tags"></div>
      </div>`;
    karte.querySelector('.name').textContent = m.titel;
    const q = karte.querySelector('.quelle');
    q.textContent = m.quelle || '–';
    q.classList.add(m.quelle);
    karte.querySelector('.datum').textContent = imPapierkorb && m.geloescht
      ? t('libDeletedOn', [formatDatum(m.geloescht)])
      : formatDatum(m.datum);
    // Strg+Klick markiert (fuer Tags an mehreren), ein normaler Klick oeffnet.
    karte.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) { schalteMarke(m.name); return; }
      zeigeModell(m);
    });
    if (!imPapierkorb) {
      const tagKnopf = document.createElement('button');
      tagKnopf.className = 'tagKnopf';
      tagKnopf.textContent = '#';
      tagKnopf.title = t('libTagsEditHint');
      tagKnopf.setAttribute('aria-label', t('libTagsEdit'));
      tagKnopf.addEventListener('click', (e) => { e.stopPropagation(); bearbeiteTags(m.name); });
      karte.querySelector('.bild').appendChild(tagKnopf);
      karte.addEventListener('contextmenu', (e) => { e.preventDefault(); bearbeiteTags(m.name); });
      nimmtTagAuf(karte, m);
    }
    karte.classList.toggle('markiert', markiert.has(m.name));
    // Beim ersten Zeichnen einer Ansicht blenden alle Kacheln gemeinsam weich
    // ein - nacheinander wirkte es, als muesste erst geladen werden. Bei
    // Filterwechseln nicht, da soll es sofort stehen.
    if (einblenden) karte.classList.add('rein');
    zeigeKartenTags(karte, m);
    karteVon.set(m.name, karte);
    rasterEl.appendChild(karte);

    // Vorschaubilder erst laden, wenn die Kachel in Sicht kommt – bei vielen
    // Modellen würde sonst jeder Filterwechsel alle Bilder von der Platte holen.
    beobachter.observe(karte);
    karte.__modell = m;
  }
  zeigeMarkierung();
}

function zeigeKartenTags(karte, m) {
  const ort = karte.querySelector('.tags');
  ort.textContent = '';
  for (const tag of m.tags || []) {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = tag;
    ort.appendChild(el);
  }
}

// Stilles Nachziehen einer Kachel: Tags neu, Bild neu laden, falls es sich
// geaendert hat. Die Kachel bleibt an ihrem Platz.
function aktualisiereKarte(m) {
  const karte = karteVon.get(m.name);
  if (!karte) return;
  zeigeKartenTags(karte, m);
  if (!m.bild) ladeVorschau(karte, m);
}

// --- Tag-Leiste (Filter) ------------------------------------------------------

// Eigener Datentyp beim Ziehen: So nimmt eine Kachel nur Tags aus der
// Leiste an, keinen beliebigen Text oder Dateien.
const TAG_ZIEHEN = 'application/x-stl-tag';

// Kachel als Ablage fuer einen Tag aus der Leiste. Ist die Kachel markiert,
// bekommen alle markierten den Tag.
function nimmtTagAuf(karte, m) {
  const passt = (e) => e.dataTransfer.types.includes(TAG_ZIEHEN);
  karte.addEventListener('dragover', (e) => {
    if (!passt(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const ziele = zieleVon(m.name);
    for (const z of ziele) karteVon.get(z.name)?.classList.add('ablage');
  });
  karte.addEventListener('dragleave', (e) => {
    if (karte.contains(e.relatedTarget)) return;
    for (const k of rasterEl.querySelectorAll('.ablage')) k.classList.remove('ablage');
  });
  karte.addEventListener('drop', async (e) => {
    if (!passt(e)) return;
    e.preventDefault();
    for (const k of rasterEl.querySelectorAll('.ablage')) k.classList.remove('ablage');
    const tag = tagSauber(e.dataTransfer.getData(TAG_ZIEHEN));
    if (!tag) return;
    await aendereTags(zieleVon(m.name), (tags) => hatTag(tags, tag) ? tags : [...tags, tag], (text) => {
      hinweisEl.textContent = text;
      hinweisEl.hidden = false;
    });
  });
}

// Neu angelegte Tags, die noch an keinem Modell haengen. Ein Tag existiert
// sonst nur durch die Modelle, die ihn tragen - ein frisch angelegter steht
// hier, bis er auf ein Modell gezogen wird. Gemerkt nur in diesem Browser;
// verloren ginge dabei nichts, was schon an einem Modell steht.
const NEUE_TAGS_KEY = 'neueTags';
let neueTags = (() => {
  try { return tagsEinmalig(JSON.parse(localStorage.getItem(NEUE_TAGS_KEY) || '[]')); } catch { return []; }
})();
function merkeNeueTags() {
  try { localStorage.setItem(NEUE_TAGS_KEY, JSON.stringify(neueTags)); } catch { /* nur Bequemlichkeit */ }
}

function zeichneTagLeiste() {
  // Je Tag die haeufigste Schreibweise und die Anzahl.
  const zaehlung = new Map();
  for (const m of modelle) {
    for (const tag of m.tags || []) {
      const s = tagSchluessel(tag);
      const z = zaehlung.get(s) || { anzahl: 0, formen: new Map() };
      z.anzahl++;
      z.formen.set(tag, (z.formen.get(tag) || 0) + 1);
      zaehlung.set(s, z);
    }
  }
  // Neue Tags, die inzwischen an einem Modell haengen, sind keine mehr.
  const vorher = neueTags.length;
  neueTags = neueTags.filter((tag) => !zaehlung.has(tagSchluessel(tag)));
  if (neueTags.length !== vorher) merkeNeueTags();
  for (const tag of neueTags) zaehlung.set(tagSchluessel(tag), { anzahl: 0, formen: new Map([[tag, 1]]) });

  // Gewaehlte Tags, die es nicht mehr gibt, fallen aus dem Filter.
  for (const g of [...gewaehlteTags]) if (!zaehlung.has(g)) gewaehlteTags.delete(g);

  tagLeisteEl.textContent = '';
  // Immer zu sehen, auch ohne einen einzigen Tag - sonst erfaehrt niemand,
  // dass es sie gibt. Nur im Papierkorb nicht.
  tagLeisteEl.hidden = imPapierkorb;
  const titel = document.createElement('span');
  titel.className = 'leisteTitel';
  titel.textContent = t('libTags');
  tagLeisteEl.appendChild(titel);
  const sortiert = [...zaehlung].sort((a, b) => a[0].localeCompare(b[0], 'de'));
  for (const [s, z] of sortiert) {
    const form = [...z.formen].sort((a, b) => b[1] - a[1])[0][0];
    const knopf = document.createElement('button');
    knopf.className = 'tag';
    knopf.setAttribute('aria-pressed', String(gewaehlteTags.has(s)));
    const name = document.createElement('span');
    name.textContent = form;
    const zahl = document.createElement('span');
    zahl.className = 'zahl';
    zahl.textContent = String(z.anzahl);
    knopf.append(name, zahl);
    // Auf eine Kachel ziehen vergibt den Tag (siehe nimmtTagAuf).
    knopf.draggable = true;
    knopf.title = t('libTagDragHint');
    knopf.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(TAG_ZIEHEN, form);
      e.dataTransfer.setData('text/plain', form);
      e.dataTransfer.effectAllowed = 'copy';
    });
    knopf.addEventListener('click', () => {
      if (gewaehlteTags.has(s)) gewaehlteTags.delete(s); else gewaehlteTags.add(s);
      knopf.setAttribute('aria-pressed', String(gewaehlteTags.has(s)));
      zeichne();
    });
    if (!z.anzahl) knopf.classList.add('neu');
    tagLeisteEl.appendChild(knopf);
  }
  tagLeisteEl.append(neuerTagKnopf(), hilfeKnopf());
}

// "+ Tag hinzufuegen": wird zum Eingabefeld. Sind Modelle markiert, bekommen
// sie den neuen Tag gleich; sonst steht er in der Leiste zum Draufziehen.
function neuerTagKnopf() {
  const knopf = document.createElement('button');
  knopf.className = 'tagNeu';
  knopf.textContent = '+ ' + t('libTagNew');
  knopf.addEventListener('click', () => {
    const feld = document.createElement('input');
    feld.type = 'text';
    feld.className = 'tagNeuFeld';
    feld.placeholder = t('libTagNewPlaceholder');
    feld.maxLength = 60;
    feld.autocomplete = 'off';
    let fertig = false;
    const ende = async (uebernehmen) => {
      if (fertig) return;
      fertig = true;
      let tag = uebernehmen ? tagSauber(feld.value) : '';
      if (tag) {
        tag = alleTags().find((v) => tagSchluessel(v) === tagSchluessel(tag)) || tag;
        const ziele = zieleVon(null);
        if (ziele.length) {
          await aendereTags(ziele, (tags) => hatTag(tags, tag) ? tags : [...tags, tag], (text) => {
            hinweisEl.textContent = text;
            hinweisEl.hidden = false;
          });
        }
        if (!modelle.some((m) => hatTag(m.tags, tag)) && !hatTag(neueTags, tag)) {
          neueTags.push(tag);
          merkeNeueTags();
        }
      }
      zeichneTagLeiste();
    };
    feld.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ende(true); }
      else if (e.key === 'Escape') { e.preventDefault(); ende(false); }
    });
    feld.addEventListener('blur', () => ende(true));
    knopf.replaceWith(feld);
    feld.focus();
  });
  return knopf;
}

function hilfeKnopf() {
  const knopf = document.createElement('button');
  knopf.className = 'tagHilfe';
  knopf.textContent = '?';
  knopf.title = t('libTagHelpTitle');
  knopf.setAttribute('aria-label', t('libTagHelpTitle'));
  knopf.addEventListener('click', () => document.getElementById('tagHilfe').showModal());
  return knopf;
}
document.getElementById('tagHilfeZu').addEventListener('click', () => document.getElementById('tagHilfe').close());

// Alle vergebenen Tags in der haeufigsten Schreibweise - fuer Vorschlaege.
// Neu angelegte, noch unbenutzte gehoeren dazu.
function alleTags() {
  const formen = new Map();
  for (const tag of neueTags) formen.set(tagSchluessel(tag), tag);
  for (const m of modelle) for (const tag of m.tags || []) {
    const s = tagSchluessel(tag);
    if (!formen.has(s)) formen.set(s, tag);
  }
  return [...formen.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

// --- Markieren und Tags bearbeiten -----------------------------------------

function schalteMarke(name) {
  if (markiert.has(name)) markiert.delete(name); else markiert.add(name);
  karteVon.get(name)?.classList.toggle('markiert', markiert.has(name));
  zeigeMarkierung();
}

function zeigeMarkierung() {
  markBalkenEl.hidden = !markiert.size;
  document.getElementById('markiertText').textContent = t('libSelected', [String(markiert.size)]);
  // Im Papierkorb: wiederherstellen statt Tags.
  document.getElementById('markiertTags').hidden = imPapierkorb;
  const wieder = document.getElementById('markiertWieder');
  wieder.hidden = !imPapierkorb;
  wieder.textContent = t('libRestoreSelected', [String(markiert.size)]);
  zeigeKorbKnopf();
}

// Der Papierkorb-Knopf: Sind Modelle markiert, verschiebt er sie in den
// Papierkorb, statt ihn zu oeffnen. Im Papierkorb selbst fehlt er - zurueck
// geht es ueber den Home-Knopf links oben (home.js).
function zeigeKorbKnopf() {
  const loeschen = !imPapierkorb && markiert.size > 0;
  korbEl.hidden = imPapierkorb;
  korbEl.textContent = loeschen ? t('libDeleteSelected', [String(markiert.size)]) : t('libTrashButton');
  korbEl.classList.toggle('gefahr', loeschen);
}

document.getElementById('markiertTags').addEventListener('click', () => bearbeiteTags(null));
document.getElementById('markiertWeg').addEventListener('click', () => {
  for (const n of markiert) karteVon.get(n)?.classList.remove('markiert');
  markiert.clear();
  zeigeMarkierung();
});

const tagDialogEl = document.getElementById('tagDialog');

// Tags mehrerer Modelle aendern: rechne(alte Tags) -> neue Tags. Schreibt
// jede info.txt, deren Tags sich wirklich aendern, zieht Zwischenspeicher,
// Kacheln und Tag-Leiste nach. Gibt zurueck, wie viele geaendert wurden;
// Fehler gehen an beiFehler.
async function aendereTags(ziele, rechne, beiFehler) {
  const fertig = [];
  for (const m of ziele) {
    const tags = rechne(m.tags || []);
    if (tags.join('\n') === (m.tags || []).join('\n')) continue;
    try {
      if (!m.handle) m.handle = await (await getTargetDir()).getDirectoryHandle(m.name);
      m.infoZeit = await schreibeTags(m.handle, tags, m.titel);
      m.tags = tags;
      fertig.push(m);
    } catch (err) {
      beiFehler(t('libTagError', [err.message]));
    }
  }
  if (!fertig.length) return 0;
  await bibSchreibe(fertig.map(eintrag));
  for (const m of fertig) { const k = karteVon.get(m.name); if (k) zeigeKartenTags(k, m); }
  zeichneTagLeiste();
  return fertig.length;
}

// Ziele einer Aktion an einer Kachel: alle markierten, wenn die Kachel
// dazugehoert - sonst nur sie.
function zieleVon(name) {
  const namen = name === null || markiert.has(name) ? [...markiert] : [name];
  return namen.map((n) => modelle.find((m) => m.name === n)).filter(Boolean);
}

// Tags fuer ein Modell bearbeiten - oder fuer alle markierten, wenn das
// angeklickte dazugehoert (oder name null ist). Jede Aenderung wird sofort in
// die info.txt geschrieben.
function bearbeiteTags(name) {
  const ziele = zieleVon(name);
  if (!ziele.length) return;

  document.getElementById('tagDialogFuer').textContent = ziele.length === 1
    ? ziele[0].titel
    : t('libTagsFor', [String(ziele.length)]);
  const fehlerEl = document.getElementById('tagDialogFehler');
  fehlerEl.hidden = true;
  let geaendert = false;

  const aendere = async (rechne) => {
    const anzahl = await aendereTags(ziele, rechne, (text) => {
      fehlerEl.textContent = text;
      fehlerEl.hidden = false;
    });
    if (anzahl) geaendert = true;
  };

  const eingabe = tagEingabe(document.getElementById('tagDialogEingabe'), {
    stand: () => {
      const zaehl = new Map();
      for (const m of ziele) for (const tag of m.tags || []) {
        const s = tagSchluessel(tag);
        const z = zaehl.get(s) || { tag, n: 0 };
        z.n++;
        zaehl.set(s, z);
      }
      return [...zaehl.values()].map(({ tag, n }) => ({ tag, teilweise: n < ziele.length }));
    },
    vorschlaege: alleTags,
    hinzu: (tag) => aendere((tags) => hatTag(tags, tag) ? tags : [...tags, tag]),
    weg: (tag) => aendere((tags) => tags.filter((x) => tagSchluessel(x) !== tagSchluessel(tag))),
    vorschlagOrt: document.getElementById('tagDialogVorschlaege')
  });

  tagDialogEl.addEventListener('close', () => {
    // Filter oder Suche koennten jetzt andere Treffer ergeben.
    if (geaendert && (gewaehlteTags.size || sucheEl.value.trim())) zeichne();
  }, { once: true });
  tagDialogEl.showModal();
  eingabe.feld().focus();
}

document.getElementById('tagDialogFertig').addEventListener('click', () => tagDialogEl.close());

const beobachter = new IntersectionObserver((eintraege) => {
  for (const e of eintraege) {
    if (!e.isIntersecting) continue;
    beobachter.unobserve(e.target);
    ladeVorschau(e.target, e.target.__modell);
  }
}, { rootMargin: '200px' });

async function ladeVorschau(karte, m) {
  const zeige = (blob) => {
    const url = URL.createObjectURL(blob);
    bildUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    const ort = karte.querySelector('.bild');
    ort.querySelector('img, .leer')?.remove();
    ort.prepend(img);
  };
  // Gemerktes kleines Bild: ein paar KB statt des Originals von der Platte.
  if (m.bild) { zeige(m.bild); return; }
  if (!m.handle) return;          // kommt mit dem Abgleich
  for (const dateiname of BILD_NAMEN) {
    let datei;
    try { datei = await (await m.handle.getFileHandle(dateiname)).getFile(); } catch { continue; }
    zeige(datei);
    if (!imPapierkorb) merkeVorschau(m, dateiname, datei);
    return;
  }
}

// Verkleinert das Vorschaubild fuer den Zwischenspeicher. Die Kachel ist
// gut 300 Pixel breit; mehr braucht es nicht.
async function merkeVorschau(m, dateiname, datei) {
  try {
    const voll = await createImageBitmap(datei);
    const breite = Math.min(400, voll.width);
    const hoehe = Math.max(1, Math.round(voll.height * breite / voll.width));
    const leinwand = new OffscreenCanvas(breite, hoehe);
    leinwand.getContext('2d').drawImage(voll, 0, 0, breite, hoehe);
    voll.close();
    m.bild = await leinwand.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    m.bildName = dateiname;
    m.bildZeit = datei.lastModified;
    await bibSchreibe([eintrag(m)]);
  } catch { /* dann eben beim naechsten Mal wieder vom Original */ }
}

// Der Papierkorb ist dieselbe Ansicht mit einem anderen Ordner dahinter -
// Suche, Filter und Sortierung gelten dort genauso.
async function zeigeAnsicht(korb) {
  imPapierkorb = korb;
  korbEl.setAttribute('aria-pressed', String(korb));
  markiert.clear();
  zeigeMarkierung();
  leerenEl.hidden = !korb;
  document.getElementById('korbNote').hidden = !korb;
  document.getElementById('libTitel').textContent = t(korb ? 'libTrashButton' : 'libHeading');
  hinweisEl.textContent = t('libLoading');
  hinweisEl.hidden = false;
  rasterEl.textContent = '';
  await ladeModelle();
}

korbEl.addEventListener('click', () => {
  if (!imPapierkorb && markiert.size) loescheMarkierte();
  else zeigeAnsicht(!imPapierkorb);
});

// Markierte Modelle in den Papierkorb - wie "In den Papierkorb" auf der
// Modellseite, nur fuer mehrere. Nach Rueckfrage, eins nach dem anderen.
async function loescheMarkierte() {
  const ziele = zieleVon(null);
  if (!ziele.length) return;
  if (!await frage({
    titel: t('libDelete'),
    text: ziele.length === 1
      ? t('libDeleteConfirm', [ziele[0].titel])
      : t('libDeleteSelectedConfirm', [String(ziele.length)]),
    ja: t('libDelete'),
    gefahr: true
  })) return;

  korbEl.disabled = true;
  korbEl.textContent = t('libMoving');
  const erledigt = [];
  try {
    const wurzel = await getTargetDir();
    const korb = await wurzel.getDirectoryHandle(PAPIERKORB, { create: true });
    for (const m of ziele) {
      const ziel = await freierName(korb, `${m.name}_deleted-${heute()}`);
      await verschiebe(wurzel, m.name, korb, ziel);
      erledigt.push(m.name);
    }
  } catch (err) {
    hinweisEl.textContent = t('libMoveFailed', [err.message]);
    hinweisEl.hidden = false;
  } finally {
    const weg = new Set(erledigt);
    modelle = modelle.filter((m) => !weg.has(m.name));
    for (const n of erledigt) markiert.delete(n);
    await bibSchreibe([], erledigt);
    korbEl.disabled = false;
    zeichneTagLeiste();
    zeichne();
    if (!modelle.length) {
      hinweisEl.textContent = t('libEmpty');
      hinweisEl.hidden = false;
    }
  }
}

// Markierte Modelle aus dem Papierkorb zurueckholen - unter ihrem alten
// Namen, ohne die Loeschmarke. Ist der vergeben, haengt freierName eine
// Nummer an.
document.getElementById('markiertWieder').addEventListener('click', async (e) => {
  const knopf = e.currentTarget;
  const ziele = zieleVon(null);
  if (!ziele.length) return;
  knopf.disabled = true;
  knopf.textContent = t('libRestoring');
  const erledigt = [];
  try {
    const wurzel = await getTargetDir();
    const korb = await wurzel.getDirectoryHandle(PAPIERKORB);
    for (const m of ziele) {
      const ziel = await freierName(wurzel, m.name.replace(GELOESCHT, ''));
      await verschiebe(korb, m.name, wurzel, ziel);
      erledigt.push(m.name);
    }
  } catch (err) {
    hinweisEl.textContent = t('libMoveFailed', [err.message]);
    hinweisEl.hidden = false;
  } finally {
    const weg = new Set(erledigt);
    modelle = modelle.filter((m) => !weg.has(m.name));
    for (const n of erledigt) markiert.delete(n);
    knopf.disabled = false;
    zeichne();
    if (!modelle.length) {
      hinweisEl.textContent = t('libTrashNothing');
      hinweisEl.hidden = false;
    }
  }
});

// --- Verschieben (wie auf der Modellseite, model.js) -----------------------

function heute() {
  const d = new Date();
  const zwei = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

async function gibtEs(ordner, name) {
  try { await ordner.getDirectoryHandle(name); return true; } catch { return false; }
}

async function freierName(ordner, wunsch) {
  let name = wunsch;
  for (let n = 2; await gibtEs(ordner, name); n++) name = `${wunsch}-${n}`;
  return name;
}

// Ordner lassen sich nicht verschieben, einzelne Dateien schon: Jede Datei
// wird in den neuen Ordner umgehaengt (move), und wo das nicht geht, kopiert.
// Danach ist der alte Ordner leer und wird entfernt.
async function verschiebe(vonEltern, name, nachEltern, neuerName) {
  const quelle = await vonEltern.getDirectoryHandle(name);
  const ziel = await nachEltern.getDirectoryHandle(neuerName, { create: true });
  let umhaengen = typeof FileSystemFileHandle.prototype.move === 'function';

  const gehe = async (von, nach) => {
    for await (const [kind, eintrag] of von.entries()) {
      if (eintrag.kind === 'directory') {
        await gehe(eintrag, await nach.getDirectoryHandle(kind, { create: true }));
        continue;
      }
      if (umhaengen) {
        try { await eintrag.move(nach, kind); continue; }
        catch { umhaengen = false; }
      }
      const strom = await (await nach.getFileHandle(kind, { create: true })).createWritable();
      await (await eintrag.getFile()).stream().pipeTo(strom);
    }
  };

  await gehe(quelle, ziel);
  await vonEltern.removeEntry(name, { recursive: true });
}

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

// Sortierung als Segment-Schalter. Die Auswahlliste bleibt (versteckt) die
// Quelle des Werts - der Schalter setzt sie nur und meldet die Aenderung.
(() => {
  const segment = document.getElementById('sortSegment');
  segment.setAttribute('aria-label', t('libSort'));
  const schieber = document.createElement('span');
  schieber.className = 'schieber';
  segment.appendChild(schieber);
  const knoepfe = [...sortEl.options].map((o) => {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'wahl';
    k.textContent = o.textContent;
    k.addEventListener('click', () => {
      if (sortEl.value === o.value) return;
      sortEl.value = o.value;
      sortEl.dispatchEvent(new Event('input'));
      setze();
    });
    segment.appendChild(k);
    return [o.value, k];
  });
  const setze = () => {
    for (const [wert, k] of knoepfe) {
      const an = wert === sortEl.value;
      k.setAttribute('aria-pressed', String(an));
      if (an) { schieber.style.left = k.offsetLeft + 'px'; schieber.style.width = k.offsetWidth + 'px'; }
    }
  };
  setze();
  // Schriften koennen nachladen und die Breiten aendern.
  document.fonts?.ready.then(setze);
  addEventListener('resize', setze);
})();

// Eigenes x zum Leeren der Suche - das von Chrome passt nicht zur Pille.
const suchLeerenEl = document.getElementById('suchLeeren');
sucheEl.addEventListener('input', () => { suchLeerenEl.hidden = !sucheEl.value; });
suchLeerenEl.addEventListener('click', () => {
  sucheEl.value = '';
  suchLeerenEl.hidden = true;
  zeichne();
  sucheEl.focus();
});

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
