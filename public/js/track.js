/* public/js/track.js
   DVK Track & Trace (klant)
   - zoekt shipment op track_code
   - haalt timeline uit shipment_events
   - realtime via Supabase channel
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    const statusMsg = document.getElementById("statusMsg");
    if (statusMsg) {
      statusMsg.textContent = "Configuratie fout: Supabase client ontbreekt.";
      statusMsg.className = "msg bad";
    }
    return;
  }

  // --- DOM ---
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");
  const timelineEl = document.getElementById("timeline");

  // --- Helpers ---
  function setMsg(text, type = "ok") {
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

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // Status labels (NL) - je kunt dit later uitbreiden
  const STATUS_NL = {
    created: { title: "Aangemeld", desc: "Zending aangemeld" },
    en_route: { title: "Onderweg", desc: "Chauffeur is onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    problem: { title: "Probleem", desc: "Probleem gemeld" },
  };

  function statusLabel(code) {
    return STATUS_NL[code]?.title || "Status";
  }

  function statusDesc(code) {
    return STATUS_NL[code]?.desc || "";
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
    if (timelineEl) timelineEl.innerHTML = "";
  }

  // --- State ---
  let currentShipment = null;
  let currentSub = null;

  function removeChannel() {
    if (currentSub) {
      sb.removeChannel(currentSub);
      currentSub = null;
    }
  }

  async function fetchShipmentByTrackCode(trackCode) {
    // Robuust tijdens bouwen: select('*') zodat kolommen (colli/kg etc) geen errors geven
    const { data, error } = await sb
      .from("shipments")
      .select("*")
      .eq("track_code", trackCode)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchEventsForShipment(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function render(shipment, events) {
    if (!shipment) return;

    const statusCode = shipment.status || "created";
    const statusNL = statusLabel(statusCode);

    // Pakketgegevens (als kolommen bestaan)
    const colli = shipment.colli ?? shipment.aantal_colli ?? null;
    const kg = shipment.kg ?? shipment.weight_kg ?? null;

    const extraLines = [];
    if (colli !== null && colli !== undefined && colli !== "") {
      extraLines.push(`Aantal colli: ${escapeHtml(colli)}`);
    }
    if (kg !== null && kg !== undefined && kg !== "") {
      extraLines.push(`Gewicht: ${escapeHtml(kg)} kg`);
    }

    // Headerblok (let op: we tonen GEEN en_route/delivered codes)
    const headerHtml = `
      <div style="font-weight:700; font-size:18px; margin-bottom:6px;">Zending gevonden</div>
      <div>Klant: ${escapeHtml(shipment.customer_name || "")}</div>
      <div>Trackcode: ${escapeHtml(shipment.track_code || "")}</div>
      <div style="margin-top:8px; font-weight:700;">Status</div>
      <div>${escapeHtml(statusNL)}</div>
      ${extraLines.length ? `<div style="margin-top:10px;">${extraLines.map(l => `<div>${l}</div>`).join("")}</div>` : ""}
    `;

    if (resultEl) resultEl.innerHTML = headerHtml;

    // Timeline
    if (!timelineEl) return;
    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    const itemsHtml = events
      .map((ev) => {
        const code = ev.event_type || ev.type || ev.status || "";
        const title = statusLabel(code) || "Update";
        const desc = statusDesc(code);

        // “Ontvangen door” alleen bij delivered, en alleen als note gevuld
        const note =
          (code === "delivered" && ev.note && String(ev.note).trim())
            ? `<div style="margin-top:4px;">✅ Ontvangen door: ${escapeHtml(ev.note)}</div>`
            : "";

        return `
          <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,.08);">
            <div style="font-weight:700;">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(desc)}</div>
            ${note}
            <div class="muted" style="margin-top:4px;">${escapeHtml(fmtDate(ev.created_at))}</div>
          </div>
        `;
      })
      .join("");

    timelineEl.innerHTML = itemsHtml;
  }

  async function startRealtime(shipmentId) {
    removeChannel();

    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            if (!currentShipment) return;
            const refreshed = await fetchShipmentByTrackCode(currentShipment.track_code);
            currentShipment = refreshed || currentShipment;

            const events = await fetchEventsForShipment(shipmentId);
            render(currentShipment, events);
            setMsg("Gevonden ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error("Realtime update error:", e);
            setMsg(`Realtime fout: ${e?.message || e}`, "bad");
          }
        }
      )
      .subscribe();
  }

  async function runSearch() {
    const trackCode = (trackInput?.value || "").trim();
    clearUI();

    if (!trackCode) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    try {
      if (searchBtn) searchBtn.disabled = true;
      setMsg("Zoeken…", "");

      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        removeChannel();
        currentShipment = null;
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      currentShipment = shipment;

      const events = await fetchEventsForShipment(shipment.id);
      render(shipment, events);

      setMsg("Gevonden ✅ (realtime actief)", "ok");
      await startRealtime(shipment.id);
    } catch (e) {
      console.error("Track & Trace error:", e);

      // Belangrijk: laat echte fout zien in UI
      const hint =
        (e?.status === 401 || e?.status === 403)
          ? " (RLS/permissions)"
          : "";
      setMsg(`Fout bij laden: ${e?.message || e}${hint}`, "bad");
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  // Events
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  // Auto-run als input al gevuld is (optioneel)
  // runSearch();
})();
