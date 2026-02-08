// public/js/supabase-config.js
// Centrale Supabase client + debug logging

(function () {
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  function log(...args) {
    console.log("[DVK]", ...args);
  }

  if (!window.supabase) {
    console.error("[DVK] Supabase CDN ontbreekt. Voeg toe: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    return;
  }

  try {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    log("supabaseClient OK");

    // Debug: sessie veranderingen
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      log("Auth event:", event, "user:", session?.user?.email || "(geen sessie)");
    });

    // Debug: huidige sessie
    window.supabaseClient.auth.getSession().then(({ data }) => {
      log("Supabase sessie actief:", data?.session?.user?.email || "(geen sessie)");
    });
  } catch (e) {
    console.error("[DVK] Kon supabaseClient niet maken:", e);
  }
})();
