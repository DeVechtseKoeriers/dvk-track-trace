/* public/js/driver.js
   Chauffeur dashboard: status zetten + event loggen
   Vereist: window.supabaseClient (uit supabase-config.js)
*/

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("supabaseClient ontbreekt. Check supabase-config.js");
    return;
  }

  // --- Helpers
  function $(id) { return document.getElementById(id); }

  // Status labels (NL) voor weergave (optioneel in UI)
  const STATUS_LABEL_NL = {
    created: "Aangemeld",
    en_route: "Onderweg",
    delivered: "Afgeleverd",
    problem: "Probleem",
  };

  // --- VEREIST: je driver dashboard heeft ergens shipment cards met knoppen
  // In jouw repo werd status vaak via data-attributes gezet.
  // Dit script verwacht knoppen met: data-action="setStatus" data-status="created|en_route|delivered|problem"
  // en een parent element met data-shipment-id="UUID"
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action='setStatus']");
    if (!btn) return;

    const newStatus = btn.getAttribute("data-status");
    const card = btn.closest("[data-shipment-id]");
    const shipmentId = card?.getAttribute("data-shipment-id");

    if (!shipmentId || !newStatus) return;

    btn.disabled = true;

    try {
      let note = null;

      if (newStatus === "problem") {
        note = prompt("Wat is het probleem? (optioneel)") || null;
      }

      // ✅ NIEUW: bij Afgeleverd vragen “aan wie”
      if (newStatus === "delivered") {
        note = prompt("Aan wie is het afgeleverd? (naam, optioneel)") || null;
      }

      // 1) Update hoofdstatus in shipments
      const { error: upErr } = await sb
        .from("shipments")
        .update({ status: newStatus })
        .eq("id", shipmentId);

      if (upErr) throw upErr;

      // 2) Log event in shipment_events
      const { error: insErr } = await sb
        .from("shipment_events")
        .insert([{
          shipment_id: shipmentId,
          event_type: newStatus,
          note: note,
        }]);

      if (insErr) throw insErr;

      // Optioneel: direct UI bijwerken
      const statusEl = card.querySelector("[data-role='statusLabel']");
      if (statusEl) statusEl.textContent = STATUS_LABEL_NL[newStatus] || newStatus;

      console.log("Status bijgewerkt:", shipmentId, newStatus, note);
    } catch (err) {
      console.error(err);
      alert("Kon status niet opslaan. Check console.");
    } finally {
      btn.disabled = false;
    }
  });
})();
