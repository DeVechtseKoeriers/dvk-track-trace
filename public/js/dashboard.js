/* global supabaseClient, html2pdf */
(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    userEmail: $("userEmail"),
    statusMsg: $("statusMsg"),
    shipmentsTbody: $("shipmentsTbody"),
    logoutBtn: $("logoutBtn"),
    newShipmentBtn: $("newShipmentBtn"),
    toggleArchiveBtn: $("toggleArchiveBtn"),
    listTitle: $("listTitle"),

    modal: $("modal"),
    closeModalBtn: $("closeModalBtn"),
    modalMsg: $("modalMsg"),
    modalTrackcode: $("modalTrackcode"),
    timelineBox: $("timelineBox"),

    btnPickedUp: $("btnPickedUp"),
    btnInTransit: $("btnInTransit"),
    btnDelivered: $("btnDelivered"),
    btnProblem: $("btnProblem"),

    deliveredFields: $("deliveredFields"),
    receiverNameInput: $("receiverNameInput"),
    noteInput: $("noteInput"),
    sigCanvas: $("sigCanvas"),
    clearSigBtn: $("clearSigBtn"),

    file1: $("file1"),
    file2: $("file2"),
    deleteFile1Btn: $("deleteFile1Btn"),
    deleteFile2Btn: $("deleteFile2Btn"),
    uploadInfo: $("uploadInfo"),

    pdfBtn: $("pdfBtn"),
    archiveBtn: $("archiveBtn"),
    confirmDeliveredBtn: $("confirmDeliveredBtn"),

    pdfContainer: $("pdfContainer"),
  };

  if (!window.supabaseClient) {
    showMsg(els.statusMsg, "Supabase client ontbreekt. Check supabase-config.js", "bad");
    return;
  }

  let showArchived = false;
  let currentUser = null;
  let currentShipment = null;
  let currentEvents = [];
  let sig = null;
  let attachment1Url = null;
  let attachment2Url = null;

  // ---- UI helpers ----
  function showMsg(el, text, type = "ok") {
    if (!el) return;
    el.style.display = "block";
    el.className = `msg ${type}`;
    el.textContent = text;
  }

  function clearMsg(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function statusLabel(status) {
    const map = {
      created: "Aangemeld",
      pickup: "Opgehaald",
      in_transit: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      archived: "Gearchiveerd",
    };
    return map[status] || status || "-";
  }

  function fmtDate(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function activeBtn(btn, isActive) {
    // "alleen oplichten (groen) welke actief is"
    // We gebruiken bestaande btn class; voegen simpel "active" class toe
    if (!btn) return;
    btn.classList.toggle("active", !!isActive);
  }

  // ---- Signature pad (super simpel) ----
  function initSignature() {
    const canvas = els.sigCanvas;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";

    let drawing = false;

    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - r.left) * (canvas.width / r.width), y: (clientY - r.top) * (canvas.height / r.height) };
    };

    const start = (e) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move = (e) => {
      if (!drawing) return;
      const p = getPos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      e.preventDefault();
    };
    const end = (e) => { drawing = false; e.preventDefault(); };

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);

    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end, { passive: false });

    sig = {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      toDataUrl() {
        // als leeg -> return null
        const blank = document.createElement("canvas");
        blank.width = canvas.width;
        blank.height = canvas.height;
        if (canvas.toDataURL() === blank.toDataURL()) return null;
        return canvas.toDataURL("image/png");
      },
      setFromDataUrl(dataUrl) {
        sig.clear();
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = dataUrl;
      },
    };
  }

  // ---- Auth/session ----
  async function loadSession() {
    const { data } = await supabaseClient.auth.getSession();
    currentUser = data?.session?.user || null;
    els.userEmail.textContent = `Ingelogd als: ${currentUser?.email || "-"}`;
  }

  // ---- Shipments list ----
  async function loadShipments() {
    clearMsg(els.statusMsg);
    els.shipmentsTbody.innerHTML = `<tr><td colspan="7" class="muted">Laden...</td></tr>`;

    const baseSelect = `
      id, track_code, customer_name, status,
      colli_count, weight_kg, updated_at,
      archived_at
    `.trim();

    let q = supabaseClient.from("shipments").select(baseSelect).order("updated_at", { ascending: false });

    if (showArchived) q = q.not("archived_at", "is", null);
    else q = q.is("archived_at", null);

    const { data, error } = await q;

    if (error) {
      showMsg(els.statusMsg, `Fout bij laden: ${error.message}`, "bad");
      els.shipmentsTbody.innerHTML = `<tr><td colspan="7" class="muted">Fout bij laden.</td></tr>`;
      return;
    }

    if (!data || data.length === 0) {
      els.shipmentsTbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    els.shipmentsTbody.innerHTML = data.map((s) => {
      return `
        <tr>
          <td>${escapeHtml(s.track_code)}</td>
          <td>${escapeHtml(s.customer_name || "-")}</td>
          <td>${escapeHtml(statusLabel(s.status))}</td>
          <td>${escapeHtml(String(s.colli_count ?? "-"))}</td>
          <td>${escapeHtml(String(s.weight_kg ?? "-"))}</td>
          <td>${escapeHtml(fmtDate(s.updated_at))}</td>
          <td>
            <button class="btn" data-action="edit" data-id="${s.id}">Wijzigen</button>
          </td>
        </tr>
      `;
    }).join("");

    // bind row actions
    [...els.shipmentsTbody.querySelectorAll("button[data-action='edit']")].forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        await openShipmentModal(id);
      });
    });
  }

  // ---- Modal open ----
  async function openShipmentModal(shipmentId) {
    clearMsg(els.modalMsg);
    els.deliveredFields.style.display = "none";
    els.timelineBox.innerHTML = "";
    els.receiverNameInput.value = "";
    els.noteInput.value = "";
    attachment1Url = null;
    attachment2Url = null;
    els.file1.value = "";
    els.file2.value = "";
    els.uploadInfo.textContent = "Nog geen bestanden.";
    if (sig) sig.clear();

    // load shipment
    const { data: shipment, error: sErr } = await supabaseClient
      .from("shipments")
      .select("*")
      .eq("id", shipmentId)
      .single();

    if (sErr) {
      showMsg(els.modalMsg, `Zending laden mislukt: ${sErr.message}`, "bad");
      return;
    }

    currentShipment = shipment;
    els.modalTrackcode.textContent = shipment.track_code;

    // load events
    const { data: events, error: eErr } = await supabaseClient
      .from("shipment_events")
      .select("id, event_type, created_at, note, receiver_name, signature_data, attachment1_url, attachment2_url")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (eErr) {
      showMsg(els.modalMsg, `Events laden mislukt: ${eErr.message}`, "bad");
      return;
    }

    currentEvents = events || [];
    renderTimeline(currentEvents);

    // active buttons highlight (oplichten)
    const st = shipment.status;
    activeBtn(els.btnPickedUp, st === "pickup");
    activeBtn(els.btnInTransit, st === "in_transit");
    activeBtn(els.btnDelivered, st === "delivered");
    activeBtn(els.btnProblem, st === "problem");

    // if already delivered, keep fields filled
    if (st === "delivered") {
      els.deliveredFields.style.display = "block";
      const lastDel = [...currentEvents].reverse().find(ev => ev.event_type === "delivered");
      if (lastDel) {
        els.receiverNameInput.value = lastDel.receiver_name || "";
        els.noteInput.value = lastDel.note || "";
        if (sig) sig.setFromDataUrl(lastDel.signature_data || null);
        attachment1Url = lastDel.attachment1_url || null;
        attachment2Url = lastDel.attachment2_url || null;
        updateUploadInfo();
      }
    }

    els.modal.style.display = "block";
  }

  function closeModal() {
    els.modal.style.display = "none";
    currentShipment = null;
    currentEvents = [];
  }

  // ---- Timeline render ----
  function renderTimeline(events) {
    if (!els.timelineBox) return;
    if (!events || events.length === 0) {
      els.timelineBox.innerHTML = `<div class="muted">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }
    els.timelineBox.innerHTML = events.map((ev) => {
      const t = statusLabel(ev.event_type);
      const note = ev.note ? `<div class="muted">${escapeHtml(ev.note)}</div>` : "";
      const recv = ev.receiver_name ? `<div class="muted">Ontvangen door: ${escapeHtml(ev.receiver_name)}</div>` : "";
      return `
        <div class="timeline-item">
          <div style="font-weight:700;">${escapeHtml(t)}</div>
          <div class="muted">${escapeHtml(fmtDate(ev.created_at))}</div>
          ${recv}
          ${note}
        </div>
      `;
    }).join("");
  }

  // ---- Status update helpers ----
  async function setShipmentStatus(newStatus) {
    if (!currentShipment) return;

    // update shipment status
    const { error: uErr } = await supabaseClient
      .from("shipments")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", currentShipment.id);

    if (uErr) {
      showMsg(els.modalMsg, `Status updaten mislukt: ${uErr.message}`, "bad");
      return false;
    }

    // insert event
    const { error: iErr } = await supabaseClient
      .from("shipment_events")
      .insert({
        shipment_id: currentShipment.id,
        event_type: newStatus,
        note: null,
        receiver_name: null,
        signature_data: null,
        attachment1_url: null,
        attachment2_url: null
      });

    if (iErr) {
      showMsg(els.modalMsg, `Event opslaan mislukt: ${iErr.message}`, "bad");
      return false;
    }

    // reload modal data
    await openShipmentModal(currentShipment.id);
    await loadShipments();
    return true;
  }

  // ---- Upload helpers ----
  function updateUploadInfo() {
    const parts = [];
    if (attachment1Url) parts.push("Bestand 1 ✅");
    if (attachment2Url) parts.push("Bestand 2 ✅");
    els.uploadInfo.textContent = parts.length ? parts.join(" • ") : "Nog geen bestanden.";
  }

  async function uploadFileToStorage(file, slot /* 1 or 2 */) {
    if (!currentShipment) return null;
    if (!file) return null;

    // Bucket naam (maak deze in Supabase Storage aan als je dat nog niet hebt)
    const bucket = "delivery-files";

    const ext = file.name.split(".").pop() || "bin";
    const path = `${currentShipment.track_code}/${Date.now()}_${slot}.${ext}`;

    const { error: upErr } = await supabaseClient.storage.from(bucket).upload(path, file, { upsert: true });
    if (upErr) throw upErr;

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async function deleteStorageUrl(url) {
    if (!url) return;
    const bucket = "delivery-files";
    // public URL -> path halen
    const marker = `/${bucket}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return;
    const path = url.substring(idx + marker.length);
    await supabaseClient.storage.from(bucket).remove([path]);
  }

  // ---- Delivered confirm (met velden bewaren!) ----
  async function confirmDelivered() {
    if (!currentShipment) return;

    const receiver = (els.receiverNameInput.value || "").trim() || null;
    const note = (els.noteInput.value || "").trim() || null;
    const signatureData = sig ? sig.toDataUrl() : null;

    // Upload files if chosen
    try {
      if (els.file1.files?.[0]) attachment1Url = await uploadFileToStorage(els.file1.files[0], 1);
      if (els.file2.files?.[0]) attachment2Url = await uploadFileToStorage(els.file2.files[0], 2);
    } catch (e) {
      showMsg(els.modalMsg, `Upload mislukt: ${e.message}`, "bad");
      return;
    }

    // update shipment status
    const { error: uErr } = await supabaseClient
      .from("shipments")
      .update({ status: "delivered", updated_at: new Date().toISOString() })
      .eq("id", currentShipment.id);

    if (uErr) {
      showMsg(els.modalMsg, `Aflevering opslaan mislukt: ${uErr.message}`, "bad");
      return;
    }

    // insert event (met receiver/signature/attachments)
    const { error: iErr } = await supabaseClient
      .from("shipment_events")
      .insert({
        shipment_id: currentShipment.id,
        event_type: "delivered",
        note,
        receiver_name: receiver,
        signature_data: signatureData,
        attachment1_url: attachment1Url,
        attachment2_url: attachment2Url
      });

    if (iErr) {
      showMsg(els.modalMsg, `Event opslaan mislukt: ${iErr.message}`, "bad");
      return;
    }

    // heropen modal zodat alles ingevuld blijft
    await openShipmentModal(currentShipment.id);
    await loadShipments();
    showMsg(els.modalMsg, "Afgeleverd opgeslagen ✅", "ok");
  }

  // ---- Archive ----
  async function archiveShipment() {
    if (!currentShipment) return;

    const { error } = await supabaseClient
      .from("shipments")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: currentUser?.id || null,
        status: "archived",
        updated_at: new Date().toISOString()
      })
      .eq("id", currentShipment.id);

    if (error) {
      showMsg(els.modalMsg, `Archiveren mislukt: ${error.message}`, "bad");
      return;
    }

    showMsg(els.modalMsg, "Zending gearchiveerd ✅", "ok");
    closeModal();
    await loadShipments();
  }

  // ---- PDF ----
  async function makePdf() {
    if (!currentShipment) return;

    // Pak laatste delivered event voor receiver/signature
    const lastDelivered = [...currentEvents].reverse().find(ev => ev.event_type === "delivered") || null;

    // Bouw HTML
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:12px;">
        <h2>Afleverbon – De Vechtse Koeriers</h2>
        <div><b>Trackcode:</b> ${escapeHtml(currentShipment.track_code)}</div>
        <div><b>Klant:</b> ${escapeHtml(currentShipment.customer_name || "-")}</div>
        <div><b>Status:</b> ${escapeHtml(statusLabel(currentShipment.status))}</div>
        <div><b>Colli:</b> ${escapeHtml(String(currentShipment.colli_count ?? "-"))}</div>
        <div><b>Kg:</b> ${escapeHtml(String(currentShipment.weight_kg ?? "-"))}</div>

        <hr/>
        <h3>Timeline</h3>
        ${currentEvents.map(ev => `
          <div style="margin-bottom:6px;">
            <b>${escapeHtml(statusLabel(ev.event_type))}</b> – ${escapeHtml(fmtDate(ev.created_at))}
            ${ev.receiver_name ? `<div>Ontvangen door: ${escapeHtml(ev.receiver_name)}</div>` : ""}
            ${ev.note ? `<div>Notitie: ${escapeHtml(ev.note)}</div>` : ""}
          </div>
        `).join("")}

        <hr/>
        <h3>Afgeleverd</h3>
        <div><b>Ontvangen door:</b> ${escapeHtml(lastDelivered?.receiver_name || "-")}</div>
        <div><b>Notitie:</b> ${escapeHtml(lastDelivered?.note || "-")}</div>

        <div style="margin-top:10px;">
          <b>Handtekening:</b><br/>
          ${lastDelivered?.signature_data ? `<img src="${lastDelivered.signature_data}" style="max-width:600px;border:1px solid #ddd;" />` : "-"}
        </div>
      </div>
    `;

    els.pdfContainer.innerHTML = html;

    const opt = {
      margin: 10,
      filename: `Afleverbon_${currentShipment.track_code}.pdf`,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    };

    await html2pdf().from(els.pdfContainer).set(opt).save();
  }

  // ---- Create new shipment (basic) ----
  async function createNewShipment() {
    // simpele prompt variant (werkt stabiel); jij kunt dit later “mooi” maken
    const track = prompt("Trackcode (bijv. DVK-2026-0001):");
    if (!track) return;

    const klant = prompt("Klantnaam:");
    if (!klant) return;

    const colli = Number(prompt("Aantal colli:", "1") || "1");
    const kg = Number(prompt("Kg:", "1") || "1");

    const { error } = await supabaseClient.from("shipments").insert({
      track_code: track,
      customer_name: klant,
      status: "created",
      colli_count: isNaN(colli) ? null : colli,
      weight_kg: isNaN(kg) ? null : kg
    });

    if (error) {
      showMsg(els.statusMsg, `Nieuwe zending mislukt: ${error.message}`, "bad");
      return;
    }

    showMsg(els.statusMsg, "Nieuwe zending aangemaakt ✅", "ok");
    await loadShipments();
  }

  // ---- Bind events ----
  function bindEvents() {
    els.closeModalBtn.addEventListener("click", closeModal);
    els.logoutBtn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      location.href = "./login.html";
    });

    els.newShipmentBtn.addEventListener("click", createNewShipment);

    els.toggleArchiveBtn.addEventListener("click", async () => {
      showArchived = !showArchived;
      els.listTitle.textContent = showArchived ? "Archief" : "Mijn zendingen";
      els.toggleArchiveBtn.textContent = showArchived ? "Terug" : "Archief";
      await loadShipments();
    });

    els.btnPickedUp.addEventListener("click", async () => { await setShipmentStatus("pickup"); });
    els.btnInTransit.addEventListener("click", async () => { await setShipmentStatus("in_transit"); });
    els.btnProblem.addEventListener("click", async () => { await setShipmentStatus("problem"); });

    els.btnDelivered.addEventListener("click", async () => {
      // laat velden zien, maar zet status niet meteen
      els.deliveredFields.style.display = "block";
      // highlight delivered button alvast
      activeBtn(els.btnDelivered, true);
    });

    els.clearSigBtn.addEventListener("click", () => sig && sig.clear());

    els.deleteFile1Btn.addEventListener("click", async () => {
      // verwijder uit storage als er al iets was
      await deleteStorageUrl(attachment1Url);
      attachment1Url = null;
      els.file1.value = "";
      updateUploadInfo();
      showMsg(els.modalMsg, "Bestand 1 verwijderd ✅", "ok");
    });

    els.deleteFile2Btn.addEventListener("click", async () => {
      await deleteStorageUrl(attachment2Url);
      attachment2Url = null;
      els.file2.value = "";
      updateUploadInfo();
      showMsg(els.modalMsg, "Bestand 2 verwijderd ✅", "ok");
    });

    els.confirmDeliveredBtn.addEventListener("click", confirmDelivered);
    els.archiveBtn.addEventListener("click", archiveShipment);
    els.pdfBtn.addEventListener("click", makePdf);
  }

  function escapeHtml(s) {
    return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  // ---- boot ----
  (async function boot() {
    initSignature();
    bindEvents();
    await loadSession();
    await loadShipments();
  })();
})();
