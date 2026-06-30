/**
 * shell-page.ts — the chromeless tabbed shell (TASK-041, DEC-025)
 *
 * One window, a tab + iframe per running console. The Hub opens this page as a
 * single chromeless `--app` window when `windowStyle:"tabbed"` (settings.ts), so
 * N projects present as N tabs in ONE window instead of N separate windows — the
 * Harvey embedded-window in miniature.
 *
 * The page is served by a CONSOLE server (`GET /shell`) and polls that server's
 * `GET /api/registry` (the machine-global registry, secrets stripped) to build
 * its tabs. Each tab iframes `http://127.0.0.1:<port>/`; the consoles allow being
 * framed via their `frame-ancestors` header, and this page's CSP allows framing
 * them via `frame-src` (set on the route).
 *
 * Self-healing: the shell is hosted by ONE console. If that console is ended, the
 * page re-hosts itself on another live console (`location.href → .../shell`), so
 * the tabbed window survives the death of whichever console happened to serve it.
 *
 * contract:console-http-api, contract:console-tray-hub
 */

import type { RegistryEntry } from "../hub/registry.js";

/** Browser-safe view of a registry entry — NO secrets (shutdownToken/pid). */
export interface ShellConsole {
  project: string;
  port: number;
  rootPath: string;
}

/**
 * Project the registry to what the shell page needs, dropping the shutdownToken
 * (and pid/version/etc) — a browser page must never see the shutdown secret.
 * Sorted by port so tab order is stable.
 */
export function toShellConsoles(entries: RegistryEntry[]): ShellConsole[] {
  return entries
    .map((e) => ({ project: e.project, port: e.port, rootPath: e.rootPath }))
    .sort((a, b) => a.port - b.port);
}

/**
 * The full shell HTML (self-contained: inline CSS + vanilla JS, no bundle).
 *
 * NB: the inline script deliberately uses string concatenation — NO template
 * literals and NO `${...}` — so it never collides with THIS file's own template
 * literal interpolation. Keep it that way when editing.
 */
export function renderShellPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Project Console — Shell</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    background: #0b0f14; color: #e6edf3;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column;
  }
  #bar {
    display: flex; gap: 4px; align-items: center;
    padding: 6px 8px; height: 38px; box-sizing: border-box;
    background: #0d1117; border-bottom: 1px solid #1f2630;
    overflow-x: auto; flex: none;
  }
  .tab {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-radius: 8px 8px 0 0;
    background: transparent; color: #9aa7b4;
    border: 1px solid transparent; border-bottom: none;
    font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
    white-space: nowrap;
  }
  .tab:hover { background: #161b22; color: #e6edf3; }
  .tab.active { background: #0b0f14; color: #e6edf3; border-color: #1f2630; }
  .tab .dot { width: 8px; height: 8px; border-radius: 50%; background: #2ea043; flex: none; }
  .tab .port { color: #6e7b8a; font-size: 12px; font-variant-numeric: tabular-nums; }
  #stage { position: relative; flex: 1 1 auto; }
  .frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  #empty {
    position: absolute; inset: 0; display: none;
    align-items: center; justify-content: center;
    color: #6e7b8a; font-size: 14px;
  }
</style>
</head>
<body>
  <div id="bar" role="tablist" aria-label="Open consoles"></div>
  <div id="stage"><div id="empty">No consoles running</div></div>
<script>
(function () {
  var API = '/api/registry';
  var SELF = Number(location.port) || 0;
  var active = Number(new URLSearchParams(location.search).get('active')) || 0;
  var bar = document.getElementById('bar');
  var stage = document.getElementById('stage');
  var empty = document.getElementById('empty');
  var tabs = {}; // port -> { tab, frame }

  function activate(port) {
    active = port;
    for (var p in tabs) {
      var on = (Number(p) === port);
      tabs[p].tab.classList.toggle('active', on);
      tabs[p].tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[p].frame.style.display = on ? 'block' : 'none';
    }
  }

  function makeTab(c) {
    var tab = document.createElement('button');
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.title = c.rootPath;
    var dot = document.createElement('span'); dot.className = 'dot';
    var label = document.createElement('span'); label.className = 'label'; label.textContent = c.project;
    var port = document.createElement('span'); port.className = 'port'; port.textContent = ':' + c.port;
    tab.appendChild(dot); tab.appendChild(label); tab.appendChild(port);
    tab.addEventListener('click', function () { activate(c.port); });
    var frame = document.createElement('iframe');
    frame.className = 'frame';
    frame.title = c.project;
    frame.src = 'http://127.0.0.1:' + c.port + '/';
    frame.style.display = 'none';
    bar.appendChild(tab);
    stage.appendChild(frame);
    tabs[c.port] = { tab: tab, frame: frame };
  }

  function render(list) {
    var live = {};
    for (var i = 0; i < list.length; i++) { live[list[i].port] = true; }

    // Self-heal: the console hosting THIS page is gone → re-host elsewhere.
    if (SELF && !live[SELF] && list.length) {
      location.href = 'http://127.0.0.1:' + list[0].port + '/shell' + (active ? ('?active=' + active) : '');
      return;
    }

    // Drop tabs for consoles that vanished.
    for (var p in tabs) {
      if (!live[p]) { tabs[p].tab.remove(); tabs[p].frame.remove(); delete tabs[p]; }
    }

    // Add new consoles + keep the tab strip in port order (list is sorted).
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (!tabs[c.port]) { makeTab(c); }
      else { tabs[c.port].tab.querySelector('.label').textContent = c.project; }
      bar.appendChild(tabs[c.port].tab); // re-append → enforce order
    }

    var any = list.length > 0;
    empty.style.display = any ? 'none' : 'flex';
    bar.style.display = any ? 'flex' : 'none';
    if (any) {
      if (!active || !live[active]) active = list[0].port;
      activate(active);
    }
  }

  function poll() {
    fetch(API, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) { if (list) render(list); })
      .catch(function () { /* transient — next tick retries */ });
  }
  poll();
  setInterval(poll, 3000);
})();
</script>
</body>
</html>`;
}
