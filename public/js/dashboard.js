/* public/js/dashboard.js
   Chauffeur dashboard: CRUD shipments + events (RLS veilig)
   - Trackcode auto: DVK-YYYY-0001 oplopend per jaar
   - Na aanmaken: kun je wijzigen (Optie A)
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check public/js/supabase-config.js");
    return;
  }

  // --- DOM
  const userEmailEl = document.getElementById("userEmail");
  const msgEl = document.getElementById("msg");
  const logoutBtn = document.getElementById("logoutBtn");

  const newBtn = document.getElementById("newBtn");
  const formCard = document.getElementById("formCard");
  const formTitle = document.getElementById("formTitle");
  const cancelBtn = document.getElementById("cancelBtn");
  const saveBtn = document.getElementById("saveBtn");

  const shipmentsBody = document.getElementById("shipmentsBody");

  const customerName = document.getElementById("customerName");
  const customerPhone = document.getElementById("customerPhone");
  const customerAddress = document.getElementById("customerAddress");
  const packageDesc = document.getElementById("packageDesc");
  const colli = document.getElementById("colli");
  const weightKg = document.getElementById("weightKg");
  const status = document.getElementById("status");
  const receivedBy = document.getElementById("receivedBy");
  const trackPreview = document.getElementById("trackPreview");

  // --- State
  let session = null;
  let currentUser = null;
  let editingShipment = null; // object of shipment

  function setMsg(text = "", type = "") {
    msgEl.textContent = text;
    msgEl.className = "msg " + (type ? `msg-${type}` : "");
  }

  function statusNL(code) {
    const map = {
      created: "Aangemeld",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
    };
    return map[code] || code || "-";
  }

  function pad4(n) {
    return String(n).padStart(4, "0");
  }

  function yearNow() {
    return new Date().getFullYear();
  }

  async function requireAuth() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    session = data.session;
    if (!session) {
      // terug naar login
      window.location.href = "./login.html";
      return false;
    }

    currentUser = session.user;
    userEmailEl.textContent = currentUser.email || "";
    console.log("[DVK] sessie actief:", currentUser.email);
    return true;
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "./login.html";
  }

  function openForm(mode, shipment = null) {
    formCard.style.display = "block";
    editingShipment = shipment;

    if (mode === "new") {
      formTitle.textContent = "Nieuwe zending";
      customerName.value = "";
      customerPhone.value = "";
      customerAddress.value = "";
      packageDesc.value = "";
      colli.value = "";
      weightKg.value = "";
      status.value = "created";
      receivedBy.value = "";
      trackPreview.textContent = "Trackcode wordt automatisch gemaakt (DVK-YYYY-0001).";
    } else {
      formTitle.textContent = "Zending wijzigen";
      customerName.value = shipment.customer_name || "";
      customerPhone.value = shipment.customer_phone || "";
      customerAddress.value = shipment.customer_address || "";
      packageDesc.value = shipment.package_desc || "";
      colli.value = shipment.colli ?? "";
      weightKg.value = shipment.weight_kg ?? "";
      status.value = shipment.status || "created";
      receivedBy.value = ""; // alleen bij delivered-event als note
      trackPreview.textContent = `Trackcode: ${shipment.track_code}`;
    }
  }

  function closeForm() {
    formCard.style.display = "none";
    editingShipment = null;
  }

  async function listShipments() {
    setMsg("Laden…", "info");

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, colli, weight_kg, updated_at, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMsg("Fout bij laden (check console).", "bad");
      return;
    }

    setMsg("Dashboard geladen ✅", "ok");

    shipmentsBody.innerHTML = (data || []).map((s) => {
      const updated = s.updated_at ? new Date(s.updated_at).toLocaleString("nl-NL") : "-";
      return `
        <tr>
          <td><code>${escapeHtml(s.track_code || "")}</code></td>
          <td>${escapeHtml(s.customer_name || "-")}</td>
          <td>${escapeHtml(statusNL(s.status))}</td>
          <td>${s.colli ?? "-"}</td>
          <td>${s.weight_kg ?? "-"}</td>
          <td class="muted">${escapeHtml(updated)}</td>
          <td style="text-align:right;">
            <button class="btn btn-secondary btn-sm" data-edit="${s.id}">Wijzig</button>
          </td>
        </tr>
      `;
    }).join("");

    // bind edit knoppen
    shipmentsBody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-edit");
        const shipment = (data || []).find(x => x.id === id);
        if (!shipment) return;
        openForm("edit", shipment);
      });
    });
  }

  async function nextTrackCode() {
    const y = yearNow();
    const prefix = `DVK-${y}-`;

    // pak laatste shipment van dit jaar op basis van track_code
    const { data, error } = await sb
      .from("shipments")
      .select("track_code")
      .like("track_code", `${prefix}%`)
      .order("track_code", { ascending: false })
      .limit(1);

    if (error) throw error;

    let next = 1;
    const last = data && data[0] && data[0].track_code ? data[0].track_code : null;
    if (last) {
      const parts = last.split("-");
      const n = parseInt(parts[2], 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${pad4(next)}`;
  }

  async function insertEvent(shipmentId, eventType, note = "") {
    const payload = {
      shipment_id: shipmentId,
      event_type: eventType,
      note: note || null,
    };
    const { error } = await sb.from("shipment_events").insert(payload);
    if (error) throw error;
  }

  async function createShipment() {
    const trackCode = await nextTrackCode();

    const payload = {
      track_code: trackCode,
      driver_id: currentUser.id,
      customer_name: customerName.value.trim() || null,
      customer_phone: customerPhone.value.trim() || null,
      customer_address: customerAddress.value.trim() || null,
      package_desc: packageDesc.value.trim() || null,
      colli: colli.value === "" ? null : parseInt(colli.value, 10),
      weight_kg: weightKg.value === "" ? null : parseFloat(weightKg.value),
      status: status.value || "created",
    };

    const { data, error } = await sb
      .from("shipments")
      .insert(payload)
      .select("id, track_code")
      .single();

    if (error) throw error;

    // altijd event voor status
    const note = (status.value === "delivered") ? (receivedBy.value.trim() || "") : "";
    await insertEvent(data.id, status.value, note);

    return data.track_code;
  }

  async function updateShipment() {
    if (!editingShipment) throw new Error("Geen shipment om te wijzigen");

    const newStatus = status.value || editingShipment.status || "created";

    const payload = {
      customer_name: customerName.value.trim() || null,
      customer_phone: customerPhone.value.trim() || null,
      customer_address: customerAddress.value.trim() || null,
      package_desc: packageDesc.value.trim() || null,
      colli: colli.value === "" ? null : parseInt(colli.value, 10),
      weight_kg: weightKg.value === "" ? null : parseFloat(weightKg.value),
      status: newStatus,
    };

    const { error } = await sb
      .from("shipments")
      .update(payload)
      .eq("id", editingShipment.id);

    if (error) throw error;

    // als status gewijzigd is: event erbij
    if (newStatus !== editingShipment.status) {
      const note = (newStatus === "delivered") ? (receivedBy.value.trim() || "") : "";
      await insertEvent(editingShipment.id, newStatus, note);
    } else {
      // status gelijk: alleen bij delivered kun je toch "afgeleverd aan" nog als event toevoegen
      if (newStatus === "delivered" && receivedBy.value.trim()) {
        await insertEvent(editingShipment.id, "delivered", receivedBy.value.trim());
      }
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function onSave() {
    setMsg("", "");
    saveBtn.disabled = true;

    try {
      if (!currentUser) throw new Error("Niet ingelogd");

      if (!editingShipment) {
        const code = await createShipment();
        setMsg(`Zending aangemaakt ✅ Trackcode: ${code}`, "ok");
      } else {
        await updateShipment();
        setMsg("Zending gewijzigd ✅", "ok");
      }

      closeForm();
      await listShipments();
    } catch (e) {
      console.error(e);
      setMsg(`Opslaan mislukt: ${e.message || e}`, "bad");
    } finally {
      saveBtn.disabled = false;
    }
  }

  // --- Init
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const ok = await requireAuth();
      if (!ok) return;

      await listShipments();

      logoutBtn.addEventListener("click", logout);
      newBtn.addEventListener("click", () => openForm("new"));
      cancelBtn.addEventListener("click", closeForm);
      saveBtn.addEventListener("click", onSave);

      // realtime refresh (optioneel)
      sb.channel("shipments_driver_realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, async () => {
          await listShipments();
        })
        .subscribe();

    } catch (e) {
      console.error(e);
      setMsg("Fout bij starten dashboard (check console).", "bad");
    }
  });
})();
