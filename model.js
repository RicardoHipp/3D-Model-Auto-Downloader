// Modellseite: zeigt alle Dateien eines Modells mit Vorschaubild und
// stellt die ausgewählte groß dar. Ersetzt das frühere Detailfenster in
// "Meine Modelle" - dort war weder Platz für Bilder noch für den Betrachter.
//
// Aufruf: model.html?ordner=<Ordnername>[&korb=1]
// Übergeben wird nur der Name: Ordner-Handles lassen sich nicht zwischen
// Seiten reichen, wohl aber der freigegebene Zielordner aus der IndexedDB.

const t = (key, subs) => chrome.i18n.getMessage(key, subs);

for (const el of document.querySelectorAll('[data-i18n]')) {
  const msg = t(el.dataset.i18n);
  if (msg) el.textContent = msg;
}

const parameter = new URLSearchParams(location.search);
const ORDNER = parameter.get('ordner') || '';
const IM_KORB = parameter.get('korb') === '1';
const PAPIERKORB = '_Trash_';
const GELOESCHT = /_deleted-(\d{4}-\d{2}-\d{2})(?:-\d+)?$/;

const BILD_ENDUNGEN = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const NETZ_ENDUNGEN = ['.stl', '.3mf', '.step', '.stp'];
const STEP_ENDUNGEN = ['.step', '.stp'];
// Fuer das Vorschaubild links wird eine STEP-Datei nur bis zu dieser Groesse
// gelesen. Groessere brauchen viele Sekunden - die sollen nicht schon beim
// Durchblaettern anfallen, sondern erst, wenn man die Datei anklickt.
const STEP_BILD_GRENZE = 3 * 1024 * 1024;

// Wie fein eine STEP-Datei in Dreiecke zerlegt wird. Gemessen am Handstreuer
// (8 MB): grob 13.634, Standard 31.196, fein 106.966, sehr fein 478.433
// Dreiecke. Die Zeit waechst dabei weniger als man denkt - das meiste geht
// ins Einlesen, das bei jeder Stufe gleich lang dauert. Die Werte beziehen
// sich auf die Groesse des Modells, nicht auf Millimeter: So passt dieselbe
// Stufe zu einer Schraube wie zu einem Gehaeuse. "Standard" laesst die
// Voreinstellung der Bibliothek gelten.
//
// verhaeltnis: hoechste Abweichung der Dreiecke von der echten Flaeche, als
// Anteil der mittleren Modellgroesse. Daraus rechnet der Regler die Angabe in
// Millimetern aus - der Anhaltspunkt, ob eine Stufe fuer den Druck noch etwas
// bringt. 0,001 ist die Voreinstellung der Bibliothek.
const STEP_STUFEN = [
  { schluessel: 'modelStepCoarse', verhaeltnis: 0.004,
    feinheit: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.004, angularDeflection: 0.8 } },
  { schluessel: 'modelStepNormal', verhaeltnis: 0.001, feinheit: null },
  { schluessel: 'modelStepFine', verhaeltnis: 0.0004,
    feinheit: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0004, angularDeflection: 0.25 } },
  { schluessel: 'modelStepVeryFine', verhaeltnis: 0.00015,
    feinheit: { linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.00015, angularDeflection: 0.12 } }
  // Eine Stufe "ultrafein" (0,00005 / 0,06) gab es kurz: Beim Prusa Spool
  // Bot (45 MB) brauchte sie knapp 7 Minuten und die vollen 4 GB, die
  // WebAssembly hat - Flaechen, fuer die der Speicher nicht reicht, laesst
  // OpenCascade still weg. Fuer den Druck bringt sie nichts mehr.
];
// Jede STEP-Datei oeffnet in "Standard" - eine zuletzt gewaehlte feine
// Stufe wuerde sonst schon das Oeffnen der naechsten Datei verlangsamen.
const STEP_STANDARD = 1;
let stepStufe = STEP_STANDARD;

const dateienEl = document.getElementById('dateien');
const buehneEl  = document.getElementById('buehne');
const mitteEl   = document.getElementById('mitte');
const lageEl    = document.getElementById('lage');
const masseEl   = document.getElementById('masse');
const hinweisEl = document.getElementById('hinweis');
const frageEl   = document.getElementById('frage');

let modellHandle = null;
let dateien = [];
let betrachter = null;
let leinwand = null;
let grossesBild = null;
let bildUrls = [];
// Licht und Farbe gelten für die grosse Ansicht und die Bilder links
// gleichermaßen - deshalb an einer Stelle, bevor irgendwer zeichnet.
let darstellung = {};

// --- Kleinkram ----------------------------------------------------------

function endungVon(name) {
  const punkt = name.lastIndexOf('.');
  return punkt < 0 ? '' : name.slice(punkt).toLowerCase();
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

// Ordnernamen folgen dem Schema "Modellname_Plattform_2026-10-19".
function zerlegeOrdnername(name) {
  const m = name.match(/^(.*)_([^_]+)_(\d{4}-\d{2}-\d{2})$/);
  if (m) return { titel: m[1].replace(/_/g, ' '), quelle: m[2], datum: m[3] };
  const alt = name.match(/^(.*)_von_([^_]+)_(\d{2})\.(\d{2})\.(\d{4})$/);
  if (alt) return { titel: alt[1].replace(/_/g, ' '), quelle: alt[2], datum: `${alt[5]}-${alt[4]}-${alt[3]}` };
  return { titel: name.replace(/_/g, ' '), quelle: '', datum: '' };
}

// pfad: wird als zweite Zeile zum Kopieren angezeigt. Wer den Explorer
// nicht eingerichtet hat, kommt so wenigstens von Hand hin - einfügen und
// Eingabetaste genügt.
function zeigeHinweis(text, bereich = 'explorer', pfad = '') {
  hinweisEl.textContent = '';
  const zeichen = document.createElement('span');
  zeichen.className = 'zeichen';
  zeichen.setAttribute('aria-hidden', 'true');
  zeichen.textContent = '!';
  const inhalt = document.createElement('div');
  inhalt.textContent = text + ' ';
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = t('libExpOpenSettings');
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await chrome.storage.session.set({ optionenBereich: bereich }); } catch {}
    chrome.runtime.openOptionsPage();
  });
  inhalt.appendChild(a);

  if (pfad) {
    const zeile = document.createElement('div');
    zeile.className = 'hinweisPfad';
    const code = document.createElement('code');
    code.textContent = pfad;
    const kopieren = document.createElement('button');
    kopieren.textContent = t('libCopyPath');
    kopieren.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pfad);
        kopieren.textContent = t('libCopied');
        setTimeout(() => { kopieren.textContent = t('libCopyPath'); }, 1600);
      } catch { /* ohne Zwischenablage bleibt der Pfad zum Markieren stehen */ }
    });
    zeile.append(code, kopieren);
    inhalt.appendChild(zeile);
  }

  hinweisEl.append(zeichen, inhalt);
  hinweisEl.hidden = false;
}

// Eigene Rückfrage statt confirm() - Chromes Fenster sieht aus wie eine
// Systemwarnung und lässt sich nicht gestalten.
function frage({ titel, text, ja, gefahr = false }) {
  document.getElementById('frageTitel').textContent = titel;
  document.getElementById('frageText').textContent = text;
  const jaEl = document.getElementById('frageJa');
  const neinEl = document.getElementById('frageNein');
  jaEl.textContent = ja;
  jaEl.className = gefahr ? 'gefahr' : 'wichtig';
  return new Promise((fertig) => {
    const ende = (antwort) => { fertig(antwort); frageEl.close(); };
    jaEl.onclick = () => ende(true);
    neinEl.onclick = () => ende(false);
    frageEl.addEventListener('close', () => fertig(false), { once: true });
    frageEl.showModal();
    neinEl.focus();
  });
}

// --- Dateien einlesen ---------------------------------------------------

async function sammle(handle, pfad = '') {
  const raus = [];
  for await (const [name, eintrag] of handle.entries()) {
    if (EXP_HILFSDATEIEN.includes(name)) continue;
    if (eintrag.kind === 'directory') {
      raus.push(...await sammle(eintrag, pfad + name + '/'));
    } else {
      const datei = await eintrag.getFile();
      // ordner: der Unterordner, in dem die Datei liegt - fuer "Im Explorer
      // oeffnen", das Lebenszeichen des Skripts landet dort.
      raus.push({ name, pfad: pfad + name, groesse: datei.size, handle: eintrag, ordner: handle });
    }
  }
  return raus;
}

async function modellOeffnen() {
  try {
    const { ansicht, exportFormat: format, rendernStandard } =
      await chrome.storage.local.get(['ansicht', 'exportFormat', 'rendernStandard']);
    if (ansicht) darstellung = ansicht;
    // "Rendern" ist ab Werk an - bei neuen Installationen wie beim Update.
    // Einmalig: Schaltet man es danach aus, bleibt es aus.
    if (!rendernStandard) {
      darstellung.rendern = true;
      await chrome.storage.local.set({ rendernStandard: true, ansicht: darstellung });
    }
    if (format === 'stl' || format === '3mf') { exportFormat = format; zeigeFormat(); }
  } catch { /* dann die Voreinstellung aus dem Renderer */ }

  const { state } = await targetDirStatus();
  if (state !== 'granted') {
    mitteEl.textContent = t(state === 'none' ? 'libNoFolder' : 'libNoPermission');
    return;
  }
  const wurzel = await getTargetDir();
  const eltern = IM_KORB ? await wurzel.getDirectoryHandle(PAPIERKORB) : wurzel;
  modellHandle = await eltern.getDirectoryHandle(ORDNER);

  const geloescht = ORDNER.match(GELOESCHT);
  const { titel, quelle, datum } = zerlegeOrdnername(
    geloescht ? ORDNER.slice(0, geloescht.index) : ORDNER);

  document.title = titel + ' – ' + t('appName');
  document.getElementById('titel').textContent = titel;
  const quelleEl = document.getElementById('quelle');
  if (quelle) {
    quelleEl.textContent = quelle;
    quelleEl.className = 'quelle ' + quelle;
    quelleEl.hidden = false;
  }
  document.getElementById('datum').textContent = geloescht
    ? t('libDeletedOn', [formatDatum(geloescht[1])])
    : formatDatum(datum);

  dateien = (await sammle(modellHandle)).sort((a, b) => a.pfad.localeCompare(b.pfad));
  const gesamt = dateien.reduce((s, d) => s + d.groesse, 0);
  document.getElementById('umfang').textContent =
    t('libFileCount', [String(dateien.length)]) + ' · ' + formatGroesse(gesamt);

  await zeigeHerkunft();
  zeigeTags();
  zeichneListe();

  // Gleich etwas zeigen: die Beschreibung, wenn es eine info.txt gibt -
  // sonst das erste Netz, sonst das erste Bild.
  if (herkunft) { zeigeDetails(); return; }
  // Nie von selbst: STEP-Dateien (lesen kann ueber eine Minute dauern) und
  // die eigenen Exporte in "Einzelteile". Dateien direkt im Modellordner
  // gehen Unterordnern vor. Findet sich nichts, das Vorschaubild.
  const tiefe = (d) => d.pfad.split('/').length;
  const zuerst = dateien
    .filter((d) => NETZ_ENDUNGEN.includes(endungVon(d.name))
                && !STEP_ENDUNGEN.includes(endungVon(d.name))
                && !d.pfad.startsWith(TEILE_ORDNER + '/'))
    .sort((a, b) => tiefe(a) - tiefe(b))[0]
    || vorschauDatei();
  if (zuerst) waehle(zuerst);
}

// --- Herkunft aus info.txt ----------------------------------------------
//
// Die Datei schreibt die Erweiterung beim Herunterladen neben das Modell.
// Aufbau wie ein Briefkopf: "Schluessel: Wert" je Zeile, Zeilen mit # sind
// Erläuterung, nach der ersten Leerzeile folgt freier Text. Dieser Teil ist
// für die Beschreibung der Website gedacht; steht dort etwas, zeigen wir es.
function zerlegeInfo(text) {
  const zeilen = text.replace(/^﻿/, '').split(/\r?\n/);
  const kopf = {};
  let i = 0;
  for (; i < zeilen.length; i++) {
    const zeile = zeilen[i];
    if (zeile.startsWith('#')) continue;
    // Die Leerzeile trennt Kopf und Text - aber erst, wenn der Kopf begonnen hat.
    if (!zeile.trim()) { if (Object.keys(kopf).length) break; continue; }
    const doppel = zeile.indexOf(':');
    if (doppel < 0) continue;
    kopf[zeile.slice(0, doppel).trim().toLowerCase()] = zeile.slice(doppel + 1).trim();
  }
  return { kopf, beschreibung: zeilen.slice(i + 1).join('\n').trim() };
}

// Inhalt der info.txt, sobald gelesen - fuer den Eintrag "Beschreibung"
// oben in der Dateiliste.
let herkunft = null;

async function zeigeHerkunft() {
  const adresseEl = document.getElementById('adresse');
  try {
    const datei = await (await modellHandle.getFileHandle('info.txt')).getFile();
    const { kopf, beschreibung } = zerlegeInfo(await datei.text());
    herkunft = { kopf, beschreibung };

    const adresse = kopf['adresse'] || '';
    if (/^https?:\/\//i.test(adresse)) {
      adresseEl.href = adresse;
      // Der Name der Plattform sagt mehr als der Gastgebername, und die
      // vollständige Adresse ist oft eine halbe Zeile lang - die steht im
      // Tooltip.
      const wo = kopf['plattform'] || new URL(adresse).hostname.replace(/^www\./, '');
      adresseEl.textContent = t('modelOpenSource', [wo]);
      adresseEl.title = adresse;
      adresseEl.hidden = false;
    }
  } catch { /* ohne info.txt bleibt die Zeile, wie sie ist */ }
}

// --- Eigene Tags ---------------------------------------------------------
//
// Stehen in der info.txt (siehe tags.js) und werden bei jeder Aenderung
// sofort dorthin geschrieben. Der Zwischenspeicher der Bibliothek wird gleich
// mitgezogen, damit sie beim Zurueckgehen schon den neuen Stand zeigt.
// Im Papierkorb nicht - dort wird nichts mehr geordnet.
let modellTags = [];
let bekannteTags = [];

function zeigeTags() {
  if (IM_KORB) return;
  const zeile = document.getElementById('tags');
  const fehlerEl = document.getElementById('tagsFehler');
  modellTags = tagsEinmalig(String(herkunft?.kopf['tags'] || '').split(','));
  zeile.hidden = false;

  const speichere = async (tags) => {
    fehlerEl.hidden = true;
    try {
      const titel = herkunft?.kopf['titel'] || document.getElementById('titel').textContent;
      const zeit = await schreibeTags(modellHandle, tags, titel);
      modellTags = tags;
      const eintrag = await bibHole(ORDNER);
      if (eintrag) {
        eintrag.tags = tags;
        eintrag.infoZeit = zeit;
        await bibSchreibe([eintrag]);
      }
    } catch (err) {
      fehlerEl.textContent = t('libTagError', [err.message]);
      fehlerEl.hidden = false;
    }
  };

  const eingabe = tagEingabe(document.getElementById('tagsEingabe'), {
    stand: () => modellTags.map((tag) => ({ tag, teilweise: false })),
    vorschlaege: () => bekannteTags,
    hinzu: (tag) => hatTag(modellTags, tag) ? null : speichere([...modellTags, tag]),
    weg: (tag) => speichere(modellTags.filter((x) => tagSchluessel(x) !== tagSchluessel(tag))),
    vorschlagOrt: document.getElementById('tagsVorschlaege')
  });

  // Vorschlaege: alle Tags, die die Bibliothek kennt.
  bibAlle().then((alle) => {
    const formen = new Map();
    for (const m of alle) for (const tag of m.tags || []) {
      if (!formen.has(tagSchluessel(tag))) formen.set(tagSchluessel(tag), tag);
    }
    bekannteTags = [...formen.values()].sort((a, b) => a.localeCompare(b, 'de'));
    // Neu zeichnen fuer die Vorschlagsliste - nicht, waehrend jemand tippt.
    if (!zeile.contains(document.activeElement)) eingabe.zeichne();
  });
}

// --- Liste links --------------------------------------------------------

// Unterordner stehen als eigene, zuklappbare Gruppen in der Liste - wie im
// Explorer: erst die Ordner, dann die Dateien. Zu Beginn sind sie
// zugeklappt; welche offen sind, merkt sich die Seite, damit ein neues
// Zeichnen der Liste (etwa nach dem Export von Einzelteilen) sie nicht
// wieder schliesst.
const offeneOrdner = new Set();

// Die Datei, die gerade auf der Buehne steht (null bei der Beschreibung).
let gezeigteDatei = null;

function zeichneListe() {
  dateienEl.textContent = '';
  if (herkunft) dateienEl.appendChild(detailsEintrag());
  const wurzel = { ordner: new Map(), dateien: [] };
  for (const d of dateien) {
    // Die info.txt steckt im Eintrag "Beschreibung" - als Datei noch einmal
    // daneben waere sie nur doppelt.
    if (herkunft && d.pfad === 'info.txt') continue;
    const stufen = d.pfad.split('/');
    stufen.pop();
    let knoten = wurzel;
    let weg = '';
    for (const name of stufen) {
      weg += name + '/';
      if (!knoten.ordner.has(name)) {
        knoten.ordner.set(name, { name, pfad: weg, ordner: new Map(), dateien: [] });
      }
      knoten = knoten.ordner.get(name);
    }
    knoten.dateien.push(d);
  }
  zeichneKnoten(dateienEl, wurzel);
}

function zeichneKnoten(ziel, knoten) {
  const ordner = [...knoten.ordner.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const o of ordner) ziel.appendChild(ordnerEintrag(o));
  for (const d of knoten.dateien) ziel.appendChild(dateiEintrag(d));
}

function anzahlIn(knoten) {
  let n = knoten.dateien.length;
  for (const o of knoten.ordner.values()) n += anzahlIn(o);
  return n;
}

function ordnerEintrag(o) {
  const gruppe = document.createElement('div');
  gruppe.className = 'ordner';

  const kopf = document.createElement('button');
  kopf.className = 'ordnerKopf';
  kopf.title = o.pfad.replace(/\/$/, '').replace(/\//g, '\\');
  const pfeil = document.createElement('span');
  pfeil.className = 'pfeil';
  pfeil.textContent = '❯';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = o.name;
  const anzahl = document.createElement('span');
  anzahl.className = 'anzahl';
  anzahl.textContent = String(anzahlIn(o));
  kopf.append(pfeil, name, anzahl);

  const inhalt = document.createElement('div');
  inhalt.className = 'ordnerInhalt';
  inhalt.__ordner = o.pfad;
  zeichneKnoten(inhalt, o);

  const offen = offeneOrdner.has(o.pfad);
  kopf.setAttribute('aria-expanded', String(offen));
  inhalt.hidden = !offen;
  kopf.addEventListener('click', () => setzeOrdnerOffen(inhalt, inhalt.hidden));

  gruppe.append(kopf, inhalt);
  return gruppe;
}

function setzeOrdnerOffen(inhalt, offen) {
  inhalt.hidden = !offen;
  inhalt.previousElementSibling.setAttribute('aria-expanded', String(offen));
  if (offen) offeneOrdner.add(inhalt.__ordner); else offeneOrdner.delete(inhalt.__ordner);
}

// Liegt die gewaehlte Datei in einem zugeklappten Ordner, wird er geoeffnet -
// sonst waere die Markierung unsichtbar.
function oeffneOrdnerVon(d) {
  for (let el = d.knopf?.parentElement; el && el !== dateienEl; el = el.parentElement) {
    if (el.classList.contains('ordnerInhalt') && el.hidden) setzeOrdnerOffen(el, true);
  }
}

// --- Datei aus der Liste herausziehen ---------------------------------------
//
// Chrome laesst eine Datei aus der Seite auf den Desktop oder in einen
// Explorer-Ordner ziehen, wenn beim Ziehen "DownloadURL" gesetzt ist
// ("Typ:Name:Adresse"). Das muss im dragstart sofort geschehen - die Datei
// selbst zu holen geht aber nur asynchron. Deshalb schon beim Darueberfahren
// eine Blob-Adresse anlegen; ein File aus dem Ordner-Handle wird dabei nicht
// in den Speicher kopiert, er verweist nur auf die Datei auf der Platte.
//
// Direkt in einen Slicer geht es nicht: Chrome reicht eine "virtuelle"
// Datei weiter, die erst beim Ablegen entsteht. Der Explorer kann damit
// umgehen, OrcaSlicer nimmt nur echte Dateipfade an (wxFileDropTarget) -
// und die darf eine Seite nicht mitgeben. Ausprobiert, auch mit file:///.
const ziehAdressen = new Map();

function ziehbar(knopf, d) {
  knopf.draggable = true;
  const vorbereiten = async () => {
    if (ziehAdressen.has(d.pfad) || !d.handle) return;
    ziehAdressen.set(d.pfad, null);
    try {
      ziehAdressen.set(d.pfad, URL.createObjectURL(await d.handle.getFile()));
    } catch {
      ziehAdressen.delete(d.pfad);
    }
  };
  knopf.addEventListener('pointerenter', vorbereiten);
  knopf.addEventListener('dragstart', (e) => {
    const adresse = ziehAdressen.get(d.pfad);
    if (!adresse) { e.preventDefault(); vorbereiten(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `application/octet-stream:${d.name}:${adresse}`);
  });
}

// Eine Datei in den Papierkorb (papierkorb.js). Von dort kommt sie beim
// Wiederherstellen in dieses Modell zurueck.
async function dateiLoeschen(liste) {
  if (!liste.length) return;
  if (!await frage({
    titel: t('modelDeleteFile'),
    text: liste.length === 1
      ? t('modelDeleteFileConfirm', [liste[0].name])
      : t('modelDeleteFilesConfirm', [String(liste.length)]),
    ja: t('libDelete')
  })) return;
  const warGezeigt = liste.includes(gezeigteDatei);
  try {
    zeigeBalken(true);
    const wurzel = await getTargetDir();
    for (const d of liste) {
      // Das kleine Bild aus der Liste mitnehmen - im Papierkorb der
      // Uebersicht erkennt man die Datei daran.
      let vorschau = null;
      const bild = d.bildFach?.querySelector('img');
      if (bild) { try { vorschau = await (await fetch(bild.src)).blob(); } catch { /* ohne Bild */ } }
      await dateiInPapierkorb(wurzel, ORDNER, d.pfad, d.handle, d.ordner, vorschau);
      netzSpeicher.delete(speicherSchluessel(d));
    }
  } catch (err) {
    zeigeHinweis(t('libMoveFailed', [err.message]), 'zielordner');
  }
  try {
    markierteDateien.clear();
    dateien = (await sammle(modellHandle)).sort((a, b) => a.pfad.localeCompare(b.pfad));
    zeichneListe();
    if (warGezeigt) {
      if (detailsKnopf) {
        zeigeDetails();
      } else {
        ++wahlNummer;
        gezeigteDatei = null;
        if (leinwand) leinwand.hidden = true;
        if (grossesBild) grossesBild.hidden = true;
        pdfAusblenden();
        for (const el of [lageEl, masseEl, feinheitEl, teileFach, modusKnopf, speichernOben, stepWarnungEl, renderKnopf, filamentFach]) el.hidden = true;
        sucheTeile(null);
        dateienEl.hidden = false;
        teileModus = false;
        mitteEl.textContent = t('modelPick');
        mitteEl.hidden = false;
      }
    }
  } finally {
    zeigeBalken(false);
  }
}

// --- Mehrere Dateien markieren (wie im Windows-Explorer) ---------------------
//
// Strg + Klick nimmt eine Datei in die Markierung auf oder heraus, Shift +
// Klick markiert alles von der zuletzt angeklickten bis zu dieser - in der
// sichtbaren Reihenfolge. Die grosse Ansicht bleibt dabei, wo sie ist; erst
// ein einfacher Klick oeffnet eine Datei und hebt die Markierung auf.
// Entf oder das x an einer markierten Datei loescht alle markierten, Esc
// hebt die Markierung auf.
const markierteDateien = new Set();
let ankerDatei = null;

function zeigeMarkierung() {
  for (const d of dateien) d.knopf?.classList.toggle('markiert', markierteDateien.has(d));
}

function sichtbareDateien() {
  return [...dateienEl.querySelectorAll('.datei')]
    .filter((k) => k.offsetParent !== null && k.__datei)
    .map((k) => k.__datei);
}

function klickAufDatei(d, e) {
  if (e.ctrlKey || e.metaKey) {
    if (markierteDateien.has(d)) markierteDateien.delete(d); else markierteDateien.add(d);
    ankerDatei = d;
    zeigeMarkierung();
    return;
  }
  if (e.shiftKey && ankerDatei) {
    const reihe = sichtbareDateien();
    const von = reihe.indexOf(ankerDatei), bis = reihe.indexOf(d);
    if (von >= 0 && bis >= 0) {
      markierteDateien.clear();
      for (let i = Math.min(von, bis); i <= Math.max(von, bis); i++) markierteDateien.add(reihe[i]);
      zeigeMarkierung();
      return;
    }
  }
  markierteDateien.clear();
  zeigeMarkierung();
  ankerDatei = d;
  waehle(d);
}

addEventListener('keydown', (e) => {
  if (frageEl.open || e.target.closest?.('input, textarea, [contenteditable]')) return;
  if (e.key === 'Escape' && markierteDateien.size) {
    markierteDateien.clear();
    zeigeMarkierung();
  } else if (e.key === 'Delete' && markierteDateien.size && !IM_KORB) {
    e.preventDefault();
    dateiLoeschen(sichtbareDateien().filter((d) => markierteDateien.has(d)));
  }
});

function dateiEintrag(d) {
  const knopf = document.createElement('button');
  knopf.className = 'datei';
  knopf.title = d.pfad.replace(/\//g, '\\');
  knopf.setAttribute('aria-current', 'false');

  const bild = document.createElement('div');
  bild.className = 'bild';
  const endung = endungVon(d.name);
  const marke = document.createElement('span');
  marke.className = 'endung';
  marke.textContent = (endung.slice(1) || '?').toUpperCase();
  bild.appendChild(marke);

  const text = document.createElement('div');
  text.className = 'text';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = d.name;
  const groesse = document.createElement('div');
  groesse.className = 'groesse';
  groesse.textContent = formatGroesse(d.groesse);
  text.append(name, groesse);

  knopf.append(bild, text);
  knopf.addEventListener('click', (e) => klickAufDatei(d, e));
  // Shift + Klick soll markieren, nicht Text auswaehlen.
  knopf.addEventListener('mousedown', (e) => { if (e.shiftKey) e.preventDefault(); });
  ziehbar(knopf, d);

  // Kleines x unten rechts: Datei in den Papierkorb. Kein eigener <button> -
  // der Eintrag ist selbst einer, und Knoepfe duerfen nicht ineinander.
  // Im Papierkorb selbst nicht: Dort wird das ganze Modell zurueckgeholt
  // oder geloescht.
  if (!IM_KORB) {
    const weg = document.createElement('span');
    weg.className = 'weg';
    weg.setAttribute('role', 'button');
    weg.tabIndex = 0;
    weg.textContent = '×';
    weg.title = t('modelDeleteFile');
    weg.setAttribute('aria-label', t('modelDeleteFile') + ': ' + d.name);
    // An einer markierten Datei: alle markierten, sonst nur diese.
    const los = (e) => {
      e.stopPropagation(); e.preventDefault();
      dateiLoeschen(markierteDateien.has(d) && markierteDateien.size > 1
        ? sichtbareDateien().filter((x) => markierteDateien.has(x)) : [d]);
    };
    weg.addEventListener('click', los);
    weg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') los(e); });
    knopf.appendChild(weg);
  }

  d.knopf = knopf;
  knopf.__datei = d;
  d.bildFach = bild;
  if (BILD_ENDUNGEN.includes(endung) || NETZ_ENDUNGEN.includes(endung)) {
    // Auch in zugeklappten Ordnern: Der Beobachter meldet den Eintrag erst,
    // wenn er beim Aufklappen sichtbar wird.
    beobachter.observe(knopf);
  }
  return knopf;
}

// Vorschaubilder kosten Zeit - ein 3MF braucht gut eine Viertelsekunde.
// Deshalb erst, wenn der Eintrag in Sicht kommt, und immer nur eines
// gleichzeitig: Sonst kämpfen zwanzig Dateien um dieselbe Grafikkarte.
const beobachter = new IntersectionObserver((eintraege) => {
  for (const e of eintraege) {
    if (!e.isIntersecting) continue;
    beobachter.unobserve(e.target);
    reiheEin(e.target.__datei);
  }
  // Gescrollt wird die Spalte, nicht die Liste darin - sie ist der Bezug
  // für "kommt in Sicht".
}, { root: document.getElementById('dateienFach'), rootMargin: '150px' });

// Zwei Stufen: Was schon im Bildspeicher liegt oder ohnehin ein Bild ist,
// kommt sofort und fuer alle sichtbaren Eintraege zugleich - das kostet nur
// Millisekunden. Nur was fehlt, wird erzeugt, und das eins nach dem anderen
// in einer Warteschlange. Sonst haelt eine neue, grosse Datei weit vorn in
// der Liste alle bekannten Bilder dahinter auf.
const schlange = [];
let arbeitet = false;

function zeigeKleinesBild(d, url) {
  bildUrls.push(url);
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  d.bildFach.replaceChildren(img);
}

async function reiheEin(d) {
  try {
    const url = await bildSofort(d);
    if (url) { zeigeKleinesBild(d, url); return; }
  } catch { /* dann eben erzeugen */ }
  schlange.push(d);
  if (!arbeitet) naechstesBild();
}

async function naechstesBild() {
  arbeitet = true;
  while (schlange.length) {
    const d = schlange.shift();
    try {
      const url = await bildErzeugen(d);
      if (url) zeigeKleinesBild(d, url);
    } catch { /* dann bleibt die Endung stehen */ }
  }
  arbeitet = false;
}

// Schluessel fuer den Bildspeicher (model_bildspeicher.js): welche Datei,
// in welchem Stand. Gezeichnete Bilder haengen ausserdem an den Farb- und
// Lichtreglern - aendern die sich, gilt ein neuer Schluessel.
function bildSchluessel(d, datei, art) {
  const ort = (IM_KORB ? PAPIERKORB + '/' : '') + ORDNER + '/' + d.pfad;
  // Was nur die gerenderte Ansicht betrifft, gehoert nicht dazu: Die Bilder
  // links bleiben ohnehin flach.
  const flach = { ...darstellung };
  for (const feld of NUR_RENDERN) flach[feld] = undefined;
  const zusatz = art === 'gezeichnet' ? '|' + kurzHash(JSON.stringify(flach)) : '';
  // Gezeichnete 3MF-Bilder: Seit einfarbige 3MF ihre hinterlegte Farbe
  // zeigen, gilt ein neuer Schluessel - die alten waren in der eigenen Farbe.
  const stand = art === 'gezeichnet' && /\.3mf$/i.test(d.name) ? 'f' : '';
  return `${ort}|${datei.size}|${datei.lastModified}|${art}${stand}${zusatz}`;
}

function kurzHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// Stufe 1: Bilddateien selbst und alles aus dem Bildspeicher. null, wenn
// das Bild erst erzeugt werden muss.
async function bildSofort(d) {
  const endung = endungVon(d.name);
  const datei = await d.handle.getFile();
  if (BILD_ENDUNGEN.includes(endung)) return URL.createObjectURL(datei);
  const schluessel = endung === '.3mf'
    ? [bildSchluessel(d, datei, 'paket'), bildSchluessel(d, datei, 'gezeichnet')]
    : [bildSchluessel(d, datei, 'gezeichnet')];
  for (const s of schluessel) {
    const gemerkt = await bildAusSpeicher(s);
    if (gemerkt) return URL.createObjectURL(gemerkt);
  }
  return null;
}

// Stufe 2: erzeugen und fuer das naechste Mal merken.
async function bildErzeugen(d) {
  const endung = endungVon(d.name);
  const datei = await d.handle.getFile();

  // Ein 3MF trägt ein fertiges Vorschaubild im Paket - deshalb zeigt auch
  // der Windows-Explorer Modelle an, ohne sie zu zeichnen. Das herauszuholen
  // kostet Millisekunden, während das Netz bei großen Dateien Sekunden
  // braucht: Die Eisbär-Datei bringt 534 MB XML mit.
  if (endung === '.3mf') {
    try {
      const zip = liesZip(await datei.arrayBuffer());
      const bild = await bild3mf(zip);
      if (bild) {
        bildInSpeicher(bildSchluessel(d, datei, 'paket'), bild.blob);
        return URL.createObjectURL(bild.blob);
      }
    } catch { /* kein Bild im Paket - dann eben zeichnen */ }
  }

  if (STEP_ENDUNGEN.includes(endung) && d.groesse > STEP_BILD_GRENZE) return null;

  const netze = await netzeVon(d, true);
  if (!netze?.length) return null;
  // Braucht den Betrachter - er bringt Renderer und Umgebung mit.
  const blob = await erzeugeVorschau(netze, 128, darstellung);
  bildInSpeicher(bildSchluessel(d, datei, 'gezeichnet'), blob);
  return URL.createObjectURL(blob);
}

// --- Netze lesen --------------------------------------------------------

// Gelesene Netze bleiben liegen, solange sie ins Budget passen: Wer eine
// Datei anklickt, deren Vorschaubild gerade entstanden ist, soll nicht
// warten, bis sie ein zweites Mal gelesen wurde. Gezählt werden Zahlen,
// nicht Bytes - vier Byte je Zahl, 40 Millionen sind also rund 160 MB.
const NETZ_BUDGET = 40e6;
const netzSpeicher = new Map();
let netzBestand = 0;

function netzGroesse(netze) {
  return netze.reduce((s, n) => s + n.ecken.length + (n.indizes?.length || 0), 0);
}

function merkeNetze(schluessel, netze) {
  const groesse = netzGroesse(netze);
  if (groesse > NETZ_BUDGET) return netze;      // zu groß zum Behalten

  // Älteste zuerst hinaus, bis wieder Platz ist (Map behält die Reihenfolge).
  for (const [alt, inhalt] of netzSpeicher) {
    if (netzBestand + groesse <= NETZ_BUDGET) break;
    netzSpeicher.delete(alt);
    netzBestand -= netzGroesse(inhalt);
  }
  netzSpeicher.set(schluessel, netze);
  netzBestand += groesse;
  return netze;
}

// Bei STEP gehoert die Feinheit zum Schluessel - dieselbe Datei in zwei
// Stufen sind zwei verschiedene Netze.
function speicherSchluessel(d, stufe = stepStufe) {
  return STEP_ENDUNGEN.includes(endungVon(d.name)) ? d.pfad + '|' + stufe : d.pfad;
}

// nurBild: fuer das Vorschaubild links. Bei STEP heisst das: lesen, aber
// nicht im Worker behalten - sonst verdraengt jedes Vorschaubild das Modell,
// das gerade gross zu sehen ist und dessen Feinheit man verstellen will.
// beiFortschritt(abschnitt, anteil): nur bei STEP, siehe stepAuftrag.
async function netzeVon(d, nurBild = false, beiFortschritt = null) {
  // Vorschaubilder immer in "Standard": Fuer 128 Pixel reicht das, und eine
  // rechts eingestellte feine Stufe soll das Blaettern nicht verlangsamen.
  const stufe = nurBild ? STEP_STANDARD : stepStufe;
  const schluessel = speicherSchluessel(d, stufe);
  const gemerkt = netzSpeicher.get(schluessel);
  if (gemerkt) return gemerkt;

  if (STEP_ENDUNGEN.includes(endungVon(d.name))) {
    const feinheit = STEP_STUFEN[stufe].feinheit;
    // Schon geladen? Dann nur neu zerlegen - Bruchteil der Zeit.
    if (!nurBild && stepGehalten === d.pfad) {
      try {
        return merkeNetze(schluessel,
          await stepAuftrag({ art: 'zerlegen', kennung: d.pfad, feinheit }, [], beiFortschritt));
      } catch { /* doch nicht mehr da - dann eben neu einlesen */ }
    }
    const puffer = await (await d.handle.getFile()).arrayBuffer();
    const art = nurBild ? 'bild' : 'laden';
    const netze = await stepAuftrag({ art, kennung: d.pfad, feinheit, daten: puffer }, [puffer],
      nurBild ? null : beiFortschritt);
    if (art === 'laden') stepGehalten = d.pfad;
    return merkeNetze(schluessel, netze);
  }

  const puffer = await (await d.handle.getFile()).arrayBuffer();
  const netze = await liesNebenher(endungVon(d.name) === '.3mf' ? '3mf' : 'stl', puffer, nurBild);
  return merkeNetze(d.pfad, netze);
}

// --- 3MF und STL nebenher lesen (model_lesen_worker.js) -------------------
//
// Zwei Arbeiter: einer fuer die grosse Ansicht, einer fuer die Bilder links.
// So wartet die angeklickte Datei nicht hinter einem Vorschaubild, und
// umgekehrt. Klickt man waehrend des Lesens eine andere Datei an, wird der
// Arbeiter der Ansicht beendet und neu gestartet - das alte Ergebnis wuerde
// ohnehin nicht mehr gebraucht, und die neue Datei kaeme sonst erst danach.
const leser = { ansicht: null, bilder: null };
let leseNummer = 0;

// Gegenstueck zu packeCodes im Arbeiter: wieder ein Feld je Dreieck, als
// Ausschnitte desselben Speichers (kein Kopieren).
function entpackeCodes(netze) {
  for (const n of netze) {
    const p = n.teilungCode;
    if (!p || Array.isArray(p)) continue;
    const codes = new Array(p.anfang.length - 1);
    for (let i = 0; i < codes.length; i++) codes[i] = p.alle.subarray(p.anfang[i], p.anfang[i + 1]);
    n.teilungCode = codes;
  }
  return netze;
}

function neuerLeser() {
  const l = { worker: new Worker('model_lesen_worker.js'), wartende: new Map() };
  l.worker.onmessage = ({ data }) => {
    const w = l.wartende.get(data.nummer);
    if (!w) return;
    l.wartende.delete(data.nummer);
    if (data.fehler) w.fehler(new Error(data.fehler));
    else w.fertig(Object.assign(entpackeCodes(data.netze), data.zusatz));
  };
  l.worker.onerror = (e) => {
    for (const w of l.wartende.values()) w.fehler(new Error(e.message || 'Fehler'));
    l.wartende.clear();
  };
  return l;
}

function liesNebenher(art, puffer, nurBild) {
  const welcher = nurBild ? 'bilder' : 'ansicht';
  let l = leser[welcher];
  if (!nurBild && l?.wartende.size) {
    l.worker.terminate();
    for (const w of l.wartende.values()) w.fehler(new Error('abgebrochen'));
    l = null;
  }
  if (!l) l = leser[welcher] = neuerLeser();
  const nummer = ++leseNummer;
  return new Promise((fertig, fehler) => {
    l.wartende.set(nummer, { fertig, fehler });
    l.worker.postMessage({ nummer, art, puffer }, [puffer]);
  });
}

// --- STEP ----------------------------------------------------------------
//
// Gelesen wird in model_step_worker.js; hier kommt nur das Ergebnis an. Der
// Worker bleibt bestehen, damit der Kern nicht fuer jede Datei neu startet.
// Mehrere Auftraege laufen dort nacheinander ab - jeder bekommt eine Nummer,
// unter der seine Antwort zurueckkommt.
let stepWorker = null;
let stepNummer = 0;
const stepWartende = new Map();
// Pfad der Datei, deren Modell der Worker gerade haelt.
let stepGehalten = null;
// Wie viele Threads der Worker zum Zerlegen nutzt - und wie viele der
// Rechner hat. Kommt mit jeder Antwort.
let stepThreads = null;

// Zaehler beim Zerlegen in Dreiecke, als Int32Array auf dem gemeinsamen
// Speicher des Workers - nur in der Thread-Fassung. Felder wie in
// BRepMesh_Statistik.hxx (vendor/occt-import-js-quelle/aendern.py).
let stepZaehler = null;
const Z_LAUF = 0, Z_GESAMT = 1, Z_FERTIG = 2, Z_AKTIV = 3, Z_DURCHGANG = 4,
      Z_SCHRITT = 5, Z_SCHRITT_FERTIG = 6, Z_SCHRITT_GESAMT = 7, Z_FORM = 9, Z_FORMEN = 10;

// auftrag: { art: 'laden' | 'zerlegen' | 'bild', kennung, feinheit, daten? }
// beiFortschritt(abschnitt, anteil, zaehler): waehrend der Arbeit, siehe
// Worker. zaehler gibt es nur beim Zerlegen und nur mit Threads - dann
// liest die Seite viermal je Sekunde selbst nach.
function stepAuftrag(auftrag, weiter = [], beiFortschritt = null) {
  if (!stepWorker) {
    stepWorker = new Worker('model_step_worker.js');
    stepWorker.onmessage = (e) => {
      if (e.data.zaehler) {
        const { puffer, versatz, laenge } = e.data.zaehler;
        stepZaehler = new Int32Array(puffer, versatz, laenge);
        return;
      }
      const warte = stepWartende.get(e.data.nummer);
      if (!warte) return;
      if (e.data.lauf !== undefined) {
        warte.startLauf = e.data.lauf;
        return;
      }
      if (e.data.fortschritt) {
        // Laufen die Zaehler, sagen sie mehr als die Prozentzahl.
        if (warte.mitZaehlern && e.data.fortschritt.abschnitt === 3) return;
        warte.beiFortschritt?.(e.data.fortschritt.abschnitt, e.data.fortschritt.anteil, null);
        return;
      }
      stepWartende.delete(e.data.nummer);
      clearInterval(warte.uhr);
      if (e.data.threads) stepThreads = e.data.threads;
      if (e.data.fehler) warte.nein(new Error(e.data.fehler));
      else warte.ja({ netze: e.data.netze, warnungen: e.data.warnungen || null });
    };
  }
  const nummer = ++stepNummer;
  return new Promise((ja, nein) => {
    const warte = { ja, nein, beiFortschritt, startLauf: undefined, mitZaehlern: false, uhr: 0 };
    if (beiFortschritt) {
      warte.uhr = setInterval(() => {
        const z = stepZaehler;
        // Erst wenn dieser Auftrag zu zerlegen begonnen hat.
        if (!z || warte.startLauf === undefined || Atomics.load(z, Z_LAUF) === warte.startLauf) return;
        warte.mitZaehlern = true;
        const stand = {
          gesamt: Atomics.load(z, Z_GESAMT),
          fertig: Atomics.load(z, Z_FERTIG),
          aktiv: Atomics.load(z, Z_AKTIV),
          durchgang: Atomics.load(z, Z_DURCHGANG),
          schritt: Atomics.load(z, Z_SCHRITT),
          schrittFertig: Atomics.load(z, Z_SCHRITT_FERTIG),
          schrittGesamt: Atomics.load(z, Z_SCHRITT_GESAMT),
          form: Atomics.load(z, Z_FORM),
          formen: Atomics.load(z, Z_FORMEN)
        };
        // Flaechen werden je Form gezaehlt; der Balken laeuft ueber alle.
        const inForm = stand.gesamt ? Math.min(1, stand.fertig / stand.gesamt) : 0;
        const anteil = stand.formen > 0
          ? (Math.max(0, stand.form - 1) + inForm) / stand.formen : inForm;
        beiFortschritt(3, anteil, stand);
      }, 250);
    }
    stepWartende.set(nummer, warte);
    stepWorker.postMessage(Object.assign({ nummer }, auftrag), weiter);
  }).then(({ netze, warnungen }) => Object.assign(stepAlsNetze(netze), { warnungen }));
}

// Jedes Netz einer STEP-Datei ist ein eigener Koerper - also ein Teil, mit
// dem Namen aus dem CAD-Programm. Farben gibt es je Koerper; die laufen ueber
// denselben Weg wie die Filamentfarben eines 3MF: eine Farbtafel und je Netz
// die Nummer darin. Sind alle gleich (meist ein CAD-Grau), zeigt der
// Betrachter wie sonst die eigene Farbe.
function stepAlsNetze(roh) {
  const tafel = [];
  const netze = roh.map((n, i) => {
    let nummer = 1;
    if (n.farbe) {
      const hex = '#' + n.farbe.map((w) =>
        Math.round(Math.min(1, Math.max(0, w)) * 255).toString(16).padStart(2, '0')).join('');
      if (!tafel.includes(hex)) tafel.push(hex);
      nummer = tafel.indexOf(hex) + 1;
    }
    return { ecken: n.ecken, indizes: n.indizes, teil: i, extruder: nummer, dreieckFarbe: null };
  });
  netze.teile = roh.map((n, i) => ({ nummer: i, name: n.name || '' }));
  netze.farbtafel = tafel;
  return netze;
}

// --- Große Darstellung --------------------------------------------------

function zeigeBalken(an) {
  const leiste = document.getElementById('fortschritt');
  leiste.hidden = !an;
  document.getElementById('balken').style.width = an ? '35%' : '0';
  standZuletzt = { text: '', seit: Date.now() };
  leiste.classList.remove('wartet');
  clearInterval(standUhr);
  standUhr = an ? setInterval(pruefeStillstand, 1000) : 0;
}

// Kommt einige Sekunden lang nichts Neues, gleitet ein Schimmer ueber den
// Balken: Es wird gerechnet, nur ohne Zwischenstand. Ein ausgedachter Stand
// waere schlechter als dieser ehrliche Hinweis.
let standZuletzt = { text: '', seit: 0 };
let standUhr = 0;
function merkeStand(text) {
  if (text === standZuletzt.text) return;
  standZuletzt = { text, seit: Date.now() };
  document.getElementById('fortschritt').classList.remove('wartet');
}
function pruefeStillstand() {
  const leiste = document.getElementById('fortschritt');
  if (leiste.hidden) { clearInterval(standUhr); standUhr = 0; leiste.classList.remove('wartet'); return; }
  leiste.classList.toggle('wartet', Date.now() - standZuletzt.seit > 4000);
}

// Text zum Stand eines STEP-Auftrags. Mit Zaehlern (Abschnitt 3, Thread-
// Fassung) steht dort, was wirklich passiert: wie viele Flaechen fertig sind,
// und rechnet nur noch eine, woran sie gerade ist.
function stepStandText(abschnitt, anteil, z) {
  if (abschnitt !== 3 || !z) {
    return t('modelStepPhase', [abschnittName(abschnitt), String(Math.round(anteil * 100))]);
  }
  const zahl = (n) => n.toLocaleString();
  const teile = [];
  if (z.formen > 1) teile.push(t('modelStepShape', [zahl(z.form), zahl(z.formen)]));
  if (z.gesamt > 0) teile.push(t('modelStepFaces', [zahl(z.fertig), zahl(z.gesamt)]));
  if (z.aktiv === 0 && z.schritt === 4) {
    teile.push(t('modelStepEdges'));
  } else if (z.aktiv === 1) {
    const durchgang = z.durchgang === 0 ? t('modelStepFirstMesh') : t('modelStepPass', [String(z.durchgang)]);
    const prozent = z.schrittGesamt > 0
      ? String(Math.min(100, Math.floor(z.schrittFertig / z.schrittGesamt * 100))) : '0';
    const schritt = z.schritt === 1 ? t('modelStepInsert', [prozent])
      : z.schritt === 2 ? t('modelStepCheck', [prozent])
      : z.schritt === 3 ? t('modelStepBorders', [prozent])
      : z.schritt === 5 ? t('modelStepSurfacePoints')
      : z.schritt === 6 ? t('modelStepClassify', [prozent])
      : z.schritt === 7 ? t('modelStepCleanup') : '';
    teile.push(schritt ? durchgang + ', ' + schritt : durchgang);
  } else if (z.aktiv > 1) {
    teile.push(t('modelStepActive', [String(z.aktiv)]));
  }
  return teile.length ? abschnittName(3) + ' – ' + teile.join(' · ') : abschnittName(3);
}

// Gesamtstand des Ladens aus Abschnitt und Anteil. Die drei Abschnitte
// dauern unterschiedlich lange; die Gewichte sind an echten Dateien
// gemessen, damit der Balken einigermassen gleichmaessig laeuft. Das Lesen
// der Datei ist schnell (7-12 %), das Umwandeln in Formen dauert am
// laengsten (39-73 %), das Zerlegen je nach Modell 15-47 %.
const STEP_GEWICHTE = [0, 0.10, 0.65, 0.25];
function stepGesamt(abschnitt, anteil, nurZerlegen) {
  if (nurZerlegen) return anteil;
  let vorher = 0;
  for (let i = 1; i < abschnitt; i++) vorher += STEP_GEWICHTE[i];
  return vorher + STEP_GEWICHTE[abschnitt] * anteil;
}

function zeigeStand(anteil) {
  document.getElementById('fortschritt').hidden = false;
  if (!standUhr) standUhr = setInterval(pruefeStillstand, 1000);
  document.getElementById('balken').style.width = Math.round(anteil * 100) + '%';
}

function abschnittName(abschnitt) {
  return t(['', 'modelStepPhaseRead', 'modelStepPhaseShapes', 'modelStepPhaseMesh'][abschnitt] || 'modelStepPhaseRead');
}

// Abmessungen des Hüllquaders in Breite × Tiefe × Höhe. STL kennt keine
// Einheit, 3MF benutzt in aller Regel Millimeter - und so legen es die
// Slicer auch ab. Bei sehr kleinen Teilen eine Nachkommastelle mehr,
// sonst stünde dort "0 × 0 × 0 mm".
function zeigeMasse(groesse) {
  if (!groesse || !groesse.every(Number.isFinite)) return;
  const stellen = Math.max(...groesse) < 10 ? 2 : 1;
  // Nicht t nennen: So heißt die Funktion für die Texte.
  const [breite, tiefe, hoehe] = groesse.map((w) =>
    w.toLocaleString(undefined, { minimumFractionDigits: stellen,
                                  maximumFractionDigits: stellen }));
  masseEl.textContent = t('modelSize', [breite, tiefe, hoehe]);
  masseEl.hidden = false;
}

// --- Teile einer 3MF-Datei ----------------------------------------------
//
// Ein 3MF kann mehrere Objekte enthalten - eine ganze Druckplatte voll. Die
// Liste links macht sie einzeln greifbar: anklicken hebt hervor, und von
// dort lässt sich jedes Teil als STL herausschreiben.
const TEILE_ORDNER = 'Einzelteile';

const teileFach  = document.getElementById('teileFach');
const modusKnopf = document.getElementById('teileModus');
const stlKnopf   = document.getElementById('alsStl');
const speichernOben = document.getElementById('speichernOben');
const teileListe = document.getElementById('teileListe');
const teilKnopf  = document.getElementById('teilSpeichern');
const alleKnopf  = document.getElementById('alleSpeichern');
const teilInfo   = document.getElementById('teilInfo');

let aktuelleNetze = [];
let aktuelleTeile = [];
let gewaehltesTeil = null;
let aktuelleDatei = null;
let teileModus = false;
let zerlegbar = false;

// Die Teileansicht tritt an die Stelle der Dateiliste, statt sich darunter
// zu schieben: In der Spalte ist für beides kein Platz, und wer Teile
// auswählt, sucht gerade keine Datei.
function setzeTeileModus(an) {
  teileModus = !!an && aktuelleTeile.length > 1;
  dateienEl.hidden = teileModus;
  teileFach.hidden = !teileModus;
  modusKnopf.setAttribute('aria-pressed', String(teileModus));
  modusKnopf.textContent = t(teileModus ? 'modelSplitOff' : 'modelSplit');
  // In der Teileansicht speichert das Teile-Fach links, mit eigenem
  // Umschalter. Der Knopf oben (ganzes Modell) wuerde dort nur verwirren -
  // er kommt beim Verlassen wieder.
  speichernOben.hidden = teileModus || obenFormat === undefined;
  if (!teileModus) {
    // Zurueck in der Dateiansicht ist wieder das ganze Modell zu sehen.
    if (betrachter) betrachter.ausgeblendet.clear();
    aktualisiereSicht();
    waehleTeil(null);
  }
}

function netzeVonTeil(nr) {
  return aktuelleNetze.filter((n) => n.teil === nr);
}

function masseVon(netze) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { ecken } of netze) {
    for (let i = 0; i < ecken.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (ecken[i + k] < min[k]) min[k] = ecken[i + k];
        if (ecken[i + k] > max[k]) max[k] = ecken[i + k];
      }
    }
  }
  return Number.isFinite(min[0]) ? [0, 1, 2].map((k) => max[k] - min[k]) : null;
}

function teilBezeichnung(teil) {
  return teil.name || t('modelPartN', [String(teil.nummer + 1)]);
}

function zeigeTeile(datei, netze) {
  aktuelleDatei = datei;
  aktuelleNetze = netze;
  aktuelleTeile = netze.teile || [];
  gewaehltesTeil = null;
  teilKnopf.disabled = true;
  teilInfo.hidden = true;
  teileListe.textContent = '';
  teileFach.hidden = true;
  dateienEl.hidden = false;
  teileModus = false;
  modusKnopf.setAttribute('aria-pressed', 'false');
  modusKnopf.textContent = t('modelSplit');

  // Ein 3MF nennt seine Teile selbst. Ein STL ist nur ein Haufen Dreiecke -
  // dort muss erst gesucht werden, was zusammenhängt, und das kostet bei
  // großen Dateien Sekunden. Das läuft nebenher in einem Worker; der Knopf
  // erscheint erst, wenn dabei mehr als ein Körper herauskommt.
  zerlegbar = false;
  modusKnopf.hidden = aktuelleTeile.length < 2;
  obenFormat = OBEN_ZIEL[endungVon(datei.name)];
  speichernOben.hidden = obenFormat === undefined;
  zeigeFormat();
  sucheTeile(!netze.teile && netze.length === 1 && netze[0].ecken.length > 0 ? netze[0].ecken : null);

  if (aktuelleTeile.length > 1) baueTeileListe();
}

// --- Einzelteile eines STL im Hintergrund suchen ---------------------------
//
// Ein Worker je Datei. Wird eine andere Datei gezeigt, bevor er fertig ist,
// wird er beendet - sein Ergebnis gehört dann zu nichts mehr.
let teileSuche = null;
let gefundeneKoerper = null;

function sucheTeile(ecken) {
  teileSuche?.terminate();
  teileSuche = null;
  gefundeneKoerper = null;
  if (!ecken) return;

  const suche = teileSuche = new Worker('model_teile_worker.js');
  const ende = () => { suche.terminate(); if (teileSuche === suche) teileSuche = null; };
  suche.onmessage = ({ data }) => {
    const aktuell = teileSuche === suche;
    ende();
    if (!aktuell || !data.netze) return;
    gefundeneKoerper = data.netze;
    gefundeneKoerper.teile = gefundeneKoerper.map((_, i) => ({ nummer: i, name: '' }));
    zerlegbar = true;
    modusKnopf.hidden = false;
  };
  suche.onerror = ende;
  // Kopie, nicht übergeben: Die Ecken braucht der Betrachter weiter.
  suche.postMessage(ecken);
}

// Augen-Symbol fuer Ein-/Ausblenden. Feste Zeichnung, kein fremder Inhalt.
const AUGE_AUF = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
const AUGE_ZU = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><path stroke="currentColor" stroke-width="2" d="M3 3l18 18"/></svg>';

function baueTeileListe() {
  teileListe.textContent = '';
  for (const teil of aktuelleTeile) {
    const zeile = document.createElement('div');
    zeile.className = 'teilZeile';
    zeile.dataset.nr = String(teil.nummer);

    const auge = document.createElement('button');
    auge.className = 'auge';
    auge.addEventListener('click', () => schalteSichtbar(teil.nummer));

    const knopf = document.createElement('button');
    knopf.className = 'teil';
    knopf.dataset.nr = String(teil.nummer);
    knopf.setAttribute('aria-current', 'false');

    const nr = document.createElement('span');
    nr.className = 'nr';
    nr.textContent = String(teil.nummer + 1);
    const was = document.createElement('span');
    was.className = 'was';
    was.textContent = teilBezeichnung(teil);
    const mm = document.createElement('span');
    mm.className = 'mm';
    const g = masseVon(netzeVonTeil(teil.nummer));
    mm.textContent = g ? g.map((w) => Math.round(w)).join('×') : '';

    knopf.append(nr, was, mm);
    knopf.addEventListener('click', () => waehleTeil(teil.nummer));
    zeile.append(auge, knopf);
    teileListe.appendChild(zeile);
  }
  aktualisiereSicht();
}

// --- Teile ein- und ausblenden ---------------------------------------------
//
// Bei vollen Druckplatten oder Baugruppen verdecken sich die Teile
// gegenseitig. Ausgeblendetes wird nicht gezeichnet und laesst sich nicht
// anklicken; die Liste zeigt es blass. Gespeichert wird nichts davon - beim
// Verlassen der Teileansicht ist wieder alles zu sehen.
function schalteSichtbar(nr) {
  if (!betrachter) return;
  const aus = betrachter.ausgeblendet;
  if (aus.has(nr)) aus.delete(nr); else aus.add(nr);
  // Ein ausgeblendetes Teil bleibt nicht ausgewaehlt - man saehe nichts.
  if (aus.has(nr) && gewaehltesTeil === nr) waehleTeil(null);
  aktualisiereSicht();
}

function setzeAlleSichtbar(sichtbar) {
  if (!betrachter) return;
  betrachter.ausgeblendet = sichtbar ? new Set() : new Set(aktuelleTeile.map((t2) => t2.nummer));
  if (!sichtbar && gewaehltesTeil !== null) waehleTeil(null);
  aktualisiereSicht();
}

function aktualisiereSicht() {
  const aus = betrachter ? betrachter.ausgeblendet : new Set();
  for (const zeile of teileListe.children) {
    const unsichtbar = aus.has(Number(zeile.dataset.nr));
    zeile.classList.toggle('aus', unsichtbar);
    const auge = zeile.querySelector('.auge');
    auge.innerHTML = unsichtbar ? AUGE_ZU : AUGE_AUF;
    auge.setAttribute('aria-pressed', String(!unsichtbar));
    auge.title = t(unsichtbar ? 'modelShowPart' : 'modelHidePart');
    auge.setAttribute('aria-label', auge.title);
  }
  document.getElementById('alleEin').disabled = aus.size === 0;
  document.getElementById('alleAus').disabled = aus.size >= aktuelleTeile.length;
  if (betrachter) betrachter.zeichne();
  if (gewaehltesTeil === null) zeigeMasse(sichtbareMasse());
}

// Masse des Sichtbaren: alles, oder nur die eingeblendeten Teile.
function sichtbareMasse() {
  const aus = betrachter ? betrachter.ausgeblendet : new Set();
  if (!aus.size) return betrachter?.groesse;
  return masseVon(aktuelleNetze.filter((n) => !aus.has(n.teil)));
}

document.getElementById('alleEin').addEventListener('click', () => setzeAlleSichtbar(true));
document.getElementById('alleAus').addEventListener('click', () => setzeAlleSichtbar(false));

// Übernimmt die im Hintergrund gefundenen Körper eines STL (sucheTeile).
function zerlegeJetzt() {
  const koerper = gefundeneKoerper;
  if (!koerper) return false;
  zerlegbar = false;
  gefundeneKoerper = null;
  aktuelleNetze = koerper;
  aktuelleTeile = koerper.teile;
  betrachter.setzeNetze(koerper);
  baueTeileListe();
  return true;
}

// Nochmals auf dasselbe Teil heben die Auswahl wieder auf - so kommt man
// ohne Umweg zurück zur Gesamtansicht.
function waehleTeil(nr) {
  gewaehltesTeil = (nr === null || nr === gewaehltesTeil) ? null : nr;
  // Wer ein ausgeblendetes Teil auswaehlt, will es sehen.
  if (gewaehltesTeil !== null && betrachter?.ausgeblendet.delete(gewaehltesTeil)) aktualisiereSicht();

  if (betrachter) {
    betrachter.hervor = gewaehltesTeil;
    betrachter.zeichne();
  }
  for (const zeile of teileListe.children) {
    zeile.querySelector('.teil').setAttribute('aria-current',
      String(Number(zeile.dataset.nr) === gewaehltesTeil));
  }
  teilKnopf.disabled = gewaehltesTeil === null;
  teilInfo.hidden = true;

  zeigeMasse(gewaehltesTeil === null
    ? sichtbareMasse()
    : masseVon(netzeVonTeil(gewaehltesTeil)));
}

function teilDateiName(teil) {
  const basis = aktuelleDatei.name.replace(/\.[^.]+$/, '');
  const nr = String(teil.nummer + 1).padStart(2, '0');
  const name = (teil.name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  return basis + '_' + nr + (name ? '_' + name : '') + '.' + exportFormat;
}

// --- Dateiformat beim Speichern ----------------------------------------------
//
// 3MF behaelt die Farben (siehe model_3mf_schreiben.js), STL nur die Form.
// Eine Wahl fuer beide Stellen - Teile links und ganzes Modell oben -, sie
// bleibt gespeichert.
let exportFormat = '3mf';
const stlHinweis = document.getElementById('stlHinweis');
const stlHinweisOben = document.getElementById('stlHinweisOben');

function zeigeFormat() {
  for (const k of document.querySelectorAll('.formatWahl .format')) {
    k.setAttribute('aria-pressed', String(k.dataset.format === exportFormat));
  }
  stlHinweis.hidden = exportFormat !== 'stl';
  // Oben: Steht das Ziel fest (3MF -> STL, STL -> 3MF), nur der eine Knopf,
  // ohne Umschalter und Hinweis. Nur bei STEP passt beides.
  const oben = obenFormat || exportFormat;
  obenWahl.hidden = !!obenFormat;
  stlHinweisOben.hidden = !!obenFormat || oben !== 'stl';
  if (!stlKnopf.disabled) stlKnopf.textContent = t(oben === 'stl' ? 'modelSaveAsStl' : 'modelSaveAs3mf');
}

for (const g of document.querySelectorAll('.formatWahl')) g.title = t('modelFormat');
for (const k of document.querySelectorAll('.formatWahl .format')) {
  k.addEventListener('click', () => {
    exportFormat = k.dataset.format;
    zeigeFormat();
    chrome.storage.local.set({ exportFormat }).catch(() => {});
  });
}

// Was in die Datei kommt. Die Farbtafel haengt am ganzen Modell, nicht an
// den einzelnen Netzen eines Teils.
function dateiInhalt(netze, teile, format = exportFormat) {
  if (format === 'stl') return schreibeStl(netze);
  // Umgefaerbte Filamente kommen so in die neue Datei.
  return schreibe3mf(netze, aktuelleTafel(), teile);
}

async function schreibeDatei(ordner, name, puffer) {
  const strom = await (await ordner.getFileHandle(name, { create: true })).createWritable();
  await strom.write(puffer);
  await strom.close();
}

async function speichereTeile(welche) {
  teilKnopf.disabled = true;
  alleKnopf.disabled = true;
  teilInfo.hidden = false;
  teilInfo.textContent = t('modelSaving');

  try {
    // Immer in den Unterordner - auch das einzelne Teil. Sonst liegen die
    // Ergebnisse mal hier, mal dort, und zwischen den Originaldateien.
    const ziel = await modellHandle.getDirectoryHandle(TEILE_ORDNER, { create: true });

    for (const teil of welche) {
      await schreibeDatei(ziel, teilDateiName(teil), await dateiInhalt(netzeVonTeil(teil.nummer), [teil]));
    }

    teilInfo.textContent = welche.length > 1
      ? t('modelSavedMany', [String(welche.length), TEILE_ORDNER])
      : t('modelSavedOne', [TEILE_ORDNER + '\\' + teilDateiName(welche[0])]);

    // Die neuen Dateien sollen gleich in der Liste stehen - ihr Ordner offen.
    dateien = (await sammle(modellHandle)).sort((a, b) => a.pfad.localeCompare(b.pfad));
    offeneOrdner.add(TEILE_ORDNER + '/');
    zeichneListe();
  } catch (err) {
    teilInfo.textContent = t('libError', [err.message]);
  } finally {
    teilKnopf.disabled = gewaehltesTeil === null;
    alleKnopf.disabled = false;
  }
}

// --- Ganzes Modell als STL --------------------------------------------------
//
// STEP aus CAD-Programmen und 3MF aus dem Slicer als eine STL-Datei, wie sie
// jeder Slicer liest. Geschrieben wird das, was gerade zu sehen ist - bei STEP
// also in der eingestellten Feinheit -, mittig und auf Z=0 gestellt. Die
// Datei kommt neben das Original, mit gleichem Namen; gibt es den schon,
// haengt eine Nummer an. Ueberschrieben wird nie etwas.
// Was oben angeboten wird: ein 3MF als STL, ein STL als 3MF - jeweils das
// andere Format. STEP kann beides, dort entscheidet der Umschalter (null).
// Andere Dateien bekommen keinen Knopf.
const OBEN_ZIEL = { '.3mf': 'stl', '.stl': '3mf', '.step': null, '.stp': null };
let obenFormat;
const obenWahl = document.querySelector('.speichernOben .formatWahl');

async function freierDateiname(ordner, basis, endung) {
  for (let n = 1; ; n++) {
    const name = basis + (n > 1 ? ` (${n})` : '') + endung;
    try { await ordner.getFileHandle(name); } catch { return name; }
  }
}

stlKnopf.title = t('modelSaveAsStlHint');
zeigeFormat();
stlKnopf.addEventListener('click', async () => {
  const datei = aktuelleDatei;
  if (!datei || !aktuelleNetze.length) return;
  stlKnopf.disabled = true;
  stlKnopf.textContent = t('modelSaving');
  let meldung;
  try {
    const ordner = datei.ordner || modellHandle;
    const format = obenFormat || exportFormat;
    const name = await freierDateiname(ordner, datei.name.replace(/\.[^.]+$/, ''), '.' + format);
    await schreibeDatei(ordner, name, await dateiInhalt(aktuelleNetze, aktuelleTeile, format));
    meldung = '✓ ' + t('modelSavedOne', [name]);
    // Die neue Datei soll gleich in der Liste stehen.
    dateien = (await sammle(modellHandle)).sort((a, b) => a.pfad.localeCompare(b.pfad));
    zeichneListe();
  } catch (err) {
    meldung = t('libError', [err.message]);
  }
  stlKnopf.textContent = meldung;
  setTimeout(() => {
    stlKnopf.disabled = false;
    zeigeFormat();
  }, 3000);
});

modusKnopf.addEventListener('click', async () => {
  // Beim ersten Mal muss ein STL erst zerlegt werden; danach liegt die
  // Liste vor und der Schalter wechselt nur noch hin und her.
  if (!teileModus && zerlegbar && !zerlegeJetzt()) return;
  setzeTeileModus(!teileModus);
});

teilKnopf.addEventListener('click', () => {
  const teil = aktuelleTeile.find((t2) => t2.nummer === gewaehltesTeil);
  if (teil) speichereTeile([teil]);
});
alleKnopf.addEventListener('click', () => speichereTeile(aktuelleTeile));

// --- Feinheit einer STEP-Datei --------------------------------------------
//
// Der Regler zerlegt das Modell neu. Eingelesen wird die Datei dafuer nicht
// noch einmal: Der Worker haelt das zuletzt geladene Modell, und das Zerlegen
// allein kostet nur einen Bruchteil. Das Bild bleibt dabei stehen, ebenso der
// Blickwinkel - sonst liesse sich der Unterschied gar nicht vergleichen.
// Neu gelesen wird erst beim Loslassen, nicht bei jedem Zwischenschritt.
// Exportiert wird, was gerade zu sehen ist: Die Stufe gilt also auch fuer
// "Einzelteile aus Datei exportieren".
const feinheitEl = document.getElementById('feinheit');
const feinReglerEl = document.getElementById('rFeinheit');
let feinheitArbeitet = false;

// Abweichung einer Stufe in Millimetern, umgerechnet auf das offene Modell.
// Die Bibliothek misst jede Form fuer sich; hier zaehlt das ganze Modell -
// fuer einen Anhaltspunkt genau genug.
function abweichungMm(stufe) {
  const g = betrachter?.groesse;
  if (!g) return null;
  return (g[0] + g[1] + g[2]) / 3 * STEP_STUFEN[stufe].verhaeltnis;
}

function stufenText(stufe) {
  const mm = abweichungMm(stufe);
  const name = t(STEP_STUFEN[stufe].schluessel);
  if (mm === null) return name;
  const zahl = mm.toLocaleString(undefined, { maximumFractionDigits: mm < 0.1 ? 3 : 2 });
  return t('modelStepDeviation', [name, zahl]);
}

function zeigeFeinheit(d, netze) {
  zeigeStepWarnung(STEP_ENDUNGEN.includes(endungVon(d.name)) ? netze.warnungen : null);
  if (!STEP_ENDUNGEN.includes(endungVon(d.name))) { feinheitEl.hidden = true; return; }
  feinReglerEl.max = String(STEP_STUFEN.length - 1);
  feinReglerEl.value = String(stepStufe);
  document.getElementById('wFeinheit').textContent = stufenText(stepStufe);
  const dreiecke = netze.reduce((s, n) => s + n.indizes.length / 3, 0);
  document.getElementById('feinDreiecke').textContent =
    t('modelTriangles', [dreiecke.toLocaleString()]);
  zeigeThreads();
  feinheitEl.classList.remove('rechnet');
  feinheitEl.hidden = false;
}

// Fehlerhafte STEP-Datei: OpenCascade musste Kanten reparieren oder konnte
// Flaechen gar nicht zerlegen (die fehlen dann im Modell). Gefunden an den
// Zahnraedern des Prusa Spool Bot - auch OrcaSlicer meldet dort Fehler.
const stepWarnungEl = document.getElementById('stepWarnung');
function zeigeStepWarnung(w) {
  const teile = [];
  if (w?.leereFlaechen > 0) teile.push(t('modelStepDamagedFaces', [String(w.leereFlaechen)]));
  if (w?.reparierteKanten > 0) teile.push(t('modelStepDamagedEdges', [String(w.reparierteKanten)]));
  stepWarnungEl.hidden = !teile.length;
  if (!teile.length) return;
  stepWarnungEl.textContent = '⚠ ' + t('modelStepDamaged') + ' (' + teile.join(', ') + ')';
}

// "12 von 16 Threads" - mit wie vielen Kernen das Zerlegen laeuft. Steht
// dort nur einer, fehlt die Isolation, die die Thread-Fassung braucht.
function zeigeThreads() {
  const el = document.getElementById('feinKerne');
  if (!stepThreads) { el.hidden = true; return; }
  el.textContent = t('modelStepThreads',
    [String(stepThreads.genutzt), String(stepThreads.verfuegbar)]);
  el.title = t('modelStepThreadsHint');
  el.hidden = false;
}

feinReglerEl.addEventListener('input', () => {
  document.getElementById('wFeinheit').textContent = stufenText(Number(feinReglerEl.value));
});

feinReglerEl.addEventListener('change', async () => {
  const neu = Number(feinReglerEl.value);
  const d = aktuelleDatei;
  if (neu === stepStufe || !d || feinheitArbeitet) { feinReglerEl.value = String(stepStufe); return; }

  stepStufe = neu;

  const kamera = {
    drehung: betrachter.drehung, hoehe: betrachter.hoehe,
    abstand: betrachter.abstand, schub: [...betrachter.schub]
  };
  const meineWahl = wahlNummer;
  feinheitArbeitet = true;
  feinReglerEl.disabled = true;
  feinheitEl.classList.add('rechnet');
  document.getElementById('feinDreiecke').textContent = t('modelStepWorking');
  zeigeBalken(true);
  // Ist das Modell noch im Worker, laeuft nur Abschnitt 3; sonst wird die
  // Datei neu eingelesen und der Balken laeuft ueber alle drei.
  const nurZerlegen = stepGehalten === d.pfad;
  const melde = (abschnitt, anteil, zaehler) => {
    if (meineWahl !== wahlNummer) return;
    zeigeStand(stepGesamt(abschnitt, anteil, nurZerlegen));
    const text = stepStandText(abschnitt, anteil, zaehler);
    merkeStand(text);
    document.getElementById('feinDreiecke').textContent = text;
  };
  try {
    const netze = await netzeVon(d, false, melde);
    if (meineWahl !== wahlNummer) return;
    betrachter.setzeNetze(netze);
    Object.assign(betrachter, kamera);
    betrachter.zeichne();
    zeigeMasse(betrachter.groesse);
    zeigeTeile(d, netze);
    zeigeFarbSchalter();
    zeigeFilamente();
    zeigeFeinheit(d, netze);
  } catch {
    document.getElementById('feinDreiecke').textContent = t('modelReadFailed', [d.name]);
  } finally {
    feinheitArbeitet = false;
    feinReglerEl.disabled = false;
    if (meineWahl === wahlNummer) zeigeBalken(false);
  }
});

// --- Beschreibung -------------------------------------------------------
//
// Steht als eigener Eintrag ganz oben in der Dateiliste, gezeigt wird sie
// auf der Buehne - dort, wo sonst die Vorschau ist. Der Text kommt aus der
// info.txt, die beim Herunterladen von der Modellseite gefuellt wird.
// Gesetzt wird ausschliesslich ueber Textknoten: Der Text stammt von einer
// fremden Website und wird nie als HTML eingelesen.
let detailsKnopf = null;
let detailsFlaeche = null;

function detailsEintrag() {
  const knopf = document.createElement('button');
  knopf.className = 'datei details';
  knopf.setAttribute('aria-current', 'false');

  const bild = document.createElement('div');
  bild.className = 'bild';
  bild.textContent = '\u2139';                     // Info-Zeichen

  const text = document.createElement('div');
  text.className = 'text';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = t('modelDetails');
  const unter = document.createElement('div');
  unter.className = 'groesse';
  unter.textContent = [herkunft.kopf['plattform'], herkunftDatum()].filter(Boolean).join(' \u00b7 ');
  text.append(name, unter);

  knopf.append(bild, text);
  knopf.addEventListener('click', zeigeDetails);
  detailsKnopf = knopf;
  return knopf;
}

function herkunftDatum() {
  const roh = herkunft?.kopf['heruntergeladen'] || '';
  const m = roh.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
  return m ? formatDatum(m[1]) + (m[2] ? ' ' + m[2] : '') : roh;
}

// Text mit Adressen darin: Die Adressen werden anklickbar, alles andere
// bleibt Text. Nur http und https - nichts, was ein Skript ausfuehren koennte.
function mitLinks(eltern, text) {
  const muster = /https?:\/\/[^\s)<>"]+/g;
  let ab = 0, treffer;
  while ((treffer = muster.exec(text))) {
    // Satzzeichen am Ende gehoeren nicht zur Adresse.
    let adresse = treffer[0].replace(/[.,;:!?]+$/, '');
    if (treffer.index > ab) eltern.append(text.slice(ab, treffer.index));
    const a = document.createElement('a');
    a.href = adresse;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = adresse;
    eltern.appendChild(a);
    ab = treffer.index + adresse.length;
    muster.lastIndex = ab;
  }
  if (ab < text.length) eltern.append(text.slice(ab));
}

// Absaetze durch Leerzeilen, Zeilen mit "\u2022 " werden zur Liste.
function setzeBeschreibung(ziel, text) {
  for (const absatz of text.split(/\n\s*\n/)) {
    const zeilen = absatz.split('\n').filter((z) => z.trim());
    if (!zeilen.length) continue;
    let liste = null;
    let p = null;
    for (const zeile of zeilen) {
      if (zeile.startsWith('\u2022 ')) {
        if (!liste) { liste = document.createElement('ul'); ziel.appendChild(liste); p = null; }
        const li = document.createElement('li');
        mitLinks(li, zeile.slice(2));
        liste.appendChild(li);
      } else {
        liste = null;
        if (!p) { p = document.createElement('p'); ziel.appendChild(p); }
        else p.appendChild(document.createElement('br'));
        mitLinks(p, zeile);
      }
    }
  }
}

function zeigeDetails() {
  ++wahlNummer;                // eine noch ladende STEP-Datei zeichnet nicht mehr
  gezeigteDatei = null;
  for (const d of dateien) d.knopf?.setAttribute('aria-current', 'false');
  detailsKnopf?.setAttribute('aria-current', 'true');

  if (leinwand) leinwand.hidden = true;
  if (grossesBild) grossesBild.hidden = true;
  pdfAusblenden();
  for (const el of [mitteEl, lageEl, masseEl, feinheitEl, teileFach, modusKnopf, speichernOben, stepWarnungEl, renderKnopf, filamentFach]) el.hidden = true;
  sucheTeile(null);
  dateienEl.hidden = false;
  teileModus = false;
  zeigeBalken(false);

  if (!detailsFlaeche) {
    detailsFlaeche = document.createElement('article');
    detailsFlaeche.className = 'details';
    buehneEl.appendChild(detailsFlaeche);
  }
  detailsFlaeche.textContent = '';
  // Innerer Block: mittig, breit genug fuer Bild und Text nebeneinander,
  // aber auf breiten Schirmen nicht bis an die Raender.
  const f = document.createElement('div');
  f.className = 'inhalt';
  detailsFlaeche.appendChild(f);
  const k = herkunft.kopf;

  // Kopf: Vorschaubild links, Titel und Angaben rechts daneben.
  const kopf = document.createElement('div');
  kopf.className = 'oben';
  const bildDatei = vorschauDatei();
  if (bildDatei) {
    const bild = document.createElement('img');
    bild.className = 'titelbild';
    bild.alt = '';
    bild.title = bildDatei.name;
    // Ein Klick zeigt das Bild gross - wie in der Liste.
    bild.addEventListener('click', () => waehle(bildDatei));
    kopf.appendChild(bild);
    bildDatei.handle.getFile().then((datei) => {
      const url = URL.createObjectURL(datei);
      bildUrls.push(url);
      bild.src = url;
    }).catch(() => bild.remove());
  }
  const kopfText = document.createElement('div');
  kopfText.className = 'kopfText';
  kopf.appendChild(kopfText);
  f.appendChild(kopf);

  const titel = document.createElement('h2');
  titel.textContent = k['titel'] || document.getElementById('titel').textContent;
  kopfText.appendChild(titel);

  const angaben = document.createElement('dl');
  const angabe = (bezeichnung, inhalt) => {
    if (!inhalt) return;
    const dt = document.createElement('dt');
    dt.textContent = bezeichnung;
    const dd = document.createElement('dd');
    if (inhalt instanceof Node) dd.appendChild(inhalt); else dd.textContent = inhalt;
    angaben.append(dt, dd);
  };
  angabe(t('modelDetailsPlatform'), k['plattform']);
  angabe(t('modelDetailsDownloaded'), herkunftDatum());
  if (/^https?:\/\//i.test(k['adresse'] || '')) {
    const a = document.createElement('a');
    a.href = k['adresse'];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = k['adresse'].split('?')[0];
    angabe(t('modelDetailsSource'), a);
  }
  kopfText.appendChild(angaben);

  const text = document.createElement('div');
  text.className = 'text';
  if (herkunft.beschreibung) setzeBeschreibung(text, herkunft.beschreibung);
  else {
    const leer = document.createElement('p');
    leer.className = 'leer';
    leer.textContent = t('modelDetailsNone');
    text.appendChild(leer);
  }
  f.appendChild(text);
  detailsFlaeche.scrollTop = 0;
  detailsFlaeche.hidden = false;
}

// Das Vorschaubild, das die Erweiterung beim Herunterladen ablegt
// (preview.jpg o. ae.), sonst das erste Bild im Ordner.
function vorschauDatei() {
  const namen = ['preview.jpg', 'preview.png', 'preview.webp', 'preview.jpeg', 'preview.gif'];
  return dateien.find((d) => namen.includes(d.pfad.toLowerCase()))
    || dateien.find((d) => BILD_ENDUNGEN.includes(endungVon(d.name)));
}

// Zählt die Auswahlen mit. Eine große STEP-Datei liest über eine Minute -
// klickt man in der Zeit eine andere Datei an, darf die alte nach dem Warten
// nicht über die neue gezeichnet werden.
let wahlNummer = 0;

// PDF: Chrome bringt einen eigenen Betrachter mit (Zoom, Suche, Drucken) -
// den zeigen wir in einem Rahmen auf der Buehne. Darueber ein Verweis, die
// Datei in einem eigenen Tab zu oeffnen, falls der Rahmen einmal nichts zeigt
// oder man sie groesser haben will.
let pdfRahmen = null;
let pdfLeiste = null;
let pdfUrl = null;

function pdfAusblenden() {
  if (pdfRahmen) { pdfRahmen.hidden = true; pdfRahmen.removeAttribute('src'); }
  if (pdfLeiste) pdfLeiste.hidden = true;
  if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
}

async function zeigePdf(d) {
  if (!pdfRahmen) {
    pdfRahmen = document.createElement('iframe');
    pdfRahmen.className = 'pdf';
    pdfRahmen.title = d.name;
    buehneEl.appendChild(pdfRahmen);

    pdfLeiste = document.createElement('div');
    pdfLeiste.className = 'pdfLeiste';
    const neuerTab = document.createElement('a');
    neuerTab.id = 'pdfTab';
    neuerTab.target = '_blank';
    neuerTab.rel = 'noopener';
    neuerTab.textContent = t('modelPdfNewTab');
    pdfLeiste.appendChild(neuerTab);
    buehneEl.appendChild(pdfLeiste);
  }
  // Den Typ ausdruecklich setzen: Ohne "application/pdf" zeigte der Rahmen
  // die Datei als Text oder boete sie zum Herunterladen an.
  const datei = await d.handle.getFile();
  pdfUrl = URL.createObjectURL(new Blob([datei], { type: 'application/pdf' }));
  pdfRahmen.title = d.name;
  pdfRahmen.src = pdfUrl;
  document.getElementById('pdfTab').href = pdfUrl;
  pdfRahmen.hidden = false;
  pdfLeiste.hidden = false;
}

async function waehle(d) {
  const meineWahl = ++wahlNummer;
  for (const andere of dateien) andere.knopf?.setAttribute('aria-current', String(andere === d));
  detailsKnopf?.setAttribute('aria-current', 'false');
  if (detailsFlaeche) detailsFlaeche.hidden = true;
  gezeigteDatei = d;
  oeffneOrdnerVon(d);

  const endung = endungVon(d.name);
  mitteEl.hidden = true;
  lageEl.hidden = true;
  renderKnopf.hidden = true;
  filamentFach.hidden = true;
  masseEl.hidden = true;
  stepWarnungEl.hidden = true;
  feinheitEl.hidden = true;
  teileFach.hidden = true;
  modusKnopf.hidden = true;
  speichernOben.hidden = true;
  sucheTeile(null);
  dateienEl.hidden = false;
  teileModus = false;
  pdfAusblenden();

  if (endung === '.pdf') {
    if (leinwand) leinwand.hidden = true;
    if (grossesBild) grossesBild.hidden = true;
    await zeigePdf(d);
    return;
  }

  if (BILD_ENDUNGEN.includes(endung)) {
    if (leinwand) leinwand.hidden = true;
    if (!grossesBild) {
      grossesBild = document.createElement('img');
      grossesBild.className = 'gross';
      grossesBild.alt = '';
      buehneEl.appendChild(grossesBild);
    }
    const url = URL.createObjectURL(await d.handle.getFile());
    bildUrls.push(url);
    grossesBild.src = url;
    grossesBild.hidden = false;
    return;
  }

  if (!NETZ_ENDUNGEN.includes(endung)) {
    if (leinwand) leinwand.hidden = true;
    if (grossesBild) grossesBild.hidden = true;
    mitteEl.textContent = t('modelNoPreview', [endung.slice(1).toUpperCase() || '?']);
    mitteEl.hidden = false;
    return;
  }

  if (grossesBild) grossesBild.hidden = true;
  if (!leinwand) {
    leinwand = document.createElement('canvas');
    buehneEl.appendChild(leinwand);
    try {
      betrachter = new Betrachter(leinwand);
      await reglerEinrichten();
    } catch (err) {
      leinwand.remove();
      leinwand = null;
      mitteEl.textContent = t('modelNoWebgl');
      mitteEl.hidden = false;
      return;
    }
  }
  leinwand.hidden = false;

  zeigeBalken(true);
  // STEP braucht Sekunden, große Dateien bis über eine Minute (47 MB: 78 s).
  // Ohne Hinweis sähe das aus wie eine hängende Seite. Liegt das Modell schon
  // im Speicher, kommt es sofort - dann gar nicht erst ankündigen.
  if (STEP_ENDUNGEN.includes(endung)) stepStufe = STEP_STANDARD;
  const stepWartet = STEP_ENDUNGEN.includes(endung) && !netzSpeicher.has(speicherSchluessel(d))
    && stepGehalten !== d.pfad;
  if (stepWartet) {
    leinwand.hidden = true;
    mitteEl.textContent = t('modelStepLoading', [formatGroesse(d.groesse)]);
    mitteEl.hidden = false;
  }
  const groesseText = formatGroesse(d.groesse);
  // Alle anderen Dateien: das alte Modell gleich wegnehmen und sagen, was
  // kommt - sonst stuende beim Hin- und Herklicken noch die vorige Datei da,
  // und bei aehnlichen Modellen verwechselt man das. Sofort, nicht nach
  // einer Wartezeit: Das Lesen blockiert die Seite, ein Zeitgeber kaeme erst
  // danach dran. Deshalb auch zwei Bilder warten, damit der Hinweis wirklich
  // zu sehen ist, bevor das Lesen beginnt. Liegt das Modell schon im
  // Speicher, kommt es sofort - dann kein Hinweis, sonst flackert es.
  const ladeHinweis = !stepWartet && !netzSpeicher.has(speicherSchluessel(d));
  if (ladeHinweis) {
    leinwand.hidden = true;
    mitteEl.textContent = t('modelLoading', [d.name, groesseText]);
    mitteEl.hidden = false;
    await new Promise((weiter) => requestAnimationFrame(() => requestAnimationFrame(weiter)));
    if (meineWahl !== wahlNummer) return;
  }
  const melde = (abschnitt, anteil, zaehler) => {
    if (meineWahl !== wahlNummer) return;
    zeigeStand(stepGesamt(abschnitt, anteil, false));
    const text = stepStandText(abschnitt, anteil, zaehler);
    merkeStand(text);
    mitteEl.textContent = t('modelStepLoading', [groesseText]) + '\n' + text;
  };
  try {
    const netze = await netzeVon(d, false, stepWartet ? melde : null);
    if (meineWahl !== wahlNummer) return;
    if (!netze.length) throw new Error('leer');
    if (stepWartet || ladeHinweis) {
      mitteEl.hidden = true;
      leinwand.hidden = false;
    }
    // "Rendern" bleibt, wie es zuletzt eingestellt war - ist es an, wird
    // die neue Datei gleich im Hintergrund aufbereitet (setzeNetze).
    // Umgefaerbte Filamente gelten nur fuer die Datei, in der man sie
    // geaendert hat.
    betrachter.filamentTafel = null;
    betrachter.hervorFilament = null;
    betrachter.setzeNetze(netze);
    // Ein Klick ins Bild waehlt ein Teil nur, wenn die Teileansicht schon
    // offen ist - eingeschaltet wird sie ausschliesslich ueber den Knopf oben.
    betrachter.beiAuswahl = (nr) => {
      if (teileModus) waehleTeil(nr);
    };
    lageEl.hidden = false;
    renderKnopf.hidden = false;
    zeigeMasse(betrachter.groesse);
    zeigeTeile(d, netze);
    zeigeFarbSchalter();
    zeigeFilamente();
    zeigeFeinheit(d, netze);
  } catch (err) {
    if (meineWahl !== wahlNummer) return;
    leinwand.hidden = true;
    mitteEl.textContent = t('modelReadFailed', [d.name]);
    mitteEl.hidden = false;
  } finally {
    // Nur die aktuelle Auswahl räumt den Balken ab - eine überholte würde
    // ihn sonst mitten im Laden der neuen verschwinden lassen.
    if (meineWahl === wahlNummer) zeigeBalken(false);
  }
}

// --- Regler für Licht und Farbe -----------------------------------------
//
// Alles, was der Shader kennt, lässt sich hier verstellen. Die Werte liegen
// im Speicher der Erweiterung, damit die Einstellung das Schließen der Seite
// überlebt - sonst müsste man sie bei jedem Modell neu suchen.

const REGLER = [
  // [Regler-Id, Feld im Betrachter, Umrechnung, Nachkommastellen, Anzeigefeld, Einheit]
  ['rGrund',    'grund',        1,             2, 'wGrund',    ''],
  ['rKopf',     'kopflicht',    1,             2, 'wKopf',     ''],
  ['rZweit',    'zweitlicht',   1,             2, 'wZweit',    ''],
  ['rRichtung', 'lichtDrehung', Math.PI / 180, 0, 'wRichtung', '°'],
  ['rHoehe',    'lichtHoehe',   Math.PI / 180, 0, 'wHoehe',    '°'],
  ['rKante',    'kante',        1,             2, 'wKante',    ''],
  ['rGamma',    'gamma',        1,             2, 'wGamma',    ''],
  // Gerenderte Ansicht
  ['rBelichtung',  'dreiBelichtung', 1,             2, 'wBelichtung',  ''],
  ['rUmgebung',    'dreiUmgebung',   1,             2, 'wUmgebung',    ''],
  ['rHaupt',       'dreiHaupt',      1,             1, 'wHaupt',       ''],
  ['rFuell',       'dreiFuell',      1,             2, 'wFuell',       ''],
  ['rKantenlicht', 'dreiKante',      1,             2, 'wKantenlicht', ''],
  ['rRauheit',     'dreiRauheit',    1,             2, 'wRauheit',     ''],
  ['rSchatten',    'dreiSchatten',   1,             2, 'wSchatten',    ''],
  ['rKnick',       'knickwinkel',    Math.PI / 180, 0, 'wKnick',       '°']
];

// Felder der gerenderten Ansicht - sie beeinflussen die flach gezeichneten
// Vorschaubilder nicht und zaehlen deshalb nicht zu deren Schluessel.
const NUR_RENDERN = ['rendern', 'hervorArt', 'knickwinkel', 'dreiBelichtung', 'dreiUmgebung', 'dreiHaupt',
                     'dreiFuell', 'dreiKante', 'dreiRauheit', 'dreiSchatten'];

const FARBREGLER = [['rFarbe', 'farbe'], ['rHintergrund', 'hintergrund']];

const alsHex = (v) => '#' + v.map((z) =>
  Math.round(Math.max(0, Math.min(1, z)) * 255).toString(16).padStart(2, '0')).join('');
const ausHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

let standard = null;

function zeigeWert(feldId, wert, stellen, einheit) {
  document.getElementById(feldId).textContent =
    (stellen ? wert.toFixed(stellen) : String(Math.round(wert))) + einheit;
}

function reglerAnzeigen() {
  for (const [id, feld, faktor, stellen, anzeige, einheit] of REGLER) {
    const wert = betrachter[feld] / faktor;
    document.getElementById(id).value = wert;
    zeigeWert(anzeige, wert, stellen, einheit);
  }
  for (const [id, feld] of FARBREGLER) {
    document.getElementById(id).value = alsHex(betrachter[feld]);
  }
  document.getElementById('rDateiFarben').checked = betrachter.dateiFarben;
}

// Das Ankreuzfeld erscheint nur bei Dateien, die wirklich mehrere Farben
// mitbringen - sonst gaebe es dort nichts umzuschalten.
function zeigeFarbSchalter() {
  document.getElementById('zDateiFarben').hidden = !betrachter?.hatDateiFarben;
}

// --- Filamente --------------------------------------------------------------
//
// Zeigt die Filamente, die das Modell wirklich benutzt, mit Anteil, und
// laesst sie umfaerben: sofort in der Ansicht, und beim Speichern als 3MF
// kommen die neuen Farben in die Datei. Die Originaldatei bleibt, wie sie
// ist, und gemerkt wird nichts - die naechste Datei zeigt wieder ihre
// eigenen Farben.
const filamentFach = document.getElementById('filamentFach');
const filamentListe = document.getElementById('filamentListe');
const filamentZurueck = document.getElementById('filamentZurueck');

// Die Farbtafel, die gerade gilt - umgefaerbt oder die der Datei.
function aktuelleTafel() {
  return betrachter?.filamentTafel || aktuelleNetze.farbtafel || [];
}

function zeigeFilamente() {
  const original = aktuelleNetze.farbtafel || [];
  const anteile = betrachter?.filamentAnteile() || new Map();
  const genutzt = [...anteile.keys()].filter((f) => original[f - 1]).sort((a, b) => a - b);
  filamentFach.hidden = !genutzt.length;
  filamentListe.textContent = '';
  if (!genutzt.length) return;
  const tafel = aktuelleTafel();
  const gesamt = [...anteile.values()].reduce((s, v) => s + v, 0) || 1;
  for (const f of genutzt) {
    const zeile = document.createElement('label');
    zeile.className = 'filament';
    zeile.classList.toggle('geaendert', tafel[f - 1].toLowerCase() !== original[f - 1].toLowerCase());
    const waehler = document.createElement('input');
    waehler.type = 'color';
    waehler.value = tafel[f - 1].slice(0, 7).toLowerCase();
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = t('modelFilamentN', [String(f)]);
    const anteil = document.createElement('span');
    anteil.className = 'fanteil';
    const prozent = 100 * anteile.get(f) / gesamt;
    anteil.textContent = (prozent < 1 ? '<1' : Math.round(prozent)) + ' %';
    const wert = document.createElement('span');
    wert.className = 'fwert';
    wert.textContent = tafel[f - 1].slice(0, 7).toUpperCase();
    zeile.append(waehler, name, anteil, wert);
    waehler.addEventListener('input', () => {
      const neu = [...aktuelleTafel()];
      neu[f - 1] = waehler.value.toUpperCase();
      betrachter.setzeFilamentFarben(neu);
      wert.textContent = neu[f - 1];
      zeile.classList.toggle('geaendert', neu[f - 1].toLowerCase() !== original[f - 1].toLowerCase());
      filamentZurueck.hidden = false;
    });
    // Darueberfahren: dieses Filament im Modell hervorheben.
    zeile.addEventListener('mouseenter', () => betrachter.setzeHervorFilament(f));
    zeile.addEventListener('mouseleave', () => betrachter.setzeHervorFilament(null));
    filamentListe.appendChild(zeile);
  }
  filamentZurueck.hidden = !betrachter?.filamentTafel;
}

// Art des Hervorhebens - eine Vorliebe, wird mit der Darstellung gemerkt.
const hervorArtWahl = document.getElementById('hervorArtWahl');
function zeigeHervorArt() {
  if (betrachter) hervorArtWahl.value = betrachter.hervorArt;
}
hervorArtWahl.addEventListener('change', () => {
  if (!betrachter) return;
  betrachter.hervorArt = hervorArtWahl.value;
  reglerSichern();
});

filamentZurueck.addEventListener('click', () => {
  betrachter.setzeFilamentFarben([...(aktuelleNetze.farbtafel || [])]);
  betrachter.filamentTafel = null;
  zeigeFilamente();
});

async function reglerSichern() {
  darstellung = {};
  for (const [, feld] of REGLER) darstellung[feld] = betrachter[feld];
  for (const [, feld] of FARBREGLER) darstellung[feld] = betrachter[feld];
  darstellung.dateiFarben = betrachter.dateiFarben;
  darstellung.rendern = betrachter.rendern;
  darstellung.hervorArt = betrachter.hervorArt;
  try { await chrome.storage.local.set({ ansicht: darstellung }); } catch { /* nicht schlimm */ }
}

async function reglerEinrichten() {
  standard = {};
  for (const [, feld] of REGLER) standard[feld] = betrachter[feld];
  for (const [, feld] of FARBREGLER) standard[feld] = [...betrachter[feld]];

  Object.assign(betrachter, darstellung);
  zeigeRendern();
  zeigeHervorArt();
  betrachter.beiRendern = (laeuft) => renderKnopf.classList.toggle('rechnet', laeuft);

  for (const [id, feld, faktor, stellen, anzeige, einheit] of REGLER) {
    document.getElementById(id).addEventListener('input', (e) => {
      const wert = Number(e.target.value);
      betrachter[feld] = wert * faktor;
      zeigeWert(anzeige, wert, stellen, einheit);
      betrachter.zeichne();
      reglerSichern();
    });
  }
  // Knickwinkel: Die weichen Netze muessen neu gerechnet werden - erst wenn
  // der Regler kurz still steht, nicht bei jedem Zwischenschritt.
  let knickUhr = null;
  document.getElementById('rKnick').addEventListener('input', () => {
    clearTimeout(knickUhr);
    knickUhr = setTimeout(() => betrachter.neuAufbereiten(), 150);
  });
  for (const [id, feld] of FARBREGLER) {
    document.getElementById(id).addEventListener('input', (e) => {
      betrachter[feld] = ausHex(e.target.value);
      betrachter.zeichne();
      reglerSichern();
    });
  }
  document.getElementById('rDateiFarben').addEventListener('change', (e) => {
    betrachter.dateiFarben = e.target.checked;
    betrachter.zeichne();
    reglerSichern();
  });
  document.getElementById('rZurueck').addEventListener('click', () => {
    for (const [, feld] of REGLER) betrachter[feld] = standard[feld];
    for (const [, feld] of FARBREGLER) betrachter[feld] = [...standard[feld]];
    betrachter.dateiFarben = true;
    reglerAnzeigen();
    betrachter.neuAufbereiten();
    betrachter.zeichne();
    reglerSichern();
  });

  reglerAnzeigen();
  betrachter.zeichne();
  document.getElementById('regler').hidden = false;
}

// --- Rendern -------------------------------------------------------------
//
// Schaltet die grosse Ansicht zwischen flach (jede Facette sichtbar, gut zum
// Pruefen) und weich schattiert mit Studiolicht um. Die Wahl bleibt
// gespeichert wie die anderen Darstellungs-Einstellungen und gilt fuer jede
// Datei, die man danach anklickt.
const renderKnopf = document.getElementById('rendern');
renderKnopf.title = t('modelRenderHint');

function zeigeRendern() {
  const an = !!betrachter?.rendern;
  renderKnopf.setAttribute('aria-pressed', String(an));
  // Unter "Darstellung" nur die Regler, die in der Ansicht etwas tun.
  document.getElementById('reglerFlach').hidden = an;
  document.getElementById('reglerRender').hidden = !an;
}

renderKnopf.addEventListener('click', () => {
  if (!betrachter) return;
  betrachter.setzeRendern(!betrachter.rendern);
  zeigeRendern();
  reglerSichern();
});

// --- Knöpfe -------------------------------------------------------------

const explorerEl = document.getElementById('explorer');
explorerEl.addEventListener('click', async () => {
  const exp = await explorerEinstellungen();
  hinweisEl.hidden = true;
  if (!exp.nutzbar) {
    zeigeHinweis(t('libExpNoPath'));
    return;
  }
  explorerEl.disabled = true;
  explorerEl.textContent = t('libExpOpening');
  // Ist gerade eine Datei in einem Unterordner gewaehlt, diesen Unterordner
  // oeffnen - sonst den Modellordner.
  const tiefer = gezeigteDatei ? gezeigteDatei.pfad.split('/').slice(0, -1).join('/') : '';
  const unter = (IM_KORB ? PAPIERKORB + '/' : '') + ORDNER + (tiefer ? '/' + tiefer : '');
  const erg = await explorerOeffnenUndPruefen(explorerUrl(exp.pfad, unter),
                                              gezeigteDatei?.ordner || modellHandle);
  explorerEl.disabled = false;
  explorerEl.textContent = t('libOpenExplorer');
  if (!erg.ok) {
    zeigeHinweis(t('libExpNoScript'), 'explorer',
                 exp.pfad.replace(/[\\/]+$/, '') + '\\' + unter.replace(/\//g, '\\'));
  }
});

// Im Papierkorb: in der Kopfzeile "Haus › Papierkorb › Modell", und
// "Papierkorb" fuehrt zurueck in dessen Ansicht der Uebersicht.
if (IM_KORB) {
  const pfadKorb = document.getElementById('pfadKorb');
  pfadKorb.href = chrome.runtime.getURL('library.html') + '?korb=1';
  pfadKorb.hidden = false;
  const trenner = document.createElement('span');
  trenner.className = 'pfadTrenner';
  trenner.setAttribute('aria-hidden', 'true');
  trenner.textContent = '›';
  pfadKorb.after(trenner);
}

const loeschEl = document.getElementById('loeschen');
const wiederEl = document.getElementById('wieder');
loeschEl.textContent = t(IM_KORB ? 'libDeleteForever' : 'libDelete');
wiederEl.hidden = !IM_KORB;

function zurueckZurUebersicht() {
  location.href = chrome.runtime.getURL('library.html') + (IM_KORB ? '?korb=1' : '');
}

loeschEl.addEventListener('click', async () => {
  const titel = document.getElementById('titel').textContent;
  if (IM_KORB) {
    if (!await frage({
      titel: t('libDeleteForever'),
      text: t('libDeleteForeverConfirm', [titel]),
      ja: t('libDeleteForever'),
      gefahr: true
    })) return;
    const wurzel = await getTargetDir();
    const korb = await wurzel.getDirectoryHandle(PAPIERKORB);
    await korb.removeEntry(ORDNER, { recursive: true });
    zurueckZurUebersicht();
    return;
  }

  if (!await frage({
    titel: t('libDelete'),
    text: t('libDeleteConfirm', [titel]),
    ja: t('libDelete')
  })) return;
  await mitAnzeige(loeschEl, 'libMoving', async () => {
    const wurzel = await getTargetDir();
    const korb = await wurzel.getDirectoryHandle(PAPIERKORB, { create: true });
    const ziel = await freierName(korb, `${ORDNER}_deleted-${heute()}`);
    await verschiebe(wurzel, ORDNER, korb, ziel);
    zurueckZurUebersicht();
  });
});

wiederEl.addEventListener('click', async () => {
  await mitAnzeige(wiederEl, 'libRestoring', async () => {
    const wurzel = await getTargetDir();
    await modellAusPapierkorb(wurzel, ORDNER, GELOESCHT);
    zurueckZurUebersicht();
  });
});

async function mitAnzeige(knopf, textSchluessel, tat) {
  const alt = knopf.textContent;
  for (const k of [loeschEl, wiederEl, explorerEl]) k.disabled = true;
  knopf.textContent = t(textSchluessel);
  zeigeBalken(true);
  try {
    await tat();
  } catch (err) {
    zeigeHinweis(t('libMoveFailed', [err.message]), 'zielordner');
  } finally {
    zeigeBalken(false);
    knopf.textContent = alt;
    for (const k of [loeschEl, wiederEl, explorerEl]) k.disabled = false;
  }
}

// Verschieben, Papierkorb: siehe papierkorb.js.

// --- Start --------------------------------------------------------------

addEventListener('beforeunload', () => {
  for (const u of bildUrls) URL.revokeObjectURL(u);
});

modellOeffnen().catch((err) => {
  mitteEl.textContent = t('libError', [err.message]);
  mitteEl.hidden = false;
});
