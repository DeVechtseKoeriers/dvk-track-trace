/* ============================================================
   DVK – Chauffeursdashboard
   Bestand: dvk-track-trace/public/js/dashboard.js

   Vereist in dashboard.html:
   - <span id="whoami"></span>
   - <button id="logoutBtn"></button>
   - <div id="status"></div>
   - <div id="list"></div>
   - <div id="skeletons"></div>

   Vereist dat supabase-config.js dit zet:
   window.supabaseClient = supabase.createClient(URL, ANON_KEY)
   ============================================================ */

const sb = window.supabaseClient;

/* DOM */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* -------------------------
   Skeleton helpers
------------------------- */
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

/* -------------------------
   Utils
------------------------- */
function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  // NL formaat: dd-mm-jjjj, hh:mm
  return dt.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(type) {
  // matcht jouw CSS classes: b-created, b-en_route, b-delivered, b-problem
  const t = String(type || "").toLowerCase();
  if (t === "created") return "badge b-created";
  if (t === "en_route") return "badge b-en_route";
  if (t === "delivered") return "badge b-delivered";
  if (t === "problem") return "badge b-problem";
  return "badge";
}

/* -------------------------
   Auth / session
------------------------- */
async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;

  const session = data?.session;
  if (!session) {
    // niet ingelogd -> terug naar login
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return session;
}

async function loadDriverName(session) {
  // Toon email of (als je later drivers tabel hebt) de naam.
  const email = session?.user?.email || "";
  return email || "Ingelogd";
}

/* -------------------------
   Data ophalen
------------------------- */
async function loadShipmentsWithEvents(driverId) {
  // 1) Shipments voor deze chauffeur
  // Let op: géén kolommen gebruiken die niet bestaan (geen reference, geen _code, etc).
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (shipErr) throw shipErr;

  const ids = (shipments || []).map((s) => s.id);
  if (ids.length === 0) return [];

  // 2) Alle events voor deze shipment_ids
  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (evErr) throw evErr;

  // map events per shipment_id
  const byShip = new Map();
  for (const e of events || []) {
    const arr = byShip.get(e.shipment_id) || [];
    arr.push(e);
    byShip.set(e.shipment_id, arr);
  }

  // combine
  return (shipments || []).map((s) => ({
    ...s,
    events: byShip.get(s.id) || [],
  }));
}

/* -------------------------
   Render
------------------------- */
function renderShipments(items) {
  if (!listEl) return;

  if (!items || items.length === 0) {
    listEl.innerHTML = "";
    statusEl.textContent = "Geen zendingen gevonden.";
    return;
  }

  const html = items
    .map((s) => {
      const shipmentId = s.id;
      const shortId = shipmentId ? String(shipmentId).slice(0, 8) : "—";
      const klant = s.customer_name || "—";
      const createdAt = fmtDate(s.created_at);

      // Bovenste status: pak shipments.status, anders laatste event_type
      const lastEvent = s.events?.length ? s.events[s.events.length - 1] : null;
      const topStatus = s.status || lastEvent?.event_type || "onbekend";

      const eventsHtml =
        (s.events || [])
          .map((e) => {
            const et = e.event_type || "event";
            const note = e.note || "";
            const t = fmtDate(e.created_at);
            return `
              <div class="row">
                <span class="${badgeClass(et)}">${esc(et)}</span>
                <span class="muted">${esc(note)}</span>
                <span class="muted">${esc(t)}</span>
              </div>
            `;
          })
          .join("") || `<div class="muted">Geen events</div>`;

      return `
        <div class="ship-card">
          <div class="row" style="gap:12px;">
            <div>
              <div style="font-weight:700; font-size:16px;">#${esc(shortId)}</div>
              <div class="muted">Klant: ${esc(klant)}</div>
              <div class="muted">Aangemaakt: ${esc(createdAt)}</div>
            </div>

            <!-- Compacte status rechtsboven -->
            <span class="${badgeClass(topStatus)}" style="margin-left:auto;">
              ${esc(topStatus)}
            </span>
          </div>

          <div class="events">
            ${eventsHtml}
          </div>
        </div>
      `;
    })
    .join("");

  listEl.innerHTML = html;
}

/* -------------------------
   Main
------------------------- */
async function init() {
  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt (check supabase-config.js).";
      return;
    }

    showSkeletons();
    statusEl.textContent = "Sessie controleren...";

    const session = await requireSession();
    if (!session) return;

    // naam rechtsboven
    const driverName = await loadDriverName(session);
    if (whoEl) whoEl.textContent = driverName;

    // logout
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await sb.auth.signOut();
        } finally {
          window.location.href = "/dvk-track-trace/driver/login.html";
        }
      });
    }

    statusEl.textContent = "Zendingen + events ophalen...";

    const driverId = session.user.id; // matcht jouw shipments.driver_id
    const shipments = await loadShipmentsWithEvents(driverId);

    hideSkeletons();
    statusEl.textContent = `${shipments.length} zending(en) geladen.`;
    renderShipments(shipments);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    const msg = err?.message || String(err);
    statusEl.textContent = "Fout bij laden: " + msg;
  }
}

document.addEventListener("DOMContentLoaded", init);
