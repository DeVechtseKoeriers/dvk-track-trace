/* public/js/track.js
   Track & Trace (klant) - zoekt shipment op track_code
   - toont zending + timeline
   - realtime via Supabase channel
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

  let currentShipment = null;
  let currentSub = null;

  const escapeHtml = (str) =>
    String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function setMsg(text, type = "ok") {
    statusMsg.style.display = "block";
    statusMsg.textContent = text;
    statusMsg.className = "msg " + (type === "bad" ? "bad" : type === "warn" ? "warn" : "ok");
  }

  function clearUI() {
    resultEl.innerHTML = "";
    statusMsg.style.display = "none";
    statusMsg.textContent = "";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Pas deze mapping gerust aan op jouw statuses
  const statusMap = {
    aangemeld: { title: "Aangemeld", desc: "Zending aangemeld" },
    zending_aangemeld: { title: "Aangemeld", desc: "Zending aangemeld" },
    onderweg: { title: "Onderweg", desc: "Chauffeur is onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    afgeleverd: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    probleem: { title: "Probleem", desc: "Probleem gemeld" },
  };

  function statusLabel(code) {
    if (!code) return "Onbekend";
    const key = String(code).toLowerCase();
    return statusMap[key]?.title || code;
  }

  function statusDesc(eventType) {
    if (!eventType) return "";
    const key = String(eventType).toLowerCase();
    return statusMap[key]?.desc || "";
  }

  function render(shipment, events) {
    // Altijd shipment tonen, ook bij 0 events
    const cust = shipment?.customer_name ? escapeHtml(shipment.customer_name) : "-";
    const track = shipment?.track_code ? escapeHtml(shipment.track_code) : "-";
    const st = statusLabel(shipment?.status);

    // Optioneel: colli/gewicht tonen als kolommen bestaan
    const colli = shipment?.colli_count ?? shipment?.colli ?? null;      // fallback als je ooit "colli" gebruikte
    const weight = shipment?.weight_kg ?? shipment?.kg ?? null;          // fallback als je ooit "kg" gebruikte

    const metaRows = [];
    if (colli !== null && colli !== undefined && colli !== "") metaRows.push(`<div><b>Colli:</b> ${escapeHtml(colli)}</div>`);
    if (weight !== null && weight !== undefined && weight !== "") metaRows.push(`<div><b>Kg:</b> ${escapeHtml(weight)}</div>`);

    const headerHtml = `
      <div class="result-card">
        <div class="result-title">Zending gevonden</div>
        <div><b>Klant:</b> ${cust}</div>
        <div><b>Trackcode:</b> ${track}</div>
        <div style="margin-top:8px;"><b>Status</b><br>${escapeHtml(st)}</div>
        ${metaRows.length ? `<div style="margin-top:8px;">${metaRows.join("")}</div>` : ""}
        <div style="margin-top:14px; font-weight:700;">Timeline</div>
        <div id="timeline" class="timeline" style="margin-top:8px;"></div>
      </div>
    `;

    resultEl.innerHTML = headerHtml;

    const timelineEl = document.getElementById("timeline");
    const safeEvents = Array.isArray(events) ? events : [];

    if (safeEvents.length === 0) {
      timelineEl.innerHTML = `<div class="muted">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    // oud -> nieuw
    const sorted = [...safeEvents].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const itemsHtml = sorted
      .map((ev) => {
        const title = statusLabel(ev.event_type);
        const desc = statusDesc(ev.event_type);
        const when = fmtDate(ev.created_at);

        // Alleen “Ontvangen door” bij delivered + note gevuld
        const noteHtml =
          String(ev.event_type).toLowerCase() === "delivered" && ev.note && String(ev.note).trim()
            ? `<div class="muted" style="margin-top:6px;">✅ Ontvangen door: ${escapeHtml(ev.note)}</div>`
            : "";

        return `
          <div class="timeline-item">
            <div class="timeline-title">${escapeHtml(title)}</div>
            ${desc ? `<div class="muted">${escapeHtml(desc)}</div>` : ""}
            ${noteHtml}
            <div class="muted" style="margin-top:6px;">${escapeHtml(when)}</div>
          </div>
        `;
      })
      .join("");

    timelineEl.innerHTML = itemsHtml;
  }

  async function fetchShipmentByTrackCode(trackCode) {
    // Belangrijk: select ook colli_count/weight_kg
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, colli_count, weight_kg, created_at, updated_at")
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

  function stopRealtime() {
    if (currentSub) {
      sb.removeChannel(currentSub);
      currentSub = null;
    }
  }

  function startRealtime(shipmentId) {
    stopRealtime();

    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            const refreshed = await fetchShipmentByTrackCode(currentShipment.track_code);
            const evs = await fetchEventsForShipment(shipmentId);
            currentShipment = refreshed || currentShipment;
            render(currentShipment, evs);
          } catch (e) {
            console.error("Realtime refresh error:", e);
          }
        }
      )
      .subscribe();
  }

  async function runSearch() {
    const trackCode = (trackInput.value || "").trim();
    if (!trackCode) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    searchBtn.disabled = true;
    clearUI();
    setMsg("Zoeken…", "warn");

    try {
      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        stopRealtime();
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      currentShipment = shipment;

      const events = await fetchEventsForShipment(shipment.id);

      render(shipment, events);
      setMsg("Gevonden ✅ (realtime actief)", "ok");
      startRealtime(shipment.id);
    } catch (e) {
      console.error("Track search error:", e);
      stopRealtime();
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn?.addEventListener("click", runSearch);
  trackInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  console.log("[DVK][track] loaded");
})();
