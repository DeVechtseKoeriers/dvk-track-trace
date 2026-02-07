/* public/js/dashboard.js
   - Auth guard: geen sessie => redirect login
   - Laadt "mijn zendingen" (driver_id = auth.uid())
   - Nieuwe zending aanmaken (met trackcode)
   - Snelle status knoppen: Opgehaald / Onderweg / Afgeleverd / Probleem
   - Afgeleverd: ontvanger + notitie + handtekening (dataURL)
*/

(() => {
  const sb = window.sb;

  const $ = (id) => document.getElementById(id);

  const el = {
    userEmail: $("userEmail"),
    msg: $("msg"),
    loading: $("loading"),
    tbody: $("tbody"),

    modalBackdrop: $("modalBackdrop"),
    modalTitle: $("modalTitle"),
    closeModalBtn: $("closeModalBtn"),
    modalMsg: $("modalMsg"),

    newBtn: $("newBtn"),
    logoutBtn: $("logoutBtn"),

    createBox: $("createBox"),
    createBtn: $("createBtn"),
    fCustomer: $("fCustomer"),
    fType: $("fType"),
    fPickup: $("fPickup"),
    fDelivery: $("fDelivery"),
    fColli: $("fColli"),
    fKg: $("fKg"),
    fNote: $("fNote"),

    actionBox: $("actionBox"),
    aTrack: $("aTrack"),
    btnPickup: $("btnPickup"),
    btnTransit: $("btnTransit"),
    btnDelivered: $("btnDelivered"),
    btnProblem: $("btnProblem"),

    deliveredBox: $("deliveredBox"),
    dReceiver: $("dReceiver"),
    dNote: $("dNote"),
    sigCanvas: $("sigCanvas"),
    clearSigBtn: $("clearSigBtn"),
    confirmDeliveredBtn: $("confirmDeliveredBtn"),

    problemBox: $("problemBox"),
    pNote: $("pNote"),
    confirmProblemBtn: $("confirmProblemBtn"),
  };

  const state = {
    user: null,
    shipments: [],
    activeShipment: null,
    sig: { drawing: false, lastX: 0, lastY: 0 },
  };

  const log = (...a) => console.log("[DVK][dashboard]", ...a);
  const showMsg = (text) => { el.msg.style.display = "block"; el.msg.textContent = text; };
  const hideMsg = () => { el.msg.style.display = "none"; el.msg.textContent = ""; };

  const showModalMsg = (text) => { el.modalMsg.style.display = "block"; el.modalMsg.textContent = text; };
  const hideModalMsg = () => { el.modalMsg.style.display = "none"; el.modalMsg.textContent = ""; };

  const openModal = () => { el.modalBackdrop.style.display = "flex"; };
  const closeModal = () => {
    el.modalBackdrop.style.display = "none";
    hideModalMsg();
    // reset boxes
    el.createBox.style.display = "block";
    el.actionBox.style.display = "none";
    el.deliveredBox.style.display = "none";
    el.problemBox.style.display = "none";
    state.activeShipment = null;
  };

  const formatDate = (iso) => {
    if (!iso) return "-";
    try {
      const d = new Date(iso);
      return d.toLocaleString("nl-NL");
    } catch {
      return iso;
    }
  };

  const statusNL = (s) => {
    const v = String(s || "").toLowerCase();
    if (v === "created") return "Aangemeld";
    if (v === "pickup") return "Opgehaald";
    if (v === "in_transit") return "Onderweg";
    if (v === "delivered") return "Afgeleverd";
    if (v === "problem") return "Probleem";
    return s || "-";
  };

  const escapeHtml = (t) =>
    String(t ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));

  const genTrackCode = () => {
    // DVK-YYYY-XXXX
    const y = new Date().getFullYear();
    const rnd = Math.floor(1000 + Math.random() * 9000);
    return `DVK-${y}-${rnd}`;
  };

  async function requireAuth() {
    if (!sb) {
      showMsg("Supabase client ontbreekt. Check supabase-config.js");
      throw new Error("no supabase client");
    }

    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    const user = data?.session?.user;
    if (!user) {
      // geen sessie => terug naar login
      location.href = "./login.html";
      throw new Error("no session");
    }

    state.user = user;
    el.userEmail.textContent = user.email || "-";
    hideMsg();
  }

  async function fetchMyShipments() {
    // verwacht schema met deze kolommen (vaste set)
    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, pickup_address, delivery_address, shipment_type, driver_id")
      .eq("driver_id", state.user.id)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    state.shipments = data || [];
    renderShipments();
  }

  function renderShipments() {
    el.loading.style.display = "none";

    if (!state.shipments.length) {
      el.tbody.innerHTML = `<tr><td colspan="7" class="muted">Geen zendingen.</td></tr>`;
      return;
    }

    el.tbody.innerHTML = state.shipments.map((s) => {
      const updated = formatDate(s.updated_at);
      return `
        <tr>
          <td><b>${escapeHtml(s.track_code || "-")}</b></td>
          <td>${escapeHtml(s.customer_name || "-")}</td>
          <td>${escapeHtml(statusNL(s.status))}</td>
          <td>${escapeHtml(s.colli_count ?? "-")}</td>
          <td>${escapeHtml(s.weight_kg ?? "-")}</td>
          <td class="row-muted">${escapeHtml(updated)}</td>
          <td>
            <div class="actions">
              <button class="btn" data-act="open" data-id="${s.id}">Wijzigen</button>
              <button class="btn ok" data-act="pickup" data-id="${s.id}">Opgehaald</button>
              <button class="btn primary" data-act="transit" data-id="${s.id}">Onderweg</button>
              <button class="btn ok" data-act="delivered" data-id="${s.id}">Afgeleverd</button>
              <button class="btn warn" data-act="problem" data-id="${s.id}">Probleem</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // bind row actions
    el.tbody.querySelectorAll("button[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const act = btn.getAttribute("data-act");
        const ship = state.shipments.find(x => String(x.id) === String(id));
        if (!ship) return;

        if (act === "open") openActions(ship);
        if (act === "pickup") quickStatus(ship, "pickup");
        if (act === "transit") quickStatus(ship, "in_transit");
        if (act === "delivered") openDelivered(ship);
        if (act === "problem") openProblem(ship);
      });
    });
  }

  function openCreate() {
    el.modalTitle.textContent = "Nieuwe zending";
    el.createBox.style.display = "block";
    el.actionBox.style.display = "none";
    el.deliveredBox.style.display = "none";
    el.problemBox.style.display = "none";
    hideModalMsg();

    // defaults
    el.fCustomer.value = "";
    el.fType.value = "Doos";
    el.fPickup.value = "";
    el.fDelivery.value = "";
    el.fColli.value = "1";
    el.fKg.value = "1";
    el.fNote.value = "";

    openModal();
  }

  function openActions(ship) {
    state.activeShipment = ship;
    el.modalTitle.textContent = "Wijzigen / Acties";
    el.aTrack.textContent = ship.track_code || "-";

    el.createBox.style.display = "none";
    el.actionBox.style.display = "block";
    el.deliveredBox.style.display = "none";
    el.problemBox.style.display = "none";
    hideModalMsg();

    openModal();
  }

  function openDelivered(ship) {
    openActions(ship);
    el.deliveredBox.style.display = "block";
    el.problemBox.style.display = "none";
    el.dReceiver.value = "";
    el.dNote.value = "";

    clearSignature();
  }

  function openProblem(ship) {
    openActions(ship);
    el.problemBox.style.display = "block";
    el.deliveredBox.style.display = "none";
    el.pNote.value = "";
  }

  async function createShipment() {
    hideModalMsg();

    const customer_name = el.fCustomer.value.trim();
    const pickup_address = el.fPickup.value.trim();
    const delivery_address = el.fDelivery.value.trim();
    const shipment_type = el.fType.value;
    const colli_count = Number(el.fColli.value || 0);
    const weight_kg = Number(el.fKg.value || 0);
    const note = el.fNote.value.trim();

    if (!customer_name) return showModalMsg("Vul klantnaam in.");
    if (!pickup_address) return showModalMsg("Vul ophaaladres in.");
    if (!delivery_address) return showModalMsg("Vul bezorgadres in.");
    if (!Number.isFinite(colli_count) || colli_count < 1) return showModalMsg("Aantal colli moet minimaal 1 zijn.");
    if (!Number.isFinite(weight_kg) || weight_kg < 0) return showModalMsg("Kg moet 0 of hoger zijn.");

    el.createBtn.disabled = true;

    const track_code = genTrackCode();
    const now = new Date().toISOString();

    // 1) insert shipment
    const { data: ship, error: shipErr } = await sb
      .from("shipments")
      .insert([{
        track_code,
        customer_name,
        status: "created",
        pickup_address,
        delivery_address,
        shipment_type,
        colli_count,
        weight_kg,
        driver_id: state.user.id,
        updated_at: now,
      }])
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, pickup_address, delivery_address, shipment_type, driver_id")
      .single();

    if (shipErr) {
      el.createBtn.disabled = false;
      showModalMsg("Aanmaken mislukt: " + shipErr.message);
      return;
    }

    // 2) initial event (optioneel)
    await sb.from("shipment_events").insert([{
      shipment_id: ship.id,
      event_type: "created",
      note: note || null,
      created_at: now,
    }]);

    el.createBtn.disabled = false;
    closeModal();
    await fetchMyShipments();
  }

  async function quickStatus(ship, newStatus) {
    try {
      hideMsg();
      const now = new Date().toISOString();

      // update shipment status
      const { error: upErr } = await sb
        .from("shipments")
        .update({ status: newStatus, updated_at: now })
        .eq("id", ship.id);

      if (upErr) throw upErr;

      // log event
      const { error: evErr } = await sb
        .from("shipment_events")
        .insert([{
          shipment_id: ship.id,
          event_type: newStatus,
          created_at: now,
        }]);

      if (evErr) throw evErr;

      await fetchMyShipments();
    } catch (e) {
      showMsg("Status wijzigen mislukt: " + (e.message || String(e)));
    }
  }

  async function confirmDelivered() {
    if (!state.activeShipment) return;

    const receiver = el.dReceiver.value.trim();
    const note = el.dNote.value.trim();
    const signature = getSignatureDataUrl();

    if (!receiver) return showModalMsg("Vul 'Ontvangen door' in.");
    if (!signature) return showModalMsg("Zet een handtekening.");

    const ship = state.activeShipment;
    const now = new Date().toISOString();

    // update shipment
    const { error: upErr } = await sb
      .from("shipments")
      .update({ status: "delivered", updated_at: now })
      .eq("id", ship.id);

    if (upErr) return showModalMsg("Update mislukt: " + upErr.message);

    // event
    const { error: evErr } = await sb
      .from("shipment_events")
      .insert([{
        shipment_id: ship.id,
        event_type: "delivered",
        receiver_name: receiver,
        note: note || null,
        signature_dataurl: signature,
        created_at: now,
      }]);

    if (evErr) return showModalMsg("Event opslaan mislukt: " + evErr.message);

    closeModal();
    await fetchMyShipments();
  }

  async function confirmProblem() {
    if (!state.activeShipment) return;
    const note = el.pNote.value.trim();
    if (!note) return showModalMsg("Vul een probleemomschrijving in.");

    const ship = state.activeShipment;
    const now = new Date().toISOString();

    const { error: upErr } = await sb
      .from("shipments")
      .update({ status: "problem", updated_at: now })
      .eq("id", ship.id);

    if (upErr) return showModalMsg("Update mislukt: " + upErr.message);

    const { error: evErr } = await sb
      .from("shipment_events")
      .insert([{
        shipment_id: ship.id,
        event_type: "problem",
        note,
        created_at: now,
      }]);

    if (evErr) return showModalMsg("Event opslaan mislukt: " + evErr.message);

    closeModal();
    await fetchMyShipments();
  }

  // --- Signature canvas ---
  function setupSignature() {
    const c = el.sigCanvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";

    const getPos = (ev) => {
      const r = c.getBoundingClientRect();
      const x = (ev.clientX - r.left) * (c.width / r.width);
      const y = (ev.clientY - r.top) * (c.height / r.height);
      return { x, y };
    };

    const down = (ev) => {
      state.sig.drawing = true;
      const p = getPos(ev);
      state.sig.lastX = p.x; state.sig.lastY = p.y;
    };

    const move = (ev) => {
      if (!state.sig.drawing) return;
      const p = getPos(ev);
      ctx.beginPath();
      ctx.moveTo(state.sig.lastX, state.sig.lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      state.sig.lastX = p.x; state.sig.lastY = p.y;
    };

    const up = () => { state.sig.drawing = false; };

    c.addEventListener("mousedown", down);
    c.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    // touch
    c.addEventListener("touchstart", (e) => { e.preventDefault(); down(e.touches[0]); }, { passive:false });
    c.addEventListener("touchmove", (e) => { e.preventDefault(); move(e.touches[0]); }, { passive:false });
    window.addEventListener("touchend", up);
  }

  function clearSignature() {
    const c = el.sigCanvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
  }

  function getSignatureDataUrl() {
    const c = el.sigCanvas;
    if (!c) return null;

    // check if empty
    const ctx = c.getContext("2d");
    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    let hasInk = false;
    for (let i = 0; i < pixels.length; i += 4) {
      // if not white-ish
      if (!(pixels[i] > 245 && pixels[i+1] > 245 && pixels[i+2] > 245 && pixels[i+3] > 0)) {
        hasInk = true; break;
      }
    }
    if (!hasInk) return null;

    return c.toDataURL("image/png");
  }

  async function logout() {
    await sb.auth.signOut();
    location.href = "./login.html";
  }

  // --- init ---
  async function init() {
    try {
      await requireAuth();

      el.loading.style.display = "block";
      el.loading.textContent = "Laden…";

      await fetchMyShipments();

      // realtime refresh (optioneel)
      sb.channel("dvk_shipments_driver")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "shipments" },
          async () => { await fetchMyShipments(); }
        )
        .subscribe();

      setupSignature();
    } catch (e) {
      log("init error", e);
      // requireAuth redirect doet al z’n werk, dus hier vaak niets nodig
    }
  }

  // UI binds
  el.newBtn.addEventListener("click", openCreate);
  el.logoutBtn.addEventListener("click", logout);
  el.closeModalBtn.addEventListener("click", closeModal);
  el.createBtn.addEventListener("click", createShipment);

  el.btnPickup.addEventListener("click", () => state.activeShipment && quickStatus(state.activeShipment, "pickup"));
  el.btnTransit.addEventListener("click", () => state.activeShipment && quickStatus(state.activeShipment, "in_transit"));
  el.btnDelivered.addEventListener("click", () => { el.deliveredBox.style.display = "block"; el.problemBox.style.display = "none"; clearSignature(); });
  el.btnProblem.addEventListener("click", () => { el.problemBox.style.display = "block"; el.deliveredBox.style.display = "none"; });

  el.clearSigBtn.addEventListener("click", clearSignature);
  el.confirmDeliveredBtn.addEventListener("click", confirmDelivered);
  el.confirmProblemBtn.addEventListener("click", confirmProblem);

  init();
})();
