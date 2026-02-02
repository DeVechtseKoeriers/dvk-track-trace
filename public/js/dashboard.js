/* ==========================================================
   DVK – Chauffeursdashboard
   Bestand: public/js/dashboard.js

   - Laadt shipments + events
   - Laat chauffeur status zetten:
       1) INSERT in shipment_events
       2) UPDATE shipments.status
   - Realtime: herlaadt bij wijzigingen
========================================================== */

/* Supabase client (gezet in supabase-config.js) */
const sb = window.supabaseClient;

/* DOM elements */
const whoEl = document.getElementById("whoami");
const logoutBtn = document.getElementById("logoutBtn");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.style.opacity = "1";
  statusEl.style.color = isError ? "var(--bad, #ef4444)" : "var(--muted, rgba(255,255,255,.62))";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* Badge class op basis van event_type/status */
function badgeClass(type) {
  const t = String(type || "").toLowerCase();
  if (t === "created") return "b-created";
  if (t === "en_route") return "b-en_route";
  if (t === "delivered") return "b-delivered";
  if (t === "problem") return "b-problem";
  return "";
}

async function requireSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;

  const session = data?.session;
  if (!session) {
    // Terug naar login/home
    window.location.href = "/dvk-track-trace/index.html";
    return null;
  }
  return session;
}

async function setWhoAmI(session) {
  if (!whoEl) return;
  whoEl.textContent = session?.user?.email || "Ingelogd";
}

/* ==========================
   Data ophalen
========================== */

async function loadShipmentsWithEvents(driverId) {
  // 1) Shipments voor deze driver
  const { data: shipments, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at")
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });

  if (shipErr) throw shipErr;

  const ids = (shipments || []).map((s) => s.id);
  if (ids.length === 0) return [];

  // 2) Events voor deze shipments
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

/* ==========================
   Status zetten (STAP 7)
   - INSERT shipment_events
   - UPDATE shipments.status
========================== */

async function setShipmentStatus({ shipmentId, eventType, note }) {
  if (!shipmentId) throw new Error("shipmentId ontbreekt");
  if (!eventType) throw new Error("eventType ontbreekt");

  // 1) INSERT event
  const { error: insErr } = await sb.from("shipment_events").insert([
    {
      shipment_id: shipmentId,
      event_type: eventType,
      note: note || null,
    },
  ]);

  if (insErr) throw insErr;

  // 2) UPDATE huidige status op shipments
  const { error: updErr } = await sb
    .from("shipments")
    .update({ status: eventType })
    .eq("id", shipmentId);

  if (updErr) throw updErr;
}

/* ==========================
   Render
========================== */

function renderShipments(rows) {
  if (!listEl) return;

  if (!rows || rows.length === 0) {
    listEl.innerHTML = `<div class="muted">Geen zendingen gevonden.</div>`;
    return;
  }

  const html = rows
    .map((s) => {
      const shortId = String(s.id).slice(0, 8);
      const curStatus = String(s.status || "").toLowerCase();

      const eventsHtml =
        (s.events || [])
          .map((e) => {
            return `
              <div class="row" style="gap:12px; margin-top:8px;">
                <span class="badge ${badgeClass(e.event_type)}">${escapeHtml(e.event_type)}</span>
                <div style="flex:1;">
                  <div>${escapeHtml(e.note || "")}</div>
                  <div class="muted">${escapeHtml(fmtDate(e.created_at))}</div>
                </div>
              </div>
            `;
          })
          .join("") || `<div class="muted" style="margin-top:8px;">Nog geen events.</div>`;

      // Actieknoppen (chauffeur)
      const btn = (type, label) => {
        const isActive = curStatus === type;
        return `
          <button
            class="btn small ${isActive ? "btn-active" : ""}"
            data-action="setStatus"
            data-id="${escapeHtml(s.id)}"
            data-type="${escapeHtml(type)}"
            ${isActive ? "disabled" : ""}
          >
            ${escapeHtml(label)}
          </button>
        `;
      };

      return `
        <div class="ship-card">
          <div class="row" style="justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:700;">#${escapeHtml(shortId)}</div>
              <div>Klant: ${escapeHtml(s.customer_name || "—")}</div>
              <div class="muted">Aangemaakt: ${escapeHtml(fmtDate(s.created_at))}</div>
            </div>
            <span class="badge ${badgeClass(s.status)}">${escapeHtml(s.status || "—")}</span>
          </div>

          <div class="sep" style="margin:12px 0;"></div>

          <div class="row" style="flex-wrap:wrap; gap:10px;">
            ${btn("created", "Aangemeld")}
            ${btn("en_route", "Onderweg")}
            ${btn("delivered", "Afgeleverd")}
            ${btn("problem", "Probleem")}
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

function bindActions() {
  if (!listEl) return;

  listEl.addEventListener("click", async (e) => {
    const el = e.target?.closest?.("[data-action]");
    if (!el) return;

    const action = el.getAttribute("data-action");
    if (action !== "setStatus") return;

    const shipmentId = el.getAttribute("data-id");
    const eventType = el.getAttribute("data-type");

    // Note automatisch invullen (mag je later aanpassen)
    const defaultNotes = {
      created: "Zending aangemeld",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld",
    };

    try {
      el.disabled = true;
      setStatus("Status opslaan...");

      await setShipmentStatus({
        shipmentId,
        eventType,
        note: defaultNotes[eventType] || null,
      });

      setStatus("Status opgeslagen.");
      // Realtime zal ook triggeren, maar we verversen meteen voor zekerheid
      await refresh();
    } catch (err) {
      console.error(err);
      setStatus(`Fout bij opslaan: ${err?.message || err}`, true);
    } finally {
      // enable gebeurt na refresh via render (button wordt disabled als status actief is)
    }
  });
}

/* ==========================
   Realtime
========================== */

let realtimeChannel = null;

function setupRealtime(driverId) {
  // Opruimen als hij al bestaat
  if (realtimeChannel) {
    try {
      sb.removeChannel(realtimeChannel);
    } catch (_) {}
    realtimeChannel = null;
  }

  realtimeChannel = sb
    .channel("dvk-driver-dashboard")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipment_events" },
      async () => {
        await refresh(false);
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shipments" },
      async (payload) => {
        // Alleen verversen als het om deze driver kan gaan (veilig: gewoon refresh)
        await refresh(false);
      }
    )
    .subscribe();
}

/* ==========================
   Refresh + init
========================== */

let currentDriverId = null;
let isRefreshing = false;

async function refresh(showLoading = true) {
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    if (showLoading) setStatus("Laden...");

    const data = await loadShipmentsWithEvents(currentDriverId);
    setStatus(`${data.length} zending(en) geladen.`);
    renderShipments(data);
  } catch (err) {
    console.error(err);
    setStatus(`Fout bij laden: ${err?.message || err}`, true);
  } finally {
    isRefreshing = false;
  }
}

async function init() {
  if (!sb) {
    setStatus("Supabase client ontbreekt (supabase-config.js).", true);
    return;
  }

  try {
    const session = await requireSession();
    if (!session) return;

    currentDriverId = session.user.id;

    await setWhoAmI(session);

    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await sb.auth.signOut();
        window.location.href = "/dvk-track-trace/index.html";
      });
    }

    bindActions();
    setupRealtime(currentDriverId);
    await refresh(true);
  } catch (err) {
    console.error(err);
    setStatus(`Init fout: ${err?.message || err}`, true);
  }
}

init();
