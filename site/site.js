// Progressive enhancement for the Kinviva website. Every page works without this script.
(function () {
  // Mobile menu
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

  // Tabs: ARIA tablist with arrow keys, Home/End and #hash links
  function initTabs(root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    function panelOf(t) { return document.getElementById(t.getAttribute("aria-controls")); }
    function select(t, focus) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute("aria-selected", String(on));
        x.tabIndex = on ? 0 : -1;
        var p = panelOf(x);
        if (p) p.hidden = !on;
      });
      if (focus) t.focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { select(t, false); });
      t.addEventListener("keydown", function (e) {
        var n = tabs.length, next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(i + 1) % n];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(i - 1 + n) % n];
        else if (e.key === "Home") next = tabs[0];
        else if (e.key === "End") next = tabs[n - 1];
        if (next) { e.preventDefault(); select(next, true); }
      });
    });
    root.__select = select;
  }
  document.querySelectorAll("[data-tabs]").forEach(initTabs);

  // Video chapters
  var player = document.querySelector("[data-player]");
  if (player) {
    var v = player.querySelector("video");
    var chapters = Array.prototype.slice.call(player.querySelectorAll(".chapter"));
    chapters.forEach(function (c) {
      c.addEventListener("click", function () { v.currentTime = parseFloat(c.getAttribute("data-t")); v.play(); });
    });
    v.addEventListener("timeupdate", function () {
      var cur = 0;
      chapters.forEach(function (c, i) { if (v.currentTime >= parseFloat(c.getAttribute("data-t")) - 0.1) cur = i; });
      chapters.forEach(function (c, i) { c.classList.toggle("is-on", i === cur); });
    });
  }

  // Download page: pick the visitor's system and confirm clicks
  var os = document.querySelector("[data-auto-os]");
  if (os && os.__select) {
    var ua = (navigator.userAgent || "") + " " + (navigator.platform || "");
    if (/Win/i.test(ua)) os.__select(document.getElementById("os-win"), false);
  }
  var toast = document.getElementById("started");
  if (toast) {
    document.querySelectorAll("[data-download]").forEach(function (a) { a.addEventListener("click", function () { toast.hidden = false; }); });
    toast.querySelector("button").addEventListener("click", function () { toast.hidden = true; });
  }

  // Gentle reveal on scroll (skipped for reduced motion)
  var items = document.querySelectorAll(".reveal");
  if (items.length && "IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
})();
