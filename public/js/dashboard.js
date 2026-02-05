// /public/js/dashboard.js
(function () {
  const sb = window.sb;
  if (!sb) return;

  const elWho = document.getElementById("who");
  const elLogout = document.getElementById("logoutBtn");

  const elName = document.getElementById("customerName");
  const elAddress = document.getElementById("customerAddress");
  const elPhone = document.getElementById("customerPhone");
  const elColli = document.getElementById("colliCount");
  const elKg = document.getElementById("weightKg");
  const elStart = document.getElementById("startStatus");
  const elCreateBtn = document.getElementById("createBtn");
  const elCreateMsg = document.getElementById("createMsg");

  const elList = document.getElementById("list");

  function msg(t, ok = false) {
    elCreateMsg.textContent = t;
    elCreateMsg.style.color = ok ? "#22c55e" : "#ef4444";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));
  }

  async function requireAuth() {
    const { data } = await sb.auth.getUser();
    const user = data?.user;
    if (!user) {
      window.location.href = "./login.html";
      return null;
    }
    elWho.innerHTML = `<b>${esc(user.email || "")}</b>`;
    return user;
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = "./login.html";
  }

  elLogout.addEventListener("click", logout);

  async function loadMyShipments() {
    elList.innerHTML = "Laden...";

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, colli_count, weight_kg, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      elList.innerHTML = `<span style="color:#ef4444;">Laden mislukt (RLS?). Check console.</span>`;
      return;
    }

    if (!data || data.length === 0) {
      elList.innerHTML = `<div class="muted">Nog geen zendingen.</div>`;
      return;
    }

    elList.innerHTML = data.map(s => `
      <div class="tl-item">
        <div><b>${esc(s.track_code)}</b> — ${esc(s.customer_name || "-")}</div>
        <div class="muted">Status: ${esc(s.status)} • Colli: ${s.colli_count ?? "-"} • Kg: ${s.weight_kg ?? "-"}</div>
      </div>
    `).join("");
  }

  function yearStr() {
    return String(new Date().getFullYear());
  }

  // simpele client-side teller (later beter via SQL function)
  async function nextTrackCode() {
    const y = yearStr();
    const prefix = `DVK-${y}-`;

    const { data, error } = await sb
      .from("shipments")
      .select("track_code")
      .like("track_code", `${prefix}%`)
      .order("track_code", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      // fallback
      return `${prefix}0001`;
    }

    const last = data?.[0]?.track_code;
    if (!last) return `${prefix}0001`;

    const m = String(last).match(/DVK-\d{4}-(\d{4})$/);
    const n = m ? parseInt(m[1], 10) : 0;
    const next = String(n + 1).padStart(4, "0");
    return `${prefix}${next}`;
  }

  async function createShipment() {
    msg("");

    const { data: userData } = await sb.auth.getUser();
    const driverId = userData?.user?.id;
    if (!driverId) {
      msg("Niet ingelogd.");
      return;
    }

    const customer_name = String(elName.value || "").trim();
    const customer_address = String(elAddress.value || "").trim();
    const customer_phone = String(elPhone.value || "").trim();

    const colli_count = elColli.value === "" ? null : parseInt(elColli.value, 10);
    const weight_kg = elKg.value === "" ? null : parseFloat(elKg.value);

    const status = elStart.value || "created";

    if (!customer_name) {
      msg("Vul klantnaam in.");
      return;
    }

    const track_code = await nextTrackCode();

    // 1) shipment insert
    const { data: ship, error: shipErr } = await sb
      .from("shipments")
      .insert([{
        track_code,
        status,
        driver_id: driverId,
        customer_name,
        customer_address: customer_address || null,
        customer_phone: customer_phone || null,
        colli_count,
        weight_kg
      }])
      .select("id, track_code")
      .single();

    if (shipErr) {
      console.error(shipErr);
      msg("Aanmaken mislukt (check console / RLS).");
      return;
    }

    // 2) eerste event insert (NL note)
    const nlNote =
      status === "en_route" ? "Chauffeur is onderweg"
      : "Zending aangemeld";

    const { error: evErr } = await sb
      .from("shipment_events")
      .insert([{
        shipment_id: ship.id,
        event_type: status,      // intern (created/en_route/etc)
        note: nlNote
      }]);

    if (evErr) {
      console.error(evErr);
      msg("Zending aangemaakt maar event mislukt (RLS).");
      return;
    }

    msg(`Aangemaakt ✅ Trackcode: ${ship.track_code}`, true);
    elName.value = "";
    elAddress.value = "";
    elPhone.value = "";
    elColli.value = "";
    elKg.value = "";

    await loadMyShipments();
  }

  elCreateBtn.addEventListener("click", createShipment);

  (async function init() {
    const u = await requireAuth();
    if (!u) return;
    await loadMyShipments();
  })();
})();
