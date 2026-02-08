// public/js/dashboard.js
// Chauffeur dashboard: lijst, modal, statusknoppen, handtekening, 2 uploads + verwijderen, pdf, archiveren

(function () {
  const $ = (id) => document.getElementById(id);

  const tbody = $("shipmentsTbody");
  const msg = $("msg");
  const whoami = $("whoami");

  const modalBackdrop = $("modalBackdrop");
  const closeModalBtn = $("closeModalBtn");
  const modalError = $("modalError");
  const modalTrack = $("modalTrack");

  const btnPickup = $("btnPickup");
  const btnTransit = $("btnTransit");
  const btnDelivered = $("btnDelivered");
  const btnProblem = $("btnProblem");

  const receiverName = $("receiverName");
  const note = $("note");
  const sigCanvas = $("sigCanvas");
  const clearSigBtn = $("clearSigBtn");

  const file1 = $("file1");
  const file2 = $("file2");
  const deleteFile1Btn = $("deleteFile1Btn");
  const deleteFile2Btn = $("deleteFile2Btn");
  const file1Info = $("file1Info");
  const file2Info = $("file2Info");

  const saveEventBtn = $("saveEventBtn");
  const archiveBtn = $("archiveBtn");
  const pdfBtn = $("pdfBtn");

  const logoutBtn = $("logoutBtn");
  const newShipmentBtn = $("newShipmentBtn");

  const BUCKET = "delivery-files";

  let currentShipment = null; // shipment row
  let currentActiveStatus = null; // pickup/in_transit/delivered/problem
  let signatureDrawing = false;

  function showMsg(el, text, type = "bad") {
    el.style.display = "block";
    el.className = "msg " + type;
    el.textContent = text;
  }
  function hideMsg(el) {
    el.style.display = "none";
  }

  function statusNl(status) {
    const map = {
      created: "Aangemeld",
      pickup: "Opgehaald",
      in_transit: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      archived: "Afgehandeld"
    };
    return map[status] || status || "-";
  }

  function fmtDate(iso) {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString("nl-NL");
    } catch {
      return iso;
    }
  }

  function setActiveButton(status) {
    currentActiveStatus = status;

    // reset
    [btnPickup, btnTransit, btnDelivered, btnProblem].forEach(b => {
      b.classList.remove("activeGlow");
      b.classList.remove("green");
      b.classList.add("gray");
    });

    // active -> green glow
    let btn = null;
    if (status === "pickup") btn = btnPickup;
    if (status === "in_transit") btn = btnTransit;
    if (status === "delivered") btn = btnDelivered;
    if (status === "problem") btn = btnProblem;

    if (btn) {
      btn.classList.remove("gray");
      btn.classList.add("green");
      btn.classList.add("activeGlow");
    }
  }

  // ---------- Signature pad ----------
  function getCanvasPos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function setupSignature() {
    const ctx = sigCanvas.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "white";

    function start(e) {
      signatureDrawing = true;
      const p = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      e.preventDefault();
    }
    function move(e) {
      if (!signatureDrawing) return;
      const p = getCanvasPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      e.preventDefault();
    }
    function end(e) {
      signatureDrawing = false;
      e.preventDefault();
    }

    sigCanvas.addEventListener("mousedown", start);
    sigCanvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);

    sigCanvas.addEventListener("touchstart", start, { passive: false });
    sigCanvas.addEventListener("touchmove", move, { passive: false });
    sigCanvas.addEventListener("touchend", end, { passive: false });

    clearSigBtn.addEventListener("click", () => {
      ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    });
  }

  function resizeCanvasForHiDpi() {
    const ratio = window.devicePixelRatio || 1;
    const rect = sigCanvas.getBoundingClientRect();
    sigCanvas.width = Math.floor(rect.width * ratio);
    sigCanvas.height = Math.floor(rect.height * ratio);
    const ctx = sigCanvas.getContext("2d");
    ctx.scale(ratio, ratio);
  }

  function getSignatureDataUrl() {
    // check if empty-ish: we do a quick pixel test
    const ctx = sigCanvas.getContext("2d");
    const img = ctx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
    let hasInk = false;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i + 3] !== 0) { hasInk = true; break; }
    }
    if (!hasInk) return null;
    return sigCanvas.toDataURL("image/png");
  }

  // ---------- Modal ----------
  function openModal(shipment) {
    currentShipment = shipment;
    hideMsg(modalError);

    modalTrack.textContent = shipment.track_code || shipment.id;

    // prefill fields from latest delivered event if exists (so it doesn't reset)
    receiverName.value = shipment._lastDelivered?.receiver_name || "";
    note.value = shipment._lastDelivered?.note || "";

    // Load signature if exists
    const ctx = sigCanvas.getContext("2d");
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    const sig = shipment._lastDelivered?.signature_data;
    if (sig && typeof sig === "string" && sig.startsWith("data:image")) {
      const img = new Image();
      img.onload = () => {
        // draw into canvas
        ctx.drawImage(img, 0, 0, sigCanvas.width / (window.devicePixelRatio || 1), sigCanvas.height / (window.devicePixelRatio || 1));
      };
      img.src = sig;
    }

    // Show existing attachments
    file1.value = "";
    file2.value = "";
    file1Info.textContent = shipment._lastDelivered?.attachment1_url ? `1: ${shipment._lastDelivered.attachment1_url}` : "1: -";
    file2Info.textContent = shipment._lastDelivered?.attachment2_url ? `2: ${shipment._lastDelivered.attachment2_url}` : "2: -";

    // highlight current status
    setActiveButton(shipment.status);

    modalBackdrop.style.display = "flex";
  }

  function closeModal() {
    modalBackdrop.style.display = "none";
    currentShipment = null;
    currentActiveStatus = null;
  }

  closeModalBtn.addEventListener("click", closeModal);

  // ---------- Upload helpers ----------
  function safeFileName(name) {
    return name.replace(/[^\w.\-]+/g, "_");
  }

  async function uploadToStorage(file, shipmentId, slot) {
    // slot: 1 or 2
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `shipments/${shipmentId}/attachment_${slot}_${Date.now()}_${safeFileName(file.name)}`;

    const { error: upErr } = await supabaseClient.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || undefined
    });

    if (upErr) throw upErr;

    // public url (bucket public)
    const { data } = supabaseClient.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  async function deleteFromStorageByUrl(publicUrl) {
    try {
      if (!publicUrl) return;
      // publicUrl looks like: https://xxxx.supabase.co/storage/v1/object/public/delivery-files/shipments/....
      const marker = `/storage/v1/object/public/${BUCKET}/`;
      const idx = publicUrl.indexOf(marker);
      if (idx === -1) return;
      const objectPath = publicUrl.substring(idx + marker.length);

      const { error } = await supabaseClient.storage.from(BUCKET).remove([objectPath]);
      if (error) console.warn("Delete storage error:", error);
    } catch (e) {
      console.warn("deleteFromStorageByUrl failed:", e);
    }
  }

  // ---------- DB helpers ----------
  async function fetchShipmentsWithLastDelivered() {
    // active shipments only (not archived)
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
      showMsg(msg, "Je bent niet ingelogd.", "bad");
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Niet ingelogd.</td></tr>`;
      return [];
    }

    whoami.textContent = `Ingelogd als: ${user.email}`;

    // shipments
    const { data: shipments, error } = await supabaseClient
      .from("shipments")
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, driver_id")
      .eq("driver_id", user.id)
      .neq("status", "archived")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    // fetch last delivered events for prefill
    const ids = shipments.map(s => s.id);
    let deliveredMap = {};
    if (ids.length > 0) {
      const { data: deliveredEvents, error: evErr } = await supabaseClient
        .from("shipment_events")
        .select("shipment_id, created_at, receiver_name, note, signature_data, attachment1_url, attachment2_url")
        .in("shipment_id", ids)
        .eq("event_type", "delivered")
        .order("created_at", { ascending: false });

      if (evErr) throw evErr;

      for (const ev of deliveredEvents) {
        if (!deliveredMap[ev.shipment_id]) deliveredMap[ev.shipment_id] = ev; // first is newest due to ordering
      }
    }

    return shipments.map(s => ({ ...s, _lastDelivered: deliveredMap[s.id] || null }));
  }

  function renderShipments(rows) {
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(s => {
      return `
        <tr>
          <td><b>${s.track_code || "-"}</b></td>
          <td>${s.customer_name || "-"}</td>
          <td>${statusNl(s.status)}</td>
          <td>${s.colli_count ?? "-"}</td>
          <td>${s.weight_kg ?? "-"}</td>
          <td>${fmtDate(s.updated_at)}</td>
          <td>
            <button class="btn" data-action="edit" data-id="${s.id}">Wijzigen</button>
            <button class="btn blue" data-action="pdf" data-id="${s.id}">PDF</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function reload() {
    hideMsg(msg);
    tbody.innerHTML = `<tr><td colspan="7" class="muted">Laden...</td></tr>`;
    try {
      const rows = await fetchShipmentsWithLastDelivered();
      renderShipments(rows);
      window.__dvkRows = rows; // debug
    } catch (e) {
      console.error(e);
      showMsg(msg, `Fout bij laden: ${e.message || e}`, "bad");
      tbody.innerHTML = `<tr><td colspan="7" class="muted">Fout bij laden.</td></tr>`;
    }
  }

  // ---------- Event saving ----------
  async function saveEvent(eventType) {
    if (!currentShipment) return;

    hideMsg(modalError);

    // if delivered, we want receiver + signature optionally
    const receiver = receiverName.value.trim() || null;
    const n = note.value.trim() || null;
    const sig = getSignatureDataUrl();

    // upload new files if selected
    let att1Url = currentShipment._lastDelivered?.attachment1_url || null;
    let att2Url = currentShipment._lastDelivered?.attachment2_url || null;

    try {
      // file 1 upload
      if (file1.files && file1.files[0]) {
        const url = await uploadToStorage(file1.files[0], currentShipment.id, 1);
        att1Url = url;
        file1Info.textContent = `1: ${url}`;
      }
      // file 2 upload
      if (file2.files && file2.files[0]) {
        const url = await uploadToStorage(file2.files[0], currentShipment.id, 2);
        att2Url = url;
        file2Info.textContent = `2: ${url}`;
      }

      // insert event
      const payload = {
        shipment_id: currentShipment.id,
        event_type: eventType,
        note: n
      };

      // only store receiver/signature/attachments on delivered (or allow for any if you prefer)
      if (eventType === "delivered") {
        payload.receiver_name = receiver;
        payload.signature_data = sig;
        payload.attachment1_url = att1Url;
        payload.attachment2_url = att2Url;
      }

      const { error: insErr } = await supabaseClient
        .from("shipment_events")
        .insert(payload);

      if (insErr) throw insErr;

      // update shipment status
      const { error: upErr } = await supabaseClient
        .from("shipments")
        .update({ status: eventType, updated_at: new Date().toISOString() })
        .eq("id", currentShipment.id);

      if (upErr) throw upErr;

      // refresh current shipment lastDelivered if delivered
      if (eventType === "delivered") {
        currentShipment._lastDelivered = {
          receiver_name: receiver,
          note: n,
          signature_data: sig,
          attachment1_url: att1Url,
          attachment2_url: att2Url
        };
      }

      // keep form filled after save (your request)
      setActiveButton(eventType);

      await reload();
      showMsg(modalError, "Opgeslagen ✅", "ok");
      setTimeout(() => hideMsg(modalError), 1200);
    } catch (e) {
      console.error(e);
      showMsg(modalError, `Event opslaan mislukt: ${e.message || e}`, "bad");
    }
  }

  // ---------- Delete attachments ----------
  async function deleteAttachment(slot) {
    if (!currentShipment) return;
    hideMsg(modalError);

    try {
      // which url
      const last = currentShipment._lastDelivered || {};
      const url = slot === 1 ? last.attachment1_url : last.attachment2_url;
      if (!url) {
        showMsg(modalError, `Geen bijlage ${slot} om te verwijderen.`, "warn");
        setTimeout(() => hideMsg(modalError), 1200);
        return;
      }

      // delete from storage
      await deleteFromStorageByUrl(url);

      // update latest delivered row in DB:
      // we update ALL delivered events for this shipment? Nee: we updaten de nieuwste delivered event.
      const { data: deliveredEvents, error: evErr } = await supabaseClient
        .from("shipment_events")
        .select("id, created_at")
        .eq("shipment_id", currentShipment.id)
        .eq("event_type", "delivered")
        .order("created_at", { ascending: false })
        .limit(1);

      if (evErr) throw evErr;
      const latest = deliveredEvents?.[0];
      if (!latest) throw new Error("Geen delivered event gevonden om bijlage te updaten.");

      const patch = {};
      if (slot === 1) patch.attachment1_url = null;
      if (slot === 2) patch.attachment2_url = null;

      const { error: updErr } = await supabaseClient
        .from("shipment_events")
        .update(patch)
        .eq("id", latest.id);

      if (updErr) throw updErr;

      // update local
      if (!currentShipment._lastDelivered) currentShipment._lastDelivered = {};
      if (slot === 1) currentShipment._lastDelivered.attachment1_url = null;
      if (slot === 2) currentShipment._lastDelivered.attachment2_url = null;

      if (slot === 1) file1Info.textContent = "1: -";
      if (slot === 2) file2Info.textContent = "2: -";

      showMsg(modalError, `Bijlage ${slot} verwijderd ✅`, "ok");
      setTimeout(() => hideMsg(modalError), 1200);
    } catch (e) {
      console.error(e);
      showMsg(modalError, `Verwijderen mislukt: ${e.message || e}`, "bad");
    }
  }

  // ---------- Archive ----------
  async function archiveShipment() {
    if (!currentShipment) return;
    hideMsg(modalError);

    try {
      const { error } = await supabaseClient
        .from("shipments")
        .update({ status: "archived", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", currentShipment.id);

      if (error) throw error;

      await reload();
      closeModal();
    } catch (e) {
      console.error(e);
      showMsg(modalError, `Archiveren mislukt: ${e.message || e}`, "bad");
    }
  }

  // ---------- PDF ----------
  async function generateDeliveryPdf(shipmentId) {
    if (!window.supabaseClient) {
      alert("Supabase client ontbreekt.");
      return;
    }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("jsPDF library ontbreekt.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    const { data: shipment, error: shipErr } = await supabaseClient
      .from("shipments")
      .select(`
        id, track_code, customer_name, status, colli_count, weight_kg,
        pickup_address, dropoff_address, shipment_type,
        updated_at, created_at, archived_at
      `)
      .eq("id", shipmentId)
      .single();

    if (shipErr) {
      console.error(shipErr);
      alert("Kon zending niet ophalen voor PDF.");
      return;
    }

    const { data: events, error: evErr } = await supabaseClient
      .from("shipment_events")
      .select("event_type, created_at, note, receiver_name, signature_data, attachment1_url, attachment2_url")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (evErr) {
      console.error(evErr);
      alert("Kon events niet ophalen voor PDF.");
      return;
    }

    const mapStatus = (s) => ({
      created: "Aangemeld",
      pickup: "Opgehaald",
      in_transit: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      cancelled: "Geannuleerd",
      archived: "Afgehandeld",
    }[s] || s || "-");

    const formatDate = (iso) => iso ? new Date(iso).toLocaleString("nl-NL") : "-";

    const deliveredEvent = [...(events || [])].reverse().find(e => e.event_type === "delivered") || null;

    let y = 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Afleverbon – De Vechtse Koeriers", 14, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const lines = [
      `Trackcode: ${shipment.track_code || "-"}`,
      `Klant: ${shipment.customer_name || "-"}`,
      `Status: ${mapStatus(shipment.status)}`,
      `Ophaaladres: ${shipment.pickup_address || "-"}`,
      `Bezorgadres: ${shipment.dropoff_address || "-"}`,
      `Type zending: ${shipment.shipment_type || "-"}`,
      `Colli: ${shipment.colli_count ?? "-"}`,
      `Kg: ${shipment.weight_kg ?? "-"}`,
      `Aangemaakt: ${formatDate(shipment.created_at)}`,
      `Laatst bijgewerkt: ${formatDate(shipment.updated_at)}`,
      `Afgehandeld (archief): ${shipment.archived_at ? formatDate(shipment.archived_at) : "nee"}`,
    ];

    doc.text(lines, 14, y);
    y += lines.length * 6 + 4;

    doc.setFont("helvetica", "bold");
    doc.text("Tijdlijn", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    if (!events || events.length === 0) {
      doc.text("- Geen gebeurtenissen", 14, y);
      y += 6;
    } else {
      for (const ev of events) {
        const row = `${formatDate(ev.created_at)} — ${mapStatus(ev.event_type)}${ev.note ? ` — ${ev.note}` : ""}`;
        const wrapped = doc.splitTextToSize(row, 180);
        doc.text(wrapped, 14, y);
        y += wrapped.length * 6;

        if (y > 260) {
          doc.addPage();
          y = 14;
        }
      }
    }

    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Aflevering", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    doc.text(`Ontvangen door: ${deliveredEvent?.receiver_name || "-"}`, 14, y); y += 6;
    doc.text(`Notitie: ${deliveredEvent?.note || "-"}`, 14, y); y += 8;

    // Attachments links
    const a1 = deliveredEvent?.attachment1_url || null;
    const a2 = deliveredEvent?.attachment2_url || null;

    doc.setFont("helvetica", "bold");
    doc.text("Bijlagen", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.text(`Bijlage 1: ${a1 || "-"}`, 14, y); y += 6;
    doc.text(`Bijlage 2: ${a2 || "-"}`, 14, y); y += 10;

    const sig = deliveredEvent?.signature_data;
    if (sig && typeof sig === "string" && sig.startsWith("data:image")) {
      if (y > 220) { doc.addPage(); y = 14; }
      doc.setFont("helvetica", "bold");
      doc.text("Handtekening", 14, y);
      y += 4;
      doc.addImage(sig, "PNG", 14, y + 2, 160, 50);
      y += 60;
    } else {
      doc.text("Handtekening: -", 14, y);
      y += 6;
    }

    doc.setFontSize(9);
    doc.text("De Vechtse Koeriers — afleverbon is opvraagbaar via de vervoerder.", 14, 290);

    const filename = `Afleverbon_${shipment.track_code || shipment.id}.pdf`;
    doc.save(filename);
  }

  // ---------- UI hooks ----------
  btnPickup.addEventListener("click", () => setActiveButton("pickup"));
  btnTransit.addEventListener("click", () => setActiveButton("in_transit"));
  btnDelivered.addEventListener("click", () => setActiveButton("delivered"));
  btnProblem.addEventListener("click", () => setActiveButton("problem"));

  saveEventBtn.addEventListener("click", () => {
    if (!currentActiveStatus) return;
    saveEvent(currentActiveStatus);
  });

  archiveBtn.addEventListener("click", archiveShipment);

  pdfBtn.addEventListener("click", () => {
    if (!currentShipment) return;
    generateDeliveryPdf(currentShipment.id);
  });

  deleteFile1Btn.addEventListener("click", () => deleteAttachment(1));
  deleteFile2Btn.addEventListener("click", () => deleteAttachment(2));

  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");
    const id = btn.getAttribute("data-id");

    const rows = window.__dvkRows || [];
    const shipment = rows.find(r => r.id === id);
    if (!shipment) return;

    if (action === "edit") openModal(shipment);
    if (action === "pdf") generateDeliveryPdf(id);
  });

  logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    location.href = "./login.html";
  });

  newShipmentBtn.addEventListener("click", () => {
    alert("Nieuwe zending aanmaken zit bij jou al in de bestaande flow. Als je wilt, zet ik die hier ook netjes compleet in.");
  });

  // ---------- Init ----------
  async function init() {
    if (!window.supabaseClient) {
      showMsg(msg, "Supabase client ontbreekt. Check supabase-config.js", "bad");
      return;
    }
    resizeCanvasForHiDpi();
    setupSignature();
    await reload();
  }

  window.addEventListener("resize", () => {
    // her-scale canvas
    resizeCanvasForHiDpi();
  });

  init();
})();
