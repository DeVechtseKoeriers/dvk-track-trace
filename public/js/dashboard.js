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
  };

  let state = {
    user: null,
    tab: "open", // open | archive
    shipments: [],
    current: null,
    selectedStatus: null,
    drawing: false,

    // cache per shipment_id: { receiver_name, note, signature_dataurl, signature_data_url }
    deliveredCache: new Map(),
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
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, is_closed")
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
        <td><button class="btn" data-id="${s.id}" type="button">Wijzigen</button></td>
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

  // ---------- IMPORTANT: Prefill delivered data so you don't retype ----------
  async function fetchLatestDeliveredData(shipmentId) {
    // 1) cache check
    if (state.deliveredCache.has(shipmentId)) {
      return state.deliveredCache.get(shipmentId);
    }

    // 2) pull latest delivered event (or latest event with receiver/signature)
    // We use select("*") so we don't break if your column name is signature_dataurl vs signature_data_url.
    const { data, error } = await sb
      .from("shipment_events")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.warn("fetchLatestDeliveredData error:", error);
      return null;
    }

    const rows = data || [];
    // Prefer delivered event, else anything with receiver/signature
    const delivered = rows.find(r => String(r.event_type || "").toLowerCase() === "delivered")
      || rows.find(r => r.receiver_name || r.signature_dataurl || r.signature_data_url);

    if (!delivered) return null;

    const pack = {
      receiver_name: delivered.receiver_name || "",
      note: delivered.note || "",
      // support both possible column names
      signature_dataurl: delivered.signature_dataurl || "",
      signature_data_url: delivered.signature_data_url || "",
    };

    state.deliveredCache.set(shipmentId, pack);
    return pack;
  }

  async function openModal(shipment) {
    state.current = shipment;
    state.selectedStatus = shipment.status || "created";

    el.mTrack.textContent = shipment.track_code || "-";
    el.mStatus.textContent = statusNL(shipment.status);

    // Do NOT always wipe fields. We fill them based on status.
    el.isClosed.checked = !!shipment.is_closed;

    // highlight current status
    setActiveStatusButton(state.selectedStatus);

    // default: clear note/receiver/sign only if NOT delivered
    el.receiverName.value = "";
    el.note.value = "";
    clearSignature();

    // If already delivered -> prefill from latest delivered event
    if (String(shipment.status || "").toLowerCase() === "delivered") {
      const pack = await fetchLatestDeliveredData(shipment.id);
      if (pack) {
        el.receiverName.value = pack.receiver_name || "";
        el.note.value = pack.note || "";
        const sigUrl = pack.signature_dataurl || pack.signature_data_url || "";
        if (sigUrl) drawSignatureFromDataUrl(sigUrl);
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

  // ---------- Save ----------
  async function saveChange() {
    if (!state.current) return;

    const ship = state.current;
    const newStatus = state.selectedStatus || ship.status || "created";
    const note = (el.note.value || "").trim();
    const receiver = (el.receiverName.value || "").trim();

    // Validations
    if (newStatus === "delivered") {
      if (!receiver) return showModalErr("Vul 'Ontvangen door' in.");
      if (!signatureHasInk()) return showModalErr("Zet een handtekening.");
    }
    if (newStatus === "problem" && !note) {
      return showModalErr("Bij 'Probleem' is een notitie verplicht.");
    }

    // 1) shipment update (status + archief)
    const { error: upErr } = await sb
      .from("shipments")
      .update({
        status: newStatus,
        is_closed: !!el.isClosed.checked
      })
      .eq("id", ship.id);

    if (upErr) return showModalErr("Opslaan mislukt (shipment): " + upErr.message);

    // 2) event insert
    const sigUrl = newStatus === "delivered" ? signatureDataUrl() : null;

    const payload = {
      shipment_id: ship.id,
      event_type: newStatus,
      note: note || null,
      receiver_name: newStatus === "delivered" ? receiver : null,
      // Use your existing DB column name:
      // If your DB uses signature_dataurl (common in your earlier screenshots), keep it.
      signature_dataurl: newStatus === "delivered" ? sigUrl : null,
    };

    const { error: evErr } = await sb.from("shipment_events").insert(payload);
    if (evErr) return showModalErr("Event opslaan mislukt: " + evErr.message);

    // Cache delivered data so next time it opens prefilled (even before DB fetch)
    if (newStatus === "delivered") {
      state.deliveredCache.set(ship.id, {
        receiver_name: receiver,
        note: note,
        signature_dataurl: sigUrl,
        signature_data_url: "",
      });
    }

    showModalOk("Opgeslagen ✅");
    closeModal();
    await loadShipments();
  }

  // ---------- UI handlers ----------
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

    // Status buttons: only select + highlight
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

      // If you click delivered, try to prefill again (useful after reopening)
      if (state.current) {
        const pack = await fetchLatestDeliveredData(state.current.id);
        if (pack) {
          if (!el.receiverName.value) el.receiverName.value = pack.receiver_name || "";
          if (!el.note.value) el.note.value = pack.note || "";
          const sigUrl = pack.signature_dataurl || pack.signature_data_url || "";
          if (sigUrl) drawSignatureFromDataUrl(sigUrl);
        }
      }
    });

    el.btnProblem.addEventListener("click", () => {
      state.selectedStatus = "problem";
      setActiveStatusButton("problem");
      el.mStatus.textContent = statusNL("problem");
    });

    // Tabs
    el.tabOpen.addEventListener("click", () => setTab("open"));
    el.tabArchive.addEventListener("click", () => setTab("archive"));

    // Logout
    el.logoutBtn.addEventListener("click", logout);

    // New shipment button: keep your existing flow (we don't change it here)
    el.newBtn?.addEventListener("click", () => {
      showMsg("Nieuwe zending: gebruik je bestaande flow (deze knop blijft).");
      setTimeout(() => showMsg(""), 1200);
    });

    await loadShipments();
  }

  init().catch((e) => {
    console.error(e);
    showMsg(e.message || String(e));
  });
})();
