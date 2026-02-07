/* public/js/supabase-config.js
   Maakt altijd window.sb (Supabase client) + debug logs.
   Vereist: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
*/

(() => {
  const log = (...a) => console.log("[DVK]", ...a);

  // ==== VUL DIT IN ====
  // Zet hier jouw Supabase Project URL en ANON key:
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";
  // ====================

  try {
    if (!window.supabase) {
      log("Supabase CDN ontbreekt. Voeg supabase-js@2 script toe.");
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes("YOURPROJECT")) {
      log("Supabase-config niet ingevuld: SUPABASE_URL/ANON_KEY.");
      return;
    }

    window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    log("supabaseClient OK");

    // Handige sessie logs
    window.sb.auth.getSession().then(({ data, error }) => {
      if (error) log("getSession error:", error.message);
      else log("Supabase sessie actief:", data?.session?.user?.email ?? "(geen sessie)");
    });

    window.sb.auth.onAuthStateChange((event, session) => {
      log("Auth event:", event, "user:", session?.user?.email ?? "(geen sessie)");
    });
  } catch (e) {
    console.error("[DVK] supabase-config crash:", e);
  }
})();
