/* =========================================================
   DVK – Chauffeursdashboard
   Bestand: public/js/dashboard.js
   ========================================================= */

/* Supabase client (gezet in supabase-config.js) */
const sb = window.supabaseClient;

/* DOM elements */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* =========================
   Skeleton helpers
   ========================= */
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

/* =========================
   Utilities
   ========================= */
function esc(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nl-NL");
}

/* =========================
   Auth helpers
   ========================= */
async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return data.session;
}

/* =========================
   Data loading
   ========================= */
async function loadShipmentsWithEvents(userId) {
  const { data, error } = await sb
    .from("shipments")
    .select(`
      id,
      reference,
      customer_name,
      created_at,
      shipment_events!shipment_events_shipment_id_fkey (
        event_type,
        note,
        created_at
      )
    `)
    .eq("driver_id", userId)
    .order("created_at", { ascending: false })
    .order("created_at", {
      foreignTable: "shipment_events",
      ascending: false,
    });

  if (error) throw error;
  return data;
}

/* =========================
   Rendering
   ========================= */
function renderShipments(shipments) {
  listEl.innerHTML = "";

  shipments.forEach((s) => {
    const latestEvent = s.shipment_events?.[0];

    const card = document.createElement("div");
    card.className = "ship-card";

    card.innerHTML = `
      <div class="ship-head">
        <strong>#${esc(s.reference ?? s.id.slice(0, 6))}</strong>
        <span class="muted">${fmtDate(s.created_at)}</span>
      </div>

      <div class="ship-body">
        <div><strong>Klant:</strong> ${esc(s.customer_name ?? "-")}</div>
        <div><strong>Status:</strong> ${esc(latestEvent?.note ?? "Onbekend")}</div>
      </div>
    `;

    listEl.appendChild(card);
  });
}

/* =========================
   Main
   ========================= */
async function init() {
  showSkeletons();

  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt.";
      return;
    }

    statusEl.textContent = "Sessie controleren…";
    const session = await requireSession();
    if (!session) return;

    const userId = session.user.id;

    if (whoEl) {
      whoEl.textContent = session.user.email;
    }

    logoutBtn?.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = "/dvk-track-trace/driver/login.html";
    });

    statusEl.textContent = "Zendingen ophalen…";
    const shipments = await loadShipmentsWithEvents(userId);

    hideSkeletons();

    if (!shipments || shipments.length === 0) {
      statusEl.textContent = "Geen zendingen gevonden.";
      return;
    }

    statusEl.textContent = "";
    renderShipments(shipments);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent =
      "Fout bij laden: " + (err?.message || "onbekende fout");
  }
}

/* Start */
document.addEventListener("DOMContentLoaded", init);
