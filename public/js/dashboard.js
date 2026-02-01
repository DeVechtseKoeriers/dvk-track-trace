/* dvk-track-trace/public/js/dashboard.js
   Driver dashboard (shipments + status-events)
   Vereist:
   - <span id="whoami"></span>
   - <button id="logoutBtn"></button>
   - <div id="status"></div>
   - <div id="list"></div>
   - supabase-config.js zet window.supabaseClient
*/

const sb = window.supabaseClient;

const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// ---------- helpers ----------
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
  // NL weergave
  return d.toLocaleString("nl-NL", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function badgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "created") return "b-created";
  if (s === "en_route") return "b-en_route";
  if (s === "delivered") return "b-delivered";
  if (s === "problem") return "b-problem";
  return "b-created";
}

function prettyStatus(status) {
  const s = String(status || "");
  if (s === "created") return "Aangemeld";
  if (s === "en_route") return "Onderweg";
  if (s === "delivered") return "Afgeleverd";
  if (s === "problem") return "Probleem";
  return s || "-";
}

// ---------- data ----------
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

async function loadDriverName(userId) {
  // drivers tabel: user_id -> name
  const { data, error } = await sb
    .from("drivers")
    .select("name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("loadDriverName error:", error);
    return null;
  }
  return data?.name || null;
}

async function loadShipmentsWithEvents(userId) {
  // NESTED query: shipments + shipment_events
  // Let op: backticks staan hier GOED gesloten.
  const { data, error } = await sb
    .from("shipments")
    .select(`
      id,
      track_code,
      status,
      customer_name,
      created_at,
      shipment_events (
        id,
        event_type,
        note,
        created_at
      )
    `)
    .eq("driver_id", userId)
    .order("created_at", { ascending: false })
    .order("created_at", { ascending: false, foreignTable: "shipment_events" });

  if (error) throw error;

  // Normaliseer events: altijd array en sorteren newest->oldest
  return (data || []).map((s) => {
    const ev = Array.isArray(s.shipment_events) ? s.shipment_events : [];
    ev.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { ...s, shipment_events: ev };
  });
}

// ---------- render ----------
function renderShipments(shipments) {
  listEl.innerHTML = "";

  statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

  if (!shipments.length) {
    listEl.innerHTML = `<div class="muted">Geen zendingen gevonden.</div>`;
    return;
  }

  shipments.forEach((s) => {
    const status = prettyStatus(s.status);
    const badge = badgeClass(s.status);

    const events = Array.isArray(s.shipment_events) ? s.shipment_events : [];
    const eventsHtml = events.length
      ? `<ul class="events">
          ${events
            .map(
              (e) => `
            <li>
              <span class="badge ${badgeClass(e.event_type)}">${esc(e.event_type)}</span>
              <span class="muted">${fmtDT(e.created_at)}</span>
              <div>${esc(e.note || "")}</div>
            </li>`
            )
            .join("")}
        </ul>`
      : `<div class="muted" style="margin-top:10px;">Nog geen events.</div>`;

    const card = document.createElement("div");
    card.className = "card ship-card";
    card.dataset.shipmentId = s.id;

    card.innerHTML = `
      <div class="row">
        <div style="min-width:140px;">
          <div style="font-size:18px;font-weight:700;">#${esc(s.track_code)}</div>
          <div class="muted">Klant: ${esc(s.customer_name || "-")}</div>
          <div class="muted">Aangemaakt: ${esc(fmtDT(s.created_at))}</div>
        </div>

        <div style="margin-left:auto; display:flex; align-items:center; gap:10px;">
          <span class="badge ${badge}">${esc(status)}</span>
          <button class="btn js-toggle">Events</button>
        </div>
      </div>

      <div class="js-events" style="display:none;">
        ${eventsHtml}
      </div>
    `;

    listEl.appendChild(card);
  });

  wireCardActions();
}

function wireCardActions() {
  // Toggle events per kaart
  document.querySelectorAll(".ship-card .js-toggle").forEach((btn) => {
    btn.onclick = () => {
      const card = btn.closest(".ship-card");
      const panel = card?.querySelector(".js-events");
      if (!panel) return;
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "block";
      btn.textContent = open ? "Events" : "Verberg";
    };
  });
}

// ---------- main ----------
async function init() {
  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt (supabase-config.js).";
      return;
    }

    statusEl.textContent = "Sessie controleren...";
    const session = await requireSession();
    if (!session) return;

    const userId = session.user.id;

    // Naam rechtsboven
    const driverName = await loadDriverName(userId);
    if (whoEl) whoEl.textContent = driverName || session.user.email || "Ingelogd";

    // Logout
    logoutBtn?.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = "/dvk-track-trace/driver/login.html";
    });

    // Eerste load
    statusEl.textContent = "Zendingen + events ophalen...";
    const shipments = await loadShipmentsWithEvents(userId);
    renderShipments(shipments);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Fout bij laden: " + (err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", init);
