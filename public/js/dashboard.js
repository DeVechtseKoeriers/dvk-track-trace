// public/js/dashboard.js
(() => {
  const supabase = window.supabaseClient;

  const el = (id) => document.getElementById(id);

  const userEmail = el("userEmail");
  const logoutBtn = el("logoutBtn");
  const dashMsg = el("dashMsg");
  const shipmentsList = el("shipmentsList");

  const toggleCreateBtn = el("toggleCreateBtn");
  const createBox = el("createBox");
  const cancelCreateBtn = el("cancelCreateBtn");
  const createBtn = el("createBtn");

  const customerNameInput = el("customerNameInput");
  const startStatusSelect = el("startStatusSelect");

  // F3 velden
  const colliInput = el("colliInput");
  const weightInput = el("weightInput");

  const createMsg = el("createMsg");

  function setMsg(target, text, type = "") {
    target.className = "msg " + (type || "");
    target.textContent = text || "";
  }

  function yearNow() {
    return new Date().getFullYear();
  }

  async function requireAuth() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      window.location.href = "./login.html";
      return null;
    }
    return data.user;
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "./login.html";
  }

  // Trackcode generator: DVK-YYYY-0001
  async function generateTrackCode() {
    const y = yearNow();
    const prefix = `DVK-${y}-`;

    // Haal hoogste bestaande code van dit jaar op
    // track_code like DVK-2026-0001
    const { data, error } = await supabase
      .from("shipments")
      .select("track_code")
      .like("track_code", `${prefix}%`)
      .order("track_code", { ascending: false })
      .limit(1);

    if (error) throw error;

    let nextNr = 1;
    if (data && data.length > 0 && data[0].track_code) {
      const last = data[0].track_code;
      const lastNum = parseInt(last.replace(prefix, ""), 10);
      if (!Number.isNaN(lastNum)) nextNr = lastNum + 1;
    }

    const padded = String(nextNr).padStart(4, "0");
    return `${prefix}${padded}`;
  }

  function statusLabel(code) {
    const map = {
      created: "Aangemeld",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem"
    };
    return map[code] || code;
  }

  async function loadShipments(userId) {
    // Toon zendingen van deze chauffeur
    const { data, error } = await supabase
      .from("shipments")
      .select("id,track_code,status,customer_name,colli_count,weight_kg,created_at")
      .eq("driver_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMsg(dashMsg, "Dashboard laden mislukt (check console / RLS).", "bad");
      return;
    }

    setMsg(dashMsg, "Dashboard geladen ✅", "ok");

    shipmentsList.innerHTML = "";
    if (!data || data.length === 0) {
      shipmentsList.innerHTML = `<div class="muted">Nog geen zendingen.</div>`;
      return;
    }

    for (const s of data) {
      const colliTxt = s.colli_count ? ` • Colli: ${s.colli_count}` : "";
      const kgTxt = s.weight_kg ? ` • Kg: ${s.weight_kg}` : "";

      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div style="font-weight:700;">${s.track_code}</div>
        <div class="muted">${s.customer_name || "—"} • ${statusLabel(s.status)}${colliTxt}${kgTxt}</div>
      `;
      shipmentsList.appendChild(item);
    }
  }

  async function createInitialEvent(shipmentId, status, note = null) {
    // Maak event in shipment_events voor timeline
    const payload = {
      shipment_id: shipmentId,
      event_type: status,
      note: note || null
    };

    const { error } = await supabase.from("shipment_events").insert(payload);
    if (error) throw error;
  }

  async function handleCreateShipment(user) {
    setMsg(createMsg, "Bezig met aanmaken…", "warn");

    const customerName = (customerNameInput.value || "").trim();
    if (!customerName) {
      setMsg(createMsg, "Vul klantnaam in.", "bad");
      return;
    }

    const startStatus = startStatusSelect.value;

    // F3: colli/kg lezen
    const colli = colliInput.value ? parseInt(colliInput.value, 10) : null;
    const weight = weightInput.value ? parseFloat(weightInput.value) : null;

    // basis validatie
    if (colli !== null && (Number.isNaN(colli) || colli < 1)) {
      setMsg(createMsg, "Aantal colli moet een getal >= 1 zijn.", "bad");
      return;
    }
    if (weight !== null && (Number.isNaN(weight) || weight < 0)) {
      setMsg(createMsg, "Gewicht moet een geldig getal zijn.", "bad");
      return;
    }

    try {
      const trackCode = await generateTrackCode();

      // Insert shipment
      const { data, error } = await supabase
        .from("shipments")
        .insert({
          track_code: trackCode,
          status: startStatus,
          driver_id: user.id,
          customer_name: customerName,
          colli_count: colli,
          weight_kg: weight
        })
        .select("id")
        .single();

      if (error) throw error;

      // Maak timeline event aan
      await createInitialEvent(data.id, startStatus, null);

      setMsg(createMsg, `Zending aangemaakt ✅ Trackcode: ${trackCode}`, "ok");

      // reset form
      customerNameInput.value = "";
      colliInput.value = "";
      weightInput.value = "";
      startStatusSelect.value = "created";

      // refresh list
      await loadShipments(user.id);
    } catch (e) {
      console.error(e);
      setMsg(createMsg, "Aanmaken mislukt (check console / RLS).", "bad");
    }
  }

  function wireUI(user) {
    userEmail.textContent = user.email || "";
    logoutBtn.addEventListener("click", signOut);

    toggleCreateBtn.addEventListener("click", () => {
      createBox.style.display = createBox.style.display === "none" ? "block" : "none";
    });

    cancelCreateBtn.addEventListener("click", () => {
      createBox.style.display = "none";
      setMsg(createMsg, "");
    });

    createBtn.addEventListener("click", () => handleCreateShipment(user));
  }

  async function init() {
    const user = await requireAuth();
    if (!user) return;

    wireUI(user);
    await loadShipments(user.id);
  }

  init();
})();
