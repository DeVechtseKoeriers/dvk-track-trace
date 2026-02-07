/* public/js/supabase-config.js */

(() => {
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";
  const DEFAULT_SCHEMA = "public";

  function fail(msg) {
    console.error("[DVK] " + msg);
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    fail("Supabase CDN ontbreekt. Zet eerst: <script src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'></script>");
    return;
  }
  if (!SUPABASE_URL || SUPABASE_URL.includes("JOUWPROJECT")) {
    fail("SUPABASE_URL niet ingevuld");
    return;
  }
  if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("JOUW_ANON_KEY")) {
    fail("SUPABASE_ANON_KEY niet ingevuld");
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: DEFAULT_SCHEMA },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "dvk_supabase_auth",
    },
    realtime: { params: { eventsPerSecond: 10 } },
  });

  // ✅ Belangrijk: expose ALLE namen die je scripts kunnen verwachten
  window.supabaseClient = sb;
  window.sb = sb;                 // <— track.js gebruikt vaak "sb"
  window.dvkSupabase = sb;        // <— extra veilige alias

  window.dvkGetUser = async function () {
    const { data, error } = await sb.auth.getUser();
    if (error) return { user: null, error };
    return { user: data?.user ?? null, error: null };
  };

  sb.auth.getSession().then(({ data, error }) => {
    if (error) return console.warn("[DVK] getSession error:", error.message);
    const email = data?.session?.user?.email || "(geen sessie)";
    console.log("[DVK] Supabase sessie actief:", email);
  });

  sb.auth.onAuthStateChange((event, session) => {
    const email = session?.user?.email || "(geen sessie)";
    console.log("[DVK] Auth event:", event, "user:", email);
  });

  console.log("[DVK] supabaseClient OK");
})();
