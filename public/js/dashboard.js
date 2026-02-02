/* ============================================================
   DVK – Chauffeursdashboard (met Realtime refresh)
   Bestand: dvk-track-trace/public/js/dashboard.js
   ============================================================ */

const sb = window.supabaseClient;

/* DOM */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* Realtime channel holder */
let rtChannel = null;
let refreshTimer = null;

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
  return dt.toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(type) {
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
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return session;
}

async function loadDriverName(session) {
  return session?.user?.email || "Ingelogd";
}

/* -------------------------
   Data ophalen
------------------------- */
async function loadShipmentsWithEvents(driverId) {
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (shipErr) throw shipErr;

  const ids = (shipments || []).map((s) => s.id);
  if (ids.length === 0) return [];

  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (evErr) throw evErr;

  const byShip = new Map();
  for (const e of events || []) {
    const arr = byShip.get(e.shipment_id) || [];
    arr.push(e);
    byShip.set(e.shipment_id, arr);
  }

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
   Realtime refresh (debounced)
------------------------- */
function scheduleRefresh(refreshFn) {
  // voorkom 10 refreshes achter elkaar bij meerdere events
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshFn(), 400);
}

async function setupRealtime(driverId, refreshFn) {
  // schoon afsluiten als hij al bestaat
  try {
    if (rtChannel) {
      await sb.removeChannel(rtChannel);
      rtChannel = null;
    }
  } catch (_) {}

  rtChannel = sb
    .channel("dvk-driver-dashboard")
    // shipments changes van deze driver
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments", filter: `driver_id=eq.${driverId}` },
      () => scheduleRefresh(refreshFn)
    )
    // alle shipment_events (we refreshen, maar jouw RLS zorgt dat je alleen eigen ziet)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events" },
      () => scheduleRefresh(refreshFn)
    )
    .subscribe((status) => {
      // optioneel: laat status zien in console
      console.log("Realtime status:", status);
    });
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

    const driverId = session.user.id;

    // naam rechtsboven
    const driverName = await loadDriverName(session);
    if (whoEl) whoEl.textContent = driverName;

    // logout
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          if (rtChannel) await sb.removeChannel(rtChannel);
          await sb.auth.signOut();
        } finally {
          window.location.href = "/dvk-track-trace/driver/login.html";
        }
      });
    }

    const refresh = async () => {
      try {
        statusEl.textContent = "Verversen...";
        const shipments = await loadShipmentsWithEvents(driverId);
        hideSkeletons();
        statusEl.textContent = `${shipments.length} zending(en) geladen.`;
        renderShipments(shipments);
      } catch (e) {
        console.error(e);
        hideSkeletons();
        statusEl.textContent = "Fout bij laden: " + (e?.message || String(e));
      }
    };

    // eerste load
    await refresh();

    // realtime
    await setupRealtime(driverId, refresh);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent = "Fout bij laden: " + (err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", init);
