# DayZ-Tools: Nasdara Feldkarte

Eine Karte für **DayZ Badlands (Nasdara)** mit Filter-Legende, gebaut direkt aus Bohemias offiziellen Spieldaten. Läuft komplett im Browser und kostenlos auf GitHub Pages.

## Was drin ist

- **Loot-Gebäude** nach Kategorie: Militär, Polizei, Medizin, Feuerwehr, Jagd, Büro, Historisch, Industrie, Bauernhof, Stadt, Dorf
- **Ereignisse**: Heli-Abstürze (klein und groß), Militärkonvois, Polizeiautos, Wassertrucks, verschlossene Container
- **Fahrzeug-Spawns** nach Typ: Ada, Gunter, Olga, Sarka, M1025, M3S, Motorrad
- **Gefahren**: Gaszonen, Wolfs- und Bärenreviere, Ölgruben
- **Orte**: Tankstellen, Bunker, Funkbunker (Morsecode), Spieler-Spawnbereiche
- **Tier-Filter**: zeigt nur Punkte in Zonen ab Tier 2 oder 3
- **Zwei Kartenarten** zum Umschalten (unten links): **Papierkarte** mit Höhenlinien, farbigen Wegen nach Klasse (Hauptweg, Nebenweg, Pfad) und Ortsnamen, oder **Gelände**, eine realistische Ansicht mit Sand, Dünen, Fels, Gärten, jedem einzelnen Baum und jedem Haus samt Schatten
- **Tier-Zonen** als zuschaltbare, halbtransparente Ebene von grün (Tier 1) bis rot (Tier 4), Militärgebiete schraffiert
- **3D-Ansicht**: ein 4 × 4 km großer Ausschnitt um die Kartenmitte mit Gelände, Bäumen und Gebäuden, frei dreh- und zoombar, Überhöhung einstellbar
- **Höhe** unter dem Mauszeiger
- **Koordinaten** unter dem Mauszeiger, kopieren per Klick oder Strg+C, Sprung zu einer GPS-Koordinate
- **Messen**: Entfernung und Kompassrichtung zwischen zwei Punkten
- **Live-Räume** mit 4-stelligem Code: Wer im selben Raum ist, sieht Zeichnungen und Marker der anderen sofort, dazu wer gerade online ist
- **Zeichnen**: Stift, Pfeil und Kreis in 8 Farben. Andere sehen den Strich schon während du zeichnest. Das **X** löscht alles, was du selbst gezeichnet hast, die Zeichnungen der anderen bleiben
- **Marker** (Basis, Versteck, Fahrzeug, …) per Rechtsklick. Im Raum für alle sichtbar und bearbeitbar, ohne Raum nur im eigenen Browser, mit Export und Import als Datei

## Wie die Papierkarte entsteht

Das eigentliche Terrain von Nasdara (Höhenmodell, Straßennetz, Ortsnamen) ist in den Spieldateien verschlüsselt und wird hier nicht verwendet. Die Papierkarte ist stattdessen aus den offenen Missionsdateien berechnet:

- **Gelände:** rund 200.000 Objekte mit Höhenangabe (Bäume, Wegstücke, Gebäude) werden zu einem Höhenraster interpoliert. Wo viele Objekte stehen, ist das Gelände genau, in leeren Wüstenflächen nur grob. Höhenlinien werden nur dort gezeichnet, wo die Daten dicht genug sind.
- **Wege:** rund 38.000 Wegstücke (Fahrwege, Pisten, Pfade) mit Position, Richtung und Länge, zu Linien verbunden. **Asphaltstraßen sind in diesen Daten nicht enthalten** und fehlen deshalb.
- **Gebäude:** Position und Ausrichtung aller Loot-Gebäude. Die Grundfläche ist aus der Lage der Loot-Punkte im Gebäude geschätzt, das Material (Lehm, Stein, Wellblech, Holz) aus dem Gebäudenamen.
- **Bäume:** rund 156.000 Bäume, Stümpfe und Stämme mit Art und Position.
- **Texturen:** Sand, Dünenrippel, Schotter, Fels, Gartenerde, Baumkronen und Dächer sind komplett selbst berechnet und gezeichnet. Es werden keine Texturen oder Bilder aus dem Spiel oder von anderen Kartenseiten verwendet.
- **Ortsnamen:** stehen in `data/places.json`. Bisher sind nur Namen drin, die offen in Bohemias Daten vorkommen (Konvoi-Gruppen, Musikzonen). Namen mit ≈ sind ungefähr platziert.

### Ortsnamen ergänzen oder korrigieren

`data/places.json` direkt auf GitHub bearbeiten (Stift-Symbol) und einen Eintrag ergänzen:

```json
{ "name": "Sabzabad", "x": 7050, "z": 7260, "type": "town", "source": "im Spiel abgelesen", "approx": false }
```

`x` und `z` sind die Koordinaten, die die Karte oben rechts anzeigt. `type` ist `city`, `town`, `village`, `poi` oder `region` und bestimmt die Schriftgröße. Nach dem Speichern ist der Name nach ein bis zwei Minuten auf der Seite.

## Live-Räume

Beim Öffnen der Seite fragt sie nach deinem Namen. Danach kannst du einen neuen Raum öffnen (du bekommst einen Code wie `K7QD`) oder mit dem Code eines Mitspielers beitreten. „Einladung kopieren“ kopiert einen Link, der direkt in den Raum führt.

Technisch läuft das über einen kostenlosen, öffentlichen MQTT-Server (`broker.emqx.io`), ein Konto braucht niemand. Jede Zeichnung und jeder Marker liegt dort als gespeicherte Nachricht im Raum, deshalb sieht auch, wer später dazukommt, den aktuellen Stand. Wichtig:

- Wer den Code kennt, kann mitlesen und mitzeichnen. Für Stash-Positionen also lieber nicht allzu offensichtliche Notizen schreiben.
- Der Server ist ein öffentlicher Testdienst ohne Garantie. Fällt er aus oder wird er gelöscht, sind die Zeichnungen weg. Der Server steht in `js/config.js` unter `room.broker` und lässt sich austauschen; alle müssen denselben nutzen.
- Zum Testen ohne Internet kann die lokal geöffnete Seite mit `?broker=ws://localhost:8883` einen eigenen Server nutzen.

## Online stellen mit GitHub Pages

1. Im Repository **Settings → Pages** öffnen.
2. Bei *Source* „Deploy from a branch“ wählen, Branch `main` und Ordner `/ (root)`, dann **Save**.
3. Nach ein bis zwei Minuten ist die Karte unter `https://lino2525.github.io/DayZ-Tools/` erreichbar. Jede Änderung auf `main` wird automatisch veröffentlicht.

Hinweis: Die Seite muss über einen Webserver laufen. Ein Doppelklick auf `index.html` funktioniert nicht, weil der Browser dann die Daten nicht laden darf. Zum lokalen Testen reicht im Ordner `python -m http.server` und dann `http://localhost:8000` aufrufen.

## Daten aktualisieren

Wenn Bohemia die Missionsdateien nach einem Update ändert:

```bash
git clone --depth 1 https://github.com/BohemiaInteractive/DayZ-Central-Economy.git
pip install numpy pillow scipy scikit-image
python scripts/build_map_data.py DayZ-Central-Economy/dayzOffline.nasdara --commit "$(git -C DayZ-Central-Economy rev-parse --short HEAD)"
python scripts/build_paper_map.py DayZ-Central-Economy/dayzOffline.nasdara
python scripts/build_realistic.py DayZ-Central-Economy/dayzOffline.nasdara
```

Das erste Skript schreibt `data/nasdara.json` und `data/nasdara-base.png`, das zweite die Papierkarte (`data/paper/`, `data/paper.json`, `data/height64.png`, `data/tiers.png`), das dritte die Geländeansicht und die 3D-Daten (`data/real/`, `data/objects.json`, `data/height16.png`, dauert etwa zwei Minuten). `data/places.json` wird nicht überschrieben. Die Ebenen, Farben und Bezeichnungen stehen in `js/config.js`.

## Aufbau

```
index.html               Seite
css/style.css            Gestaltung
js/config.js             Ebenen, Farben, Marker-Arten
js/app.js                Kartenlogik
js/view3d.js             3D-Ansicht (wird erst beim Öffnen geladen)
js/room.js               Live-Räume über MQTT
data/nasdara.json        Punkte und Zonen (erzeugt)
data/nasdara-base.png    Loot-Zonen-Karte, 1 Pixel = 4 m (erzeugt)
data/paper/              Kacheln der Papierkarte (erzeugt)
data/paper.json          Wege, Gebäude, Siedlungen, Höhenpunkte (erzeugt)
data/height64.png        Höhenraster für die Höhenanzeige (erzeugt)
data/real/               Kacheln der Geländeansicht, bis 2 m je Pixel (erzeugt)
data/objects.json        Bäume und Gebäude (erzeugt)
data/tiers.png           Tier-Zonen als transparente Ebene (erzeugt)
data/height16.png        Höhenraster für 3D (erzeugt)
data/places.json         Ortsnamen (von Hand gepflegt)
scripts/build_map_data.py   Erzeugt Loot-Daten und Loot-Zonen-Karte
scripts/build_paper_map.py  Erzeugt die Papierkarte und die Tier-Zonen
scripts/build_realistic.py  Erzeugt Geländeansicht, Bäume, Gebäude und 3D-Daten
vendor/                  Leaflet und Schriften (lokal, keine externen Abrufe)
```

## Lizenzen

- **Spieldaten** (`data/`): abgeleitet aus [DayZ Central Economy](https://github.com/BohemiaInteractive/DayZ-Central-Economy) und [DayZ Script Diff](https://github.com/BohemiaInteractive/DayZ-Script-Diff-Experimental) von Bohemia Interactive, lizenziert unter der [Arma and DayZ Public License Share Alike (ADPL-SA)](https://www.bohemia.net/community/licenses/arma-and-dayz-public-license-share-alike-adpl-sa). Daraus folgt: Namensnennung, keine kommerzielle Nutzung, nur für Arma und DayZ, Weitergabe unter gleicher Lizenz. DAYZ® ist eine eingetragene Marke von Bohemia Interactive a.s. Dies ist kein offizielles Produkt von Bohemia Interactive.
- **Leaflet** (`vendor/leaflet`): BSD-2-Clause, siehe `vendor/leaflet/LICENSE`.
- **three.js** (`vendor/three`): MIT, siehe `vendor/three/LICENSE`.
- **MQTT.js** (`vendor/mqtt`): MIT, siehe `vendor/mqtt/LICENSE.md`.
- **Schriften** Barlow Semi Condensed und Big Shoulders Stencil (`vendor/fonts`): SIL Open Font License, siehe Lizenzdateien im Ordner.
