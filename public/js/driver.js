// =====================================================
// DVK – Chauffeur Login
// Bestand: /public/js/driver.js
// Vereist: window.supabaseClient (uit supabase-config.js)
// Gebruikt in: /driver/login.html
// =====================================================

(function () {
  const sb = window.supabaseClient;
  if (!sb) {
    console.error("[DVK] Supabase client ontbreekt. Check supabase-config.js");
    return;
  }

  const $ = (id) => document.getElementById(id);

  const form = $("loginForm");
  const emailEl = $("email");
  const passEl = $("password");
  const btnEl = $("loginBtn");
  const msgEl = $("msg");

  // GitHub Pages project-site base path (bv. /dvk-track-trace)
  function basePath() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length ? "/" + parts[0] : "";
  }

  function to(path) {
    return location.origin + basePath() + path;
  }

  function showMsg(text, type = "ok") {
    if (!msgEl) return;
    msgEl.style.display = "block";
    msgEl.textContent = text || "";
    msgEl.className = "msg " + (type === "bad" ? "bad" : type === "warn" ? "warn" : "ok");
  }

  function hideMsg() {
    if (!msgEl) return;
    msgEl.style.display = "none";
    msgEl.textContent = "";
    msgEl.className = "msg";
  }

  function setDisabled(disabled) {
    if (btnEl) btnEl.disabled = disabled;
    if (emailEl) emailEl.disabled = disabled;
    if (passEl) passEl.disabled = disabled;
  }

  async function redirectIfLoggedIn() {
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      if (data?.session) {
        location.href = to("/driver/dashboard.html");
      }
    } catch (e) {
      console.error("[DVK] Session check error", e);
      // geen harde actie; user kan nog gewoon inloggen
    }
  }

  async function doLogin(email, password) {
    showMsg("Bezig met inloggen…", "warn");
    setDisabled(true);

    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;

      if (data?.session) {
        showMsg("Ingelogd ✅", "ok");
        location.href = to("/driver/dashboard.html");
      } else {
        showMsg("Inloggen gelukt maar geen sessie ontvangen.", "bad");
      }
    } catch (e) {
      console.error("[DVK] Login error", e);

      // Meer behulpzame foutmelding
      const msg =
        (e?.message || "").toLowerCase().includes("invalid login credentials")
          ? "Onjuiste e-mail of wachtwoord."
          : "Inloggen mislukt. Check Supabase URL/Key en Auth instellingen.";

      showMsg(msg, "bad");
    } finally {
      setDisabled(false);
    }
  }

  // Wire up
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      hideMsg();

      const email = (emailEl?.value || "").trim();
      const password = passEl?.value || "";

      if (!email || !password) {
        showMsg("Vul e-mail en wachtwoord in.", "warn");
        return;
      }

      doLogin(email, password);
    });
  } else {
    console.warn("[DVK] loginForm niet gevonden. Check driver/login.html id's.");
  }

  // Init
  redirectIfLoggedIn();
})();
