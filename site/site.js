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

  // Early Access form: posts to the service named in data-endpoint. Closed until that is set.
  var eaForm = document.getElementById("ea-form");
  if (eaForm) {
    var eaStatus = document.getElementById("ea-status");
    var say = function (t, bad) { eaStatus.textContent = t; eaStatus.className = "ea-status" + (bad ? " bad" : " ok"); };
    eaForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var endpoint = eaForm.getAttribute("data-endpoint");
      if (!endpoint) { say("Registrations are temporarily unavailable. Please check back soon.", true); return; }
      var f = eaForm.elements;
      var email = f.email.value.trim();
      if (!f.name.value.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { say("Please enter your name and a valid email.", true); return; }
      if (!f.use_case.value) { say("Please choose what you would use Kinviva for.", true); return; }
      if (!f.consent.checked) { say("Please tick the consent box so we can contact you.", true); return; }
      var btn = eaForm.querySelector("button[type=submit]");
      btn.disabled = true; say("Sending…", false);
      fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: f.name.value.trim(), email: email, use_case: f.use_case.value, company: f.company.value.trim(),
        consent: true, website: f.website.value
      }) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          if (x.r.ok) { say("Thank you. You are on the Early Access list. If you are selected we will email you.", false); eaForm.reset(); }
          else if (x.r.status === 429) { say("Too many attempts. Please try again in an hour.", true); btn.disabled = false; }
          else { say(x.j.error || "Something went wrong. Please try again.", true); btn.disabled = false; }
        }).catch(function () { say("Could not reach the service. Please try again later.", true); btn.disabled = false; });
    });
  }
})();
