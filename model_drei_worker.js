// Weiche Normalen fuer die Ansicht "Rendern" - in einem eigenen Faden,
// damit die Seite bei grossen Modellen nicht einfriert.
//
// Nach Anleitung-Leora-Optik.md, Abschnitt 1: je Ecke der Mittelwert der
// Flaechennormalen an derselben Stelle, aber nur der Flaechen, die weniger
// als den Grenzwinkel abknicken (Voreinstellung 15 Grad, siehe model_view.js) - Kanten bleiben scharf.
//
// Das ist toCreasedNormals aus three.js (BufferGeometryUtils, r175),
// Schritt fuer Schritt nachgebaut, mit demselben Ergebnis Bit fuer Bit:
// gleiche Rechenreihenfolge, gleiches Raster zum Zusammenfassen gleicher
// Stellen (Koordinate mal 100, abgeschnitten), gleiche Reihenfolge beim
// Aufsummieren. Nur die Buchhaltung ist anders: three.js bildet fuer jede
// Ecke einen Text "x,y,z" und sucht ihn in einem Objekt - bei 13 Millionen
// Ecken rund 12 Sekunden. Hier sind es Zahlen in einer Hashtabelle.
// Geprueft gegen three.js an mehreren Dateien (siehe Sitzung 2026-11-20).
//
// Zum Schluss werden gleiche Ecken zusammengelegt (siehe zusammenlegen).
// Die Dreiecke behalten ihre Reihenfolge; die Farbabschnitte (nach
// Filament sortiert) gelten deshalb unveraendert weiter.
//
// Bekommt { nummer, ecken: Float32Array, indizes: Uint32Array | null, winkel },
// antwortet mit { nummer, lage, normalen, indizes } oder { nummer, fehler }.

// Wie in three.js: ( 1 + 1e-10 ) * 1e2
const RASTER = (1 + 1e-10) * 1e2;

function knickNormalen(ecken, indizes, winkel) {
  const grenze = Math.cos(winkel);
  const anzahl = indizes ? indizes.length : ecken.length / 3;    // Dreiecksecken
  const dreiecke = anzahl / 3;
  const punkte = ecken.length / 3;                                // Punkte der Quelle
  // Punkt zu einer Dreiecksecke. Aufgefaltet wird nicht: Bei 3MF und STEP
  // teilen sich die Dreiecke ihre Punkte, und jeder Rechenschritt, der an
  // der Lage haengt, laeuft dann nur einmal je Punkt statt je Ecke.
  const punktVon = indizes || null;

  // 1. Flaechennormalen, genau wie three.js: (c - b) x (a - b), dann mal
  //    1 / Laenge (bei Laenge 0 bleibt der Nullvektor).
  const fn = new Float64Array(dreiecke * 3);
  for (let t = 0; t < dreiecke; t++) {
    const a = (punktVon ? punktVon[t * 3] : t * 3) * 3;
    const b = (punktVon ? punktVon[t * 3 + 1] : t * 3 + 1) * 3;
    const c = (punktVon ? punktVon[t * 3 + 2] : t * 3 + 2) * 3;
    const ux = ecken[c] - ecken[b], uy = ecken[c + 1] - ecken[b + 1], uz = ecken[c + 2] - ecken[b + 2];
    const vx = ecken[a] - ecken[b], vy = ecken[a + 1] - ecken[b + 1], vz = ecken[a + 2] - ecken[b + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    fn[t * 3] = x * l; fn[t * 3 + 1] = y * l; fn[t * 3 + 2] = z * l;
  }

  // 2. Jeden Punkt auf das Raster: drei ganze Zahlen (~~ schneidet ab wie
  //    in three.js), gleiche Zahlen = gleiche Stelle. Hashtabelle mit
  //    offener Adressierung; je Stelle eine Nummer.
  let groesse = 1;
  while (groesse < punkte * 2) groesse <<= 1;
  groesse = Math.max(groesse, 1024);
  const maske = groesse - 1;
  const tafel = new Int32Array(groesse).fill(-1);
  const stelleXYZ = new Int32Array(punkte * 3);
  const punktStelle = new Int32Array(punkte);
  let stellen = 0;
  for (let p = 0; p < punkte; p++) {
    const x = ~~(ecken[p * 3] * RASTER), y = ~~(ecken[p * 3 + 1] * RASTER), z = ~~(ecken[p * 3 + 2] * RASTER);
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d));
    h = (h ^ (h >>> 15)) & maske;
    for (;;) {
      const s = tafel[h];
      if (s < 0) {
        tafel[h] = stellen;
        stelleXYZ[stellen * 3] = x; stelleXYZ[stellen * 3 + 1] = y; stelleXYZ[stellen * 3 + 2] = z;
        punktStelle[p] = stellen++;
        break;
      }
      if (stelleXYZ[s * 3] === x && stelleXYZ[s * 3 + 1] === y && stelleXYZ[s * 3 + 2] === z) {
        punktStelle[p] = s;
        break;
      }
      h = (h + 1) & maske;
    }
  }
  const stelle = new Int32Array(anzahl);
  for (let c = 0; c < anzahl; c++) stelle[c] = punktStelle[punktVon ? punktVon[c] : c];

  // 3. Je Stelle die Dreiecke ihrer Ecken, in derselben Reihenfolge, in der
  //    three.js sie sammelt (Dreieck fuer Dreieck, Ecke fuer Ecke). Ein
  //    Dreieck mit zwei Ecken an derselben Stelle steht dort zweimal - auch
  //    das wie in three.js.
  const anfang = new Uint32Array(stellen + 1);
  for (let c = 0; c < anzahl; c++) anfang[stelle[c] + 1]++;
  for (let s = 0; s < stellen; s++) anfang[s + 1] += anfang[s];
  const liste = new Uint32Array(anzahl);
  const fuell = anfang.slice(0, stellen);
  for (let c = 0; c < anzahl; c++) liste[fuell[stelle[c]]++] = (c / 3) | 0;

  // 4. Je Ecke: alle Flaechennormalen der Stelle, die mit der eigenen mehr
  //    als cos(winkel) gemeinsam haben, aufsummieren, dann normieren.
  const normalen = new Float32Array(anzahl * 3);
  for (let c = 0; c < anzahl; c++) {
    const t = ((c / 3) | 0) * 3;
    const nx = fn[t], ny = fn[t + 1], nz = fn[t + 2];
    let sx = 0, sy = 0, sz = 0;
    const s = stelle[c];
    for (let i = anfang[s], bis = anfang[s + 1]; i < bis; i++) {
      const u = liste[i] * 3;
      const ox = fn[u], oy = fn[u + 1], oz = fn[u + 2];
      if (nx * ox + ny * oy + nz * oz > grenze) { sx += ox; sy += oy; sz += oz; }
    }
    const l = 1 / (Math.sqrt(sx * sx + sy * sy + sz * sz) || 1);
    normalen[c * 3] = sx * l; normalen[c * 3 + 1] = sy * l; normalen[c * 3 + 2] = sz * l;
  }
  return zusammenlegen(ecken, punktVon, normalen, stelle, stellen);
}

// 5. Gleiche Ecken zusammenlegen: Wo Lage und Normale Bit fuer Bit gleich
//    sind - ueberall ausser an Kanten -, braucht die Grafikkarte die Ecke
//    nur einmal; die Dreiecke verweisen dann ueber einen Index darauf. Bei
//    grossen Modellen etwa ein Fuenftel der Daten, schneller hochgeladen
//    und weniger Grafikspeicher. Das Bild bleibt dasselbe; die Dreiecke
//    behalten ihre Reihenfolge, die Farbabschnitte gelten weiter.
//    Gesucht wird je Rasterstelle in einer kurzen Kette der dort schon
//    angelegten Ecken - meist eine oder zwei.
function zusammenlegen(ecken, punktVon, normalen, stelle, stellen) {
  const anzahl = stelle.length;
  const lb = new Uint32Array(ecken.buffer, ecken.byteOffset, ecken.length);
  const nb = new Uint32Array(normalen.buffer);
  const erste = new Int32Array(stellen).fill(-1);   // Stelle -> erste neue Ecke
  const naechste = new Int32Array(anzahl);           // neue Ecke -> naechste derselben Stelle
  const quelle = new Uint32Array(anzahl);            // neue Ecke -> alte Ecke
  const indizes = new Uint32Array(anzahl);
  let neu = 0;
  for (let c = 0; c < anzahl; c++) {
    const s = stelle[c], c3 = c * 3, p3 = (punktVon ? punktVon[c] : c) * 3;
    let e = erste[s], letzte = -1;
    while (e >= 0) {
      const q = quelle[e], q3 = q * 3, r3 = (punktVon ? punktVon[q] : q) * 3;
      if (nb[q3] === nb[c3] && nb[q3 + 1] === nb[c3 + 1] && nb[q3 + 2] === nb[c3 + 2]
          && (r3 === p3 || (lb[r3] === lb[p3] && lb[r3 + 1] === lb[p3 + 1] && lb[r3 + 2] === lb[p3 + 2]))) break;
      letzte = e;
      e = naechste[e];
    }
    if (e < 0) {
      e = neu++;
      quelle[e] = c;
      naechste[e] = -1;
      if (letzte < 0) erste[s] = e; else naechste[letzte] = e;
    }
    indizes[c] = e;
  }
  const lage = new Float32Array(neu * 3), neueNormalen = new Float32Array(neu * 3);
  for (let e = 0; e < neu; e++) {
    const q = quelle[e], q3 = q * 3, p3 = (punktVon ? punktVon[q] : q) * 3, e3 = e * 3;
    lage[e3] = ecken[p3]; lage[e3 + 1] = ecken[p3 + 1]; lage[e3 + 2] = ecken[p3 + 2];
    neueNormalen[e3] = normalen[q3]; neueNormalen[e3 + 1] = normalen[q3 + 1]; neueNormalen[e3 + 2] = normalen[q3 + 2];
  }
  return { lage, normalen: neueNormalen, indizes };
}

onmessage = ({ data }) => {
  try {
    const { lage, normalen, indizes } = knickNormalen(data.ecken, data.indizes, data.winkel);
    postMessage({ lauf: data.lauf, nummer: data.nummer, lage, normalen, indizes },
                [lage.buffer, normalen.buffer, indizes.buffer]);
  } catch (fehler) {
    postMessage({ lauf: data.lauf, nummer: data.nummer, fehler: String(fehler?.message || fehler) });
  }
};
