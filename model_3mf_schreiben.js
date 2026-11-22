// 3MF schreiben - mit Farben, fuer alle gaengigen Slicer.
//
// STL kennt keine Farben. Ein 3MF dagegen kann sie auf mehreren Wegen
// tragen, und jeder Slicer liest einen anderen. Geschrieben werden deshalb
// alle, die etwas bringen:
//
//   - Nach 3MF-Norm: eine Farbpalette (<basematerials>), jedes Objekt mit
//     seiner Grundfarbe (pid/pindex), abweichende Dreiecke mit eigener (p1).
//     Das lesen alle normtreuen Programme.
//   - Bambu Studio und OrcaSlicer: paint_color an bemalten Dreiecken, dazu
//     in Metadata/model_settings.config das Filament jedes Objekts und in
//     Metadata/project_settings.config die Filamente samt Farben (siehe
//     projektEinstellungen).
//   - PrusaSlicer: dieselbe Bemalung als slic3rpe:mmu_segmentation und die
//     Farben in Metadata/Slic3r_PE.config.
//
// Bemalung: Die Slicer unterteilen teilweise bemalte Dreiecke und schreiben
// die Unterteilung als Hex-Ziffern an das Dreieck (siehe model_3mf.js,
// malfarbe). Die Originaldaten dafuer haben wir beim Lesen behalten; sie
// gehen unveraendert wieder hinaus. So bleibt die Bemalung im Slicer genau
// wie im Original, und das Netz selbst bekommt keine zusaetzlichen Ecken -
// es bleibt geschlossen.
//
// Lage wie beim STL: in X/Y gemittelt und auf Z=0 gestellt, alle Teile
// gemeinsam, damit sie zueinander stehen bleiben.
//
// netze: wie vom Leser (ecken, indizes, teil, extruder, dreieckFarbe,
//        teilungNr/teilungCode), farbtafel: ["#rrggbb", ...] (Filament 1..n)
// teile: [{ nummer, name }] oder leer
// Ergebnis: Promise<Blob>
(() => {

const KOPF = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NORM = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRUSA = 'http://schemas.slic3r.org/3mf/2017/06';
// Eigener Namensraum fuer ein Kennzeichen am <model>: "von dieser
// Erweiterung geschrieben". Slicer ignorieren unbekannte Attribute fremder
// Namensraeume; unser Leser erkennt daran, dass die Farbe gewollt ist -
// auch bei einem einfarbigen Teil (siehe EIGENER_EXPORT in model_3mf.js).
const EIGEN = 'https://github.com/RicardoHipp/3D-Model-Auto-Downloader';
const ANWENDUNG = '3D Model Downloader & Organizer';

// --- Bemalung verschluesseln ----------------------------------------------
// Ein ungeteiltes Dreieck in Filament n: Von hinten gelesen tragen die
// oberen zwei Bit der letzten Ziffer die Nummer, ab 3 folgt der Rest davor.
// "4" = Filament 1, "8" = 2, "0C" = 3, "1C" = 4 ...
const HEX = '0123456789ABCDEF';
function malCode(n) {
  if (n < 3) return HEX[n << 2];
  let rest = n - 3, code = 'C';
  while (rest >= 15) { code = 'F' + code; rest -= 15; }
  return HEX[rest] + code;
}

const xmlText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Zahlen kurz und ohne Rundungsreste: auf 0,01 Mikrometer.
const dekodierer = new TextDecoder();
const zahl = (v) => String(Math.round(v * 1e5) / 1e5);

function mittelpunkt(netze) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { ecken } of netze) {
    for (let i = 0; i < ecken.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const w = ecken[i + k];
        if (w < min[k]) min[k] = w;
        if (w > max[k]) max[k] = w;
      }
    }
  }
  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
}

// Ecken je Netz auf die tatsaechlich benutzten verkleinern. Ein STL hat gar
// keine gemeinsamen Ecken - dort werden gleiche Positionen zusammengelegt,
// sonst saehe der Slicer lauter lose Dreiecke.
function eckenUndDreiecke(netz) {
  const { ecken, indizes } = netz;
  const anzahl = ecken.length / 3;
  const neu = new Int32Array(anzahl).fill(-1);
  const liste = [];
  let nummer = 0;
  if (indizes?.length) {
    const dreiecke = new Uint32Array(indizes.length);
    for (let c = 0; c < indizes.length; c++) {
      const e = indizes[c];
      if (neu[e] < 0) { neu[e] = nummer++; liste.push(e); }
      dreiecke[c] = neu[e];
    }
    return { auswahl: liste, dreiecke };
  }
  const bits = new Uint32Array(ecken.buffer, ecken.byteOffset, ecken.length);
  const tafel = new Map();
  const dreiecke = new Uint32Array(anzahl);
  for (let e = 0; e < anzahl; e++) {
    const schluessel = bits[e * 3] + ',' + bits[e * 3 + 1] + ',' + bits[e * 3 + 2];
    let nr = tafel.get(schluessel);
    if (nr === undefined) { nr = nummer++; tafel.set(schluessel, nr); liste.push(e); }
    dreiecke[e] = nr;
  }
  return { auswahl: liste, dreiecke };
}

// --- Das Modell als Folge von Textstuecken ---------------------------------
// Grosse Modelle ergeben Hunderte Megabyte Text - mehr, als in eine
// Zeichenkette passt. Deshalb in Stuecken, die gleich gepackt werden.
function* modellText(objekte, farbtafel, bunt) {
  yield KOPF + `<model unit="millimeter" xml:lang="en-US" xmlns="${NORM}" xmlns:slic3rpe="${PRUSA}" xmlns:mdo="${EIGEN}" mdo:export="1">\n`
    + ` <metadata name="Application">${xmlText(ANWENDUNG)}</metadata>\n <resources>\n`;
  if (bunt) {
    yield '  <basematerials id="1">\n' + farbtafel.map((hex, i) =>
      `   <base name="${xmlText('Filament ' + (i + 1))}" displaycolor="${hex.toUpperCase()}FF"/>\n`).join('')
      + '  </basematerials>\n';
  }
  let stueck = '';
  for (const o of objekte) {
    const farbe = bunt ? ` pid="1" pindex="${o.extruder - 1}"` : '';
    stueck += `  <object id="${o.id}" name="${xmlText(o.name)}" type="model"${farbe}>\n   <mesh>\n    <vertices>\n`;
    for (const t of o.teile) {
      const { ecken, versatz } = t;
      for (const e of t.auswahl) {
        stueck += `     <vertex x="${zahl(ecken[e * 3] - versatz[0])}" y="${zahl(ecken[e * 3 + 1] - versatz[1])}" z="${zahl(ecken[e * 3 + 2] - versatz[2])}"/>\n`;
        if (stueck.length > 1 << 20) { yield stueck; stueck = ''; }
      }
    }
    stueck += '    </vertices>\n    <triangles>\n';
    for (const t of o.teile) {
      const { dreiecke, basis, farbeVon, codeVon } = t;
      for (let d = 0; d < dreiecke.length / 3; d++) {
        stueck += `     <triangle v1="${dreiecke[d * 3] + basis}" v2="${dreiecke[d * 3 + 1] + basis}" v3="${dreiecke[d * 3 + 2] + basis}"`;
        if (bunt) {
          const f = farbeVon(d);
          if (f !== o.extruder) stueck += ` pid="1" p1="${f - 1}"`;
          const code = codeVon(d);
          if (code) stueck += ` paint_color="${code}" slic3rpe:mmu_segmentation="${code}"`;
        }
        stueck += '/>\n';
        if (stueck.length > 1 << 20) { yield stueck; stueck = ''; }
      }
    }
    stueck += '    </triangles>\n   </mesh>\n  </object>\n';
  }
  yield stueck + ' </resources>\n <build>\n'
    + objekte.map((o) => `  <item objectid="${o.id}" printable="1"/>\n`).join('')
    + ' </build>\n</model>\n';
}

// Teile zu Objekten: alle Netze eines Teils in eines.
function baueObjekte(netze, teile, farbtafel, versatz) {
  const gruppen = new Map();
  for (const n of netze) {
    const schluessel = n.teil ?? 0;
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(n);
  }
  const zahlFilamente = Math.max(1, farbtafel.length);
  const gueltig = (f) => (f >= 1 && f <= zahlFilamente ? f : 1);
  const objekte = [];
  for (const [nummer, liste] of gruppen) {
    const teil = teile.find((t) => t.nummer === nummer);
    const name = teil?.name || (gruppen.size > 1 ? 'Teil ' + (Number(nummer) + 1) : 'Modell');
    // Grundfarbe: das Filament, mit dem das erste Netz gedruckt wird.
    const extruder = gueltig(liste[0].extruder || 1);
    let basis = 0;
    const stuecke = liste.map((n) => {
      const { auswahl, dreiecke } = eckenUndDreiecke(n);
      const eigen = gueltig(n.extruder || 1);
      const bemalt = n.dreieckFarbe;
      const geteilt = new Map();
      (n.teilungNr || []).forEach((nr, i) => geteilt.set(nr, n.teilungCode[i]));
      const stueck = {
        ecken: n.ecken, versatz, auswahl, dreiecke, basis,
        farbeVon: (d) => gueltig((bemalt && bemalt[d]) || eigen),
        // Originale Unterteilung, sonst die Farbe des ganzen Dreiecks,
        // wenn sie von der Grundfarbe des Objekts abweicht.
        codeVon: (d) => {
          const roh = geteilt.get(d);
          if (roh) return dekodierer.decode(roh);
          // Auch wo das Dreieck die Grundfarbe des Teils hat: Ob ein Slicer
          // die Grundfarbe aus model_settings.config uebernimmt, ist nicht
          // sicher - die Bemalung schon (so machen es auch andere
          // Programme beim Export). Nur bei Filament 1 ueberall ist nichts zu sagen.
          const f = gueltig((bemalt && bemalt[d]) || eigen);
          return f !== extruder || f !== 1 ? malCode(f) : '';
        }
      };
      basis += auswahl.length;
      return stueck;
    });
    objekte.push({ id: objekte.length + 1, name, extruder, teile: stuecke });
  }
  return objekte;
}

// --- Projekteinstellungen fuer Bambu Studio und OrcaSlicer ---------------------
//
// Die Farbtoene der Filamente liest OrcaSlicer nur aus
// Metadata/project_settings.config. Fehlt dort ein Filament, legt Orca
// selbst eines an - mit der naechsten Farbe aus seiner eigenen Reihe
// (Plater.cpp, get_next_color_for_filament), daher sonst etwa Tuerkis statt
// Schwarz. Geschrieben wird deshalb ein vollstaendiger Satz Werte je
// Filament (Generic PLA), wie ihn fremde Exporte mitbringen, die in Orca
// einwandfrei laden. Eine Fassung nur mit den Farben liess dagegen Orcas
// Kommandozeile abstuerzen - die stuerzt allerdings auch an jenen fremden
// Dateien ab, sagt also ueber das Programmfenster nichts.
// Werte je Filament; jedes Feld wird so oft wiederholt, wie es Filamente gibt.
// Nur Einstellwerte - Start- und End-G-Code bleiben leer. Der Beispielcode
// der Vorlage regelte nur Zusatzluefter bestimmter Bambu-Drucker; wer das
// braucht, waehlt im Slicer sein Filamentprofil. Stammt das Modell aus einem
// Bambu-/Orca-Projekt, gilt ohnehin dessen eigener Code.
const PROJEKT_JE_FILAMENT = {
  "activate_air_filtration": "0",
  "additional_cooling_fan_speed": "0",
  "chamber_temperatures": "0",
  "circle_compensation_speed": "200",
  "close_fan_the_first_x_layers": "1",
  "complete_print_exhaust_fan_speed": "80",
  "cool_plate_temp": "35",
  "cool_plate_temp_initial_layer": "35",
  "counter_coef_1": "0",
  "counter_coef_2": "0.025",
  "counter_coef_3": "-0.11",
  "counter_limit_max": "0.05",
  "counter_limit_min": "-0.04",
  "default_filament_colour": "",
  "diameter_limit": "50",
  "during_print_exhaust_fan_speed": "60",
  "eng_plate_temp": "45",
  "eng_plate_temp_initial_layer": "45",
  "fan_cooling_layer_time": "60",
  "fan_max_speed": "100",
  "fan_min_speed": "20",
  "filament_adaptive_volumetric_speed": "0",
  "filament_adhesiveness_category": "0",
  "filament_change_length": "10",
  "filament_colour_type": "1",
  "filament_cooling_before_tower": "10",
  "filament_cost": "0",
  "filament_density": "0",
  "filament_diameter": "1.75",
  "filament_end_gcode": " ",
  "filament_extruder_variant": "Direct Drive Standard",
  "filament_flow_ratio": "0.98",
  "filament_flush_temp": "0",
  "filament_flush_volumetric_speed": "0",
  "filament_ids": "OGFL99",
  "filament_is_support": "0",
  "filament_long_retractions_when_cut": "1",
  "filament_max_volumetric_speed": "21",
  "filament_minimal_purge_on_wipe_tower": "15",
  "filament_pre_cooling_temperature": "0",
  "filament_pre_cooling_temperature_nc": "0",
  "filament_prime_volume": "45",
  "filament_prime_volume_nc": "60",
  "filament_printable": "3",
  "filament_ramming_travel_time": "0",
  "filament_ramming_travel_time_nc": "0",
  "filament_ramming_volumetric_speed": "-1",
  "filament_ramming_volumetric_speed_nc": "-1",
  "filament_retract_length_nc": "10",
  "filament_retraction_distances_when_cut": "18",
  "filament_retraction_length": "nil",
  "filament_scarf_gap": "0",
  "filament_scarf_height": "10%",
  "filament_scarf_length": "10",
  "filament_scarf_seam_type": "none",
  "filament_settings_id": "Generic PLA @System",
  "filament_shrink": "100%",
  "filament_soluble": "0",
  "filament_start_gcode": " ",
  "filament_type": "PLA",
  "filament_velocity_adaptation_factor": "1",
  "filament_vendor": "Generic",
  "filament_z_hop": "nil",
  "full_fan_speed_layer": "0",
  "hole_coef_1": "0",
  "hole_coef_2": "-0.025",
  "hole_coef_3": "0.28",
  "hole_limit_max": "0.25",
  "hole_limit_min": "0.08",
  "hot_plate_temp": "45",
  "hot_plate_temp_initial_layer": "45",
  "impact_strength_z": "0",
  "long_retractions_when_ec": "0",
  "no_slow_down_for_cooling_on_outwalls": "0",
  "nozzle_temperature": "220",
  "nozzle_temperature_initial_layer": "220",
  "nozzle_temperature_range_high": "240",
  "nozzle_temperature_range_low": "190",
  "overhang_fan_speed": "100",
  "overhang_fan_threshold": "95%",
  "reduce_fan_stop_start_freq": "0",
  "required_nozzle_HRC": "0",
  "retraction_distances_when_ec": "0",
  "slow_down_for_layer_cooling": "1",
  "slow_down_layer_time": "5",
  "slow_down_min_speed": "10",
  "supertack_plate_temp": "35",
  "supertack_plate_temp_initial_layer": "35",
  "temperature_vitrification": "100",
  "textured_plate_temp": "45",
  "textured_plate_temp_initial_layer": "45",
  "volumetric_speed_coefficients": ""
};

// Mit den Projekteinstellungen der Quelldatei (vorlage) als Grundlage:
// Drucker, Druckprofil und alles andere bleiben, wie sie waren. Geaendert
// werden nur die Filamente - jedes Feld je Filament wird auf die neue Zahl
// gebracht, und ein neues Filament uebernimmt die Werte dessen, das es
// ersetzt (herkunft: je Eintrag der Tafel die Nummer des Filaments in der
// Quelle). Ein umgefaerbtes PETG-Teil bleibt also PETG, nur in neuer Farbe.
//
// Neuere Bambu-Projekte fuehren Filamentwerte in mehreren Formen:
//   - einfach je Filament (Laenge = Zahl der Filamente),
//   - je Filament und Duesenvariante, gruppiert nach filament_self_index
//     ("1","1","2","2",...),
//   - in festen Bloecken je Filament (z. B. AMS-Trocknung, 4 je Filament),
//   - als Matrix n x n (Spuelmengen), auch mehrere hintereinander,
//   - mit zwei Eintraegen fuer Druck- und Druckerprofil drumherum
//     (different_settings_to_system, inherits_group: Druck, Filamente, Drucker).
// Jede Form waechst passend mit. Was keiner Form zuzuordnen ist, bleibt
// unberuehrt. Damit Druckerfelder nicht versehentlich mitwachsen, gelten
// einfache Laengen nur fuer Filamentfelder (Name "filament_..." oder in der
// neutralen Vorlage oben); Varianten- und Blockfelder sind an ihrer Laenge
// eindeutig genug.
function projektAusVorlage(vorlage, farbtafel, herkunft) {
  const alt = vorlage.filament_colour.length;
  const n = farbtafel.length;
  const quelle = (j) => (herkunft[j] || 1) - 1;            // 0-basiert
  const raus = JSON.parse(JSON.stringify(vorlage));
  const filamentFeld = (k) => k.startsWith('filament_') || k in PROJEKT_JE_FILAMENT;

  // Gruppen der Duesenvarianten: je Quellfilament die Stellen in den Feldern
  const selbst = Array.isArray(vorlage.filament_self_index) ? vorlage.filament_self_index.map(Number) : null;
  const stellenVon = selbst && selbst.length > alt
    ? Array.from({ length: alt }, (_, f) => selbst.flatMap((s, i) => (s === f + 1 ? [i] : [])))
    : null;
  if (stellenVon && stellenVon.some((st) => !st.length)) throw new Error('filament_self_index unvollstaendig');

  for (const [k, wert] of Object.entries(vorlage)) {
    if (!Array.isArray(wert) || !wert.length) continue;
    const L = wert.length;
    if (k === 'filament_colour' || k === 'filament_multi_colour' || k === 'flush_volumes_matrix'
        || k === 'flush_volumes_vector') continue;
    if (k === 'filament_self_index' && stellenVon) {
      raus[k] = herkunft.flatMap((_, j) => stellenVon[quelle(j)].map(() => String(j + 1)));
    } else if ((k === 'different_settings_to_system' || k === 'inherits_group') && L === alt + 2) {
      raus[k] = [wert[0], ...herkunft.map((_, j) => wert[1 + quelle(j)]), wert[L - 1]];
    } else if (stellenVon && L === selbst.length) {
      raus[k] = herkunft.flatMap((_, j) => stellenVon[quelle(j)].map((i) => wert[i]));
    } else if (L === alt && filamentFeld(k)) {
      raus[k] = herkunft.map((_, j) => wert[quelle(j)]);
    } else if (L > alt && L % alt === 0 && filamentFeld(k)) {
      const block = L / alt;
      raus[k] = herkunft.flatMap((_, j) => wert.slice(quelle(j) * block, (quelle(j) + 1) * block));
    }
  }

  // Farben: in der Schreibweise der Quelle (#RRGGBB oder #RRGGBBAA)
  const mitAlpha = String(vorlage.filament_colour[0] || '').length > 7;
  const farben = farbtafel.map((h) => (h || '#808080').slice(0, 7).toUpperCase() + (mitAlpha ? 'FF' : ''));
  raus.filament_colour = farben;
  if (Array.isArray(vorlage.filament_multi_colour)) raus.filament_multi_colour = farben;
  // Spuelmengen: eine oder mehrere n x n-Matrizen aus den Werten der
  // jeweiligen Quellfilamente, Diagonale 0.
  const matrix = vorlage.flush_volumes_matrix;
  if (Array.isArray(matrix) && matrix.length && matrix.length % (alt * alt) === 0) {
    raus.flush_volumes_matrix = [];
    for (let m = 0; m < matrix.length / (alt * alt); m++) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          raus.flush_volumes_matrix.push(i === j ? '0'
            : matrix[m * alt * alt + quelle(i) * alt + quelle(j)] ?? '280');
        }
      }
    }
  }
  const vektor = vorlage.flush_volumes_vector;
  if (Array.isArray(vektor) && vektor.length && vektor.length % alt === 0) {
    const block = vektor.length / alt;
    raus.flush_volumes_vector = herkunft.flatMap((_, j) => vektor.slice(quelle(j) * block, (quelle(j) + 1) * block));
  }
  return JSON.stringify(raus, null, 4);
}

function projektEinstellungen(farbtafel, vorlage = null, herkunft = null) {
  if (vorlage && Array.isArray(vorlage.filament_colour) && vorlage.filament_colour.length) {
    try {
      return projektAusVorlage(vorlage, farbtafel, herkunft || farbtafel.map((_, i) => i + 1));
    } catch { /* dann die neutrale Vorlage */ }
  }
  const n = farbtafel.length;
  const raus = {};
  for (const [schluessel, wert] of Object.entries(PROJEKT_JE_FILAMENT)) raus[schluessel] = Array(n).fill(wert);
  const farben = farbtafel.map((h) => (h || '#808080').slice(0, 7).toUpperCase() + 'FF');
  raus.filament_colour = farben;
  raus.filament_multi_colour = farben;
  // Spuelmengen beim Farbwechsel: n x n, auf der Diagonale 0.
  raus.flush_volumes_matrix = Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? '0' : '280'));
  raus.flush_volumes_vector = Array(2 * n).fill('140');
  raus.version = '02.04.00.70';
  raus.from = 'project';
  raus.name = 'project_settings';
  return JSON.stringify(raus, null, 4);
}

// --- Begleitdateien ----------------------------------------------------------

const INHALTSARTEN = KOPF
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
  + ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
  + ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
  + ' <Default Extension="config" ContentType="text/xml"/>\n'
  + '</Types>\n';

const BEZIEHUNGEN = KOPF
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
  + ' <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
  + '</Relationships>\n';

function bambuObjekte(objekte) {
  return KOPF + '<config>\n' + objekte.map((o) =>
    `  <object id="${o.id}">\n    <metadata key="name" value="${xmlText(o.name)}"/>\n`
    + `    <metadata key="extruder" value="${o.extruder}"/>\n  </object>\n`).join('') + '</config>\n';
}

function prusaObjekte(objekte) {
  return KOPF + '<config>\n' + objekte.map((o) =>
    `  <object id="${o.id}" instances_count="1">\n`
    + `    <metadata type="object" key="name" value="${xmlText(o.name)}"/>\n`
    + `    <metadata type="object" key="extruder" value="${o.extruder}"/>\n  </object>\n`).join('') + '</config>\n';
}

// --- ZIP ------------------------------------------------------------------------
// Gepackt mit dem, was der Browser mitbringt (CompressionStream). Die
// gepackten Stuecke bleiben einzeln liegen und werden erst im Blob
// zusammengesetzt - kein riesiger zusammenhaengender Puffer.

const CRC_TAFEL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcWeiter(crc, bytes) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TAFEL[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function packe(stuecke) {
  const kodierer = new TextEncoder();
  const strom = new CompressionStream('deflate-raw');
  const schreiber = strom.writable.getWriter();
  const raus = [];
  const lesen = (async () => {
    const leser = strom.readable.getReader();
    let groesse = 0;
    for (;;) {
      const { done, value } = await leser.read();
      if (done) return groesse;
      raus.push(value);
      groesse += value.length;
    }
  })();
  let crc = 0, roh = 0;
  for (const text of stuecke) {
    const bytes = kodierer.encode(text);
    crc = crcWeiter(crc, bytes);
    roh += bytes.length;
    await schreiber.write(bytes);
  }
  await schreiber.close();
  const gepackt = await lesen;
  return { daten: raus, crc, roh, gepackt };
}

async function zipBlob(dateien) {
  const teile = [], verzeichnis = [];
  let ort = 0;
  const kodierer = new TextEncoder();
  for (const { name, stuecke } of dateien) {
    const { daten, crc, roh, gepackt } = await packe(stuecke);
    if (roh > 0xfffffffe || ort > 0xfffffffe) throw new Error('Modell zu gross fuer 3MF');
    const n = kodierer.encode(name);
    const kopf = new DataView(new ArrayBuffer(30));
    kopf.setUint32(0, 0x04034b50, true);
    kopf.setUint16(4, 20, true);
    kopf.setUint16(6, 0x0800, true);          // Namen in UTF-8
    kopf.setUint16(8, 8, true);               // deflate
    kopf.setUint32(14, crc, true);
    kopf.setUint32(18, gepackt, true);
    kopf.setUint32(22, roh, true);
    kopf.setUint16(26, n.length, true);
    teile.push(kopf, n, ...daten);

    const eintrag = new DataView(new ArrayBuffer(46));
    eintrag.setUint32(0, 0x02014b50, true);
    eintrag.setUint16(4, 20, true);
    eintrag.setUint16(6, 20, true);
    eintrag.setUint16(8, 0x0800, true);
    eintrag.setUint16(10, 8, true);
    eintrag.setUint32(16, crc, true);
    eintrag.setUint32(20, gepackt, true);
    eintrag.setUint32(24, roh, true);
    eintrag.setUint16(28, n.length, true);
    eintrag.setUint32(42, ort, true);
    verzeichnis.push(eintrag, n);
    ort += 30 + n.length + gepackt;
  }
  const groesse = verzeichnis.reduce((s, v) => s + v.byteLength, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, dateien.length, true);
  ende.setUint16(10, dateien.length, true);
  ende.setUint32(12, groesse, true);
  ende.setUint32(16, ort, true);
  return new Blob([...teile, ...verzeichnis, ende], { type: 'model/3mf' });
}

// --- Zusammen ---------------------------------------------------------------------

// projekt: Projekteinstellungen der Quelldatei (oder null), herkunft: je
// Eintrag der Tafel die Nummer des Quellfilaments (siehe teileUmfaerben).
async function schreibe3mf(netze, farbtafel = [], teile = [], { projekt = null, herkunft = null } = {}) {
  // Farben nur, wenn die Datei wirklich welche hat - ein einfarbiges Modell
  // bekommt keine Palette, der Slicer nimmt dann sein eigenes Filament.
  const bunt = farbtafel.length > 0;
  const versatz = mittelpunkt(netze);
  const objekte = baueObjekte(netze, teile, farbtafel, versatz);
  const dateien = [
    { name: '[Content_Types].xml', stuecke: [INHALTSARTEN] },
    { name: '_rels/.rels', stuecke: [BEZIEHUNGEN] },
    { name: '3D/3dmodel.model', stuecke: modellText(objekte, farbtafel, bunt) }
  ];
  if (bunt) {
    dateien.push(
      { name: 'Metadata/model_settings.config', stuecke: [bambuObjekte(objekte)] },
      { name: 'Metadata/project_settings.config', stuecke: [projektEinstellungen(farbtafel, projekt, herkunft)] },
      { name: 'Metadata/Slic3r_PE_model.config', stuecke: [prusaObjekte(objekte)] },
      { name: 'Metadata/Slic3r_PE.config',
        stuecke: [`; extruder_colour = ${farbtafel.map((h) => h.toUpperCase()).join(';')}\n`
                  + `; filament_colour = ${farbtafel.map((h) => h.toUpperCase()).join(';')}\n`] }
    );
  }
  return zipBlob(dateien);
}

// --- Teile umfaerben ------------------------------------------------------------
//
// Hat man im Feld "Filamente" ein Filament nur in einem Teil umgefaerbt,
// ist das fuer den Slicer ein eigenes Filament: Es kommt hinten an die
// Tafel (oder ein vorhandenes gleicher Farbe wird mitbenutzt), und in
// diesem Teil wird das alte durch das neue ersetzt - Grundfarbe, Farbe je
// Dreieck und die Malcodes fein bemalter Dreiecke.
//
// teilFarben: Map Teil -> Map Filament -> "#rrggbb".
// Ergebnis: { netze, tafel } - Kopien, die Eingaben bleiben unberuehrt.
const kodierer = new TextEncoder();

function hexWertSchreiben(b) {
  return b <= 57 ? b - 48 : b <= 70 ? b - 55 : b - 87;
}

// Einen Malcode (Hex-Ziffern, von hinten gelesen) mit neuen Filament-
// nummern neu schreiben. Der Baum bleibt, wie er ist; nur die Nummern an
// den Blaettern aendern sich (siehe malfarbe/verfeinere in model_3mf.js).
function codeUmfaerben(bytes, karte) {
  let pos = bytes.length - 1;
  const raus = [];   // Ziffern in Lesereihenfolge (vom Ende her)
  const lies = () => (pos >= 0 ? hexWertSchreiben(bytes[pos--]) : 0);
  const knoten = () => {
    const z = lies();
    const geteilt = z & 3;
    if (geteilt) {
      raus.push(z);
      for (let i = 0; i <= geteilt; i++) knoten();
      return;
    }
    let zustand = z >> 2;
    if (zustand === 3) {
      let mehr = lies();
      zustand += mehr;
      while (mehr === 15 && pos >= 0) { mehr = lies(); zustand += mehr; }
    }
    const neu = karte.get(zustand) ?? zustand;
    if (neu < 3) { raus.push(neu << 2); return; }
    raus.push(12);
    let rest = neu - 3;
    while (rest >= 15) { raus.push(15); rest -= 15; }
    raus.push(rest);
  };
  knoten();
  return kodierer.encode(raus.reverse().map((n) => HEX[n]).join(''));
}

function teileUmfaerben(netze, tafel, teilFarben) {
  // Herkunft je Eintrag der Tafel: welches Filament der Quelle er ersetzt.
  const herkunft = tafel.map((_, i) => i + 1);
  if (!teilFarben?.size) return { netze, tafel, herkunft };
  const neueTafel = [...tafel];
  const karten = new Map();   // Teil -> Map altes Filament -> neues
  for (const [teil, je] of teilFarben) {
    const karte = new Map();
    for (const [filament, hex] of je) {
      if ((neueTafel[filament - 1] || '').toUpperCase() === hex.toUpperCase()) continue;
      let ziel = neueTafel.findIndex((h) => (h || '').toUpperCase() === hex.toUpperCase());
      if (ziel < 0) { neueTafel.push(hex.toUpperCase()); herkunft.push(filament); ziel = neueTafel.length - 1; }
      karte.set(filament, ziel + 1);
    }
    if (karte.size) karten.set(teil, karte);
  }
  if (!karten.size) return { netze, tafel, herkunft };
  const neu = netze.map((n) => {
    const karte = karten.get(n.teil ?? 0);
    if (!karte) return n;
    const kopie = { ...n };
    kopie.extruder = karte.get(n.extruder || 1) ?? n.extruder;
    if (n.dreieckFarbe) kopie.dreieckFarbe = n.dreieckFarbe.map((f) => (f ? karte.get(f) ?? f : 0));
    if (n.teilungCode) kopie.teilungCode = n.teilungCode.map((c) => codeUmfaerben(c, karte));
    return kopie;
  });
  return { netze: neu, tafel: neueTafel, herkunft };
}

globalThis.schreibe3mf = schreibe3mf;
globalThis.teileUmfaerben = teileUmfaerben;

})();
