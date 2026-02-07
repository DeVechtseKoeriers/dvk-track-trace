/* public/js/track.js
   Track & Trace:
   - zoekt shipment op track_code
   - haalt events op uit shipment_events
   - realtime updates (optioneel)
   - status in NL
   - toont: ophaaladres, bezorgadres, type, colli, kg
   Vereist IDs in HTML:
   #trackInput #searchBtn #statusMsg #result #timeline
*/

(() => {
  const sb = window.sb;

  const $ = (sel) => document.querySelector(sel);

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setMsg(text, type = "ok") {
    const el = $("#statusMsg");
    if (!el) return;
    el.style.display = "block";
    el.textContent = text || "";
    el.className = "msg " + (type === "bad" ? "bad" : "ok");
  }

  function clearMsg() {
    const el = $("#statusMsg");
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  const STATUS_NL = {
    created: "Aangemeld",
    pickup: "Opgehaald",
    in_transit: "Onderweg",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem gemeld",
  };

  const EVENT_NL = {
    created: { title: "Aangemeld", desc: "Zending aangemeld" },
    pickup: { title: "Opgehaald", desc: "Zending opgehaald" },
    in_transit: { title: "Onderweg", desc: "Zending is onderweg" },
    en_route: { title: "Onderweg", desc: "Zending is onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    problem: { title: "Probleem", desc: "Probleem gemeld" },
    note: { title: "Update", desc: "Statusupdate" },
  };

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  function statusLabel(code) {
    return STATUS_NL[code] || code || "-";
  }

  function renderShipment(shipment) {
    const result = $("#result");
    if (!result) return;

    const pickupAddr =
      shipment.pickup_address ||
      shipment.pickup_addr ||
      shipment.pickup ||
      "-";

    const dropoffAddr =
      shipment.dropoff_address ||
      shipment.delivery_address ||
      shipment.dropoff_addr ||
      shipment.dropoff ||
      "-";

    const type =
      shipment.shipment_type ||
      shipment.type ||
      "-";

    const colli =
      shipment.colli_count ??
      shipment.colli ??
      "-";

    const kg =
      shipment.weight_kg ??
      shipment.kg ??
      shipment.weight ??
      "-";

    result.innerHTML = `
      <div class="box">
        <div style="font-weight:800; font-size:18px;">Zending gevonden</div>
        <div><b>Klant:</b> ${escapeHtml(shipment.customer_name || "-")}</div>
        <div><b>Trackcode:</b> ${escapeHtml(shipment.track_code || "-")}</div>
        <div><b>Status:</b> ${escapeHtml(statusLabel(shipment.status))}</div>
        <div style="height:10px"></div>
        <div><b>Ophaaladres:</b> ${escapeHtml(pickupAddr)}</div>
        <div><b>Bezorgadres:</b> ${escapeHtml(dropoffAddr)}</div>
        <div><b>Type zending:</b> ${escapeHtml(type)}</div>
        <div><b>Colli:</b> ${escapeHtml(colli)}</div>
        <div><b>Kg:</b> ${escapeHtml(kg)}</div>
      </div>
    `;
  }

  function renderTimeline(events) {
    const tl = $("#timeline");
    if (!tl) return;

    if (!events || events.length === 0) {
      tl.innerHTML = `<div class="muted">Nog geen statusupdates beschikbaar.</div>`;
      return;
    }

    // oud -> nieuw
    const sorted = [...events].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const items = sorted.map((ev) => {
      const key = ev.event_type || "note";
      const meta = EVENT_NL[key] || { title: key, desc: "" };
      const when = fmtDate(ev.created_at);

      // delivered note JSON: {received_by, note, signature}
      let extra = "";
      if (key === "delivered" && ev.note) {
        const j = safeJsonParse(ev.note);
        if (j && (j.received_by || j.note)) {
          extra = `<div class="muted">Ontvangen door: ${escapeHtml(j.received_by || "-")}${j.note ? " — " + escapeHtml(j.note) : ""}</div>`;
        } else {
          extra = `<div class="muted">${escapeHtml(ev.note)}</div>`;
        }
      } else if (ev.note) {
        extra = `<div class="muted">${escapeHtml(ev.note)}</div>`;
      }

      return `
        <div class="timeline-item">
          <div class="timeline-title">${escapeHtml(meta.title)}</div>
          <div class="muted">${escapeHtml(meta.desc)}</div>
          ${extra}
          <div class="muted">${escapeHtml(when)}</div>
        </div>
      `;
    });

    tl.innerHTML = items.join("");
  }

  async function fetchShipmentByTrackCode(trackCode) {
    const { data, error } = await sb
      .from("shipments")
      .select("*")
      .eq("track_code", trackCode)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchEventsForShipment(shipmentId) {
    const { data, error } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  let currentSub = null;
  function stopRealtime() {
    try {
      if (currentSub) sb.removeChannel(currentSub);
    } catch {}
    currentSub = null;
  }

  function startRealtime(shipmentId, onUpdate) {
    stopRealtime();
    currentSub = sb
      .channel(`shipment_events:${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        () => onUpdate()
      )
      .subscribe();
  }

  async function runSearch() {
    try {
      const trackCode = ($("#trackInput")?.value || "").trim();
      clearMsg();

      const result = $("#result");
      const tl = $("#timeline");
      if (result) result.innerHTML = "";
      if (tl) tl.innerHTML = "";

      if (!trackCode) {
        setMsg("Vul een trackcode in.", "bad");
        return;
      }

      setMsg("Zoeken…", "ok");

      const shipment = await fetchShipmentByTrackCode(trackCode);
      if (!shipment) {
        stopRealtime();
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        return;
      }

      renderShipment(shipment);

      const events = await fetchEventsForShipment(shipment.id);
      renderTimeline(events);

      setMsg("Gevonden ✅ (realtime actief)", "ok");

      startRealtime(shipment.id, async () => {
        const evs = await fetchEventsForShipment(shipment.id);
        renderTimeline(evs);

        // status opnieuw ophalen voor NL label up-to-date
        const refreshed = await fetchShipmentByTrackCode(trackCode);
        if (refreshed) renderShipment(refreshed);
      });
    } catch (e) {
      console.error("[DVK][track] error:", e);
      setMsg("Fout bij laden (check console).", "bad");
    }
  }

  function bind() {
    if (!sb) {
      console.error("[DVK][track] supabaseClient ontbreekt. Check supabase-config.js");
      return;
    }

    const btn = $("#searchBtn");
    const input = $("#trackInput");

    if (!btn || !input) {
      console.error("[DVK][track] DOM mist #searchBtn of #trackInput");
      return;
    }

    btn.addEventListener("click", runSearch);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    console.log("[DVK][track] bind OK");
  }

  bind();
})();
