/* public/js/track.js
   DVK Track & Trace (klant) – stabiel + nette layout
   Verwacht in HTML:
   - #trackInput
   - #searchBtn
   - #statusMsg
   - #result
   - #timeline
*/
(function () {
  const sb = window.supabaseClient;

  // Elements (defensief)
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");
  const timelineEl = document.getElementById("timeline");

  function setMsg(text, ok = true) {
    if (!statusMsg) return;
    statusMsg.style.display = "block";
    statusMsg.innerHTML = escapeHtml(text);
    statusMsg.style.borderColor = ok ? "rgba(34,197,94,.6)" : "rgba(239,68,68,.6)";
    statusMsg.style.background = ok ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)";
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
    if (timelineEl) timelineEl.innerHTML = "";
    if (statusMsg) statusMsg.style.display = "none";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function nlStatus(status) {
    const s = String(status || "").toLowerCase();
    if (s === "created" || s === "registered" || s === "aangemeld") return "Aangemeld";
    if (s === "picked_up" || s === "opgehaald") return "Opgehaald";
    if (s === "in_transit" || s === "onderweg") return "Onderweg";
    if (s === "delivered" || s === "afgeleverd") return "Afgeleverd";
    if (s === "problem" || s === "issue" || s === "probleem") return "Probleem";
    return status || "-";
  }

  function nlEventType(type) {
    const t = String(type || "").toLowerCase();
    if (t === "picked_up") return "Opgehaald";
    if (t === "in_transit") return "Onderweg";
    if (t === "delivered") return "Afgeleverd";
    if (t === "problem") return "Probleem";
    if (t === "created") return "Aangemeld";
    return type || "-";
  }

  function fmtDT(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return String(iso);
    }
  }

  function renderShipment(shipment) {
    const customer = shipment.customer_name || shipment.client_name || shipment.customer || "-";
    const trackcode = shipment.track_code || shipment.trackcode || shipment.code || "-";
    const pickup = shipment.pickup_address || shipment.pickup || shipment.pickup_addr || "-";
    const dropoff = shipment.dropoff_address || shipment.dropoff || shipment.dropoff_addr || "-";
    const type = shipment.shipment_type || shipment.type || "-";
    const colli = shipment.colli_count ?? shipment.colli ?? "-";
    const kg = shipment.weight_kg ?? shipment.kg ?? "-";

    if (!resultEl) return;

    resultEl.innerHTML = `
      <div style="padding:14px 14px 12px; border:1px solid rgba(255,255,255,.10); border-radius:12px; background:rgba(0,0,0,.12);">
        <div style="font-size:18px; margin-bottom:6px;">
          Zending gevonden
        </div>

        <div style="font-weight:800; margin-bottom:14px;">
          Status: ${escapeHtml(nlStatus(shipment.status))}
        </div>

        <div><b>Klant:</b> ${escapeHtml(customer)}</div>
        <div><b>Trackcode:</b> ${escapeHtml(trackcode)}</div>

        <div style="height:10px;"></div>

        <div><b>Ophaaladres:</b> ${escapeHtml(pickup)}</div>
        <div><b>Bezorgadres:</b> ${escapeHtml(dropoff)}</div>

        <div style="height:10px;"></div>

        <div><b>Type zending:</b> ${escapeHtml(type)}</div>
        <div><b>Colli:</b> ${escapeHtml(colli)}</div>
        <div><b>Kg:</b> ${escapeHtml(kg)}</div>

        <div style="height:12px;"></div>

        <div style="opacity:.8; font-size:12px;">
          Afleverbon / afleverdocument (incl. handtekening) kan opgevraagd worden bij De Vechtse Koeriers.
        </div>
      </div>
    `;
  }

  function renderTimeline(events) {
    if (!timelineEl) return;

    if (!events || events.length === 0) {
      timelineEl.innerHTML = `<div style="opacity:.75; margin-top:10px;">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    timelineEl.innerHTML = events
      .map((ev) => {
        const title = nlEventType(ev.event_type || ev.type);
        const dt = fmtDT(ev.created_at || ev.createdAt);
        const receiver = ev.receiver_name || ev.received_by || "";
        const note = ev.note || ev.notes || "";

        const extra =
          (receiver || note)
            ? `<div style="margin-top:4px; opacity:.85; font-size:12px;">
                 ${receiver ? `Ontvangen door: ${escapeHtml(receiver)}` : ""}
                 ${receiver && note ? " • " : ""}
                 ${note ? escapeHtml(note) : ""}
               </div>`
            : "";

        return `
          <div style="margin-top:10px; padding:12px; border:1px solid rgba(255,255,255,.10); border-radius:12px; background:rgba(0,0,0,.10);">
            <div style="font-weight:800;">${escapeHtml(title)}</div>
            <div style="opacity:.75; font-size:12px;">${escapeHtml(dt)}</div>
            ${extra}
          </div>
        `;
      })
      .join("");
  }

  async function fetchShipmentByTrackcode(trackcode) {
    // Minimale select (geen kolommen die misschien niet bestaan)
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, pickup_address, dropoff_address, shipment_type, colli_count, weight_kg, updated_at")
      .eq("track_code", trackcode)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchEvents(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, created_at, receiver_name, note")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function subscribeRealtime(shipmentId, onChange) {
    // Als realtime niet werkt, breekt de pagina niet.
    try {
      const channel = sb
        .channel(`tt-${shipmentId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
          () => onChange()
        )
        .subscribe((status) => {
          // status = 'SUBSCRIBED' etc.
        });

      return () => {
        try { sb.removeChannel(channel); } catch {}
      };
    } catch {
      return () => {};
    }
  }

  async function runSearch() {
    if (!sb) {
      setMsg("Supabase client ontbreekt. Check supabase-config.js", false);
      return;
    }

    const trackcode = String(trackInput?.value || "").trim();
    if (!trackcode) {
      setMsg("Vul een trackcode in.", false);
      return;
    }

    clearUI();
    setMsg("Zoeken…", true);

    try {
      const shipment = await fetchShipmentByTrackcode(trackcode);
      if (!shipment) {
        setMsg("Geen zending gevonden met deze trackcode.", false);
        return;
      }

      setMsg("Gevonden ✅ (realtime actief)", true);
      renderShipment(shipment);

      const events = await fetchEvents(shipment.id);
      renderTimeline(events);

      // realtime (events)
      if (window.__dvkUnsubTT) window.__dvkUnsubTT();
      window.__dvkUnsubTT = subscribeRealtime(shipment.id, async () => {
        const evs = await fetchEvents(shipment.id);
        renderTimeline(evs);
      });
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console).", false);
    }
  }

  // Wire up button + Enter
  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  // Safety: if timeline element missing, don't crash
  if (!timelineEl) console.warn("[DVK] #timeline ontbreekt in HTML (geen crash).");
})();
