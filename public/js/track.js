// public/js/track.js
(() => {
  const supabase = window.supabaseClient;

  const el = (id) => document.getElementById(id);

  const trackInput = el("trackInput");
  const searchBtn = el("searchBtn");
  const statusMsg = el("statusMsg");
  const resultBox = el("result");
  const foundInfo = el("foundInfo");
  const packageInfo = el("packageInfo");
  const timelineDiv = el("timeline");

  let channel = null;

  function setMsg(text, type = "") {
    statusMsg.className = "msg " + (type || "");
    statusMsg.textContent = text || "";
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

  function eventText(code) {
    const map = {
      created: "Zending aangemeld",
      en_route: "Chauffeur is onderweg",
      delivered: "Zending afgeleverd",
      problem: "Probleem gemeld"
    };
    return map[code] || code;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("nl-NL");
    } catch {
      return iso;
    }
  }

  function renderPackageInfo(shipment) {
    // F3: Toon colli/kg alleen als het gevuld is
    let html = `<div style="font-weight:700;">Pakketgegevens</div>`;
    const lines = [];

    if (shipment.colli_count != null) lines.push(`Aantal colli: ${shipment.colli_count}`);
    if (shipment.weight_kg != null) lines.push(`Gewicht: ${shipment.weight_kg} kg`);

    if (lines.length === 0) {
      html += `<div class="muted">Geen gegevens opgegeven.</div>`;
    } else {
      html += `<div class="muted">${lines.join("<br>")}</div>`;
    }

    packageInfo.innerHTML = html;
  }

  function renderTimeline(events) {
    timelineDiv.innerHTML = "";

    if (!events || events.length === 0) {
      timelineDiv.innerHTML = `<div class="muted">Geen events gevonden.</div>`;
      return;
    }

    for (const e of events) {
      const row = document.createElement("div");
      row.className = "timeline-item";
      row.innerHTML = `
        <div style="font-weight:700;">${statusLabel(e.event_type)}</div>
        <div class="muted">${eventText(e.event_type)}</div>
        ${e.note ? `<div class="muted">Ontvangen door: ${e.note}</div>` : ""}
        <div class="muted">${formatDate(e.created_at)}</div>
      `;
      timelineDiv.appendChild(row);
    }
  }

  async function fetchShipment(trackCode) {
    // klantzijde: we lezen shipments + events
    const { data, error } = await supabase
      .from("shipments")
      .select("id,track_code,status,customer_name,colli_count,weight_kg")
      .eq("track_code", trackCode)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchEvents(shipmentId) {
    const { data, error } = await supabase
      .from("shipment_events")
      .select("id,event_type,note,created_at")
      .eq("shipment_id", shipmentId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  function stopRealtime() {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  async function startRealtime(shipmentId) {
    stopRealtime();

    channel = supabase
      .channel("events_" + shipmentId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
        async () => {
          // refresh timeline bij wijziging
          const events = await fetchEvents(shipmentId);
          renderTimeline(events);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // realtime actief
        }
      });
  }

  async function runSearch() {
    const code = (trackInput.value || "").trim();
    if (!code) {
      setMsg("Vul een trackcode in.", "bad");
      return;
    }

    setMsg("Zoeken…", "warn");
    resultBox.style.display = "none";

    try {
      const shipment = await fetchShipment(code);

      if (!shipment) {
        setMsg("Geen zending gevonden met deze trackcode.", "bad");
        stopRealtime();
        return;
      }

      setMsg("Gevonden ✅ (realtime actief)", "ok");
      resultBox.style.display = "block";

      foundInfo.innerHTML = `
        <div>Klant: ${shipment.customer_name || "—"}</div>
        <div>Trackcode: ${shipment.track_code}</div>
        <div style="margin-top:6px;"><strong>Status:</strong> ${statusLabel(shipment.status)}</div>
      `;

      renderPackageInfo(shipment);

      const events = await fetchEvents(shipment.id);
      renderTimeline(events);

      await startRealtime(shipment.id);
    } catch (e) {
      console.error(e);
      setMsg("Fout bij laden (check console)", "bad");
      stopRealtime();
    }
  }

  // UI events
  searchBtn.addEventListener("click", runSearch);
  trackInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

})();
