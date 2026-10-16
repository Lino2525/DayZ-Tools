// Ebenen der Karte: Bezeichnung, Farbe, Darstellung und ob sie beim ersten Öffnen sichtbar sind.
// style: "dot" = kleiner Punkt (Gebäude), "box" = eckiges Abzeichen, "round" = rundes Abzeichen,
//        "ring" = Ring, "circle" = Kreisfläche mit Radius aus den Daten
window.MAP_CONFIG = {
  dataUrl: "data/nasdara.json",
  baseImage: "data/nasdara-base.png",
  paperDataUrl: "data/paper.json",
  placesUrl: "data/places.json",
  heightUrl: "data/height64.png",
  paperTiles: "data/paper/{z}/{x}/{y}.webp",
  realTiles: "data/real/{z}/{x}/{y}.webp",
  realMaxLevel: 5,
  tiersImage: "data/tiers.png",
  objectsUrl: "data/objects.json",
  height3dUrl: "data/height16.png",

  // Live-Räume: öffentlicher MQTT-Server über WebSocket. Alle müssen denselben Server nutzen.
  room: {
    broker: "wss://broker.emqx.io:8084/mqtt",
    namespace: "lino2525-dayztools/nasdara/v1",
  },
  drawColors: ["#E5322D", "#F29B1D", "#F5E04A", "#3DB54A", "#2F8FE0", "#9B4FD8", "#FFFFFF", "#1E1E1E"],
  // Optional: eigenes Kartenbild (z. B. Satellitenbild), das die gesamte Karte abdeckt.
  // Pfad eintragen, dann erscheint unter "Grundkarte" ein Schalter dafür.
  overlayImage: null,

  groups: [
    {
      id: "loot",
      title: "Loot-Gebäude",
      hint: "Gebäude nach Loot-Art laut Spieldaten",
      layers: [
        { id: "military", label: "Militär", color: "#3E5A1C", style: "dot", on: true },
        { id: "police", label: "Polizei", color: "#1E4F9E", style: "dot", on: true },
        { id: "medic", label: "Medizin", color: "#C1272D", style: "dot", on: true },
        { id: "firefighter", label: "Feuerwehr", color: "#E2571C", style: "dot", on: true },
        { id: "hunting", label: "Jagd", color: "#24785A", style: "dot", on: true },
        { id: "office", label: "Büro", color: "#3F5578", style: "dot", on: false },
        { id: "historical", label: "Historisch", color: "#6B4F2A", style: "dot", on: false },
        { id: "industrial", label: "Industrie", color: "#5F5B55", style: "dot", on: false },
        { id: "farm", label: "Bauernhof", color: "#8C6A12", style: "dot", on: false },
        { id: "town", label: "Stadt", color: "#8E3F26", style: "dot", on: false },
        { id: "village", label: "Dorf", color: "#AE7444", style: "dot", on: false }
      ]
    },
    {
      id: "events",
      title: "Ereignisse",
      hint: "Mögliche Spawnpunkte, nicht alle sind gleichzeitig aktiv",
      layers: [
        { id: "heli", label: "Heli-Absturz", glyph: "H", color: "#C2410C", style: "box", on: true },
        { id: "heli_big", label: "Heli-Absturz (groß)", glyph: "H", color: "#7F1D1D", style: "box", on: true },
        { id: "convoy", label: "Militärkonvoi", glyph: "K", color: "#3E5A1C", style: "box", on: true },
        { id: "police_car", label: "Polizeiauto", glyph: "P", color: "#1E4F9E", style: "box", on: false },
        { id: "water_truck", label: "Wassertruck", glyph: "W", color: "#1C7EA6", style: "box", on: true },
        { id: "locked", label: "Verschlossener Container", glyph: "C", color: "#6A5A3C", style: "box", on: false }
      ]
    },
    {
      id: "vehicles",
      title: "Fahrzeuge",
      hint: "Spawnpunkte nach Fahrzeugtyp",
      layers: [
        { id: "v_ada", label: "Ada 4x4", glyph: "A", color: "#0F6E66", style: "round", on: false },
        { id: "v_gunter", label: "Gunter 2", glyph: "G", color: "#0F6E66", style: "round", on: false },
        { id: "v_olga", label: "Olga 24", glyph: "O", color: "#0F6E66", style: "round", on: false },
        { id: "v_sarka", label: "Sarka 120", glyph: "S", color: "#0F6E66", style: "round", on: false },
        { id: "v_m1025", label: "M1025", glyph: "H", color: "#0F6E66", style: "round", on: false },
        { id: "v_truck", label: "M3S LKW", glyph: "L", color: "#0F6E66", style: "round", on: false },
        { id: "v_moto", label: "Motorrad", glyph: "M", color: "#0F6E66", style: "round", on: false }
      ]
    },
    {
      id: "danger",
      title: "Gefahren",
      layers: [
        { id: "gas", label: "Gaszone", color: "#8DAA1E", style: "circle", source: "circles", on: true },
        { id: "wolf", label: "Wolfsrevier", color: "#46505E", style: "circle", source: "circles", on: false },
        { id: "bear", label: "Bärenrevier", color: "#7A2E12", style: "circle", source: "circles", on: false },
        { id: "oil_pit", label: "Ölgrube", glyph: "Ö", color: "#2B2A26", style: "box", on: false }
      ]
    },
    {
      id: "places",
      title: "Orte",
      layers: [
        { id: "fuel", label: "Tankstelle", glyph: "T", color: "#A2560B", style: "box", on: true },
        { id: "bunker", label: "Bunker", glyph: "B", color: "#45403A", style: "box", on: false },
        { id: "radio_bunker", label: "Funkbunker (Morsecode)", glyph: "F", color: "#8E1B4A", style: "box", on: false },
        { id: "spawn", label: "Spieler-Spawnbereich", color: "#45403A", style: "ring", on: false }
      ]
    }
  ],

  markerTypes: [
    { id: "base", label: "Basis", glyph: "⌂" },
    { id: "stash", label: "Versteck", glyph: "▼" },
    { id: "car", label: "Fahrzeug", glyph: "◆" },
    { id: "danger", label: "Gefahr", glyph: "!" },
    { id: "meet", label: "Treffpunkt", glyph: "✕" },
    { id: "note", label: "Notiz", glyph: "•" }
  ]
};
