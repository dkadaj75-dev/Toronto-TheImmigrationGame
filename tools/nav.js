// tools/nav.js — shared tool navigation strip (PROJECT_CONTEXT.md §7.4).
//
// Plain classic script (no `type="module"`) so it can be dropped into any tool
// page or the game with one <script src="..."> line. This file is the single
// source of truth for the tool list — add new tools here only, nowhere else.
//
// Rendering:
//  - Tool pages (tools/*.html): a slim, non-sticky row inserted as the very
//    first child of <body>. It sits in normal document flow above each page's
//    own sticky header, so it never fights the header's own `position: sticky;
//    top: 0` — the strip simply scrolls away first, exactly like a second
//    toolbar row would. (assets.html/interactions.html hardcode
//    `#layout { height: calc(100vh - 53px) }`; this file adds a scoped
//    override that also subtracts the strip's height so nothing overflows.)
//  - The game (index.html): a top strip would collide with the HUD's
//    top-left/top-right need+skill panels and the top-center clock/quest
//    toasts (see game/ui.ts), so instead this renders a small fixed
//    collapsible gear button in the bottom-right corner (above #devbar,
//    clear of the bottom-center action menu and bottom-left quest panel).
//
// Guarded to no-op safely if document/body aren't available (e.g. under
// jsdom tool tests, which by default never even fetch an external
// <script src>, so this file typically isn't executed there at all).
(function () {
  'use strict';
  try {
    if (typeof document === 'undefined') return;
    // Idempotent: a page that (accidentally) includes this twice, or a test
    // harness that re-runs init, must not double-inject.
    if (document.getElementById('condo-toolnav') || document.getElementById('condo-toolnav-corner')) return;

    var TOOLS = [
      { id: 'game', label: 'Game', href: '/index.html' },
      { id: 'assets', label: 'Assets', href: '/tools/assets.html' },
      { id: 'interactions', label: 'Interactions', href: '/tools/interactions.html' },
      { id: 'tuning', label: 'Tuning', href: '/tools/tuning.html' },
      { id: 'map', label: 'Map', href: '/tools/map.html' },
      { id: 'animations', label: 'Animations', href: '/tools/animations.html' },
      { id: 'quests', label: 'Quests', href: '/tools/quests.html' },
      { id: 'career', label: 'Career', href: '/tools/career.html' },
      { id: 'finance', label: 'Finance', href: '/tools/finance.html' },
      { id: 'behavior', label: 'Behavior', href: '/tools/behavior.html' },
      { id: 'theme', label: 'Theme', href: '/tools/theme.html' },
    ];

    function currentToolId() {
      var path = (typeof location !== 'undefined' && location.pathname) || '/';
      if (path === '' || path === '/' || /\/index\.html$/.test(path)) return 'game';
      for (var i = 0; i < TOOLS.length; i++) {
        var file = TOOLS[i].href.slice(TOOLS[i].href.lastIndexOf('/') + 1);
        if (path.indexOf('/' + file) !== -1) return TOOLS[i].id;
      }
      return null; // unknown page — still render the nav, just nothing highlighted
    }

    function injectStyle() {
      if (document.getElementById('condo-toolnav-style')) return;
      var css =
        '#condo-toolnav{display:flex;align-items:center;gap:2px;height:32px;padding:0 10px;' +
        'background:#0f1420;border-bottom:1px solid #26304a;font:12px/1 system-ui,-apple-system,sans-serif;' +
        'color:#93a3c0;overflow-x:auto;white-space:nowrap;box-sizing:border-box;}' +
        '#condo-toolnav .ctn-brand{font-weight:600;color:#dfe6f2;margin-right:12px;font-size:12px;' +
        'letter-spacing:.02em;flex-shrink:0;}' +
        '#condo-toolnav a{color:#93a3c0;text-decoration:none;padding:6px 10px;border-radius:6px;' +
        'font-size:12px;flex-shrink:0;}' +
        '#condo-toolnav a:hover{background:#1c2436;color:#dfe6f2;}' +
        '#condo-toolnav a.ctn-active{background:rgba(61,111,210,.30);color:#eaf0fb;font-weight:600;}' +
        '#condo-toolnav-corner{position:fixed;right:8px;bottom:40px;z-index:10000;' +
        'font:12px system-ui,-apple-system,sans-serif;}' +
        '#condo-toolnav-toggle{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.15);' +
        'background:rgba(20,26,38,.88);color:#e8ecf4;font-size:15px;cursor:pointer;display:flex;' +
        'align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.35);padding:0;}' +
        '#condo-toolnav-toggle:hover{background:rgba(30,38,54,.95);}' +
        '#condo-toolnav-panel{display:none;position:absolute;right:0;bottom:42px;' +
        'background:rgba(20,26,38,.94);border:1px solid rgba(255,255,255,.12);border-radius:10px;' +
        'padding:6px;min-width:132px;flex-direction:column;gap:2px;backdrop-filter:blur(4px);}' +
        '#condo-toolnav-panel.ctn-open{display:flex;}' +
        '#condo-toolnav-panel a{color:#cdd6e8;text-decoration:none;padding:7px 9px;border-radius:6px;' +
        'font-size:12px;}' +
        '#condo-toolnav-panel a:hover{background:rgba(255,255,255,.08);}' +
        '#condo-toolnav-panel a.ctn-active{background:rgba(90,120,190,.35);color:#fff;}' +
        // Scoped compensation for the two tool pages whose #layout hardcodes
        // `calc(100vh - 53px)` against their own header height — harmless
        // no-op on every other page, since #layout only exists there.
        '#layout{height:calc(100vh - 53px - 32px) !important;}';
      var style = document.createElement('style');
      style.id = 'condo-toolnav-style';
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    }

    function buildTopStrip(activeId) {
      var nav = document.createElement('nav');
      nav.id = 'condo-toolnav';
      var brand = document.createElement('span');
      brand.className = 'ctn-brand';
      brand.textContent = 'Condo Life';
      nav.appendChild(brand);
      TOOLS.forEach(function (t) {
        var a = document.createElement('a');
        a.href = t.href;
        a.textContent = t.label;
        if (t.id === activeId) a.className = 'ctn-active';
        nav.appendChild(a);
      });
      document.body.insertBefore(nav, document.body.firstChild);
    }

    function buildCornerMenu(activeId) {
      var wrap = document.createElement('div');
      wrap.id = 'condo-toolnav-corner';

      var panel = document.createElement('div');
      panel.id = 'condo-toolnav-panel';
      TOOLS.forEach(function (t) {
        var a = document.createElement('a');
        a.href = t.href;
        a.textContent = t.label;
        if (t.id === activeId) a.className = 'ctn-active';
        panel.appendChild(a);
      });

      var btn = document.createElement('button');
      btn.id = 'condo-toolnav-toggle';
      btn.type = 'button';
      btn.title = 'Tools';
      btn.setAttribute('aria-label', 'Tools navigation');
      btn.textContent = '⚙'; // gear
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        panel.classList.toggle('ctn-open');
      });
      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) panel.classList.remove('ctn-open');
      });

      wrap.appendChild(panel);
      wrap.appendChild(btn);
      document.body.appendChild(wrap);
    }

    function init() {
      if (!document.body) return;
      injectStyle();
      var activeId = currentToolId();
      if (activeId === 'game') buildCornerMenu(activeId);
      else buildTopStrip(activeId);
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
  } catch (err) {
    // The nav strip must never be able to break a tool page or the game.
    if (typeof console !== 'undefined' && console.warn) console.warn('[condo-toolnav] init failed:', err);
  }
})();
