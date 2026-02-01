document.addEventListener("DOMContentLoaded", () => {
  const sb = window.supabaseClient;

  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const btn = document.getElementById("loginBtn");

  if (!sb) {
    console.error("supabaseClient ontbreekt. Controleer supabase-config.js en script-volgorde.");
    return;
  }
  if (!emailEl || !passEl || !btn) {
    console.error("Login elementen niet gevonden (email/password/loginBtn).");
    return;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Inloggen...";

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: emailEl.value.trim(),
        password: passEl.value
      });

      if (error) throw error;

      // Succes -> doorsturen
      window.location.href = "./dashboard.html";
    } catch (e) {
      alert("Inloggen mislukt: " + (e?.message || e));
      btn.disabled = false;
      btn.textContent = old;
    }
  });
});
