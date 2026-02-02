/* =====================================================
   DVK – Chauffeursdashboard
   Bestand: public/js/dashboard.js
===================================================== */

/* Supabase client (komt uit supabase-config.js) */
const sb = window.supabaseClient;

/* DOM elements */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* -------------------------
   Helpers
------------------------- */
function showStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function clearList() {
  if (listEl) listEl.innerHTML = "";
}

/* -------------------------
   Auth check
------------------------- */
async function getUser() {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) {
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return data.user;
}

/* -------------------------
   Data loaders
------------------------- */
async function loadShipments(driverId) {
  const { data, error } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function loadEvents(shipmentId) {
  const { data, error } = await sb
    .from("shipment_events")
    .select("event_type, note, created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

/* -------------------------
   Render
------------------------- */
async function renderShipments(shipments) {
  clearList();

  for (const shipment of shipments) {
    const card = document.createElement("div");
    card.className = "ship-card";

    card.innerHTML = `
      <div class="row">
        <strong>${shipment.customer_name ?? "Onbekende klant"}</strong>
        <span class="badge b-${shipment.status}">
          ${shipment.status}
        </span>
      </div>
      <div class="muted">
        Aangemaakt: ${new Date(shipment.created_at).toLocaleString()}
      </div>
      <div class="events" id="events-${shipment.id}">
        <div class="muted">Events laden…</div>
      </div>
    `;

    listEl.appendChild(card);

    // Events laden
    const eventsEl = document.getElementById(`events-${shipment.id}`);
    try {
      const events = await loadEvents(shipment.id);
      eventsEl.innerHTML = events.length
        ? events
            .map(
              e => `
                <div class="event">
                  <span class="badge b-${e.event_type}">
                    ${e.event_type}
                  </span>
                  <span>${e.note ?? ""}</span>
                  <span class="muted">
                    ${new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
              `
            )
            .join("")
        : `<div class="muted">Geen events</div>`;
    } catch {
      eventsEl.innerHTML = `<div class="muted">Events niet beschikbaar</div>`;
    }
  }
}

/* -------------------------
   Init
------------------------- */
async function init() {
  try {
    showStatus("Gebruiker controleren…");
    const user = await getUser();
    if (!user) return;

    if (whoEl) whoEl.textContent = user.email;

    showStatus("Zendingen laden…");
    const shipments = await loadShipments(user.id);

    if (!shipments.length) {
      showStatus("Geen zendingen gevonden.");
      return;
    }

    showStatus("");
    await renderShipments(shipments);
  } catch (err) {
    console.error(err);
    showStatus("Fout bij laden: " + err.message);
  }
}

/* -------------------------
   Logout
------------------------- */
logoutBtn?.addEventListener("click", async () => {
  await sb.auth.signOut();
  window.location.href = "/dvk-track-trace/driver/login.html";
});

/* Start */
document.addEventListener("DOMContentLoaded", init);
