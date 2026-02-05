/* /public/js/dashboard.js
   Chauffeur Dashboard:
   - lijst zendingen (driver_id = auth.uid())
   - status wijzigen via dropdown + velden
   - ✅ F1: nieuwe zending aanmaken (track_code leeg -> trigger maakt DVK-YYYY-0001)
   - maakt direct een shipment_event aan bij aanmaken
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // ---- DOM ----
  const shipmentsEl = document.getElementById("shipments");
  const statusMsgEl = document.getElementById("statusMsg");
  const whoamiEl = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logoutBtn");

  // F1 UI
  const newShipmentBtn = document.getElementById("newShipmentBtn");
  const newShipmentPanel = document.getElementById("newShipmentPanel");
  const newCustomerName = document.getElementById("newCustomerName");
  const newStatus = document.getElementById("newStatus");
  const createShipmentBtn = document.getElementById("createShipmentBtn");
  const cancelShipmentBtn = document.getElementById("cancelShipmentBtn");
  const newShipmentMsg = document.getElementById("newShipmentMsg");

  function setMsg(text, type = "") {
    if (!statusMsgEl) return;
    statusMsgEl.textContent = text || "";
    statusMsgEl.className = "msg " + (type || "");
  }

  function setNewMsg(text) {
    if (!newShipmentMsg) return;
    newShipmentMsg.textContent = text || "";
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("nl-NL");
  }

  const STATUS = [
    { value: "created", label: "Aangemeld" },
    { value: "en_route", label: "Onderweg" },
    { value: "delivered", label: "Afgeleverd" },
    { value: "problem", label: "Probleem" },
  ];

  function labelOf(status) {
    return (STATUS.find(s => s.value === status)?.label) || status || "-";
  }

  // ---- Auth ----
  async function requireUser() {
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    const user = data?.user;
    if (!user) {
      window.location.href = "../driver/login.html";
      return null;
    }
    return user;
  }

  async function logout() {
    try {
      await sb.auth.signOut();
      window.location.href = "../driver/login.html";
    } catch (e) {
      console.error(e);
      alert("Uitloggen mislukt (check console)");
    }
  }

  // ---- DB ----
  async function fetchShipments(driverId) {
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function updateShipmentStatus(shipmentId, newStatus) {
    const { error } = await sb
      .from("shipments")
      .update({ status: newStatus })
      .eq("id", shipmentId);

    if (error) throw error;
  }

  async function insertEvent(shipmentId, eventType, note) {
    const payload = {
      shipment_id: shipmentId,
      event_type: eventType,
      note: (note && note.trim()) ? note.trim() : null,
    };

    const { error } = await sb.from("shipment_events").insert(payload);
    if (error) throw error;
  }

  // ✅ F1: create shipment (track_code leeg laten)
  async function createShipment(driverId, customerName, startStatus) {
    // track_code niet meegeven -> trigger zet hem automatisch
    const { data, error } = await sb
      .from("shipments")
      .insert([{
        driver_id: driverId,
        customer_name: customerName,
        status: startStatus || "created",
        // track_code bewust NIET invullen
      }])
      .select("id, track_code, status, customer_name, created_at")
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // ---- UI render ----
  function renderShipments(list) {
    if (!shipmentsEl) return;

    if (!list.length) {
      shipmentsEl.innerHTML = `<div class="muted">Geen zendingen gevonden.</div>`;
      return;
    }

    shipmentsEl.innerHTML = list.map(s => {
      const options = STATUS.map(opt => `
        <option value="${esc(opt.value)}" ${opt.value === s.status ? "selected" : ""}>
          ${esc(opt.label)}
        </option>
      `).join("");

      return `
        <div class="ship-card" data-shipment-id="${esc(s.id)}">
          <div class="ship-top">
            <div>
              <div class="ship-title">${esc(s.customer_name || "Onbekend")}</div>
              <div class="muted">Trackcode: <b>${esc(s.track_code || "-")}</b></div>
              <div class="muted">Aangemaakt: ${esc(fmtDate(s.created_at))}</div>
              <div class="muted">Huidige status: <b>${esc(labelOf(s.status))}</b></div>
            </div>
          </div>

          <div class="sep" style="margin:12px 0;"></div>

          <div class="row" style="gap:10px; align-items:flex-start;">
            <div style="flex:1;">
              <div class="muted" style="margin-bottom:6px;">Status</div>
              <select class="statusSelect" style="width:100%; padding:10px; border-radius:10px;">
                ${options}
              </select>

              <div class="extra deliveredExtra" style="display:none; margin-top:10px;">
                <div class="muted" style="margin-bottom:6px;">Ontvangen door (naam)</div>
                <input class="deliveredName" type="text" placeholder="Bijv. Jan Jansen"
                       style="width:100%; padding:10px; border-radius:10px;" />
              </div>

              <div class="extra problemExtra" style="display:none; margin-top:10px;">
                <div class="muted" style="margin-bottom:6px;">Probleem / opmerking</div>
                <input class="problemNote" type="text" placeholder="Bijv. klant niet thuis"
                       style="width:100%; padding:10px; border-radius:10px;" />
              </div>
            </div>

            <div style="min-width:140px; padding-top:22px;">
              <button class="btn saveBtn" style="width:100%;">Opslaan</button>
            </div>
          </div>

          <div class="muted saveInfo" style="margin-top:10px;"></div>
        </div>
      `;
    }).join("");

    shipmentsEl.querySelectorAll(".ship-card").forEach(card => {
      const select = card.querySelector(".statusSelect");
      const saveBtn = card.querySelector(".saveBtn");
      const info = card.querySelector(".saveInfo");

      const deliveredExtra = card.querySelector(".deliveredExtra");
      const deliveredName = card.querySelector(".deliveredName");

      const problemExtra = card.querySelector(".problemExtra");
      const problemNote = card.querySelector(".problemNote");

      function updateExtras() {
        const v = select.value;
        deliveredExtra.style.display = (v === "delivered") ? "block" : "none";
        problemExtra.style.display = (v === "problem") ? "block" : "none";

        if (v !== "delivered") deliveredName.value = "";
        if (v !== "problem") problemNote.value = "";
      }

      select.addEventListener("change", updateExtras);
      updateExtras();

      saveBtn.addEventListener("click", async () => {
        const shipmentId = card.getAttribute("data-shipment-id");
        const newStatus = select.value;

        try {
          saveBtn.disabled = true;
          info.textContent = "Opslaan…";

          let note = null;

          if (newStatus === "delivered") {
            const name = (deliveredName.value || "").trim();
            if (!name) {
              info.textContent = "Vul eerst ‘Ontvangen door (naam)’ in.";
              saveBtn.disabled = false;
              return;
            }
            note = name;
          }

          if (newStatus === "problem") {
            const pn = (problemNote.value || "").trim();
            note = pn || null;
          }

          await updateShipmentStatus(shipmentId, newStatus);
          await insertEvent(shipmentId, newStatus, note);

          info.textContent = "Opgeslagen ✅";
          await refresh();

        } catch (e) {
          console.error(e);
          info.textContent = "Opslaan mislukt (check console / RLS)";
        } finally {
          saveBtn.disabled = false;
        }
      });
    });
  }

  // ---- Realtime ----
  let rt = null;
  async function startRealtime(driverId) {
    try {
      if (rt) await sb.removeChannel(rt);

      rt = sb.channel("driver_rt")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "shipments", filter: `driver_id=eq.${driverId}` },
          () => refresh()
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "shipment_events" },
          () => refresh()
        )
        .subscribe();
    } catch (e) {
      console.warn("Realtime niet gestart:", e);
    }
  }

  // ---- Init / Refresh ----
  let driverId = null;

  async function refresh() {
    if (!driverId) return;
    const list = await fetchShipments(driverId);
    renderShipments(list);
  }

  function showNewPanel(show) {
    if (!newShipmentPanel) return;
    newShipmentPanel.style.display = show ? "block" : "none";
    if (show) {
      setNewMsg("");
      newCustomerName.value = "";
      newStatus.value = "created";
      newCustomerName.focus();
    }
  }

  // ---- F1 actions ----
  async function handleCreateShipment() {
    const name = (newCustomerName.value || "").trim();
    const startStatus = (newStatus.value || "created").trim();

    if (!name) {
      setNewMsg("Vul klantnaam in.");
      return;
    }

    try {
      createShipmentBtn.disabled = true;
      setNewMsg("Aanmaken…");

      const created = await createShipment(driverId, name, startStatus);

      // meteen een eerste event aanmaken zodat timeline nooit leeg is
      await insertEvent(created.id, startStatus, null);

      setNewMsg(`Aangemaakt ✅ Trackcode: ${created.track_code}`);
      await refresh();

      // panel mag open blijven of sluiten; ik sluit hem na succes:
      setTimeout(() => showNewPanel(false), 900);
    } catch (e) {
      console.error(e);
      setNewMsg("Aanmaken mislukt (check console / RLS).");
    } finally {
      createShipmentBtn.disabled = false;
    }
  }

  (async function init() {
    try {
      const user = await requireUser();
      if (!user) return;

      driverId = user.id;
      if (whoamiEl) whoamiEl.textContent = user.email || user.id;

      logoutBtn?.addEventListener("click", logout);

      // F1 panel events
      newShipmentBtn?.addEventListener("click", () => showNewPanel(true));
      cancelShipmentBtn?.addEventListener("click", () => showNewPanel(false));
      createShipmentBtn?.addEventListener("click", handleCreateShipment);

      setMsg("Dashboard laden…", "");
      await refresh();
      await startRealtime(driverId);
      setMsg("Dashboard geladen ✅", "ok");

    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console)", "bad");
    }
  })();
})();
