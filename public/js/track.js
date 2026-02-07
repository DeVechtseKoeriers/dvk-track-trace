/* public/js/track.js
   Track & Trace (klant) - zoekt shipment op track_code
   - haalt timeline op uit shipment_events
   - realtime updates via Supabase channel

   Vereisten in HTML:
   - input#trackInput
   - button#searchBtn
   - div#statusMsg
   - div#result
   - div#timeline

   Vereisten in JS:
   - supabase-config.js zet window.sb (Supabase client)
*/

(function () {
  // ---- Guard ----
  const sb = window.sb;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // ---- DOM ----
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");
  const timelineEl = document.getElementById("timeline");

  // ---- Helpers ----
  function escapeHtml(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setMsg(text, type = "info") {
    // type: ok | bad | info
    if (!statusMsg) return;
    statusMsg.textContent = text || "";
    statusMsg.className = "msg " + (type || "info");
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
    if (timelineEl) timelineEl.innerHTML = "";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Status mapping (pas gerust aan naar jouw termen)
  function statusLabel(code) {
    const map = {
      created: "Aangemeld",
      picked_up: "Onderweg",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem gemeld",
    };
    return map[code] || code || "-";
  }

  function statusDesc(code) {
    const map = {
      created: "Zending aangemeld",
      picked_up: "Chauffeur is onderweg",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Er is een probleem gemeld",
    };
    return map[code] || "";
  }

  // ---- State ----
  let currentShipment = null;
  let currentSub = null;

  function removeChannel() {
    if (currentSub) {
      try {
        sb.removeChannel(currentSub);
      } catch (e) {
        // ignore
      }
      currentSub = null;
    }
  }

  // ---- A) Shipment ophalen op trackcode ----
  async function fetchShipmentByTrackCode(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select(
        `
        id,
        track_code,
        status,
        customer_name,
        pickup_address,
        delivery_address,
        shipment_type,
        colli_count,
        weight_kg,
        created_at,
        updated_at
      `
      )
      .eq("track_code", trackCode)
      .limit(1)
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

  // ---- B) Render shipment + meta + timeline ----
  function render(shipment, events) {
    if (!resultEl) return;

    const statusNL = statusLabel(shipment?.status);
    const klant = shipment?.customer_name ? escapeHtml(shipment.customer_name) : "-";

    const pickup = shipment?.pickup_address ? escapeHtml(shipment.pickup_address) : "-";
    const delivery = shipment?.delivery_address ? escapeHtml(shipment.delivery_address) : "-";
    const type = shipment?.shipment_type ? escapeHtml(shipment.shipment_type) : "-";

    const colli =
      shipment?.colli_count !== null && shipment?.colli_count !== undefined
        ? escapeHtml(shipment.colli_count)
        : "-";

    const weight =
      shipment?.weight_kg !== null && shipment?.weight_kg !== undefined
        ? escapeHtml(shipment.weight_kg)
        : "-";

    const headerHtml = `
      <div style="font-weight:700; margin-bottom:6px;">Zending gevonden</div>
      <div><b>Klant:</b> ${klant}</div>
      <div><b>Trackcode:</b> ${escapeHtml(shipment?.track_code || "")}</div>
      <div><b>Status:</b> ${escapeHtml(statusNL || "-")}</div>
      <div style="margin-top:10px;"></div>
      <div><b>Ophaaladres:</b> ${pickup}</div>
      <div><b>Bezorgadres:</b> ${delivery}</div>
      <div><b>Type zending:</b> ${type}</div>
      <div><b>Colli:</b> ${colli}</div>
      <div><b>Kg:</b> ${weight}</div>
      <div style="margin-top:10px; font-weight:700;">Timeline</div>
    `;

    resultEl.innerHTML = headerHtml;

    // Timeline
    if (!timelineEl) return;

    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted" style="margin-top:8px;">Geen events gevonden.</div>`;
      return;
    }

    // sort (veilig)
    const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const itemsHtml = sorted
      .map((ev) => {
        const title = statusLabel(ev.event_type);
        const desc = statusDesc(ev.event_type);
        const when = fmtDate(ev.created_at);

        const note =
          ev.note && String(ev.note).trim().length > 0
            ? `<div class="muted" style="margin-top:4px;">${escapeHtml(ev.note)}</div>`
            : "";

        return `
          <div class="card2" style="padding:12px; margin-top:10px;">
            <div style="font-weight:700;">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(desc)}</div>
            ${note}
            <div class="muted" style="margin-top:6px;">${escapeHtml(when)}</div>
          </div>
        `;
      })
      .join("");

    timelineEl.innerHTML = itemsHtml;
  }

  // ---- Realtime ----
  async function startRealtime(shipmentId) {
    removeChannel();

    currentSub = sb.channel(`shipment_events_${shipmentId}`);

    currentSub
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            // events opnieuw ophalen
            const events = await fetchEventsForShipment(shipmentId);

            // shipment opnieuw ophalen (status kan veranderd zijn)
            const refreshed = await fetchShipmentByTrackCode(currentShipment.track_code);

            if (refreshed) currentShipment = refreshed;
            render(currentShipment, events);
            setMsg("Gevonden ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error(e);
          }
        }
      )
      .subscribe();
  }

  function stopRealtime() {
    removeChannel();
  }

  // ---- Search ----
  async function runSearch() {
    const trackCode = (trackInput?.value || "").trim();
    clearUI();

    if (!trackCode) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    try {
      searchBtn && (searchBtn.disabled = true);
      setMsg("Zoeken…", "info");

      // shipment
      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        stopRealtime();
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      currentShipment = shipment;

      // events
      const events = await fetchEventsForShipment(shipment.id);

      render(shipment, events);
      setMsg("Gevonden ✅ (realtime actief)", "ok");

      // realtime
      startRealtime(shipment.id);
    } catch (e) {
      console.error(e);
      stopRealtime();
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      searchBtn && (searchBtn.disabled = false);
    }
  }

  // ---- Bindings ----
  function bind() {
    if (!trackInput || !searchBtn) return;

    searchBtn.addEventListener("click", runSearch);
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    // debug
    console.log("[DVK][track] bind OK");
  }

  // ---- Boot ----
  bind();
})();
