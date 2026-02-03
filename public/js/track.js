/* ==========================================================
   DVK – Track & Trace (public)
   public/js/track.js
========================================================== */

console.log("track.js loaded ✅");

const sb = window.supabaseClient;

const trackInput = document.getElementById("trackInput");
const trackBtn = document.getElementById("trackBtn");
const msg = document.getElementById("msg");

const result = document.getElementById("result");
const customer = document.getElementById("customer");
const statusBadge = document.getElementById("statusBadge");
const timeline = document.getElementById("timeline");

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
  const { data: shipment, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at, track_code")
    .eq("track_code", code)
    .maybeSingle();

  if (shipErr) throw shipErr;
  if (!shipment) return null;

  const { data: events, error: evErr } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .eq("shipment_id", shipment.id)
    .order("created_at", { ascending: true });

  if (evErr) throw evErr;

  return { shipment, events: events || [] };
}

function render(data) {
  if (!data) {
    result.style.display = "none";
    return;
  }

  const { shipment, events } = data;

  customer.textContent = shipment.customer_name
    ? `Klant: ${shipment.customer_name}`
    : "";

  statusBadge.className = badgeClass(shipment.status);
  statusBadge.textContent = shipment.status || "-";

  timeline.innerHTML = events.length
    ? events
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

  try {
    const data = await loadByTrackCode(code);
    if (!data) {
      setMsg("Geen zending gevonden.", true);
      render(null);
      return;
    }

    setMsg("Gevonden ✅");
    render(data);
  } catch (e) {
    console.error(e);
    setMsg("Fout: " + e.message, true);
  }
}

trackBtn.addEventListener("click", runSearch);
trackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});
