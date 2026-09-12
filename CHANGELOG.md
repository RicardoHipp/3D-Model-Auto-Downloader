# Changelog

Alle nennenswerten Änderungen an dieser Erweiterung.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung an [Semantic Versioning](https://semver.org/lang/de/).

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

[1.0.4]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.4
[1.0.3]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.3
[1.0.2]: https://github.com/RicardoHipp/3D-Model-Auto-Downloader/releases/tag/v1.0.2
