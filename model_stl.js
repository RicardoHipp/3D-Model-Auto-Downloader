// Eigener Gueltigkeitsbereich: Ohne Module teilen sich alle Skripte
// einen Namensraum, und gleich benannte Hilfsfunktionen in zwei
// Dateien ueberschreiben sich sonst gegenseitig.
(() => {

// STL lesen - binär und ASCII.
//
// Zurück kommt immer dasselbe: ein Float32Array mit drei Zahlen je Ecke,
// drei Ecken je Dreieck, ohne Index. Normalen liefern wir nicht mit: Die in
// der Datei sind oft falsch oder null, und der Shader rechnet sie ohnehin
// aus den Ableitungen der Fläche aus. Spart ein Drittel Speicher.

function liesStl(puffer) {
  return istAscii(puffer) ? liesAscii(puffer) : liesBinaer(puffer);
}

// Ein binäres STL hat 84 Byte Kopf und danach exakt 50 Byte je Dreieck.
// Stimmt diese Rechnung, ist es binär - verlässlicher als auf "solid" am
// Anfang zu prüfen, denn manche Programme schreiben das auch in binäre
// Dateien.
function istAscii(puffer) {
  if (puffer.byteLength < 84) return true;
  const anzahl = new DataView(puffer).getUint32(80, true);
  return 84 + anzahl * 50 !== puffer.byteLength;
}

function liesBinaer(puffer) {
  const sicht = new DataView(puffer);
  const dreiecke = sicht.getUint32(80, true);
  const ecken = new Float32Array(dreiecke * 9);

  let ab = 84, schreib = 0;
  for (let d = 0; d < dreiecke; d++) {
    ab += 12;                              // Normale überspringen
    for (let e = 0; e < 9; e++, ab += 4) {
      ecken[schreib++] = sicht.getFloat32(ab, true);
    }
    ab += 2;                               // Attributfeld überspringen
  }
  return { ecken, dreiecke };
}

function liesAscii(puffer) {
  const text = new TextDecoder().decode(puffer);
  const zahlen = [];
  // Nur die vertex-Zeilen interessieren; facet normal lassen wir liegen.
  const muster = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let treffer;
  while ((treffer = muster.exec(text))) {
    zahlen.push(+treffer[1], +treffer[2], +treffer[3]);
  }
  return { ecken: new Float32Array(zahlen), dreiecke: zahlen.length / 9 };
}

// --- In einzelne Koerper zerlegen ---------------------------------------
//
// Ein STL kennt keine Objekte, nur einen Haufen Dreiecke. Was davon ein
// Koerper ist, verraet allein der Zusammenhang: Dreiecke, die sich eine
// Ecke teilen, gehoeren zusammen. Genau das machen die Slicer mit "In
// Objekte aufteilen".
//
// Die Ecken werden dafuer verschweisst - in der Datei steht jede geteilte
// Ecke mehrfach, bei jedem angrenzenden Dreieck einmal. Verglichen werden
// die Zahlen so, wie sie in der Datei stehen; ein Programm, das dieselbe
// Ecke zweimal leicht unterschiedlich schreibt, waere damit nicht zu
// fassen - in der Praxis kommt das aber nicht vor.
function zerlegeNetz(ecken) {
  const anzahlEcken = ecken.length / 3;
  const schluessel = new Map();
  const knoten = new Int32Array(anzahlEcken);
  let anzahlKnoten = 0;

  for (let i = 0; i < anzahlEcken; i++) {
    const k = ecken[i * 3] + '|' + ecken[i * 3 + 1] + '|' + ecken[i * 3 + 2];
    let id = schluessel.get(k);
    if (id === undefined) { id = anzahlKnoten++; schluessel.set(k, id); }
    knoten[i] = id;
  }

  // Verbundsuche mit Pfadverkuerzung: Jede Ecke zeigt am Ende auf die
  // Wurzel ihres Koerpers.
  const eltern = new Int32Array(anzahlKnoten);
  for (let i = 0; i < anzahlKnoten; i++) eltern[i] = i;
  const wurzel = (i) => {
    while (eltern[i] !== i) { eltern[i] = eltern[eltern[i]]; i = eltern[i]; }
    return i;
  };
  const verbinde = (a, b) => {
    const wa = wurzel(a), wb = wurzel(b);
    if (wa !== wb) eltern[wb] = wa;
  };

  const anzahlDreiecke = anzahlEcken / 3;
  for (let d = 0; d < anzahlDreiecke; d++) {
    verbinde(knoten[d * 3], knoten[d * 3 + 1]);
    verbinde(knoten[d * 3], knoten[d * 3 + 2]);
  }

  // Dreiecke nach Koerper zaehlen, dann in einem Rutsch umkopieren.
  const koerper = new Map();
  const zuordnung = new Int32Array(anzahlDreiecke);
  for (let d = 0; d < anzahlDreiecke; d++) {
    const w = wurzel(knoten[d * 3]);
    let nr = koerper.get(w);
    if (nr === undefined) { nr = koerper.size; koerper.set(w, nr); }
    zuordnung[d] = nr;
  }

  const groessen = new Int32Array(koerper.size);
  for (let d = 0; d < anzahlDreiecke; d++) groessen[zuordnung[d]]++;

  const netze = [];
  const stand = new Int32Array(koerper.size);
  for (let n = 0; n < koerper.size; n++) {
    netze.push({ ecken: new Float32Array(groessen[n] * 9), indizes: null, teil: n });
  }
  for (let d = 0; d < anzahlDreiecke; d++) {
    const n = zuordnung[d];
    const ziel = netze[n].ecken;
    let schreib = stand[n] * 9;
    stand[n]++;
    for (let k = 0; k < 9; k++) ziel[schreib + k] = ecken[d * 9 + k];
  }
  return ohneBruchstuecke(netze);
}

// Netzfehler ergeben lauter winzige Scherben - beim Testen an einer Figur
// mit zwei Millionen Dreiecken waren es 294 Stueck von unter einem halben
// Millimeter neben dem einen echten Koerper. Als Teile taugen sie nicht,
// wegwerfen darf man sie aber auch nicht: Sie gehoeren zur Datei. Also
// werden sie dem naechstgelegenen richtigen Koerper zugeschlagen.
const WINZIG_MM = 1;

function huelleVonEcken(ecken) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ecken.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (ecken[i + k] < min[k]) min[k] = ecken[i + k];
      if (ecken[i + k] > max[k]) max[k] = ecken[i + k];
    }
  }
  return { min, max, mitte: [0, 1, 2].map((k) => (min[k] + max[k]) / 2) };
}

function ohneBruchstuecke(netze) {
  if (netze.length < 2) return netze;

  const huellen = netze.map((n) => huelleVonEcken(n.ecken));
  const istGross = huellen.map((h) =>
    Math.hypot(h.max[0] - h.min[0], h.max[1] - h.min[1], h.max[2] - h.min[2]) >= WINZIG_MM);
  const grosse = istGross.map((g, i) => (g ? i : -1)).filter((i) => i >= 0);
  if (!grosse.length || grosse.length === netze.length) return netze;

  // Jeder Koerper sammelt seine Scherben ein.
  const gruppen = new Map(grosse.map((i) => [i, [i]]));
  for (let i = 0; i < netze.length; i++) {
    if (istGross[i]) continue;
    let bester = grosse[0], kuerzeste = Infinity;
    for (const g of grosse) {
      const d = Math.hypot(
        huellen[i].mitte[0] - huellen[g].mitte[0],
        huellen[i].mitte[1] - huellen[g].mitte[1],
        huellen[i].mitte[2] - huellen[g].mitte[2]);
      if (d < kuerzeste) { kuerzeste = d; bester = g; }
    }
    gruppen.get(bester).push(i);
  }

  const raus = [];
  for (const [, teile] of gruppen) {
    if (teile.length === 1) {
      raus.push({ ...netze[teile[0]], teil: raus.length });
      continue;
    }
    const laenge = teile.reduce((s, i) => s + netze[i].ecken.length, 0);
    const ecken = new Float32Array(laenge);
    let ab = 0;
    for (const i of teile) { ecken.set(netze[i].ecken, ab); ab += netze[i].ecken.length; }
    raus.push({ ecken, indizes: null, teil: raus.length });
  }
  return raus;
}

// --- STL schreiben -------------------------------------------------------
//
// Binär, nicht ASCII: ein Zehntel der Dateigröße und ohne Rundungsfragen
// beim Aufschreiben der Zahlen. Die Normale je Dreieck rechnen wir aus den
// Ecken aus - sie darf laut Norm zwar null sein, aber manche Programme
// stolpern darüber.
//
// netze: [{ ecken: Float32Array, indizes?: Uint32Array }, ...]
// aufsetzen: Teil in X/Y mitteln und auf Z=0 stellen, wie es ein Slicer
// erwartet. Ohne das läge es dort, wo es auf dem Druckbett des Originals
// stand - unter Umständen weit außerhalb der Mitte.
function schreibeStl(netze, aufsetzen = true) {
  let anzahl = 0;
  for (const n of netze) {
    anzahl += n.indizes?.length ? n.indizes.length / 3 : n.ecken.length / 9;
  }

  const versatz = aufsetzen ? mittelpunkt(netze) : [0, 0, 0];
  const puffer = new ArrayBuffer(84 + anzahl * 50);
  const sicht = new DataView(puffer);
  // Die 80 Byte Kopf bleiben leer. Ein "solid" am Anfang bringt manche
  // Leser dazu, die Datei für ASCII zu halten.
  sicht.setUint32(80, anzahl, true);

  let ab = 84;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];

  for (const netz of netze) {
    const { ecken, indizes } = netz;
    const dreiecke = indizes?.length ? indizes.length / 3 : ecken.length / 9;
    for (let d = 0; d < dreiecke; d++) {
      for (let e = 0; e < 3; e++) {
        const i = (indizes?.length ? indizes[d * 3 + e] : d * 3 + e) * 3;
        const ziel = e === 0 ? a : e === 1 ? b : c;
        for (let k = 0; k < 3; k++) ziel[k] = ecken[i + k] - versatz[k];
      }

      const n = normale(a, b, c);
      for (let k = 0; k < 3; k++, ab += 4) sicht.setFloat32(ab, n[k], true);
      for (const ecke of [a, b, c]) {
        for (let k = 0; k < 3; k++, ab += 4) sicht.setFloat32(ab, ecke[k], true);
      }
      sicht.setUint16(ab, 0, true);
      ab += 2;
    }
  }
  return puffer;
}

function normale(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  const l = Math.hypot(x, y, z);
  // Entartete Dreiecke haben keine Richtung; dort bleibt die Normale null,
  // das ist laut Norm zulässig.
  return l ? [x / l, y / l, z / l] : [0, 0, 0];
}

// Mitte in X und Y, Unterkante in Z.
function mittelpunkt(netze) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { ecken } of netze) {
    for (let i = 0; i < ecken.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (ecken[i + k] < min[k]) min[k] = ecken[i + k];
        if (ecken[i + k] > max[k]) max[k] = ecken[i + k];
      }
    }
  }
  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
}

globalThis.liesStl = liesStl;
globalThis.schreibeStl = schreibeStl;
globalThis.zerlegeNetz = zerlegeNetz;

})();
