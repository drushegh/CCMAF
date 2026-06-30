/**
 * hub-page.ts — the Hub flyout window (TASK-043, DEC-028)
 *
 * The Hub UI as a small console-served page the tray opens as a compact chromeless
 * window (positioned near the system tray): running consoles with Open/End, known
 * projects with Start/Open, and settings inline — one panel, not a native menu and
 * not a full browser window.
 *
 * Served at `GET /hub`; polls `GET /api/hub/state`; actions POST to
 * `/api/hub/{open,end,start}` and settings PUT `/api/settings` (all write-guarded —
 * the per-launch token is embedded below, same trust model as the SPA + /settings).
 * Self-heals: if the console hosting this page is ended, it re-hosts on another.
 *
 * NB: the inline script uses string concatenation — NO template literals, NO
 * `${...}` (except the one intentional token injection) — so it never collides with
 * THIS file's own template literal. Keep it that way when editing.
 *
 * contract:console-http-api
 */

/** The Hub flyout HTML. `token` is the per-launch X-Console-Token (write-guard). */
export function renderHubPage(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Console Hub</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0b0f14; color: #e6edf3; padding: 14px 14px 16px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13.5px; line-height: 1.4;
  }
  header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  h1 { font-size: 15px; margin: 0; }
  .count { font-size: 12px; color: #6e7b8a; }
  h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: #6e7b8a; margin: 14px 0 6px; }
  .row {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 6px;
    background: #0d1117; border: 1px solid #1f2630; border-radius: 9px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot.on { background: #2ea043; } .dot.off { background: #3a4757; }
  .name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name .port { color: #6e7b8a; font-size: 12px; margin-left: 6px; font-variant-numeric: tabular-nums; }
  .btn {
    flex: none; padding: 4px 10px; border-radius: 7px; font: inherit; font-size: 12.5px;
    background: #1b2430; color: #e6edf3; border: 1px solid #2a3441; cursor: pointer;
  }
  .btn:hover { border-color: #3a4757; background: #222d3b; }
  .btn.primary { background: #1c3a6e; border-color: #2563eb; }
  .btn.primary:hover { background: #234a8a; }
  .btn.danger:hover { background: #5b2030; border-color: #b3344a; }
  .empty { color: #6e7b8a; font-size: 12.5px; padding: 4px 2px; }
  .sep { border-top: 1px solid #161b22; margin: 14px 0 0; }
  .pills { display: flex; gap: 6px; margin-bottom: 8px; }
  .pill {
    flex: 1 1 0; padding: 6px 4px; border-radius: 8px; font: inherit; font-size: 12.5px; cursor: pointer;
    background: #0d1117; color: #9aa7b4; border: 1px solid #1f2630; text-align: center;
  }
  .pill:hover { border-color: #2a3441; color: #e6edf3; }
  .pill.active { border-color: #2563eb; background: #11203a; color: #e6edf3; }
  .custompath { display: none; margin-bottom: 8px; }
  .custompath.show { display: block; }
  .custompath input {
    width: 100%; padding: 7px 9px; border-radius: 8px; background: #0d1117;
    border: 1px solid #1f2630; color: #e6edf3; font: inherit;
  }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; cursor: pointer; }
  .switch + .switch { border-top: 1px solid #161b22; }
  .switch .t { font-size: 13.5px; }
  .switch .d { font-size: 11.5px; color: #6e7b8a; }
  .switch input { position: absolute; opacity: 0; pointer-events: none; }
  .track { width: 38px; height: 21px; border-radius: 999px; background: #2a3441; position: relative; flex: none; transition: background .15s; }
  .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 17px; height: 17px; border-radius: 50%; background: #9aa7b4; transition: transform .15s, background .15s; }
  .switch input:checked ~ .track { background: #2563eb; }
  .switch input:checked ~ .track::after { transform: translateX(17px); background: #fff; }
  .toast {
    position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%) translateY(14px);
    background: #1f6f43; color: #fff; padding: 6px 14px; border-radius: 8px; font-size: 12.5px;
    opacity: 0; transition: opacity .18s, transform .18s; pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .footer { margin-top: 16px; padding-top: 12px; border-top: 1px solid #161b22; text-align: center; }
  .quit {
    padding: 7px 16px; border-radius: 8px; font: inherit; font-size: 12.5px; cursor: pointer;
    background: transparent; color: #9aa7b4; border: 1px solid #2a3441;
  }
  .quit:hover { color: #fff; background: #5b2030; border-color: #b3344a; }
</style>
</head>
<body>
  <header><h1>Console Hub</h1><span class="count" id="count"></span></header>
  <div id="running"></div>
  <div id="stoppedwrap" hidden><h2>Start a project</h2><div id="stopped"></div></div>

  <div class="sep"></div>
  <h2>Open with</h2>
  <div class="pills" id="openmode">
    <button class="pill" data-mode="default" type="button">Default</button>
    <button class="pill" data-mode="app" type="button">App window</button>
    <button class="pill" data-mode="custom" type="button">Custom</button>
  </div>
  <div class="custompath" id="custompath"><input id="custombrowser" type="text" placeholder="C:\\Path\\to\\browser.exe" spellcheck="false" /></div>
  <label class="switch"><span><span class="t">Tabbed shell window</span><br/><span class="d">One window, a tab per console</span></span><input type="checkbox" id="tabbed" /><span class="track"></span></label>
  <label class="switch"><span><span class="t">Auto-open on start</span><br/><span class="d">Open the cockpit when a console starts</span></span><input type="checkbox" id="autoopen" /><span class="track"></span></label>

  <div class="footer"><button class="quit" id="quit" type="button">Quit Hub</button></div>

  <div class="toast" id="toast">Saved</div>
<script>
(function () {
  var TOKEN = '${token}';
  var SELF = Number(location.port) || 0;
  var runningEl = document.getElementById('running');
  var stoppedEl = document.getElementById('stopped');
  var stoppedWrap = document.getElementById('stoppedwrap');
  var countEl = document.getElementById('count');
  var modeBtns = document.querySelectorAll('#openmode .pill');
  var customWrap = document.getElementById('custompath');
  var customInput = document.getElementById('custombrowser');
  var tabbed = document.getElementById('tabbed');
  var autoopen = document.getElementById('autoopen');
  var toast = document.getElementById('toast');
  var toastTimer;
  var editingSettings = false;

  function flash() {
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1000);
  }
  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': TOKEN },
      body: JSON.stringify(body || {})
    });
  }
  function putSettings(patch) {
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-console-token': TOKEN },
      body: JSON.stringify(patch)
    }).then(function (r) { if (r.ok) flash(); });
  }

  function mkBtn(label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'btn' + (cls ? ' ' + cls : '');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function runningRow(c) {
    var row = document.createElement('div'); row.className = 'row';
    var dot = document.createElement('span'); dot.className = 'dot on';
    var name = document.createElement('span'); name.className = 'name';
    name.title = c.rootPath;
    name.appendChild(document.createTextNode(c.project));
    var port = document.createElement('span'); port.className = 'port'; port.textContent = ':' + c.port;
    name.appendChild(port);
    row.appendChild(dot); row.appendChild(name);
    row.appendChild(mkBtn('Open', 'primary', function () { post('/api/hub/open', { port: c.port }); }));
    row.appendChild(mkBtn('End', 'danger', function () { post('/api/hub/end', { port: c.port }).then(refresh); }));
    return row;
  }
  function stoppedRow(s) {
    var row = document.createElement('div'); row.className = 'row';
    var dot = document.createElement('span'); dot.className = 'dot off';
    var name = document.createElement('span'); name.className = 'name';
    name.title = s.rootPath; name.textContent = s.project;
    row.appendChild(dot); row.appendChild(name);
    row.appendChild(mkBtn('Start', '', function () { post('/api/hub/start', { root: s.rootPath }).then(refresh); }));
    row.appendChild(mkBtn('Open', 'primary', function () { post('/api/hub/open', { root: s.rootPath }).then(refresh); }));
    return row;
  }

  function setMode(mode) {
    for (var i = 0; i < modeBtns.length; i++) {
      modeBtns[i].classList.toggle('active', modeBtns[i].getAttribute('data-mode') === mode);
    }
    customWrap.classList.toggle('show', mode === 'custom');
  }

  function render(state) {
    var running = state.running || [];
    var stopped = state.stopped || [];

    // Self-heal: this page's host console is gone → re-host on another.
    var live = {}; for (var i = 0; i < running.length; i++) live[running[i].port] = true;
    if (SELF && !live[SELF] && running.length) { location.href = 'http://127.0.0.1:' + running[0].port + '/hub'; return; }

    countEl.textContent = running.length + (running.length === 1 ? ' console' : ' consoles');
    runningEl.innerHTML = '';
    if (running.length) { for (var j = 0; j < running.length; j++) runningEl.appendChild(runningRow(running[j])); }
    else { var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No consoles running.'; runningEl.appendChild(e); }

    stoppedWrap.hidden = stopped.length === 0;
    stoppedEl.innerHTML = '';
    for (var k = 0; k < stopped.length; k++) stoppedEl.appendChild(stoppedRow(stopped[k]));

    // Don't stomp the settings controls while the user is interacting with them.
    if (!editingSettings && state.settings) {
      setMode(state.settings.openMode);
      if (state.settings.customBrowser && document.activeElement !== customInput) customInput.value = state.settings.customBrowser;
      tabbed.checked = (state.settings.windowStyle === 'tabbed');
      autoopen.checked = !!state.settings.autoOpenOnStart;
    }
  }

  function refresh() {
    return fetch('/api/hub/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) { if (s) render(s); })
      .catch(function () {});
  }

  for (var i = 0; i < modeBtns.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-mode');
        setMode(mode);
        var patch = { openMode: mode };
        if (mode === 'custom' && customInput.value) patch.customBrowser = customInput.value;
        putSettings(patch);
        if (mode === 'custom') customInput.focus();
      });
    })(modeBtns[i]);
  }
  customInput.addEventListener('focus', function () { editingSettings = true; });
  customInput.addEventListener('blur', function () { editingSettings = false; });
  customInput.addEventListener('change', function () { putSettings({ openMode: 'custom', customBrowser: customInput.value }); });
  tabbed.addEventListener('change', function () { putSettings({ windowStyle: tabbed.checked ? 'tabbed' : 'single' }); });
  autoopen.addEventListener('change', function () { putSettings({ autoOpenOnStart: autoopen.checked }); });

  document.getElementById('quit').addEventListener('click', function () {
    post('/api/hub/quit').then(function () {
      document.body.innerHTML = '<p style="color:#6e7b8a;font:13px ui-sans-serif,system-ui;text-align:center;margin-top:40px">Hub stopped. You can close this window.</p>';
      window.close(); // best-effort (app windows may block it)
    });
  });

  refresh();
  setInterval(refresh, 2500);
})();
</script>
</body>
</html>`;
}
