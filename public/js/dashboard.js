const sb = window.supabaseClient;

document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const listEl = document.getElementById("list");
  const whoEl = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logoutBtn");

  // Handige helpers
  const fmt = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString("nl-NL", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
    } catch {
      return iso;
    }
  };

  const badgeClass = (status) => {
    const s = (status || "").toLowerCase();
    if (s === "created") return "b-created";
    if (s === "en_route") return "b-en_route";
    if (s === "delivered") return "b-delivered";
    return "b-problem";
  };

  const niceLabel = (v) => {
    const s = (v || "").toLowerCase();
    if (s === "created") return "Aangemeld";
    if (s === "en_route") return "Onderweg";
    if (s === "delivered") return "Afgeleverd";
    return v || "Onbekend";
  };

  // Uitloggen
  logoutBtn?.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "/dvk-track-trace/driver/login.html";
  });

  // MAIN
  loadDashboard().catch((e) => {
    console.error(e);
    statusEl.textContent = "Fout: " + (e?.message || e);
  });

  async function loadDashboard() {
    statusEl.textContent = "Inloggen controleren...";
    listEl.innerHTML = "";

    // 1) check login
    const { data: userRes, error: userErr } = await sb.auth.getUser();
    if (userErr) {
      console.error(userErr);
      statusEl.textContent = "Fout bij ophalen sessie: " + userErr.message;
      return;
    }

    const user = userRes?.user;
    if (!user) {
      // niet ingelogd
      window.location.href = "/dvk-track-trace/driver/login.html";
      return;
    }

    const userId = user.id;

    // 2) Naam chauffeur ophalen (drivers tabel)
    statusEl.textContent = "Chauffeur ophalen...";
    const { data: driverRow, error: driverErr } = await sb
      .from("drivers")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();

    if (!driverErr && driverRow?.name && whoEl) {
      whoEl.textContent = driverRow.name;
    } else if (whoEl) {
      // fallback: email tonen
      whoEl.textContent = user.email || userId;
    }

    // 3) Shipments + events ophalen (nested)
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
      // events binnen shipment sorteren (nieuwste bovenaan)
      .order("created_at", { ascending: false, foreignTable: "shipment_events" });

    if (shipErr) {
      console.error(shipErr);
      statusEl.textContent = "Fout bij ophalen zendingen: " + shipErr.message;
      return;
    }

    listEl.innerHTML = "";

    if (!shipments || shipments.length === 0) {
      statusEl.textContent = "Geen zendingen gevonden.";
      return;
    }

    statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

    // 4) Render cards
    shipments.forEach((s) => {
      const card = document.createElement("div");
      card.className = "ship-card";

      const code = s.track_code || "(geen code)";
      const status = s.status || "unknown";
      const customer = s.customer_name || "-";
      const created = fmt(s.created_at);

      const header = document.createElement("div");
      header.className = "row";
      header.innerHTML = `
        <strong>#${code}</strong>
        <span class="badge ${badgeClass(status)}">${niceLabel(status)}</span>
        <span class="muted">Klant: ${customer}</span>
        <span class="muted">Aangemaakt: ${created}</span>
      `;

      card.appendChild(header);

      // Events
      const events = Array.isArray(s.shipment_events) ? s.shipment_events : [];

      if (events.length === 0) {
        const p = document.createElement("div");
        p.className = "muted";
        p.style.marginTop = "10px";
        p.textContent = "Nog geen events.";
        card.appendChild(p);
      } else {
        const ul = document.createElement("ul");
        ul.className = "events";

        events.forEach((e) => {
          const li = document.createElement("li");
          const t = niceLabel(e.event_type);
          const note = e.note ? ` – ${e.note}` : "";
          const at = e.created_at ? ` (${fmt(e.created_at)})` : "";
          li.textContent = `${t}${note}${at}`;
          ul.appendChild(li);
        });

        card.appendChild(ul);
      }

      listEl.appendChild(card);
    });
  }
});
