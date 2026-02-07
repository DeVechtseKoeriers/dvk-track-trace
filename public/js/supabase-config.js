/* public/js/supabase-config.js
   - Maakt window.sb (Supabase client) aan
   - Werkt met Supabase CDN v2 (window.supabase)
   - Geeft duidelijke console logs en foutmeldingen
*/

(() => {
  // === VUL DIT IN (jouw Supabase Project) ===
  // Je kunt deze vinden in Supabase > Project Settings > API
  const SUPABASE_URL = window.DVK_SUPABASE_URL || "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = window.DVK_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  // Helper log
  const log = (...a) => console.log("[DVK][supabase-config]", ...a);
  const err = (...a) => console.error("[DVK][supabase-config]", ...a);

  // Controleer of Supabase CDN geladen is
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    err("Supabase CDN ontbreekt. Laad eerst: https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    window.sb = null;
    return;
  }

  // Controleer config
  if (!SUPABASE_URL || SUPABASE_URL.includes("VUL_HIER")) {
    err("SUPABASE_URL ontbreekt/placeholder. Vul SUPABASE_URL in supabase-config.js");
    window.sb = null;
    return;
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("VUL_HIER")) {
    err("SUPABASE_ANON_KEY ontbreekt/placeholder. Vul ANON KEY in supabase-config.js");
    window.sb = null;
    return;
  }

  // Maak client
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  window.sb = sb;                 // hoofd client
  window.supabaseClient = sb;     // compat (als oudere code dit verwacht)

  log("supabaseClient OK");

  // Debug sessie
  sb.auth.getSession().then(({ data, error }) => {
    if (error) err("getSession error:", error);
    log("sessie:", data?.session ? "actief" : "geen sessie");
  });

  // Auth events debug
  sb.auth.onAuthStateChange((event, session) => {
    log("Auth event:", event, "user:", session?.user?.email || "geen sessie");
  });
})();
