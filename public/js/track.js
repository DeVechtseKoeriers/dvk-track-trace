/* public/js/track.js
   Track & Trace (klant) – zoekt shipment op track_code + timeline uit shipment_events
   Vereist: window.sb (supabase client) uit supabase-config.js
*/

(function () {
  const log = (...a) => console.log("[DVK][track]", ...a);

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtDate(ts) {
    if (!ts) return "-";
    const d = new Date(ts);
    return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  const statusMap = {
    created: "Aangemeld",
    pickup: "Opgehaald",
    in_transit: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem gemeld",
  };

  function statusLabel(code) {
    return statusMap[code] || code || "-";
  }

  function statusDesc(code) {
    const m = {
      created: "Zending aangemeld",
      pickup: "Zending opgehaald",
      in_transit: "Zending onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld",
    };
    return m[code] || "";
  }

  function setMsg(text, type = "ok") {
    const s = el("statusMsg");
    if (!s) return;
    s.textContent = text || "";
    s.className = `msg msg-${type}`;
  }

  function clearUI() {
    const r = el("result");
    const t = el("timeline");
    if (r) r.innerHTML = "";
    if (t) t.innerHTML = "";
  }

  async function fetchShipmentByTrackCode(trackCode) {
    const sb = window.sb;
    if (!sb) throw new Error("supabaseClient ontbreekt");

    const { data, error } = await sb
      .from("shipments")
      .select(
        "id, track_code, status, customer_name, pickup_address, delivery_address, shipment_type, colli_count, weight_kg, created_at"
      )
      .eq("track_code", trackCode)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchEventsForShipment(shipmentId) {
    const sb = window.sb;
    if (!sb) throw new Error("supabaseClient ontbreekt");

    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function render(shipment, events) {
    const r = el("result");
    const t = el("timeline");
    if (!r || !t) return;

    const pickup = shipment.pickup_address || "-";
    const delivery = shipment.delivery_address || "-";
    const type = shipment.shipment_type || "-";
    const colli = shipment.colli_count ?? "-";
    const kg = shipment.weight_kg ?? "-";

    r.innerHTML = `
      <div style="font-weight:800; font-size:18px; margin-top:10px;">Zending gevonden</div>
      <div><b>Klant:</b> ${escapeHtml(shipment.customer_name || "-")}</div>
      <div><b>Trackcode:</b> ${escapeHtml(shipment.track_code || "-")}</div>
      <div style="margin-top:10px;"><b>Status</b><br>${escapeHtml(statusLabel(shipment.status))}</div>

      <div style="margin-top:12px;">
        <b>Ophaaladres:</b> ${escapeHtml(pickup)}<br>
        <b>Bezorgadres:</b> ${escapeHtml(delivery)}<br>
        <b>Type zending:</b> ${escapeHtml(type)}<br>
        <b>Colli:</b> ${escapeHtml(colli)}<br>
        <b>Kg:</b> ${escapeHtml(kg)}
      </div>
    `;

    t.innerHTML = `<div style="font-weight:700; margin-top:14px;">Timeline</div>`;

    if (!events.length) {
      t.innerHTML += `<div class="muted" style="margin-top:6px;">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    const items = events
      .map((ev) => {
        const title = statusLabel(ev.event_type);
        const desc = statusDesc(ev.event_type);
        const when = fmtDate(ev.created_at);
        const note = ev.note && String(ev.note).trim() ? `<div class="muted">Ontvangen door: ${escapeHtml(ev.note)}</div>` : "";
        return `
          <div class="card" style="margin-top:10px; padding:10px;">
            <div style="font-weight:800;">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(desc)}</div>
            ${note}
            <div class="muted" style="margin-top:6px;">${escapeHtml(when)}</div>
          </div>
        `;
      })
      .join("");

    t.innerHTML += items;
  }

  async function runSearch() {
    const input = el("trackInput");
    const btn = el("searchBtn");

    const trackCode = (input?.value || "").trim();
    clearUI();

    if (!trackCode) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    if (btn) btn.disabled = true;
    setMsg("Zoeken...", "info");

    try {
      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      const events = await fetchEventsForShipment(shipment.id);

      setMsg("Gevonden ✅", "ok");
      render(shipment, events);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console).", "bad");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ✅ Bind altijd pas nadat DOM bestaat
  function bind() {
    const input = el("trackInput");
    const btn = el("searchBtn");

    log("bind:", {
      trackInput: !!input,
      searchBtn: !!btn,
      statusMsg: !!el("statusMsg"),
      result: !!el("result"),
      timeline: !!el("timeline"),
      sb: !!window.sb,
    });

    if (btn) btn.addEventListener("click", runSearch);
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runSearch();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", bind);
})();
