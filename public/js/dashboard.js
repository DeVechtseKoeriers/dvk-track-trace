/* ==========================================================
   DVK – Chauffeursdashboard
   Bestand: public/js/dashboard.js
   Stap A2: Afgeleverd -> naam ontvanger verplicht
   ========================================================== */

/* Supabase client (gezet in supabase-config.js) */
const sb = window.supabaseClient;

/* DOM elements */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

/* Skeleton helpers */
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

function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.style.color = isError ? "#ffb4b4" : "";
}

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id) {
  if (!id) return "";
  return String(id).slice(0, 8);
}

/* -------------------------
   Auth helpers
------------------------- */
async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session) {
    window.location.href = "/dvk-track-trace/driver/index.html";
    return null;
  }
  return session;
}

async function loadDriverName(session) {
  return session?.user?.email || "Ingelogd";
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "/dvk-track-trace/driver/index.html";
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
   Status update + event insert
------------------------- */
const STATUS_META = {
  created: { label: "Aangemeld", noteDefault: "Zending aangemeld" },
  en_route: { label: "Onderweg", noteDefault: "Chauffeur is onderweg" },
  delivered: { label: "Afgeleverd", noteDefault: "Zending afgeleverd" },
  problem: { label: "Probleem", noteDefault: "Probleem gemeld" },
};

async function updateShipmentStatus(shipmentId, newStatus, note) {
  const { error: upErr } = await sb
    .from("shipments")
    .update({ status: newStatus })
    .eq("id", shipmentId);

  if (upErr) throw upErr;

  const { error: insErr } = await sb
    .from("shipment_events")
    .insert([
      {
        shipment_id: shipmentId,
        event_type: newStatus,
        note: note || STATUS_META[newStatus]?.noteDefault || "",
      },
    ]);

  if (insErr) throw insErr;
}

/* -------------------------
   UI rendering
------------------------- */
function badgeClass(status) {
  return `badge b-${status}`;
}

function renderEvents(events) {
  if (!events || events.length === 0) return `<div class="muted">Nog geen events</div>`;
  return `
    <div class="events">
      ${events
        .map(
          (e) => `
        <div class="row" style="justify-content:space-between; gap:14px;">
          <div>
            <div class="${badgeClass(e.event_type)}">${e.event_type}</div>
            <div class="muted" style="margin-top:6px;">${e.note || ""}</div>
          </div>
          <div class="muted" style="white-space:nowrap;">${fmtDT(e.created_at)}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderActionButtons(shipment) {
  return `
    <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap;">
      <button class="btn" data-action="status" data-status="created" data-ship="${shipment.id}">Aangemeld</button>
      <button class="btn" data-action="status" data-status="en_route" data-ship="${shipment.id}">Onderweg</button>
      <button class="btn" data-action="status" data-status="delivered" data-ship="${shipment.id}">Afgeleverd</button>
      <button class="btn" data-action="status" data-status="problem" data-ship="${shipment.id}">Probleem</button>
    </div>
  `;
}

function renderShipmentCard(shipment) {
  const status = shipment.status || "";
  return `
    <div class="ship-card">
      <div class="row" style="justify-content:space-between; align-items:flex-start;">
        <div>
          <div style="font-weight:800; font-size:18px;">#${shortId(shipment.id)}</div>
          <div style="margin-top:4px;">Klant: <strong>${shipment.customer_name || "-"}</strong></div>
          <div class="muted" style="margin-top:4px;">Aangemaakt: ${fmtDT(shipment.created_at)}</div>
        </div>
        <div class="${badgeClass(status)}" style="align-self:flex-start;">${status || "-"}</div>
      </div>

      ${renderActionButtons(shipment)}

      <div class="sep" style="margin-top:14px;"></div>

      ${renderEvents(shipment.events)}
    </div>
  `;
}

/* -------------------------
   Status flow (A2)
   - Confirm altijd
   - Problem: note verplicht
   - Delivered: ontvanger naam verplicht + extra notitie optioneel
------------------------- */
function askRequired(promptText) {
  const v = (window.prompt(promptText, "") || "").trim();
  return v;
}

async function handleStatusClick(shipmentId, newStatus) {
  const meta = STATUS_META[newStatus] || { label: newStatus, noteDefault: "" };

  // 1) Confirm
  const ok = window.confirm(`Status wijzigen naar: "${meta.label}"?`);
  if (!ok) return;

  // 2) Note bouwen
  let note = meta.noteDefault || "";

  if (newStatus === "problem") {
    const problemText = askRequired("Probleem omschrijving (verplicht):");
    if (!problemText) {
      alert("Probleem omschrijving is verplicht.");
      return;
    }
    note = problemText;
  }

  if (newStatus === "delivered") {
    // A2: Naam ontvanger verplicht
    const receiver = askRequired("Naam ontvanger (verplicht):");
    if (!receiver) {
      alert("Naam ontvanger is verplicht.");
      return;
    }

    // Extra notitie optioneel
    const extra = (window.prompt("Extra notitie (optioneel):", "") || "").trim();

    // Note formaat dat je later makkelijk kan parsen/tonen
    note = extra
      ? `Ontvangen door: ${receiver} — Notitie: ${extra}`
      : `Ontvangen door: ${receiver}`;
  }

  // 3) Save
  setStatus("Status bijwerken...");
  try {
    await updateShipmentStatus(shipmentId, newStatus, note);
    setStatus("Status bijgewerkt ✅");
  } catch (e) {
    console.error(e);
    setStatus("Fout bij status update: " + (e?.message || e), true);
  }
}

/* -------------------------
   Realtime subscriptions
------------------------- */
let realtimeChannel = null;

function startRealtime(driverId) {
  realtimeChannel = sb
    .channel("dvk-driver-dashboard")
    .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, (payload) => {
      const row = payload.new || payload.old;
      if (row?.driver_id === driverId) {
        refresh(driverId, { silent: true });
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, () => {
      refresh(driverId, { silent: true });
    })
    .subscribe();
}

/* -------------------------
   Main refresh
------------------------- */
async function refresh(driverId, opts = {}) {
  if (!opts.silent) showSkeletons();
  try {
    const rows = await loadShipmentsWithEvents(driverId);
    if (listEl) listEl.innerHTML = rows.map(renderShipmentCard).join("");
    setStatus(`${rows.length} zending(en) geladen.`);
  } catch (e) {
    console.error(e);
    setStatus("Fout bij laden: " + (e?.message || e), true);
  } finally {
    hideSkeletons();
  }
}

/* -------------------------
   Event delegation
------------------------- */
document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-action='status']");
  if (!btn) return;

  const shipmentId = btn.getAttribute("data-ship");
  const newStatus = btn.getAttribute("data-status");
  if (!shipmentId || !newStatus) return;

  await handleStatusClick(shipmentId, newStatus);
});

/* -------------------------
   Init
------------------------- */
(async function init() {
  try {
    showSkeletons();
    const session = await requireSession();
    if (!session) return;

    const email = await loadDriverName(session);
    if (whoEl) whoEl.textContent = email;

    if (logoutBtn) logoutBtn.addEventListener("click", signOut);

    const driverId = session.user.id;

    await refresh(driverId);
    startRealtime(driverId);
  } catch (e) {
    console.error(e);
    setStatus("Init fout: " + (e?.message || e), true);
    hideSkeletons();
  }
})();
