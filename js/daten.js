// Spielwerte aus DayZ 1.30 (stable), Datei scripts.pbo.
// Jede Zahl hier ist eine Konstante aus dem Spielcode, keine Schätzung.
const HITZE = {
  // HeatStroke.c: STAGE_THRESHOLDS
  stufen: [0.0, 0.4, 0.6, 0.85],
  // PlayerConstants.c (Wert pro Sekunde)
  sinkt: 0.0001,          // THERMAL_BIAS_POSITIVE_HC_DECREMENT
  steigtNiedrig: 0.00022, // THERMAL_BIAS_POSITIVE_HC_LOW_INCREMENT
  steigtMittel: 0.00032,  // THERMAL_BIAS_POSITIVE_HC_MEDIUM_INCREMENT
  steigtHoch: 0.0005,     // THERMAL_BIAS_POSITIVE_HC_HIGH_INCREMENT
  waschen: 0.175,         // THERMAL_BIAS_WASH_HEAD_DECREMENT
  sperre: 30,             // THERMAL_BIAS_WASH_HEAD_TEMPORARY_RESISTANCE_TIME (s)
  // Wasserstand: SL_WATER_NORMAL / SL_WATER_HIGH
  wasserNormal: 1000,
  wasserHoch: 3500,
};

// Wie sich der Hitzschlag-Wert pro Sekunde ändert.
// Nachgebaut aus HeatComfortMdfr.c (OnTick).
// temp: "weiss" | "gelb" | "rot" | "rotblink" | blau-Stufen
// wasser: "voll" (>3500) | "mittel" (1000–3500) | "wenig" (<1000)
function hitzeRate(temp, wasser, wert) {
  const s = HITZE.stufen;
  const heiss = ["gelb", "rot", "rotblink"].includes(temp);
  if (!heiss) return wert > 0 ? -HITZE.sinkt : 0;
  let r = 0;
  if (temp === "rotblink") r += HITZE.steigtHoch;
  else if (temp === "rot") r += HITZE.steigtMittel;
  if (wasser === "wenig") {
    if (wert > s[3]) r += HITZE.steigtHoch;
    else if (wert >= s[2]) r += HITZE.steigtMittel;
    else r += HITZE.steigtNiedrig;
  } else if (wasser === "mittel") {
    if (wert < s[1]) r += HITZE.steigtNiedrig;
    else r -= HITZE.sinkt;
  }
  return r;
}

// Krankheiten und Zustände. Quellen: Spielcode 1.30, ergänzt um Guides (markiert).
const ZUSTAENDE = {
  hitze: {
    name: "Hitzschlag",
    kurz: "Versteckter Hitzewert, der in der Sonne steigt. Kein Erreger, keine Tablette hilft.",
    ursache: [
      "Temperatursymbol rot oder rot blinkend: Der Wert steigt immer, auch wenn du trinkst.",
      "Temperatursymbol gelb und Wassertropfen gelb oder rot: Der Wert steigt.",
      "Direkte Sonne, vor allem morgens und mittags. In Nasdara kommen mittags bis zu +8 °C dazu.",
      "Ohne Kopfbedeckung wirkt die Sonne stärker.",
    ],
    erkennen: [
      "Stufe 1: kaum etwas, du schwitzt Wasser weg.",
      "Stufe 2: verschwommene Sicht, schlechtere Ausdauer, Hitze-Animation, Krankheitssymbol.",
      "Stufe 3: Erbrechen, im Schnitt alle 7,5 bis 15 Minuten (−70 Wasser, −55 Energie).",
      "Stufe 4: Gesundheit sinkt, Sicht flackert, alle 60 bis 120 s eine 5 bis 10 s lange Ohnmacht.",
      "Das Thermometer zeigt beim Hitzschlag kein Fieber.",
    ],
    heilen: [
      "Gesicht waschen am Brunnen, am Wasser oder mit einer Flasche in der Hand: −0,175 pro Waschung.",
      "Nach jeder Waschung 30 s warten, vorher wirkt die nächste nicht.",
      "Raus aus der Sonne, bis das Temperatursymbol weiß ist und die Pfeile nach unten zeigen.",
      "Antibiotika, Kohle und Vitamine helfen nicht.",
    ],
    vorbeugen: [
      "Wassertropfen ganz voll halten (über 3500). Dann steigt der Wert bei gelbem Symbol nicht.",
      "Schon bei gelbem Symbol das Gesicht waschen, nicht erst bei rot.",
      "Kopfbedeckung tragen, leichte Kleidung, schwere Westen und warme Jacken ablegen.",
      "Lange Strecken in der Mittagssonne meiden, Pausen im Schatten machen.",
    ],
  },
  magen: {
    name: "Überfüllter Magen",
    kurz: "Zu viel auf einmal gegessen oder getrunken. Erbrechen ohne Krankheit.",
    ursache: [
      "Magen ab 1000 gefüllt: Magen-Symbol erscheint.",
      "Magen ab 2000 gefüllt: Du erbrichst sofort.",
      "Häufig, wenn man gegen die Hitze am Brunnen literweise trinkt.",
    ],
    erkennen: [
      "Erbrechen direkt nach dem Essen oder Trinken.",
      "Magen-Symbol ist sichtbar, Krankheitssymbol nicht.",
    ],
    heilen: [
      "Nichts nötig, der Magen leert sich von allein.",
      "Danach in kleinen Mengen trinken, weil Erbrechen Wasser kostet.",
    ],
    vorbeugen: [
      "In Etappen trinken und aufhören, sobald das Magen-Symbol erscheint.",
    ],
  },
  cholera: {
    name: "Cholera",
    kurz: "Kommt von ungereinigtem Wasser aus Teichen, Flüssen und Pfützen.",
    ursache: [
      "Direkt aus Teich, Fluss, Pfütze oder Tunnelwasser getrunken. Laut Code gibt das jedes Mal Cholera-Erreger.",
      "Mit Wasser aus solchen Quellen eine Flasche gefüllt und ohne Reinigung getrunken.",
      "Brunnen sind sicher.",
    ],
    erkennen: [
      "Krankheitssymbol, Fieber (das Thermometer zeigt es an), verschwommene Sicht.",
      "Schneller Wasserverlust, wiederholtes Erbrechen (−450 Wasser, −310 Energie pro Mal).",
    ],
    heilen: [
      "Tetracyclin-Antibiotika: wirken voll gegen Cholera, eine Dosis hält 300 s.",
      "Vitamine stärken das Immunsystem.",
      "Viel sauberes Wasser trinken, um den Verlust auszugleichen.",
    ],
    vorbeugen: [
      "Nur aus Brunnen trinken.",
      "Anderes Wasser mit Reinigungstabletten, Abkochen oder Filterflasche sauber machen.",
    ],
  },
  salmonellen: {
    name: "Salmonellen",
    kurz: "Kommen von rohem Fleisch oder blutigen Händen.",
    ursache: [
      "Rohes oder verdorbenes Fleisch, Fett oder Innereien gegessen (laut DayZ-Wiki).",
      "Mit blutigen Händen ohne Handschuhe gegessen oder getrunken, zum Beispiel nach dem Häuten.",
    ],
    erkennen: [
      "Krankheitssymbol, Erbrechen (−450 Wasser, −310 Energie pro Mal).",
      "Alle 12 bis 18 s ein Schmerzlaut.",
    ],
    heilen: [
      "Aktivkohle-Tabletten: töten die Erreger, wirken in den letzten 100 s einer 300-s-Dosis.",
      "Vitamine stärken das Immunsystem.",
    ],
    vorbeugen: [
      "Fleisch immer durchgaren.",
      "Hände waschen oder Handschuhe tragen, bevor du isst oder trinkst.",
    ],
  },
  vergiftung: {
    name: "Lebensmittelvergiftung",
    kurz: "Kommt von verdorbenem oder verbranntem Essen und blutigen Händen.",
    ursache: [
      "Verdorbenes oder verbranntes Essen gegessen (laut DayZ-Wiki).",
      "Unbekannte Dose oder Benzin konsumiert (laut DayZ-Wiki).",
      "Mit blutigen Händen ohne Handschuhe gegessen oder getrunken.",
    ],
    erkennen: [
      "Erbrechen in Abständen (−70 Wasser, −55 Energie), Erschöpfung.",
      "Das Krankheitssymbol erscheint beim ersten Erbrechen.",
    ],
    heilen: [
      "Aktivkohle-Tabletten beschleunigen den Abbau.",
      "Sonst abwarten. Jedes Erbrechen baut die Vergiftung ab.",
    ],
    vorbeugen: [
      "Nichts Verdorbenes oder Verbranntes essen.",
      "Hände sauber halten oder Handschuhe tragen.",
    ],
  },
  erkaeltung: {
    name: "Erkältung",
    kurz: "Leichte Form der Grippe. Kommt von Kälte, Nässe oder Ansteckung.",
    ursache: [
      "Unterkühlt oder lange nass gewesen. In Nasdara sind die Nächte kühl (3 bis 14 °C Minimum).",
      "Kontakt mit einem kranken Spieler.",
    ],
    erkennen: ["Niesen."],
    heilen: [
      "Tetracyclin-Antibiotika wirken voll.",
      "Vitamine, warm und trocken bleiben, gut essen und trinken.",
    ],
    vorbeugen: ["Nachts warm anziehen, nasse Kleidung trocknen."],
  },
  grippe: {
    name: "Grippe",
    kurz: "Folgt auf eine unbehandelte Erkältung.",
    ursache: ["Wie bei der Erkältung, nur weiter fortgeschritten."],
    erkennen: [
      "Husten, Fieber (Thermometer zeigt es an), verschwommene Sicht.",
      "Das Krankheitssymbol erscheint beim ersten Husten.",
    ],
    heilen: ["Tetracyclin-Antibiotika wirken voll.", "Vitamine helfen dem Immunsystem."],
    vorbeugen: ["Erkältung früh behandeln, warm und trocken bleiben."],
  },
  lunge: {
    name: "Lungenentzündung",
    kurz: "Folgt auf eine unbehandelte Grippe. Kostet dauerhaft Gesundheit.",
    ursache: ["Grippe weiter verschlimmert."],
    erkennen: [
      "Schweres Atmen, Husten, Gesundheit sinkt laufend.",
      "Ausdauer ist deutlich schlechter.",
    ],
    heilen: ["Sofort Tetracyclin-Antibiotika nehmen und mehrere Dosen nacheinander."],
    vorbeugen: ["Grippe nicht verschleppen."],
  },
  wunde: {
    name: "Wundinfektion",
    kurz: "Kommt von Wunden, die nicht desinfiziert wurden.",
    ursache: ["Eine Wunde wurde nicht desinfiziert."],
    erkennen: [
      "Stufe 1: Krankheitssymbol, Schmerzlaute.",
      "Stufe 2: Fieber, zitternde Hände, starke Schmerzen, Gesundheit sinkt.",
    ],
    heilen: [
      "Desinfizieren (Spray, Alkohol, Jod) baut die Infektion ab.",
      "Tetracyclin-Antibiotika wirken nur halb so stark wie bei Cholera.",
    ],
    vorbeugen: ["Wunden vor dem Verbinden desinfizieren."],
  },
  kuru: {
    name: "Kuru",
    kurz: "Kommt vom Essen von Menschenfleisch.",
    ursache: ["Menschenfleisch gegessen."],
    erkennen: ["Unkontrolliertes Lachen, Zittern, Krankheitssymbol."],
    heilen: ["Es gibt kein Heilmittel."],
    vorbeugen: ["Kein Menschenfleisch essen."],
  },
  chemie: {
    name: "Chemische Vergiftung",
    kurz: "Kommt aus Gaszonen.",
    ursache: ["Ohne Gasmaske mit Filter in einer Gaszone gewesen."],
    erkennen: ["Husten, in schwerer Form Erbrechen und Gesundheitsverlust."],
    heilen: [
      "AntiChem-Injektor: setzt die Vergiftung auf 0 oder holt sie aus der schwersten Stufe zurück.",
    ],
    vorbeugen: ["Gaszonen nur mit Gasmaske und Filter betreten."],
  },
  silikose: {
    name: "Silikose",
    kurz: "Staub in der Lunge aus einem Sandsturm.",
    ursache: ["Ohne Atemschutz in einem Sandsturm gewesen."],
    erkennen: [
      "Husten im Sturm, danach schweres Atmen.",
      "Später schlechtere Ausdauer, Gesundheitsverlust, Ohnmacht.",
    ],
    heilen: [
      "Raus aus dem Sturm: geschlossenes Gebäude, Bunker, Tunnel oder Auto. Motorrad zählt nicht.",
      "Baut sich nur ab, wenn das Immunsystem gut ist. Vitamine helfen.",
      "Antibiotika helfen nicht.",
    ],
    vorbeugen: ["Staubmaske, Tuch oder Gasmaske mit Filter tragen."],
  },
  augen: {
    name: "Gereizte Augen",
    kurz: "Sand in den Augen aus einem Sandsturm.",
    ursache: ["Ohne Brille oder Schutzbrille in einem Sandsturm gewesen."],
    erkennen: ["Rote Adern am Bildrand."],
    heilen: [
      "Gesicht am Brunnen oder Wasser waschen: halbiert die Reizung, 2 Waschungen reichen.",
      "Mit einer Flasche in der Hand hilft es kaum (−1,6 statt −50).",
    ],
    vorbeugen: ["Schutzbrille im Sandsturm tragen."],
  },
  kaelte: {
    name: "Unterkühlung",
    kurz: "Dir ist zu kalt. Kostet Energie und zuletzt Gesundheit.",
    ursache: ["Nasse Kleidung, Nacht, Wind, zu leichte Kleidung."],
    erkennen: ["Temperatursymbol hellblau, blau oder blau blinkend."],
    heilen: ["Trockene, warme Kleidung, Feuer, Gebäude.", "Essen, weil Kälte Energie kostet."],
    vorbeugen: ["Für die Nacht eine wärmere Schicht mitnehmen."],
  },
  durst: {
    name: "Wassermangel",
    kurz: "Dein Wasserstand ist kritisch und kostet Gesundheit.",
    ursache: ["Zu wenig getrunken, Schwitzen in der Hitze, Erbrechen."],
    erkennen: ["Wassertropfen rot oder rot blinkend."],
    heilen: ["Sofort sauberes Wasser trinken, in Schlucken."],
    vorbeugen: ["In der Wüste immer mindestens zwei volle Flaschen dabeihaben."],
  },
};
