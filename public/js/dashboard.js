/* public/js/dashboard.js */
(() => {
  const sb = window.supabaseClient;
  const log = (...a) => console.log("[DVK][dash]", ...a);

  // Elements
  const userEmail = document.getElementById("userEmail");
  const dashMsg = document.getElementById("dashMsg");
  const shipmentsBody = document.getElementById("shipmentsBody");
  const toggleArchiveBtn = document.getElementById("toggleArchiveBtn");
  const modeLabel = document.getElementById("modeLabel");

  const newModal = document.getElementById("newModal");
  const newMsg = document.getElementById("newMsg");
  const newCustomer = document.getElementById("newCustomer");
  const newPickup = document.getElementById("newPickup");
  const newDropoff = document.getElementById("newDropoff");
  const newType = document.getElementById("newType");
  const newColli = document.getElementById("newColli");
  const newKg = document.getElementById("newKg");

  const editModal = document.getElementById("editModal");
  const editMsg = document.getElementById("editMsg");
  const editTrack = document.getElementById("editTrack");
  const receiverName = document.getElementById("receiverName");
  const note = document.getElementById("note");

  const doc1 = document.getElementById("doc1");
  const doc2 = document.getElementById("doc2");
  const doc1Info = document.getElementById("doc1Info");
  const doc2Info = document.getElementById("doc2Info");

  const sigCanvas = document.getElementById("sigCanvas");
  const sigCtx = sigCanvas.getContext("2d");

  // Status buttons
  const statusButtons = [...document.querySelectorAll(".statusBtn")];

  // State
  let sessionUser = null;
  let showArchive = false;
  let currentShipment = null;
  let selectedStatus = null;

  // ===== Helpers =====
  function showMsg(el, text, type = "error") {
    el.style.display = "block";
    el.className = "msg " + (type === "ok" ? "ok" : type === "warn" ? "warn" : "bad");
    el.textContent = text;
  }
  function hideMsg(el) {
    el.style.display = "none";
    el.textContent = "";
  }

  function formatDate(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    return d.toLocaleString("nl-NL", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }

  function statusNL(s) {
    switch (s) {
      case "created": return "Aangemaakt";
      case "picked_up": return "Opgehaald";
      case "in_transit": return "Onderweg";
      case "delivered": return "Afgeleverd";
      case "problem": return "Probleem";
      default: return s || "-";
    }
  }

  function setActiveStatusButton(status) {
    statusButtons.forEach(btn => {
      const isActive = btn.dataset.status === status;
      btn.classList.toggle("active", isActive);
    });
  }

  // ===== Signature draw (mobile friendly) =====
  let drawing = false;
  let last = null;

  function getPos(e) {
    const r = sigCanvas.getBoundingClientRect();
    const t = e.touches && e.touches[0];
    const clientX = t ? t.clientX : e.clientX;
    const clientY = t ? t.clientY : e.clientY;
    return { x: (clientX - r.left) * (sigCanvas.width / r.width), y: (clientY - r.top) * (sigCanvas.height / r.height) };
  }

  function startDraw(e) {
    drawing = true;
    last = getPos(e);
    e.preventDefault();
  }
  function moveDraw(e) {
    if (!drawing) return;
    const p = getPos(e);
    sigCtx.lineWidth = 3;
    sigCtx.lineCap = "round";
    sigCtx.strokeStyle = "#111";
    sigCtx.beginPath();
    sigCtx.moveTo(last.x, last.y);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.stroke();
    last = p;
    e.preventDefault();
  }
  function endDraw(e) {
    drawing = false;
    last = null;
    e && e.preventDefault();
  }

  function clearSignature() {
    sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  }

  function signatureDataURL() {
    // leeg? check snel met pixels
    const img = sigCtx.getImageData(0, 0, sigCanvas.width, sigCanvas.height).data;
    let hasInk = false;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i+3] !== 0) { hasInk = true; break; }
    }
    return hasInk ? sigCanvas.toDataURL("image/png") : null;
  }

  // ===== DB fetch =====
  async function requireSession() {
    if (!sb) {
      showMsg(dashMsg, "Supabase client ontbreekt. Check supabase-config.js");
      return null;
    }
    const { data, error } = await sb.auth.getSession();
    if (error) {
      showMsg(dashMsg, "Auth error: " + error.message);
      return null;
    }
    sessionUser = data?.session?.user || null;
    userEmail.textContent = sessionUser?.email || "-";
    return sessionUser;
  }

  async function loadShipments() {
    hideMsg(dashMsg);
    shipmentsBody.innerHTML = `<tr><td colspan="7" class="muted">Laden…</td></tr>`;

    const user = await requireSession();
    if (!user) return;

    modeLabel.textContent = showArchive ? "Archief" : "Actief";

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, archived")
      .eq("driver_id", user.id)
      .eq("archived", showArchive)
      .order("updated_at", { ascending: false });

    if (error) {
      showMsg(dashMsg, "Fout bij laden: " + error.message);
      shipmentsBody.innerHTML = `<tr><td colspan="7" class="muted">Fout bij laden.</td></tr>`;
      return;
    }

    if (!data || data.length === 0) {
      shipmentsBody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    shipmentsBody.innerHTML = data.map(row => `
      <tr>
        <td><strong>${row.track_code || "-"}</strong></td>
        <td>${row.customer_name || "-"}</td>
        <td>${statusNL(row.status)}</td>
        <td>${row.colli_count ?? "-"}</td>
        <td>${row.weight_kg ?? "-"}</td>
        <td>${formatDate(row.updated_at)}</td>
        <td>
          <button class="btn" data-action="edit" data-id="${row.id}">Wijzigen</button>
        </td>
      </tr>
    `).join("");
  }

  // ===== Create shipment (trackcode auto!) =====
  async function createShipment() {
    hideMsg(newMsg);
    const user = await requireSession();
    if (!user) return;

    const payload = {
      driver_id: user.id,
      customer_name: (newCustomer.value || "").trim(),
      pickup_address: (newPickup.value || "").trim(),
      dropoff_address: (newDropoff.value || "").trim(),
      shipment_type: (newType.value || "").trim(),
      colli_count: newColli.value ? parseInt(newColli.value, 10) : null,
      weight_kg: newKg.value ? parseFloat(newKg.value) : null,
      status: "created",
      archived: false
      // LET OP: GEEN track_code hier -> DB trigger maakt hem automatisch
    };

    if (!payload.customer_name) {
      showMsg(newMsg, "Vul klantnaam in.");
      return;
    }

    const { data, error } = await sb
      .from("shipments")
      .insert([payload])
      .select("id, track_code")
      .single();

    if (error) {
      showMsg(newMsg, "Aanmaken mislukt: " + error.message);
      return;
    }

    showMsg(newMsg, `Zending aangemaakt. Trackcode: ${data.track_code}`, "ok");

    // reset form
    newCustomer.value = "";
    newPickup.value = "";
    newDropoff.value = "";
    newType.value = "";
    newColli.value = "";
    newKg.value = "";

    // close + refresh
    setTimeout(() => {
      newModal.style.display = "none";
      loadShipments();
    }, 350);
  }

  // ===== Edit modal load =====
  async function openEdit(shipmentId) {
    hideMsg(editMsg);
    clearSignature();
    doc1.value = "";
    doc2.value = "";
    doc1Info.textContent = "";
    doc2Info.textContent = "";

    const user = await requireSession();
    if (!user) return;

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, archived")
      .eq("id", shipmentId)
      .single();

    if (error) {
      showMsg(dashMsg, "Kan zending niet openen: " + error.message);
      return;
    }

    currentShipment = data;
    selectedStatus = data.status || "created";
    editTrack.textContent = data.track_code || "-";
    setActiveStatusButton(selectedStatus);

    // Prefill: laatst DELIVERED event (receiver/note/signature) zodat “Afgeleverd” ingevuld blijft
    const { data: events, error: evErr } = await sb
      .from("shipment_events")
      .select("event_type, receiver_name, note, signature_data, doc1_url, doc2_url, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!evErr && events && events.length) {
      const lastDelivered = events.find(e => e.event_type === "delivered");
      const lastAny = events[0];

      const src = lastDelivered || lastAny;
      receiverName.value = src?.receiver_name || "";
      note.value = src?.note || "";

      if (src?.signature_data) {
        const img = new Image();
        img.onload = () => {
          sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
          sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
        };
        img.src = src.signature_data;
      }

      if (src?.doc1_url) doc1Info.textContent = "Bestand #1 opgeslagen.";
      if (src?.doc2_url) doc2Info.textContent = "Bestand #2 opgeslagen.";
    }

    editModal.style.display = "block";
  }

  // ===== Storage upload (optioneel) =====
  // Als je geen storage gebruikt, kun je doc1/doc2 ook uit laten; events blijven dan gewoon opslaan.
  const BUCKET = "delivery-docs";

  async function uploadFile(shipmentId, file, slot) {
    if (!file) return null;
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${shipmentId}/${Date.now()}_${slot}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  }

  // ===== Save event + update shipment status =====
  async function saveEvent() {
    hideMsg(editMsg);
    if (!currentShipment?.id) return;

    const user = await requireSession();
    if (!user) return;

    const sig = signatureDataURL();

    // Upload docs (max 2)
    let doc1Url = null;
    let doc2Url = null;

    try {
      if (doc1.files && doc1.files[0]) doc1Url = await uploadFile(currentShipment.id, doc1.files[0], "doc1");
      if (doc2.files && doc2.files[0]) doc2Url = await uploadFile(currentShipment.id, doc2.files[0], "doc2");
    } catch (e) {
      showMsg(editMsg, "Upload mislukt: " + (e?.message || e), "warn");
      // we gaan door zonder upload
    }

    // 1) update shipment status
    const { error: upErr } = await sb
      .from("shipments")
      .update({ status: selectedStatus })
      .eq("id", currentShipment.id);

    if (upErr) {
      showMsg(editMsg, "Status opslaan mislukt: " + upErr.message);
      return;
    }

    // 2) insert event
    const evPayload = {
      shipment_id: currentShipment.id,
      event_type: selectedStatus,
      receiver_name: (receiverName.value || "").trim() || null,
      note: (note.value || "").trim() || null,
      signature_data: sig || null,
      doc1_url: doc1Url,
      doc2_url: doc2Url
    };

    const { error: evErr } = await sb.from("shipment_events").insert([evPayload]);
    if (evErr) {
      showMsg(editMsg, "Event opslaan mislukt: " + evErr.message);
      return;
    }

    showMsg(editMsg, "Opgeslagen ✅", "ok");

    // refresh table
    loadShipments();
  }

  // ===== Archive toggle / archive action =====
  async function archiveShipment() {
    hideMsg(editMsg);
    if (!currentShipment?.id) return;

    const { error } = await sb
      .from("shipments")
      .update({ archived: true })
      .eq("id", currentShipment.id);

    if (error) {
      showMsg(editMsg, "Archiveren mislukt: " + error.message);
      return;
    }

    showMsg(editMsg, "Gearchiveerd ✅", "ok");
    setTimeout(() => {
      editModal.style.display = "none";
      loadShipments();
    }, 300);
  }

  // ===== PDF generation (gevuld + signature) =====
  async function makePdf() {
    hideMsg(editMsg);
    if (!currentShipment?.id) return;

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      showMsg(editMsg, "jsPDF ontbreekt. Check dashboard.html script include.");
      return;
    }

    // shipment details
    const { data: ship, error: shipErr } = await sb
      .from("shipments")
      .select("track_code, customer_name, status, colli_count, weight_kg, pickup_address, dropoff_address, shipment_type, updated_at")
      .eq("id", currentShipment.id)
      .single();

    if (shipErr) {
      showMsg(editMsg, "PDF: kan zending niet laden: " + shipErr.message);
      return;
    }

    // events
    const { data: events, error: evErr } = await sb
      .from("shipment_events")
      .select("event_type, receiver_name, note, signature_data, created_at")
      .eq("shipment_id", currentShipment.id)
      .order("created_at", { ascending: true });

    if (evErr) {
      showMsg(editMsg, "PDF: kan events niet laden: " + evErr.message);
      return;
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    let y = 52;

    const line = (t, size = 11, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.text(String(t || ""), 40, y);
      y += size + 8;
    };

    line("De Vechtse Koeriers – Afleverbon", 16, true);
    y += 6;

    line(`Trackcode: ${ship.track_code}`, 12, true);
    line(`Klant: ${ship.customer_name || "-"}`);
    line(`Status: ${statusNL(ship.status)}`);
    line(`Ophaaladres: ${ship.pickup_address || "-"}`);
    line(`Bezorgadres: ${ship.dropoff_address || "-"}`);
    line(`Type zending: ${ship.shipment_type || "-"}`);
    line(`Colli: ${ship.colli_count ?? "-"}   Kg: ${ship.weight_kg ?? "-"}`);
    line(`Laatst bijgewerkt: ${formatDate(ship.updated_at)}`);
    y += 8;

    line("Tijdlijn", 13, true);
    y += 2;

    if (!events || events.length === 0) {
      line("Geen gebeurtenissen.", 11, false);
    } else {
      events.forEach(ev => {
        const t = `${formatDate(ev.created_at)} – ${statusNL(ev.event_type)}`;
        line(t, 11, true);
        if (ev.receiver_name) line(`Ontvangen door: ${ev.receiver_name}`, 10, false);
        if (ev.note) line(`Notitie: ${ev.note}`, 10, false);
        y += 4;
        if (y > 720) { doc.addPage(); y = 52; }
      });
    }

    // signature from last delivered event (if any)
    const lastDelivered = (events || []).slice().reverse().find(e => e.event_type === "delivered" && e.signature_data);
    if (lastDelivered?.signature_data) {
      if (y > 620) { doc.addPage(); y = 52; }
      line("Handtekening", 13, true);
      y += 6;
      try {
        doc.addImage(lastDelivered.signature_data, "PNG", 40, y, 520, 140);
        y += 160;
      } catch (e) {
        line("Handtekening kon niet worden toegevoegd.", 10, false);
      }
    } else {
      line("Handtekening: (niet beschikbaar)", 11, false);
    }

    // Save
    const filename = `Afleverbon_${ship.track_code}.pdf`;
    doc.save(filename);
    showMsg(editMsg, "PDF gemaakt ✅", "ok");
  }

  // ===== Bindings =====
  function bind() {
    if (!sb) {
      showMsg(dashMsg, "Supabase client ontbreekt. Check supabase-config.js");
      return;
    }

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await sb.auth.signOut();
      location.href = "../driver/login.html";
    });

    document.getElementById("newShipmentBtn").addEventListener("click", () => {
      hideMsg(newMsg);
      newModal.style.display = "block";
    });
    document.getElementById("closeNewModal").addEventListener("click", () => newModal.style.display = "none");
    document.getElementById("createShipmentBtn").addEventListener("click", createShipment);

    document.getElementById("closeEditModal").addEventListener("click", () => editModal.style.display = "none");
    document.getElementById("saveEventBtn").addEventListener("click", saveEvent);
    document.getElementById("archiveBtn").addEventListener("click", archiveShipment);
    document.getElementById("pdfBtn").addEventListener("click", makePdf);

    toggleArchiveBtn.addEventListener("click", () => {
      showArchive = !showArchive;
      toggleArchiveBtn.textContent = showArchive ? "Terug" : "Archief";
      loadShipments();
    });

    shipmentsBody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action='edit']");
      if (!btn) return;
      openEdit(btn.dataset.id);
    });

    statusButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        selectedStatus = btn.dataset.status;
        setActiveStatusButton(selectedStatus);
      });
    });

    document.getElementById("clearSig").addEventListener("click", clearSignature);

    document.getElementById("removeDoc1").addEventListener("click", () => {
      doc1.value = "";
      doc1Info.textContent = "Bestand #1 verwijderd (lokale selectie).";
    });
    document.getElementById("removeDoc2").addEventListener("click", () => {
      doc2.value = "";
      doc2Info.textContent = "Bestand #2 verwijderd (lokale selectie).";
    });

    // Signature input (mouse + touch)
    sigCanvas.addEventListener("mousedown", startDraw);
    sigCanvas.addEventListener("mousemove", moveDraw);
    window.addEventListener("mouseup", endDraw);

    sigCanvas.addEventListener("touchstart", startDraw, { passive: false });
    sigCanvas.addEventListener("touchmove", moveDraw, { passive: false });
    sigCanvas.addEventListener("touchend", endDraw, { passive: false });
  }

  // ===== Init =====
  bind();
  loadShipments();
})();
