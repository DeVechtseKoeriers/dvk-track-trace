/* public/js/dashboard.js
   Chauffeur Dashboard:
   - laadt shipments voor driver_id
   - status wijzigen via knoppen
   - schrijft altijd een shipment_event
   - bij delivered vraagt om ontvangernaam en zet dat in note
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // ====== DOM (pas aan als jouw ids anders zijn) ======
  const listEl = document.getElementById("shipments");
  const driverIdEl = document.getElementById("driverId"); // verborgen input of data-veld
  const statusEl = document.getElementById("statusMsg");

  function setMsg(text, type = "") {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "msg " + (type || "");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ====== Status mapping ======
  const statusMap = {
    created: { title: "Aangemeld" },
    en_route: { title: "Onderweg" },
    delivered: { title: "Afgeleverd" },
    problem: { title: "Probleem" },
  };

  function statusLabel(code) {
    return statusMap[code]?.title || code || "";
  }

  // ====== DriverId bepalen ======
  // Optie A: driverId in hidden input (#driverId)
  // Optie B: driverId in localStorage ("driver_id")
  function getDriverId() {
    const fromEl = driverIdEl?.value?.trim();
    if (fromEl) return fromEl;

    const fromLS = localStorage.getItem("driver_id");
    if (fromLS) return fromLS;

    return "";
  }

  // ====== Data ======
  async function loadShipments(driverId) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function insertEvent({ shipmentId, eventType, note }) {
    const payload = {
      shipment_id: shipmentId,
      event_type: eventType,
      note: note || null,
    };

    const { error } = await sb.from("shipment_events").insert(payload);
    if (error) throw error;
  }

  async function updateShipmentStatus({ shipmentId, newStatus }) {
    const { error } = await sb
      .from("shipments")
      .update({ status: newStatus })
      .eq("id", shipmentId);

    if (error) throw error;
  }

  // ====== UI ======
  function renderShipments(items) {
    if (!listEl) return;

    if (!items.length) {
      listEl.innerHTML = `<div class="muted">Geen zendingen gevonden.</div>`;
      return;
    }

    listEl.innerHTML = items
      .map((s) => {
        return `
          <div class="ship-card">
            <div class="ship-top">
              <div>
                <div class="ship-title">#${escapeHtml((s.id || "").slice(0, 8))}</div>
                <div class="muted">Klant: ${escapeHtml(s.customer_name || "")}</div>
                <div class="muted">Trackcode: ${escapeHtml(s.track_code || "")}</div>
              </div>
              <div class="status-pill">
                <div class="status-big">${escapeHtml(statusLabel(s.status))}</div>
              </div>
            </div>

            <div class="row" style="margin-top:12px; gap:10px;">
              <button class="btn" data-action="created" data-id="${escapeHtml(s.id)}">Aangemeld</button>
              <button class="btn" data-action="en_route" data-id="${escapeHtml(s.id)}">Onderweg</button>
              <button class="btn" data-action="delivered" data-id="${escapeHtml(s.id)}">Afgeleverd</button>
              <button class="btn" data-action="problem" data-id="${escapeHtml(s.id)}">Probleem</button>
            </div>
          </div>
        `;
      })
      .join("");

    // events
    listEl.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const shipmentId = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        await handleStatusChange(shipmentId, action);
      });
    });
  }

  // ====== Status change handler ======
  async function handleStatusChange(shipmentId, newStatus) {
    try {
      setMsg("Bezig…", "");

      let note = "";

      // ✅ bij afgeleverd vragen we ontvanger
      if (newStatus === "delivered") {
        note = prompt("Ontvangen door (naam ontvanger):", "") || "";
        note = note.trim();
        if (!note) {
          setMsg("Afgebroken: geen ontvanger ingevuld.", "bad");
          return;
        }
      }

      // 1) shipment status updaten
      await updateShipmentStatus({ shipmentId, newStatus });

      // 2) event schrijven (altijd!)
      await insertEvent({ shipmentId, eventType: newStatus, note });

      // 3) lijst herladen
      const driverId = getDriverId();
      const shipments = await loadShipments(driverId);
      renderShipments(shipments);

      setMsg("Opgeslagen ✅", "ok");
    } catch (e) {
      console.error(e);
      setMsg("Opslaan mislukt (check console)", "bad");
    }
  }

  // ====== Init ======
  async function init() {
    const driverId = getDriverId();
    if (!driverId) {
      setMsg("Driver ID ontbreekt. (Geen zendingen zichtbaar)", "bad");
      return;
    }

    try {
      const shipments = await loadShipments(driverId);
      renderShipments(shipments);
      setMsg("Dashboard geladen ✅", "ok");
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console)", "bad");
    }
  }

  init();
})();
