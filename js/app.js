"use strict";

/* ---------- Eigene HUD-Symbole (keine Originalgrafiken) ---------- */
const ICONS = {
  temp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3.5a2 2 0 0 1 4 0v9.2a4.5 4.5 0 1 1-4 0z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="17" r="2.4" fill="currentColor"/><rect x="11.1" y="8" width="1.8" height="8" fill="currentColor"/></svg>',
  tropfen: (f) => {
    const y = 21 - 16 * f;
    const id = "t" + Math.random().toString(36).slice(2, 8);
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="${id}"><rect x="0" y="${y}" width="24" height="24"/></clipPath></defs><path d="M12 3c3.5 4.8 6 8.3 6 11.5a6 6 0 0 1-12 0C6 11.3 8.5 7.8 12 3z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3c3.5 4.8 6 8.3 6 11.5a6 6 0 0 1-12 0C6 11.3 8.5 7.8 12 3z" fill="currentColor" clip-path="url(#${id})"/></svg>`;
  },
  essen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16a8 8 0 0 1-16 0z" fill="currentColor"/><path d="M9 4c-1 1.5 1 2.5 0 4M13 4c-1 1.5 1 2.5 0 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  herz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" fill="currentColor"/></svg>',
  krank: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></g></svg>',
  magen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v4c0 2-4 2.5-4 7.5A6.5 6.5 0 0 0 11.5 21c4.5 0 7.5-3 7.5-7s-3-5-5.5-5c-1.5 0-2.5-1-2.5-2.5V3z" fill="currentColor"/></svg>',
  nass: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3c2 2.8 3.5 4.8 3.5 6.6a3.5 3.5 0 0 1-7 0C4.5 7.8 6 5.8 8 3zM16 10c2 2.8 3.5 4.8 3.5 6.6a3.5 3.5 0 0 1-7 0c0-1.8 1.5-3.8 3.5-6.6z" fill="currentColor"/></svg>',
};

function iconsEinsetzen(root) {
  root.querySelectorAll(".hud[data-icon]").forEach((el) => {
    const typ = el.dataset.icon;
    const ic = ICONS[typ];
    el.innerHTML = typeof ic === "function" ? ic(parseFloat(el.dataset.fuell || "1")) : ic;
  });
}

/* ---------- Hilfen ---------- */
const s = HITZE.stufen;
const fmtZahl = (x, d = 0) => x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtMin(sek) {
  const m = Math.round(sek / 60);
  if (m < 1) return "unter 1 Min.";
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} Std. ${r} Min.` : `${h} Std.`;
}
// Wertebereich je Stufe (Untergrenze, Obergrenze)
const STUFE_BEREICH = { 1: [0, s[1]], 2: [s[1], s[2]], 3: [s[2], s[3]], 4: [s[3], 1] };
const waschungen = (wert) => Math.ceil(wert / HITZE.waschen - 1e-9);

/* ---------- Formular lesen ---------- */
function lesen(form) {
  const d = new FormData(form);
  const w = {};
  for (const [k, v] of d.entries()) w[k] = v === "on" ? true : v;
  return w;
}

/* ---------- Auswertung ---------- */
// Jede Regel gibt Punkte und einen lesbaren Grund. Die Gewichte sind eine Einschätzung,
// die Bedingungen dahinter stammen aus dem Spielcode.
function bewerten(w) {
  const heiss = ["gelb", "rot", "rotblink"].includes(w.temp);
  const rotTemp = w.temp === "rot" || w.temp === "rotblink";
  const kalt = ["hellblau", "blau", "blaublink"].includes(w.temp);
  const wenigWasser = ["gelb", "rot", "rotblink"].includes(w.wasser);
  const r = {};
  const add = (id, p, grund) => {
    r[id] = r[id] || { punkte: 0, gruende: [] };
    r[id].punkte += p;
    if (grund && p > 0) r[id].gruende.push(grund);
  };

  // Hitzschlag
  if (w.temp === "rotblink") add("hitze", 5, "Temperatursymbol rot blinkend: der Hitzewert steigt schnell");
  else if (w.temp === "rot") add("hitze", 4, "Temperatursymbol rot: der Hitzewert steigt immer");
  else if (w.temp === "gelb") add("hitze", wenigWasser ? 3 : 1.5, wenigWasser ? "Gelbes Symbol und wenig Wasser: der Hitzewert steigt" : "Temperatursymbol gelb");
  if (heiss || w.ort === "sonne") {
    if (w.erbrechen) add("hitze", 2, "Erbrechen ist Stufe 3 des Hitzschlags");
    if (w.verschwommen) add("hitze", 1.5, "Verschwommene Sicht gehört zu Stufe 2");
    if (w.hitzeanim) add("hitze", 2.5, "Hitze-Animation gehört zu Stufe 2");
    if (w.flackern) add("hitze", 2, "Flackernde Sicht gehört zu Stufe 4");
    if (w.ohnmacht) add("hitze", 2, "Kurze Ohnmacht gehört zu Stufe 4");
    if (w.krankwechsel) add("hitze", 1.5, "Symptome kommen und gehen: Stufe 3 endet knapp unter 0,6 und beginnt knapp darüber wieder");
  }
  if (w.ort === "sonne") add("hitze", 1.5, "Du stehst in der direkten Sonne");
  if (w.zeit === "mittag" || w.zeit === "morgen") add("hitze", 1, "Morgens und mittags wirkt die Sonne in Nasdara am stärksten");
  if (w.ohnekopf && (heiss || w.ort === "sonne")) add("hitze", 0.5, "Ohne Kopfbedeckung wirkt die Sonne stärker");
  if (w.schwer && heiss) add("hitze", 0.5, "Schwere Kleidung hält Wärme");
  if (w.sprint && heiss) add("hitze", 0.5, "Rennen erzeugt Wärme");
  if (w.thermo === "fieber") add("hitze", -3);
  if (w.thermo === "normal" && w.erbrechen && heiss) add("hitze", 1, "Thermometer normal: Hitzschlag zeigt kein Fieber");

  // Überfüllter Magen
  if (w.erbrechen) {
    if (w.vielgetrunken) add("magen", 4, "Viel auf einmal gegessen oder getrunken: ab Magen 2000 erbrichst du");
    if (w.magenvoll) add("magen", 4, "Magen-voll-Symbol ist zu sehen");
    if ((w.vielgetrunken || w.magenvoll) && !w.krank) add("magen", 1, "Kein Krankheitssymbol");
  }

  // Cholera
  if (w.teich) add("cholera", 5, "Aus Teich, Fluss, Pfütze oder Tunnel getrunken: das gibt laut Code jedes Mal Cholera-Erreger");
  if (w.teich || w.thermo === "fieber") {
    if (w.thermo === "fieber") add("cholera", 2, "Thermometer zeigt Fieber");
    if (w.erbrechen) add("cholera", 1.5, "Erbrechen");
    if (w.verschwommen) add("cholera", 1, "Verschwommene Sicht durch Fieber");
    if (wenigWasser) add("cholera", 1, "Wasser sinkt schnell");
    if (w.krank) add("cholera", 1, "Krankheitssymbol");
  }

  // Salmonellen
  if (w.roh) add("salmonellen", 4, "Rohes Fleisch gegessen");
  if (w.blutig) add("salmonellen", 2.5, "Mit blutigen Händen gegessen oder getrunken");
  if (w.roh || w.blutig) {
    if (w.erbrechen) add("salmonellen", 1.5, "Erbrechen");
    if (w.schmerz) add("salmonellen", 2, "Schmerzlaute alle paar Sekunden");
    if (w.krank) add("salmonellen", 1, "Krankheitssymbol");
  }

  // Lebensmittelvergiftung
  if (w.verdorben) add("vergiftung", 4, "Verdorbenes oder verbranntes Essen");
  if (w.benzin) add("vergiftung", 4, "Benzin oder unbekannte Dose");
  if (w.blutig) add("vergiftung", 2, "Blutige Hände führen zu Salmonellen oder Vergiftung");
  if ((w.verdorben || w.benzin || w.blutig) && w.erbrechen) add("vergiftung", 2, "Erbrechen");

  // Erkältung, Grippe, Lungenentzündung
  if (w.niesen) add("erkaeltung", 4, "Niesen");
  if (w.husten) add("grippe", 3, "Husten");
  if (w.niesen || w.husten) {
    if (w.kalt) { add("erkaeltung", 2, "Gefroren oder nass gewesen"); add("grippe", 2, "Gefroren oder nass gewesen"); }
    if (w.kontakt) { add("erkaeltung", 1.5, "Kontakt mit krankem Spieler"); add("grippe", 1.5, "Kontakt mit krankem Spieler"); }
    if (w.thermo === "fieber") add("grippe", 2, "Fieber");
  }
  if (w.atmen && (w.husten || w.kalt)) {
    add("lunge", 3, "Schweres Atmen");
    if (w.husten) add("lunge", 1.5, "Husten");
    if (w.gesund === "gelb" || w.gesund === "rot") add("lunge", 1.5, "Gesundheit sinkt");
  }

  // Wundinfektion
  if (w.wunde) {
    add("wunde", 4, "Wunde ohne Desinfektion");
    if (w.schmerz) add("wunde", 2, "Schmerzlaute");
    if (w.zittern) add("wunde", 1.5, "Zitternde Hände gehören zu Stufe 2");
    if (w.thermo === "fieber") add("wunde", 1.5, "Fieber gehört zu Stufe 2");
  }

  // Kuru
  if (w.mensch) add("kuru", 5, "Menschenfleisch gegessen");
  if (w.lachen) add("kuru", 5, "Unkontrolliertes Lachen");
  if ((w.mensch || w.lachen) && w.zittern) add("kuru", 1, "Zittern");

  // Chemie
  if (w.gas) {
    add("chemie", 5, "In einer Gaszone gewesen");
    if (w.husten) add("chemie", 2, "Husten");
    if (w.erbrechen) add("chemie", 1, "Erbrechen");
  }

  // Sandsturm
  if (w.sturm) {
    add("silikose", 4, "In einem Sandsturm gewesen");
    if (w.husten) add("silikose", 2, "Husten");
    if (w.atmen) add("silikose", 2, "Schweres Atmen");
    if (w.ohnmacht) add("silikose", 1, "Ohnmacht");
  }
  if (w.augen) add("augen", 5, "Rote Adern am Bildrand");
  if (w.augen && w.sturm) add("augen", 2, "Sandsturm");

  // Kälte und Wasser
  if (w.temp === "blaublink") add("kaelte", 5, "Temperatursymbol blau blinkend");
  else if (w.temp === "blau") add("kaelte", 4, "Temperatursymbol blau");
  else if (w.temp === "hellblau") add("kaelte", 2.5, "Temperatursymbol hellblau");
  if (kalt && w.nass) add("kaelte", 1, "Nasse Kleidung");
  if (w.wasser === "rotblink") add("durst", 5, "Tropfen rot blinkend: Wasser ist leer");
  else if (w.wasser === "rot") add("durst", 3.5, "Tropfen rot");

  return Object.entries(r)
    .filter(([, v]) => v.punkte >= 3)
    .sort((a, b) => b[1].punkte - a[1].punkte)
    .map(([id, v]) => ({ id, ...v }));
}

/* Hitzschlag-Stufe aus den Symptomen schätzen */
function hitzeStufe(w) {
  if (w.flackern || w.ohnmacht) return 4;
  if (w.erbrechen && !w.vielgetrunken && !w.magenvoll) return 3;
  if (w.verschwommen || w.hitzeanim || w.krank) return 2;
  return 1;
}
function wasserKlasse(w) {
  if (w.wasser === "voll") return "voll";
  if (w.wasser === "mittel") return "mittel";
  if (["gelb", "rot", "rotblink"].includes(w.wasser)) return "wenig";
  return null;
}

function skalaHtml(von, bis, text) {
  return `<div class="skala-band" aria-hidden="true">
    <div class="seg s1" style="--von:0;--bis:.4"><span></span></div>
    <div class="seg s2" style="--von:.4;--bis:.6"><span></span></div>
    <div class="seg s3" style="--von:.6;--bis:.85"><span></span></div>
    <div class="seg s4" style="--von:.85;--bis:1"><span></span></div>
    <div class="marker" style="--von:${von};--bis:${bis}" data-text="${text}"></div>
  </div>`;
}

function hitzeBox(w) {
  const stufe = hitzeStufe(w);
  const [lo, hi] = STUFE_BEREICH[stufe];
  const mitte = (lo + hi) / 2;
  const wk = wasserKlasse(w);
  let trend = "";
  if (w.temp && wk) {
    const rate = hitzeRate(w.temp === "hellblau" || w.temp === "blau" || w.temp === "blaublink" ? "weiss" : w.temp, wk, mitte);
    if (rate > 0) {
      const bisNaechste = stufe < 4 ? (hi - mitte) / rate : null;
      trend = `<p class="trend steigt">Dein Wert steigt gerade, um etwa ${fmtZahl(rate * 60, 3)} pro Minute.</p>` +
        (bisNaechste ? `<p>So geht es in grob ${fmtMin(bisNaechste)} in Stufe ${stufe + 1}.</p>` : "");
    } else if (rate < 0) {
      trend = `<p class="trend sinkt">Dein Wert sinkt gerade, aber nur um ${fmtZahl(-rate * 60, 3)} pro Minute.</p><p>Mit Gesicht waschen geht es viel schneller.</p>`;
    } else {
      trend = `<p class="trend bleibt">Dein Wert bleibt gerade gleich.</p><p>Er sinkt erst, wenn das Temperatursymbol weiß wird oder du dein Gesicht wäschst.</p>`;
    }
  } else {
    trend = `<p class="leer">Gib Temperatur- und Wassersymbol an, dann siehst du, ob der Wert gerade steigt oder sinkt.</p>`;
  }
  const nMin = waschungen(lo), nMax = waschungen(hi);
  const wasch = nMin === nMax ? `${nMax}` : `${Math.max(1, nMin)} bis ${nMax}`;
  return `<div class="hitze-box">
    <h5>Geschätzter Hitzewert: Stufe ${stufe} (${fmtZahl(lo, 2)} bis ${fmtZahl(hi, 2)})</h5>
    ${skalaHtml(lo, hi, "Du")}
    ${trend}
    <p><strong>${wasch}× Gesicht waschen</strong> im 30-s-Takt bringen dich auf 0. Nur abkühlen dauert bis zu ${fmtMin(hi / HITZE.sinkt)}</p>
  </div>`;
}

function hitzeJetzt(w) {
  const stufe = hitzeStufe(w);
  const list = [];
  if (stufe === 4) list.push("Sofort in Deckung: Schatten, Gebäude oder Auto. Erst dann trinken.");
  const [, hi] = STUFE_BEREICH[stufe];
  list.push(`${waschungen(hi)}× Gesicht waschen, nach jeder Waschung 30 s warten.`);
  if (w.temp === "rot" || w.temp === "rotblink" || w.ort === "sonne") list.push("Raus aus der Sonne, bis das Temperatursymbol weiß ist und die Pfeile nach unten zeigen.");
  if (w.wasser && w.wasser !== "voll") list.push("Tropfen ganz voll trinken, in Etappen. Aufhören, wenn das Magen-Symbol erscheint.");
  if (w.ohnekopf) list.push("Eine Kopfbedeckung aufsetzen.");
  if (w.schwer) list.push("Schwere oder warme Kleidung ablegen.");
  return list;
}

function befundHtml(b, index, w) {
  const z = ZUSTAENDE[b.id];
  const max = 14;
  const anteil = Math.min(1, b.punkte / max);
  const sicherheit = anteil > 0.65 ? "sehr wahrscheinlich" : anteil > 0.4 ? "wahrscheinlich" : "möglich";
  const jetzt = b.id === "hitze" ? hitzeJetzt(w) : z.heilen;
  return `<article class="befund${index === 0 ? " haupt" : ""}">
    <div class="befund-kopf"><h4>${z.name}</h4><span class="sicher">${sicherheit}</span></div>
    <div class="balken"><i style="--w:${Math.round(anteil * 100)}%"></i></div>
    ${b.id === "hitze" ? hitzeBox(w) : ""}
    <div class="spalten">
      <div><h5>Spricht dafür</h5><ul>${b.gruende.map((g) => `<li>${g}</li>`).join("")}</ul></div>
      <div><h5>Jetzt tun</h5><ol>${jetzt.map((t) => `<li>${t}</li>`).join("")}</ol></div>
      <div><h5>Damit es nicht wiederkommt</h5><ul>${z.vorbeugen.map((t) => `<li>${t}</li>`).join("")}</ul></div>
    </div>
  </article>`;
}

function auswerten(form, ziel) {
  const w = lesen(form);
  const liste = bewerten(w);
  let html = `<h3>Auswertung</h3>`;
  if (!liste.length) {
    const leer = Object.keys(w).filter((k) => w[k]).length === 0;
    html += leer
      ? `<p class="leer">Du hast noch nichts angegeben. Wähle oben mindestens das Temperatursymbol und was dein Charakter zeigt.</p>`
      : `<p class="leer">Aus deinen Angaben lässt sich keine Ursache eindeutig ablesen. Ergänze, was du in der letzten Stunde gemacht hast, zum Beispiel woraus du getrunken hast.</p>`;
  } else {
    html += `<p class="unter">${liste.length === 1 ? "Eine Ursache passt" : `${liste.length} Ursachen passen`} zu deinen Angaben, die wahrscheinlichste zuerst.</p>`;
    html += liste.map((b, i) => befundHtml(b, i, w)).join("");
    if (w.erbrechen && liste.some((b) => b.id === "hitze") && liste.some((b) => b.id === "cholera")) {
      html += `<p class="hinweis">Hitzschlag und Cholera machen beide Erbrechen. Ein Thermometer klärt es: Fieber spricht für Cholera, beim Hitzschlag ist die Körpertemperatur normal.</p>`;
    }
  }
  ziel.innerHTML = html;
  ziel.hidden = false;
  ziel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/* ---------- Rechner ---------- */
function rechnerZeigen() {
  const stufe = +document.querySelector('input[name="rstufe"]:checked').value;
  const [lo, hi] = STUFE_BEREICH[stufe];
  const ziel = document.getElementById("rechner-ausgabe");
  const nMin = Math.max(1, waschungen(lo)), nMax = waschungen(hi);
  const wasch = nMin === nMax ? `${nMax}×` : `${nMin}–${nMax}×`;
  const karten = [`<div class="zahl-karte"><b>${wasch} waschen</b><span>Gesicht waschen im 30-s-Takt bringt dich von hier auf 0. Das dauert nur wenige Minuten.</span></div>`];
  if (stufe >= 3) {
    const von = stufe === 3 ? "0" : fmtMin((lo - s[2]) / HITZE.sinkt);
    karten.push(`<div class="zahl-karte"><b>${von} bis ${fmtMin((hi - s[2]) / HITZE.sinkt)}</b><span>Nur abkühlen, bis das Erbrechen aufhört (unter 0,6). Gesund bist du dann noch nicht.</span></div>`);
  } else {
    karten.push(`<div class="zahl-karte"><b>Gelb + voll = Stillstand</b><span>Bei gelbem Symbol und ganz vollem Tropfen sinkt der Wert nicht. Nur ein weißes Symbol oder Waschen hilft.</span></div>`);
  }
  karten.push(`<div class="zahl-karte"><b>${fmtMin(lo / HITZE.sinkt) === "unter 1 Min." ? "bis " : fmtMin(lo / HITZE.sinkt) + " bis "}${fmtMin(hi / HITZE.sinkt)}</b><span>Nur abkühlen (Temperatursymbol weiß), bis der Wert ganz bei 0 ist. Erst dann ist der Hitzschlag weg.</span></div>`);
  ziel.innerHTML = karten.join("");
}

/* ---------- Krankheitsliste ---------- */
function krankheitenZeigen() {
  const ziel = document.getElementById("krank-liste");
  ziel.innerHTML = Object.values(ZUSTAENDE).map((z, i) => `
    <details${i === 0 ? " open" : ""}>
      <summary><span class="k-name">${z.name}</span><span class="k-kurz">${z.kurz}</span></summary>
      <div class="krank-inhalt">
        <div><h4>Ursache</h4><ul>${z.ursache.map((t) => `<li>${t}</li>`).join("")}</ul></div>
        <div><h4>Erkennen</h4><ul>${z.erkennen.map((t) => `<li>${t}</li>`).join("")}</ul></div>
        <div><h4>Heilen</h4><ul>${z.heilen.map((t) => `<li>${t}</li>`).join("")}</ul></div>
        <div><h4>Vorbeugen</h4><ul>${z.vorbeugen.map((t) => `<li>${t}</li>`).join("")}</ul></div>
      </div>
    </details>`).join("");
}

/* ---------- Leiste: aktiven Bereich markieren ---------- */
function leisteBeobachten() {
  const links = [...document.querySelectorAll(".leiste a")];
  const bereiche = links.map((a) => document.querySelector(a.getAttribute("href")));
  const obs = new IntersectionObserver((eintraege) => {
    eintraege.forEach((e) => {
      if (e.isIntersecting) {
        links.forEach((a) => a.classList.toggle("aktiv", a.getAttribute("href") === "#" + e.target.id));
      }
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  bereiche.forEach((b) => b && obs.observe(b));
}

/* ---------- Start ---------- */
document.addEventListener("DOMContentLoaded", () => {
  iconsEinsetzen(document);
  krankheitenZeigen();
  rechnerZeigen();
  document.querySelectorAll('input[name="rstufe"]').forEach((el) => el.addEventListener("change", rechnerZeigen));

  const form = document.getElementById("formular");
  const ziel = document.getElementById("ergebnis");
  form.addEventListener("submit", (e) => { e.preventDefault(); auswerten(form, ziel); });
  form.addEventListener("reset", () => { ziel.hidden = true; ziel.innerHTML = ""; });
  leisteBeobachten();
});
