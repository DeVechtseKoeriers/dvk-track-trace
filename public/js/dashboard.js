/* public/js/dashboard.js
   Chauffeur dashboard: shipments + events
   - toont echte foutmelding op scherm
   - kolomnamen configureerbaar bovenaan
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    alert("supabaseClient ontbreekt. Check public/js/supabase-config.js");
    return;
  }

  // ====== PAS HIER EVENTUEEL JE KOLOMNAMEN AAN ======
  const COL = {
    TRACK: "track_code",
    STATUS: "status",
    CUSTOMER: "customer_name",
    COLLI: "colli",
    KG: "kg", // <- als jij 'weight_kg' hebt: zet dit op "weight_kg"
    DESC: "package_desc",
    ADDRESS: "customer_address",
    PHONE: "customer_phone",
    DRIVER: "driver_id",
    CREATED: "created_at",
    UPDATED: "updated_at",
  };
  // ===================================================

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
  const weightKg = document.getElementById("weightKg"); // input veld, kolomnaam kan KG zijn
  const status = document.getElementById("status");
  const receivedBy = document.getElementById("receivedBy");
  const trackPreview = document.getElementById("trackPreview");

  let session = null;
  let currentUser = null;
  let editingShipment = null;

  function setMsg(text = "", type = "") {
    msgEl.textContent = text;
    msgEl.className = "msg " + (type ? `msg-${type}` : "");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusNL(code) {
    const map = { created: "Aangemeld", en_route: "Onderweg", delivered: "Afgeleverd", problem: "Probleem" };
    return map[code] || code || "-";
  }

  function pad4(n) { return String(n).padStart(4, "0"); }
  function yearNow() { return new Date().getFullYear(); }

  async function requireAuth() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    session = data.session;
    if (!session) {
      window.location.href = "./login.html";
      return false;
    }

    currentUser = session.user;
    userEmailEl.textContent = currentUser.email || "";
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
      customerName.value = shipment[COL.CUSTOMER] || "";
      customerPhone.value = shipment[COL.PHONE] || "";
      customerAddress.value = shipment[COL.ADDRESS] || "";
      packageDesc.value = shipment[COL.DESC] || "";
      colli.value = shipment[COL.COLLI] ?? "";
      weightKg.value = shipment[COL.KG] ?? "";
      status.value = shipment[COL.STATUS] || "created";
      receivedBy.value = "";
      trackPreview.textContent = `Trackcode: ${shipment[COL.TRACK]}`;
    }
  }

  function closeForm() {
    formCard.style.display = "none";
    editingShipment = null;
  }

  async function listShipments() {
    setMsg("Laden…", "info");

    const selectCols = [
      "id",
      COL.TRACK,
      COL.CUSTOMER,
      COL.STATUS,
      COL.COLLI,
      COL.KG,
      COL.UPDATED,
      COL.CREATED,
    ].join(",");

    const { data, error } = await sb
      .from("shipments")
      .select(selectCols)
      .order(COL.CREATED, { ascending: false });

    if (error) {
      console.error(error);
      setMsg(`Fout bij laden: ${error.message}`, "bad");
      return;
    }

    setMsg("Dashboard geladen ✅", "ok");

    shipmentsBody.innerHTML = (data || []).map((s) => {
      const updated = s[COL.UPDATED] ? new Date(s[COL.UPDATED]).toLocaleString("nl-NL") : "-";
      return `
        <tr>
          <td><code>${escapeHtml(s[COL.TRACK] || "")}</code></td>
          <td>${escapeHtml(s[COL.CUSTOMER] || "-")}</td>
          <td>${escapeHtml(statusNL(s[COL.STATUS]))}</td>
          <td>${s[COL.COLLI] ?? "-"}</td>
          <td>${s[COL.KG] ?? "-"}</td>
          <td class="muted">${escapeHtml(updated)}</td>
          <td style="text-align:right;">
            <button class="btn btn-secondary btn-sm" data-edit="${s.id}">Wijzig</button>
          </td>
        </tr>
      `;
    }).join("");

    shipmentsBody.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-edit");
        const shipment = (data || []).find(x => x.id === id);
        if (shipment) openForm("edit", shipment);
      });
    });
  }

  async function nextTrackCode() {
    const y = yearNow();
    const prefix = `DVK-${y}-`;

    const { data, error } = await sb
      .from("shipments")
      .select(COL.TRACK)
      .like(COL.TRACK, `${prefix}%`)
      .order(COL.TRACK, { ascending: false })
      .limit(1);

    if (error) throw error;

    let next = 1;
    const last = data?.[0]?.[COL.TRACK] || null;
    if (last) {
      const parts = last.split("-");
      const n = parseInt(parts[2], 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${pad4(next)}`;
  }

  async function insertEvent(shipmentId, eventType, note = "") {
    const { error } = await sb.from("shipment_events").insert({
      shipment_id: shipmentId,
      event_type: eventType,
      note: note || null,
    });
    if (error) throw error;
  }

  async function createShipment() {
    const trackCode = await nextTrackCode();

    const payload = {
      [COL.TRACK]: trackCode,
      [COL.DRIVER]: currentUser.id,
      [COL.CUSTOMER]: customerName.value.trim() || null,
      [COL.PHONE]: customerPhone.value.trim() || null,
      [COL.ADDRESS]: customerAddress.value.trim() || null,
      [COL.DESC]: packageDesc.value.trim() || null,
      [COL.COLLI]: colli.value === "" ? null : parseInt(colli.value, 10),
      [COL.KG]: weightKg.value === "" ? null : parseFloat(weightKg.value),
      [COL.STATUS]: status.value || "created",
    };

    const { data, error } = await sb
      .from("shipments")
      .insert(payload)
      .select("id," + COL.TRACK)
      .single();

    if (error) throw error;

    const note = (status.value === "delivered") ? (receivedBy.value.trim() || "") : "";
    await insertEvent(data.id, status.value, note);

    return data[COL.TRACK];
  }

  async function updateShipment() {
    if (!editingShipment) throw new Error("Geen shipment om te wijzigen");

    const newStatus = status.value || editingShipment[COL.STATUS] || "created";

    const payload = {
      [COL.CUSTOMER]: customerName.value.trim() || null,
      [COL.PHONE]: customerPhone.value.trim() || null,
      [COL.ADDRESS]: customerAddress.value.trim() || null,
      [COL.DESC]: packageDesc.value.trim() || null,
      [COL.COLLI]: colli.value === "" ? null : parseInt(colli.value, 10),
      [COL.KG]: weightKg.value === "" ? null : parseFloat(weightKg.value),
      [COL.STATUS]: newStatus,
    };

    const { error } = await sb.from("shipments").update(payload).eq("id", editingShipment.id);
    if (error) throw error;

    if (newStatus !== editingShipment[COL.STATUS]) {
      const note = (newStatus === "delivered") ? (receivedBy.value.trim() || "") : "";
      await insertEvent(editingShipment.id, newStatus, note);
    } else if (newStatus === "delivered" && receivedBy.value.trim()) {
      await insertEvent(editingShipment.id, "delivered", receivedBy.value.trim());
    }
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

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const ok = await requireAuth();
      if (!ok) return;

      await listShipments();

      logoutBtn.addEventListener("click", logout);
      newBtn.addEventListener("click", () => openForm("new"));
      cancelBtn.addEventListener("click", closeForm);
      saveBtn.addEventListener("click", onSave);

    } catch (e) {
      console.error(e);
      setMsg(`Startfout: ${e.message || e}`, "bad");
    }
  });
})();
