// public/js/dashboard.js
// DVK Track & Trace – Chauffeur Dashboard

const BASE = "/dvk-track-trace"; // GitHub Pages repo path
const sb = window.supabaseClient;

function $(id) {
  return document.getElementById(id);
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("nl-NL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;

  const session = data?.session;
  if (!session?.user) {
    window.location.href = `${BASE}/driver/login.html`;
    return null;
  }
  return session;
}

async function loadDashboard() {
  const statusEl = $("status");
  const listEl = $("list");
  const whoEl = $("who");
  const logoutBtn = $("logoutBtn");

  if (!sb) {
    statusEl.textContent = "Supabase client ontbreekt (window.supabaseClient).";
    return;
  }

  // Logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await sb.auth.signOut();
      } finally {
        window.location.href = `${BASE}/driver/login.html`;
      }
    });
  }

  statusEl.textContent = "Controleren of je ingelogd bent...";
  const session = await requireSession();
  if (!session) return;

  const userId = session.user.id;

  // Chauffeurnaam ophalen (drivers.user_id = auth.user.id)
  statusEl.textContent = "Chauffeur gegevens ophalen...";
  const { data: driverRow, error: driverErr } = await sb
    .from("drivers")
    .select("name")
    .eq("user_id", userId)
    .maybeSingle();

  if (!driverErr && driverRow?.name && whoEl) {
    whoEl.textContent = driverRow.name;
  }

  // Shipments + events ophalen in 1 query (nested)
  statusEl.textContent = "Zendingen + events ophalen...";

  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select(
      `
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
    `
    )
    .eq("driver_id", userId)
    .order("created_at", { ascending: false })
    // Belangrijk: events binnen shipment sorteren
    .order("created_at", { ascending: false, foreignTable: "shipment_events" });

  if (shipErr) {
    console.error(shipErr);
    statusEl.textContent = "Fout bij ophalen zendingen: " + shipErr.message;
    return;
  }

  // Tegels renderen
  listEl.innerHTML = "";

  if (!shipments || shipments.length === 0) {
    statusEl.textContent = "Geen zendingen gevonden.";
    return;
  }

  statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

  shipments.forEach((s) => {
    const events = Array.isArray(s.shipment_events) ? s.shipment_events : [];

    const eventsHtml =
      events.length === 0
        ? `<div class="muted">Nog geen events.</div>`
        : `
          <ul class="events">
            ${events
              .map(
                (e) => `
              <li>
                <span class="badge">${escapeHtml(e.event_type)}</span>
                <span class="note">${escapeHtml(e.note)}</span>
                <span class="time">${escapeHtml(fmtDate(e.created_at))}</span>
              </li>
            `
              )
              .join("")}
          </ul>
        `;

    const card = document.createElement("div");
    card.className = "shipment-card";
    card.innerHTML = `
      <div class="shipment-head">
        <div class="track">#${escapeHtml(s.track_code)}</div>
        <div class="status-chip">${escapeHtml(s.status)}</div>
      </div>

      <div class="shipment-meta">
        <div><span class="muted">Klant:</span> ${escapeHtml(s.customer_name)}</div>
        <div><span class="muted">Aangemaakt:</span> ${escapeHtml(fmtDate(s.created_at))}</div>
      </div>

      <div class="shipment-events">
        ${eventsHtml}
      </div>
    `;

    listEl.appendChild(card);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  loadDashboard().catch((err) => {
    console.error(err);
    const statusEl = document.getElementById("status");
    if (statusEl) statusEl.textContent = "Dashboard fout: " + (err?.message || err);
  });
});
