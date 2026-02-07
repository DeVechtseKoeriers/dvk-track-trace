/* public/js/supabase-config.js
   DVK – Supabase bootstrap (works on GitHub Pages)
   - maakt window.supabaseClient aan
   - logt sessie in console
   - biedt helpers: dvkGetUser(), dvkRequireAuth()
*/

(() => {
  // =========================
  // 1) VUL DIT IN (Supabase)
  // =========================
  // Haal uit Supabase: Project Settings → API
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  // Optioneel: als je realtime issues had kun je schema expliciet laten staan
  const DEFAULT_SCHEMA = "public";

  // =========================
  // 2) VALIDATIE / FAIL FAST
  // =========================
  function fail(msg) {
    console.error("[DVK] " + msg);
    // Zorg dat andere scripts dit ook zien
    window.supabaseClient = null;
  }

  // supabase-js via CDN moet geladen zijn vóór dit script
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    fail("Supabase CDN ontbreekt. Zet in je HTML eerst: <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script>");
    return;
  }

  if (!SUPABASE_URL || SUPABASE_URL.includes("JOUWPROJECT")) {
    fail("SUPABASE_URL niet ingevuld in public/js/supabase-config.js");
    return;
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("JOUW_ANON_KEY")) {
    fail("SUPABASE_ANON_KEY niet ingevuld in public/js/supabase-config.js");
    return;
  }

  // =========================
  // 3) CLIENT MAKEN
  // =========================
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: DEFAULT_SCHEMA },
    auth: {
      // Belangrijk voor GitHub Pages:
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "dvk_supabase_auth",
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  window.supabaseClient = sb;

  // =========================
  // 4) HELPERS
  // =========================
  window.dvkGetUser = async function dvkGetUser() {
    const { data, error } = await sb.auth.getUser();
    if (error) return { user: null, error };
    return { user: data?.user ?? null, error: null };
  };

  window.dvkRequireAuth = async function dvkRequireAuth(redirectTo) {
    const { user, error } = await window.dvkGetUser();
    if (error || !user) {
      if (redirectTo) window.location.href = redirectTo;
      return null;
    }
    return user;
  };

  // =========================
  // 5) DEBUG LOGS
  // =========================
  sb.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.warn("[DVK] getSession error:", error.message);
      return;
    }
    const email = data?.session?.user?.email || "(geen sessie)";
    console.log("[DVK] Supabase sessie actief:", email);
  });

  sb.auth.onAuthStateChange((event, session) => {
    const email = session?.user?.email || "(geen sessie)";
    console.log("[DVK] Auth event:", event, "user:", email);
  });

  console.log("[DVK] supabaseClient OK");
})();
