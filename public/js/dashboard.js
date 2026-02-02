/* =========================================================
   DVK – Chauffeur Dashboard
   Bestand: public/js/dashboard.js
   Doel:
   - Ingelogde chauffeur
   - Zendingen ophalen
   - PER ZENDING alleen LAATSTE STATUS tonen
   ========================================================= */

const sb = window.supabaseClient;

// DOM
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const skeletonsEl = document.getElementById("skeletons");

/* ---------------- Skeleton helpers ---------------- */
function showSkeletons() {
  if (skeletonsEl) skeletonsEl.style.display = "grid";
  if (listEl) listEl.style.display = "none";
}

function hideSkeletons() {
  if (skeletonsEl) skeletonsEl.style.display = "none";
  if (listEl) listEl.style.display = "grid";
}

/* ---------------- Helpers ---------------- */
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------- Auth ---------------- */
async function requireSession() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) {
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return data.session;
}

/* ---------------- Data ---------------- */
async function loadShipmentsWithEvents(userId) {
  const { data, error } = await sb
    .from("shipments")
    .select(`
      id,
      reference,
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
    .order("created_at", {
      foreignTable: "shipment_events",
      ascending: false,
    });

  if (error) throw error;
  return data || [];
}

/* ---------------- Status mapping ---------------- */
function statusFromEvent(event) {
  if (!event) {
    return { text: "Onbekend", cls: "badge" };
  }

  switch (event.event_type) {
    case "created":
      return { text: "Aangemeld", cls: "badge warn" };
    case "en_route":
      return { text: "Onderweg", cls: "badge ok" };
    case "delivered":
      return { text: "Afgeleverd", cls: "badge done" };
    default:
      return { text: event.event_type, cls: "badge" };
  }
}

/* ---------------- Render ---------------- */
function renderShipments(shipments) {
  listEl.innerHTML = "";

  if (!shipments.length) {
    statusEl.textContent = "Geen zendingen gevonden.";
    return;
  }

  shipments.forEach((s) => {
    const latestEvent = s.shipment_events?.[0];
    const status = statusFromEvent(latestEvent);

    const card = document.createElement("div");
    card.className = "ship-card";

    card.innerHTML = `
      <div class="row">
        <strong>#${esc(s.reference)}</strong>
        <span class="${status.cls}">${status.text}</span>
      </div>

      <div class="muted">Klant: ${esc(s.customer_name || "-")}</div>
      <div class="muted">Aangemaakt: ${fmtDate(s.created_at)}</div>
    `;

    listEl.appendChild(card);
  });

  statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;
}

/* ---------------- Init ---------------- */
async function init() {
  showSkeletons();

  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt.";
      return;
    }

    const session = await requireSession();
    if (!session) return;

    const userId = session.user.id;
    window.__DVK_USER_ID__ = userId;

    // Naam rechtsboven
    if (whoEl) whoEl.textContent = session.user.email;

    // Logout
    logoutBtn?.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = "/dvk-track-trace/driver/login.html";
    });

    statusEl.textContent = "Zendingen laden...";
    const shipments = await loadShipmentsWithEvents(userId);

    hideSkeletons();
    renderShipments(shipments);

  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent = "Fout bij laden: " + (err?.message || err);
  }
}

document.addEventListener("DOMContentLoaded", init);
