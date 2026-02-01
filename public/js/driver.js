const supabase = window.supabaseClient;
  window.DVK_SUPABASE_URL,
  window.DVK_SUPABASE_ANON_KEY
);

async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

document.addEventListener("DOMContentLoaded", () => {
  const emailEl = document.querySelector("input[placeholder='E-mail']");
  const passEl = document.querySelector("input[type='password']");
  const btn = document.querySelector("button");

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Inloggen...";
    try {
      await signIn(emailEl.value.trim(), passEl.value);
      // straks dashboard data echt laden; voor nu doorsturen
      location.href = "/driver/dashboard.html";
    } catch (e) {
      alert("Login mislukt: " + (e?.message || "Onbekende fout"));
    } finally {
      btn.disabled = false;
      btn.textContent = "Inloggen";
    }
  });
});
