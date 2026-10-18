# Changelog

Alle nennenswerten Änderungen an dieser Erweiterung.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

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

[1.0.6]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.6
[1.0.5]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.5
[1.0.4]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.4
[1.0.3]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.3
[1.0.2]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.2
