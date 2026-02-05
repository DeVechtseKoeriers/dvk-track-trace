// =====================================================
// DVK – Supabase Config
// Bestand: /public/js/supabase-config.js
// Vereist: Supabase CDN (@supabase/supabase-js v2)
// Maakt: window.supabaseClient beschikbaar
// =====================================================

// ⚠️ VUL HIER JE EIGEN WAARDEN IN
const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

// ----------------------------
// Veiligheidscheck
// ----------------------------
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("[DVK] Supabase URL of ANON KEY ontbreekt.");
}

// ----------------------------
// Client aanmaken (globaal)
// ----------------------------
window.supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  }
);

// ----------------------------
// Debug (handig tijdens bouwen)
// ----------------------------
(async () => {
  try {
    const { data } = await window.supabaseClient.auth.getSession();
    if (data?.session) {
      console.log("[DVK] Supabase sessie actief:", data.session.user.email);
    } else {
      console.log("[DVK] Geen actieve Supabase sessie");
    }
  } catch (e) {
    console.warn("[DVK] Supabase sessiecheck mislukt", e);
  }
})();
