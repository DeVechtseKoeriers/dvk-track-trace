/* public/js/supabase-config.js */
(function () {
  const log = (...a) => console.log("[DVK][config]", ...a);
  const err = (...a) => console.error("[DVK][config]", ...a);

  // === VUL DIT IN ===
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  // Basic guard
  if (!SUPABASE_URL || SUPABASE_URL.includes("JOUWPROJECT") || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("JOUW_ANON_KEY")) {
    err("Supabase URL/ANON KEY niet ingevuld in public/js/supabase-config.js");
    // We returnen niet hard, want soms wil je alsnog de error zien in de UI.
  }

  // Check CDN
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    err("Supabase CDN ontbreekt. Check dat dashboard.html dit heeft: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    return;
  }

  try {
    // Maak client (of hergebruik)
    if (!window.supabaseClient) {
      window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      log("supabaseClient aangemaakt ✅");
    } else {
      log("supabaseClient bestond al ✅");
    }

    // Test call (zodat je meteen weet dat client werkt)
    window.supabaseClient.auth.getSession()
      .then(({ data, error }) => {
        if (error) err("getSession error:", error.message);
        const email = data?.session?.user?.email || "(geen sessie)";
        log("sessie:", email);
      })
      .catch((e) => err("getSession exception:", e));

    // Auth events
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      const email = session?.user?.email || "(geen sessie)";
      log("Auth event:", event, "user:", email);
    });

  } catch (e) {
    err("Config crash:", e);
  }
})();
