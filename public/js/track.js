/* public/js/track.js
   Track & Trace (klant)
   - Zoekt shipment op track_code
   - Haalt events uit shipment_events
   - Realtime updates op shipment_events
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Controleer supabase-config.js");
    return;
  }

  // UI hooks
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const result = document.getElementById("result");

  let currentSub = null;
  let currentShipmentId = null;

  function setMsg(text, kind = "") {
    statusMsg.textContent = text || "";
    statusMsg.className = "msg " + (kind || "");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function labelForEventType(t) {
    const map = {
      created: "Zending aangemeld",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld",
    };
    return map[t] || t;
  }

  function render(shipment, events) {
    // Badge = laatste event_type of shipment.status
    const lastType = (events?.[events.length - 1]?.event_type) || shipment?.status || "unknown";

    const timelineHtml = (events || [])
      .map((e) => {
        const when = e.created_at ? new Date(e.created_at).toLocaleString("nl-NL") : "";
        const note = e.note ? `<div class="muted">${esc(e.note)}</div>` : "";
        return `
          <div class="tl-row">
            <div class="pill ${esc(e.event_type)}">${esc(e.event_type)}</div>
            <div class="tl-main">
              <div class="tl-title">${esc(labelForEventType(e.event_type))}</div>
              <div class="tl-when muted">${esc(when)}</div>
              ${note}
            </div>
          </div>
        `;
      })
      .join("");

    result.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="h2">Zending gevonden</div>
            <div class="muted">Klant: ${esc(shipment.customer_name || "-")}</div>
            <div class="muted">Trackcode: ${esc(shipment.track_code || "-")}</div>
          </div>
          <div class="status-pill">${esc(lastType)}</div>
        </div>

        <div class="sep"></div>
        <div style="font-weight:700; margin-top:10px;">Timeline</div>
        <div id="timeline" class="timeline">
          ${timelineHtml || `<div class="muted">Nog geen events</div>`}
        </div>
      </div>
    `;
  }

  async function fetchShipmentByTrackCode(code) {
    // Let op: jouw kolom heet track_code (zie je screenshot)
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("track_code", code)
      .limit(1);

    if (error) throw error;
    return (data && data[0]) || null;
  }

  async function fetchEvents(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function unsubscribe() {
    if (currentSub) {
      sb.removeChannel(currentSub);
      currentSub = null;
    }
  }

  function subscribeRealtime(shipmentId, onChange) {
    unsubscribe();

    currentSub = sb
      .channel("track-events-" + shipmentId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shipment_events",
          filter: `shipment_id=eq.${shipmentId}`,
        },
        () => onChange()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setMsg("Gevonden ✅ (realtime actief)", "ok");
        }
      });
  }

  async function runSearch() {
    try {
      const code = (trackInput?.value || "").trim();
      if (!code) {
        setMsg("Vul een trackcode in.", "bad");
        return;
      }

      setMsg("Zoeken…", "");
      result.innerHTML = "";

      const shipment = await fetchShipmentByTrackCode(code);
      if (!shipment) {
        unsubscribe();
        currentShipmentId = null;
        setMsg("Niet gevonden ❌", "bad");
        return;
      }

      currentShipmentId = shipment.id;
      const events = await fetchEvents(shipment.id);
      render(shipment, events);

      subscribeRealtime(shipment.id, async () => {
        // bij elke wijziging events opnieuw ophalen en opnieuw renderen
        const freshEvents = await fetchEvents(shipment.id);
        render(shipment, freshEvents);
      });
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console)", "bad");
    }
  }

  // Events
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }
})();
