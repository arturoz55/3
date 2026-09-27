/* Forkline — cookie & storage consent.
 * Forkline sets no tracking cookies. Demo data lives in localStorage (necessary).
 * The only optional item is Google Fonts, which is fetched from Google's servers. */
(() => {
  "use strict";
  const KEY = "forkline:consent";
  const VERSION = 1;
  const FONTS_URL = "https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400;500&display=swap";

  function read() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY));
      return c && c.v === VERSION ? c : null;
    } catch { return null; }
  }
  function write(fonts) {
    const c = { v: VERSION, fonts: !!fonts, t: Date.now() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
    return c;
  }
  function loadFonts() {
    if (document.getElementById("gfonts")) return;
    const pre = document.createElement("link");
    pre.rel = "preconnect"; pre.href = "https://fonts.gstatic.com"; pre.crossOrigin = "";
    const l = document.createElement("link");
    l.id = "gfonts"; l.rel = "stylesheet"; l.href = FONTS_URL;
    document.head.append(pre, l);
  }
  function apply(c) {
    if (c?.fonts) loadFonts();
    else if (document.getElementById("gfonts")) location.reload(); // unload fonts that were already fetched
  }

  let el = null;
  function close() {
    if (!el) return;
    el.classList.add("out");
    const node = el; el = null;
    setTimeout(() => node.remove(), 300);
  }
  function show(detailed = false) {
    if (el) el.remove();
    const cur = read();
    el = document.createElement("div");
    el.className = "consent";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-labelledby", "consentTitle");
    el.innerHTML = `
      <div class="consent-head">
        <span class="consent-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 12.5A9 9 0 1 1 11.5 3a3 3 0 0 0 3.6 3.6 3 3 0 0 0 3.3 3.3A3 3 0 0 0 21 12.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8.5" cy="10" r="1.2" fill="currentColor"/><circle cx="14" cy="15" r="1.2" fill="currentColor"/><circle cx="9" cy="16" r="1" fill="currentColor"/></svg></span>
        <h2 id="consentTitle">cookies &amp; storage</h2>
      </div>
      <p>Forkline doesn't use tracking or advertising cookies. We save your demo wallet, markets and watchlist in this browser so they're here when you come back. That data stays on your device.</p>
      <div class="consent-opts" ${detailed ? "" : "hidden"}>
        <label class="consent-opt"><input type="checkbox" checked disabled /><span><b>necessary</b><small>Demo data and this choice, kept in your browser's local storage. The site can't work without it.</small></span></label>
        <label class="consent-opt"><input type="checkbox" id="consentFonts" ${cur ? (cur.fonts ? "checked" : "") : "checked"} /><span><b>Google Fonts</b><small>Loads the Geist typeface from Google's servers, which receive your IP address. Turn it off to use your system font.</small></span></label>
      </div>
      <div class="consent-actions">
        ${detailed
          ? `<button type="button" class="btn btn-ink press" data-c="save">save choices</button>`
          : `<button type="button" class="btn btn-ink press" data-c="all">accept all</button>
             <button type="button" class="btn btn-outline press" data-c="necessary">necessary only</button>
             <button type="button" class="btn btn-ghost press" data-c="custom">customize</button>`}
      </div>
      <a href="#/privacy" class="consent-more">privacy details</a>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-c]");
      if (e.target.closest(".consent-more")) { if (read()) close(); return; }
      if (!b) return;
      const act = b.dataset.c;
      if (act === "custom") { show(true); return; }
      const fonts = act === "all" ? true : act === "necessary" ? false : el.querySelector("#consentFonts").checked;
      const before = read();
      const c = write(fonts);
      close();
      if (before && before.fonts && !fonts) apply(c); // reload to drop the fonts
      else if (fonts) loadFonts();
      document.dispatchEvent(new CustomEvent("consentchange", { detail: c }));
    });
    requestAnimationFrame(() => el?.querySelector("[data-c]")?.focus({ preventScroll: true }));
  }

  // boot: apply a saved choice, or ask on the first visit
  const saved = read();
  if (saved) apply(saved);
  else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => show(false));
  else show(false);

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-consent-open]")) { e.preventDefault(); show(true); }
  });

  window.Consent = { read, show };
})();
