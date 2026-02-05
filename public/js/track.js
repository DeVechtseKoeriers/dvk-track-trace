/* public/js/track.js - ROBUUSTE versie
   - werkt ook als IDs iets afwijken
   - voorkomt form submit refresh
   - logt of binding gelukt is
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // Helpers
  const $ = (sel) => document.querySelector(sel);

  function pickFirst(selectors) {
    for (const s of selectors) {
      const el = $(s);
      if (el) return el;
    }
    return null;
  }

  function setMsg(el, text, type = "") {
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg " + type;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}, ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  const STATUS_NL = {
    created: { title: "Aangemeld", desc: "Zending aangemeld" },
    en_route: { title: "Onderweg", desc: "Chauffeur is onderweg" },
    delivered: { title: "Afgeleverd", desc: "Zending afgeleverd" },
    problem: { title: "Probleem", desc: "Probleem gemeld" },
  };

  const statusLabel = (code) => STATUS_NL[code]?.title || "Status";
  const statusDesc = (code) => STATUS_NL[code]?.desc || "";

  // Realtime state
  let currentShipment = null;
  let currentSub = null;

  function removeChannel() {
    if (currentSub) {
      sb.removeChannel(currentSub);
      currentSub = null;
    }
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
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function render(resultEl, timelineEl, shipment, events) {
    if (!shipment) return;

    const statusCode = shipment.status || "created";

    // pakket info (kolomnamen flexibel)
    const colli = shipment.colli ?? shipment.aantal_colli ?? shipment.packages ?? null;
    const kg = shipment.kg ?? shipment.weight_kg ?? shipment.weight ?? null;

    const extra = [];
    if (colli !== null && colli !== "" && colli !== undefined) extra.push(`Aantal colli: ${escapeHtml(colli)}`);
    if (kg !== null && kg !== "" && kg !== undefined) extra.push(`Gewicht: ${escapeHtml(kg)} kg`);

    const headerHtml = `
      <div style="font-weight:700; font-size:18px; margin-bottom:6px;">Zending gevonden</div>
      <div>Klant: ${escapeHtml(shipment.customer_name || "")}</div>
      <div>Trackcode: ${escapeHtml(shipment.track_code || "")}</div>
      <div style="margin-top:8px; font-weight:700;">Status</div>
      <div>${escapeHtml(statusLabel(statusCode))}</div>
      ${extra.length ? `<div style="margin-top:10px;">${extra.map(x => `<div>${x}</div>`).join("")}</div>` : ""}
    `;
    if (resultEl) resultEl.innerHTML = headerHtml;

    if (!timelineEl) return;
    if (!events.length) {
      timelineEl.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    timelineEl.innerHTML = events
      .map((ev) => {
        const code = ev.event_type || ev.type || ev.status || "";
        const title = statusLabel(code);
        const desc = statusDesc(code);
        const note =
          code === "delivered" && ev.note && String(ev.note).trim()
            ? `<div style="margin-top:4px;">✅ Ontvangen door: ${escapeHtml(ev.note)}</div>`
            : "";

        return `
          <div style="padding:10px 0; border-top:1px solid rgba(255,255,255,.08);">
            <div style="font-weight:700;">${escapeHtml(title)}</div>
            <div class="muted">${escapeHtml(desc)}</div>
            ${note}
            <div class="muted" style="margin-top:4px;">${escapeHtml(fmtDate(ev.created_at))}</div>
          </div>
        `;
      })
      .join("");
  }

  async function startRealtime(statusMsg, resultEl, timelineEl, shipmentId) {
    removeChannel();

    currentSub = sb
      .channel(`shipment_events_${shipmentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          try {
            if (!currentShipment) return;
            const refreshed = await fetchShipmentByTrackCode(currentShipment.track_code);
            currentShipment = refreshed || currentShipment;

            const events = await fetchEventsForShipment(shipmentId);
            render(resultEl, timelineEl, currentShipment, events);
            setMsg(statusMsg, "Gevonden ✅ (realtime actief)", "ok");
          } catch (e) {
            console.error("Realtime update error:", e);
            setMsg(statusMsg, `Realtime fout: ${e?.message || e}`, "bad");
          }
        }
      )
      .subscribe();
  }

  function boot() {
    // Pak elementen (meerdere mogelijke IDs)
    const trackInput = pickFirst([
      "#trackInput",
      "#track_code",
      "#trackCode",
      'input[name="track_code"]',
      'input[placeholder*="DVK"]',
    ]);

    const searchBtn = pickFirst([
      "#searchBtn",
      "#zoekBtn",
      "#btnSearch",
      'button[type="submit"]',
      'button',
    ]);

    const statusMsg = pickFirst(["#statusMsg", "#msg", ".msg"]);
    const resultEl = pickFirst(["#result", "#shipmentResult"]);
    const timelineEl = pickFirst(["#timeline", "#timelineEl", ".timeline"]);

    const formEl = searchBtn?.closest("form") || trackInput?.closest("form") || null;

    console.log("[DVK][track] bind:", {
      trackInput: !!trackInput,
      searchBtn: !!searchBtn,
      statusMsg: !!statusMsg,
      resultEl: !!resultEl,
      timelineEl: !!timelineEl,
      formEl: !!formEl,
    });

    if (!trackInput || !searchBtn) {
      setMsg(statusMsg, "Track pagina fout: input/knop niet gevonden (IDs mismatch).", "bad");
      return;
    }

    async function runSearch() {
      const trackCode = (trackInput.value || "").trim();

      if (resultEl) resultEl.innerHTML = "";
      if (timelineEl) timelineEl.innerHTML = "";

      if (!trackCode) {
        setMsg(statusMsg, "Vul een trackcode in.", "bad");
        return;
      }

      try {
        searchBtn.disabled = true;
        setMsg(statusMsg, "Zoeken…", "");

        const shipment = await fetchShipmentByTrackCode(trackCode);
        if (!shipment) {
          removeChannel();
          currentShipment = null;
          setMsg(statusMsg, "Geen zending gevonden met deze trackcode.", "bad");
          return;
        }

        currentShipment = shipment;

        const events = await fetchEventsForShipment(shipment.id);
        render(resultEl, timelineEl, shipment, events);

        setMsg(statusMsg, "Gevonden ✅ (realtime actief)", "ok");
        await startRealtime(statusMsg, resultEl, timelineEl, shipment.id);
      } catch (e) {
        console.error("[DVK][track] error:", e);
        const hint = e?.status === 401 || e?.status === 403 ? " (RLS/permissions)" : "";
        setMsg(statusMsg, `Fout bij laden: ${e?.message || e}${hint}`, "bad");
      } finally {
        searchBtn.disabled = false;
      }
    }

    // Klik
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("[DVK][track] click search");
      runSearch();
    });

    // Enter in input
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        console.log("[DVK][track] enter search");
        runSearch();
      }
    });

    // Form submit (als aanwezig)
    if (formEl) {
      formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        console.log("[DVK][track] form submit search");
        runSearch();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
