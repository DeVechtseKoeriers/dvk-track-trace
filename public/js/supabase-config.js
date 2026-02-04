// public/js/supabase-config.js
// Maakt: window.supabaseClient (zodat track.js en dashboard.js dezelfde client kunnen gebruiken)

(() => {
  // VUL IN (die heb jij al)
  const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase JS library ontbreekt. Laadt @supabase/supabase-js@2 wel?");
    return;
  }

  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  console.log("✅ supabase-config loaded —", SUPABASE_URL);
})();
