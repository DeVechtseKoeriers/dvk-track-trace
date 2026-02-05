/* public/js/track.js
   Klant Track & Trace:
   - zoekt shipment op track_code
   - laadt events uit shipment_events
   - realtime updates via Supabase channel
   - toont alleen NL labels (geen created/en_route/delivered codes)
   - toont "Ontvangen door: <naam>" alleen als delivered + note gevuld
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

  function setMsg(text, type = "") {
    if (!statusMsg) return;
    statusMsg.textContent = text || "";
    statusMsg.className = "msg " + (type || "");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Alleen NL labels
  const label = {
    created: { title: "Aangemeld", desc: "Zending aangemeld" },
    en_route: { title: "Onderweg", desc: "Chauffeur is onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    problem: { title: "Probleem", desc: "Probleem gemeld" },
  };

  function nlTitle(code) {
    return label[code]?.title || "Status";
  }
  function nlDesc(code) {
    return label[code]?.desc || "";
  }

  // Realtime state
  let activeShipmentId = null;
  let channel = null;

  async function fetchShipmentByTrackCode(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("track_code", trackCode)
      .maybeSingle();

    if (error) throw error;
    return data || null;
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

  function renderShipmentCard(shipment) {
    if (!resultEl) return;
    if (!shipment) {
      resultEl.innerHTML = "";
      return;
    }

    const statusTitle = nlTitle(shipment.status);

    resultEl.innerHTML = `
      <div class="card">
        <div class="h2">Zending gevonden</div>
        <div><b>Klant:</b> ${escapeHtml(shipment.customer_name || "-")}</div>
        <div><b>Trackcode:</b> ${escapeHtml(shipment.track_code || "-")}</div>

        <div class="sep"></div>

        <div><b>Status</b></div>
        <div class="status-pill">${escapeHtml(statusTitle)}</div>
      </div>
    `;
  }

  function renderTimeline(events) {
    if (!timelineEl) return;

    if (!events.length) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    timelineEl.innerHTML = events
      .map((e) => {
        const t = nlTitle(e.event_type);
        const d = nlDesc(e.event_type);

        // ✅ Ontvangen door alleen bij delivered + note
        let extra = "";
        if (e.event_type === "delivered" && e.note && e.note.trim()) {
          extra = `<div class="muted">Ontvangen door: ${escapeHtml(e.note.trim())}</div>`;
        }

        const time = new Date(e.created_at).toLocaleString("nl-NL");

        return `
          <div class="tl-item">
            <div class="tl-title">${escapeHtml(t)}</div>
            <div class="tl-desc">${escapeHtml(d)}</div>
            ${extra}
            <div class="tl-time">${escapeHtml(time)}</div>
          </div>
        `;
      })
      .join("");
  }

  async function runSearch() {
    try {
      const code = (trackInput?.value || "").trim();
      if (!code) {
        setMsg("Vul een trackcode in.", "bad");
        return;
      }

      setMsg("Zoeken…", "");
      const shipment = await fetchShipmentByTrackCode(code);

      if (!shipment) {
        activeShipmentId = null;
        renderShipmentCard(null);
        if (timelineEl) timelineEl.innerHTML = "";
        setMsg("Niet gevonden.", "bad");
        await resetRealtime();
        return;
      }

      activeShipmentId = shipment.id;

      renderShipmentCard(shipment);

      const events = await fetchEvents(shipment.id);
      renderTimeline(events);

      setMsg("Gevonden ✅ (realtime actief)", "ok");

      await startRealtime(shipment.id);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console)", "bad");
    }
  }

  async function resetRealtime() {
    if (channel) {
      try {
        await sb.removeChannel(channel);
      } catch (_) {}
      channel = null;
    }
  }

  async function startRealtime(shipmentId) {
    await resetRealtime();

    // Alleen events voor deze shipment
    channel = sb
      .channel("shipment_events_" + shipmentId)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "shipment_events",
          filter: `shipment_id=eq.${shipmentId}`,
        },
        async () => {
          // refresh events + shipment status
          try {
            const events = await fetchEvents(shipmentId);
            renderTimeline(events);

            // status opnieuw ophalen
            const { data } = await sb
              .from("shipments")
              .select("id, track_code, status, customer_name, created_at")
              .eq("id", shipmentId)
              .maybeSingle();

            if (data) renderShipmentCard(data);
          } catch (e) {
            console.error(e);
          }
        }
      )
      .subscribe();
  }

  // Events
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }
})();
