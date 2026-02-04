// public/js/track.js
(() => {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("Geen Supabase client. Check supabase-config.js");
    return;
  }

  const elInput = document.getElementById("trackInput");
  const elBtn = document.getElementById("searchBtn");
  const elStatus = document.getElementById("statusLine");
  const elResult = document.getElementById("resultCard");
  const elShipMeta = document.getElementById("shipMeta");
  const elShipBadge = document.getElementById("shipBadge");
  const elTimeline = document.getElementById("timeline");

  let currentShipment = null;
  let channel = null;

  const STATUS_UI = {
    created:   { label: "Aangemeld",   kind: "neutral" },
    en_route:  { label: "Onderweg",    kind: "warn" },
    delivered: { label: "Afgeleverd",  kind: "ok" },
    problem:   { label: "Probleem",    kind: "bad" },
  };

  function setStatus(text, kind = "") {
    elStatus.className = "statusline";
    if (kind) elStatus.classList.add(kind);
    elStatus.textContent = text || "";
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("nl-NL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch {
      return iso || "";
    }
  }

  function normalizeCode(v) {
    return (v || "").trim().toUpperCase();
  }

  function clearUI() {
    currentShipment = null;
    elResult.style.display = "none";
    elShipMeta.textContent = "";
    elShipBadge.textContent = "—";
    elShipBadge.className = "badge neutral";
    elTimeline.innerHTML = "";
  }

  function badgeFromEventType(eventType) {
    const key = (eventType || "").toLowerCase();
    const def = STATUS_UI[key] || { label: key || "Onbekend", kind: "neutral" };
    elShipBadge.textContent = def.label;
    elShipBadge.className = `badge ${def.kind}`;
  }

  function renderTimeline(events) {
    // events verwacht: oplopend op created_at
    elTimeline.innerHTML = "";

    if (!events || events.length === 0) {
      const div = document.createElement("div");
      div.className = "tl-item";
      div.innerHTML = `<div class="tl-left">
          <div class="tl-title">Nog geen events</div>
          <div class="tl-note">Wacht op eerste status-update</div>
        </div>
        <div class="tl-time">—</div>`;
      elTimeline.appendChild(div);
      return;
    }

    // dedupe op (event_type + created_at + note) om rommel te vermijden
    const seen = new Set();

    for (const e of events) {
      const sig = `${e.event_type}|${e.created_at}|${e.note || ""}`;
      if (seen.has(sig)) continue;
      seen.add(sig);

      const key = (e.event_type || "").toLowerCase();
      const ui = STATUS_UI[key] || { label: key || "Onbekend", kind: "neutral" };

      const div = document.createElement("div");
      div.className = "tl-item";
      div.innerHTML = `
        <div class="tl-left">
          <div class="tl-title">${ui.label}</div>
          <div class="tl-note">${(e.note || "").trim() || "—"}</div>
        </div>
        <div class="tl-time">${fmtDate(e.created_at)}</div>
      `;
      elTimeline.appendChild(div);
    }

    // laatste event bepaalt badge (dus delivered wint)
    const last = events[events.length - 1];
    badgeFromEventType(last?.event_type);
  }

  async function fetchShipmentByCode(code) {
    // Let op: jouw kolom heet _code (zie jouw screenshots)
    const { data, error } = await sb
      .from("shipments")
      .select("id, _code, status, customer_name, created_at")
      .eq("_code", code)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function fetchEventsForShipment(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function unsubscribeRealtime() {
    try {
      if (channel) {
        await sb.removeChannel(channel);
        channel = null;
      }
    } catch (e) {
      console.warn("unsubscribeRealtime failed", e);
    }
  }

  async function subscribeRealtime(shipmentId) {
    await unsubscribeRealtime();

    channel = sb.channel(`track-events-${shipmentId}`);

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "shipment_events",
        filter: `shipment_id=eq.${shipmentId}`,
      },
      async (payload) => {
        // Bij nieuwe event: opnieuw events ophalen (simpel en betrouwbaar)
        try {
          const events = await fetchEventsForShipment(shipmentId);
          renderTimeline(events);
          setStatus("Gevonden ✅ (realtime actief)", "ok");
        } catch (e) {
          console.error(e);
          setStatus("Realtime update fout (events ophalen)", "warn");
        }
      }
    );

    const { error } = await channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // ok
      }
    });

    if (error) {
      console.error(error);
      setStatus("Realtime subscription mislukt", "warn");
    }
  }

  async function runSearch() {
    const code = normalizeCode(elInput.value);

    if (!code) {
      clearUI();
      setStatus("Vul een trackcode in.", "warn");
      return;
    }

    setStatus("Zoeken…", "");
    clearUI();

    try {
      const shipment = await fetchShipmentByCode(code);

      if (!shipment) {
        setStatus("Niet gevonden ❌ (controleer de code)", "bad");
        return;
      }

      currentShipment = shipment;

      // meta
      elShipMeta.textContent =
        `Klant: ${shipment.customer_name || "—"} • Aangemaakt: ${fmtDate(shipment.created_at)}`;

      // events
      const events = await fetchEventsForShipment(shipment.id);

      // als er nog geen events zijn: toon status uit shipments.status als badge
      if (!events || events.length === 0) {
        badgeFromEventType(shipment.status);
        renderTimeline([]);
      } else {
        renderTimeline(events);
      }

      elResult.style.display = "block";
      setStatus("Gevonden ✅ (realtime actief)", "ok");

      // realtime
      await subscribeRealtime(shipment.id);
    } catch (e) {
      console.error(e);
      setStatus("Fout bij laden (check console)", "bad");
    }
  }

  // Events
  elBtn.addEventListener("click", (e) => {
    e.preventDefault();
    runSearch();
  });

  elInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  // Kleine default (optioneel)
  // elInput.value = "DVK12345";
})();
