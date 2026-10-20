# Feldsanitäter Nasdara

Ein Werkzeug für **DayZ Badlands (Nasdara)**: Du gibst ein, was dein Charakter zeigt, und die Seite sagt dir, was du wahrscheinlich hast und was jetzt hilft. Der Schwerpunkt liegt auf dem Hitzschlag aus Update 1.30.

**Zur Seite:** https://lino2525.github.io/DayZ-Tools/

## Was drin ist

- **Zustand prüfen:** HUD-Symbole, Symptome, was du zuletzt gemacht hast und wo du bist. Daraus entsteht eine Einschätzung mit Gründen, Sofortmaßnahmen und Tipps gegen den Rückfall.
- **Hitzschlag verstehen:** wann der versteckte Hitzewert steigt oder sinkt, ein Rechner für die Heilungsdauer und die Werte von Nasdara.
- **Krankheiten nachschlagen:** alle Vanilla-Krankheiten mit Ursache, Erkennen, Heilen und Vorbeugen.
- **Wichtige Fakten:** das Wichtigste auf einen Blick.

Die Seite speichert nichts und braucht keine Anmeldung.

## Woher die Werte kommen

Die Zahlen stammen aus den Spielskripten von DayZ 1.30 (`dta/scripts.pbo`), vor allem `HeatStroke.c`, `HeatComfortMdfr.c`, `PlayerConstants.c` und `Nasdara.c`. Wo eine Angabe aus einem Guide oder Wiki stammt, ist sie auf der Seite so gekennzeichnet.

## Aufbau

Reines HTML, CSS und JavaScript ohne Build-Schritt. Läuft direkt auf GitHub Pages.

- `index.html`: Seite
- `css/style.css`: Gestaltung
- `js/daten.js`: Spielwerte und Krankheiten
- `js/app.js`: Auswertung, Rechner, Liste

Inoffizielles Fan-Tool, nicht von Bohemia Interactive.
