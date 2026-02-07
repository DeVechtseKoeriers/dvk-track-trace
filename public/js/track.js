/* public/js/track.js
   Track & Trace (klant): zoekt shipment op track_code + laadt timeline uit shipment_events
   Werkt met anon select policies op shipments + shipment_events.
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");
  const timelineEl = document.getElementById("timeline");

  const STATUS_LABEL = {
    created: "Aangemeld",
    pickup: "Opgehaald",
    in_transit: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem gemeld",
  };

  const EVENT_LABEL = {
    created: { title: "Aangemeld", desc: "Zending aangemeld" },
    pickup: { title: "Opgehaald", desc: "Zending opgehaald" },
    in_transit: { title: "Onderweg", desc: "Zending onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    problem: { title: "Probleem", desc: "Probleem gemeld" },
    note: { title: "Update", desc: "Statusupdate" },
  };

  let currentShipment = null;
  let currentSub = null;

  function setMsg(text, type = "ok") {
    statusMsg.textContent = text || "";
    statusMsg.className = "msg " + (type ? `msg-${type}` : "");
  }

  function esc(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleString("nl-NL");
  }

  function statusNL(code) {
    return STATUS_LABEL[code] || code || "-";
  }

  function render(shipment, events) {
    const headerHtml = `
      <div style="font-weight:700; margin-top:10px;">Zending gevonden</div>
      <div>Klant: ${esc(shipment.customer_name || "-")}</div>
      <div>Trackcode: ${esc(shipment.track_code || "-")}</div>
      <div>Status: ${esc(statusNL(shipment.status))}</div>
      <br/>
      <div>Ophaaladres: ${esc(shipment.pickup_address || "-")}</div>
      <div>Bezorgadres: ${esc(shipment.delivery_address || "-")}</div>
      <div>Type zending: ${esc(shipment.shipment_type || "-")}</div>
      <div>Colli: ${esc(shipment.colli_count ?? "-")}</div>
      <div>Kg: ${esc(shipment.weight_kg ?? "-")}</div>
    `;
    resultEl.innerHTML = headerHtml;

    // Timeline
    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted" style="margin-top:8px;">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    // sort oud -> nieuw
    const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const itemsHtml = sorted
      .map((ev) => {
        const meta = EVENT_LABEL[ev.event_type] || EVENT_LABEL.note;
        const note = ev.note && ev.note.trim() ? `<div class="muted">Notitie: ${esc(ev.note)}</div>` : "";
        return `
          <div class="timeline-item">
            <div class="timeline-title">${esc(meta.title)}</div>
            <div class="muted">${esc(meta.desc)}</div>
            ${note}
            <div class="muted">${esc(fmtDate(ev.created_at))}</div>
          </div>
        `;
      })
      .join("");

    timelineEl.innerHTML = itemsHtml;
  }

  async function fetchShipmentByTrackCode(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, pickup_address, delivery_address, shipment_type, colli_count, weight_kg, created_at, updated_at")
      .eq("track_code", trackCode)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
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

  function stopRealtime() {
    try {
      if (currentSub) sb.removeChannel(currentSub);
    } catch {}
    currentSub = null;
  }

  function startRealtime(shipmentId) {
    stopRealtime();

    // Let op: realtime vereist dat je replication aan staat op shipment_events in Supabase
    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          // refresh events + shipment status (status kan ook via dashboard gewijzigd zijn)
          const refreshed = await fetchShipmentByTrackCode(currentShipment.track_code);
          const evs = await fetchEventsForShipment(shipmentId);
          currentShipment = refreshed;
          render(currentShipment, evs);
        }
      )
      .subscribe();
  }

  async function runSearch() {
    const trackCode = (trackInput.value || "").trim();
    resultEl.innerHTML = "";
    timelineEl.innerHTML = "";
    stopRealtime();

    if (!trackCode) {
      setMsg("Vul een trackcode in.", "warn");
      return;
    }

    try {
      searchBtn.disabled = true;
      setMsg("Zoeken…", "ok");

      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      const events = await fetchEventsForShipment(shipment.id);

      currentShipment = shipment;
      render(shipment, events);
      setMsg("Gevonden ✅ (realtime actief)", "ok");
      startRealtime(shipment.id);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      searchBtn.disabled = false;
    }
  }

  // Bind
  searchBtn.addEventListener("click", runSearch);
  trackInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
})();
