<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chauffeur dashboard | DVK</title>

  <!-- BELANGRIJK: stylesheet pad voor GitHub Pages -->
  <link rel="stylesheet" href="/dvk-track-trace/public/css/style.css" />

  <!-- Fallback styling (zorgt dat het altijd netjes is, ook als style.css faalt) -->
  <style>
    body { margin:0; background:#0b1220; color:rgba(255,255,255,.92); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
    .container { max-width:980px; margin:28px auto; padding:0 16px; }
    .topbar { display:flex; align-items:center; gap:16px; padding:14px 16px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:14px; }
    .brand strong { display:block; font-size:16px; }
    .brand span { display:block; opacity:.7; font-size:13px; margin-top:2px; }
    .topbar-right { margin-left:auto; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .btn { background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); color:rgba(255,255,255,.92); padding:10px 12px; border-radius:10px; cursor:pointer; }
    .btn:hover { background:rgba(255,255,255,.10); }
    .card { margin-top:14px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:16px; }
    .h1 { margin:0; font-size:32px; }
    .small { margin:6px 0 0; opacity:.75; }
    .sep { height:1px; background:rgba(255,255,255,.08); margin:14px 0; }
    .muted { opacity:.7; font-size:13px; }

    /* grid en cards */
    .grid { display:grid; gap:12px; margin-top:14px; }
    .ship-card { background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:14px; }
    .row { display:flex; gap:10px; align-items:flex-start; }
    .ship-code { font-weight:700; }
    .badge { padding:6px 10px; border-radius:999px; font-size:12px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.06); }
    .b-created { background:rgba(59,130,246,.18); }
    .b-en_route { background:rgba(245,158,11,.18); }
    .b-delivered { background:rgba(34,197,94,.18); }
    .b-problem { background:rgba(239,68,68,.18); }

    /* events */
    .events { margin-top:10px; padding-left:6px; }
    .event-row { display:flex; gap:10px; margin-top:10px; }
    .event-dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.55); margin-top:6px; flex:0 0 auto; }
    .event-title { font-weight:600; }
    .event-note { margin-top:2px; }
    .event-dt { margin-top:2px; }

    /* skeleton */
    #skeletons { display:none; }
    .skeleton .sk-line { height:10px; background:rgba(255,255,255,.06); border-radius:999px; margin:10px 0; }
    .w40 { width:40%; } .w60 { width:60%; } .w50 { width:50%; }
    .sk-chiprow { display:flex; gap:8px; margin-top:10px; }
    .sk-chip { height:22px; border-radius:999px; background:rgba(255,255,255,.06); }
    .w30 { width:30%; }
  </style>
</head>

<body>
  <div class="container">
    <div class="topbar">
      <div class="brand">
        <strong>De Vechtse Koeriers</strong>
        <span>Chauffeursportaal</span>
      </div>

      <div class="topbar-right">
        <span class="muted" id="whoami">...</span>
        <button class="btn" id="logoutBtn">Uitloggen</button>
      </div>
    </div>

    <div class="card">
      <h1 class="h1">Dashboard</h1>
      <p class="small">Jouw zendingen + status-events</p>

      <div class="sep"></div>

      <div id="status" class="muted">Laden…</div>

      <div id="list" class="grid"></div>

      <!-- Skeletons -->
      <div id="skeletons" class="grid" aria-hidden="true">
        <div class="ship-card skeleton">
          <div class="sk-line w40"></div>
          <div class="sk-line w60"></div>
          <div class="sk-line w50"></div>
          <div class="sk-chiprow">
            <div class="sk-chip w30"></div>
            <div class="sk-chip w40"></div>
          </div>
        </div>
        <div class="ship-card skeleton">
          <div class="sk-line w40"></div>
          <div class="sk-line w60"></div>
          <div class="sk-line w50"></div>
          <div class="sk-chiprow">
            <div class="sk-chip w30"></div>
            <div class="sk-chip w40"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Supabase -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

  <!-- Let op: absolute paden i.v.m. GitHub Pages -->
  <script src="/dvk-track-trace/public/js/supabase-config.js"></script>
  <script src="/dvk-track-trace/public/js/dashboard.js"></script>
</body>
</html>
