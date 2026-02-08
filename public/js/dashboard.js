(() => {
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const el = {
    userEmail: $("userEmail"),
    logoutBtn: $("logoutBtn"),
    newBtn: $("newBtn"),
    tbody: $("tbody"),
    pageMsg: $("pageMsg"),

    tabOpen: $("tabOpen"),
    tabArchive: $("tabArchive"),

    modalBackdrop: $("modalBackdrop"),
    closeModalBtn: $("closeModalBtn"),
    modalMsg: $("modalMsg"),
    modalOk: $("modalOk"),
    mTrack: $("mTrack"),
    mStatus: $("mStatus"),

    btnPickup: $("btnPickup"),
    btnTransit: $("btnTransit"),
    btnDelivered: $("btnDelivered"),
    btnProblem: $("btnProblem"),

    receiverName: $("receiverName"),
    note: $("note"),
    sig: $("sig"),
    clearSigBtn: $("clearSigBtn"),
    saveBtn: $("saveBtn"),

    isClosed: $("isClosed"),
    autoPod: $("autoPod"),

    proofFiles: $("proofFiles"),
    proofList: $("proofList"),

    pdfBtn: $("pdfBtn"),
  };

  const BUCKET = "delivery-proofs";

  let state = {
    user: null,
    tab: "open",
    shipments: [],
    current: null,
    selectedStatus: null,
    drawing: false,
    deliveredCache: new Map(), // shipment_id -> { receiver_name, note, signature_dataurl, proof_paths, proof_names, proof_mimes }
  };

  const statusNL = (s) => {
    const v = String(s || "").toLowerCase();
    const map = {
      created: "Aangemeld",
      pickup: "Opgehaald",
      in_transit: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
    };
    return map[v] || s || "-";
  };

  const escapeHtml = (t) =>
    String(t ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));

  const fmt = (iso) => {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("nl-NL"); }
    catch { return iso; }
  };

  function showMsg(text) {
    el.pageMsg.style.display = text ? "block" : "none";
    el.pageMsg.textContent = text || "";
  }
  function showModalErr(text) {
    el.modalMsg.style.display = text ? "block" : "none";
    el.modalMsg.textContent = text || "";
    el.modalOk.style.display = "none";
  }
  function showModalOk(text) {
    el.modalOk.style.display = text ? "block" : "none";
    el.modalOk.textContent = text || "";
    el.modalMsg.style.display = "none";
  }

  function setActiveStatusButton(status) {
    const all = [el.btnPickup, el.btnTransit, el.btnDelivered, el.btnProblem];
    all.forEach(b => b.classList.remove("active-green"));

    const map = {
      pickup: el.btnPickup,
      in_transit: el.btnTransit,
      delivered: el.btnDelivered,
      problem: el.btnProblem,
    };
    const btn = map[status];
    if (btn) btn.classList.add("active-green");
  }

  async function requireAuth() {
    if (!sb) {
      showMsg("Supabase client ontbreekt. Check supabase-config.js");
      throw new Error("no client");
    }

    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    const user = data?.session?.user;
    if (!user) {
      location.href = "./login.html";
      throw new Error("no session");
    }

    state.user = user;
    el.userEmail.textContent = user.email || "-";
  }

  async function loadShipments() {
    showMsg("");
    el.tbody.innerHTML = `<tr><td colspan="7" class="muted">Laden…</td></tr>`;

    const closed = state.tab === "archive";

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, is_closed, pod_pdf_path")
      .eq("driver_id", state.user.id)
      .eq("is_closed", closed)
      .order("updated_at", { ascending: false });

    if (error) {
      showMsg(error.message);
      el.tbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    state.shipments = data || [];

    if (!state.shipments.length) {
      el.tbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    el.tbody.innerHTML = state.shipments.map(s => `
      <tr>
        <td><b>${escapeHtml(s.track_code || "-")}</b></td>
        <td>${escapeHtml(s.customer_name || "-")}</td>
        <td>${escapeHtml(statusNL(s.status))}</td>
        <td>${escapeHtml(s.colli_count ?? "-")}</td>
        <td>${escapeHtml(s.weight_kg ?? "-")}</td>
        <td class="muted">${escapeHtml(fmt(s.updated_at))}</td>
        <td>
          <button class="btn small" data-id="${s.id}" type="button">Wijzigen</button>
        </td>
      </tr>
    `).join("");

    el.tbody.querySelectorAll("button[data-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const shipment = state.shipments.find(x => String(x.id) === String(id));
        if (shipment) await openModal(shipment);
      });
    });
  }

  // ---------- Signature ----------
  function setupSignature() {
    const c = el.sig;
    if (!c) return;
    const ctx = c.getContext("2d");

    function pos(ev) {
      const r = c.getBoundingClientRect();
      const e = ev.touches ? ev.touches[0] : ev;
      const x = (e.clientX - r.left) * (c.width / r.width);
      const y = (e.clientY - r.top) * (c.height / r.height);
      return { x, y };
    }

    function down(ev) {
      state.drawing = true;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ev.preventDefault?.();
    }

    function move(ev) {
      if (!state.drawing) return;
      const p = pos(ev);
      ctx.lineTo(p.x, p.y);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111";
      ctx.stroke();
      ev.preventDefault?.();
    }

    function up() { state.drawing = false; }

    c.addEventListener("mousedown", down);
    c.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    c.addEventListener("touchstart", down, { passive:false });
    c.addEventListener("touchmove", move, { passive:false });
    window.addEventListener("touchend", up);
  }

  function clearSignature() {
    const c = el.sig;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
  }

  function drawSignatureFromDataUrl(dataUrl) {
    if (!dataUrl) return;
    const c = el.sig;
    const ctx = c.getContext("2d");
    const img = new Image();
    img.onload = () => {
      clearSignature();
      ctx.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = dataUrl;
  }

  function signatureHasInk() {
    const c = el.sig;
    const ctx = c.getContext("2d");
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i+3] !== 0) return true;
    }
    return false;
  }

  function signatureDataUrl() {
    return el.sig.toDataURL("image/png");
  }

  // ---------- Proof UI ----------
  function renderProofList(items) {
    el.proofList.innerHTML = "";
    (items || []).forEach((it, idx) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<b>${idx + 1}.</b> <span>${escapeHtml(it.name || it.path || "bestand")}</span>`;
      el.proofList.appendChild(chip);
    });
  }

  function getSelectedProofFiles() {
    const files = Array.from(el.proofFiles?.files || []);
    if (files.length > 2) {
      // hard enforce: max 2
      el.proofFiles.value = "";
      throw new Error("Maximaal 2 bestanden uploaden.");
    }
    return files;
  }

  // ---------- Fetch latest delivered data for prefill ----------
  async function fetchLatestDeliveredData(shipmentId) {
    if (state.deliveredCache.has(shipmentId)) return state.deliveredCache.get(shipmentId);

    const { data, error } = await sb
      .from("shipment_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) return null;

    const rows = data || [];
    const delivered = rows.find(r => String(r.event_type || "").toLowerCase() === "delivered")
      || rows.find(r => r.receiver_name || r.signature_dataurl || r.signature_data_url);

    if (!delivered) return null;

    const pack = {
      receiver_name: delivered.receiver_name || "",
      note: delivered.note || "",
      signature_dataurl: delivered.signature_dataurl || delivered.signature_data_url || "",
      proof_paths: delivered.proof_paths || [],
      proof_names: delivered.proof_names || [],
      proof_mimes: delivered.proof_mimes || [],
    };

    state.deliveredCache.set(shipmentId, pack);
    return pack;
  }

  // ---------- Modal ----------
  async function openModal(shipment) {
    state.current = shipment;
    state.selectedStatus = shipment.status || "created";

    el.mTrack.textContent = shipment.track_code || "-";
    el.mStatus.textContent = statusNL(shipment.status);

    el.isClosed.checked = !!shipment.is_closed;
    setActiveStatusButton(state.selectedStatus);

    // reset file input
    if (el.proofFiles) el.proofFiles.value = "";
    renderProofList([]);

    // default clear
    el.receiverName.value = "";
    el.note.value = "";
    clearSignature();

    // Prefill if already delivered
    if (String(shipment.status || "").toLowerCase() === "delivered") {
      const pack = await fetchLatestDeliveredData(shipment.id);
      if (pack) {
        el.receiverName.value = pack.receiver_name || "";
        el.note.value = pack.note || "";
        if (pack.signature_dataurl) drawSignatureFromDataUrl(pack.signature_dataurl);

        // show previously uploaded proofs as list (names)
        const proofItems = (pack.proof_paths || []).map((p, i) => ({
          path: p,
          name: (pack.proof_names || [])[i] || p
        }));
        renderProofList(proofItems);
      }
    }

    el.modalBackdrop.style.display = "flex";
    showModalErr("");
    showModalOk("");
  }

  function closeModal() {
    el.modalBackdrop.style.display = "none";
    state.current = null;
    state.selectedStatus = null;
    showModalErr("");
    showModalOk("");
  }

  // ---------- Upload proofs to Storage (max 2) ----------
  async function uploadProofFiles(shipment, files) {
    if (!files.length) return { paths: [], names: [], mimes: [] };

    const paths = [];
    const names = [];
    const mimes = [];

    for (const f of files) {
      const safeName = f.name.replace(/[^\w.\-]+/g, "_");
      const path = `${shipment.id}/${Date.now()}_${safeName}`;

      const { error } = await sb.storage.from(BUCKET).upload(path, f, {
        cacheControl: "3600",
        upsert: false,
        contentType: f.type || "application/octet-stream",
      });

      if (error) throw new Error(`Upload mislukt (${f.name}): ${error.message}`);

      paths.push(path);
      names.push(f.name);
      mimes.push(f.type || "");
    }

    return { paths, names, mimes };
  }

  // ---------- Fetch timeline for PDF ----------
  async function fetchTimeline(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("event_type, note, receiver_name, created_at, signature_dataurl, signature_data_url")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------- PDF generate (client side) ----------
  async function buildPdfBlob(shipment) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 40;
    let y = 46;

    const line = (txt, inc = 18) => {
      doc.text(String(txt), margin, y);
      y += inc;
      if (y > 770) { doc.addPage(); y = 46; }
    };

    doc.setFontSize(16);
    line("De Vechtse Koeriers — Afleverbon / POD", 24);

    doc.setFontSize(11);
    line(`Trackcode: ${shipment.track_code || "-"}`);
    line(`Klant: ${shipment.customer_name || "-"}`);
    line(`Status: ${statusNL(shipment.status)}`);
    line(`Colli: ${shipment.colli_count ?? "-"}`);
    line(`Kg: ${shipment.weight_kg ?? "-"}`);
    line(`Datum/tijd: ${new Date().toLocaleString("nl-NL")}`, 22);

    doc.setFontSize(12);
    line("Tijdlijn:", 20);
    doc.setFontSize(10);

    const events = await fetchTimeline(shipment.id);
    events.forEach(ev => {
      line(`- ${fmt(ev.created_at)} — ${statusNL(ev.event_type)}${ev.note ? " — " + ev.note : ""}`, 14);
      if (ev.event_type === "delivered" && ev.receiver_name) {
        line(`  Ontvangen door: ${ev.receiver_name}`, 14);
      }
    });

    // Handtekening uit laatste delivered-event
    const lastDelivered = [...events].reverse().find(e => String(e.event_type).toLowerCase() === "delivered");
    const sigUrl = lastDelivered?.signature_dataurl || lastDelivered?.signature_data_url || "";

    if (sigUrl) {
      line("", 10);
      doc.setFontSize(12);
      line("Handtekening:", 18);

      // Plaats signature image
      try {
        // jsPDF kan dataURL direct
        doc.addImage(sigUrl, "PNG", margin, y, 240, 120);
        y += 140;
      } catch {
        line("(Handtekening kon niet worden ingesloten)", 16);
      }
    } else {
      line("", 10);
      line("Handtekening: (geen)", 16);
    }

    // Bewijsstukken (we zetten ze als tekst, omdat ze private zijn)
    const pack = await fetchLatestDeliveredData(shipment.id);
    const proofNames = pack?.proof_names || [];
    if (proofNames.length) {
      line("", 10);
      doc.setFontSize(12);
      line("Bewijsstukken (intern):", 18);
      doc.setFontSize(10);
      proofNames.forEach(n => line(`- ${n}`, 14));
      line("NB: Bewijsstukken zijn alleen intern beschikbaar.", 16);
    }

    return doc.output("blob");
  }

  async function uploadPdfToStorage(shipment, pdfBlob) {
    const fileName = `${(shipment.track_code || "POD").replace(/[^\w\-]+/g, "_")}.pdf`;
    const path = `${shipment.id}/POD_${fileName}`;

    const { error } = await sb.storage.from(BUCKET).upload(path, pdfBlob, {
      cacheControl: "3600",
      upsert: true,
      contentType: "application/pdf",
    });

    if (error) throw new Error("PDF upload mislukt: " + error.message);

    // store path on shipment
    const { error: upErr } = await sb
      .from("shipments")
      .update({ pod_pdf_path: path })
      .eq("id", shipment.id);

    if (upErr) throw new Error("POD path opslaan mislukt: " + upErr.message);

    return path;
  }

  async function downloadPdf(shipment) {
    const blob = await buildPdfBlob(shipment);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DVK_POD_${shipment.track_code || "zending"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Save ----------
  async function saveChange() {
    if (!state.current) return;
    const ship = state.current;

    const newStatus = state.selectedStatus || ship.status || "created";
    const note = (el.note.value || "").trim();
    const receiver = (el.receiverName.value || "").trim();

    try {
      const selectedFiles = getSelectedProofFiles();

      // validations
      if (newStatus === "delivered") {
        if (!receiver) return showModalErr("Vul 'Ontvangen door' in.");
        if (!signatureHasInk()) return showModalErr("Zet een handtekening.");
      }
      if (newStatus === "problem" && !note) {
        return showModalErr("Bij 'Probleem' is een notitie verplicht.");
      }

      // 1) shipment update
      const { error: upErr } = await sb
        .from("shipments")
        .update({
          status: newStatus,
          is_closed: !!el.isClosed.checked
        })
        .eq("id", ship.id);

      if (upErr) return showModalErr("Opslaan mislukt (shipment): " + upErr.message);

      // 2) upload proofs (only if selected)
      let proof = { paths: [], names: [], mimes: [] };
      if (selectedFiles.length) {
        proof = await uploadProofFiles(ship, selectedFiles);
      }

      // 3) insert event
      const sigUrl = newStatus === "delivered" ? signatureDataUrl() : null;

      const payload = {
        shipment_id: ship.id,
        event_type: newStatus,
        note: note || null,
        receiver_name: newStatus === "delivered" ? receiver : null,
        signature_dataurl: newStatus === "delivered" ? sigUrl : null,
        proof_paths: proof.paths,
        proof_names: proof.names,
        proof_mimes: proof.mimes,
      };

      const { error: evErr } = await sb.from("shipment_events").insert(payload);
      if (evErr) return showModalErr("Event opslaan mislukt: " + evErr.message);

      // cache delivered data
      if (newStatus === "delivered") {
        state.deliveredCache.set(ship.id, {
          receiver_name: receiver,
          note: note,
          signature_dataurl: sigUrl,
          proof_paths: proof.paths,
          proof_names: proof.names,
          proof_mimes: proof.mimes,
        });
      }

      // 4) auto POD bij archiveren (optioneel)
      if (el.isClosed.checked && el.autoPod.checked) {
        const freshShipment = await getShipmentById(ship.id);
        const pdfBlob = await buildPdfBlob(freshShipment);
        await uploadPdfToStorage(freshShipment, pdfBlob);
      }

      showModalOk("Opgeslagen ✅");
      closeModal();
      await loadShipments();
    } catch (e) {
      console.error(e);
      showModalErr(e.message || String(e));
    }
  }

  async function getShipmentById(id) {
    const { data, error } = await sb
      .from("shipments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------- Tab / logout ----------
  function setTab(tab) {
    state.tab = tab;
    el.tabOpen.classList.toggle("active", tab === "open");
    el.tabArchive.classList.toggle("active", tab === "archive");
    loadShipments();
  }

  async function logout() {
    await sb.auth.signOut();
    location.href = "./login.html";
  }

  // ---------- init ----------
  async function init() {
    await requireAuth();
    setupSignature();

    el.closeModalBtn.addEventListener("click", closeModal);
    el.clearSigBtn.addEventListener("click", clearSignature);
    el.saveBtn.addEventListener("click", saveChange);

    el.pdfBtn.addEventListener("click", async () => {
      if (!state.current) return;
      try {
        const fresh = await getShipmentById(state.current.id);
        await downloadPdf(fresh);
      } catch (e) {
        showModalErr("PDF maken mislukt: " + (e.message || e));
      }
    });

    // status buttons (select + highlight + NL label)
    el.btnPickup.addEventListener("click", () => {
      state.selectedStatus = "pickup";
      setActiveStatusButton("pickup");
      el.mStatus.textContent = statusNL("pickup");
    });

    el.btnTransit.addEventListener("click", () => {
      state.selectedStatus = "in_transit";
      setActiveStatusButton("in_transit");
      el.mStatus.textContent = statusNL("in_transit");
    });

    el.btnDelivered.addEventListener("click", async () => {
      state.selectedStatus = "delivered";
      setActiveStatusButton("delivered");
      el.mStatus.textContent = statusNL("delivered");

      // prefill from latest delivered if exists
      if (state.current) {
        const pack = await fetchLatestDeliveredData(state.current.id);
        if (pack) {
          if (!el.receiverName.value) el.receiverName.value = pack.receiver_name || "";
          if (!el.note.value) el.note.value = pack.note || "";
          if (pack.signature_dataurl) drawSignatureFromDataUrl(pack.signature_dataurl);

          const proofItems = (pack.proof_paths || []).map((p, i) => ({
            path: p,
            name: (pack.proof_names || [])[i] || p
          }));
          if (proofItems.length) renderProofList(proofItems);
        }
      }
    });

    el.btnProblem.addEventListener("click", () => {
      state.selectedStatus = "problem";
      setActiveStatusButton("problem");
      el.mStatus.textContent = statusNL("problem");
    });

    // file input: max 2 direct feedback
    el.proofFiles?.addEventListener("change", () => {
      try {
        const files = Array.from(el.proofFiles.files || []);
        if (files.length > 2) {
          el.proofFiles.value = "";
          showModalErr("Maximaal 2 bestanden uploaden.");
          return;
        }
        showModalErr("");
      } catch (e) {
        showModalErr(e.message);
      }
    });

    // tabs + logout
    el.tabOpen.addEventListener("click", () => setTab("open"));
    el.tabArchive.addEventListener("click", () => setTab("archive"));
    el.logoutBtn.addEventListener("click", logout);

    // nieuwe zending knop: jouw bestaande flow blijft
    el.newBtn?.addEventListener("click", () => {
      showMsg("Nieuwe zending: gebruik je bestaande flow (deze knop blijft).");
      setTimeout(() => showMsg(""), 1200);
    });

    await loadShipments();
  }

  async function openModal(shipment) {
    state.current = shipment;
    state.selectedStatus = shipment.status || "created";

    el.mTrack.textContent = shipment.track_code || "-";
    el.mStatus.textContent = statusNL(shipment.status);

    el.isClosed.checked = !!shipment.is_closed;
    setActiveStatusButton(state.selectedStatus);

    // reset file input
    if (el.proofFiles) el.proofFiles.value = "";
    renderProofList([]);

    // default clear
    el.receiverName.value = "";
    el.note.value = "";
    clearSignature();

    if (String(shipment.status || "").toLowerCase() === "delivered") {
      const pack = await fetchLatestDeliveredData(shipment.id);
      if (pack) {
        el.receiverName.value = pack.receiver_name || "";
        el.note.value = pack.note || "";
        if (pack.signature_dataurl) drawSignatureFromDataUrl(pack.signature_dataurl);

        const proofItems = (pack.proof_paths || []).map((p, i) => ({
          path: p,
          name: (pack.proof_names || [])[i] || p
        }));
        renderProofList(proofItems);
      }
    }

    el.modalBackdrop.style.display = "flex";
    showModalErr("");
    showModalOk("");
  }

  function closeModal() {
    el.modalBackdrop.style.display = "none";
    state.current = null;
    state.selectedStatus = null;
    showModalErr("");
    showModalOk("");
  }

  init().catch((e) => {
    console.error(e);
    showMsg(e.message || String(e));
  });
})();
