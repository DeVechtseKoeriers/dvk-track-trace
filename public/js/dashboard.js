// public/js/dashboard.js

(function () {
  const sb = window.supabaseClient; // komt uit supabase-config.js

  const statusEl = document.getElementById("status");
  const listEl = document.getElementById("list");
  const whoEl = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logoutBtn");

  if (!sb) {
    console.error("Supabase client ontbreekt. Check supabase-config.js + script volgorde.");
    statusEl.textContent = "Supabase client ontbreekt (config).";
    return;
  }

  logoutBtn?.addEventListener("click", async () => {
    await sb.auth.signOut();
    // terug naar login (pas pad aan als jij anders hebt)
    window.location.href = "/dvk-track-trace/driver/login.html";
  });

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function badgeClass(status) {
    const s = (status || "").toLowerCase();
    if (s === "created") return "b-created";
    if (s === "en_route") return "b-en_route";
    if (s === "delivered") return "b-delivered";
    if (s === "problem") return "b-problem";
    return "b-created";
  }

  function labelStatus(status) {
    const s = (status || "").toLowerCase();
    if (s === "created") return "Aangemeld";
    if (s === "en_route") return "Onderweg";
    if (s === "delivered") return "Bezorgd";
    if (s === "problem") return "Probleem";
    return status || "-";
  }

  async function requireAuth() {
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) {
      window.location.href = "/dvk-track-trace/driver/login.html";
      return null;
    }
    return data.user;
  }

  async function loadDashboard() {
    statusEl.textContent = "Inloggen controleren...";
    listEl.innerHTML = "";

    const user = await requireAuth();
    if (!user) return;

    const userId = user.id;

    // 1) Chauffeur-naam ophalen uit drivers table
    statusEl.textContent = "Chauffeur ophalen...";
    const { data: driverRow, error: driverErr } = await sb
      .from("drivers")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();

    if (!driverErr && driverRow?.name && whoEl) {
      whoEl.textContent = driverRow.name;
    } else if (whoEl) {
      whoEl.textContent = user.email || "Chauffeur";
    }

    // 2) Shipments + events ophalen in 1 query (nested)
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
      .order("created_at", { ascending: false })
      // belangrijk: events binnen shipment sorteren
      .order("created_at", { ascending: false, foreignTable: "shipment_events" });

    if (shipErr) {
      console.error(shipErr);
      statusEl.textContent = "Fout bij ophalen zendingen: " + (shipErr.message || "onbekend");
      return;
    }

    // Tegels renderen: eerst leegmaken (voorkomt dubbele tegels)
    listEl.innerHTML = "";

    if (!shipments || shipments.length === 0) {
      statusEl.textContent = "Geen zendingen gevonden.";
      return;
    }

    statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

    shipments.forEach((s) => {
      const card = document.createElement("div");
      card.className = "ship-card";

      const top = document.createElement("div");
      top.className = "row";

      const code = document.createElement("div");
      code.style.fontWeight = "700";
      code.textContent = `#${s.track_code || "-"}`;

      const badge = document.createElement("span");
      badge.className = `badge ${badgeClass(s.status)}`;
      badge.textContent = labelStatus(s.status);

      const klant = document.createElement("div");
      klant.className = "muted";
      klant.textContent = `Klant: ${s.customer_name || "-"}`;

      const aangemaakt = document.createElement("div");
      aangemaakt.className = "muted";
      aangemaakt.textContent = `Aangemaakt: ${fmtDate(s.created_at)}`;

      top.appendChild(code);
      top.appendChild(badge);

      card.appendChild(top);
      card.appendChild(klant);
      card.appendChild(aangemaakt);

      // Events lijst
      const events = Array.isArray(s.shipment_events) ? s.shipment_events : [];

      if (events.length === 0) {
        const none = document.createElement("div");
        none.className = "muted";
        none.style.marginTop = "8px";
        none.textContent = "Nog geen events.";
        card.appendChild(none);
      } else {
        const ul = document.createElement("ul");
        ul.className = "events";

        events.forEach((e) => {
          const li = document.createElement("li");
          li.innerHTML = `<span class="muted">${fmtDate(e.created_at)} • </span><strong>${e.event_type || "-"}</strong> — ${e.note || ""}`;
          ul.appendChild(li);
        });

        card.appendChild(ul);
      }

      listEl.appendChild(card);
    });
  }

  document.addEventListener("DOMContentLoaded", loadDashboard);
})();
