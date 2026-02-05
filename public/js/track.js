// /public/js/track.js
(function () {
  const sb = window.sb;
  if (!sb) return;

  const elInput = document.getElementById("trackInput");
  const elBtn = document.getElementById("searchBtn");
  const elMsg = document.getElementById("statusMsg");

  const elResult = document.getElementById("result");
  const elMeta = document.getElementById("shipMeta");
  const elStatus = document.getElementById("shipStatus");
  const elPkg = document.getElementById("pkgInfo");
  const elTimeline = document.getElementById("timeline");

  let realtimeChannel = null;
  let currentShipmentId = null;

  const statusMap = {
    created: "Aangemeld",
    registered: "Aangemeld",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
    cancelled: "Geannuleerd",
  };

  function nlStatus(code) {
    if (!code) return "Onbekend";
    return statusMap[String(code).toLowerCase()] || code; // fallback op wat in DB staat
  }

  function showMsg(text, ok = false) {
    elMsg.textContent = text;
    elMsg.style.color = ok ? "#22c55e" : "#ef4444";
  }

  function showResult(show) {
    elResult.style.display = show ? "block" : "none";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function renderShipment(sh) {
    const customer = sh.customer_name ? escapeHtml(sh.customer_name) : "-";
    const track = escapeHtml(sh.track_code || "");
    const status = nlStatus(sh.status);

    elMeta.innerHTML = `
      Klant: <b>${customer}</b><br/>
      Trackcode: <b>${track}</b>
    `;

    elStatus.innerHTML = `<b>${escapeHtml(status)}</b>`;

    const colli = (sh.colli_count ?? sh.colli ?? null);
    const kg = (sh.weight_kg ?? sh.kg ?? null);
    const phone = sh.customer_phone ?? null;
    const addr = sh.customer_address ?? null;

    const lines = [];
    lines.push(`Colli: <b>${colli ?? "-"}</b>`);
    lines.push(`Kg: <b>${kg ?? "-"}</b>`);
    if (addr) lines.push(`Adres: <b>${escapeHtml(addr)}</b>`);
    if (phone) lines.push(`Telefoon: <b>${escapeHtml(phone)}</b>`);

    elPkg.innerHTML = lines.join("<br/>");
  }

  function renderTimeline(events) {
    if (!events || events.length === 0) {
      elTimeline.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    elTimeline.innerHTML = events.map(ev => {
      const t = ev.created_at ? new Date(ev.created_at).toLocaleString("nl-NL") : "";
      const label = nlStatus(ev.event_type);
      // "note" gebruiken we als NL-tekst (bijv. "Ontvangen door: Piet")
      const note = ev.note ? escapeHtml(ev.note) : "";
      return `
        <div class="tl-item">
          <div class="tl-title"><b>${escapeHtml(label)}</b></div>
          ${note ? `<div class="tl-note">${note}</div>` : ""}
          <div class="tl-time muted">${escapeHtml(t)}</div>
        </div>
      `;
    }).join("");
  }

  async function loadShipmentAndTimeline(trackCode) {
    showMsg("", true);
    showResult(false);

    // shipment ophalen
    const { data: ship, error: shipErr } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, customer_address, customer_phone, colli_count, weight_kg, created_at")
      .eq("track_code", trackCode)
      .maybeSingle();

    if (shipErr) {
      console.error(shipErr);
      showMsg("Fout bij laden (check console)");
      return;
    }
    if (!ship) {
      showMsg("Geen zending gevonden.");
      return;
    }

    currentShipmentId = ship.id;
    renderShipment(ship);

    // events ophalen
    const { data: events, error: evErr } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", ship.id)
      .order("created_at", { ascending: true });

    if (evErr) {
      console.error(evErr);
      showMsg("Fout bij timeline laden (check console)");
      return;
    }

    renderTimeline(events);
    showResult(true);
    showMsg("Gevonden ✅ (realtime actief)", true);

    await setupRealtime(ship.id);
  }

  async function setupRealtime(shipmentId) {
    try {
      if (realtimeChannel) {
        await sb.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }

      realtimeChannel = sb.channel(`track-${shipmentId}`);

      // events realtime
      realtimeChannel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          const { data: events } = await sb
            .from("shipment_events")
            .select("id, shipment_id, event_type, note, created_at")
            .eq("shipment_id", shipmentId)
            .order("created_at", { ascending: true });

          renderTimeline(events || []);
        }
      );

      // status realtime
      realtimeChannel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` },
        async () => {
          const { data: ship } = await sb
            .from("shipments")
            .select("id, track_code, status, customer_name, customer_address, customer_phone, colli_count, weight_kg, created_at")
            .eq("id", shipmentId)
            .maybeSingle();

          if (ship) renderShipment(ship);
        }
      );

      await realtimeChannel.subscribe();
    } catch (e) {
      console.error(e);
    }
  }

  function normalizeTrackCode(raw) {
    return String(raw || "").trim();
  }

  async function runSearch() {
    const trackCode = normalizeTrackCode(elInput.value);
    if (!trackCode) {
      showMsg("Vul een trackcode in.");
      return;
    }
    await loadShipmentAndTimeline(trackCode);
  }

  elBtn.addEventListener("click", runSearch);
  elInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });
})();
