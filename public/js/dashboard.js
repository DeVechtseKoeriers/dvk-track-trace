/* public/js/dashboard.js
   Chauffeur Dashboard – DVK
   Vereist: public/js/supabase-config.js (maakt window.supabaseClient)
   Tabellen: public.shipments
   Kolommen die we gebruiken: id, track_code, customer_name, status, created_at, updated_at,
   colli_count (int4), weight_kg (numeric), driver_id (uuid)
*/

(() => {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("[DVK][dashboard] supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const qs = (sel) => document.querySelector(sel);

  function setMsg(text, type = "ok") {
    const el = $("statusMsg") || qs('[data-role="statusMsg"]');
    if (!el) return;
    el.textContent = text || "";
    el.className = `msg ${type}`;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Status NL mapping (voor weergave)
  const statusNL = (code) => {
    const map = {
      created: "Aangemeld",
      en_route: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      cancelled: "Geannuleerd",
    };
    // Soms staat er al NL in je DB; dan laten we het staan
    return map[code] || code || "";
  };

  // ---------- DOM refs (met fallback) ----------
  const logoutBtn = $("logoutBtn") || qs('[data-action="logout"]');
  const userEmailEl = $("userEmail") || qs('[data-role="userEmail"]');

  const shipmentsBody =
    $("shipmentsBody") ||
    qs("#shipmentsTable tbody") ||
    qs('[data-role="shipmentsBody"]');

  const newBtn = $("newShipmentBtn") || qs('[data-action="newShipment"]');

  // Form (create/edit) – verwacht ids; mag ook data-role.
  const formWrap = $("shipmentFormWrap") || qs('[data-role="shipmentFormWrap"]');
  const formTitle = $("formTitle") || qs('[data-role="formTitle"]');

  const inpId = $("shipmentId") || qs('[data-field="shipmentId"]'); // hidden
  const inpCustomer = $("customerName") || qs('[data-field="customer_name"]');
  const inpStatus = $("startStatus") || qs('[data-field="status"]');
  const inpColli = $("colliCount") || qs('[data-field="colli_count"]');
  const inpKg = $("weightKg") || qs('[data-field="weight_kg"]');

  const btnSave = $("saveShipmentBtn") || qs('[data-action="saveShipment"]');
  const btnCancel = $("cancelShipmentBtn") || qs('[data-action="cancelShipment"]');

  // ---------- State ----------
  let currentUser = null;
  let refreshTimer = null;

  // ---------- Auth ----------
  async function requireSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    if (!session?.user) {
      // Als je een aparte loginpagina hebt:
      window.location.href = "../driver/login.html";
      return null;
    }
    currentUser = session.user;
    return session.user;
  }

  // ---------- Trackcode generator: DVK-YYYY-0001 ----------
  async function generateNextTrackCode() {
    const year = new Date().getFullYear();
    const prefix = `DVK-${year}-`;

    // Pak hoogste track_code van dit jaar (binnen jouw zichtbare rows)
    const { data, error } = await sb
      .from("shipments")
      .select("track_code")
      .like("track_code", `${prefix}%`)
      .order("track_code", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[DVK][dashboard] generateNextTrackCode error:", error);
      // fallback: gewoon 0001
      return `${prefix}0001`;
    }

    const last = data?.[0]?.track_code || null;
    if (!last) return `${prefix}0001`;

    const parts = String(last).split("-");
    const lastNum = parseInt(parts[2] || "0", 10);
    const nextNum = Number.isFinite(lastNum) ? lastNum + 1 : 1;
    const padded = String(nextNum).padStart(4, "0");
    return `${prefix}${padded}`;
  }

  // ---------- UI: form ----------
  function openForm(mode = "create", shipment = null) {
    if (!formWrap) return;

    formWrap.style.display = "block";
    if (formTitle) formTitle.textContent = mode === "edit" ? "Zending wijzigen" : "Nieuwe zending";

    if (inpId) inpId.value = shipment?.id || "";
    if (inpCustomer) inpCustomer.value = shipment?.customer_name || "";
    if (inpStatus) inpStatus.value = shipment?.status || "created";

    if (inpColli) inpColli.value = shipment?.colli_count ?? "";
    if (inpKg) inpKg.value = shipment?.weight_kg ?? "";
  }

  function closeForm() {
    if (!formWrap) return;
    formWrap.style.display = "none";
    if (inpId) inpId.value = "";
    if (inpCustomer) inpCustomer.value = "";
    if (inpStatus) inpStatus.value = "created";
    if (inpColli) inpColli.value = "";
    if (inpKg) inpKg.value = "";
  }

  function readForm() {
    const customer_name = (inpCustomer?.value || "").trim();
    const status = (inpStatus?.value || "created").trim();

    // colli_count integer
    const colliRaw = (inpColli?.value ?? "").toString().trim();
    const colli_count = colliRaw === "" ? null : parseInt(colliRaw, 10);

    // weight_kg numeric (mag decimal)
    const kgRaw = (inpKg?.value ?? "").toString().trim().replace(",", ".");
    const weight_kg = kgRaw === "" ? null : Number(kgRaw);

    if (!customer_name) throw new Error("Vul klantnaam in.");

    if (colli_count !== null && !Number.isFinite(colli_count)) {
      throw new Error("Colli moet een geheel getal zijn.");
    }
    if (weight_kg !== null && !Number.isFinite(weight_kg)) {
      throw new Error("Kg moet een getal zijn (bijv. 12.5).");
    }

    return { customer_name, status, colli_count, weight_kg };
  }

  // ---------- Data: list ----------
  async function loadShipments() {
    if (!shipmentsBody) return;

    setMsg("Laden…", "muted");

    const { data, error } = await sb
      .from("shipments")
      .select("id, track_code, customer_name, status, colli_count, weight_kg, updated_at, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[DVK][dashboard] loadShipments error:", error);
      setMsg(`Fout bij laden: ${error.message}`, "bad");
      return;
    }

    renderShipments(data || []);
    setMsg("Dashboard geladen ✅", "ok");
  }

  function renderShipments(rows) {
    if (!shipmentsBody) return;
    shipmentsBody.innerHTML = "";

    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6" class="muted">Nog geen zendingen.</td>`;
      shipmentsBody.appendChild(tr);
      return;
    }

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.track_code || "")}</strong></td>
        <td>${escapeHtml(r.customer_name || "")}</td>
        <td>${escapeHtml(statusNL(r.status))}</td>
        <td>${r.colli_count ?? ""}</td>
        <td>${r.weight_kg ?? ""}</td>
        <td>${escapeHtml(fmtDate(r.updated_at || r.created_at))}</td>
        <td>
          <button class="btn small" data-action="edit" data-id="${r.id}">Wijzigen</button>
        </td>
      `;
      shipmentsBody.appendChild(tr);
    }

    // bind edit buttons
    shipmentsBody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;

        const { data, error } = await sb
          .from("shipments")
          .select("id, track_code, customer_name, status, colli_count, weight_kg")
          .eq("id", id)
          .maybeSingle();

        if (error) {
          console.error("[DVK][dashboard] fetch shipment error:", error);
          setMsg(`Fout bij openen: ${error.message}`, "bad");
          return;
        }
        openForm("edit", data);
      });
    });
  }

  // ---------- Data: save (create/edit) ----------
  async function saveShipment() {
    try {
      const payload = readForm();
      const id = inpId?.value || "";

      // Create
      if (!id) {
        const track_code = await generateNextTrackCode();

        const insertPayload = {
          track_code,
          customer_name: payload.customer_name,
          status: payload.status,
          colli_count: payload.colli_count,
          weight_kg: payload.weight_kg,
          driver_id: currentUser.id, // belangrijk voor RLS
        };

        const { error } = await sb.from("shipments").insert(insertPayload);
        if (error) throw error;

        setMsg(`Zending aangemaakt: ${track_code} ✅`, "ok");
        closeForm();
        await loadShipments();
        return;
      }

      // Edit
      const updatePayload = {
        customer_name: payload.customer_name,
        status: payload.status,
        colli_count: payload.colli_count,
        weight_kg: payload.weight_kg,
      };

      const { error } = await sb.from("shipments").update(updatePayload).eq("id", id);
      if (error) throw error;

      setMsg("Zending bijgewerkt ✅", "ok");
      closeForm();
      await loadShipments();
    } catch (e) {
      console.error("[DVK][dashboard] saveShipment error:", e);
      setMsg(e?.message || "Opslaan mislukt.", "bad");
    }
  }

  // ---------- Realtime refresh (simpel & stabiel) ----------
  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      loadShipments().catch(() => {});
    }, 10000); // elke 10 sec
  }
  function stopAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  // ---------- Escape ----------
  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Events ----------
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await sb.auth.signOut();
      window.location.href = "../driver/login.html";
    });
  }

  if (newBtn) {
    newBtn.addEventListener("click", () => openForm("create", null));
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", () => closeForm());
  }

  if (btnSave) {
    btnSave.addEventListener("click", (e) => {
      e.preventDefault();
      saveShipment();
    });
  }

  // ---------- Boot ----------
  (async function boot() {
    try {
      const user = await requireSession();
      if (!user) return;

      if (userEmailEl) userEmailEl.textContent = user.email || "";

      await loadShipments();
      startAutoRefresh();
    } catch (e) {
      console.error("[DVK][dashboard] boot error:", e);
      setMsg(`Fout: ${e.message || e}`, "bad");
    }
  })();
})();
