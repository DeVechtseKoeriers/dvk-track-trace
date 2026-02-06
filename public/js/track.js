/* public/js/track.js
   Track & Trace (klant)
   - zoekt shipment op track_code
   - haalt events op uit shipment_events
   - realtime via channel
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check public/js/supabase-config.js");
    return;
  }

  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");

  let currentShipment = null;
  let currentSub = null;

  function setMsg(text = "", type = "") {
    statusMsg.textContent = text;
    statusMsg.className = "msg " + (type ? `msg-${type}` : "");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleString("nl-NL");
  }

  function statusTitle(code) {
    const map = {
      created: "Aangemeld",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
    };
    return map[code] || code || "-";
  }

  function statusDesc(code) {
    const map = {
      created: "Zending aangemeld",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld",
    };
    return map[code] || "";
  }

  function stopRealtime() {
    if (currentSub) {
      sb.removeChannel(currentSub);
      currentSub = null;
    }
  }

  async function fetchShipmentByTrackCode(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, customer_phone, customer_address, package_desc, colli, weight_kg, created_at, updated_at")
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

  function render(shipment, events) {
    if (!shipment) {
      resultEl.innerHTML = "";
      return;
    }

    // laatste delivered note -> "Afgeleverd aan"
    const lastDelivered = [...events].reverse().find(e => e.event_type === "delivered" && e.note && e.note.trim());
    const receivedBy = lastDelivered ? lastDelivered.note.trim() : "";

    const header = `
      <div class="card" style="margin-top:10px;">
        <div style="font-weight:800;">Zending gevonden</div>
        <div>Klant: ${escapeHtml(shipment.customer_name || "-")}</div>
        <div>Trackcode: <code>${escapeHtml(shipment.track_code || "")}</code></div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Status</div>
          <div>${escapeHtml(statusTitle(shipment.status))}</div>
          ${receivedBy ? `<div class="muted">Afgeleverd aan: ${escapeHtml(receivedBy)}</div>` : ""}
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Pakketgegevens</div>
          <div>${shipment.package_desc ? escapeHtml(shipment.package_desc) : "<span class='muted'>-</span>"}</div>
          <div class="muted">Colli: ${shipment.colli ?? "-"} • Kg: ${shipment.weight_kg ?? "-"}</div>
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Afleverinformatie</div>
          <div>${shipment.customer_address ? escapeHtml(shipment.customer_address) : "<span class='muted'>-</span>"}</div>
          <div class="muted">${shipment.customer_phone ? `Tel: ${escapeHtml(shipment.customer_phone)}` : ""}</div>
        </div>

        <div style="margin-top:12px; font-weight:800;">Timeline</div>
        <div id="timeline"></div>
      </div>
    `;

    resultEl.innerHTML = header;

    const timelineEl = document.getElementById("timeline");
    if (!timelineEl) return;

    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    const items = events.map(ev => {
      const title = statusTitle(ev.event_type);
      const desc = statusDesc(ev.event_type);
      const when = fmtDate(ev.created_at);
      const noteLine = (ev.event_type === "delivered" && ev.note && ev.note.trim())
        ? `<div class="muted">Afgeleverd aan: ${escapeHtml(ev.note)}</div>`
        : "";

      return `
        <div class="timeline-item">
          <div style="font-weight:800;">${escapeHtml(title)}</div>
          <div>${escapeHtml(desc)}</div>
          ${noteLine}
          <div class="muted">${escapeHtml(when)}</div>
          <div class="hr"></div>
        </div>
      `;
    }).join("");

    timelineEl.innerHTML = items;
  }

  function startRealtime(shipmentId, trackCode) {
    stopRealtime();

    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            const refreshed = await fetchShipmentByTrackCode(trackCode);
            const events = await fetchEventsForShipment(shipmentId);
            currentShipment = refreshed;
            render(refreshed, events);
            setMsg("Geüpdatet ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error(e);
          }
        }
      )
      .subscribe();
  }

  async function runSearch() {
    const code = (trackInput.value || "").trim();
    if (!code) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    searchBtn.disabled = true;
    setMsg("Zoeken…", "info");

    try {
      const shipment = await fetchShipmentByTrackCode(code);
      if (!shipment) {
        stopRealtime();
        currentShipment = null;
        render(null, []);
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      const events = await fetchEventsForShipment(shipment.id);
      currentShipment = shipment;

      render(shipment, events);
      setMsg("Gevonden ✅ (realtime actief)", "ok");
      startRealtime(shipment.id, code);

    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      searchBtn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    searchBtn.addEventListener("click", runSearch);
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
    console.log("[DVK][track] klaar");
  });
})();
