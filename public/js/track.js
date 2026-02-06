/* public/js/track.js
   Track & Trace (klant)
   - zoekt shipment op track_code
   - haalt timeline events uit shipment_events
   - toont foutmelding op scherm (incl. echte oorzaak)
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    alert("supabaseClient ontbreekt. Check public/js/supabase-config.js");
    return;
  }

  // ====== PAS HIER EVENTUEEL JE KOLOMNAMEN AAN ======
  const COL = {
    TRACK: "track_code",
    STATUS: "status",
    CUSTOMER: "customer_name",
    COLLI: "colli",
    KG: "kg", // <- als jij 'weight_kg' hebt: zet dit op "weight_kg"
    DESC: "package_desc", // als anders: bv "omschrijving"
    ADDRESS: "customer_address",
    PHONE: "customer_phone",
    CREATED: "created_at",
    UPDATED: "updated_at",
  };
  // ===================================================

  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");

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
    return new Date(iso).toLocaleString("nl-NL");
  }

  function statusTitle(code) {
    const map = { created: "Aangemeld", en_route: "Onderweg", delivered: "Afgeleverd", problem: "Probleem" };
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
    // let op: als 1 van deze kolommen niet bestaat -> error -> die tonen we op scherm
    const selectCols = [
      "id",
      COL.TRACK,
      COL.STATUS,
      COL.CUSTOMER,
      COL.DESC,
      COL.COLLI,
      COL.KG,
      COL.ADDRESS,
      COL.PHONE,
      COL.CREATED,
      COL.UPDATED,
    ].join(",");

    const { data, error } = await sb
      .from("shipments")
      .select(selectCols)
      .eq(COL.TRACK, trackCode)
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

    const lastDelivered = [...events].reverse().find(e => e.event_type === "delivered" && e.note && e.note.trim());
    const receivedBy = lastDelivered ? lastDelivered.note.trim() : "";

    const pkgDesc = shipment[COL.DESC];
    const colliVal = shipment[COL.COLLI];
    const kgVal = shipment[COL.KG];
    const addr = shipment[COL.ADDRESS];
    const phone = shipment[COL.PHONE];

    resultEl.innerHTML = `
      <div class="card" style="margin-top:10px;">
        <div style="font-weight:800;">Zending gevonden</div>
        <div>Klant: ${escapeHtml(shipment[COL.CUSTOMER] || "-")}</div>
        <div>Trackcode: <code>${escapeHtml(shipment[COL.TRACK] || "")}</code></div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Status</div>
          <div>${escapeHtml(statusTitle(shipment[COL.STATUS]))}</div>
          ${receivedBy ? `<div class="muted">Afgeleverd aan: ${escapeHtml(receivedBy)}</div>` : ""}
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Pakketgegevens</div>
          <div>${pkgDesc ? escapeHtml(pkgDesc) : "<span class='muted'>-</span>"}</div>
          <div class="muted">Colli: ${colliVal ?? "-"} • Kg: ${kgVal ?? "-"}</div>
        </div>

        <div style="margin-top:10px;">
          <div style="font-weight:800;">Afleverinformatie</div>
          <div>${addr ? escapeHtml(addr) : "<span class='muted'>-</span>"}</div>
          <div class="muted">${phone ? `Tel: ${escapeHtml(phone)}` : ""}</div>
        </div>

        <div style="margin-top:12px; font-weight:800;">Timeline</div>
        <div id="timeline"></div>
      </div>
    `;

    const timelineEl = document.getElementById("timeline");
    if (!timelineEl) return;

    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    timelineEl.innerHTML = events.map(ev => {
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
  }

  function startRealtime(shipmentId, trackCode) {
    stopRealtime();

    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            const shipment = await fetchShipmentByTrackCode(trackCode);
            const events = await fetchEventsForShipment(shipmentId);
            render(shipment, events);
            setMsg("Geüpdatet ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error(e);
            setMsg(`Realtime fout: ${e.message || e}`, "bad");
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
    resultEl.innerHTML = "";

    try {
      const shipment = await fetchShipmentByTrackCode(code);
      if (!shipment) {
        stopRealtime();
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      const events = await fetchEventsForShipment(shipment.id);
      render(shipment, events);
      setMsg("Gevonden ✅ (realtime actief)", "ok");
      startRealtime(shipment.id, code);

    } catch (e) {
      console.error(e);
      // ✅ NU KOMT DE ECHTE OORZAAK OP SCHERM
      setMsg(`Fout bij laden: ${e.message || e}`, "bad");
    } finally {
      searchBtn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    searchBtn.addEventListener("click", runSearch);
    trackInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
    console.log("[DVK][track] ready");
  });
})();
