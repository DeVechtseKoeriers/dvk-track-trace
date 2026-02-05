// =====================================================
// DVK – Chauffeur Dashboard
// Bestand: /public/js/dashboard.js
// Vereist: window.supabaseClient (uit supabase-config.js)
// =====================================================

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("[DVK] Supabase client ontbreekt.");
    return;
  }

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);

  function basePath() {
    // Voor GitHub Pages project-sites: /dvk-track-trace
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length ? "/" + parts[0] : "";
  }

  function to(path) {
    return location.origin + basePath() + path;
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  function setMsg(el, text, type = "") {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg " + (type || "");
  }

  // ---------- DOM ----------
  const elUser = $("userEmail");
  const elLogout = $("logoutBtn");

  const elStatus = $("statusMsg");
  const elList = $("shipmentsList");

  const elNewBtn = $("newShipmentBtn");
  const elPanel = $("newShipmentPanel");
  const elCancel = $("cancelCreate");

  const elForm = $("createForm");
  const elName = $("customerName");
  const elPhone = $("customerPhone");
  const elAddr = $("customerAddress");
  const elColli = $("colli");
  const elKg = $("kg");
  const elStart = $("startStatus");

  // ---------- Auth ----------
  async function requireAuth() {
    const { data } = await sb.auth.getUser();
    if (!data?.user) {
      location.href = to("/driver/login.html");
      return null;
    }
    elUser && (elUser.textContent = data.user.email || "");
    return data.user;
  }

  async function logout() {
    await sb.auth.signOut();
    location.href = to("/driver/login.html");
  }

  elLogout && elLogout.addEventListener("click", logout);

  // ---------- Trackcode generator ----------
  async function nextTrackCode() {
    const y = new Date().getFullYear();
    const prefix = `DVK-${y}-`;

    const { data, error } = await sb
      .from("shipments")
      .select("track_code")
      .like("track_code", `${prefix}%`)
      .order("track_code", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      return `${prefix}0001`;
    }

    const last = data?.[0]?.track_code;
    if (!last) return `${prefix}0001`;

    const m = last.match(/(\d{4})$/);
    const n = m ? parseInt(m[1], 10) + 1 : 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  }

  // ---------- Load shipments ----------
  async function loadShipments() {
    setMsg(elStatus, "Zendingen laden…", "warn");
    elList.innerHTML = "";

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, colli_count, weight_kg, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setMsg(elStatus, "Laden mislukt (RLS / netwerk).", "bad");
      return;
    }

    setMsg(elStatus, "Dashboard geladen ✅", "ok");

    if (!data || data.length === 0) {
      elList.innerHTML = `<div class="muted">Nog geen zendingen.</div>`;
      return;
    }

    elList.innerHTML = data.map(s => `
      <div class="list-item">
        <div style="font-weight:700;">${esc(s.track_code)}</div>
        <div class="muted">
          ${esc(s.customer_name || "-")}
          • Colli: ${s.colli_count ?? "-"}
          • Kg: ${s.weight_kg ?? "-"}
        </div>
      </div>
    `).join("");
  }

  // ---------- Create shipment ----------
  async function createShipment(e) {
    e.preventDefault();

    setMsg(elStatus, "");

    const name = elName.value.trim();
    if (!name) {
      setMsg(elStatus, "Vul klantnaam in.", "bad");
      return;
    }

    const phone = elPhone.value.trim() || null;
    const addr = elAddr.value.trim() || null;

    const colli = elColli.value === "" ? null : parseInt(elColli.value, 10);
    const kg = elKg.value === "" ? null : parseFloat(elKg.value);

    if (colli !== null && (Number.isNaN(colli) || colli < 0)) {
      setMsg(elStatus, "Aantal colli ongeldig.", "bad");
      return;
    }
    if (kg !== null && (Number.isNaN(kg) || kg < 0)) {
      setMsg(elStatus, "Kg ongeldig.", "bad");
      return;
    }

    const status = elStart.value || "created";

    try {
      setMsg(elStatus, "Aanmaken…", "warn");
      const track = await nextTrackCode();

      const { data: ship, error } = await sb
        .from("shipments")
        .insert([{
          track_code: track,
          status,
          customer_name: name,
          customer_phone: phone,
          customer_address: addr,
          colli_count: colli,
          weight_kg: kg
        }])
        .select("id")
        .single();

      if (error) throw error;

      // eerste event (NL note)
      const note =
        status === "en_route" ? "Chauffeur is onderweg" :
        status === "delivered" ? "Zending afgeleverd" :
        "Zending aangemeld";

      const { error: evErr } = await sb
        .from("shipment_events")
        .insert([{ shipment_id: ship.id, event_type: status, note }]);

      if (evErr) throw evErr;

      setMsg(elStatus, `Aangemaakt ✅ ${track}`, "ok");
      elForm.reset();
      elPanel.classList.add("hidden");
      await loadShipments();
    } catch (err) {
      console.error(err);
      setMsg(elStatus, "Aanmaken mislukt (RLS / netwerk).", "bad");
    }
  }

  // ---------- UI wiring ----------
  elNewBtn && elNewBtn.addEventListener("click", () => {
    elPanel.classList.toggle("hidden");
  });

  elCancel && elCancel.addEventListener("click", () => {
    elPanel.classList.add("hidden");
  });

  elForm && elForm.addEventListener("submit", createShipment);

  // ---------- Init ----------
  (async function init() {
    const user = await requireAuth();
    if (!user) return;
    await loadShipments();
  })();
})();
