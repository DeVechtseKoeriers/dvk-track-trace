/* ============================================================
   DVK – Chauffeursdashboard
   Bestand: dvk-track-trace/public/js/dashboard.js

   Vereisten in HTML:
   - #whoami, #logoutBtn, #status, #list, #skeletons (optioneel)
   - supabase-config.js zet window.supabaseClient
============================================================ */

const sb = window.supabaseClient;

// DOM
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const skEl = document.getElementById("skeletons");

// ---------- UI helpers ----------
function showSkeletons() {
  if (skEl) skEl.style.display = "grid";
  if (listEl) listEl.style.display = "none";
}
function hideSkeletons() {
  if (skEl) skEl.style.display = "none";
  if (listEl) listEl.style.display = "grid";
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDT(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "created") return "badge b-created";
  if (s === "en_route") return "badge b-en_route";
  if (s === "delivered") return "badge b-delivered";
  if (s === "problem") return "badge b-problem";
  return "badge";
}

// ---------- Auth ----------
async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session) {
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return session;
}

// ---------- Data loaders ----------
async function loadShipmentsForDriver(driverId) {
  // Let op: jouw tabel heeft _code (niet reference) en driver_id (niet user_id)
  const { data, error } = await sb
    .from("shipments")
    .select("id,_code,status,customer_name,created_at,driver_id")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function loadEventsForShipmentIds(shipmentIds) {
  if (!shipmentIds.length) return [];

  // Haal alle events op in 1 query (geen relationship nodig)
  const { data, error } = await sb
    .from("shipment_events")
    .select("id,shipment_id,event_type,note,created_at")
    .in("shipment_id", shipmentIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function groupEventsByShipment(events) {
  const map = new Map();
  for (const ev of events) {
    const sid = ev.shipment_id;
    if (!map.has(sid)) map.set(sid, []);
    map.get(sid).push(ev);
  }
  return map;
}

// ---------- Render ----------
function renderShipments(shipments, eventsByShipment) {
  if (!listEl) return;

  if (!shipments || shipments.length === 0) {
    listEl.innerHTML = "";
    statusEl.textContent = "Geen zendingen gevonden.";
    return;
  }

  statusEl.textContent = `${shipments.length} zending(en) geladen.`;

  const html = shipments
    .map((s) => {
      const code = s._code ?? "";
      const customer = s.customer_name ?? "";
      const st = s.status ?? "";
      const createdAt = s.created_at;

      const events = eventsByShipment.get(s.id) || [];
      const topEvents = events.slice(0, 5); // max 5 tonen

      const eventsHtml =
        topEvents.length === 0
          ? `<div class="events muted">Geen events.</div>`
          : `
            <div class="events">
              ${topEvents
                .map((ev) => {
                  const evType = esc(ev.event_type || "");
                  const note = esc(ev.note || "");
                  const dt = fmtDT(ev.created_at);
                  return `<div class="event-row">
                            <span class="event-dot"></span>
                            <div class="event-body">
                              <div class="event-title">${evType}</div>
                              <div class="event-note muted">${note}</div>
                              <div class="event-dt muted">${dt}</div>
                            </div>
                          </div>`;
                })
                .join("")}
            </div>
          `;

      return `
        <div class="ship-card">
          <div class="row">
            <div>
              <div class="ship-code">#${esc(code)}</div>
              <div class="muted">Klant: ${esc(customer)}</div>
              <div class="muted">Aangemaakt: ${esc(fmtDT(createdAt))}</div>
            </div>
            <div style="margin-left:auto; display:flex; gap:8px; align-items:flex-start;">
              <span class="${badgeClass(st)}">${esc(st)}</span>
            </div>
          </div>
          ${eventsHtml}
        </div>
      `;
    })
    .join("");

  listEl.innerHTML = html;
}

// ---------- Main ----------
async function init() {
  showSkeletons();

  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt (supabase-config.js).";
      return;
    }

    statusEl.textContent = "Sessie controleren…";
    const session = await requireSession();
    if (!session) return;

    // Whoami rechtsboven
    if (whoEl) whoEl.textContent = session.user?.email || "Ingelogd";

    // Logout
    logoutBtn?.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = "/dvk-track-trace/driver/login.html";
    });

    const driverId = session.user.id;

    statusEl.textContent = "Zendingen ophalen…";
    const shipments = await loadShipmentsForDriver(driverId);

    statusEl.textContent = "Events ophalen…";
    const ids = shipments.map((s) => s.id);
    const events = await loadEventsForShipmentIds(ids);
    const eventsByShipment = groupEventsByShipment(events);

    hideSkeletons();
    renderShipments(shipments, eventsByShipment);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent =
      "Fout bij laden: " + (err?.message ? err.message : String(err));
  }
}

document.addEventListener("DOMContentLoaded", init);
