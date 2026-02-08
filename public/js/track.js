/* public/js/track.js
 * DVK Track & Trace (klant)
 * - NL status vertalingen
 * - Realtime updates (shipments + shipment_events) per trackcode
 * - Fallback polling
 * - Nettere layout / spacing
 */

(function () {
  // ===== Helpers =====
  const $ = (id) => document.getElementById(id);

  const trackInput = $("trackInput");
  const searchBtn = $("searchBtn");
  const statusMsg = $("statusMsg");
  const resultEl = $("result");
  const timelineEl = $("timeline");

  // DOM safety
  function ensureDom() {
    if (!trackInput || !searchBtn || !statusMsg || !resultEl || !timelineEl) {
      console.error("[DVK] track.js mist DOM elementen. Check track/index.html ids.");
      return false;
    }
    return true;
  }

  // Supabase client (uit supabase-config.js)
  function getClient() {
    // verwacht: window.supabaseClient
    if (!window.supabaseClient) {
      console.error("[DVK] supabaseClient ontbreekt. Check supabase-config.js");
      showMsg("Fout: Track & Trace kan niet laden (config).", "bad");
      return null;
    }
    return window.supabaseClient;
  }

  function showMsg(text, type = "ok") {
    statusMsg.style.display = "block";
    statusMsg.textContent = text;
    statusMsg.className = "msg " + (type === "bad" ? "bad" : type === "warn" ? "warn" : "ok");
  }

  function hideMsg() {
    statusMsg.style.display = "none";
    statusMsg.textContent = "";
  }

  function cleanTrackcode(v) {
    return (v || "").trim().toUpperCase();
  }

  function fmtDateTime(dt) {
    try {
      const d = new Date(dt);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return dt || "";
    }
  }

  // ===== NL vertalingen =====
  const shipmentStatusNL = {
    created: "Aangemeld",
    registered: "Aangemeld",
    pickup: "Ophaal gepland",
    picked_up: "Opgehaald",
    in_transit: "Onderweg",
    out_for_delivery: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
    failed: "Probleem",
    cancelled: "Geannuleerd",
    archived: "Afgehandeld",
  };

  const eventTypeNL = {
    created: "Aangemeld",
    pickup: "Ophaal gepland",
    picked_up: "Opgehaald",     // ✅ fix: picked_up -> Opgehaald
    in_transit: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
    note: "Notitie",
  };

  function nlStatus(s) {
    const key = (s || "").toString().trim().toLowerCase();
    return shipmentStatusNL[key] || (s || "-");
  }

  function nlEvent(t) {
    const key = (t || "").toString().trim().toLowerCase();
    return eventTypeNL[key] || (t || "-");
  }

  // ===== Realtime / poll control =====
  let currentTrack = null;
  let rtChannel = null;
  let pollTimer = null;

  function stopRealtimeAndPoll(client) {
    try {
      if (rtChannel && client) client.removeChannel(rtChannel);
    } catch {}
    rtChannel = null;

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function loadShipmentAndTimeline(client, trackcode) {
    // 1) shipment
    const { data: shipment, error: sErr } = await client
      .from("shipments")
      .select("id, track_code, customer_name, status, pickup_address, dropoff_address, shipment_type, colli_count, weight_kg, updated_at")
      .eq("track_code", trackcode)
      .maybeSingle();

    if (sErr) throw sErr;
    if (!shipment) return { shipment: null, events: [] };

    // 2) events
    const { data: events, error: eErr } = await client
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, receiver_name, created_at")
      .eq("shipment_id", shipment.id)
      .order("created_at", { ascending: true });

    if (eErr) throw eErr;

    return { shipment, events: events || [] };
  }

  function renderShipment(shipment) {
    if (!shipment) {
      resultEl.innerHTML = "";
      timelineEl.innerHTML = "";
      showMsg("Geen zending gevonden.", "warn");
      return;
    }

    hideMsg();

    const pickup = shipment.pickup_address || "-";
    const dropoff = shipment.dropoff_address || "-";
    const type = shipment.shipment_type || "-";
    const colli = (shipment.colli_count ?? "-");
    const kg = (shipment.weight_kg ?? "-");

    // ✅ spacing + ophaal/bezorg onder elkaar
    resultEl.innerHTML = `
      <div style="margin-top:8px;">
        <div style="font-weight:800; font-size:18px; margin-bottom:10px;">Zending gevonden</div>

        <div style="line-height:1.55;">
          <div><b>Klant:</b> ${escapeHtml(shipment.customer_name || "-")}</div>
          <div><b>Trackcode:</b> ${escapeHtml(shipment.track_code || "-")}</div>
          <div><b>Status:</b> ${escapeHtml(nlStatus(shipment.status))}</div>

          <div style="height:10px;"></div>

          <div><b>Ophaaladres:</b> ${escapeHtml(pickup)}</div>
          <div><b>Bezorgadres:</b> ${escapeHtml(dropoff)}</div>
          <div><b>Type zending:</b> ${escapeHtml(type)}</div>
          <div><b>Colli:</b> ${escapeHtml(String(colli))}</div>
          <div><b>Kg:</b> ${escapeHtml(String(kg))}</div>
        </div>
      </div>
    `;
  }

  function renderTimeline(events) {
    // ✅ voorkom dubbele "Timeline" (HTML heeft header al)
    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    const items = events.map((ev) => {
      const title = nlEvent(ev.event_type);
      const when = fmtDateTime(ev.created_at);

      // Alleen "Ontvangen door" tonen als er echt een receiver_name is
      const receiverLine = ev.receiver_name
        ? `<div class="muted" style="margin-top:2px;">Ontvangen door: ${escapeHtml(ev.receiver_name)}</div>`
        : "";

      const noteLine = ev.note
        ? `<div class="muted" style="margin-top:2px;">Notitie: ${escapeHtml(ev.note)}</div>`
        : "";

      return `
        <div class="card" style="padding:12px; margin-top:10px;">
          <div style="font-weight:800;">${escapeHtml(title)}</div>
          <div class="muted">${escapeHtml(when)}</div>
          ${receiverLine}
          ${noteLine}
        </div>
      `;
    }).join("");

    timelineEl.innerHTML = items;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function runSearch(trackcode) {
    if (!ensureDom()) return;
    const client = getClient();
    if (!client) return;

    const tc = cleanTrackcode(trackcode || trackInput.value);
    if (!tc) {
      showMsg("Vul een trackcode in.", "warn");
      return;
    }

    // Reset UI
    resultEl.innerHTML = "";
    timelineEl.innerHTML = "";
    showMsg("Zoeken…", "ok");

    // stop previous realtime/poll
    stopRealtimeAndPoll(client);
    currentTrack = tc;

    try {
      const { shipment, events } = await loadShipmentAndTimeline(client, tc);

      if (!shipment) {
        renderShipment(null);
        stopRealtimeAndPoll(client);
        return;
      }

      showMsg("Gevonden ✅ (realtime actief)", "ok");
      renderShipment(shipment);
      renderTimeline(events);

      // Start realtime for this shipment
      startRealtime(client, shipment.id);

      // Fallback poll (Safari kan websockets soms ‘parkeren’)
      pollTimer = setInterval(async () => {
        if (!currentTrack) return;
        try {
          const r = await loadShipmentAndTimeline(client, currentTrack);
          if (!r.shipment) return;
          renderShipment(r.shipment);
          renderTimeline(r.events);
        } catch (e) {
          // stil blijven; realtime kan het alsnog doen
        }
      }, 15000);

    } catch (e) {
      console.error("[DVK] Search error:", e);
      showMsg("Fout bij laden. Probeer opnieuw.", "bad");
    }
  }

  function startRealtime(client, shipmentId) {
    // luister op beide tabellen; refresh data bij elke wijziging
    rtChannel = client.channel(`tt-${shipmentId}`);

    rtChannel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` },
        async () => {
          if (!currentTrack) return;
          const r = await loadShipmentAndTimeline(client, currentTrack);
          if (r.shipment) {
            renderShipment(r.shipment);
            renderTimeline(r.events);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          if (!currentTrack) return;
          const r = await loadShipmentAndTimeline(client, currentTrack);
          if (r.shipment) {
            renderShipment(r.shipment);
            renderTimeline(r.events);
          }
        }
      );

    rtChannel.subscribe((status) => {
      // status kan zijn: SUBSCRIBED / TIMED_OUT / CLOSED / CHANNEL_ERROR
      // We laten de UI “realtime actief” staan; fallback poll vangt uitval op.
      console.log("[DVK] realtime status:", status);
    });
  }

  // ===== Events =====
  function bindEvents() {
    searchBtn.addEventListener("click", () => runSearch());

    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    // handig: bij refresh met ?track=DVK-...
    const url = new URL(window.location.href);
    const preset = url.searchParams.get("track");
    if (preset) {
      trackInput.value = preset;
      runSearch(preset);
    }
  }

  // init
  if (ensureDom()) bindEvents();
})();
