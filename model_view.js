// Eigener WebGL2-Renderer für Dreiecksnetze.
//
// Bewusst klein gehalten: Was hier nicht drin ist, brauchen wir für eine
// Modellvorschau nicht. Kein Szenengraph, keine Materialien, keine Schatten.
//
// Normalen liefert niemand mit: Der Fragment-Shader rechnet sie aus den
// Ableitungen der Weltposition aus (dFdx/dFdy). Das ergibt flache
// Schattierung, zeigt also jede Facette - für eine Druckvorschau genau
// richtig - und spart den halben Speicher gegenüber mitgelieferten Normalen.
//
// Eigener Gueltigkeitsbereich: Alle Skripte einer Seite teilen sich einen
// Namensraum, und gleich benannte Hilfsfunktionen würden sich sonst
// gegenseitig überschreiben.
(() => {

const ECKPUNKT_SHADER = `#version 300 es
in vec3 lage;
uniform mat4 mvp;
uniform mat4 modell;
out vec3 welt;
void main() {
  welt = (modell * vec4(lage, 1.0)).xyz;
  gl_Position = mvp * vec4(lage, 1.0);
}`;

const FLAECHEN_SHADER = `#version 300 es
precision highp float;
in vec3 welt;
uniform vec3 auge;
uniform vec3 farbe;
uniform vec3 lichtRichtung;
// x = Grundhelligkeit, y = Kopflicht, z = zweites Licht, w = Kantenschimmer
uniform vec4 staerken;
uniform float gamma;
uniform float deckkraft;
out vec4 ergebnis;

void main() {
  // Normale aus der Fläche selbst - unabhängig davon, was in der Datei stand
  vec3 n = normalize(cross(dFdx(welt), dFdy(welt)));
  vec3 zumAuge = normalize(auge - welt);
  if (dot(n, zumAuge) < 0.0) n = -n;          // Rückseiten mit beleuchten

  // Kopflicht sitzt in der Kamera und dreht mit; das zweite steht fest im
  // Raum, damit beim Drehen überhaupt etwas von der Form sichtbar wird.
  float haupt = max(dot(n, zumAuge), 0.0);
  float zweit = max(dot(n, normalize(lichtRichtung)), 0.0);
  float rand  = pow(1.0 - haupt, 3.0);

  vec3 licht = farbe * (staerken.x + staerken.y * haupt + staerken.z * zweit)
             + vec3(staerken.w) * rand;
  ergebnis = vec4(pow(licht, vec3(1.0 / gamma)), deckkraft);
}`;

// Drahtgitter: nur die Kanten der Dreiecke, in einer Farbe mit Deckkraft.
// Eigenes Programm - der Flaechenshader rechnet seine Normale aus der
// Flaeche, und die gibt es bei Linien nicht.
//
// Deckkraft nach Dichte: kantePx ist die typische Kantenlaenge des Netzes
// in Bildpunkten im Abstand 1. Geteilt durch den Abstand des Punkts ergibt
// sich, wie lang eine Kante dort auf dem Bildschirm ist. Ab GITTER_VOLL
// Bildpunkten voll, darunter anteilig durchsichtiger: Halb so lange Kanten
// heisst doppelt so viele Linien uebereinander, jede halb so deckend - in
// der Summe bleibt ein gleichmaessiger Schleier, statt dass ein feines
// Modell herausgezoomt ganz dunkel (oder bei "nur Gitter" weiss) wird.
// GITTER_MIN haelt die Linien sichtbar: Darunter wuerde die Mischung in
// 8 Bit gar nichts mehr aendern, und das Gitter wirkte abgeschaltet.
const GITTER_VOLL = 8.0;
const GITTER_MIN = 0.015;
const LINIEN_SHADER = `#version 300 es
precision highp float;
in vec3 welt;
uniform vec4 linienFarbe;
uniform vec3 auge;
uniform float kantePx;
out vec4 ergebnis;
void main() {
  float px = kantePx / max(distance(auge, welt), 1e-6);
  float a = max(linienFarbe.a * clamp(px / ${GITTER_VOLL.toFixed(1)}, 0.0, 1.0), ${GITTER_MIN});
  ergebnis = vec4(linienFarbe.rgb, a);
}`;

// Typische Kantenlaenge eines Netzes: Median ueber bis zu 30000 gleichmaessig
// verteilte Dreiecke. Der Median, weil einzelne lange Kanten (grosse ebene
// Flaechen in CAD-Exporten) den Mittelwert verzerren wuerden.
function typischeKante({ ecken, indizes }) {
  const dreiecke = Math.floor((indizes ? indizes.length : ecken.length / 3) / 3);
  if (!dreiecke) return 0;
  const schritt = Math.max(1, Math.floor(dreiecke / 30000));
  const laengen = [];
  const ecke = (i) => (indizes ? indizes[i] : i) * 3;
  for (let d = 0; d < dreiecke; d += schritt) {
    for (let k = 0; k < 3; k++) {
      const a = ecke(d * 3 + k), b = ecke(d * 3 + (k + 1) % 3);
      laengen.push(Math.hypot(ecken[a] - ecken[b], ecken[a + 1] - ecken[b + 1], ecken[a + 2] - ecken[b + 2]));
    }
  }
  laengen.sort((x, y) => x - y);
  return laengen[laengen.length >> 1];
}

// --- Ansicht "Rendern" ----------------------------------------------------
//
// Weich schattiert mit three.js - siehe model_drei.js.
//
// Bildwinkel: 35 Grad wie ein Fotoobjektiv, fuer beide Ansichten gleich -
// sonst springt beim Umschalten die Perspektive. Frueher zeichnete die
// flache Ansicht mit 0,9 (gut 50 Grad); der Zoom ("abstand") ist noch in
// diesem Mass gespeichert, die Kamera rueckt entsprechend weiter weg, damit
// das Modell gleich gross im Bild bleibt.
const SICHT = 35 * Math.PI / 180;
const ALTE_SICHT = 0.9;
// Ab hier gilt eine Kante als Kante und wird nicht geglaettet. Ueblich sind
// 30-40 Grad; bei CAD-Exporten mit grossen Dreiecken auf ebenen
// Flaechen zieht das helle Flecken ueber die Flaeche (Fasen unter dem
// Grenzwinkel werden mitgeglaettet). Erst 15 Grad, dann 20 Grad als
// Standard gewaehlt. Einstellbar unter "Darstellung".
const KNICKWINKEL = 20 * Math.PI / 180;

// Zum Anklicken: Dieselbe Szene wird noch einmal gezeichnet, jedes Netz in
// einer eigenen Farbe, die seine Nummer verschlüsselt. Danach wird genau
// das eine Pixel unter dem Mauszeiger ausgelesen. Das trifft auch dann das
// Richtige, wenn Teile ineinanderstecken - anders als ein Vergleich von
// Hüllquadern.
const KENN_SHADER = `#version 300 es
precision highp float;
in vec3 welt;
uniform vec4 kennung;
out vec4 ergebnis;
void main() { ergebnis = kennung; }`;

// --- Matrizen (Spaltenvektoren, wie WebGL sie erwartet) -----------------

function perspektive(sicht, seiten, nah, fern) {
  const f = 1 / Math.tan(sicht / 2);
  return new Float32Array([
    f / seiten, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (fern + nah) / (nah - fern), -1,
    0, 0, (2 * fern * nah) / (nah - fern), 0
  ]);
}

function blickVon(auge, ziel, oben) {
  const z = normiere(minus(auge, ziel));
  const x = normiere(kreuz(oben, z));
  const y = kreuz(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -punkt(x, auge), -punkt(y, auge), -punkt(z, auge), 1
  ]);
}

function malMatrix(a, b) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      r[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1]
        + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
    }
  }
  return r;
}

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const kreuz = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const punkt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function normiere(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// --- Filamentfarben -------------------------------------------------------
//
// Sortiert die Dreiecke eines Netzes nach Filament und merkt sich, wo im
// Indexpuffer welche Farbe beginnt. So genuegt beim Zeichnen ein Aufruf je
// Farbe, und der Shader bleibt, wie er ist.
//
// netz.dreieckFarbe: Filamentnummer je Dreieck, 0 = unbemalt
// netz.extruder:     Filament des Teils, gilt fuer alles Unbemalte
function farbBereiche(netz, farbtafel) {
  // Bringt das Netz eine feinere Zerlegung mit - fuer teilweise bemalte
  // Dreiecke -, wird die gezeichnet; sie hat ihre eigene Farbliste.
  const indizes = netz.feinIndizes || netz.indizes;
  const dreieckFarbe = netz.feinIndizes ? netz.feinFarbe : netz.dreieckFarbe;
  const extruder = netz.extruder;
  if (!indizes?.length || !farbtafel.length || !extruder) return null;

  const dreiecke = indizes.length / 3;
  const filamentVon = (d) => (dreieckFarbe && dreieckFarbe[d]) || extruder;

  // Zaehlen, dann in einem Rutsch einsortieren.
  const anzahl = new Uint32Array(256);
  for (let d = 0; d < dreiecke; d++) anzahl[filamentVon(d)]++;

  const start = new Uint32Array(256);
  const liste = [];
  let ab = 0;
  for (let f = 0; f < 256; f++) {
    if (!anzahl[f]) continue;
    start[f] = ab;
    // Fehlt die Farbe in der Tafel, gilt die des ersten Filaments.
    const hex = farbtafel[f - 1] || farbtafel[0] || '#808080';
    liste.push({ filament: f, hex, farbe: alsFarbe(hex), ab: ab * 3, anzahl: anzahl[f] * 3 });
    ab += anzahl[f];
  }

  const sortiert = new Uint32Array(indizes.length);
  for (let d = 0; d < dreiecke; d++) {
    const ziel = start[filamentVon(d)]++ * 3;
    sortiert[ziel] = indizes[d * 3];
    sortiert[ziel + 1] = indizes[d * 3 + 1];
    sortiert[ziel + 2] = indizes[d * 3 + 2];
  }
  return { indizes: sortiert, liste };
}

// "#RRGGBB" in die Werte, mit denen der Shader rechnet. Zwei Anpassungen:
// Reines Weiss wuerde unter dem Kopflicht flaechig ausbrennen und reines
// Schwarz vor dem schwarzen Hintergrund verschwinden - also oben etwas
// gedaempft und unten leicht angehoben. Die Voreinstellung #41618b liegt
// im selben Helligkeitsbereich.
function alsFarbe(hex) {
  const zahl = parseInt(hex.slice(1, 7), 16);
  return new Float32Array(
    [(zahl >> 16) & 255, (zahl >> 8) & 255, zahl & 255].map((w) => 0.06 + 0.8 * w / 255));
}

// --- Renderer -----------------------------------------------------------

class Betrachter {
  // fuerBild: Die Leinwand hängt nicht in der Seite, hat also keine
  // gemessene Größe - dann gilt ihre eigene, und der Inhalt muss nach dem
  // Zeichnen erhalten bleiben, damit toBlob() ihn noch vorfindet.
  constructor(leinwand, { fuerBild = false } = {}) {
    this.leinwand = leinwand;
    this.festeGroesse = fuerBild;
    const gl = leinwand.getContext('webgl2', {
      antialias: true, depth: true, preserveDrawingBuffer: fuerBild
    });
    if (!gl) throw new Error('WebGL2 steht nicht zur Verfügung');
    this.gl = gl;

    this.programm = baueProgramm(gl, ECKPUNKT_SHADER, FLAECHEN_SHADER);
    this.linienProgramm = baueProgramm(gl, ECKPUNKT_SHADER, LINIEN_SHADER);
    this.linienOrte = {
      lage:  gl.getAttribLocation(this.linienProgramm, 'lage'),
      mvp:   gl.getUniformLocation(this.linienProgramm, 'mvp'),
      modell: gl.getUniformLocation(this.linienProgramm, 'modell'),
      farbe: gl.getUniformLocation(this.linienProgramm, 'linienFarbe'),
      auge:  gl.getUniformLocation(this.linienProgramm, 'auge'),
      kantePx: gl.getUniformLocation(this.linienProgramm, 'kantePx')
    };
    // Drahtgitter: 'aus', 'darueber' (Linien ueber dem Modell) oder 'nur'
    // (nur die Linien). Wird nicht gemerkt.
    this.gitter = 'aus';
    this.orte = {
      lage:   gl.getAttribLocation(this.programm, 'lage'),
      mvp:    gl.getUniformLocation(this.programm, 'mvp'),
      modell: gl.getUniformLocation(this.programm, 'modell'),
      auge:   gl.getUniformLocation(this.programm, 'auge'),
      farbe:  gl.getUniformLocation(this.programm, 'farbe'),
      licht:  gl.getUniformLocation(this.programm, 'lichtRichtung'),
      staerken: gl.getUniformLocation(this.programm, 'staerken'),
      gamma:  gl.getUniformLocation(this.programm, 'gamma'),
      deckkraft: gl.getUniformLocation(this.programm, 'deckkraft')
    };

    gl.enable(gl.DEPTH_TEST);

    this.netze = [];
    this.mitte = [0, 0, 0];
    this.radius = 1;

    // Nummer des hervorgehobenen Teils; null heisst: alle gleich hell.
    this.hervor = null;
    // Teilnummern, die nicht gezeichnet werden (Teileansicht: ausblenden).
    this.ausgeblendet = new Set();
    // Mehrfarbige Dateien in ihren Filamentfarben zeigen. hatDateiFarben
    // sagt, ob die aktuelle Datei ueberhaupt welche mitbringt.
    this.dateiFarben = true;
    this.hatDateiFarben = false;
    // Wird gerufen, wenn jemand ins Bild klickt - mit der Teilnummer oder
    // null fuer den leeren Hintergrund.
    this.beiAuswahl = null;
    this.kennProgramm = null;
    this.kennRahmen = null;

    // Ansicht "Rendern": weich schattiert mit three.js (model_drei.js). Die
    // Netze dafuer entstehen erst beim Einschalten, im Hintergrund; bis sie
    // da sind, bleibt es flach. beiRendern meldet, ob gerade gerechnet wird.
    this.rendern = false;
    this.drei = null;
    this.dreiLauf = 0;
    this.dreiArbeiter = null;
    this.beiRendern = null;
    this.rendernRechnet = false;
    // Ab hier gilt eine Kante als Kante und wird nicht geglaettet (Bogenmass).
    this.knickwinkel = KNICKWINKEL;
    // Feld "Filamente": geaenderte Farbtafel (null = die der Datei) und das
    // Filament, das gerade hervorgehoben wird (null = keines).
    this.filamentTafel = null;
    this.hervorFilament = null;
    // Umgefaerbte Filamente nur in einzelnen Teilen: Map Teil -> Map
    // Filament -> "#rrggbb". null = keine.
    this.teilFarben = null;
    // Hervorheben nur innerhalb eines Teils (Feld "Filamente" in der
    // Teileansicht), sonst null.
    this.hervorTeil = null;
    // Wie das hervorgehobene Filament sich abhebt: 'grau' (die anderen
    // hellgrau), 'glas' (die anderen durchscheinend), 'puls' (es pulsiert,
    // der Rest bleibt), 'dunkel' (die anderen abgedunkelt) oder 'aus'.
    this.hervorArt = 'puls';
    this.pulsLaeuft = false;
    // Licht und Material der gerenderten Ansicht, einstellbar unter
    // "Darstellung", solange "Rendern" an ist. Nach Auge abgestimmt.
    this.dreiBelichtung = 1.2;
    this.dreiUmgebung = 0.25;
    this.dreiHaupt = 2.5;
    this.dreiFuell = 1.5;
    this.dreiKante = 0;
    this.dreiRauheit = 0.55;
    this.dreiSchatten = 0.2;
    this.dreiKarte = 4096;     // Punkte je Seite der Schattenkarte (Testregler)
    // Glaettung von Maus und Rad in ms (siehe bewege). 60 ms wirken ruhig,
    // ohne dass das Modell spuerbar hinterherhaengt.
    this.glaettung = 60;
    this.fpsGrenze = 0;
    this.drehTempo = 0;

    // Kameralage: Winkel um die Hochachse, Höhenwinkel, Abstand.
    // Hochachse ist Z - so legen es STL und 3MF im 3D-Druck ab. Mit der in
    // der Grafik üblichen Y-Achse läge jedes Modell auf der Seite.
    // Und von vorn: Was ein Slicer als Vorderseite ablegt, liegt in
    // Richtung -Y; von +Y aus sähe man dem Modell auf den Rücken.
    this.drehung = 216 * Math.PI / 180;
    this.hoehe = 34 * Math.PI / 180;
    this.abstand = 3;
    this.schub = [0, 0, 0];

    // Alles, woran sich drehen lässt, an einer Stelle. Die Werte gelten je
    // Betrachter - das Vorschaubild zeichnet mit denselben.
    this.farbe = [0.2549, 0.3804, 0.5451];     // #41618b
    this.hintergrund = [0, 0, 0];
    this.grund = 0;           // kein Grundlicht - die Tiefen bleiben dunkel
    this.kopflicht = 1.5;     // sitzt in der Kamera und trägt das Bild
    this.zweitlicht = 0.27;   // feste Richtung im Raum, nur zum Auflockern
    this.kante = 0.1;         // dezenter Schimmer auf der Silhouette
    this.gamma = 1.4;         // kräftiger als die üblichen 2.2
    // Richtung des zweiten Lichts in denselben Winkeln wie die Kamera.
    this.lichtDrehung = 247 * Math.PI / 180;
    this.lichtHoehe = 78 * Math.PI / 180;

    if (!fuerBild) {
      this.bediene();
      new ResizeObserver(() => this.zeichne()).observe(leinwand);
    }
  }

  // Erwartet { ecken: Float32Array, indizes?: Uint32Array } je Netz.
  setzeNetze(netze) {
    const gl = this.gl;
    for (const n of this.netze) {
      gl.deleteBuffer(n.eckPuffer);
      if (n.indexPuffer) gl.deleteBuffer(n.indexPuffer);
      gl.deleteVertexArray(n.vao);
      if (n.gitter) { gl.deleteBuffer(n.gitter.puffer); gl.deleteVertexArray(n.gitter.vao); }
    }
    this.drei?.leeren();

    // Vom Nutzer umgefaerbt (Feld "Filamente")? Dann gilt diese Tafel.
    this.dateiTafel = netze.farbtafel || [];
    const farbtafel = this.filamentTafel || this.dateiTafel;
    const bereicheJeNetz = netze.map((n) => farbBereiche(n, farbtafel));
    // Eine 3MF zeigt ihre hinterlegte Farbe auch, wenn es nur eine ist. Bei
    // STEP dagegen nur ab zwei verschiedenen: Eine einzige CAD-Farbe ist
    // meist das Standardgrau des Programms. Abschalten laesst sich beides
    // unter "Darstellung" (Farben der Datei).
    const verschiedene = new Set();
    for (const b of bereicheJeNetz) for (const stueck of b?.liste || []) verschiedene.add(stueck.hex);
    this.hatDateiFarben = verschiedene.size > 1 || (!!netze.aus3mf && verschiedene.size === 1);

    this.netze = netze.map(({ ecken, indizes, teil }, netzNummer) => {
      const bunt = this.hatDateiFarben ? bereicheJeNetz[netzNummer] : null;
      // Die sortierte Reihenfolge ersetzt die urspruengliche - gezeichnet
      // wird ohnehin jedes Dreieck, nur eben nach Farbe gebuendelt.
      if (bunt) indizes = bunt.indizes;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const eckPuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, eckPuffer);
      gl.bufferData(gl.ARRAY_BUFFER, ecken, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.orte.lage);
      gl.vertexAttribPointer(this.orte.lage, 3, gl.FLOAT, false, 0, 0);

      let indexPuffer = null;
      if (indizes && indizes.length) {
        indexPuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexPuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indizes, gl.STATIC_DRAW);
      }
      gl.bindVertexArray(null);

      return {
        vao, eckPuffer, indexPuffer,
        // Nummer des Bauteils, zu dem dieses Netz gehoert. Bei STL gibt es
        // nur eines, dann bleibt sie undefiniert.
        teil,
        // Abschnitte gleicher Farbe im Indexpuffer, oder null.
        bereiche: bunt ? bunt.liste : null,
        anzahl: indexPuffer ? indizes.length : ecken.length / 3,
        // Woraus die weiche Fassung entsteht - in derselben Reihenfolge der
        // Dreiecke, damit die Farbabschnitte auch dort stimmen.
        quelle: { ecken, indizes: indexPuffer ? indizes : null },
        weich: false
      };
    });

    this.hervor = null;
    this.ausgeblendet = new Set();
    // Teilfarben gelten weiter (etwa bei anderer STEP-Feinheit derselben Datei).
    if (this.teilFarben) this.faerbeNetze();
    this.passeEin(netze);
    if (this.rendern) this.aufbereiten();
    else this.dreiLauf++;
    this.zeichne();
  }

  // --- Rendern: ein- und ausschalten, weiche Netze bauen -------------------

  setzeRendern(an) {
    // Die Vorschaubilder bleiben flach.
    this.rendern = !!an && !this.festeGroesse;
    if (this.rendern && this.netze.length && !this.netze.every((n) => n.weich)) this.aufbereiten();
    this.zeichne();
  }

  // Filamente umfaerben, ohne die Netze neu hochzuladen: nur die Farben der
  // Abschnitte und - in der gerenderten Ansicht - der Materialien.
  setzeFilamentFarben(tafel) {
    this.filamentTafel = tafel;
    this.faerbeNetze();
    this.zeichne();
  }

  // Ein Filament nur in einem Teil umfaerben (hex) oder zuruecksetzen (null).
  setzeTeilFarbe(teil, filament, hex) {
    if (!this.teilFarben) this.teilFarben = new Map();
    if (!this.teilFarben.has(teil)) this.teilFarben.set(teil, new Map());
    const je = this.teilFarben.get(teil);
    if (hex) je.set(filament, hex); else je.delete(filament);
    if (!je.size) this.teilFarben.delete(teil);
    if (!this.teilFarben.size) this.teilFarben = null;
    this.faerbeNetze();
    this.zeichne();
  }

  // Farbe eines Filaments in einem Teil: Teilfarbe, sonst Tafel.
  farbeVon(teil, filament) {
    return this.teilFarben?.get(teil)?.get(filament)
      || (this.filamentTafel || this.dateiTafel || [])[filament - 1] || null;
  }

  // Farben aller Abschnitte nach Tafel und Teilfarben setzen - ohne die
  // Netze neu hochzuladen.
  faerbeNetze() {
    this.netze.forEach((n, i) => {
      if (!n.bereiche) return;
      for (const stueck of n.bereiche) {
        const hex = this.farbeVon(n.teil, stueck.filament);
        if (!hex) continue;
        stueck.hex = hex;
        stueck.farbe = alsFarbe(hex);
      }
      this.drei?.faerbe(i, n.bereiche);
    });
  }

  // Hervorheben ein-/ausschalten. Beim Pulsieren zeichnet die Ansicht
  // fortlaufend, solange etwas hervorgehoben ist.
  setzeHervorFilament(f) {
    this.hervorFilament = f;
    this.zeichne();
    if (f !== null && this.hervorArt === 'puls' && !this.pulsLaeuft) {
      this.pulsLaeuft = true;
      const schritt = () => {
        if (this.hervorFilament === null || this.hervorArt !== 'puls') { this.pulsLaeuft = false; this.zeichne(); return; }
        this.anfordern();
        requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    }
  }

  // Kanten eines Netzes fuer das Drahtgitter - erst beim ersten Einschalten
  // gebaut, denn bei grossen Modellen kostet das Speicher. Bei gemeinsamen
  // Ecken (3MF) wird jede Kante nur einmal gezeichnet; STL hat je Dreieck
  // eigene Ecken, dort zeichnen zwei Dreiecke ihre gemeinsame Kante doppelt.
  gitterVon(n) {
    if (n.gitter) return n.gitter;
    const gl = this.gl;
    n.kante ??= typischeKante(n.quelle);
    const { ecken, indizes } = n.quelle;
    const anzahl = indizes ? indizes.length : ecken.length / 3;
    const linien = new Uint32Array(anzahl * 2);
    let l = 0;
    const gesehen = indizes ? new Set() : null;
    const eckenZahl = ecken.length / 3;
    for (let d = 0; d + 2 < anzahl; d += 3) {
      for (let k = 0; k < 3; k++) {
        const a = indizes ? indizes[d + k] : d + k;
        const b = indizes ? indizes[d + (k + 1) % 3] : d + (k + 1) % 3;
        if (gesehen) {
          const schluessel = a < b ? a * eckenZahl + b : b * eckenZahl + a;
          if (gesehen.has(schluessel)) continue;
          gesehen.add(schluessel);
        }
        linien[l++] = a;
        linien[l++] = b;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, n.eckPuffer);
    gl.enableVertexAttribArray(this.linienOrte.lage);
    gl.vertexAttribPointer(this.linienOrte.lage, 3, gl.FLOAT, false, 0, 0);
    const puffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, linien.subarray(0, l), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    n.gitter = { vao, puffer, anzahl: l };
    return n.gitter;
  }

  // Bild fuer eine Bewegung anfordern (Maus, Rad, Selbstdrehen, Pulsieren).
  // Ohne Begrenzung wird sofort gezeichnet wie bisher. Mit Begrenzung
  // (testweise, fpsGrenze = Bilder je Sekunde) hoechstens so oft: Gezeichnet
  // wird im ersten Bildschirmbild, das den Abstand erreicht. Passt die Zahl
  // nicht glatt zur Bildschirmrate, stehen Bilder unterschiedlich lang.
  // zeichne() selbst bleibt sofort: Vorschaubilder und Teilauswahl lesen das
  // Bild direkt danach aus.
  anfordern() {
    if (!(this.fpsGrenze > 0)) { this.zeichne(); return; }
    this.ausstehend = true;
    if (this.taktLaeuft) return;
    this.taktLaeuft = true;
    const takt = (jetzt) => {
      const grenze = this.fpsGrenze;
      let dran = true;   // Grenze inzwischen aus: sofort zeichnen
      if (grenze > 0) {
        const abstand = 1000 / grenze;
        // Zeitplan statt "seit dem letzten Bild": So bleibt der Schnitt bei
        // der eingestellten Zahl, auch wenn ein Bild etwas spaet kommt.
        // Liegt der geplante Zeitpunkt mehr als einen Abstand daneben -
        // Pause, neue Grenze, noch keiner gesetzt -, neu ansetzen. Das
        // !(... <= ...) faengt auch undefined ab.
        if (!(Math.abs(jetzt - this.naechstesBild) <= abstand)) this.naechstesBild = jetzt;
        dran = jetzt >= this.naechstesBild - 1;
        if (dran && this.ausstehend) this.naechstesBild += abstand;
      }
      if (dran) {
        if (!this.ausstehend) { this.taktLaeuft = false; return; }
        this.ausstehend = false;
        this.zeichne();
      }
      requestAnimationFrame(takt);
    };
    requestAnimationFrame(takt);
  }

  // Bewegung mit Maus oder Rad: drehung/hoehe in Bogenmass, schub als
  // Verschiebung, zoom als Logarithmus des Faktors fuer den Abstand.
  //
  // Mit Glaettung (glaettung = Zeitkonstante in ms, testweise einstellbar)
  // wird die Bewegung nicht auf einmal ausgefuehrt, sondern als Rest
  // gemerkt, den das Modell in jedem Bild zu einem Teil abbaut - nach der
  // Zeitkonstante sind knapp zwei Drittel davon geschehen. Ungleichmaessig
  // ankommende Mausbewegungen verteilen sich so auf mehrere Bilder.
  // Gemerkt wird der Rest, nicht ein Ziel: Setzt anderes die Kamera direkt
  // (Zuruecksetzen, Teilansicht, Selbstdrehen), zieht nichts zurueck.
  bewege({ drehung = 0, hoehe = 0, schub = null, zoom = 0 }) {
    if (!(this.glaettung > 0)) {
      this.schritt({ drehung, hoehe, schub, zoom });
      this.anfordern();
      return;
    }
    const r = this.rest ??= { drehung: 0, hoehe: 0, schub: [0, 0, 0], zoom: 0 };
    r.drehung += drehung;
    r.hoehe += hoehe;
    r.zoom += zoom;
    if (schub) for (let a = 0; a < 3; a++) r.schub[a] += schub[a];
    if (this.glaettLaeuft) return;
    this.glaettLaeuft = true;
    let vorher = performance.now();
    const takt = (jetzt) => {
      const dt = Math.max(0, jetzt - vorher);
      vorher = jetzt;
      const tau = this.glaettung;
      // Anteil, der in diesem Bild geschieht. Ohne Glaettung (Regler
      // inzwischen auf 0) alles auf einmal.
      const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
      const klein = Math.abs(r.drehung) < 1e-5 && Math.abs(r.hoehe) < 1e-5 && Math.abs(r.zoom) < 1e-5
        && r.schub.every((v) => Math.abs(v) < this.radius * 1e-5);
      const teil = klein ? 1 : k;
      this.schritt({ drehung: r.drehung * teil, hoehe: r.hoehe * teil,
                     schub: r.schub.map((v) => v * teil), zoom: r.zoom * teil });
      r.drehung -= r.drehung * teil;
      r.hoehe -= r.hoehe * teil;
      r.zoom -= r.zoom * teil;
      for (let a = 0; a < 3; a++) r.schub[a] -= r.schub[a] * teil;
      this.anfordern();
      if (klein) { this.glaettLaeuft = false; return; }
      requestAnimationFrame(takt);
    };
    requestAnimationFrame(takt);
  }

  // Fuehrt eine Bewegung sofort aus (siehe bewege).
  schritt({ drehung, hoehe, schub, zoom }) {
    this.drehung += drehung;
    // Ohne Anschlag: hoch und runter so weit wie links und rechts. Der
    // Winkel bleibt zwischen -pi und pi, damit er nicht endlos waechst.
    this.hoehe += hoehe;
    if (this.hoehe > Math.PI) this.hoehe -= 2 * Math.PI;
    if (this.hoehe < -Math.PI) this.hoehe += 2 * Math.PI;
    if (schub) for (let a = 0; a < 3; a++) this.schub[a] += schub[a];
    if (zoom) {
      this.abstand = Math.max(this.radius * 0.2, Math.min(this.radius * 20, this.abstand * Math.exp(zoom)));
    }
  }

  // Testweise: Blickwinkel, Zoom und Verschiebung als Text - fuer die
  // Bildratenanzeige und zum Nachstellen einer Ansicht (setzeKamera).
  // Zoom: Abstand im Verhaeltnis zum Einpassen, 1 = ganzes Modell im Bild.
  kameraText() {
    const grad = (w) => (w * 180 / Math.PI).toFixed(1);
    const zoom = this.abstand / (this.radius * 2.6);
    return `Drehung ${grad(this.drehung)}°  Hoehe ${grad(this.hoehe)}°  Zoom ${zoom.toFixed(3)}  ` +
      `Verschiebung ${this.schub.map((v) => v.toFixed(1)).join('/')}`;
  }

  // Gegenstueck zu kameraText: setzeKamera(152.3, 12, 0.45, [0, 0, 0]).
  setzeKamera(drehGrad, hoeheGrad, zoom = 1, schub = [0, 0, 0]) {
    this.drehung = drehGrad * Math.PI / 180;
    this.hoehe = hoeheGrad * Math.PI / 180;
    this.abstand = zoom * this.radius * 2.6;
    this.schub = [...schub];
    this.zeichne();
  }

  // Testweise: das Modell von selbst um die Hochachse drehen lassen.
  // grad: Grad je Sekunde, 0 = aus. Die Schrittweite richtet sich nach der
  // tatsaechlich vergangenen Zeit - bei ausfallenden Bildern springt das
  // Modell, statt langsamer zu werden.
  setzeDrehTempo(grad) {
    this.drehTempo = grad;
    if (!grad || this.drehtLaeuft) return;
    this.drehtLaeuft = true;
    let vorher = performance.now();
    const schritt = (jetzt) => {
      if (!this.drehTempo) { this.drehtLaeuft = false; return; }
      // Hoechstens 0,1 s auf einmal - nach einem verdeckten Tab nicht springen.
      const dt = Math.min(0.1, Math.max(0, jetzt - vorher) / 1000);
      vorher = jetzt;
      this.drehung += this.drehTempo * Math.PI / 180 * dt;
      if (this.drehung > Math.PI) this.drehung -= 2 * Math.PI;
      this.anfordern();
      requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }

  // 0..1, langsam auf und ab - fuer "Pulsieren".
  pulsWert() {
    return 0.5 - 0.5 * Math.cos(performance.now() / 1000 * 2 * Math.PI / 1.2);
  }

  // Wie viel vom Modell (oder von einem Teil) in welchem Filament ist:
  // Map Filament -> Dreiecke.
  filamentAnteile(teil = null) {
    const raus = new Map();
    for (const n of this.netze) {
      if (teil !== null && n.teil !== teil) continue;
      for (const stueck of n.bereiche || []) {
        raus.set(stueck.filament, (raus.get(stueck.filament) || 0) + stueck.anzahl / 3);
      }
    }
    return raus;
  }

  // Knickwinkel geaendert: Ist "Rendern" an, gleich neu rechnen; sonst die
  // vorbereiteten Netze verwerfen, damit sie beim Einschalten neu entstehen.
  neuAufbereiten() {
    if (!this.netze.length) return;
    if (this.rendern && this.drei) { this.aufbereiten(true); return; }
    this.dreiLauf++;
    this.meldeRechnen(false);
    for (const n of this.netze) n.weich = false;
    this.drei?.leeren();
  }

  meldeRechnen(laeuft) {
    this.rendernRechnet = laeuft;
    this.beiRendern?.(laeuft);
  }

  // Schickt die Netze nacheinander an den Arbeiter (three.js,
  // toCreasedNormals) und reicht die Ergebnisse an die three.js-Buehne.
  // Wechselt inzwischen das Modell, verfallen die Antworten (Laufnummer).
  // ersetzen: alle Netze neu rechnen (anderer Knickwinkel) - die bisherigen
  // bleiben so lange zu sehen und werden erst am Ende ausgetauscht.
  async aufbereiten(ersetzen = false) {
    const lauf = ++this.dreiLauf;
    const netze = this.netze;
    this.meldeRechnen(true);
    try {
      if (!this.drei) {
        this.drei = new DreiBuehne(this.leinwand);
        this.drei.einpassen(this.mitte, this.groesse, this.radius);
      }
      if (!this.dreiArbeiter) this.dreiArbeiter = new Worker('model_drei_worker.js');
      const arbeiter = this.dreiArbeiter;
      const neu = [];
      for (let i = 0; i < netze.length; i++) {
        const n = netze[i];
        if (n.weich && !ersetzen) continue;
        // Nur die eigene Antwort annehmen: Ein ueberholter Lauf kann noch
        // eine im Arbeiter stecken haben.
        const antwort = await new Promise((fertig) => {
          arbeiter.onmessage = ({ data }) => { if (data.lauf === lauf && data.nummer === i) fertig(data); };
          arbeiter.onerror = (e) => fertig({ fehler: e.message || 'Fehler' });
          arbeiter.postMessage({ lauf, nummer: i, ecken: n.quelle.ecken, indizes: n.quelle.indizes,
                                 winkel: this.knickwinkel });
        });
        if (lauf !== this.dreiLauf) return;
        if (antwort.fehler) throw new Error(antwort.fehler);
        neu.push([i, antwort]);
      }
      // Erst einsetzen, wenn alle fertig sind - ein halb weiches Modell
      // saehe aus wie ein Fehler.
      if (ersetzen) this.drei.leeren();
      for (const [i, antwort] of neu) {
        this.drei.setzeNetz(i, antwort, netze[i].bereiche, netze[i].teil);
        netze[i].weich = true;
      }
      this.zeichne();
    } catch (fehler) {
      console.warn('Rendern nicht moeglich:', fehler);
    } finally {
      if (lauf === this.dreiLauf) this.meldeRechnen(false);
    }
  }

  // Kamera so setzen, dass das Modell ganz im Bild ist.
  passeEin(netze) {
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { ecken } of netze) {
      for (let i = 0; i < ecken.length; i += 3) {
        for (let a = 0; a < 3; a++) {
          const w = ecken[i + a];
          if (w < min[a]) min[a] = w;
          if (w > max[a]) max[a] = w;
        }
      }
    }
    if (!Number.isFinite(min[0])) { min = [0, 0, 0]; max = [1, 1, 1]; }

    this.mitte = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
    this.groesse = [0, 1, 2].map((a) => max[a] - min[a]);
    this.radius = Math.max(Math.hypot(...this.groesse) / 2, 0.001);
    this.abstand = this.radius * 2.6;
    this.schub = [0, 0, 0];
    this.drei?.einpassen(this.mitte, this.groesse, this.radius);
  }

  // Zeichnet sofort. Mit Bildratenanzeige wird danach auf die Grafikkarte
  // gewartet, damit "ms je Bild" die ganze Zeit zeigt.
  zeichne() {
    if (!this.anzeige) { this.zeichneBild(); return; }
    const anfang = performance.now();
    this.zeichneBild();
    const gerendert = this.drei && !this.drei.leinwand.hidden;
    (gerendert ? this.drei.renderer.getContext() : this.gl).finish();
    this.gerechnet.push(performance.now());
    this.neuesBild = true;
    this.dauer = performance.now() - anfang;
  }

  // Testweise: Bildrate und Zeit je Bild oben links einblenden, in der
  // flachen wie in der gerenderten Ansicht.
  //   angezeigt: Bildschirmbilder je Sekunde, in denen ein neues Bild kam -
  //              das ist, was man als fluessig oder ruckelig sieht.
  //   gerechnet: wie oft je Sekunde gezeichnet wurde.
  //   ms:        Zeit fuer ein Bild, mit Warten auf die Grafikkarte.
  //   laengste Pause: groesster Abstand zwischen zwei angezeigten Bildern in
  //              der letzten Sekunde - Ruckler sieht man hier.
  // Dazu bei "Rendern" die Schattenkarte und immer die Kamera (kameraText).
  zaehler(an) {
    if (!an) {
      this.anzeige?.remove();
      this.anzeige = null;
      return;
    }
    if (this.anzeige) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:8px;top:8px;z-index:5;pointer-events:none;' +
      'font:12px/1.4 ui-monospace,Consolas,monospace;color:#fff;background:rgba(0,0,0,.55);' +
      'padding:3px 7px;border-radius:4px;white-space:pre';
    this.leinwand.parentNode.append(el);
    this.anzeige = el;
    this.gerechnet = [];
    this.angezeigt = [];
    this.neuesBild = false;
    this.dauer = 0;
    const takt = (jetzt) => {
      if (this.anzeige !== el) return;
      el.hidden = this.leinwand.hidden && !(this.drei && !this.drei.leinwand.hidden);
      if (this.neuesBild) { this.angezeigt.push(jetzt); this.neuesBild = false; }
      const grenze = jetzt - 1000;
      while (this.angezeigt.length && this.angezeigt[0] < grenze) this.angezeigt.shift();
      while (this.gerechnet.length && this.gerechnet[0] < grenze) this.gerechnet.shift();
      let pause = 0;
      for (let i = 1; i < this.angezeigt.length; i++) {
        pause = Math.max(pause, this.angezeigt[i] - this.angezeigt[i - 1]);
      }
      const gerendert = this.drei && !this.drei.leinwand.hidden;
      el.textContent =
        `angezeigt ${this.angezeigt.length} fps   gerechnet ${this.gerechnet.length}/s\n` +
        `${this.dauer.toFixed(1)} ms je Bild   laengste Pause ${pause.toFixed(0)} ms\n` +
        (gerendert ? this.drei.schattenText() + '\n' : '') +
        this.kameraText();
      requestAnimationFrame(takt);
    };
    requestAnimationFrame(takt);
  }

  zeichneBild() {
    const gl = this.gl;
    const dpr = this.festeGroesse ? 1 : Math.min(devicePixelRatio || 1, 2);
    const breite = this.festeGroesse
      ? this.leinwand.width : Math.max(1, Math.round(this.leinwand.clientWidth * dpr));
    const hoehe = this.festeGroesse
      ? this.leinwand.height : Math.max(1, Math.round(this.leinwand.clientHeight * dpr));
    if (this.leinwand.width !== breite || this.leinwand.height !== hoehe) {
      this.leinwand.width = breite;
      this.leinwand.height = hoehe;
    }
    gl.viewport(0, 0, breite, hoehe);
    gl.clearColor(this.hintergrund[0], this.hintergrund[1], this.hintergrund[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.netze.length) return;

    const r = this.radius;
    const ziel = [
      this.mitte[0] + this.schub[0],
      this.mitte[1] + this.schub[1],
      this.mitte[2] + this.schub[2]
    ];
    const gerendert = this.rendern && !!this.drei && this.netze.every((n) => n.weich);
    const winkel = SICHT;
    const abstand = this.abstand * Math.tan(ALTE_SICHT / 2) / Math.tan(SICHT / 2);
    const auge = [
      ziel[0] + abstand * Math.cos(this.hoehe) * Math.sin(this.drehung),
      ziel[1] + abstand * Math.cos(this.hoehe) * Math.cos(this.drehung),
      ziel[2] + abstand * Math.sin(this.hoehe)
    ];

    // Hochachse der Kamera, nicht die der Welt: So darf der Hoehenwinkel
    // ueber die Pole hinaus - das Modell laesst sich auch hoch und runter
    // endlos drehen, ohne dass das Bild am Pol umklappt.
    const oben = [
      -Math.sin(this.drehung) * Math.sin(this.hoehe),
      -Math.cos(this.drehung) * Math.sin(this.hoehe),
      Math.cos(this.hoehe)
    ];
    const sicht = blickVon(auge, ziel, oben);
    const proj = perspektive(winkel, breite / hoehe, Math.max(r * 0.01, 0.01), abstand + r * 4);
    const mvp = malMatrix(proj, sicht);
    // Das Kennungsbild zeichnet dieselbe Ansicht; es borgt sich die Matrix,
    // statt sie noch einmal auszurechnen.
    this.letzteMvp = mvp;

    // Drahtgitter: Bildpunkte je Weltlaenge im Abstand 1 - fuer die
    // Deckkraft nach Dichte (siehe LINIEN_SHADER).
    const pxFaktor = hoehe / (2 * Math.tan(SICHT / 2));
    if (this.gitter !== 'aus') {
      for (const n of this.netze) n.kante ??= typischeKante(n.quelle);
      // Hinweis, solange die Kanten selbst am Blickpunkt kaum ein paar
      // Bildpunkte lang sind - dann sieht man nur den Schleier.
      const groesste = Math.max(0, ...this.netze.map((n) => n.kante || 0));
      this.beiGitterFein?.(groesste * pxFaktor / abstand < 3);
    } else {
      this.beiGitterFein?.(false);
    }

    this.drei?.zeigen(gerendert);
    if (gerendert) {
      this.drei.zeichne({
        breite, hoehe, auge, ziel, oben,
        nah: Math.max(r * 0.01, 0.01), fern: abstand + r * 4,
        hintergrund: this.hintergrund, farbe: this.farbe,
        blass: this.farbe.map((w) => w * 0.3 + 0.04),
        hervor: this.hervor, ausgeblendet: this.ausgeblendet, dateiFarben: this.dateiFarben,
        hervorFilament: this.hervorArt === 'aus' ? null : this.hervorFilament, hervorArt: this.hervorArt,
        hervorTeil: this.hervorTeil, gitter: this.gitter,
        gitterKantePx: this.netze.map((n) => (n.kante || 0) * pxFaktor),
        puls: this.hervorArt === 'puls' && this.hervorFilament !== null ? this.pulsWert() : 0,
        licht: {
          belichtung: this.dreiBelichtung, umgebung: this.dreiUmgebung,
          haupt: this.dreiHaupt, fuell: this.dreiFuell, kante: this.dreiKante,
          rauheit: this.dreiRauheit, schatten: this.dreiSchatten, karte: this.dreiKarte
        }
      });
      return;
    }

    gl.useProgram(this.programm);
    gl.uniformMatrix4fv(this.orte.mvp, false, mvp);
    gl.uniformMatrix4fv(this.orte.modell, false, new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
    ]));
    gl.uniform3fv(this.orte.auge, new Float32Array(auge));
    gl.uniform3fv(this.orte.farbe, new Float32Array(this.farbe));
    gl.uniform3fv(this.orte.licht, new Float32Array([
      Math.cos(this.lichtHoehe) * Math.sin(this.lichtDrehung),
      Math.cos(this.lichtHoehe) * Math.cos(this.lichtDrehung),
      Math.sin(this.lichtHoehe)
    ]));
    gl.uniform4f(this.orte.staerken, this.grund, this.kopflicht, this.zweitlicht, this.kante);
    gl.uniform1f(this.orte.gamma, this.gamma);
    gl.uniform1f(this.orte.deckkraft, 1);

    // Ein Filament hervorgehoben (Feld "Filamente")? Dann sehen die anderen
    // je nach Art anders aus; bei "Glas" werden sie erst zum Schluss
    // durchscheinend ueber das Uebrige gezeichnet.
    const hf = this.hervorFilament;
    const art = hf === null || this.hervorArt === 'aus' ? null : this.hervorArt;
    const GRAU = alsFarbe('#d2d2d2');
    const puls = art === 'puls' ? this.pulsWert() * 0.65 : 0;
    const glas = [];
    const farbeFuer = (farbe, gewaehlt) => {
      if (art === null) return farbe;
      // Pulsieren: helle Farben werden dunkler, dunkle heller - sonst saehe
      // man es bei Weiss oder Hellgelb gar nicht.
      if (gewaehlt && puls) {
        const hell = 0.2126 * farbe[0] + 0.7152 * farbe[1] + 0.0722 * farbe[2] > 0.5;
        return farbe.map((w) => (hell ? w * (1 - puls) : w + (1 - w) * puls));
      }
      if (gewaehlt) return farbe;
      if (art === 'dunkel') return farbe.map((w) => w * 0.25);
      if (art === 'grau') return GRAU;
      return farbe;
    };

    // Ist ein Teil ausgewählt, werden die übrigen zurückgenommen statt
    // ausgeblendet: So bleibt sichtbar, wo das Teil im Ganzen sitzt.
    const blass = this.farbe.map((w) => w * 0.22 + 0.05);
    let letzteFarbe = null;

    // Drahtgitter darueber: Flaechen ein wenig nach hinten, damit die Linien
    // nicht mit ihnen um dieselbe Tiefe streiten.
    if (this.gitter === 'darueber') {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
    }
    for (const n of this.netze) {
      if (this.ausgeblendet.has(n.teil)) continue;
      if (this.gitter === 'nur') continue;
      const betont = this.hervor === null || n.teil === this.hervor;

      // Mehrfarbig: je Filament ein Abschnitt des Indexpuffers. Zurueck-
      // genommene Teile bleiben einfarbig blass - bunt und blass zugleich
      // waere nur unruhig.
      if (betont && this.dateiFarben && n.bereiche) {
        gl.bindVertexArray(n.vao);
        for (const stueck of n.bereiche) {
          const gewaehlt = stueck.filament === hf && (this.hervorTeil === null || n.teil === this.hervorTeil);
          if (art === 'glas' && !gewaehlt) { glas.push([n, stueck]); continue; }
          gl.uniform3fv(this.orte.farbe, farbeFuer(stueck.farbe, gewaehlt));
          gl.drawElements(gl.TRIANGLES, stueck.anzahl, gl.UNSIGNED_INT, stueck.ab * 4);
        }
        letzteFarbe = null;
        continue;
      }
      if (art === 'glas') { glas.push([n, null]); continue; }

      const gewollt = art && betont ? farbeFuer(this.farbe, false) : betont ? this.farbe : blass;
      if (gewollt !== letzteFarbe) {
        gl.uniform3fv(this.orte.farbe, new Float32Array(gewollt));
        letzteFarbe = gewollt;
      }
      gl.bindVertexArray(n.vao);
      if (n.indexPuffer) gl.drawElements(gl.TRIANGLES, n.anzahl, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, n.anzahl);
    }

    // "Glas": die uebrigen Filamente durchscheinend darueber - ohne in die
    // Tiefe zu schreiben, damit sie einander nicht verdecken.
    if (glas.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(this.orte.deckkraft, 0.12);
      for (const [n, stueck] of glas) {
        gl.bindVertexArray(n.vao);
        gl.uniform3fv(this.orte.farbe, stueck ? stueck.farbe : new Float32Array(this.farbe));
        if (stueck) gl.drawElements(gl.TRIANGLES, stueck.anzahl, gl.UNSIGNED_INT, stueck.ab * 4);
        else if (n.indexPuffer) gl.drawElements(gl.TRIANGLES, n.anzahl, gl.UNSIGNED_INT, 0);
        else gl.drawArrays(gl.TRIANGLES, 0, n.anzahl);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniform1f(this.orte.deckkraft, 1);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (this.gitter !== 'aus') this.zeichneGitter(mvp, auge, pxFaktor);
    gl.bindVertexArray(null);
  }

  // Drahtgitter der flachen Ansicht. Darueber: dunkle, halb durchsichtige
  // Linien, verdeckte Kanten bleiben verdeckt. Nur Gitter: helle Linien in
  // der Modellfarbe, alle Kanten sichtbar.
  zeichneGitter(mvp, auge, pxFaktor) {
    const gl = this.gl;
    const nur = this.gitter === 'nur';
    gl.useProgram(this.linienProgramm);
    gl.uniformMatrix4fv(this.linienOrte.mvp, false, mvp);
    gl.uniform3fv(this.linienOrte.auge, new Float32Array(auge));
    gl.uniformMatrix4fv(this.linienOrte.modell, false, new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1
    ]));
    const hell = this.farbe.map((w) => w + (1 - w) * 0.45);
    if (nur) gl.uniform4f(this.linienOrte.farbe, hell[0], hell[1], hell[2], 0.9);
    else gl.uniform4f(this.linienOrte.farbe, 0, 0, 0, 0.35);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const n of this.netze) {
      if (this.ausgeblendet.has(n.teil)) continue;
      const g = this.gitterVon(n);
      gl.uniform1f(this.linienOrte.kantePx, n.kante * pxFaktor);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.LINES, g.anzahl, gl.UNSIGNED_INT, 0);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(this.programm);
  }

  // --- Anklicken ---------------------------------------------------------
  //
  // Zeichnet die Szene in ein unsichtbares Bild, jedes Netz in seiner
  // eigenen Farbe, und liest das Pixel unter dem Zeiger aus.
  kennBildVorbereiten(breite, hoehe) {
    const gl = this.gl;
    if (!this.kennProgramm) {
      this.kennProgramm = baueProgramm(gl, ECKPUNKT_SHADER, KENN_SHADER);
      this.kennOrte = {
        mvp: gl.getUniformLocation(this.kennProgramm, 'mvp'),
        kennung: gl.getUniformLocation(this.kennProgramm, 'kennung')
      };
    }
    if (this.kennRahmen && this.kennBreite === breite && this.kennHoehe === hoehe) return;

    if (this.kennRahmen) {
      gl.deleteFramebuffer(this.kennRahmen);
      gl.deleteTexture(this.kennBild);
      gl.deleteRenderbuffer(this.kennTiefe);
    }
    this.kennBild = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.kennBild);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, breite, hoehe, 0,
                  gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.kennTiefe = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.kennTiefe);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, breite, hoehe);

    this.kennRahmen = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.kennRahmen);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                            gl.TEXTURE_2D, this.kennBild, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
                               gl.RENDERBUFFER, this.kennTiefe);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.kennBreite = breite;
    this.kennHoehe = hoehe;
  }

  // x/y in Bildschirmpunkten innerhalb der Leinwand, Ursprung oben links.
  teilBei(x, y) {
    const gl = this.gl;
    if (!this.netze.length) return null;

    const breite = this.leinwand.width, hoehe = this.leinwand.height;
    this.kennBildVorbereiten(breite, hoehe);

    // Die Leinwand ist feiner aufgelöst als die Seite; Klickpunkt umrechnen.
    const faktor = breite / this.leinwand.clientWidth;
    const px = Math.round(x * faktor);
    const py = Math.round(hoehe - y * faktor);     // WebGL zählt von unten
    if (px < 0 || py < 0 || px >= breite || py >= hoehe) return null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.kennRahmen);
    gl.viewport(0, 0, breite, hoehe);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.kennProgramm);
    gl.uniformMatrix4fv(this.kennOrte.mvp, false, this.letzteMvp);

    this.netze.forEach((n, i) => {
      // Ausgeblendetes laesst sich auch nicht anklicken.
      if (this.ausgeblendet.has(n.teil)) return;
      // Nummer ab 1, damit die 0 für "nichts getroffen" frei bleibt.
      const nummer = i + 1;
      gl.uniform4f(this.kennOrte.kennung,
        (nummer & 255) / 255, ((nummer >> 8) & 255) / 255,
        ((nummer >> 16) & 255) / 255, 1);
      gl.bindVertexArray(n.vao);
      if (n.indexPuffer) gl.drawElements(gl.TRIANGLES, n.anzahl, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, n.anzahl);
    });
    gl.bindVertexArray(null);

    const pixel = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const nummer = pixel[0] | (pixel[1] << 8) | (pixel[2] << 16);
    if (!nummer || nummer > this.netze.length) return null;
    return this.netze[nummer - 1].teil ?? null;
  }

  bediene() {
    const el = this.leinwand;
    let letzte = null, taste = 0;

    // Ein Klick ist ein Zeigen, kein Ziehen: Wer das Modell dreht, will
    // nichts auswählen. Deshalb merken wir uns den Startpunkt und werten
    // nur aus, wenn der Zeiger fast stehen geblieben ist.
    let start = null;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      letzte = [e.clientX, e.clientY];
      start = [e.clientX, e.clientY];
      taste = e.button;
    });
    el.addEventListener('pointerup', (e) => {
      el.releasePointerCapture(e.pointerId);
      letzte = null;
      if (!start || e.button !== 0 || !this.beiAuswahl) { start = null; return; }
      if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) { start = null; return; }
      start = null;
      const kasten = el.getBoundingClientRect();
      this.beiAuswahl(this.teilBei(e.clientX - kasten.left, e.clientY - kasten.top));
    });
    el.addEventListener('pointermove', (e) => {
      if (!letzte) return;
      const dx = e.clientX - letzte[0], dy = e.clientY - letzte[1];
      letzte = [e.clientX, e.clientY];
      if (taste === 0) {
        // Plus, nicht minus: Die Maus fasst das Modell an und zieht es mit.
        // Nach rechts ziehen dreht es nach rechts - die Kamera wandert dabei
        // nach links. Andersherum fühlt es sich verkehrt an.
        // Steht das Modell kopf (ueber einen Pol hinaus gedreht), laeuft die
        // Drehung um die Hochachse fuer das Auge andersherum - dann das
        // Vorzeichen umkehren, damit die Maus das Modell weiter "anfasst".
        const kopf = Math.cos(this.hoehe) < 0 ? -1 : 1;
        this.bewege({ drehung: dx * 0.008 * kopf, hoehe: dy * 0.008 });
      } else {
        // Schieben in der Bildebene: entlang der Rechts- und Hochachse der
        // Kamera, nicht entlang der Weltachsen - sonst wandert das Modell
        // je nach Blickwinkel in eine andere Richtung als die Maus.
        //
        // Achtung bei den Vorzeichen: Verschoben wird der Blickpunkt, und das
        // Modell wandert auf dem Bildschirm genau andersherum. "rechts" zeigt
        // hier zudem nach links - es ist das Negative der Rechtsachse, die
        // sich aus Blickrichtung und Hochachse ergibt. Beides zusammen hebt
        // sich auf, deshalb steht bei dx ein Plus.
        const schritt = this.abstand / el.clientHeight;
        const rechts = [Math.cos(this.drehung), -Math.sin(this.drehung), 0];
        const hoch = [
          -Math.sin(this.drehung) * Math.sin(this.hoehe),
          -Math.cos(this.drehung) * Math.sin(this.hoehe),
          Math.cos(this.hoehe)
        ];
        this.bewege({ schub: [0, 1, 2].map((a) => (dx * rechts[a] + dy * hoch[a]) * schritt) });
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.bewege({ zoom: Math.log(1 + Math.sign(e.deltaY) * 0.12) });
    }, { passive: false });
  }
}

function baueProgramm(gl, eckQuelle, flaechenQuelle) {
  const bauen = (art, quelle) => {
    const s = gl.createShader(art);
    gl.shaderSource(s, quelle);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, bauen(gl.VERTEX_SHADER, eckQuelle));
  gl.attachShader(p, bauen(gl.FRAGMENT_SHADER, flaechenQuelle));
  // Feste Nummer für das einzige Attribut: Beide Programme - Anzeige und
  // Kennungsbild - teilen sich dieselben VAOs, und die merken sich die
  // Nummer, nicht den Namen.
  gl.bindAttribLocation(p, 0, 'lage');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Programm: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

// --- Vorschaubild erzeugen ----------------------------------------------
//
// Für die Liste links. Eine eigene, versteckte Leinwand, damit das sichtbare
// Bild stehen bleibt; sie wird wiederverwendet, denn einen WebGL-Zusammenhang
// anzulegen ist der teuerste Teil daran.
let bildMaler = null;

async function erzeugeVorschau(netze, groesse = 512, darstellung = null) {
  if (!bildMaler) {
    const leinwand = document.createElement('canvas');
    leinwand.width = leinwand.height = groesse;
    bildMaler = new Betrachter(leinwand, { fuerBild: true });
  }
  if (bildMaler.leinwand.width !== groesse) {
    bildMaler.leinwand.width = bildMaler.leinwand.height = groesse;
  }

  // Dieselben Licht- und Farbwerte wie die große Ansicht, sonst passen die
  // Bilder links nicht zu dem, was rechts steht.
  if (darstellung) Object.assign(bildMaler, darstellung);
  // Die Bilder links bleiben flach - "Rendern" gilt nur fuer die grosse Ansicht.
  bildMaler.rendern = false;

  bildMaler.setzeNetze(netze);
  // Von vorn und etwas von oben - derselbe Blick wie beim Öffnen.
  bildMaler.drehung = 216 * Math.PI / 180;
  bildMaler.hoehe = 34 * Math.PI / 180;
  bildMaler.abstand = bildMaler.radius * 2.35;
  bildMaler.zeichne();

  return await new Promise((fertig) => bildMaler.leinwand.toBlob(fertig, 'image/png'));
}

globalThis.Betrachter = Betrachter;
globalThis.erzeugeVorschau = erzeugeVorschau;

})();
