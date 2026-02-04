<div style="font-weight:700;margin-bottom:8px;">Timeline</div>
      <div class="timeline" id="timeline">
        ${eventsHtml || `<div class="msg">Nog geen events.</div>`}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchShipmentByTrackCode(trackCodeRaw) {
  const trackCode = String(trackCodeRaw || "").trim();
  if (!trackCode) throw new Error("Vul een trackcode in.");

  // shipment ophalen via shipments.track_code
  const { data: ship, error } = await sb
    .from("shipments")
    .select(`id, ${TRACK_COL}, status, customer_name, created_at`)
    .eq(TRACK_COL, trackCode)
    .maybeSingle();

  if (error) throw error;
  if (!ship) return null;
  return ship;
}

async function fetchEvents(shipmentId) {
  const { data, error } = await sb
    .from("shipment_events")
    .select("id, shipment_id, event_type, note, created_at")
    .eq("shipment_id", shipmentId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

async function subscribeRealtime(shipmentId, trackCode) {
  // channel opruimen
  if (currentChannel) {
    try { await sb.removeChannel(currentChannel); } catch {}
    currentChannel = null;
  }

  // Realtime updates op shipment_events + shipments (status update)
  const ch = sb.channel(`track-${shipmentId}`);

  ch.on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "shipment_events", filter: `shipment_id=eq.${shipmentId}` },
    async () => {
      try {
        const ship = await fetchShipmentByTrackCode(trackCode);
        const events = await fetchEvents(shipmentId);
        renderShipmentCard(ship, events);
        setMsg("Gevonden ✅ (realtime actief).", "ok");
      } catch (e) {
        console.error(e);
      }
    }
  );

  ch.on(
    "postgres_changes",
    { event: "UPDATE", schema: "public", table: "shipments", filter: `id=eq.${shipmentId}` },
    async () => {
      try {
        const ship = await fetchShipmentByTrackCode(trackCode);
        const events = await fetchEvents(shipmentId);
        renderShipmentCard(ship, events);
        setMsg("Gevonden ✅ (realtime actief).", "ok");
      } catch (e) {
        console.error(e);
      }
    }
  );

  const { error } = await ch.subscribe();
  if (error) throw error;

  currentChannel = ch;
}

async function runSearch() {
  const code = String(trackInput.value || "").trim();
  setMsg("");
  result.innerHTML = "";
  searchBtn.disabled = true;

  try {
    const ship = await fetchShipmentByTrackCode(code);

    if (!ship) {
      setMsg("Niet gevonden. Controleer de trackcode.", "bad");
      return;
    }

    currentShipmentId = ship.id;
    const events = await fetchEvents(ship.id);

    renderShipmentCard(ship, events);
    setMsg("Gevonden ✅ (realtime actief).", "ok");

    // realtime aan
    await subscribeRealtime(ship.id, ship[TRACK_COL]);

  } catch (err) {
    console.error(err);
    setMsg("Fout bij laden (check console)", "bad");
  } finally {
    searchBtn.disabled = false;
  }
}

// events
searchBtn.addEventListener("click", runSearch);
trackInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") runSearch();
});

// (optioneel) standaard demo invullen
if (trackInput && !trackInput.value) {
  // trackInput.value = "DVK12345";
}
