/* public/js/dashboard.js
   Chauffeur dashboard: lijst + nieuw/wijzigen + snelle statusknoppen
   Vereist RLS policies voor shipments update + shipment_events insert voor eigen shipments.
*/

(function () {
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const STATUS_LABEL = {
    created: "Aangemeld",
    pickup: "Opgehaald",
    in_transit: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
  };

  const els = {
    userEmail: $("userEmail"),
    msg: $("msg"),
    body: $("shipmentsBody"),

    modal: $("modal"),
    modalTitle: $("modalTitle"),
    btnNew: $("btnNew"),
    btnClose: $("btnClose"),
    btnCancel: $("btnCancel"),
    btnLogout: $("btnLogout"),

    form: $("shipmentForm"),
    shipmentId: $("shipmentId"),
    trackCode: $("trackCode"),
    customerName: $("customerName"),
    status: $("status"),
    shipmentType: $("shipmentType"),
    pickupAddress: $("pickupAddress"),
    deliveryAddress: $("deliveryAddress"),
    colliCount: $("colliCount"),
    weightKg: $("weightKg"),

    btnDelete: $("btnDelete"),
  };

  function showMsg(text, type = "ok") {
    els.msg.style.display = "block";
    els.msg.className = `msg msg-${type}`;
    els.msg.textContent = text;
  }
  function clearMsg() {
    els.msg.style.display = "none";
    els.msg.textContent = "";
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    return new Date(iso).toLocaleString("nl-NL");
  }

  function safe(v) {
    return (v === null || v === undefined || v === "") ? "-" : String(v);
  }

  function statusNL(code) {
    return STATUS_LABEL[code] || code || "-";
  }

  async function requireSession() {
    if (!sb) throw new Error("supabaseClient ontbreekt");
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session) throw new Error("Geen sessie (niet ingelogd)");
    els.userEmail.textContent = session.user?.email || "";
    return session;
  }

  function openModal(mode, row) {
    els.modal.style.display = "block";
    clearMsg();

    if (mode === "new") {
      els.modalTitle.textContent = "Nieuwe zending";
      els.btnDelete.style.display = "none";
      els.form.reset();
      els.shipmentId.value = "";
      els.status.value = "created";
      return;
    }

    els.modalTitle.textContent = "Zending wijzigen";
    els.btnDelete.style.display = "inline-flex";

    els.shipmentId.value = row.id || "";
    els.trackCode.value = row.track_code || "";
    els.customerName.value = row.customer_name || "";
    els.status.value = row.status || "created";
    els.shipmentType.value = row.shipment_type || "";
    els.pickupAddress.value = row.pickup_address || "";
    els.deliveryAddress.value = row.delivery_address || "";
    els.colliCount.value = row.colli_count ?? "";
    els.weightKg.value = row.weight_kg ?? "";
  }

  function closeModal() {
    els.modal.style.display = "none";
  }

  function normalizePayload() {
    const colli = els.colliCount.value.trim();
    const kg = els.weightKg.value.trim();

    return {
      track_code: els.trackCode.value.trim(),
      customer_name: els.customerName.value.trim(),
      status: els.status.value,
      shipment_type: els.shipmentType.value || null,
      pickup_address: els.pickupAddress.value.trim() || null,
      delivery_address: els.deliveryAddress.value.trim() || null,
      colli_count: colli === "" ? null : parseInt(colli, 10),
      weight_kg: kg === "" ? null : Number(kg),
      updated_at: new Date().toISOString(),
    };
  }

  async function addEvent(shipmentId, eventType, note = null) {
    // Voeg timeline event toe (shipment_events)
    const payload = {
      shipment_id: shipmentId,
      event_type: eventType,
      note: note,
      created_at: new Date().toISOString(),
    };
    const { error } = await sb.from("shipment_events").insert([payload]);
    if (error) throw error;
  }

  async function quickStatusUpdate(row, newStatus) {
    try {
      await requireSession();

      // 1) update shipment
      const { error: upErr } = await sb
        .from("shipments")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) throw upErr;

      // 2) add timeline event
      await addEvent(row.id, newStatus, null);

      showMsg(`Status bijgewerkt: ${statusNL(newStatus)} ✅`, "ok");
      await loadShipments();
    } catch (e) {
      console.error(e);
      showMsg(`Snelle update mislukt: ${e.message || e}`, "bad");
    }
  }

  async function loadShipments() {
    try {
      await requireSession();

      const { data, error } = await sb
        .from("shipments")
        .select("id, track_code, customer_name, status, pickup_address, delivery_address, shipment_type, colli_count, weight_kg, updated_at, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;

      els.body.innerHTML = "";

      (data || []).forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${safe(row.track_code)}</td>
          <td>${safe(row.customer_name)}</td>
          <td>${safe(statusNL(row.status))}</td>
          <td>${safe(row.pickup_address)}</td>
          <td>${safe(row.delivery_address)}</td>
          <td>${safe(row.shipment_type)}</td>
          <td>${safe(row.colli_count)}</td>
          <td>${safe(row.weight_kg)}</td>
          <td>${fmtDate(row.updated_at || row.created_at)}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-sm js-edit">Wijzigen</button>
            <button class="btn btn-ghost btn-sm js-pickup">Opgehaald</button>
            <button class="btn btn-ghost btn-sm js-transit">Onderweg</button>
            <button class="btn btn-ghost btn-sm js-delivered">Afgeleverd</button>
          </td>
        `;

        tr.querySelector(".js-edit").addEventListener("click", () => openModal("edit", row));
        tr.querySelector(".js-pickup").addEventListener("click", () => quickStatusUpdate(row, "pickup"));
        tr.querySelector(".js-transit").addEventListener("click", () => quickStatusUpdate(row, "in_transit"));
        tr.querySelector(".js-delivered").addEventListener("click", () => quickStatusUpdate(row, "delivered"));

        els.body.appendChild(tr);
      });

      if (!data || data.length === 0) showMsg("Nog geen zendingen gevonden.", "warn");
      else clearMsg();
    } catch (e) {
      console.error(e);
      showMsg(`Fout bij laden: ${e.message || e}`, "bad");
    }
  }

  async function saveShipment(e) {
    e.preventDefault();
    try {
      await requireSession();

      const id = els.shipmentId.value || null;
      const payload = normalizePayload();

      if (!payload.track_code || !payload.customer_name) {
        showMsg("Trackcode en klantnaam zijn verplicht.", "warn");
        return;
      }

      if (!id) {
        const { data, error } = await sb.from("shipments").insert([payload]).select("id").maybeSingle();
        if (error) throw error;

        // event voor created (optioneel, maar handig voor timeline)
        if (data?.id) await addEvent(data.id, payload.status || "created", null);

        showMsg("Zending aangemaakt ✅", "ok");
      } else {
        const { error } = await sb.from("shipments").update(payload).eq("id", id);
        if (error) throw error;

        // event toevoegen als status is veranderd? (simpel: altijd event van huidige status)
        await addEvent(id, payload.status, null);

        showMsg("Zending bijgewerkt ✅", "ok");
      }

      closeModal();
      await loadShipments();
    } catch (e2) {
      console.error(e2);
      showMsg(`Opslaan mislukt: ${e2.message || e2}`, "bad");
    }
  }

  async function deleteShipment() {
    const id = els.shipmentId.value || null;
    if (!id) return;
    try {
      await requireSession();
      const { error } = await sb.from("shipments").delete().eq("id", id);
      if (error) throw error;
      closeModal();
      await loadShipments();
      showMsg("Zending verwijderd.", "ok");
    } catch (e) {
      console.error(e);
      showMsg(`Verwijderen mislukt: ${e.message || e}`, "bad");
    }
  }

  async function logout() {
    try {
      await sb.auth.signOut();
      window.location.href = "./login.html";
    } catch (e) {
      showMsg(`Uitloggen mislukt: ${e.message || e}`, "bad");
    }
  }

  function bind() {
    els.btnNew.addEventListener("click", () => openModal("new"));
    els.btnClose.addEventListener("click", closeModal);
    els.btnCancel.addEventListener("click", closeModal);
    els.btnLogout.addEventListener("click", logout);
    els.btnDelete.addEventListener("click", deleteShipment);
    els.form.addEventListener("submit", saveShipment);
    els.modal.addEventListener("click", (ev) => {
      if (ev.target === els.modal) closeModal();
    });
  }

  bind();
  loadShipments();
})();
