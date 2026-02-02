/* =========================================================
   DVK – Chauffeursdashboard
   Bestand: dvk-track-trace/public/js/dashboard.js
   Vereist:
   - supabase-config.js zet window.supabaseClient
   - driver/dashboard.html heeft: #whoami #logoutBtn #status #list #skeletons
   Tables (zoals op je screenshots):
   - public.shipments: id, driver_id, status, customer_name, customer_note, created_at, updated_at, ...
   - public.shipment_events: id, shipment_id, event_type, note, created_at
========================================================= */

const sb = window.supabaseClient;

/* DOM */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* Skeletons */
function showSkeletons() {
  const sk = document.getElementById("skeletons");
  if (sk) sk.style.display = "grid";
  if (listEl) listEl.style.display = "none";
}
function hideSkeletons() {
  const sk = document.getElementById("skeletons");
  if (sk) sk.style.display = "none";
  if (listEl) listEl.style.display = "grid";
}

/* Helpers */
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

/* Auth */
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

/* Laad naam rechtsboven (veilig: geen DB nodig) */
async function loadDriverName() {
  const { data, error } = await sb.auth.getUser();
  if (error) return "";
  const u = data?.user;
  return u?.user_metadata?.name || u?.email || "";
}

/* Data ophalen: shipments + events (zonder join/relationship) */
async function loadShipmentsWithEvents(driverId) {
  // 1) Shipments van deze driver
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, driver_id, status, customer_name, customer_note, created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (shipErr) throw shipErr;

  const ids = (shipments || []).map((s) => s.id);
  if (ids.length === 0) return [];

  // 2) Events voor die shipments
  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (evErr) throw evErr;

  // 3) Koppel events aan shipments
  const byShipment = new Map();
  (events || []).forEach((e) => {
    const key = e.shipment_id;
    if (!byShipment.has(key)) byShipment.set(key, []);
    byShipment.get(key).push(e);
  });

  return (shipments || []).map((s) => ({
    ...s,
    events: byShipment.get(s.id) || [],
  }));
}

/* Render */
function renderShipments(items) {
  if (!listEl) return;

  if (!items || items.length === 0) {
    listEl.innerHTML = "";
    statusEl.textContent = "Geen zendingen gevonden.";
    return;
  }

  statusEl.textContent = `${items.length} zending(en) geladen.`;

  listEl.innerHTML = items
    .map((s) => {
      const idShort = String(s.id || "").slice(0, 8);
      const createdAt = fmtDT(s.created_at);

      const evHtml = (s.events || [])
        .map((e) => {
          const t = esc(e.event_type);
          const note = esc(e.note || "");
          const dt = fmtDT(e.created_at);
          return `
            <div class="row">
              <span class="${badgeClass(t)}">${t}</span>
              <span class="muted">${note ? note : ""}</span>
              <span class="muted" style="margin-left:auto">${dt}</span>
            </div>
          `;
        })
        .join("");

      return `
        <div class="ship-card">
          <div class="row" style="justify-content:space-between;">
            <div>
              <div><strong>#${esc(idShort)}</strong></div>
              <div class="muted">Klant: ${esc(s.customer_name || "-")}</div>
              <div class="muted">Aangemaakt: ${esc(createdAt)}</div>
            </div>
            <div class="${badgeClass(s.status)}">${esc(s.status || "-")}</div>
          </div>

          ${
            s.customer_note
              ? `<div class="muted" style="margin-top:8px;">${esc(s.customer_note)}</div>`
              : ""
          }

          <div class="events">
            ${evHtml || `<div class="muted">Geen events.</div>`}
          </div>
        </div>
      `;
    })
    .join("");
}

/* Main */
async function init() {
  showSkeletons();

  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt (supabase-config.js niet geladen).";
      return;
    }

    statusEl.textContent = "Sessie controleren…";
    const session = await requireSession();
    if (!session) return;

    const driverName = await loadDriverName();
    if (whoEl) whoEl.textContent = driverName || session.user.email || "";

    // Logout
    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        await sb.auth.signOut();
        window.location.href = "/dvk-track-trace/driver/login.html";
      };
    }

    statusEl.textContent = "Zendingen + events ophalen…";
    const userId = session.user.id;

    const shipments = await loadShipmentsWithEvents(userId);

    renderShipments(shipments);
  } catch (err) {
    console.error("Dashboard error:", err);
    const msg =
      err?.message ||
      (typeof err === "string" ? err : "Onbekende fout (zie console).");
    statusEl.textContent = "Fout bij laden: " + msg;
    if (listEl) listEl.innerHTML = "";
  } finally {
    hideSkeletons();
  }
}

// Start (ook als DOM al geladen is)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
