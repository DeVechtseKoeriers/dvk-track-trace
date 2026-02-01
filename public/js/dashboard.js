// public/js/dashboard.js

(() => {
  // 1) Supabase client (gemaakt in supabase-config.js)
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Laad eerst supabase-config.js");
    return;
  }

  // 2) DOM refs (pas id's aan als jouw HTML anders is)
  const statusEl =
    document.getElementById("status") ||
    document.querySelector("[data-status]") ||
    { textContent: "" };

  const listEl =
    document.getElementById("shipmentList") ||
    document.querySelector("[data-shipments]");

  const whoEl =
    document.getElementById("who") ||
    document.querySelector("[data-who]");

  const logoutBtn =
    document.getElementById("logoutBtn") ||
    document.querySelector("[data-logout]");

  if (!listEl) {
    console.error("shipmentList element niet gevonden (id='shipmentList' of [data-shipments]).");
    return;
  }

  // 3) Helper: format datum
  function fmtDate(d) {
    try {
      return new Date(d).toLocaleString();
    } catch {
      return String(d);
    }
  }

  // 4) Dashboard laden
  async function loadDashboard() {
    statusEl.textContent = "Sesssie controleren...";

    // A) User sessie
    const { data: sessionData, error: sessErr } = await sb.auth.getSession();
    if (sessErr) {
      console.error(sessErr);
      statusEl.textContent = "Fout bij sessie ophalen.";
      return;
    }

    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      // geen sessie -> terug naar login
      window.location.href = "/dvk-track-trace/driver/login.html";
      return;
    }

    // B) Chauffeur ophalen (optioneel)
    statusEl.textContent = "Chauffeur laden...";
    const { data: driverRow, error: driverErr } = await sb
      .from("drivers")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();

    if (!driverErr && driverRow?.name && whoEl) {
      whoEl.textContent = driverRow.name;
    }

    // C) Shipments + events in 1 query (nested)
    statusEl.textContent = "Zendingen + events ophalen...";

    const { data: shipments, error: shipErr } = await sb
      .from("shipments")
      .select(`
        id,
        track_code,
        status,
        customer_name,
        created_at,
        shipment_events (
          event_type,
          note,
          created_at
        )
      `)
      .eq("driver_id", userId)
      // shipments sorteren (nieuwste boven)
      .order("created_at", { ascending: false })
      // events binnen shipment sorteren (nieuwste boven)
      .order("created_at", {
        ascending: false,
        foreignTable: "shipment_events"
      });

    if (shipErr) {
      console.error(shipErr);
      statusEl.textContent = "Fout bij ophalen zendingen.";
      return;
    }

    // D) Tegels resetten (BELANGRIJK)
    listEl.innerHTML = "";

    if (!shipments || shipments.length === 0) {
      statusEl.textContent = "Geen zendingen gevonden.";
      return;
    }

    statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

    // E) Render per shipment
    shipments.forEach((shipment) => {
      const events = shipment.shipment_events || [];

      const eventsHtml =
        events.length === 0
          ? `<li>Nog geen events.</li>`
          : events
              .map((e) => {
                return `
                  <li>
                    <strong>${e.event_type}</strong> – ${e.note || ""}
                    <br>
                    <small>${fmtDate(e.created_at)}</small>
                  </li>
                `;
              })
              .join("");

      const tile = document.createElement("div");
      tile.className = "shipment-card";

      tile.innerHTML = `
        <div class="shipment-head">
          <div class="shipment-code">#${shipment.track_code}</div>
          <div class="shipment-status">${shipment.status}</div>
        </div>

        <div class="shipment-meta">
          <div><strong>Klant:</strong> ${shipment.customer_name || "-"}</div>
          <div><strong>Aangemaakt:</strong> ${fmtDate(shipment.created_at)}</div>
        </div>

        <ul class="shipment-events">
          ${eventsHtml}
        </ul>
      `;

      listEl.appendChild(tile);
    });
  }

  // 5) Logout
  async function doLogout() {
    try {
      await sb.auth.signOut();
    } catch (e) {
      console.error(e);
    }
    window.location.href = "/dvk-track-trace/driver/login.html";
  }

  // 6) Init
  document.addEventListener("DOMContentLoaded", () => {
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
    loadDashboard();
  });
})();
