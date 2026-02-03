/* ==========================================================
   DVK – Track & Trace (public)
   Bestand: public/js/track.js
========================================================== */

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
  return d.toLocaleString("nl-NL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "created") return "badge b-created";
  if (s === "en_route") return "badge b-en_route";
  if (s === "delivered") return "badge b-delivered";
  if (s === "problem") return "badge b-problem";
  return "badge";
}

async function loadByTrackCode(trackCode) {
  // 1) shipment op track_code
  const { data: shipment, error: shipErr } = await sb
    .from("shipments")
    .select("id, status, customer_name, created_at, track_code")
    .eq("track_code", trackCode)
    .maybeSingle();

  if (shipErr) throw shipErr;
  if (!shipment) return null;

  // 2) events
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

  customer.textContent = shipment.customer_name ? `Klant: ${shipment.customer_name}` : "";
  statusBadge.className = badgeClass(shipment.status);
  statusBadge.textContent = shipment.status || "-";

  if (!events || events.length === 0) {
    timeline.innerHTML = `<div class="muted">Nog geen updates.</div>`;
  } else {
    timeline.innerHTML = events
      .slice()
      .reverse()
      .map(
        (e) => `
        <div class="event">
          <div class="event-left">
            <div class="${badgeClass(e.event_type)}">${e.event_type}</div>
            <div>
              <div>${e.note || ""}</div>
              <div class="muted">${fmtDT(e.created_at)}</div>
            </div>
          </div>
        </div>
      `
      .join("");
  }

  result.style.display = "block";
}

async function runSearch() {
  const code = (trackInput.value || "").trim().toUpperCase();
  if (!code) {
    setMsg("Vul een trackcode in.", true);
    return;
  }

  setMsg("Zoeken...");
  try {
    const data = await loadByTrackCode(code);
    if (!data) {
      setMsg("Geen zending gevonden met deze trackcode.", true);
      render(null);
      return;
    }
    setMsg("Gevonden ✅");
    render(data);
  } catch (e) {
    console.error(e);
    setMsg("Fout: " + (e?.message || e), true);
    render(null);
  }
}

trackBtn.addEventListener("click", runSearch);
trackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

// Auto: ?code=DVK12345
(function preloadFromUrl() {
  const url = new URL(window.location.href);
  const code = (url.searchParams.get("code") || "").trim();
  if (code) {
    trackInput.value = code;
    runHelp();
  }
  function runHelp() {
    runSearch();
  }
})();
