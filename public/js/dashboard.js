/* ==========================================================
   DVK – Chauffeursdashboard
   Bestand: public/js/dashboard.js

   A2.4 Afgeleverd:
   - Ontvanger verplicht
   - Locatie dropdown verplicht
   - Handtekening (tekst) verplicht
   - Extra notitie optioneel

   Probleem (A2.3) blijft:
   - Categorie dropdown verplicht
   - Omschrijving verplicht
========================================================== */

const sb = window.supabaseClient;

const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

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
  return String(id || "").slice(0, 8);
}

function badgeClass(status) {
  return `badge b-${String(status || "").toLowerCase()}`;
}

/* -------------------------
   Auth
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

async function signOut() {
  await sb.auth.signOut();
  window.location.href = "/dvk-track-trace/driver/index.html";
}

/* -------------------------
   Data
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

async function updateShipmentStatus(shipmentId, newStatus, note) {
  const { error: upErr } = await sb
    .from("shipments")
    .update({ status: newStatus })
    .eq("id", shipmentId);

  if (upErr) throw upErr;

  const { error: insErr } = await sb.from("shipment_events").insert([
    {
      shipment_id: shipmentId,
      event_type: newStatus,
      note: note || null,
    },
  ]);

  if (insErr) throw insErr;
}

/* -------------------------
   UI state
------------------------- */
const openPanel = new Map(); // shipmentId -> "delivered" | "problem" | null
let currentDriverId = null;
let isSaving = false;

/* -------------------------
   Render
------------------------- */
function renderEvents(events) {
  if (!events || events.length === 0) return `<div class="muted">Nog geen events</div>`;
  const newestFirst = [...events].reverse();

  return `
    <div class="events">
      ${newestFirst
        .slice(0, 6)
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

/* A2.4: delivered panel met echte dropdown + signature text */
function renderDeliveredPanel(shipmentId, isOpen) {
  return `
    <div class="panel" data-panel="delivered" style="display:${isOpen ? "block" : "none"};">
      <div class="field">
        <div class="label">Naam ontvanger (verplicht)</div>
        <input class="input" type="text" data-delivered-receiver placeholder="Bijv. J. Jansen" />
      </div>

      <div class="field">
        <div class="label">Afleverlocatie (verplicht)</div>
        <select class="select" data-delivered-location>
          <option value="">Kies locatie…</option>
          <option value="voordeur">Voordeur</option>
          <option value="buren">Buren</option>
          <option value="receptie">Receptie</option>
          <option value="pakketbox">Pakketbox</option>
        </select>
      </div>

      <div class="field">
        <div class="label">Handtekening (verplicht)</div>
        <input class="input" type="text" data-delivered-signature placeholder="Typ naam als handtekening (bijv. Jan Jansen)" />
        <div class="help">Dit is een tekst-handtekening voor bewijs (later kunnen we dit vervangen door echte handtekening/foto).</div>
      </div>

      <div class="field">
        <div class="label">Extra notitie (optioneel)</div>
        <textarea class="textarea" data-delivered-note placeholder="Bijv. achter het huis, hond in tuin…"></textarea>
      </div>

      <div class="panel-actions">
        <button class="btn ok" data-action="saveDelivered" data-ship="${shipmentId}">Opslaan (Afgeleverd)</button>
        <button class="btn secondary" data-action="cancelPanel" data-ship="${shipmentId}">Annuleren</button>
      </div>
    </div>
  `;
}

/* A2.3: problem panel */
function renderProblemPanel(shipmentId, isOpen) {
  return `
    <div class="panel" data-panel="problem" style="display:${isOpen ? "block" : "none"};">
      <div class="field">
        <div class="label">Probleem categorie (verplicht)</div>
        <select class="select" data-problem-category>
          <option value="">Kies categorie…</option>
          <option value="customer_not_home">Klant niet thuis</option>
          <option value="wrong_address">Verkeerd adres</option>
          <option value="damaged">Schade</option>
          <option value="access_blocked">Toegang geblokkeerd</option>
          <option value="other">Anders</option>
        </select>
      </div>

      <div class="field">
        <div class="label">Omschrijving (verplicht)</div>
        <textarea class="textarea" data-problem-note placeholder="Omschrijf wat er aan de hand is…"></textarea>
      </div>

      <div class="panel-actions">
        <button class="btn bad" data-action="saveProblem" data-ship="${shipmentId}">Opslaan (Probleem)</button>
        <button class="btn secondary" data-action="cancelPanel" data-ship="${shipmentId}">Annuleren</button>
      </div>
    </div>
  `;
}

function renderActionButtons(shipment) {
  const sid = shipment.id;
  const open = openPanel.get(sid) || null;

  return `
    <div class="row" style="gap:10px; margin-top:12px; flex-wrap:wrap;">
      <button class="btn" data-action="quickStatus" data-status="created" data-ship="${sid}">Aangemeld</button>
      <button class="btn" data-action="quickStatus" data-status="en_route" data-ship="${sid}">Onderweg</button>

      <button class="btn ok" data-action="openPanel" data-panel="delivered" data-ship="${sid}">
        Afgeleverd…
      </button>
      <button class="btn bad" data-action="openPanel" data-panel="problem" data-ship="${sid}">
        Probleem…
      </button>
    </div>

    ${renderDeliveredPanel(sid, open === "delivered")}
    ${renderProblemPanel(sid, open === "problem")}
  `;
}

function renderShipmentCard(shipment) {
  const status = shipment.status || "";

  return `
    <div class="ship-card" data-ship-card="${shipment.id}">
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
   Refresh
------------------------- */
async function refresh(opts = { silent: false }) {
  if (!opts.silent) setStatus("Laden...");
  try {
    const rows = await loadShipmentsWithEvents(currentDriverId);
    if (listEl) listEl.innerHTML = rows.map(renderShipmentCard).join("");
    setStatus(`${rows.length} zending(en) geladen.`);
  } catch (e) {
    console.error(e);
    setStatus("Fout bij laden: " + (e?.message || e), true);
  }
}

/* -------------------------
   Realtime
------------------------- */
let realtimeChannel = null;

function startRealtime(driverId) {
  realtimeChannel = sb
    .channel("dvk-driver-dashboard")
    .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, (payload) => {
      const row = payload.new || payload.old;
      if (row?.driver_id === driverId) refresh({ silent: true });
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "shipment_events" }, () => {
      refresh({ silent: true });
    })
    .subscribe();
}

/* -------------------------
   Actions
------------------------- */
function getCard(shipmentId) {
  return document.querySelector(`[data-ship-card="${shipmentId}"]`);
}

async function doQuickStatus(shipmentId, status) {
  if (isSaving) return;
  const ok = window.confirm(`Status wijzigen naar "${status}"?`);
  if (!ok) return;

  const defaults = {
    created: "Zending aangemeld",
    en_route: "Chauffeur is onderweg",
  };

  isSaving = true;
  setStatus("Opslaan...");
  try {
    await updateShipmentStatus(shipmentId, status, defaults[status] || null);
    setStatus("Opgeslagen ✅");
    openPanel.set(shipmentId, null);
    await refresh({ silent: true });
  } catch (e) {
    console.error(e);
    setStatus("Fout: " + (e?.message || e), true);
  } finally {
    isSaving = false;
  }
}

/* A2.4 save delivered */
async function saveDelivered(shipmentId) {
  if (isSaving) return;
  const card = getCard(shipmentId);
  if (!card) return;

  const receiver = (card.querySelector("[data-delivered-receiver]")?.value || "").trim();
  const location = (card.querySelector("[data-delivered-location]")?.value || "").trim();
  const signature = (card.querySelector("[data-delivered-signature]")?.value || "").trim();
  const extraNote = (card.querySelector("[data-delivered-note]")?.value || "").trim();

  if (!receiver) return alert("Naam ontvanger is verplicht.");
  if (!location) return alert("Afleverlocatie is verplicht.");
  if (!signature) return alert("Handtekening (tekst) is verplicht.");

  const note = extraNote
    ? `Ontvangen door: ${receiver} | Locatie: ${location} | Handtekening: ${signature} | Notitie: ${extraNote}`
    : `Ontvangen door: ${receiver} | Locatie: ${location} | Handtekening: ${signature}`;

  isSaving = true;
  setStatus("Opslaan (Afgeleverd)...");
  try {
    await updateShipmentStatus(shipmentId, "delivered", note);
    setStatus("Afgeleverd opgeslagen ✅");
    openPanel.set(shipmentId, null);
    await refresh({ silent: true });
  } catch (e) {
    console.error(e);
    setStatus("Fout: " + (e?.message || e), true);
  } finally {
    isSaving = false;
  }
}

/* A2.3 save problem */
async function saveProblem(shipmentId) {
  if (isSaving) return;
  const card = getCard(shipmentId);
  if (!card) return;

  const category = (card.querySelector("[data-problem-category]")?.value || "").trim();
  const noteText = (card.querySelector("[data-problem-note]")?.value || "").trim();

  if (!category) return alert("Probleem categorie is verplicht.");
  if (!noteText) return alert("Omschrijving is verplicht.");

  const note = `Categorie: ${category} | Omschrijving: ${noteText}`;

  isSaving = true;
  setStatus("Opslaan (Probleem)...");
  try {
    await updateShipmentStatus(shipmentId, "problem", note);
    setStatus("Probleem opgeslagen ✅");
    openPanel.set(shipmentId, null);
    await refresh({ silent: true });
  } catch (e) {
    console.error(e);
    setStatus("Fout: " + (e?.message || e), true);
  } finally {
    isSaving = false;
  }
}

/* -------------------------
   Delegation
------------------------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;

  const action = el.getAttribute("data-action");
  const shipmentId = el.getAttribute("data-ship");

  if (action === "openPanel") {
    const panel = el.getAttribute("data-panel");
    openPanel.set(shipmentId, panel);
    await refresh({ silent: true });
    return;
  }

  if (action === "cancelPanel") {
    openPanel.set(shipmentId, null);
    await refresh({ silent: true });
    return;
  }

  if (action === "quickStatus") {
    const status = el.getAttribute("data-status");
    await doQuickStatus(shipmentId, status);
    return;
  }

  if (action === "saveDelivered") {
    await saveDelivered(shipmentId);
    return;
  }

  if (action === "saveProblem") {
    await saveProblem(shipmentId);
    return;
  }
});

/* -------------------------
   Init
------------------------- */
(async function init() {
  try {
    const session = await requireSession();
    if (!session) return;

    currentDriverId = session.user.id;

    if (whoEl) whoEl.textContent = session?.user?.email || "Ingelogd";
    if (logoutBtn) logoutBtn.addEventListener("click", signOut);

    await refresh({ silent: false });
    startRealtime(currentDriverId);
  } catch (e) {
    console.error(e);
    setStatus("Init fout: " + (e?.message || e), true);
  }
})();
