# Nasdara Feldkarte

Eine Karte für **DayZ Badlands (Nasdara)** mit Filter-Legende, gebaut direkt aus Bohemias offiziellen Spieldaten. Läuft komplett im Browser und kostenlos auf GitHub Pages.

## Was drin ist

- **Loot-Gebäude** nach Kategorie: Militär, Polizei, Medizin, Feuerwehr, Jagd, Büro, Historisch, Industrie, Bauernhof, Stadt, Dorf
- **Ereignisse**: Heli-Abstürze (klein und groß), Militärkonvois, Polizeiautos, Wassertrucks, verschlossene Container
- **Fahrzeug-Spawns** nach Typ: Ada, Gunter, Olga, Sarka, M1025, M3S, Motorrad
- **Gefahren**: Gaszonen, Wolfs- und Bärenreviere, Ölgruben
- **Orte**: Tankstellen, Bunker, Funkbunker (Morsecode), Spieler-Spawnbereiche
- **Tier-Filter**: zeigt nur Punkte in Zonen ab Tier 2 oder 3
- **Grundkarte** aus Tier-Zonen, Militärgebieten und allen Gebäuden, mit 1-km-Raster
- **Koordinaten** unter dem Mauszeiger, kopieren per Klick oder Strg+C, Sprung zu einer GPS-Koordinate
- **Messen**: Entfernung und Kompassrichtung zwischen zwei Punkten
- **Eigene Marker** (Basis, Versteck, Fahrzeug, …) per Rechtsklick, gespeichert im Browser, mit Export und Import als Datei

Was die offiziellen Daten **nicht** enthalten: Satellitenbild, Gelände, Straßen und Ortsnamen. In `js/config.js` kann unter `overlayImage` ein eigenes Kartenbild eingetragen werden, das dann als Ebene über der Grundkarte liegt.

## Online stellen mit GitHub Pages

1. Auf github.com ein neues Repository anlegen, z. B. `nasdara-karte`, Sichtbarkeit **Public**.
2. Auf der Repo-Seite **Add file → Upload files** wählen und den **Inhalt** dieses Ordners hineinziehen (also `index.html`, `css`, `js`, `data`, `vendor`, `scripts` und die übrigen Dateien, nicht den Ordner selbst). Mit **Commit changes** bestätigen.
3. **Settings → Pages** öffnen, bei *Source* „Deploy from a branch“ wählen, Branch `main` und Ordner `/ (root)`, dann **Save**.
4. Nach ein bis zwei Minuten ist die Karte unter `https://<dein-name>.github.io/nasdara-karte/` erreichbar.

Hinweis: Die Seite muss über einen Webserver laufen. Ein Doppelklick auf `index.html` funktioniert nicht, weil der Browser dann die Daten nicht laden darf. Zum lokalen Testen reicht im Ordner `python -m http.server` und dann `http://localhost:8000` aufrufen.

## Daten aktualisieren

Wenn Bohemia die Missionsdateien nach einem Update ändert:

```bash
git clone --depth 1 https://github.com/BohemiaInteractive/DayZ-Central-Economy.git
pip install numpy pillow
python scripts/build_map_data.py DayZ-Central-Economy/dayzOffline.nasdara --commit "$(git -C DayZ-Central-Economy rev-parse --short HEAD)"
```

Das Skript schreibt `data/nasdara.json` und `data/nasdara-base.png` neu. Die Ebenen, Farben und Bezeichnungen stehen in `js/config.js`.

## Aufbau

```
index.html               Seite
css/style.css            Gestaltung
js/config.js             Ebenen, Farben, Marker-Arten
js/app.js                Kartenlogik
data/nasdara.json        Punkte und Zonen (erzeugt)
data/nasdara-base.png    Grundkarte, 1 Pixel = 4 m (erzeugt)
scripts/build_map_data.py  Erzeugt die Daten aus den Missionsdateien
vendor/                  Leaflet und Schriften (lokal, keine externen Abrufe)
```

## Lizenzen

- **Spieldaten** (`data/`): abgeleitet aus [DayZ Central Economy](https://github.com/BohemiaInteractive/DayZ-Central-Economy) von Bohemia Interactive, lizenziert unter der [Arma and DayZ Public License Share Alike (ADPL-SA)](https://www.bohemia.net/community/licenses/arma-and-dayz-public-license-share-alike-adpl-sa). Daraus folgt: Namensnennung, keine kommerzielle Nutzung, nur für Arma und DayZ, Weitergabe unter gleicher Lizenz. DAYZ® ist eine eingetragene Marke von Bohemia Interactive a.s. Dies ist kein offizielles Produkt von Bohemia Interactive.
- **Leaflet** (`vendor/leaflet`): BSD-2-Clause, siehe `vendor/leaflet/LICENSE`.
- **Schriften** Barlow Semi Condensed und Big Shoulders Stencil (`vendor/fonts`): SIL Open Font License, siehe Lizenzdateien im Ordner.
