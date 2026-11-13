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
const NETZ_ENDUNGEN = ['.stl', '.3mf'];

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
      raus.push({ name, pfad: pfad + name, groesse: datei.size, handle: eintrag });
    }
  }
  return raus;
}

async function modellOeffnen() {
  try {
    const { ansicht } = await chrome.storage.local.get('ansicht');
    if (ansicht) darstellung = ansicht;
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

  document.title = titel + ' – 3D Model Auto-Downloader';
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
  zeichneListe();

  // Gleich etwas zeigen: das erste Netz, sonst das erste Bild.
  const zuerst = dateien.find((d) => NETZ_ENDUNGEN.includes(endungVon(d.name)))
    || dateien.find((d) => BILD_ENDUNGEN.includes(endungVon(d.name)));
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

async function zeigeHerkunft() {
  const adresseEl = document.getElementById('adresse');
  const beschreibungEl = document.getElementById('beschreibung');
  try {
    const datei = await (await modellHandle.getFileHandle('info.txt')).getFile();
    const { kopf, beschreibung } = zerlegeInfo(await datei.text());

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
    if (beschreibung) {
      beschreibungEl.textContent = beschreibung;
      beschreibungEl.hidden = false;
    }
  } catch { /* ohne info.txt bleibt die Zeile, wie sie ist */ }
}

// --- Liste links --------------------------------------------------------

function zeichneListe() {
  dateienEl.textContent = '';
  for (const d of dateien) {
    const knopf = document.createElement('button');
    knopf.className = 'datei';
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
    name.textContent = d.pfad;
    const groesse = document.createElement('div');
    groesse.className = 'groesse';
    groesse.textContent = formatGroesse(d.groesse);
    text.append(name, groesse);

    knopf.append(bild, text);
    knopf.addEventListener('click', () => waehle(d));
    dateienEl.appendChild(knopf);

    d.knopf = knopf;
    d.bildFach = bild;
    if (BILD_ENDUNGEN.includes(endung) || NETZ_ENDUNGEN.includes(endung)) {
      beobachter.observe(knopf);
      knopf.__datei = d;
    }
  }
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

const schlange = [];
let arbeitet = false;

function reiheEin(d) {
  schlange.push(d);
  if (!arbeitet) naechstesBild();
}

async function naechstesBild() {
  arbeitet = true;
  while (schlange.length) {
    const d = schlange.shift();
    try {
      const url = await kleinesBild(d);
      if (url) {
        bildUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        d.bildFach.replaceChildren(img);
      }
    } catch { /* dann bleibt die Endung stehen */ }
  }
  arbeitet = false;
}

async function kleinesBild(d) {
  const endung = endungVon(d.name);
  if (BILD_ENDUNGEN.includes(endung)) {
    return URL.createObjectURL(await d.handle.getFile());
  }

  // Ein 3MF trägt ein fertiges Vorschaubild im Paket - deshalb zeigt auch
  // der Windows-Explorer Modelle an, ohne sie zu zeichnen. Das herauszuholen
  // kostet Millisekunden, während das Netz bei großen Dateien Sekunden
  // braucht: Die Eisbär-Datei bringt 534 MB XML mit.
  if (endung === '.3mf') {
    try {
      const zip = liesZip(await (await d.handle.getFile()).arrayBuffer());
      const bild = await bild3mf(zip);
      if (bild) return URL.createObjectURL(bild.blob);
    } catch { /* kein Bild im Paket - dann eben zeichnen */ }
  }

  const netze = await netzeVon(d);
  if (!netze?.length) return null;
  // Braucht den Betrachter - er bringt Renderer und Umgebung mit.
  const blob = await erzeugeVorschau(netze, 128, darstellung);
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

async function netzeVon(d) {
  const gemerkt = netzSpeicher.get(d.pfad);
  if (gemerkt) return gemerkt;

  const puffer = await (await d.handle.getFile()).arrayBuffer();
  const netze = endungVon(d.name) === '.3mf'
    ? await lies3mf(liesZip(puffer))
    : (() => {
        const { ecken } = liesStl(puffer);
        return ecken.length ? [{ ecken, indizes: null }] : [];
      })();
  return merkeNetze(d.pfad, netze);
}

// --- Große Darstellung --------------------------------------------------

function zeigeBalken(an) {
  document.getElementById('fortschritt').hidden = !an;
  document.getElementById('balken').style.width = an ? '35%' : '0';
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
  if (!teileModus) waehleTeil(null);
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
  // großen Dateien Sekunden. Deshalb erst auf Knopfdruck.
  zerlegbar = !netze.teile && netze.length === 1 && netze[0].ecken.length > 0;
  modusKnopf.hidden = aktuelleTeile.length < 2 && !zerlegbar;

  if (aktuelleTeile.length > 1) baueTeileListe();
}

function baueTeileListe() {
  teileListe.textContent = '';
  for (const teil of aktuelleTeile) {
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
    teileListe.appendChild(knopf);
  }
}

// Sucht in einem STL die zusammenhängenden Körper. Läuft im Vordergrund
// und blockiert dabei die Seite - deshalb vorher die Beschriftung ändern
// und dem Browser Zeit lassen, sie auch zu zeichnen.
async function zerlegeJetzt() {
  modusKnopf.disabled = true;
  modusKnopf.textContent = t('modelSplitting');
  await new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig)));

  try {
    const koerper = zerlegeNetz(aktuelleNetze[0].ecken);
    zerlegbar = false;
    if (koerper.length < 2) {
      teilInfo.hidden = false;
      teilInfo.textContent = t('modelOneBody');
      modusKnopf.hidden = true;
      return false;
    }
    koerper.teile = koerper.map((_, i) => ({ nummer: i, name: '' }));
    aktuelleNetze = koerper;
    aktuelleTeile = koerper.teile;
    betrachter.setzeNetze(koerper);
    baueTeileListe();
    return true;
  } finally {
    modusKnopf.disabled = false;
    modusKnopf.textContent = t(teileModus ? 'modelSplitOff' : 'modelSplit');
  }
}

// Nochmals auf dasselbe Teil heben die Auswahl wieder auf - so kommt man
// ohne Umweg zurück zur Gesamtansicht.
function waehleTeil(nr) {
  gewaehltesTeil = (nr === null || nr === gewaehltesTeil) ? null : nr;

  if (betrachter) {
    betrachter.hervor = gewaehltesTeil;
    betrachter.zeichne();
  }
  for (const knopf of teileListe.children) {
    knopf.setAttribute('aria-current',
      String(Number(knopf.dataset.nr) === gewaehltesTeil));
  }
  teilKnopf.disabled = gewaehltesTeil === null;
  teilInfo.hidden = true;

  zeigeMasse(gewaehltesTeil === null
    ? betrachter?.groesse
    : masseVon(netzeVonTeil(gewaehltesTeil)));
}

function stlName(teil) {
  const basis = aktuelleDatei.name.replace(/\.[^.]+$/, '');
  const nr = String(teil.nummer + 1).padStart(2, '0');
  const name = (teil.name || '').replace(/[<>:"/\\|?*]/g, '_').trim();
  return basis + '_' + nr + (name ? '_' + name : '') + '.stl';
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
      await schreibeDatei(ziel, stlName(teil), schreibeStl(netzeVonTeil(teil.nummer)));
    }

    teilInfo.textContent = welche.length > 1
      ? t('modelSavedMany', [String(welche.length), TEILE_ORDNER])
      : t('modelSavedOne', [TEILE_ORDNER + '\\' + stlName(welche[0])]);

    // Die neuen Dateien sollen gleich in der Liste stehen.
    dateien = (await sammle(modellHandle)).sort((a, b) => a.pfad.localeCompare(b.pfad));
    zeichneListe();
  } catch (err) {
    teilInfo.textContent = t('libError', [err.message]);
  } finally {
    teilKnopf.disabled = gewaehltesTeil === null;
    alleKnopf.disabled = false;
  }
}

modusKnopf.addEventListener('click', async () => {
  // Beim ersten Mal muss ein STL erst zerlegt werden; danach liegt die
  // Liste vor und der Schalter wechselt nur noch hin und her.
  if (!teileModus && zerlegbar && !await zerlegeJetzt()) return;
  setzeTeileModus(!teileModus);
});

teilKnopf.addEventListener('click', () => {
  const teil = aktuelleTeile.find((t2) => t2.nummer === gewaehltesTeil);
  if (teil) speichereTeile([teil]);
});
alleKnopf.addEventListener('click', () => speichereTeile(aktuelleTeile));

async function waehle(d) {
  for (const andere of dateien) andere.knopf?.setAttribute('aria-current', String(andere === d));

  const endung = endungVon(d.name);
  mitteEl.hidden = true;
  lageEl.hidden = true;
  masseEl.hidden = true;
  teileFach.hidden = true;
  modusKnopf.hidden = true;
  dateienEl.hidden = false;
  teileModus = false;

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
  try {
    const netze = await netzeVon(d);
    if (!netze.length) throw new Error('leer');
    betrachter.setzeNetze(netze);
    // Ein Klick ins Bild holt die Teileliste gleich mit hervor - sonst
    // leuchtet etwas auf, und man sähe nicht, was es ist.
    betrachter.beiAuswahl = (nr) => {
      if (nr !== null && !teileModus) setzeTeileModus(true);
      waehleTeil(nr);
    };
    lageEl.hidden = false;
    zeigeMasse(betrachter.groesse);
    zeigeTeile(d, netze);
    zeigeFarbSchalter();
  } catch (err) {
    leinwand.hidden = true;
    mitteEl.textContent = t('modelReadFailed', [d.name]);
    mitteEl.hidden = false;
  } finally {
    zeigeBalken(false);
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
  ['rGamma',    'gamma',        1,             2, 'wGamma',    '']
];

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

async function reglerSichern() {
  darstellung = {};
  for (const [, feld] of REGLER) darstellung[feld] = betrachter[feld];
  for (const [, feld] of FARBREGLER) darstellung[feld] = betrachter[feld];
  darstellung.dateiFarben = betrachter.dateiFarben;
  try { await chrome.storage.local.set({ ansicht: darstellung }); } catch { /* nicht schlimm */ }
}

async function reglerEinrichten() {
  standard = {};
  for (const [, feld] of REGLER) standard[feld] = betrachter[feld];
  for (const [, feld] of FARBREGLER) standard[feld] = [...betrachter[feld]];

  Object.assign(betrachter, darstellung);

  for (const [id, feld, faktor, stellen, anzeige, einheit] of REGLER) {
    document.getElementById(id).addEventListener('input', (e) => {
      const wert = Number(e.target.value);
      betrachter[feld] = wert * faktor;
      zeigeWert(anzeige, wert, stellen, einheit);
      betrachter.zeichne();
      reglerSichern();
    });
  }
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
    betrachter.zeichne();
    reglerSichern();
  });

  reglerAnzeigen();
  betrachter.zeichne();
  document.getElementById('regler').hidden = false;
}

// --- Knöpfe -------------------------------------------------------------

document.getElementById('zurueck').addEventListener('click', (e) => {
  e.preventDefault();
  location.href = chrome.runtime.getURL('library.html');
});

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
  const unter = (IM_KORB ? PAPIERKORB + '/' : '') + ORDNER;
  const erg = await explorerOeffnenUndPruefen(explorerUrl(exp.pfad, unter), modellHandle);
  explorerEl.disabled = false;
  explorerEl.textContent = t('libOpenExplorer');
  if (!erg.ok) {
    zeigeHinweis(t('libExpNoScript'), 'explorer',
                 exp.pfad.replace(/[\\/]+$/, '') + '\\' + unter.replace(/\//g, '\\'));
  }
});

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
    const korb = await wurzel.getDirectoryHandle(PAPIERKORB);
    const ziel = await freierName(wurzel, ORDNER.replace(GELOESCHT, ''));
    await verschiebe(korb, ORDNER, wurzel, ziel);
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

// --- Verschieben (wie in der Übersicht) ---------------------------------

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

// Ordner lassen sich nicht verschieben, einzelne Dateien schon. Scheitert
// move(), wird kopiert - Näheres in library.js, wo dasselbe passiert.
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

// --- Start --------------------------------------------------------------

addEventListener('beforeunload', () => {
  for (const u of bildUrls) URL.revokeObjectURL(u);
});

modellOeffnen().catch((err) => {
  mitteEl.textContent = t('libError', [err.message]);
  mitteEl.hidden = false;
});
