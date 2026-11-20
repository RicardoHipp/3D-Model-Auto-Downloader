// Ansicht "Rendern" mit three.js (vendor/three.min.js, MIT-Lizenz).
//
// Umgesetzt nach Anleitung-Leora-Optik.md:
//   1. Weiche Normalen mit scharfen Kanten (toCreasedNormals, 35 Grad) -
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

// Lichter wie in der Anleitung, fuer ein Modell der Groesse 1 um den
// Ursprung: x nach rechts, y nach oben, z zum Betrachter. Hier in
// Kamerakoordinaten und mit dem Modellradius skaliert.
const LICHTER = [
  { lage: [1.5, 2.5, 2.0], staerke: 2.2, schatten: true },   // Haupt
  { lage: [-2, 1, 1], staerke: 0.5 },                        // Fuell
  { lage: [0, 2, -3], staerke: 1.0 }                         // Kante
];
const SICHT = 35;          // Grad, wie ein Fotoobjektiv
const RAUHEIT = 0.55;

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
        licht.shadow.mapSize.set(2048, 2048);
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
    this.einfach = new DREI.MeshStandardMaterial({ roughness: RAUHEIT, metalness: 0, side: DREI.DoubleSide });
    this.blass = this.einfach.clone();
  }

  zeigen(an) {
    this.sichtbar = an;
    this.leinwand.hidden = !an || this.unter.hidden;
  }

  leeren() {
    for (const n of this.netze) {
      if (!n) continue;
      this.gruppe.remove(n.mesh);
      n.mesh.geometry.dispose();
      for (const m of n.farben) m.dispose();
    }
    this.netze = [];
  }

  // lage/normalen: nicht indiziert, aus dem Arbeiter. bereiche: Abschnitte
  // je Filament (Anfang und Laenge in Ecken) oder null.
  setzeNetz(nummer, { lage, normalen }, bereiche, teil) {
    const geo = new DREI.BufferGeometry();
    geo.setAttribute('position', new DREI.BufferAttribute(lage, 3));
    geo.setAttribute('normal', new DREI.BufferAttribute(normalen, 3));
    const farben = [];
    if (bereiche) {
      bereiche.forEach((stueck, i) => {
        geo.addGroup(stueck.ab, stueck.anzahl, i);
        farben.push(new DREI.MeshStandardMaterial({
          color: new DREI.Color(stueck.hex), roughness: RAUHEIT, metalness: 0, side: DREI.DoubleSide
        }));
      });
    }
    const mesh = new DREI.Mesh(geo, this.einfach);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.gruppe.add(mesh);
    this.netze[nummer] = { mesh, farben, teil };
  }

  // Groesse des Modells: fuer Boden, Schattenkamera und Lichtabstand.
  einpassen(mitte, groesse, radius) {
    this.radius = radius;
    this.boden.position.set(mitte[0], mitte[1], mitte[2] - groesse[2] / 2);
    this.boden.scale.set(radius * 10, radius * 10, 1);
    const kamera = this.lichter[0].licht.shadow.camera;
    kamera.left = kamera.bottom = -radius * 1.5;
    kamera.right = kamera.top = radius * 1.5;
    kamera.near = radius * 0.1;
    kamera.far = radius * 10;
    kamera.updateProjectionMatrix();
  }

  zeichne({ breite, hoehe, auge, ziel, oben, nah, fern, hintergrund, farbe, blass,
            hervor, ausgeblendet, dateiFarben }) {
    const r = this.renderer;
    r.setPixelRatio(1);
    r.setSize(breite, hoehe, false);

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

    this.szene.background = new DREI.Color().setRGB(...hintergrund, DREI.SRGBColorSpace);
    this.einfach.color.setRGB(...farbe, DREI.SRGBColorSpace);
    this.blass.color.setRGB(...blass, DREI.SRGBColorSpace);
    for (const n of this.netze) {
      if (!n) continue;
      n.mesh.visible = !ausgeblendet.has(n.teil);
      const betont = hervor === null || n.teil === hervor;
      n.mesh.material = betont && dateiFarben && n.farben.length ? n.farben
        : betont ? this.einfach : this.blass;
    }
    r.render(this.szene, k);
  }
}

globalThis.DreiBuehne = DreiBuehne;

})();
