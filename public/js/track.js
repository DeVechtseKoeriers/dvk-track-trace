/* public/js/track.js
   Track & Trace (klant)
   Vereist: public/js/supabase-config.js (maakt window.supabaseClient)
   Leest: public.shipments + public.shipment_events
   Toont: colli_count + weight_kg indien gevuld
*/

(() => {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("[DVK][track] supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");
  const timelineEl = document.getElementById("timeline");

  const state = {
    currentShipment: null,
    channel: null,
  };

  function setMsg(text, type = "ok") {
    if (!statusMsg) return;
    statusMsg.textContent = text || "";
    statusMsg.className = `msg ${type}`;
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
    if (timelineEl) timelineEl.innerHTML = "";
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
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Status/Events mapping
  const mapLabel = (code) => {
    const m = {
      created: "Aangemeld",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      cancelled: "Geannuleerd",
    };
    return m[code] || code || "";
  };
  const mapDesc = (code) => {
    const m = {
      created: "Zending aangemeld",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld",
      cancelled: "Zending geannuleerd",
    };
    return m[code] || "";
  };

  async function fetchShipmentByTrackCode(trackCode) {
    // Let op: kolommen zijn colli_count en weight_kg
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at, colli_count, weight_kg")
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
    if (!resultEl || !timelineEl) return;

    const statusNl = mapLabel(shipment.status);

    const colliLine =
      shipment.colli_count !== null && shipment.colli_count !== undefined && shipment.colli_count !== ""
        ? `<div>Colli: <strong>${escapeHtml(shipment.colli_count)}</strong></div>`
        : "";

    const kgLine =
      shipment.weight_kg !== null && shipment.weight_kg !== undefined && shipment.weight_kg !== ""
        ? `<div>Kg: <strong>${escapeHtml(shipment.weight_kg)}</strong></div>`
        : "";

    resultEl.innerHTML = `
      <div style="font-weight:700; margin-top:10px;">Zending gevonden</div>
      <div>Klant: ${escapeHtml(shipment.customer_name || "")}</div>
      <div>Trackcode: ${escapeHtml(shipment.track_code || "")}</div>
      <div>Status: <strong>${escapeHtml(statusNl)}</strong></div>
      ${colliLine}
      ${kgLine}
    `;

    if (!events.length) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    const items = events
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((ev) => {
        const title = mapLabel(ev.event_type);
        const desc = mapDesc(ev.event_type);
        const when = fmtDate(ev.created_at);

        // "Ontvangen door" alleen bij delivered en alleen als note gevuld
        const noteHtml =
          ev.event_type === "delivered" && ev.note && ev.note.trim()
            ? `<div style="margin-top:4px;">✅ Ontvangen door: <strong>${escapeHtml(ev.note)}</strong></div>`
            : "";

        return `
          <div class="timeline-item">
            <div style="font-weight:700;">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(desc)}</div>
            ${noteHtml}
            <div class="muted" style="margin-top:4px;">${escapeHtml(when)}</div>
          </div>
        `;
      })
      .join("");

    timelineEl.innerHTML = items;
  }

  function stopRealtime() {
    if (state.channel) {
      try {
        sb.removeChannel(state.channel);
      } catch (e) {}
      state.channel = null;
    }
  }

  function startRealtime(shipmentId) {
    stopRealtime();

    // luisteren naar wijzigingen in shipment_events
    state.channel = sb
      .channel(`shipment_events_${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            const freshShipment = await fetchShipmentByTrackCode(state.currentShipment.track_code);
            const events = await fetchEventsForShipment(shipmentId);
            if (freshShipment) state.currentShipment = freshShipment;
            render(state.currentShipment, events);
            setMsg("Gevonden ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error("[DVK][track] realtime refresh error:", e);
          }
        }
      )
      .subscribe();
  }

  async function runSearch() {
    try {
      const code = (trackInput?.value || "").trim();
      clearUI();

      if (!code) {
        setMsg("Vul een trackcode in.", "bad");
        return;
      }

      setMsg("Zoeken…", "muted");
      if (searchBtn) searchBtn.disabled = true;

      const shipment = await fetchShipmentByTrackCode(code);
      if (!shipment) {
        stopRealtime();
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      const events = await fetchEventsForShipment(shipment.id);

      state.currentShipment = shipment;
      render(shipment, events);

      setMsg("Gevonden ✅ (realtime actief)", "ok");
      startRealtime(shipment.id);
    } catch (e) {
      console.error("[DVK][track] runSearch error:", e);
      setMsg(`Fout bij laden: ${e.message || e}`, "bad");
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  // Bind events
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  // Boot
  setMsg("", "muted");
})();
