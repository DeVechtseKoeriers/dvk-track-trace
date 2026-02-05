// /public/js/supabase-config.js
(function () {
 const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";


  if (!window.supabase) {
    console.error("Supabase CDN niet geladen. Check <script src='https://cdn.jsdelivr...'>");
    return;
  }

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("supabase-config loaded —", SUPABASE_URL);
})();
