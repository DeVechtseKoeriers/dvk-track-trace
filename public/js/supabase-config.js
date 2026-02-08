/* public/js/supabase-config.js */
(() => {
  // === VUL DIT IN ===
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII”;

  function log(...args) { console.log("[DVK]", ...args); }

  // Supabase CDN moet geladen zijn: window.supabase
  if (!window.supabase || !window.supabase.createClient) {
    console.error("[DVK] Supabase CDN ontbreekt. Check <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'>");
    return;
  }

  // Maak client (één keer)
  if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    log("supabaseClient OK");
  } else {
    log("supabaseClient bestond al");
  }

  // Kleine helper om sessie te loggen
  window.dvkAuthDebug = async function () {
    try {
      const { data } = await window.supabaseClient.auth.getSession();
      const email = data?.session?.user?.email || "(geen sessie)";
      log("Supabase sessie actief:", email);
      return data?.session || null;
    } catch (e) {
      console.error("[DVK] auth debug error:", e);
      return null;
    }
  };

  // Log auth events
  window.supabaseClient.auth.onAuthStateChange((event, session) => {
    const email = session?.user?.email || "(geen sessie)";
    log("Auth event:", event, "user:", email);
  });
})();
