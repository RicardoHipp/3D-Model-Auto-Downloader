# Changelog

Alle nennenswerten Änderungen an dieser Erweiterung.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Geändert

- **Papierkorb deutlich schneller.** Beim Verschieben und Wiederherstellen
  ganzer Modelle werden bis zu 12 Dateien gleichzeitig umgehängt – gemessen
  rund achtmal so schnell wie nacheinander. Scheitert das Umhängen einer
  Datei, wird nur diese kopiert, nicht mehr der ganze Rest.
- Der Knopf zeigt beim Verschieben, wie weit es ist („Wird verschoben …
  12 / 37“), bei mehreren Modellen auch, das wievielte gerade dran ist.
- **Entpacken schneller.** Zielordner und Berechtigung werden einmal je
  Download geholt statt für jede Datei, angelegte Unterordner gemerkt, und
  mehrere Dateien gleichzeitig geschrieben – viele kleine Dateien bis zu 12
  auf einmal, große nach Speicherbedarf (zusammen höchstens 512 MB) nur zu
  zweit oder einzeln.

### Behoben

- Beim Verschieben ganzer Modelle wurden Dateien aus einem Ordner genommen,
  während er noch durchlaufen wurde. Dabei konnten Dateien übersprungen
  werden und mit dem alten Ordner verloren gehen. Jetzt wird erst
  vollständig aufgelistet, dann verschoben.

## [1.4.0] – 2026-11-23

### Hinzugefügt

- **Drahtgitter.** Ganz oben unter „Darstellung“: „über dem Modell“ legt
  die Kanten der Dreiecke über das Modell, „nur Gitter“ zeigt nur sie – in
  der flachen und der gerenderten Ansicht. Bei fein aufgelösten Modellen
  werden die Linien herausgezoomt durchsichtiger, sodass ein gleichmäßiger
  Schleier bleibt statt eines zugelaufenen Bilds; ein Hinweis sagt dann,
  dass man zum Erkennen heranzoomen muss.
- **Neues Feld „Bewegung“** rechts oben, mit eigenem „Zurücksetzen“:
  - **Nachlauf beim Drehen und Zoomen** (ab Werk 60 ms): Bewegungen mit
    Maus und Rad laufen weich aus – ruhiger, ungleichmäßig ankommende
    Mausbewegungen ruckeln nicht mehr.
  - **Selbst drehen** in einstellbarer Geschwindigkeit.
  - **Bildrate begrenzen** auf einen frei wählbaren Wert.
  - **Bildrate anzeigen:** Bilder je Sekunde, Zeit je Bild, längste Pause,
    Blickwinkel, Zoom und Verschiebung – bei „Rendern“ auch die
    Schattenkarte.
- **Schattenauflösung** einstellbar unter „Darstellung“ (512 bis 16384,
  ab Werk 4096).

### Geändert

- **Schärfere Schatten beim Heranzoomen.** Die Schattenkarte wird nur über
  den Teil des Modells gespannt, der gerade zu sehen ist, und ist doppelt
  so fein wie bisher. Die welligen Streifen auf schräg beleuchteten Flächen
  sind weg.
- Rechts oben ist immer nur ein Feld aufgeklappt. Reicht es über die
  Ansicht hinaus, rollt nur das Feld, nicht die ganze Seite.
- Der Knopf „Rendern“ leuchtet grün, wenn er an ist.
- In „Meine Modelle“ steht rechts oben die Versionsnummer.
- Knickwinkel ab Werk 20° statt 15°, Gamma der flachen Ansicht ab Werk
  1,4 statt 1,5.
- **Mit jeder neuen Version startet die Ansicht mit den
  Werkseinstellungen** und „Rendern“ an – so sieht jeder die Neuerungen
  erst einmal wie gedacht. Was man danach verstellt, bleibt bis zur
  nächsten Version.
- Einrichtung „Im Explorer öffnen“: Ein Hinweis oben zeigt, dass man nach
  einer Neuinstallation mit gleichem Zielordner nichts neu herunterladen
  muss, sondern nur den Pfad einträgt.

### Behoben

- Beim Blick von unten auf ein Modell konnten Schatten je nach Winkel
  verschwinden und wieder auftauchen.
- „Zurücksetzen“ unter „Darstellung“ erfasst jetzt alle Regler.
- **Unbrauchbarer Zielordner hängte die Erweiterung auf.** War ein früher
  gewählter Ordner nicht mehr erreichbar, wartete jeder Zugriff darauf
  endlos: Downloads landeten still im normalen Download-Ordner, die
  Einstellungsseite blieb bei „…“ stehen. Jetzt gilt das nach kurzer Zeit
  als „kein Ordner gewählt“ – der Download stoppt mit Hinweis, und die
  Einstellungsseite bietet „Ordner wählen“ an.

## [1.3.0] – 2026-11-22

### Hinzugefügt

- **Filamente ansehen und umfärben.** Ein neues Feld „Filamente“ rechts
  unter „Darstellung“ zeigt die Filamente, die ein Modell wirklich benutzt,
  mit ihrem Anteil. Ein Klick aufs Farbfeld färbt sie um – sofort in der
  Ansicht, und beim Speichern als 3MF kommen die neuen Farben in die Datei.
  Die Originaldatei bleibt unverändert, gemerkt wird nichts.
- **Einzelne Teile umfärben.** In der Teileansicht gilt das Feld
  „Filamente“ nur für das gewählte Teil – etwa wenn alle Teile dasselbe
  Weiß nutzen, aber eines schwarz werden soll. Beim Export wird daraus ein
  eigenes Filament; auch fein bemalte Teile werden dabei richtig umgefärbt.
  Der Knopf heißt jetzt „Einzelteile exportieren oder färben“.
- **Hervorheben beim Darüberfahren:** Fährt man über ein Filament, hebt es
  sich im Modell ab – wählbar als Pulsieren (Standard), Grau, Glas, Dunkel
  oder gar nicht.
- **Umgefärbte 3MF als Ganzes speichern:** Sind Farben geändert, erscheint
  oben zusätzlich „Als 3MF speichern“ – auch in der Teileansicht.
- **Einzelne Dateien löschen.** Ein kleines × an jeder Datei der Liste
  verschiebt sie in den Papierkorb. Mit Strg/Shift lassen sich mehrere
  markieren und mit Entf gemeinsam löschen. In der Übersicht stehen
  gelöschte Dateien im Papierkorb unter „Gelöschte Dateien“ – jede mit
  ihrem Bild, einzeln wiederherstellbar (zurück in ihr Modell) oder
  endgültig zu löschen.
- **Eigene Regler für die gerenderte Ansicht:** Belichtung,
  Umgebungslicht, Haupt-, Füll- und Kantenlicht, Rauheit, Bodenschatten
  und Knickwinkel. Unter „Darstellung“ stehen je nach Ansicht nur die
  Regler, die dort etwas bewirken.
- **Dateien aus der Liste ziehen** – auf den Desktop oder in einen
  Explorer-Ordner.
- **Vorschaubilder werden zwischengespeichert** (bis 500 MB, im
  Chrome-Profil). Bekannte Bilder erscheinen beim Öffnen eines Ordners
  sofort, neue entstehen danach der Reihe nach.
- **Kurze Umfrage beim Entfernen:** Wer die Erweiterung entfernt, sieht ein
  freiwilliges, anonymes Formular mit der Frage nach dem Grund. Siehe
  Datenschutzerklärung.

### Geändert

- **„Rendern“ ist ab Werk an** und wird gemerkt. Die Aufbereitung ist
  rund zehnmal schneller (eigene Berechnung der weichen Normalen, Bit für
  Bit gleich wie bei three.js), große Modelle brauchen gut eine Sekunde
  statt rund fünfzehn. Weniger Grafikspeicher durch gemeinsame Ecken.
  Knickwinkel jetzt 15° – keine hellen Flecken mehr auf ebenen Flächen von
  CAD-Exporten. Ein drehender Kreis im Knopf zeigt, dass noch gerechnet
  wird.
- **3MF und STL werden im Hintergrund gelesen** – die Seite bleibt auch bei
  sehr großen Dateien bedienbar. Während eine Datei lädt, steht ein Hinweis
  statt des vorigen Modells da.
- **3MF-Export für Bambu Studio und OrcaSlicer:** Die Datei enthält jetzt
  Projekteinstellungen mit allen Filamenten und Farben – stammt das Modell
  aus einem Bambu-/Orca-Projekt, bleiben dessen Drucker, Druckprofil und
  Filamenttypen erhalten. Jedes Dreieck trägt seine Filamentnummer als
  Bemalung. Bisher legte Orca fehlende Filamente in eigenen Farben an.
- **Einfarbige 3MF** zeigen ihre hinterlegte Filamentfarbe.
- Flache und gerenderte Ansicht nutzen dieselbe Perspektive (35°).
- Obere Leiste: bei 3MF „Als STL speichern“, bei STL „Als 3MF speichern“;
  in der Teileansicht wird dort nicht doppelt gespeichert. Ein Klick ins
  Modell öffnet die Teileansicht nicht mehr – nur der Knopf.
- Standardfarbe der Ansicht ist ein gedecktes Blau (#41618B).
- Im Papierkorb führt „Papierkorb“ in der Kopfzeile zurück zur Übersicht.
- Einrichtung „Im Explorer öffnen“: roter Hinweis, die Schritte genau zu
  lesen, und eine Anleitung für Windows-Rechner, die die Dateien
  blockieren („Zulassen“ in den Eigenschaften).

### Behoben

- Der 3MF/STL-Umschalter oben ließ sich nicht anklicken.
- Lange Dateinamen machten Rückfragen breiter als das Fenster.
- Der Ladekreis am Knopf „Rendern“ verschob die Knöpfe daneben.
- Wechselte man während der Aufbereitung Datei oder Winkel, konnte eine
  veraltete Antwort im falschen Lauf landen.

## [1.2.0] – 2026-11-20

### Hinzugefügt

- **Als 3MF speichern – mit Farben.** Einzelteile und das ganze Modell
  lassen sich jetzt wahlweise als 3MF oder STL speichern (Umschalter
  „3MF | STL“ im Teile-Fach und oben neben dem Speichern-Knopf; die Wahl
  bleibt gespeichert). 3MF behält die Farben: als Farbpalette nach
  3MF-Norm, als Bemalung für Bambu Studio/OrcaSlicer (paint_color) und
  PrusaSlicer (mmu_segmentation) sowie mit dem Filament je Teil. Fein
  bemalte Dreiecke gehen unverändert hinaus, das Netz bekommt keine
  zusätzlichen Ecken. Bei STL weist ein Hinweis darauf hin, dass keine
  Farben enthalten sind. Die Farbtöne der Filamente selbst stellt man im
  Slicer ein.
- **„Rendern“ in der 3D-Ansicht.** Ein Knopf schaltet zwischen der flachen
  Ansicht (jede Facette sichtbar) und einer weich schattierten Darstellung
  mit Studiolicht um – mit three.js: weiche Normalen mit scharfen Kanten
  ab 35°, Umgebungslicht, drei Lichter, die mit der Kamera mitdrehen,
  mattes Kunststoffmaterial, ACES-Tonemapping und Bodenschatten. Das
  Aufbereiten läuft im Hintergrund; jede neu geöffnete Datei startet flach.
  Vorschaubilder bleiben flach.
- **Farben aus 3MF-Dateien anderer Programme.** Neben Bambu Studio/Orca
  werden jetzt auch die Farben nach 3MF-Norm (basematerials, colorgroup)
  und die Filamentfarben von PrusaSlicer gelesen.
- **Tag-Filter mit einem Klick aufheben:** Knopf „Alle anzeigen“ in der
  Tag-Leiste, sobald nach Tags gefiltert wird.
- **GIF als Vorschaubild,** auch bei Cults3D (dort zeigt die Seite statt
  eines Bildes ein Video).

### Geändert

- **Modell endlos drehen,** auch hoch und runter über die Pole hinweg,
  ohne dass das Bild umklappt.
- „Teil als STL“ heißt jetzt „Teil speichern“.
- three.js (MIT) liegt lokal in der Erweiterung; Lizenz in
  LIZENZEN-DRITTER.txt.

### Behoben

- **Große 3MF-Dateien** (Hauptmodell über rund 512 MB Text) ließen sich
  nicht öffnen – das Hauptmodell wird jetzt als Strom gelesen.
- **Cults3D:** Downloads über den neuen Host downloader.cults3d.com wurden
  nicht mehr abgefangen; „Download all“ wird als ZIP erkannt, auch wenn
  Name, Adresse und MIME-Typ es nicht verraten; Dateiname und Endung
  kommen aus der signierten Adresse.
- Nach einem großen Bild blieb dieses sichtbar, wenn danach ein Modell
  gezeigt wurde.
- Übersicht: Ordner ohne erkennbare Quelle ließen die Liste mit einem
  Fehler abbrechen.

## [1.1.1] – 2026-11-15

### Hinzugefügt

- **„Als STL speichern" für STEP und 3MF.** Auf der Modellseite steht über
  der 3D-Ansicht ein Knopf, der das ganze Modell als eine STL-Datei neben
  das Original schreibt – mittig und auf Z=0 gestellt, bei STEP in der
  eingestellten Feinheit. Damit lassen sich auch STEP-Dateien aus einem
  einzigen Körper umwandeln, nicht nur Baugruppen. Vorhandene Dateien
  werden nie überschrieben; gibt es den Namen schon, hängt eine Nummer an.

### Geändert

- **Knöpfe überall als Pillen,** wie in der Werkzeugleiste der Übersicht –
  auf der Modellseite, in Fenstern, Einstellungen und Willkommensseite.
- **Kurzbeschreibung im Store** nennt jetzt Tags, die 3D-Vorschau und das
  Umwandeln von STEP in STL.

### Behoben

- Der ausgewählte Eintrag „Beschreibung" in der Dateiliste hatte unten
  keinen blauen Rand.
- Beim Öffnen eines Modells blitzte rechts kurz ein Rollbalken auf.

## [1.1.0] – 2026-11-15

### Geändert

- **Neuer Name: „3D Model Downloader & Organizer".** Die Erweiterung lädt
  längst nicht mehr nur herunter, sie ordnet und verwaltet auch. Der Name
  ändert sich überall, wo er erscheint: in Chrome, im Store, auf allen
  Seiten, in der Datenschutzerklärung und in der Einrichtung für
  „Im Explorer öffnen". Wer die schon eingerichtet hat, muss nichts neu
  machen.

- **Neues Aussehen, angelehnt an Apple.** Systemschrift (Segoe UI Variable
  unter Windows 11), eine Akzentfarbe (Blau) statt vieler, hauchdünne
  Kanten, runde Ecken, durchscheinender Kopf mit Milchglas-Effekt,
  plastischere Knöpfe, ruhige Rückmeldungen beim Darüberfahren und weiche,
  leicht federnde Bewegungen. In der Werkzeugleiste der Übersicht sind
  Suche, Plattform, Sortierung und Papierkorb gleich hohe Pillen; die
  Sortierung ist jetzt ein Segment-Schalter. Wer in Windows Animationen
  abgeschaltet hat, bekommt keine Bewegungen.

- **Startseite links oben.** Jede Seite hat links oben „⌂ 3D Model
  Downloader & Organizer › Seite"; ein Klick führt zur Übersicht. Die
  Zurück-Knöpfe, die auf jeder Seite woanders saßen, sind weg.

- **Kacheln der Übersicht.** Plattform und Datum stehen als Pillen oben auf
  dem Vorschaubild, das Tag-Symbol rechts unten; darunter ist Platz für
  Titel und Tags. Die Kacheln zoomen beim Öffnen kurz auf.

- **Teile-Erkennung bei STL im Hintergrund.** „In Einzelteile zerlegen"
  erscheint nur noch, wenn eine STL wirklich aus mehreren Körpern besteht;
  gesucht wird gleich nach dem Öffnen in einem eigenen Faden, ohne die Seite
  aufzuhalten.

- **Bei erneutem Herunterladen wird eine vorhandene `info.txt` um die
  Beschreibung ergänzt,** wenn darin noch keine steht. Eigene Notizen bleiben
  unangetastet.

### Hinzugefügt

- **Eigene Tags.** Modelle lassen sich mit eigenen Stichwörtern versehen –
  in der Übersicht per Rechtsklick oder über das # auf der Kachel, auf der
  Modellseite in der Zeile „Tags", oder indem man einen Tag aus der
  Tag-Leiste auf ein Modell zieht. Mit Strg+Klick markierte Modelle
  bekommen einen Tag gemeinsam. Die Tag-Leiste filtert (mehrere Tags: das
  Modell muss alle haben), die Suche findet Tags ebenfalls. Groß- und
  Kleinschreibung zählen nicht. Gespeichert werden die Tags als Zeile
  „Tags:" in der `info.txt` des Modells – sie wandern mit dem Ordner und
  lassen sich auch mit dem Editor ändern. Eine Anleitung steckt hinter dem
  „?" in der Tag-Leiste.

- **Schnellere Übersicht.** Die Übersicht merkt sich Titel, Tags und ein
  verkleinertes Vorschaubild je Modell und zeigt sie sofort; der Abgleich
  mit den Ordnern läuft danach im Hintergrund (rechts oben „Wird
  aktualisiert …"). Neue, gelöschte und von Hand geänderte Modelle werden
  dabei erkannt.

- **Mehrere Modelle auf einmal** mit Strg+Klick markieren und in den
  Papierkorb verschieben – oder im Papierkorb markieren und wiederherstellen.

- **STEP-Dateien ansehen.** Die Modellseite zeigt STEP/STP-Dateien in 3D,
  mit wählbarer Feinheit und Fortschrittsanzeige. Dafür liegt OpenCascade
  (occt-import-js, LGPL-2.1) bei, selbst gebaut und mit einer Reparatur für
  fehlerhafte Kreiskanten; beschädigte Dateien werden mit einem Hinweis
  angezeigt. Quelltext und Änderungen stehen unter
  `vendor/occt-import-js-quelle`.

- **PDF-Ansicht** auf der Modellseite.

- **Beschreibung des Modells** von der Website in der `info.txt` und in einem
  eigenen Bereich „Beschreibung" auf der Modellseite, mit Vorschaubild.

- **Dateiliste als Ordnerbaum** auf der Modellseite; „Im Explorer öffnen"
  öffnet den Ordner der gerade gezeigten Datei.

- **Teile ein- und ausblenden** in der Teileansicht, einzeln oder alle auf
  einmal. Die Knöpfe bleiben auch bei langen Listen sichtbar.

- **Fortschrittsanzeige auch auf Cults3D.**

- **Lizenzhinweise** für Emscripten, Node.js und musl sowie die Ausnahme von
  Open CASCADE zur LGPL in `LIZENZEN-DRITTER.txt`.

## [1.0.9] – 2026-11-14

### Hinzugefügt

- **Cults3D als vierte Plattform.** Gratis-Modelle laufen bei Cults über eine
  Bestellung: Erst legt „Herunterladen – Gratis" sie an, dann lädt
  „Herunterladen aller" die Dateien als ZIP. Den ersten Schritt macht weiter
  der Nutzer selbst – er ist eine Handlung im eigenen Konto, und bei
  kostenpflichtigen Modellen führt derselbe Knopf in den Bezahlvorgang. Die
  Erweiterung greift erst beim zweiten Klick ein: ZIP entpacken, Vorschaubild
  und `info.txt` dazulegen, alles im eigenen Ordner mit der Plattform
  „Cults".

  Der Titel kommt von der Bestellseite, die `info.txt` zeigt auf die
  Modellseite. Abgerufen wird die signierte Adresse auf
  `download.cults3d.com`, auf die Cults weiterleitet – der Link davor
  antwortet ohne Sitzung des Browsers mit 403.

### Geändert

- **„Neueste zuerst" sortiert auch nach Uhrzeit.** Bisher kannte die
  Übersicht nur das Datum aus dem Ordnernamen; Modelle desselben Tages
  standen in zufälliger Reihenfolge. Jetzt zählt innerhalb eines Tages der
  Zeitpunkt des Downloads, abgelesen an der ältesten Datei im Ordner.

- **ZIP-Archive ohne überflüssige Ordnerebenen.** Liegen alle Dateien eines
  Archivs im selben Unterordner, fällt der beim Entpacken weg. Cults packt
  etwa „Ersteller/Modell/datei.stl" – im Modellordner stand sonst derselbe
  Name noch einmal zwei Ebenen tief.

## [1.0.8] – 2026-11-14

### Hinzugefügt

- **Einzelteile exportieren.** Auf der Modellseite sitzt oben links in der
  Ansicht der Schalter „Einzelteile aus Datei exportieren". Ist er an, steht
  links statt der Dateiliste die Liste der Teile mit Nummer, Name und Maßen.
  Ein Klick auf ein Teil – in der Liste oder direkt im Bild – hebt es hervor;
  von dort lässt es sich einzeln oder zusammen mit allen anderen als STL in
  den Unterordner `Einzelteile` schreiben. Jedes Teil wird dabei mittig und
  mit der Unterkante auf Z=0 abgelegt.

  Bei 3MF stammen die Teile aus der Datei selbst, samt der Namen, die der
  Slicer vergeben hat. Netze, die ineinanderstecken oder aufeinanderliegen
  (etwa ein andersfarbiger Schriftzug), bleiben ein Teil. Bei STL sucht die
  Erweiterung die zusammenhängenden Körper – wie „In Objekte aufteilen" im
  Slicer. Splitter von unter einem Millimeter, wie sie bei Netzfehlern
  entstehen, werden dem nächstgelegenen Körper zugeschlagen.

- **Mehrfarbige 3MF in ihren Filamentfarben.** Die Ansicht zeigt bemalte und
  aus verschiedenfarbigen Teilen zusammengesetzte Modelle in den Farben, die
  in der Datei hinterlegt sind. Auch teilweise bemalte Dreiecke werden so
  zerlegt, wie die Datei es beschreibt, damit Farbgrenzen sauber verlaufen.
  Im Feld „Darstellung" lässt sich das mit „Farben der Datei" abschalten;
  einfarbige Modelle bleiben in der selbst gewählten Farbe.

- **Maße.** Oben links in der Ansicht stehen Breite × Tiefe × Höhe in
  Millimetern, bei ausgewähltem Teil die des Teils. Gibt ein 3MF eine andere
  Einheit an, wird umgerechnet.

- **Herkunft des Modells.** Beim Herunterladen entsteht im Modellordner eine
  `info.txt` mit Titel, Plattform, Adresse der Modellseite und Datum. Die
  Modellseite zeigt daraus einen Verweis „Auf … ansehen". Unter der
  Leerzeile der Datei ist Platz für eigene Notizen; steht dort etwas, wird
  es mit angezeigt. Eine vorhandene Datei wird nie überschrieben.

- **Pfad zum Kopieren.** Antwortet das Explorer-Skript nicht, zeigt die
  Meldung jetzt den vollständigen Pfad des Modellordners mit einem Knopf zum
  Kopieren.

### Geändert

- **Das Explorer-Skript öffnet nur noch den eigenen Zielordner (Fassung 4).**
  Ein registriertes Kürzel wie `stldl:` kann jede Website aufrufen, nicht nur
  diese Erweiterung. Das Skript merkt sich deshalb den zugeordneten
  Zielordner und vergleicht jeden Aufruf damit, bevor es den Pfad anfasst;
  alles andere – fremde Ordner, Netzwerkpfade, Pfade mit `..` – wird
  abgelehnt. Die Texte seiner Dialoge kommen nicht mehr aus der Adresse.

  **Wer die Explorer-Funktion eingerichtet hat, muss das Skript einmal neu
  herunterladen und ausführen.** Die Erweiterung erkennt die alte Fassung und
  weist darauf hin. Nach einem Wechsel des Zielordners ist die Zuordnung
  ebenfalls zu erneuern – bisher zeigte der Knopf dann stillschweigend auf
  den alten Ordner.

- **Große 3MF-Dateien öffnen sich deutlich schneller.** Das Vorschaubild
  kommt aus dem Paket, statt dafür das ganze Modell zu lesen; der Leser
  arbeitet direkt auf den entpackten Bytes; und einmal gelesene Modelle
  bleiben im Speicher. Bei einer Datei mit 534 MB XML sank die Wartezeit von
  rund neun auf gut zwei Sekunden.

- **Kopf der Modellseite zweizeilig**, die Registrierungsdatei nennt ihren
  Befehl zusätzlich im Klartext.

### Behoben

- **3MF mit mehreren Objekten in einer Teildatei wurden falsch gezeichnet.**
  Der Leser warf alle Objekte einer Teildatei zusammen; Dreiecke zeigten
  dadurch auf die Ecken des Nachbarobjekts und spannten sich quer durchs
  Modell. Außerdem fehlten Komponenten, die nicht am Anfang der Teildatei
  standen.

- **3MF im ZIP64-Format ließen sich nicht öffnen.** Betroffen waren vor allem
  Dateien von Printables – sie hatten weder Vorschaubild noch 3D-Ansicht.

- **Verschieben mit der rechten Maustaste** lief nach links und rechts
  verkehrt herum.

## [1.0.7] – 2026-10-25

### Hinzugefügt

- **„Meine Modelle" – eine Übersicht über alles Heruntergeladene.** Die Seite
  liest den Zielordner direkt aus und zeigt jedes Modell mit Name, Plattform
  und Datum. Dazu Suche nach Namen, ein Filter nach Plattform und Sortierung
  nach Datum oder Name.

- **Modellseite mit 3D-Vorschau.** Ein Klick auf ein Modell öffnet eine eigene
  Seite: links alle Dateien des Ordners mit einem Vorschaubild, rechts die
  gewählte Datei zum Drehen, Schieben und Zoomen. Gelesen werden **STL** und
  **3MF**; beim 3MF auch Bambu-Projektdateien mit mehreren Objekten.

  Gerendert wird mit WebGL im Browser, ohne fremde Bibliothek und ohne
  Serverkontakt – es verlässt also keine Datei den Rechner. Über „Darstellung"
  lassen sich Farbe, Hintergrund und Beleuchtung einstellen; die Werte bleiben
  gespeichert.

- **Papierkorb statt endgültigem Löschen.** Gelöschte Modelle wandern in den
  Ordner `_Trash_` im Zielordner, mit dem Löschdatum am Namen. Von dort lassen
  sie sich wiederherstellen. Geleert wird nur von Hand – nichts verschwindet
  nach Ablauf einer Frist von selbst.

- **„Im Explorer öffnen" für jedes Modell.** Optional und mit zwei Schritten
  eingerichtet. Hintergrund: Die Erweiterung kennt den Zielordner nur als
  Verweis, nicht als Pfad – der Browser rückt ihn nicht heraus. Deshalb
  erzeugt die Optionsseite zwei kleine Dateien, die diese Brücke über Windows schlagen:
  ein Skript, das den Ordner öffnet, und einen Registrierungseintrag, der es
  mit dem Kürzel `stldl:` verknüpft.

  Beide Dateien stehen auf der Optionsseite vollständig im Klartext, samt
  Kommentaren in der eingestellten Sprache, und lassen sich mit einer zweiten
  Datei rückstandslos wieder entfernen. Wer darauf verzichtet, verliert nur
  diesen einen Knopf – alles andere arbeitet unverändert weiter.

- **Fortschrittsband auf der Website.** Während ein Download läuft oder ein
  Archiv entpackt wird, blendet sich am unteren Rand ein schmales Band mit dem
  aktuellen Dateinamen ein. Es meldet auch, wenn etwas schiefgeht – etwa ein
  fehlender Zielordner – und verschwindet von selbst wieder.

- **Begrüßungsseite nach Installation und Update.** Sie erklärt beim ersten
  Start die nötige Einrichtung und zeigt nach einem Update, was neu ist. Ein
  bloßes Chrome-Update löst sie nicht aus.

- **Downloads auf Printables und MakerWorld werden abgefangen, bevor der
  Browser sie startet.** Beide Plattformen erzeugen einen Link mit der fertigen
  Datei-URL und klicken ihn per JavaScript an; die Erweiterung fängt diesen
  Aufruf ab. Chrome erfährt von dem Download damit gar nichts und fragt auch
  nicht nach dem Speicherort. Für Thingiverse gab es diesen Weg bereits.

  Der Ansatz hängt an einer Browser-Schnittstelle, nicht an Beschriftungen oder
  CSS-Klassen der Websites – ein Redesign der Seiten bricht ihn daher nicht.

  **Absicherung:** Meldet die Erweiterung nicht innerhalb von 1,5 Sekunden
  Vollzug, startet die Seite den ursprünglichen Download doch. So geht nichts
  verloren, etwa direkt nach einem Update der Erweiterung, wenn bereits offene
  Seiten die Verbindung zu ihr verloren haben. Beide Fälle stehen in der
  Browser-Konsole.

### Geändert
- **Es muss jetzt ein Zielordner festgelegt werden.** Bisher war der eigene
  Ordner optional und die Dateien landeten sonst unter
  „Downloads/STL_Downloads/". Dieser Standardweg ging über Chromes
  Download-Funktion – und damit über den Speicherort-Dialog, sobald jemand
  „Vor dem Download jeweils nachfragen" aktiviert hatte.

  Ist kein Ordner festgelegt, wird ein Download jetzt **gestoppt** statt
  heruntergeladen. Die Erweiterung zeigt eine Benachrichtigung und öffnet die
  Optionsseite, damit klar ist, was fehlt.

  Einmal einen Ordner wählen genügt. Danach schreibt die Erweiterung direkt
  dorthin, ohne jede Nachfrage.

  **Zum Ablauf:** Chrome fragt beim nächsten Browserstart ein zweites Mal nach.
  Erst dann bietet es „Bei jedem Besuch zulassen" an – beim ersten Mal gibt es
  diese Option noch nicht, das lässt sich nicht umgehen. Die Erweiterung weist
  an jeder betroffenen Stelle darauf hin.

- **Popup neu aufgebaut.** Statt der Download-Liste führen jetzt zwei große
  Knöpfe zu „Meine Modelle" und den Einstellungen; Status und Diagnose stehen
  darunter. Steht eine Berechtigung zur Erneuerung an, pulsiert der
  entsprechende Knopf, damit man es nicht übersieht.

- **Rückfragen im eigenen Gewand.** Wo bisher Chromes graues Systemfenster
  aufging, fragt die Erweiterung jetzt im Design der Seite nach – mit klarer
  Kennzeichnung, wenn es um etwas Endgültiges geht.

### Behoben
- **Thingiverse lud trotz fehlendem Zielordner herunter.** Die Prüfung lief an
  dieser einen Stelle nicht, die Datei landete im Downloads-Ordner und das
  Fortschrittsband lief endlos weiter. Alle drei Wege prüfen jetzt dieselbe
  Stelle, und das Band gibt nach spätestens zwei Minuten auf.

- **„Bis zum Neustart deaktivieren" wurde ignoriert.** Die Zielordner-Prüfung
  kam der Pause zuvor und fing den Download trotzdem ab.

## [1.0.6] – 2026-10-18

### Hinzugefügt

- **Eigener Zielordner.** Über die Optionsseite lässt sich ein beliebiger Ordner
  auswählen; die Erweiterung schreibt die Dateien dann direkt dorthin, statt den
  Umweg über den Downloads-Ordner zu nehmen. Ohne Auswahl bleibt alles wie
  bisher – der Standard ist unverändert `Downloads/STL_Downloads/`.

  Damit verschwindet auch die in 1.0.5 beschriebene Einschränkung: Wer einen
  eigenen Ordner gewählt hat, bekommt beim Entpacken eines ZIP-Archivs **keine
  Speicherort-Dialoge mehr**, selbst wenn in Chrome "Vor dem Download jeweils
  nachfragen" aktiviert ist. Die Erweiterung benutzt für diesen Weg Chromes
  Download-Funktion gar nicht mehr.

  Hinweise:

  - Den Downloads-Ordner **selbst** sperrt Chrome für diese Funktion. Ein
    Unterordner darin ist erlaubt und lässt sich im Auswahlfenster auch neu
    anlegen.
  - Die Berechtigung übersteht einen Browser-Neustart. Falls sie doch einmal
    verfällt, weist das Popup darauf hin und sie lässt sich mit einem Klick
    erneuern.
  - Schlägt das direkte Schreiben für eine Datei fehl, fällt die Erweiterung
    automatisch auf den bisherigen Weg zurück; der Download geht also nicht
    verloren.

## [1.0.5] – 2026-10-18

### Hinzugefügt

- **Englische Oberfläche.** Die Erweiterung liegt jetzt auf Englisch und Deutsch
  vor (`_locales/`); Chrome wählt automatisch die Sprache des Browsers.
  Englisch ist die Standardsprache – wer weder Englisch noch Deutsch eingestellt
  hat, bekommt sie zu sehen.

  Hintergrund: 53 % der wöchentlichen Nutzer sind englischsprachig, dazu kommen
  Russisch, Französisch und Portugiesisch. Deutsch lag zuletzt unter "Sonstige".
  Mit einer rein deutschen Oberfläche wurde fast jede zweite Installation wieder
  entfernt.

### Bekannte Einschränkung

- **Chrome-Einstellung "Vor dem Download jeweils nachfragen, wo gespeichert
  werden soll".** Ist sie aktiv, erscheint beim Entpacken eines ZIP-Archivs ein
  Speichern-Dialog pro enthaltener Datei. Die Dateien landen zwar im richtigen
  Ordner, der Pfad ist im Dialog bereits vorausgefüllt – aber bei zwanzig
  Dateien sind das zwanzig Bestätigungen.

  Die Erweiterung setzt bei ihren eigenen Downloads inzwischen `saveAs: false`.
  Das genügt nicht: Die Browser-Einstellung hat Vorrang, und eine Erweiterung
  kann eine ausdrückliche Nutzerentscheidung nicht übergehen. Ein anderer
  Lösungsweg wird geprüft.

  Wer viele ZIP-Archive lädt, schaltet die Einstellung solange am besten ab.

### Geändert

- **Neues Ordnerschema:** `Benchy_Thingiverse_2026-10-18` statt
  `Benchy_von_Thingiverse_18.10.2026`. Zwei Änderungen auf einmal, damit es bei
  einem einzigen Bruch bleibt:

  - Das Bindewort `_von_` entfällt, damit der Ordnername in jeder
    Oberflächensprache identisch ist.
  - Das Datum steht im ISO-Format (`JJJJ-MM-TT`). Das ist international
    eindeutig und sortiert im Dateiexplorer chronologisch – nach Namen sortieren
    heißt damit auch nach Datum sortieren.

  Hinweis für Bestandsnutzer: Lädst du ein Modell erneut herunter, das du vor
  diesem Update schon einmal geladen hattest, entsteht ein zweiter Ordner nach
  dem neuen Schema neben dem alten. Bereits gespeicherte Dateien bleiben
  unberührt.
- Name und Kurzbeschreibung im Store sind damit ebenfalls übersetzbar.

## [1.0.4] – 2026-09-13

### Behoben

- **Erweiterung wurde nach längerer Browser-Laufzeit funktionsunfähig.** Klick auf
  das Symbol blieb wirkungslos, Downloads landeten nicht mehr in sortierten
  Ordnern. Aus- und Einschalten half nicht, nur ein Browser-Neustart.

  Ursache: Chrome verlor die Service-Worker-Registrierung. Auf
  `chrome://serviceworker-internals` stand die Registrierung ohne `Active worker`
  da, neue Worker-Versionen endeten reihum als `REDUNDANT`, und der Worker
  startete nicht mehr – nicht einmal bis zur ersten Zeile Code. In diesem Zustand
  kann die Erweiterung sich nicht selbst reparieren, weil kein eigener Code läuft.

  Gegenmaßnahmen in dieser Version:

  - **Symbole werden nicht mehr zur Laufzeit gezeichnet.** Bisher erzeugte der
    Service Worker sie per `OffscreenCanvas` – einmal bei jedem Worker-Start und
    dreimal bei jedem Symbolwechsel, also bei jedem Tab-Wechsel und jedem
    Seitenladen. Diese Grafiklast im Worker ist der wahrscheinliche Auslöser.
    Stattdessen liegen jetzt fertige PNGs im Paket (`icons/`); Aussehen unverändert.
  - **Keepalive-Alarm wiederhergestellt** (in 1.0.3 entfernt). Ein Alarm alle 30
    Sekunden verhindert, dass der Worker lange genug stillliegt, um in diesen
    Zustand zu geraten. Dafür ist die Berechtigung `alarms` wieder nötig – sie
    erzeugt keine Nutzerwarnung bei der Installation.

### Geändert

- Benachrichtigungen verwenden das mitgelieferte `icon128.png` statt eines beim
  Start erzeugten Data-URLs.
- Der Alarm läuft mit 30 Sekunden statt der früheren 24 – Chrome hebt kürzere
  Intervalle bei installierten Erweiterungen ohnehin auf dieses Minimum an.

## [1.0.3] – 2026-08-01

### Geändert

- Berechtigungen reduziert: `tabs` und `alarms` entfernt, ebenso der
  Host-Zugriff auf `*.amazonaws.com`.
- Keepalive-Alarm entfernt (in 1.0.4 wieder aufgenommen, siehe oben).
- Laufender Zustand (Ordnerzuordnung, Download-Warteschlange, bereits geladene
  Vorschaubilder) übersteht jetzt Neustarts des Service Workers. Dadurch landen
  Dateien desselben Modells zuverlässig im selben Ordner.
- Symbolaktualisierung wertet zusätzlich `changeInfo.status` aus, da ohne die
  `tabs`-Berechtigung keine URL mehr mitgeliefert wird.

### Hinzugefügt

- Datenschutzerklärung (`privacy.html`) für den Chrome Web Store.

## [1.0.2] – 2026-05-26

### Hinzugefügt

- Weiterleitungsseite (`index.html`) für GitHub Pages.
- Google-Site-Verification für die Store-Eintragung.
- `homepage_url` im Manifest.

## [1.0.1]

### Geändert

- Neue Symbolfarben (blau / grün / gelb) je nach Seitenzustand.
- Keepalive des Service Workers verstärkt; Alarm wird bei jedem Worker-Start
  neu angelegt, nicht nur bei Installation und Browserstart.
- Lizenz auf MIT gewechselt.

## [1.0.0]

- Erste Veröffentlichung. Automatisches Herunterladen von STL-, 3MF- und
  ZIP-Dateien von MakerWorld, Printables und Thingiverse in nach Modellname und
  Plattform benannte Unterordner. ZIP-Archive werden im Arbeitsspeicher entpackt.

[1.3.0]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.3.0
[1.2.0]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.2.0
[1.1.1]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.1.1
[1.1.0]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.1.0
[1.0.9]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.9
[1.0.8]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.8
[1.0.7]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.7
[1.0.6]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.6
[1.0.5]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.5
[1.0.4]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.4
[1.0.3]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.3
[1.0.2]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.2
