/* public/js/supabase-config.js
   - Maakt 1 globale client aan: window.sb
   - Logging voor debug
   - Werkt met CDN (@supabase/supabase-js@2)
*/

(() => {
  // ✅ VUL DEZE 2 IN (Supabase → Project Settings → API)
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  function log(...args) { console.log("[DVK]", ...args); }
  function warn(...args) { console.warn("[DVK]", ...args); }
  function err(...args) { console.error("[DVK]", ...args); }

  // Controle: CDN geladen?
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    err("Supabase CDN ontbreekt. Check script tag naar @supabase/supabase-js@2");
    window.sb = null;
    return;
  }

  // Controle: keys ingevuld?
  if (!SUPABASE_URL || SUPABASE_URL.includes("VUL_HIER") || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("VUL_HIER")) {
    err("SUPABASE_URL / SUPABASE_ANON_KEY niet ingevuld in public/js/supabase-config.js");
    window.sb = null;
    return;
  }

  // Client aanmaken (persist sessie zodat dashboard login blijft)
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "dvk-auth",
    },
  });

  window.sb = sb;

  log("supabaseClient OK");

  // Handige auth logging
  sb.auth.getSession().then(({ data }) => {
    const email = data?.session?.user?.email || "geen sessie";
    log("Supabase sessie actief:", email);
  }).catch(() => {});

  sb.auth.onAuthStateChange((event, session) => {
    const email = session?.user?.email || "geen sessie";
    log("Auth event:", event, "user:", email);
  });

})();
