/* public/js/track.js
   Track & Trace (klant)
   - zoekt shipment op track_code
   - toont details + timeline
   - realtime updates via shipment_events & shipment status
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // Elements (moeten bestaan in track/index.html)
  let trackInput, searchBtn, statusMsg, resultEl, timelineEl;

  // Realtime state
  let currentShipment = null;
  let currentSub = null;

  // Status mapping NL
  const STATUS_NL = {
    created:   "Aangemeld",
    pickup:    "Opgehaald",
    en_route:  "Onderweg",
    delivered: "Afgeleverd",
    problem:   "Probleem gemeld",
  };

  // Event mapping NL (shipment_events.event_type)
  const EVENT_NL = {
    created:   { title: "Aangemeld",     desc: "Zending aangemeld" },
    pickup:    { title: "Opgehaald",     desc: "Zending opgehaald" },
    en_route:  { title: "Onderweg",      desc: "Chauffeur is onderweg" },
    delivered: { title: "Afgeleverd",    desc: "Zending afgeleverd" },
    problem:   { title: "Probleem",      desc: "Probleem gemeld" },
    note:      { title: "Update",        desc: "Statusupdate" },
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function setMsg(text, type = "ok") {
    if (!statusMsg) return;
    statusMsg.style.display = "block";
    statusMsg.className = `msg ${type === "bad" ? "bad" : "ok"}`;
    statusMsg.textContent = text;
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
    if (timelineEl) timelineEl.innerHTML = "";
    if (statusMsg) {
      statusMsg.style.display = "none";
      statusMsg.textContent = "";
    }
  }

  function statusLabel(code) {
    if (!code) return "-";
    return STATUS_NL[code] || code;
  }

  function eventLabel(type) {
    return EVENT_NL[type]?.title || type || "Update";
  }

  function eventDesc(type) {
    return EVENT_NL[type]?.desc || "";
  }

  function stopRealtime() {
    try {
      if (currentSub && window.sb) {
        window.sb.removeChannel(currentSub);
      }
    } catch (_) {}
    currentSub = null;
  }

  async function fetchShipmentByTrackCode(trackCode) {
    const sb = window.sb;
    if (!sb) throw new Error("supabaseClient ontbreekt. Check supabase-config.js");

    // ✅ Let op: kolomnamen die jij gebruikt (colli_count, weight_kg, pickup_address, delivery_address, shipment_type)
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, pickup_address, delivery_address, shipment_type, colli_count, weight_kg, created_at, updated_at")
      .eq("track_code", trackCode)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }

  async function fetchEventsForShipment(shipmentId) {
    const sb = window.sb;
    if (!sb) throw new Error("supabaseClient ontbreekt. Check supabase-config.js");

    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function render(shipment, events) {
    if (!resultEl) return;

    const klant = shipment?.customer_name || "-";
    const track = shipment?.track_code || "-";
    const st = statusLabel(shipment?.status);

    const pickup = shipment?.pickup_address || "-";
    const delivery = shipment?.delivery_address || "-";
    const type = shipment?.shipment_type || "-";
    const colli = (shipment?.colli_count ?? shipment?.colli_count === 0) ? String(shipment.colli_count) : "-";
    const kg = (shipment?.weight_kg ?? shipment?.weight_kg === 0) ? String(shipment.weight_kg) : "-";

    resultEl.innerHTML = `
      <div style="font-weight:900; font-size:18px; margin-bottom:6px;">Zending gevonden</div>
      <div><b>Klant:</b> ${escapeHtml(klant)}</div>
      <div><b>Trackcode:</b> ${escapeHtml(track)}</div>
      <div style="margin-top:8px;"><b>Status:</b> ${escapeHtml(st)}</div>

      <div style="margin-top:10px;">
        <div><b>Ophaaladres:</b> ${escapeHtml(pickup)}</div>
        <div><b>Bezorgadres:</b> ${escapeHtml(delivery)}</div>
        <div><b>Type zending:</b> ${escapeHtml(type)}</div>
        <div><b>Colli:</b> ${escapeHtml(colli)}</div>
        <div><b>Kg:</b> ${escapeHtml(kg)}</div>
      </div>
    `;

    // Timeline
    if (!timelineEl) return;

    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="titem"><div class="d">Nog geen statusupdates beschikbaar.</div></div>`;
      return;
    }

    const items = events.map((ev) => {
      const title = eventLabel(ev.event_type);
      const desc = eventDesc(ev.event_type);
      const when = fmtDate(ev.created_at);
      const note = (ev.event_type === "delivered" && ev.note && ev.note.trim())
        ? `<div class="d"><b>Ontvangen door:</b> ${escapeHtml(ev.note)}</div>`
        : (ev.note && ev.note.trim())
          ? `<div class="d">${escapeHtml(ev.note)}</div>`
          : "";

      return `
        <div class="titem">
          <div class="t">${escapeHtml(title)}</div>
          ${desc ? `<div class="d">${escapeHtml(desc)}</div>` : ""}
          ${note}
          <div class="w">${escapeHtml(when)}</div>
        </div>
      `;
    }).join("");

    timelineEl.innerHTML = items;
  }

  function startRealtime(shipmentId, trackCode) {
    const sb = window.sb;
    if (!sb) return;

    stopRealtime();

    // Realtime: luister naar events + shipment status updates
    const ch = sb.channel(`shipment_${shipmentId}`);

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
      async () => {
        try {
          const events = await fetchEventsForShipment(shipmentId);
          render(currentShipment, events);
        } catch (e) {
          console.error("[DVK][track] realtime events error:", e);
        }
      }
    );

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments", filter: `track_code=eq.${trackCode}` },
      async () => {
        try {
          const refreshed = await fetchShipmentByTrackCode(trackCode);
          if (refreshed) currentShipment = refreshed;
          const events = await fetchEventsForShipment(shipmentId);
          render(currentShipment, events);
        } catch (e) {
          console.error("[DVK][track] realtime shipment error:", e);
        }
      }
    );

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setMsg("Gevonden ✅ (realtime actief)", "ok");
      }
    });

    currentSub = ch;
  }

  async function runSearch() {
    try {
      const trackCode = (trackInput?.value || "").trim();
      clearUI();

      if (!trackCode) {
        setMsg("Vul een trackcode in.", "bad");
        return;
      }

      if (searchBtn) searchBtn.disabled = true;
      setMsg("Zoeken…", "ok");

      const shipment = await fetchShipmentByTrackCode(trackCode);

      if (!shipment) {
        stopRealtime();
        currentShipment = null;
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      currentShipment = shipment;

      const events = await fetchEventsForShipment(shipment.id);
      render(shipment, events);

      // realtime starten
      startRealtime(shipment.id, trackCode);

    } catch (e) {
      console.error("[DVK][track] error:", e);
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  function bindUI() {
    trackInput = $("trackInput");
    searchBtn = $("searchBtn");
    statusMsg = $("statusMsg");
    resultEl = $("result");
    timelineEl = $("timeline");

    // Als HTML per ongeluk niet klopt -> log en voorkom crash
    if (!trackInput || !searchBtn || !statusMsg || !resultEl || !timelineEl) {
      console.error("[DVK][track] HTML mist één of meer elementen:", {
        trackInput: !!trackInput,
        searchBtn: !!searchBtn,
        statusMsg: !!statusMsg,
        result: !!resultEl,
        timeline: !!timelineEl,
      });
      // We stoppen niet hard, maar zonder deze elementen kan het niet werken
      return;
    }

    searchBtn.addEventListener("click", runSearch);
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    console.log("[DVK][track] bind OK");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!window.sb) {
      console.error("[DVK][track] supabaseClient ontbreekt. Check supabase-config.js");
    }
    bindUI();
  });

})();
