/* DVK Driver Dashboard - shipments + events + status update + add event
   Vereist:
   - supabase-config.js zet window.supabaseClient = supabase.createClient(URL, ANON)
   - dashboard.html heeft #status, #list, #whoami, #logoutBtn
*/

const sb = window.supabaseClient;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  // NL weergave
  return d.toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  const map = {
    created: "Aangemeld",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
  };
  return map[status] || status || "-";
}

function badgeClass(status) {
  const map = {
    created: "b-created",
    en_route: "b-en_route",
    delivered: "b-delivered",
    problem: "b-problem",
  };
  return map[status] || "b-created";
}

async function requireSession() {
  const { data } = await sb.auth.getSession();
  const session = data?.session;
  if (!session) {
    // niet ingelogd => terug naar login
    window.location.href = "/dvk-track-trace/driver/login.html";
    return null;
  }
  return session;
}

async function loadDriverName(userId) {
  // Optioneel: drivers tabel (name)
  // Als dit faalt door RLS of ontbrekende rij: we tonen gewoon email.
  try {
    const { data: driverRow } = await sb
      .from("drivers")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();

    return driverRow?.name || null;
  } catch {
    return null;
  }
}

async function loadShipmentsWithEvents(userId) {
  // Nested select: shipments + shipment_events
  const { data: shipments, error } = await sb
    .from("shipments")
    .select(`
      id,
      track_code,
      status,
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
    // sorteer events binnen elke shipment:
    .order("created_at", { ascending: false, foreignTable: "shipment_events" });

  if (error) throw error;
  return shipments || [];
}

function renderShipments(shipments) {
  const listEl = $("list");
  const statusEl = $("status");

  listEl.innerHTML = "";

  statusEl.textContent = `Gevonden: ${shipments.length} zending(en).`;

  for (const s of shipments) {
    const events = Array.isArray(s.shipment_events) ? s.shipment_events : [];
    const eventsHtml = events.length
      ? `<ul class="events">
          ${events
            .slice(0, 6)
            .map(
              (e) => `
              <li>
                <span class="badge ${badgeClass(e.event_type)}">${escapeHtml(e.event_type)}</span>
                <span class="muted">${escapeHtml(e.note || "")}</span>
                <div class="muted" style="margin-top:4px">${formatDateTime(e.created_at)}</div>
              </li>`
            )
            .join("")}
        </ul>`
      : `<div class="muted" style="margin-top:10px">Nog geen events.</div>`;

    const card = document.createElement("div");
    card.className = "ship-card";
    card.dataset.shipmentId = s.id;

    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div style="font-size:18px;font-weight:700">#${escapeHtml(s.track_code)}</div>
        <span class="badge ${badgeClass(s.status)}">${escapeHtml(statusLabel(s.status))}</span>
      </div>

      <div class="row muted" style="margin-top:6px">
        <div><strong>Klant:</strong> ${escapeHtml(s.customer_name)}</div>
      </div>

      <div class="row muted">
        <div><strong>Aangemaakt:</strong> ${formatDateTime(s.created_at)}</div>
      </div>

      <div class="sep"></div>

      <div class="row" style="gap:8px; flex-wrap:wrap">
        <select class="statusSelect">
          <option value="created" ${s.status === "created" ? "selected" : ""}>Aangemeld</option>
          <option value="en_route" ${s.status === "en_route" ? "selected" : ""}>Onderweg</option>
          <option value="delivered" ${s.status === "delivered" ? "selected" : ""}>Afgeleverd</option>
          <option value="problem" ${s.status === "problem" ? "selected" : ""}>Probleem</option>
        </select>

        <button class="btn btnUpdate">Status opslaan</button>
        <button class="btn btnEvent">Event toevoegen</button>
      </div>

      ${eventsHtml}
    `;

    listEl.appendChild(card);
  }
}

async function updateShipmentStatus(shipmentId, newStatus) {
  // 1) update shipment
  const { error: upErr } = await sb
    .from("shipments")
    .update({ status: newStatus })
    .eq("id", shipmentId);

  if (upErr) throw upErr;

  // 2) log als event (optioneel, maar superhandig)
  const note =
    newStatus === "delivered"
      ? "Zending afgeleverd"
      : newStatus === "problem"
      ? "Probleem gemeld"
      : newStatus === "en_route"
      ? "Chauffeur is onderweg"
      : "Zending aangemeld";

  const { error: evErr } = await sb
    .from("shipment_events")
    .insert([{ shipment_id: shipmentId, event_type: newStatus, note }]);

  if (evErr) throw evErr;
}

async function addCustomEvent(shipmentId) {
  const type = prompt("Event type (bijv: note / delivered / problem / en_route):", "note");
  if (!type) return;

  const note = prompt("Event omschrijving:", "");
  if (note === null) return;

  const { error } = await sb
    .from("shipment_events")
    .insert([{ shipment_id: shipmentId, event_type: type.trim(), note: (note || "").trim() }]);

  if (error) throw error;
}

function wireCardActions() {
  const listEl = $("list");

  listEl.addEventListener("click", async (e) => {
    const btn = e.target;
    const card = btn.closest(".ship-card");
    if (!card) return;

    const shipmentId = card.dataset.shipmentId;
    const statusSelect = card.querySelector(".statusSelect");

    try {
      if (btn.classList.contains("btnUpdate")) {
        btn.disabled = true;
        btn.textContent = "Opslaan...";
        await updateShipmentStatus(shipmentId, statusSelect.value);
        await refreshDashboard();
      }

      if (btn.classList.contains("btnEvent")) {
        btn.disabled = true;
        btn.textContent = "Toevoegen...";
        await addCustomEvent(shipmentId);
        await refreshDashboard();
      }
    } catch (err) {
      console.error(err);
      alert("Actie mislukt: " + (err?.message || String(err)));
    } finally {
      if (btn && btn.classList) {
        btn.disabled = false;
        if (btn.classList.contains("btnUpdate")) btn.textContent = "Status opslaan";
        if (btn.classList.contains("btnEvent")) btn.textContent = "Event toevoegen";
      }
    }
  });
}

async function refreshDashboard() {
  const statusEl = $("status");
  statusEl.textContent = "Verversing...";

  const session = await requireSession();
  if (!session) return;

  const userId = session.user.id;

  const shipments = await loadShipmentsWithEvents(userId);
  renderShipments(shipments);
}

async function init() {
  if (!sb) {
    alert("Supabase client ontbreekt. Check supabase-config.js (window.supabaseClient).");
    return;
  }

  const statusEl = $("status");
  const whoEl = $("whoami");
  const logoutBtn = $("logoutBtn");

  statusEl.textContent = "Laden...";

  const session = await requireSession();
  if (!session) return;

  const userId = session.user.id;

  // Naam rechtsboven
  const driverName = await loadDriverName(userId);
  whoEl.textContent = driverName || session.user.email || "Ingelogd";

  // Logout
  logoutBtn?.addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "/dvk-track-trace/driver/login.html";
  });

  // acties op kaarten
  wireCardActions();

  // eerste load
  try {
    statusEl.textContent = "Zendingen + events ophalen...";
    const shipments = await loadShipmentsWithEvents(userId);
    renderShipments(shipments);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Fout bij laden: " + (err?.message || String(err));
  }
}

document.addEventListener("DOMContentLoaded", init);
