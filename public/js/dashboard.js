/* dvk-track-trace / public / js / dashboard.js */

/* global window, document */

const sb = window.supabaseClient;

// DOM refs
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// ---------------- Skeleton helpers ----------------
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

// ---------------- Helpers ----------------
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
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------- Auth ----------------
async function requireSession() {
  const { data } = await sb.auth.getSession();
  if (!data?.session) {
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return data.session;
}

// ---------------- Data ----------------
async function loadShipmentsWithEvents(userId) {
  const { data, error } = await sb
    .from("shipments")
    .select(`
      id,
      reference,
      status,
      created_at,
      events (
        id,
        type,
        created_at,
        description
      )
    `)
    .eq("driver_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// ---------------- Render ----------------
function renderShipments(shipments) {
  listEl.innerHTML = "";

  shipments.forEach((s) => {
    const card = document.createElement("div");
    card.className = "ship-card";

    card.innerHTML = `
      <div class="row">
        <strong>#${esc(s.reference || s.id)}</strong>
        <span class="badge">${esc(s.status)}</span>
      </div>
      <div class="muted">Aangemaakt: ${fmtDT(s.created_at)}</div>
      <div class="events">
        ${(s.events || [])
          .map(
            (e) => `
          <div class="event">
            <span>${fmtDT(e.created_at)}</span>
            <strong>${esc(e.type)}</strong>
            <div class="muted">${esc(e.description || "")}</div>
          </div>`
          )
          .join("")}
      </div>
    `;

    listEl.appendChild(card);
  });
}

// ---------------- Main ----------------
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

    statusEl.textContent = "Zendingen laden…";
    const shipments = await loadShipmentsWithEvents(userId);

    hideSkeletons();

    if (!shipments.length) {
      statusEl.textContent = "Geen zendingen gevonden.";
      return;
    }

    statusEl.textContent = "";
    renderShipments(shipments);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent = "Fout bij laden: " + (err?.message || err);
  }
}

document.addEventListener("DOMContentLoaded", init);
