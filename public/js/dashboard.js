/* public/js/dashboard.js
   Chauffeur dashboard:
   - Laadt shipments van ingelogde driver
   - Nieuwe/Wijzigen via modal
   - Snelle knoppen: Opgehaald / Onderweg / Afgeleverd / Probleem
   - Afgeleverd: ontvanger + opmerking + handtekening (note JSON)
   - Probleem: vrije tekst (note)
*/

(() => {
  const sb = window.sb;
  const $ = (s) => document.querySelector(s);

  const STATUS_NL = {
    created: "Aangemeld",
    pickup: "Opgehaald",
    in_transit: "Onderweg",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
  };

  function fmtDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toast(msg, type = "ok") {
    const el = $("#dvkToast");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
    el.className = "msg " + (type === "bad" ? "bad" : "ok");
    clearTimeout(window.__t);
    window.__t = setTimeout(() => (el.style.display = "none"), 3200);
  }

  function showError(msg) {
    const el = $("#shipmentsError");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
  }
  function clearError() {
    const el = $("#shipmentsError");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function requireUser() {
    if (!sb) throw new Error("supabaseClient ontbreekt. Check supabase-config.js");
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    if (!data?.user) throw new Error("Niet ingelogd.");
    return data.user;
  }

  async function fetchMyShipments() {
    const user = await requireUser();

    // driver_id moet auth.uid() zijn
    const { data, error } = await sb
      .from("shipments")
      .select("*")
      .eq("driver_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function upsertShipment(payload, id = null) {
    if (id) {
      const { error } = await sb.from("shipments").update(payload).eq("id", id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("shipments").insert(payload);
      if (error) throw error;
    }
  }

  async function deleteShipment(id) {
    const { error } = await sb.from("shipments").delete().eq("id", id);
    if (error) throw error;
  }

  async function setStatusAndEvent(shipmentId, newStatus, eventType, note = "") {
    // update shipments
    const { error: uErr } = await sb
      .from("shipments")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", shipmentId);
    if (uErr) throw uErr;

    // add event
    const { error: eErr } = await sb.from("shipment_events").insert({
      shipment_id: shipmentId,
      event_type: eventType,
      note: note || "",
    });
    if (eErr) throw eErr;
  }

  // ===== Delivered modal + signature =====
  function signatureSetup() {
    const canvas = $("#dvkSigCanvas");
    if (!canvas) return { getDataUrl: () => "", clear: () => {} };

    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";

    let drawing = false;
    let last = null;

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x, y };
    }

    function start(e) {
      drawing = true;
      last = pos(e);
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      e.preventDefault();
    }
    function stop() {
      drawing = false;
      last = null;
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);

    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", stop);

    function clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    function getDataUrl() {
      // als canvas leeg is, return ""
      const blank = document.createElement("canvas");
      blank.width = canvas.width;
      blank.height = canvas.height;
      if (canvas.toDataURL() === blank.toDataURL()) return "";
      return canvas.toDataURL("image/png");
    }

    return { clear, getDataUrl };
  }

  let currentShipments = [];
  let editingId = null;

  function renderTable(rows) {
    const tbody = $("#shipmentsTbody");
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows
      .map((s) => {
        const colli = s.colli_count ?? s.colli ?? "";
        const kg = s.weight_kg ?? s.kg ?? "";
        return `
        <tr>
          <td>${esc(s.track_code || "")}</td>
          <td>${esc(s.customer_name || "")}</td>
          <td>${esc(STATUS_NL[s.status] || s.status || "")}</td>
          <td>${esc(colli)}</td>
          <td>${esc(kg)}</td>
          <td>${esc(fmtDate(s.updated_at || s.created_at))}</td>
          <td style="white-space:nowrap;">
            <button class="btn small" data-act="edit" data-id="${s.id}">Wijzigen</button>
            <button class="btn small" data-act="pickup" data-id="${s.id}">Opgehaald</button>
            <button class="btn small" data-act="transit" data-id="${s.id}">Onderweg</button>
            <button class="btn small" data-act="delivered" data-id="${s.id}">Afgeleverd</button>
            <button class="btn small danger" data-act="problem" data-id="${s.id}">Probleem</button>
          </td>
        </tr>
      `;
      })
      .join("");

    tbody.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.act, btn.dataset.id));
    });
  }

  // ===== Ship modal (new/edit) =====
  function openShipModal(mode, shipment = null) {
    const modal = $("#dvkShipModal");
    if (!modal) return;

    $("#shipModalTitle").textContent = mode === "edit" ? "Zending wijzigen" : "Nieuwe zending";
    $("#shipModalDelete").style.display = mode === "edit" ? "inline-block" : "none";

    editingId = shipment?.id || null;

    $("#mTrack").value = shipment?.track_code || "";
    $("#mCustomer").value = shipment?.customer_name || "";
    $("#mPickup").value = shipment?.pickup_address || shipment?.pickup_addr || "";
    $("#mDropoff").value = shipment?.dropoff_address || shipment?.delivery_address || shipment?.dropoff_addr || "";
    $("#mType").value = shipment?.shipment_type || shipment?.type || "Doos";
    $("#mColli").value = shipment?.colli_count ?? shipment?.colli ?? 1;
    $("#mKg").value = shipment?.weight_kg ?? shipment?.kg ?? 0;
    $("#mStatus").value = shipment?.status || "created";

    modal.style.display = "block";
  }

  function closeShipModal() {
    const modal = $("#dvkShipModal");
    if (modal) modal.style.display = "none";
    editingId = null;
  }

  // ===== Delivered modal =====
  const sig = signatureSetup();

  let deliveredForId = null;
  function openDeliveredModal(shipmentId) {
    deliveredForId = shipmentId;
    $("#dvkRecvName").value = "";
    $("#dvkRecvNote").value = "";
    sig.clear();
    $("#dvkDeliveredModal").style.display = "block";
  }
  function closeDeliveredModal() {
    $("#dvkDeliveredModal").style.display = "none";
    deliveredForId = null;
  }

  // ===== Problem modal =====
  let problemForId = null;
  function openProblemModal(shipmentId) {
    problemForId = shipmentId;
    $("#dvkProblemText").value = "";
    $("#dvkProblemModal").style.display = "block";
  }
  function closeProblemModal() {
    $("#dvkProblemModal").style.display = "none";
    problemForId = null;
  }

  // ===== Actions =====
  async function handleAction(act, id) {
    try {
      clearError();

      if (act === "edit") {
        const s = currentShipments.find((x) => x.id === id);
        openShipModal("edit", s);
        return;
      }

      if (act === "pickup") {
        await setStatusAndEvent(id, "pickup", "pickup", "");
        toast("Status gezet: Opgehaald ✅");
        await refresh();
        return;
      }

      if (act === "transit") {
        await setStatusAndEvent(id, "in_transit", "in_transit", "");
        toast("Status gezet: Onderweg ✅");
        await refresh();
        return;
      }

      if (act === "delivered") {
        openDeliveredModal(id);
        return;
      }

      if (act === "problem") {
        openProblemModal(id);
        return;
      }
    } catch (e) {
      console.error("[DVK][dash] action error:", e);
      showError("Fout: " + (e.message || String(e)));
    }
  }

  async function refresh() {
    try {
      clearError();
      const user = await requireUser();
      $("#userEmail").textContent = user.email || "-";

      currentShipments = await fetchMyShipments();
      renderTable(currentShipments);
    } catch (e) {
      console.error("[DVK][dash] refresh error:", e);
      showError("Fout bij laden: " + (e.message || String(e)));
    }
  }

  // ===== Bind UI =====
  async function bind() {
    if (!sb) {
      showError("supabaseClient ontbreekt. Check supabase-config.js");
      return;
    }

    // logout
    $("#logoutBtn").addEventListener("click", async () => {
      await sb.auth.signOut();
      location.href = "./login.html";
    });

    // New shipment
    $("#newShipmentBtn").addEventListener("click", () => openShipModal("new"));

    // ship modal close/save/delete
    $("#shipModalClose").addEventListener("click", closeShipModal);

    $("#shipModalSave").addEventListener("click", async () => {
      try {
        clearError();
        const user = await requireUser();

        const payload = {
          driver_id: user.id,
          track_code: $("#mTrack").value.trim(),
          customer_name: $("#mCustomer").value.trim(),
          pickup_address: $("#mPickup").value.trim(),
          dropoff_address: $("#mDropoff").value.trim(),
          shipment_type: $("#mType").value,
          colli_count: Number($("#mColli").value || 0),
          weight_kg: Number($("#mKg").value || 0),
          status: $("#mStatus").value,
          updated_at: new Date().toISOString(),
        };

        if (!payload.track_code) throw new Error("Trackcode is verplicht.");
        if (!payload.customer_name) throw new Error("Klantnaam is verplicht.");

        await upsertShipment(payload, editingId);
        toast("Opgeslagen ✅");
        closeShipModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] save error:", e);
        showError(e.message || String(e));
      }
    });

    $("#shipModalDelete").addEventListener("click", async () => {
      try {
        if (!editingId) return;
        await deleteShipment(editingId);
        toast("Verwijderd ✅");
        closeShipModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] delete error:", e);
        showError(e.message || String(e));
      }
    });

    // delivered modal
    $("#dvkSigClear").addEventListener("click", () => sig.clear());
    $("#dvkDeliveredCancel").addEventListener("click", closeDeliveredModal);

    $("#dvkDeliveredSave").addEventListener("click", async () => {
      try {
        if (!deliveredForId) return;

        const received_by = $("#dvkRecvName").value.trim();
        const note = $("#dvkRecvNote").value.trim();
        const signature = sig.getDataUrl(); // "" als leeg

        const payload = JSON.stringify({
          received_by,
          note,
          signature, // base64 png (optioneel)
        });

        await setStatusAndEvent(deliveredForId, "delivered", "delivered", payload);
        toast("Status gezet: Afgeleverd ✅");
        closeDeliveredModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] delivered error:", e);
        showError(e.message || String(e));
      }
    });

    // problem modal
    $("#dvkProblemCancel").addEventListener("click", closeProblemModal);

    $("#dvkProblemSave").addEventListener("click", async () => {
      try {
        if (!problemForId) return;
        const txt = $("#dvkProblemText").value.trim();
        if (!txt) throw new Error("Vul een omschrijving in.");

        await setStatusAndEvent(problemForId, "problem", "problem", txt);
        toast("Probleem gemeld ✅");
        closeProblemModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] problem error:", e);
        showError(e.message || String(e));
      }
    });

    await refresh();
  }

  bind();
})();
