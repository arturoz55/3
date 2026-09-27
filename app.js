/* Forkline — single-page app (vanilla JS, no build step).
 * Markets are simulated locally on a constant-product bonding curve with play balance.
 * Repository data and ownership checks are real, read live from GitHub. */
(() => {
  "use strict";

  // ---------- constants ----------
  const STORE_KEY = "forkline:v1";
  const TOTAL_SUPPLY = 1_000_000_000;
  const CURVE_SUPPLY = 800_000_000; // tokens sellable on the curve before graduation
  const V_ETH0 = 30; // virtual quote reserve
  const V_TOK0 = 1_073_000_000; // virtual token reserve
  const FEE = 0.01; // 1% per trade: half to creator, half to treasury
  const START_BALANCE = 10;
  const VERIFY_FILE = ".forkline";

  // ---------- state ----------
  const defaultState = () => ({ wallet: null, markets: [], activity: [], treasury: 0 });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.markets) || !Array.isArray(s.activity)) return defaultState();
      return { ...defaultState(), ...s };
    } catch {
      return defaultState();
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) { state = load(); render(); } });

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const fmt = (n, d = 2) => {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(d) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(d) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(d) + "K";
    return n.toFixed(d);
  };
  const fmtEth = (n) => (Math.abs(n) < 0.0001 && n !== 0 ? n.toExponential(2) : n.toFixed(4)) + " ETH";
  const fmtPrice = (p) => p.toExponential(3);
  const ago = (t) => {
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  };
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

  function toast(msg) {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 320); }, 3200);
  }

  // ---------- bonding curve ----------
  const curve = {
    price: (m) => m.vEth / m.vTok,
    // quote for spending `eth` (gross, fee included)
    buyQuote(m, eth) {
      const fee = eth * FEE;
      const net = eth - fee;
      const k = m.vEth * m.vTok;
      let out = m.vTok - k / (m.vEth + net);
      const left = CURVE_SUPPLY - m.sold;
      if (out > left) out = left;
      return { out: Math.max(0, out), fee, net };
    },
    // quote for selling `tok` tokens, returns eth after fee
    sellQuote(m, tok) {
      const k = m.vEth * m.vTok;
      const gross = m.vEth - k / (m.vTok + tok);
      const fee = gross * FEE;
      return { out: Math.max(0, gross - fee), fee, gross };
    },
    mcap: (m) => (m.vEth / m.vTok) * TOTAL_SUPPLY,
    progress: (m) => Math.min(100, (m.sold / CURVE_SUPPLY) * 100),
  };

  function buy(m, eth) {
    const q = curve.buyQuote(m, eth);
    if (q.out <= 0) throw new Error("curve is complete — nothing left to buy");
    // if capped by remaining supply, charge only what is needed
    const k = m.vEth * m.vTok;
    const neededNet = k / (m.vTok - q.out) - m.vEth;
    const net = Math.min(q.net, neededNet);
    const fee = net * FEE / (1 - FEE);
    const spent = net + fee;
    m.vEth += net;
    m.vTok -= q.out;
    m.sold += q.out;
    settleFee(m, fee);
    return { tokens: q.out, spent };
  }
  function sell(m, tok) {
    const q = curve.sellQuote(m, tok);
    m.vEth -= q.gross;
    m.vTok += tok;
    m.sold -= tok;
    settleFee(m, q.fee);
    return { eth: q.out };
  }
  function settleFee(m, fee) {
    m.creatorFees += fee / 2;
    state.treasury += fee / 2;
  }
  function recordPrice(m) {
    m.history.push({ t: Date.now(), p: curve.price(m) });
    if (m.history.length > 400) m.history.splice(0, m.history.length - 400);
  }
  function logActivity(a) {
    state.activity.unshift({ id: uid(), t: Date.now(), ...a });
    if (state.activity.length > 300) state.activity.length = 300;
  }

  // ---------- wallet (demo) ----------
  function connect() {
    if (state.wallet) return state.wallet;
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const addr = "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    state.wallet = { address: addr, balance: START_BALANCE, holdings: {} };
    save();
    toast("demo wallet connected with " + START_BALANCE + " play ETH");
    updateConnect();
    return state.wallet;
  }
  function disconnect() {
    state.wallet = null;
    save();
    updateConnect();
    toast("wallet disconnected");
  }
  function updateConnect() {
    const b = $("#connectBtn");
    b.textContent = state.wallet ? short(state.wallet.address) : "connect";
    b.classList.toggle("mono", !!state.wallet);
  }
  $("#connectBtn").addEventListener("click", () => {
    if (state.wallet) location.hash = "#/profile";
    else { connect(); render(); }
  });

  // ---------- GitHub ----------
  function parseRepo(input) {
    const s = String(input || "").trim()
      .replace(/^git\+/, "")
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/\.git$/i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const m = s.match(/^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/.*)?$/);
    if (!m || m[2] === "." || m[2] === "..") return null;
    return { owner: m[1], repo: m[2] };
  }
  async function gh(path) {
    let res;
    try {
      res = await fetch("https://api.github.com" + path, { headers: { Accept: "application/vnd.github+json" } });
    } catch {
      throw new Error("could not reach GitHub — check your connection and try again");
    }
    if (res.status === 404) throw new Error("repository not found (or it is private)");
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      const when = reset ? " — try again in ~" + Math.max(1, Math.ceil((reset - Date.now()) / 60000)) + " min" : "";
      throw new Error("GitHub rate limit reached" + when);
    }
    if (!res.ok) throw new Error("GitHub responded " + res.status);
    return res;
  }
  // count items in a list endpoint using per_page=1 + Link header
  async function ghCount(path) {
    try {
      const res = await gh(path + (path.includes("?") ? "&" : "?") + "per_page=1");
      const link = res.headers.get("link") || "";
      const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (m) return Number(m[1]);
      const body = await res.json();
      return Array.isArray(body) ? body.length : 0;
    } catch (e) {
      if (/rate limit/.test(e.message)) throw e;
      return 0; // empty repositories return 409 for commits
    }
  }
  async function fetchRepo(owner, repo) {
    const info = await (await gh(`/repos/${owner}/${repo}`)).json();
    if (info.private) throw new Error("only public repositories can launch");
    const [contributors, commits] = await Promise.all([
      ghCount(`/repos/${info.owner.login}/${info.name}/contributors?anon=1`),
      ghCount(`/repos/${info.owner.login}/${info.name}/commits`),
    ]);
    return {
      owner: info.owner.login,
      name: info.name,
      fullName: info.full_name,
      description: info.description || "",
      avatar: info.owner.avatar_url,
      url: info.html_url,
      stars: info.stargazers_count,
      forks: info.forks_count,
      issues: info.open_issues_count,
      language: info.language || "—",
      branch: info.default_branch,
      pushedAt: info.pushed_at,
      contributors,
      commits,
      fork: info.fork,
      archived: info.archived,
    };
  }
  async function checkVerification(repo, code) {
    const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${encodeURIComponent(repo.branch)}/${VERIFY_FILE}?t=${Date.now()}`;
    let res;
    try { res = await fetch(url, { cache: "no-store" }); }
    catch { return { ok: false, reason: "could not reach GitHub" }; }
    if (res.status === 404) return { ok: false, reason: `no ${VERIFY_FILE} file found on ${repo.branch} yet` };
    if (!res.ok) return { ok: false, reason: "could not read the file (" + res.status + ")" };
    const text = await res.text();
    return text.includes(code) ? { ok: true } : { ok: false, reason: `${VERIFY_FILE} exists but does not contain the code` };
  }

  // ---------- router ----------
  const routes = [
    [/^\/?$/, viewHome],
    [/^\/explore$/, viewExplore],
    [/^\/launch$/, viewLaunch],
    [/^\/activity$/, viewActivity],
    [/^\/how$/, viewHow],
    [/^\/treasury$/, viewTreasury],
    [/^\/profile$/, viewProfile],
    [/^\/m\/([a-z0-9]+)$/, viewMarket],
  ];
  let cleanup = [];
  function render() {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    let view = viewNotFound, params = [];
    for (const [re, fn] of routes) {
      const m = path.match(re);
      if (m) { view = fn; params = m.slice(1); break; }
    }
    const app = $("#app");
    app.innerHTML = view(...params);
    const key = path.split("/")[1] || "";
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === key || (key === "m" && a.dataset.nav === "explore")));
    updateConnect();
    view.mount?.(app, ...params);
    observeReveal();
  }
  let lastPath = null;
  window.addEventListener("hashchange", () => {
    const p = location.hash.split("?")[0];
    if (p !== lastPath) window.scrollTo({ top: 0, behavior: "instant" });
    lastPath = p;
    render();
  });

  // nav scroll state
  const navWrap = $("#navWrap");
  const onScroll = () => navWrap.classList.toggle("scrolled", window.scrollY > 12);
  window.addEventListener("scroll", onScroll, { passive: true });

  // reveal on scroll
  let io;
  function observeReveal() {
    io?.disconnect();
    if (!("IntersectionObserver" in window)) { $$(".reveal").forEach((el) => el.classList.add("in")); return; }
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    $$(".reveal").forEach((el) => io.observe(el));
  }

  // ---------- shared renderers ----------
  function marketCard(m) {
    const change = priceChange(m);
    return `<a class="card mcard" href="#/m/${m.id}">
      <div class="mc-top">
        <div class="avatar" style="background-image:url('${esc(m.repo.avatar)}')"></div>
        <div style="min-width:0;flex:1">
          <div class="mc-name">${esc(m.name)} <span class="muted mono small">$${esc(m.ticker)}</span></div>
          <div class="mc-repo">${esc(m.repo.fullName)}</div>
        </div>
        ${m.example ? `<span class="pill">example</span>` : m.verified ? `<span class="verified">${icon.check} verified</span>` : `<span class="unverified">unverified</span>`}
      </div>
      <div class="mc-stats">
        <div class="stat"><div class="k">mcap</div><div class="v">${fmt(curve.mcap(m))} Ξ</div></div>
        <div class="stat"><div class="k">24h</div><div class="v ${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : ""}${change.toFixed(1)}%</div></div>
        <div class="stat"><div class="k">stars</div><div class="v">${fmt(m.repo.stars, m.repo.stars < 1000 ? 0 : 1)}</div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-bottom:6px"><span>curve progress</span><span class="mono">${curve.progress(m).toFixed(1)}%</span></div>
        <div class="bar"><i style="width:${curve.progress(m)}%"></i></div>
      </div>
    </a>`;
  }
  function priceChange(m) {
    const cutoff = Date.now() - 86400000;
    const base = m.history.find((h) => h.t >= cutoff) || m.history[0];
    const now = curve.price(m);
    return base ? ((now - base.p) / base.p) * 100 : 0;
  }
  function volume(m) { return state.activity.filter((a) => a.marketId === m.id && a.type !== "launch").reduce((s, a) => s + (a.eth || 0), 0); }
  function activityLine(a) {
    const m = state.markets.find((x) => x.id === a.marketId);
    const name = m ? `<a href="#/m/${m.id}">$${esc(m.ticker)}</a>` : "a market";
    if (a.type === "launch") return `<span class="badge launch">${icon.rocket}</span><span><span class="mono">${esc(short(a.who))}</span> launched ${name} from <span class="mono">${esc(a.repo)}</span></span>`;
    const verb = a.type === "buy" ? "bought" : "sold";
    return `<span class="badge ${a.type}">${a.type === "buy" ? "↑" : "↓"}</span><span><span class="mono">${esc(short(a.who))}</span> ${verb} ${fmt(a.tokens)} ${name} for ${fmtEth(a.eth)}</span>`;
  }
  function tickerHtml() {
    const items = state.activity.slice(0, 16);
    if (!items.length) return `<div class="ticker"><div class="ticker-empty">no activity yet — the first launch shows up here</div></div>`;
    const one = items.map((a) => {
      const m = state.markets.find((x) => x.id === a.marketId);
      const t = m ? "$" + m.ticker : "—";
      const txt = a.type === "launch" ? `<b>${esc(t)}</b> launched` : `<b>${esc(t)}</b> ${a.type} ${fmtEth(a.eth)}`;
      return `<span class="ticker-item"><span class="badge ${a.type}" style="width:18px;height:18px;font-size:10px">${a.type === "buy" ? "↑" : a.type === "sell" ? "↓" : "✦"}</span>${txt}<span class="mono" style="color:var(--faint)">${ago(a.t)}</span></span>`;
    }).join("");
    // duplicated for a seamless loop
    return `<div class="ticker"><div class="ticker-track">${one}${one}</div></div>`;
  }

  const icon = {
    check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    rocket: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/></svg>`,
    branch: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 6"/></svg>`,
    file: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/></svg>`,
  };

  // ---------- views ----------
  function viewHome() {
    const recent = [...state.markets].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    return `
    <section class="hero">
      <div class="world" id="world">
        <div class="float" style="left:4%;top:20%;width:250px;--dur:10s;--delay:.2s" data-depth="18">
          <div class="fh"><span class="dots"><i></i><i></i><i></i></span>${icon.file} lib / curve.ts</div>
          <div class="fb" id="typeCode"></div>
        </div>
        <div class="float hide-sm" style="left:7%;top:62%;width:220px;--dur:12s;--delay:.5s" data-depth="30">
          <div class="fh">${icon.branch} history</div>
          <div class="fb">
            <div class="row"><span class="node"></span>scaffold project<span class="sha">1c0e</span></div>
            <div class="row"><span class="node"></span>add pricing math<span class="sha">b72d</span></div>
            <div class="row"><span class="node"></span>tests for edge cases<span class="sha">09fa</span></div>
            <div class="row"><span class="node" style="border-color:var(--coral)"></span>release v0.2<span class="sha">e41b</span></div>
          </div>
        </div>
        <div class="float hide-sm" style="right:5%;top:18%;width:230px;--dur:11s;--delay:.35s" data-depth="24">
          <div class="fh">review</div>
          <div class="fb">
            <div class="row"><span class="pill">PR #42</span>docs: quick start</div>
            <div class="row"><span class="pill green">approved</span>2 reviewers</div>
            <div class="row"><span class="pill" style="background:rgba(240,138,108,.12);color:var(--coral)">issue</span>triaged</div>
          </div>
        </div>
        <div class="float term hide-xs" style="right:6%;top:60%;width:240px;--dur:9s;--delay:.65s" data-depth="14">
          <div class="fh"><span class="dots"><i></i><i></i><i></i></span>zsh</div>
          <div class="fb code-line" id="typeTerm"></div>
        </div>
        <div class="float hide-sm" style="left:38%;top:80%;width:200px;--dur:13s;--delay:.8s" data-depth="36">
          <div class="fb" style="display:flex;align-items:center;gap:8px">${icon.branch}<span class="mono">fork → main</span><span class="pill green" style="margin-left:auto">merged</span></div>
        </div>
      </div>
      <div class="hero-glow"></div>
      <div class="hero-copy">
        <h1><span class="word">ship code.</span><br><span class="word soft" style="animation-delay:.15s">launch it.</span></h1>
        <p>Forkline turns a public GitHub repository into a verified market. Paste a repo, prove you maintain it, and let people back the work they believe in.</p>
        <div class="hero-cta">
          <a href="#/explore" class="btn btn-lg btn-outline press">browse markets</a>
          <a href="#/launch" class="btn btn-lg btn-ink press">${icon.rocket} launch a repository</a>
        </div>
      </div>
    </section>
    ${tickerHtml()}
    <div class="lifecycle"><span>repo</span><span>proof</span><span>market</span><span>growth</span></div>

    <section class="section reveal">
      <div class="section-head">
        <div><div class="eyebrow">markets</div><h2>open source markets</h2></div>
        <a href="#/explore" class="btn btn-ghost press">view all →</a>
      </div>
      ${recent.length ? `<div class="grid">${recent.map(marketCard).join("")}</div>` :
        `<div class="empty"><p>verified repository launches will appear here</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a href="#/launch" class="btn btn-ink press">launch the first one</a><button class="btn btn-outline press" data-seed type="button">load example markets</button></div></div>`}
    </section>

    <section class="section reveal">${howSteps()}</section>`;
  }
  viewHome.mount = (app) => {
    // typing code
    const code = [
      [["tk-k", "export "], ["tk-k", "function "], ["tk-f", "quote"], ["", "(x, y) {"]],
      [["", "  "], ["tk-k", "const "], ["", "k = x * y;"]],
      [["", "  "], ["tk-k", "return "], ["tk-f", "settle"], ["", "(k, "], ["tk-s", "'repo'"], ["", ");"]],
      [["", "}"]],
    ];
    const codeEl = $("#typeCode", app);
    const termEl = $("#typeTerm", app);
    const timers = [];
    const typeInto = (el, lines, renderLine, speed, loop) => {
      let li = 0, ci = 0;
      const total = (l) => l.reduce((s, [, t]) => s + t.length, 0);
      const tick = () => {
        if (!el.isConnected) return;
        const html = lines.map((l, i) => {
          if (i > li) return "";
          const upto = i < li ? Infinity : ci;
          return renderLine(l, i, upto, i === li);
        }).join("");
        el.innerHTML = html;
        if (ci < total(lines[li])) ci++;
        else if (li < lines.length - 1) { li++; ci = 0; }
        else if (loop) { timers.push(setTimeout(() => { li = 0; ci = 0; tick(); }, 2600)); return; }
        else return;
        timers.push(setTimeout(tick, speed + Math.random() * 40));
      };
      tick();
    };
    typeInto(codeEl, code, (l, i, upto, cur) => {
      let n = upto, out = "";
      for (const [cls, t] of l) {
        if (n <= 0) break;
        const part = t.slice(0, n); n -= t.length;
        out += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part);
      }
      return `<div class="code-line"><span class="ln">0${i + 1}</span>${out}${cur ? '<span class="caret"></span>' : ""}</div>`;
    }, 45, true);
    const term = [[["", "$ git push origin main"]], [["", "✓ 3 commits pushed"]], [["", "$ forkline verify"]], [["", "✓ ownership confirmed"]]];
    typeInto(termEl, term, (l, i, upto, cur) => {
      const t = l[0][1].slice(0, upto);
      const color = t.startsWith("✓") ? "color:#6ee7b7" : "";
      return `<div style="${color}">${esc(t)}${cur ? '<span class="caret" style="background:#d7d6e0"></span>' : ""}</div>`;
    }, 55, true);
    cleanup.push(() => timers.forEach(clearTimeout));

    // pointer parallax on floating panels
    const floats = $$("[data-depth]", app);
    const move = (e) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      floats.forEach((f) => {
        const d = Number(f.dataset.depth);
        f.style.setProperty("--px", (-x * d).toFixed(1) + "px");
        f.style.setProperty("--py", (-y * d).toFixed(1) + "px");
      });
    };
    if (window.matchMedia("(pointer: fine)").matches) {
      window.addEventListener("pointermove", move, { passive: true });
      cleanup.push(() => window.removeEventListener("pointermove", move));
    }
  };

  function howSteps() {
    return `<div class="section-head"><div><div class="eyebrow">how it works</div><h2>from repository to market</h2></div></div>
      <div class="steps">
        <div class="card step"><span class="num">01</span><span class="tag">paste</span><h3>point to a repo</h3><p>Any public GitHub project works. Use the full URL or the short owner/name form.</p></div>
        <div class="card step"><span class="num">02</span><span class="tag">prove</span><h3>show it is yours</h3><p>Stars, forks, commits and contributors come live from GitHub. Commit a one-line file to prove you maintain it.</p></div>
        <div class="card step"><span class="num">03</span><span class="tag">launch</span><h3>open the market</h3><p>Choose a name and ticker. The market opens on a constant-product curve in seconds.</p></div>
        <div class="card step"><span class="num">04</span><span class="tag">grow</span><h3>back the work</h3><p>Trade along the curve while the project ships. The creator earns part of every fee.</p></div>
      </div>`;
  }

  function viewExplore() {
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">explore</div><h2>open source markets</h2><p>Every market is backed by a live GitHub repository. Verified launches passed an ownership check.</p></div>
      <div class="rail">
        <div class="tabs" id="sortTabs">
          <span class="tab-ind"></span>
          <button data-sort="trending" class="active">trending</button>
          <button data-sort="new">recently launched</button>
          <button data-sort="active">most active</button>
        </div>
        <input class="input" id="q" placeholder="search name, ticker or repo" aria-label="search markets" />
        <label class="check" style="align-items:center"><input type="checkbox" id="onlyVerified" /> verified only</label>
      </div>
      <div id="marketList"></div>
    </div>`;
  }
  viewExplore.mount = (app) => {
    let sort = "trending";
    const list = $("#marketList", app);
    const draw = () => {
      const q = $("#q", app).value.trim().toLowerCase();
      const onlyV = $("#onlyVerified", app).checked;
      let ms = state.markets.filter((m) => (!onlyV || m.verified) &&
        (!q || [m.name, m.ticker, m.repo.fullName].some((s) => s.toLowerCase().includes(q))));
      const trades = (m) => state.activity.filter((a) => a.marketId === m.id).length;
      if (sort === "trending") ms.sort((a, b) => volume(b) - volume(a) || b.createdAt - a.createdAt);
      if (sort === "new") ms.sort((a, b) => b.createdAt - a.createdAt);
      if (sort === "active") ms.sort((a, b) => trades(b) - trades(a) || (b.repo.commits - a.repo.commits));
      list.innerHTML = ms.length ? `<div class="grid">${ms.map(marketCard).join("")}</div>` :
        `<div class="empty"><p>${state.markets.length ? "no markets match that filter" : "no markets yet — launch the first repository"}</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><a href="#/launch" class="btn btn-ink press">launch a repository</a>${state.markets.length ? "" : `<button class="btn btn-outline press" data-seed type="button">load example markets</button>`}</div></div>`;
    };
    setupTabs($("#sortTabs", app), (v) => { sort = v; draw(); });
    $("#q", app).addEventListener("input", draw);
    $("#onlyVerified", app).addEventListener("change", draw);
    draw();
  };

  function setupTabs(root, onChange) {
    const ind = $(".tab-ind", root);
    const place = (btn) => { ind.style.left = btn.offsetLeft + "px"; ind.style.width = btn.offsetWidth + "px"; };
    const btns = $$("button", root);
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.toggle("active", x === b));
      place(b);
      onChange(b.dataset.sort);
    }));
    requestAnimationFrame(() => place($("button.active", root) || btns[0]));
    // re-place after webfont load changes widths
    document.fonts?.ready.then(() => root.isConnected && place($("button.active", root)));
  }

  // --- launch wizard ---
  let wiz = { step: 1, repo: null, code: null, verified: false, name: "", ticker: "", initialBuy: 0 };
  function viewLaunch() {
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">launch</div><h2>launch a repository</h2><p>Four steps, about a minute. Repository data is read live from GitHub.</p></div>
      <div class="wizard">
        <div class="wsteps" id="wsteps"></div>
        <div class="card wpanel" id="wpanel"></div>
      </div>
    </div>`;
  }
  viewLaunch.mount = (app) => {
    const panel = $("#wpanel", app);
    const stepsEl = $("#wsteps", app);
    const labels = ["repository", "verify", "configure", "launch"];
    const drawSteps = () => {
      stepsEl.innerHTML = labels.map((l, i) => {
        const n = i + 1;
        const cls = n === wiz.step ? "cur" : n < wiz.step ? "done" : "";
        return `<div class="${cls}"><i>${n < wiz.step ? "✓" : n}</i>${l}</div>`;
      }).join("");
    };
    const go = (n) => { wiz.step = n; draw(); };
    const draw = () => {
      drawSteps();
      panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = "";
      if (wiz.step === 1) step1(); else if (wiz.step === 2) step2(); else if (wiz.step === 3) step3(); else step4();
    };

    function repoPreview(r) {
      return `<div class="repo-preview">
        <div class="avatar" style="background-image:url('${esc(r.avatar)}')"></div>
        <div style="min-width:0">
          <div style="font-weight:600"><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.fullName)}</a></div>
          <div class="muted small" style="margin-top:3px">${esc(r.description || "no description")}</div>
        </div>
      </div>
      <div class="kv">
        <div class="stat"><div class="k">stars</div><div class="v">${fmt(r.stars, 0)}</div></div>
        <div class="stat"><div class="k">forks</div><div class="v">${fmt(r.forks, 0)}</div></div>
        <div class="stat"><div class="k">commits</div><div class="v">${r.commits ? fmt(r.commits, 0) : "—"}</div></div>
        <div class="stat"><div class="k">contributors</div><div class="v">${r.contributors ? fmt(r.contributors, 0) : "—"}</div></div>
      </div>`;
    }

    function step1() {
      panel.innerHTML = `<h3>paste a repository</h3>
        <form id="repoForm" class="field" novalidate>
          <label for="repoIn">github repository</label>
          <div class="input-row">
            <input id="repoIn" class="input mono" placeholder="github.com/owner/repo or owner/repo" autocomplete="off" spellcheck="false" value="${esc(wiz.repo?.fullName || "")}" />
            <button class="btn btn-ink btn-lg press" id="fetchBtn" type="submit">fetch</button>
          </div>
          <div class="err" id="repoErr"></div>
        </form>
        <div id="repoOut">${wiz.repo ? repoPreview(wiz.repo) : `<div class="hint">Try a public repo such as <button type="button" class="mono" data-ex="vitejs/vite" style="color:var(--accent)">vitejs/vite</button> or <button type="button" class="mono" data-ex="sindresorhus/ky" style="color:var(--accent)">sindresorhus/ky</button>.</div>`}</div>
        <div class="wactions"><span></span><button class="btn btn-ink press" id="next1" ${wiz.repo ? "" : "disabled"}>continue →</button></div>`;
      const input = $("#repoIn", panel);
      const err = $("#repoErr", panel);
      const btn = $("#fetchBtn", panel);
      $$("[data-ex]", panel).forEach((b) => b.addEventListener("click", () => { input.value = b.dataset.ex; $("#repoForm", panel).requestSubmit(); }));
      $("#repoForm", panel).addEventListener("submit", async (e) => {
        e.preventDefault();
        err.textContent = "";
        const p = parseRepo(input.value);
        if (!p) { err.textContent = "enter a repository as owner/repo or a github.com URL"; return; }
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        try {
          const r = await fetchRepo(p.owner, p.repo);
          if (!panel.isConnected) return;
          const existing = state.markets.find((m) => m.repo.fullName.toLowerCase() === r.fullName.toLowerCase());
          if (existing) {
            err.innerHTML = `this repository already has a market — <a href="#/m/${existing.id}" style="text-decoration:underline">open $${esc(existing.ticker)}</a>`;
            wiz.repo = null;
          } else {
            if (wiz.repo?.fullName !== r.fullName) { wiz.code = null; wiz.verified = false; wiz.name = ""; wiz.ticker = ""; }
            wiz.repo = r;
            if (r.archived) err.textContent = "note: this repository is archived";
          }
          $("#repoOut", panel).innerHTML = wiz.repo ? repoPreview(wiz.repo) : "";
          $("#next1", panel).disabled = !wiz.repo;
        } catch (ex) {
          if (!panel.isConnected) return;
          err.textContent = ex.message || "could not reach GitHub";
          if (/could not reach|rate limit/.test(err.textContent)) err.insertAdjacentHTML("beforeend", ` · <button type="button" data-seed style="color:var(--accent);text-decoration:underline">try the example markets instead</button>`);
        } finally {
          if (panel.isConnected) { btn.disabled = false; btn.textContent = "fetch"; }
        }
      });
      $("#next1", panel).addEventListener("click", () => wiz.repo && go(2));
      input.focus();
    }

    function step2() {
      if (!wiz.code) {
        const b = new Uint8Array(6); crypto.getRandomValues(b);
        wiz.code = "forkline-verify=" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      }
      const r = wiz.repo;
      const newFile = `https://github.com/${r.owner}/${r.name}/new/${encodeURIComponent(r.branch)}?filename=${encodeURIComponent(VERIFY_FILE)}&value=${encodeURIComponent(wiz.code)}`;
      panel.innerHTML = `<h3>verify ownership</h3>
        <p class="hint" style="margin:0">Commit a file named <span class="mono">${VERIFY_FILE}</span> to the <span class="mono">${esc(r.branch)}</span> branch of <span class="mono">${esc(r.fullName)}</span> containing this code. Only someone with write access can do that, so it proves you maintain the project.</p>
        <div class="codebox"><span id="vcode">${esc(wiz.code)}</span><button type="button" id="copyCode">copy</button></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-outline press" href="${esc(newFile)}" target="_blank" rel="noopener noreferrer">create the file on GitHub ↗</a>
          <button class="btn btn-ink press" id="checkBtn" type="button">${wiz.verified ? "verified ✓" : "check now"}</button>
        </div>
        <div class="err" id="vErr" style="${wiz.verified ? "color:var(--green)" : ""}">${wiz.verified ? "ownership confirmed" : ""}</div>
        <label class="check"><input type="checkbox" id="skipV" ${!wiz.verified && wiz.skip ? "checked" : ""} ${wiz.verified ? "disabled" : ""}/> I don't maintain this repo. Launch it as <b style="margin:0 3px">unverified</b> (shown with a label).</label>
        <div class="wactions"><button class="btn btn-ghost press" id="back2">← back</button><button class="btn btn-ink press" id="next2" ${wiz.verified || wiz.skip ? "" : "disabled"}>continue →</button></div>`;
      $("#copyCode", panel).addEventListener("click", () => copy(wiz.code));
      $("#back2", panel).addEventListener("click", () => go(1));
      const skip = $("#skipV", panel);
      skip.addEventListener("change", () => { wiz.skip = skip.checked; $("#next2", panel).disabled = !(wiz.verified || wiz.skip); });
      $("#checkBtn", panel).addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const err = $("#vErr", panel);
        if (wiz.verified) return;
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
        err.textContent = ""; err.style.color = "";
        try {
          const res = await checkVerification(r, wiz.code);
          if (!panel.isConnected) return;
          if (res.ok) {
            wiz.verified = true; wiz.skip = false;
            err.style.color = "var(--green)"; err.textContent = "ownership confirmed";
            btn.textContent = "verified ✓";
            skip.checked = false; skip.disabled = true;
            $("#next2", panel).disabled = false;
            toast("repository verified");
          } else {
            err.textContent = res.reason + ". GitHub can take up to a minute to serve new files.";
            btn.disabled = false; btn.textContent = "check again";
          }
        } catch {
          if (!panel.isConnected) return;
          err.textContent = "could not reach GitHub — check your connection";
          btn.disabled = false; btn.textContent = "check again";
        }
      });
      $("#next2", panel).addEventListener("click", () => go(3));
    }

    function step3() {
      const r = wiz.repo;
      if (!wiz.name) wiz.name = r.name.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32);
      if (!wiz.ticker) wiz.ticker = r.name.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6) || "REPO";
      panel.innerHTML = `<h3>configure the market</h3>
        <div class="field"><label for="mName">market name</label><input id="mName" class="input" maxlength="32" value="${esc(wiz.name)}" /></div>
        <div class="field"><label for="mTicker">ticker</label><input id="mTicker" class="input mono" maxlength="8" value="${esc(wiz.ticker)}" /></div>
        <div class="field"><label for="mBuy">initial buy (optional, play ETH)</label><input id="mBuy" class="input mono" type="number" min="0" step="0.01" inputmode="decimal" value="${wiz.initialBuy || ""}" placeholder="0.0" /><div class="hint" id="buyHint"></div></div>
        <div class="err" id="cErr"></div>
        <div class="wactions"><button class="btn btn-ghost press" id="back3">← back</button><button class="btn btn-ink press" id="next3">review →</button></div>`;
      const nameIn = $("#mName", panel), tIn = $("#mTicker", panel), bIn = $("#mBuy", panel);
      const hint = () => {
        const v = Number(bIn.value);
        const fresh = freshMarket(r);
        $("#buyHint", panel).textContent = v > 0 ? `≈ ${fmt(curve.buyQuote(fresh, v).out)} ${tIn.value || "tokens"} at launch price` : "Buying in the same step means you get the first price on the curve.";
      };
      tIn.addEventListener("input", () => { const p = tIn.selectionStart; tIn.value = tIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); tIn.setSelectionRange(p, p); hint(); });
      bIn.addEventListener("input", hint);
      hint();
      $("#back3", panel).addEventListener("click", () => { wiz.name = nameIn.value; wiz.ticker = tIn.value; go(2); });
      $("#next3", panel).addEventListener("click", () => {
        const err = $("#cErr", panel);
        const name = nameIn.value.trim(), ticker = tIn.value.trim(), ib = Number(bIn.value || 0);
        if (name.length < 2) return (err.textContent = "name needs at least 2 characters");
        if (ticker.length < 2) return (err.textContent = "ticker needs 2–8 letters or digits");
        if (state.markets.some((m) => m.ticker === ticker)) return (err.textContent = "that ticker is taken");
        if (!(ib >= 0) || ib > 1000) return (err.textContent = "initial buy must be between 0 and 1000");
        Object.assign(wiz, { name, ticker, initialBuy: ib });
        go(4);
      });
    }

    function step4() {
      const r = wiz.repo;
      const w = state.wallet;
      const short_ = !w ? "" : w.balance < wiz.initialBuy ? `you only have ${fmtEth(w.balance)}` : "";
      panel.innerHTML = `<h3>review & launch</h3>
        ${repoPreview(r)}
        <div class="summary">
          <div><span>market</span><b>${esc(wiz.name)} · $${esc(wiz.ticker)}</b></div>
          <div><span>ownership</span><b style="color:${wiz.verified ? "var(--green)" : "var(--faint)"}">${wiz.verified ? "verified" : "unverified"}</b></div>
          <div><span>supply</span><b>${fmt(TOTAL_SUPPLY, 0)}</b></div>
          <div><span>curve</span><b>constant product · ${fmt(CURVE_SUPPLY, 0)} on curve</b></div>
          <div><span>trade fee</span><b>${FEE * 100}% (half to creator)</b></div>
          <div><span>initial buy</span><b>${wiz.initialBuy ? fmtEth(wiz.initialBuy) : "none"}</b></div>
        </div>
        <label class="check"><input type="checkbox" id="ack" /> I understand this is a demo: the curve is simulated and balances are play money.</label>
        <div class="err" id="lErr">${esc(short_)}</div>
        <div class="wactions"><button class="btn btn-ghost press" id="back4">← back</button>
          <button class="btn btn-accent btn-lg press" id="launchBtn" disabled>${icon.rocket} ${w ? "launch market" : "connect & launch"}</button></div>`;
      $("#back4", panel).addEventListener("click", () => go(3));
      const ack = $("#ack", panel), lb = $("#launchBtn", panel);
      ack.addEventListener("change", () => (lb.disabled = !ack.checked));
      lb.addEventListener("click", () => {
        const wallet = state.wallet || connect();
        if (wallet.balance < wiz.initialBuy) { $("#lErr", panel).textContent = `you only have ${fmtEth(wallet.balance)}`; return; }
        if (state.markets.some((m) => m.repo.fullName.toLowerCase() === r.fullName.toLowerCase())) { $("#lErr", panel).textContent = "this repository was just launched"; return; }
        const m = freshMarket(r);
        Object.assign(m, { id: uid(), name: wiz.name, ticker: wiz.ticker, verified: wiz.verified, creator: wallet.address, createdAt: Date.now() });
        recordPrice(m);
        state.markets.push(m);
        logActivity({ type: "launch", marketId: m.id, who: wallet.address, repo: r.fullName });
        if (wiz.initialBuy > 0) {
          const res = buy(m, wiz.initialBuy);
          wallet.balance -= res.spent;
          wallet.holdings[m.id] = (wallet.holdings[m.id] || 0) + res.tokens;
          recordPrice(m);
          logActivity({ type: "buy", marketId: m.id, who: wallet.address, tokens: res.tokens, eth: res.spent });
        }
        save();
        wiz = { step: 1, repo: null, code: null, verified: false, name: "", ticker: "", initialBuy: 0 };
        toast(`$${m.ticker} is live`);
        location.hash = "#/m/" + m.id;
      });
    }
    draw();
  };

  // fictional sample markets so the app can be explored without GitHub access
  function seedExamples() {
    const samples = [
      { name: "Tidepool", ticker: "TIDE", repo: "tidepool", desc: "A tiny job queue for edge runtimes", lang: "TypeScript", stars: 4820, forks: 212, commits: 1310, contributors: 41, buys: [2.4, 1.1, 0.6, 3.2], sells: [0.3] },
      { name: "Lanternfs", ticker: "LNTRN", repo: "lanternfs", desc: "Content-addressed file sync over plain HTTP", lang: "Rust", stars: 1930, forks: 88, commits: 642, contributors: 17, buys: [1.5, 0.8, 0.4], sells: [0.9] },
      { name: "Quillmark", ticker: "QUILL", repo: "quillmark", desc: "Markdown to print-ready PDF with no LaTeX", lang: "Go", stars: 760, forks: 31, commits: 288, contributors: 9, buys: [0.5, 0.25], sells: [] },
    ];
    const hue = { TIDE: 200, LNTRN: 38, QUILL: 280 };
    samples.forEach((x, i) => {
      if (state.markets.some((m) => m.ticker === x.ticker)) return;
      const repo = {
        owner: "example", name: x.repo, fullName: "example/" + x.repo, description: x.desc,
        avatar: "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${hue[x.ticker]} 70% 88%)"/><text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="700" text-anchor="middle" fill="hsl(${hue[x.ticker]} 60% 35%)">${x.name[0]}</text></svg>`),
        url: "#/how", stars: x.stars, forks: x.forks, issues: 0, language: x.lang, branch: "main",
        pushedAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(), commits: x.commits, contributors: x.contributors,
      };
      const m = freshMarket(repo);
      const who = "0x" + "e".repeat(4) + (i + 1).toString(16).padStart(36, "0");
      Object.assign(m, { id: uid(), name: x.name, ticker: x.ticker, verified: false, example: true, creator: who, createdAt: Date.now() - (i + 1) * 3600000 });
      recordPrice(m);
      state.markets.push(m);
      logActivity({ type: "launch", marketId: m.id, who, repo: repo.fullName });
      x.buys.forEach((eth) => { const r = buy(m, eth); recordPrice(m); logActivity({ type: "buy", marketId: m.id, who, tokens: r.tokens, eth: r.spent }); });
      x.sells.forEach((eth) => { const tok = curve.buyQuote(m, eth).out; const r = sell(m, tok); recordPrice(m); logActivity({ type: "sell", marketId: m.id, who, tokens: tok, eth: r.eth }); });
    });
    save();
    toast("example markets loaded");
    render();
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-seed]")) { e.preventDefault(); seedExamples(); }
  });

  function freshMarket(repo) {
    return {
      repo: { ...repo }, vEth: V_ETH0, vTok: V_TOK0, sold: 0, creatorFees: 0, history: [],
    };
  }

  function copy(text) {
    const done = () => toast("copied");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch { toast("copy failed"); }
    ta.remove();
  }

  // --- market page ---
  function viewMarket(id) {
    const m = state.markets.find((x) => x.id === id);
    if (!m) return viewNotFound();
    const change = priceChange(m);
    const r = m.repo;
    const holders = holdersOf(m);
    return `<div class="page">
      <div class="mhead">
        <div class="avatar" style="background-image:url('${esc(r.avatar)}')"></div>
        <div style="flex:1;min-width:200px">
          <h1>${esc(m.name)} <span class="muted mono" style="font-size:18px">$${esc(m.ticker)}</span></h1>
          <div class="mc-repo" style="margin-top:4px">${m.example ? `${esc(r.fullName)} · <span class="pill">example data</span>` : `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.fullName)} ↗</a>`} · ${m.example ? "" : m.verified ? `<span class="verified">${icon.check} verified maintainer</span>` : `<span class="unverified">unverified</span>`}</div>
        </div>
        <div style="text-align:right">
          <div class="price-big" id="priceBig">${fmtPrice(curve.price(m))}</div>
          <div class="small ${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : ""}${change.toFixed(2)}% · ETH per token</div>
        </div>
      </div>
      <div class="market">
        <div>
          <div class="card chart">${chartSvg(m)}</div>
          <div class="kv" style="margin-top:16px">
            <div class="stat card"><div class="k">market cap</div><div class="v">${fmt(curve.mcap(m))} Ξ</div></div>
            <div class="stat card"><div class="k">volume</div><div class="v">${fmt(volume(m))} Ξ</div></div>
            <div class="stat card"><div class="k">holders</div><div class="v">${holders.length}</div></div>
            <div class="stat card"><div class="k">creator fees</div><div class="v">${m.creatorFees.toFixed(4)}</div></div>
          </div>
          <div class="card" style="margin-top:16px;padding:16px 18px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--dim);margin-bottom:8px"><span>curve progress · graduates at ${fmt(CURVE_SUPPLY, 0)} sold</span><span class="mono">${curve.progress(m).toFixed(2)}%</span></div>
            <div class="bar" style="height:8px"><i style="width:${curve.progress(m)}%"></i></div>
            ${curve.progress(m) >= 100 ? `<div class="small" style="margin-top:8px;color:var(--green)">curve complete: this market has graduated</div>` : ""}
          </div>
          <div class="subgrid">
            <div class="card">
              <div class="card-title">repository</div>
              <div class="list">
                <div class="list-item">stars<span class="t">${fmt(r.stars, 0)}</span></div>
                <div class="list-item">forks<span class="t">${fmt(r.forks, 0)}</span></div>
                <div class="list-item">commits<span class="t">${r.commits ? fmt(r.commits, 0) : "—"}</span></div>
                <div class="list-item">contributors<span class="t">${r.contributors ? fmt(r.contributors, 0) : "—"}</span></div>
                <div class="list-item">language<span class="t">${esc(r.language)}</span></div>
                <div class="list-item">last push<span class="t">${r.pushedAt ? ago(new Date(r.pushedAt).getTime()) + " ago" : "—"}</span></div>
              </div>
              ${m.example ? "" : `<div style="padding:0 18px 16px"><button class="btn btn-ghost press" id="refreshRepo" type="button">refresh from GitHub</button></div>`}
            </div>
            <div class="card feed">
              <div class="card-title">trades</div>
              <div class="list" id="tradeList">${tradesHtml(m)}</div>
            </div>
          </div>
        </div>
        <div class="card trade" id="tradeBox"></div>
      </div>
    </div>`;
  }
  function tradesHtml(m) {
    const acts = state.activity.filter((a) => a.marketId === m.id).slice(0, 12);
    return acts.length ? acts.map((a) => `<div class="list-item">${activityLine(a)}<span class="t">${ago(a.t)}</span></div>`).join("") : `<div class="list-item muted">no trades yet</div>`;
  }
  function holdersOf(m) {
    // only one local wallet exists in this demo; count it if it holds tokens, plus creator
    const hs = new Set();
    state.activity.filter((a) => a.marketId === m.id && a.type === "buy").forEach((a) => hs.add(a.who));
    if (state.wallet && !(state.wallet.holdings[m.id] > 0)) hs.delete(state.wallet.address);
    return [...hs];
  }
  function chartSvg(m) {
    const W = 700, H = 260, P = 10;
    const pts = m.history.length > 1 ? m.history : [m.history[0] || { t: Date.now(), p: curve.price(m) }, { t: Date.now(), p: curve.price(m) }];
    const ps = pts.map((h) => h.p);
    let lo = Math.min(...ps), hi = Math.max(...ps);
    if (hi - lo < hi * 0.02) { hi *= 1.02; lo *= 0.98; }
    const x = (i) => P + (i / (pts.length - 1)) * (W - 2 * P);
    const y = (p) => H - P - ((p - lo) / (hi - lo)) * (H - 2 * P);
    const d = pts.map((h, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(h.p).toFixed(1)).join(" ");
    const area = d + ` L${x(pts.length - 1).toFixed(1)} ${H} L${P} ${H} Z`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="price history">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c4dff" stop-opacity=".18"/><stop offset="1" stop-color="#7c4dff" stop-opacity="0"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" stroke="rgba(24,22,40,.06)" stroke-dasharray="4 6"/>`).join("")}
      <path class="area" d="${area}"/><path class="path" d="${d}" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1].p)}" r="4" fill="#7c4dff"/>
    </svg>`;
  }
  viewMarket.mount = (app, id) => {
    const m = state.markets.find((x) => x.id === id);
    if (!m) return;
    const box = $("#tradeBox", app);
    let side = "buy";
    const draw = () => {
      const w = state.wallet;
      const held = w ? w.holdings[m.id] || 0 : 0;
      const done = curve.progress(m) >= 100;
      box.innerHTML = `
        <div class="seg"><button data-side="buy" class="${side === "buy" ? "on-buy" : ""}">buy</button><button data-side="sell" class="${side === "sell" ? "on-sell" : ""}">sell</button></div>
        <div class="field">
          <label for="amt">${side === "buy" ? "amount (play ETH)" : "amount ($" + esc(m.ticker) + ")"}</label>
          <input id="amt" class="input mono" type="number" min="0" step="any" inputmode="decimal" placeholder="0.0" />
        </div>
        <div class="quick">${side === "buy" ? ["0.1", "0.5", "1", "max"].map((v) => `<button data-q="${v}">${v}</button>`).join("") : ["25%", "50%", "75%", "max"].map((v) => `<button data-q="${v}">${v}</button>`).join("")}</div>
        <div class="summary">
          <div><span>you receive</span><b id="recv">—</b></div>
          <div><span>fee (${FEE * 100}%)</span><b id="feeOut">—</b></div>
          <div><span>balance</span><b>${w ? fmtEth(w.balance) : "not connected"}</b></div>
          <div><span>holding</span><b>${fmt(held)} $${esc(m.ticker)}</b></div>
        </div>
        <div class="err" id="tErr"></div>
        <button class="btn btn-lg ${side === "buy" ? "btn-ink" : "btn-outline"} press" id="goTrade" ${done && side === "buy" ? "disabled" : ""}>${!w ? "connect wallet" : done && side === "buy" ? "curve complete" : side}</button>`;
      const amt = $("#amt", box);
      const upd = () => {
        const v = Number(amt.value);
        const err = $("#tErr", box);
        err.textContent = "";
        if (!(v > 0)) { $("#recv", box).textContent = "—"; $("#feeOut", box).textContent = "—"; return; }
        if (side === "buy") {
          const q = curve.buyQuote(m, v);
          $("#recv", box).textContent = fmt(q.out) + " $" + m.ticker;
          $("#feeOut", box).textContent = fmtEth(q.fee);
          if (w && v > w.balance + 1e-12) err.textContent = "not enough balance";
        } else {
          const q = curve.sellQuote(m, v);
          $("#recv", box).textContent = fmtEth(q.out);
          $("#feeOut", box).textContent = fmtEth(q.fee);
          if (v > held + 1e-6) err.textContent = "you don't hold that many";
        }
      };
      amt.addEventListener("input", upd);
      $$("[data-side]", box).forEach((b) => b.addEventListener("click", () => { side = b.dataset.side; draw(); }));
      $$("[data-q]", box).forEach((b) => b.addEventListener("click", () => {
        const q = b.dataset.q;
        const wal = state.wallet;
        if (side === "buy") amt.value = q === "max" ? (wal ? Math.floor(wal.balance * 1e6) / 1e6 : 0) : q;
        else {
          const pct = q === "max" ? 1 : parseFloat(q) / 100;
          amt.value = held ? String(pct === 1 ? held : Math.floor(held * pct)) : 0;
        }
        upd();
      }));
      $("#goTrade", box).addEventListener("click", () => {
        if (!state.wallet) { connect(); draw(); return; }
        const wal = state.wallet;
        const v = Number(amt.value);
        const err = $("#tErr", box);
        if (!(v > 0)) { err.textContent = "enter an amount"; return; }
        try {
          if (side === "buy") {
            if (v > wal.balance + 1e-12) throw new Error("not enough balance");
            const res = buy(m, Math.min(v, wal.balance));
            wal.balance = Math.max(0, wal.balance - res.spent);
            wal.holdings[m.id] = (wal.holdings[m.id] || 0) + res.tokens;
            logActivity({ type: "buy", marketId: m.id, who: wal.address, tokens: res.tokens, eth: res.spent });
            toast(`bought ${fmt(res.tokens)} $${m.ticker}`);
          } else {
            const have = wal.holdings[m.id] || 0;
            if (v > have + 1e-6) throw new Error("you don't hold that many");
            const tok = Math.min(v, have);
            const res = sell(m, tok);
            wal.balance += res.eth;
            wal.holdings[m.id] = have - tok;
            if (wal.holdings[m.id] < 1e-6) delete wal.holdings[m.id];
            logActivity({ type: "sell", marketId: m.id, who: wal.address, tokens: tok, eth: res.eth });
            toast(`sold for ${fmtEth(res.eth)}`);
          }
          recordPrice(m);
          save();
          render();
        } catch (ex) { err.textContent = ex.message; }
      });
    };
    draw();

    $("#refreshRepo", app)?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = "refreshing…";
      try {
        const fresh = await fetchRepo(m.repo.owner, m.repo.name);
        m.repo = { ...m.repo, ...fresh };
        save();
        toast("repository stats updated");
        render();
      } catch (ex) {
        toast(ex.message);
        if (b.isConnected) { b.disabled = false; b.textContent = "refresh from GitHub"; }
      }
    });
  };

  function viewActivity() {
    const acts = state.activity.slice(0, 100);
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">activity</div><h2>live activity</h2><p>Launches and trades across every market, newest first.</p></div>
      <div class="card feed"><div class="list">${acts.length ? acts.map((a) => `<div class="list-item">${activityLine(a)}<span class="t">${ago(a.t)} ago</span></div>`).join("") : `<div class="list-item muted">no activity yet — the first launch shows up here</div>`}</div></div>
    </div>`;
  }
  viewActivity.mount = () => {
    // refresh relative timestamps
    const t = setInterval(() => { if (!document.hidden) render(); }, 30000);
    cleanup.push(() => clearInterval(t));
  };

  function viewHow() {
    return `<div class="page">${howSteps()}
      <div class="card" style="margin-top:16px;padding:22px;line-height:1.7;color:var(--dim);font-size:14px">
        <h3 style="font-size:18px;margin-bottom:10px">the curve</h3>
        Each market starts with ${fmt(TOTAL_SUPPLY, 0)} tokens. ${fmt(CURVE_SUPPLY, 0)} are sold along a constant-product curve (<span class="mono">x · y = k</span>) with virtual reserves of ${V_ETH0} ETH and ${fmt(V_TOK0, 3)} tokens. The price rises as people buy and falls as they sell. Every trade pays a ${FEE * 100}% fee: half goes to the market creator and half to the treasury. When all ${fmt(CURVE_SUPPLY, 0)} curve tokens are sold, the market graduates and buying stops.
        <h3 style="font-size:18px;margin:18px 0 10px">verification</h3>
        Forkline generates a one-time code. The maintainer commits it in a <span class="mono">${VERIFY_FILE}</span> file on the default branch, and Forkline reads that file straight from GitHub. Only people with write access can do this. Repositories without the file can still launch, but they carry an unverified label.
        <h3 style="font-size:18px;margin:18px 0 10px">this build</h3>
        This is a demo. GitHub data and verification are real, but the wallet, balances and curve are simulated in your browser and saved to local storage.
      </div>
    </div>`;
  }

  function viewTreasury() {
    const fees = state.markets.reduce((s, m) => s + m.creatorFees, 0);
    const vol = state.markets.reduce((s, m) => s + volume(m), 0);
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">treasury</div><h2>treasury</h2><p>Half of every trading fee collects here. The other half goes to the creators of each market.</p></div>
      <div class="tstats">
        <div class="card"><div class="eyebrow">treasury balance</div><div class="v">${state.treasury.toFixed(4)} Ξ</div></div>
        <div class="card"><div class="eyebrow">paid to creators</div><div class="v">${fees.toFixed(4)} Ξ</div></div>
        <div class="card"><div class="eyebrow">total volume</div><div class="v">${fmt(vol)} Ξ</div></div>
      </div>
      <div class="card"><div class="card-title">fees by market</div><div class="list">${state.markets.length ? [...state.markets].sort((a, b) => b.creatorFees - a.creatorFees).map((m) => `<div class="list-item"><a href="#/m/${m.id}">$${esc(m.ticker)}</a><span class="muted mono small">${esc(m.repo.fullName)}</span><span class="t">${(m.creatorFees * 2).toFixed(4)} Ξ</span></div>`).join("") : `<div class="list-item muted">no fees collected yet</div>`}</div></div>
    </div>`;
  }

  function viewProfile() {
    const w = state.wallet;
    if (!w) return `<div class="page"><div class="page-head"><div class="eyebrow">profile</div><h2>your profile</h2></div>
      <div class="empty"><p>connect a demo wallet to trade and launch</p><button class="btn btn-ink press" id="pConnect">connect</button></div></div>`;
    const holdings = Object.entries(w.holdings).map(([id, amt]) => ({ m: state.markets.find((x) => x.id === id), amt })).filter((h) => h.m && h.amt > 0);
    const value = holdings.reduce((s, h) => s + curve.sellQuote(h.m, h.amt).out, 0);
    const created = state.markets.filter((m) => m.creator === w.address);
    return `<div class="page">
      <div class="page-head"><div class="eyebrow">profile</div><h2 class="mono" style="font-size:clamp(18px,3vw,28px);word-break:break-all">${esc(w.address)}</h2></div>
      <div class="tstats">
        <div class="card"><div class="eyebrow">balance</div><div class="v">${w.balance.toFixed(4)} Ξ</div></div>
        <div class="card"><div class="eyebrow">holdings value</div><div class="v">${value.toFixed(4)} Ξ</div></div>
        <div class="card"><div class="eyebrow">creator earnings</div><div class="v">${created.reduce((s, m) => s + m.creatorFees, 0).toFixed(4)} Ξ</div></div>
      </div>
      <div class="subgrid" style="margin-top:0">
        <div class="card"><div class="card-title">holdings</div><div class="list">${holdings.length ? holdings.map((h) => `<div class="list-item"><a href="#/m/${h.m.id}">$${esc(h.m.ticker)}</a><span class="t">${fmt(h.amt)}</span></div>`).join("") : `<div class="list-item muted">nothing yet</div>`}</div></div>
        <div class="card"><div class="card-title">launched</div><div class="list">${created.length ? created.map((m) => `<div class="list-item"><a href="#/m/${m.id}">$${esc(m.ticker)}</a><span class="muted mono small">${esc(m.repo.fullName)}</span></div>`).join("") : `<div class="list-item muted">no launches yet</div>`}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-outline press" id="copyAddr">copy address</button>
        <button class="btn btn-ghost press" id="disc">disconnect</button>
        <button class="btn btn-ghost press" id="reset" style="color:var(--red)">reset demo data</button>
      </div>
    </div>`;
  }
  viewProfile.mount = (app) => {
    $("#pConnect", app)?.addEventListener("click", () => { connect(); render(); });
    $("#copyAddr", app)?.addEventListener("click", () => copy(state.wallet.address));
    $("#disc", app)?.addEventListener("click", () => { disconnect(); render(); });
    let armed = false;
    $("#reset", app)?.addEventListener("click", (e) => {
      if (!armed) {
        armed = true;
        e.currentTarget.textContent = "click again to delete all demo data";
        return;
      }
      state = defaultState(); save(); toast("demo data cleared"); location.hash = "#/";
      render();
    });
  };

  function viewNotFound() {
    return `<div class="page"><div class="empty"><p>that page doesn't exist</p><a href="#/" class="btn btn-ink press">go home</a></div></div>`;
  }

  // ---------- boot ----------
  document.documentElement.classList.add("js-motion");
  lastPath = location.hash.split("?")[0];
  onScroll();
  render();
})();
