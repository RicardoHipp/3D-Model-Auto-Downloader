// Eigene Tags und der Zwischenspeicher der Bibliothek.
//
// Wo die Tags stehen: als Zeile "Tags: Garten, Werkzeug" im Kopf der
// info.txt des Modells. Damit wandern sie mit dem Ordner - auf einen anderen
// Rechner, aufs NAS, durch eine Neuinstallation der Erweiterung - und lassen
// sich auch mit dem Editor aendern. Fehlt die info.txt, entsteht sie beim
// ersten Tag.
//
// Damit die Bibliothek nicht bei jedem Oeffnen alle Ordner lesen muss, merkt
// sie sich je Modell, was sie fuer die Kachel braucht (Titel, Plattform,
// Datum, Tags, ein kleines Vorschaubild) in einer eigenen IndexedDB. Die ist
// nur Zwischenspeicher: Die Seite zeigt sofort ihren Stand und gleicht danach
// im Hintergrund mit den Ordnern ab. Geht sie verloren, baut sie sich aus
// den Ordnern wieder auf.
//
// Gross- und Kleinschreibung zaehlen nicht: "Garten" und "garten" sind
// derselbe Tag. Geschrieben wird er so, wie er zuerst vergeben wurde.
//
// Genutzt von library.html und model.html.

// --- Zwischenspeicher -------------------------------------------------------
//
// Eigene Datenbank, nicht die der Zielordner-Handles (target_dir.js): Die
// oeffnen Service Worker und Offscreen-Seite mit Version 1, ein neuer Speicher
// darin braeuchte Version 2 - und dann scheiterten sie.
const BIB_DB = 'stl-bibliothek';
const BIB_STORE = 'modelle';

let bibDbVersprechen = null;
function bibDb() {
  if (!bibDbVersprechen) {
    bibDbVersprechen = new Promise((fertig, fehler) => {
      const anfrage = indexedDB.open(BIB_DB, 1);
      anfrage.onupgradeneeded = () => anfrage.result.createObjectStore(BIB_STORE, { keyPath: 'name' });
      anfrage.onsuccess = () => fertig(anfrage.result);
      anfrage.onerror = () => { bibDbVersprechen = null; fehler(anfrage.error); };
    });
  }
  return bibDbVersprechen;
}

async function bibTx(modus, tat) {
  const db = await bibDb();
  return new Promise((fertig, fehler) => {
    const tx = db.transaction(BIB_STORE, modus);
    const anfrage = tat(tx.objectStore(BIB_STORE));
    tx.oncomplete = () => fertig(anfrage?.result);
    tx.onerror = () => fehler(tx.error);
    tx.onabort = () => fehler(tx.error);
  });
}

async function bibAlle() {
  try { return (await bibTx('readonly', (s) => s.getAll())) || []; } catch { return []; }
}

async function bibHole(name) {
  try { return (await bibTx('readonly', (s) => s.get(name))) || null; } catch { return null; }
}

// Schreibt mehrere Eintraege und loescht andere - in einem Rutsch.
async function bibSchreibe(eintraege = [], weg = []) {
  if (!eintraege.length && !weg.length) return;
  try {
    await bibTx('readwrite', (s) => {
      for (const e of eintraege) s.put(e);
      for (const n of weg) s.delete(n);
    });
  } catch { /* nur Zwischenspeicher - beim naechsten Abgleich wieder */ }
}

// --- Tags -------------------------------------------------------------------

const tagSchluessel = (tag) => tag.toLocaleLowerCase();

// Aufgeraeumt: keine Kommas (die trennen), keine doppelten Leerzeichen.
function tagSauber(tag) {
  return String(tag || '').replace(/[,\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// Ohne Doppelte (gleich bis auf Gross-/Kleinschreibung), Reihenfolge bleibt.
function tagsEinmalig(tags) {
  const gesehen = new Set();
  const raus = [];
  for (const roh of tags) {
    const tag = tagSauber(roh);
    if (!tag || gesehen.has(tagSchluessel(tag))) continue;
    gesehen.add(tagSchluessel(tag));
    raus.push(tag);
  }
  return raus;
}

function hatTag(tags, tag) {
  const s = tagSchluessel(tag);
  return (tags || []).some((x) => tagSchluessel(x) === s);
}

// --- info.txt ---------------------------------------------------------------
//
// Kopf: Zeilen "Schluessel: Wert", davor Erlaeuterungen mit #, nach der
// ersten Leerzeile freier Text (siehe infoInhalt in background.js). Gesucht
// wird wie in model.js (zerlegeInfo): Der Kopf beginnt mit der ersten Zeile
// mit Doppelpunkt und endet an der naechsten Leerzeile.
function infoKopfBereich(zeilen) {
  let anfang = -1;
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.startsWith('#')) continue;
    if (!z.trim()) { if (anfang >= 0) return { anfang, ende: i }; continue; }
    if (anfang < 0 && z.includes(':')) anfang = i;
    if (anfang < 0) return null;          // Text vor jedem Kopf: fremde Datei
  }
  return anfang >= 0 ? { anfang, ende: zeilen.length } : null;
}

function tagsAusInfo(text) {
  const zeilen = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const kopf = infoKopfBereich(zeilen);
  if (!kopf) return [];
  for (let i = kopf.anfang; i < kopf.ende; i++) {
    const m = zeilen[i].match(/^\s*tags\s*:(.*)$/i);
    if (m) return tagsEinmalig(m[1].split(','));
  }
  return [];
}

// Neuer Inhalt der info.txt mit diesen Tags. Alles andere bleibt, wie es ist.
function infoMitTags(text, tags, titel) {
  const zeile = 'Tags: ' + tags.join(', ');
  if (text == null) {
    // Noch keine info.txt - dieselbe Form, wie sie beim Herunterladen entsteht.
    return [
      '# ' + chrome.i18n.getMessage('appName'),
      '# ' + chrome.i18n.getMessage('infoHeader'),
      '',
      'Titel: ' + (titel || ''),
      zeile,
      '',
      ''
    ].join('\r\n');
  }
  const zeilen = text.replace(/^﻿/, '').split(/\r?\n/);
  const kopf = infoKopfBereich(zeilen);
  if (!kopf) {
    // Fremde Datei ohne Kopf: einen voranstellen, den Rest nicht anfassen.
    if (!tags.length) return null;
    return [zeile, '', ...zeilen].join('\r\n');
  }
  for (let i = kopf.anfang; i < kopf.ende; i++) {
    if (/^\s*tags\s*:/i.test(zeilen[i])) {
      if (tags.length) zeilen[i] = zeile; else zeilen.splice(i, 1);
      return zeilen.join('\r\n');
    }
  }
  if (!tags.length) return null;
  zeilen.splice(kopf.ende, 0, zeile);
  return zeilen.join('\r\n');
}

async function liesInfo(ordner) {
  try {
    return await (await (await ordner.getFileHandle('info.txt')).getFile()).text();
  } catch {
    return null;
  }
}

// Schreibt die Tags in die info.txt des Ordners. Gibt die neue Aenderungszeit
// der Datei zurueck - die braucht der Zwischenspeicher, um die eigene
// Aenderung beim naechsten Abgleich nicht fuer eine fremde zu halten.
async function schreibeTags(ordner, tags, titel) {
  const neu = infoMitTags(await liesInfo(ordner), tags, titel);
  const datei = await ordner.getFileHandle('info.txt', { create: true });
  if (neu != null) {
    const strom = await datei.createWritable();
    await strom.write(neu);
    await strom.close();
  }
  return (await datei.getFile()).lastModified;
}

// --- Eingabe fuer Tags ------------------------------------------------------
//
// Kaertchen mit x zum Entfernen, dahinter ein Feld fuer neue Tags. Enter oder
// Komma uebernimmt. Wird ein Tag eingegeben, den es in anderer Schreibweise
// schon gibt, gilt die vorhandene.
//
// Die schon vergebenen Tags stehen darunter (vorschlagOrt) als Kaertchen zum
// Anklicken - statt einer Auswahlliste am Feld. Tippen grenzt sie ein.
//
//   stand()        -> [{ tag, teilweise }]   was gerade gezeigt wird
//   vorschlaege()  -> [tag]                  alle bekannten Tags
//   hinzu(tag), weg(tag)                     asynchron; danach neu gezeichnet
function tagEingabe(behaelter, { stand, vorschlaege, hinzu, weg, vorschlagOrt }) {
  const t = (k, s) => chrome.i18n.getMessage(k, s);
  behaelter.classList.add('tagEingabe');
  vorschlagOrt?.classList.add('tagVorschlaege');

  const zeigeVorschlaege = () => {
    if (!vorschlagOrt) return;
    vorschlagOrt.textContent = '';
    // Was alle schon haben, braucht keinen Vorschlag; Tags, die nur ein Teil
    // der markierten Modelle hat, schon - ein Klick gibt sie allen.
    const schon = new Set(stand().filter((s) => !s.teilweise).map((s) => tagSchluessel(s.tag)));
    const filter = tagSchluessel(tagSauber(feld()?.value || ''));
    for (const v of vorschlaege()) {
      if (schon.has(tagSchluessel(v))) continue;
      if (filter && !tagSchluessel(v).includes(filter)) continue;
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'tag vorschlag';
      knopf.textContent = '+ ' + v;
      // Fokus im Feld lassen: Sonst verschwindet die Liste dort, wo sie nur
      // beim Tippen zu sehen ist, bevor der Klick ankommt.
      knopf.addEventListener('mousedown', (e) => e.preventDefault());
      knopf.addEventListener('click', async () => {
        await hinzu(v);
        zeichne();
        feld().focus();
      });
      vorschlagOrt.appendChild(knopf);
    }
    vorschlagOrt.hidden = !vorschlagOrt.childElementCount;
  };

  const zeichne = () => {
    behaelter.textContent = '';
    for (const { tag, teilweise } of stand()) {
      const chip = document.createElement('span');
      chip.className = 'tag' + (teilweise ? ' teilweise' : '');
      if (teilweise) chip.title = t('libTagsPartial');
      const name = document.createElement('span');
      name.textContent = tag;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tagWeg';
      x.textContent = '×';
      x.title = t('libTagRemove');
      x.setAttribute('aria-label', t('libTagRemove') + ': ' + tag);
      x.addEventListener('mousedown', (e) => e.preventDefault());
      x.addEventListener('click', async () => { await weg(tag); zeichne(); feld().focus(); });
      chip.append(name, x);
      behaelter.appendChild(chip);
    }
    const eingabe = document.createElement('input');
    eingabe.type = 'text';
    eingabe.className = 'tagFeld';
    eingabe.placeholder = t('libTagAdd');
    eingabe.autocomplete = 'off';
    eingabe.maxLength = 60;
    const uebernimm = async () => {
      let tag = tagSauber(eingabe.value);
      eingabe.value = '';
      if (!tag) { zeigeVorschlaege(); return; }
      tag = vorschlaege().find((v) => tagSchluessel(v) === tagSchluessel(tag)) || tag;
      await hinzu(tag);
      zeichne();
      feld().focus();
    };
    eingabe.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); uebernimm(); }
      else if (e.key === 'Backspace' && !eingabe.value) {
        const letzter = stand().at(-1);
        if (letzter) weg(letzter.tag).then(() => { zeichne(); feld().focus(); });
      }
    });
    eingabe.addEventListener('input', zeigeVorschlaege);
    behaelter.appendChild(eingabe);
    zeigeVorschlaege();
  };
  const feld = () => behaelter.querySelector('.tagFeld');
  zeichne();
  return { zeichne, feld };
}
