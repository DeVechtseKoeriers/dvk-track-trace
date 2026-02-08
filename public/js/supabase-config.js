/* public/js/supabase-config.js
   DVK – Supabase config (CDN @supabase/supabase-js@2)
   Zorgt voor window.supabaseClient, en wat debug logging.
*/
(function () {
  try {
    const SUPABASE_URL =
      window.SUPABASE_URL ||
      "https://gvgdeymqqmuoaexkhdta.supabase.co"; // <-- VUL IN

    const SUPABASE_ANON_KEY =
      window.SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII"; // <-- VUL IN

    if (!window.supabase || !window.supabase.createClient) {
      console.error("[DVK] Supabase CDN ontbreekt. Check <script src=...supabase-js@2>");
      return;
    }

    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });

    console.log("[DVK] supabaseClient OK");

    // Debug sessie
    window.supabaseClient.auth.getSession().then(({ data }) => {
      const email = data?.session?.user?.email || "geen sessie";
      console.log("[DVK] Supabase sessie actief:", email);
    });

    // Auth events (debug)
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      console.log("[DVK] Auth event:", event, "user:", session?.user?.email || "geen sessie");
    });
  } catch (e) {
    console.error("[DVK] supabase-config.js crash:", e);
  }
})();
