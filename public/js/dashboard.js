const sb = window.supabaseClient;

function badgeClass(statusOrEvent) {
  const s = (statusOrEvent || "").toLowerCase();
  if (s === "created") return "badge b-created";
  if (s === "en_route") return "badge b-en_route";
  if (s === "delivered") return "badge b-delivered";
  if (s === "problem") return "badge b-problem";
  // fallback: gebruik status zelf
  if (s.includes("route")) return "badge b-en_route";
  return "badge";
}

function label(s) {
  const map = {
    created: "Aangemeld",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem"
  };
  return map[s] || s || "-";
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
  } catch { return ""; }
}

async function requireLogin() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    // RELATIEF zodat GitHub Pages altijd klopt
    window.location.href = "./login.html";
    return null;
  }
  return data.session;
}

async function loadDashboard() {
  const statusEl = document.getElementById("status");
  const listEl = document.getElementById("list");
  const who = document.getElementById("whoami");

  const session = await requireLogin();
  if (!session) return;

  const userId = session.user.id;
  who.textContent = session.user.email || userId;

  // Driver naam ophalen (optioneel)
  const { data: driverRow } = await sb
    .from("drivers")
    .select("name")
    .eq("user_id", userId)
    .maybeSingle();

  if (driverRow?.name) who.textContent = driverRow.name;

  statusEl.textContent = "Zendingen ophalen…";

  // Shipments voor ingelogde chauffeur
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, track_code, status, customer_name, created_at")
    .eq("driver_id", userId)
    .order("created_at", { ascending: false });

  if (shipErr) {
    statusEl.textContent = "Fout bij ophalen shipments: " + shipErr.message;
    return;
  }

  if (!shipments || shipments.length === 0) {
    statusEl.textContent = "Geen zendingen gevonden voor deze chauffeur.";
    listEl.innerHTML = "";
    return;
  }

  // Events in 1x ophalen (sneller): waar shipment_id IN (...)
  const ids = shipments.map(s => s.id);
  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (evErr) {
    statusEl.textContent = "Fout bij ophalen events: " + evErr.message;
    return;
  }

  // Groepeer events per shipment_id
  const byShipment = new Map();
  (events || []).forEach(e => {
    const arr = byShipment.get(e.shipment_id) || [];
    arr.push(e);
    byShipment.set(e.shipment_id, arr);
  });

  statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;
  listEl.innerHTML = "";

  shipments.forEach(s => {
    const evs = byShipment.get(s.id) || [];
    const lastEvent = evs.length ? evs[evs.length - 1].event_type : null;

    const card = document.createElement("div");
    card.className = "ship-card";

    card.innerHTML = `
      <div class="row">
        <strong style="font-size:16px">#${s.track_code}</strong>
        <span class="${badgeClass(lastEvent || s.status)}">${label(lastEvent || s.status)}</span>
        <span class="muted">Klant: ${s.customer_name || "-"}</span>
        <span class="muted">Aangemaakt: ${fmtTime(s.created_at)}</span>
      </div>

      <ul class="events">
        ${
          evs.length
            ? evs.map(e => `<li><strong>${label(e.event_type)}</strong> — ${e.note || ""} <span class="muted">(${fmtTime(e.created_at)})</span></li>`).join("")
            : `<li class="muted">Nog geen events.</li>`
        }
      </ul>
    `;

    listEl.appendChild(card);
  });
}

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  await sb.auth.signOut();
  window.location.href = "./login.html";
});

document.addEventListener("DOMContentLoaded", loadDashboard);
