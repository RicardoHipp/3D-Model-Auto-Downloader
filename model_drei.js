// Ansicht "Rendern" mit three.js (vendor/three.min.js, MIT-Lizenz).
//
// Aufbau:
//   1. Weiche Normalen mit scharfen Kanten (wie toCreasedNormals, Knickwinkel einstellbar) -
//      in model_drei_worker.js.
//   2. Renderer: sRGB-Ausgabe, ACES-Tonemapping, weiche Schatten.
//   3. Umgebung (RoomEnvironment) fuer Reflexe und Grundhelligkeit, dazu
//      Haupt-, Fuell- und Kantenlicht, die mit der Kamera mitdrehen.
//   4. Material MeshStandardMaterial, Rauheit 0,55, je Filament eines.
//   5. Bodenschatten unter dem Modell.
//
// Gezeichnet wird auf eine eigene Leinwand, die genau ueber der flachen
// liegt und keine Maus annimmt. Drehen, Zoomen und Anklicken laufen deshalb
// weiter ueber den eigenen Renderer (model_view.js); der gibt hier nur die
// Kamera durch. Die flache Ansicht und die Vorschaubilder bleiben unberuehrt.
(() => {

// Lichter fuer ein Modell der Groesse 1 um den Ursprung: x nach rechts, y nach oben, z zum Betrachter. Hier in
// Kamerakoordinaten und mit dem Modellradius skaliert.
const LICHTER = [
  { lage: [1.5, 2.5, 2.0], staerke: 2.2, schatten: true },   // Haupt
  { lage: [-2, 1, 1], staerke: 0.5 },                        // Fuell
  { lage: [0, 2, -3], staerke: 1.0 }                         // Kante
];
const SICHT = 35;          // Grad, wie ein Fotoobjektiv
const RAUHEIT = 0.55;
const WEISS = new DREI.Color(1, 1, 1);
const SCHWARZ = new DREI.Color(0, 0, 0);
const SCHATTENKARTE = 4096;  // Punkte je Seite

// --- Schattenkarte zuschneiden --------------------------------------------
//
// Die Schattenkarte ist ein Bild aus Sicht des Hauptlichts. Ueberspannt sie
// das ganze Modell, bleiben beim Heranzoomen nur wenige ihrer Punkte im
// Bildausschnitt - Schattenkanten werden treppig, schraeg beleuchtete Flaechen
// wellig. Deshalb wird sie bei jedem Bild nur ueber das gespannt, was gerade
// wirklich zu sehen ist.
//
// Was zu sehen ist, liefert ein kleiner Vorlauf: Die Szene wird in ein
// winziges Bild gezeichnet, das statt Farben die Weltlage jedes Punkts
// enthaelt. Ein reiner Schnitt aus Sichtfeld und Modell reicht nicht - das
// Sichtfeld weitet sich hinter der sichtbaren Flaeche durchs ganze Modell,
// und nah herangezoomt waere kaum etwas gewonnen (nachgerechnet).
//
// Begrenzt wird nur quer zum Licht. In Lichtrichtung bleibt das ganze Modell
// drin - Schatten von Teilen ausserhalb des Bildes fallen weiter richtig.
const VORLAUF = 96;          // Punkte des Vorlaufbilds in der Breite

const WELTLAGE = new DREI.ShaderMaterial({
  side: DREI.DoubleSide,
  vertexShader: `
    varying vec3 vWelt;
    void main() {
      vec4 welt = modelMatrix * vec4(position, 1.0);
      vWelt = welt.xyz;
      gl_Position = projectionMatrix * viewMatrix * welt;
    }`,
  fragmentShader: `
    varying vec3 vWelt;
    void main() { gl_FragColor = vec4(vWelt, 1.0); }`
});

// Material fuer das Drahtgitter eines Netzes. Wie in der flachen Ansicht
// (LINIEN_SHADER in model_view.js) sinkt die Deckkraft, wenn die Kanten auf
// dem Bildschirm kuerzer als 8 Bildpunkte werden - herausgezoomt bleibt ein
// gleichmaessiger Schleier statt eines zugelaufenen Bilds. kantePx:
// typische Kantenlaenge in Bildpunkten im Abstand 1, je Bild gesetzt.
function drahtMaterial() {
  const m = new DREI.MeshBasicMaterial({ wireframe: true, transparent: true, depthWrite: false });
  m.userData.kantePx = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.kantePx = m.userData.kantePx;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vTiefe;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vTiefe = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform float kantePx;\nvarying float vTiefe;\nvoid main() {')
      .replace('#include <opaque_fragment>',
        'diffuseColor.a = max(diffuseColor.a * clamp(kantePx / max(vTiefe, 1e-6) / 8.0, 0.0, 1.0), 0.015);\n' +
        '#include <opaque_fragment>');
  };
  return m;
}

class DreiBuehne {
  constructor(unter) {
    this.unter = unter;
    const leinwand = document.createElement('canvas');
    leinwand.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    leinwand.hidden = true;
    // Als erstes Kind der Buehne: Positionierte Elemente werden in der
    // Reihenfolge der Seite gemalt. Ganz vorn liegt diese Leinwand unter
    // Knoepfen, Leiste und Hinweisen, aber ueber der flachen Leinwand.
    unter.parentNode.prepend(leinwand);
    this.leinwand = leinwand;
    this.sichtbar = false;
    // model.js blendet die flache Leinwand aus, wenn ein Bild oder PDF
    // gezeigt wird - dann muss diese mit verschwinden.
    this.beobachter = new MutationObserver(() => this.zeigen(this.sichtbar));
    this.beobachter.observe(unter, { attributes: true, attributeFilter: ['hidden'] });

    const r = new DREI.WebGLRenderer({ canvas: leinwand, antialias: true });
    r.outputColorSpace = DREI.SRGBColorSpace;
    r.toneMapping = DREI.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = DREI.PCFSoftShadowMap;
    this.renderer = r;

    const szene = new DREI.Scene();
    const pmrem = new DREI.PMREMGenerator(r);
    szene.environment = pmrem.fromScene(new DREI.RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.szene = szene;

    this.kamera = new DREI.PerspectiveCamera(SICHT, 1, 0.1, 1000);

    this.lichter = LICHTER.map(({ lage, staerke, schatten }) => {
      const licht = new DREI.DirectionalLight(0xffffff, staerke);
      if (schatten) {
        licht.castShadow = true;
        licht.shadow.mapSize.set(SCHATTENKARTE, SCHATTENKARTE);
        licht.shadow.radius = 4;
        licht.shadow.bias = -0.0005;
      }
      szene.add(licht, licht.target);
      return { licht, richtung: lage };
    });

    // Boden, der nur den Schatten zeigt. In 3MF und STL ist Z oben - die
    // Ebene liegt von Haus aus flach in X/Y.
    this.boden = new DREI.Mesh(new DREI.PlaneGeometry(1, 1),
                               new DREI.ShadowMaterial({ opacity: 0.25 }));
    this.boden.receiveShadow = true;
    szene.add(this.boden);

    this.gruppe = new DREI.Group();
    szene.add(this.gruppe);
    this.netze = [];
    // polygonOffset: Flaechen ein wenig nach hinten, damit ein Drahtgitter
    // darueber nicht mit ihnen um dieselbe Tiefe streitet.
    this.einfach = new DREI.MeshStandardMaterial({ roughness: RAUHEIT, metalness: 0, side: DREI.DoubleSide,
                                                   polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.blass = this.einfach.clone();
    // Drahtgitter: teilt sich die Geometrie mit dem Netz. three.js baut die
    // Kanten daraus selbst, jede nur einmal. Je Netz ein eigenes Material
    // (siehe drahtMaterial) - die Deckkraft haengt an seiner Kantenlaenge.
  }

  // Neue Farben fuer die Abschnitte eines Netzes (Feld "Filamente").
  faerbe(nummer, bereiche) {
    const n = this.netze[nummer];
    if (!n) return;
    bereiche.forEach((stueck, i) => { if (n.farben[i]) n.farben[i].userData.hex = stueck.hex; });
  }

  stelleLicht({ belichtung, umgebung, haupt, fuell, kante, rauheit, schatten, karte }) {
    this.renderer.toneMappingExposure = belichtung;
    this.szene.environmentIntensity = umgebung;
    [haupt, fuell, kante].forEach((staerke, i) => { this.lichter[i].licht.intensity = staerke; });
    this.boden.material.opacity = schatten;
    this.boden.visible = schatten > 0;
    if (karte) {
      const s = this.lichter[0].licht.shadow;
      const punkte = Math.min(karte, this.renderer.capabilities.maxTextureSize);
      if (s.mapSize.x !== punkte) {
        s.mapSize.set(punkte, punkte);
        s.map?.dispose();
        s.map = null;
      }
    }
    if (this.rauheit !== rauheit) {
      this.rauheit = rauheit;
      this.einfach.roughness = this.blass.roughness = rauheit;
      for (const n of this.netze) for (const m of n?.farben || []) m.roughness = rauheit;
    }
  }

  zeigen(an) {
    this.sichtbar = an;
    this.leinwand.hidden = !an || this.unter.hidden;
  }

  // Fuer die Bildratenanzeige des Betrachters: Groesse der Schattenkarte und
  // wie breit sie gerade ueber das Modell gespannt ist.
  schattenText() {
    const s = this.lichter[0].licht.shadow;
    return `Schatten ${s.mapSize.x}   ${(s.camera.right - s.camera.left).toFixed(1)} mm`;
  }

  leeren() {
    for (const n of this.netze) {
      if (!n) continue;
      this.gruppe.remove(n.mesh, n.draht);
      n.mesh.geometry.dispose();
      for (const m of n.farben) m.dispose();
      n.draht.material.dispose();
    }
    this.netze = [];
  }

  // lage/normalen/indizes aus dem Arbeiter, gleiche Ecken zusammengelegt.
  // bereiche: Abschnitte je Filament (Anfang und Laenge im Index) oder null.
  setzeNetz(nummer, { lage, normalen, indizes }, bereiche, teil) {
    const geo = new DREI.BufferGeometry();
    geo.setAttribute('position', new DREI.BufferAttribute(lage, 3));
    geo.setAttribute('normal', new DREI.BufferAttribute(normalen, 3));
    geo.setIndex(new DREI.BufferAttribute(indizes, 1));
    const farben = [];
    if (bereiche) {
      bereiche.forEach((stueck, i) => {
        geo.addGroup(stueck.ab, stueck.anzahl, i);
        const m = new DREI.MeshStandardMaterial({
          color: new DREI.Color(stueck.hex), roughness: this.rauheit ?? RAUHEIT, metalness: 0, side: DREI.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        });
        m.userData = { filament: stueck.filament, hex: stueck.hex };
        farben.push(m);
      });
    }
    const mesh = new DREI.Mesh(geo, this.einfach);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const draht = new DREI.Mesh(geo, drahtMaterial());
    draht.visible = false;
    this.gruppe.add(mesh, draht);
    this.netze[nummer] = { mesh, draht, farben, teil };
  }

  // Groesse des Modells: fuer Boden, Schattenkamera und Lichtabstand.
  einpassen(mitte, groesse, radius) {
    this.radius = radius;
    this.boden.position.set(mitte[0], mitte[1], mitte[2] - groesse[2] / 2);
    this.boden.scale.set(radius * 10, radius * 10, 1);
    const halb = new DREI.Vector3(...groesse).multiplyScalar(0.5);
    this.kiste = new DREI.Box3(new DREI.Vector3(...mitte).sub(halb), new DREI.Vector3(...mitte).add(halb));
    // Kleiner fester Tiefenversatz - den Rest erledigt normalBias, der sich
    // in schattenZuschneiden() nach der Groesse der Kartenpunkte richtet.
    // Ein grosser fester Versatz liesse Schatten von ihren Kanten abheben.
    this.lichter[0].licht.shadow.bias = -0.0001;
  }

  // Die Schattenkarte des Hauptlichts auf den sichtbaren Teil spannen (siehe
  // oben bei VORLAUF). k: die Kamera, schon ausgerichtet.
  schattenZuschneiden(k, breite, hoehe) {
    const licht = this.lichter[0].licht;
    const schatten = licht.shadow;
    const sk = schatten.camera;
    const r = this.radius;
    if (!this.kiste || !r) return;

    // Dieselbe Lage, die three.js beim Zeichnen selbst einstellt.
    sk.position.copy(licht.position);
    sk.lookAt(licht.target.position);
    sk.updateMatrixWorld();
    const insLicht = sk.matrixWorldInverse;

    // Tiefe: das ganze Modell - alles, was Schatten werfen kann.
    let zMin = Infinity, zMax = -Infinity;
    const p = new DREI.Vector3();
    const tiefeDazu = () => { zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); };
    for (let i = 0; i < 8; i++) {
      const { min, max } = this.kiste;
      p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(insLicht);
      tiefeDazu();
    }

    // Quer zum Licht: was im Vorlaufbild zu sehen ist. Nie groesser als
    // frueher fest eingestellt - 1,5 Radien um den Blickpunkt.
    const g = r * 1.5;
    let [x0, x1, y0, y1] = [-g, g, -g, g];
    // Der Boden zaehlt nur, wo der Schatten des Modells hinfallen kann -
    // sonst spannte jeder Blick auf den Boden die Karte wieder ganz auf.
    const zBoden = this.kiste.min.z;
    const fussabdruck = this.kiste.clone();
    const richtung = new DREI.Vector3().subVectors(licht.target.position, licht.position).normalize();
    if (richtung.z < -0.05) {
      for (let i = 0; i < 8; i++) {
        const { min, max } = this.kiste;
        p.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
        fussabdruck.expandByPoint(p.addScaledVector(richtung, (zBoden - p.z) / richtung.z));
      }
    }
    fussabdruck.expandByScalar(r * 0.01);

    const lagen = this.sichtbareLagen(breite, hoehe);
    if (lagen) {
      let [a, b, c, d] = [Infinity, -Infinity, Infinity, -Infinity];
      let zelle = 0;
      const jeProbe = Math.tan(k.fov * Math.PI / 360) * 2 / lagen.hoch;
      for (let i = 0; i < lagen.werte.length; i += 4) {
        if (lagen.werte[i + 3] === 0) continue;   // Hintergrund
        p.set(lagen.werte[i], lagen.werte[i + 1], lagen.werte[i + 2]);
        if (!fussabdruck.containsPoint(p)) continue;
        // Groesse eines Vorlaufpunkts an dieser Stelle - so weit kann
        // Sichtbares zwischen zwei Proben liegen.
        zelle = Math.max(zelle, p.distanceTo(k.position) * jeProbe);
        p.applyMatrix4(insLicht);
        a = Math.min(a, p.x); b = Math.max(b, p.x);
        c = Math.min(c, p.y); d = Math.max(d, p.y);
        tiefeDazu();
      }
      if (a <= b) {
        // Rand: eine Probe plus etwas fuer die weiche Schattenkante, die
        // Nachbarpunkte der Karte abtastet.
        const rand = zelle * 1.5 + Math.max(b - a, d - c) * 0.02;
        x0 = Math.max(-g, a - rand); x1 = Math.min(g, b + rand);
        y0 = Math.max(-g, c - rand); y1 = Math.min(g, d + rand);
        if (x1 <= x0 || y1 <= y0) [x0, x1, y0, y1] = [-g, g, -g, g];
      }
    }
    const tiefe = (zMax - zMin) * 0.01 + r * 0.01;
    sk.left = x0; sk.right = x1; sk.bottom = y0; sk.top = y1;
    sk.near = -zMax - tiefe;
    sk.far = -zMin + tiefe;
    sk.updateProjectionMatrix();

    // Gegen Schattenakne (wellige Streifen auf schraeg beleuchteten
    // Flaechen): die Schattenprobe um anderthalb Kartenpunkte entlang der
    // Flaechennormalen versetzen.
    schatten.normalBias = Math.max(x1 - x0, y1 - y0) / schatten.mapSize.x * 1.5;
  }

  // Vorlauf: die Szene klein zeichnen, mit der Weltlage statt der Farbe.
  // Gibt { werte: Float32Array (x, y, z, sichtbar je Punkt), hoch } zurueck,
  // oder null, wenn die Grafikkarte nicht in Kommazahlen zeichnen kann - dann
  // bleibt die Karte ueber dem ganzen Modell wie frueher.
  sichtbareLagen(breite, hoehe) {
    const r = this.renderer;
    if (this.ohneVorlauf || !r.extensions.has('EXT_color_buffer_float')) {
      this.ohneVorlauf = true;
      return null;
    }
    const w = VORLAUF;
    const h = Math.max(1, Math.round(VORLAUF * hoehe / breite));
    if (!this.vorlauf) {
      this.vorlauf = new DREI.WebGLRenderTarget(w, h, { type: DREI.FloatType, depthBuffer: true });
    } else if (this.vorlauf.width !== w || this.vorlauf.height !== h) {
      this.vorlauf.setSize(w, h);
    }
    const szene = this.szene;
    const vorher = { hintergrund: szene.background, farbe: r.getClearColor(new DREI.Color()), alpha: r.getClearAlpha() };
    szene.background = null;
    szene.overrideMaterial = WELTLAGE;
    // Der Boden hat nur eine Oberseite - von unten ist er im echten Bild
    // unsichtbar. Das Vorlaufmaterial ist beidseitig; ohne das hier
    // verdeckte der Boden beim Blick von unten das ganze Modell, und der
    // Zuschnitt landete auf dem Boden statt auf dem Modell.
    const bodenSichtbar = this.boden.visible;
    if (this.kamera.position.z < this.boden.position.z) this.boden.visible = false;
    r.setClearColor(0x000000, 0);
    // Der Vorlauf braucht keine Schatten - sonst rechnete three.js die
    // Karte hier ein zweites Mal.
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.vorlauf);
    r.clear();
    r.render(szene, this.kamera);
    const werte = new Float32Array(w * h * 4);
    r.readRenderTargetPixels(this.vorlauf, 0, 0, w, h, werte);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = true;
    r.setClearColor(vorher.farbe, vorher.alpha);
    szene.overrideMaterial = null;
    this.boden.visible = bodenSichtbar;
    szene.background = vorher.hintergrund;
    return { werte, hoch: h };
  }

  // licht: Werte der Regler unter "Darstellung" (siehe Betrachter):
  // { belichtung, umgebung, haupt, fuell, kante, rauheit, schatten }
  zeichne({ breite, hoehe, auge, ziel, oben, nah, fern, hintergrund, farbe, blass,
            hervor, ausgeblendet, dateiFarben, hervorFilament = null, hervorArt = 'grau', puls = 0,
            hervorTeil = null, gitter = 'aus', gitterKantePx = [],
            licht: werte }) {
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(breite, hoehe, false);
    if (werte) this.stelleLicht(werte);

    const k = this.kamera;
    k.aspect = breite / hoehe;
    k.near = nah;
    k.far = fern;
    k.updateProjectionMatrix();
    k.position.set(...auge);
    k.up.set(...oben);
    k.lookAt(...ziel);
    k.updateMatrixWorld();

    // Lichter mit der Kamera drehen: Richtung aus Kamerakoordinaten in die
    // Welt, Abstand nach Modellgroesse.
    const x = new DREI.Vector3().setFromMatrixColumn(k.matrixWorld, 0);
    const y = new DREI.Vector3().setFromMatrixColumn(k.matrixWorld, 1);
    const z = new DREI.Vector3().setFromMatrixColumn(k.matrixWorld, 2);
    const mitte = new DREI.Vector3(...ziel);
    for (const { licht, richtung } of this.lichter) {
      licht.position.copy(mitte)
        .addScaledVector(x, richtung[0] * this.radius)
        .addScaledVector(y, richtung[1] * this.radius)
        .addScaledVector(z, richtung[2] * this.radius);
      licht.target.position.copy(mitte);
    }
    this.schattenZuschneiden(k, breite, hoehe);

    this.szene.background = new DREI.Color().setRGB(...hintergrund, DREI.SRGBColorSpace);
    this.einfach.color.setRGB(...farbe, DREI.SRGBColorSpace);
    this.blass.color.setRGB(...blass, DREI.SRGBColorSpace);
    // Drahtgitter darueber dunkel und halb durchsichtig, allein hell in der
    // Modellfarbe. Die Deckkraft sinkt mit der Dichte (siehe drahtMaterial).
    this.netze.forEach((n, i) => {
      if (!n) return;
      const m = n.draht.material;
      if (gitter === 'nur') {
        m.color.setRGB(...farbe.map((w) => w + (1 - w) * 0.45), DREI.SRGBColorSpace);
        m.opacity = 0.9;
      } else {
        m.color.setRGB(0, 0, 0);
        m.opacity = 0.35;
      }
      m.userData.kantePx.value = gitterKantePx[i] || 0;
    });
    for (const n of this.netze) {
      if (!n) continue;
      // Ein Filament hervorgehoben (Feld "Filamente"): die anderen je nach Art
      // grau, durchscheinend oder dunkel - oder das gewaehlte pulsiert.
      for (const m of n.farben) {
        m.color.set(m.userData.hex);
        const andere = hervorFilament !== null && (m.userData.filament !== hervorFilament
          || (hervorTeil !== null && n.teil !== hervorTeil));
        const glas = andere && hervorArt === 'glas';
        if (andere && hervorArt === 'dunkel') m.color.multiplyScalar(0.2);
        if (andere && hervorArt === 'grau') m.color.set('#d2d2d2');
        // Pulsieren: helle Farben zum Dunklen hin, dunkle zum Hellen - sonst
        // saehe man es bei Weiss oder Hellgelb gar nicht.
        if (!andere && hervorFilament !== null && puls) {
          const z = parseInt(m.userData.hex.slice(1, 7), 16);
          const hell = (0.2126 * (z >> 16 & 255) + 0.7152 * (z >> 8 & 255) + 0.0722 * (z & 255)) / 255 > 0.5;
          m.color.lerp(hell ? SCHWARZ : WEISS, puls * 0.65);
        }
        if (m.transparent !== glas) {
          m.transparent = glas;
          m.depthWrite = !glas;
          m.needsUpdate = true;
        }
        m.opacity = glas ? 0.12 : 1;
      }
      const da = !ausgeblendet.has(n.teil);
      n.mesh.visible = da && gitter !== 'nur';
      n.draht.visible = da && gitter !== 'aus';
      const betont = hervor === null || n.teil === hervor;
      n.mesh.material = betont && dateiFarben && n.farben.length ? n.farben
        : betont ? this.einfach : this.blass;
    }
    r.render(this.szene, k);
  }
}

globalThis.DreiBuehne = DreiBuehne;

})();
