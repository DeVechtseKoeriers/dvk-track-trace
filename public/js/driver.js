const sb = window.supabaseClient;

document.addEventListener("DOMContentLoaded", () => {
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const btn = document.getElementById("loginBtn");

  if (!emailEl || !passEl || !btn) {
    console.error("Login elements not found");
    return;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Inloggen…";

    const { data, error } = await sb.auth.signInWithPassword({
      email: emailEl.value.trim(),
      password: passEl.value,
    });

    if (error) {
      alert("Inloggen mislukt: " + error.message);
      btn.disabled = false;
      btn.textContent = "Inloggen";
      return;
    }

    // Succes
    window.location.href =
      "/dvk-track-trace/driver/dashboard.html";
  });
});
