/* Forkline — procedural sky.
 * Draws soft cumulus clouds with fractal value noise on canvas (no image assets),
 * and drifts them across a fixed sky layer. */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- noise ----------
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    const r = rng(seed);
    const val = new Float32Array(256);
    const perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) { val[i] = r(); perm[i] = i; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const at = (x, y) => val[perm[(perm[x & 255] + y) & 255]];
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    return (x, y, oct = 5) => {
      let s = 0, amp = 0.5, f = 1, norm = 0;
      for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
      return s / norm;
    };
  }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- cloud renderer ----------
  // puffs: [{x,y,r}] in css px; core: optional rect kept fully opaque (for panels); base: flat-bottom y
  function renderCloud(w, h, { puffs, core = null, base = null, seed = 1, res = 0.5 }) {
    const cw = Math.max(1, Math.round(w * res)), ch = Math.max(1, Math.round(h * res));
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(cw, ch);
    const px = img.data;
    const fbm = makeNoise(seed);
    const fbm2 = makeNoise(seed * 7 + 3);
    let top = h, bottom = 0;
    for (const p of puffs) { top = Math.min(top, p.y - p.r); bottom = Math.max(bottom, p.y + p.r); }
    if (core) { top = Math.min(top, core.y); bottom = Math.max(bottom, core.y + core.h); }
    const span = Math.max(1, bottom - top);
    for (let j = 0; j < ch; j++) {
      const y = j / res;
      for (let i = 0; i < cw; i++) {
        const x = i / res;
        let shape = 0;
        for (let k = 0; k < puffs.length; k++) {
          const p = puffs[k];
          const dx = x - p.x, dy = (y - p.y) * 1.08;
          const s = 1 - Math.sqrt(dx * dx + dy * dy) / p.r;
          if (s > shape) shape = s;
        }
        let coreW = 0;
        if (core) {
          const ox = Math.max(core.x - x, 0, x - (core.x + core.w));
          const oy = Math.max(core.y - y, 0, y - (core.y + core.h));
          const out = Math.sqrt(ox * ox + oy * oy);
          coreW = 1 - smooth(0, 18, out);
        }
        if (shape <= -0.2 && coreW <= 0) continue;
        const n = fbm(x / 70 + seed, y / 70);
        let d = shape + (n - 0.5) * 0.95;
        if (base !== null) d *= 1 - smooth(base - 14, base + 10, y);
        let a = Math.max(smooth(0.18, 0.62, d), coreW);
        if (a <= 0.003) continue;
        // light from above: bright crowns, cool grey undersides, billowy texture
        const t = Math.min(1, Math.max(0, (y - top) / span));
        const billow = fbm2(x / 38, y / 38, 4);
        let shade = 1 - 0.17 * Math.pow(t, 1.5) - 0.09 * (1 - billow) * smooth(0.2, 0.9, d);
        shade = shade * (1 - coreW) + coreW * (0.985 - 0.03 * t);
        const edge = 1 - smooth(0.2, 0.75, d); // thin edges pick up the sky tint
        const tint = edge * (1 - coreW);
        const r = 255 * shade - 22 * tint - 10 * t;
        const g = 255 * shade - 10 * tint - 5 * t;
        const b = 255 * Math.min(1, shade + 0.04 + 0.05 * t);
        const o = (j * cw + i) * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // a free-floating cumulus: flat base, stacked puffs rising in the middle
  function cumulus(w, h, seed) {
    const r = rng(seed);
    const puffs = [];
    const base = h * 0.8;
    const n = 7 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      const fx = 0.16 + (i / (n - 1)) * 0.68 + (r() - 0.5) * 0.06;
      const mid = 1 - Math.abs(fx - 0.5) * 2; // tallest near the middle
      const rad = h * (0.2 + 0.2 * mid + r() * 0.1);
      puffs.push({ x: fx * w, y: base - rad * (0.55 + 0.5 * mid) - r() * h * 0.06, r: rad });
    }
    return renderCloud(w, h, { puffs, base, seed, res: 0.45 });
  }

  // ---------- drifting sky layer ----------
  function startSky() {
    const cv = document.createElement("canvas");
    cv.className = "sky-clouds";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
    const sky = document.createElement("div");
    sky.className = "sky";
    sky.setAttribute("aria-hidden", "true");
    document.body.prepend(sky);
    const ctx = cv.getContext("2d");
    let W = 0, H = 0;
    let clouds = [];

    const build = () => {
      const small = innerWidth < 700;
      const count = small ? 5 : 9;
      const r = rng(20260927);
      clouds = [];
      for (let i = 0; i < count; i++) {
        const depth = 0.35 + r() * 0.65; // 1 = near
        const w = (small ? 260 : 380) + depth * (small ? 160 : 320) + r() * 120;
        const h = w * (0.42 + r() * 0.12);
        clouds.push({
          sprite: cumulus(w, h, 1000 + i * 97),
          w, h, depth,
          x: r() * (innerWidth + w) - w,
          y: innerHeight * (0.04 + r() * 0.85) - h / 2,
          speed: 4 + depth * 10,
          alpha: 0.7 + depth * 0.3,
        });
      }
      clouds.sort((a, b) => a.depth - b.depth);
    };
    const resize = () => {
      W = cv.width = innerWidth;
      H = cv.height = innerHeight;
      draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const sy = scrollY;
      for (const c of clouds) {
        let y = c.y - sy * 0.12 * c.depth;
        const period = H + c.h * 2;
        y = ((((y + c.h) % period) + period) % period) - c.h; // wrap vertically on long pages
        ctx.globalAlpha = c.alpha;
        ctx.drawImage(c.sprite, c.x, y, c.w, c.h);
      }
      ctx.globalAlpha = 1;
    };
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!document.hidden) {
        for (const c of clouds) {
          c.x += c.speed * dt;
          if (c.x > W + 20) c.x = -c.w - 20;
        }
        draw();
      }
      requestAnimationFrame(tick);
    };

    build();
    resize();
    let rt;
    addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { const wasSmall = W < 700; resize(); if (wasSmall !== innerWidth < 700) { build(); draw(); } }, 150);
    });
    if (reduceMotion) addEventListener("scroll", draw, { passive: true });
    else requestAnimationFrame(tick);
  }

  window.Sky = { start: startSky, cumulus };
})();
