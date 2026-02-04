/* public/js/track.js
   Klant Track & Trace: zoeken op track_code + realtime updates
   Vereist: window.supabaseClient (uit supabase-config.js)
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // DOM
  const trackInput = document.getElementById("trackInput");
  const searchBtn = document.getElementById("searchBtn");
  const statusMsg = document.getElementById("statusMsg");
  const resultEl = document.getElementById("result");

  // NL labels (alleen dit tonen!)
  const TYPE = {
    created:  { title: "Aangemeld",  subtitle: "Zending aangemeld" },
    en_route: { title: "Onderweg",   subtitle: "Chauffeur is onderweg" },
    delivered:{ title: "Afgeleverd", subtitle: "Zending afgeleverd" },
    problem:  { title: "Probleem",   subtitle: "Probleem gemeld" },
  };

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleString("nl-NL", { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
    } catch { return String(ts); }
  }

  function setMsg(text, ok = true) {
    if (!statusMsg) return;
    statusMsg.textContent = text || "";
    statusMsg.style.color = ok ? "#22c55e" : "#ef4444";
  }

  function clearUI() {
    if (resultEl) resultEl.innerHTML = "";
  }

  // Realtime subscription (per shipment)
  let channel = null;
  function stopRealtime() {
    if (channel) {
      sb.removeChannel(channel);
      channel = null;
    }
  }

  function renderShipment(shipment, events) {
    // Bepaal “hoofdstaat” in NL (geen codes tonen)
    const statusKey = shipment?.status || "created";
    const statusMeta = TYPE[statusKey] || { title: "Status", subtitle: "" };

    // Events sorteren
    const sorted = (events || []).slice().sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Timeline HTML (alleen NL)
    const timelineHtml = sorted.length
      ? sorted.map(ev => {
          const meta = TYPE[ev.event_type] || { title: "Update", subtitle: "" };
          const note = ev.note ? `<div class="muted">Ontvangen door: ${escapeHtml(ev.note)}</div>` : "";
          return `
            <div class="tl-item">
              <div class="tl-left">
                <div class="tl-title">${escapeHtml(meta.title)}</div>
                <div class="tl-sub">${escapeHtml(meta.subtitle)}</div>
                ${note}
              </div>
              <div class="tl-time">${escapeHtml(fmtDate(ev.created_at))}</div>
            </div>
          `;
        }).join("")
      : `<div class="muted">Geen events gevonden.</div>`;

    // Resultaatkaart (simpel, past bij jouw layout)
    resultEl.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="h">Zending gevonden</div>
            <div class="muted">Klant: ${escapeHtml(shipment.customer_name || "-")}</div>
            <div class="muted">Trackcode: ${escapeHtml(shipment.track_code || "-")}</div>
          </div>
          <div class="badge">${escapeHtml(statusMeta.title)}</div>
        </div>

        <div class="sep"></div>

        <div class="h">Timeline</div>
        <div class="timeline">
          ${timelineHtml}
        </div>
      </div>
    `;
  }

  async function loadByTrackCode(trackCode) {
    const code = String(trackCode || "").trim();
    if (!code) {
      setMsg("Vul een trackcode in.", false);
      return;
    }

    setMsg("Zoeken...", true);
    clearUI();
    stopRealtime();

    // 1) Shipment ophalen
    const { data: shipments, error: shipErr } = await sb
      .from("shipments")
      .select("id, track_code, status, customer_name, created_at")
      .eq("track_code", code)
      .limit(1);

    if (shipErr) {
      console.error(shipErr);
      setMsg("Fout bij laden (check console)", false);
      return;
    }

    const shipment = shipments?.[0];
    if (!shipment) {
      setMsg("Niet gevonden.", false);
      return;
    }

    // 2) Events ophalen
    const { data: events, error: evErr } = await sb
      .from("shipment_events")
      .select("id, shipment_id, event_type, note, created_at")
      .eq("shipment_id", shipment.id)
      .order("created_at", { ascending: true });

    if (evErr) {
      console.error(evErr);
      setMsg("Fout bij laden events (check console)", false);
      return;
    }

    renderShipment(shipment, events);
    setMsg("Gevonden ✅ (realtime actief)", true);

    // 3) Realtime: events + shipment status
    channel = sb
      .channel("track-" + shipment.id)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipment.id}` },
        async () => {
          // herlaad events + shipment (veilig, simpel)
          const [{ data: s2 }, { data: e2 }] = await Promise.all([
            sb.from("shipments").select("id, track_code, status, customer_name, created_at").eq("id", shipment.id).limit(1),
            sb.from("shipment_events").select("id, shipment_id, event_type, note, created_at").eq("shipment_id", shipment.id).order("created_at", { ascending: true }),
          ]);

          renderShipment(s2?.[0] || shipment, e2 || []);
          setMsg("Gevonden ✅ (realtime actief)", true);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments", filter: `id=eq.${shipment.id}` },
        async () => {
          const [{ data: s2 }, { data: e2 }] = await Promise.all([
            sb.from("shipments").select("id, track_code, status, customer_name, created_at").eq("id", shipment.id).limit(1),
            sb.from("shipment_events").select("id, shipment_id, event_type, note, created_at").eq("shipment_id", shipment.id).order("created_at", { ascending: true }),
          ]);

          renderShipment(s2?.[0] || shipment, e2 || []);
          setMsg("Gevonden ✅ (realtime actief)", true);
        }
      )
      .subscribe();
  }

  // UI bindings
  async function runSearch() {
    const code = trackInput?.value || "";
    await loadByTrackCode(code);
  }

  if (searchBtn) searchBtn.addEventListener("click", runSearch);
  if (trackInput) {
    trackInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });
  }

  // Cleanup
  window.addEventListener("beforeunload", () => stopRealtime());
})();
