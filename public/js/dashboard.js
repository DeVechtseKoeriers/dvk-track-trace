/* ==========================================================
   DVK – Chauffeursdashboard
   Bestand: dvk-track-trace/public/js/dashboard.js
   ========================================================== */

/* Supabase client (gezet in supabase-config.js) */
const sb = window.supabaseClient;

/* Base path (GitHub Pages repo) */
const BASE = "/dvk-track-trace";
const LOGIN_URL = `${BASE}/driver/login.html`;

/* DOM elements */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* Skeleton container (optioneel) */
const skEl = document.getElementById("skeletons");

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDT(iso) {
  if (!iso) return "--";
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

function showSkeletons() {
  if (skEl) skEl.style.display = "grid";
  if (listEl) listEl.style.display = "none";
}

function hideSkeletons() {
  if (skEl) skEl.style.display = "none";
  if (listEl) listEl.style.display = "grid";
}

/* Kies het “beste” referentieveld zonder te crashen */
function bestRef(sh) {
  return (
    sh.reference ??
    sh.shipment_number ??
    sh.tracking_code ??
    sh.tracking ??
    sh.code ??
    sh.ref ??
    sh.id
  );
}

/* Kies klantnaam veld zonder te crashen */
function bestCustomer(sh) {
  return (
    sh.customer_name ??
    sh.customer ??
    sh.client_name ??
    sh.klant ??
    sh.name ??
    "—"
  );
}

/* status -> badge class (matcht jouw CSS b-created / b-en_route etc.) */
function badgeClass(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "created") return "b-created";
  if (s === "en_route" || s === "enroute" || s === "on_the_way") return "b-en_route";
  if (s === "delivered") return "b-delivered";
  if (s === "problem" || s === "issue") return "b-problem";
  return "b-created";
}

function statusLabel(status) {
  const s = String(status ?? "").toLowerCase();
  if (s === "created") return "Aangemeld";
  if (s === "en_route" || s === "enroute") return "Onderweg";
  if (s === "delivered") return "Afgeleverd";
  if (s === "problem") return "Probleem";
  return status || "Onbekend";
}

/* ---------------- auth ---------------- */

async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;

  const session = data?.session;
  if (!session) {
    window.location.href = LOGIN_URL;
    return null;
  }
  return session;
}

/* ---------------- data ---------------- */

async function loadShipmentsForDriver(userId) {
  // We gebruiken select('*') zodat we niet crashen op ontbrekende kolommen.
  // Filter: driver_id OF user_id (werkt als één van beide in jouw schema zit).
  const { data, error } = await sb
    .from("shipments")
    .select("*")
    .or(`driver_id.eq.${userId},user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

async function loadEventsForShipmentIds(ids) {
  if (!ids.length) return [];

  const { data, error } = await sb
    .from("shipment_events")
    .select("*")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

function mergeShipmentsWithEvents(shipments, events) {
  const byShipment = new Map();
  for (const ev of events) {
    const sid = ev.shipment_id;
    if (!byShipment.has(sid)) byShipment.set(sid, []);
    byShipment.get(sid).push(ev);
  }

  return shipments.map((sh) => {
    const evs = byShipment.get(sh.id) ?? [];
    const last = evs.length ? evs[evs.length - 1] : null;

    // status komt liefst uit events, anders uit shipment.status (als die bestaat)
    const status = last?.event_type ?? sh.status ?? "created";
    return { ...sh, _events: evs, _status: status };
  });
}

/* ---------------- render ---------------- */

function renderShipments(items) {
  if (!listEl) return;

  if (!items.length) {
    statusEl.textContent = "Geen zendingen gevonden.";
    listEl.innerHTML = "";
    return;
  }

  statusEl.textContent = `Zendingen: ${items.length}`;

  listEl.innerHTML = items
    .map((sh) => {
      const ref = esc(bestRef(sh));
      const klant = esc(bestCustomer(sh));
      const created = fmtDT(sh.created_at ?? sh.created ?? sh.createdAt);

      const badge = badgeClass(sh._status);
      const badgeTxt = esc(statusLabel(sh._status));

      const evHtml =
        sh._events?.length
          ? `<div class="events">
              ${sh._events
                .slice()
                .reverse()
                .map((ev) => {
                  const t = fmtDT(ev.created_at ?? ev.createdAt);
                  const type = esc(ev.event_type ?? "");
                  const note = esc(ev.note ?? "");
                  return `<div class="event">
                            <span class="muted">${t}</span>
                            <span class="badge ${badgeClass(type)}">${esc(statusLabel(type))}</span>
                            <span class="muted">${note || type}</span>
                          </div>`;
                })
                .join("")}
            </div>`
          : `<div class="events muted">Nog geen events.</div>`;

      return `
        <div class="ship-card">
          <div class="row" style="justify-content:space-between;">
            <div>
              <div style="font-size:18px; font-weight:700;">#${ref}</div>
              <div class="muted">Klant: ${klant}</div>
              <div class="muted">Aangemaakt: ${esc(created)}</div>
            </div>
            <div style="display:flex; align-items:flex-start; gap:8px;">
              <span class="badge ${badge}">${badgeTxt}</span>
            </div>
          </div>

          <div class="sep"></div>

          <details>
            <summary class="btn" style="cursor:pointer;">Events</summary>
            ${evHtml}
          </details>
        </div>
      `;
    })
    .join("");
}

/* ---------------- main ---------------- */

async function init() {
  try {
    if (!sb) {
      statusEl.textContent = "Supabase client ontbreekt (supabase-config.js).";
      return;
    }

    showSkeletons();
    statusEl.textContent = "Sessie controleren…";
    const session = await requireSession();
    if (!session) return;

    // Naam rechtsboven (simpel: email of user id)
    const userLabel = session.user?.email ?? session.user?.id ?? "ingelogd";
    if (whoEl) whoEl.textContent = userLabel;

    // Logout
    logoutBtn?.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = LOGIN_URL;
    });

    // Data laden
    statusEl.textContent = "Zendingen ophalen…";
    const userId = session.user.id;

    const shipments = await loadShipmentsForDriver(userId);
    const ids = shipments.map((s) => s.id);

    statusEl.textContent = "Events ophalen…";
    const events = await loadEventsForShipmentIds(ids);

    const merged = mergeShipmentsWithEvents(shipments, events);

    hideSkeletons();
    renderShipments(merged);
  } catch (err) {
    console.error(err);
    hideSkeletons();
    statusEl.textContent = "Fout bij laden: " + (err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", init);
