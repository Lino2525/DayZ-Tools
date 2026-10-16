// Live-Räume über einen öffentlichen MQTT-Server (WebSocket).
// Jedes geteilte Objekt (Zeichnung, Marker) liegt als "retained" Nachricht unter
//   <namespace>/<CODE>/o/<id>
// Wer den Raum betritt, bekommt vom Server sofort den aktuellen Stand. Eine leere
// Nachricht löscht das Objekt. Anwesenheit liegt unter <namespace>/<CODE>/p/<clientId>.
(function () {
  "use strict";

  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const HEARTBEAT = 45000;
  const STALE = 130000;

  function newCode() {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.from(a, (v) => ALPHABET[v % ALPHABET.length]).join("");
  }

  function normalizeCode(s) {
    const c = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return validCode(c) ? c : null;
  }
  function validCode(c) {
    return typeof c === "string" && c.length === 4 && [...c].every((ch) => ALPHABET.includes(ch));
  }

  function join({ broker, namespace, code, me, onObject, onPresence, onStatus }) {
    const base = `${namespace}/${code}`;
    const presence = new Map();
    let closed = false;
    let hb = null, sweep = null;

    const client = window.mqtt.connect(broker, {
      clientId: "dzt_" + Math.random().toString(36).slice(2, 10),
      clean: true,
      keepalive: 30,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
      will: { topic: `${base}/p/${me.id}`, payload: "", retain: true, qos: 0 },
    });

    const announce = () => {
      if (!client.connected) return;
      client.publish(`${base}/p/${me.id}`, JSON.stringify({ n: me.name, c: me.color, t: Date.now() }), { retain: true, qos: 0 });
    };
    const emitPresence = () => {
      const now = Date.now();
      for (const [id, p] of presence) if (id !== me.id && now - (p.seen || 0) > STALE) presence.delete(id);
      presence.set(me.id, { n: me.name, c: me.color, seen: now, self: true });
      onPresence && onPresence([...presence.entries()].map(([id, p]) => ({ id, name: p.n, color: p.c, self: !!p.self })));
    };

    client.on("connect", () => {
      onStatus && onStatus("online");
      client.subscribe(`${base}/#`, { qos: 1 });
      announce();
      emitPresence();
    });
    client.on("reconnect", () => onStatus && onStatus("connecting"));
    client.on("offline", () => onStatus && onStatus("offline"));
    client.on("error", () => onStatus && onStatus("error"));
    client.on("message", (topic, payload) => {
      if (!topic.startsWith(base + "/")) return;
      const rest = topic.slice(base.length + 1);
      const slash = rest.indexOf("/");
      const kind = rest.slice(0, slash), id = rest.slice(slash + 1);
      const text = payload && payload.length ? new TextDecoder().decode(payload) : "";
      let obj = null;
      if (text) { try { obj = JSON.parse(text); } catch (e) { return; } }
      if (kind === "o") onObject && onObject(id, obj);
      else if (kind === "p") {
        if (obj) presence.set(id, Object.assign(obj, { seen: Date.now() }));
        else presence.delete(id);
        emitPresence();
      }
    });

    hb = setInterval(announce, HEARTBEAT);
    sweep = setInterval(emitPresence, 15000);
    onStatus && onStatus("connecting");

    return {
      code,
      publish(id, obj) {
        if (closed) return;
        client.publish(`${base}/o/${id}`, JSON.stringify(obj), { retain: true, qos: 1 });
      },
      remove(id) {
        if (closed) return;
        client.publish(`${base}/o/${id}`, "", { retain: true, qos: 1 });
      },
      rename(name, color) {
        me.name = name; me.color = color;
        announce(); emitPresence();
      },
      get connected() { return client.connected; },
      leave() {
        if (closed) return;
        closed = true;
        clearInterval(hb); clearInterval(sweep);
        try { client.publish(`${base}/p/${me.id}`, "", { retain: true, qos: 0 }); } catch (e) { /* egal */ }
        setTimeout(() => client.end(true), 150);
      },
    };
  }

  window.NasdaraRoom = { newCode, normalizeCode, validCode, join, ALPHABET };
})();
