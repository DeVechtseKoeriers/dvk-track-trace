/* public/js/track.js
   DVK Track & Trace – Stap A: status komt uit LAATSTE event (shipment_events)
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js include/pad.");
    return;
  }

  // --- UI hooks (moeten bestaan in track/index.html) ---
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const result = document.getElementById("result");

  // Realtime subscription refs (zodat we netjes kunnen vervangen)
  let eventsChannel = null;

  // --- Helpers ---
  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setMsg(text, kind = "") {
    if (!statusMsg) return;
    statusMsg.textContent = text || "";
    statusMsg.className = "msg" + (kind ? ` ${kind}` : "");
  }

  function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    // NL stijl, zonder gedoe met locale issues
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Event → nette tekst + “status”
  function eventLabel(eventType) {
    const t = String(eventType || "").toLowerCase();
    if (t === "created") return "Zending aangemeld";
    if (t === "en_route") return "Chauffeur is onderweg";
    if (t === "delivered") return "Zending afgeleverd";
    if (t === "problem") return "Probleem gemeld";
    return eventType || "-";
  }

  // ✅ Stap A: LAATSTE event bepaalt status (voor klantweergave)
  function displayStatusFromLatestEvent(latestEventType, fallbackShipmentStatus) {
    const t = String(latestEventType || "").toLowerCase();

    if (t === "delivered") return "Afgeleverd";
    if (t === "en_route") return "Onderweg";
    if (t === "created") return "Aangemeld";
    if (t === "problem") return "Probleem";

    // fallback: shipments.status (als er nog geen events zijn)
    const s = String(fallbackShipmentStatus || "").toLowerCase();
    if (s === "delivered") return "Afgeleverd";
    if (s === "en_route") return "Onderweg";
    if (s === "created") return "Aangemeld";
    if (s === "problem") return "Probleem";
    return fallbackShipmentStatus || "-";
  }

  // Bouw timeline HTML (simpel, stap B maken we mooier)
  function renderTimeline(events) {
    if (!events || events.length === 0) {
      return `<div class="muted">Geen events gevonden.</div>`;
    }

    // events: oud -> nieuw
    return events
      .map((e) => {
        const left = `<div><strong>${esc(e.event_type)}</strong><br>${esc(eventLabel(e.event_type))}</div>`;
        const right = `<div style="text-align:right">${esc(formatDate(e.created_at))}</div>`;
        return `<div class="row" style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)">${left}${right}</div>`;
      })
      .join("");
  }

  function detachRealtime() {
    try {
      if (eventsChannel) sb.removeChannel(eventsChannel);
    } catch (e) {}
    eventsChannel = null;
  }

  async function fetchShipmentByTrackCode(trackCode) {
    // Let op: jouw kolom heet track_code (dat zagen we in Supabase screenshot)
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("track_code", trackCode)
      .maybeSingle();

    if (error) throw error;
    return data; // kan null zijn
  }

  async function fetchEventsByShipmentId(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function renderShipmentCard({ shipment, events }) {
    const latest = (events && events.length) ? events[events.length - 1] : null;

    const displayStatus = displayStatusFromLatestEvent(
      latest?.event_type,
      shipment?.status
    );

    const header = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:800;font-size:18px">Zending gevonden</div>
          <div class="muted">Klant: ${esc(shipment.customer_name || "Onbekend")}</div>
          <div class="muted">Trackcode: ${esc(shipment.track_code || "")}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:800">${esc(displayStatus)}</div>
          <div class="muted">${esc(shipment.status || "")}</div>
        </div>
      </div>
    `;

    const timeline = `
      <div style="margin-top:12px;font-weight:800">Timeline</div>
      <div id="timeline" class="timeline" style="margin-top:6px">
        ${renderTimeline(events)}
      </div>
    `;

    result.innerHTML = `
      <div class="card" style="padding:16px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(15,26,44,.35)">
        ${header}
        ${timeline}
      </div>
    `;
  }

  async function enableRealtimeForShipment(shipmentId, trackCode) {
    detachRealtime();

    // ✅ luister op shipment_events voor dit shipment
    eventsChannel = sb
      .channel(`track-events-${shipmentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shipment_events",
          filter: `shipment_id=eq.${shipmentId}`,
        },
        async () => {
          // bij event update/insert: opnieuw events ophalen en UI updaten (status komt automatisch mee via Stap A)
          try {
            const shipment = await fetchShipmentByTrackCode(trackCode);
            const events = await fetchEventsByShipmentId(shipmentId);
            setMsg("Gevonden ✅ (realtime actief)", "ok");
            renderShipmentCard({ shipment, events });
          } catch (e) {
            console.error(e);
          }
        }
      )
      .subscribe();
  }

  async function runSearch() {
    const code = (trackInput?.value || "").trim();
    if (!code) {
      setMsg("Vul een trackcode in.", "warn");
      return;
    }

    setMsg("Zoeken…", "warn");
    result.innerHTML = "";

    try {
      const shipment = await fetchShipmentByTrackCode(code);

      if (!shipment) {
        detachRealtime();
        setMsg("Niet gevonden ❌", "bad");
        result.innerHTML = "";
        return;
      }

      const events = await fetchEventsByShipmentId(shipment.id);

      // ✅ Stap A: status komt uit laatste event (in renderShipmentCard)
      setMsg("Gevonden ✅ (realtime actief)", "ok");
      renderShipmentCard({ shipment, events });

      await enableRealtimeForShipment(shipment.id, code);
    } catch (err) {
      detachRealtime();
      console.error("Track error:", err);
      setMsg("Fout bij laden (check console)", "bad");
    }
  }

  // --- Events ---
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  // auto-run als er al een waarde in input staat (handig bij testen)
  if (trackInput && trackInput.value && trackInput.value.trim()) {
    runSearch();
  }
})();
