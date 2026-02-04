/* public/js/driver.js
   Chauffeur dashboard – status wijzigen + timeline events + realtime refresh
   Vereist:
   - supabase-config.js zet window.supabaseClient (sb)
   - In dashboard.html:
       <div id="shipmentsCount"></div>  (optioneel)
       <div id="shipments"></div>       (verplicht)
*/

const sb = window.supabaseClient;
if (!sb) {
  console.error("❌ supabaseClient ontbreekt. Laad eerst supabase-config.js");
}

// -------------------- Helpers --------------------
function $(sel) { return document.querySelector(sel); }

function setMsg(text, type = "") {
  const el = $("#statusMsg");
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg " + (type || "");
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("nl-NL", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function labelFor(type) {
  const map = {
    created:   { title: "created",   text: "Zending aangemeld" },
    en_route:  { title: "en_route",  text: "Chauffeur is onderweg" },
    delivered: { title: "delivered", text: "Zending afgeleverd" },
    problem:   { title: "problem",   text: "Probleem gemeld" },
  };
  return map[type] || { title: type, text: type };
}

function badgeClass(status) {
  if (status === "delivered") return "ok";
  if (status === "problem") return "bad";
  if (status === "en_route") return "warn";
  return "";
}

// -------------------- Auth / Session --------------------
async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  const session = data?.session;
  if (!session) {
    // terug naar login (pas pad aan als jouw login elders staat)
    window.location.href = "../driver/login.html";
    return null;
  }
  return session;
}

// -------------------- Data load --------------------
async function loadShipmentsWithEvents(driverId) {
  // 1) shipments
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, track_code, customer_name, created_at, updated_at, driver_id")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (shipErr) throw shipErr;

  const ids = (shipments || []).map(s => s.id);
  if (ids.length === 0) return [];

  // 2) events (voor timeline)
  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .in("shipment_id", ids)
    .order("created_at", { ascending: true });

  if (evErr) throw evErr;

  const byShip = new Map();
  for (const e of (events || [])) {
    const arr = byShip.get(e.shipment_id) || [];
    arr.push(e);
    byShip.set(e.shipment_id, arr);
  }

  return (shipments || []).map(s => ({
    ...s,
    events: byShip.get(s.id) || []
  }));
}

// -------------------- Update + event insert --------------------
async function setShipmentStatus(shipmentId, newStatus, note = null) {
  // Update shipments.status
  const { error: upErr } = await sb
    .from("shipments")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", shipmentId);

  if (upErr) throw upErr;

  // Insert shipment_events row (timeline)
  const { error: evErr } = await sb
    .from("shipment_events")
    .insert([{
      shipment_id: shipmentId,
      event_type: newStatus,
      note: note || null
    }]);

  if (evErr) throw evErr;
}

// -------------------- UI render --------------------
function renderShipments(list) {
  const wrap = $("#shipments");
  if (!wrap) {
    console.error("❌ #shipments container ontbreekt in dashboard.html");
    return;
  }

  const countEl = $("#shipmentsCount");
  if (countEl) countEl.textContent = `${list.length} zending(en) geladen.`;

  wrap.innerHTML = "";

  for (const s of list) {
    const status = s.status || "created";
    const bc = badgeClass(status);

    const card = document.createElement("div");
    card.className = "ship-card";
    card.dataset.shipmentId = s.id;

    card.innerHTML = `
      <div class="ship-head">
        <div class="ship-left">
          <div class="ship-id">#${String(s.id).slice(0, 8)}</div>
          <div class="ship-cust">Klant: ${s.customer_name || "-"}</div>
          <div class="ship-track">Trackcode: ${s.track_code || "-"}</div>
          <div class="ship-created">Aangemaakt: ${fmtDate(s.created_at)}</div>
        </div>
        <div class="ship-right">
          <span class="badge ${bc}">${status}</span>
        </div>
      </div>

      <div class="ship-actions">
        <button class="btnStatus" data-status="created">Aangemeld</button>
        <button class="btnStatus" data-status="en_route">Onderweg</button>
        <button class="btnStatus" data-status="delivered">Afgeleverd</button>
        <button class="btnStatus" data-status="problem">Probleem</button>
      </div>

      <div class="ship-timeline">
        <div class="timeline-title">Timeline</div>
        <div class="timeline-list">
          ${
            (s.events && s.events.length)
              ? s.events.map(e => {
                  const L = labelFor(e.event_type);
                  const note = e.note ? `<div class="tl-note">${e.note}</div>` : "";
                  return `
                    <div class="tl-row">
                      <div class="tl-type">${L.title}</div>
                      <div class="tl-text">${L.text}${note}</div>
                      <div class="tl-date">${fmtDate(e.created_at)}</div>
                    </div>
                  `;
                }).join("")
              : `<div class="tl-empty">Geen events gevonden.</div>`
          }
        </div>
      </div>
    `;

    // Klik handlers per kaart
    card.querySelectorAll(".btnStatus").forEach(btn => {
      btn.addEventListener("click", async () => {
        const newStatus = btn.dataset.status;
        try {
          setMsg("Opslaan...", "warn");

          let note = null;
          if (newStatus === "problem") {
            note = prompt("Wat is het probleem? (optioneel)") || null;
          }

          await setShipmentStatus(s.id, newStatus, note);
          setMsg("Opgeslagen ✅", "ok");

          // Direct herladen zodat je het meteen ziet
          await refresh();
        } catch (err) {
          console.error(err);
          setMsg("Fout bij opslaan (check console / RLS policies).", "bad");
          alert("Fout bij opslaan. Check console.");
        }
      });
    });

    wrap.appendChild(card);
  }
}

// -------------------- Realtime --------------------
let rtChannel = null;

function setupRealtime(driverId) {
  try {
    if (rtChannel) sb.removeChannel(rtChannel);

    rtChannel = sb.channel("driver-dashboard-rt");

    // shipments updates (status)
    rtChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments", filter: `driver_id=eq.${driverId}` },
      () => refresh()
    );

    // events inserts/updates
    rtChannel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events" },
      () => refresh()
    );

    rtChannel.subscribe();
  } catch (e) {
    console.warn("Realtime kon niet starten:", e);
  }
}

// -------------------- Main --------------------
let currentDriverId = null;
let isRefreshing = false;

async function refresh() {
  if (!currentDriverId || isRefreshing) return;
  isRefreshing = true;
  try {
    const list = await loadShipmentsWithEvents(currentDriverId);
    renderShipments(list);
  } finally {
    isRefreshing = false;
  }
}

(async function init() {
  try {
    const session = await requireSession();
    if (!session) return;

    currentDriverId = session.user.id;

    setMsg("", "");
    await refresh();
    setupRealtime(currentDriverId);
  } catch (err) {
    console.error(err);
    setMsg("Fout bij laden (check console).", "bad");
  }
})();
