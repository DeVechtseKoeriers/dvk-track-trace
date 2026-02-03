/* ==========================================================
   DVK – Track & Trace (public) + Realtime
   Bestand: dvk-track-trace/public/js/track.js
========================================================== */

console.log("track.js loaded ✅");

const sb = window.supabaseClient;

/* DOM */
const trackInput = document.getElementById("trackInput");
const trackBtn = document.getElementById("trackBtn");
const msg = document.getElementById("msg");

const result = document.getElementById("result");
const customer = document.getElementById("customer");
const statusBadge = document.getElementById("statusBadge");
const timeline = document.getElementById("timeline");

/* Realtime state */
let rtChannel = null;
let currentShipmentId = null;
let currentTrackCode = null;

function setMsg(text, isError = false) {
  msg.textContent = text || "";
  msg.style.color = isError ? "#ffb4b4" : "";
}

function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("nl-NL");
}

function badgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "created") return "badge b-created";
  if (s === "en_route") return "badge b-en_route";
  if (s === "delivered") return "badge b-delivered";
  if (s === "problem") return "badge b-problem";
  return "badge";
}

async function loadByTrackCode(code) {
  // 1) Shipment
  const { data: shipment, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at, track_code")
    .eq("track_code", code)
    .maybeSingle();

  if (shipErr) throw shipErr;
  if (!shipment) return null;

  // 2) Events
  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .eq("shipment_id", shipment.id)
    .order("created_at", { ascending: false });

  if (evErr) throw evErr;

  return { shipment, events: events || [] };
}

function render(data) {
  if (!data) {
    result.style.display = "none";
    return;
  }

  const { shipment, events } = data;

  customer.textContent = shipment.customer_name ? `Klant: ${shipment.customer_name}` : "";

  statusBadge.className = badgeClass(shipment.status);
  statusBadge.textContent = shipment.status || "-";

  timeline.innerHTML = events.length
    ? [...events]
        .reverse()
        .map(
          (e) => `
          <div class="event">
            <div class="${badgeClass(e.event_type)}">${e.event_type}</div>
            <div class="muted">${fmtDT(e.created_at)}</div>
            <div>${e.note || ""}</div>
          </div>
        `
        )
        .join("")
    : `<div class="muted">Nog geen status-updates.</div>`;

  result.style.display = "block";
}

/* ---------------------------
   Realtime helpers
---------------------------- */

async function stopRealtime() {
  if (rtChannel) {
    try {
      await rtChannel.unsubscribe();
    } catch (_) {}
    rtChannel = null;
  }
  currentShipmentId = null;
  currentTrackCode = null;
}

async function refreshCurrent() {
  // Herlaad alles “vers” op basis van trackcode (simpel & betrouwbaar)
  if (!currentTrackCode) return;
  try {
    const data = await loadByTrackCode(currentTrackCode);
    if (data) render(data);
  } catch (e) {
    console.warn("refreshCurrent failed:", e?.message);
  }
}

function startRealtimeForShipment(shipmentId) {
  // stop oude channel
  if (rtChannel) {
    rtChannel.unsubscribe().catch(() => {});
    rtChannel = null;
  }

  currentShipmentId = shipmentId;

  // Channel per zending
  rtChannel = sb
    .channel(`public-track-${shipmentId}`)
    // 1) Nieuwe/gewijzigde events
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shipment_events",
        filter: `shipment_id=eq.${shipmentId}`,
      },
      async () => {
        // Zodra er iets verandert -> refresh UI
        await refreshCurrent();
      }
    )
    // 2) Shipment status wijziging (bijv. delivered)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "shipments",
        filter: `id=eq.${shipmentId}`,
      },
      async () => {
        await refreshCurrent();
      }
    )
    .subscribe((status) => {
      // status kan zijn: SUBSCRIBED, TIMED_OUT, CLOSED, CHANNEL_ERROR
      console.log("Realtime status:", status);
    });
}

/* ---------------------------
   UI acties
---------------------------- */

async function runSearch() {
  if (!sb) {
    setMsg("Supabase client ontbreekt.", true);
    return;
  }

  const code = trackInput.value.trim().toUpperCase();
  if (!code) {
    setMsg("Vul een trackcode in.", true);
    return;
  }

  setMsg("Zoeken…");
  result.style.display = "none";

  // stop realtime van vorige zoekactie
  await stopRealtime();

  try {
    const data = await loadByTrackCode(code);
    if (!data) {
      setMsg("Geen zending gevonden.", true);
      render(null);
      return;
    }

    // Bewaar “context” voor realtime refresh
    currentTrackCode = code;

    setMsg("Gevonden ✅ (realtime actief)");
    render(data);

    // Start realtime
    startRealtimeForShipment(data.shipment.id);
  } catch (e) {
    console.error(e);
    setMsg("Fout: " + e.message, true);
  }
}

trackBtn.addEventListener("click", runSearch);
trackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

// netjes opruimen bij pagina verlaten
window.addEventListener("beforeunload", () => {
  if (rtChannel) rtChannel.unsubscribe().catch(() => {});
});
