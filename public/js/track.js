/* global supabaseClient */
(() => {
  const $ = (id) => document.getElementById(id);

  function showMsg(el, text, type = "ok") {
    if (!el) return;
    el.style.display = "block";
    el.className = `msg ${type}`;
    el.textContent = text;
  }
  function clearMsg(el) {
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function statusLabel(status) {
    const map = {
      created: "Aangemeld",
      pickup: "Opgehaald",
      in_transit: "Onderweg",
      delivered: "Afgeleverd",
      problem: "Probleem",
      archived: "Afgehandeld",
    };
    return map[status] || status || "-";
  }

  function fmtDate(dt) {
    if (!dt) return "-";
    const d = new Date(dt);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function runSearch() {
    const trackInput = $("trackInput");
    const searchBtn = $("searchBtn");
    const statusMsg = $("statusMsg");
    const resultEl = $("result");
    const timelineEl = $("timeline");

    if (!window.supabaseClient) {
      showMsg(statusMsg, "Supabase client ontbreekt. Check supabase-config.js", "bad");
      return;
    }

    // voorkom null crashes
    if (!trackInput || !searchBtn || !statusMsg || !resultEl || !timelineEl) {
      console.error("Ontbrekende HTML elementen:", { trackInput, searchBtn, statusMsg, resultEl, timelineEl });
      alert("Track & Trace: HTML IDs ontbreken (check console).");
      return;
    }

    clearMsg(statusMsg);
    resultEl.innerHTML = "";
    timelineEl.innerHTML = "";

    const code = (trackInput.value || "").trim();
    if (!code) {
      showMsg(statusMsg, "Vul een trackcode in.", "bad");
      return;
    }

    searchBtn.disabled = true;
    searchBtn.textContent = "Zoeken...";

    try {
      // shipment zoeken
      const { data: shipment, error: sErr } = await supabaseClient
        .from("shipments")
        .select("id, track_code, customer_name, status, pickup_address, dropoff_address, shipment_type, colli_count, weight_kg")
        .eq("track_code", code)
        .maybeSingle();

      if (sErr) throw sErr;
      if (!shipment) {
        showMsg(statusMsg, "Niet gevonden.", "bad");
        return;
      }

      showMsg(statusMsg, "Gevonden ✅ (realtime actief)", "ok");

      resultEl.innerHTML = `
        <div style="font-weight:700;margin-top:10px;">Zending gevonden</div>
        <div><b>Klant:</b> ${escapeHtml(shipment.customer_name || "-")}</div>
        <div><b>Trackcode:</b> ${escapeHtml(shipment.track_code)}</div>
        <div><b>Status:</b> ${escapeHtml(statusLabel(shipment.status))}</div>

        <div style="margin-top:8px;">
          <div><b>Ophaaladres:</b> ${escapeHtml(shipment.pickup_address || "-")}</div>
          <div><b>Bezorgadres:</b> ${escapeHtml(shipment.dropoff_address || "-")}</div>
          <div><b>Type zending:</b> ${escapeHtml(shipment.shipment_type || "-")}</div>
          <div><b>Colli:</b> ${escapeHtml(String(shipment.colli_count ?? "-"))}</div>
          <div><b>Kg:</b> ${escapeHtml(String(shipment.weight_kg ?? "-"))}</div>
        </div>

        <div style="margin-top:10px;font-weight:700;">Timeline</div>
      `;

      // events laden
      const { data: events, error: eErr } = await supabaseClient
        .from("shipment_events")
        .select("event_type, created_at, note, receiver_name")
        .eq("shipment_id", shipment.id)
        .order("created_at", { ascending: true });

      if (eErr) throw eErr;

      if (!events || events.length === 0) {
        timelineEl.innerHTML = `<div class="muted">Nog geen statusupdates beschikbaar.</div>`;
        return;
      }

      timelineEl.innerHTML = events.map(ev => `
        <div class="timeline-item">
          <div style="font-weight:700;">${escapeHtml(statusLabel(ev.event_type))}</div>
          <div class="muted">${escapeHtml(fmtDate(ev.created_at))}</div>
          ${ev.receiver_name ? `<div class="muted">Ontvangen door: ${escapeHtml(ev.receiver_name)}</div>` : ""}
          ${ev.note ? `<div class="muted">${escapeHtml(ev.note)}</div>` : ""}
        </div>
      `).join("");

    } catch (e) {
      console.error(e);
      showMsg(statusMsg, `Fout bij laden: ${e.message}`, "bad");
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Zoeken";
    }
  }

  function boot() {
    const searchBtn = $("searchBtn");
    const trackInput = $("trackInput");

    if (!searchBtn || !trackInput) return;

    searchBtn.addEventListener("click", runSearch);
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
