# DayZ-Tools: Nasdara Feldkarte

Eine Karte für **DayZ Badlands (Nasdara)** mit Filter-Legende, gebaut direkt aus Bohemias offiziellen Spieldaten. Läuft komplett im Browser und kostenlos auf GitHub Pages.

## Was drin ist

- **Loot-Gebäude** nach Kategorie: Militär, Polizei, Medizin, Feuerwehr, Jagd, Büro, Historisch, Industrie, Bauernhof, Stadt, Dorf
- **Ereignisse**: Heli-Abstürze (klein und groß), Militärkonvois, Polizeiautos, Wassertrucks, verschlossene Container
- **Fahrzeug-Spawns** nach Typ: Ada, Gunter, Olga, Sarka, M1025, M3S, Motorrad
- **Gefahren**: Gaszonen, Wolfs- und Bärenreviere, Ölgruben
- **Orte**: Tankstellen, Bunker, Funkbunker (Morsecode), Spieler-Spawnbereiche
- **Tier-Filter**: zeigt nur Punkte in Zonen ab Tier 2 oder 3
- **Zwei Kartenarten** zum Umschalten (unten links): **Papierkarte** mit Gelände, Höhenlinien, Wegen, Gebäuden und Ortsnamen, oder **Loot-Zonen** mit Tier-Zonen und Militärgebieten. Beide mit 1-km-Raster
- **Höhe** unter dem Mauszeiger
- **Koordinaten** unter dem Mauszeiger, kopieren per Klick oder Strg+C, Sprung zu einer GPS-Koordinate
- **Messen**: Entfernung und Kompassrichtung zwischen zwei Punkten
- **Eigene Marker** (Basis, Versteck, Fahrzeug, …) per Rechtsklick, gespeichert im Browser, mit Export und Import als Datei

## Wie die Papierkarte entsteht

Das eigentliche Terrain von Nasdara (Höhenmodell, Straßennetz, Ortsnamen) ist in den Spieldateien verschlüsselt und wird hier nicht verwendet. Die Papierkarte ist stattdessen aus den offenen Missionsdateien berechnet:

- **Gelände:** rund 200.000 Objekte mit Höhenangabe (Bäume, Wegstücke, Gebäude) werden zu einem Höhenraster interpoliert. Wo viele Objekte stehen, ist das Gelände genau, in leeren Wüstenflächen nur grob. Höhenlinien werden nur dort gezeichnet, wo die Daten dicht genug sind.
- **Wege:** rund 38.000 Wegstücke (Fahrwege, Pisten, Pfade) mit Position, Richtung und Länge, zu Linien verbunden. **Asphaltstraßen sind in diesen Daten nicht enthalten** und fehlen deshalb.
- **Gebäude:** Position und Ausrichtung aller Loot-Gebäude, als einheitliche Quadrate.
- **Ortsnamen:** stehen in `data/places.json`. Bisher sind nur Namen drin, die offen in Bohemias Daten vorkommen (Konvoi-Gruppen, Musikzonen). Namen mit ≈ sind ungefähr platziert.

### Ortsnamen ergänzen oder korrigieren

`data/places.json` direkt auf GitHub bearbeiten (Stift-Symbol) und einen Eintrag ergänzen:

```json
{ "name": "Sabzabad", "x": 7050, "z": 7260, "type": "town", "source": "im Spiel abgelesen", "approx": false }
```

`x` und `z` sind die Koordinaten, die die Karte oben rechts anzeigt. `type` ist `city`, `town`, `village`, `poi` oder `region` und bestimmt die Schriftgröße. Nach dem Speichern ist der Name nach ein bis zwei Minuten auf der Seite.

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
```

Das erste Skript schreibt `data/nasdara.json` und `data/nasdara-base.png`, das zweite die Papierkarte (`data/paper/`, `data/paper.json`, `data/height64.png`). `data/places.json` wird nicht überschrieben. Die Ebenen, Farben und Bezeichnungen stehen in `js/config.js`.

## Aufbau

```
index.html               Seite
css/style.css            Gestaltung
js/config.js             Ebenen, Farben, Marker-Arten
js/app.js                Kartenlogik
data/nasdara.json        Punkte und Zonen (erzeugt)
data/nasdara-base.png    Loot-Zonen-Karte, 1 Pixel = 4 m (erzeugt)
data/paper/              Kacheln der Papierkarte (erzeugt)
data/paper.json          Wege, Gebäude, Siedlungen, Höhenpunkte (erzeugt)
data/height64.png        Höhenraster für die Höhenanzeige (erzeugt)
data/places.json         Ortsnamen (von Hand gepflegt)
scripts/build_map_data.py   Erzeugt Loot-Daten und Loot-Zonen-Karte
scripts/build_paper_map.py  Erzeugt die Papierkarte
vendor/                  Leaflet und Schriften (lokal, keine externen Abrufe)
```

## Lizenzen

- **Spieldaten** (`data/`): abgeleitet aus [DayZ Central Economy](https://github.com/BohemiaInteractive/DayZ-Central-Economy) und [DayZ Script Diff](https://github.com/BohemiaInteractive/DayZ-Script-Diff-Experimental) von Bohemia Interactive, lizenziert unter der [Arma and DayZ Public License Share Alike (ADPL-SA)](https://www.bohemia.net/community/licenses/arma-and-dayz-public-license-share-alike-adpl-sa). Daraus folgt: Namensnennung, keine kommerzielle Nutzung, nur für Arma und DayZ, Weitergabe unter gleicher Lizenz. DAYZ® ist eine eingetragene Marke von Bohemia Interactive a.s. Dies ist kein offizielles Produkt von Bohemia Interactive.
- **Leaflet** (`vendor/leaflet`): BSD-2-Clause, siehe `vendor/leaflet/LICENSE`.
- **Schriften** Barlow Semi Condensed und Big Shoulders Stencil (`vendor/fonts`): SIL Open Font License, siehe Lizenzdateien im Ordner.
