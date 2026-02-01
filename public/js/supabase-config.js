// dvk-track-trace/public/js/supabase-config.js

// 1) Vul deze 2 waarden in (exact vanuit Supabase -> Project Settings -> API)
const SUPABASE_URL = "https://gvgdeymqqmuoaexkhdta.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Z2RleW1xcW11b2FleGtoZHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5Mjk0NTksImV4cCI6MjA4NTUwNTQ1OX0.sN86Xgzc2l_vevR8SWU9KJ7Q6HTKZxrUp1bTyCNNkII";

// 2) Client beschikbaar maken voor andere scripts
window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Debug (mag blijven)
console.log("✅ supabase-config loaded", SUPABASE_URL);
