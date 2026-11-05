// Progressive enhancement for the MeetingLens website. Every page works without this script.
(function () {
  // --- Mobile menu
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { toggle.click(); toggle.focus(); }
    });
  }

  // --- Tabs (ARIA tablist with arrow keys, Home/End, and #hash links)
  function initTabs(root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    function panelOf(t) { return document.getElementById(t.getAttribute("aria-controls")); }
    function visible(t) { return !t.hidden; }
    function select(t, focus) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute("aria-selected", String(on));
        x.tabIndex = on ? 0 : -1;
        var p = panelOf(x);
        if (p) p.hidden = !on;
      });
      if (focus) t.focus();
      var id = t.id.replace(/^tab-/, "");
      if (root.hasAttribute("data-hash") && history.replaceState) history.replaceState(null, "", "#" + id);
    }
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { select(t, false); });
      t.addEventListener("keydown", function (e) {
        var list = tabs.filter(visible), i = list.indexOf(t), n = list.length, next = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") next = list[(i + 1) % n];
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = list[(i - 1 + n) % n];
        else if (e.key === "Home") next = list[0];
        else if (e.key === "End") next = list[n - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    root.__select = select;
    root.__tabs = tabs;
  }
  document.querySelectorAll("[data-tabs]").forEach(initTabs);

  // --- Features: filter chips + deep links
  var explorer = document.querySelector(".explorer [data-tabs]");
  if (explorer) {
    explorer.setAttribute("data-hash", "");
    var chips = document.querySelectorAll(".chip");
    var none = document.getElementById("no-match");
    chips.forEach(function (c) {
      c.addEventListener("click", function () {
        var f = c.getAttribute("data-filter");
        chips.forEach(function (x) { var on = x === c; x.classList.toggle("is-on", on); x.setAttribute("aria-pressed", String(on)); });
        var first = null;
        explorer.__tabs.forEach(function (t) {
          var show = f === "all" || t.getAttribute("data-cat") === f;
          t.hidden = !show;
          if (show && !first) first = t;
        });
        if (none) none.hidden = !!first;
        if (first) {
          var current = explorer.__tabs.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0];
          if (!current || current.hidden) explorer.__select(first, false);
        }
      });
    });
    var hash = (location.hash || "").replace("#", "");
    var target = hash && document.getElementById("tab-" + hash);
    if (target) explorer.__select(target, false);
  }

  // --- Video chapters
  var player = document.querySelector("[data-player]");
  if (player) {
    var v = player.querySelector("video");
    var chapters = Array.prototype.slice.call(player.querySelectorAll(".chapter"));
    chapters.forEach(function (c) {
      c.addEventListener("click", function () {
        v.currentTime = parseFloat(c.getAttribute("data-t"));
        v.play();
      });
    });
    v.addEventListener("timeupdate", function () {
      var cur = 0;
      chapters.forEach(function (c, i) { if (v.currentTime >= parseFloat(c.getAttribute("data-t")) - 0.1) cur = i; });
      chapters.forEach(function (c, i) { c.classList.toggle("is-on", i === cur); });
    });
  }

  // --- Download page: pick the visitor's system, toast on click
  var os = document.querySelector("[data-auto-os]");
  if (os) {
    var ua = (navigator.userAgent || "") + " " + (navigator.platform || "");
    var note = document.getElementById("platform-note");
    if (/Win/i.test(ua)) os.__select(document.getElementById("os-win"), false);
    else if (!/Mac/i.test(ua) && note) { note.textContent = "MeetingLens downloads are for Mac and Windows computers."; note.hidden = false; }
  }
  var toast = document.getElementById("started");
  if (toast) {
    document.querySelectorAll("[data-download]").forEach(function (a) { a.addEventListener("click", function () { toast.hidden = false; }); });
    toast.querySelector("button").addEventListener("click", function () { toast.hidden = true; });
  }
})();
