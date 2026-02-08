/* public/js/dashboard.js
   DVK Chauffeurs Dashboard
   Vereist bestaande HTML IDs (zoals je al had).
   Wijzigen/Acties modal:
   - knoppen: picked_up / in_transit / delivered / problem
   - receiver + note + signature alleen bij delivered
*/
(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    showTopError("Supabase client ontbreekt. Check supabase-config.js");
    return;
  }

  // ===== Helpers =====
  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function nlStatus(status) {
    const s = String(status || "").toLowerCase();
    if (s === "created" || s === "registered") return "Aangemeld";
    if (s === "picked_up") return "Opgehaald";
    if (s === "in_transit") return "Onderweg";
    if (s === "delivered") return "Afgeleverd";
    if (s === "problem") return "Probleem";
    return status || "-";
  }

  function showTopError(msg) {
    const box = $("topError");
    if (!box) return;
    box.style.display = "block";
    box.textContent = msg;
  }

  function hideTopError() {
    const box = $("topError");
    if (!box) return;
    box.style.display = "none";
  }

  function fmtDT(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return String(iso);
    }
  }

  // ===== State =====
  let selectedShipment = null;
  let deliveredDraft = { receiver_name: "", note: "", signature_data: "" };

  // ===== DOM (verwacht in je bestaande HTML) =====
  const shipmentsBody = $("shipmentsBody");           // <tbody> lijst
  const loadingRow = $("loadingRow");                 // "Laden..." row (optioneel)
  const actionsModal = $("actionsModal");             // modal wrapper
  const actionsTitle = $("actionsTitle");             // titel in modal
  const actionsError = $("actionsError");             // foutmelding in modal
  const btnPickedUp = $("btnPickedUp");
  const btnInTransit = $("btnInTransit");
  const btnDelivered = $("btnDelivered");
  const btnProblem = $("btnProblem");

  // Afgeleverd velden (bestaan al in jouw UI of voeg je toe)
  const deliveredSection = $("deliveredSection");     // wrapper voor receiver/note/signature
  const receiverInput = $("receiverName");
  const noteInput = $("deliveryNote");
  const signatureCanvas = $("signatureCanvas");
  const btnClearSig = $("btnClearSignature");
  const btnConfirmDelivery = $("btnConfirmDelivery");

  // ===== Signature capture (simpel, mobielproof) =====
  let sigCtx = null;
  let drawing = false;
  let last = null;

  function setupSignatureCanvas() {
    if (!signatureCanvas) return;

    sigCtx = signatureCanvas.getContext("2d");
    const resize = () => {
      // behoud handtekeningruimte maar maak scherp op mobiel
      const rect = signatureCanvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      signatureCanvas.width = Math.floor(rect.width * scale);
      signatureCanvas.height = Math.floor(rect.height * scale);
      sigCtx.setTransform(scale, 0, 0, scale, 0, 0);
      sigCtx.lineWidth = 2;
      sigCtx.lineCap = "round";
      sigCtx.lineJoin = "round";
      // redraw draft indien aanwezig
      if (deliveredDraft.signature_data) {
        loadSignatureData(deliveredDraft.signature_data);
      } else {
        clearSignature();
      }
    };

    window.addEventListener("resize", resize);
    setTimeout(resize, 50);

    const getPos = (e) => {
      const r = signatureCanvas.getBoundingClientRect();
      const touch = e.touches && e.touches[0];
      const clientX = touch ? touch.clientX : e.clientX;
      const clientY = touch ? touch.clientY : e.clientY;
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const down = (e) => {
      drawing = true;
      last = getPos(e);
      e.preventDefault();
    };

    const move = (e) => {
      if (!drawing) return;
      const p = getPos(e);
      sigCtx.beginPath();
      sigCtx.moveTo(last.x, last.y);
      sigCtx.lineTo(p.x, p.y);
      sigCtx.stroke();
      last = p;
      deliveredDraft.signature_data = signatureCanvas.toDataURL("image/png");
      e.preventDefault();
    };

    const up = (e) => {
      drawing = false;
      last = null;
      deliveredDraft.signature_data = signatureCanvas.toDataURL("image/png");
      e.preventDefault();
    };

    signatureCanvas.addEventListener("mousedown", down);
    signatureCanvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    signatureCanvas.addEventListener("touchstart", down, { passive: false });
    signatureCanvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up, { passive: false });

    if (btnClearSig) btnClearSig.addEventListener("click", () => {
      deliveredDraft.signature_data = "";
      clearSignature();
    });
  }

  function clearSignature() {
    if (!sigCtx || !signatureCanvas) return;
    sigCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  }

  function loadSignatureData(dataUrl) {
    if (!sigCtx || !signatureCanvas || !dataUrl) return;
    const img = new Image();
    img.onload = () => {
      clearSignature();
      // teken in canvas op zichtbare schaal
      const rect = signatureCanvas.getBoundingClientRect();
      sigCtx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = dataUrl;
  }

  // ===== UI: Show/Hide delivered fields =====
  function setDeliveredUIVisible(visible) {
    if (!deliveredSection) return;
    deliveredSection.style.display = visible ? "block" : "none";
  }

  function fillDeliveredDraftIntoUI() {
    if (receiverInput) receiverInput.value = deliveredDraft.receiver_name || "";
    if (noteInput) noteInput.value = deliveredDraft.note || "";
    if (signatureCanvas) {
      if (deliveredDraft.signature_data) loadSignatureData(deliveredDraft.signature_data);
      else clearSignature();
    }
  }

  function readDeliveredUIIntoDraft() {
    if (receiverInput) deliveredDraft.receiver_name = receiverInput.value || "";
    if (noteInput) deliveredDraft.note = noteInput.value || "";
    // signature_data wordt live gezet tijdens tekenen
  }

  // ===== Actions button highlight =====
  function setActiveAction(btn) {
    [btnPickedUp, btnInTransit, btnDelivered, btnProblem].forEach((b) => {
      if (!b) return;
      b.classList.remove("is-active");
    });
    if (btn) btn.classList.add("is-active");
  }

  function showActionsError(msg) {
    if (!actionsError) return;
    actionsError.style.display = "block";
    actionsError.textContent = msg;
  }

  function clearActionsError() {
    if (!actionsError) return;
    actionsError.style.display = "none";
    actionsError.textContent = "";
  }

  // ===== Data load =====
  async function loadMyShipments() {
    hideTopError();
    if (loadingRow) loadingRow.style.display = "table-row";

    try {
      const { data: sessionData } = await sb.auth.getSession();
      const uid = sessionData?.session?.user?.id;
      if (!uid) {
        showTopError("Niet ingelogd.");
        return;
      }

      // Minimal select (alleen kolommen die je al gebruikt)
      const { data, error } = await sb
        .from("shipments")
        .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      renderShipmentsTable(data || []);
    } catch (e) {
      console.error(e);
      showTopError("Fout bij laden: " + (e.message || e));
    } finally {
      if (loadingRow) loadingRow.style.display = "none";
    }
  }

  function renderShipmentsTable(rows) {
    if (!shipmentsBody) return;

    if (!rows || rows.length === 0) {
      shipmentsBody.innerHTML = `
        <tr><td colspan="7" style="opacity:.75;">Geen zendingen.</td></tr>
      `;
      return;
    }

    shipmentsBody.innerHTML = rows.map((r) => {
      return `
        <tr>
          <td>${escapeHtml(r.track_code || "-")}</td>
          <td>${escapeHtml(r.customer_name || "-")}</td>
          <td>${escapeHtml(nlStatus(r.status))}</td>
          <td>${escapeHtml(r.colli_count ?? "-")}</td>
          <td>${escapeHtml(r.weight_kg ?? "-")}</td>
          <td>${escapeHtml(fmtDT(r.updated_at))}</td>
          <td><button class="btn btn-sm" data-action="edit" data-id="${escapeHtml(r.id)}">Wijzigen</button></td>
        </tr>
      `;
    }).join("");

    shipmentsBody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const row = rows.find((x) => String(x.id) === String(id));
        if (!row) return;
        await openActionsModal(row);
      });
    });
  }

  async function openActionsModal(shipmentRow) {
    selectedShipment = shipmentRow;
    clearActionsError();

    // reset deliveredDraft niet hard wissen: we zetten 'm op basis van laatste delivered event (als bestaat)
    deliveredDraft = { receiver_name: "", note: "", signature_data: "" };

    if (actionsTitle) {
      actionsTitle.textContent = `Wijzigen / Acties — ${shipmentRow.track_code || ""}`;
    }

    // Prefill delivered info vanuit laatste delivered event (best effort)
    try {
      const { data: evs, error } = await sb
        .from("shipment_events")
        .select("event_type, created_at, receiver_name, note, signature_data")
        .eq("shipment_id", shipmentRow.id)
        .order("created_at", { ascending: false })
        .limit(20);

      // als kolom signature_data niet bestaat, geeft dit error → vangen we af, en doen we zonder signature
      if (!error && Array.isArray(evs)) {
        const delivered = evs.find((x) => String(x.event_type).toLowerCase() === "delivered");
        if (delivered) {
          deliveredDraft.receiver_name = delivered.receiver_name || "";
          deliveredDraft.note = delivered.note || "";
          deliveredDraft.signature_data = delivered.signature_data || "";
        }
      }
    } catch {
      // niets
    }

    // default highlight huidige status
    const st = String(shipmentRow.status || "").toLowerCase();
    if (st === "picked_up") setActiveAction(btnPickedUp);
    else if (st === "in_transit") setActiveAction(btnInTransit);
    else if (st === "delivered") setActiveAction(btnDelivered);
    else if (st === "problem") setActiveAction(btnProblem);
    else setActiveAction(null);

    // delivered velden: alleen zichtbaar als status delivered
    const isDelivered = st === "delivered";
    setDeliveredUIVisible(isDelivered);
    fillDeliveredDraftIntoUI();

    if (actionsModal) actionsModal.style.display = "block";
  }

  function closeActionsModal() {
    if (actionsModal) actionsModal.style.display = "none";
    selectedShipment = null;
    clearActionsError();
  }

  // ===== Save event + update shipment status =====
  async function setStatus(newStatus) {
    if (!selectedShipment) return;

    clearActionsError();

    // Alleen bij Afgeleverd: naam/notitie/handtekening verplicht/ingevuld laten
    const needsDeliveredFields = newStatus === "delivered";

    if (needsDeliveredFields) {
      readDeliveredUIIntoDraft();
      if (!deliveredDraft.receiver_name || deliveredDraft.receiver_name.trim().length < 1) {
        showActionsError("Vul 'Ontvangen door (naam)' in.");
        return;
      }
      if (!deliveredDraft.signature_data) {
        showActionsError("Plaats een handtekening.");
        return;
      }
    }

    try {
      // 1) update shipment status
      const { error: upErr } = await sb
        .from("shipments")
        .update({ status: newStatus })
        .eq("id", selectedShipment.id);

      if (upErr) throw upErr;

      // 2) insert event (defensief: signature_data alleen als kolom bestaat)
      const basePayload = {
        shipment_id: selectedShipment.id,
        event_type: newStatus,
        note: needsDeliveredFields ? deliveredDraft.note : null,
        receiver_name: needsDeliveredFields ? deliveredDraft.receiver_name : null,
      };

      // Probeer signature_data mee te sturen, maar als kolom ontbreekt -> zonder.
      let insErr = null;
      {
        const { error } = await sb.from("shipment_events").insert([{
          ...basePayload,
          signature_data: needsDeliveredFields ? deliveredDraft.signature_data : null,
        }]);
        insErr = error;
      }

      if (insErr) {
        // Retry zonder signature_data (voorkomt "schema cache" errors)
        const msg = String(insErr.message || "");
        if (msg.includes("signature_data") || msg.includes("schema cache")) {
          const { error: retryErr } = await sb.from("shipment_events").insert([basePayload]);
          if (retryErr) throw retryErr;
        } else {
          throw insErr;
        }
      }

      // UI highlight + delivered section show/hide
      if (newStatus === "picked_up") {
        setActiveAction(btnPickedUp);
        setDeliveredUIVisible(false);
      }
      if (newStatus === "in_transit") {
        setActiveAction(btnInTransit);
        setDeliveredUIVisible(false);
      }
      if (newStatus === "problem") {
        setActiveAction(btnProblem);
        setDeliveredUIVisible(false);
      }
      if (newStatus === "delivered") {
        setActiveAction(btnDelivered);
        setDeliveredUIVisible(true);
        // velden blijven zichtbaar + ingevuld
        fillDeliveredDraftIntoUI();
      }

      // refresh table
      await loadMyShipments();
    } catch (e) {
      console.error(e);
      showActionsError("Opslaan mislukt: " + (e.message || e));
    }
  }

  // ===== Wire up buttons =====
  if (btnPickedUp) btnPickedUp.addEventListener("click", () => setStatus("picked_up"));
  if (btnInTransit) btnInTransit.addEventListener("click", () => setStatus("in_transit"));
  if (btnProblem) btnProblem.addEventListener("click", () => setStatus("problem"));

  // Afgeleverd: velden worden pas getoond wanneer je op Afgeleverd klikt
  if (btnDelivered) {
    btnDelivered.addEventListener("click", () => {
      setActiveAction(btnDelivered);
      setDeliveredUIVisible(true);
      fillDeliveredDraftIntoUI();
    });
  }

  // Bevestig levering knop (als aanwezig): doet status delivered (incl check)
  if (btnConfirmDelivery) {
    btnConfirmDelivery.addEventListener("click", () => setStatus("delivered"));
  }

  // Live draft sync
  if (receiverInput) receiverInput.addEventListener("input", () => readDeliveredUIIntoDraft());
  if (noteInput) noteInput.addEventListener("input", () => readDeliveredUIIntoDraft());

  // Modal sluiten (als je al een sluitknop hebt)
  const btnCloseModal = $("btnCloseModal");
  if (btnCloseModal) btnCloseModal.addEventListener("click", closeActionsModal);

  // Setup signature
  setupSignatureCanvas();

  // Init
  loadMyShipments();
})();
