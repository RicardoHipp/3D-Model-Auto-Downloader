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
  ergebnis = vec4(pow(licht, vec3(1.0 / gamma)), 1.0);
}`;

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
// Ab hier gilt eine Kante als Kante und wird nicht geglaettet.
const KNICKWINKEL = 35 * Math.PI / 180;

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
    liste.push({ hex, farbe: alsFarbe(hex), ab: ab * 3, anzahl: anzahl[f] * 3 });
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
// gedaempft und unten leicht angehoben. Die Voreinstellung #1568d5 liegt
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
    this.orte = {
      lage:   gl.getAttribLocation(this.programm, 'lage'),
      mvp:    gl.getUniformLocation(this.programm, 'mvp'),
      modell: gl.getUniformLocation(this.programm, 'modell'),
      auge:   gl.getUniformLocation(this.programm, 'auge'),
      farbe:  gl.getUniformLocation(this.programm, 'farbe'),
      licht:  gl.getUniformLocation(this.programm, 'lichtRichtung'),
      staerken: gl.getUniformLocation(this.programm, 'staerken'),
      gamma:  gl.getUniformLocation(this.programm, 'gamma')
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
    this.farbe = [0.0824, 0.4078, 0.8353];     // #1568d5
    this.hintergrund = [0, 0, 0];
    this.grund = 0;           // kein Grundlicht - die Tiefen bleiben dunkel
    this.kopflicht = 1.5;     // sitzt in der Kamera und trägt das Bild
    this.zweitlicht = 0.27;   // feste Richtung im Raum, nur zum Auflockern
    this.kante = 0.1;         // dezenter Schimmer auf der Silhouette
    this.gamma = 1.5;         // kräftiger als die üblichen 2.2
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
    }
    this.drei?.leeren();

    const farbtafel = netze.farbtafel || [];
    const bereicheJeNetz = netze.map((n) => farbBereiche(n, farbtafel));
    // Nur wenn wirklich mehr als eine Farbe vorkommt. Eine einfarbige Datei
    // traegt zwar auch eine Filamentfarbe, aber die ist Zufall - was der
    // Ersteller gerade eingelegt hatte.
    const verschiedene = new Set();
    for (const b of bereicheJeNetz) for (const stueck of b?.liste || []) verschiedene.add(stueck.hex);
    this.hatDateiFarben = verschiedene.size > 1;

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

  meldeRechnen(laeuft) {
    this.rendernRechnet = laeuft;
    this.beiRendern?.(laeuft);
  }

  // Schickt die Netze nacheinander an den Arbeiter (three.js,
  // toCreasedNormals) und reicht die Ergebnisse an die three.js-Buehne.
  // Wechselt inzwischen das Modell, verfallen die Antworten (Laufnummer).
  async aufbereiten() {
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
      for (let i = 0; i < netze.length; i++) {
        const n = netze[i];
        if (n.weich) continue;
        const antwort = await new Promise((fertig) => {
          arbeiter.onmessage = ({ data }) => fertig(data);
          arbeiter.onerror = (e) => fertig({ fehler: e.message || 'Fehler' });
          arbeiter.postMessage({ nummer: i, ecken: n.quelle.ecken, indizes: n.quelle.indizes,
                                 winkel: KNICKWINKEL });
        });
        if (lauf !== this.dreiLauf) return;
        if (antwort.fehler) throw new Error(antwort.fehler);
        this.drei.setzeNetz(i, antwort, n.bereiche, n.teil);
        n.weich = true;
        // Erst zeichnen, wenn alle fertig sind - ein halb weiches Modell
        // saehe aus wie ein Fehler.
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

  zeichne() {
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

    this.drei?.zeigen(gerendert);
    if (gerendert) {
      this.drei.zeichne({
        breite, hoehe, auge, ziel, oben,
        nah: Math.max(r * 0.01, 0.01), fern: abstand + r * 4,
        hintergrund: this.hintergrund, farbe: this.farbe,
        blass: this.farbe.map((w) => w * 0.3 + 0.04),
        hervor: this.hervor, ausgeblendet: this.ausgeblendet, dateiFarben: this.dateiFarben
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

    // Ist ein Teil ausgewählt, werden die übrigen zurückgenommen statt
    // ausgeblendet: So bleibt sichtbar, wo das Teil im Ganzen sitzt.
    const blass = this.farbe.map((w) => w * 0.22 + 0.05);
    let letzteFarbe = null;

    for (const n of this.netze) {
      if (this.ausgeblendet.has(n.teil)) continue;
      const betont = this.hervor === null || n.teil === this.hervor;

      // Mehrfarbig: je Filament ein Abschnitt des Indexpuffers. Zurueck-
      // genommene Teile bleiben einfarbig blass - bunt und blass zugleich
      // waere nur unruhig.
      if (betont && this.dateiFarben && n.bereiche) {
        gl.bindVertexArray(n.vao);
        for (const stueck of n.bereiche) {
          gl.uniform3fv(this.orte.farbe, stueck.farbe);
          gl.drawElements(gl.TRIANGLES, stueck.anzahl, gl.UNSIGNED_INT, stueck.ab * 4);
        }
        letzteFarbe = null;
        continue;
      }

      const gewollt = betont ? this.farbe : blass;
      if (gewollt !== letzteFarbe) {
        gl.uniform3fv(this.orte.farbe, new Float32Array(gewollt));
        letzteFarbe = gewollt;
      }
      gl.bindVertexArray(n.vao);
      if (n.indexPuffer) gl.drawElements(gl.TRIANGLES, n.anzahl, gl.UNSIGNED_INT, 0);
      else gl.drawArrays(gl.TRIANGLES, 0, n.anzahl);
    }
    gl.bindVertexArray(null);
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
        this.drehung += dx * 0.008 * kopf;
        // Ohne Anschlag: hoch und runter so weit wie links und rechts. Der
        // Winkel bleibt zwischen -pi und pi, damit er nicht endlos waechst.
        this.hoehe += dy * 0.008;
        if (this.hoehe > Math.PI) this.hoehe -= 2 * Math.PI;
        if (this.hoehe < -Math.PI) this.hoehe += 2 * Math.PI;
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
        for (let a = 0; a < 3; a++) {
          this.schub[a] += (dx * rechts[a] + dy * hoch[a]) * schritt;
        }
      }
      this.zeichne();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.abstand = Math.max(this.radius * 0.2,
        Math.min(this.radius * 20, this.abstand * (1 + Math.sign(e.deltaY) * 0.12)));
      this.zeichne();
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
