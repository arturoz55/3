/* Forkline — Zcash helpers.
 * Validates mainnet Zcash addresses (unified, Sapling, TEX and transparent) with their real
 * checksums, builds ZIP-321 payment URIs, and draws them as QR codes. */
(() => {
  "use strict";

  // ---------- bech32 / bech32m (BIP-173, BIP-350) ----------
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const BECH32 = 1, BECH32M = 0x2bc830a3;
  function polymod(values) {
    const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
    }
    return chk >>> 0;
  }
  function bech32Decode(str) {
    if (str !== str.toLowerCase() && str !== str.toUpperCase()) return null;
    const s = str.toLowerCase();
    const pos = s.lastIndexOf("1");
    if (pos < 1 || pos + 7 > s.length) return null;
    const hrp = s.slice(0, pos);
    const data = [];
    for (const c of s.slice(pos + 1)) {
      const d = CHARSET.indexOf(c);
      if (d === -1) return null;
      data.push(d);
    }
    const exp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
    const check = polymod(exp.concat(data));
    const variant = check === BECH32 ? "bech32" : check === BECH32M ? "bech32m" : null;
    return variant ? { hrp, variant, dataLength: data.length - 6 } : null;
  }

  // ---------- base58check (transparent addresses) ----------
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58Decode(s) {
    let n = 0n;
    for (const c of s) {
      const d = B58.indexOf(c);
      if (d === -1) return null;
      n = n * 58n + BigInt(d);
    }
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const c of s) { if (c !== "1") break; bytes.unshift(0); }
    return new Uint8Array(bytes);
  }
  async function sha256d(bytes) {
    const a = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", a));
  }

  // ---------- validation ----------
  // returns { ok, kind, shielded, label } or { ok: false, reason }
  async function validate(input) {
    const addr = String(input || "").trim();
    if (!addr) return { ok: false, reason: "empty address" };
    const lower = addr.toLowerCase();
    if (/^(utest1|ztestsapling1|tm|textest1)/.test(lower)) return { ok: false, reason: "that is a testnet address — use a mainnet address" };

    if (/^(u1|zs1|tex1)/.test(lower)) {
      const d = bech32Decode(addr);
      if (!d) return { ok: false, reason: "the address checksum does not match — check for a typo" };
      if (d.hrp === "u" && d.variant === "bech32m") return { ok: true, address: lower, kind: "unified", shielded: true, label: "unified address" };
      if (d.hrp === "zs" && d.variant === "bech32" && lower.length === 78) return { ok: true, address: lower, kind: "sapling", shielded: true, label: "Sapling shielded address" };
      if (d.hrp === "tex" && d.variant === "bech32m") return { ok: true, address: lower, kind: "tex", shielded: false, label: "TEX address" };
      return { ok: false, reason: "not a valid Zcash address encoding" };
    }
    if (/^t[13]/.test(addr)) {
      if (addr.length !== 35) return { ok: false, reason: "transparent addresses are 35 characters long" };
      const raw = base58Decode(addr);
      if (!raw || raw.length !== 26) return { ok: false, reason: "not a valid transparent address" };
      const body = raw.slice(0, 22), sum = raw.slice(22);
      const h = await sha256d(body);
      if (h[0] !== sum[0] || h[1] !== sum[1] || h[2] !== sum[2] || h[3] !== sum[3]) return { ok: false, reason: "the address checksum does not match — check for a typo" };
      const p2pkh = body[0] === 0x1c && body[1] === 0xb8, p2sh = body[0] === 0x1c && body[1] === 0xbd;
      if (!p2pkh && !p2sh) return { ok: false, reason: "not a Zcash mainnet transparent address" };
      return { ok: true, address: addr, kind: "transparent", shielded: false, label: "transparent address" };
    }
    return { ok: false, reason: "Zcash addresses start with u1, zs1, t1, t3 or tex1" };
  }

  // ---------- ZIP-321 payment URI ----------
  const b64url = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const MEMO_MAX = 512; // bytes
  function memoBytes(memo) { return new TextEncoder().encode(memo || "").length; }
  function formatAmount(zec) {
    // at most 8 decimals (1 zatoshi = 1e-8 ZEC), no trailing zeros
    return Number(zec).toFixed(8).replace(/\.?0+$/, "");
  }
  function paymentUri({ address, shielded }, { amount, memo, message } = {}) {
    const params = [];
    if (amount > 0) params.push("amount=" + formatAmount(amount));
    if (memo && shielded && memoBytes(memo) <= MEMO_MAX) params.push("memo=" + b64url(memo));
    if (message) params.push("message=" + encodeURIComponent(message));
    return "zcash:" + address + (params.length ? "?" + params.join("&") : "");
  }

  // ---------- QR ----------
  function qrSvg(text) {
    if (typeof window.qrcode !== "function") return "";
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount(), m = 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="payment QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0e0d14"/></svg>`;
  }

  // reads "zcash=<address>" (or "zcash: <address>") from a .forkline file
  function addressFromFile(text) {
    const m = String(text || "").match(/^\s*zcash\s*[=:]\s*(\S+)\s*$/im);
    return m ? m[1] : null;
  }

  window.Zcash = { validate, paymentUri, qrSvg, addressFromFile, memoBytes, MEMO_MAX };
})();
