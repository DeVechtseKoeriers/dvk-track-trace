/* public/js/dashboard.js
   F2: Nieuwe zending met adres + telefoon
*/

(function () {
  const sb = window.supabaseClient;

  const shipmentsEl = document.getElementById("shipments");
  const whoamiEl = document.getElementById("whoami");
  const logoutBtn = document.getElementById("logoutBtn");
  const statusMsg = document.getElementById("statusMsg");

  const newShipmentBtn = document.getElementById("newShipmentBtn");
  const newShipmentPanel = document.getElementById("newShipmentPanel");
  const createShipmentBtn = document.getElementById("createShipmentBtn");
  const cancelShipmentBtn = document.getElementById("cancelShipmentBtn");
  const newShipmentMsg = document.getElementById("newShipmentMsg");

  const customerName = document.getElementById("customerName");
  const customerPhone = document.getElementById("customerPhone");
  const pickupAddress = document.getElementById("pickupAddress");
  const deliveryAddress = document.getElementById("deliveryAddress");
  const startStatus = document.getElementById("startStatus");

  let driverId = null;

  function setMsg(t) {
    statusMsg.textContent = t || "";
  }

  async function requireUser() {
    const { data } = await sb.auth.getUser();
    if (!data.user) {
      window.location.href = "../driver/login.html";
      return null;
    }
    return data.user;
  }

  async function loadShipments() {
    const { data } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, delivery_address, customer_phone, status")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false });

    shipmentsEl.innerHTML = (data || []).map(s => `
      <div class="ship-card">
        <b>${s.customer_name}</b><br>
        📦 ${s.track_code}<br>
        📍 ${s.delivery_address || "-"}<br>
        ☎️ ${s.customer_phone || "-"}<br>
        Status: ${s.status}
      </div>
    `).join("");
  }

  async function createShipment() {
    if (!customerName.value.trim()) {
      newShipmentMsg.textContent = "Klantnaam is verplicht";
      return;
    }

    const { data, error } = await sb
      .from("shipments")
      .insert([{
        driver_id: driverId,
        customer_name: customerName.value.trim(),
        customer_phone: customerPhone.value.trim(),
        pickup_address: pickupAddress.value.trim(),
        delivery_address: deliveryAddress.value.trim(),
        status: startStatus.value
      }])
      .select()
      .single();

    if (error) {
      console.error(error);
      newShipmentMsg.textContent = "Aanmaken mislukt (RLS?)";
      return;
    }

    await sb.from("shipment_events").insert([{
      shipment_id: data.id,
      event_type: startStatus.value
    }]);

    newShipmentPanel.style.display = "none";
    customerName.value = "";
    customerPhone.value = "";
    pickupAddress.value = "";
    deliveryAddress.value = "";

    await loadShipments();
  }

  newShipmentBtn.onclick = () => newShipmentPanel.style.display = "block";
  cancelShipmentBtn.onclick = () => newShipmentPanel.style.display = "none";
  createShipmentBtn.onclick = createShipment;

  logoutBtn.onclick = async () => {
    await sb.auth.signOut();
    window.location.href = "../driver/login.html";
  };

  (async function init() {
    const user = await requireUser();
    if (!user) return;

    driverId = user.id;
    whoamiEl.textContent = user.email;

    await loadShipments();
  })();
})();
