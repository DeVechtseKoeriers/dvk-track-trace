/* public/js/dashboard.js
   Chauffeur dashboard (RLS authenticated):
   - Laadt shipments voor driver_id = auth.uid()
   - Nieuwe/Wijzigen
   - Snelle knoppen: Opgehaald / Onderweg / Afgeleverd / Probleem
   - Afgeleverd: ontvanger + opmerking + (optioneel) handtekening in shipment_events.note (JSON)
   - Probleem: vrije tekst

   BELANGRIJK: past zich automatisch aan aan jouw kolomnamen:
   pickup: pickup_address | pickup_addr | pickup
   dropoff: delivery_address | dropoff_address | dropoff_addr | dropoff
   type: shipment_type | type
   colli: colli_count | colli
   kg: weight_kg | kg | weight
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

  // =========================
  // Slimme kolom-detectie
  // =========================
  const COLS = {
    pickup: ["pickup_address", "pickup_addr", "pickup"],
    dropoff: ["delivery_address", "dropoff_address", "dropoff_addr", "dropoff"],
    type: ["shipment_type", "type"],
    colli: ["colli_count", "colli"],
    kg: ["weight_kg", "kg", "weight"],
  };

  function normalizeTrack(code) {
    return (code || "").trim().toUpperCase();
  }

  function pickFirst(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    }
    return "";
  }

  function buildPayloadFromForm(user) {
    const raw = {
      track_code: normalizeTrack($("#mTrack").value),
      customer_name: ($("#mCustomer").value || "").trim(),
      pickup: ($("#mPickup").value || "").trim(),
      dropoff: ($("#mDropoff").value || "").trim(),
      type: $("#mType").value || "Doos",
      colli: Number($("#mColli").value || 0),
      kg: Number($("#mKg").value || 0),
      status: $("#mStatus").value || "created",
    };

    if (!raw.track_code) throw new Error("Trackcode is verplicht.");
    if (!raw.customer_name) throw new Error("Klantnaam is verplicht.");

    return {
      driver_id: user.id,
      track_code: raw.track_code,
      customer_name: raw.customer_name,
      __pickup: raw.pickup,
      __dropoff: raw.dropoff,
      __type: raw.type,
      __colli: raw.colli,
      __kg: raw.kg,
      status: raw.status,
      updated_at: new Date().toISOString(),
    };
  }

  function variantsForPayload(base) {
    // Maak verschillende payloads met alternatieve kolomnamen
    const out = [];

    for (const pickupKey of COLS.pickup) {
      for (const dropKey of COLS.dropoff) {
        for (const typeKey of COLS.type) {
          for (const colliKey of COLS.colli) {
            for (const kgKey of COLS.kg) {
              const p = {
                driver_id: base.driver_id,
                track_code: base.track_code,
                customer_name: base.customer_name,
                status: base.status,
                updated_at: base.updated_at,
              };

              if (base.__pickup) p[pickupKey] = base.__pickup;
              if (base.__dropoff) p[dropKey] = base.__dropoff;
              if (base.__type) p[typeKey] = base.__type;

              // colli/kg altijd als nummer
              p[colliKey] = Number(base.__colli || 0);
              p[kgKey] = Number(base.__kg || 0);

              out.push(p);
            }
          }
        }
      }
    }
    return out;
  }

  async function tryInsertOrUpdate(tableOpFn, payloadVariants) {
    let lastErr = null;

    for (const payload of payloadVariants) {
      const { error } = await tableOpFn(payload);
      if (!error) return; // success
      lastErr = error;

      // Als fout gaat over "column ... does not exist", probeer volgende variant
      const msg = (error.message || "").toLowerCase();
      if (
        msg.includes("could not find the") ||
        msg.includes("does not exist") ||
        msg.includes("schema cache")
      ) {
        continue;
      }

      // Andere fouten (RLS, invalid, etc) meteen stoppen
      throw error;
    }

    // Alle varianten geprobeerd
    throw lastErr || new Error("Onbekende fout bij opslaan.");
  }

  async function insertShipmentSmart(basePayload) {
    const variants = variantsForPayload(basePayload);
    await tryInsertOrUpdate(
      (payload) => sb.from("shipments").insert(payload),
      variants
    );

    // Maak meteen een "created" event (timeline) — dit faalt niet als policy klopt
    // (Als events insert niet mag, dan werkt zending alsnog; timeline toont dan later updates)
    try {
      const { data: sh, error: selErr } = await sb
        .from("shipments")
        .select("id, track_code")
        .eq("track_code", basePayload.track_code)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!selErr && sh?.id) {
        await sb.from("shipment_events").insert({
          shipment_id: sh.id,
          event_type: "created",
          note: "",
        });
      }
    } catch (_) {}
  }

  async function updateShipmentSmart(id, basePayload) {
    const variants = variantsForPayload(basePayload);
    await tryInsertOrUpdate(
      (payload) => sb.from("shipments").update(payload).eq("id", id),
      variants
    );
  }

  async function deleteShipment(id) {
    const { error } = await sb.from("shipments").delete().eq("id", id);
    if (error) throw error;
  }

  async function setStatusAndEvent(shipmentId, newStatus, eventType, note = "") {
    const { error: uErr } = await sb
      .from("shipments")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", shipmentId);
    if (uErr) throw uErr;

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
      const blank = document.createElement("canvas");
      blank.width = canvas.width;
      blank.height = canvas.height;
      if (canvas.toDataURL() === blank.toDataURL()) return "";
      return canvas.toDataURL("image/png");
    }

    return { clear, getDataUrl };
  }

  // =========================
  // UI state
  // =========================
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
        const colli = pickFirst(s, COLS.colli) ?? "";
        const kg = pickFirst(s, COLS.kg) ?? "";

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

  async function fetchMyShipments() {
    const user = await requireUser();

    const { data, error } = await sb
      .from("shipments")
      .select("*")
      .eq("driver_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return data || [];
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

    $("#mPickup").value = pickFirst(shipment, COLS.pickup) || "";
    $("#mDropoff").value = pickFirst(shipment, COLS.dropoff) || "";

    $("#mType").value = pickFirst(shipment, COLS.type) || "Doos";
    $("#mColli").value = pickFirst(shipment, COLS.colli) ?? 1;
    $("#mKg").value = pickFirst(shipment, COLS.kg) ?? 0;
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

  async function bind() {
    if (!sb) {
      showError("supabaseClient ontbreekt. Check supabase-config.js");
      return;
    }

    $("#logoutBtn").addEventListener("click", async () => {
      await sb.auth.signOut();
      location.href = "./login.html";
    });

    $("#newShipmentBtn").addEventListener("click", () => openShipModal("new"));
    $("#shipModalClose").addEventListener("click", closeShipModal);

    $("#shipModalSave").addEventListener("click", async () => {
      try {
        clearError();
        const user = await requireUser();
        const base = buildPayloadFromForm(user);

        if (editingId) {
          await updateShipmentSmart(editingId, base);
          toast("Opgeslagen ✅");
        } else {
          await insertShipmentSmart(base);
          toast("Zending aangemaakt ✅");
        }

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

    // Delivered modal
    $("#dvkSigClear").addEventListener("click", () => sig.clear());
    $("#dvkDeliveredCancel").addEventListener("click", closeDeliveredModal);

    $("#dvkDeliveredSave").addEventListener("click", async () => {
      try {
        if (!deliveredForId) return;

        const received_by = ($("#dvkRecvName").value || "").trim();
        const note = ($("#dvkRecvNote").value || "").trim();
        const signature = sig.getDataUrl();

        const payload = JSON.stringify({ received_by, note, signature });

        await setStatusAndEvent(deliveredForId, "delivered", "delivered", payload);
        toast("Status gezet: Afgeleverd ✅");
        closeDeliveredModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] delivered error:", e);
        showError(e.message || String(e));
      }
    });

    // Problem modal
    $("#dvkProblemCancel").addEventListener("click", closeProblemModal);

    $("#dvkProblemSave").addEventListener("click", async () => {
      try {
        if (!problemForId) return;
        const txt = ($("#dvkProblemText").value || "").trim();
        if (!txt) throw new Error("Vul een omschrijving in.");

        await setStatusAndEvent(problemForId, "problem", "problem", txt);
        toast("Probleem gemeld ✅");
        closeProblemModal();
        await refresh();
      } catch (e) {
        console.error("[DVK][dash] problem error:", e);
        showError(e.message || String(e)));
      }
    });

    await refresh();
  }

  bind();
})();
