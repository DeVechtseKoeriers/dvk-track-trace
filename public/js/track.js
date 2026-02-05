// =====================================================
// DVK – Track & Trace (klant)
// Bestand: /public/js/track.js
// Vereist: window.supabaseClient (supabase-config.js)
// Gebruikt door: /track/index.html
// =====================================================

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("[DVK] Supabase client ontbreekt. Check supabase-config.js");
    return;
  }

  const $ = (id) => document.getElementById(id);

  const input = $("trackInput");
  const btn = $("searchBtn");
  const msg = $("statusMsg");
  const result = $("result");
  const timeline = $("timeline");

  // optioneel: als jouw track/index.html extra velden heeft (shipMeta etc.)
  const shipMeta = $("shipMeta");
  const shipStatus = $("shipStatus");
  const pkgInfo = $("pkgInfo");

  let channel = null;
  let currentShipmentId = null;

  // ----------------------------
  // Helpers
  // ----------------------------
  const statusNL = {
    created: "Aangemeld",
    registered: "Aangemeld",
    en_route: "Onderweg",
    out_for_delivery: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
    cancelled: "Geannuleerd"
  };

  function nlStatus(code) {
    if (!code) return "Onbekend";
    const k = String(code).toLowerCase();
    return statusNL[k] || code;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function showMsg(text, type = "") {
    if (!msg) return;
    msg.textContent = text || "";
    msg.className = "msg " + (type || "");
    msg.style.display = text ? "block" : "none";
  }

  function showResult(show) {
    if (!result) return;
    result.style.display = show ? "block" : "none";
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleString("nl-NL");
    } catch {
      return iso || "";
    }
  }

  function stopRealtime() {
    if (channel) {
      sb.removeChannel(channel);
      channel = null;
    }
  }

  async function startRealtime(shipmentId) {
    stopRealtime();

    channel = sb
      .channel("tt-" + shipmentId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          await refreshTimeline(shipmentId);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` },
        async () => {
          // status / pakketgegevens realtime bijwerken
          const ship = await fetchShipmentById(shipmentId);
          if (ship) renderShipment(ship);
        }
      )
      .subscribe();
  }

  // ----------------------------
  // DB calls
  // ----------------------------
  async function fetchShipmentByTrack(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, customer_address, customer_phone, colli_count, weight_kg, created_at")
      .eq("track_code", trackCode)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchShipmentById(id) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, customer_address, customer_phone, colli_count, weight_kg, created_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error(error);
      return null;
    }
    return data;
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

  // ----------------------------
  // Renderers
  // ----------------------------
  function renderShipment(ship) {
    const customer = ship.customer_name ? esc(ship.customer_name) : "-";
    const track = esc(ship.track_code || "");
    const status = esc(nlStatus(ship.status));

    // Als jouw HTML het shipMeta/shipStatus/pkInfo blok heeft:
    if (shipMeta && shipStatus && pkgInfo) {
      shipMeta.innerHTML = `Klant: <b>${customer}</b><br>Trackcode: <b>${track}</b>`;
      shipStatus.innerHTML = `<b>${status}</b>`;

      const lines = [];
      // pakket
      const colli = ship.colli_count ?? null;
      const kg = ship.weight_kg ?? null;

      lines.push(`Colli: <b>${colli ?? "-"}</b>`);
      lines.push(`Kg: <b>${kg ?? "-"}</b>`);

      // optioneel ook adres/telefoon
      if (ship.customer_address) lines.push(`Adres: <b>${esc(ship.customer_address)}</b>`);
      if (ship.customer_phone) lines.push(`Telefoon: <b>${esc(ship.customer_phone)}</b>`);

      pkgInfo.innerHTML = `<div class="muted">${lines.join("<br>")}</div>`;
      return;
    }

    // Fallback: als je een simpel #result blok hebt
    if (result) {
      result.innerHTML = `
        <div class="card inner">
          <div style="font-weight:700;">Zending gevonden</div>
          <div class="muted" style="margin-top:6px;">Klant: <b>${customer}</b></div>
          <div class="muted">Trackcode: <b>${track}</b></div>
          <div style="margin-top:8px;"><b>Status:</b> ${status}</div>

          <div class="sep"></div>
          <div style="font-weight:700;">Pakketgegevens</div>
          <div class="muted" style="margin-top:6px;">
            Colli: <b>${ship.colli_count ?? "-"}</b><br>
            Kg: <b>${ship.weight_kg ?? "-"}</b>
            ${ship.customer_address ? `<br>Adres: <b>${esc(ship.customer_address)}</b>` : ""}
            ${ship.customer_phone ? `<br>Telefoon: <b>${esc(ship.customer_phone)}</b>` : ""}
          </div>
        </div>
      `;
    }
  }

  function renderTimeline(events) {
    if (!timeline) return;

    if (!events || events.length === 0) {
      timeline.innerHTML = `<div class="muted">Nog geen updates.</div>`;
      return;
    }

    timeline.innerHTML = events.map((e) => {
      const t = esc(fmtDate(e.created_at));
      const type = esc(nlStatus(e.event_type));
      const note = e.note ? esc(e.note) : "";

      return `
        <div class="tl-item">
          <div class="tl-title"><b>${type}</b></div>
          ${note ? `<div class="tl-note">${note}</div>` : ""}
          <div class="timeline-time muted">${t}</div>
        </div>
      `;
    }).join("");
  }

  async function refreshTimeline(shipmentId) {
    try {
      const events = await fetchEvents(shipmentId);
      renderTimeline(events);
    } catch (e) {
      console.error(e);
    }
  }

  // ----------------------------
  // Main search
  // ----------------------------
  async function search() {
    const code = (input?.value || "").trim();
    if (!code) {
      showMsg("Vul een trackcode in.", "warn");
      showResult(false);
      stopRealtime();
      return;
    }

    showMsg("Zoeken…", "warn");
    showResult(false);

    try {
      const ship = await fetchShipmentByTrack(code);

      if (!ship) {
        showMsg("Geen zending gevonden met deze trackcode.", "bad");
        stopRealtime();
        return;
      }

      currentShipmentId = ship.id;
      renderShipment(ship);

      const events = await fetchEvents(ship.id);
      renderTimeline(events);

      showResult(true);
      showMsg("Gevonden ✅ (realtime actief)", "ok");

      await startRealtime(ship.id);
    } catch (e) {
      console.error(e);
      showMsg("Fout bij laden (check console).", "bad");
      stopRealtime();
    }
  }

  // ----------------------------
  // Wire UI
  // ----------------------------
  if (btn) btn.addEventListener("click", search);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") search();
    });
  }

})();
